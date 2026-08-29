"use client";

import { ChangeEvent, CSSProperties, KeyboardEvent, useMemo, useState } from "react";
import { api, createRequestId, encodeFileNameForHeader } from "@/lib/api";
import type { Direction, ManualAsset, WorkflowTask, Workspace } from "@/components/workbench-app";

type Content = Record<string, unknown>;
type SellingPoint = { category: "产品创新" | "创新活动策划"; explanation: string; text?: string; claimIds?: string[] };
export type ManualVisualPreferences = { logo_mode: "upload" | "ai"; logo_media_asset_id?: string; font_family: string; font_label: string; palette: string[] };

const DEFAULT_PALETTE = ["#18372B", "#2B6173", "#D5A72B", "#F7F1E3"];
const FONT_OPTIONS = [
  { value: "Source Han Serif SC", label: "思源宋体 / 思源黑体" },
  { value: "Source Han Sans SC", label: "思源黑体 / 思源宋体" },
  { value: "system-ui", label: "现代无衬线 / 系统字体" },
];

function routeContent(route?: Direction): Content { return (route?.content_json ?? route?.content ?? {}) as Content; }
function text(value: unknown, fallback = "") { return typeof value === "string" && value.trim() ? value : fallback; }
function list(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
function pointList(value: unknown): SellingPoint[] {
  const raw = Array.isArray(value) ? value : [];
  const points = raw.slice(0, 3).map((item) => {
    const point = typeof item === "object" && item ? item as Content : { text: String(item) };
    return { category: point.category === "创新活动策划" ? "创新活动策划" : "产品创新", explanation: text(point.explanation, text(point.text)), text: text(point.text), claimIds: list(point.claimIds) } as SellingPoint;
  });
  while (points.length < 3) points.push({ category: points.length === 2 ? "创新活动策划" : "产品创新", explanation: "尚未生成", claimIds: [] });
  return points;
}

function buildDraft(workspace: Workspace): Content {
  const current = workspace.directions.find((route) => route.state === "current");
  const source = { ...routeContent(current), ...(workspace.manual?.content ?? {}) };
  const strategy = typeof source.brand_strategy === "object" && source.brand_strategy ? source.brand_strategy as Content : {};
  const story = typeof source.story_system === "object" && source.story_system ? source.story_system as Content : {};
  const palette = list(source.color_palette).filter((value) => /^#[0-9a-f]{6}$/i.test(value)).slice(0, 4);
  const oneLiner = text(source.brand_one_liner, "待生成品牌一句话"); const existingSlogan = text(source.slogan);
  return { ...source, display_name: text(source.display_name, workspace.project.brand_name), cover_subtitle: text(source.cover_subtitle, "品牌手册"), logo_note: text(source.logo_note), logo_design: text(source.logo_design, text((source.visual_system as Content | undefined)?.logo_direction)), font_family: text(source.font_family, FONT_OPTIONS[0].value), font_label: text(source.font_label, FONT_OPTIONS[0].label), color_palette: [...palette, ...DEFAULT_PALETTE.slice(palette.length)].slice(0, 4), brand_one_liner: oneLiner, slogan: existingSlogan && existingSlogan !== oneLiner ? existingSlogan : "待生成独立口号", target_audience: text(source.target_audience, text(strategy.audience)), target_scenarios: text(source.target_scenarios, Array.isArray(strategy.scenarios) ? strategy.scenarios.join("、") : text(strategy.scenarios)), story_spine: text(source.story_spine, text(story.main_story, text(source.brand_introduction))), selling_points: pointList(source.selling_points) };
}

async function extractPalette(file: File): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas"); canvas.width = 48; canvas.height = 48;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return DEFAULT_PALETTE;
  context.drawImage(bitmap, 0, 0, 48, 48); bitmap.close();
  const pixels = context.getImageData(0, 0, 48, 48).data;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 180) continue;
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    if (r > 244 && g > 244 && b > 244) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`; const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1; bucket.r += r; bucket.g += g; bucket.b += b; buckets.set(key, bucket);
  }
  const candidates = [...buckets.values()].sort((a, b) => b.count - a.count).map((bucket) => [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]);
  const selected: number[][] = [];
  for (const color of candidates) { if (selected.every((other) => Math.hypot(color[0] - other[0], color[1] - other[1], color[2] - other[2]) > 58)) selected.push(color); if (selected.length === 4) break; }
  const toHex = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return [...selected.map((color) => `#${toHex(color[0])}${toHex(color[1])}${toHex(color[2])}`.toUpperCase()), ...DEFAULT_PALETTE].slice(0, 4);
}

