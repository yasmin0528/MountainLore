import sqlite3

from fastapi.testclient import TestClient

from app.core.config import settings
from app.fieldwork.store import initialize_database
from app.main import app


def test_fieldwork_single_session_and_candidate_confirmation(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "fieldwork.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))

    with TestClient(app) as client:
        assert client.post("/api/visitors").status_code == 200
        project = client.post(
            "/api/projects",
            json={
                "brand_name": "山里黄",
                "industry": "刺梨深加工",
                "core_product": "刺梨原汁",
                "origin": "贵州六盘水",
                "category": "刺梨",
                "consent": True,
            },
        ).json()["data"]
        next_project = client.post(
            "/api/projects",
            json={
                "brand_name": "第二份品牌档案",
                "industry": "贵州茶",
                "core_product": "袋泡茶",
                "origin": "贵州都匀",
                "category": "贵州茶",
                "consent": True,
            },
        )
        assert next_project.status_code == 200
        session = client.post("/api/sessions", json={"project_id": project["id"]}).json()["data"]
        assert session["status"] == "active"
        assert client.post("/api/sessions", json={"project_id": project["id"]}).status_code == 409

        media = client.post(
            "/api/media",
            content=b"demo-image-bytes",
            headers={
                "Content-Type": "image/png",
                "X-Project-ID": project["id"],
                "X-File-Name": "orchard.png",
            },
        )
        assert media.status_code == 200

        message = client.post(
            f"/api/sessions/{session['id']}/messages",
            json={"content": "秋收时邻居会来帮忙，鲜果当天就送去处理。", "media_asset_ids": [media.json()["data"]["id"]]},
            headers={"Idempotency-Key": "answer-one"},
        )
        assert message.status_code == 200
        assert message.json()["data"]["session"]["field_notes"]

        completed = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]
        assert completed["candidates"]
        candidate = completed["candidates"][0]
        confirmed = client.post(f"/api/candidates/{candidate['id']}/confirm")
        assert confirmed.status_code == 200
        assert confirmed.json()["data"]["candidate"]["status"] == "confirmed"


def test_legacy_projects_table_is_migrated_before_creating_a_project(tmp_path, monkeypatch) -> None:
    database = tmp_path / "legacy.db"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """CREATE TABLE projects (
                id TEXT PRIMARY KEY, brand_name TEXT NOT NULL, industry TEXT NOT NULL,
                core_product TEXT NOT NULL, origin TEXT NOT NULL,
                product_category TEXT, current_stage TEXT NOT NULL,
                current_route_id TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )"""
        )
    monkeypatch.setattr(settings, "database_path", str(database))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    initialize_database()

    with TestClient(app) as client:
        client.post("/api/visitors")
        response = client.post(
            "/api/projects",
            json={"brand_name": "迁移测试", "industry": "刺梨", "core_product": "刺梨原汁", "origin": "贵州", "consent": True},
        )
    assert response.status_code == 200


def test_delete_project_removes_the_visitor_owned_project(tmp_path, monkeypatch) -> None:
    database = tmp_path / "delete-project.db"
    monkeypatch.setattr(settings, "database_path", str(database))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))

    with TestClient(app) as client:
        assert client.post("/api/visitors").status_code == 200
        created = client.post(
            "/api/projects",
            json={
                "brand_name": "Delete Me",
                "industry": "tea",
                "core_product": "green tea",
                "origin": "Guizhou",
                "consent": True,
            },
        ).json()["data"]
        deleted = client.delete(f"/api/projects/{created['id']}")
        assert deleted.status_code == 200
        assert deleted.json()["data"]["status"] == "deleted"
        assert client.get("/api/projects").json()["data"] == []
        assert client.get(f"/api/projects/{created['id']}").status_code == 404
