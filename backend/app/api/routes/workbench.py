from __future__ import annotations

import json
import logging
import secrets
from binascii import Error as Base64Error
from pathlib import Path
from typing import Any, Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.routes.fieldwork import current_visitor, envelope, fail, project_for_visitor, session_payload
from app.core.config import settings
from app.fieldwork.store import connect, decode_record, json_value, new_id, now, row_dict
from app.services.providers import ProviderError, provider
from app.services.tide_report import (
    latest_report_for_project,
    refresh_personal_tide_report,
    reserve_personal_tide_refresh,
    shared_idea_for_project,
)
from app.services.workflow import create_manual_skeleton, create_task, execute_task, hash_share_token, project_snapshot, submit_task

router = APIRouter()
logger = logging.getLogger(__name__)


class CardPatch(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=6000)
    expected_content_version: int


class DirectionCreate(BaseModel):
    request_id: str | None = None
    defer_directions: bool = False
    visual_preferences: dict[str, Any] = Field(default_factory=dict)


class ManualPatch(BaseModel):
    content_json: dict[str, Any]


class ExportCreate(BaseModel):
    formats: list[str] = Field(default_factory=lambda: ["pdf", "zip"])


class ManualAssetAttach(BaseModel):
    media_asset_id: str


class ShareCreate(BaseModel):
    label: str | None = Field(default=None, max_length=120)


class TideCreate(BaseModel):
    request_id: str | None = None


class GenerationCreate(BaseModel):
    template_type: str
    inspiration_card_id: str | None = None
    request_id: str | None = None


class GenerationPreviewCreate(BaseModel):
    template_type: str
    inspiration_text: str = Field(min_length=1, max_length=1200)
    inspiration_card_id: str | None = None
    material_ids: list[str] = Field(default_factory=list, max_length=4)


MATERIAL_PROMPT_SEGMENTS: dict[str, str] = {
    "sticker": "品牌贴纸：以多规格异形贴纸组成一套可单独使用的贴纸系列，突出轮廓、留白和成组关系。",
    "gift-box": "礼盒包装：展示开合式礼盒的正面、材质和局部结构，作为赠礼场景中的主物件。",
    "can": "罐装包装：展示罐体比例、环绕标签位置和陈列节奏，保留可用于后续落版的干净画面。",
    "expo-banner": "展会易拉宝：展示竖向现场立牌的整体版式、远观层级与产品陈列关系。",
}


def normalized_material_ids(template_type: str, material_ids: list[str]) -> list[str]:
    """Validate client selections before any model or image provider is invoked."""
    selections = list(dict.fromkeys(material_ids))
    unknown = [material_id for material_id in selections if material_id not in MATERIAL_PROMPT_SEGMENTS]
    if unknown:
        fail(422, "包含不支持的实体物料类型", "invalid_material_type")
    if template_type == "peripheral" and not selections:
        fail(422, "实体物料设计至少选择一种物料", "material_required")
    if template_type == "xiaohongshu" and selections:
        fail(422, "线上图文生成不接受实体物料选择", "materials_not_supported")
    return selections


