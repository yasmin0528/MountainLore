import hashlib
import json
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.fieldwork.store import connect, decode_record, initialize_database, json_value, new_id, now, row_dict, visitor_expiry

router = APIRouter()


class ProjectCreate(BaseModel):
    brand_name: str = Field(min_length=1, max_length=100)
    industry: str = Field(min_length=1, max_length=100)
    core_product: str = Field(min_length=1, max_length=100)
    origin: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=60)
    consent: bool

    @field_validator("brand_name", "industry", "core_product", "origin")
    @classmethod
    def strip_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("此项不能为空")
        return value


class MessageCreate(BaseModel):
    content: str = Field(default="", max_length=2000)
    skipped: bool = False
    media_asset_ids: list[str] = Field(default_factory=list, max_length=5)


class SessionCreate(BaseModel):
    project_id: str


def envelope(data: Any) -> dict[str, Any]:
    return {"data": data, "request_id": new_id()}


def fail(status: int, message: str, code: str = "invalid_request", field: str | None = None) -> None:
    detail: dict[str, str] = {"code": code, "message": message}
    if field:
        detail["field"] = field
    raise HTTPException(status_code=status, detail=detail)


@router.on_event("startup")
def setup_storage() -> None:
    initialize_database()


@router.post("/visitors")
def create_or_restore_visitor(
    response: Response,
    visitor_token: Annotated[str | None, Cookie()] = None,
) -> dict[str, Any]:
    initialize_database()
    if visitor_token:
        token_hash = hashlib.sha256(visitor_token.encode()).hexdigest()
        with connect() as connection:
            visitor = row_dict(connection.execute(
                "SELECT * FROM visitors WHERE token_hash = ? AND expires_at > ?", (token_hash, now())
            ).fetchone())
        if visitor:
            return envelope({"id": visitor["id"], "expires_at": visitor["expires_at"], "restored": True})

    token = secrets.token_urlsafe(32)
    visitor_id = new_id()
    expires_at = visitor_expiry()
    with connect() as connection:
        connection.execute(
            "INSERT INTO visitors (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (visitor_id, hashlib.sha256(token.encode()).hexdigest(), expires_at, now()),
        )
    response.set_cookie(
        key=settings.visitor_cookie_name, value=token, httponly=True, samesite="lax",
        max_age=settings.visitor_ttl_days * 24 * 60 * 60,
    )
    return envelope({"id": visitor_id, "expires_at": expires_at, "restored": False})


def current_visitor(visitor_token: Annotated[str | None, Cookie()] = None) -> dict[str, Any]:
    if not visitor_token:
        fail(401, "请先建立临时项目", "visitor_required")
    token_hash = hashlib.sha256(visitor_token.encode()).hexdigest()
    with connect() as connection:
        visitor = row_dict(connection.execute(
            "SELECT * FROM visitors WHERE token_hash = ? AND expires_at > ?", (token_hash, now())
        ).fetchone())
    if not visitor:
        fail(401, "访客会话已过期，请重新开始", "visitor_expired")
    return visitor


def project_for_visitor(project_id: str, visitor: dict[str, Any]) -> dict[str, Any]:
    with connect() as connection:
        project = row_dict(connection.execute(
            "SELECT * FROM projects WHERE id = ? AND visitor_id = ?", (project_id, visitor["id"])
        ).fetchone())
    if not project:
        fail(404, "找不到该品牌项目", "project_not_found")
    return project


def session_payload(session: dict[str, Any]) -> dict[str, Any]:
    with connect() as connection:
        messages = [dict(row) for row in connection.execute(
            "SELECT id, role, content, sequence, created_at FROM messages WHERE session_id = ? ORDER BY sequence", (session["id"],)
        )]
        notes = [decode_record(dict(row)) for row in connection.execute(
            "SELECT * FROM field_notes WHERE session_id = ? ORDER BY sequence", (session["id"],)
        )]
    return {**session, "messages": messages, "field_notes": notes}