function RouteProgress({ task, onRetry }: { task: WorkflowTask; onRetry: (id: string) => void }) {
  const failed = task.status === "failed";
  const failureMessage = typeof task.result?.message === "string" ? task.result.message : task.error_code === "provider_timeout" ? "模型请求超时，可重试。" : "生成未完成，可重试。";
  return <section className={`manual-progress-stage${failed ? " is-failed" : ""}`} role="status"><span className="manual-progress-seal">{failed ? "停" : "定"}</span><p className="eyebrow">品牌路线 · {failed ? "生成失败" : "正在整理"}</p><h1>{failed ? "三条路线未生成完成" : "正在生成三条差异路线"}</h1><p>{failed ? failureMessage : "档案事实与视觉偏好会一起冻结保存。生成完成后，再由你选择其中一条路线。"}</p>{!failed && <progress value={task.progress ?? 8} max={100} />}{failed && <button className="secondary-button" onClick={() => onRetry(task.id)}>重试生成路线</button>}</section>;
}

function ManualUnavailable({ current, busy, onRefresh, onSelect, onFailure }: { current: Direction; busy: boolean; onRefresh: () => Promise<void>; onSelect: (id: string) => Promise<boolean>; onFailure: (message: string) => void }) {
  return <section className="manual-progress-stage is-failed" role="alert"><span className="manual-progress-seal">停</span><p className="eyebrow">品牌手册 · 初始化异常</p><h1>路线已选定，但手册尚未就绪</h1><p>这不会影响已选路线。请先刷新；若仍未恢复，可重新确认当前路线来补建可编辑手册。</p><div className="manual-unavailable-actions"><button className="secondary-button" disabled={busy} onClick={() => void onRefresh().catch(() => onFailure("手册刷新失败，请稍后重试。"))}>刷新手册</button><button className="primary-button" disabled={busy} onClick={() => void onSelect(current.id)}>重新确认当前路线</button></div></section>;
}

function Setup({ workspace, busy, onGenerate, onFailure }: { workspace: Workspace; busy: boolean; onGenerate: (preferences: ManualVisualPreferences) => Promise<void>; onFailure: (message: string) => void }) {
  const [logoMode, setLogoMode] = useState<"upload" | "ai">("upload");
  const [logoPreview, setLogoPreview] = useState(""); const [logoAssetId, setLogoAssetId] = useState("");
  const [font, setFont] = useState(FONT_OPTIONS[0]); const [palette, setPalette] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false); const [notice, setNotice] = useState("");
  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setUploading(true); setNotice(""); setLogoPreview(URL.createObjectURL(file));
    try {
      const [colors, uploaded] = await Promise.all([extractPalette(file), api<{ data: { id: string } }>("/media", { method: "POST", body: file, headers: { "Content-Type": file.type || "image/png", "X-Project-ID": workspace.project.id, "X-File-Name": encodeFileNameForHeader(file.name) } })]);
      setPalette(colors); setLogoAssetId(uploaded.data.id); setNotice("Logo 已上传，并提取出 4 个候选色。你仍可逐个调整。");
    } catch { const message = "Logo 上传或取色未完成，请换一张图片重试。"; setNotice(message); onFailure(message); } finally { setUploading(false); }
  }
  const canGenerate = logoMode === "ai" || Boolean(logoAssetId);
  return <section className="manual-onboarding-page"><header><div><p className="eyebrow">品牌手册</p><h1>品牌手册</h1><p>选择 Logo、字体和颜色。</p></div><img src="/guipin/assets/sticker-custom.png" alt="" /></header><ol className="manual-setup-steps">
    <li><article><span>01</span><div><h2>Logo</h2><p>上传已有 Logo，或比较三条方案。</p></div></article><div className="manual-choice-row"><button className={logoMode === "upload" ? "is-selected" : ""} onClick={() => setLogoMode("upload")}>上传 Logo</button><button className={logoMode === "ai" ? "is-selected" : ""} onClick={() => setLogoMode("ai")}>比较文字方案</button></div>{logoMode === "upload" ? <label className="manual-logo-drop">{logoPreview ? <img src={logoPreview} alt="上传 Logo 预览" /> : <span>选择 PNG、JPG 或 WebP</span>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} /></label> : <div className="manual-ai-logo-note"><p>生成路线后选择一条，再生成 Logo。</p></div>}{notice && <small className="manual-setup-notice">{notice}</small>}</li>
    <li><article><span>02</span><div><h2>字体</h2><p>选择字体。</p></div></article><div className="manual-font-options">{FONT_OPTIONS.map((option) => <button key={option.value} className={font.value === option.value ? "is-selected" : ""} style={{ fontFamily: option.value }} onClick={() => setFont(option)}>{option.label}</button>)}</div></li>
    <li><article><span>03</span><div><h2>颜色</h2><p>{logoAssetId ? "已从上传 Logo 提取四个候选色。" : "AI 将先给出三条路线各自的配色方案与提炼依据。"}</p></div></article>{palette.length ? <div className="manual-palette-fields">{palette.map((color, index) => <label key={`${index}-${color}`}><input type="color" value={color} onChange={(event) => setPalette((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value.toUpperCase() : item))} /><input value={color} maxLength={7} onChange={(event) => setPalette((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value.toUpperCase() : item))} aria-label={`候选色 ${index + 1}`} /></label>)}</div> : <p className="manual-route-palette-note">选择路线前不预设通用色板，避免不同品牌使用同一套配色。</p>}</li>
  </ol><footer><button className="primary-button" disabled={busy || uploading || !canGenerate} onClick={() => onGenerate({ logo_mode: logoMode, logo_media_asset_id: logoAssetId || undefined, font_family: font.value, font_label: font.label, palette })}>{uploading ? "正在读取 Logo…" : busy ? "正在生成…" : "生成三条品牌路线 →"}</button></footer></section>;
}

