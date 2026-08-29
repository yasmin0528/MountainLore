"""Small, testable adapters for OpenAI-compatible Credits endpoints."""

from __future__ import annotations

import base64
import json
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, retriable: bool = True):
        self.code = code
        self.retriable = retriable
        super().__init__(message)


@dataclass
class TideSource:
    url: str
    title: str
    published_at: str | None
    theme: str
    content_motif: str
    fit_reason: str
    risk_note: str


@dataclass
class WeeklyTideSource:
    url: str
    channel: str
    publisher: str
    title: str
    published_at: str | None


@dataclass
class WeeklyTideIdea:
    theme: str
    content_motif: str
    applicable_scene: str
    festival_context: str
    risk_note: str
    source_urls: list[str]


def _json_from_content(content: str) -> dict[str, Any]:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise ProviderError("invalid_model_json", "模型没有返回可用的结构化内容")
        try:
            return json.loads(match.group())
        except json.JSONDecodeError as exc:
            raise ProviderError("invalid_model_json", "模型返回的结构化内容无法解析") from exc


class CreditsProvider:
    def __init__(self) -> None:
        self.timeout = httpx.Timeout(settings.provider_timeout_seconds)

    @property
    def live(self) -> bool:
        return settings.ai_runtime_mode.lower() == "live"

    def readiness(self) -> dict[str, Any]:
        configured = bool(settings.openai_next_api_key)
        tide_configured = settings.tide_configured
        return {
            "mode": "live" if self.live else "demo",
            "capabilities": {
                "fieldwork": {"configured": configured, "model": settings.openai_next_text_model, "status": "configured" if configured else "missing_key"},
                "brand": {"configured": configured, "model": settings.openai_next_text_model, "status": "configured" if configured else "missing_key"},
                "tide": {
                    "configured": tide_configured,
                    "model": settings.tide_synthesis_model,
                    "search_model": settings.tide_search_model,
                    "status": "configured" if tide_configured else "missing_key",
                },
                "image": {"configured": bool(settings.resolved_image_api_key), "model": settings.openai_next_image_model, "status": "unverified" if settings.resolved_image_api_key else "missing_key"},
            },
            # Kept for older clients while the UI migrates to capabilities.
            "text_configured": configured,
            "image_configured": bool(settings.resolved_image_api_key),
            "text_model": settings.openai_next_text_model,
            "tide_model": settings.tide_synthesis_model,
            "image_model": settings.openai_next_image_model,
        }

    def available_models(self) -> list[str]:
        if not self.live:
            return []
        if not settings.openai_next_api_key:
            raise ProviderError("provider_not_configured", "请先配置 OPENAI_NEXT_API_KEY")
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.get(
                    f"{settings.openai_next_base_url.rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {settings.openai_next_api_key}"},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderError("provider_unavailable", "无法读取模型列表，请检查 Key、余额与网络") from exc
        return [str(item.get("id")) for item in response.json().get("data", []) if item.get("id")]

    def chat_json(
        self, *, model: str, instruction: str, context: dict[str, Any],
        image_paths: list[str] | None = None,
    ) -> dict[str, Any]:
        return self._chat_json(
            model=model,
            instruction=instruction,
            context=context,
            base_url=settings.openai_next_base_url,
            api_key=settings.openai_next_api_key,
            missing_key_message="请先配置 OPENAI_NEXT_API_KEY",
            image_paths=image_paths,
        )

    def tide_chat_json(
        self, *, model: str, instruction: str, context: dict[str, Any], temperature: float | None = None,
    ) -> dict[str, Any]:
        """Run the weekly report through its isolated search/synthesis provider."""
        return self._chat_json(
            model=model,
            instruction=instruction,
            context=context,
            base_url=settings.tide_api_base_url,
            api_key=settings.tide_api_key,
            missing_key_message="请先配置 TIDE_API_KEY",
            temperature=temperature,
        )

    def _chat_json(
        self, *, model: str, instruction: str, context: dict[str, Any], base_url: str,
        api_key: str, missing_key_message: str, image_paths: list[str] | None = None,
        temperature: float | None = 0.45,
    ) -> dict[str, Any]:
        if not self.live:
            raise ProviderError("demo_mode", "演示模式未调用真实模型")
        if not api_key:
            raise ProviderError("provider_not_configured", missing_key_message)
        user_text = f"{instruction}\n\n输入上下文：\n{json.dumps(context, ensure_ascii=False)}"
        user_content: str | list[dict[str, Any]] = user_text
        if image_paths:
            parts: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
            for raw_path in image_paths[:4]:
                path = Path(raw_path)
                if not path.is_file():
                    continue
                mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
                encoded = base64.b64encode(path.read_bytes()).decode("ascii")
                parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}", "detail": "low"}})
            user_content = parts
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": "你是严谨的贵州山地农产品品牌编辑。只输出合法 JSON，不虚构事实、来源或功效。"},
                {"role": "user", "content": user_content},
            ],
        }
        if temperature is not None:
            payload["temperature"] = temperature
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    f"{base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError("provider_timeout", "模型请求超时，可重试") from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 400:
                raise ProviderError(
                    "provider_bad_request",
                    "模型请求无效或模型当前不可用，请检查模型名和网关配置",
                    retriable=False,
                ) from exc
            if status in {401, 403}:
                raise ProviderError("provider_auth_failed", "模型 Key 无效或没有该模型权限", retriable=False) from exc
            if status in {402, 429}:
                raise ProviderError("provider_quota_or_rate_limited", "模型余额不足或请求受限，请检查账户后重试") from exc
            raise ProviderError("provider_unavailable", f"模型服务返回 HTTP {status}，可重试") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("provider_unavailable", "模型服务暂不可用，可重试") from exc
        body = response.json()
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        return _json_from_content(str(content))

    def tide_search(self, context: dict[str, Any]) -> list[TideSource]:
        result = self.tide_chat_json(
            model=settings.tide_search_model,
            instruction=(
                "联网检索与当前产品、产地、品牌路线相关的近期公开内容。返回 JSON："
                '{"sources":[{"url":"https://...","title":"...","published_at":"YYYY-MM-DD 或 null",'
                '"theme":"...","content_motif":"...","fit_reason":"...","risk_note":"..."}]}。'
                "只返回实际搜索到且可打开的原始来源，最多 2 条；没有则返回空数组。"
            ),
            context=context,
        )
        raw_sources = result.get("sources")
        if not isinstance(raw_sources, list):
            raise ProviderError("missing_citations", "联网模型没有返回可验证的来源")
        sources: list[TideSource] = []
        for raw in raw_sources[:2]:
            if not isinstance(raw, dict) or not str(raw.get("url", "")).startswith(("https://", "http://")):
                continue
            sources.append(TideSource(
                url=str(raw["url"]), title=str(raw.get("title") or "未命名来源"),
                published_at=str(raw["published_at"]) if raw.get("published_at") else None,
                theme=str(raw.get("theme") or "内容灵感"), content_motif=str(raw.get("content_motif") or ""),
                fit_reason=str(raw.get("fit_reason") or ""), risk_note=str(raw.get("risk_note") or "需人工判断语境与版权"),
            ))
        if not sources:
            raise ProviderError("missing_citations", "联网模型没有返回可验证的来源")
        return sources

    def weekly_tide_candidates(self) -> list[WeeklyTideSource]:
        """Ask the live search model for public pages only; final filtering happens locally."""
        result = self.tide_chat_json(
            model=settings.tide_search_model,
            instruction=(
                "联网检索近30天中国新消费与餐饮行业的公开内容。检索时覆盖并优先这些网站："
                "红餐网(canyin88.com)、餐饮老板内参(watcn.com)、Foodaily(foodaily.com)、"
                "小食代(foodinc.com.cn)、观潮新消费(tidesight.com)、36氪(36kr.com)，"
                "并分别检索公开可访问的小红书帖子(xiaohongshu.com)与抖音趋势页(douyin.com)。"
                "只返回真实、可公开打开的 HTTPS 原始页面，不得使用聚合转载、登录页或搜索结果页。"
                "返回 JSON：{\"sources\":[{\"url\":\"https://...\",\"channel\":\"industry|xiaohongshu|douyin\","
                "\"publisher\":\"...\",\"title\":\"...\",\"published_at\":\"YYYY-MM-DD 或 null\"}]}。"
                f"最多返回 {settings.tide_source_max_results} 条，宁缺毋滥。"
            ),
            context={"task": "weekly_consumer_and_food_trend_scan"},
        )
        raw_sources = result.get("sources")
        if not isinstance(raw_sources, list):
            raise ProviderError("missing_citations", "联网模型没有返回可验证的周报来源")
        sources: list[WeeklyTideSource] = []
        for raw in raw_sources[: settings.tide_source_max_results]:
            if not isinstance(raw, dict):
                continue
            url = str(raw.get("url") or "")
            channel = str(raw.get("channel") or "")
            if not url.startswith("https://") or channel not in {"industry", "xiaohongshu", "douyin"}:
                continue
            sources.append(WeeklyTideSource(
                url=url,
                channel=channel,
                publisher=str(raw.get("publisher") or "公开来源"),
                title=str(raw.get("title") or "未命名来源"),
                published_at=str(raw["published_at"]) if raw.get("published_at") else None,
            ))
        if not sources:
            raise ProviderError("missing_citations", "联网模型没有返回可验证的周报来源")
        return sources

    def weekly_tide_ideas(self, sources: list[dict[str, Any]], holidays: list[dict[str, str]]) -> list[WeeklyTideIdea]:
        result = self.tide_chat_json(
            model=settings.tide_synthesis_model,
            instruction=(
                "基于已验链来源生成5到6条通用的餐饮/新消费创意灵感。"
                "趋势只能作为创意角度，不能写成品牌、产品或功效事实；不得添加未在输入来源中出现的信息。"
                "每条必须引用至少一个输入 source_urls，主题不可重复；结合未来45天节日，若无适合节点写“非节日驱动”。"
                "返回 JSON：{\"ideas\":[{\"theme\":\"...\",\"content_motif\":\"...\","
                "\"applicable_scene\":\"...\",\"festival_context\":\"...\",\"risk_note\":\"...\","
                "\"source_urls\":[\"https://...\"]}]}。"
            ),
            context={"verified_sources": sources, "upcoming_holidays": holidays},
            # The platform's kimi-k3 gateway accepts only temperature=1.
            temperature=1,
        )
        raw_ideas = result.get("ideas")
        if not isinstance(raw_ideas, list):
            raise ProviderError("invalid_model_json", "联网模型没有返回周报灵感")
        ideas: list[WeeklyTideIdea] = []
        for raw in raw_ideas[:6]:
            if not isinstance(raw, dict):
                continue
            urls = [str(url) for url in raw.get("source_urls", []) if isinstance(url, str)]
            theme = str(raw.get("theme") or "").strip()
            if not theme or not urls:
                continue
            ideas.append(WeeklyTideIdea(
                theme=theme,
                content_motif=str(raw.get("content_motif") or "").strip(),
                applicable_scene=str(raw.get("applicable_scene") or "").strip(),
                festival_context=str(raw.get("festival_context") or "非节日驱动").strip(),
                risk_note=str(raw.get("risk_note") or "仅作创意角度，需结合品牌事实复核").strip(),
                source_urls=urls,
            ))
        return ideas

    def verify_source(self, url: str) -> bool:
        try:
            with httpx.Client(timeout=httpx.Timeout(12), follow_redirects=True) as client:
                response = client.get(url, headers={"User-Agent": "MountainLore/0.1 source-check"})
                return 200 <= response.status_code < 400
        except httpx.HTTPError:
            return False

    def generate_image(self, prompt: str, reference_images: list[str] | None = None) -> dict[str, str]:
        if not self.live:
            raise ProviderError("demo_mode", "演示模式未调用真实图片服务")
        key = settings.resolved_image_api_key
        if not key:
            raise ProviderError("image_provider_not_configured", "请先配置图片服务 Key")
        payload: dict[str, Any] = {
            "model": settings.openai_next_image_model,
            "prompt": prompt,
            "n": 1,
            "size": "1024x1536",
            "response_format": "b64_json",
        }
        if reference_images:
            payload["image"] = reference_images[:4]
        try:
            with httpx.Client(timeout=httpx.Timeout(max(settings.provider_timeout_seconds, 90))) as client:
                response = client.post(
                    f"{settings.openai_next_image_base_url.rstrip('/')}/images/generations",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=payload,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError("image_timeout", "图片任务超时，可重试") from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in {401, 403}:
                raise ProviderError("image_auth_failed", "图片 Key 无效或没有图片模型权限", retriable=False) from exc
            if status in {402, 429}:
                raise ProviderError("image_quota_or_rate_limited", "图片余额不足或请求受限，请检查账户后重试") from exc
            raise ProviderError("image_unavailable", f"图片服务返回 HTTP {status}，可重试") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("image_unavailable", "图片服务暂不可用，可重试") from exc
        item = response.json().get("data", [{}])[0]
        if item.get("b64_json"):
            return {"kind": "base64", "value": str(item["b64_json"])}
        if item.get("url"):
            return {"kind": "url", "value": str(item["url"])}
        raise ProviderError("image_invalid_response", "图片服务没有返回图片")

    @staticmethod
    def write_base64_image(value: str, destination: str) -> None:
        with open(destination, "wb") as output:
            output.write(base64.b64decode(value))


provider = CreditsProvider()
