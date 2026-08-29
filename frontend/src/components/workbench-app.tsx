"use client";

import Link from "next/link";
import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ArchiveFolioDialog, BrandMaterials, DirectionDraftDialog, ProjectDirectory } from "@/components/archive-studio";
import { BrandManualResult } from "@/components/brand-manual-result";

export type Project = { id: string; brand_name: string; industry: string; core_product: string; origin: string; current_stage?: string; current_direction_id?: string; status?: string };
type Session = { id: string; status: string; started_at: string; field_notes: Note[]; messages: Message[] };
type Message = { id: string; role: "assistant" | "user" | "system"; content: string };
type Note = { id: string; type: string; title: string; summary: string; sequence: number };
type Candidate = { id: string; type: string; title: string; content: string; status: string };
export type ArchiveCard = { id: string; type: string; title: string; content: string; status: string; content_version: number; source_summary?: string; created_at?: string; updated_at?: string };
export type Direction = { id: string; route_no: number; state: string; title: string; content_json?: Record<string, unknown>; content?: Record<string, unknown>; version?: number };
export type Claim = { id: string; field_note_id?: string; statement: string; status: string; risk: string; public_allowed: number; source_record_ids?: string[] };
export type WorkflowTask = { id: string; kind: "follow_up" | "route_generation" | "manual_generation" | "export"; status: "queued" | "running" | "succeeded" | "partial" | "failed"; progress: number; error_code?: string; result?: Record<string, unknown> };
export type ManualAsset = { id: string; kind: string; media_asset_id?: string; url?: string; metadata?: Record<string, unknown> };
export type ManualVersion = { id: string; version: number; status: string; content: Record<string, unknown>; created_at: string };
type Inspiration = { id: string; theme: string; content_motif: string; source_url: string; source_title: string; published_at?: string; fit_reason: string; risk_note: string; favorite: number };
type Tide = { id: string; status: string; error_code?: string; completed_at?: string; cards: Inspiration[] };
type TideReportSource = { id: string; channel: "industry" | "xiaohongshu" | "douyin"; publisher: string; source_url: string; source_title: string; published_at?: string };
type TideReportIdea = { id: string; theme: string; content_motif: string; applicable_scene: string; festival_context: string; risk_note: string; favorite: number; sources: TideReportSource[] };
type TideReport = { edition: { id: string; status: string; completed_at?: string; ideas: TideReportIdea[] } | null; latest_attempt: { status: string; error_code?: string; completed_at?: string } | null; next_refresh_at: string };
export type Job = { id: string; template_type: string; status: string; result: Record<string, unknown>; error_code?: string; regeneration_used: number };
type GenerationPreview = { id: string; template_type: "peripheral" | "xiaohongshu"; status: string; inspiration_text: string; result: Record<string, unknown> };
export type Workspace = { project: Project; archive_cards: ArchiveCard[]; claims?: Claim[]; directions: Direction[]; tasks?: WorkflowTask[]; manual?: { content: Record<string, unknown>; current_version_id?: string }; manual_versions?: ManualVersion[]; manual_assets?: ManualAsset[]; exports?: Array<{ id: string; format: string; download_url?: string }>; shares?: Array<{ id: string; revoked_at?: string; created_at: string }>; tide_searches: Tide[]; generation_jobs: Job[] };
type Screen = "setup" | "interview" | "candidates" | "project-directory" | "archive" | "assets" | "chronicle" | "directions" | "manual" | "tide" | "launch";
type SetupForm = { brand_name: string; industry: string; core_product: string; origin: string; category: string; consent: boolean };
type ProviderReadiness = { mode: string; capabilities: Record<string, { configured: boolean; model: string; status: string }> };

const productOptions = ["刺梨", "酸汤", "辣椒", "贵州茶", "抹茶", "蓝莓", "猕猴桃"];
const stickerByProduct: Record<string, string> = { 刺梨: "sticker-cili.png", 酸汤: "sticker-sour-soup.png", 辣椒: "sticker-chili.png", 贵州茶: "sticker-tea.png", 抹茶: "sticker-matcha.png", 蓝莓: "sticker-blueberry.png", 猕猴桃: "sticker-kiwi.png" };
const primaryScreens: Array<{ key: "fieldwork" | "tide" | "launch"; label: string; number: string }> = [
  { key: "fieldwork", label: "采风", number: "01" }, { key: "tide", label: "观潮", number: "02" }, { key: "launch", label: "出山", number: "03" },
];

// 仅用于后端不可用时的界面走查。所有来源、时间和生成结果均为模拟内容。
const DEMO_WORKSPACE: Workspace = {
  project: { id: "demo-cili", brand_name: "赫章山野刺梨社", industry: "刺梨", core_product: "刺梨原汁", origin: "贵州赫章", current_stage: "archive", current_direction_id: "demo-route-2" },
  archive_cards: [
    { id: "demo-origin", type: "产地与人物", title: "雾起时采果，晒干后入仓", content: "模拟采风记录：果园位于山地坡地，采收期以人工分拣为主。这里用于检验档案卡、来源和版本信息的排版。", status: "active", content_version: 2, source_summary: "演示采风笔记 #01", created_at: "2026-08-20T09:00:00Z", updated_at: "2026-08-25T09:00:00Z" },
    { id: "demo-product", type: "产品与工艺", title: "一瓶原汁的酸涩层次", content: "模拟产品资料：强调果实本味、酸感与冷饮场景；不包含任何可直接对外宣称的功效信息。", status: "active", content_version: 1, source_summary: "演示采风笔记 #02", created_at: "2026-08-21T09:00:00Z", updated_at: "2026-08-21T09:00:00Z" },
    { id: "demo-scene", type: "消费场景", title: "午后冰镇与周末短途出行", content: "模拟场景资料：将山野气息转译为城市里的短暂停靠，而不是把趋势判断写成产品事实。", status: "active", content_version: 1, source_summary: "演示访谈摘录 #03", created_at: "2026-08-22T09:00:00Z", updated_at: "2026-08-22T09:00:00Z" },
    { id: "demo-discarded", type: "待核材料", title: "未经确认的旧说法", content: "此条已弃用，演示它不会出现在资产夹与后续输入中。", status: "discarded", content_version: 1, source_summary: "演示待核材料", created_at: "2026-08-20T09:00:00Z" },
  ],
  directions: [
    { id: "demo-route-1", route_no: 1, state: "draft", title: "山野醒意", content_json: { brand_one_liner: "把山地果实的醒意，留给城市里需要停一停的时刻。", target_audience: "年轻通勤人群", target_scenarios: "午后冷饮", selling_points: ["山野感", "酸感记忆", "低负担场景"], content_tone: "清醒、克制、明亮" } },
    { id: "demo-route-2", route_no: 2, state: "current", title: "一口回到山风里", content_json: { brand_one_liner: "用一口清酸，把高地的风带回今天。", target_audience: "在意产地感的城市消费者", target_scenarios: "短途出行、朋友小聚", selling_points: ["产地线索", "轻盈口感", "可分享"], content_tone: "松弛、真诚、有画面" } },
  ],
  manual: { content: { title: "一口回到山风里", status: "演示品牌手册" } },
  tide_searches: [{ id: "demo-tide", status: "succeeded", completed_at: "2026-08-28T10:20:00Z", cards: [
    { id: "demo-inspiration-1", theme: "留白标签与风味短句", content_motif: "模拟灵感：用留白、产地坐标和一行风味短句组织包装正面。", source_url: "https://example.com/", source_title: "演示来源 A（非真实检索）", published_at: "演示日期", fit_reason: "可验证灵感卡的来源、风险说明、收藏与带入出山动作。", risk_note: "仅作界面走查，不得作为市场趋势依据。", favorite: 1 },
    { id: "demo-inspiration-2", theme: "低饱和山野摄影", content_motif: "模拟灵感：把果实近景与山地纹理并置，保留自然光和材质的粗粝感。", source_url: "https://example.com/", source_title: "演示来源 B（非真实检索）", published_at: "演示日期", fit_reason: "用于查看两张灵感卡并列、链接与选择后的跳转效果。", risk_note: "仅作界面走查，不得作为市场趋势依据。", favorite: 0 },
  ] }],
  generation_jobs: [{ id: "demo-job-1", template_type: "peripheral", status: "succeeded", regeneration_used: 0, result: { brief: "模拟 Brief：将刺梨的清酸、雾气与靛蓝布纹组合为随行杯概念，正面只保留必要产品信息。", image: { kind: "url", value: "/guipin/assets/sticker-cili.png" } } }, { id: "demo-job-2", template_type: "xiaohongshu", status: "partial", regeneration_used: 1, result: { brief: "模拟 Brief：一组关于午后冰镇刺梨的图文提案。", titles: ["把山风带进冰箱", "这一口酸得很清醒", "刺梨原汁的夏日打开方式"] } }],
};

