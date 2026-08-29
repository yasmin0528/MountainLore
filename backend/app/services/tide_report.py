"""Shared, verified weekly trend reports for the 观潮 workspace."""

from __future__ import annotations

import json
import re
import asyncio
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from zoneinfo import ZoneInfo

import httpx

from app.core.config import settings
from app.fieldwork.store import connect, json_value, new_id, now, row_dict
from app.services.providers import ProviderError, WeeklyTideIdea, WeeklyTideSource, provider

SHANGHAI = ZoneInfo("Asia/Shanghai")
TIDE_EDITORIAL_VERSION = 4
_ALLOWED_HOSTS = {
    "canyin88.com": ("industry", "红餐网"),
    "watcn.com": ("industry", "餐饮老板内参"),
    "foodaily.com": ("industry", "Foodaily"),
    "foodinc.com.cn": ("industry", "小食代"),
    "tidesight.com": ("industry", "观潮新消费"),
    "pai.com.cn": ("industry", "电商派"),
    "36kr.com": ("industry", "36氪"),
    "xiaohongshu.com": ("xiaohongshu", "小红书公开帖"),
    "douyin.com": ("douyin", "抖音公开趋势"),
}
_DATE_PATTERNS = (
    re.compile(r"article:published_time[^>]*content=[\"']([^\"']+)", re.I),
    re.compile(r"datePublished[\"']?\s*[:=]\s*[\"']([^\"']+)", re.I),
    re.compile(r"(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})"),
)
_TRACKING_QUERY_KEYS = {"spm", "from", "source", "ref", "referrer", "campaign", "share"}
_TERMINAL_REPORT_STATUSES = {"succeeded", "partial"}
_RUNNING_TIMEOUT = timedelta(minutes=10)
_RETRY_DELAY = timedelta(seconds=60)

@dataclass
class VerifiedSource:
    original_url: str
    source_url: str
    channel: str
    publisher: str
    source_title: str
    published_at: str | None
    source_excerpt: str = ""


def canonical_source_url(value: str) -> str:
    """Normalize a final article URL without erasing meaningful query values."""
    parsed = urlparse(value.strip())
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    port = f":{parsed.port}" if parsed.port and parsed.port not in {80, 443} else ""
    path = re.sub(r"/+", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")
    query = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_QUERY_KEYS
    ]
    return urlunparse(((parsed.scheme or "https").lower(), f"{host}{port}", path, "", urlencode(sorted(query)), ""))


def normalize_story_text(value: str, *, title: bool = False) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").lower()
    if title:
        normalized = re.sub(r"\s*[-_|｜—–·]\s*(?:foodaily|36氪|观潮新消费|红餐网|餐饮老板内参|小食代|电商派|小红书|抖音).*$", "", normalized, flags=re.I)
    return "".join(character for character in normalized if character.isalnum())


def ngram_similarity(left: str, right: str, size: int) -> float:
    def grams(value: str) -> set[str]:
        normalized = normalize_story_text(value)
        if not normalized:
            return set()
        if len(normalized) <= size:
            return {normalized}
        return {normalized[index:index + size] for index in range(len(normalized) - size + 1)}

    left_grams, right_grams = grams(left), grams(right)
    if not left_grams or not right_grams:
        return 0.0
    return len(left_grams & right_grams) / len(left_grams | right_grams)


def sources_are_same_story(left: VerifiedSource, right: VerifiedSource) -> bool:
    if canonical_source_url(left.source_url) == canonical_source_url(right.source_url):
        return True
    title_similarity = ngram_similarity(
        normalize_story_text(left.source_title, title=True),
        normalize_story_text(right.source_title, title=True),
        2,
    )
    body_similarity = ngram_similarity(left.source_excerpt, right.source_excerpt, 3)
    if _published_date(left.published_at) > _published_date(right.published_at) and body_similarity < 0.65:
        return False
    return title_similarity >= 0.86 and body_similarity >= 0.65


