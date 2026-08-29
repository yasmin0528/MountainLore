"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { api, createRequestId, encodeFileNameForHeader } from "@/lib/api";
import type { ArchiveCard, Claim, Direction, ManualAsset, ManualVersion, Project, Workspace } from "@/components/workbench-app";

type ManualContent = Record<string, unknown>;

const projectColors = ["#205d75", "#205d75", "#566f5c", "#7697a5"];
const projectNames = ["赫章山野刺梨社", "都匀云雾茶 · 试验档", "黔北糟辣椒合作社", "凯里酸汤小作坊"];

function routeContent(route?: Direction) { return (route?.content_json ?? route?.content ?? {}) as ManualContent; }
function words(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
function text(value: unknown, fallback = "") { return typeof value === "string" && value.trim() ? value : fallback; }

export function ProjectDirectory({ projects, onSelect, onDelete, onCreate }: { projects: Project[]; onSelect: (project: Project) => void; onDelete: (project: Project) => void; onCreate: () => void }) {
  const directory = projects.length ? projects : [];
  return <section className="archive-directory">
    <header className="archive-directory-head"><p className="eyebrow">档案</p><h1>先选品牌项目，再翻开它的资料</h1><p>不同品牌各有一套独立的材料、路线和出山记录。</p></header>
    <div className="directory-toolbar"><div><p className="eyebrow">个人品牌项目</p><h2>选定一个项目，再查看它的品牌资料。</h2></div><button className="secondary-button" onClick={onCreate}>＋ 新建品牌档案</button></div>
    <div className="project-directory-grid">
      {directory.map((item, index) => <article className="project-directory-card" key={item.id}>
        <button className="project-directory-open" onClick={() => onSelect(item)} aria-label={`打开 ${item.brand_name} 的品牌资料`}>
          <span className="directory-tab" style={{ backgroundColor: projectColors[index % projectColors.length] }}>{(item.industry || item.core_product || "档").slice(0, 1)}</span>
          <i style={{ backgroundColor: projectColors[index % projectColors.length] }} aria-hidden="true" />
          <small>{item.core_product || item.industry}</small><strong>{item.brand_name || projectNames[index % projectNames.length]}</strong>
        </button>
        <footer><button className="directory-delete" onClick={() => onDelete(item)}>删除</button><b>打开品牌资料 →</b></footer>
      </article>)}
    </div>
    {!directory.length && <div className="empty-state"><p>还没有可翻阅的品牌项目。</p><button className="secondary-button" onClick={onCreate}>从采风开始</button></div>}
    <p className="directory-footnote">每个品牌的资料、判断和出山记录彼此独立。选定项目后，所有侧签只切换该项目的档案卡。</p>
  </section>;
}

export function BrandMaterials({ workspace, onOpenArchive, onOpenManual, onOpenRecords }: { workspace: Workspace; onOpenArchive: () => void; onOpenManual: () => void; onOpenRecords: () => void }) {
  const active = workspace.archive_cards.filter((card) => card.status === "active");
  const current = workspace.directions.find((route) => route.state === "current");
  const manualReady = Boolean(workspace.manual);
  return <section className="materials-page">
    <header className="materials-topline"><span>{workspace.project.origin} · {workspace.project.core_product}</span><small>● 资料已保留</small></header>
    <header className="materials-heading"><p className="eyebrow">档案 · 品牌资料</p><h1>{workspace.project.brand_name} · 品牌资料</h1><p>先翻开一张缩略卡，再查看已经留下的品牌材料。</p></header>
    <div className="materials-shelf">
      <button className="material-thumb archive-thumb" onClick={onOpenArchive}><header><span>档案卡片</span><small>点击抽出档案</small></header><div className="mini-accordion"><i>品牌故事</i><i>产品信息</i><i>{workspace.project.brand_name}</i></div><footer><b>{active.length} 项资料</b><span>翻开 →</span></footer></button>
      <button className={`material-thumb manual-thumb ${manualReady ? "is-ready" : "is-empty"}`} onClick={onOpenManual}><header><span>品牌手册</span><small>{manualReady ? "已生成" : "尚未生成"}</small></header><p className="manual-brand-small">{workspace.project.brand_name}</p><h2>{manualReady ? text(routeContent(current).brand_one_liner, "打开品牌手册") : "Logo、字体与颜色方案待设置"}</h2><div className="mini-manual-image">{manualReady ? <span>HTML SLIDE · {workspace.manual_versions?.length ?? 1} 版</span> : <><i>＋</i><span>首次打开后开始引导</span></>}</div><footer><b>{manualReady ? "打开品牌手册" : "开始定调"}</b><span>查看 →</span></footer></button>
      <button className="material-thumb record-thumb" onClick={onOpenRecords}><header><span>出山记录</span><small>已经做过的版本</small></header><ol>{workspace.generation_jobs.slice(0, 3).map((job) => <li key={job.id}><time>{job.template_type === "xiaohongshu" ? "图文" : "周边"}</time><b>{job.status === "succeeded" ? "概念稿已保存" : "文字 Brief 已保留"}</b></li>)}{!workspace.generation_jobs.length && <li><time>—</time><b>尚未出山</b></li>}</ol><footer><b>{workspace.generation_jobs.length} 次出山</b><span>继续使用 →</span></footer></button>
    </div>
  </section>;
}

function cardLabel(card: ArchiveCard, index: number) {
  if (/产品|规格|包装/i.test(`${card.type}${card.title}`)) return "产品信息";
  if (/工艺|加工|过程/i.test(`${card.type}${card.title}`)) return "加工过程";
  return index % 3 === 2 ? "加工过程" : index % 3 === 1 ? "产品信息" : "品牌故事";
}

export function ArchiveFolioDialog({ project, cards, onClose, onEdit }: { project: Project; cards: ArchiveCard[]; onClose: () => void; onEdit: (card: ArchiveCard) => void }) {
  const active = cards.filter((card) => card.status === "active");
  const [selectedId, setSelectedId] = useState(active[0]?.id ?? "");
  const selected = active.find((card) => card.id === selectedId) ?? active[0];
  const selectedIndex = selected ? active.indexOf(selected) : 0;
  return <div className="archive-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="archive-folio-dialog" role="dialog" aria-modal="true" aria-label={`${project.brand_name} 档案卡`}>
      <button className="folio-mobile-close" aria-label="关闭档案卡" onClick={onClose}>×</button>
      <aside className="folio-rail"><header><strong>档案卡</strong><small>点击抽换</small></header><div className="folio-tabs">{active.map((card, index) => <button key={card.id} className={`folio-sidecard sidecard-${index % 3} ${card.id === selected?.id ? "is-selected" : ""}`} onClick={() => setSelectedId(card.id)} aria-pressed={card.id === selected?.id}><i>{cardLabel(card, index).slice(0, 1)}</i><span><b>{cardLabel(card, index)}</b><small>{card.type}</small></span></button>)}</div><footer><b>{project.origin}档案</b><small>{String(selectedIndex + 1).padStart(2, "0")} / {String(active.length).padStart(2, "0")}</small></footer></aside>
      <article className="folio-paper">{selected ? <><header><p className="eyebrow">品牌档案 · 风物本</p><h2>{project.brand_name}</h2><p>{project.origin} · {active.length} 项已确认资料</p><button className="modal-close" aria-label="关闭档案卡" onClick={onClose}>×</button></header><div className="folio-tab-stack" aria-hidden="true">{active.map((card, index) => <i key={card.id} className={`tab-stack-${index % 3} ${card.id === selected.id ? "is-current" : ""}`}><span>{cardLabel(card, index)}</span></i>)}</div><div className="folio-sheet-stack"><i className="folio-underlay layer-one" /><i className="folio-underlay layer-two" /><section className={`folio-sheet sheet-${selectedIndex % 3}`} key={selected.id}><p className="folio-number">{String(selectedIndex + 1).padStart(2, "0")}</p><p className="folio-section-name">{cardLabel(selected, selectedIndex)}</p><h3>{selected.title}</h3><p>{selected.content}</p><dl><dt>来源</dt><dd>{selected.source_summary ?? "采风确认材料"}</dd><dt>版本</dt><dd>v{selected.content_version} · 已确认</dd></dl><footer><button className="text-button" onClick={() => onEdit(selected)}>编辑这张资料</button><span>点击侧签，抽换同一品牌的资料页</span></footer></section></div></> : <><button className="modal-close" aria-label="关闭档案卡" onClick={onClose}>×</button><div className="empty-state"><p>尚无已确认资料。</p></div></>}</article>
    </section>
  </div>;
}

function toDraft(project: Project, manual: ManualContent | undefined, current?: Direction): ManualContent {
  const source = { ...routeContent(current), ...(manual ?? {}) };
  const strategy = typeof source.brand_strategy === "object" && source.brand_strategy ? source.brand_strategy as ManualContent : {};
  const story = typeof source.story_system === "object" && source.story_system ? source.story_system as ManualContent : {};
  const voice = typeof source.voice === "object" && source.voice ? source.voice as ManualContent : {};
  const visual = typeof source.visual_system === "object" && source.visual_system ? source.visual_system as ManualContent : {};
  const sellingPoints = Array.isArray(source.selling_points) ? source.selling_points : [];
  return { brand_name: project.brand_name, brand_introduction: text(source.brand_introduction, text(source.story_spine, "把已确认的产地、产品与人物资料，整理成一份可继续编辑的品牌介绍。")), slogan: text(source.slogan, text(source.brand_one_liner, "让一口风物，有来处地进入今天。")), target_audience: text(source.target_audience, text(strategy.audience, "待确认目标人群")), target_scenarios: Array.isArray(strategy.scenarios) ? strategy.scenarios.join("、") : text(source.target_scenarios, "待确认消费场景"), story_spine: text(source.story_spine, text(story.main_story, text(source.brand_introduction, "从真实档案中提炼故事主线。"))), selling_points: sellingPoints.length ? sellingPoints : [{ text: "真实产地线索", claimIds: [] }, { text: "已确认的产品信息", claimIds: [] }, { text: "克制的当代表达", claimIds: [] }], evidence_gaps: Array.isArray(source.evidence_gaps) ? source.evidence_gaps : [], visual_scheme: Array.isArray(visual.keywords) ? visual.keywords : words(source.visual_scheme).length ? words(source.visual_scheme) : words(source.visual_keywords), voice_do: text(source.voice_do, text(voice.do, text(source.content_tone, "真诚、清楚、有画面"))), voice_dont: Array.isArray(voice.dont) ? voice.dont : words(source.voice_dont).length ? words(source.voice_dont) : words(source.forbidden_expressions), logo_preview: text(source.logo_preview), disclaimer: text(source.disclaimer, "AI 生成的品牌工作稿；公开卖点仅可使用已确认且允许公开的事实。") };
}

function readerText(value: unknown, fallback = "") {
  const raw = text(value, fallback);
  // 对外草案只呈现可理解的设计理由，不呈现模型的限制性提示或工作指令。
  const positive = raw
    .replace(/(?:不要|不能|不(?:使用|用|以|把|让|写|谈|借|强调|承诺|替代|等同)|避免|拒绝)[^。；;，,]*[。；;，,]?/g, "")
    .replace(/[，、\s]{2,}/g, "，")
    .replace(/^\s*[，、；;]\s*|\s*[，、；;]\s*$/g, "")
    .trim();
  return positive || fallback;
}

function draftList(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    const listed = value.map((item) => readerText(item)).filter(Boolean);
    return listed.length ? listed : fallback;
  }
  const listed = readerText(value).split(/[、，,；;\n]/).map((item) => item.trim()).filter(Boolean);
  return listed.length ? listed : fallback;
}

