import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.routes import workbench as workbench_routes
from app.core.config import settings
from app.fieldwork.store import connect, new_id, now
from app.main import app
from app.services import workflow
from app.services.providers import ProviderError, provider


def _seed_confirmed_card(client: TestClient) -> tuple[str, str]:
    client.post("/api/visitors")
    project = client.post(
        "/api/projects",
        json={"brand_name": "见山刺梨", "industry": "刺梨", "core_product": "刺梨原汁", "origin": "贵州龙里", "category": "刺梨", "consent": True},
    ).json()["data"]
    session = client.post("/api/sessions", json={"project_id": project["id"]}).json()["data"]
    client.post(f"/api/sessions/{session['id']}/messages", json={"content": "鲜果当天加工，邻居会来帮忙。", "media_asset_ids": []})
    candidate = client.post(f"/api/sessions/{session['id']}/finish").json()["data"]["candidates"][0]
    client.post(f"/api/candidates/{candidate['id']}/confirm")
    return project["id"], candidate["id"]


def test_workbench_direction_discard_and_launch_snapshot(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "workbench.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project_id, _ = _seed_confirmed_card(client)
        workspace = client.get(f"/api/projects/{project_id}/workspace").json()["data"]
        card = workspace["archive_cards"][0]
        deferred = client.post(
            f"/api/projects/{project_id}/chronicle/confirm",
            json={"request_id": "archive-first", "defer_directions": True},
        ).json()["data"]
        assert deferred == {"task": None, "routes": [], "deferred": True}
        assert client.get(f"/api/projects/{project_id}/workspace").json()["data"]["project"]["status"] == "archive_ready"
        preferences = {"logo_mode": "ai", "font_family": "Source Han Serif SC", "font_label": "思源宋体 / 思源黑体", "palette": ["#18372B", "#2B6173", "#D5A72B", "#F7F1E3"]}
        directions = client.post(f"/api/projects/{project_id}/directions", json={"visual_preferences": preferences}).json()["data"]["routes"]
        assert len(directions) == 3
        workspace_routes = client.get(f"/api/projects/{project_id}/workspace").json()["data"]["directions"]
        assert workspace_routes[0]["content_json"]["brand_one_liner"]
        assert workspace_routes[0]["content_json"]["visual_preferences"] == preferences
        assert {point["category"] for point in workspace_routes[0]["content_json"]["selling_points"]}.issubset({"产品创新", "创新活动策划"})
        selected = client.post(f"/api/directions/{directions[0]['id']}/select").json()["data"]
        assert selected["state"] == "current"
        assert selected["task"] is None
        assert selected["manual"]["content"]["logo_design"]
        manual_workspace = client.get(f"/api/projects/{project_id}/workspace").json()["data"]
        assert manual_workspace["manual_versions"][0]["status"] == "text_ready"
        assert not [task for task in manual_workspace["tasks"] if task["kind"] in {"manual_generation", "logo_generation", "export"}]
        search_id, inspiration_id = new_id(), new_id()
        with connect() as connection:
            connection.execute(
                "INSERT INTO tide_searches VALUES (?, ?, 'succeeded', ?, NULL, ?, ?)",
                (search_id, project_id, "刺梨 城市通勤", now(), now()),
            )
            connection.execute(
                "INSERT INTO inspiration_cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (inspiration_id, search_id, "公开灵感", "真实来源中的表达角度", "https://example.com/source", "来源标题", "2026-08-29", "适配当前路线", "只作灵感", now()),
            )
        job = client.post(f"/api/projects/{project_id}/generation-jobs", json={"template_type": "xiaohongshu", "inspiration_card_id": inspiration_id}).json()["data"]
        assert job["status"] == "partial"
        assert job["result"]["titles"]
        assert job["input_snapshot"]["inspiration"]["id"] == inspiration_id
        client.post(f"/api/archive-cards/{card['id']}/discard")
        assert client.post(f"/api/projects/{project_id}/directions", json={}).status_code == 422


def test_tide_never_fabricates_results_without_live_provider(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "tide.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project_id, _ = _seed_confirmed_card(client)
        direction = client.post(f"/api/projects/{project_id}/directions", json={}).json()["data"]["routes"][0]
        client.post(f"/api/directions/{direction['id']}/select")
        response = client.post(f"/api/projects/{project_id}/tide-searches", json={})
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "tide_not_configured"


def test_logo_failure_does_not_remove_the_selected_route_manual(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "logo-failure.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project_id, _ = _seed_confirmed_card(client)
        direction = client.post(f"/api/projects/{project_id}/directions", json={}).json()["data"]["routes"][0]
        monkeypatch.setattr(settings, "ai_runtime_mode", "live")
        monkeypatch.setattr(workbench_routes, "submit_task", lambda _task_id: None)
        selected = client.post(f"/api/directions/{direction['id']}/select").json()["data"]
        assert selected["task"]["kind"] == "logo_generation"
        assert selected["manual"]["manual_version_id"]

        def image_failure(*_args: object, **_kwargs: object) -> dict[str, str]:
            raise ProviderError("image_auth_failed", "图片服务鉴权失败")

        monkeypatch.setattr(provider, "generate_image", image_failure)
        failed_task = workflow.execute_task(selected["task"]["id"])
        workspace = client.get(f"/api/projects/{project_id}/workspace").json()["data"]

        assert failed_task["status"] == "failed"
        assert workspace["manual"]["current_version_id"] == selected["manual"]["manual_version_id"]
        assert workspace["manual_versions"][0]["status"] == "text_ready"
        assert workspace["directions"][0]["state"] == "current"


def test_generation_preview_is_not_an_archive_record_until_saved(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "preview.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project_id, _ = _seed_confirmed_card(client)
        route = client.post(f"/api/projects/{project_id}/directions", json={}).json()["data"]["routes"][0]
        client.post(f"/api/directions/{route['id']}/select")
        preview_id = new_id()
        snapshot = {"project": {"id": project_id}, "direction": {"id": route["id"]}}
        result = {"brief": "一份待确认的概念预览", "image": {"kind": "url", "value": "https://example.com/preview.png"}}
        with connect() as connection:
            connection.execute(
                "INSERT INTO generation_previews VALUES (?, ?, ?, ?, ?, ?, 'succeeded', NULL, ?, ?)",
                (preview_id, project_id, "peripheral", "让刺梨先被看见", json.dumps(snapshot), json.dumps(result), now(), now()),
            )
        assert client.get(f"/api/projects/{project_id}/workspace").json()["data"]["generation_jobs"] == []
        saved = client.post(f"/api/generation-previews/{preview_id}/save").json()["data"]
        assert saved["result"]["brief"] == "一份待确认的概念预览"
        assert len(client.get(f"/api/projects/{project_id}/workspace").json()["data"]["generation_jobs"]) == 1


def test_generation_preview_rejects_non_object_model_json_without_a_500(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "preview-json.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    with TestClient(app) as client:
        project_id, _ = _seed_confirmed_card(client)
        route = client.post(f"/api/projects/{project_id}/directions", json={}).json()["data"]["routes"][0]
        client.post(f"/api/directions/{route['id']}/select")
        monkeypatch.setattr(workbench_routes.provider, "chat_json", lambda **_kwargs: [])
        response = client.post(
            f"/api/projects/{project_id}/generation-previews",
            json={"template_type": "peripheral", "inspiration_text": "山地果实的晨间能量"},
        )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "invalid_model_json"


def test_generation_preview_persists_base64_image_as_authenticated_media(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "preview-image.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "live")
    with TestClient(app) as client:
        project_id, _ = _seed_confirmed_card(client)
        route = client.post(f"/api/projects/{project_id}/directions", json={}).json()["data"]["routes"][0]
        client.post(f"/api/directions/{route['id']}/select")
        monkeypatch.setattr(workbench_routes.provider, "chat_json", lambda **_kwargs: {"brief": "可审核的概念稿"})
        monkeypatch.setattr(workbench_routes.provider, "generate_image", lambda _prompt: {"kind": "base64", "value": "aW1hZ2UtYnl0ZXM="})
        preview = client.post(
            f"/api/projects/{project_id}/generation-previews",
            json={"template_type": "peripheral", "inspiration_text": "山地果实的晨间能量"},
        )
        assert preview.status_code == 200
        image_url = preview.json()["data"]["result"]["image"]["value"]
        image = client.get(image_url)
    assert image.status_code == 200
    assert image.content == b"image-bytes"


def test_generation_requires_active_archives_and_keeps_project_context_isolated(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "generation-scope.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        first_project_id, _ = _seed_confirmed_card(client)
        second_project_id, _ = _seed_confirmed_card(client)
        first_route = client.post(f"/api/projects/{first_project_id}/directions", json={}).json()["data"]["routes"][0]
        second_route = client.post(f"/api/projects/{second_project_id}/directions", json={}).json()["data"]["routes"][0]
        client.post(f"/api/directions/{first_route['id']}/select")
        client.post(f"/api/directions/{second_route['id']}/select")

        generated = client.post(f"/api/projects/{second_project_id}/generation-jobs", json={"template_type": "xiaohongshu"}).json()["data"]
        assert generated["input_snapshot"]["project"]["id"] == second_project_id
        assert {card["project_id"] for card in generated["input_snapshot"]["archive_cards"]} == {second_project_id}

        first_card = client.get(f"/api/projects/{first_project_id}/workspace").json()["data"]["archive_cards"][0]
        client.post(f"/api/archive-cards/{first_card['id']}/discard")
        blocked = client.post(f"/api/projects/{first_project_id}/generation-jobs", json={"template_type": "peripheral"})
        assert blocked.status_code == 422
        assert blocked.json()["error"]["code"] == "archive_required"


def test_project_directory_and_manual_keep_identity(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "manual.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project_id, _ = _seed_confirmed_card(client)
        directory = client.get("/api/projects").json()["data"]
        assert [project["id"] for project in directory] == [project_id]
        routes = client.post(f"/api/projects/{project_id}/directions", json={}).json()["data"]["routes"]
        assert len(routes) == 3
        client.post(f"/api/directions/{routes[0]['id']}/select")
        saved = client.patch(
            f"/api/projects/{project_id}/brand-manual",
            json={"content_json": {"brand_name": "不应覆盖项目名", "slogan": "可以编辑的口号"}},
        ).json()["data"]
        assert saved["content"]["brand_name"] == "见山刺梨"
        assert saved["content"]["slogan"] == "可以编辑的口号"


def test_legacy_v1_namespace_is_not_registered(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "routes.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    with TestClient(app) as client:
        assert client.get("/api/v1/projects").status_code == 404
