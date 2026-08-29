"use client";

/* 视觉资产是受项目权限保护的动态媒体地址，使用原始 img 保持鉴权请求不被图片优化器改写。 */
/* eslint-disable @next/next/no-img-element */

import type { Direction, ManualAsset, Project, WorkflowTask, Workspace } from "@/components/workbench-app";

type Content = Record<string, unknown>;

function routeContent(route?: Direction): Content { return (route?.content_json ?? route?.content ?? {}) as Content; }
function text(value: unknown, fallback = "") { return typeof value === "string" && value.trim() ? value : fallback; }
function list(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const items = text(value).split(/[、，,；;\n]/).map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}
function assetTitle(kind: string) { return kind === "logo_mark" ? "Logo 图形方向" : kind === "packaging_key_visual" ? "包装主视觉" : "延展纹样"; }
function assetAlt(kind: string, project: Project) { return `${project.brand_name}${assetTitle(kind)}概念稿`; }

function AssetTile({ project, kind, asset }: { project: Project; kind: string; asset?: ManualAsset }) {
  return <figure className={`manual-result-asset ${asset?.url ? "is-ready" : "is-pending"}`}>
    {asset?.url ? <img src={asset.url} alt={assetAlt(kind, project)} /> : <div aria-hidden="true"><span>AI</span></div>}
    <figcaption><strong>{assetTitle(kind)}</strong><small>{asset?.url ? "已生成并同步" : "仍在生成，文字手册不受影响"}</small></figcaption>
  </figure>;
}