def _published_date(value: str | None) -> datetime:
    match = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", value or "")
    if not match:
        return datetime.min.replace(tzinfo=SHANGHAI)
    try:
        return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=SHANGHAI)
    except ValueError:
        return datetime.min.replace(tzinfo=SHANGHAI)


def _source_quality(source: VerifiedSource) -> tuple[int, int, int]:
    return (
        int(_published_date(source.published_at).year > 1),
        len(source.source_excerpt or ""),
        int(canonical_source_url(source.source_url) == canonical_source_url(source.original_url)),
    )


def deduplicate_verified_sources(
    sources: list[VerifiedSource],
    history: list[VerifiedSource] | None = None,
) -> list[VerifiedSource]:
    """Keep the best current copy and exclude stories already used in four weeks."""
    winners: list[VerifiedSource] = []
    for candidate in sources:
        duplicate_index = next((index for index, item in enumerate(winners) if sources_are_same_story(candidate, item)), None)
        if duplicate_index is not None:
            if _source_quality(candidate) > _source_quality(winners[duplicate_index]):
                winners[duplicate_index] = candidate
            continue
        if any(sources_are_same_story(candidate, older) for older in history or []):
            continue
        winners.append(candidate)
    return winners


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


def next_personal_refresh_at(at: datetime | None = None) -> str:
    current = (at or china_now()).astimezone(SHANGHAI)
    monday = (current - timedelta(days=current.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return (monday + timedelta(days=7)).isoformat()


def _utc_now(at: datetime | None = None) -> datetime:
    return (at or datetime.now(UTC)).astimezone(UTC)


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def upcoming_holidays(at: datetime | None = None) -> list[dict[str, str]]:
    """Return only dates that are explicit in a calendar, never guessed lunar dates."""
    current = (at or china_now()).astimezone(SHANGHAI).date()
    cutoff = current + timedelta(days=45)
    fixed_moments = [
        ("元旦", "01-01"), ("情人节", "02-14"), ("妇女节", "03-08"), ("清明", "04-04"),
        ("劳动节", "05-01"), ("520", "05-20"), ("618", "06-18"), ("818", "08-18"),
        ("国庆", "10-01"), ("双11", "11-11"), ("双12", "12-12"), ("圣诞", "12-25"),
    ]
    # Lunar dates are supplied only for years whose calendar has been confirmed.
    confirmed_lunar_moments = {2026: [("中秋", "09-25")]}
    upcoming: list[dict[str, str]] = []
    for year in (current.year, current.year + 1):
        for name, month_day in fixed_moments + confirmed_lunar_moments.get(year, []):
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


def _is_recent_dated_article(published_at: str | None) -> bool:
    """Only accept concrete publication dates inside the current seven-day window."""
    if not published_at:
        return False
    match = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", published_at)
    if not match:
        return False
    try:
        published = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=SHANGHAI)
    except ValueError:
        return False
    current = china_now()
    return current - timedelta(days=min(settings.tide_search_lookback_days, 7)) <= published <= current


def _article_text_from_html(html: str) -> str:
    content = re.sub(r"<(?:script|style|svg|noscript)[^>]*>[\s\S]*?</(?:script|style|svg|noscript)>", " ", html, flags=re.I)
    blocks = re.findall(r"<(?:p|h[1-4]|li)[^>]*>([\s\S]*?)</(?:p|h[1-4]|li)>", content, flags=re.I)
    text = " ".join(re.sub(r"<[^>]+>", " ", block) for block in (blocks or [content]))
    return re.sub(r"\s+", " ", text).strip()[:1600]


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
    page_html = response.text[:250_000]
    title, captured_date = _metadata_from_html(page_html)
    channel, publisher = allowed
    if candidate.channel in {"xiaohongshu", "douyin"} and candidate.channel != channel:
        return None
    source_title = title or candidate.title
    published_at = captured_date or candidate.published_at
    if not source_title or source_title == "未命名来源" or not _is_recent_dated_article(published_at):
        return None
    return VerifiedSource(
        original_url=candidate.url,
        source_url=final_url,
        channel=channel,
        publisher=publisher,
        source_title=source_title,
        published_at=published_at,
        source_excerpt=_article_text_from_html(page_html) or candidate.body_excerpt,
    )


def _acquire_week_lock(week_key: str) -> bool:
    timestamp = now()
    stale_before = (datetime.now(UTC) - timedelta(minutes=10)).isoformat()
    with connect() as connection:
        inserted = connection.execute(
            "INSERT OR IGNORE INTO tide_refresh_locks (week_key, status, acquired_at, completed_at, error_code) VALUES (?, 'running', ?, NULL, NULL)",
            (week_key, timestamp),
        ).rowcount
        if inserted:
            return True
        retried = connection.execute(
            "UPDATE tide_refresh_locks SET status = 'running', acquired_at = ?, completed_at = NULL, error_code = NULL WHERE week_key = ? AND (status = 'failed' OR (status = 'running' AND acquired_at < ?))",
            (timestamp, week_key, stale_before),
        ).rowcount
    return bool(retried)


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


def _is_holiday_only_idea(idea: WeeklyTideIdea, holiday_names: set[str] | None) -> bool:
    """Allow source-free ideas only when their calendar trigger is explicit."""
    return not idea.source_urls and bool(holiday_names) and any(
        holiday_name in idea.festival_context for holiday_name in holiday_names
    )


def _idea_score(idea: WeeklyTideIdea) -> tuple[int, int]:
    return (len(set(idea.source_urls)), len(idea.content_motif) + len(idea.applicable_scene))


def _ideas_are_duplicates(left: WeeklyTideIdea, right: WeeklyTideIdea) -> bool:
    theme_similarity = ngram_similarity(
        normalize_story_text(left.theme, title=True),
        normalize_story_text(right.theme, title=True),
        2,
    )
    context_similarity = ngram_similarity(
        f"{left.content_motif}{left.applicable_scene}",
        f"{right.content_motif}{right.applicable_scene}",
        3,
    )
    return theme_similarity >= 0.82 and context_similarity >= 0.55


def _validate_ideas(
    ideas: list[WeeklyTideIdea],
    source_ids_by_url: dict[str, str],
    holiday_names: set[str] | None = None,
    prior_ideas: list[WeeklyTideIdea] | None = None,
) -> list[WeeklyTideIdea]:
    valid: list[WeeklyTideIdea] = []
    holiday_only_count = 0
    for idea in ideas:
        normalized_theme = re.sub(r"\s+", "", idea.theme).lower()
        source_ids = {source_ids_by_url[url] for url in idea.source_urls if url in source_ids_by_url}
        holiday_only = _is_holiday_only_idea(idea, holiday_names)
        if not normalized_theme or (not source_ids and not holiday_only):
            continue
        idea_text = " ".join((idea.theme, idea.content_motif, idea.applicable_scene))
        if not idea.content_motif or not idea.applicable_scene or re.search(r"餐饮|餐厅|门店|菜单|桌边|外卖|招商加盟|堂食", idea_text):
            continue
        if holiday_only:
            if holiday_only_count >= 2:
                continue
            holiday_only_count += 1
        if any(_ideas_are_duplicates(idea, prior) for prior in prior_ideas or []):
            continue
        duplicate_index = next((index for index, current in enumerate(valid) if _ideas_are_duplicates(idea, current)), None)
        if duplicate_index is not None:
            if _idea_score(idea) > _idea_score(valid[duplicate_index]):
                valid[duplicate_index] = idea
            continue
        valid.append(idea)
    return valid


def _source_history(visitor_id: str | None, at: datetime | None = None) -> list[VerifiedSource]:
    cutoff = (datetime.fromisoformat(current_week_key(at)).date() - timedelta(days=28)).isoformat()
    with connect() as connection:
        rows = list(connection.execute(
            """SELECT DISTINCT tide_report_sources.* FROM tide_report_sources
               JOIN tide_editions ON tide_editions.id = tide_report_sources.edition_id
               WHERE tide_editions.status IN ('succeeded', 'partial')
                 AND tide_editions.editorial_version = ?
                 AND substr(tide_editions.week_key, 1, 10) >= ?""",
            (TIDE_EDITORIAL_VERSION, cutoff),
        ))
        if visitor_id:
            rows.extend(connection.execute(
                """SELECT DISTINCT tide_report_sources.* FROM tide_report_sources
                   JOIN tide_personal_editions ON tide_personal_editions.id = tide_report_sources.edition_id
                   WHERE tide_personal_editions.visitor_id = ?
                     AND tide_personal_editions.status IN ('succeeded', 'partial')
                     AND tide_personal_editions.editorial_version = ?
                     AND tide_personal_editions.week_key >= ?""",
                (visitor_id, TIDE_EDITORIAL_VERSION, cutoff),
            ))
    return [
        VerifiedSource(
            row["source_url"], row["source_url"], row["channel"], row["publisher"],
            row["source_title"], row["published_at"], row["source_excerpt"],
        )
        for row in rows
    ]


def _idea_history(visitor_id: str | None, at: datetime | None = None) -> list[WeeklyTideIdea]:
    cutoff = (datetime.fromisoformat(current_week_key(at)).date() - timedelta(days=28)).isoformat()
    with connect() as connection:
        rows = list(connection.execute(
            """SELECT tide_report_ideas.* FROM tide_report_ideas
               JOIN tide_editions ON tide_editions.id = tide_report_ideas.edition_id
               WHERE tide_editions.status IN ('succeeded', 'partial')
                 AND tide_editions.editorial_version = ?
                 AND substr(tide_editions.week_key, 1, 10) >= ?""",
            (TIDE_EDITORIAL_VERSION, cutoff),
        ))
        if visitor_id:
            rows.extend(connection.execute(
                """SELECT tide_report_ideas.* FROM tide_report_ideas
                   JOIN tide_personal_editions ON tide_personal_editions.id = tide_report_ideas.edition_id
                   WHERE tide_personal_editions.visitor_id = ?
                     AND tide_personal_editions.status IN ('succeeded', 'partial')
                     AND tide_personal_editions.editorial_version = ?
                     AND tide_personal_editions.week_key >= ?""",
                (visitor_id, TIDE_EDITORIAL_VERSION, cutoff),
            ))
    return [
        WeeklyTideIdea(
            row["theme"], row["content_motif"], row["applicable_scene"],
            row["festival_context"], row["risk_note"], [],
        )
        for row in rows
    ]


def _build_report(
    visitor_id: str | None,
    at: datetime | None = None,
    phase_callback: Any | None = None,
) -> tuple[list[VerifiedSource], list[WeeklyTideIdea], str]:
    def phase(value: str) -> None:
        if phase_callback:
            phase_callback(value)

    phase("collecting")
    candidates = provider.weekly_tide_candidates()
    phase("verifying")
    verified: list[VerifiedSource] = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        for item in executor.map(verify_weekly_source, candidates):
            if item:
                verified.append(item)
    phase("deduplicating")
    unique_sources = deduplicate_verified_sources(verified, _source_history(visitor_id, at))[:8]
    holidays = upcoming_holidays(at)
    source_ids_by_url: dict[str, str] = {}
    for source in unique_sources:
        placeholder = canonical_source_url(source.source_url)
        source_ids_by_url[source.source_url] = placeholder
        source_ids_by_url[source.original_url] = placeholder
    source_context = [
        {
            "url": source.source_url,
            "channel": source.channel,
            "publisher": source.publisher,
            "title": source.source_title,
            "published_at": source.published_at,
            "article_excerpt": source.source_excerpt,
        }
        for source in unique_sources
    ]
    phase("synthesizing")
    holiday_names = {holiday["name"] for holiday in holidays}
    ideas = _validate_ideas(
        provider.weekly_tide_ideas(source_context, holidays),
        source_ids_by_url,
        holiday_names,
        _idea_history(visitor_id, at),
    )[:6]
    if not ideas:
        code = "no_new_verified_sources" if not unique_sources else "no_valid_tide_ideas"
        raise ProviderError(code, "排重后没有可发布的本周灵感")
    return unique_sources, ideas, "succeeded" if len(ideas) >= 5 else "partial"


def _persist_report(
    edition_id: str,
    sources: list[VerifiedSource],
    ideas: list[WeeklyTideIdea],
    status: str,
    *,
    personal: bool,
    at: datetime | None = None,
    attempt_count: int | None = None,
) -> None:
    completed_at = _utc_now(at).isoformat() if at else now()
    with connect() as connection:
        if personal:
            connection.execute("BEGIN IMMEDIATE")
            current = row_dict(connection.execute(
                "SELECT status, attempt_count FROM tide_personal_editions WHERE id = ?",
                (edition_id,),
            ).fetchone())
            if not current or current["status"] != "running" or (
                attempt_count is not None and current["attempt_count"] != attempt_count
            ):
                raise ProviderError("refresh_interrupted", "当前刷新尝试已失效")
        source_ids_by_url: dict[str, str] = {}
        for source in sources:
            source_id = new_id()
            connection.execute(
                """INSERT INTO tide_report_sources
                   (id, edition_id, channel, publisher, source_url, source_title, published_at, source_excerpt, captured_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    source_id, edition_id, source.channel, source.publisher, source.source_url,
                    source.source_title, source.published_at, source.source_excerpt, completed_at,
                ),
            )
            source_ids_by_url[source.source_url] = source_id
            source_ids_by_url[source.original_url] = source_id
        for idea in ideas:
            source_ids = sorted({source_ids_by_url[url] for url in idea.source_urls if url in source_ids_by_url})
            connection.execute(
                "INSERT INTO tide_report_ideas VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    new_id(), edition_id, idea.theme, idea.content_motif, idea.applicable_scene,
                    idea.festival_context, idea.risk_note, json_value(source_ids), completed_at,
                ),
            )
        if personal:
            connection.execute(
                """UPDATE tide_personal_editions
                   SET status = ?, phase = 'completed', error_code = NULL,
                       updated_at = ?, completed_at = ?
                   WHERE id = ? AND status = 'running'""",
                (status, completed_at, completed_at, edition_id),
            )
        else:
            connection.execute(
                "UPDATE tide_editions SET status = ?, error_code = NULL, completed_at = ? WHERE id = ?",
                (status, completed_at, edition_id),
            )


def refresh_weekly_tide_report(at: datetime | None = None) -> dict[str, Any]:
    """Publish one shared edition without consuming any visitor refresh."""
    if not provider.live:
        return {"status": "skipped", "reason": "tide_not_configured"}
    week_key = current_week_key(at)
    edition_week_key = f"{week_key}-editorial-v{TIDE_EDITORIAL_VERSION}"
    if not _acquire_week_lock(edition_week_key):
        return {"status": "already_attempted", "week_key": week_key}
    edition_id = new_id()
    try:
        with connect() as connection:
            existing = row_dict(connection.execute(
                "SELECT * FROM tide_editions WHERE week_key = ?", (edition_week_key,)
            ).fetchone())
            if existing and existing["status"] in _TERMINAL_REPORT_STATUSES:
                _finish_week_lock(edition_week_key, existing["status"])
                return {"status": "already_attempted", "week_key": week_key}
            if existing:
                edition_id = existing["id"]
                connection.execute(
                    """UPDATE tide_editions SET status = 'running', error_code = NULL,
                       created_at = ?, completed_at = NULL WHERE id = ?""",
                    (now(), edition_id),
                )
            else:
                connection.execute(
                    """INSERT INTO tide_editions
                       (id, week_key, status, error_code, created_at, completed_at, editorial_version)
                       VALUES (?, ?, 'running', NULL, ?, NULL, ?)""",
                    (edition_id, edition_week_key, now(), TIDE_EDITORIAL_VERSION),
                )
        sources, ideas, status = _build_report(None, at)
        _persist_report(edition_id, sources, ideas, status, personal=False, at=at)
        _finish_week_lock(edition_week_key, status)
        return {"status": status, "week_key": week_key, "idea_count": len(ideas)}
    except ProviderError as exc:
        return _mark_edition_failed(edition_id, edition_week_key, exc.code)
    except Exception:
        return _mark_edition_failed(edition_id, edition_week_key, "tide_refresh_failed")


def _personal_state_from_row(row: dict[str, Any] | None, at: datetime | None = None) -> dict[str, Any]:
    current = _utc_now(at)
    if not row:
        return {
            "status": "idle", "phase": "idle", "can_refresh": True,
            "next_refresh_at": next_personal_refresh_at(at), "error_code": None, "attempt_count": 0,
        }
    status = row["status"]
    can_refresh = False
    next_at = next_personal_refresh_at(at)
    if status == "failed":
        updated_at = _parse_timestamp(row.get("updated_at")) or current
        retry_at = updated_at + _RETRY_DELAY
        can_refresh = current >= retry_at
        next_at = retry_at.astimezone(SHANGHAI).isoformat()
    return {
        "status": status,
        "phase": row.get("phase") or ("completed" if status in _TERMINAL_REPORT_STATUSES else status),
        "can_refresh": can_refresh,
        "next_refresh_at": next_at,
        "error_code": row.get("error_code"),
        "attempt_count": row.get("attempt_count", 0),
    }


def personal_refresh_state(visitor_id: str, at: datetime | None = None) -> dict[str, Any]:
    week_key = current_week_key(at)
    timestamp = _utc_now(at)
    with connect() as connection:
        row = row_dict(connection.execute(
            """SELECT * FROM tide_personal_editions
               WHERE visitor_id = ? AND week_key = ? AND editorial_version = ?""",
            (visitor_id, week_key, TIDE_EDITORIAL_VERSION),
        ).fetchone())
        if row and row["status"] == "running":
            updated_at = _parse_timestamp(row.get("updated_at"))
            if updated_at and timestamp - updated_at >= _RUNNING_TIMEOUT:
                connection.execute(
                    """UPDATE tide_personal_editions
                       SET status = 'failed', phase = 'failed', error_code = 'refresh_interrupted', updated_at = ?
                       WHERE id = ? AND status = 'running'""",
                    (timestamp.isoformat(), row["id"]),
                )
                row = row | {
                    "status": "failed", "phase": "failed", "error_code": "refresh_interrupted",
                    "updated_at": timestamp.isoformat(),
                }
    return _personal_state_from_row(row, at)


def reserve_personal_tide_refresh(visitor_id: str, at: datetime | None = None) -> dict[str, Any]:
    week_key = current_week_key(at)
    timestamp = _utc_now(at)
    with connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = row_dict(connection.execute(
            """SELECT * FROM tide_personal_editions
               WHERE visitor_id = ? AND week_key = ? AND editorial_version = ?""",
            (visitor_id, week_key, TIDE_EDITORIAL_VERSION),
        ).fetchone())
        if row and row["status"] == "running":
            updated_at = _parse_timestamp(row.get("updated_at"))
            if updated_at and timestamp - updated_at < _RUNNING_TIMEOUT:
                return _personal_state_from_row(row, at) | {"accepted": False, "edition_id": row["id"]}
            connection.execute(
                """UPDATE tide_personal_editions
                   SET status = 'failed', phase = 'failed', error_code = 'refresh_interrupted', updated_at = ?
                   WHERE id = ?""",
                (timestamp.isoformat(), row["id"]),
            )
            row = row | {"status": "failed", "updated_at": timestamp.isoformat(), "error_code": "refresh_interrupted"}
        if row and row["status"] in _TERMINAL_REPORT_STATUSES:
            return _personal_state_from_row(row, at) | {"accepted": False, "edition_id": row["id"]}
        if row and row["status"] == "failed":
            retry_at = (_parse_timestamp(row.get("updated_at")) or timestamp) + _RETRY_DELAY
            if timestamp < retry_at:
                return _personal_state_from_row(row, at) | {"accepted": False, "edition_id": row["id"]}
            connection.execute(
                """UPDATE tide_personal_editions
                   SET status = 'running', phase = 'collecting', error_code = NULL,
                       attempt_count = attempt_count + 1, updated_at = ?, completed_at = NULL
                   WHERE id = ?""",
                (timestamp.isoformat(), row["id"]),
            )
            edition_id = row["id"]
            attempt_count = row["attempt_count"] + 1
        else:
            edition_id = new_id()
            attempt_count = 1
            connection.execute(
                """INSERT INTO tide_personal_editions
                   (id, visitor_id, week_key, status, phase, error_code, attempt_count,
                    created_at, updated_at, completed_at, editorial_version)
                   VALUES (?, ?, ?, 'running', 'collecting', NULL, 1, ?, ?, NULL, ?)""",
                (edition_id, visitor_id, week_key, timestamp.isoformat(), timestamp.isoformat(), TIDE_EDITORIAL_VERSION),
            )
    return {
        "status": "running", "phase": "collecting", "can_refresh": False,
        "next_refresh_at": next_personal_refresh_at(at), "error_code": None,
        "attempt_count": attempt_count, "accepted": True, "edition_id": edition_id,
    }


def _update_personal_phase(edition_id: str, phase: str, attempt_count: int, at: datetime | None = None) -> None:
    with connect() as connection:
        connection.execute(
            """UPDATE tide_personal_editions SET phase = ?, updated_at = ?
               WHERE id = ? AND status = 'running' AND attempt_count = ?""",
            (phase, _utc_now(at).isoformat() if at else now(), edition_id, attempt_count),
        )


def _mark_personal_failed(edition_id: str, error_code: str, attempt_count: int | None = None, at: datetime | None = None) -> None:
    with connect() as connection:
        if attempt_count is None:
            connection.execute(
                """UPDATE tide_personal_editions
                   SET status = 'failed', phase = 'failed', error_code = ?, updated_at = ?
                   WHERE id = ? AND status = 'running'""",
                (error_code, _utc_now(at).isoformat() if at else now(), edition_id),
            )
        else:
            connection.execute(
                """UPDATE tide_personal_editions
                   SET status = 'failed', phase = 'failed', error_code = ?, updated_at = ?
                   WHERE id = ? AND status = 'running' AND attempt_count = ?""",
                (error_code, _utc_now(at).isoformat() if at else now(), edition_id, attempt_count),
            )


def refresh_personal_tide_report(
    visitor_id: str,
    edition_id: str | None = None,
    at: datetime | None = None,
    attempt_count: int | None = None,
) -> dict[str, Any]:
    if not provider.live:
        if edition_id:
            _mark_personal_failed(edition_id, "tide_not_configured", attempt_count, at)
        return {"status": "failed", "error_code": "tide_not_configured"}
    with connect() as connection:
        row = row_dict(connection.execute(
            """SELECT * FROM tide_personal_editions
               WHERE visitor_id = ? AND week_key = ? AND editorial_version = ?""",
            (visitor_id, current_week_key(at), TIDE_EDITORIAL_VERSION),
        ).fetchone())
    if not row or row["status"] != "running" or (edition_id and row["id"] != edition_id):
        return personal_refresh_state(visitor_id, at)
    edition_id = row["id"]
    attempt_count = attempt_count or row["attempt_count"]
    if row["attempt_count"] != attempt_count:
        return personal_refresh_state(visitor_id, at)
    try:
        sources, ideas, status = _build_report(
            visitor_id,
            at,
            lambda phase: _update_personal_phase(edition_id, phase, attempt_count, at),
        )
        _persist_report(edition_id, sources, ideas, status, personal=True, at=at, attempt_count=attempt_count)
        return {"status": status, "idea_count": len(ideas)}
    except ProviderError as exc:
        _mark_personal_failed(edition_id, exc.code, attempt_count, at)
        return {"status": "failed", "error_code": exc.code}
    except Exception:
        _mark_personal_failed(edition_id, "tide_refresh_failed", attempt_count, at)
        return {"status": "failed", "error_code": "tide_refresh_failed"}


async def weekly_tide_refresh_loop(stop_event: asyncio.Event) -> None:
    """Run once on startup for catch-up, then cheaply poll for Monday 09:00."""
    while not stop_event.is_set():
        await asyncio.to_thread(refresh_weekly_tide_report)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(15, settings.tide_refresh_interval_seconds))
        except TimeoutError:
            continue


def latest_report_for_project(project_id: str, visitor_id: str | None = None) -> dict[str, Any]:
    """Prefer this visitor's current personal report, otherwise show shared."""
    refresh_state = personal_refresh_state(visitor_id) if visitor_id else {
        "status": "idle", "phase": "idle", "can_refresh": False,
        "next_refresh_at": next_personal_refresh_at(), "error_code": None, "attempt_count": 0,
    }
    with connect() as connection:
        latest_attempt = row_dict(connection.execute(
            "SELECT * FROM tide_editions WHERE editorial_version = ? ORDER BY created_at DESC LIMIT 1",
            (TIDE_EDITORIAL_VERSION,),
        ).fetchone())
        edition = None
        scope = "shared"
        if visitor_id:
            edition = row_dict(connection.execute(
                """SELECT * FROM tide_personal_editions
                   WHERE visitor_id = ? AND week_key = ? AND editorial_version = ?
                     AND status IN ('succeeded', 'partial')
                   ORDER BY completed_at DESC LIMIT 1""",
                (visitor_id, current_week_key(), TIDE_EDITORIAL_VERSION),
            ).fetchone())
            if edition:
                scope = "personal"
        if not edition:
            edition = row_dict(connection.execute(
                """SELECT * FROM tide_editions
                   WHERE status IN ('succeeded', 'partial') AND editorial_version = ?
                   ORDER BY completed_at DESC LIMIT 1""",
                (TIDE_EDITORIAL_VERSION,),
            ).fetchone())
        if not edition:
            return {
                "edition": None, "latest_attempt": latest_attempt,
                "refresh_state": refresh_state, "next_refresh_at": refresh_state["next_refresh_at"],
            }
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
        return {
            "edition": edition | {"scope": scope, "ideas": ideas},
            "latest_attempt": latest_attempt,
            "refresh_state": refresh_state,
            "next_refresh_at": refresh_state["next_refresh_at"],
        }


def shared_idea_for_project(connection: Any, idea_id: str, visitor_id: str | None = None) -> dict[str, Any] | None:
    idea = row_dict(connection.execute("SELECT * FROM tide_report_ideas WHERE id = ?", (idea_id,)).fetchone())
    if not idea:
        return None
    shared = connection.execute(
        """SELECT 1 FROM tide_editions
           WHERE id = ? AND status IN ('succeeded', 'partial') AND editorial_version = ?""",
        (idea["edition_id"], TIDE_EDITORIAL_VERSION),
    ).fetchone()
    personal = None
    if visitor_id:
        personal = connection.execute(
            """SELECT 1 FROM tide_personal_editions
               WHERE id = ? AND visitor_id = ? AND status IN ('succeeded', 'partial')
                 AND editorial_version = ?""",
            (idea["edition_id"], visitor_id, TIDE_EDITORIAL_VERSION),
        ).fetchone()
    if not shared and not personal:
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