function RouteCompare({ routes, busy, onSelect, onRegenerate }: { routes: Direction[]; busy: boolean; onSelect: (id: string) => Promise<boolean>; onRegenerate: () => void }) {
  const [selected, setSelected] = useState("");
  return <section className="manual-route-page"><header><p className="eyebrow">品牌手册</p><h1>选择品牌路线</h1><p>比较受众、场景和视觉方向。</p></header><div className="manual-route-compare">{routes.map((route, index) => { const content = routeContent(route); const palette = list(content.color_palette).filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 4); return <article key={route.id} className={selected === route.id ? "is-selected" : ""}><span>ROUTE {String(index + 1).padStart(2, "0")}</span><h2>{route.title.replace(/^路线[一二三]｜/, "")}</h2><p className="manual-route-line">{text(content.brand_one_liner, "尚未生成")}</p><dl><div><dt>独立口号</dt><dd>{text(content.slogan, "尚未生成")}</dd></div><div><dt>目标人群</dt><dd>{text(content.target_audience, "尚未生成")}</dd></div><div><dt>核心场景</dt><dd>{list(content.target_scenarios).join(" · ") || text(content.target_scenarios, "尚未生成")}</dd></div><div><dt>颜色方案</dt><dd><span className="manual-route-swatches">{palette.map((color) => <i key={color} style={{ backgroundColor: color }} title={color} />)}</span>{text(content.color_rationale, "待补充颜色提炼依据")}</dd></div><div><dt>故事主线</dt><dd>{text(content.story_spine, "尚未生成")}</dd></div><div className="manual-logo-concept"><dt>Logo 设计方案</dt><dd>{text(content.logo_design, "尚未生成")}</dd></div></dl><ul>{pointList(content.selling_points).map((point, pointIndex) => <li key={pointIndex}><small>{point.category}</small>{point.explanation}</li>)}</ul><div className="manual-route-keywords">{list(content.visual_keywords).slice(0, 4).map((word) => <i key={word}>{word}</i>)}</div><button className="primary-button" disabled={busy} onClick={async () => { setSelected(route.id); await onSelect(route.id); }}>选择这条路线</button></article>; })}</div><footer><button className="text-button" disabled={busy} onClick={onRegenerate}>三条都不合适，重新生成</button><span>确认后生成品牌手册。</span></footer></section>;
}

