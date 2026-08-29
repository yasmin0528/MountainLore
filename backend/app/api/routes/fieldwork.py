import hashlib
import asyncio
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
from app.services.providers import ProviderError, provider
from app.services.workflow import retry_task

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
            """INSERT INTO projects (id, visitor_id, brand_name, industry, core_product, origin, category, consent_at, status, current_stage, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'fieldwork', ?, ?)""",
            (project_id, visitor["id"], payload.brand_name, payload.industry, payload.core_product, payload.origin,
             payload.category, timestamp, timestamp, timestamp),
        )
        project = row_dict(connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    return envelope(project)


@router.get("/projects")
def list_projects(visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    """Return the visitor's own projects for the archive project directory."""
    with connect() as connection:
        projects = [
            row_dict(row)
            for row in connection.execute(
                "SELECT * FROM projects WHERE visitor_id = ? ORDER BY updated_at DESC, created_at DESC",
                (visitor["id"],),
            )
        ]
    return envelope(projects)


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
            """INSERT INTO media_assets
               (id, project_id, storage_key, original_name, mime_type, size_bytes, created_at, kind, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', '{}')""",
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


def fieldwork_model_result(
    project: dict[str, Any], history: list[dict[str, Any]], user_text: str,
    answer_count: int, image_paths: list[str],
) -> tuple[dict[str, Any], str]:
    fallback = {
        "field_note": {
            "type": NOTE_TYPES[(answer_count - 1) % len(NOTE_TYPES)],
            "title": NOTE_TITLES[(answer_count - 1) % len(NOTE_TITLES)],
            "summary": user_text[:240] or "用户以图片补充了现场材料。",
        },
        "claims": [{
            "statement": user_text[:240] or "图片中呈现了与项目相关的现场信息，仍需用户确认。",
            "claim_type": "user_statement" if user_text else "image_description",
            "risk": "low" if user_text else "medium",
        }],
        "known_information": [],
        "next_question": FOLLOW_UPS[min(answer_count - 1, len(FOLLOW_UPS) - 1)],
        "done": answer_count >= 3,
    }
    if not provider.live:
        return fallback, "demo"
    try:
        result = provider.chat_json(
            model=settings.openai_next_text_model,
            instruction=(
                "整理本轮采风并决定最高信息增益的下一问。只输出JSON："
                "{field_note:{type,title,summary},claims:[{statement,claim_type,risk}],"
                "known_information:[...],next_question,done}。"
                "不得重复基础建档中的品牌名、品类、核心产品、产地；不得重复历史问题。"
                "最多进行四轮用户回答：answer_count>=3时可以done=true，answer_count>=4必须done=true。"
                "图片只可描述可见内容，不得由画面推断功效、产地或身份。"
            ),
            context={"project": project, "history": history, "latest_answer": user_text, "answer_count": answer_count},
            image_paths=image_paths,
        )
        note = result.get("field_note")
        claims = result.get("claims")
        if not isinstance(note, dict) or not str(note.get("summary", "")).strip() or not isinstance(claims, list):
            raise ProviderError("invalid_model_json", "采风模型返回结构不完整")
        result["done"] = bool(result.get("done")) or answer_count >= 4
        return result, "live"
    except ProviderError as exc:
        fallback["provider_error"] = {"code": exc.code, "message": str(exc)}
        return fallback, "fallback"


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
            history = [dict(row) for row in connection.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY sequence", (session_id,)
            )]
            assets = [dict(row) for row in connection.execute(
                f"SELECT * FROM media_assets WHERE id IN ({','.join('?' for _ in payload.media_asset_ids)})",
                payload.media_asset_ids,
            )] if payload.media_asset_ids else []
            image_paths = [str(Path(settings.media_directory) / asset["storage_key"]) for asset in assets]
            organized, mode = fieldwork_model_result(project, history, user_text, answer_count, image_paths)
            note = organized["field_note"]
            summary = str(note.get("summary") or user_text[:240])
            connection.execute(
                "INSERT INTO field_notes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (note_id, session_id, str(note.get("type") or NOTE_TYPES[(note_index - 1) % len(NOTE_TYPES)])[:32], str(note.get("title") or NOTE_TITLES[(note_index - 1) % len(NOTE_TITLES)])[:160],
                 summary, json_value(payload.media_asset_ids), note_index, now()),
            )
            source_ids: list[str] = []
            statement_source_id = new_id()
            connection.execute(
                """INSERT INTO source_records
                   (id, project_id, field_note_id, media_asset_id, source_type, source_ref, content, created_at)
                   VALUES (?, ?, ?, NULL, 'user_statement', ?, ?, ?)""",
                (statement_source_id, project["id"], note_id, f"message:{history[-1] if history else answer_count}", user_text, now()),
            )
            source_ids.append(statement_source_id)
            for asset in assets:
                source_id = new_id()
                connection.execute(
                    """INSERT INTO source_records
                       (id, project_id, field_note_id, media_asset_id, source_type, source_ref, content, created_at)
                       VALUES (?, ?, ?, ?, 'image_description', ?, ?, ?)""",
                    (source_id, project["id"], note_id, asset["id"], f"media:{asset['id']}", f"采风图片：{asset['original_name']}；模型仅据可见内容形成描述。", now()),
                )
                source_ids.append(source_id)
            claim_ids: list[str] = []
            for raw_claim in organized.get("claims", [])[:6]:
                if not isinstance(raw_claim, dict) or not str(raw_claim.get("statement", "")).strip():
                    continue
                claim_id = new_id()
                claim_ids.append(claim_id)
                risk = str(raw_claim.get("risk") or "medium")
                if risk not in {"low", "medium", "high", "unknown"}:
                    risk = "medium"
                connection.execute(
                    """INSERT INTO claims
                       (id, project_id, field_note_id, statement, claim_type, status, risk, public_allowed,
                        source_record_ids_json, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)""",
                    (claim_id, project["id"], note_id, str(raw_claim["statement"])[:1000], str(raw_claim.get("claim_type") or "user_statement")[:60], risk, json_value(source_ids), now(), now()),
                )
            add_message(connection, session_id, "system", f"已整理第 {note_index} 条采风笔记，并提取 {len(claim_ids)} 条待确认事实。")
        else:
            organized, mode = ({"done": answer_count >= 3, "next_question": FOLLOW_UPS[min(answer_count - 1, 2)]}, "skip")
        if not organized.get("done") and answer_count < 4:
            next_question = str(organized.get("next_question") or FOLLOW_UPS[min(answer_count - 1, 2)])
            previous_questions = {item["content"] for item in history if item["role"] == "assistant"} if not payload.skipped else set()
            if next_question in previous_questions:
                next_question = FOLLOW_UPS[min(answer_count - 1, 2)]
            add_message(connection, session_id, "assistant", next_question)
        else:
            add_message(connection, session_id, "assistant", "这一轮已经收集到几段可继续整理的材料。你可以结束本次采风，逐张确认候选档案。")
        task = {"id": new_id(), "project_id": project["id"], "kind": "follow_up", "status": "succeeded",
                "result_json": json_value({"mode": mode, "field_note_id": note_id}), "error_code": organized.get("provider_error", {}).get("code") if isinstance(organized.get("provider_error"), dict) else None,
                "idempotency_key": idempotency_key, "created_at": now(), "updated_at": now(),
                "input_snapshot_json": json_value({"answer_count": answer_count}), "progress": 100, "attempt": 1,
                "retriable": 0, "parent_task_id": None}
        connection.execute(
            """INSERT INTO tasks
               (id, project_id, kind, status, result_json, error_code, idempotency_key, created_at,
                updated_at, input_snapshot_json, progress, attempt, retriable, parent_task_id)
               VALUES (:id, :project_id, :kind, :status, :result_json, :error_code, :idempotency_key, :created_at,
                       :updated_at, :input_snapshot_json, :progress, :attempt, :retriable, :parent_task_id)""", task)
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
                archive_id = new_id()
                connection.execute(
                    "INSERT INTO archive_cards (id, project_id, candidate_id, type, title, content, status, created_at, updated_at, content_version, source_summary) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?)",
                    (archive_id, candidate["project_id"], candidate_id, candidate["type"], candidate["title"], candidate["content"], now(), now(), "采风问答与图片来源"),
                )
                note_ids = json.loads(candidate["field_note_ids_json"])
                if note_ids:
                    placeholders = ",".join("?" for _ in note_ids)
                    claims = connection.execute(
                        f"SELECT id, risk FROM claims WHERE field_note_id IN ({placeholders})", note_ids
                    ).fetchall()
                    for claim in claims:
                        connection.execute(
                            "INSERT OR IGNORE INTO archive_card_claims (archive_card_id, claim_id) VALUES (?, ?)",
                            (archive_id, claim["id"]),
                        )
                        connection.execute(
                            "UPDATE claims SET status = 'confirmed', public_allowed = ?, updated_at = ? WHERE id = ?",
                            (0 if claim["risk"] == "high" else 1, now(), claim["id"]),
                        )
            elif status == "discarded":
                note_ids = json.loads(candidate["field_note_ids_json"])
                if note_ids:
                    placeholders = ",".join("?" for _ in note_ids)
                    connection.execute(
                        f"UPDATE claims SET status = 'rejected', public_allowed = 0, updated_at = ? WHERE field_note_id IN ({placeholders})",
                        [now(), *note_ids],
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
        last = ""
        for _ in range(120):
            with connect() as connection:
                current = row_dict(connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
            payload = json.dumps(decode_record(current), ensure_ascii=False)
            if payload != last:
                yield f"event: progress\ndata: {payload}\n\n"
                last = payload
            if current["status"] in {"succeeded", "partial", "failed"}:
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/tasks/{task_id}")
def get_task(task_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        task = row_dict(connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
    if not task:
        fail(404, "找不到任务", "task_not_found")
    project_for_visitor(task["project_id"], visitor)
    return envelope(decode_record(task))


@router.post("/tasks/{task_id}/retry")
def retry_workflow_task(task_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        task = row_dict(connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
    if not task:
        fail(404, "找不到任务", "task_not_found")
    project_for_visitor(task["project_id"], visitor)
    retried = retry_task(task_id)
    if not retried:
        fail(409, "该任务当前不能重试", "task_not_retriable")
    return envelope(retried)
