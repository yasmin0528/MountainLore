"""Shared, verified weekly trend reports for the 观潮 workspace."""

from __future__ import annotations

import json
import re
import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx

from app.core.config import settings
from app.fieldwork.store import connect, json_value, new_id, now, row_dict
from app.services.providers import ProviderError, WeeklyTideIdea, WeeklyTideSource, provider

SHANGHAI = ZoneInfo("Asia/Shanghai")
_ALLOWED_HOSTS = {
    "canyin88.com": ("industry", "红餐网"),
    "watcn.com": ("industry", "餐饮老板内参"),
    "foodaily.com": ("industry", "Foodaily"),
    "foodinc.com.cn": ("industry", "小食代"),
    "tidesight.com": ("industry", "观潮新消费"),
    "36kr.com": ("industry", "36氪"),
    "xiaohongshu.com": ("xiaohongshu", "小红书公开帖"),
    "douyin.com": ("douyin", "抖音公开趋势"),
}
_DATE_PATTERNS = (
    re.compile(r"article:published_time[^>]*content=[\"']([^\"']+)", re.I),
    re.compile(r"datePublished[\"']?\s*[:=]\s*[\"']([^\"']+)", re.I),
    re.compile(r"(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})"),
)


@dataclass
class VerifiedSource:
    original_url: str
    source_url: str
    channel: str
    publisher: str
    source_title: str
    published_at: str | None


def china_now() -> datetime:
    return datetime.now(SHANGHAI)


def current_week_key(at: datetime | None = None) -> str:
    current = (at or china_now()).astimezone(SHANGHAI)
    monday = (current - timedelta(days=current.weekday())).date()
    return monday.isoformat()


def next_refresh_at(at: datetime | None = None) -> str:
    current = (at or china_now()).astimezone(SHANGHAI)
    days_until_monday = (7 - current.weekday()) % 7
    candidate = current.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=days_until_monday)
    if candidate <= current:
        candidate += timedelta(days=7)
    return candidate.isoformat()


def upcoming_holidays(at: datetime | None = None) -> list[dict[str, str]]:
    """A compact, explicit calendar of statutory and major consumer moments.

    Lunar statutory holidays remain deliberately named (rather than pretending to
    know their Gregorian date without a dedicated calendar service). The model
    receives only dates that are deterministic for the current year plus the
    named lunar moments as editorial context.
    """
    current = (at or china_now()).astimezone(SHANGHAI).date()
    cutoff = current + timedelta(days=45)
    moments = [
        ("元旦", "01-01"), ("情人节", "02-14"), ("妇女节", "03-08"), ("清明", "04-04"),
        ("劳动节", "05-01"), ("520", "05-20"), ("618", "06-18"), ("七夕", "08-17"),
        ("818", "08-18"), ("中秋", "09-17"), ("国庆", "10-01"), ("双11", "11-11"),
        ("双12", "12-12"), ("圣诞", "12-25"),
    ]
    upcoming: list[dict[str, str]] = []
    for year in (current.year, current.year + 1):
        for name, month_day in moments:
            date = datetime.strptime(f"{year}-{month_day}", "%Y-%m-%d").date()
            if current <= date <= cutoff:
                upcoming.append({"name": name, "date": date.isoformat()})
    return upcoming


def _allowed_host(host: str) -> tuple[str, str] | None:
    normalized = host.lower().split(":", 1)[0]
    for allowed, value in _ALLOWED_HOSTS.items():
        if normalized == allowed or normalized.endswith(f".{allowed}"):
            return value
    return None


def is_allowed_source_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and bool(parsed.hostname and _allowed_host(parsed.hostname))


