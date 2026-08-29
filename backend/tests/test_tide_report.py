from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.fieldwork.store import connect, initialize_database
from app.main import app
from app.services.providers import ProviderError, WeeklyTideIdea, WeeklyTideSource, _TAVILY_WEEKLY_QUERIES, _is_candidate_date_eligible, provider
from app.services.tide_report import (
    TIDE_EDITORIAL_VERSION,
    VerifiedSource,
    _is_recent_dated_article,
    canonical_source_url,
    deduplicate_verified_sources,
    is_allowed_source_url,
    latest_report_for_project,
    personal_refresh_state,
    refresh_personal_tide_report,
    refresh_weekly_tide_report,
    reserve_personal_tide_refresh,
    sources_are_same_story,
)
from app.services.tide_report import _validate_ideas
from app.services.tide_report import upcoming_holidays
import app.services.tide_report as tide_report


SHANGHAI = ZoneInfo("Asia/Shanghai")


def _seed_positioned_project(client: TestClient) -> str:
    client.post("/api/visitors")
    project = client.post(
        "/api/projects",
        json={"brand_name": "见山刺梨", "industry": "刺梨", "core_product": "刺梨原汁", "origin": "贵州龙里", "category": "刺梨", "consent": True},
    ).json()["data"]
    session = client.post("/api/sessions", json={"project_id": project["id"]}).json()["data"]
    client.post(f"/api/sessions/{session['id']}/messages", json={"content": "鲜果当天加工，邻居会来帮忙。", "media_asset_ids": []})
    candidate = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]["candidates"][0]
    client.post(f"/api/candidates/{candidate['id']}/confirm")
    route = client.post(f"/api/projects/{project['id']}/directions", json={}).json()["data"]["routes"][0]
    client.post(f"/api/directions/{route['id']}/select")
    return project["id"]


def _weekly_sources() -> list[WeeklyTideSource]:
    publishers = (("Foodaily", "foodaily.com"), ("36氪", "36kr.com"), ("观潮新消费", "tidesight.com"))
    return [
        WeeklyTideSource(f"https://www.{domain}/a{i}", "industry", publisher, f"行业来源 {i}", "2026-08-20")
        for i, (publisher, domain) in enumerate(publishers * 2, start=1)
    ]


def _weekly_ideas(sources: list[dict[str, str]]) -> list[WeeklyTideIdea]:
    return [
        WeeklyTideIdea(f"灵感 {index}", "内容母题", "通勤与朋友小聚", "中秋前的分享场景", "仅作创意角度", [source["url"]])
        for index, source in enumerate(sources, start=1)
    ]


