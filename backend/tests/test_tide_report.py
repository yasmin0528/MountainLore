from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.fieldwork.store import initialize_database
from app.main import app
from app.services.providers import ProviderError, WeeklyTideIdea, WeeklyTideSource, _TAVILY_WEEKLY_QUERIES, provider
from app.services.tide_report import VerifiedSource, is_allowed_source_url, latest_report_for_project, refresh_weekly_tide_report
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
    return [
        WeeklyTideSource(f"https://www.foodaily.com/a{i}", "industry", "Foodaily", f"行业来源 {i}", "2026-08-20")
        for i in range(1, 7)
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
    assert report["edition"]["week_key"] == "2026-08-31"
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
        sample = client.get("/api/tide-report/sample").json()["data"]
        assert sample["edition"]["week_key"] == "2026-08-31"
        assert len(sample["edition"]["ideas"]) == 6
        project_id = _seed_positioned_project(client)
        report = client.get(f"/api/projects/{project_id}/tide-report").json()["data"]
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
    assert any(source.published_at is None for source in sources)
    assert all("old-article" not in source.url for source in sources)


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
