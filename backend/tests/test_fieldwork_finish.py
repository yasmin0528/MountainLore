from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings
from app.fieldwork.store import connect
from app.main import app


def create_project_and_session(client: TestClient) -> tuple[dict, dict]:
    client.post("/api/visitors").raise_for_status()
    project = client.post(
        "/api/projects",
        json={"brand_name": "山野刺梨社", "industry": "刺梨", "core_product": "刺梨原汁", "origin": "贵州六盘水", "category": "刺梨", "consent": True},
    ).json()["data"]
    session = client.post("/api/sessions", json={"project_id": project["id"]}).json()["data"]
    return project, session


def test_skipping_to_terminal_creates_basic_candidates(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "skip-finish.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project, session = create_project_and_session(client)
        for index in range(3):
            response = client.post(
                f"/api/sessions/{session['id']}/messages",
                json={"content": "", "skipped": True, "media_asset_ids": []},
            )
            response.raise_for_status()
            updated = response.json()["data"]["session"]
            assert updated["ready_to_finish"] is (index == 2)

        assert updated["messages"][-1]["role"] == "assistant"
        assert "结束本次采风" in updated["messages"][-1]["content"]
        candidates = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]["candidates"]
        assert [(item["title"], item["content"]) for item in candidates] == [
            ("品牌主体", project["brand_name"]),
            ("产品产业", project["industry"]),
            ("主要产地", project["origin"]),
        ]
        confirmed = client.post(f"/api/candidates/{candidates[0]['id']}/confirm").json()["data"]
        assert confirmed["archive_card"]["source_summary"] == "基础建档"


def test_field_notes_keep_existing_candidate_flow(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "notes-finish.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        _, session = create_project_and_session(client)
        client.post(
            f"/api/sessions/{session['id']}/messages",
            json={"content": "果子成熟当天由合作社成员采收并完成分拣。", "skipped": False, "media_asset_ids": []},
        ).raise_for_status()
        candidates = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]["candidates"]
        assert len(candidates) == 1
        assert candidates[0]["title"] == "品牌的来处"
        confirmed = client.post(f"/api/candidates/{candidates[0]['id']}/confirm").json()["data"]
        assert confirmed["archive_card"]["source_summary"] == "采风问答与图片来源"


def test_terminal_state_is_detected_by_answer_count_even_without_finish_prompt(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "ready-finish.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        _, session = create_project_and_session(client)
        for _ in range(3):
            response = client.post(
                f"/api/sessions/{session['id']}/messages",
                json={"content": "", "skipped": True, "media_asset_ids": []},
            )
            response.raise_for_status()

        with connect() as connection:
            connection.execute(
                "INSERT INTO messages (id, session_id, role, content, sequence, created_at) VALUES (?, ?, 'assistant', '采风已足够，继续整理细节。', ?, ?)",
                ("override-finish", session["id"], 99, "2026-08-29T10:00:00Z"),
            )

        project_response = client.get(f"/api/projects/{session['project_id']}")
        project_response.raise_for_status()
        assert project_response.json()["data"]["session"]["ready_to_finish"] is True