function Logo({ asset }: { asset?: ManualAsset }) { return asset?.url ? <img className="manual-slide-logo" src={asset.url} alt="品牌 Logo" /> : <div className="manual-slide-logo-placeholder"><small>尚未生成</small></div>; }
function Pattern({ asset }: { asset?: ManualAsset }) { return asset?.url ? <img className="manual-slide-logo" src={asset.url} alt="品牌延展纹样" /> : <div className="manual-slide-logo-placeholder manual-pattern-placeholder"><small>尚未生成</small></div>; }

export function BrandManualResult({ workspace, logoTask, patternTask, exportTask, demoMode, busy, onGenerate, onSelect, onSave, onRefresh, onRetry, onGenerateAsset, onFailure, onOpenArchive, onNext }: { workspace: Workspace; logoTask?: WorkflowTask; patternTask?: WorkflowTask; exportTask?: WorkflowTask; demoMode: boolean; busy: boolean; onGenerate: (preferences: ManualVisualPreferences) => Promise<void>; onSelect: (id: string) => Promise<boolean>; onSave: (content: Content) => Promise<void>; onRefresh: () => Promise<void>; onRetry: (id: string) => void; onGenerateAsset: (kind: "extension_pattern" | "packaging_key_visual") => Promise<void>; onFailure: (message: string) => void; onOpenArchive: () => void; onNext: () => void }) {
  const latestVersion = Math.max(0, ...workspace.directions.map((route) => route.version ?? 0));
  const routes = workspace.directions.filter((route) => route.state !== "superseded" && (route.version ?? 0) === latestVersion);
  const current = workspace.directions.find((route) => route.state === "current"); const routeTask = workspace.tasks?.find((task) => task.kind === "route_generation");
  const [draft, setDraft] = useState<Content>(() => buildDraft(workspace)); const [slide, setSlide] = useState(0); const [editing, setEditing] = useState(false); const [exporting, setExporting] = useState(false); const [notice, setNotice] = useState("");
  const logo = [...(workspace.manual_assets ?? [])].reverse().find((asset) => asset.kind === "logo_mark"); const pattern = [...(workspace.manual_assets ?? [])].reverse().find((asset) => asset.kind === "extension_pattern"); const palette = list(draft.color_palette).slice(0, 4); const points = pointList(draft.selling_points);
  const slides = useMemo(() => ["首页", "Logo", "字体 / 颜色", "品牌一句话", "口号", "目标人群 / 场景", "故事主线", "卖点 01", "卖点 02", "卖点 03"], []);

  if (!workspace.manual && !current && routeTask && ["queued", "running", "failed"].includes(routeTask.status)) return <RouteProgress task={routeTask} onRetry={onRetry} />;
  if (!workspace.manual && !current && routes.length >= 3) return <RouteCompare routes={routes.slice(0, 3)} busy={busy} onSelect={onSelect} onRegenerate={() => void onGenerate(((routeContent(routes[0]).visual_preferences ?? { logo_mode: "ai", font_family: FONT_OPTIONS[0].value, font_label: FONT_OPTIONS[0].label, palette: DEFAULT_PALETTE }) as ManualVisualPreferences))} />;
  if (!workspace.manual && !current) return <Setup workspace={workspace} busy={busy} onGenerate={onGenerate} onFailure={onFailure} />;
  if (!workspace.manual && current) return <ManualUnavailable current={current} busy={busy} onRefresh={onRefresh} onSelect={onSelect} onFailure={onFailure} />;

  function setField(key: string, nextValue: unknown) { setDraft((currentDraft) => ({ ...currentDraft, [key]: nextValue })); }
  function setPoint(index: number, key: keyof SellingPoint, value: string) { const next = pointList(draft.selling_points); next[index] = { ...next[index], [key]: value }; setDraft((currentDraft) => ({ ...currentDraft, selling_points: next })); }
  async function save() { await onSave({ ...draft, brand_name: workspace.project.brand_name, selling_points: pointList(draft.selling_points) }); setEditing(false); setNotice("这一版修改已保存，并写入版本历史。"); }
  async function createExports() { if (demoMode) { setNotice("演示模式不生成真实下载文件。"); return; } setExporting(true); try { await api(`/projects/${workspace.project.id}/brand-manual/exports`, { method: "POST", headers: { "Idempotency-Key": createRequestId("manual-export") }, body: JSON.stringify({ formats: ["pdf", "zip"] }) }); await onRefresh(); setNotice("导出任务已创建，完成后下载入口会出现在目录底部。"); } catch { onFailure("导出任务创建失败，请重试。"); } finally { setExporting(false); } }
  async function replaceLogo(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setNotice("正在替换 Logo…"); try { const uploaded = await api<{ data: { id: string } }>("/media", { method: "POST", body: file, headers: { "Content-Type": file.type || "image/png", "X-Project-ID": workspace.project.id, "X-File-Name": encodeFileNameForHeader(file.name) } }); await api(`/projects/${workspace.project.id}/brand-manual/assets/logo_mark`, { method: "POST", body: JSON.stringify({ media_asset_id: uploaded.data.id }) }); const colors = await extractPalette(file); const next = { ...draft, logo_media_asset_id: uploaded.data.id, logo_mode: "upload", color_palette: colors }; setDraft(next); await onSave(next); await onRefresh(); setNotice("Logo 已替换，并同步更新了四色候选方案。"); } catch { const message = "Logo 替换失败，请重试。"; setNotice(message); onFailure(message); } }
  function handleKeys(event: KeyboardEvent<HTMLElement>) { if (editing) return; if (event.key === "ArrowRight") setSlide((index) => Math.min(slides.length - 1, index + 1)); if (event.key === "ArrowLeft") setSlide((index) => Math.max(0, index - 1)); }
  const editableText = (key: string, multiline = true) => editing ? (multiline ? <textarea value={text(draft[key])} onChange={(event) => setField(key, event.target.value)} /> : <input value={text(draft[key])} onChange={(event) => setField(key, event.target.value)} />) : <p>{text(draft[key], "尚未生成")}</p>;

  return <section className="manual-deck-page" tabIndex={0} onKeyDown={handleKeys} aria-label={`${workspace.project.brand_name} 品牌手册`}><header className="manual-deck-top"><button className="text-button" onClick={onOpenArchive}>← 品牌档案</button><div><span className="manual-current-tag">当前路线</span><b>{current?.title ?? "尚未生成"}</b></div></header><div className="manual-deck-layout">
    <article className="manual-slide-canvas" style={{ "--manual-primary": palette[0] ?? DEFAULT_PALETTE[0], "--manual-secondary": palette[1] ?? DEFAULT_PALETTE[1] } as CSSProperties}>
      {slide === 0 && <section className="manual-slide cover-slide"><div><span>品牌手册</span>{editing ? <input className="manual-cover-name-input" value={text(draft.display_name)} onChange={(event) => setField("display_name", event.target.value)} /> : <h1>{text(draft.display_name, workspace.project.brand_name)}</h1>}{editableText("cover_subtitle", false)}</div><Logo asset={logo} /></section>}
      {slide === 1 && <section className="manual-slide logo-slide"><header><span>01</span><h1>Logo / 延展纹样</h1></header><div className="manual-logo-layout"><section className="manual-visual-asset"><small>最终 Logo</small><Logo asset={logo} />{logoTask?.status === "running" || logoTask?.status === "queued" ? <em>正在生成最终 Logo · {logoTask.progress}%</em> : logoTask?.status === "failed" ? <button className="text-button" onClick={() => onRetry(logoTask.id)}>Logo 生成失败，重试</button> : logo ? <em>已沉淀至品牌资产</em> : <em>尚未生成</em>}</section><section className="manual-visual-asset"><small>延展纹样</small><Pattern asset={pattern} />{patternTask?.status === "running" || patternTask?.status === "queued" ? <em>正在生成纹样 · {patternTask.progress}%</em> : patternTask?.status === "failed" ? <button className="text-button" onClick={() => onRetry(patternTask.id)}>纹样生成失败，重试</button> : pattern ? <em>已保存为品牌资产</em> : !demoMode && <button className="text-button" onClick={() => void onGenerateAsset("extension_pattern")}>生成延展纹样</button>}</section><section className="manual-logo-plan"><small>已选定的设计方案</small>{editing ? <><textarea value={text(draft.logo_design)} onChange={(event) => setField("logo_design", event.target.value)} /><textarea value={text(draft.logo_note)} onChange={(event) => setField("logo_note", event.target.value)} /><label className="manual-replace-logo">替换 Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={replaceLogo} /></label></> : <><p>{text(draft.logo_design, "尚未生成")}</p><small>{text(draft.logo_note)}</small></>}</section></div></section>}
      {slide === 2 && <section className="manual-slide system-slide"><header><span>02</span><h1>字体 / 颜色</h1></header><div className="manual-system-grid"><section><small>字体方案</small>{editing ? <select value={text(draft.font_family)} onChange={(event) => { const option = FONT_OPTIONS.find((item) => item.value === event.target.value) ?? FONT_OPTIONS[0]; setDraft((value) => ({ ...value, font_family: option.value, font_label: option.label })); }}>{FONT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : <h2 style={{ fontFamily: text(draft.font_family) }}>{text(draft.font_label)}</h2>}<p>标题与正文的字体组合。</p></section><section><small>品牌四色</small><div className="manual-slide-swatches">{palette.map((color, index) => <label key={`${color}-${index}`}><i style={{ backgroundColor: color }} />{editing ? <input value={color} onChange={(event) => { const next = [...palette]; next[index] = event.target.value.toUpperCase(); setField("color_palette", next); }} /> : <b>{color}</b>}</label>)}</div></section></div></section>}
      {slide === 3 && <section className="manual-slide statement-slide"><header><span>03</span><h1>品牌一句话</h1></header><blockquote>{editableText("brand_one_liner")}</blockquote><small>用一句话说明品牌是谁、来自哪里、为谁带来什么。</small></section>}
      {slide === 4 && <section className="manual-slide statement-slide slogan-slide"><header><span>04</span><h1>口号</h1></header><blockquote>{editableText("slogan")}</blockquote><small>适用于包装正面、传播标题与品牌落款。</small></section>}
      {slide === 5 && <section className="manual-slide audience-slide"><header><span>05</span><h1>目标人群 / 场景</h1></header><div><section><small>目标人群</small>{editableText("target_audience")}</section><section><small>核心消费场景</small>{editableText("target_scenarios")}</section></div></section>}
      {slide === 6 && <section className="manual-slide story-slide"><header><span>06</span><h1>故事主线</h1></header><small>一句话品牌故事</small>{editableText("story_spine")}</section>}
      {slide >= 7 && <section className="manual-slide point-slide"><header><span>{String(slide).padStart(2, "0")}</span><h1>核心卖点 {String(slide - 6).padStart(2, "0")}</h1></header><div><small>卖点类别</small>{editing ? <select value={points[slide - 7].category} onChange={(event) => setPoint(slide - 7, "category", event.target.value)}><option>产品创新</option><option>创新活动策划</option></select> : <h2>{points[slide - 7].category}</h2>}<small>卖点解释</small>{editing ? <textarea value={points[slide - 7].explanation} onChange={(event) => setPoint(slide - 7, "explanation", event.target.value)} /> : <p>{points[slide - 7].explanation}</p>}</div></section>}
      <footer><span>{String(slide + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span><b>{text(draft.display_name, workspace.project.brand_name)}</b></footer>
    </article>
    <aside className="manual-deck-directory"><header><span>▣</span><h2>目录</h2></header><nav>{slides.map((label, index) => <button key={label} className={index === slide ? "is-current" : ""} onClick={() => setSlide(index)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav><div className="manual-deck-actions">{editing ? <><button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存本页修改"}</button><button className="secondary-button" onClick={() => { setDraft(buildDraft(workspace)); setEditing(false); }}>取消</button></> : <button className="primary-button" onClick={() => setEditing(true)}>✎ 编辑本页</button>}<button className="secondary-button" disabled={exporting} onClick={() => void createExports()}>{exporting ? "正在创建…" : "↓ 导出 PDF / 图包"}</button>{workspace.exports?.filter((item) => item.download_url).slice(0, 2).map((item) => <a key={item.id} href={item.download_url}>下载 {item.format.toUpperCase()}</a>)}<button className="text-button" onClick={onNext}>继续观潮 →</button></div></aside>
  </div><footer className="manual-deck-pager"><button disabled={slide === 0} onClick={() => setSlide((index) => index - 1)}>← 上一页</button><span>{notice || (exportTask && ["queued", "running"].includes(exportTask.status) ? `正在导出 ${exportTask.progress}%` : "可用左右方向键翻页")}</span><button disabled={slide === slides.length - 1} onClick={() => setSlide((index) => index + 1)}>下一页 →</button></footer></section>;
}
