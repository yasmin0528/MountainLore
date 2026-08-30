"use client";


import Image from "next/image";
import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, createRequestId, encodeFileNameForHeader } from "@/lib/api";
import { ArchiveFolioDialog, BrandMaterials, DirectionDraftDialog, ProjectDirectory } from "@/components/archive-studio";
import { BrandManualResult, type ManualVisualPreferences } from "@/components/brand-manual-result";
import { FailureToast } from "@/components/failure-toast";

export type Project = { id: string; brand_name: string; industry: string; core_product: string; origin: string; current_stage?: string; current_direction_id?: string; status?: string };
type Account = { id: string; email: string; created_at: string };
type Session = { id: string; status: string; started_at: string; field_notes: Note[]; messages: Message[]; ready_to_finish?: boolean; round?: number };
type Message = { id: string; role: "assistant" | "user" | "system"; content: string };
type Note = { id: string; type: string; title: string; summary: string; sequence: number };
type CandidateSource = { id: string; url: string; title: string; excerpt: string; authority: string; captured_at: string };
type Candidate = { id: string; type: string; title: string; content: string; status: string; risk?: string; sources?: CandidateSource[] };
export type ArchiveCard = { id: string; type: string; title: string; content: string; status: string; content_version: number; source_summary?: string; created_at?: string; updated_at?: string };
export type Direction = { id: string; route_no: number; state: string; title: string; content_json?: Record<string, unknown>; content?: Record<string, unknown>; version?: number };
export type Claim = { id: string; field_note_id?: string; statement: string; status: string; risk: string; public_allowed: number; source_record_ids?: string[] };
export type WorkflowTask = { id: string; kind: "follow_up" | "route_generation" | "manual_generation" | "logo_generation" | "manual_asset_generation" | "export" | "culture_research"; status: "queued" | "running" | "succeeded" | "partial" | "failed"; progress: number; error_code?: string; result?: Record<string, unknown> };
export type ManualAsset = { id: string; kind: string; media_asset_id?: string; url?: string; metadata?: Record<string, unknown> };
export type ManualVersion = { id: string; version: number; status: string; content: Record<string, unknown>; created_at: string };
type Inspiration = { id: string; theme: string; content_motif: string; source_url: string; source_title: string; published_at?: string; fit_reason: string; risk_note: string; favorite: number };
type Tide = { id: string; status: string; error_code?: string; completed_at?: string; cards: Inspiration[] };
type TideReportSource = { id: string; channel: "industry" | "xiaohongshu" | "douyin"; publisher: string; source_url: string; source_title: string; published_at?: string };
type TideReportIdea = { id: string; theme: string; content_motif: string; applicable_scene: string; festival_context: string; risk_note: string; favorite: number; sources: TideReportSource[] };
type TideRefreshState = { status: "idle" | "running" | "succeeded" | "partial" | "failed"; phase: "idle" | "collecting" | "verifying" | "deduplicating" | "synthesizing" | "completed" | "failed"; can_refresh: boolean; next_refresh_at: string; error_code?: string | null; attempt_count: number };
type TideReport = { edition: { id: string; scope: "shared" | "personal"; status: "succeeded" | "partial"; completed_at?: string; is_fallback?: boolean; ideas: TideReportIdea[] } | null; latest_attempt: { status: string; error_code?: string; completed_at?: string } | null; refresh_state: TideRefreshState; preview_sources?: TideReportSource[]; next_refresh_at: string };
export type Job = { id: string; template_type: string; status: string; result: Record<string, unknown>; error_code?: string; regeneration_used: number };
type GenerationPreview = { id: string; template_type: "peripheral" | "xiaohongshu"; status: string; inspiration_text: string; result: Record<string, unknown> };
type GenerationOverlayKind = "manual" | "manual_asset" | "launch";
export type Workspace = { project: Project; session?: Session | null; archive_cards: ArchiveCard[]; claims?: Claim[]; directions: Direction[]; tasks?: WorkflowTask[]; manual?: { content: Record<string, unknown>; current_version_id?: string }; manual_versions?: ManualVersion[]; manual_assets?: ManualAsset[]; exports?: Array<{ id: string; format: string; download_url?: string }>; shares?: Array<{ id: string; revoked_at?: string; created_at: string }>; tide_searches: Tide[]; generation_jobs: Job[] };
type Screen = "home" | "setup" | "interview" | "candidates" | "project-directory" | "archive" | "assets" | "chronicle" | "directions" | "manual" | "tide" | "launch";
type SetupForm = { brand_name: string; industry: string; core_product: string; origin: string; category: string; consent: boolean };
type TrialAnswer = { id: string; label: string; content: string };
const TIDE_ACTIVITY_PATTERN = /活动|促销|展会|市集|直播|发布|上新|旅行|出行|露营|开箱|返乡|礼赠|福利|团建|赛事|庆典|快闪/;
function festivalDateRank(context: string) {
  const matched = context.match(/(20\d{2})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})/);
  if (!matched) return undefined;
  const value = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return Number.isNaN(value.getTime()) ? undefined : Math.abs(value.getTime() - Date.now());
}
function orderTideIdeas(ideas: TideReportIdea[]) {
  return ideas.map((idea, index) => ({ idea, index, festivalRank: festivalDateRank(idea.festival_context), hasActivity: TIDE_ACTIVITY_PATTERN.test(`${idea.theme} ${idea.content_motif} ${idea.applicable_scene}`) })).sort((left, right) => {
    const leftFestival = left.festivalRank !== undefined; const rightFestival = right.festivalRank !== undefined;
    if (leftFestival !== rightFestival) return leftFestival ? -1 : 1;
    if (leftFestival && rightFestival && left.festivalRank !== right.festivalRank) return left.festivalRank! - right.festivalRank!;
    if (left.hasActivity !== right.hasActivity) return left.hasActivity ? -1 : 1;
    return left.index - right.index;
  }).map(({ idea }) => idea);
}
function launchInspirationPrompt(inspiration: Inspiration | null | undefined, userPrompt: string) {
  const ownPrompt = userPrompt.trim(); if (!inspiration) return ownPrompt;
  const context = `观潮灵感：${inspiration.theme}。转译重点：${inspiration.content_motif}。适用场景：${inspiration.fit_reason}。`;
  return ownPrompt ? `${context}\n\n${ownPrompt}` : context;
}
const productOptions = ["刺梨", "酸汤", "辣椒", "贵州茶", "抹茶", "蓝莓", "猕猴桃", "自定义"];
const stickerByProduct: Record<string, string> = { 刺梨: "sticker-cili.png", 酸汤: "sticker-sour-soup.png", 辣椒: "sticker-chili.png", 贵州茶: "sticker-tea.png", 抹茶: "sticker-matcha.png", 蓝莓: "sticker-blueberry.png", 猕猴桃: "sticker-kiwi.png", 自定义: "sticker-custom.png" };
const TRIAL_CASE: { form: SetupForm; answers: TrialAnswer[] } = {
  form: { brand_name: "三哥马辣", industry: "辣椒", core_product: "辣椒面", origin: "贵阳市修文县", category: "辣椒", consent: true },
  answers: [
    { id: "origin", label: "品牌起点与口味", content: "采风材料提及：三哥马辣承载家族配方、地方特色与匠心。创始人杨祖琴经过 1000 多次调味和试验，形成特辣、中辣、微辣、蒜香、葱香等口味。" },
    { id: "process", label: "原料与制作工序", content: "采风材料提及：原材料的成色、品相、品质均需严格把关；花生、大豆、花椒等烘炒环节尤其看重火候，再依秘制配方配比，经搅拌、初碎、舂制等工序形成成品。" },
    { id: "market", label: "产品与销售渠道", content: "采风材料提及：多种口味的马辣产品已进入贵州各大超市及各地各村的小卖部，并通过消费者口碑获得认可。" },
    { id: "growth", label: "地方支持与发展", content: "采风材料提及：修文县将其作为“一主一特”食品行业品牌培育，围绕标准厂房、电商渠道、融资与生产设施等提供支持。相关政策、金额与时间节点仍需在后续核验。" },
    { id: "team", label: "团队与传承", content: "采风材料提及：郭肖由企业高管转任贵州“三哥马辣”有限公司总经理，与创始人杨祖琴共同推动家族传统手艺与现代技术融合。人物经历及引用内容需取得本人或企业确认。" },
  ],
};
const primaryScreens: Array<{ key: "fieldwork" | "tide" | "launch"; label: string; number: string; icon: string }> = [
  { key: "fieldwork", label: "采风", number: "01", icon: "⌁" }, { key: "tide", label: "观潮", number: "02", icon: "≈" }, { key: "launch", label: "出山", number: "03", icon: "↗" },
];
const mobileScreenTitles: Record<Screen, string> = {
  home: "首页",
  setup: "采风", interview: "采风", candidates: "采风", chronicle: "采风", directions: "采风", manual: "品牌手册",
  tide: "观潮", launch: "出山", "project-directory": "档案", archive: "档案", assets: "档案",
};
type MaterialTemplate = { id: string; label: string; note: string; image?: string; alt?: string };
const multimodalPromptGuide = "\n\n任务目标：围绕以上需求直接生成一套可使用的图文成品——文字内容与配套视觉画面应围绕同一主题、场景和情绪共同完成表达。文字应可直接用于发布或继续编辑；画面应作为可直接使用的品牌视觉方案，而不是对画面如何生成的说明。\n\n品牌资产运用：如本次任务已提供 Logo、品牌主视觉、延展纹样、产品照片或其他品牌资产，最终画面请优先沿用其可见的轮廓、比例、主色、材质感和摄影语气。";
const launchPromptTemplates = [
  { label: "节日礼赠", note: "节庆礼盒与赠礼场景", text: `请围绕【节日名称】策划一套节日礼赠表达，面向【送礼对象】。希望突出【产品风味 / 产地线索】，并给出适合送礼场景的主视觉、包装语气与传播标题方向。${multimodalPromptGuide}` },
  { label: "限时促销", note: "短周期活动转化", text: `请为【产品名称】设计一场【活动周期】的限时促销内容。目标是让【目标人群】在【渠道 / 场景】快速理解产品亮点，并提供主张、优惠表达、视觉氛围与行动引导建议。${multimodalPromptGuide}` },
  { label: "新城市试水", note: "地区市场开拓", text: `请面向【目标城市 / 地区】的【目标消费者】规划一次市场试水表达。结合当地【消费场景 / 季节】，突出品牌中最适合被初次理解的产地、风味或使用体验，并给出图文与视觉切入角度。${multimodalPromptGuide}` },
  { label: "人群送礼", note: "关系型礼物提案", text: `请为【送礼人群】准备一份送给【收礼对象】的品牌礼物提案。表达应自然、克制，不夸大功效；重点说明这份礼物适合在【关系 / 时刻】被送出，以及它承载的产品与产地感受。${multimodalPromptGuide}` },
  { label: "线下亮相", note: "市集、展会与陈列", text: `请为【市集 / 展会 / 快闪活动】准备一套线下亮相方案。目标是在【活动地点】让初次接触的人快速理解品牌与产品；请给出主视觉线索、现场陈列重点、可带走的信息与一条现场短句。${multimodalPromptGuide}` },
];
const materialTemplates: MaterialTemplate[] = [
  { id: "sticker", label: "品牌贴纸", note: "多规格贴纸组合", image: "/guipin/launch-materials/material-brand-sticker-preview.png", alt: "山景窗边的刺梨饮品与手提包装概念图" },
  { id: "gift-box", label: "礼盒包装", note: "开合式礼盒正面", image: "/guipin/launch-materials/material-gift-box-preview.png", alt: "深蓝色贵州红茶礼盒与内装概念图" },
  { id: "can", label: "罐装包装", note: "红黄双罐调味料包装", image: "/guipin/launch-materials/material-can-preview.png", alt: "红黄双罐山里灶火调味料包装概念图" },
  { id: "expo-banner", label: "展会易拉宝", note: "现场立牌版式参考", image: "/guipin/launch-materials/material-expo-banner-preview.png", alt: "山货集市现场的黔岭风物易拉宝概念图" },
];

