"""Small, testable adapters for OpenAI-compatible Credits endpoints."""

from __future__ import annotations

import base64
import json
import mimetypes
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

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
    body_excerpt: str = ""


@dataclass
class WeeklyTideIdea:
    theme: str
    content_motif: str
    applicable_scene: str
    festival_context: str
    risk_note: str
    source_urls: list[str]


@dataclass(frozen=True)
class TavilyWeeklyQuery:
    domain: str
    channel: str
    publisher: str
    query: str


_TAVILY_WEEKLY_QUERIES = (
    TavilyWeeklyQuery("canyin88.com", "industry", "红餐网", "近7天 中国 地方食材 农产品 供应链 风味 site:canyin88.com"),
    TavilyWeeklyQuery("watcn.com", "industry", "餐饮老板内参", "近7天 中国 地方食材 农产品 产地 品牌 site:watcn.com"),
    TavilyWeeklyQuery("foodaily.com", "industry", "Foodaily", "近7天 中国 山地农产品 地方风味 食品饮料 site:foodaily.com"),
    TavilyWeeklyQuery("foodinc.com.cn", "industry", "小食代", "近7天 中国 农产品 原产地 食品饮料 site:foodinc.com.cn"),
    TavilyWeeklyQuery("tidesight.com", "industry", "观潮新消费", "近7天 中国 地方物产 农产品 新消费 品牌 site:tidesight.com"),
    TavilyWeeklyQuery("36kr.com", "industry", "36氪", "近7天 中国 农业 农产品 品牌 消费 site:36kr.com"),
    TavilyWeeklyQuery("xiaohongshu.com", "xiaohongshu", "小红书公开帖", "近7天 山野 农产品 产地 风味 热议 公开帖子 site:xiaohongshu.com"),
    TavilyWeeklyQuery("douyin.com", "douyin", "抖音公开趋势", "近7天 山野 农产品 产地 风味 热议 site:douyin.com"),
)
_SHANGHAI = ZoneInfo("Asia/Shanghai")
_MAX_WEEKLY_SOURCES_PER_DOMAIN = 3
_FIRST_PARTY_WEEKLY_LISTINGS = (
    ("https://www.canyin88.com/zixun/", "industry", "红餐网", r'href=["\']([^"\']*/zixun/20\d{2}/\d{1,2}/\d{1,2}/\d+\.html)'),
    ("https://www.tidesight.com/news/", "industry", "观潮新消费", r'href=["\'](https?://[^"\']+/news/\d+\.html)'),
)


def _json_from_content(content: str) -> dict[str, Any]:
    parsed: Any
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise ProviderError("invalid_model_json", "模型没有返回可用的结构化内容")
        try:
            parsed = json.loads(match.group())
        except json.JSONDecodeError as exc:
            raise ProviderError("invalid_model_json", "模型返回的结构化内容无法解析") from exc
    if not isinstance(parsed, dict):
        raise ProviderError("invalid_model_json", "模型返回的结构化内容必须是 JSON 对象")
    return parsed


def _is_recent(published_at: object) -> bool:
    """Weekly reports only accept concrete article dates inside the lookback window."""
    if not published_at:
        return False
    match = re.search(r"(20\d{2})[-/](\d{1,2})[-/](\d{1,2})", str(published_at))
    if not match:
        return False
    try:
        published = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=_SHANGHAI)
    except ValueError:
        return False
    current = datetime.now(_SHANGHAI)
    return current - timedelta(days=min(settings.tide_search_lookback_days, 7)) <= published <= current

