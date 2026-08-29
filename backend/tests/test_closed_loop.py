from __future__ import annotations

import base64
import io
import sqlite3
import time
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.core.config import settings
from app.main import app


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII="
)


def test_incompatible_evidence_tables_are_preserved_and_migrated(tmp_path: Path, monkeypatch) -> None:
    database = tmp_path / "legacy.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE source_records (id TEXT PRIMARY KEY, source_type TEXT, source_locator TEXT)")
        connection.execute("INSERT INTO source_records VALUES ('old-source', 'interview', 'legacy://one')")
    monkeypatch.setattr(settings, "database_path", str(database))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
    with sqlite3.connect(database) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(source_records)")}
        legacy_tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'legacy_source_records_%'")]
        assert {"project_id", "field_note_id", "source_ref", "content"}.issubset(columns)
        assert legacy_tables
        assert connection.execute(f'SELECT id FROM "{legacy_tables[0]}"').fetchone()[0] == "old-source"


def wait_task(client: TestClient, task_id: str) -> dict:
    for _ in range(80):
        task = client.get(f"/api/tasks/{task_id}").json()["data"]
        if task["status"] in {"succeeded", "partial", "failed"}:
            return task
        time.sleep(0.05)
    raise AssertionError("task did not finish")


def seed_project(client: TestClient) -> tuple[str, str]:
    client.post("/api/visitors")
    project = client.post(
        "/api/projects",
        json={"brand_name": "见山刺梨", "industry": "刺梨", "core_product": "刺梨原汁", "origin": "贵州六盘水", "category": "刺梨", "consent": True},
    ).json()["data"]
    session = client.post("/api/sessions", json={"project_id": project["id"]}).json()["data"]
    client.post(
        f"/api/sessions/{session['id']}/messages",
        headers={"Idempotency-Key": "fieldwork-1"},
        json={"content": "果子由合作社成员在成熟期人工采收，并在当天完成分拣。", "skipped": False, "media_asset_ids": []},
    )
    candidates = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]["candidates"]
    client.post(f"/api/candidates/{candidates[0]['id']}/confirm")
    return project["id"], candidates[0]["id"]


def test_evidence_bound_async_closed_loop_and_delivery(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "closed-loop.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project_id, _ = seed_project(client)
        workspace = client.get(f"/api/projects/{project_id}/workspace").json()["data"]
        public_claims = [claim for claim in workspace["claims"] if claim["public_allowed"]]
        assert public_claims and all(claim["status"] == "confirmed" for claim in public_claims)

        first = client.post(
            f"/api/projects/{project_id}/chronicle/confirm",
            headers={"Idempotency-Key": "chronicle-once"}, json={"request_id": "initial"},
        ).json()["data"]
        repeated = client.post(
            f"/api/projects/{project_id}/chronicle/confirm",
            headers={"Idempotency-Key": "chronicle-once"}, json={"request_id": "initial"},
        ).json()["data"]
        assert first["task"]["id"] == repeated["task"]["id"]
        route_task = wait_task(client, first["task"]["id"])
        assert route_task["status"] == "succeeded"
        routes = client.get(f"/api/projects/{project_id}/workspace").json()["data"]["directions"]
        visible = [route for route in routes if route["state"] != "superseded"]
        assert len(visible) == 3
        allowed_ids = {claim["id"] for claim in public_claims}
        for route in visible:
            for point in route["content_json"]["selling_points"]:
                assert set(point["claimIds"]).issubset(allowed_ids)

        selected = client.post(f"/api/directions/{visible[0]['id']}/select").json()["data"]
        assert selected["task"] is None  # demo mode has no deferred image job
        assert selected["manual"]["manual_version_id"]
        workspace = client.get(f"/api/projects/{project_id}/workspace").json()["data"]
        assert workspace["manual"]["content"]["brand_name"] == "见山刺梨"
        assert workspace["manual_versions"][0]["status"] == "text_ready"
        auto_export_tasks = [task for task in workspace["tasks"] if task["kind"] == "export"]
        assert not auto_export_tasks

        upload = client.post(
            "/api/media", content=PNG_1X1,
            headers={"Content-Type": "image/png", "X-Project-ID": project_id, "X-File-Name": "logo.png"},
        ).json()["data"]
        client.post(
            f"/api/projects/{project_id}/brand-manual/assets/logo_mark",
            json={"media_asset_id": upload["id"]},
        ).raise_for_status()
        assert client.get(f"/api/media/{upload['id']}").content == PNG_1X1

        share = client.post(f"/api/projects/{project_id}/brand-manual/shares", json={"label": "验收快照"}).json()["data"]
        token = share["api_url"].rsplit("/", 1)[-1]
        frozen = client.get(share["api_url"]).json()["data"]
        edited = dict(workspace["manual"]["content"])
        edited["slogan"] = "这是后续编辑，不应改动旧分享"
        client.patch(f"/api/projects/{project_id}/brand-manual", json={"content_json": edited}).raise_for_status()
        assert client.get(f"/api/shares/{token}").json()["data"] == frozen

        export_task = client.post(
            f"/api/projects/{project_id}/brand-manual/exports",
            headers={"Idempotency-Key": "export-once"}, json={"formats": ["pdf", "zip"]},
        ).json()["data"]["task"]
        export_result = wait_task(client, export_task["id"])
        assert export_result["status"] == "succeeded"
        exported = {item["format"]: client.get(item["download_url"]).content for item in export_result["result"]["exports"]}
        assert len(PdfReader(io.BytesIO(exported["pdf"])).pages) == 14
        with zipfile.ZipFile(io.BytesIO(exported["zip"])) as archive:
            assert {"brand-manual.json", "brand-manual.pdf"}.issubset(archive.namelist())

        client.post(f"/api/projects/{project_id}/brand-manual/shares/{share['id']}/revoke").raise_for_status()
        assert client.get(f"/api/shares/{token}").status_code == 404

        with TestClient(app) as stranger:
            stranger.post("/api/visitors")
            assert stranger.get(f"/api/projects/{project_id}/workspace").status_code == 404
            assert stranger.get(f"/api/media/{upload['id']}").status_code == 404
