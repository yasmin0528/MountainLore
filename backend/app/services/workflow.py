"""Persisted project workflow jobs for routes, manuals, assets and exports."""

from __future__ import annotations

import hashlib
import json
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings
from app.fieldwork.store import connect, decode_record, json_value, new_id, now, row_dict
from app.services.brand_manual_ppt import build_brand_manual_slides
from app.services.providers import ProviderError, provider

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mountainlore-workflow")
_running: set[str] = set()
_running_lock = threading.Lock()

_ROUTE_COLOR_SCHEMES = [
    (["#294A62", "#D8B56A", "#F4E9D2", "#6F7D58"], "以产地的晨雾、纸本记录和作物成熟色建立克制的田野档案感。"),
    (["#2E5B46", "#D99A30", "#F6F1E5", "#495866"], "从产品的自然色泽和当代使用场景提炼低饱和主色，以明亮强调色承接创新感。"),
    (["#A9443D", "#37634D", "#F3D6A7", "#403D38"], "从活动现场、产品切面和手作材料中提炼高辨识对比色，突出共同参与的能量。"),
]


def _fallback_slogan(project: dict[str, Any], route_index: int) -> str:
    product = str(project.get("core_product") or "风物")
    slogans = [f"一口{product}，见山见真", f"今天，就来点{product}", f"一起，让{product}被看见"]
    return slogans[(route_index - 1) % len(slogans)]


def _valid_palette(value: Any) -> list[str]:
    colors = [str(item).upper() for item in value] if isinstance(value, list) else []
    return colors if len(colors) == 4 and len(set(colors)) == 4 and all(len(color) == 7 and color.startswith("#") and all(char in "0123456789ABCDEF" for char in color[1:]) for color in colors) else []


def public_claims(connection: Any, project_id: str) -> list[dict[str, Any]]:
    return [
        decode_record(dict(row))
        for row in connection.execute(
            """SELECT DISTINCT claims.* FROM claims
               JOIN archive_card_claims ON archive_card_claims.claim_id = claims.id
               JOIN archive_cards ON archive_cards.id = archive_card_claims.archive_card_id
               WHERE claims.project_id = ? AND archive_cards.status = 'active'
                 AND claims.status IN ('confirmed', 'corrected') AND claims.public_allowed = 1
               ORDER BY claims.created_at""",
            (project_id,),
        )
    ]