def _is_candidate_date_eligible(published_at: object) -> bool:
    """Search indexes often omit dates; the article page remains the authority.

    A missing search-index date is not evidence that an article is stale. Keep
    it as a candidate, then require a concrete, recent date after fetching the
    publisher page in ``verify_weekly_source``. Explicitly dated old results
    can still be discarded early to save a network request.
    """
    return not published_at or _is_recent(published_at)

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
                    "search_provider": settings.tide_search_provider,
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
            json_mode=settings.openai_next_json_mode,
        )

    def tide_chat_json(
        self, *, model: str, instruction: str, context: dict[str, Any], temperature: float | None = None,
        timeout_seconds: float | None = None,
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
            timeout=httpx.Timeout(timeout_seconds) if timeout_seconds else None,
            json_mode=False,
        )

    def _chat_json(
        self, *, model: str, instruction: str, context: dict[str, Any], base_url: str,
        api_key: str, missing_key_message: str, image_paths: list[str] | None = None,
        temperature: float | None = 0.45, timeout: httpx.Timeout | None = None,
        json_mode: bool = False,
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
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        try:
            with httpx.Client(timeout=timeout or self.timeout) as client:
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
        """Collect diverse candidate pages directly from Tavily before local verification."""
        if not self.live:
            raise ProviderError("demo_mode", "演示模式未调用真实联网检索")
        if settings.tide_search_provider.lower() != "tavily":
            raise ProviderError("tide_search_provider_unsupported", "当前仅支持 Tavily 作为观潮联网检索服务", retriable=False)
        if not settings.tavily_api_key:
            raise ProviderError("tavily_not_configured", "请先配置 TAVILY_API_KEY", retriable=False)
        sources = self._latest_public_source_candidates()
        seen_urls: set[str] = set()
        domain_counts: dict[str, int] = {}
        for source in sources:
            seen_urls.add(source.url)
            domain = next((query.domain for query in _TAVILY_WEEKLY_QUERIES if source.publisher == query.publisher), source.publisher)
            domain_counts[domain] = domain_counts.get(domain, 0) + 1
        if len(sources) >= 10:
            return sources
        for search_query in _TAVILY_WEEKLY_QUERIES:
            if len(sources) >= settings.tide_source_max_results:
                break
            result = self._tavily_search(search_query)
            raw_sources = result.get("results")
            if not isinstance(raw_sources, list):
                continue
            for raw in raw_sources:
                if not isinstance(raw, dict):
                    continue
                url = str(raw.get("url") or "").strip()
                published_at = raw.get("published_date")
                if (
                    not url.startswith("https://")
                    or url in seen_urls
                    or domain_counts.get(search_query.domain, 0) >= _MAX_WEEKLY_SOURCES_PER_DOMAIN
                    or not _is_candidate_date_eligible(published_at)
                ):
                    continue
                seen_urls.add(url)
                domain_counts[search_query.domain] = domain_counts.get(search_query.domain, 0) + 1
                sources.append(WeeklyTideSource(
                    url=url,
                    channel=search_query.channel,
                    publisher=search_query.publisher,
                    title=str(raw.get("title") or "未命名来源").strip(),
                    published_at=str(published_at) if published_at else None,
                    body_excerpt=str(raw.get("raw_content") or raw.get("content") or "").strip()[:1600],
                ))
                if len(sources) >= settings.tide_source_max_results:
                    break
        if not sources:
            raise ProviderError("tavily_no_results", "Tavily 没有返回可验证的周报来源")
        return sources

    def _latest_public_source_candidates(self) -> list[WeeklyTideSource]:
        """Publisher list pages are fresher than the third-party search index."""
        sources: list[WeeklyTideSource] = []
        seen_urls: set[str] = set()
        with httpx.Client(timeout=httpx.Timeout(min(settings.tide_source_verify_timeout_seconds, 10)), follow_redirects=True) as client:
            for listing_url, channel, publisher, pattern in _FIRST_PARTY_WEEKLY_LISTINGS:
                try:
                    response = client.get(listing_url, headers={"User-Agent": "MountainLore/0.2 weekly-source-list"})
                    response.raise_for_status()
                except httpx.HTTPError:
                    continue
                count = 0
                for raw_url in re.findall(pattern, response.text, flags=re.I):
                    url = urljoin(listing_url, raw_url).split("#", 1)[0]
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)
                    date_match = re.search(r"/(20\d{2})/(\d{1,2})/(\d{1,2})/", url)
                    published_at = "-".join(date_match.groups()) if date_match else None
                    sources.append(WeeklyTideSource(url, channel, publisher, f"{publisher} 最新公开文章", published_at))
                    count += 1
                    if count >= _MAX_WEEKLY_SOURCES_PER_DOMAIN:
                        break
        return sources

    def _tavily_search(self, search_query: TavilyWeeklyQuery) -> dict[str, Any]:
        payload = {
            "api_key": settings.tavily_api_key,
            "query": search_query.query,
            "topic": "general",
            "search_depth": settings.tavily_search_depth,
            "max_results": settings.tavily_max_results_per_query,
            "include_domains": [search_query.domain],
            "country": settings.tavily_country,
            "include_answer": False,
            "include_raw_content": "markdown",
        }
        try:
            response = self._post_tavily(payload)
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError("tavily_timeout", "Tavily 检索超时，可在下周自动重试") from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in {401, 403}:
                raise ProviderError("tavily_auth_failed", "Tavily Key 无效或没有访问权限", retriable=False) from exc
            if status in {402, 429}:
                raise ProviderError("tavily_quota_or_rate_limited", "Tavily 免费额度不足或请求受限", retriable=False) from exc
            raise ProviderError("tavily_unavailable", f"Tavily 返回 HTTP {status}") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("tavily_unavailable", "Tavily 服务暂不可用") from exc
        body = response.json()
        if not isinstance(body, dict):
            raise ProviderError("tavily_invalid_response", "Tavily 返回格式无效")
        return body

    def _post_tavily(self, payload: dict[str, Any]) -> httpx.Response:
        with httpx.Client(timeout=self.timeout) as client:
            return client.post("https://api.tavily.com/search", json=payload)

    def weekly_tide_ideas(self, sources: list[dict[str, Any]], holidays: list[dict[str, str]]) -> list[WeeklyTideIdea]:
        instruction = (
                "基于已验链来源的正文摘录，生成最多6条服务于山地农产品、地方物产、食品饮料和原产地品牌的主题灵感。"
                "重点寻找采收节律、原产地、风味、山野出行、送礼、节气、加工与供应链等母题；"
                "每条都必须能直接转译为农产品品牌、产品、产地档案或农事内容。"
                "不要输出餐饮门店开业、菜单、桌边服务、餐厅打卡、咖啡馆、餐饮经营或招商加盟灵感。"
                "趋势只能作为创意角度，不能写成品牌、产品或功效事实；不得添加未在输入来源中出现的信息。"
                "每条必须引用至少一个输入 source_urls，主题不可重复；有几条可靠来源就先生成几条可追溯灵感，1到4条也必须返回，不能为了凑数合并无关故事。"
                "结合未来45天节日，若无适合节点写“非节日驱动”。"
                "返回 JSON：{\"ideas\":[{\"theme\":\"...\",\"content_motif\":\"...\","
                "\"applicable_scene\":\"...\",\"festival_context\":\"...\",\"risk_note\":\"...\","
                "\"source_urls\":[\"https://...\"]}]}。"
                "以下节假日规则为上条新闻溯源规则的唯一例外：允许最多2条“节假日节点灵感”，仅可依据 upcoming_holidays 中明确列出的节日，source_urls 必须是空数组；"
                "这类灵感不得引用、概括或伪造新闻媒体内容，不得声称市场趋势、销量、消费者偏好或其他外部事实。"
                "节假日节点灵感可以补充但不能替换已有的可追溯来源灵感；verified_sources 较少时仍须优先返回来源能够支撑的结果。"
            )
        context = {"verified_sources": sources, "upcoming_holidays": holidays}
        try:
            result = self.tide_chat_json(
                model=settings.tide_synthesis_model,
                instruction=instruction,
                context=context,
                # The platform's kimi-k3 gateway accepts only temperature=1.
                temperature=1,
                timeout_seconds=25,
            )
        except ProviderError as exc:
            if exc.code != "provider_timeout":
                raise
            # The general text channel is already used by the rest of the
            # workbench. It is a fast, configured fallback when the isolated
            # weekly synthesis gateway stalls.
            result = self.chat_json(
                model=settings.openai_next_text_model,
                instruction=instruction,
                context=context,
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
            if not theme:
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

    def generate_image(
        self, prompt: str, reference_images: list[str] | None = None,
        negative_prompt: str | None = None,
    ) -> dict[str, str]:
        if not self.live:
            raise ProviderError("demo_mode", "演示模式未调用真实图片服务")
        key = settings.resolved_image_api_key
        if not key:
            raise ProviderError("image_provider_not_configured", "请先配置图片服务 Key")
        # 部分网关(如 StepFun)对 prompt 有 512 字符硬上限;统一截断到安全长度避免 400。
        prompt = prompt.strip()[:500]
        payload: dict[str, Any] = {
            "model": settings.openai_next_image_model,
            "prompt": prompt,
            "n": 1,
            "size": settings.openai_next_image_size,
            "response_format": "b64_json",
        }
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt.strip()[:500]
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
        if item.get("finish_reason") == "content_filtered":
            raise ProviderError("image_content_filtered", "提示词命中内容审核，请调整后重试", retriable=False)
        if item.get("b64_json"):
            return {"kind": "base64", "value": str(item["b64_json"])}
        if item.get("url"):
            return {"kind": "url", "value": str(item["url"])}
        raise ProviderError("image_invalid_response", "图片服务没有返回图片")

    @staticmethod
    def write_base64_image(value: str, destination: str) -> None:
        with open(destination, "wb") as output:
            output.write(base64.b64decode(value, validate=True))


provider = CreditsProvider()
