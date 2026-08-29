"""Skill-backed slide manifest for brand-manual exports."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.services.providers import ProviderError

_PROFILE = Path(__file__).resolve().parents[3] / ".codex" / "skills" / "brand-manual-ppt" / "references" / "render-profile.json"


def load_brand_manual_ppt_profile() -> dict[str, Any]:
    """Read the project-managed skill profile on every export."""
    try:
        profile = json.loads(_PROFILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProviderError("ppt_profile_unavailable", "品牌手册 PPT 渲染规范不可用") from exc
    if profile.get("skill") != "brand-manual-ppt" or profile.get("version") != 1:
        raise ProviderError("ppt_profile_invalid", "品牌手册 PPT 渲染规范版本不受支持")
    if not isinstance(profile.get("slides"), list) or not isinstance(profile.get("repeat"), dict):
        raise ProviderError("ppt_profile_invalid", "品牌手册 PPT 渲染规范缺少页面定义")
    return profile


def _lookup(record: Any, path: str) -> Any:
    value = record
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "、".join(part for part in (_text(item) for item in value) if part)
    if isinstance(value, dict):
        return "；".join(part for part in (_text(item) for item in value.values()) if part)
    return str(value).strip()


def _field(record: dict[str, Any], path: str, fallback: str) -> str:
    return _text(_lookup(record, path)) or fallback


def _evidence(point: dict[str, Any]) -> str:
    ids = point.get("claimIds")
    return "事实依据：" + "、".join(str(item) for item in ids) if isinstance(ids, list) and ids else "待补证据"


def build_brand_manual_slides(content: dict[str, Any]) -> list[tuple[str, str, str, str]]:
    """Build the export manifest from the in-repository Skill profile."""
    profile = load_brand_manual_ppt_profile()
    slides: list[tuple[str, str, str, str]] = []
    for definition in profile["slides"]:
        if not isinstance(definition, dict):
            raise ProviderError("ppt_profile_invalid", "品牌手册 PPT 页面定义无效")
        slides.append((
            _text(definition.get("label")) or "品牌手册",
            _field(content, str(definition.get("title") or ""), _text(definition.get("titleFallback"))),
            _field(content, str(definition.get("body") or ""), _text(definition.get("bodyFallback"))),
            _text(definition.get("kind")) or "text",
        ))
    repeat = profile["repeat"]
    points = content.get(str(repeat.get("source") or "selling_points"))
    points = points if isinstance(points, list) else []
    for index in range(int(repeat.get("limit") or 0)):
        point = points[index] if index < len(points) and isinstance(points[index], dict) else {}
        label = _text(repeat.get("labelTemplate") or "卖点 {index}").format(index=f"{index + 1:02d}", evidence=_evidence(point))
        slides.append((
            label,
            _field(point, str(repeat.get("title") or ""), _text(repeat.get("titleFallback"))),
            _field(point, str(repeat.get("body") or ""), _text(repeat.get("bodyFallback"))),
            _text(repeat.get("kind")) or "point",
        ))
    return slides
