# 贵品风物志｜当前数据与 API 契约

SQLite 默认位于 `data/mountainlore.db`，媒体位于 `data/media`；运行服务后以 `/docs` 和 `/openapi.json` 为实际 OpenAPI 权威。

## 闭环

```text
User (optional for anonymous use) → Project → Session / Message / MediaAsset
  → FieldNote → SourceRecord → Claim
  → Candidate → ArchiveCard ↔ Claim
  → Task(route_generation) → BrandDirection × 2
  → Task(manual_generation) → BrandManual + ManualVersion + ManualAsset × 3
  → Task(export) → PDF / ZIP
  → immutable ShareSnapshot
```

只有同时满足以下条件的事实可进入公开卖点：

- 关联 `ArchiveCard.status=active`；
- `Claim.status` 为 `confirmed` 或 `corrected`；
- `Claim.public_allowed=true`。

旧档案会自动补建 `legacy_import` 来源和 `pending` 事实，且 `public_allowed=false`。内容不会丢失，但不能被自动当作公开卖点。

## 当前接口

| 阶段 | 接口 | 服务端保证 |
|---|---|---|
| 账号 | `POST /auth/register` | 创建邮箱密码账号；将当前浏览器尚未归属账号的采风项目迁入该账号 |
| 账号 | `POST /auth/login`、`POST /auth/logout`、`GET /auth/me` | 使用 HttpOnly 会话 Cookie 跨设备恢复项目目录；登录仍会合并当前浏览器匿名项目 |
| 访客 | `POST /visitors` | HttpOnly Cookie 恢复当前浏览器项目；项目与媒体按访客隔离 |
| 建档 | `POST /projects` | 保存品牌、产业、产品、产地和授权状态 |
| 采风 | `POST /sessions` | 每项目一个可恢复采风会话 |
| 采风 | `POST /sessions/{id}/messages` | 结构化笔记、来源、候选事实和不重复的下一问；最多四轮回答 |
| 采风 | `POST /sessions/{id}/finish` | 结束采风并生成逐张待确认候选卡 |
| 编志 | `POST /candidates/{id}/confirm|discard` | 确认后建立档案—事实关联；弃用事实不进入下游 |
| 编志 | `POST /projects/{id}/chronicle/confirm` | 冻结档案与事实快照，幂等启动恰好两版方案任务 |
| 定调 | `POST /projects/{id}/directions` | 仅用于显式重新生成；创建新版本，不覆盖已选路线 |
| 定调 | `POST /directions/{id}/select` | 选择路线并启动完整手册生成任务 |
| 手册 | `GET/PATCH /projects/{id}/brand-manual` | 保存当前编辑；每次保存新增不可变版本 |
| 资产 | `GET /media/{asset_id}` | 校验项目访客权限后返回上传或生成资产 |
| 资产 | `POST /projects/{id}/brand-manual/assets/{kind}` | 将用户上传 Logo 等资产持久绑定到当前手册版本 |
| 导出 | `POST /projects/{id}/brand-manual/exports` | 后台生成可打开的 PDF 与视觉 ZIP |
| 分享 | `POST /projects/{id}/brand-manual/shares` | 创建不可变快照；可撤销，撤销后公开链接失效 |
| 任务 | `GET /tasks/{id}`、`GET /tasks/{id}/events` | 状态、进度、错误与结果可恢复；启动时重排队中断任务 |
| 任务 | `POST /tasks/{id}/retry` | 只重试失败或部分完成的同一任务，不重新创建幂等请求 |
| 观潮 | `GET /projects/{id}/tide-report` | 读取共享的本周自动周报；仅已定调项目可访问 |
| 观潮 | `POST /projects/{id}/tide-report-ideas/{idea_id}/favorite` | 按项目收藏或取消收藏一条共享灵感 |
| 观潮 | `POST /projects/{id}/tide-report-ideas/{idea_id}/use` | 将共享灵感作为当前项目的出山创意上下文 |
| 出山 | `POST /projects/{id}/generation-previews` | 生成预览；用户确认保存后才进入历史记录 |

## 模型适配器与 Key

- 采风/编志、品牌方案/手册、视觉理解和观潮共享服务端 `OPENAI_NEXT_API_KEY`。观潮周报仅在 `AI_RUNTIME_MODE=live` 时由 Sonar 每周一 09:00（中国时区）自动刷新；未配置或验链不足时保留上一期成功周报，不伪造热点。
- 图片优先使用 `OPENAI_NEXT_IMAGE_API_KEY`，未设置时回退统一 Key。
- Key 从不返回前端；`GET /provider/readiness` 只返回逐能力配置状态与模型名。
- PDF、ZIP、本地 SQLite、媒体读取和分享快照不调用第三方服务。

## 任务与版本

`tasks` 保存 `input_snapshot`、进度、尝试次数、幂等键、错误码和结果。路线和手册均以冻结输入生成；重新生成创建新版本。手册同时保存原始生成快照、当前编辑内容和不可变版本，切换路线不会覆盖旧版本或用户修改。

图像失败时手册任务为 `partial`：文字手册与已完成图片保留，用户可重试未完成阶段。三类手册视觉资产固定为无文字 Logo 图形方向、包装主视觉和延展纹样；免责声明只保存在界面与元数据中。

## 本地验证

```powershell
cd D:\2026贵客松\MoutainLore
python -X utf8 -m pytest -q --basetemp D:\2026贵客松\.tmp_mountainlore_pytest
cd frontend
npm run lint -- --quiet
npx tsc --noEmit
npm run build
```

闭环测试覆盖事实公开边界、确认编志幂等、固定两版、选择路线生成手册、图片失败保留文字、Logo 持久化、PDF/ZIP 可打开、分享快照不可变和访客权限隔离。

## 登录 MVP 边界

- 邮箱与密码（至少 8 个字符）是唯一登录方式；密码使用 scrypt 哈希保存，明文不会进入数据库或日志。
- 会话有效期默认 30 天，可由 `AUTH_SESSION_TTL_DAYS` 配置。生产 HTTPS 环境必须设 `AUTH_COOKIE_SECURE=true`。
- 此 MVP 不包含邮箱验证、找回密码、多因素认证或团队协作；上线前应补充隐私政策和数据删除流程。