def _metadata_from_html(html: str) -> tuple[str | None, str | None]:
    title_match = re.search(r"<title[^>]*>\s*(.*?)\s*</title>", html, flags=re.I | re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else None
    for pattern in _DATE_PATTERNS:
        date_match = pattern.search(html)
        if date_match:
            value = date_match.group(1).replace("/", "-").replace(".", "-")
            return title, value[:10]
    return title, None


def verify_weekly_source(candidate: WeeklyTideSource) -> VerifiedSource | None:
    if not is_allowed_source_url(candidate.url):
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(settings.tide_source_verify_timeout_seconds), follow_redirects=True) as client:
            response = client.get(candidate.url, headers={"User-Agent": "MountainLore/0.2 weekly-source-check"})
            response.raise_for_status()
    except httpx.HTTPError:
        return None
    final_url = str(response.url)
    parsed = urlparse(final_url)
    allowed = _allowed_host(parsed.hostname or "") if parsed.scheme == "https" else None
    if not allowed:
        return None
    title, captured_date = _metadata_from_html(response.text[:250_000])
    channel, publisher = allowed
    if candidate.channel in {"xiaohongshu", "douyin"} and candidate.channel != channel:
        return None
    return VerifiedSource(
        original_url=candidate.url,
        source_url=final_url,
        channel=channel,
        publisher=publisher,
        source_title=title or candidate.title,
        published_at=captured_date or candidate.published_at,
    )


def _acquire_week_lock(week_key: str) -> bool:
    timestamp = now()
    with connect() as connection:
        inserted = connection.execute(
            "INSERT OR IGNORE INTO tide_refresh_locks (week_key, status, acquired_at, completed_at, error_code) VALUES (?, 'running', ?, NULL, NULL)",
            (week_key, timestamp),
        ).rowcount
    return bool(inserted)


def _finish_week_lock(week_key: str, status: str, error_code: str | None = None) -> None:
    with connect() as connection:
        connection.execute(
            "UPDATE tide_refresh_locks SET status = ?, completed_at = ?, error_code = ? WHERE week_key = ?",
            (status, now(), error_code, week_key),
        )


def _mark_edition_failed(edition_id: str, week_key: str, error_code: str) -> dict[str, Any]:
    with connect() as connection:
        connection.execute("UPDATE tide_editions SET status = 'failed', error_code = ?, completed_at = ? WHERE id = ?", (error_code, now(), edition_id))
    _finish_week_lock(week_key, "failed", error_code)
    return {"status": "failed", "week_key": week_key, "error_code": error_code}


def _validate_ideas(ideas: list[WeeklyTideIdea], source_ids_by_url: dict[str, str]) -> list[WeeklyTideIdea]:
    valid: list[WeeklyTideIdea] = []
    themes: set[str] = set()
    for idea in ideas:
        normalized_theme = re.sub(r"\s+", "", idea.theme).lower()
        source_ids = {source_ids_by_url[url] for url in idea.source_urls if url in source_ids_by_url}
        if not normalized_theme or normalized_theme in themes or not source_ids:
            continue
        if not idea.content_motif or not idea.applicable_scene:
            continue
        themes.add(normalized_theme)
        valid.append(idea)
    return valid


def refresh_weekly_tide_report(at: datetime | None = None) -> dict[str, Any]:
    """Publish at most one verified report per China week, with a SQLite lock."""
    if not provider.live:
        return {"status": "skipped", "reason": "tide_not_configured"}
    week_key = current_week_key(at)
    if not _acquire_week_lock(week_key):
        return {"status": "already_attempted", "week_key": week_key}
    edition_id = new_id()
    with connect() as connection:
        connection.execute(
            "INSERT INTO tide_editions (id, week_key, status, error_code, created_at, completed_at) VALUES (?, ?, 'running', NULL, ?, NULL)",
            (edition_id, week_key, now()),
        )
    try:
        candidates = provider.weekly_tide_candidates()
        verified_by_url: dict[str, VerifiedSource] = {}
        for candidate in candidates:
            verified = verify_weekly_source(candidate)
            if verified:
                verified_by_url.setdefault(verified.source_url, verified)
        if len(verified_by_url) < 5:
            raise ProviderError("insufficient_verified_sources", "本周可访问的公开来源不足")
        with connect() as connection:
            source_ids_by_url: dict[str, str] = {}
            for verified in verified_by_url.values():
                source_id = new_id()
                connection.execute(
                    "INSERT INTO tide_report_sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (source_id, edition_id, verified.channel, verified.publisher, verified.source_url, verified.source_title, verified.published_at, now()),
                )
                source_ids_by_url[verified.source_url] = source_id
                source_ids_by_url[verified.original_url] = source_id
        source_context = [
            {"url": source.source_url, "channel": source.channel, "publisher": source.publisher, "title": source.source_title, "published_at": source.published_at}
            for source in verified_by_url.values()
        ]
        ideas = _validate_ideas(provider.weekly_tide_ideas(source_context, upcoming_holidays(at)), source_ids_by_url)
        if not 5 <= len(ideas) <= 6:
            raise ProviderError("insufficient_verified_ideas", "本周不足5条可追溯灵感")
        with connect() as connection:
            for idea in ideas:
                source_ids = sorted({source_ids_by_url[url] for url in idea.source_urls if url in source_ids_by_url})
                connection.execute(
                    "INSERT INTO tide_report_ideas VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (new_id(), edition_id, idea.theme, idea.content_motif, idea.applicable_scene, idea.festival_context, idea.risk_note, json_value(source_ids), now()),
                )
            connection.execute("UPDATE tide_editions SET status = 'succeeded', completed_at = ? WHERE id = ?", (now(), edition_id))
        _finish_week_lock(week_key, "succeeded")
        return {"status": "succeeded", "week_key": week_key, "idea_count": len(ideas)}
    except ProviderError as exc:
        return _mark_edition_failed(edition_id, week_key, exc.code)
    except Exception:
        return _mark_edition_failed(edition_id, week_key, "tide_refresh_failed")