type DirectionDraftDialogProps = {
  project: Project;
  direction: Direction;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function DirectionDraftDialog({ project, direction, busy, onClose, onConfirm }: DirectionDraftDialogProps) {
  const content = routeContent(direction);
  const strategy = typeof content.brand_strategy === "object" && content.brand_strategy ? content.brand_strategy as ManualContent : {};
  const visual = typeof content.visual_system === "object" && content.visual_system ? content.visual_system as ManualContent : {};
  const brandName = readerText(content.candidate_brand_name, project.brand_name);
  const visualKeywords = draftList(visual.keywords ?? content.visual_keywords, ["山地档案", "果实纹理", "清醒留白"]);
  const audience = readerText(content.target_audience, readerText(strategy.audience, "愿意认识产品来处的年轻消费者"));
  const scenarios = draftList(strategy.scenarios ?? content.target_scenarios, ["通勤或办公桌上的一段清醒时刻", "市集、展销与朋友分享时的认识入口", "围绕产地和产品资料展开的日常交流"]);
  const points = Array.isArray(content.selling_points) && content.selling_points.length ? content.selling_points : ["产地线索", "产品本味", "可分享的认识入口"];
  const firstCharacter = brandName.replace(/[\s·｜|]/g, "").slice(0, 1) || "山";
  const motif = visualKeywords[0] || "山地档案";
  const story = readerText(content.story_spine, `从${project.origin}的${project.core_product}出发，把已经确认的资料整理成一份能被读懂、能继续补充的品牌故事。`);
  const introduction = readerText(content.brand_introduction, story);
  const slogan = readerText(content.slogan, readerText(content.brand_one_liner, "把一份有来处的风物，带进今天。"));
  const voice = readerText(content.content_tone, "克制、具体、有感受");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="archive-modal-backdrop direction-draft-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="direction-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="direction-draft-title">
      <header className="direction-draft-header"><div><p className="eyebrow">定调 / 品牌手册草案</p><h1 id="direction-draft-title">{brandName}｜品牌手册草案</h1><p>这是一份用于比较和确认的品牌方向说明。确认后会据此生成品牌手册。</p></div><button className="modal-close" aria-label="关闭品牌手册草案" onClick={onClose}>×</button></header>
      <div className="direction-draft-paper">
        <section><h2>品牌名字</h2><p className="draft-brand-name">{brandName}</p></section>
        <section><h2>Logo 方向</h2><p>以“{firstCharacter}”字作为主印记，结合{motif}的轮廓与留白，做成清楚、易辨认的图形。它能在瓶身、标签和小尺寸头像上保持一致的识别感。</p></section>
        <section><h2>视觉方案</h2><dl className="direction-visual-ledger"><div><dt>风格</dt><dd>{visualKeywords.join(" · ")}</dd></div><div><dt>颜色</dt><dd>靛蓝、苔绿、花蕊黄、果皮褐红、纸灰</dd></div><div><dt>字体</dt><dd>思源宋体用于标题；思源黑体用于正文和信息标签。</dd></div><div><dt>包装气质</dt><dd>把产品名称、产地和关键信息分层排布，配合纸张纤维和轻微木刻颗粒，让每一面包装都像一张方便翻阅的品牌档案卡。</dd></div></dl></section>
        <section><h2>品牌介绍</h2><p>{introduction}</p></section>
        <section><h2>口号</h2><p className="draft-slogan">{slogan}</p></section>
        <section><h2>品牌声音</h2><p>{voice}。</p><p>先把产品的来处、资料和特点说清楚，再讲这一口带来的感受；语言保持真诚、简洁，方便顾客理解和转述。</p></section>
        <section><h2>目标消费者与核心场景</h2><p>{audience}</p><ul>{scenarios.map((scenario) => <li key={scenario}>{scenario}</li>)}</ul></section>
        <section><h2>品牌故事主线</h2><p>{story}</p></section>
        <section><h2>三条主卖点</h2><div className="draft-selling-points">{points.slice(0, 3).map((raw, index) => {
          const point = typeof raw === "object" && raw ? raw as ManualContent : { text: String(raw) };
          const title = readerText(point.title, readerText(point.text, `品牌特点 ${index + 1}`));
          const detail = readerText(point.description ?? point.explanation ?? point.rationale, `围绕“${title}”组织产品信息与使用感受，让顾客能在短时间内理解这份品牌的独特之处。`);
          return <article key={`${title}-${index}`}><p>0{index + 1}</p><h3>{title}</h3><span>{detail}</span></article>;
        })}</div></section>
      </div>
      <footer className="direction-draft-footer"><p>确认后，系统会以这版方向开始生成品牌手册与视觉概念稿。</p><div><button className="secondary-button" disabled={busy} onClick={onClose}>返回比较</button><button className="primary-button" disabled={busy} onClick={() => void onConfirm()}>{busy ? "正在确认…" : "确认采用这版方案"}</button></div></footer>
    </article>
  </div>;
}

export function BrandManualDialog({ project, cards, claims, directions, manual, assets, versions, exports, shares, busy, onRefresh, onClose, onSave, onSelectRoute, onRegenerate }: { project: Project; cards: ArchiveCard[]; claims: Claim[]; directions: Direction[]; manual?: ManualContent; assets: ManualAsset[]; versions: ManualVersion[]; exports: Array<{ id: string; format: string; download_url?: string }>; shares: Array<{ id: string; revoked_at?: string; created_at: string }>; busy: boolean; onRefresh: () => Promise<void>; onClose: () => void; onSave: (content: ManualContent) => void; onSelectRoute: (id: string) => void; onRegenerate: () => void }) {
  const visibleRoutes = directions.filter((route) => route.state !== "superseded");
  const historicalRoutes = directions.filter((route) => route.state === "superseded");
  const latestVersion = Math.max(0, ...visibleRoutes.map((route) => route.version ?? 1));
  const routeChoices = visibleRoutes.filter((route) => (route.version ?? 1) === latestVersion);
  const current = visibleRoutes.find((route) => route.state === "current");
  const [tool, setTool] = useState<"logo" | "color" | "font" | "assets" | null>(null);
  const [draft, setDraft] = useState<ManualContent>(() => toDraft(project, manual, current));
  const [notice, setNotice] = useState("");
  const evidence = useMemo(() => cards.filter((card) => card.status === "active"), [cards]);
  const set = (key: string, value: unknown) => setDraft((previous) => ({ ...previous, [key]: value }));
  const sellingPoints = Array.isArray(draft.selling_points) ? draft.selling_points : [];
  const addLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice("正在保存 Logo…");
    const uploaded = await api<{ data: { id: string } }>("/media", { method: "POST", body: file, headers: { "Content-Type": file.type, "X-Project-ID": project.id, "X-File-Name": encodeFileNameForHeader(file.name) } });
    await api(`/projects/${project.id}/brand-manual/assets/logo_mark`, { method: "POST", body: JSON.stringify({ media_asset_id: uploaded.data.id }) });
    set("logo_preview", `/api/media/${uploaded.data.id}`);
    await onRefresh();
    setNotice("Logo 已持久保存，刷新页面仍可查看。");
  };
  const createExports = async () => {
    setNotice("正在生成 PDF 与视觉图包…");
    await api(`/projects/${project.id}/brand-manual/exports`, { method: "POST", headers: { "Idempotency-Key": createRequestId("export") }, body: JSON.stringify({ formats: ["pdf", "zip"] }) });
    await onRefresh();
    setNotice("导出任务已创建，可关闭页面稍后回来下载。");
  };
  const share = async () => {
    const result = await api<{ data: { share_url: string } }>(`/projects/${project.id}/brand-manual/shares`, { method: "POST", body: JSON.stringify({ label: `${project.brand_name} 品牌手册` }) });
    const url = `${window.location.origin}${result.data.share_url}`;
    await navigator.clipboard?.writeText(url);
    await onRefresh();
    setNotice("不可变分享快照已创建，链接已复制。");
  };
  const revoke = async (id: string) => {
    await api(`/projects/${project.id}/brand-manual/shares/${id}/revoke`, { method: "POST" });
    await onRefresh();
    setNotice("分享已撤销。");
  };
  return <div className="archive-modal-backdrop manual-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="manual-dialog" role="dialog" aria-modal="true" aria-label={`${project.brand_name} 品牌手册`}>
      <aside className="manual-tool-rail"><strong>定调</strong>{([ ["logo", "Logo"], ["color", "配色"], ["font", "字体"], ["assets", "素材"] ] as const).map(([key, label]) => <button key={key} className={tool === key ? "is-active" : ""} onClick={() => setTool(tool === key ? null : key)}>{label}</button>)}<small>所有图形均为<br />AI 概念稿</small></aside>
      <article className="manual-canvas"><header><div><p className="eyebrow">品牌档案 · F-04 定调</p><h2>品牌手册</h2><p>{project.brand_name} · 生成底稿、当前编辑和版本历史分别保存。</p></div><div className="manual-actions"><button className="text-button" onClick={() => void createExports()}>生成 PDF / 图包</button><button className="text-button" onClick={() => void share()}>创建分享快照</button><button className="modal-close" aria-label="关闭品牌手册" onClick={onClose}>×</button></div></header>
        {notice && <p className="manual-notice" role="status">{notice}</p>}
        {tool && <section className="manual-tool-popover"><b>{tool === "logo" ? "Logo" : tool === "color" ? "颜色方案" : tool === "font" ? "字体方案" : "素材上传"}</b>{tool === "logo" || tool === "assets" ? <label className="upload-button">上传图片<input type="file" accept="image/*" onChange={addLogo} /></label> : <p>{tool === "color" ? "苔藓绿 / 暖纸色 / 靛蓝" : "标题：思源宋体；正文：思源黑体"}</p>}{Boolean(draft.logo_preview) && <img src={String(draft.logo_preview)} alt="上传的 Logo 预览" />}</section>}
        <section className="manual-paper"><div className="manual-intro"><div className="manual-logo-slot">{draft.logo_preview ? <img src={String(draft.logo_preview)} alt="品牌 Logo" /> : <span>{project.brand_name.slice(0, 1)}</span>}<small>{draft.logo_preview ? "上传 Logo" : "AI 概念稿"}</small></div><label>品牌名字<input value={project.brand_name} readOnly aria-readonly="true" /></label><label>品牌介绍<textarea value={String(draft.brand_introduction ?? "")} onChange={(event) => set("brand_introduction", event.target.value)} /></label><label>口号 / 声音<input value={String(draft.slogan ?? "")} onChange={(event) => set("slogan", event.target.value)} /></label></div>
          <div className="manual-grid"><label>目标消费者与核心消费场景<textarea value={`${String(draft.target_audience ?? "")}\n${String(draft.target_scenarios ?? "")}`} onChange={(event) => { const [audience = "", scenario = ""] = event.target.value.split("\n"); set("target_audience", audience); set("target_scenarios", scenario); }} /></label><label>品牌故事主线<textarea value={String(draft.story_spine ?? "")} onChange={(event) => set("story_spine", event.target.value)} /></label><section><p>三条主卖点及证据</p>{sellingPoints.map((raw, index) => { const point = typeof raw === "object" && raw ? raw as ManualContent : { text: String(raw), claimIds: [] }; const ids = Array.isArray(point.claimIds) ? point.claimIds.map(String) : []; return <button key={`${String(point.text)}-${index}`} className="manual-evidence" onClick={() => document.getElementById(`manual-evidence-${ids[0] ?? index}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })}><b>{String(index + 1).padStart(2, "0")}</b>{String(point.text)}<small>{ids.length ? `${ids.length} 条证据` : "待补证"}</small></button>; })}</section><section><p>视觉方案</p><div className="manual-swatches"><i /><i /><i /></div><small>{words(draft.visual_scheme).join(" / ") || "苔藓绿 / 暖纸 / 靛蓝"}</small></section></div>
          <section className="manual-evidence-list"><p className="eyebrow">事实与来源状态</p>{claims.map((claim, index) => <article id={`manual-evidence-${claim.id}`} key={claim.id}><b>{String(index + 1).padStart(2, "0")}</b><span>{claim.statement}</span><small>{claim.status} · {claim.risk} · {claim.public_allowed ? "可公开" : "不可公开"}</small></article>)}{!claims.length && evidence.map((card, index) => <article key={card.id}><b>{String(index + 1).padStart(2, "0")}</b><span>{card.title}</span><small>{card.source_summary ?? "已确认资料"}</small></article>)}</section>
          <section className="manual-asset-gallery"><p className="eyebrow">视觉资产画廊</p><div>{assets.map((asset) => <figure key={asset.id}>{asset.url ? <img src={asset.url} alt={asset.kind} /> : <span>待生成</span>}<figcaption>{asset.kind === "logo_mark" ? "Logo 图形方向" : asset.kind === "packaging_key_visual" ? "包装主视觉" : "延展纹样"}<small>AI 概念资产；说明仅在元数据中展示</small></figcaption></figure>)}</div></section>
          {Array.isArray(draft.evidence_gaps) && draft.evidence_gaps.length > 0 && <section className="manual-gaps"><p className="eyebrow">待补证据</p><ul>{draft.evidence_gaps.map((gap) => <li key={String(gap)}>{String(gap)}</li>)}</ul></section>}
        </section>
        <footer className="manual-route-footer"><div><p className="eyebrow">三条差异路线</p>{routeChoices.length ? routeChoices.map((route) => <button key={route.id} className={route.state === "current" ? "is-current" : ""} onClick={() => onSelectRoute(route.id)}><b>路线 0{route.route_no}</b><span>{route.title}</span>{route.state === "current" && <small>current</small>}</button>) : <span>首次打开手册后生成三条路线</span>}{current && !routeChoices.some((route) => route.id === current.id) && <small className="route-current-note">当前仍为「{current.title}」，选择新路线才会覆盖。</small>}</div><div><button className="secondary-button" disabled={busy} onClick={onRegenerate}>{visibleRoutes.length ? "重新生成" : "生成三条路线"}</button><button className="primary-button" disabled={busy || !current} onClick={() => onSave({ ...draft, brand_name: project.brand_name })}>{busy ? "正在保存…" : "保存手册"}</button></div></footer>
        {historicalRoutes.length > 0 && <details className="manual-history"><summary>查看旧版本（{historicalRoutes.length}）</summary>{historicalRoutes.map((route) => <article key={route.id}><b>路线 0{route.route_no}</b><span>{route.title}</span><small>历史版本，只读不覆盖 current</small></article>)}</details>}
        <section className="manual-delivery"><details><summary>版本历史（{versions.length}）</summary>{versions.map((version) => <article key={version.id}><b>v{version.version}</b><span>{version.status}</span><small>{new Date(version.created_at).toLocaleString("zh-CN")}</small></article>)}</details><div>{exports.map((item) => item.download_url && <a className="secondary-button" key={item.id} href={item.download_url}>{item.format.toUpperCase()} 下载</a>)}</div><details><summary>分享管理（{shares.length}）</summary>{shares.map((item) => <article key={item.id}><span>{new Date(item.created_at).toLocaleString("zh-CN")}</span>{item.revoked_at ? <small>已撤销</small> : <button className="text-button" onClick={() => void revoke(item.id)}>撤销</button>}</article>)}</details></section>
      </article>
    </section>
  </div>;
}
