"use client";

import Link from "next/link";
import Image from "next/image";
import { ChangeEvent, Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, createRequestId, encodeFileNameForHeader } from "@/lib/api";
import { ArchiveFolioDialog, BrandMaterials, DirectionDraftDialog, ProjectDirectory } from "@/components/archive-studio";
import { BrandManualResult, type ManualVisualPreferences } from "@/components/brand-manual-result";
import { FailureToast } from "@/components/failure-toast";

export type Project = { id: string; brand_name: string; industry: string; core_product: string; origin: string; current_stage?: string; current_direction_id?: string; status?: string };
type Account = { id: string; email: string; created_at: string };
type Session = { id: string; status: string; started_at: string; field_notes: Note[]; messages: Message[]; ready_to_finish?: boolean };
type Message = { id: string; role: "assistant" | "user" | "system"; content: string };
type Note = { id: string; type: string; title: string; summary: string; sequence: number };
type Candidate = { id: string; type: string; title: string; content: string; status: string };
export type ArchiveCard = { id: string; type: string; title: string; content: string; status: string; content_version: number; source_summary?: string; created_at?: string; updated_at?: string };
export type Direction = { id: string; route_no: number; state: string; title: string; content_json?: Record<string, unknown>; content?: Record<string, unknown>; version?: number };
export type Claim = { id: string; field_note_id?: string; statement: string; status: string; risk: string; public_allowed: number; source_record_ids?: string[] };
export type WorkflowTask = { id: string; kind: "follow_up" | "route_generation" | "manual_generation" | "logo_generation" | "manual_asset_generation" | "export"; status: "queued" | "running" | "succeeded" | "partial" | "failed"; progress: number; error_code?: string; result?: Record<string, unknown> };
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
export type Workspace = { project: Project; session?: Session | null; archive_cards: ArchiveCard[]; claims?: Claim[]; directions: Direction[]; tasks?: WorkflowTask[]; manual?: { content: Record<string, unknown>; current_version_id?: string }; manual_versions?: ManualVersion[]; manual_assets?: ManualAsset[]; exports?: Array<{ id: string; format: string; download_url?: string }>; shares?: Array<{ id: string; revoked_at?: string; created_at: string }>; tide_searches: Tide[]; generation_jobs: Job[] };
type Screen = "setup" | "interview" | "candidates" | "project-directory" | "archive" | "assets" | "chronicle" | "directions" | "manual" | "tide" | "launch";
type SetupForm = { brand_name: string; industry: string; core_product: string; origin: string; category: string; consent: boolean };
const productOptions = ["刺梨", "酸汤", "辣椒", "贵州茶", "抹茶", "蓝莓", "猕猴桃", "自定义"];
const stickerByProduct: Record<string, string> = { 刺梨: "sticker-cili.png", 酸汤: "sticker-sour-soup.png", 辣椒: "sticker-chili.png", 贵州茶: "sticker-tea.png", 抹茶: "sticker-matcha.png", 蓝莓: "sticker-blueberry.png", 猕猴桃: "sticker-kiwi.png", 自定义: "sticker-custom.png" };
const primaryScreens: Array<{ key: "fieldwork" | "tide" | "launch"; label: string; number: string; icon: string }> = [
  { key: "fieldwork", label: "采风", number: "01", icon: "⌁" }, { key: "tide", label: "观潮", number: "02", icon: "≈" }, { key: "launch", label: "出山", number: "03", icon: "↗" },
];
const mobileScreenTitles: Record<Screen, string> = {
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
  { id: "sticker", label: "品牌贴纸", note: "多规格贴纸组合", image: "/guipin/launch-materials/brand-stickers.png", alt: "自然光下的空白品牌贴纸样机" },
  { id: "gift-box", label: "礼盒包装", note: "开合式礼盒正面", image: "/guipin/launch-materials/gift-box.png", alt: "自然光下的空白礼盒样机" },
  { id: "can", label: "罐装包装", note: "空白样机待补" },
  { id: "expo-banner", label: "展会易拉宝", note: "现场立牌版式参考", image: "/guipin/launch-materials/expo-banner.png", alt: "自然光下的空白展会立牌样机" },
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
const DEMO_FIELDWORK_SESSION: Session = { id: "demo-fieldwork", status: "active", started_at: "2026-08-29T09:20:00Z", ready_to_finish: true, field_notes: [{ id: "demo-note-1", type: "BRAND", title: "合作社从一片坡地开始", summary: "以人工采收和当天分拣为主，仍待确认后入档。", sequence: 1 }], messages: [{ id: "demo-message-1", role: "assistant", content: "从这份品牌的来处讲起：最初是谁、因为什么开始做这件事？" }, { id: "demo-message-2", role: "user", content: "果园在山坡上，最早是几户人家一起种下的。" }, { id: "demo-message-3", role: "system", content: "已整理 1 条采风笔记，待确认。" }, { id: "demo-message-4", role: "assistant", content: "产品从采收或原料到成品，哪一个环节最能说明你们是怎么做的？" }, { id: "demo-message-5", role: "user", content: "果子成熟当天采下，当天就完成分拣。" }, { id: "demo-message-6", role: "assistant", content: "这一轮已经收集到几段可继续整理的材料。你可以结束本次采风，逐张确认候选档案。" }] };
function demoProjects(): Project[] { const base = createDemoWorkspace().project; return [base, { id: "demo-tea", brand_name: "都匀云雾茶 · 试验档", industry: "贵州茶", core_product: "云雾绿茶", origin: "贵州都匀", current_stage: "archive" }, { id: "demo-chili", brand_name: "黔北糟辣椒合作社", industry: "糟辣椒", core_product: "糟辣椒", origin: "贵州遵义", current_stage: "archive" }, { id: "demo-soup", brand_name: "凯里酸汤小作坊", industry: "酸汤", core_product: "红酸汤", origin: "贵州凯里", current_stage: "archive" }]; }

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

export default function WorkbenchApp({ initialDemo = false, initialScreen = "archive", initialManual = false, initialDirectionDraft = false, initialFieldwork = false }: { initialDemo?: boolean; initialScreen?: Screen; initialManual?: boolean; initialDirectionDraft?: boolean; initialFieldwork?: boolean }) {
  const [demoSeed] = useState<Workspace | null>(() => initialDemo ? createDemoWorkspace() : null);
  const [project, setProject] = useState<Project | null>(() => demoSeed?.project ?? null);
  const [session, setSession] = useState<Session | null>(() => initialFieldwork ? structuredClone(DEMO_FIELDWORK_SESSION) : null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(() => demoSeed);
  const [projectDirectory, setProjectDirectory] = useState<Project[]>(() => initialDemo ? demoProjects() : []);
  const [screen, setScreen] = useState<Screen>(initialDemo ? (initialManual ? "manual" : initialScreen) : "setup");
  const [form, setForm] = useState<SetupForm>({ brand_name: "", industry: "刺梨", core_product: "", origin: "", category: "刺梨", consent: false });
  const [answer, setAnswer] = useState("");
  const [uploads, setUploads] = useState<Array<{ id: string; file: File; status: "uploading" | "ready" | "failed"; assetId?: string; error?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [launchInspiration, setLaunchInspiration] = useState<Inspiration | null>(null);
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [launchType, setLaunchType] = useState<"peripheral" | "xiaohongshu">("peripheral");
  const [generationPreview, setGenerationPreview] = useState<GenerationPreview | null>(null);
  const [launchArchiveId, setLaunchArchiveId] = useState<string | null>(null);
  const [launchArchivePickerOpen, setLaunchArchivePickerOpen] = useState(false);
  const [launchMaterialIds, setLaunchMaterialIds] = useState<string[]>([]);
  const [launchMaterialPickerOpen, setLaunchMaterialPickerOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(initialDemo);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [archiveModal, setArchiveModal] = useState<"cards" | null>(null);
  const [directionDraft, setDirectionDraft] = useState<Direction | null>(() => initialDirectionDraft ? demoSeed?.directions[0] ?? null : null);
  const [tideReport, setTideReport] = useState<TideReport | null>(null);
  const [visitorReady, setVisitorReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);

  const closeMobileNav = useCallback((restoreFocus = true) => {
    setMobileNavOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => mobileNavTriggerRef.current?.focus());
  }, []);

  function loadDemoWorkspace(reason?: unknown) {
    const demo = createDemoWorkspace();
    setProject(demo.project); setWorkspace(demo); setProjectDirectory(demoProjects()); setScreen("project-directory"); setDemoMode(true); setDemoReason(reason ? errorText(reason) : null); setError(null);
  }

  useEffect(() => {
    void api<{ data: unknown }>("/visitors", { method: "POST" }).then(async () => {
      setVisitorReady(true);
      if (initialDemo) return;
      try { const me = await api<{ data: Account | null }>("/auth/me"); setAccount(me.data); } catch { /* Anonymous fieldwork remains available when auth is unavailable. */ }
      try { const directory = await api<{ data: Project[] }>("/projects"); setProjectDirectory(directory.data); } catch { /* workspace loading still works with an older backend */ }
      const saved = window.localStorage.getItem("mountainlore-project-id");
      if (!saved) return;
      try {
        const response = await api<{ data: Workspace }>(`/projects/${saved}/workspace`);
        setWorkspace(response.data); setProject(response.data.project); setSession(response.data.session ?? null); setScreen(stageToScreen(response.data.project.current_stage, response.data.project.status));
      } catch { window.localStorage.removeItem("mountainlore-project-id"); }
    }).catch((caught) => setError(`真实后端暂不可用（${errorText(caught)}）。请检查服务后重试。`));
  }, [initialDemo]);


  useEffect(() => {
    if (!initialDemo || !initialFieldwork) return;
    const demo = createDemoWorkspace();
    setProject(demo.project);
    setWorkspace(demo);
    setProjectDirectory(demoProjects());
    setSession(structuredClone(DEMO_FIELDWORK_SESSION));
    setCandidates([]);
    setScreen("interview");
  }, [initialDemo, initialFieldwork]);
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

  useEffect(() => {
    if (!activeWorkflowTask || demoMode || !project) return;
    const timer = window.setInterval(() => {
      void api<{ data: Workspace }>(`/projects/${project.id}/workspace`)
        .then((response) => {
          setWorkspace(response.data); setProject(response.data.project); setSession(response.data.session ?? null);
          if (screen === "manual" && response.data.directions.filter((item) => item.state !== "superseded").length >= 3) setScreen("manual");
        })
        .catch((caught) => setError(errorText(caught)));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeWorkflowTask, demoMode, project, screen]);

  const loadTideReport = useCallback(async () => {
    if (!visitorReady) return;
    const path = demoMode ? "/tide-report/sample" : project ? "/projects/" + project.id + "/tide-report" : null;
    if (!path) return;
    const response = await api<{ data: TideReport }>(path);
    setTideReport(response.data);
  }, [demoMode, project, visitorReady]);

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
    if (demoMode) return;
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
      const saved = window.localStorage.getItem("mountainlore-project-id");
      if (saved) {
        try { await refreshWorkspace(saved); } catch { window.localStorage.removeItem("mountainlore-project-id"); }
      }
    } catch (caught) { setError(errorText(caught)); throw caught; }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(null);
    try {
      await api("/auth/logout", { method: "POST" }); setAccount(null);
      const directory = await api<{ data: Project[] }>("/projects"); setProjectDirectory(directory.data);
      if (project && !directory.data.some((item) => item.id === project.id)) {
        setProject(null); setWorkspace(null); setSession(null); window.localStorage.removeItem("mountainlore-project-id"); setScreen("project-directory");
      }
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
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
  async function deleteProject(target: Project) {
    setBusy(true); setError(null);
    try {
      if (!demoMode) await api(`/projects/${target.id}`, { method: "DELETE" });
      setProjectDirectory((items) => items.filter((item) => item.id !== target.id));
      if (project?.id === target.id) {
        setProject(null); setWorkspace(null); setSession(null);
        window.localStorage.removeItem("mountainlore-project-id");
        setScreen("project-directory");
      }
    } catch (caught) { setError(errorText(caught)); }
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
    const items = files.map((file) => ({ id: createRequestId("upload"), file, status: "uploading" as const }));
    setUploads((previous) => [...previous, ...items]);
    await Promise.all(items.map(async (item) => {
      try {
        const result = await api<{ data: { id: string } }>("/media", { method: "POST", body: item.file, headers: { "Content-Type": item.file.type, "X-Project-ID": project.id, "X-File-Name": encodeFileNameForHeader(item.file.name) } });
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
      const result = await api<{ data: { session: Session } }>(`/sessions/${session.id}/messages`, { method: "POST", headers: { "Idempotency-Key": createRequestId("message") }, body: JSON.stringify({ content: answer, skipped, media_asset_ids: assetIds }) });
      setSession(result.data.session); setAnswer(""); setUploads([]);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function finishFieldwork() {
    if (demoMode) { setCandidates([{ id: "demo-candidate-1", type: "BRAND", title: "品牌的来处", content: "果园从几户人家共同种下的一片山坡开始。", status: "pending" }, { id: "demo-candidate-2", type: "PROCESS", title: "当天采收与分拣", content: "果实成熟当天采收，并在当天完成分拣。", status: "pending" }]); setSession((current) => current ? { ...current, status: "completed" } : current); setScreen("candidates"); return; }
    if (!session || !project) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ data: { candidates: Candidate[]; session: Session } }>(`/sessions/${session.id}/finish`, { method: "POST", headers: { "Idempotency-Key": createRequestId("finish") } });
      setCandidates(result.data.candidates); setSession(result.data.session); setScreen("candidates");
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function resolveCandidate(candidate: Candidate, action: "confirm" | "discard") {
    try {
      const result = await api<{ data: { candidate: Candidate } }>(`/candidates/${candidate.id}/${action}`, { method: "POST", headers: { "Idempotency-Key": createRequestId("candidate") } });
      setCandidates((previous) => previous.map((item) => item.id === candidate.id ? result.data.candidate : item));
    } catch (caught) { setError(errorText(caught)); }
  }

  async function saveCard(card: ArchiveCard): Promise<boolean> { if (demoMode) { setWorkspace((current) => current ? { ...current, archive_cards: current.archive_cards.map((item) => item.id === card.id ? { ...card, content_version: item.content_version + 1, updated_at: new Date().toISOString() } : item) } : current); return true; } setBusy(true); setError(null); try { await api(`/archive-cards/${card.id}`, { method: "PATCH", body: JSON.stringify({ title: card.title, content: card.content, expected_content_version: card.content_version }) }); await refreshWorkspace(); return true; } catch (caught) { setError(errorText(caught)); return false; } finally { setBusy(false); } }
  async function createDirections(preferences?: ManualVisualPreferences) { if (!project) return; if (demoMode) { setScreen("chronicle"); return; } setBusy(true); setError(null); try { await api(`/projects/${project.id}/directions`, { method: "POST", headers: { "Idempotency-Key": createRequestId("directions") }, body: JSON.stringify({ visual_preferences: preferences ?? {} }) }); await refreshWorkspace(); setScreen("chronicle"); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function confirmChronicle() { if (!project) return; if (demoMode) { setScreen("manual"); return; } setBusy(true); setError(null); try { await api(`/projects/${project.id}/chronicle/confirm`, { method: "POST", headers: { "Idempotency-Key": `chronicle-${project.id}` }, body: JSON.stringify({ request_id: "initial", defer_directions: true }) }); await refreshWorkspace(); setScreen("manual"); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function saveManual(content: Record<string, unknown>) { if (!project) return; if (demoMode) { setWorkspace((current) => current ? { ...current, manual: { ...(current.manual ?? {}), content } } : current); return; } setBusy(true); setError(null); try { await api(`/projects/${project.id}/brand-manual`, { method: "PATCH", body: JSON.stringify({ content_json: content }) }); await refreshWorkspace(); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function retryTask(id: string) { try { await api(`/tasks/${id}/retry`, { method: "POST" }); await refreshWorkspace(); } catch (caught) { setError(errorText(caught)); } }
  async function generateManualAsset(kind: "extension_pattern" | "packaging_key_visual") { if (!project || demoMode) return; try { await api(`/projects/${project.id}/brand-manual/generate-assets/${kind}`, { method: "POST", headers: { "Idempotency-Key": createRequestId(`asset-${kind}`) } }); await refreshWorkspace(); } catch (caught) { setError(errorText(caught)); } }
  async function selectDirection(id: string): Promise<boolean> { if (demoMode) { setWorkspace((current) => current ? { ...current, project: { ...current.project, current_direction_id: id, status: "manual_ready" }, directions: current.directions.map((route) => ({ ...route, state: route.id === id ? "current" : "draft" })) } : current); setScreen("manual"); return true; } setBusy(true); setError(null); try { await api(`/directions/${id}/select`, { method: "POST", headers: { "Idempotency-Key": `manual-${id}` } }); await refreshWorkspace(); setScreen("manual"); return true; } catch (caught) { setError(errorText(caught)); return false; } finally { setBusy(false); } }
  async function favoriteTideIdea(id: string) { if (!project) return; setBusy(true); setError(null); try { const response = await api<{ data: { favorite: number } }>(`/projects/${project.id}/tide-report-ideas/${id}/favorite`, { method: "POST" }); setTideReport((current) => current?.edition ? { ...current, edition: { ...current.edition, ideas: current.edition.ideas.map((idea) => idea.id === id ? { ...idea, favorite: response.data.favorite } : idea) } } : current); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function useTideIdea(idea: TideReportIdea) { if (!project) return; setBusy(true); setError(null); try { await api(`/projects/${project.id}/tide-report-ideas/${idea.id}/use`, { method: "POST" }); const source = idea.sources[0]; setLaunchInspiration({ id: idea.id, theme: idea.theme, content_motif: idea.content_motif, source_url: source?.source_url ?? "", source_title: source?.source_title ?? idea.theme, published_at: source?.published_at, fit_reason: idea.applicable_scene, risk_note: idea.risk_note, favorite: idea.favorite }); setLaunchArchiveId(null); setGenerationPreview(null); setScreen("launch"); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  async function refreshTideReport() {
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
    if (launchType === "peripheral" && !selectedLaunchMaterials.length) { setError("请先选择至少一种要生成的实体物料。"); return; }
    if (!launchPrompt.trim()) { setError("先写下一句灵感或你希望被看见的画面。"); return; }
    const requestPrompt = launchPrompt.trim();
    const materialIds = launchType === "peripheral" ? selectedLaunchMaterials.map((item) => item.id) : [];
    setBusy(true); setError(null);
    try {
      if (demoMode) {
        setGenerationPreview({ id: `demo-preview-${Date.now()}`, template_type: launchType, status: "succeeded", inspiration_text: requestPrompt, result: launchType === "peripheral" ? { brief: `模拟预览：以“${requestPrompt}”为起点，组织一张暖纸、靛蓝布纹与刺梨果实并置的周边概念稿。`, concept_title: selectedLaunchMaterials.map((item) => item.label).join("、"), materials: ["磨砂纸材", "靛蓝布纹标签", "明黄封签"], image: { kind: "url", value: "/guipin/assets/sticker-cili.png" } } : { brief: `模拟预览：把“${requestPrompt}”变成一组可以继续讨论的图文叙事。`, titles: ["把山风带进冰箱", "这一口酸得很清醒", "从赫章寄来的夏日"], body: "一口清酸，像把山地的风留在今天。", hashtags: ["#贵州风物", "#刺梨原汁"], image: { kind: "url", value: "/guipin/assets/sticker-cili.png" } } });
        return;
      }
      const response = await api<{ data: GenerationPreview }>(`/projects/${project.id}/generation-previews`, { method: "POST", body: JSON.stringify({ template_type: launchType, inspiration_text: requestPrompt, inspiration_card_id: launchInspiration?.id, material_ids: materialIds }) });
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
  const openFieldwork = () => { if (mobileNavOpen) closeMobileNav(); setScreen("setup"); };
  const isPrimaryActive = (key: "fieldwork" | "tide" | "launch") => key === "fieldwork"
    ? ["setup", "interview", "candidates", "chronicle", "directions", "manual"].includes(screen)
    : screen === key;

  return <div className="app-shell">
    {mobileNavOpen && <button type="button" className="mobile-nav-scrim" aria-label="关闭导航菜单" onClick={() => closeMobileNav()} />}
    <aside ref={mobileDrawerRef} id="mobile-workspace-navigation" className={`sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`} aria-label="品牌工作台导航">
      <div className="mobile-drawer-head">
        <button type="button" className="mobile-drawer-mark" aria-label="收起导航菜单" onClick={() => closeMobileNav()}>贵</button>
        <div><span>数字田野志</span><strong>贵品风物志</strong></div>
      </div>
      <div className="brand-lockup"><span>贵品</span><div><strong>贵品风物志</strong></div></div><p className="sidebar-label">品牌工作台</p>
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
    <main className="workspace"><header className="mobile-workspace-bar"><button ref={mobileNavTriggerRef} type="button" className="mobile-project-mark" aria-label={mobileNavOpen ? "收起导航菜单" : "打开导航菜单"} aria-expanded={mobileNavOpen} aria-controls="mobile-workspace-navigation" onClick={() => mobileNavOpen ? closeMobileNav() : setMobileNavOpen(true)}>贵</button><div className="mobile-workspace-title"><strong>贵品风物志</strong><small>{mobileScreenTitles[screen]}</small></div></header>{demoMode && <aside className="demo-banner" role="status"><span>{demoReason ? `真实后端暂不可用（${demoReason}），已载入演示数据。` : "演示数据模式：档案、观潮来源与出山结果均为模拟内容，仅供检查页面和交互。"}</span><button className="text-button" onClick={() => window.location.reload()}>重试真实服务</button></aside>}
      {screen === "setup" && <Setup form={form} setForm={setForm} busy={busy} onSubmit={start} onDemo={loadDemoWorkspace} />}
      {screen === "interview" && project && session && <Interview project={project} session={session} answer={answer} setAnswer={setAnswer} uploads={uploads} busy={busy} onFiles={uploadFiles} onSend={sendMessage} onFinish={finishFieldwork} />}
      {screen === "candidates" && <Candidates candidates={candidates} confirmed={confirmedCount} busy={busy} onResolve={resolveCandidate} onContinue={confirmChronicle} />}
      {screen === "project-directory" && <ProjectDirectory projects={projectDirectory} onSelect={openProject} onDelete={(item) => setDeleteTarget(item)} onCreate={() => setScreen("setup")} />}
      {screen === "archive" && workspace && <BrandMaterials workspace={workspace} onOpenArchive={() => setArchiveModal("cards")} onOpenManual={() => setScreen("manual")} onOpenRecords={() => setScreen("assets")} />}
      {screen === "assets" && workspace && <AssetHistory workspace={workspace} onBack={() => setScreen("archive")} onLaunch={() => navigate("launch")} />}
      {screen === "chronicle" && workspace && <Chronicle workspace={workspace} task={latestRouteTask} onRetry={retryTask} onOpenArchive={() => setArchiveModal("cards")} />}
      {screen === "directions" && workspace && <Directions directions={workspace.directions} claims={workspace.claims ?? []} current={currentDirection} manual={workspace.manual} routeTask={latestRouteTask} busy={busy} onGenerate={createDirections} onRetry={retryTask} onPreview={setDirectionDraft} onOpenManual={() => setScreen("manual")} />}
      {screen === "manual" && workspace && <BrandManualResult key={workspace.manual?.current_version_id ?? workspace.project.status ?? "manual-setup"} workspace={workspace} logoTask={latestLogoTask} patternTask={latestPatternTask} exportTask={workspace.tasks?.find((item) => item.kind === "export")} demoMode={demoMode} busy={busy} onGenerate={createDirections} onSelect={selectDirection} onSave={saveManual} onRefresh={refreshWorkspace} onRetry={retryTask} onGenerateAsset={generateManualAsset} onFailure={setError} onOpenArchive={() => setScreen("archive")} onNext={() => setScreen("tide")} />}
      {screen === "tide" && workspace && <Tide report={tideReport} demoMode={demoMode} busy={busy} onRefresh={refreshTideReport} onFavorite={favoriteTideIdea} onUse={useTideIdea} onNext={() => setScreen("launch")} />}
      {screen === "launch" && workspace && <Launch workspace={launchWorkspace ?? undefined} projects={projectDirectory} inspiration={launchWorkspace ? launchInspiration ?? undefined : undefined} busy={busy} prompt={launchPrompt} type={launchType} preview={generationPreview} canGenerate={launchGenerationReady} selectedMaterials={selectedLaunchMaterials} visualAssetCount={launchVisualAssetCount} pickerOpen={launchArchivePickerOpen} materialPickerOpen={launchMaterialPickerOpen} onPromptChange={setLaunchPrompt} onTypeChange={setLaunchType} onOpenPicker={() => setLaunchArchivePickerOpen(true)} onClosePicker={() => setLaunchArchivePickerOpen(false)} onOpenMaterialPicker={() => setLaunchMaterialPickerOpen(true)} onCloseMaterialPicker={() => setLaunchMaterialPickerOpen(false)} onToggleMaterial={(id) => setLaunchMaterialIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} onSelectArchive={selectLaunchArchive} onPreview={previewLaunch} onSavePreview={saveLaunchPreview} onClosePreview={() => setGenerationPreview(null)} onOpenRecords={() => setScreen("assets")} />}
      {archiveModal === "cards" && workspace && <ArchiveFolioDialog project={workspace.project} cards={workspace.archive_cards} busy={busy} onClose={() => setArchiveModal(null)} onSave={saveCard} />}
      {directionDraft && workspace && <DirectionDraftDialog project={workspace.project} direction={directionDraft} busy={busy} onClose={() => setDirectionDraft(null)} onConfirm={async () => { if (await selectDirection(directionDraft.id)) setDirectionDraft(null); }} />}

      {authOpen && <AuthDialog busy={busy} onClose={() => setAuthOpen(false)} onSubmit={authenticate} />}
      {deleteTarget && <DeleteProjectDialog project={deleteTarget} busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={() => { const target = deleteTarget; setDeleteTarget(null); void deleteProject(target); }} />}
      {!project && screen !== "setup" && screen !== "project-directory" && <Empty title={screen === "tide" ? "先完成采风并确认档案，才能开始真实观潮" : screen === "launch" ? "先完成采风并确认档案，才能生成出山概念稿" : "先建立品牌档案"} action={() => setScreen("setup")} actionLabel="去采风" />}
    </main><FailureToast message={error} onDismiss={() => setError(null)} />
  </div>;
}

function AuthDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (mode: "login" | "register", email: string, password: string) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLocalError(null);
    try { await onSubmit(mode, email, password); } catch (caught) { setLocalError(errorText(caught)); }
  };
  return <div className="modal-backdrop" role="presentation"><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><button type="button" className="modal-close" aria-label="关闭账号窗口" onClick={onClose}>×</button><p className="eyebrow">账号与档案</p><h2 id="account-dialog-title">{mode === "register" ? "保存你的田野记录" : "回到你的田野记录"}</h2><p>登录后可在其他设备继续查看和编辑已采风的品牌档案。</p><div className="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")}>注册</button><button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>登录</button></div><form onSubmit={submit}><label>邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /><small>至少 8 个字符</small></label>{localError && <p className="form-error" role="alert">{localError}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>暂不登录</button><button className="primary-button" disabled={busy}>{busy ? "正在处理…" : mode === "register" ? "注册并保存" : "登录"}</button></footer></form></section></div>;
}

function DeleteProjectDialog({ project, busy, onClose, onConfirm }: { project: Project; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="archive-modal-backdrop delete-project-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="delete-project-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
      <header><div><p className="eyebrow">档案 / 删除品牌项目</p><h2 id="delete-project-title">确认删除「{project.brand_name}」？</h2></div><button className="modal-close" ref={closeRef} aria-label="关闭删除确认" onClick={onClose}>×</button></header>
      <p>删除后，这个项目的采风记录、档案卡与品牌资产会被<b>永久移除</b>，无法恢复。</p>
      <p className="delete-project-note" role="note"><i aria-hidden="true">!</i><span>此操作不可撤销。若只是暂时不用，可以先保留，之后随时回来继续。</span></p>
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>保留项目</button><button type="button" className="delete-project-confirm" disabled={busy} onClick={onConfirm}>{busy ? "正在删除…" : "确认永久删除"}</button></footer>
    </section>
  </div>;
}

function Setup({ form, setForm, busy, onSubmit, onDemo }: { form: SetupForm; setForm: Dispatch<SetStateAction<SetupForm>>; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDemo: () => void }) {
  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  return <section className="setup-page"><header className="page-header"><p className="eyebrow">采风</p><h1>先记下三件事，再开始讲故事</h1><p>真实比完整更重要。每段材料都会留下来源、状态和确认记录。</p></header><form className="field-form" onSubmit={onSubmit}><div className="card-rule" /><fieldset><legend>产品产业 <em>必填</em></legend><div className="product-options">{productOptions.map((option) => <button type="button" className={form.category === option ? "product-option selected" : "product-option"} key={option} onClick={() => { set("category", option); set("industry", option === "自定义" ? "" : option); }}><img src={`/guipin/assets/${stickerByProduct[option]}`} alt="" /><span>{option}</span></button>)}</div>{form.category === "自定义" && <label className="custom-industry-field">补充产品产业<input value={form.industry} onChange={(event) => set("industry", event.target.value)} placeholder="例如：蜂蜜、菌菇、腊肉" autoFocus required /></label>}</fieldset><div className="form-grid"><label>品牌 / 主体名称<input value={form.brand_name} onChange={(event) => set("brand_name", event.target.value)} required /></label><label>核心产品<input value={form.core_product} onChange={(event) => set("core_product", event.target.value)} placeholder="例如：刺梨原汁" required /></label><label>主要产地<input value={form.origin} onChange={(event) => set("origin", event.target.value)} placeholder="例如：贵州六盘水" required /></label></div><label className="consent"><input type="checkbox" checked={form.consent} onChange={(event) => set("consent", event.target.checked)} />我确认已获得材料使用授权，不提交敏感个人信息。</label><footer><div><p>创建一个可恢复的游客项目。</p><Link className="text-button" href="/?demo=1&view=archive" onClick={onDemo}>查看演示项目</Link></div><button className="primary-button" disabled={busy}>{busy ? "正在建立…" : "开始采风"}</button></footer></form></section>;
}

function Interview({ project, session, answer, setAnswer, uploads, busy, onFiles, onSend, onFinish }: { project: Project; session: Session; answer: string; setAnswer: (value: string) => void; uploads: Array<{ id: string; file: File; status: string; error?: string }>; busy: boolean; onFiles: (event: ChangeEvent<HTMLInputElement>) => void; onSend: (skip?: boolean) => void; onFinish: () => void }) {
  const readyToFinish = Boolean(session.ready_to_finish);
  return <><header className="interview-header"><div><p className="eyebrow">FIELD INTERVIEW</p><h1>{project.core_product}</h1><p>{project.origin} · 已自动保存</p></div></header><div className="interview-layout"><section className="transcript"><div className="transcript-head"><div><p className="eyebrow">对话记录</p><h2>从真实经历开始</h2></div><span>{session.field_notes.length} 条笔记</span></div><div className="transcript-list">{session.messages.map((message, index) => { const isFinishPrompt = readyToFinish && message.role === "assistant" && index === session.messages.length - 1; return <article className={`turn turn-${message.role}`} key={message.id}><p className="turn-meta">{message.role === "assistant" ? "调查员" : message.role === "user" ? "受访者" : "系统"}</p><p>{message.content}</p>{isFinishPrompt && <div className="turn-finish-action"><button className="primary-button" onClick={onFinish} disabled={busy}>结束本次采风</button></div>}</article>; })}</div><section className="composer">{readyToFinish && <p className="composer-complete" role="status">本轮采风已收束。</p>}<label htmlFor="fieldwork-answer">你的回答 <small>一次只需说一件真实的事</small></label><textarea id="fieldwork-answer" value={answer} maxLength={2000} disabled={readyToFinish} onChange={(event) => setAnswer(event.target.value)} placeholder="可以从一个人、一件事，或一个产品细节开始。" /><div className="composer-footer"><div><label className="upload-button"><input type="file" accept="image/*" multiple disabled={readyToFinish} onChange={onFiles} />添加照片</label><span>{answer.length} / 2,000</span></div><div><button className="text-button" onClick={() => onSend(true)} disabled={busy || readyToFinish}>跳过</button><button className="primary-button" onClick={() => onSend()} disabled={busy || readyToFinish}>{busy ? "正在整理…" : "记录并继续"}</button></div></div>{uploads.map((item) => <div className="upload-item" key={item.id}><span>{item.file.name}<small>{item.status === "ready" ? "已保存" : item.status === "failed" ? item.error : "正在上传"}</small></span></div>)}</section></section><aside className="notes-panel"><header><p className="eyebrow">FIELD NOTES</p><h2>本次采风笔记</h2></header>{session.field_notes.length ? <div className="note-stack">{session.field_notes.map((note) => <article className="sticky-note" key={note.id}><p>FIELD NOTE {String(note.sequence).padStart(2, "0")}</p><h3>{note.title}</h3><p>{note.summary}</p><small>待确认</small></article>)}</div> : <p className="notes-empty">第一张笔记会在这里出现。</p>}</aside></div></>;
}

function Candidates({ candidates, confirmed, busy, onResolve, onContinue }: { candidates: Candidate[]; confirmed: number; busy: boolean; onResolve: (item: Candidate, action: "confirm" | "discard") => void; onContinue: () => void }) { const pending = candidates.some((item) => item.status === "pending"); return <section className="candidate-page"><header className="page-header compact"><p className="eyebrow">采风完成 / 候选确认</p><h1>由你决定哪些材料进入档案</h1><p>AI 整理结果不是事实，确认前请核对原始访谈。</p></header><div className="candidate-grid">{candidates.map((item, index) => <article className="candidate-card" key={item.id}><p className="eyebrow">{item.type} / {String(index + 1).padStart(2, "0")}</p><h2>{item.title}</h2><p>{item.content}</p><footer>{item.status === "pending" ? <><button className="secondary-button" onClick={() => onResolve(item, "discard")}>弃用</button><button className="primary-button" onClick={() => onResolve(item, "confirm")}>确认入档</button></> : <span className={`status ${item.status}`}>{item.status === "confirmed" ? "已确认" : "已弃用"}</span>}</footer></article>)}</div><footer className="candidate-footer"><p>{pending ? "请先处理完每一张候选卡。" : confirmed ? `已有 ${confirmed} 条材料，将归入品牌档案后进入定调。` : "至少确认一张材料后才能编志。"}</p><button className="primary-button" disabled={!confirmed || pending || busy} onClick={onContinue}>{busy ? "正在确认…" : "确认编志并定调"}</button></footer></section>; }

function TaskStatus({ task, onRetry }: { task?: WorkflowTask; onRetry: (id: string) => void }) {
  if (!task) return null;
  const label = task.status === "queued" ? "已排队" : task.status === "running" ? `正在生成 ${task.progress}%` : task.status === "succeeded" ? "生成完成" : task.status === "partial" ? "文字已完成，部分视觉资产待重试" : "生成未完成";
  return <section className={`workflow-task ${task.status}`} role="status"><div><b>{label}</b><small>任务 {task.id.slice(0, 8)} · 刷新页面不会丢失</small></div><progress max={100} value={task.progress ?? 0} />{["failed", "partial"].includes(task.status) && <button className="secondary-button" onClick={() => onRetry(task.id)}>重试未完成阶段</button>}</section>;
}

function Chronicle({ workspace, task, onRetry, onOpenArchive }: { workspace: Workspace; task?: WorkflowTask; onRetry: (id: string) => void; onOpenArchive: () => void }) {
  return <section className="stage-page chronicle-page"><StageHeader eyebrow="采风完成 / 正在编志" title="把确认过的材料，沉淀为品牌故事卡片" copy="系统会先保存本次档案与事实；首次打开品牌手册时，再补充 Logo、字体与颜色并生成三条路线。" /><div className="stage-toolbar"><span>{workspace.archive_cards.filter((card) => card.status === "active").length} 张有效档案 · {workspace.claims?.filter((claim) => claim.public_allowed).length ?? 0} 条可公开事实</span><button className="secondary-button" onClick={onOpenArchive}>回看故事卡片与来源</button></div><TaskStatus task={task} onRetry={onRetry} /><p className="chronicle-auto-note">品牌路线与手册统一从品牌档案中的「品牌手册」进入。</p></section>;
}

function archiveDate(value?: string) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "时间待补"; }

function AssetHistory({ workspace, onBack, onLaunch }: { workspace: Workspace; onBack: () => void; onLaunch: () => void }) {
  return <section className="stage-page asset-history-page"><header className="asset-hero"><div><p className="eyebrow">{workspace.project.brand_name} · 出山记录</p><h1>每一次出山，都是一份可回看的概念稿。</h1><p>这里仅保留从出山工作台生成的图文稿与原型稿历史。</p></div><button className="secondary-button" onClick={onBack}>← 回到品牌档案</button></header><section className="asset-history-list launch-history-list"><header><p className="eyebrow">生成历史</p><h2>图文稿与原型稿</h2></header>{workspace.generation_jobs.length ? workspace.generation_jobs.map((job) => <article key={job.id}><div><strong>{job.template_type === "xiaohongshu" ? "小红书图文" : "周边概念稿"}</strong><span className={`job-status ${job.status}`}>{job.status === "succeeded" ? "已生成" : job.status === "partial" ? "文字 Brief 已保留" : "任务未完成"}</span></div><p>{String(job.result.brief ?? job.result.body ?? "文字 Brief 已保留")}</p>{typeof job.result.image === "object" && job.result.image && (job.result.image as Record<string, string>).kind === "url" && <img src={(job.result.image as Record<string, string>).value} alt={`${job.template_type === "xiaohongshu" ? "小红书图文" : "周边"}概念稿`} />}{Array.isArray(job.result.titles) && <ul>{stringList(job.result.titles).map((title) => <li key={title}>{title}</li>)}</ul>}<small>AI 概念稿，不可直接印刷</small></article>) : <Empty title="这里会保存周边概念稿与小红书图文的历史版本" action={onLaunch} actionLabel="去出山" />}</section></section>;
}

function Directions({ directions, claims, current, manual, routeTask, busy, onGenerate, onRetry, onPreview, onOpenManual }: { directions: Direction[]; claims: Claim[]; current?: Direction; manual?: Workspace["manual"]; routeTask?: WorkflowTask; busy: boolean; onGenerate: () => void; onRetry: (id: string) => void; onPreview: (route: Direction) => void; onOpenManual: () => void }) { const latestVersion = Math.max(0, ...directions.map((item) => item.version ?? 0)); const routes = directions.filter((item) => item.state !== "superseded" && (item.version ?? 0) === latestVersion); const manualReady = Boolean(current && manual); return <section className="stage-page"><StageHeader eyebrow="定调 / 品牌路线" title="让事实决定方向，而不是替代事实" copy="点击任一方案查看完整草案；确认路线后会立即创建可编辑手册，视觉资产将在手册内单独生成。" /><div className="stage-toolbar"><span>{current ? `已选：${current.title}` : "请选择一版品牌方向"}</span><button className="secondary-button" onClick={onGenerate} disabled={busy || routeTask?.status === "running"}>{directions.length ? "重新生成新版本" : "生成三版方案"}</button></div><TaskStatus task={routeTask?.status === "succeeded" ? undefined : routeTask} onRetry={onRetry} />{routes.length ? <div className="route-grid route-grid-three">{routes.map((route) => <RouteCard key={route.id} route={route} claims={claims} onOpen={onPreview} />)}</div> : <Empty title="品牌手册首次设置后，这里会出现三版方案" />}{manualReady && <footer className="stage-next"><button className="primary-button" onClick={onOpenManual}>查看完整品牌手册</button></footer>}</section>; }
function RouteCard({ route, claims, onOpen }: { route: Direction; claims: Claim[]; onOpen: (route: Direction) => void }) { const value = cardContent(route); const points = Array.isArray(value.selling_points) ? value.selling_points : []; const scenarios = Array.isArray(value.target_scenarios) ? value.target_scenarios.join("、") : String(value.target_scenarios ?? ""); const open = () => onOpen(route); return <article className={`route-card route-card-open ${route.state === "current" ? "is-current" : ""}`} role="button" tabIndex={0} aria-label={`查看路线 ${route.route_no}：${route.title} 的品牌手册草案`} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}><p className="eyebrow">路线 0{route.route_no} {route.state === "current" ? "· 已选择" : ""}</p><h2>{route.title}</h2><p className="route-one-liner">{String(value.brand_one_liner ?? "")}</p><dl><dt>人群与场景</dt><dd>{String(value.target_audience ?? "")} · {scenarios}</dd><dt>故事与价值</dt><dd>{String(value.story_spine ?? "")}<br />{String(value.emotion_value ?? "")} · {String(value.altruistic_value ?? "")}</dd><dt>三条卖点</dt><dd className="route-evidence-list">{points.map((raw, index) => { const point = typeof raw === "object" && raw ? raw as Record<string, unknown> : { text: String(raw), claimIds: [] }; const claimIds = Array.isArray(point.claimIds) ? point.claimIds.map(String) : []; const linked = claims.filter((claim) => claimIds.includes(claim.id)); return <details key={`${String(point.text)}-${index}`} onClick={(event) => event.stopPropagation()}><summary>{String(point.text)} <small>{linked.length ? `${linked.length} 条证据` : "待补证"}</small></summary>{linked.length ? linked.map((claim) => <p key={claim.id}>{claim.statement}<em>{claim.status} · {claim.risk}</em></p>) : <p>该表达尚未绑定可公开事实，不能直接作为公开卖点。</p>}</details>; })}</dd><dt>视觉路线</dt><dd>{stringList(value.visual_keywords).join(" / ")}</dd></dl><span className="route-card-open-hint">点击查看品牌手册草案 →</span></article>; }

function Tide({ report, demoMode, busy, onRefresh, onFavorite, onUse, onNext }: { report: TideReport | null; demoMode: boolean; busy: boolean; onRefresh: () => void; onFavorite: (id: string) => void; onUse: (idea: TideReportIdea) => void; onNext: () => void }) {
  const edition = report?.edition;
  const refresh = report?.refresh_state;
  const previewSources = report?.preview_sources ?? [];
  const channelLabel: Record<TideReportSource["channel"], string> = { industry: "行业媒体", xiaohongshu: "小红书公开帖", douyin: "抖音公开趋势" };
  const phaseOrder: TideRefreshState["phase"][] = ["collecting", "verifying", "deduplicating", "synthesizing"];
  const phaseLabel: Record<TideRefreshState["phase"], string> = { idle: "等待刷新", collecting: "搜集资讯", verifying: "验链正文", deduplicating: "四周排重", synthesizing: "提炼灵感", completed: "刷新完成", failed: "刷新未完成" };
  const phaseIndex = refresh?.status === "running" ? phaseOrder.indexOf(refresh.phase) : -1;
  const errorLabel: Record<string, string> = {
    tavily_auth_failed: "资讯搜集服务的凭证无效，请联系维护人员。",
    tavily_quota_or_rate_limited: "资讯搜集服务当前繁忙，60 秒后可重试。",
    provider_timeout: "资讯提炼超时，60 秒后可重试。",
    no_new_verified_sources: "近四周排重后暂未发现新增且可验链的文章。",
    no_valid_tide_ideas: "已找到文章，但本次没有提炼出可发布的主题灵感。",
    refresh_interrupted: "刷新任务运行超时并已中断。",
    tide_refresh_failed: "刷新过程中出现异常。",
    tide_not_configured: "观潮联网服务尚未配置。",
  };
  const status = refresh?.status === "running"
    ? "正在" + phaseLabel[refresh.phase] + "；刷新完成前继续显示当前周报。"
    : refresh?.status === "failed"
      ? (edition
        ? "本次刷新未完成，正在继续显示已有周报。 " + (errorLabel[refresh.error_code ?? ""] ?? "")
        : "本次刷新未完成，暂未取得可展示的周报。 " + (errorLabel[refresh.error_code ?? ""] ?? "请在 60 秒后重试。"))
      : edition?.scope === "personal"
        ? (edition.status === "partial" ? "你的私人周报已更新 · 本周资讯较少，共 " + edition.ideas.length + " 条有效灵感" : "你的私人周报已更新 · 共 " + edition.ideas.length + " 条有效灵感")
        : edition?.is_fallback
          ? "当前显示最近一次已验链的共享周报；下次自动刷新成功后会更新。"
          : edition
          ? "当前显示全站共享周报 · 采集于 " + archiveDate(edition.completed_at)
          : "当前还没有可显示的周报，可使用本周私人刷新机会。";
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
    <StageHeader eyebrow="观潮 / 本周观察" title="把公开观察，转译成山地农产品的主题灵感" copy="每周一自动更新全站共享周报；每位访客每个中国自然周另有一次私人联网刷新。刷新只影响你，趋势不会改写品牌事实。" />
    <div className="tide-ledger" aria-label="观潮刷新进度">{phaseOrder.map((phase, index) => <span className={phaseIndex === index ? "is-active" : phaseIndex > index || refresh && ["succeeded", "partial"].includes(refresh.status) ? "is-done" : ""} key={phase}>{index + 1}. {phaseLabel[phase]}</span>)}</div>
    <section className={"tide-refresh-panel " + (refresh?.status ?? "idle")} role="status">
      <div><strong>{status}</strong><small>{edition ? (edition.scope === "personal" ? "仅你可见，并在你的所有项目中复用" : edition.is_fallback ? "本地数据库首次启动时展示的已验链共享快照；私人刷新不会覆盖它" : "所有访客可见；私人刷新不会覆盖它") : "刷新失败不会消耗本周机会"}</small></div>
      <button className="secondary-button tide-refresh-button" disabled={refreshDisabled} onClick={onRefresh}>{refreshLabel}</button>
    </section>
    {edition?.ideas.length ? <div className="inspiration-grid">{edition.ideas.map((idea, index) => <article className="inspiration-card tide-report-card" key={idea.id}><header><p className="eyebrow">{edition.scope === "personal" ? "私人灵感" : "共享灵感"} {String(index + 1).padStart(2, "0")}</p><time>{idea.festival_context}</time></header><h2>{idea.theme}</h2><p>{idea.content_motif}</p><dl className="tide-idea-meta"><dt>可能的机会点</dt><dd>{idea.applicable_scene}</dd>{idea.sources.length ? <><dt>提炼来源 / 原文链接</dt><dd>{idea.sources.map((source) => <a href={source.source_url} target="_blank" rel="noreferrer" key={source.id}><span>{channelLabel[source.channel]} · {source.publisher} · {source.published_at}</span>{source.source_title} <em>打开原文 ↗</em></a>)}</dd></> : <><dt>灵感依据</dt><dd>节假日节点：{idea.festival_context}（不引用新闻媒体）</dd></>}</dl><footer><div>{demoMode ? <span>演示入口不写入项目收藏</span> : <><button className="text-button" disabled={busy} onClick={() => onFavorite(idea.id)}>{idea.favorite ? "已收藏" : "收藏灵感"}</button><span>{idea.risk_note}</span></>}</div>{!demoMode && <button className="secondary-button" disabled={busy} onClick={() => onUse(idea)}>用此灵感出山</button>}</footer></article>)}</div> : previewSources.length ? <section className="inspiration-grid" aria-label="近 7 天已验链文章">{articleCards}</section> : <Empty title={refresh?.status === "running" ? "正在搜集本周资讯，完成后会自动出现在这里。" : refresh?.status === "failed" ? "本次联网刷新没有发布新结果；请在 60 秒后重试。" : "当前没有可显示的周报；可以使用本周私人刷新机会。"} />}
    <footer className="stage-next"><button className="primary-button" onClick={onNext}>{demoMode ? "查看出山演示" : "不选灵感，直接出山"}</button></footer>
  </section>;
}

function Launch({ workspace, projects, inspiration, busy, prompt, type, preview, canGenerate, selectedMaterials, pickerOpen, materialPickerOpen, onPromptChange, onTypeChange, onOpenPicker, onClosePicker, onOpenMaterialPicker, onCloseMaterialPicker, onToggleMaterial, onSelectArchive, onPreview, onSavePreview, onClosePreview, onOpenRecords }: { workspace?: Workspace; projects: Project[]; inspiration?: Inspiration; busy: boolean; prompt: string; type: "peripheral" | "xiaohongshu"; preview: GenerationPreview | null; canGenerate: boolean; selectedMaterials: MaterialTemplate[]; visualAssetCount: number; pickerOpen: boolean; materialPickerOpen: boolean; onPromptChange: (value: string) => void; onTypeChange: (value: "peripheral" | "xiaohongshu") => void; onOpenPicker: () => void; onClosePicker: () => void; onOpenMaterialPicker: () => void; onCloseMaterialPicker: () => void; onToggleMaterial: (id: string) => void; onSelectArchive: (project: Project) => void; onPreview: () => void; onSavePreview: () => void; onClosePreview: () => void; onOpenRecords: () => void }) {
  const activeCards = workspace?.archive_cards.filter((card) => card.status === "active") ?? [];
  const direction = workspace?.directions.find((item) => item.state === "current");
  const readinessMessage = !workspace ? "请先选择本次出山要使用的品牌档案。" : !activeCards.length ? "该档案尚无有效资料，请先确认入档材料。" : !direction ? "该档案尚未确定品牌路线，请先完成定调。" : type === "peripheral" && !selectedMaterials.length ? "请选择至少一种实体物料，再开始生成预览。" : "档案、路线与物料已就绪，可开始生成预览。";
  return <section className="stage-page launch-page">
    <header className="launch-header"><div><p className="eyebrow">出山</p><h1>出山</h1><p>选择品牌档案和出山方向。</p></div><button className="primary-button launch-record-button" disabled={!workspace} onClick={onOpenRecords}>打开出山记录 →</button></header>
    {inspiration && <p className="selected-inspiration">已纳入本次输入的观潮灵感：{inspiration.source_title}</p>}
    <section className="launch-conversation" aria-label="出山输入"><header><p className="eyebrow">出山输入</p><a href="#launch-type">选择生成类型 ↓</a></header><div className="launch-archive-bar"><div><p className="eyebrow">品牌档案</p><strong>{workspace?.project.brand_name ?? "尚未选择"}</strong><small>{workspace ? `${activeCards.length} 张有效资料 · ${direction ? `已选路线：${direction.title}` : "尚未选择路线"}` : "选择后用于本次生成。"}</small></div><button className="secondary-button" type="button" onClick={onOpenPicker} disabled={busy}>{workspace ? "更换品牌档案" : "选择品牌档案"}</button></div><p className={`launch-readiness ${canGenerate ? "is-ready" : ""}`} role="status">{readinessMessage}</p><section className="launch-prompt-templates" aria-labelledby="launch-template-title"><header><p className="eyebrow" id="launch-template-title">预设提示词</p><small>选择一种常用需求，可继续修改。</small></header><div>{launchPromptTemplates.map((template) => <button type="button" className="launch-prompt-template" key={template.label} onClick={() => onPromptChange(template.text)}><strong>{template.label}</strong><span>{template.note}</span></button>)}</div></section><label className="launch-composer"><span className="sr-only">输入出山需求</span><textarea value={prompt} maxLength={1200} onChange={(event) => onPromptChange(event.target.value)} placeholder={workspace ? "描述想生成的内容。" : "请先选择品牌档案。"} /><button className="primary-button" disabled={busy || !canGenerate || !prompt.trim()} onClick={onPreview}>{busy ? "正在生成预览…" : "生成预览 →"}</button></label><small>{prompt.length} / 1,200 · 预览不会自动归档</small></section>
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
  return <div className="launch-preview-backdrop" role="presentation" onMouseDown={onClose}><section className="launch-preview-dialog" role="dialog" aria-modal="true" aria-label="出山生成预览" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">生成预览 / 尚未归档</p><h2>{preview.template_type === "xiaohongshu" ? "线上图文生成" : "实体物料设计"}</h2></div><button className="modal-close" aria-label="关闭预览" onClick={onClose}>×</button></header><div className="launch-preview-content">{imageUrl && <figure><img src={imageUrl} alt="AI 概念预览" /><figcaption>AI 概念稿，不可直接印刷</figcaption></figure>}<article><p className="eyebrow">文字 Brief</p><p>{String(preview.result.brief ?? "")}</p>{preview.template_type === "xiaohongshu" && <><h3>标题提案</h3><ul>{titles.map((title) => <li key={title}>{title}</li>)}</ul><p>{String(preview.result.body ?? "")}</p></>}{preview.template_type === "peripheral" && <><h3>{String(preview.result.concept_title ?? "周边概念")}</h3><p>{stringList(preview.result.materials).join(" · ")}</p></>}</article></div><footer><small>确认保存后，它才会进入档案的「出山记录」。</small><div><button className="secondary-button" disabled={busy} onClick={onClose}>继续修改</button><button className="primary-button" disabled={busy} onClick={onSave}>{busy ? "正在保存…" : "保存到档案"}</button></div></footer></section></div>;
}
function StageHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) { return <header className="page-header compact"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></header>; }
function Empty({ title, action, actionLabel = "开始" }: { title: string; action?: () => void; actionLabel?: string }) { return <div className="empty-state"><p>{title}</p>{action && <button className="secondary-button" onClick={action}>{actionLabel}</button>}</div>; }
function stageToScreen(stage?: string, status?: string): Screen { if (stage === "positioning") return "manual"; if (stage === "chronicle" && status === "directions_ready") return "directions"; if (stage === "chronicle") return "chronicle"; if (stage === "tide") return "tide"; if (stage === "launch") return "launch"; if (stage === "fieldwork") return "setup"; return "archive"; }