async def weekly_tide_refresh_loop(stop_event: asyncio.Event) -> None:
    """Run once on startup for catch-up, then cheaply poll for Monday 09:00."""
    while not stop_event.is_set():
        await asyncio.to_thread(refresh_weekly_tide_report)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(15, settings.tide_refresh_interval_seconds))
        except TimeoutError:
            continue


def latest_report_for_project(project_id: str) -> dict[str, Any]:
    """Return the latest successful edition plus the latest attempt for stale-state UI."""
    with connect() as connection:
        latest_attempt = row_dict(connection.execute("SELECT * FROM tide_editions ORDER BY created_at DESC LIMIT 1").fetchone())
        edition = row_dict(connection.execute("SELECT * FROM tide_editions WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1").fetchone())
        if not edition:
            return {"edition": None, "latest_attempt": latest_attempt, "next_refresh_at": next_refresh_at()}
        ideas = [dict(row) for row in connection.execute("SELECT * FROM tide_report_ideas WHERE edition_id = ? ORDER BY created_at", (edition["id"],))]
        for idea in ideas:
            source_ids = json.loads(idea.pop("source_ids_json") or "[]")
            placeholders = ",".join("?" for _ in source_ids) or "''"
            rows = [dict(row) for row in connection.execute(
                f"SELECT * FROM tide_report_sources WHERE id IN ({placeholders})", tuple(source_ids)
            )]
            source_index = {item["id"]: item for item in rows}
            idea["sources"] = [source_index[source_id] for source_id in source_ids if source_id in source_index]
            preference = row_dict(connection.execute(
                "SELECT favorite, used_at FROM project_tide_idea_preferences WHERE project_id = ? AND idea_id = ?",
                (project_id, idea["id"]),
            ).fetchone()) or {}
            idea["favorite"] = preference.get("favorite", 0)
            idea["used_at"] = preference.get("used_at")
        return {"edition": edition | {"ideas": ideas}, "latest_attempt": latest_attempt, "next_refresh_at": next_refresh_at()}


def shared_idea_for_project(connection: Any, idea_id: str) -> dict[str, Any] | None:
    idea = row_dict(connection.execute(
        """SELECT tide_report_ideas.* FROM tide_report_ideas
           JOIN tide_editions ON tide_editions.id = tide_report_ideas.edition_id
           WHERE tide_report_ideas.id = ? AND tide_editions.status = 'succeeded'""",
        (idea_id,),
    ).fetchone())
    if not idea:
        return None
    source_ids = json.loads(idea.pop("source_ids_json") or "[]")
    if source_ids:
        placeholders = ",".join("?" for _ in source_ids)
        sources = [dict(row) for row in connection.execute(f"SELECT * FROM tide_report_sources WHERE id IN ({placeholders})", tuple(source_ids))]
        lookup = {source["id"]: source for source in sources}
        idea["sources"] = [lookup[source_id] for source_id in source_ids if source_id in lookup]
    else:
        idea["sources"] = []
    return idea