export function BrandManualResult({ workspace, manualTask, exportTask, demoMode, onRetry, onOpenArchive, onNext }: { workspace: Workspace; manualTask?: WorkflowTask; exportTask?: WorkflowTask; demoMode: boolean; onRetry: (id: string) => void; onOpenArchive: () => void; onNext: () => void }) {
  const project = workspace.project;
  const current = workspace.directions.find((route) => route.state === "current");
  const content = workspace.manual?.content ?? routeContent(current);
  const strategy = typeof content.brand_strategy === "object" && content.brand_strategy ? content.brand_strategy as Content : {};
  const visual = typeof content.visual_system === "object" && content.visual_system ? content.visual_system as Content : {};
  const voice = typeof content.voice === "object" && content.voice ? content.voice as Content : {};
  const story = typeof content.story_system === "object" && content.story_system ? content.story_system as Content : {};
  const isComplete = demoMode || Boolean(workspace.manual) || Boolean(manualTask && ["succeeded", "partial"].includes(manualTask.status));
  const isPartial = manualTask?.status === "partial";
  const assetsByKind = new Map(workspace.manual_assets?.map((asset) => [asset.kind, asset]));
  const visualWords = list(visual.keywords ?? content.visual_keywords, ["山地档案", "果实纹理", "清醒留白"]);
  const sellingPoints = Array.isArray(content.selling_points) && content.selling_points.length ? content.selling_points : ["产地线索", "产品本味", "日常分享场景"];
  const exportsReady = workspace.exports?.filter((item) => item.download_url) ?? [];

  if (!isComplete) return <section className="manual-generation-page">
    <header className="manual-generation-header"><p className="eyebrow">定调已确认 / 正在生成</p><h1>正在把这版方向做成完整的品牌手册</h1><p>文字、三项视觉概念稿、PDF 和图包会按顺序生成，并自动同步到这个品牌项目的档案。</p></header>
    <section className="manual-progress-panel" role="status"><div><b>{manualTask?.status === "queued" ? "正在排队" : "AI 正在生成品牌手册"}</b><small>可离开本页，生成结果会保留在该项目中。</small></div><progress value={manualTask?.progress ?? 8} max={100} /><ol><li>品牌策略与手册文字</li><li>Logo、包装主视觉与延展纹样</li><li>PDF 与视觉图包</li></ol>{manualTask?.status === "failed" && <button className="secondary-button" onClick={() => onRetry(manualTask.id)}>重试生成</button>}</section>
  </section>;

  return <section className="brand-manual-result-page">
    <header className="brand-manual-result-header"><div><p className="eyebrow">品牌手册 / 已完成</p><h1>{project.brand_name}｜品牌手册</h1><p>{project.origin} · {project.core_product} · 依据已确认的品牌方向生成</p></div><span className={isPartial ? "manual-result-status partial" : "manual-result-status"}>{isPartial ? "文字已完成，部分视觉稿待补" : "已同步至品牌档案"}</span></header>
    <article className="brand-manual-result-paper">
      <section><h2>品牌名字</h2><p className="manual-result-brand">{text(content.brand_name, project.brand_name)}</p></section>
      <section><h2>品牌介绍</h2><p>{text(content.brand_introduction, text(content.story_spine, `从${project.origin}的${project.core_product}出发，整理出一份能被读懂、能继续使用的品牌说明。`))}</p></section>
      <section><h2>口号</h2><p className="manual-result-slogan">{text(content.slogan, text(content.brand_one_liner, "把有来处的风物，带进今天。"))}</p></section>
      <section><h2>品牌声音</h2><p>{text(content.voice_do, text(voice.do, text(content.content_tone, "真诚、具体、有感受")))}</p></section>
      <section><h2>目标消费者与核心场景</h2><p>{text(content.target_audience, text(strategy.audience, "愿意认识产品来处、喜欢地方风物的年轻消费者"))}</p><ul>{list(strategy.scenarios ?? content.target_scenarios, ["日常饮用与工作间隙", "市集展销与朋友分享", "围绕地方产品的日常交流"]).map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h2>品牌故事主线</h2><p>{text(content.story_spine, text(story.main_story, "从已经确认的产品资料与真实经历出发，让品牌故事有清楚的来处。"))}</p></section>
      <section><h2>三条主卖点</h2><div className="manual-result-points">{sellingPoints.slice(0, 3).map((raw, index) => { const point = typeof raw === "object" && raw ? raw as Content : { text: String(raw) }; return <article key={`${String(point.text)}-${index}`}><b>0{index + 1}</b><div><h3>{text(point.title, text(point.text, `品牌特点 ${index + 1}`))}</h3><p>{text(point.description ?? point.explanation ?? point.rationale, "把这一项特点说得具体、清楚，方便顾客理解与分享。")}</p></div></article>; })}</div></section>
      <section><h2>视觉方案</h2><dl className="manual-result-visual"><div><dt>风格</dt><dd>{visualWords.join(" · ")}</dd></div><div><dt>颜色</dt><dd>靛蓝、苔绿、花蕊黄、果皮褐红、纸灰</dd></div><div><dt>字体</dt><dd>思源宋体用于标题；思源黑体用于正文与信息标签。</dd></div></dl></section>
      <section className="manual-result-gallery"><h2>视觉资产</h2><div><AssetTile project={project} kind="logo_mark" asset={assetsByKind.get("logo_mark")} /><AssetTile project={project} kind="packaging_key_visual" asset={assetsByKind.get("packaging_key_visual")} /><AssetTile project={project} kind="extension_pattern" asset={assetsByKind.get("extension_pattern")} /></div></section>
    </article>
    <footer className="brand-manual-delivery"><section><p className="eyebrow">输出文件</p><h2>网页、PDF 与图包已在同一项目中保存</h2>{demoMode ? <p>演示模式只呈现网页手册，不生成真实下载文件。</p> : exportsReady.length ? <div className="manual-downloads">{exportsReady.map((item) => <a className="secondary-button" key={item.id} href={item.download_url}>{item.format === "pdf" ? "下载 PDF" : "下载视觉图包"}</a>)}</div> : <p>{exportTask?.status === "failed" ? "导出未完成，可重试。" : "正在生成 PDF 与视觉图包…"}</p>}{exportTask?.status === "failed" && <button className="text-button" onClick={() => onRetry(exportTask.id)}>重试导出</button>}</section><section className="archive-sync-success"><p className="eyebrow">档案同步</p><strong>品牌手册已同步成功</strong><p>品牌方向、完整手册、视觉资产和下载文件都已归入此项目。</p><button className="text-button" onClick={onOpenArchive}>前往查看品牌档案 →</button></section><button className="primary-button" onClick={onNext}>继续观潮</button></footer>
  </section>;
}
