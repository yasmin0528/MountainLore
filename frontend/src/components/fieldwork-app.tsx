"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { api, ApiError, createRequestId, encodeFileNameForHeader } from "@/lib/api";
import { FailureToast } from "@/components/failure-toast";

type Message = { id: string; role: "assistant" | "user" | "system"; content: string; created_at: string };
type FieldNote = { id: string; type: string; title: string; summary: string; sequence: number; created_at: string };
type Session = { id: string; status: "active" | "completed"; started_at: string; messages: Message[]; field_notes: FieldNote[]; ready_to_finish?: boolean };
type Project = { id: string; brand_name: string; industry: string; core_product: string; origin: string; category?: string; status: string; session?: Session | null };
type Candidate = { id: string; type: string; title: string; content: string; status: "pending" | "confirmed" | "discarded" };
type UploadItem = { id: string; name: string; status: "uploading" | "ready" | "failed"; assetId?: string; preview: string; file: File; error?: string };

const productOptions = ["刺梨", "酸汤", "辣椒", "贵州茶", "抹茶", "蓝莓", "猕猴桃","自定义"];
const stickerByProduct: Record<string, string> = {
  "刺梨": "sticker-cili.png", "酸汤": "sticker-sour-soup.png", "辣椒": "sticker-chili.png",
  "贵州茶": "sticker-tea.png", "抹茶": "sticker-matcha.png", "蓝莓": "sticker-blueberry.png",
  "猕猴桃": "sticker-kiwi.png", "自定义": "sticker-custom.png",
};

function stickerPath(product: string) {
  return `/guipin/assets/${stickerByProduct[product] ?? stickerByProduct["自定义"]}`;
}

function noteType(type: string) {
  const labels: Record<string, string> = { BRAND: "品牌故事", PEOPLE: "人物", PROCESS: "产品与工艺", ORIGIN: "产地与环境", MEMORY: "地方记忆", STORY: "真实经历" };
  return labels[type] ?? type;
}