def records(connection: Any, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    return [decode_record(dict(row)) for row in connection.execute(sql, params)]


def active_cards(connection: Any, project_id: str) -> list[dict[str, Any]]:
    return records(connection, "SELECT * FROM archive_cards WHERE project_id = ? AND status = 'active' ORDER BY created_at", (project_id,))


def project_context(connection: Any, project_id: str) -> dict[str, Any]:
    project = row_dict(connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    cards = active_cards(connection, project_id)
    return {"project": project, "archive_cards": cards}


def directions_for_project(connection: Any, project_id: str) -> list[dict[str, Any]]:
    directions = records(connection, "SELECT * FROM brand_directions WHERE project_id = ? ORDER BY version DESC, route_no", (project_id,))
    # ``decode_record`` turns ``content_json`` into ``content`` for generic
    # records.  The workspace contract deliberately exposes the original
    # field name so frontend route cards and the brand-manual dialog share one
    # predictable shape.
    for direction in directions:
        direction["content_json"] = direction.pop("content", {})
    return directions


def require_current_direction(connection: Any, project_id: str) -> dict[str, Any]:
    project = row_dict(connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    current = row_dict(connection.execute("SELECT * FROM brand_directions WHERE id = ?", (project.get("current_direction_id"),)).fetchone())
    if not current:
        fail(422, "请先选择一条品牌路线", "direction_required")
    return current


def direction_content(card_context: dict[str, Any], route_no: int) -> dict[str, Any]:
    project = card_context["project"]
    cards = card_context["archive_cards"]
    details = "；".join(card["title"] for card in cards[:3]) or "待进一步补充的真实材料"
    if route_no == 1:
        return {"title": "山野日常的轻养路线", "target_audience": "城市通勤与轻户外人群", "target_scenarios": "晨间、办公室与短途出游", "brand_one_liner": f"把{project['origin']}的{project['core_product']}带进当代日常。", "selling_points": ["可追溯产地故事", "真实工艺与人物", "轻量日常表达"], "story_spine": details, "content_tone": "克制、明亮、口语化", "visual_keywords": ["靛蓝", "暖纸", "果实贴纸"], "forbidden_expressions": ["治疗", "包治", "唯一正宗"]}
    if route_no == 2:
        return {"title": "地方风物的礼赠路线", "target_audience": "节日送礼与文化旅行者", "target_scenarios": "探访礼物、节庆与品牌联名", "brand_one_liner": f"以{project['core_product']}为引，寄出{project['origin']}的一段风物。", "selling_points": ["地方记忆可回溯", "手工档案感", "适合礼赠叙事"], "story_spine": details, "content_tone": "沉静、有人情味、少承诺", "visual_keywords": ["山地档案", "苔藓", "明黄标记"], "forbidden_expressions": ["祖传秘方", "绝对功效", "未经证实的非遗"]}
    return {"title": "工艺透明的安心路线", "target_audience": "关注配料与制作过程的理性消费者", "target_scenarios": "日常选购、送礼比较与产品说明", "brand_one_liner": f"把{project['core_product']}从{project['origin']}到成品的真实过程讲清楚。", "selling_points": ["真实材料可回看", "工艺过程不夸大", "表达边界清楚"], "story_spine": details, "content_tone": "清楚、克制、可信", "visual_keywords": ["米色纸张", "工艺标签", "苔藓绿"], "forbidden_expressions": ["全网最好", "零添加承诺", "未经证实的功效"]}


@router.get("/provider/readiness")
def provider_readiness() -> dict[str, Any]:
    return envelope(provider.readiness())


@router.post("/provider/verify")
def verify_provider() -> dict[str, Any]:
    try:
        return envelope({**provider.readiness(), "available_models": provider.available_models()})
    except ProviderError as exc:
        fail(503, str(exc), exc.code)


@router.get("/projects/{project_id}/workspace")
def get_workspace(project_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        project = row_dict(connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
        session = row_dict(connection.execute("SELECT * FROM sessions WHERE project_id = ?", (project_id,)).fetchone())
        cards = records(connection, "SELECT * FROM archive_cards WHERE project_id = ? ORDER BY created_at", (project_id,))
        directions = directions_for_project(connection, project_id)
        manual = row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone())
        if manual:
            manual = decode_record(manual)
        claims = records(connection, "SELECT * FROM claims WHERE project_id = ? ORDER BY created_at", (project_id,))
        tasks = records(connection, "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
        manual_versions = records(connection, "SELECT * FROM manual_versions WHERE project_id = ? ORDER BY version DESC", (project_id,))
        manual_assets = records(
            connection,
            """SELECT manual_assets.*, media_assets.original_name, media_assets.mime_type
               FROM manual_assets LEFT JOIN media_assets ON media_assets.id = manual_assets.media_asset_id
               JOIN brand_manuals ON brand_manuals.project_id = manual_assets.project_id
                 AND brand_manuals.current_version_id = manual_assets.manual_version_id
               WHERE manual_assets.project_id = ? ORDER BY manual_assets.created_at""",
            (project_id,),
        )
        for asset in manual_assets:
            asset["url"] = f"/api/media/{asset['media_asset_id']}" if asset.get("media_asset_id") else None
        exports = records(connection, "SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
        for item in exports:
            item["download_url"] = f"/api/exports/{item['id']}/download" if item.get("status") == "succeeded" else None
        shares = records(connection, "SELECT id, project_id, manual_version_id, revoked_at, created_at FROM share_snapshots WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
        tides = records(connection, "SELECT * FROM tide_searches WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
        for tide in tides:
            tide["cards"] = records(connection, "SELECT * FROM inspiration_cards WHERE tide_search_id = ?", (tide["id"],))
        jobs = records(connection, "SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
    return envelope({"project": project, "session": session_payload(session) if session else None, "archive_cards": cards, "claims": claims, "directions": directions, "tasks": tasks, "manual": manual, "manual_versions": manual_versions, "manual_assets": manual_assets, "exports": exports, "shares": shares, "tide_searches": tides, "generation_jobs": jobs})


@router.get("/projects/{project_id}/brand-manual")
def get_brand_manual(project_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        manual = row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone())
        if not manual:
            fail(404, "品牌手册尚未生成", "manual_not_found")
        result = decode_record(manual)
        result["versions"] = records(connection, "SELECT * FROM manual_versions WHERE project_id = ? ORDER BY version DESC", (project_id,))
        result["assets"] = records(connection, "SELECT * FROM manual_assets WHERE project_id = ? ORDER BY created_at", (project_id,))
    return envelope(result)


@router.patch("/projects/{project_id}/brand-manual")
def patch_brand_manual(project_id: str, payload: ManualPatch, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project = project_for_visitor(project_id, visitor)
    with connect() as connection:
        current_direction_id = project.get("current_direction_id")
        if not current_direction_id:
            fail(422, "请先选择一条品牌路线", "direction_required")
        content = dict(payload.content_json)
        # The project name is an identity field, not a free-text manual field.
        content["brand_name"] = project["brand_name"]
        existing = row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone())
        if existing:
            connection.execute(
                "UPDATE brand_manuals SET direction_id = ?, content_json = ?, updated_at = ? WHERE project_id = ?",
                (current_direction_id, json_value(content), now(), project_id),
            )
        else:
            connection.execute(
                """INSERT INTO brand_manuals
                   (id, project_id, direction_id, content_json, updated_at, current_version_id, generated_snapshot_json)
                   VALUES (?, ?, ?, ?, ?, NULL, '{}')""",
                (new_id(), project_id, current_direction_id, json_value(content), now()),
            )
        version = connection.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM manual_versions WHERE project_id = ?", (project_id,)).fetchone()[0]
        version_id = new_id()
        generated = existing.get("generated_snapshot_json") if existing else "{}"
        connection.execute(
            """INSERT INTO manual_versions
               (id, project_id, direction_id, version, generated_snapshot_json, content_json, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'user_saved', ?, ?)""",
            (version_id, project_id, current_direction_id, version, generated or "{}", json_value(content), now(), now()),
        )
        connection.execute("UPDATE brand_manuals SET current_version_id = ? WHERE project_id = ?", (version_id, project_id))
        manual = decode_record(row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone()))
    return envelope(manual)


@router.patch("/archive-cards/{card_id}")
def patch_archive_card(card_id: str, payload: CardPatch, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        card = row_dict(connection.execute("SELECT * FROM archive_cards WHERE id = ?", (card_id,)).fetchone())
        if not card:
            fail(404, "找不到档案卡", "archive_not_found")
        project_for_visitor(card["project_id"], visitor)
        version = card.get("content_version") or 1
        if version != payload.expected_content_version:
            fail(409, "档案已被其他修改更新，请刷新后再试", "content_conflict")
        updated = now()
        connection.execute("UPDATE archive_cards SET title = ?, content = ?, content_version = ?, updated_at = ? WHERE id = ?", (payload.title, payload.content, version + 1, updated, card_id))
        result = row_dict(connection.execute("SELECT * FROM archive_cards WHERE id = ?", (card_id,)).fetchone())
    return envelope(result)


@router.delete("/archive-cards/{card_id}")
def delete_archive_card(card_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        card = row_dict(connection.execute("SELECT * FROM archive_cards WHERE id = ?", (card_id,)).fetchone())
        if not card:
            fail(404, "找不到档案卡", "archive_not_found")
        project_for_visitor(card["project_id"], visitor)
        connection.execute("DELETE FROM archive_card_claims WHERE archive_card_id = ?", (card_id,))
        connection.execute("DELETE FROM archive_cards WHERE id = ?", (card_id,))
    return envelope({"id": card_id, "status": "deleted"})


@router.post("/archive-cards/{card_id}/discard")
def discard_archive_card(card_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        card = row_dict(connection.execute("SELECT * FROM archive_cards WHERE id = ?", (card_id,)).fetchone())
        if not card:
            fail(404, "找不到档案卡", "archive_not_found")
        project_for_visitor(card["project_id"], visitor)
        connection.execute("UPDATE archive_cards SET status = 'discarded', updated_at = ? WHERE id = ?", (now(), card_id))
        result = row_dict(connection.execute("SELECT * FROM archive_cards WHERE id = ?", (card_id,)).fetchone())
    return envelope(result)


@router.post("/projects/{project_id}/directions")
def create_directions(project_id: str, payload: DirectionCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)], idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        snapshot = project_snapshot(connection, project_id)
        if not snapshot["archive_cards"]:
            fail(422, "请先确认至少一张档案卡", "archive_required")
        preferences = dict(payload.visual_preferences)
        logo_media_id = preferences.get("logo_media_asset_id")
        if logo_media_id:
            media = row_dict(connection.execute("SELECT id FROM media_assets WHERE id = ? AND project_id = ?", (logo_media_id, project_id)).fetchone())
            if not media:
                fail(422, "Logo 图片不属于当前项目", "invalid_media")
        snapshot["visual_preferences"] = preferences
    key = idempotency_key or (f"directions:{project_id}:{payload.request_id}" if payload.request_id else None)
    task, created = create_task(project_id, "route_generation", snapshot, key)
    if created:
        task = execute_task(task["id"]) if not provider.live else task
        if provider.live:
            submit_task(task["id"])
    return envelope({"task": task, "routes": task.get("result", {}).get("routes", []), "version": task.get("result", {}).get("version")})


@router.post("/projects/{project_id}/chronicle/confirm")
def confirm_chronicle(project_id: str, payload: DirectionCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)], idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        pending = connection.execute("SELECT COUNT(*) FROM candidates WHERE project_id = ? AND status = 'pending'", (project_id,)).fetchone()[0]
        if pending:
            fail(409, "请先逐张确认或弃用候选档案", "candidates_pending")
        snapshot = project_snapshot(connection, project_id)
        if not snapshot["archive_cards"]:
            fail(422, "请先确认至少一张档案卡", "archive_required")
        if payload.defer_directions:
            connection.execute(
                "UPDATE projects SET current_stage = 'archive', status = 'archive_ready', updated_at = ? WHERE id = ?",
                (now(), project_id),
            )
            return envelope({"task": None, "routes": [], "deferred": True})
    key = idempotency_key or f"chronicle:{project_id}:{payload.request_id or 'confirm'}"
    task, created = create_task(project_id, "route_generation", snapshot, key)
    if created:
        with connect() as connection:
            connection.execute("UPDATE projects SET current_stage = 'chronicle', status = 'generating_directions', updated_at = ? WHERE id = ?", (now(), project_id))
        if provider.live:
            submit_task(task["id"])
        else:
            task = execute_task(task["id"])
    return envelope({"task": task, "routes": task.get("result", {}).get("routes", [])})


@router.post("/directions/{direction_id}/select")
def select_direction(direction_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)], idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, Any]:
    with connect() as connection:
        direction = row_dict(connection.execute("SELECT * FROM brand_directions WHERE id = ?", (direction_id,)).fetchone())
        if not direction:
            fail(404, "找不到品牌路线", "direction_not_found")
        project_for_visitor(direction["project_id"], visitor)
        connection.execute("UPDATE brand_directions SET state = CASE WHEN id = ? THEN 'current' WHEN state = 'current' THEN 'superseded' ELSE state END WHERE project_id = ?", (direction_id, direction["project_id"]))
        connection.execute("UPDATE projects SET current_direction_id = ?, current_stage = 'positioning', status = 'manual_ready', updated_at = ? WHERE id = ?", (direction_id, now(), direction["project_id"]))
        selected = decode_record(row_dict(connection.execute("SELECT * FROM brand_directions WHERE id = ?", (direction_id,)).fetchone()))
        snapshot = project_snapshot(connection, direction["project_id"])
        snapshot["direction"] = {**selected, "content": selected.get("content", {})}
    manual = create_manual_skeleton(direction["project_id"], snapshot)
    preferences = selected.get("content", {}).get("visual_preferences") or {}
    logo_task = None
    if not preferences.get("logo_media_asset_id") and provider.live:
        logo_snapshot = {**snapshot, "manual_version_id": manual["manual_version_id"], "asset_kind": "logo_mark"}
        # Keep this separate from the legacy manual task idempotency key so an
        # older in-flight manual task cannot suppress the new Logo-only task.
        key = f"logo:{direction_id}:{manual['manual_version_id']}"
        logo_task, created = create_task(direction["project_id"], "logo_generation", logo_snapshot, key)
        if created:
            submit_task(logo_task["id"])
    return envelope({**selected, "direction": selected, "manual": manual, "task": logo_task})


@router.post("/projects/{project_id}/brand-manual/generate-assets/{kind}")
def generate_manual_asset(project_id: str, kind: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)], idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    if kind not in {"extension_pattern", "packaging_key_visual"}:
        fail(422, "仅支持按需生成延展纹样或包装主视觉", "invalid_asset_kind")
    if not provider.live:
        fail(409, "演示模式不生成图片资产", "image_provider_not_configured")
    with connect() as connection:
        manual = row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone())
        current = require_current_direction(connection, project_id)
        if not manual or not manual.get("current_version_id"):
            fail(422, "请先选择一条路线生成品牌手册", "manual_required")
        snapshot = project_snapshot(connection, project_id)
        selected = decode_record(current)
        snapshot["direction"] = {**selected, "content": selected.get("content", {})}
        snapshot["manual_version_id"] = manual["current_version_id"]
        snapshot["asset_kind"] = kind
    task, created = create_task(project_id, "manual_asset_generation", snapshot, idempotency_key or f"asset:{kind}:{snapshot['manual_version_id']}")
    if created:
        submit_task(task["id"])
    return envelope({"task": task})


@router.post("/projects/{project_id}/brand-manual/assets/{kind}")
def attach_manual_asset(project_id: str, kind: str, payload: ManualAssetAttach, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    if kind not in {"logo_mark", "packaging_key_visual", "extension_pattern"}:
        fail(422, "不支持的视觉资产类型", "invalid_asset_kind")
    with connect() as connection:
        manual = row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone())
        if not manual or not manual.get("current_version_id"):
            fail(422, "请先生成品牌手册", "manual_required")
        media = row_dict(connection.execute("SELECT * FROM media_assets WHERE id = ? AND project_id = ?", (payload.media_asset_id, project_id)).fetchone())
        if not media:
            fail(422, "图片不属于当前项目", "invalid_media")
        asset_id = new_id()
        connection.execute(
            """INSERT INTO manual_assets
               (id, project_id, manual_version_id, kind, media_asset_id, metadata_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (asset_id, project_id, manual["current_version_id"], kind, media["id"], json_value({"source": "user_upload"}), now()),
        )
        asset = decode_record(row_dict(connection.execute("SELECT * FROM manual_assets WHERE id = ?", (asset_id,)).fetchone()))
        asset["url"] = f"/api/media/{media['id']}"
    return envelope(asset)


@router.get("/media/{asset_id}")
def get_media(asset_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> FileResponse:
    with connect() as connection:
        asset = row_dict(connection.execute("SELECT * FROM media_assets WHERE id = ?", (asset_id,)).fetchone())
    if not asset:
        fail(404, "找不到图片资产", "media_not_found")
    project_for_visitor(asset["project_id"], visitor)
    path = (Path(settings.media_directory) / asset["storage_key"]).resolve()
    media_root = Path(settings.media_directory).resolve()
    if media_root not in path.parents or not path.is_file():
        fail(404, "图片文件不存在", "media_file_missing")
    return FileResponse(path, media_type=asset["mime_type"], filename=asset["original_name"])


@router.post("/projects/{project_id}/brand-manual/exports")
def create_manual_exports(project_id: str, payload: ExportCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)], idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    formats = list(dict.fromkeys(payload.formats))
    if not formats or any(item not in {"pdf", "zip"} for item in formats):
        fail(422, "仅支持 PDF 与 ZIP 导出", "invalid_export_format")
    with connect() as connection:
        manual = row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone())
    if not manual or not manual.get("current_version_id"):
        fail(422, "请先生成并保存品牌手册", "manual_required")
    snapshot = {"manual_version_id": manual["current_version_id"], "formats": formats}
    task, created = create_task(project_id, "export", snapshot, idempotency_key)
    if created:
        submit_task(task["id"])
    return envelope({"task": task})


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> FileResponse:
    with connect() as connection:
        item = row_dict(connection.execute("SELECT * FROM exports WHERE id = ?", (export_id,)).fetchone())
    if not item or item["status"] != "succeeded" or not item.get("storage_key"):
        fail(404, "导出文件尚不可用", "export_not_ready")
    project_for_visitor(item["project_id"], visitor)
    path = (Path(settings.media_directory) / item["storage_key"]).resolve()
    media_root = Path(settings.media_directory).resolve()
    if media_root not in path.parents or not path.is_file():
        fail(404, "导出文件不存在", "export_file_missing")
    media_type = "application/pdf" if item["format"] == "pdf" else "application/zip"
    return FileResponse(path, media_type=media_type, filename=path.name)


@router.post("/projects/{project_id}/brand-manual/shares")
def create_share(project_id: str, payload: ShareCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        manual = row_dict(connection.execute("SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)).fetchone())
        if not manual or not manual.get("current_version_id"):
            fail(422, "请先生成并保存品牌手册", "manual_required")
        version = decode_record(row_dict(connection.execute("SELECT * FROM manual_versions WHERE id = ?", (manual["current_version_id"],)).fetchone()))
        assets = records(connection, "SELECT * FROM manual_assets WHERE manual_version_id = ? ORDER BY created_at", (manual["current_version_id"],))
        token = secrets.token_urlsafe(24)
        share_id = new_id()
        snapshot = {"label": payload.label, "manual_version": version, "assets": assets, "created_at": now()}
        connection.execute(
            """INSERT INTO share_snapshots
               (id, project_id, manual_version_id, token_hash, snapshot_json, revoked_at, created_at)
               VALUES (?, ?, ?, ?, ?, NULL, ?)""",
            (share_id, project_id, manual["current_version_id"], hash_share_token(token), json_value(snapshot), now()),
        )
    return envelope({"id": share_id, "share_url": f"/share/{token}", "api_url": f"/api/shares/{token}", "created_at": snapshot["created_at"]})


@router.get("/shares/{token}")
def get_share(token: str) -> dict[str, Any]:
    with connect() as connection:
        share = row_dict(connection.execute("SELECT * FROM share_snapshots WHERE token_hash = ?", (hash_share_token(token),)).fetchone())
    if not share or share.get("revoked_at"):
        fail(404, "分享已失效或不存在", "share_not_found")
    snapshot = json.loads(share["snapshot_json"])
    for asset in snapshot.get("assets", []):
        if asset.get("media_asset_id"):
            asset["url"] = f"/api/shares/{token}/assets/{asset['media_asset_id']}"
    return envelope(snapshot)


@router.get("/shares/{token}/assets/{asset_id}")
def get_share_asset(token: str, asset_id: str) -> FileResponse:
    with connect() as connection:
        share = row_dict(connection.execute("SELECT * FROM share_snapshots WHERE token_hash = ?", (hash_share_token(token),)).fetchone())
        if not share or share.get("revoked_at"):
            fail(404, "分享已失效或不存在", "share_not_found")
        snapshot = json.loads(share["snapshot_json"])
        allowed = {item.get("media_asset_id") for item in snapshot.get("assets", [])}
        if asset_id not in allowed:
            fail(404, "该资产不在分享快照中", "media_not_found")
        asset = row_dict(connection.execute("SELECT * FROM media_assets WHERE id = ?", (asset_id,)).fetchone())
    if not asset:
        fail(404, "找不到图片资产", "media_not_found")
    path = (Path(settings.media_directory) / asset["storage_key"]).resolve()
    if not path.is_file():
        fail(404, "图片文件不存在", "media_file_missing")
    return FileResponse(path, media_type=asset["mime_type"])


@router.post("/projects/{project_id}/brand-manual/shares/{share_id}/revoke")
def revoke_share(project_id: str, share_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        share = row_dict(connection.execute("SELECT * FROM share_snapshots WHERE id = ? AND project_id = ?", (share_id, project_id)).fetchone())
        if not share:
            fail(404, "找不到分享快照", "share_not_found")
        connection.execute("UPDATE share_snapshots SET revoked_at = ? WHERE id = ?", (now(), share_id))
    return envelope({"id": share_id, "revoked": True})


@router.get("/projects/{project_id}/tide-report")
def get_tide_report(project_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        require_current_direction(connection, project_id)
    return envelope(latest_report_for_project(project_id, visitor["id"]))



@router.post("/tide-report/refresh", status_code=202)
def refresh_tide_report(
    background_tasks: BackgroundTasks,
    visitor: Annotated[dict[str, Any], Depends(current_visitor)],
) -> dict[str, Any]:
    if not provider.live:
        fail(409, "观潮联网搜集尚未配置，请检查检索与提炼服务", "tide_not_configured")
    state = reserve_personal_tide_refresh(visitor["id"])
    if state.get("accepted"):
        background_tasks.add_task(
            refresh_personal_tide_report,
            visitor["id"],
            state["edition_id"],
            attempt_count=state["attempt_count"],
        )
    return envelope({"refresh_state": {key: value for key, value in state.items() if key not in {"accepted", "edition_id"}}})


@router.post("/projects/{project_id}/tide-report-ideas/{idea_id}/favorite")
def favorite_tide_report_idea(project_id: str, idea_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        require_current_direction(connection, project_id)
        if not shared_idea_for_project(connection, idea_id, visitor["id"]):
            fail(404, "找不到这条本周灵感", "tide_idea_not_found")
        existing = row_dict(connection.execute(
            "SELECT favorite FROM project_tide_idea_preferences WHERE project_id = ? AND idea_id = ?", (project_id, idea_id)
        ).fetchone())
        favorite = 0 if existing and existing["favorite"] else 1
        connection.execute(
            """INSERT INTO project_tide_idea_preferences (project_id, idea_id, favorite, used_at, updated_at)
               VALUES (?, ?, ?, NULL, ?)
               ON CONFLICT(project_id, idea_id) DO UPDATE SET favorite = excluded.favorite, updated_at = excluded.updated_at""",
            (project_id, idea_id, favorite, now()),
        )
    return envelope({"id": idea_id, "favorite": favorite})


@router.post("/projects/{project_id}/tide-report-ideas/{idea_id}/use")
def use_tide_report_idea(project_id: str, idea_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        require_current_direction(connection, project_id)
        idea = shared_idea_for_project(connection, idea_id, visitor["id"])
        if not idea:
            fail(404, "找不到这条本周灵感", "tide_idea_not_found")
        connection.execute(
            """INSERT INTO project_tide_idea_preferences (project_id, idea_id, favorite, used_at, updated_at)
               VALUES (?, ?, 0, ?, ?)
               ON CONFLICT(project_id, idea_id) DO UPDATE SET used_at = excluded.used_at, updated_at = excluded.updated_at""",
            (project_id, idea_id, now(), now()),
        )
    return envelope(idea)


@router.post("/projects/{project_id}/tide-searches")
def create_tide_search(project_id: str, payload: TideCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    project_for_visitor(project_id, visitor)
    if not provider.live:
        fail(409, "观潮需要真实联网模型。请在后端配置 Credits Key 并启用 AI_RUNTIME_MODE=live。", "tide_not_configured")
    with connect() as connection:
        context = project_context(connection, project_id)
        current = row_dict(connection.execute("SELECT * FROM brand_directions WHERE id = ?", (context["project"].get("current_direction_id"),)).fetchone())
        if not current:
            fail(422, "请先选择一条品牌路线", "direction_required")
        if context["project"].get("tide_search_used", 0) >= 2:
            fail(429, "观潮额度已用完", "tide_quota_exhausted")
        direction = json.loads(current["content_json"])
        query = f"{context['project']['core_product']} {context['project']['origin']} {direction.get('target_audience', '')}"
        search_id = new_id()
        connection.execute("INSERT INTO tide_searches VALUES (?, ?, 'running', ?, NULL, ?, NULL)", (search_id, project_id, query, now()))
        try:
            sources = provider.tide_search({**context, "direction": direction, "query": query})
            verified = [source for source in sources if provider.verify_source(source.url)]
            if not verified:
                raise ProviderError("no_verified_sources", "未找到可访问的真实来源")
        except ProviderError as exc:
            connection.execute("UPDATE tide_searches SET status = 'failed', error_code = ?, completed_at = ? WHERE id = ?", (exc.code, now(), search_id))
            fail(503, str(exc), exc.code)
        for source in verified[:2]:
            connection.execute("INSERT INTO inspiration_cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)", (new_id(), search_id, source.theme, source.content_motif, source.url, source.title, source.published_at, source.fit_reason, source.risk_note, now()))
        connection.execute("UPDATE tide_searches SET status = 'succeeded', completed_at = ? WHERE id = ?", (now(), search_id))
        connection.execute("UPDATE projects SET tide_search_used = tide_search_used + 1, current_stage = 'tide', updated_at = ? WHERE id = ?", (now(), project_id))
        result = row_dict(connection.execute("SELECT * FROM tide_searches WHERE id = ?", (search_id,)).fetchone())
        result["cards"] = records(connection, "SELECT * FROM inspiration_cards WHERE tide_search_id = ?", (search_id,))
    return envelope(result)


@router.post("/inspiration-cards/{card_id}/favorite")
def favorite_inspiration(card_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        card = row_dict(connection.execute("SELECT * FROM inspiration_cards WHERE id = ?", (card_id,)).fetchone())
        if not card:
            fail(404, "找不到灵感卡", "inspiration_not_found")
        search = row_dict(connection.execute("SELECT * FROM tide_searches WHERE id = ?", (card["tide_search_id"],)).fetchone())
        project_for_visitor(search["project_id"], visitor)
        connection.execute("UPDATE inspiration_cards SET favorite = CASE WHEN favorite = 1 THEN 0 ELSE 1 END WHERE id = ?", (card_id,))
        result = row_dict(connection.execute("SELECT * FROM inspiration_cards WHERE id = ?", (card_id,)).fetchone())
    return envelope(result)


def launch_brief(context: dict[str, Any], template_type: str, inspiration_text: str = "") -> dict[str, Any]:
    project = context["project"]
    direction = context["direction"]
    inspiration = context.get("inspiration")
    inspiration_hint = f"；参考已选公开灵感《{inspiration['source_title']}》的表达角度" if inspiration else ""
    user_hint = f"；用户灵感：{inspiration_text.strip()}" if inspiration_text.strip() else ""
    common = {"brief": f"围绕{project['core_product']}，以{direction.get('visual_keywords', ['暖纸'])[0]}与地方档案质感完成概念稿{inspiration_hint}{user_hint}；所有传播事实仅取自确认档案。", "warning": "AI 概念稿，不可直接印刷"}
    if template_type == "xiaohongshu":
        return {**common, "titles": [f"把{project['core_product']}带进今天", f"来自{project['origin']}的一口风物", "这份山地日常，想寄给你"], "body": direction.get("story_spine", ""), "hashtags": ["#贵州风物", "#山地农产品", "#品牌档案"], "image_ratio": "3:4"}
    return {**common, "template": "周边概念稿", "image_ratio": "3:4"}


def generation_context(connection: Any, project_id: str, inspiration_card_id: str | None) -> dict[str, Any]:
    context = project_context(connection, project_id)
    if not context["archive_cards"]:
        fail(422, "请先确认至少一张有效档案卡", "archive_required")
    current = row_dict(connection.execute("SELECT * FROM brand_directions WHERE id = ?", (context["project"].get("current_direction_id"),)).fetchone())
    if not current:
        fail(422, "请先选择一条品牌路线", "direction_required")
    context["direction"] = json.loads(current["content_json"])
    if inspiration_card_id:
        inspiration = shared_idea_for_project(connection, inspiration_card_id, context["project"].get("visitor_id"))
        if inspiration:
            sources = inspiration.get("sources", [])
            inspiration["source_title"] = "、".join(str(source["source_title"]) for source in sources[:2]) or inspiration["theme"]
            inspiration["source_url"] = sources[0]["source_url"] if sources else ""
        else:
            inspiration = row_dict(connection.execute(
                """SELECT inspiration_cards.* FROM inspiration_cards
                   JOIN tide_searches ON tide_searches.id = inspiration_cards.tide_search_id
                   WHERE inspiration_cards.id = ? AND tide_searches.project_id = ?""",
                (inspiration_card_id, project_id),
            ).fetchone())
        if not inspiration:
            fail(422, "所选灵感不属于当前品牌项目", "invalid_inspiration")
        context["inspiration"] = inspiration
    return context


def launch_generation_input(context: dict[str, Any], template_type: str, inspiration_text: str, material_ids: list[str]) -> dict[str, Any]:
    """Build the hidden, deterministic production brief used by both models."""
    project = context["project"]
    direction = context["direction"]
    if template_type == "peripheral":
        material_prompt = "制作类型：实体物料设计。将以下物料作为同一套品牌视觉系统来呈现：" + " ".join(
            MATERIAL_PROMPT_SEGMENTS[material_id] for material_id in material_ids
        ) + " 画面应体现真实可制作的样机、材质和结构；不生成可读文字。"
    else:
        material_prompt = (
            "制作类型：线上图文生成。为移动端社媒图文制作竖版 3:4 首图/封面构图，"
            "突出单一主题、清晰视觉焦点和可继续排版的留白；不生成可读文字。"
        )
    image_prompt = (
        f"中国贵州山地农产品品牌概念图。产品：{project['core_product']}；产地：{project['origin']}；"
        f"品牌路线：{direction.get('brand_one_liner', '')}。"
        f"用户图像需求（只作为创意方向，不得改写品牌事实）：{inspiration_text.strip()}。"
        f"{material_prompt} 暖纸、靛蓝布面、苔藓绿、明黄标记、地方档案质感、竖版 3:4。"
        "不出现疗效、夸张承诺或虚构来源。"
    )
    return {
        "template_type": template_type,
        "user_prompt": inspiration_text.strip(),
        "material_ids": material_ids,
        "material_prompt": material_prompt,
        "image_prompt": image_prompt,
    }


def model_launch_copy(context: dict[str, Any], generation_input: dict[str, Any]) -> dict[str, Any]:
    template_type = str(generation_input["template_type"])
    inspiration_text = str(generation_input["user_prompt"])
    baseline = launch_brief(context, template_type, inspiration_text)
    instruction = (
        "根据确认档案、当前路线和用户灵感，生成一份出山概念稿的文字内容。用户灵感只可作为创意方向，不得写成品牌事实。"
        "只输出 JSON，必须有 brief 字段；小红书图文额外输出 titles（3条）、body、hashtags；"
        "周边设计稿额外输出 concept_title、materials。不得出现疗效、绝对化承诺或虚构来源。"
    )
    generated = provider.chat_json(
        model=settings.openai_next_text_model,
        instruction=instruction,
        context={**context, "user_inspiration": inspiration_text, "launch_generation": generation_input},
    )
    if not isinstance(generated.get("brief"), str) or not generated["brief"].strip():
        raise ProviderError("invalid_model_json", "文案模型没有返回可用的概念 Brief")
    result = {**baseline, **generated, "warning": "AI 概念稿，不可直接印刷"}
    if template_type == "xiaohongshu" and not isinstance(result.get("titles"), list):
        raise ProviderError("invalid_model_json", "图文模型没有返回标题列表")
    return result


def persist_preview_image(
    connection: Any, project_id: str, preview_id: str, image: dict[str, str], prompt: str,
) -> dict[str, str]:
    """Store base64 previews behind the existing authenticated media endpoint."""
    if image.get("kind") != "base64":
        if image.get("kind") == "url" and image.get("value"):
            return image
        raise ProviderError("image_invalid_response", "图片服务没有返回可持久化内容")
    asset_id = new_id()
    relative_key = f"{project_id}/generated/preview-{preview_id}.png"
    image_path = Path(settings.media_directory) / relative_key
    image_path.parent.mkdir(parents=True, exist_ok=True)
    provider.write_base64_image(image["value"], str(image_path))
    connection.execute(
        """INSERT INTO media_assets
           (id, project_id, storage_key, original_name, mime_type, size_bytes, created_at, kind, metadata_json)
           VALUES (?, ?, ?, ?, 'image/png', ?, ?, 'generated', ?)""",
        (asset_id, project_id, relative_key, f"preview-{preview_id}.png", image_path.stat().st_size, now(),
         json_value({"kind": "generation_preview", "preview_id": preview_id, "prompt": prompt, "disclaimer": "AI generated concept asset"})),
    )
    return {"kind": "url", "value": f"/api/media/{asset_id}"}


def run_generation_preview(preview_id: str) -> None:
    """Generate outside the request/response lifecycle so reverse proxies do not time out."""
    with connect() as connection:
        preview = row_dict(connection.execute("SELECT * FROM generation_previews WHERE id = ?", (preview_id,)).fetchone())
    if not preview or preview["status"] != "running":
        return
    context = json.loads(preview["input_snapshot_json"])
    generation_input = context.get("launch_generation")
    if not isinstance(generation_input, dict):
        result, status, error_code = {"warning": "AI 概念稿，不可直接印刷", "error_message": "缺少生成输入快照"}, "failed", "generation_snapshot_invalid"
    else:
        try:
            result = model_launch_copy(context, generation_input)
            image = provider.generate_image(str(generation_input["image_prompt"]))
            with connect() as connection:
                result["image"] = persist_preview_image(connection, preview["project_id"], preview_id, image, str(generation_input["image_prompt"]))
            status, error_code = "succeeded", None
        except ProviderError as exc:
            result, status, error_code = {"warning": "AI 概念稿，不可直接印刷", "error_message": str(exc)}, "failed", exc.code
        except (Base64Error, OSError, ValueError) as exc:
            result, status, error_code = {"warning": "AI 概念稿，不可直接印刷", "error_message": "图片保存失败，请重试"}, "failed", "image_storage_failed"
            logger.warning("Generation preview %s could not persist its image: %s", preview_id, exc)
        except Exception:
            result, status, error_code = {"warning": "AI 概念稿，不可直接印刷", "error_message": "生成服务出现异常，请重试"}, "failed", "generation_internal_error"
            logger.exception("Generation preview %s failed unexpectedly", preview_id)
    with connect() as connection:
        connection.execute(
            "UPDATE generation_previews SET result_json = ?, status = ?, error_code = ?, updated_at = ? WHERE id = ? AND status = 'running'",
            (json_value(result), status, error_code, now(), preview_id),
        )


@router.post("/projects/{project_id}/generation-previews", status_code=202)
def create_generation_preview(
    project_id: str, payload: GenerationPreviewCreate, background_tasks: BackgroundTasks,
    visitor: Annotated[dict[str, Any], Depends(current_visitor)],
) -> dict[str, Any]:
    if payload.template_type not in {"peripheral", "xiaohongshu"}:
        fail(422, "仅支持周边概念稿或小红书图文", "invalid_template")
    material_ids = normalized_material_ids(payload.template_type, payload.material_ids)
    project_for_visitor(project_id, visitor)
    if not provider.live:
        fail(409, "请先在后端配置 Key，并将 AI_RUNTIME_MODE 设为 live 后再生成预览", "generation_not_configured")
    with connect() as connection:
        context = generation_context(connection, project_id, payload.inspiration_card_id)
        if context["project"].get("launch_used", 0) >= 2:
            fail(429, "出山额度已用完", "launch_quota_exhausted")
        preview_id = new_id()
        generation_input = launch_generation_input(context, payload.template_type, payload.inspiration_text, material_ids)
        context["launch_generation"] = generation_input
        connection.execute(
            "INSERT INTO generation_previews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (preview_id, project_id, payload.template_type, payload.inspiration_text, json_value(context), json_value({"warning": "正在生成图文预览"}), "running", None, now(), now()),
        )
        preview = decode_record(row_dict(connection.execute("SELECT * FROM generation_previews WHERE id = ?", (preview_id,)).fetchone()))
    background_tasks.add_task(run_generation_preview, preview_id)
    return envelope(preview)


@router.get("/generation-previews/{preview_id}")
def get_generation_preview(preview_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        preview = row_dict(connection.execute("SELECT * FROM generation_previews WHERE id = ?", (preview_id,)).fetchone())
    if not preview:
        fail(404, "找不到这份生成预览", "preview_not_found")
    project_for_visitor(preview["project_id"], visitor)
    return envelope(decode_record(preview))


@router.post("/generation-previews/{preview_id}/save")
def save_generation_preview(preview_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        preview = row_dict(connection.execute("SELECT * FROM generation_previews WHERE id = ?", (preview_id,)).fetchone())
        if not preview:
            fail(404, "找不到这份生成预览", "preview_not_found")
        project_for_visitor(preview["project_id"], visitor)
        if preview["status"] != "succeeded":
            fail(409, "这份预览尚未成功生成，不能保存", "preview_not_ready")
        project = row_dict(connection.execute("SELECT * FROM projects WHERE id = ?", (preview["project_id"],)).fetchone())
        if project.get("launch_used", 0) >= 2:
            fail(429, "出山额度已用完", "launch_quota_exhausted")
        job_id = new_id()
        connection.execute("INSERT INTO generation_jobs VALUES (?, ?, ?, NULL, ?, 'succeeded', ?, ?, NULL, 0, ?, ?)", (job_id, preview["project_id"], job_id, preview["template_type"], preview["input_snapshot_json"], preview["result_json"], now(), now()))
        connection.execute("UPDATE generation_previews SET status = 'accepted', updated_at = ? WHERE id = ?", (now(), preview_id))
        connection.execute("UPDATE projects SET launch_used = launch_used + 1, current_stage = 'launch', updated_at = ? WHERE id = ?", (now(), preview["project_id"]))
        job = decode_record(row_dict(connection.execute("SELECT * FROM generation_jobs WHERE id = ?", (job_id,)).fetchone()))
    return envelope(job)


@router.post("/projects/{project_id}/generation-jobs")
def create_generation(project_id: str, payload: GenerationCreate, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    if payload.template_type not in {"peripheral", "xiaohongshu"}:
        fail(422, "仅支持周边概念稿或小红书图文", "invalid_template")
    project_for_visitor(project_id, visitor)
    with connect() as connection:
        context = generation_context(connection, project_id, payload.inspiration_card_id)
        if context["project"].get("launch_used", 0) >= 2:
            fail(429, "出山额度已用完", "launch_quota_exhausted")
        brief = launch_brief(context, payload.template_type)
        job_id = new_id()
        connection.execute("INSERT INTO generation_jobs VALUES (?, ?, ?, NULL, ?, 'running', ?, '{}', NULL, 0, ?, ?)", (job_id, project_id, job_id, payload.template_type, json_value(context), now(), now()))
        image_result: dict[str, str] | None = None
        image_error: str | None = None
        if provider.live:
            try:
                prompt = f"中国贵州山地农产品品牌概念图，产品：{context['project']['core_product']}，产地：{context['project']['origin']}，路线：{context['direction'].get('brand_one_liner')}。暖纸、靛蓝布面、苔藓绿、明黄标记、地方档案质感，无夸张疗效文案，竖版 3:4。"
                image_result = provider.generate_image(prompt)
                if image_result["kind"] == "base64":
                    image_path = Path(settings.media_directory) / f"generation-{job_id}.png"
                    provider.write_base64_image(image_result["value"], str(image_path))
                    image_result = {"kind": "local", "value": f"/media/{image_path.name}"}
            except ProviderError as exc:
                image_error = exc.code
        else:
            image_error = "image_provider_not_configured"
        result = {**brief, "image": image_result, "image_error": image_error}
        # A missing image service must not discard the generated, reviewable
        # copy brief.  Mark this explicitly as partial instead of pretending a
        # concept image exists or returning a failed, unusable output.
        status = "succeeded" if image_result else "partial"
        connection.execute("UPDATE generation_jobs SET status = ?, result_json = ?, error_code = ?, updated_at = ? WHERE id = ?", (status, json_value(result), image_error, now(), job_id))
        connection.execute("UPDATE projects SET launch_used = launch_used + 1, current_stage = 'launch', updated_at = ? WHERE id = ?", (now(), project_id))
        job = decode_record(row_dict(connection.execute("SELECT * FROM generation_jobs WHERE id = ?", (job_id,)).fetchone()))
    return envelope(job)


@router.post("/generation-jobs/{job_id}/regenerate")
def regenerate(job_id: str, visitor: Annotated[dict[str, Any], Depends(current_visitor)]) -> dict[str, Any]:
    with connect() as connection:
        job = row_dict(connection.execute("SELECT * FROM generation_jobs WHERE id = ?", (job_id,)).fetchone())
        if not job:
            fail(404, "找不到出山任务", "generation_not_found")
        project_for_visitor(job["project_id"], visitor)
        root_id = job["root_job_id"] or job["id"]
        root = row_dict(connection.execute("SELECT * FROM generation_jobs WHERE id = ?", (root_id,)).fetchone())
        if root["regeneration_used"]:
            fail(409, "该任务已经重生成过一次", "regeneration_exhausted")
        connection.execute("UPDATE generation_jobs SET regeneration_used = 1 WHERE id = ?", (root_id,))
    # Reuse the same outward generation path, then neutralize the ordinary
    # quota charge and link the resulting record to the original immutable job.
    # The product allows exactly one regeneration per root request.
    response = create_generation(job["project_id"], GenerationCreate(template_type=job["template_type"]), visitor)
    regenerated_id = response["data"]["id"]
    with connect() as connection:
        connection.execute("UPDATE projects SET launch_used = MAX(launch_used - 1, 0) WHERE id = ?", (job["project_id"],))
        connection.execute("UPDATE generation_jobs SET root_job_id = ?, regenerate_of_job_id = ? WHERE id = ?", (root_id, job_id, regenerated_id))
        result = decode_record(row_dict(connection.execute("SELECT * FROM generation_jobs WHERE id = ?", (regenerated_id,)).fetchone()))
    return envelope(result)