def test_weekly_report_is_verified_shared_and_keeps_previous_success(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "tide-report.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    initialize_database()
    monkeypatch.setattr(provider, "weekly_tide_candidates", _weekly_sources)
    monkeypatch.setattr(provider, "weekly_tide_ideas", lambda sources, holidays: _weekly_ideas(sources))
    monkeypatch.setattr(
        tide_report,
        "verify_weekly_source",
        lambda candidate: VerifiedSource(candidate.url, candidate.url, candidate.channel, candidate.publisher, candidate.title, candidate.published_at),
    )
    first = refresh_weekly_tide_report(datetime(2026, 8, 31, 9, tzinfo=SHANGHAI))
    assert first == {"status": "succeeded", "week_key": "2026-08-31", "idea_count": 6}
    assert refresh_weekly_tide_report(datetime(2026, 8, 31, 10, tzinfo=SHANGHAI))["status"] == "already_attempted"

    monkeypatch.setattr(provider, "weekly_tide_candidates", lambda: _weekly_sources()[:4])
    failed = refresh_weekly_tide_report(datetime(2026, 9, 7, 9, tzinfo=SHANGHAI))
    assert failed["status"] == "failed"
    report = latest_report_for_project("any-positioned-project")
    assert report["edition"]["week_key"] == "2026-08-31-editorial-v4"
    assert report["edition"]["editorial_version"] == TIDE_EDITORIAL_VERSION
    assert len(report["edition"]["ideas"]) == 6


def test_tide_report_api_favorite_use_and_generation_snapshot(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "tide-api.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    initialize_database()
    monkeypatch.setattr(provider, "weekly_tide_candidates", _weekly_sources)
    monkeypatch.setattr(provider, "weekly_tide_ideas", lambda sources, holidays: _weekly_ideas(sources))
    monkeypatch.setattr(tide_report, "verify_weekly_source", lambda candidate: VerifiedSource(candidate.url, candidate.url, candidate.channel, candidate.publisher, candidate.title, candidate.published_at))
    refresh_weekly_tide_report(datetime(2026, 8, 31, 9, tzinfo=SHANGHAI))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        client.post("/api/visitors")
        sample = client.get("/api/tide-report/sample").json()["data"]
        assert sample["edition"]["week_key"] == "2026-08-31-editorial-v4"
        assert len(sample["edition"]["ideas"]) == 6
        project_id = _seed_positioned_project(client)
        report = client.get(f"/api/projects/{project_id}/tide-report").json()["data"]
        assert report["edition"]["week_key"] == "2026-08-31-editorial-v4"
        idea_id = report["edition"]["ideas"][0]["id"]
        assert client.post(f"/api/projects/{project_id}/tide-report-ideas/{idea_id}/favorite").json()["data"]["favorite"] == 1
        used = client.post(f"/api/projects/{project_id}/tide-report-ideas/{idea_id}/use").json()["data"]
        assert used["id"] == idea_id
        job = client.post(f"/api/projects/{project_id}/generation-jobs", json={"template_type": "xiaohongshu", "inspiration_card_id": idea_id}).json()["data"]
        assert job["input_snapshot"]["inspiration"]["id"] == idea_id


def test_weekly_source_allowlist_rejects_non_public_and_non_https() -> None:
    assert is_allowed_source_url("https://www.foodaily.com/article/1")
    assert is_allowed_source_url("https://www.xiaohongshu.com/explore/1")
    assert not is_allowed_source_url("http://www.foodaily.com/article/1")
    assert not is_allowed_source_url("https://example.com/article/1")


def test_weekly_source_requires_a_concrete_recent_date(monkeypatch) -> None:
    monkeypatch.setattr(tide_report, "china_now", lambda: datetime(2026, 8, 29, 12, tzinfo=SHANGHAI))
    monkeypatch.setattr(settings, "tide_search_lookback_days", 7)
    assert _is_recent_dated_article("2026-08-23")
    assert not _is_recent_dated_article("2026-08-21")
    assert not _is_recent_dated_article(None)
    assert not _is_recent_dated_article("本周更新")


def test_upcoming_holidays_do_not_guess_lunar_dates() -> None:
    dates = {item["name"]: item["date"] for item in upcoming_holidays(datetime(2026, 8, 29, 9, tzinfo=SHANGHAI))}
    assert dates["中秋"] == "2026-09-25"
    assert dates["国庆"] == "2026-10-01"


def test_holiday_only_report_can_publish_without_news_sources(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "holiday-only.db"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    initialize_database()
    holiday_idea = WeeklyTideIdea(
        "中秋山野物产分享礼", "围绕山野物产的节日分享内容", "中秋送礼与团聚前的内容准备", "中秋（2026-09-17）", "仅作节日创意角度", []
    )
    unsupported_idea = WeeklyTideIdea(
        "泛节日促销", "没有明确节日依据", "随时可用", "非节日驱动", "仅作创意角度", []
    )
    assert _validate_ideas([holiday_idea, unsupported_idea], {}, {"中秋"}) == [holiday_idea]
    monkeypatch.setattr(provider, "weekly_tide_candidates", lambda: [])
    monkeypatch.setattr(provider, "weekly_tide_ideas", lambda sources, holidays: [holiday_idea])
    monkeypatch.setattr(tide_report, "upcoming_holidays", lambda at: [{"name": "中秋", "date": "2026-09-17"}])
    result = refresh_weekly_tide_report(datetime(2026, 8, 31, 9, tzinfo=SHANGHAI))
    assert result == {"status": "partial", "week_key": "2026-08-31", "idea_count": 1}
    report = latest_report_for_project("any-positioned-project")
    assert report["edition"]["ideas"][0]["sources"] == []


def test_tide_provider_uses_its_own_models_and_credentials(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    monkeypatch.setattr(settings, "openai_next_api_key", "global-key")
    monkeypatch.setattr(settings, "openai_next_base_url", "https://global.example/v1")
    monkeypatch.setattr(settings, "openai_next_text_model", "global-model")
    monkeypatch.setattr(settings, "tide_api_key", "tide-key")
    monkeypatch.setattr(settings, "tide_api_base_url", "https://tide.example/v1")
    monkeypatch.setattr(settings, "tavily_api_key", "tavily-key")
    monkeypatch.setattr(settings, "tide_search_provider", "tavily")
    monkeypatch.setattr(settings, "tide_synthesis_model", "kimi-k3")
    captured: dict[str, object] = {}

    def _capture(**kwargs):
        captured.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(provider, "_chat_json", _capture)
    assert provider.tide_chat_json(model=settings.tide_synthesis_model, instruction="synthesize", context={}) == {"ok": True}
    assert captured["base_url"] == "https://tide.example/v1"
    assert captured["api_key"] == "tide-key"
    assert captured["model"] == "kimi-k3"
    assert captured["temperature"] is None
    readiness = provider.readiness()
    assert readiness["capabilities"]["tide"] == {
        "configured": True,
        "model": "kimi-k3",
        "search_provider": "tavily",
        "status": "configured",
    }
    assert readiness["text_model"] == "global-model"


def test_tide_k3_synthesis_uses_gateway_compatible_temperature(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tide_synthesis_model", "kimi-k3")
    captured: dict[str, object] = {}

    def _capture(**kwargs):
        captured.update(kwargs)
        return {"ideas": []}

    monkeypatch.setattr(provider, "tide_chat_json", _capture)
    assert provider.weekly_tide_ideas([], []) == []
    assert captured["model"] == "kimi-k3"
    assert captured["temperature"] == 1


def test_tavily_candidates_cover_each_source_group_and_deduplicate(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    monkeypatch.setattr(settings, "tavily_api_key", "tavily-key")
    monkeypatch.setattr(settings, "tide_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_max_results_per_query", 3)
    monkeypatch.setattr(provider, "_latest_public_source_candidates", lambda: [])
    calls: list[str] = []

    def _search(query):
        calls.append(query.domain)
        return {
            "results": [
                {"url": f"https://www.{query.domain}/article-1", "title": f"{query.publisher} 标题", "published_date": "2026-08-28"},
                {"url": "https://www.foodaily.com/duplicate", "title": "重复", "published_date": None},
                {"url": f"https://www.{query.domain}/old-article", "title": "旧文章", "published_date": "2025-01-01"},
            ]
        }

    monkeypatch.setattr(provider, "_tavily_search", _search)
    sources = provider.weekly_tide_candidates()
    assert calls == [
        "canyin88.com", "watcn.com", "foodaily.com", "foodinc.com.cn",
        "tidesight.com", "36kr.com", "xiaohongshu.com", "douyin.com",
    ]
    assert {source.channel for source in sources} == {"industry", "xiaohongshu", "douyin"}
    assert len({source.url for source in sources}) == len(sources)
    assert max(sum(source.publisher == publisher for source in sources) for publisher in {source.publisher for source in sources}) <= 3
    assert any(source.published_at is None for source in sources)
    assert all("old-article" not in source.url for source in sources)
    assert all("近7天" in query.query for query in _TAVILY_WEEKLY_QUERIES)


@pytest.mark.parametrize(
    ("status", "code"),
    [(401, "tavily_auth_failed"), (429, "tavily_quota_or_rate_limited")],
)
def test_tavily_failure_codes_are_explicit(monkeypatch, status: int, code: str) -> None:
    request = httpx.Request("POST", "https://api.tavily.com/search")
    monkeypatch.setattr(provider, "_post_tavily", lambda payload: httpx.Response(status, request=request))
    with pytest.raises(ProviderError) as raised:
        provider._tavily_search(_TAVILY_WEEKLY_QUERIES[0])
    assert raised.value.code == code


def test_tide_url_and_story_deduplication_covers_tracking_reprints_and_updates() -> None:
    tracked = "https://www.foodaily.com/article/42?utm_source=wx&spm=abc&lang=zh#comments"
    clean = "https://foodaily.com/article/42?lang=zh"
    assert canonical_source_url(tracked) == canonical_source_url(clean)
    original = VerifiedSource(
        tracked, clean, "industry", "Foodaily", "贵州刺梨：从山地采收到城市饮品｜Foodaily",
        "2026-08-27", "刺梨采收季开始，产地企业正在完善分拣和加工，并尝试进入城市饮品场景。"
    )
    reprint = VerifiedSource(
        "https://www.36kr.com/p/1", "https://www.36kr.com/p/1", "industry", "36氪",
        "贵州刺梨 从山地采收到城市饮品 - 36氪", "2026-08-27",
        "刺梨采收季开始，产地企业正在完善分拣和加工，并尝试进入城市饮品场景。"
    )
    assert sources_are_same_story(original, reprint)
    follow_up = VerifiedSource(
        "https://www.36kr.com/p/2", "https://www.36kr.com/p/2", "industry", "36氪",
        "贵州刺梨从山地采收到城市饮品", "2026-08-29",
        "新建冷链仓已经投用，合作社公布首批出口订单和新的加工产线。"
    )
    assert not sources_are_same_story(follow_up, original)
    assert deduplicate_verified_sources([original, reprint, follow_up]) == [original, follow_up]


def test_personal_partial_report_is_weekly_reused_and_private(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "personal-partial.db"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    initialize_database()
    at = datetime(2026, 8, 29, 12, tzinfo=SHANGHAI)
    monkeypatch.setattr(tide_report, "china_now", lambda: at)
    sources = _weekly_sources()[:3]
    monkeypatch.setattr(provider, "weekly_tide_candidates", lambda: sources)
    monkeypatch.setattr(provider, "weekly_tide_ideas", lambda source_context, holidays: _weekly_ideas(source_context))
    monkeypatch.setattr(
        tide_report,
        "verify_weekly_source",
        lambda candidate: VerifiedSource(
            candidate.url, candidate.url, candidate.channel, candidate.publisher,
            candidate.title, "2026-08-28", "不同来源的完整正文 " + candidate.url,
        ),
    )

    reserved = reserve_personal_tide_refresh("visitor-a", at)
    assert reserved["accepted"] is True
    result = refresh_personal_tide_report("visitor-a", reserved["edition_id"], at)
    assert result == {"status": "partial", "idea_count": 3}
    assert reserve_personal_tide_refresh("visitor-a", at)["accepted"] is False

    first_project = latest_report_for_project("project-a", "visitor-a")
    second_project = latest_report_for_project("project-b", "visitor-a")
    other_visitor = latest_report_for_project("project-c", "visitor-b")
    assert first_project["edition"]["scope"] == "personal"
    assert first_project["edition"]["id"] == second_project["edition"]["id"]
    assert first_project["refresh_state"]["status"] == "partial"
    assert first_project["refresh_state"]["can_refresh"] is False
    assert other_visitor["edition"] is None
    assert other_visitor["refresh_state"]["can_refresh"] is True


def test_shared_auto_refresh_does_not_consume_private_quota(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "shared-does-not-consume.db"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    initialize_database()
    at = datetime(2026, 8, 29, 9, tzinfo=SHANGHAI)
    monkeypatch.setattr(provider, "weekly_tide_candidates", _weekly_sources)
    monkeypatch.setattr(provider, "weekly_tide_ideas", lambda sources, holidays: _weekly_ideas(sources))
    monkeypatch.setattr(
        tide_report,
        "verify_weekly_source",
        lambda candidate: VerifiedSource(candidate.url, candidate.url, candidate.channel, candidate.publisher, candidate.title, "2026-08-28", candidate.url),
    )
    assert refresh_weekly_tide_report(at)["status"] == "succeeded"
    state = personal_refresh_state("visitor-a", at)
    assert state["status"] == "idle"
    assert state["can_refresh"] is True


def test_personal_failure_keeps_shared_report_and_retries_after_60_seconds(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "personal-retry.db"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    initialize_database()
    at = datetime(2026, 8, 29, 9, tzinfo=SHANGHAI)
    monkeypatch.setattr(tide_report, "china_now", lambda: at)
    monkeypatch.setattr(provider, "weekly_tide_candidates", _weekly_sources)
    monkeypatch.setattr(provider, "weekly_tide_ideas", lambda sources, holidays: _weekly_ideas(sources))
    monkeypatch.setattr(
        tide_report,
        "verify_weekly_source",
        lambda candidate: VerifiedSource(candidate.url, candidate.url, candidate.channel, candidate.publisher, candidate.title, "2026-08-28", candidate.url),
    )
    assert refresh_weekly_tide_report(at)["status"] == "succeeded"
    shared_id = latest_report_for_project("project", "visitor-a")["edition"]["id"]

    monkeypatch.setattr(provider, "weekly_tide_candidates", lambda: (_ for _ in ()).throw(ProviderError("tavily_quota_or_rate_limited", "busy")))
    reserved = reserve_personal_tide_refresh("visitor-a", at)
    assert refresh_personal_tide_report("visitor-a", reserved["edition_id"], at)["status"] == "failed"
    failed_report = latest_report_for_project("project", "visitor-a")
    assert failed_report["edition"]["id"] == shared_id
    assert failed_report["edition"]["scope"] == "shared"
    assert personal_refresh_state("visitor-a", at + timedelta(seconds=30))["can_refresh"] is False
    retry = reserve_personal_tide_refresh("visitor-a", at + timedelta(seconds=61))
    assert retry["accepted"] is True
    assert retry["attempt_count"] == 2


def test_personal_double_click_starts_once_and_new_week_resets(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "personal-concurrency.db"))
    initialize_database()
    at = datetime(2026, 8, 29, 10, tzinfo=SHANGHAI)
    with ThreadPoolExecutor(max_workers=2) as executor:
        states = list(executor.map(lambda _: reserve_personal_tide_refresh("visitor-a", at), range(2)))
    assert sum(bool(state["accepted"]) for state in states) == 1
    edition_id = next(state["edition_id"] for state in states if state["accepted"])
    with connect() as connection:
        connection.execute(
            "UPDATE tide_personal_editions SET status = 'succeeded', phase = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
            (at.isoformat(), at.isoformat(), edition_id),
        )
    assert reserve_personal_tide_refresh("visitor-a", at)["accepted"] is False
    next_week = reserve_personal_tide_refresh("visitor-a", at + timedelta(days=7))
    assert next_week["accepted"] is True
    assert next_week["attempt_count"] == 1