@router.post("/projects")
def create_project(payload: ProjectCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    if not payload.consent:
        fail(422, "请先同意隐私与素材使用说明", "consent_required", "consent")
    with connect() as connection:
        project_id = new_id()
        timestamp = now()
        connection.execute(
            """INSERT INTO projects (id, visitor_id, brand_name, industry, core_product, origin, category, consent_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)""",
            (project_id, visitor["id"], payload.brand_name, payload.industry, payload.core_product, payload.origin,
             payload.category, timestamp, timestamp, timestamp),
        )
        project = row_dict(connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    return envelope(project)


@router.get("/projects/{project_id}")
def get_project(project_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project = project_for_visitor(project_id, visitor)
    with connect() as connection:
        session = row_dict(connection.execute("SELECT * FROM sessions WHERE project_id = ?", (project_id,)).fetchone())
    return envelope({**project, "session": session_payload(session) if session else None})


@router.post("/media")
async def upload_media(
    request: Request,
    project_id: Annotated[str, Header(alias="X-Project-ID")],
    original_name: Annotated[str, Header(alias="X-File-Name")],
    visitor: Annotated[dict[str, Any], Depends(current_visitor)],
) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        fail(422, "仅支持上传图片文件", "invalid_media", "file")
    content = await request.body()
    if len(content) > settings.max_upload_bytes:
        fail(422, "图片文件超过大小限制", "media_too_large", "file")
    with connect() as connection:
        count = connection.execute("SELECT COUNT(*) FROM media_assets WHERE project_id = ?", (project_id,)).fetchone()[0]
        if count >= 5:
            fail(422, "每次采风最多上传 5 张图片", "media_limit", "file")
        asset_id = new_id()
        suffix = Path(original_name or "upload.jpg").suffix.lower() or ".jpg"
        relative_key = f"{project_id}/{asset_id}{suffix}"
        target = Path(settings.media_directory) / relative_key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        connection.execute(
            "INSERT INTO media_assets VALUES (?, ?, ?, ?, ?, ?, ?)",
            (asset_id, project_id, relative_key, original_name or "image", content_type, len(content), now()),
        )
    return envelope({"id": asset_id, "original_name": original_name or "image", "mime_type": content_type, "size_bytes": len(content)})


OPENING_QUESTION = "从这份品牌的来处讲起：最初是谁、因为什么开始做这件事？"
FOLLOW_UPS = [
    "你提到的这件事里，有没有一个具体的人或场景，是你希望被记下来的？",
    "产品从采收或原料到成品，哪一个环节最能说明你们是怎么做的？",
    "这片产地或当地生活里，有没有一个真实细节，让你觉得它和别处不一样？",
]
NOTE_TYPES = ["BRAND", "PEOPLE", "PROCESS"]
NOTE_TITLES = ["品牌的来处", "被提到的人与现场", "产品与工艺细节"]


def add_message(connection: Any, session_id: str, role: str, content: str) -> dict[str, Any]:
    sequence = connection.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (session_id,)).fetchone()[0] + 1
    message = {"id": new_id(), "session_id": session_id, "role": role, "content": content, "sequence": sequence, "created_at": now()}
    connection.execute("INSERT INTO messages VALUES (:id, :session_id, :role, :content, :sequence, :created_at)", message)
    return message


@router.post("/sessions")
def create_session(payload: SessionCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_id = payload.project_id
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        if connection.execute("SELECT id FROM sessions WHERE project_id = ?", (project_id,)).fetchone():
            fail(409, "每个品牌只能进行一次采风", "session_exists")
        session = {"id": new_id(), "project_id": project_id, "sequence": 1, "status": "active", "started_at": now(), "ended_at": None}
        connection.execute("INSERT INTO sessions VALUES (:id, :project_id, :sequence, :status, :started_at, :ended_at)", session)
        add_message(connection, session["id"], "assistant", OPENING_QUESTION)
        connection.execute("UPDATE projects SET status = 'active', updated_at = ? WHERE id = ?", (now(), project_id))
    return envelope(session_payload(session))


def session_for_visitor(session_id: str, visitor: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    with connect() as connection:
        session = row_dict(connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone())
    if not session:
        fail(404, "找不到采风记录", "session_not_found")
    project = project_for_visitor(session["project_id"], visitor)
    return session, project


@router.post("/sessions/{session_id}/messages")
def create_message(
    session_id: str,
    payload: MessageCreate,
    visitor: Annotated[dict[str, Any], Depends(current_visitor)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    session, project = session_for_visitor(session_id, visitor)
    if session["status"] != "active":
        fail(409, "本次采风已经结束", "session_closed")
    if not payload.skipped and not payload.content.strip() and not payload.media_asset_ids:
        fail(422, "请填写回答、上传图片或跳过本题", "empty_message", "content")
    with connect() as connection:
        if idempotency_key:
            task = row_dict(connection.execute("SELECT * FROM tasks WHERE idempotency_key = ?", (idempotency_key,)).fetchone())
            if task:
                return envelope({"task": decode_record(task), "session": session_payload(session)})
        if payload.media_asset_ids:
            placeholders = ",".join("?" for _ in payload.media_asset_ids)
            valid_count = connection.execute(
                f"SELECT COUNT(*) FROM media_assets WHERE project_id = ? AND id IN ({placeholders})", [project["id"], *payload.media_asset_ids]
            ).fetchone()[0]
            if valid_count != len(payload.media_asset_ids):
                fail(422, "图片不属于当前项目", "invalid_media", "media_asset_ids")
        user_text = "已跳过此题" if payload.skipped else payload.content.strip()
        add_message(connection, session_id, "user", user_text)
        answer_count = connection.execute("SELECT COUNT(*) FROM messages WHERE session_id = ? AND role = 'user'", (session_id,)).fetchone()[0]
        note_id: str | None = None
        if not payload.skipped:
            note_index = connection.execute("SELECT COUNT(*) FROM field_notes WHERE session_id = ?", (session_id,)).fetchone()[0] + 1
            note_id = new_id()
            summary = f"AI 摘要（演示整理）：{user_text[:120]}"
            connection.execute(
                "INSERT INTO field_notes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (note_id, session_id, NOTE_TYPES[(note_index - 1) % len(NOTE_TYPES)], NOTE_TITLES[(note_index - 1) % len(NOTE_TITLES)],
                 summary, json_value(payload.media_asset_ids), note_index, now()),
            )
            add_message(connection, session_id, "system", f"已整理第 {note_index} 条采风笔记（演示整理）。")
        if answer_count < 3:
            add_message(connection, session_id, "assistant", FOLLOW_UPS[answer_count - 1])
        else:
            add_message(connection, session_id, "assistant", "这一轮已经收集到几段可继续整理的材料。你可以结束本次采风，逐张确认候选档案。")
        task = {"id": new_id(), "project_id": project["id"], "kind": "follow_up", "status": "succeeded",
                "result_json": json_value({"mode": "demo", "field_note_id": note_id}), "error_code": None,
                "idempotency_key": idempotency_key, "created_at": now(), "updated_at": now()}
        connection.execute("INSERT INTO tasks VALUES (:id, :project_id, :kind, :status, :result_json, :error_code, :idempotency_key, :created_at, :updated_at)", task)
    return envelope({"task": decode_record(task), "session": session_payload(session)})


@router.post("/sessions/{session_id}/finish")
def finish_session(
    session_id: str,
    visitor: Annotated[dict[str, Any], Depends(current_visitor)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    session, project = session_for_visitor(session_id, visitor)
    with connect() as connection:
        if session["status"] == "completed":
            candidates = [decode_record(dict(row)) for row in connection.execute("SELECT * FROM candidates WHERE project_id = ?", (project["id"],))]
            return envelope({"session": session, "candidates": candidates})
        notes = [decode_record(dict(row)) for row in connection.execute("SELECT * FROM field_notes WHERE session_id = ? ORDER BY sequence", (session_id,))]
        if not notes:
            fail(422, "至少记录一段有效材料后才能结束采风", "notes_required")
        for note in notes:
            connection.execute(
                "INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
                (new_id(), project["id"], json_value([note["id"]]), note["type"], note["title"], note["summary"], now()),
            )
        ended = now()
        connection.execute("UPDATE sessions SET status = 'completed', ended_at = ? WHERE id = ?", (ended, session_id))
        connection.execute("UPDATE projects SET status = 'fieldwork_completed', updated_at = ? WHERE id = ?", (ended, project["id"]))
        candidates = [decode_record(dict(row)) for row in connection.execute("SELECT * FROM candidates WHERE project_id = ?", (project["id"],))]
    return envelope({"session": {**session, "status": "completed", "ended_at": ended}, "candidates": candidates})


@router.get("/projects/{project_id}/candidates")
def get_candidates(project_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        candidates = [decode_record(dict(row)) for row in connection.execute("SELECT * FROM candidates WHERE project_id = ? ORDER BY created_at", (project_id,))]
    return envelope(candidates)


def update_candidate(candidate_id: str, action: str, visitor: dict[str, Any]) -> dict[str, Any]:
    with connect() as connection:
        candidate = row_dict(connection.execute("SELECT * FROM candidates WHERE id = ?", (candidate_id,)).fetchone())
        if not candidate:
            fail(404, "找不到候选档案", "candidate_not_found")
        project_for_visitor(candidate["project_id"], visitor)
        if candidate["status"] == "pending":
            status = "confirmed" if action == "confirm" else "discarded"
            connection.execute("UPDATE candidates SET status = ? WHERE id = ?", (status, candidate_id))
            candidate["status"] = status
            if status == "confirmed":
                connection.execute(
                    "INSERT INTO archive_cards VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
                    (new_id(), candidate["project_id"], candidate_id, candidate["type"], candidate["title"], candidate["content"], now()),
                )
        archive = row_dict(connection.execute("SELECT * FROM archive_cards WHERE candidate_id = ?", (candidate_id,)).fetchone())
    return {"candidate": decode_record(candidate), "archive_card": archive}


@router.post("/candidates/{candidate_id}/confirm")
def confirm_candidate(candidate_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    return envelope(update_candidate(candidate_id, "confirm", visitor))


@router.post("/candidates/{candidate_id}/discard")
def discard_candidate(candidate_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    return envelope(update_candidate(candidate_id, "discard", visitor))


@router.get("/tasks/{task_id}/events")
async def task_events(task_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> StreamingResponse:
    with connect() as connection:
        task = row_dict(connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
    if not task:
        fail(404, "找不到任务", "task_not_found")
    project_for_visitor(task["project_id"], visitor)

    async def events() -> AsyncIterator[str]:
        payload = json.dumps(decode_record(task), ensure_ascii=False)
        yield f"event: {task['status']}\ndata: {payload}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