def project_snapshot(connection: Any, project_id: str) -> dict[str, Any]:
    project = row_dict(connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    cards = [dict(row) for row in connection.execute(
        "SELECT * FROM archive_cards WHERE project_id = ? AND status = 'active' ORDER BY created_at", (project_id,)
    )]
    claims = public_claims(connection, project_id)
    return {
        "project": project,
        "archive_cards": cards,
        "claims": claims,
        "frozen_at": now(),
        "evidence_rule": "Only confirmed/corrected claims with publicAllowed=true may support public selling points.",
    }


def create_task(
    project_id: str, kind: str, snapshot: dict[str, Any], idempotency_key: str | None,
    *, parent_task_id: str | None = None,
) -> tuple[dict[str, Any], bool]:
    with connect() as connection:
        if idempotency_key:
            existing = row_dict(connection.execute(
                "SELECT * FROM tasks WHERE idempotency_key = ?", (idempotency_key,)
            ).fetchone())
            if existing:
                return decode_record(existing), False
        task = {
            "id": new_id(), "project_id": project_id, "kind": kind, "status": "queued",
            "result_json": json_value({}), "error_code": None, "idempotency_key": idempotency_key,
            "created_at": now(), "updated_at": now(), "input_snapshot_json": json_value(snapshot),
            "progress": 0, "attempt": 0, "retriable": 1, "parent_task_id": parent_task_id,
        }
        connection.execute(
            """INSERT INTO tasks
               (id, project_id, kind, status, result_json, error_code, idempotency_key,
                created_at, updated_at, input_snapshot_json, progress, attempt, retriable, parent_task_id)
               VALUES (:id, :project_id, :kind, :status, :result_json, :error_code, :idempotency_key,
                       :created_at, :updated_at, :input_snapshot_json, :progress, :attempt, :retriable, :parent_task_id)""",
            task,
        )
    result = task.copy()
    return decode_record(result), True


def submit_task(task_id: str) -> None:
    with _running_lock:
        if task_id in _running:
            return
        _running.add(task_id)
    _executor.submit(_run_task, task_id)


def execute_task(task_id: str) -> dict[str, Any]:
    """Run deterministically in demo/tests while live provider work stays asynchronous."""
    _run_task(task_id)
    with connect() as connection:
        return decode_record(row_dict(connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()))


def recover_tasks() -> None:
    with connect() as connection:
        rows = connection.execute("SELECT id FROM tasks WHERE status IN ('queued', 'running')").fetchall()
        connection.execute(
            "UPDATE tasks SET status = 'queued', error_code = NULL, updated_at = ? WHERE status = 'running'", (now(),)
        )
    for row in rows:
        submit_task(row["id"])


def retry_task(task_id: str) -> dict[str, Any] | None:
    with connect() as connection:
        task = row_dict(connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
        if not task or task["status"] not in {"failed", "partial"} or not task["retriable"]:
            return None
        connection.execute(
            "UPDATE tasks SET status = 'queued', error_code = NULL, progress = 0, updated_at = ? WHERE id = ?",
            (now(), task_id),
        )
    submit_task(task_id)
    task["status"] = "queued"
    task["error_code"] = None
    task["progress"] = 0
    return decode_record(task)


def _task_update(task_id: str, *, status: str | None = None, progress: int | None = None,
                 result: dict[str, Any] | None = None, error_code: str | None = None,
                 retriable: bool | None = None) -> None:
    fields = ["updated_at = ?"]
    values: list[Any] = [now()]
    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if progress is not None:
        fields.append("progress = ?")
        values.append(progress)
    if result is not None:
        fields.append("result_json = ?")
        values.append(json_value(result))
    if error_code is not None:
        fields.append("error_code = ?")
        values.append(error_code)
    if retriable is not None:
        fields.append("retriable = ?")
        values.append(1 if retriable else 0)
    values.append(task_id)
    with connect() as connection:
        connection.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)


def _run_task(task_id: str) -> None:
    try:
        with connect() as connection:
            task = row_dict(connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
            if not task or task["status"] not in {"queued", "running"}:
                return
            connection.execute(
                "UPDATE tasks SET status = 'running', attempt = attempt + 1, progress = 5, updated_at = ? WHERE id = ?",
                (now(), task_id),
            )
        if task["kind"] == "route_generation":
            result = _generate_routes(task)
        elif task["kind"] == "manual_generation":
            # Legacy persisted tasks are upgraded to the immediate, route-derived
            # deck instead of re-entering the old text-and-three-images pipeline.
            result = create_manual_skeleton(task["project_id"], json.loads(task["input_snapshot_json"]))
        elif task["kind"] in {"logo_generation", "manual_asset_generation"}:
            result = _generate_manual_asset(task)
        elif task["kind"] == "export":
            result = _generate_exports(task)
        else:
            raise ProviderError("unsupported_task", f"不支持的任务类型：{task['kind']}")
        # 导出只由用户显式触发，避免手册首次可见时与视觉任务争抢队列。
        final_status = "partial" if result.pop("_partial", False) else "succeeded"
        _task_update(task_id, status=final_status, progress=100, result=result)
    except ProviderError as exc:
        _task_update(task_id, status="failed", progress=100, error_code=exc.code, result={"message": str(exc)}, retriable=exc.retriable)
    except Exception as exc:  # keep a recoverable task instead of losing the project
        _task_update(task_id, status="failed", progress=100, error_code="workflow_failed", result={"message": str(exc)})
    finally:
        with _running_lock:
            _running.discard(task_id)


def _fallback_routes(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    project = snapshot["project"]
    claims = snapshot["claims"]
    claim_ids = [claim["id"] for claim in claims]
    statements = [claim["statement"] for claim in claims]
    evidence_gaps = [] if claim_ids else ["尚无可公开事实；卖点仅为待验证方向，不能直接传播。"]
    anchors = (statements + [project["origin"], project["core_product"], "真实制作过程"])[:3]
    return [
        {
            "title": "路线一｜山里来信", "candidate_brand_name": project["brand_name"],
            "brand_one_liner": f"以可追溯的{project['core_product']}连接{project['origin']}的真实劳动，让日常选择看得见来处、尝得到风物。",
            "slogan": _fallback_slogan(project, 1),
            "target_audience": "重视来处、日常食用与真实关系的城市消费者",
            "target_scenarios": ["日常自用", "拜访伴手礼", "地方风物分享"],
            "story_spine": "从一个具体的人与一段制作现场出发，让品牌像田野笔记一样可信、克制。",
            "emotion_value": "亲近、可信、有人情味", "altruistic_value": "帮助购买者理解产地与劳动，而非只记住口号。",
            "selling_points": [
                {"text": anchors[i], "claimIds": [claim_ids[i]] if i < len(claim_ids) else [], "evidenceStatus": "confirmed" if i < len(claim_ids) else "gap"}
                for i in range(3)
            ],
            "evidenceGaps": evidence_gaps, "visual_keywords": ["田野手记", "暖纸", "靛蓝", "手绘标注"],
            "color_palette": _ROUTE_COLOR_SCHEMES[0][0], "color_rationale": _ROUTE_COLOR_SCHEMES[0][1],
            "logo_design": "以一枚从山路与果实轮廓中提炼的手绘印记为核心：外轮廓像展开的田野记录页，中间保留一条向上的山路留白。采用靛蓝单色为主、暖纸为底，小尺寸仍清晰；不使用文字、渐变或复杂徽章。",
            "positive_prompt": "无文字品牌符号，贵州山地田野记录感，克制手绘，单色轮廓，适合小尺寸",
            "negative_prompt": "文字，渐变，玻璃拟态，旅游海报，疗效承诺，复杂徽章",
            "content_tone": "具体、平实、有出处", "forbidden_expressions": ["顶级", "治愈", "唯一", "包治百病"],
        },
        {
            "title": "路线二｜山地新日常", "candidate_brand_name": project["brand_name"],
            "brand_one_liner": f"让{project['core_product']}以清楚、轻快的当代方式进入日常，把产地经验转化为易理解、愿复用的新选择。",
            "slogan": _fallback_slogan(project, 2),
            "target_audience": "偏好当代设计、轻负担表达与地方新消费的年轻人",
            "target_scenarios": ["工作间隙", "朋友分享", "节气礼赠"],
            "story_spine": "以真实产品与工艺为底，把地方经验翻译成简洁、可持续使用的现代视觉语言。",
            "emotion_value": "清醒、轻快、有发现感", "altruistic_value": "让地方知识变得好理解、好使用、可核验。",
            "selling_points": [
                {"text": anchors[(i + 1) % 3], "claimIds": [claim_ids[i]] if i < len(claim_ids) else [], "evidenceStatus": "confirmed" if i < len(claim_ids) else "gap"}
                for i in range(3)
            ],
            "evidenceGaps": evidence_gaps, "visual_keywords": ["现代标本", "苔藓绿", "明黄索引", "留白"],
            "color_palette": _ROUTE_COLOR_SCHEMES[1][0], "color_rationale": _ROUTE_COLOR_SCHEMES[1][1],
            "logo_design": "以产品切面与山地等高线组合成现代标本符号：使用几何圆角与一条明黄索引线，形成可被缩小为 App 图标的稳定结构。主色为苔藓绿，辅以明黄；整体留白、无文字、无写实插画。",
            "positive_prompt": "无文字品牌符号，山地农作物抽象标本，现代编辑设计，几何留白，小尺寸清晰",
            "negative_prompt": "文字，霓虹，渐变，玻璃拟态，旅游纪念品，写实风景照片",
            "content_tone": "短句、清楚、不过度修辞", "forbidden_expressions": ["网红", "天花板", "药食同源疗效", "销量第一"],
        },
        {
            "title": "路线三｜风物共创场", "candidate_brand_name": project["brand_name"],
            "brand_one_liner": f"围绕{project['core_product']}发起真实可参与的风物体验，让{project['origin']}的地方故事被共同创造、持续分享。",
            "slogan": _fallback_slogan(project, 3),
            "target_audience": "愿意参与地方文化体验、品牌活动与内容共创的人群",
            "target_scenarios": ["产地开放日", "节气共创活动", "品牌联名与社群分享"],
            "story_spine": "把真实产地材料变成可参与的活动线索，让品牌不只讲述地方，也邀请人们一起留下新故事。",
            "emotion_value": "开放、鲜活、有参与感", "altruistic_value": "让地方劳动与知识在真实参与中获得持续关注。",
            "selling_points": [
                {"text": anchors[(i + 2) % 3], "claimIds": [claim_ids[i]] if i < len(claim_ids) else [], "evidenceStatus": "confirmed" if i < len(claim_ids) else "gap"}
                for i in range(3)
            ],
            "evidenceGaps": evidence_gaps, "visual_keywords": ["活动路标", "朱砂红", "山地绿", "手作拼贴"],
            "color_palette": _ROUTE_COLOR_SCHEMES[2][0], "color_rationale": _ROUTE_COLOR_SCHEMES[2][1],
            "logo_design": "以一枚可被参与者盖印、拼接的活动路标为核心：山形、对话框与种子颗粒形成开放的三角构图。主色为山地绿与朱砂红，边缘保留手作切纸感；不出现文字，避免旅游海报式图案。",
            "positive_prompt": "无文字品牌符号，地方风物共创活动感，手作拼贴，清晰轮廓，小尺寸可识别",
            "negative_prompt": "文字，渐变，玻璃拟态，旅游宣传画，舞台灯光，复杂徽章",
            "content_tone": "热情、具体、鼓励参与", "forbidden_expressions": ["唯一", "顶流", "疗愈", "未经证实的文化背书"],
        },
    ]


def _validate_routes(raw: Any, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    routes = raw if isinstance(raw, list) else []
    if len(routes) != 3:
        raise ProviderError("invalid_route_count", "品牌方案必须恰好返回三版")
    allowed = {claim["id"] for claim in snapshot["claims"]}
    validated: list[dict[str, Any]] = []
    used_palettes: set[tuple[str, ...]] = set()
    for index, route in enumerate(routes, start=1):
        if not isinstance(route, dict):
            raise ProviderError("invalid_model_json", "品牌方案结构不完整")
        points = route.get("selling_points") if isinstance(route.get("selling_points"), list) else []
        normalized_points: list[dict[str, Any]] = []
        gaps = [str(item) for item in route.get("evidenceGaps", []) if str(item).strip()]
        for point_index, point in enumerate(points[:3]):
            point = point if isinstance(point, dict) else {"text": str(point)}
            ids = [str(item) for item in point.get("claimIds", []) if str(item) in allowed]
            text = str(point.get("text") or "待补卖点")
            if not ids:
                gaps.append(f"“{text}”尚未绑定可公开事实")
            category = str(point.get("category") or ("产品创新" if point_index < 2 else "创新活动策划"))
            if category not in {"产品创新", "创新活动策划"}:
                category = "产品创新"
            normalized_points.append({"category": category, "explanation": str(point.get("explanation") or text), "text": text, "claimIds": ids, "evidenceStatus": "confirmed" if ids else "gap"})
        while len(normalized_points) < 3:
            category = "创新活动策划" if len(normalized_points) == 2 else "产品创新"
            normalized_points.append({"category": category, "explanation": "待补充并核验的卖点", "text": "待补充并核验的卖点", "claimIds": [], "evidenceStatus": "gap"})
        logo_design = str(route.get("logo_design") or route.get("positive_prompt") or "以无文字核心图形建立品牌识别，保证小尺寸清晰可辨。")
        one_liner = str(route.get("brand_one_liner") or "").strip()
        slogan = str(route.get("slogan") or "").strip()
        if not slogan or slogan == one_liner:
            slogan = _fallback_slogan(snapshot["project"], index)
        default_palette, default_rationale = _ROUTE_COLOR_SCHEMES[index - 1]
        palette = _valid_palette(route.get("color_palette")) or list(default_palette)
        if tuple(palette) in used_palettes:
            palette = list(default_palette)
        used_palettes.add(tuple(palette))
        route.update({"title": str(route.get("title") or f"路线 {index}"), "brand_one_liner": one_liner, "slogan": slogan, "selling_points": normalized_points, "evidenceGaps": list(dict.fromkeys(gaps)), "color_palette": palette, "color_rationale": str(route.get("color_rationale") or default_rationale), "logo_design": logo_design, "visual_preferences": snapshot.get("visual_preferences", {})})
        validated.append(route)
    return validated


def _generate_routes(task: dict[str, Any]) -> dict[str, Any]:
    snapshot = json.loads(task["input_snapshot_json"])
    _task_update(task["id"], progress=25)
    if provider.live:
        result = provider.chat_json(
            model=settings.openai_next_text_model,
            instruction=(
                "基于冻结的项目、可公开事实与visual_preferences，生成恰好三版、受众/场景/叙事与视觉都明显不同的品牌初步方案。只输出 JSON 对象 {routes:[...]}。"
                "每版必须含 title,candidate_brand_name,brand_one_liner,slogan,target_audience,target_scenarios,story_spine,"
                "emotion_value,altruistic_value,selling_points(恰好3项，每项含category、explanation、text和claimIds；category只能是产品创新或创新活动策划),evidenceGaps,"
                "visual_keywords,color_palette(恰好4个HEX色值),color_rationale,logo_design,positive_prompt,negative_prompt,content_tone,forbidden_expressions。"
                "brand_one_liner 必须是一句完整介绍，同时体现品牌核心价值观和两项关键亮点；slogan 必须朗朗上口、易传播且有号召力，且不得与 brand_one_liner 相同或改写成同一句。"
                "三版 color_palette 必须显著不同，并结合特色产品、原料、产地线索或已上传 Logo 提炼；color_rationale 要说明对应关系，不能沿用通用默认色板。"
                "logo_design 必须是一段具体的无文字 Logo 设计说明，写清核心符号、构图、色彩或质感、小尺寸使用原则和明确避免项；三版的 Logo 方案必须显著不同。"
                "claimIds只能使用输入 claims 的 id；无依据的表达不得伪装成事实，必须留空claimIds并写入evidenceGaps。"
            ),
            context=snapshot,
        )
        routes = _validate_routes(result.get("routes"), snapshot)
        mode = "live"
    else:
        routes = _validate_routes(_fallback_routes(snapshot), snapshot)
        mode = "demo"
    _task_update(task["id"], progress=70)
    with connect() as connection:
        version = connection.execute(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM brand_directions WHERE project_id = ?", (task["project_id"],)
        ).fetchone()[0]
        connection.execute(
            "UPDATE brand_directions SET state = 'superseded' WHERE project_id = ? AND state = 'draft'", (task["project_id"],)
        )
        created = []
        for route_no, content in enumerate(routes, start=1):
            direction_id = new_id()
            connection.execute(
                """INSERT INTO brand_directions
                   (id, project_id, version, route_no, state, title, content_json, input_snapshot_json, created_at)
                   VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)""",
                (direction_id, task["project_id"], version, route_no, content["title"], json_value(content), json_value(snapshot), now()),
            )
            created.append({"id": direction_id, "project_id": task["project_id"], "version": version, "route_no": route_no, "state": "draft", "title": content["title"], "content": content})
        connection.execute(
            "UPDATE projects SET current_stage = 'chronicle', status = 'directions_ready', updated_at = ? WHERE id = ?",
            (now(), task["project_id"]),
        )
    return {"routes": created, "version": version, "mode": mode}


def _fallback_manual(snapshot: dict[str, Any]) -> dict[str, Any]:
    project = snapshot["project"]
    route = snapshot["direction"]["content"]
    preferences = route.get("visual_preferences") or snapshot.get("visual_preferences") or {}
    scenarios = route.get("target_scenarios", [])
    return {
        "brand_name": route.get("candidate_brand_name") or project["brand_name"],
        "brand_introduction": route.get("story_spine", ""), "slogan": route.get("slogan") or _fallback_slogan(project, 1),
        "brand_strategy": {"audience": route.get("target_audience", ""), "scenarios": route.get("target_scenarios", []), "emotion": route.get("emotion_value", ""), "altruism": route.get("altruistic_value", "")},
        "story_system": {"main_story": route.get("story_spine", ""), "chapters": ["来处", "人物", "工艺", "今天的使用方式"]},
        "voice": {"do": route.get("content_tone", ""), "dont": route.get("forbidden_expressions", [])},
        "selling_points": route.get("selling_points", []), "evidence_gaps": route.get("evidenceGaps", []),
        "brand_one_liner": route.get("brand_one_liner", ""),
        "target_audience": route.get("target_audience", ""),
        "target_scenarios": "、".join(scenarios) if isinstance(scenarios, list) else scenarios,
        "story_spine": route.get("story_spine", ""),
        "font_family": preferences.get("font_family", "Source Han Serif SC"),
        "font_label": preferences.get("font_label", "思源宋体 / 思源黑体"),
        "color_palette": (_valid_palette(preferences.get("palette")) if preferences.get("logo_media_asset_id") else []) or _valid_palette(route.get("color_palette")) or list(_ROUTE_COLOR_SCHEMES[0][0]),
        "color_rationale": route.get("color_rationale", "待补充色彩提炼依据。"),
        "logo_mode": preferences.get("logo_mode", "ai"),
        "logo_media_asset_id": preferences.get("logo_media_asset_id"),
        "logo_design": route.get("logo_design", "无文字图形，优先保证24px辨识度"),
        "visual_system": {"keywords": route.get("visual_keywords", []), "logo_direction": route.get("logo_design", "无文字图形，优先保证24px辨识度"), "packaging": "以档案索引组织信息，保留事实来源入口", "pattern": "从产地、原料或工具轮廓抽取可平铺纹样"},
        "applications": ["包装正面", "档案详情页", "社交媒体封面", "伴手礼包装"],
        "disclaimer": "AI 生成的品牌工作稿；公开卖点仅可使用已确认且允许公开的事实。",
    }


def create_manual_skeleton(project_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Persist a route-derived, editable deck without waiting for another model call."""
    direction = snapshot["direction"]
    content = _fallback_manual(snapshot)
    with connect() as connection:
        manual = row_dict(connection.execute(
            "SELECT * FROM brand_manuals WHERE project_id = ?", (project_id,)
        ).fetchone())
        if manual and manual.get("direction_id") == direction["id"] and manual.get("current_version_id"):
            version = row_dict(connection.execute(
                "SELECT * FROM manual_versions WHERE id = ?", (manual["current_version_id"],)
            ).fetchone())
            if version:
                return {"manual_version_id": version["id"], "content": json.loads(version["content_json"]), "created": False}
        version_no = connection.execute(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM manual_versions WHERE project_id = ?", (project_id,)
        ).fetchone()[0]
        version_id = new_id()
        timestamp = now()
        connection.execute(
            """INSERT INTO manual_versions
               (id, project_id, direction_id, version, generated_snapshot_json, content_json, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'text_ready', ?, ?)""",
            (version_id, project_id, direction["id"], version_no, json_value(content), json_value(content), timestamp, timestamp),
        )
        if manual:
            connection.execute(
                "UPDATE brand_manuals SET direction_id = ?, content_json = ?, current_version_id = ?, generated_snapshot_json = ?, updated_at = ? WHERE project_id = ?",
                (direction["id"], json_value(content), version_id, json_value(content), timestamp, project_id),
            )
        else:
            connection.execute(
                """INSERT INTO brand_manuals
                   (id, project_id, direction_id, content_json, updated_at, current_version_id, generated_snapshot_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (new_id(), project_id, direction["id"], json_value(content), timestamp, version_id, json_value(content)),
            )
        preferences = direction["content"].get("visual_preferences") or snapshot.get("visual_preferences") or {}
        uploaded_logo_id = preferences.get("logo_media_asset_id")
        if uploaded_logo_id:
            media = row_dict(connection.execute(
                "SELECT id FROM media_assets WHERE id = ? AND project_id = ?", (uploaded_logo_id, project_id)
            ).fetchone())
            if media:
                connection.execute(
                    """INSERT INTO manual_assets
                       (id, project_id, manual_version_id, kind, media_asset_id, metadata_json, created_at)
                       VALUES (?, ?, ?, 'logo_mark', ?, ?, ?)""",
                    (new_id(), project_id, version_id, uploaded_logo_id, json_value({"source": "user_upload"}), timestamp),
                )
    return {"manual_version_id": version_id, "content": content, "created": True}


def _save_image_asset(project_id: str, version_id: str, kind: str, result: dict[str, str], prompt: str) -> str:
    asset_id = new_id()
    suffix = ".png"
    relative_key = f"{project_id}/generated/{asset_id}{suffix}"
    target = Path(settings.media_directory) / relative_key
    target.parent.mkdir(parents=True, exist_ok=True)
    if result["kind"] == "base64":
        provider.write_base64_image(result["value"], str(target))
    elif result["kind"] == "url":
        try:
            response = httpx.get(result["value"], timeout=60, follow_redirects=True)
            response.raise_for_status()
            target.write_bytes(response.content)
        except httpx.HTTPError as exc:
            raise ProviderError("image_download_failed", "图片已生成但下载保存失败，可重试图片阶段") from exc
    else:
        raise ProviderError("image_invalid_response", "图片服务没有返回可持久化内容")
    size = target.stat().st_size
    with connect() as connection:
        connection.execute(
            """INSERT INTO media_assets
               (id, project_id, storage_key, original_name, mime_type, size_bytes, created_at, kind, metadata_json)
               VALUES (?, ?, ?, ?, 'image/png', ?, ?, 'generated', ?)""",
            (asset_id, project_id, relative_key, f"{kind}.png", size, now(), json_value({"kind": kind, "prompt": prompt, "manual_version_id": version_id, "disclaimer": "AI generated concept asset"})),
        )
        connection.execute(
            """INSERT INTO manual_assets
               (id, project_id, manual_version_id, kind, media_asset_id, metadata_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (new_id(), project_id, version_id, kind, asset_id, json_value({"prompt": prompt, "disclaimer": "AI generated concept asset"}), now()),
        )
    return asset_id


def _generate_manual_asset(task: dict[str, Any]) -> dict[str, Any]:
    snapshot = json.loads(task["input_snapshot_json"])
    version_id = str(snapshot.get("manual_version_id") or "")
    asset_kind = str(snapshot.get("asset_kind") or "")
    if asset_kind not in {"logo_mark", "extension_pattern", "packaging_key_visual"}:
        raise ProviderError("invalid_asset_kind", "不支持的品牌视觉资产类型", retriable=False)
    if not version_id:
        raise ProviderError("manual_version_required", "缺少品牌手册版本")
    with connect() as connection:
        existing = row_dict(connection.execute(
            "SELECT media_asset_id FROM manual_assets WHERE manual_version_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
            (version_id, asset_kind),
        ).fetchone())
    if existing and existing.get("media_asset_id"):
        return {"manual_version_id": version_id, "asset_kind": asset_kind, "asset_id": existing["media_asset_id"], "reused": True}
    route = snapshot["direction"]["content"]
    prompts = {
        "logo_mark": f"根据已选定的 Logo 设计方案生成最终 Logo：{route.get('logo_design', '')}。品牌一句话：{route.get('brand_one_liner', '')}。{route.get('positive_prompt', '')}。只生成无文字的 Logo 图形方向，纯色背景，不出现任何字母或汉字。避免：{route.get('negative_prompt', '')}",
        "extension_pattern": f"根据已选 Logo 设计方案“{route.get('logo_design', '')}”生成可无缝平铺的品牌延展纹样。{route.get('positive_prompt', '')}。不生成文字，不出现功效声明。避免：{route.get('negative_prompt', '')}",
        "packaging_key_visual": f"根据品牌路线“{route.get('brand_one_liner', '')}”生成农产品包装主视觉概念。{route.get('positive_prompt', '')}。不生成可读文字，不出现功效声明。避免：{route.get('negative_prompt', '')}",
    }
    _task_update(task["id"], progress=45)
    if not provider.live:
        raise ProviderError("demo_mode", "演示模式不生成图片")
    asset_id = _save_image_asset(task["project_id"], version_id, asset_kind, provider.generate_image(prompts[asset_kind], negative_prompt=route.get("negative_prompt")), prompts[asset_kind])
    _task_update(task["id"], progress=90)
    return {"manual_version_id": version_id, "asset_kind": asset_kind, "asset_id": asset_id}


def _manual_export_snapshot(connection: Any, project_id: str, version_id: str) -> dict[str, Any]:
    version = decode_record(row_dict(connection.execute(
        "SELECT * FROM manual_versions WHERE id = ? AND project_id = ?", (version_id, project_id)
    ).fetchone()) or {})
    if not version:
        raise ProviderError("manual_not_found", "找不到需要导出的手册版本")
    assets = [decode_record(dict(row)) for row in connection.execute(
        """SELECT manual_assets.*, media_assets.storage_key, media_assets.original_name, media_assets.mime_type
           FROM manual_assets LEFT JOIN media_assets ON media_assets.id = manual_assets.media_asset_id
           WHERE manual_assets.manual_version_id = ? ORDER BY manual_assets.created_at""", (version_id,)
    )]
    return {"version": version, "assets": assets}


def _build_pdf(snapshot: dict[str, Any], destination: Path) -> None:
    try:
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import mm
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.pdfbase.pdfmetrics import registerFont, stringWidth
        from reportlab.pdfgen import canvas
    except ImportError as exc:
        raise ProviderError("pdf_dependency_missing", "PDF 生成依赖尚未安装") from exc
    registerFont(UnicodeCIDFont("STSong-Light"))
    content = snapshot["version"]["content"]
    palette = content.get("color_palette") if isinstance(content.get("color_palette"), list) else []
    colors = [str(item) for item in palette if str(item).startswith("#")][:4]
    colors += ["#18372B", "#2B6173", "#D5A72B", "#F7F1E3"][len(colors):]
    logo_asset = next((asset for asset in snapshot["assets"] if asset.get("kind") == "logo_mark"), None)
    logo_path = Path(settings.media_directory) / str(logo_asset.get("storage_key") or "") if logo_asset else None
    slides = build_brand_manual_slides(content)

    destination.parent.mkdir(parents=True, exist_ok=True)
    width, height = landscape(A4)
    document = canvas.Canvas(str(destination), pagesize=(width, height))

    def wrapped(value: str, font_size: float, max_width: float) -> list[str]:
        lines, current = [], ""
        for char in value:
            candidate = current + char
            if current and stringWidth(candidate, "STSong-Light", font_size) > max_width:
                lines.append(current)
                current = char
            else:
                current = candidate
        if current:
            lines.append(current)
        return lines or [""]

    for page_no, (label, title_text, body_text, kind) in enumerate(slides, start=1):
        document.setFillColor(HexColor("#FFFDF7"))
        document.rect(0, 0, width, height, fill=1, stroke=0)
        document.setFillColor(HexColor(colors[0]))
        document.rect(0, 0, 8 * mm, height, fill=1, stroke=0)
        document.setFillColor(HexColor("#6F786F"))
        document.setFont("STSong-Light", 9)
        document.drawString(24 * mm, height - 18 * mm, f"{label}  ·  {page_no:02d} / {len(slides):02d}")
        document.setFillColor(HexColor("#18201D"))
        document.setFont("STSong-Light", 27 if kind != "cover" else 34)
        y = height - 42 * mm
        for line in wrapped(title_text, 27 if kind != "cover" else 34, 156 * mm):
            document.drawString(24 * mm, y, line)
            y -= 13 * mm
        if kind in {"cover", "logo"} and logo_path and logo_path.is_file():
            document.drawImage(str(logo_path), width - 82 * mm, 48 * mm, width=48 * mm, height=48 * mm, preserveAspectRatio=True, anchor="c", mask="auto")
        elif kind in {"cover", "logo"}:
            document.setStrokeColor(HexColor("#BFC7C0"))
            document.rect(width - 82 * mm, 48 * mm, 48 * mm, 48 * mm, fill=0, stroke=1)
            document.setFont("STSong-Light", 13)
            document.drawCentredString(width - 58 * mm, 70 * mm, "LOGO")
        if kind == "system":
            for index, color in enumerate(colors):
                x = 24 * mm + index * 36 * mm
                document.setFillColor(HexColor(color))
                document.roundRect(x, 40 * mm, 29 * mm, 29 * mm, 2 * mm, fill=1, stroke=0)
                document.setFillColor(HexColor("#454D48"))
                document.setFont("STSong-Light", 8)
                document.drawString(x, 34 * mm, color.upper())
        else:
            document.setFillColor(HexColor(colors[1]))
            document.setFont("STSong-Light", 15 if kind != "point" else 18)
            body_y = min(y - 3 * mm, 78 * mm)
            for line in wrapped(body_text, 15 if kind != "point" else 18, 150 * mm)[:5]:
                document.drawString(24 * mm, body_y, line)
                body_y -= 9 * mm
        document.setFillColor(HexColor("#9A9F9A"))
        document.setFont("STSong-Light", 8)
        document.drawRightString(width - 18 * mm, 11 * mm, "贵品风物志 · 品牌手册 PPT 渲染")
        document.showPage()
    document.save()


def _generate_exports(task: dict[str, Any]) -> dict[str, Any]:
    request = json.loads(task["input_snapshot_json"])
    version_id = request["manual_version_id"]
    formats = request.get("formats") or ["pdf", "zip"]
    with connect() as connection:
        snapshot = _manual_export_snapshot(connection, task["project_id"], version_id)
    base_dir = Path(settings.media_directory) / task["project_id"] / "exports"
    base_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, Any] = {"exports": []}
    pdf_path = base_dir / f"brand-manual-{version_id}.pdf"
    if "pdf" in formats or "zip" in formats:
        _build_pdf(snapshot, pdf_path)
    for index, export_format in enumerate(formats, start=1):
        export_id = new_id()
        if export_format == "pdf":
            path = pdf_path
        elif export_format == "zip":
            path = base_dir / f"brand-assets-{version_id}.zip"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("brand-manual.json", json.dumps(snapshot["version"]["content"], ensure_ascii=False, indent=2))
                archive.writestr("README.txt", "贵品风物志品牌资产工作稿。AI图像仅作概念参考；公开事实请回看证据状态。")
                archive.write(pdf_path, "brand-manual.pdf")
                for asset in snapshot["assets"]:
                    source = Path(settings.media_directory) / str(asset.get("storage_key") or "")
                    if source.is_file():
                        archive.write(source, f"visual-assets/{asset.get('kind')}-{source.name}")
        else:
            continue
        relative_key = str(path.relative_to(Path(settings.media_directory))).replace("\\", "/")
        with connect() as connection:
            connection.execute(
                """INSERT INTO exports (id, project_id, manual_version_id, format, storage_key, status, error_code, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'succeeded', NULL, ?, ?)""",
                (export_id, task["project_id"], version_id, export_format, relative_key, now(), now()),
            )
        result["exports"].append({"id": export_id, "format": export_format, "download_url": f"/api/exports/{export_id}/download"})
        _task_update(task["id"], progress=35 + index * 30)
    return result


def hash_share_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