function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function FieldworkApp() {
  const [project, setProject] = useState<Project | null>(null);
  const [step, setStep] = useState<"setup" | "interview" | "candidates">("setup");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [form, setForm] = useState({ brand_name: "", industry: "", custom_industry: "", core_product: "", origin: "", category: "", consent: false });
  const [answer, setAnswer] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const session = project?.session ?? null;
  const pendingUploads = uploads.some((item) => item.status === "uploading");
  const readyAssets = uploads.filter((item) => item.status === "ready" && item.assetId).map((item) => item.assetId as string);
  const processedCandidates = candidates.filter((candidate) => candidate.status !== "pending").length;

  useEffect(() => {
    void api<{ data: unknown }>("/visitors", { method: "POST" }).catch(() => {
      setFormError("暂时无法建立访客会话，请检查后端服务后重试。");
    });
  }, []);

  async function startFieldwork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!form.consent) {
      setFormError("开始前请先确认已阅读隐私与素材使用说明。");
      return;
    }
    if (!form.industry.trim()) {
      setFormError("请选择产品产业；选择“自定义”后请补充产业名称。");
      return;
    }
    setBusy(true);
    try {
      await api<{ data: unknown }>("/visitors", { method: "POST" });
      const projectResponse = await api<{ data: Project }>("/projects", { method: "POST", body: JSON.stringify({ brand_name: form.brand_name, industry: form.industry, core_product: form.core_product, origin: form.origin, category: form.category, consent: form.consent }) });
      const sessionResponse = await api<{ data: Session }>("/sessions", { method: "POST", body: JSON.stringify({ project_id: projectResponse.data.id }) });
      setProject({ ...projectResponse.data, session: sessionResponse.data });
      setStep("interview");
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "建立项目失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!project || !event.target.files) return;
    const selected = Array.from(event.target.files);
    const available = 5 - uploads.length;
    if (selected.length > available) setMessageError(`本次最多保留 5 张图片，已忽略超出的 ${selected.length - available} 张。`);
    const items = selected.slice(0, available).map((file) => ({ id: createRequestId("upload"), name: file.name, file, preview: URL.createObjectURL(file), status: "uploading" as const }));
    setUploads((current) => [...current, ...items]);
    await Promise.all(items.map(async (item) => {
      try {
        const response = await api<{ data: { id: string } }>("/media", { method: "POST", body: item.file, headers: { "Content-Type": item.file.type, "X-Project-ID": project.id, "X-File-Name": encodeFileNameForHeader(item.file.name) } });
        setUploads((current) => current.map((existing) => existing.id === item.id ? { ...existing, status: "ready", assetId: response.data.id } : existing));
      } catch (error) {
        setUploads((current) => current.map((existing) => existing.id === item.id ? { ...existing, status: "failed", error: error instanceof ApiError ? error.message : "上传失败" } : existing));
        setMessageError(error instanceof ApiError ? error.message : "图片上传失败，请重试。");
      }
    }));
    event.target.value = "";
  }

  async function retryUpload(item: UploadItem) {
    if (!project) return;
    setUploads((current) => current.map((existing) => existing.id === item.id ? { ...existing, status: "uploading", error: undefined } : existing));
    try {
      const response = await api<{ data: { id: string } }>("/media", { method: "POST", body: item.file, headers: { "Content-Type": item.file.type, "X-Project-ID": project.id, "X-File-Name": encodeFileNameForHeader(item.file.name) } });
      setUploads((current) => current.map((existing) => existing.id === item.id ? { ...existing, status: "ready", assetId: response.data.id } : existing));
    } catch (error) {
      setUploads((current) => current.map((existing) => existing.id === item.id ? { ...existing, status: "failed", error: error instanceof ApiError ? error.message : "上传失败" } : existing));
      setMessageError(error instanceof ApiError ? error.message : "图片上传失败，请重试。");
    }
  }

  async function sendAnswer(skipped = false) {
    if (!session || !project) return;
    setMessageError(null);
    if (!skipped && !answer.trim() && readyAssets.length === 0) {
      setMessageError("请写下回答、上传一张图片，或跳过这一题。");
      return;
    }
    if (pendingUploads) {
      setMessageError("请等待图片上传完成后再继续。");
      return;
    }
    setBusy(true);
    try {
      const response = await api<{ data: { session: Session } }>(`/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Idempotency-Key": createRequestId("message") },
        body: JSON.stringify({ content: answer, skipped, media_asset_ids: readyAssets }),
      });
      setProject({ ...project, session: response.data.session });
      setAnswer("");
      setUploads([]);
    } catch (error) {
      setMessageError(error instanceof ApiError ? error.message : "记录失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function finishFieldwork() {
    if (!session || !project) return;
    setBusy(true);
    try {
      const response = await api<{ data: { candidates: Candidate[]; session: Session } }>(`/sessions/${session.id}/finish`, {
        method: "POST", headers: { "Idempotency-Key": createRequestId("finish") },
      });
      setCandidates(response.data.candidates);
      setProject({ ...project, session: response.data.session });
      setStep("candidates");
    } catch (error) {
      setMessageError(error instanceof ApiError ? error.message : "整理失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function resolveCandidate(candidate: Candidate, action: "confirm" | "discard") {
    try {
      const response = await api<{ data: { candidate: Candidate } }>(`/candidates/${candidate.id}/${action}`, { method: "POST", headers: { "Idempotency-Key": createRequestId("candidate") } });
      setCandidates((current) => current.map((item) => item.id === candidate.id ? response.data.candidate : item));
    } catch (error) {
      setMessageError(error instanceof ApiError ? error.message : "操作未保存，请重试。");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="产品流程">
        <div className="brand-lockup"><span>贵品</span><div><strong>贵品风物志</strong></div></div>
        <p className="sidebar-label">今日田野</p>
        <nav>
          {["采风", "编志", "定调", "观潮", "出山"].map((label, index) => <div className={`stage ${index === 0 ? "stage-current" : ""}`} key={label}><b>0{index + 1}</b><span>{label}</span></div>)}
        </nav>
        <div className="project-chip"><i aria-hidden="true" />{project?.brand_name ?? "尚未建立项目"}</div>
      </aside>
      <main className="workspace">
        {step === "setup" && <SetupView form={form} setForm={setForm} busy={busy} onSubmit={startFieldwork} />}
        {step === "interview" && project && session && <InterviewView project={project} session={session} answer={answer} setAnswer={setAnswer} uploads={uploads} busy={busy} onFiles={uploadFiles} onRetry={retryUpload} onRemove={(id) => setUploads((items) => items.filter((item) => item.id !== id))} onSend={() => void sendAnswer()} onSkip={() => void sendAnswer(true)} onFinish={() => void finishFieldwork()} />}
        {step === "candidates" && project && <CandidateView project={project} candidates={candidates} processed={processedCandidates} onResolve={resolveCandidate} />}
      </main>
      <FailureToast message={formError ?? messageError} onDismiss={() => { if (formError) setFormError(null); else setMessageError(null); }} />
    </div>
  );
}

function SetupView({ form, setForm, busy, onSubmit }: { form: { brand_name: string; industry: string; custom_industry: string; core_product: string; origin: string; category: string; consent: boolean }; setForm: (value: typeof form) => void; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const set = (key: keyof typeof form, value: string | boolean) => setForm({ ...form, [key]: value });
  const [showProductHelp, setShowProductHelp] = useState(false);
  return <section className="setup-page"><header className="page-header"><p className="eyebrow">采风</p><h1>先记下三件事，再开始讲故事</h1><p>真实比完整更重要。这里收集的每一段材料，都会留下来源与确认状态。</p></header><form className="field-form" onSubmit={onSubmit}><div className="card-rule" /><fieldset><legend>产品产业 <em>必填</em></legend><div className="product-options">{productOptions.map((option) => <button type="button" className={form.category === option ? "product-option selected" : "product-option"} key={option} onClick={() => { set("category", option); set("industry", option); }}><img src={stickerPath(option)} alt="" /><span>{option}</span>{form.category === option && <i>已选</i>}</button>)}<button type="button" className={form.category === "自定义" ? "product-option selected" : "product-option"} onClick={() => { set("category", "自定义"); set("industry", form.custom_industry); }}><img src={stickerPath("自定义")} alt="" /><span>自定义</span>{form.category === "自定义" && <i>已选</i>}</button></div></fieldset>{form.category === "自定义" && <label className="custom-industry">自定义产业<input value={form.custom_industry} onChange={(event) => { set("custom_industry", event.target.value); set("industry", event.target.value); }} placeholder="例如：山地蜂蜜、食用菌加工" required /></label>}<div className="form-grid"><label><span className="field-label">品牌 / 主体名称</span><input value={form.brand_name} onChange={(event) => set("brand_name", event.target.value)} required /></label><label className="product-field"><span className="field-label">产品 <button className="info-tip" type="button" aria-label="产品说明" aria-expanded={showProductHelp} onMouseEnter={() => setShowProductHelp(true)} onMouseLeave={() => setShowProductHelp(false)} onFocus={() => setShowProductHelp(true)} onBlur={() => setShowProductHelp(false)} onClick={() => setShowProductHelp((visible) => !visible)}>?</button>{showProductHelp && <span className="help-popover" role="tooltip">主推农产品形式</span>}</span><input value={form.core_product} onChange={(event) => set("core_product", event.target.value)} placeholder="例如：刺梨原汁" required /></label><label><span className="field-label">主要产地</span><input value={form.origin} onChange={(event) => set("origin", event.target.value)} required /></label></div><label className="consent"><input type="checkbox" checked={form.consent} onChange={(event) => set("consent", event.target.checked)} /> <span>我确认已获得所上传材料的使用授权，并不提交精确住址、身份证等敏感信息。</span></label><footer><p>开始采风将直接创建新的品牌项目与唯一采风记录。</p><button className="primary-button" disabled={busy}>{busy ? "正在建立…" : "开始采风"}</button></footer></form></section>;
}

function InterviewView({ project, session, answer, setAnswer, uploads, busy, onFiles, onRetry, onRemove, onSend, onSkip, onFinish }: { project: Project; session: Session; answer: string; setAnswer: (value: string) => void; uploads: UploadItem[]; busy: boolean; onFiles: (event: ChangeEvent<HTMLInputElement>) => void; onRetry: (item: UploadItem) => void; onRemove: (id: string) => void; onSend: () => void; onSkip: () => void; onFinish: () => void }) {
  const readyToFinish = Boolean(session.ready_to_finish);
  return <><header className="interview-header"><div><p className="eyebrow">采风记录 · 001</p><h1>{project.core_product}</h1><p>{project.origin} · {dateText(session.started_at)}</p></div><div className="save-state"><i aria-hidden="true" />资料已保存<br /><a href="#notes">查看本次笔记</a></div></header><div className="interview-layout"><section className="transcript" aria-label="采风访谈转录"><div className="transcript-head"><div><p className="eyebrow">FIELD INTERVIEW</p><h2>从真实经历开始</h2></div></div><div className="transcript-list" aria-live="polite">{session.messages.map((message) => { return <article className={`turn turn-${message.role}`} key={message.id}><p className="turn-meta">{message.role === "assistant" ? "调查员" : message.role === "user" ? "受访者" : "系统处理"}</p><p>{message.content}</p></article>; })}</div><section className="composer" aria-label="回答当前问题">{readyToFinish && <p className="composer-complete" role="status">本轮采风已收束。</p>}<label htmlFor="fieldwork-answer">你的回答 <small>一次只需说一件真实的事</small></label><textarea id="fieldwork-answer" value={answer} maxLength={2000} onChange={(event) => setAnswer(event.target.value)} placeholder="可以从一个人、一件事，或一个产品细节开始。" /><div className="composer-footer"><div><label className="upload-button"><input type="file" accept="image/*" multiple onChange={onFiles} />添加照片</label><span>{answer.length} / 2,000</span></div><div><button className="text-button" onClick={onSkip} disabled={busy}>跳过这题</button><button className="primary-button" onClick={onSend} disabled={busy}>{busy ? "正在整理…" : "记录并继续"}</button>{readyToFinish && <button className="secondary-button" onClick={onFinish} disabled={busy}>结束本次采风</button>}</div></div>{uploads.length > 0 && <div className="upload-list">{uploads.map((item) => <div className="upload-item" key={item.id}><img src={item.preview} alt={`待上传：${item.name}`} /><span>{item.name}<small>{item.status === "uploading" ? "正在上传" : item.status === "ready" ? "已保存" : item.error}</small></span>{item.status === "failed" ? <button onClick={() => onRetry(item)}>重试</button> : <button onClick={() => onRemove(item.id)} aria-label={`移除 ${item.name}`}>移除</button>}</div>)}</div>}</section></section><NotesPanel notes={session.field_notes} /></div></>;
}

function NotesPanel({ notes }: { notes: FieldNote[] }) {
  return <aside className="notes-panel" id="notes"><header><p className="eyebrow">FIELD NOTES</p><h2>本次采风笔记</h2><p>只读记录，完成后再逐张确认是否入档。</p></header>{notes.length === 0 ? <div className="notes-empty">访谈围绕一个话题收束后，第一张笔记会出现在这里。</div> : <div className="note-stack">{notes.map((note) => <article className="sticky-note" key={note.id}><p>FIELD NOTE {String(note.sequence).padStart(2, "0")} <span>{noteType(note.type)}</span></p><h3>{note.title}</h3><p>{note.summary}</p><small>AI 摘要 · 待确认</small></article>)}</div>}</aside>;
}


function CandidateView({ project, candidates, processed, onResolve }: { project: Project; candidates: Candidate[]; processed: number; onResolve: (candidate: Candidate, action: "confirm" | "discard") => void }) {
  const confirmed = candidates.filter((candidate) => candidate.status === "confirmed").length;
  return <section className="candidate-page"><header className="page-header compact"><p className="eyebrow">采风完成 / 候选确认</p><h1>由你决定哪些材料进入档案</h1><p>{project.brand_name} · 已处理 {processed} / {candidates.length} 张候选卡。AI 整理结果不是事实，确认前请核对原始访谈。</p></header><div className="candidate-grid">{candidates.map((candidate, index) => <article className="candidate-card" key={candidate.id}><p className="eyebrow">{candidate.type} / {String(index + 1).padStart(2, "0")}</p><h2>{candidate.title}</h2><p>{candidate.content}</p><footer>{candidate.status === "pending" ? <><button className="secondary-button" onClick={() => onResolve(candidate, "discard")}>弃用</button><button className="primary-button" onClick={() => onResolve(candidate, "confirm")}>确认入档</button></> : <span className={candidate.status === "confirmed" ? "status confirmed" : "status discarded"}>{candidate.status === "confirmed" ? "已确认入档" : "已弃用"}</span>}</footer></article>)}</div><footer className="candidate-footer"><p>{confirmed > 0 ? `已有 ${confirmed} 条材料可进入编志。` : "确认至少一张候选卡后，才会有可编纂的品牌材料。"}</p><button className="primary-button" disabled={confirmed === 0}>进入编志（即将开放）</button></footer></section>;
}
