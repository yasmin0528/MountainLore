"""Continuation rounds for re-fieldwork ("再次采风").

A single per-project session now carries several rounds (messages.round_no).
These tests cover the round lifecycle: restarting a completed/terminated round
opens a new round that keeps the history and notes, while an in-progress round
(<3 answers) is resumed in place; per-round answer budgets stay independent;
candidates are not regenerated across rounds; and legacy databases migrate the
round_no column in place instead of being retired.
"""
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings
from app.fieldwork.store import connect, initialize_database
from app.main import app

CONTINUATION_QUESTION = "上一轮已经记下了一些材料。这一轮接着采风：还有哪些关于来处、工艺、人物或现场的细节，是你希望被记下来的？"


def create_project_and_session(client: TestClient) -> tuple[dict, dict]:
    client.post("/api/visitors").raise_for_status()
    project = client.post(
        "/api/projects",
        json={"brand_name": "山野刺梨社", "industry": "刺梨", "core_product": "刺梨原汁", "origin": "贵州六盘水", "category": "刺梨", "consent": True},
    ).json()["data"]
    session = client.post("/api/sessions", json={"project_id": project["id"]}).json()["data"]
    return project, session


def answer(client: TestClient, session_id: str, content: str = "", skipped: bool = False) -> dict:
    response = client.post(
        f"/api/sessions/{session_id}/messages",
        json={"content": content, "skipped": skipped, "media_asset_ids": []},
    )
    response.raise_for_status()
    return response.json()["data"]["session"]


def restart(client: TestClient, project_id: str) -> dict:
    response = client.post(f"/api/projects/{project_id}/fieldwork/restart")
    response.raise_for_status()
    return response.json()["data"]["session"]


def finish(client: TestClient, session_id: str) -> list[dict]:
    response = client.post(f"/api/sessions/{session_id}/finish")
    response.raise_for_status()
    return response.json()["data"]["candidates"]


def get_session(client: TestClient, project_id: str) -> dict:
    response = client.get(f"/api/projects/{project_id}")
    response.raise_for_status()
    return response.json()["data"]["session"]


def round_user_messages(session_payload: dict, round_no: int) -> int:
    return sum(1 for message in session_payload["messages"] if int(message.get("round_no") or 1) == round_no and message["role"] == "user")