function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) {
    if (/fetch|network|load failed/i.test(error.message)) return "请求未能到达本地后端服务。";
    return `浏览器调用出错：${error.message}`;
  }
  return "操作未完成，请检查服务后重试。";
}
function cardContent(direction: Direction): Record<string, unknown> {
  const content = direction.content_json ?? direction.content;
  return content && typeof content === "object" && !Array.isArray(content) ? content : {};
}
function stringList(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
function archiveDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

export default function WorkbenchApp() {

  const [project, setProject] = useState<Project | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [cultureResearchTask, setCultureResearchTask] = useState<WorkflowTask | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projectDirectory, setProjectDirectory] = useState<Project[]>([]);
  // Deliberately start here on every document load; the workbench does not persist a screen.
  const [screen, setScreen] = useState<Screen>("home");
  const [form, setForm] = useState<SetupForm>({ brand_name: "", industry: "刺梨", core_product: "", origin: "", category: "刺梨", consent: false });
  const [answer, setAnswer] = useState("");
  const [isTrialCase, setIsTrialCase] = useState(false);
  const [uploads, setUploads] = useState<Array<{ id: string; file: File; status: "uploading" | "ready" | "failed"; assetId?: string; error?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [generationOverlay, setGenerationOverlay] = useState<GenerationOverlayKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [launchInspiration, setLaunchInspiration] = useState<Inspiration | null>(null);
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [launchType, setLaunchType] = useState<"peripheral" | "xiaohongshu">("peripheral");
  const [generationPreview, setGenerationPreview] = useState<GenerationPreview | null>(null);
  const [launchArchiveId, setLaunchArchiveId] = useState<string | null>(null);
  const [launchArchivePickerOpen, setLaunchArchivePickerOpen] = useState(false);
  const [launchMaterialIds, setLaunchMaterialIds] = useState<string[]>([]);
  const [launchMaterialPickerOpen, setLaunchMaterialPickerOpen] = useState(false);


  const [account, setAccount] = useState<Account | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteCardTarget, setDeleteCardTarget] = useState<ArchiveCard | null>(null);
  const [archiveModal, setArchiveModal] = useState<"cards" | null>(null);
  const [directionDraft, setDirectionDraft] = useState<Direction | null>(null);
  const [tideReport, setTideReport] = useState<TideReport | null>(null);
  const [visitorReady, setVisitorReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);

  const closeMobileNav = useCallback((restoreFocus = true) => {
    setMobileNavOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => mobileNavTriggerRef.current?.focus());
  }, []);


  useEffect(() => {
    window.localStorage.removeItem("mountainlore-project-id");
    void api<{ data: unknown }>("/visitors", { method: "POST" }).then(async () => {
      setVisitorReady(true);
      try { const me = await api<{ data: Account | null }>("/auth/me"); setAccount(me.data); } catch { /* Anonymous fieldwork remains available when auth is unavailable. */ }
      try { const directory = await api<{ data: Project[] }>("/projects"); setProjectDirectory(directory.data); } catch { /* workspace loading still works with an older backend */ }
    }).catch((caught) => setError(`真实后端暂不可用（${errorText(caught)}）。请检查服务后重试。`));
  }, []);


  useEffect(() => {
    if (!mobileNavOpen) return;
    const drawer = mobileDrawerRef.current;
    const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMobileNav(); return; }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll(focusableSelector)) as HTMLElement[];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.classList.add("mobile-nav-open");
    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => drawer?.querySelector<HTMLElement>(focusableSelector)?.focus());
    return () => { document.body.classList.remove("mobile-nav-open"); document.removeEventListener("keydown", handleKeyDown); window.cancelAnimationFrame(focusFrame); };
  }, [closeMobileNav, mobileNavOpen]);

  const confirmedCount = useMemo(() => candidates.filter((item) => item.status === "confirmed").length, [candidates]);
  const currentDirection = workspace?.directions.find((item) => item.state === "current");
  const launchWorkspace = launchArchiveId && workspace?.project.id === launchArchiveId ? workspace : null;
  const launchActiveCards = launchWorkspace?.archive_cards.filter((card) => card.status === "active") ?? [];
  const launchDirection = launchWorkspace?.directions.find((item) => item.state === "current");
  const launchReady = Boolean(launchWorkspace && launchActiveCards.length && launchDirection);
  const selectedLaunchMaterials = materialTemplates.filter((item) => launchMaterialIds.includes(item.id));
  const launchGenerationReady = launchReady && (launchType !== "peripheral" || selectedLaunchMaterials.length > 0);
  const launchVisualAssetCount = launchWorkspace?.manual_assets?.filter((asset) => asset.media_asset_id).length ?? 0;
  const activeWorkflowTask = workspace?.tasks?.find((item) => ["route_generation", "manual_generation", "logo_generation", "manual_asset_generation", "export"].includes(item.kind) && ["queued", "running"].includes(item.status));
  const latestRouteTask = workspace?.tasks?.find((item) => item.kind === "route_generation");
  const latestLogoTask = workspace?.tasks?.find((item) => item.kind === "logo_generation");
  const latestPatternTask = workspace?.tasks?.find((item) => item.kind === "manual_asset_generation");
  const visibleGenerationOverlay = generationOverlay && (generationOverlay === "launch" ? screen === "launch" : ["chronicle", "directions", "manual"].includes(screen)) ? generationOverlay : null;

  useEffect(() => {
    if (!generationOverlay || busy) return;
    const taskKinds = generationOverlay === "manual" ? ["route_generation", "manual_generation"] : generationOverlay === "manual_asset" ? ["logo_generation", "manual_asset_generation"] : [];
    const taskIsActive = taskKinds.some((kind) => workspace?.tasks?.some((item) => item.kind === kind && ["queued", "running"].includes(item.status)));
    if (!taskIsActive) setGenerationOverlay(null);
  }, [busy, generationOverlay, workspace?.tasks]);

  useEffect(() => {
    if (!activeWorkflowTask || !project) return;
    const timer = window.setInterval(() => {
      void api<{ data: Workspace }>(`/projects/${project.id}/workspace`)
        .then((response) => {
          setWorkspace(response.data); setProject(response.data.project); setSession(response.data.session ?? null);
        })
        .catch((caught) => setError(errorText(caught)));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeWorkflowTask, project]);

  useEffect(() => {
    if (screen !== "candidates" || !project || !cultureResearchTask || !["queued", "running"].includes(cultureResearchTask.status)) return;
    let disposed = false;
    const syncResearch = async () => {
      try {
        const taskResponse = await api<{ data: WorkflowTask }>(`/tasks/${cultureResearchTask.id}`);
        if (disposed) return;
        setCultureResearchTask(taskResponse.data);
        if (!["queued", "running"].includes(taskResponse.data.status)) {
          const candidateResponse = await api<{ data: Candidate[] }>(`/projects/${project.id}/candidates`);
          if (!disposed) setCandidates(candidateResponse.data);
        }
      } catch {
        // Research is intentionally a quiet enhancement: existing fieldwork cards stay usable.
      }
    };
    void syncResearch();
    const timer = window.setInterval(() => { void syncResearch(); }, 1200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [cultureResearchTask, project, screen]);
  const loadTideReport = useCallback(async () => {
    if (!visitorReady) return;
    const path = project ? "/projects/" + project.id + "/tide-report" : null;
    if (!path) return;
    const response = await api<{ data: TideReport }>(path);
    setTideReport(response.data);
  }, [project, visitorReady]);

  useEffect(() => {
    if (screen !== "tide") return;
    void loadTideReport().catch((caught) => setError(errorText(caught)));
  }, [loadTideReport, screen]);

  useEffect(() => {
    if (screen !== "tide" || tideReport?.refresh_state.status !== "running") return;
    const timer = window.setInterval(() => {
      void loadTideReport().catch((caught) => setError(errorText(caught)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loadTideReport, screen, tideReport?.refresh_state.status]);

  async function refreshWorkspace(id = project?.id) {

    if (!id) return;
    const response = await api<{ data: Workspace }>(`/projects/${id}/workspace`);
    setWorkspace(response.data); setProject(response.data.project); setSession(response.data.session ?? null);
  }
  async function authenticate(mode: "login" | "register", email: string, password: string) {
    setBusy(true); setError(null);
    try {
      await api("/visitors", { method: "POST" });
      const response = await api<{ data: Account }>(`/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) });
      setAccount(response.data); setAuthOpen(false);
      const directory = await api<{ data: Project[] }>("/projects");
      setProjectDirectory(directory.data);
    } catch (caught) { setError(errorText(caught)); throw caught; }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(null);
    try {
      await api("/auth/logout", { method: "POST" }); setAccount(null);
      const directory = await api<{ data: Project[] }>("/projects"); setProjectDirectory(directory.data);
      if (project && !directory.data.some((item) => item.id === project.id)) {
        setProject(null); setWorkspace(null); setSession(null); setScreen("project-directory");
      }
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function openProject(nextProject: Project) {
    setBusy(true); setError(null);
    try { await refreshWorkspace(nextProject.id); setScreen("archive"); }
    catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function deleteProject(target: Project) {
    setBusy(true); setError(null);
    try {
      await api(`/projects/${target.id}`, { method: "DELETE" });
      setProjectDirectory((items) => items.filter((item) => item.id !== target.id));
      if (project?.id === target.id) {
        setProject(null); setWorkspace(null); setSession(null);
        setScreen("project-directory");
      }
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }

  function loadTrialCase() {
    setForm(TRIAL_CASE.form);
    setIsTrialCase(true);
    setError(null);
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    if (!form.consent || !form.industry || !form.core_product || !form.brand_name || !form.origin) { setError("请完成基础建档并确认素材授权。"); return; }
    setBusy(true);
    try {
      await api("/visitors", { method: "POST" });
      const created = await api<{ data: Project }>("/projects", { method: "POST", body: JSON.stringify(form) });
      const started = await api<{ data: Session }>("/sessions", { method: "POST", body: JSON.stringify({ project_id: created.data.id }) });
      setProject(created.data); setProjectDirectory((items) => [created.data, ...items]); setSession(started.data); setScreen("interview");
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!project || !event.target.files) return;
    const files = Array.from(event.target.files).slice(0, Math.max(0, 5 - uploads.length));
    const items = files.map((file) => ({ id: createRequestId("upload"), file, status: "uploading" as const }));
    setUploads((previous) => [...previous, ...items]);
    await Promise.all(items.map(async (item) => {
      try {
        const result = await api<{ data: { id: string } }>("/media", { method: "POST", body: item.file, headers: { "Content-Type": item.file.type, "X-Project-ID": project.id, "X-File-Name": encodeFileNameForHeader(item.file.name) } });
        setUploads((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status: "ready", assetId: result.data.id } : entry));
      } catch (caught) { setUploads((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: errorText(caught) } : entry)); }
    }));
  }

  async function sendMessage(skipped = false, presetAnswer?: string) {
    if (!project || !session) return;
    const content = presetAnswer ?? answer;
    const assetIds = uploads.filter((item) => item.status === "ready" && item.assetId).map((item) => item.assetId);
    if (!skipped && !content.trim() && assetIds.length === 0) { setError("写下一段经历、添加照片，或跳过这一题。"); return; }
    setBusy(true); setError(null);
    try {
      const result = await api<{ data: { session: Session } }>(`/sessions/${session.id}/messages`, { method: "POST", headers: { "Idempotency-Key": createRequestId("message") }, body: JSON.stringify({ content, skipped, media_asset_ids: assetIds }) });
      setSession(result.data.session); setAnswer(""); setUploads([]);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function finishFieldwork() {
    if (!session || !project) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ data: { candidates: Candidate[]; session: Session; research_task?: WorkflowTask | null } }>(`/sessions/${session.id}/finish`, { method: "POST", headers: { "Idempotency-Key": createRequestId("finish") } });
      setCandidates(result.data.candidates); setCultureResearchTask(result.data.research_task ?? null); setSession(result.data.session); setScreen("candidates");
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function restartFieldwork() {
    if (!project) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ data: { session: Session } }>(`/projects/${project.id}/fieldwork/restart`, { method: "POST", headers: { "Idempotency-Key": createRequestId("fieldwork-restart") } });
      setProject((current) => current ? { ...current, status: "active", current_stage: "fieldwork" } : current);
      setSession(result.data.session); setScreen("interview"); setAnswer(""); setUploads([]); setCandidates([]); setCultureResearchTask(null);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function resolveCandidate(candidate: Candidate, action: "confirm" | "discard") {
    try {
      const result = await api<{ data: { candidate: Candidate } }>(`/candidates/${candidate.id}/${action}`, { method: "POST", headers: { "Idempotency-Key": createRequestId("candidate") } });
      setCandidates((previous) => previous.map((item) => item.id === candidate.id ? result.data.candidate : item));
    } catch (caught) { setError(errorText(caught)); }
  }

  async function deleteCard(card: ArchiveCard): Promise<boolean> { setBusy(true); setError(null); try { await api(`/archive-cards/${card.id}`, { method: "DELETE" }); await refreshWorkspace(); return true; } catch (caught) { setError(errorText(caught)); return false; } finally { setBusy(false); } }
  async function saveCard(card: ArchiveCard): Promise<boolean> { setBusy(true); setError(null); try { await api(`/archive-cards/${card.id}`, { method: "PATCH", body: JSON.stringify({ title: card.title, content: card.content, expected_content_version: card.content_version }) }); await refreshWorkspace(); return true; } catch (caught) { setError(errorText(caught)); return false; } finally { setBusy(false); } }
  async function createDirections(preferences?: ManualVisualPreferences) { if (!project) return; setGenerationOverlay("manual"); setBusy(true); setError(null); try { await api(`/projects/${project.id}/directions`, { method: "POST", headers: { "Idempotency-Key": createRequestId("directions") }, body: JSON.stringify({ visual_preferences: preferences ?? {} }) }); await refreshWorkspace(); } catch (caught) { setGenerationOverlay(null); setError(errorText(caught)); } finally { setBusy(false); } }
  async function confirmChronicle() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      // Culture research can append candidates after the initial list was rendered.
      // Reconcile with the server before asking it to freeze the chronicle.
      const latest = await api<{ data: Candidate[] }>(`/projects/${project.id}/candidates`);
      const latestCandidates = latest.data;
      setCandidates(latestCandidates);
      if (latestCandidates.some((candidate) => candidate.status === "pending")) {
        setError("发现新增候选材料，已同步到页面。请逐张确认入档或弃用后继续。");
        return;
      }
      if (!latestCandidates.some((candidate) => candidate.status === "confirmed")) {
        setError("请先确认至少一张材料后再编志。");
        return;
      }
      await api(`/projects/${project.id}/chronicle/confirm`, { method: "POST", headers: { "Idempotency-Key": `chronicle-${project.id}` }, body: JSON.stringify({ request_id: "initial", defer_directions: true }) });
      await refreshWorkspace();
      setScreen("chronicle");
    } catch (caught) {
      // A candidate can be added between the reconciliation and the final request.
      // Refresh it so the user can resolve the real blocker instead of being left at a stale page.
      try {
        const latest = await api<{ data: Candidate[] }>(`/projects/${project.id}/candidates`);
        if (latest.data.some((candidate) => candidate.status === "pending")) {
          setCandidates(latest.data);
          setError("候选材料刚刚更新，已同步到页面。请处理新增材料后继续。");
          return;
        }
      } catch {
        // Preserve the original API failure if the recovery refresh fails.
      }
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function saveManual(content: Record<string, unknown>) { if (!project) return; setBusy(true); setError(null); try { await api(`/projects/${project.id}/brand-manual`, { method: "PATCH", body: JSON.stringify({ content_json: content }) }); await refreshWorkspace(); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function retryTask(id: string) { const task = workspace?.tasks?.find((item) => item.id === id); const overlay = task?.kind === "route_generation" || task?.kind === "manual_generation" ? "manual" : task?.kind === "logo_generation" || task?.kind === "manual_asset_generation" ? "manual_asset" : null; if (overlay) setGenerationOverlay(overlay); setBusy(true); try { await api(`/tasks/${id}/retry`, { method: "POST" }); await refreshWorkspace(); } catch (caught) { setGenerationOverlay(null); setError(errorText(caught)); } finally { setBusy(false); } }
  async function generateManualAsset(kind: "extension_pattern" | "packaging_key_visual") { if (!project) return; setGenerationOverlay("manual_asset"); setBusy(true); try { await api(`/projects/${project.id}/brand-manual/generate-assets/${kind}`, { method: "POST", headers: { "Idempotency-Key": createRequestId(`asset-${kind}`) } }); await refreshWorkspace(); } catch (caught) { setGenerationOverlay(null); setError(errorText(caught)); } finally { setBusy(false); } }
  async function selectDirection(id: string): Promise<boolean> { setBusy(true); setError(null); try { await api(`/directions/${id}/select`, { method: "POST", headers: { "Idempotency-Key": `manual-${id}` } }); await refreshWorkspace(); setScreen("manual"); return true; } catch (caught) { setError(errorText(caught)); return false; } finally { setBusy(false); } }
  async function favoriteTideIdea(id: string) { if (!project) return; setBusy(true); setError(null); try { const response = await api<{ data: { favorite: number } }>(`/projects/${project.id}/tide-report-ideas/${id}/favorite`, { method: "POST" }); setTideReport((current) => current?.edition ? { ...current, edition: { ...current.edition, ideas: current.edition.ideas.map((idea) => idea.id === id ? { ...idea, favorite: response.data.favorite } : idea) } } : current); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function useTideIdea(idea: TideReportIdea) {
    if (!project) return;
    setBusy(true); setError(null);
    try {
      await api(`/projects/${project.id}/tide-report-ideas/${idea.id}/use`, { method: "POST" });
      const source = idea.sources[0];
      setLaunchInspiration({ id: idea.id, theme: idea.theme, content_motif: idea.content_motif, source_url: source?.source_url ?? "", source_title: source?.source_title ?? idea.theme, published_at: source?.published_at, fit_reason: idea.applicable_scene, risk_note: idea.risk_note, favorite: idea.favorite });
      setLaunchArchiveId(project.id); setGenerationPreview(null); setScreen("launch");
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }  async function refreshTideReport() {
    setError(null);
    try {
      const response = await api<{ data: { refresh_state: TideRefreshState } }>("/tide-report/refresh", { method: "POST" });
      setTideReport((current) => current ? { ...current, refresh_state: response.data.refresh_state, next_refresh_at: response.data.refresh_state.next_refresh_at } : current);
      if (!tideReport) await loadTideReport();
    } catch (caught) { setError(errorText(caught)); }
  }
  async function selectLaunchArchive(nextProject: Project) {
    setBusy(true); setError(null);
    try {
      const response = await api<{ data: Workspace }>(`/projects/${nextProject.id}/workspace`);
      setWorkspace(response.data); setProject(response.data.project);
      if (launchInspiration && nextProject.id !== launchArchiveId) setLaunchInspiration(null);
      setLaunchArchiveId(nextProject.id); setGenerationPreview(null); setLaunchArchivePickerOpen(false);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function waitForGenerationPreview(previewId: string): Promise<GenerationPreview> {
    // Text and image generation run as separate provider calls; wait long
    // enough for both server-side timeouts before reporting a delayed preview.
    for (let attempt = 0; attempt < 360; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const response = await api<{ data: GenerationPreview }>(`/generation-previews/${previewId}`);
      if (["succeeded", "partial"].includes(response.data.status)) return response.data;
      if (response.data.status === "failed") {
        throw new Error(String(response.data.result.error_message ?? "图文预览生成失败，请修改提示词后重试。"));
      }
    }
    throw new Error("图文预览仍在生成，请稍后重试。");
  }
  async function previewLaunch() {
    if (!project || !launchWorkspace || project.id !== launchArchiveId) { setError("请先选择本次出山要使用的品牌档案。"); return; }
    if (!launchActiveCards.length) { setError("所选品牌档案还没有有效资料，请先确认入档材料。"); return; }
    if (!launchDirection) { setError("所选品牌档案还没有确定品牌路线，请先完成定调。"); return; }
    if (launchType === "peripheral" && !selectedLaunchMaterials.length) { setError("请先选择至少一种要生成的实体物料。"); return; }
    const requestPrompt = launchInspirationPrompt(launchInspiration, launchPrompt);
    if (!requestPrompt) { setError("先写下一句灵感或选择一条观潮灵感。"); return; }
    const materialIds = launchType === "peripheral" ? selectedLaunchMaterials.map((item) => item.id) : [];
    setGenerationOverlay("launch"); setBusy(true); setError(null);
    try {
      const response = await api<{ data: GenerationPreview }>(`/projects/${project.id}/generation-previews`, { method: "POST", body: JSON.stringify({ template_type: launchType, inspiration_text: requestPrompt, inspiration_card_id: launchInspiration?.id, material_ids: materialIds }) });
      setGenerationPreview(response.data.status === "succeeded" ? response.data : await waitForGenerationPreview(response.data.id));
    } catch (caught) { setError(errorText(caught)); }
    finally { setGenerationOverlay(null); setBusy(false); }
  }
  async function saveLaunchPreview() {
    if (!generationPreview) return;
    setBusy(true); setError(null);
    try {
      await api(`/generation-previews/${generationPreview.id}/save`, { method: "POST" });
      await refreshWorkspace();
      setGenerationPreview(null); setLaunchPrompt(""); setLaunchMaterialIds([]);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  const navigate = (next: Screen) => {
    if (mobileNavOpen) closeMobileNav();
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
  const openFieldwork = () => { if (mobileNavOpen) closeMobileNav(); setIsTrialCase(false); setScreen("setup"); };
  const isPrimaryActive = (key: "fieldwork" | "tide" | "launch") => key === "fieldwork"
    ? ["setup", "interview", "candidates", "chronicle", "directions", "manual"].includes(screen)
    : screen === key;

  if (screen === "home") return <><HomePage onStart={() => { setIsTrialCase(false); setScreen("setup"); }} /><FailureToast message={error} onDismiss={() => setError(null)} /></>;

  return <div className="app-shell">
    {mobileNavOpen && <button type="button" className="mobile-nav-scrim" aria-label="关闭导航菜单" onClick={() => closeMobileNav()} />}
    <aside ref={mobileDrawerRef} id="mobile-workspace-navigation" className={`sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`} aria-label="品牌工作台导航">
      <div className="mobile-drawer-head">
        <button type="button" className="mobile-drawer-mark" aria-label="收起导航菜单" onClick={() => closeMobileNav()}>贵</button>
        <div><span>数字田野志</span><strong>贵品风物志</strong></div>
      </div>
      <div className="brand-lockup"><span>贵</span><div><strong>贵品风物志</strong></div></div><p className="sidebar-label">品牌工作台</p>
      <nav aria-label="主导航">
        {primaryScreens.map((item) => <button key={item.key} className={`stage ${isPrimaryActive(item.key) ? "stage-current" : ""}`} onClick={() => item.key === "fieldwork" ? openFieldwork() : navigate(item.key)}><span className="stage-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>)}
        <button type="button" className={`stage mobile-archive-stage ${["project-directory", "archive", "assets"].includes(screen) ? "stage-current" : ""}`} onClick={() => navigate("project-directory")}><span className="stage-icon" aria-hidden="true">▱</span><span>档案</span></button>
      </nav>
      <div className="sidebar-spacer" />
      <section className="account-summary" aria-label="账号">
        {account ? <><small>已登录</small><strong title={account.email}>{account.email}</strong><button className="text-button" disabled={busy} onClick={logout}>退出登录</button></> : <><small>跨设备保存</small><button className="secondary-button" onClick={() => setAuthOpen(true)}>登录 / 注册</button></>}
      </section>
      <button className={`project-chip ${["project-directory", "archive", "assets"].includes(screen) ? "archive-current" : ""}`} onClick={() => navigate("project-directory")}><i aria-hidden="true" /><span>档案</span><small>{project?.brand_name ?? "品牌项目目录"}</small></button>
    </aside>
    <main className="workspace"><header className="mobile-workspace-bar"><button ref={mobileNavTriggerRef} type="button" className="mobile-project-mark" aria-label={mobileNavOpen ? "收起导航菜单" : "打开导航菜单"} aria-expanded={mobileNavOpen} aria-controls="mobile-workspace-navigation" onClick={() => mobileNavOpen ? closeMobileNav() : setMobileNavOpen(true)}>贵</button><div className="mobile-workspace-title"><strong>贵品风物志</strong><small>{mobileScreenTitles[screen]}</small></div></header>
      {screen === "setup" && <Setup form={form} setForm={setForm} busy={busy} isTrialCase={isTrialCase} onSubmit={start} onTrialCase={loadTrialCase} />}
      {screen === "interview" && project && session && <Interview project={project} session={session} answer={answer} setAnswer={setAnswer} uploads={uploads} busy={busy} onFiles={uploadFiles} onSend={sendMessage} trialAnswers={isTrialCase ? TRIAL_CASE.answers : []} onFinish={finishFieldwork} onContinueFieldwork={restartFieldwork} />}
      {screen === "candidates" && <Candidates candidates={candidates} confirmed={confirmedCount} researching={Boolean(cultureResearchTask && ["queued", "running"].includes(cultureResearchTask.status))} busy={busy} onResolve={resolveCandidate} onContinue={confirmChronicle} />}
      {screen === "project-directory" && <ProjectDirectory projects={projectDirectory} onSelect={openProject} onDelete={(item) => setDeleteTarget(item)} onCreate={() => { setIsTrialCase(false); setScreen("setup"); }} />}
      {screen === "archive" && workspace && <BrandMaterials workspace={workspace} onOpenArchive={() => setArchiveModal("cards")} onOpenManual={() => setScreen("manual")} onOpenRecords={() => setScreen("assets")} />}
      {screen === "assets" && workspace && <AssetHistory workspace={workspace} onBack={() => setScreen("archive")} onLaunch={() => navigate("launch")} />}
      {screen === "chronicle" && workspace && <Chronicle workspace={workspace} task={latestRouteTask} onRetry={retryTask} onOpenArchive={() => setArchiveModal("cards")} onContinueToning={() => setScreen("manual")} />}
      {screen === "directions" && workspace && <Directions directions={workspace.directions} claims={workspace.claims ?? []} current={currentDirection} manual={workspace.manual} routeTask={latestRouteTask} busy={busy} onGenerate={createDirections} onRetry={retryTask} onPreview={setDirectionDraft} onOpenManual={() => setScreen("manual")} />}
      {screen === "manual" && workspace && <BrandManualResult key={workspace.manual?.current_version_id ?? workspace.project.status ?? "manual-setup"} workspace={workspace} logoTask={latestLogoTask} patternTask={latestPatternTask} exportTask={workspace.tasks?.find((item) => item.kind === "export")} busy={busy} onGenerate={createDirections} onSelect={selectDirection} onSave={saveManual} onRefresh={refreshWorkspace} onRetry={retryTask} onGenerateAsset={generateManualAsset} onFailure={setError} onOpenArchive={() => setScreen("archive")} onNext={() => setScreen("tide")} />}
      {screen === "tide" && workspace && <Tide report={tideReport} busy={busy} onRefresh={refreshTideReport} onFavorite={favoriteTideIdea} onUse={useTideIdea} onNext={() => setScreen("launch")} />}
      {screen === "launch" && workspace && <Launch workspace={launchWorkspace ?? undefined} projects={projectDirectory} inspiration={launchWorkspace ? launchInspiration ?? undefined : undefined} busy={busy} prompt={launchPrompt} type={launchType} preview={generationPreview} canGenerate={launchGenerationReady} selectedMaterials={selectedLaunchMaterials} visualAssetCount={launchVisualAssetCount} pickerOpen={launchArchivePickerOpen} materialPickerOpen={launchMaterialPickerOpen} onPromptChange={setLaunchPrompt} onTypeChange={setLaunchType} onOpenPicker={() => setLaunchArchivePickerOpen(true)} onClosePicker={() => setLaunchArchivePickerOpen(false)} onOpenMaterialPicker={() => setLaunchMaterialPickerOpen(true)} onCloseMaterialPicker={() => setLaunchMaterialPickerOpen(false)} onToggleMaterial={(id) => setLaunchMaterialIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} onSelectArchive={selectLaunchArchive} onPreview={previewLaunch} onSavePreview={saveLaunchPreview} onClosePreview={() => setGenerationPreview(null)} onOpenRecords={() => setScreen("assets")} />}
      {archiveModal === "cards" && workspace && <ArchiveFolioDialog project={workspace.project} cards={workspace.archive_cards} busy={busy} onClose={() => setArchiveModal(null)} onSave={saveCard} onDeleteRequest={(card) => setDeleteCardTarget(card)} />}
      {directionDraft && workspace && <DirectionDraftDialog project={workspace.project} direction={directionDraft} busy={busy} onClose={() => setDirectionDraft(null)} onConfirm={async () => { if (await selectDirection(directionDraft.id)) setDirectionDraft(null); }} />}

      {authOpen && <AuthDialog busy={busy} onClose={() => setAuthOpen(false)} onSubmit={authenticate} />}
      {deleteTarget && <DeleteProjectDialog project={deleteTarget} busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={() => { const target = deleteTarget; setDeleteTarget(null); void deleteProject(target); }} />}
      {deleteCardTarget && workspace?.project && <DeleteProjectDialog project={workspace.project} subject={deleteCardTarget.title} description="删除后，这张档案卡将从品牌资料中移除，但采风对话、笔记和来源记录会保留。" confirmLabel="确认删除卡片" keepLabel="保留卡片" busy={busy} onClose={() => setDeleteCardTarget(null)} onConfirm={() => { const target = deleteCardTarget; setDeleteCardTarget(null); void deleteCard(target); }} />}
      {!project && screen !== "setup" && screen !== "project-directory" && <Empty title={screen === "tide" ? "先完成采风并确认档案，才能开始真实观潮" : screen === "launch" ? "先完成采风并确认档案，才能生成出山概念稿" : "先建立品牌档案"} action={() => setScreen("setup")} actionLabel="去采风" />}
      {visibleGenerationOverlay && <GenerationLoading kind={visibleGenerationOverlay} />}
    </main><FailureToast message={error} onDismiss={() => setError(null)} />
  </div>;
}

function HomePage({ onStart }: { onStart: () => void }) {
  return <main className="home-page">
    <button type="button" className="home-start-button" onClick={onStart}>开始体验 <span aria-hidden="true">→</span></button>
  </main>;
}

function GenerationLoading({ kind }: { kind: GenerationOverlayKind }) {
  const content = kind === "launch"
    ? { eyebrow: "出山产物生成中", title: "正在把风物带到眼前", copy: "正在整理文案与画面，请稍候。" }
    : kind === "manual_asset"
      ? { eyebrow: "品牌手册生成中", title: "正在绘制视觉资产", copy: "正在提炼品牌的图形与色彩语言。" }
      : { eyebrow: "品牌手册生成中", title: "正在凝练品牌方向", copy: "正在依据已确认的品牌资料生成手册底稿。" };
  return <div className="generation-loading" role="status" aria-live="polite" aria-label={content.title}>
    <div className="generation-loading-card">
      <div className="generation-spinner" aria-hidden="true"><i /><i /><b>贵</b></div>
      <p className="eyebrow">{content.eyebrow}</p><h2>{content.title}</h2><p>{content.copy}</p>
    </div>
  </div>;
}

function AuthDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (mode: "login" | "register", email: string, password: string) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLocalError(null);
    try { await onSubmit(mode, email, password); } catch (caught) { setLocalError(errorText(caught)); }
  };
  const dialog = <div className="modal-backdrop auth-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><button type="button" className="modal-close" aria-label="关闭账号窗口" onClick={onClose}>×</button><p className="eyebrow">账号与档案</p><h2 id="account-dialog-title">{mode === "register" ? "保存你的田野记录" : "回到你的田野记录"}</h2><p>登录后可在其他设备继续查看和编辑已采风的品牌档案。</p><div className="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")}>注册</button><button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>登录</button></div><form onSubmit={submit}><label>邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /><small>至少 8 个字符</small></label>{localError && <p className="form-error" role="alert">{localError}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>暂不登录</button><button className="primary-button" disabled={busy}>{busy ? "正在处理…" : mode === "register" ? "注册并保存" : "登录"}</button></footer></form></section></div>;
  return mounted ? createPortal(dialog, document.body) : null;
}

function DeleteProjectDialog({ project, subject, description = "删除后，这个项目的采风记录、档案卡与品牌资产会被永久移除，无法恢复。", confirmLabel = "确认永久删除", keepLabel = "保留项目", busy, onClose, onConfirm }: { project: Project; subject?: string; description?: string; confirmLabel?: string; keepLabel?: string; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="archive-modal-backdrop delete-project-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="delete-project-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
      <header><div><p className="eyebrow">档案 / 删除品牌项目</p><h2 id="delete-project-title">确认删除「{subject ?? project.brand_name}」？</h2></div><button className="modal-close" ref={closeRef} aria-label="关闭删除确认" onClick={onClose}>×</button></header>
      <p><span>{description}</span></p>
      <p className="delete-project-note" role="note"><i aria-hidden="true">!</i><span>此操作不可撤销。若只是暂时不用，可以先保留，之后随时回来继续。</span></p>
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{keepLabel}</button><button type="button" className="delete-project-confirm" disabled={busy} onClick={onConfirm}>{busy ? "正在删除…" : confirmLabel}</button></footer>
    </section>
  </div>;
}

function Setup({ form, setForm, busy, isTrialCase, onSubmit, onTrialCase }: { form: SetupForm; setForm: Dispatch<SetStateAction<SetupForm>>; busy: boolean; isTrialCase: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onTrialCase: () => void }) {
  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  return <section className="setup-page"><header className="page-header"><p className="eyebrow">采风</p><h1>先记下三件事，再开始讲故事</h1><p>真实比完整更重要。每段材料都会留下来源、状态和确认记录。</p></header><form className="field-form" onSubmit={onSubmit}><div className="card-rule" /><fieldset><legend>产品产业 <em>必填</em></legend><div className="product-options">{productOptions.map((option) => <button type="button" className={form.category === option ? "product-option selected" : "product-option"} key={option} onClick={() => { set("category", option); set("industry", option === "自定义" ? "" : option); }}><img src={`/guipin/assets/${stickerByProduct[option]}`} alt="" /><span>{option}</span></button>)}</div>{form.category === "自定义" && <label className="custom-industry-field">补充产品产业<input value={form.industry} onChange={(event) => set("industry", event.target.value)} placeholder="例如：蜂蜜、菌菇、腊肉" autoFocus required /></label>}</fieldset><div className="form-grid"><label>品牌 / 主体名称<input value={form.brand_name} onChange={(event) => set("brand_name", event.target.value)} required /></label><label>核心产品<input value={form.core_product} onChange={(event) => set("core_product", event.target.value)} placeholder="例如：刺梨原汁" required /></label><label>主要产地<input value={form.origin} onChange={(event) => set("origin", event.target.value)} placeholder="例如：贵州六盘水" required /></label></div><label className="consent"><input type="checkbox" checked={form.consent} onChange={(event) => set("consent", event.target.checked)} />{isTrialCase ? "我确认仅将内置案例用于体验，后续材料仍需核验和确认。" : "我确认已获得材料使用授权，不提交敏感个人信息。"}</label><footer><div className="trial-case-entry"><span>如果你不是商家也没关系～</span><button type="button" className="text-button" onClick={onTrialCase}>点这里试用内置案例</button><small>仅用于体验采风流程，后续内容仍需核验确认。</small></div><button className="primary-button" disabled={busy}>{busy ? "正在建立…" : "开始采风"}</button></footer></form></section>;
}

function Interview({ project, session, answer, setAnswer, uploads, busy, onFiles, onSend, trialAnswers, onFinish, onContinueFieldwork }: { project: Project; session: Session; answer: string; setAnswer: (value: string) => void; uploads: Array<{ id: string; file: File; status: string; error?: string }>; busy: boolean; onFiles: (event: ChangeEvent<HTMLInputElement>) => void; onSend: (skip?: boolean, presetAnswer?: string) => void; trialAnswers: TrialAnswer[]; onFinish: () => void; onContinueFieldwork: () => void }) {
  const readyToFinish = Boolean(session.ready_to_finish);
  const showFinishAction = readyToFinish && session.status === "active";
  const round = session.round ?? 1;
  return <><header className="interview-header"><div><p className="eyebrow">FIELD INTERVIEW{round > 1 ? ` / 第 ${round} 轮采风` : ""}</p><h1>{project.core_product}</h1><p>{project.origin} · 已自动保存</p></div></header><div className="interview-layout"><section className="transcript"><div className="transcript-head"><div><p className="eyebrow">对话记录</p><h2>从真实经历开始</h2></div><span>{session.field_notes.length} 条笔记</span></div><div className="transcript-list">{session.messages.map((message) => { return <article className={`turn turn-${message.role}`} key={message.id}><p className="turn-meta">{message.role === "assistant" ? "调查员" : message.role === "user" ? "受访者" : "系统"}</p><p>{message.content}</p></article>; })}</div><section className={trialAnswers.length > 0 ? "composer trial-composer" : "composer"}>{readyToFinish && <p className="composer-complete" role="status">本轮采风已收束。</p>}<label htmlFor="fieldwork-answer">你的回答 <small>一次只需说一件真实的事</small></label><textarea id="fieldwork-answer" value={answer} maxLength={2000} onChange={(event) => setAnswer(event.target.value)} placeholder="可以从一个人、一件事，或一个产品细节开始。" />{trialAnswers.length > 0 && !readyToFinish && <section className="trial-answer-options" aria-label="内置案例可选回答"><div><strong>内置案例可选回答</strong><small>点击后直接记录到本轮采风</small></div><div className="trial-answer-list">{trialAnswers.map((item) => <button type="button" className="trial-answer-button" key={item.id} disabled={busy} onClick={() => onSend(false, item.content)}><b>{item.label}</b><span>{item.content}</span></button>)}</div></section>}<div className="composer-footer"><div><label className="upload-button"><input type="file" accept="image/*" multiple onChange={onFiles} />添加照片</label><span>{answer.length} / 2,000</span></div><div><button className="text-button" onClick={() => onSend(true)} disabled={busy}>跳过</button><button className="primary-button" onClick={() => onSend()} disabled={busy}>{busy ? "正在整理…" : "记录并继续"}</button>{showFinishAction && <button className="secondary-button" onClick={onContinueFieldwork} disabled={busy}>继续采风</button>}{showFinishAction && <button className="secondary-button" onClick={onFinish} disabled={busy}>结束本次采风</button>}</div></div>{uploads.map((item) => <div className="upload-item" key={item.id}><span>{item.file.name}<small>{item.status === "ready" ? "已保存" : item.status === "failed" ? item.error : "正在上传"}</small></span></div>)}</section></section><aside className="notes-panel"><header><p className="eyebrow">FIELD NOTES</p><h2>本次采风笔记</h2></header>{session.field_notes.length ? <div className="note-stack">{session.field_notes.map((note) => <article className="sticky-note" key={note.id}><p>FIELD NOTE {String(note.sequence).padStart(2, "0")}</p><h3>{note.title}</h3><p>{note.summary}</p><small>待确认</small></article>)}</div> : <p className="notes-empty">第一张笔记会在这里出现。</p>}</aside></div></>;
}

function Candidates({ candidates, confirmed, researching, busy, onResolve, onContinue }: { candidates: Candidate[]; confirmed: number; researching: boolean; busy: boolean; onResolve: (item: Candidate, action: "confirm" | "discard") => void; onContinue: () => void }) {
  const pending = candidates.some((item) => item.status === "pending");
  const authorityLabel: Record<string, string> = { official: "官方资料", academic: "学术资料", cultural_institution: "文博 / 非遗机构", media: "待核验线索" };
  return <section className="candidate-page"><header className="page-header compact"><p className="eyebrow">采风完成 / 候选确认</p><h1>由你决定哪些材料进入档案</h1><p>{researching ? "正在整理本次采风的品牌档案。" : "AI 整理结果不是事实，确认前请核对原始访谈与来源。"}</p></header>{researching ? <section className="candidate-research-wait" role="status"><i aria-hidden="true" /><div><strong>正在整理品牌档案</strong><p>正在将本次采风材料整理为待确认的品牌档案。</p></div></section> : <><div className="candidate-grid">{candidates.map((item, index) => <article className="candidate-card" key={item.id}><p className="eyebrow">{item.type} / {String(index + 1).padStart(2, "0")}</p><h2>{item.title}</h2><p>{item.content}</p>{item.sources?.length ? <details className="candidate-sources"><summary>来源与依据 · {item.sources.length} 条</summary><ul>{item.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><span>{authorityLabel[source.authority] ?? "公开资料"}</span>{source.excerpt && <p>{source.excerpt}</p>}</li>)}</ul></details> : null}{item.risk && item.sources?.length ? <small className={`candidate-risk ${item.risk}`}>{item.risk === "low" ? "来源已记录" : item.risk === "medium" ? "请留意原始语境" : "需谨慎使用"}</small> : null}<footer>{item.status === "pending" ? <><button className="secondary-button" onClick={() => onResolve(item, "discard")}>弃用</button><button className="primary-button" onClick={() => onResolve(item, "confirm")}>确认入档</button></> : <span className={`status ${item.status}`}>{item.status === "confirmed" ? "已确认" : "已弃用"}</span>}</footer></article>)}</div><footer className="candidate-footer"><p>{pending ? "请先处理完每一张候选卡。" : confirmed ? `已有 ${confirmed} 条材料，将归入品牌档案后进入定调。` : "至少确认一张材料后才能编志。"}</p><button className="primary-button" disabled={!confirmed || pending || busy} onClick={onContinue}>{busy ? "正在确认…" : "确认编志并定调"}</button></footer></>}</section>;
}

function TaskStatus({ task, onRetry }: { task?: WorkflowTask; onRetry: (id: string) => void }) {
  if (!task) return null;
  const label = task.status === "queued" ? "已排队" : task.status === "running" ? `正在生成 ${task.progress}%` : task.status === "succeeded" ? "生成完成" : task.status === "partial" ? "文字已完成，部分视觉资产待重试" : "生成未完成";
  return <section className={`workflow-task ${task.status}`} role="status"><div><b>{label}</b><small>任务 {task.id.slice(0, 8)} · 刷新页面不会丢失</small></div><progress max={100} value={task.progress ?? 0} />{["failed", "partial"].includes(task.status) && <button className="secondary-button" onClick={() => onRetry(task.id)}>重试未完成阶段</button>}</section>;
}

function Chronicle({ workspace, task, onRetry, onOpenArchive, onContinueToning }: { workspace: Workspace; task?: WorkflowTask; onRetry: (id: string) => void; onOpenArchive: () => void; onContinueToning: () => void }) {
  const activeCount = workspace.archive_cards.filter((card) => card.status === "active").length;
  const publicCount = workspace.claims?.filter((claim) => claim.public_allowed).length ?? 0;
  const routesReady = workspace.directions.filter((route) => route.state !== "superseded").length >= 3;
  const generating = Boolean(task && ["queued", "running"].includes(task.status));
  const title = routesReady ? "编志完成，进入定调" : generating ? "正在编志与生成品牌路线" : "编志完成，接下来定调";
  const copy = routesReady ? "档案已沉淀为可定调的品牌资料。选择一版方向后，将据此生成品牌手册。" : generating ? "系统正在基于已确认的档案整理品牌故事与品牌方向。" : "档案与事实已冻结保存；补充 Logo、字体与颜色后，系统会生成三版品牌方向供你挑选。";
  const hint = routesReady ? "三条品牌路线已生成。比较后选择一条，系统会据此创建品牌手册。" : generating ? "品牌路线正在生成，完成后可直接挑选方向。" : "品牌方向与手册会进入品牌档案中的「品牌手册」，之后可随时回来继续。";
  const actionLabel = routesReady ? "选择路线方案 →" : generating ? "查看定调进度 →" : "继续定调 →";
  return <section className="stage-page chronicle-page"><StageHeader eyebrow="采风完成 / 编志" title={title} copy={copy} /><div className="stage-toolbar"><span>{activeCount} 张有效档案 · {publicCount} 条可公开事实</span><button className="secondary-button" onClick={onOpenArchive}>回看故事卡片与来源</button></div><TaskStatus task={task} onRetry={onRetry} /><footer className="stage-next"><p>{hint}</p><button className="primary-button" onClick={onContinueToning}>{actionLabel}</button></footer></section>;
}


function AssetHistory({ workspace, onBack, onLaunch }: { workspace: Workspace; onBack: () => void; onLaunch: () => void }) {
  return <section className="stage-page asset-history-page"><header className="asset-hero"><div><p className="eyebrow">{workspace.project.brand_name} · 出山记录</p><h1>每一次出山，都是一份可回看的概念稿。</h1><p>这里仅保留从出山工作台生成的图文稿与原型稿历史。</p></div><button className="secondary-button" onClick={onBack}>← 回到品牌档案</button></header><section className="asset-history-list launch-history-list"><header><p className="eyebrow">生成历史</p><h2>图文稿与原型稿</h2></header>{workspace.generation_jobs.length ? workspace.generation_jobs.map((job) => <article key={job.id}><div><strong>{job.template_type === "xiaohongshu" ? "小红书图文" : "周边概念稿"}</strong><span className={`job-status ${job.status}`}>{job.status === "succeeded" ? "已生成" : job.status === "partial" ? "文字 Brief 已保留" : "任务未完成"}</span></div><p>{String(job.result.brief ?? job.result.body ?? "文字 Brief 已保留")}</p>{typeof job.result.image === "object" && job.result.image && (job.result.image as Record<string, string>).kind === "url" && <img src={(job.result.image as Record<string, string>).value} alt={`${job.template_type === "xiaohongshu" ? "小红书图文" : "周边"}概念稿`} />}{Array.isArray(job.result.titles) && <ul>{stringList(job.result.titles).map((title) => <li key={title}>{title}</li>)}</ul>}<small>AI 概念稿，不可直接印刷</small></article>) : <Empty title="这里会保存周边概念稿与小红书图文的历史版本" action={onLaunch} actionLabel="去出山" />}</section></section>;
}

function Directions({ directions, claims, current, manual, routeTask, busy, onGenerate, onRetry, onPreview, onOpenManual }: { directions: Direction[]; claims: Claim[]; current?: Direction; manual?: Workspace["manual"]; routeTask?: WorkflowTask; busy: boolean; onGenerate: () => void; onRetry: (id: string) => void; onPreview: (route: Direction) => void; onOpenManual: () => void }) { const latestVersion = Math.max(0, ...directions.map((item) => item.version ?? 0)); const routes = directions.filter((item) => item.state !== "superseded" && (item.version ?? 0) === latestVersion); const manualReady = Boolean(current && manual); return <section className="stage-page"><StageHeader eyebrow="定调 / 品牌路线" title="让事实决定方向，而不是替代事实" copy="点击任一方案查看完整草案；确认路线后会立即创建可编辑手册，视觉资产将在手册内单独生成。" /><div className="stage-toolbar"><span>{current ? `已选：${current.title}` : "请选择一版品牌方向"}</span><button className="secondary-button" onClick={onGenerate} disabled={busy || routeTask?.status === "running"}>{directions.length ? "重新生成新版本" : "生成三版方案"}</button></div><TaskStatus task={routeTask?.status === "succeeded" ? undefined : routeTask} onRetry={onRetry} />{routes.length ? <div className="route-grid route-grid-three">{routes.map((route) => <RouteCard key={route.id} route={route} claims={claims} onOpen={onPreview} />)}</div> : <Empty title="品牌手册首次设置后，这里会出现三版方案" />}{manualReady && <footer className="stage-next"><button className="primary-button" onClick={onOpenManual}>查看完整品牌手册</button></footer>}</section>; }
function RouteCard({ route, claims, onOpen }: { route: Direction; claims: Claim[]; onOpen: (route: Direction) => void }) { const value = cardContent(route); const points = Array.isArray(value.selling_points) ? value.selling_points : []; const scenarios = Array.isArray(value.target_scenarios) ? value.target_scenarios.join("、") : String(value.target_scenarios ?? ""); const open = () => onOpen(route); return <article className={`route-card route-card-open ${route.state === "current" ? "is-current" : ""}`} role="button" tabIndex={0} aria-label={`查看路线 ${route.route_no}：${route.title} 的品牌手册草案`} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}><p className="eyebrow">路线 0{route.route_no} {route.state === "current" ? "· 已选择" : ""}</p><h2>{route.title}</h2><p className="route-one-liner">{String(value.brand_one_liner ?? "")}</p><dl><dt>人群与场景</dt><dd>{String(value.target_audience ?? "")} · {scenarios}</dd><dt>故事与价值</dt><dd>{String(value.story_spine ?? "")}<br />{String(value.emotion_value ?? "")} · {String(value.altruistic_value ?? "")}</dd><dt>三条卖点</dt><dd className="route-evidence-list">{points.map((raw, index) => { const point = typeof raw === "object" && raw ? raw as Record<string, unknown> : { text: String(raw), claimIds: [] }; const claimIds = Array.isArray(point.claimIds) ? point.claimIds.map(String) : []; const linked = claims.filter((claim) => claimIds.includes(claim.id)); return <details key={`${String(point.text)}-${index}`} onClick={(event) => event.stopPropagation()}><summary>{String(point.text)} <small>{linked.length ? `${linked.length} 条证据` : "待补证"}</small></summary>{linked.length ? linked.map((claim) => <p key={claim.id}>{claim.statement}<em>{claim.status} · {claim.risk}</em></p>) : <p>该表达尚未绑定可公开事实，不能直接作为公开卖点。</p>}</details>; })}</dd><dt>视觉路线</dt><dd>{stringList(value.visual_keywords).join(" / ")}</dd></dl><span className="route-card-open-hint">点击查看品牌手册草案 →</span></article>; }

function Tide({ report, busy, onRefresh, onFavorite, onUse, onNext }: { report: TideReport | null; busy: boolean; onRefresh: () => void; onFavorite: (id: string) => void; onUse: (idea: TideReportIdea) => void; onNext: () => void }) {
  const edition = report?.edition;
  const orderedIdeas = useMemo(() => orderTideIdeas(edition?.ideas ?? []), [edition?.ideas]);
  const refresh = report?.refresh_state; const previewSources = report?.preview_sources ?? [];
  const channelLabel: Record<TideReportSource["channel"], string> = { industry: "行业媒体", xiaohongshu: "小红书公开帖", douyin: "抖音公开趋势" };
  const phaseLabel: Record<TideRefreshState["phase"], string> = { idle: "等待刷新", collecting: "搜集资讯", verifying: "验链正文", deduplicating: "四周排重", synthesizing: "提炼灵感", completed: "刷新完成", failed: "刷新未完成" };
  const refreshLabel = refresh?.status === "running"
    ? phaseLabel[refresh.phase] + "…"
    : refresh && ["succeeded", "partial"].includes(refresh.status)
      ? "本周已刷新"
      : refresh?.status === "failed" && !refresh.can_refresh
        ? "60 秒后可重试"
        : "刷新本周资讯";
  const refreshDisabled = !refresh || refresh.status === "running" || ["succeeded", "partial"].includes(refresh.status) || !refresh.can_refresh;
  const articleCards = previewSources.map((source) => (
    <article className="inspiration-card tide-report-card" key={source.id}>
      <header><p className="eyebrow">近 7 天已验链文章</p><time>{source.published_at}</time></header>
      <h2>{source.source_title}</h2>
      <p>{channelLabel[source.channel]} · {source.publisher}</p>
      <dl className="tide-idea-meta"><dt>原文链接</dt><dd><a href={source.source_url} target="_blank" rel="noreferrer"><span>打开原文</span>{source.source_url} <em>↗</em></a></dd></dl>
      <footer><span>已校验发布日期、可访问性与正文；等待提炼，不作为趋势结论展示。</span></footer>
    </article>
  ));
  return <section className="stage-page tide-page">
    <StageHeader eyebrow="观潮 / 本周观察" title="从新消费变化里，找到商家现在能做什么" copy="每周一自动更新：把年轻人的情绪价值、兴趣社交、体验消费与新场景，转成可直接尝试的商家动作。" />
    <button type="button" className="tide-refresh-text-button" disabled={refreshDisabled} aria-busy={refresh?.status === "running"} onClick={onRefresh}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-4L3 9m-1-5v5h5m-3 4a8 8 0 0 0 14.9 4L21 15m1 5v-5h-5" /></svg>
      <span>{refreshLabel}</span>
    </button>
    {edition?.ideas.length ? <div className="inspiration-grid">{orderedIdeas.map((idea, index) => <article className="inspiration-card tide-report-card" key={idea.id}><header><p className="eyebrow">{edition.scope === "personal" ? "私人灵感" : "共享灵感"} {String(index + 1).padStart(2, "0")}</p><time>{idea.festival_context}</time></header><h2>{idea.theme}</h2><p>{idea.content_motif}</p><dl className="tide-idea-meta"><dt>商家可以马上做什么</dt><dd>{idea.applicable_scene}</dd>{idea.sources.length ? <><dt>提炼来源 / 原文链接</dt><dd>{idea.sources.map((source) => <a href={source.source_url} target="_blank" rel="noreferrer" key={source.id}><span>{channelLabel[source.channel]} · {source.publisher} · {source.published_at}</span>{source.source_title} <em>打开原文 ↗</em></a>)}</dd></> : <><dt>灵感依据</dt><dd>节假日节点：{idea.festival_context}（不引用新闻媒体）</dd></>}</dl><footer><div><button className="text-button" disabled={busy} onClick={() => onFavorite(idea.id)}>{idea.favorite ? "已收藏" : "收藏灵感"}</button><span>{idea.risk_note}</span></div><button className="secondary-button" disabled={busy} onClick={() => onUse(idea)}>用此灵感出山</button></footer></article>)}</div> : previewSources.length ? <section className="inspiration-grid" aria-label="近 7 天已验链文章">{articleCards}</section> : <Empty title={refresh?.status === "running" ? "正在搜集本周资讯，完成后会自动出现在这里。" : refresh?.status === "failed" ? "本次联网刷新没有发布新结果；请在 60 秒后重试。" : "当前没有可显示的周报；可以使用本周私人刷新机会。"} />}
    <footer className="stage-next"><button className="primary-button" onClick={onNext}>不选灵感，直接出山</button></footer>
  </section>;
}
function Launch({ workspace, projects, inspiration, busy, prompt, type, preview, canGenerate, hasPrompt = Boolean(prompt.trim() || inspiration), selectedMaterials, pickerOpen, materialPickerOpen, onPromptChange, onTypeChange, onOpenPicker, onClosePicker, onOpenMaterialPicker, onCloseMaterialPicker, onToggleMaterial, onSelectArchive, onPreview, onRemoveInspiration = () => {}, onSavePreview, onClosePreview, onOpenRecords }: { workspace?: Workspace; projects: Project[]; inspiration?: Inspiration; busy: boolean; prompt: string; type: "peripheral" | "xiaohongshu"; preview: GenerationPreview | null; canGenerate: boolean; hasPrompt?: boolean; selectedMaterials: MaterialTemplate[]; visualAssetCount: number; pickerOpen: boolean; materialPickerOpen: boolean; onPromptChange: (value: string) => void; onTypeChange: (value: "peripheral" | "xiaohongshu") => void; onOpenPicker: () => void; onClosePicker: () => void; onOpenMaterialPicker: () => void; onCloseMaterialPicker: () => void; onToggleMaterial: (id: string) => void; onSelectArchive: (project: Project) => void; onPreview: () => void; onRemoveInspiration?: () => void; onSavePreview: () => void; onClosePreview: () => void; onOpenRecords: () => void }) {
  const activeCards = workspace?.archive_cards.filter((card) => card.status === "active") ?? [];
  const direction = workspace?.directions.find((item) => item.state === "current");
  const readinessMessage = !workspace ? "请先选择本次出山要使用的品牌档案。" : !activeCards.length ? "该档案尚无有效资料，请先确认入档材料。" : !direction ? "该档案尚未确定品牌路线，请先完成定调。" : type === "peripheral" && !selectedMaterials.length ? "请选择至少一种实体物料，再开始生成预览。" : "档案、路线与物料已就绪，可开始生成预览。";
  return <section className="stage-page launch-page">
    <header className="launch-header"><div><p className="eyebrow">出山</p><h1>出山</h1><p>选择品牌档案和出山方向。</p></div><button className="primary-button launch-record-button" disabled={!workspace} onClick={onOpenRecords}>打开出山记录 →</button></header>
    {inspiration && <div className="selected-inspiration"><span>已选观潮灵感 · <strong>{inspiration.theme}</strong></span><button type="button" aria-label={`移除观潮灵感：${inspiration.theme}`} onClick={onRemoveInspiration}>×</button></div>}
    <section className="launch-conversation" aria-label="出山输入"><header><p className="eyebrow">出山输入</p><a href="#launch-type">选择生成类型 ↓</a></header><div className="launch-archive-bar"><div><p className="eyebrow">品牌档案</p><strong>{workspace?.project.brand_name ?? "尚未选择"}</strong><small>{workspace ? `${activeCards.length} 张有效资料 · ${direction ? `已选路线：${direction.title}` : "尚未选择路线"}` : "选择后用于本次生成。"}</small></div><button className="secondary-button" type="button" onClick={onOpenPicker} disabled={busy}>{workspace ? "更换品牌档案" : "选择品牌档案"}</button></div><p className={`launch-readiness ${canGenerate ? "is-ready" : ""}`} role="status">{readinessMessage}</p><section className="launch-prompt-templates" aria-labelledby="launch-template-title"><header><p className="eyebrow" id="launch-template-title">预设提示词</p><small>选择一种常用需求，可继续修改。</small></header><div>{launchPromptTemplates.map((template) => <button type="button" className="launch-prompt-template" key={template.label} onClick={() => onPromptChange(template.text)}><strong>{template.label}</strong><span>{template.note}</span></button>)}</div></section><label className="launch-composer"><span className="sr-only">输入出山需求</span><textarea value={prompt} maxLength={1200} onChange={(event) => onPromptChange(event.target.value)} placeholder={workspace ? "描述想生成的内容。" : "请先选择品牌档案。"} /><button className="primary-button" disabled={busy || !canGenerate || !hasPrompt} onClick={onPreview}>{busy ? "正在生成预览…" : "生成预览 →"}</button></label><small>{prompt.length} / 1,200 · 预览不会自动归档</small></section>
    <section className="launch-types" id="launch-type"><button type="button" className={`launch-type-card peripheral ${type === "peripheral" ? "is-selected" : ""}`} onClick={() => { onTypeChange("peripheral"); onOpenMaterialPicker(); }}><span>出山方向 01</span><strong>实体物料设计</strong><small>{selectedMaterials.length ? `已选：${selectedMaterials.map((item) => item.label).join("、")}` : "选择物料类型与样机参考。"}</small><i aria-hidden="true">◒</i></button><button type="button" className={`launch-type-card social ${type === "xiaohongshu" ? "is-selected" : ""}`} onClick={() => onTypeChange("xiaohongshu")}><span>出山方向 02</span><strong>线上图文生成</strong><small>小红书封面概念、标题、正文与话题结构。</small><i aria-hidden="true">✦</i></button></section>
    {workspace?.generation_jobs.length ? <section className="launch-saved-note"><p>已有 {workspace.generation_jobs.length} 份已保存产物</p><button className="text-button" onClick={onOpenRecords}>查看全部记录</button></section> : null}
    {pickerOpen && <LaunchArchivePicker projects={projects} selectedId={workspace?.project.id} busy={busy} onClose={onClosePicker} onSelect={onSelectArchive} />}
    {materialPickerOpen && <LaunchMaterialPicker selectedIds={selectedMaterials.map((item) => item.id)} onClose={onCloseMaterialPicker} onToggle={onToggleMaterial} />}
    {preview && <LaunchPreviewModal preview={preview} busy={busy} onClose={onClosePreview} onSave={onSavePreview} />}
  </section>;
}

function LaunchArchivePicker({ projects, selectedId, busy, onClose, onSelect }: { projects: Project[]; selectedId?: string; busy: boolean; onClose: () => void; onSelect: (project: Project) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  return <div className="archive-modal-backdrop launch-archive-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="launch-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="launch-archive-title"><header><div><p className="eyebrow">品牌档案</p><h2 id="launch-archive-title">选择本次出山的品牌档案</h2><p>本次生成只会使用你选定项目的有效资料与当前品牌路线。</p></div><button className="modal-close" ref={closeRef} aria-label="关闭品牌档案选择" onClick={onClose}>×</button></header><div className="launch-archive-list">{projects.length ? projects.map((item) => <button type="button" className={`launch-archive-option ${item.id === selectedId ? "is-selected" : ""}`} key={item.id} disabled={busy} onClick={() => onSelect(item)}><span>{item.industry || "档"}</span><div><small>{item.origin || "产地待补"} · {item.core_product || "产品待补"}</small><strong>{item.brand_name}</strong></div><b>{item.id === selectedId ? "已选择" : "用于出山 →"}</b></button>) : <p className="launch-archive-empty">还没有可选择的品牌档案。请先完成采风并确认材料。</p>}</div></section></div>;
}

function LaunchMaterialPicker({ selectedIds, onClose, onToggle }: { selectedIds: string[]; onClose: () => void; onToggle: (id: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  return <div className="archive-modal-backdrop launch-material-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="launch-material-dialog" role="dialog" aria-modal="true" aria-labelledby="launch-material-title"><header><div><p className="eyebrow">实体物料设计</p><h2 id="launch-material-title">选择本次要生成的物料</h2><p>可多选。所选类型会和你的需求一起进入本次概念生成。</p></div><button className="modal-close" ref={closeRef} aria-label="关闭实体物料选择" onClick={onClose}>×</button></header><fieldset className="launch-material-grid"><legend className="sr-only">实体物料类型</legend>{materialTemplates.map((item) => { const checked = selectedIds.includes(item.id); return <label className={`launch-material-option ${checked ? "is-selected" : ""}`} key={item.id}><input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} /><span className="launch-material-image">{item.image ? <Image src={item.image} alt={item.alt ?? "实体物料空白样机"} fill sizes="(max-width: 760px) 42vw, 210px" /> : <span aria-hidden="true">样机<br />待补</span>}</span><span className="launch-material-copy"><strong>{item.label}</strong><small>{item.note}</small></span></label>; })}</fieldset><footer><small>{selectedIds.length ? `已选择 ${selectedIds.length} 种物料` : "至少选择一种物料后，才可生成实体物料预览。"}</small><button type="button" className="primary-button" onClick={onClose}>完成选择</button></footer></section></div>;
}

function LaunchPreviewModal({ preview, busy, onClose, onSave }: { preview: GenerationPreview; busy: boolean; onClose: () => void; onSave: () => void }) {
  const image = preview.result.image as Record<string, string> | undefined;
  const imageUrl = image && (image.kind === "url" || image.kind === "local") ? image.value : undefined;
  const titles = stringList(preview.result.titles);
  const warning = typeof preview.result.warning === "string" ? preview.result.warning : null;
  return <div className="launch-preview-backdrop" role="presentation" onMouseDown={onClose}><section className="launch-preview-dialog" role="dialog" aria-modal="true" aria-label="出山生成预览" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">生成预览 / 尚未归档</p><h2>{preview.template_type === "xiaohongshu" ? "线上图文生成" : "实体物料设计"}</h2></div><button className="modal-close" aria-label="关闭预览" onClick={onClose}>×</button></header>{preview.status === "partial" && warning && <p className="launch-preview-warning" role="status">{warning}</p>}<div className="launch-preview-content">{imageUrl && <figure><img src={imageUrl} alt="AI 概念预览" /><figcaption>AI 概念稿，不可直接印刷</figcaption></figure>}<article><p className="eyebrow">文字 Brief</p><p>{String(preview.result.brief ?? "")}</p>{preview.template_type === "xiaohongshu" && <><h3>标题提案</h3><ul>{titles.map((title) => <li key={title}>{title}</li>)}</ul><p>{String(preview.result.body ?? "")}</p></>}{preview.template_type === "peripheral" && <><h3>{String(preview.result.concept_title ?? "周边概念")}</h3><p>{stringList(preview.result.materials).join(" · ")}</p></>}</article></div><footer><small>确认保存后，它才会进入档案的「出山记录」。</small><div><button className="secondary-button" disabled={busy} onClick={onClose}>继续修改</button><button className="primary-button" disabled={busy} onClick={onSave}>{busy ? "正在保存…" : "保存到档案"}</button></div></footer></section></div>;
}
function StageHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) { return <header className="page-header compact"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></header>; }
function Empty({ title, action, actionLabel = "开始" }: { title: string; action?: () => void; actionLabel?: string }) { return <div className="empty-state"><p>{title}</p>{action && <button className="secondary-button" onClick={action}>{actionLabel}</button>}</div>; }
