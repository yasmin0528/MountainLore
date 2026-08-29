from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.providers import CulturalResearchCard, CulturalResearchSource, ProviderError, provider


def _project_and_session(client: TestClient) -> tuple[dict, dict]:
    client.post("/api/visitors").raise_for_status()
    project = client.post("/api/projects", json={
        "brand_name": "山里好果", "industry": "刺梨", "core_product": "刺梨原汁",
        "origin": "贵州六盘水", "category": "刺梨", "consent": True,
    }).json()["data"]
    session = client.post("/api/sessions", json={"project_id": project["id"]}).json()["data"]["session"]
    return project, session


def test_culture_research_cards_are_source_backed_and_public_after_confirmation(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "culture.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    source = CulturalResearchSource(
        url="https://example.gov.cn/heritage/cili", title="地方文化馆资料", excerpt="刺梨采集与山地生活的公开记录。", authority="official",
    )
    card = CulturalResearchCard(
        type="LOCAL_CULTURE", title="山地采集的季节记忆", content="公开资料记录了当地围绕刺梨采集形成的季节性劳动经验。", risk="low", source_urls=[source.url],
    )
    monkeypatch.setattr(provider, "cultural_research", lambda origin, product: ([card], {source.url: source}))

    with TestClient(app) as client:
        project, session = _project_and_session(client)
        result = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]
        research = result["research_task"]
        candidate = next(item for item in result["candidates"] if item["type"] == "LOCAL_CULTURE")
        assert research["kind"] == "culture_research"
        assert research["status"] == "succeeded"
        assert candidate["sources"] == [{
            "id": candidate["sources"][0]["id"], "url": source.url, "title": source.title,
            "excerpt": source.excerpt, "authority": "official", "captured_at": candidate["sources"][0]["captured_at"],
        }]

        confirmed = client.post(f"/api/candidates/{candidate['id']}/confirm").json()["data"]
        assert confirmed["archive_card"]["source_summary"] == "公开资料 1 条"
        workspace = client.get(f"/api/projects/{project['id']}/workspace").json()["data"]
        claim = next(item for item in workspace["claims"] if item["statement"] == card.content)
        assert claim["status"] == "confirmed"
        assert claim["public_allowed"] == 1


def test_culture_research_failure_quietly_keeps_fieldwork_candidates(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "culture-failure.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))

    def fail_research(origin: str, product: str):
        raise ProviderError("tavily_timeout", "timeout")

    monkeypatch.setattr(provider, "cultural_research", fail_research)
    with TestClient(app) as client:
        _, session = _project_and_session(client)
        result = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]
        assert result["research_task"]["status"] == "failed"
        assert [item["title"] for item in result["candidates"]] == ["品牌主体", "产品产业", "主要产地"]
        assert all(not item["sources"] for item in result["candidates"])