function createDemoWorkspace(): Workspace { return structuredClone(DEMO_WORKSPACE); }
function demoProjects(): Project[] { const base = createDemoWorkspace().project; return [base, { id: "demo-tea", brand_name: "都匀云雾茶 · 试验档", industry: "贵州茶", core_product: "云雾绿茶", origin: "贵州都匀", current_stage: "archive" }, { id: "demo-chili", brand_name: "黔北糟辣椒合作社", industry: "糟辣椒", core_product: "糟辣椒", origin: "贵州遵义", current_stage: "archive" }, { id: "demo-soup", brand_name: "凯里酸汤小作坊", industry: "酸汤", core_product: "红酸汤", origin: "贵州凯里", current_stage: "archive" }]; }

function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "请求未能到达本地后端服务。";
  return "操作未完成，请检查服务后重试。";
}
function cardContent(direction: Direction): Record<string, unknown> {
  const content = direction.content_json ?? direction.content;
  return content && typeof content === "object" && !Array.isArray(content) ? content : {};
}
function stringList(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }

export default function WorkbenchApp({ initialDemo = false, initialScreen = "archive", initialManual = false, initialDirectionDraft = false }: { initialDemo?: boolean; initialScreen?: Screen; initialManual?: boolean; initialDirectionDraft?: boolean }) {
  const [demoSeed] = useState<Workspace | null>(() => initialDemo ? createDemoWorkspace() : null);
  const [project, setProject] = useState<Project | null>(() => demoSeed?.project ?? null);
  const [session, setSession] = useState<Session | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(() => demoSeed);
  const [projectDirectory, setProjectDirectory] = useState<Project[]>(() => initialDemo ? demoProjects() : []);
  const [screen, setScreen] = useState<Screen>(initialDemo ? (initialManual ? "manual" : initialScreen) : "setup");
  const [form, setForm] = useState<SetupForm>({ brand_name: "", industry: "刺梨", core_product: "", origin: "", category: "刺梨", consent: false });
  const [answer, setAnswer] = useState("");
  const [uploads, setUploads] = useState<Array<{ id: string; file: File; status: "uploading" | "ready" | "failed"; assetId?: string; error?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ArchiveCard | null>(null);
  const [launchInspiration, setLaunchInspiration] = useState<Inspiration | null>(null);
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [launchType, setLaunchType] = useState<"peripheral" | "xiaohongshu">("peripheral");
  const [generationPreview, setGenerationPreview] = useState<GenerationPreview | null>(null);
  const [launchArchiveId, setLaunchArchiveId] = useState<string | null>(null);
  const [launchArchivePickerOpen, setLaunchArchivePickerOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(initialDemo);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const [archiveModal, setArchiveModal] = useState<"cards" | null>(null);
  const [directionDraft, setDirectionDraft] = useState<Direction | null>(() => initialDirectionDraft ? demoSeed?.directions[0] ?? null : null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [tideReport, setTideReport] = useState<TideReport | null>(null);

  function loadDemoWorkspace(reason?: unknown) {
    const demo = createDemoWorkspace();
    setProject(demo.project); setWorkspace(demo); setProjectDirectory(demoProjects()); setScreen("project-directory"); setDemoMode(true); setDemoReason(reason ? errorText(reason) : null); setError(null);
  }

  useEffect(() => {
    if (initialDemo) return;
    void api<{ data: ProviderReadiness }>("/provider/readiness").then((response) => setReadiness(response.data)).catch(() => undefined);
    void api<{ data: unknown }>("/visitors", { method: "POST" }).then(async () => {
      try { const directory = await api<{ data: Project[] }>("/projects"); setProjectDirectory(directory.data); } catch { /* workspace loading still works with an older backend */ }
      const saved = window.localStorage.getItem("mountainlore-project-id");
      if (!saved) return;
      try {
        const response = await api<{ data: Workspace }>(`/projects/${saved}/workspace`);
        setWorkspace(response.data); setProject(response.data.project); setScreen(stageToScreen(response.data.project.current_stage, response.data.project.status));
      } catch { window.localStorage.removeItem("mountainlore-project-id"); }
    }).catch(loadDemoWorkspace);
  }, [initialDemo]);

  const confirmedCount = useMemo(() => candidates.filter((item) => item.status === "confirmed").length, [candidates]);
  const currentDirection = workspace?.directions.find((item) => item.state === "current");
  const launchWorkspace = launchArchiveId && workspace?.project.id === launchArchiveId ? workspace : null;
  const launchActiveCards = launchWorkspace?.archive_cards.filter((card) => card.status === "active") ?? [];
  const launchDirection = launchWorkspace?.directions.find((item) => item.state === "current");
  const launchReady = Boolean(launchWorkspace && launchActiveCards.length && launchDirection);
  const launchVisualAssetCount = launchWorkspace?.manual_assets?.filter((asset) => asset.media_asset_id).length ?? 0;
  const activeWorkflowTask = workspace?.tasks?.find((item) => ["route_generation", "manual_generation", "export"].includes(item.kind) && ["queued", "running"].includes(item.status));
  const latestRouteTask = workspace?.tasks?.find((item) => item.kind === "route_generation");
  const latestManualTask = workspace?.tasks?.find((item) => item.kind === "manual_generation");

  useEffect(() => {
    if (!activeWorkflowTask || demoMode || !project) return;
    const timer = window.setInterval(() => {
      void api<{ data: Workspace }>(`/projects/${project.id}/workspace`)
        .then((response) => {
          setWorkspace(response.data); setProject(response.data.project);
          if (screen === "chronicle" && response.data.directions.filter((item) => item.state !== "superseded").length === 2) setScreen("directions");
        })
        .catch((caught) => setError(errorText(caught)));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeWorkflowTask, demoMode, project, screen]);

  useEffect(() => {
    if (screen !== "tide" || !project || demoMode) return;
    void api<{ data: TideReport }>(`/projects/${project.id}/tide-report`)
      .then((response) => setTideReport(response.data))
      .catch((caught) => setError(errorText(caught)));
  }, [demoMode, project, screen]);

  async function refreshWorkspace(id = project?.id) {
    if (demoMode) return;
    if (!id) return;
    const response = await api<{ data: Workspace }>(`/projects/${id}/workspace`);
    setWorkspace(response.data); setProject(response.data.project);
  }
  async function openProject(nextProject: Project) {
    if (demoMode) {
      const demo = createDemoWorkspace();
      const selected = demoProjects().find((item) => item.id === nextProject.id) ?? demo.project;
      demo.project = { ...demo.project, ...selected };
      setProject(selected); setWorkspace(demo); setScreen("archive"); return;
    }
    setBusy(true); setError(null);
    try { await refreshWorkspace(nextProject.id); window.localStorage.setItem("mountainlore-project-id", nextProject.id); setScreen("archive"); }
    catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    if (!form.consent || !form.industry || !form.core_product || !form.brand_name || !form.origin) { setError("请完成基础建档并确认素材授权。"); return; }
    setBusy(true);
    try {
      await api("/visitors", { method: "POST" });
      const created = await api<{ data: Project }>("/projects", { method: "POST", body: JSON.stringify(form) });
      const started = await api<{ data: Session }>("/sessions", { method: "POST", body: JSON.stringify({ project_id: created.data.id }) });
      setProject(created.data); setProjectDirectory((items) => [created.data, ...items]); setSession(started.data); window.localStorage.setItem("mountainlore-project-id", created.data.id); setScreen("interview");
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!project || !event.target.files) return;
    const files = Array.from(event.target.files).slice(0, Math.max(0, 5 - uploads.length));
    const items = files.map((file) => ({ id: crypto.randomUUID(), file, status: "uploading" as const }));
    setUploads((previous) => [...previous, ...items]);
    await Promise.all(items.map(async (item) => {
      try {
        const result = await api<{ data: { id: string } }>("/media", { method: "POST", body: item.file, headers: { "Content-Type": item.file.type, "X-Project-ID": project.id, "X-File-Name": item.file.name } });
        setUploads((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status: "ready", assetId: result.data.id } : entry));
      } catch (caught) { setUploads((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: errorText(caught) } : entry)); }
    }));
  }

  async function sendMessage(skipped = false) {
    if (!project || !session) return;
    const assetIds = uploads.filter((item) => item.status === "ready" && item.assetId).map((item) => item.assetId);
    if (!skipped && !answer.trim() && assetIds.length === 0) { setError("写下一段经历、添加照片，或跳过这一题。"); return; }
    setBusy(true); setError(null);
    try {
      const result = await api<{ data: { session: Session } }>(`/sessions/${session.id}/messages`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ content: answer, skipped, media_asset_ids: assetIds }) });
      setSession(result.data.session); setAnswer(""); setUploads([]);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function finishFieldwork() {
    if (!session || !project) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ data: { candidates: Candidate[]; session: Session } }>(`/sessions/${session.id}/finish`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });
      setCandidates(result.data.candidates); setSession(result.data.session); setScreen("candidates");
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function resolveCandidate(candidate: Candidate, action: "confirm" | "discard") {
    try {
      const result = await api<{ data: { candidate: Candidate } }>(`/candidates/${candidate.id}/${action}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });
      setCandidates((previous) => previous.map((item) => item.id === candidate.id ? result.data.candidate : item));
    } catch (caught) { setError(errorText(caught)); }
  }

  async function saveCard() { if (!editing) return; if (demoMode) { setWorkspace((current) => current ? { ...current, archive_cards: current.archive_cards.map((card) => card.id === editing.id ? { ...editing, content_version: card.content_version + 1, updated_at: new Date().toISOString() } : card) } : current); setEditing(null); return; } setBusy(true); try { await api(`/archive-cards/${editing.id}`, { method: "PATCH", body: JSON.stringify({ title: editing.title, content: editing.content, expected_content_version: editing.content_version }) }); await refreshWorkspace(); setEditing(null); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function createDirections() { if (!project) return; if (demoMode) { setWorkspace((current) => current ? { ...current, directions: current.directions.map((route) => ({ ...route, state: route.id === current.project.current_direction_id ? "current" : "draft" })) } : current); return; } setBusy(true); setError(null); try { await api(`/projects/${project.id}/directions`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: "{}" }); await refreshWorkspace(); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function confirmChronicle() { if (!project) return; if (demoMode) { setScreen("directions"); return; } setBusy(true); setError(null); try { await api(`/projects/${project.id}/chronicle/confirm`, { method: "POST", headers: { "Idempotency-Key": `chronicle-${project.id}` }, body: JSON.stringify({ request_id: "initial" }) }); await refreshWorkspace(); setScreen("chronicle"); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function retryTask(id: string) { try { await api(`/tasks/${id}/retry`, { method: "POST" }); await refreshWorkspace(); } catch (caught) { setError(errorText(caught)); } }
  async function selectDirection(id: string): Promise<boolean> { if (demoMode) { setWorkspace((current) => current ? { ...current, project: { ...current.project, current_direction_id: id, status: "manual_ready" }, directions: current.directions.map((route) => ({ ...route, state: route.id === id ? "current" : "draft" })) } : current); setScreen("manual"); return true; } setBusy(true); setError(null); try { await api(`/directions/${id}/select`, { method: "POST", headers: { "Idempotency-Key": `manual-${id}` } }); await refreshWorkspace(); setScreen("manual"); return true; } catch (caught) { setError(errorText(caught)); return false; } finally { setBusy(false); } }
  async function favoriteTideIdea(id: string) { if (!project) return; setBusy(true); setError(null); try { const response = await api<{ data: { favorite: number } }>(`/projects/${project.id}/tide-report-ideas/${id}/favorite`, { method: "POST" }); setTideReport((current) => current?.edition ? { ...current, edition: { ...current.edition, ideas: current.edition.ideas.map((idea) => idea.id === id ? { ...idea, favorite: response.data.favorite } : idea) } } : current); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function useTideIdea(idea: TideReportIdea) { if (!project) return; setBusy(true); setError(null); try { await api(`/projects/${project.id}/tide-report-ideas/${idea.id}/use`, { method: "POST" }); const source = idea.sources[0]; setLaunchInspiration({ id: idea.id, theme: idea.theme, content_motif: idea.content_motif, source_url: source?.source_url ?? "", source_title: source?.source_title ?? idea.theme, published_at: source?.published_at, fit_reason: idea.applicable_scene, risk_note: idea.risk_note, favorite: idea.favorite }); setLaunchArchiveId(null); setGenerationPreview(null); setScreen("launch"); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function selectLaunchArchive(nextProject: Project) {
    setBusy(true); setError(null);
    try {
      if (demoMode) {
        const demo = createDemoWorkspace();
        const selected = demoProjects().find((item) => item.id === nextProject.id) ?? demo.project;
        demo.project = { ...demo.project, ...selected };
        setProject(selected); setWorkspace(demo);
      } else {
        const response = await api<{ data: Workspace }>(`/projects/${nextProject.id}/workspace`);
        setWorkspace(response.data); setProject(response.data.project);
        window.localStorage.setItem("mountainlore-project-id", nextProject.id);
      }
      setLaunchArchiveId(nextProject.id); setGenerationPreview(null); setLaunchArchivePickerOpen(false);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function previewLaunch() {
    if (!project || !launchWorkspace || project.id !== launchArchiveId) { setError("请先选择本次出山要使用的品牌档案。"); return; }
    if (!launchActiveCards.length) { setError("所选品牌档案还没有有效资料，请先确认入档材料。"); return; }
    if (!launchDirection) { setError("所选品牌档案还没有确定品牌路线，请先完成定调。"); return; }
    if (!launchPrompt.trim()) { setError("先写下一句灵感或你希望被看见的画面。"); return; }
    setBusy(true); setError(null);
    try {
      if (demoMode) {
        setGenerationPreview({ id: `demo-preview-${Date.now()}`, template_type: launchType, status: "succeeded", inspiration_text: launchPrompt.trim(), result: launchType === "peripheral" ? { brief: `模拟预览：以“${launchPrompt.trim()}”为起点，组织一张暖纸、靛蓝布纹与刺梨果实并置的周边概念稿。`, concept_title: "山风随行杯", materials: ["磨砂玻璃", "靛蓝布纹标签", "明黄封签"], image: { kind: "url", value: "/guipin/assets/sticker-cili.png" } } : { brief: `模拟预览：把“${launchPrompt.trim()}”变成一组可以继续讨论的图文叙事。`, titles: ["把山风带进冰箱", "这一口酸得很清醒", "从赫章寄来的夏日"], body: "一口清酸，像把山地的风留在今天。", hashtags: ["#贵州风物", "#刺梨原汁"], image: { kind: "url", value: "/guipin/assets/sticker-cili.png" } } });
        return;
      }
      const response = await api<{ data: GenerationPreview }>(`/projects/${project.id}/generation-previews`, { method: "POST", body: JSON.stringify({ template_type: launchType, inspiration_text: launchPrompt.trim(), inspiration_card_id: launchInspiration?.id }) });
      setGenerationPreview(response.data);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function saveLaunchPreview() {
    if (!generationPreview) return;
    setBusy(true); setError(null);
    try {
      if (demoMode) {
        const job: Job = { id: `demo-job-${Date.now()}`, template_type: generationPreview.template_type, status: "succeeded", regeneration_used: 0, result: generationPreview.result };
        setWorkspace((current) => current ? { ...current, generation_jobs: [job, ...current.generation_jobs] } : current);
      } else {
        await api(`/generation-previews/${generationPreview.id}/save`, { method: "POST" });
        await refreshWorkspace();
      }
      setGenerationPreview(null); setLaunchPrompt("");
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  const navigate = (next: Screen) => {
    if (next === "launch" && screen !== "launch") { setLaunchArchiveId(null); setLaunchInspiration(null); setGenerationPreview(null); }
    if (!project && next !== "setup") {
      setScreen(next);
      return;
    }
    if (["archive", "assets", "chronicle", "directions", "manual", "tide", "launch"].includes(next) && !workspace) {
      void (async () => { try { await refreshWorkspace(); setScreen(next); } catch (caught) { setError(errorText(caught)); } })();
      return;
    }
    setScreen(next);
  };
  const openFieldwork = () => setScreen("setup");
  const isPrimaryActive = (key: "fieldwork" | "tide" | "launch") => key === "fieldwork"
    ? ["setup", "interview", "candidates", "chronicle", "directions", "manual"].includes(screen)
    : screen === key;
  return <div className="app-shell">
    <aside className="sidebar" aria-label="品牌工作台导航"><div className="brand-lockup"><span>贵品</span><div><strong>贵品风物志</strong></div></div><p className="sidebar-label">品牌工作台</p><nav>{primaryScreens.map((item) => <button key={item.key} className={`stage ${isPrimaryActive(item.key) ? "stage-current" : ""}`} onClick={() => item.key === "fieldwork" ? openFieldwork() : navigate(item.key)}><b>{item.number}</b><span>{item.label}</span></button>)}</nav><div className="sidebar-spacer" /><button className={`project-chip ${["project-directory", "archive", "assets"].includes(screen) ? "archive-current" : ""}`} onClick={() => navigate("project-directory")}><i aria-hidden="true" /><span>档案</span><small>{project?.brand_name ?? "品牌项目目录"}</small></button></aside>
    <main className="workspace">{demoMode && <aside className="demo-banner" role="status"><span>{demoReason ? `真实后端暂不可用（${demoReason}），已载入演示数据。` : "演示数据模式：档案、观潮来源与出山结果均为模拟内容，仅供检查页面和交互。"}</span><button className="text-button" onClick={() => window.location.reload()}>重试真实服务</button></aside>}{error && <p className="form-error global-error" role="alert">{error}</p>}
      {screen === "setup" && <Setup form={form} setForm={setForm} readiness={readiness} busy={busy} onSubmit={start} onDemo={loadDemoWorkspace} />}
      {screen === "interview" && project && session && <Interview project={project} session={session} answer={answer} setAnswer={setAnswer} uploads={uploads} busy={busy} onFiles={uploadFiles} onSend={sendMessage} onFinish={finishFieldwork} />}
      {screen === "candidates" && <Candidates candidates={candidates} confirmed={confirmedCount} busy={busy} onResolve={resolveCandidate} onContinue={confirmChronicle} />}
      {screen === "project-directory" && <ProjectDirectory projects={projectDirectory} onSelect={openProject} onCreate={() => setScreen("setup")} />}
      {screen === "archive" && workspace && <BrandMaterials workspace={workspace} onOpenArchive={() => setArchiveModal("cards")} onOpenManual={() => setScreen("manual")} onOpenRecords={() => setScreen("assets")} />}
      {screen === "assets" && workspace && <AssetHistory workspace={workspace} onBack={() => setScreen("archive")} onLaunch={() => navigate("launch")} />}
      {screen === "chronicle" && workspace && <Chronicle workspace={workspace} task={latestRouteTask} onRetry={retryTask} onOpenArchive={() => setArchiveModal("cards")} />}
      {screen === "directions" && workspace && <Directions directions={workspace.directions} claims={workspace.claims ?? []} current={currentDirection} routeTask={latestRouteTask} manualTask={latestManualTask} busy={busy} onGenerate={createDirections} onRetry={retryTask} onPreview={setDirectionDraft} onOpenManual={() => setScreen("manual")} />}
      {screen === "manual" && workspace && <BrandManualResult workspace={workspace} manualTask={latestManualTask} exportTask={workspace.tasks?.find((item) => item.kind === "export")} demoMode={demoMode} onRetry={retryTask} onOpenArchive={() => setScreen("archive")} onNext={() => setScreen("tide")} />}
      {screen === "tide" && workspace && <Tide report={tideReport} demoMode={demoMode} busy={busy} onFavorite={favoriteTideIdea} onUse={useTideIdea} onNext={() => navigate("launch")} />}
      {screen === "launch" && workspace && <Launch workspace={launchWorkspace ?? undefined} projects={projectDirectory} inspiration={launchWorkspace ? launchInspiration ?? undefined : undefined} busy={busy} prompt={launchPrompt} type={launchType} preview={generationPreview} ready={launchReady} visualAssetCount={launchVisualAssetCount} pickerOpen={launchArchivePickerOpen} onPromptChange={setLaunchPrompt} onTypeChange={setLaunchType} onOpenPicker={() => setLaunchArchivePickerOpen(true)} onClosePicker={() => setLaunchArchivePickerOpen(false)} onSelectArchive={selectLaunchArchive} onPreview={previewLaunch} onSavePreview={saveLaunchPreview} onClosePreview={() => setGenerationPreview(null)} onOpenRecords={() => setScreen("assets")} />}
      {archiveModal === "cards" && workspace && <ArchiveFolioDialog project={workspace.project} cards={workspace.archive_cards} onClose={() => setArchiveModal(null)} onEdit={(card) => { setEditing(card); setArchiveModal(null); }} />}
      {directionDraft && workspace && <DirectionDraftDialog project={workspace.project} direction={directionDraft} busy={busy} onClose={() => setDirectionDraft(null)} onConfirm={async () => { if (await selectDirection(directionDraft.id)) setDirectionDraft(null); }} />}
      {editing && <div className="modal-backdrop"><section className="finish-dialog" role="dialog" aria-modal="true"><p className="eyebrow">编辑档案</p><input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /><textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /><footer><button className="secondary-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={busy} onClick={saveCard}>保存</button></footer></section></div>}
      {!project && screen !== "setup" && screen !== "project-directory" && <Empty title={screen === "tide" ? "先完成采风并确认档案，才能开始真实观潮" : screen === "launch" ? "先完成采风并确认档案，才能生成出山概念稿" : "先建立品牌档案"} action={() => setScreen("setup")} actionLabel="去采风" />}
    </main>
  </div>;
}

function Setup({ form, setForm, readiness, busy, onSubmit, onDemo }: { form: SetupForm; setForm: Dispatch<SetStateAction<SetupForm>>; readiness: ProviderReadiness | null; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDemo: () => void }) {
  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  return <section className="setup-page"><header className="page-header"><p className="eyebrow">采风</p><h1>先记下三件事，再开始讲故事</h1><p>真实比完整更重要。每段材料都会留下来源、状态和确认记录。</p></header>{readiness && <section className="capability-strip" aria-label="模型能力状态">{Object.entries(readiness.capabilities).map(([key, value]) => <span key={key} className={value.configured ? "ready" : "missing"}><b>{key === "fieldwork" ? "采风" : key === "brand" ? "品牌生成" : key === "tide" ? "观潮" : "图像"}</b>{value.status === "unverified" ? "已配置 · 待实测" : value.configured ? `已配置 · ${value.model}` : "未配置 · 联系管理员"}</span>)}</section>}<form className="field-form" onSubmit={onSubmit}><div className="card-rule" /><fieldset><legend>产品产业 <em>必填</em></legend><div className="product-options">{productOptions.map((option) => <button type="button" className={form.category === option ? "product-option selected" : "product-option"} key={option} onClick={() => { set("category", option); set("industry", option); }}><img src={`/guipin/assets/${stickerByProduct[option]}`} alt="" /><span>{option}</span></button>)}</div></fieldset><div className="form-grid"><label>品牌 / 主体名称<input value={form.brand_name} onChange={(event) => set("brand_name", event.target.value)} required /></label><label>核心产品<input value={form.core_product} onChange={(event) => set("core_product", event.target.value)} placeholder="例如：刺梨原汁" required /></label><label>主要产地<input value={form.origin} onChange={(event) => set("origin", event.target.value)} placeholder="例如：贵州六盘水" required /></label></div><label className="consent"><input type="checkbox" checked={form.consent} onChange={(event) => set("consent", event.target.checked)} />我确认已获得材料使用授权，不提交敏感个人信息。</label><footer><div><p>创建一个可恢复的游客项目。</p><Link className="text-button" href="/?demo=1&view=archive" onClick={onDemo}>查看演示项目</Link></div><button className="primary-button" disabled={busy}>{busy ? "正在建立…" : "开始采风"}</button></footer></form></section>;
}

function Interview({ project, session, answer, setAnswer, uploads, busy, onFiles, onSend, onFinish }: { project: Project; session: Session; answer: string; setAnswer: (value: string) => void; uploads: Array<{ id: string; file: File; status: string; error?: string }>; busy: boolean; onFiles: (event: ChangeEvent<HTMLInputElement>) => void; onSend: (skip?: boolean) => void; onFinish: () => void }) {
  return <><header className="interview-header"><div><p className="eyebrow">FIELD INTERVIEW</p><h1>{project.core_product}</h1><p>{project.origin} · 已自动保存</p></div><button className="secondary-button" onClick={onFinish} disabled={busy || session.field_notes.length === 0}>结束本次采风</button></header><div className="interview-layout"><section className="transcript"><div className="transcript-head"><div><p className="eyebrow">对话记录</p><h2>从真实经历开始</h2></div><span>{session.field_notes.length} 条笔记</span></div><div className="transcript-list">{session.messages.map((message) => <article className={`turn turn-${message.role}`} key={message.id}><p className="turn-meta">{message.role === "assistant" ? "调查员" : message.role === "user" ? "受访者" : "系统"}</p><p>{message.content}</p></article>)}</div><section className="composer"><label htmlFor="fieldwork-answer">你的回答 <small>一次只需说一件真实的事</small></label><textarea id="fieldwork-answer" value={answer} maxLength={2000} onChange={(event) => setAnswer(event.target.value)} placeholder="可以从一个人、一件事，或一个产品细节开始。" /><div className="composer-footer"><div><label className="upload-button"><input type="file" accept="image/*" multiple onChange={onFiles} />添加照片</label><span>{answer.length} / 2,000</span></div><div><button className="text-button" onClick={() => onSend(true)} disabled={busy}>跳过</button><button className="primary-button" onClick={() => onSend()} disabled={busy}>{busy ? "正在整理…" : "记录并继续"}</button></div></div>{uploads.map((item) => <div className="upload-item" key={item.id}><span>{item.file.name}<small>{item.status === "ready" ? "已保存" : item.status === "failed" ? item.error : "正在上传"}</small></span></div>)}</section></section><aside className="notes-panel"><header><p className="eyebrow">FIELD NOTES</p><h2>本次采风笔记</h2></header>{session.field_notes.length ? <div className="note-stack">{session.field_notes.map((note) => <article className="sticky-note" key={note.id}><p>FIELD NOTE {String(note.sequence).padStart(2, "0")}</p><h3>{note.title}</h3><p>{note.summary}</p><small>待确认</small></article>)}</div> : <p className="notes-empty">第一张笔记会在这里出现。</p>}</aside></div></>;
}

function Candidates({ candidates, confirmed, busy, onResolve, onContinue }: { candidates: Candidate[]; confirmed: number; busy: boolean; onResolve: (item: Candidate, action: "confirm" | "discard") => void; onContinue: () => void }) { const pending = candidates.some((item) => item.status === "pending"); return <section className="candidate-page"><header className="page-header compact"><p className="eyebrow">采风完成 / 候选确认</p><h1>由你决定哪些材料进入档案</h1><p>AI 整理结果不是事实，确认前请核对原始访谈。</p></header><div className="candidate-grid">{candidates.map((item, index) => <article className="candidate-card" key={item.id}><p className="eyebrow">{item.type} / {String(index + 1).padStart(2, "0")}</p><h2>{item.title}</h2><p>{item.content}</p><footer>{item.status === "pending" ? <><button className="secondary-button" onClick={() => onResolve(item, "discard")}>弃用</button><button className="primary-button" onClick={() => onResolve(item, "confirm")}>确认入档</button></> : <span className={`status ${item.status}`}>{item.status === "confirmed" ? "已确认" : "已弃用"}</span>}</footer></article>)}</div><footer className="candidate-footer"><p>{pending ? "请先处理完每一张候选卡。" : confirmed ? `已有 ${confirmed} 条材料，确认后将自动生成两版方案。` : "至少确认一张材料后才能编志。"}</p><button className="primary-button" disabled={!confirmed || pending || busy} onClick={onContinue}>{busy ? "正在确认…" : "确认编志并生成两版方案"}</button></footer></section>; }

function TaskStatus({ task, onRetry }: { task?: WorkflowTask; onRetry: (id: string) => void }) {
  if (!task) return null;
  const label = task.status === "queued" ? "已排队" : task.status === "running" ? `正在生成 ${task.progress}%` : task.status === "succeeded" ? "生成完成" : task.status === "partial" ? "文字已完成，部分视觉资产待重试" : "生成未完成";
  return <section className={`workflow-task ${task.status}`} role="status"><div><b>{label}</b><small>任务 {task.id.slice(0, 8)} · 刷新页面不会丢失</small></div><progress max={100} value={task.progress ?? 0} />{["failed", "partial"].includes(task.status) && <button className="secondary-button" onClick={() => onRetry(task.id)}>重试未完成阶段</button>}</section>;
}

function Chronicle({ workspace, task, onRetry, onOpenArchive }: { workspace: Workspace; task?: WorkflowTask; onRetry: (id: string) => void; onOpenArchive: () => void }) {
  return <section className="stage-page chronicle-page"><StageHeader eyebrow="采风完成 / 正在编志" title="把确认过的材料，沉淀为品牌故事卡片" copy="系统会先冻结本次档案与事实，再生成两版品牌方向；完成后自动进入方向选择，无需从导航寻找入口。" /><div className="stage-toolbar"><span>{workspace.archive_cards.filter((card) => card.status === "active").length} 张有效档案 · {workspace.claims?.filter((claim) => claim.public_allowed).length ?? 0} 条可公开事实</span><button className="secondary-button" onClick={onOpenArchive}>回看故事卡片与来源</button></div><TaskStatus task={task} onRetry={onRetry} /><p className="chronicle-auto-note">编志完成后将自动进入定调，比较并选择两版品牌方向。</p></section>;
}

function archiveDate(value?: string) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "时间待补"; }

function AssetHistory({ workspace, onBack, onLaunch }: { workspace: Workspace; onBack: () => void; onLaunch: () => void }) {
  return <section className="stage-page asset-history-page"><header className="asset-hero"><div><p className="eyebrow">{workspace.project.brand_name} · 出山记录</p><h1>每一次出山，都是一份可回看的概念稿。</h1><p>这里仅保留从出山工作台生成的图文稿与原型稿历史。</p></div><button className="secondary-button" onClick={onBack}>← 回到品牌档案</button></header><section className="asset-history-list launch-history-list"><header><p className="eyebrow">生成历史</p><h2>图文稿与原型稿</h2></header>{workspace.generation_jobs.length ? workspace.generation_jobs.map((job) => <article key={job.id}><div><strong>{job.template_type === "xiaohongshu" ? "小红书图文" : "周边概念稿"}</strong><span className={`job-status ${job.status}`}>{job.status === "succeeded" ? "已生成" : job.status === "partial" ? "文字 Brief 已保留" : "任务未完成"}</span></div><p>{String(job.result.brief ?? job.result.body ?? "文字 Brief 已保留")}</p>{typeof job.result.image === "object" && job.result.image && (job.result.image as Record<string, string>).kind === "url" && <img src={(job.result.image as Record<string, string>).value} alt={`${job.template_type === "xiaohongshu" ? "小红书图文" : "周边"}概念稿`} />}{Array.isArray(job.result.titles) && <ul>{stringList(job.result.titles).map((title) => <li key={title}>{title}</li>)}</ul>}<small>AI 概念稿，不可直接印刷</small></article>) : <Empty title="这里会保存周边概念稿与小红书图文的历史版本" action={onLaunch} actionLabel="去出山" />}</section></section>;
}

function Directions({ directions, claims, current, routeTask, manualTask, busy, onGenerate, onRetry, onPreview, onOpenManual }: { directions: Direction[]; claims: Claim[]; current?: Direction; routeTask?: WorkflowTask; manualTask?: WorkflowTask; busy: boolean; onGenerate: () => void; onRetry: (id: string) => void; onPreview: (route: Direction) => void; onOpenManual: () => void }) { const latestVersion = Math.max(0, ...directions.map((item) => item.version ?? 0)); const routes = directions.filter((item) => item.state !== "superseded" && (item.version ?? 0) === latestVersion); const manualReady = manualTask && ["succeeded", "partial"].includes(manualTask.status); return <section className="stage-page"><StageHeader eyebrow="定调 / 品牌路线" title="让事实决定方向，而不是替代事实" copy="点击任一方案查看完整草案；在草案中确认后，系统会直接生成手册、视觉稿与下载文件。" /><div className="stage-toolbar"><span>{current ? `已选：${current.title}` : "请选择一版品牌方向"}</span><button className="secondary-button" onClick={onGenerate} disabled={busy || routeTask?.status === "running"}>{directions.length ? "重新生成新版本" : "生成两版方案"}</button></div><TaskStatus task={routeTask?.status === "succeeded" ? undefined : routeTask} onRetry={onRetry} />{routes.length ? <div className="route-grid">{routes.map((route) => <RouteCard key={route.id} route={route} claims={claims} onOpen={onPreview} />)}</div> : <Empty title="编志完成后，这里会固定出现两版方案" />}{manualTask && <TaskStatus task={manualTask} onRetry={onRetry} />}{manualReady && <footer className="stage-next"><button className="primary-button" onClick={onOpenManual}>查看完整品牌手册</button></footer>}</section>; }
function RouteCard({ route, claims, onOpen }: { route: Direction; claims: Claim[]; onOpen: (route: Direction) => void }) { const value = cardContent(route); const points = Array.isArray(value.selling_points) ? value.selling_points : []; const scenarios = Array.isArray(value.target_scenarios) ? value.target_scenarios.join("、") : String(value.target_scenarios ?? ""); const open = () => onOpen(route); return <article className={`route-card route-card-open ${route.state === "current" ? "is-current" : ""}`} role="button" tabIndex={0} aria-label={`查看路线 ${route.route_no}：${route.title} 的品牌手册草案`} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}><p className="eyebrow">路线 0{route.route_no} {route.state === "current" ? "· 已选择" : ""}</p><h2>{route.title}</h2><p className="route-one-liner">{String(value.brand_one_liner ?? "")}</p><dl><dt>人群与场景</dt><dd>{String(value.target_audience ?? "")} · {scenarios}</dd><dt>故事与价值</dt><dd>{String(value.story_spine ?? "")}<br />{String(value.emotion_value ?? "")} · {String(value.altruistic_value ?? "")}</dd><dt>三条卖点</dt><dd className="route-evidence-list">{points.map((raw, index) => { const point = typeof raw === "object" && raw ? raw as Record<string, unknown> : { text: String(raw), claimIds: [] }; const claimIds = Array.isArray(point.claimIds) ? point.claimIds.map(String) : []; const linked = claims.filter((claim) => claimIds.includes(claim.id)); return <details key={`${String(point.text)}-${index}`} onClick={(event) => event.stopPropagation()}><summary>{String(point.text)} <small>{linked.length ? `${linked.length} 条证据` : "待补证"}</small></summary>{linked.length ? linked.map((claim) => <p key={claim.id}>{claim.statement}<em>{claim.status} · {claim.risk}</em></p>) : <p>该表达尚未绑定可公开事实，不能直接作为公开卖点。</p>}</details>; })}</dd><dt>视觉路线</dt><dd>{stringList(value.visual_keywords).join(" / ")}</dd></dl><span className="route-card-open-hint">点击查看品牌手册草案 →</span></article>; }

function Tide({ report, demoMode, busy, onFavorite, onUse, onNext }: { report: TideReport | null; demoMode: boolean; busy: boolean; onFavorite: (id: string) => void; onUse: (idea: TideReportIdea) => void; onNext: () => void }) {
  const edition = report?.edition;
  const latestAttempt = report?.latest_attempt;
  const stale = edition && latestAttempt?.status === "failed";
  const channelLabel: Record<TideReportSource["channel"], string> = { industry: "行业媒体", xiaohongshu: "小红书公开帖", douyin: "抖音公开趋势" };
  const status = demoMode ? "演示模式不提供实时周报" : stale ? `本周刷新未完成，仍可阅读 ${archiveDate(edition?.completed_at)} 的已验链周报` : edition ? `本期采集于 ${archiveDate(edition.completed_at)} · 下次自动刷新 ${archiveDate(report?.next_refresh_at)}` : latestAttempt?.error_code ? "灵感正在积攒中；系统将在下个周一自动继续检索。" : "正在等待本周自动联网检索。";
  return <section className="stage-page tide-page"><StageHeader eyebrow="观潮 / 本周观察" title="把行业变化，转译成可判断的创意角度" copy="每周一 09:00 自动检索、验链并更新；趋势不改写品牌事实，只作为出山的表达参考。" /><div className="tide-ledger"><span>行业与社媒扫描</span><i /><span>逐条验链</span><i /><span>节日语境</span><i /><span>选择灵感</span></div><div className="stage-toolbar tide-status"><span>{status}</span><small>无手动刷新</small></div>{edition?.ideas.length ? <div className="inspiration-grid">{edition.ideas.map((idea, index) => <article className="inspiration-card tide-report-card" key={idea.id}><header><p className="eyebrow">灵感 {String(index + 1).padStart(2, "0")}</p><time>{idea.festival_context}</time></header><h2>{idea.theme}</h2><p>{idea.content_motif}</p><dl className="tide-idea-meta"><dt>适用场景</dt><dd>{idea.applicable_scene}</dd><dt>来源账本</dt><dd>{idea.sources.map((source) => <a href={source.source_url} target="_blank" rel="noreferrer" key={source.id}><span>{channelLabel[source.channel]} · {source.publisher}</span>{source.source_title} <em>{source.published_at ?? "时间未知"} ↗</em></a>)}</dd></dl><footer><div><button className="text-button" disabled={busy} onClick={() => onFavorite(idea.id)}>{idea.favorite ? "已收藏" : "收藏灵感"}</button><span>{idea.risk_note}</span></div><button className="secondary-button" disabled={busy} onClick={() => onUse(idea)}>用此灵感出山</button></footer></article>)}</div> : <Empty title={demoMode ? "演示模式不展示模拟热点；真实服务启用后将自动出现本周周报。" : "本周还没有足够的可验证来源；不会显示伪造趋势。"} /> }<footer className="stage-next"><button className="primary-button" onClick={onNext}>不选灵感，直接出山</button></footer></section>;
}

function Launch({ workspace, projects, inspiration, busy, prompt, type, preview, ready, visualAssetCount, pickerOpen, onPromptChange, onTypeChange, onOpenPicker, onClosePicker, onSelectArchive, onPreview, onSavePreview, onClosePreview, onOpenRecords }: { workspace?: Workspace; projects: Project[]; inspiration?: Inspiration; busy: boolean; prompt: string; type: "peripheral" | "xiaohongshu"; preview: GenerationPreview | null; ready: boolean; visualAssetCount: number; pickerOpen: boolean; onPromptChange: (value: string) => void; onTypeChange: (value: "peripheral" | "xiaohongshu") => void; onOpenPicker: () => void; onClosePicker: () => void; onSelectArchive: (project: Project) => void; onPreview: () => void; onSavePreview: () => void; onClosePreview: () => void; onOpenRecords: () => void }) {
  const activeCards = workspace?.archive_cards.filter((card) => card.status === "active") ?? [];
  const direction = workspace?.directions.find((item) => item.state === "current");
  const readinessMessage = !workspace ? "请先选择本次出山要使用的品牌档案。" : !activeCards.length ? "该档案尚无有效资料，请先确认入档材料。" : !direction ? "该档案尚未确定品牌路线，请先完成定调。" : "档案与路线已就绪，可开始生成预览。";
  return <section className="stage-page launch-page">
    <header className="launch-header"><div><p className="eyebrow">出山</p><h1>让整理好的风物，长成能被看见的东西</h1><p>选择一份品牌档案，再将它转译为可继续讨论的图文或物料概念。</p></div><button className="primary-button launch-record-button" disabled={!workspace} onClick={onOpenRecords}>打开出山记录 →</button></header>
    {inspiration && <p className="selected-inspiration">已纳入本次输入的观潮灵感：{inspiration.source_title}</p>}
    <section className="launch-conversation" aria-label="出山输入"><header><p className="eyebrow">出山输入</p><a href="#launch-type">选择生成类型 ↓</a></header><div className="launch-archive-bar"><div><p className="eyebrow">品牌档案</p><strong>{workspace?.project.brand_name ?? "尚未选择"}</strong><small>{workspace ? `${activeCards.length} 张有效资料 · ${direction ? `已选路线：${direction.title}` : "待选择品牌路线"} · ${visualAssetCount} 项手册视觉资产（本轮不带入生成）` : "选择后才会把对应档案与需求一起用于本次生成。"}</small></div><button className="secondary-button" type="button" onClick={onOpenPicker} disabled={busy}>{workspace ? "更换品牌档案" : "选择品牌档案"}</button></div><p className={`launch-readiness ${ready ? "is-ready" : ""}`} role="status">{readinessMessage}</p><label className="launch-composer"><span className="sr-only">输入出山需求</span><textarea value={prompt} maxLength={1200} onChange={(event) => onPromptChange(event.target.value)} placeholder={workspace ? "写下想让人看见的画面、标题或表达；它只会作为创意方向，不会改写品牌档案里的事实。" : "请先选择品牌档案；随后可从一幅画面、一句标题或一个想尝试的表达开始。"} /><button className="primary-button" disabled={busy || !ready || !prompt.trim()} onClick={onPreview}>{busy ? "正在生成预览…" : "生成预览 →"}</button></label><small>{prompt.length} / 1,200 · 预览不会自动归档</small></section>
    <section className="launch-types" id="launch-type"><button className={`launch-type-card peripheral ${type === "peripheral" ? "is-selected" : ""}`} onClick={() => onTypeChange("peripheral")}><span>出山方向 01</span><strong>实体物料设计</strong><small>包装概念、周边单页、品牌卡片与陈列资料。</small><i aria-hidden="true">◒</i></button><button className={`launch-type-card social ${type === "xiaohongshu" ? "is-selected" : ""}`} onClick={() => onTypeChange("xiaohongshu")}><span>出山方向 02</span><strong>线上图文生成</strong><small>小红书封面概念、标题、正文与话题结构。</small><i aria-hidden="true">✦</i></button></section>
    {workspace?.generation_jobs.length ? <section className="launch-saved-note"><p>已有 {workspace.generation_jobs.length} 份已保存产物</p><button className="text-button" onClick={onOpenRecords}>查看全部记录</button></section> : null}
    {pickerOpen && <LaunchArchivePicker projects={projects} selectedId={workspace?.project.id} busy={busy} onClose={onClosePicker} onSelect={onSelectArchive} />}
    {preview && <LaunchPreviewModal preview={preview} busy={busy} onClose={onClosePreview} onSave={onSavePreview} />}
  </section>;
}

function LaunchArchivePicker({ projects, selectedId, busy, onClose, onSelect }: { projects: Project[]; selectedId?: string; busy: boolean; onClose: () => void; onSelect: (project: Project) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  return <div className="archive-modal-backdrop launch-archive-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="launch-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="launch-archive-title"><header><div><p className="eyebrow">品牌档案</p><h2 id="launch-archive-title">选择本次出山的品牌档案</h2><p>本次生成只会使用你选定项目的有效资料与当前品牌路线。</p></div><button className="modal-close" ref={closeRef} aria-label="关闭品牌档案选择" onClick={onClose}>×</button></header><div className="launch-archive-list">{projects.length ? projects.map((item) => <button type="button" className={`launch-archive-option ${item.id === selectedId ? "is-selected" : ""}`} key={item.id} disabled={busy} onClick={() => onSelect(item)}><span>{item.industry || "档"}</span><div><small>{item.origin || "产地待补"} · {item.core_product || "产品待补"}</small><strong>{item.brand_name}</strong></div><b>{item.id === selectedId ? "已选择" : "用于出山 →"}</b></button>) : <p className="launch-archive-empty">还没有可选择的品牌档案。请先完成采风并确认材料。</p>}</div></section></div>;
}

function LaunchPreviewModal({ preview, busy, onClose, onSave }: { preview: GenerationPreview; busy: boolean; onClose: () => void; onSave: () => void }) {
  const image = preview.result.image as Record<string, string> | undefined;
  const imageUrl = image && (image.kind === "url" || image.kind === "local") ? image.value : undefined;
  const titles = stringList(preview.result.titles);
  return <div className="launch-preview-backdrop" role="presentation" onMouseDown={onClose}><section className="launch-preview-dialog" role="dialog" aria-modal="true" aria-label="出山生成预览" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">生成预览 / 尚未归档</p><h2>{preview.template_type === "xiaohongshu" ? "线上图文生成" : "实体物料设计"}</h2></div><button className="modal-close" aria-label="关闭预览" onClick={onClose}>×</button></header><div className="launch-preview-content">{imageUrl && <figure><img src={imageUrl} alt="AI 概念预览" /><figcaption>AI 概念稿，不可直接印刷</figcaption></figure>}<article><p className="eyebrow">文字 Brief</p><p>{String(preview.result.brief ?? "")}</p>{preview.template_type === "xiaohongshu" && <><h3>标题提案</h3><ul>{titles.map((title) => <li key={title}>{title}</li>)}</ul><p>{String(preview.result.body ?? "")}</p></>}{preview.template_type === "peripheral" && <><h3>{String(preview.result.concept_title ?? "周边概念")}</h3><p>{stringList(preview.result.materials).join(" · ")}</p></>}</article></div><footer><small>确认保存后，它才会进入档案的「出山记录」。</small><div><button className="secondary-button" disabled={busy} onClick={onClose}>继续修改</button><button className="primary-button" disabled={busy} onClick={onSave}>{busy ? "正在保存…" : "保存到档案"}</button></div></footer></section></div>;
}
function StageHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) { return <header className="page-header compact"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></header>; }
function Empty({ title, action, actionLabel = "开始" }: { title: string; action?: () => void; actionLabel?: string }) { return <div className="empty-state"><p>{title}</p>{action && <button className="secondary-button" onClick={action}>{actionLabel}</button>}</div>; }
function stageToScreen(stage?: string, status?: string): Screen { if (stage === "positioning" && ["generating_manual", "manual_ready"].includes(status ?? "")) return "manual"; if (stage === "chronicle") return "chronicle"; if (stage === "positioning") return "directions"; if (stage === "tide") return "tide"; if (stage === "launch") return "launch"; if (stage === "fieldwork") return "setup"; return "archive"; }