def test_completed_restart_opens_round_two_keeping_history_and_notes(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "rounds.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project, session = create_project_and_session(client)
        for index in range(3):
            answer(client, session["id"], content=f"第 {index + 1} 段真实细节：合作社在山坡上分拣果实。")
        assert get_session(client, project["id"])["ready_to_finish"] is True

        first = finish(client, session["id"])
        assert len(first) == 3  # 三条采风笔记 → 三张候选

        restarted = restart(client, project["id"])
        assert restarted["status"] == "active"
        assert restarted["round"] == 2
        assert restarted["ready_to_finish"] is False
        assert restarted["messages"][-1]["content"] == CONTINUATION_QUESTION
        assert restarted["messages"][-1]["round_no"] == 2
        # 旧对话与旧笔记都保留。
        assert len(restarted["messages"]) > 6
        assert len(restarted["field_notes"]) == 3

        # 第二轮补采一条，finish 只应新增这张候选，不重复第一轮的笔记。
        answer(client, session["id"], content="第二轮补采：包装用本地靛蓝布纹。")
        second = finish(client, session["id"])
        assert len(second) == 4
        assert len({note_id for candidate in second for note_id in candidate["field_note_ids"]}) == 4


def test_active_locked_round_restarts_and_budget_stays_per_round(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "locked.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project, session = create_project_and_session(client)
        for _ in range(3):
            answer(client, session["id"], content="采风中留下的真实细节。")
        # 会话仍是 active 但 ready_to_finish 已锁住 → restart 必须开新轮。
        restarted = restart(client, project["id"])
        assert restarted["round"] == 2
        assert restarted["ready_to_finish"] is False

        for _ in range(5):
            answer(client, session["id"], content="第二轮的更多细节。")
        assert round_user_messages(get_session(client, project["id"]), 2) == 5
        # 每轮独立预算：第六个回答被本轮 409 阻断（第一轮的 3 条不算进来）。
        blocked = client.post(
            f"/api/sessions/{session['id']}/messages",
            json={"content": "超过本轮预算的回答。", "skipped": False, "media_asset_ids": []},
        )
        assert blocked.status_code == 409
        assert blocked.json()["error"]["code"] == "fieldwork_ready_to_finish"


def test_zero_archive_cards_restart_does_not_duplicate_fallback_candidates(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "zero.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project, session = create_project_and_session(client)
        for _ in range(3):
            answer(client, session["id"], skipped=True)
        first = finish(client, session["id"])
        assert [item["title"] for item in first] == ["品牌主体", "产品产业", "主要产地"]
        for candidate in first:
            client.post(f"/api/candidates/{candidate['id']}/discard").raise_for_status()

        # 一张档案卡都没有 → 仍然可以再次采风。
        restarted = restart(client, project["id"])
        assert restarted["status"] == "active"
        assert restarted["round"] == 2
        assert restarted["ready_to_finish"] is False

        # 第二轮全跳过 → 基础候选不会重复生成。
        for _ in range(3):
            answer(client, session["id"], skipped=True)
        second = finish(client, session["id"])
        assert len(second) == 3
        assert [item["title"] for item in second] == ["品牌主体", "产品产业", "主要产地"]


def test_active_in_progress_restart_resumes_same_round(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "resume.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project, session = create_project_and_session(client)
        answer(client, session["id"], content="第一段细节。")
        before = get_session(client, project["id"])

        resumed = restart(client, project["id"])
        assert resumed["id"] == session["id"]
        assert resumed["sequence"] == session["sequence"]
        assert resumed["round"] == 1
        assert len(resumed["messages"]) == len(before["messages"])  # 不追加续轮消息
        assert resumed["messages"][-1]["round_no"] == 1

        # 恢复后继续同一轮，不另起轮次。
        after = answer(client, session["id"], content="第二段细节。")
        assert after["round"] == 1


def test_ready_to_finish_does_not_leak_across_rounds(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "leak.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project, session = create_project_and_session(client)
        for _ in range(3):
            answer(client, session["id"], skipped=True)
        finish(client, session["id"])

        restarted = restart(client, project["id"])
        assert restarted["round"] == 2
        assert restarted["ready_to_finish"] is False

        for _ in range(2):
            answer(client, session["id"], skipped=True)
        assert get_session(client, project["id"])["ready_to_finish"] is False
        answer(client, session["id"], skipped=True)
        assert get_session(client, project["id"])["ready_to_finish"] is True


def test_restart_is_idempotent(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "idempotent.db"))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    with TestClient(app) as client:
        project, session = create_project_and_session(client)
        for _ in range(3):
            answer(client, session["id"], content="足够收束的一段细节。")

        first_restart = restart(client, project["id"])
        second_restart = restart(client, project["id"])
        assert first_restart["id"] == second_restart["id"]
        assert first_restart["sequence"] == second_restart["sequence"] == 2
        assert len(first_restart["messages"]) == len(second_restart["messages"])  # 未重复开轮
        continuations = [m for m in second_restart["messages"] if m["content"] == CONTINUATION_QUESTION]
        assert len(continuations) == 1


def test_legacy_messages_table_migrates_in_place(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "legacy.db"
    monkeypatch.setattr(settings, "database_path", str(db_path))
    monkeypatch.setattr(settings, "media_directory", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "ai_runtime_mode", "demo")
    # 旧库 messages 表没有 round_no 列（6 列原型 schema）。
    connection = sqlite3.connect(str(db_path))
    connection.executescript(
        """
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
          content TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL
        );
        INSERT INTO messages VALUES ('m1', 's1', 'assistant', '开场问题', 1, '2026-08-01T00:00:00Z');
        """
    )
    connection.commit()
    connection.close()

    initialize_database()
    with connect() as connection:
        tables = {row["name"] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        assert "messages" in tables  # 未被 _retire_incompatible_tables 改名
        migrated = connection.execute("SELECT id, content, round_no FROM messages WHERE id = 'm1'").fetchone()
        assert migrated["id"] == "m1"
        assert migrated["content"] == "开场问题"
        assert migrated["round_no"] == 1  # 旧行回填默认轮次
