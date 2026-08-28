---
version: 1.0
name: MountainLore-design-system
description: "MountainLore / 山风风物志的数字民族志田野志设计系统。以真实人物、地点、物产与地方记忆为主体；以安静、可检索、可持续书写的当代 Web App 为目标。它不是企业 SaaS 后台、文旅宣传页或复古拟物界面。"

colors:
  paper: "#F2EDDF"
  paper-secondary: "#E8E0D1"
  paper-elevated: "#FAF7EF"
  ink: "#272923"
  body: "#41433C"
  muted-ink: "#706D63"
  muted-soft: "#9B9588"
  border: "#C9C0AF"
  border-soft: "#DDD5C7"
  forest: "#405746"
  forest-active: "#304535"
  forest-pressed: "#263A2D"
  forest-soft: "#DCE4D9"
  moss: "#697965"
  moss-soft: "#E0E6DC"
  indigo: "#465B66"
  indigo-soft: "#DDE5E7"
  clay: "#98533F"
  clay-soft: "#F0DDD6"
  on-clay: "#FFFFFF"
  ochre: "#B69257"
  ochre-soft: "#F0E5CF"
  success: "#405746"
  warning: "#B69257"
  error: "#98533F"
  on-forest: "#FAF7EF"
  focus-ring: "#405746"

typography:
  display-xl:
    fontFamily: "Noto Serif SC, Source Han Serif SC, STSong, Songti SC, serif"
    fontSize: 56px
    fontWeight: 500
    lineHeight: 1.14
    letterSpacing: -0.8px
  display-lg:
    fontFamily: "Noto Serif SC, Source Han Serif SC, STSong, Songti SC, serif"
    fontSize: 42px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.5px
  display-md:
    fontFamily: "Noto Serif SC, Source Han Serif SC, STSong, Songti SC, serif"
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.3px
  display-sm:
    fontFamily: "Noto Serif SC, Source Han Serif SC, STSong, Songti SC, serif"
    fontSize: 24px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0
  title-lg:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  title-md:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0
  title-sm:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: 0
  body-md:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: 0
  body-sm:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: 0
  quote:
    fontFamily: "Noto Serif SC, Source Han Serif SC, STSong, Songti SC, serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: 0
  metadata:
    fontFamily: "Noto Sans SC, Source Han Sans SC, Arial Narrow, sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: 0.9px
    textTransform: uppercase
  caption:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0.1px
  annotation:
    fontFamily: "KaiTi, STKaiti, Noto Serif SC, serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  code:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1
  nav-link:
    fontFamily: "Noto Sans SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4

rounded:
  xs: 3px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  pill: 9999px
  full: 50%

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px

components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.on-forest}"
    typography: "{typography.button}"
    border: "1px solid {colors.forest}"
    rounded: "{rounded.md}"
    padding: 12px 20px
    minHeight: 40px
  button-primary-hover:
    backgroundColor: "{colors.forest-active}"
  button-primary-active:
    backgroundColor: "{colors.forest-pressed}"
  button-primary-disabled:
    backgroundColor: "{colors.paper-secondary}"
    textColor: "{colors.muted-ink}"
    border: "1px solid {colors.border-soft}"
  button-secondary:
    backgroundColor: "{colors.paper-elevated}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: 12px 20px
    minHeight: 40px
  button-secondary-hover:
    backgroundColor: "{colors.paper-secondary}"
    border: "1px solid {colors.moss}"
  button-destructive:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.on-clay}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 12px 20px
    minHeight: 40px
  button-text-link:
    backgroundColor: transparent
    textColor: "{colors.forest}"
    typography: "{typography.button}"
    textDecoration: underline
    textUnderlineOffset: 3px
  button-icon:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    border: "1px solid {colors.border-soft}"
    rounded: "{rounded.sm}"
    size: 40px
  text-link:
    textColor: "{colors.forest}"
    typography: "{typography.body-md}"
    textDecoration: underline
    textUnderlineOffset: 3px
  app-sidebar:
    backgroundColor: "{colors.paper-secondary}"
    textColor: "{colors.ink}"
    borderRight: "1px solid {colors.border-soft}"
    width: 240px
  field-record-card:
    backgroundColor: "{colors.paper-elevated}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.lg}"
    shadow: none
    padding: 20px
  archive-card:
    backgroundColor: "{colors.paper-elevated}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.border-soft}"
    rounded: "{rounded.sm}"
    shadow: none
    padding: 16px
  photo-figure:
    backgroundColor: "{colors.paper-secondary}"
    rounded: "{rounded.sm}"
    overflow: hidden
  metadata-block:
    labelTypography: "{typography.metadata}"
    valueTypography: "{typography.body-sm}"
    labelColor: "{colors.muted-ink}"
    valueColor: "{colors.ink}"
    divider: "1px solid {colors.border-soft}"
  transcript-turn:
    backgroundColor: transparent
    borderLeft: "2px solid {colors.border}"
    rounded: 0
    padding: 8px 0 8px 16px
  transcript-turn-interviewer:
    borderLeft: "2px solid {colors.indigo}"
  transcript-turn-participant:
    borderLeft: "2px solid {colors.moss}"
  evidence-panel:
    backgroundColor: "{colors.paper-secondary}"
    border: "1px solid {colors.border-soft}"
    rounded: "{rounded.md}"
    padding: 16px
  text-input:
    backgroundColor: "{colors.paper-elevated}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: 10px 14px
    minHeight: 40px
  text-input-focused:
    border: "1px solid {colors.forest}"
    outline: "3px solid color-mix(in srgb, {colors.focus-ring} 22%, transparent)"
  tag:
    backgroundColor: "{colors.paper-secondary}"
    textColor: "{colors.body}"
    typography: "{typography.caption}"
    border: "1px solid {colors.border-soft}"
    rounded: "{rounded.pill}"
    padding: 4px 9px
  module-indicator:
    typography: "{typography.metadata}"
    borderLeft: "2px solid currentColor"
    padding: 2px 0 2px 8px
  divider:
    borderTop: "1px solid {colors.border-soft}"

---

# MountainLore「山风风物志」设计系统

## 1. 产品与设计意图

MountainLore 是面向山地农产品与地方品牌孵化的 AI Agent。核心流程为：**采风 → 编志 → 定调 → 观潮 → 出山**。界面应像一本持续被采集、校对与编纂的数字田野志：用户留下照片、语音、对话与经历，AI 协助追问、归档、提炼并转化为品牌资产。

**Field first。** 真实的照片、人物、地点、日期、原话和物产优先于装饰。信息应可被阅读、追溯和引用。

**Evidence over decoration。** 用证据链构成层级：Field Note 编号、来源、时间地点、采访原话、图片说明与标签；不要以大面积插画填充空白。

**Quiet editorial。** 大量留白、低饱和自然色、细暖灰分隔线和克制的编辑出版物排版。避免强渐变、厚阴影、玻璃效果。

**Human trace。** 页码、批注、轻微手写下划线、坐标和日期戳可作为辅助层；每页最多 1–3 种，不能遮蔽正文或成为装饰主题。

**Modern product usability。** 这是现代产品而非纸本复刻。导航、表单、编辑、上传、过滤、搜索和 Agent 反馈必须清楚、快速并符合无障碍规范。

## 2. 色彩

页面 70% 以上使用 `{colors.paper}`、`{colors.paper-elevated}` 与 `{colors.ink}`。`{colors.forest}` 是唯一主要产品色；靛青、苔藓、陶土与赭黄仅用于模块标识、状态点、标签、数据分类和少量重点内容，绝不作为整页主题底色。

| 语义 | Token | 用途 |
|---|---|---|
| Paper | `{colors.paper}` / #F2EDDF | 应用画布与主页面背景 |
| Paper secondary | `{colors.paper-secondary}` / #E8E0D1 | 侧栏、输入区、次级区域 |
| Ink | `{colors.ink}` / #272923 | 标题、正文、图标 |
| Muted ink | `{colors.muted-ink}` / #706D63 | 元数据、辅助说明、禁用文字 |
| Forest | `{colors.forest}` / #405746 | 主按钮、焦点、出山模块 |
| Moss | `{colors.moss}` / #697965 | 编志模块、植物/档案分类 |
| Indigo | `{colors.indigo}` / #465B66 | 采风模块、访谈调查员标识 |
| Clay | `{colors.clay}` / #98533F | 定调模块、删除与重要提醒 |
| Ochre | `{colors.ochre}` / #B69257 | 观潮模块、观察与待确认状态 |

边框必须使用暖灰褐 `{colors.border}` 或 `{colors.border-soft}`，不用冷灰。文字与底色遵循 WCAG AA：普通文本对比度至少 4.5:1；仅以颜色区分的状态必须再提供文字、图标或形状。

## 3. 字体与排版

标题使用 `{typography.display-*}` 的中文宋体/Serif，正文和交互使用 `{typography.body-*}` 的现代中文无衬线。英文名称、日期、编号与元数据可采用 Serif + Sans 的混排。优先加载 Noto/Source Han 字体；不可用时按 token 的系统回退顺序降级，不能用装饰性书法字体替代正文。

| 层级 | Token | 使用 |
|---|---|---|
| 页面标题 | `{typography.display-xl}` | “今日田野”、项目首页主标题 |
| 区块标题 | `{typography.display-lg}` / `-md` | 档案章节、编志段落 |
| 档案标题 | `{typography.title-lg}` | 物产、人、地点或事件名称 |
| 正文 | `{typography.body-md}` | 叙述、编辑器、访谈文本 |
| 原话 | `{typography.quote}` | 受访者引语；搭配出处 |
| 注释 | `{typography.annotation}` | 少量边注、人工校注，不用于 UI 控件 |
| 元数据 | `{typography.metadata}` | FIELD NOTE、LOCATION、DATE、SOURCE |
| 图片说明 | `{typography.caption}` | 影像来源、描述、拍摄信息 |

元数据标签可使用紧凑大写英文（如 `FIELD NOTE 012`、`GUIZHOU · XINGYI`）或对应中文小标题；字号必须小于正文。Display 不强制粗体，以尺度和留白建立层级；正文行长宜为 28–42 个中文字符，长篇编志正文最大宽度约 720px。

## 4. 布局

- 基础间距为 4px；使用 `spacing` token，禁止任意新增间距值。
- 应用主内容最大宽度 1440px；常规工作区使用 12 列网格，列间距 24px。
- 长文阅读/编志使用 8 列或最大 720px；右侧元数据、目录或证据面板使用 3–4 列。
- 页面区段常规垂直间距 `{spacing.section}`（80px）；紧凑任务页可用 48px，不可为了“纸张感”制造无意义大空白。
- 卡片网格：桌面 3 列、平板 2 列、移动端 1 列；信息密集的档案列表可为 2 列或单列。

### 侧栏导航

保留现代 SaaS 侧栏。顶部显示 **MountainLore / 山风**，下方为“今日田野”和带编号的流程：`01 采风`、`02 编志`、`03 定调`、`04 观潮`、`05 出山`。项目区使用小状态点与项目名，例如 `● 贵州刺梨`。

当前项使用细色线、文字颜色或浅色底，不使用整块高饱和彩色底。桌面侧栏宽 240px；移动端收至抽屉，打开后应锁定背景滚动并将焦点移入菜单。

## 5. Field Record Card 与 Archive Card

普通 SaaS 卡片统一改为 `{component.field-record-card}` 或 `{component.archive-card}`：暖纸背景、1px 暖灰边框、6–10px 小圆角、无阴影或仅悬停时 1px 位移与极淡阴影。卡片不是彩色容器；层级来自照片、标题、元数据、正文与分隔线。

标准 Field Record Card 顺序：

1. `FIELD NOTE 012` 与可选采集状态。
2. 档案标题（如“刺梨”）与拉丁名/别名（如 `Rosa roxburghii`）。
3. `贵州 · 黔西南 · 兴义`、`2026.08.28` 等核心 metadata。
4. 纪实照片，使用 `{component.photo-figure}`。
5. 一段关键原话与人物出处。
6. 标签与图片说明。

图片占比可大，但必须提供有意义的 `alt`；无图时显示结构化文本占位，不使用装饰插画替代。卡片整块可点击时，不得再嵌套可点击控件；次级操作单独放在可访问的菜单按钮中。

## 6. 图像与档案材料

**Documentary photography first。** 优先级依次为：用户真实上传照片、地方环境纪实、人物劳动与生活、农产品/土地/植物细节、地图/扫描件/手稿、极少量辅助插画。

- 照片保持自然色温，不使用高饱和滤镜、商业棚拍感或 AI 梦幻效果。
- 可加入极轻颗粒或纸色底，但不可模拟发黄破损的旧纸，也不可用老化滤镜掩盖低质量素材。
- 统一使用 `object-fit: cover`；记录原始比例，重要图像允许在详情页完整展示。
- 每张非纯装饰图片都必须带 caption：描述、地点/日期（已知时）与来源/版权状态。
- 扫描件和手稿要保留可放大的原件入口，并在可行时提供转录文本。

## 7. 民族志 Metadata 系统

Metadata 不是 CRM 表单字段。它是每条记录的可追溯证据，应紧邻内容、可复制、可筛选，但不抢占叙述正文。使用 `{component.metadata-block}`：上方小标签、下方可读值、暖灰分隔线。

建议字段：

| 标签 | 值示例 | 说明 |
|---|---|---|
| FIELD NOTE | 012 | 稳定、可引用的记录编号 |
| LOCATION | 贵州 · 黔西南 · 兴义 | 层级地点；有坐标时另显示 |
| RECORDED | 2026.08.28 · 18:42 | 记录日期与时间 |
| PEOPLE | 王阿姨，56 岁 | 人物须按同意与隐私设置展示 |
| SOURCE | 口述访谈 | 文字、语音、照片、扫描件等 |
| BATCH | 2026 秋收 · 第 03 批 | 采集批次与时间语境 |
| TAGS | 刺梨 / 秋收 / 山地生活 | 可筛选关键词 |

原话必须明确区分“逐字转录”“整理转述”“AI 摘要”，不得将 AI 生成内容伪装为受访者原话。位置与人物信息应遵守用户权限和脱敏设置；公开内容的精确坐标默认隐藏。

## 8. 田野访谈（采风）界面

采风是 **Field Interview Session**，而非彩色聊天气泡界面。顶部固定显示记录上下文，例如：`采风记录 · 001`、`贵州黔西南 / 2026.08.28 / 18:42`，并提供保存状态与返回档案的入口。

主栏用访谈转录式排版：每一轮为 `{component.transcript-turn}`，通过角色标签、左侧色线和排版区分，而不是通过左右彩色气泡区分。

- **调查员（AI）**：Indigo 细线，角色标签“调查员”；问题短、可追问、说明所据材料。
- **受访者（用户）**：Moss 细线，角色标签“受访者”；保留原话、照片、音频及时间信息。
- **系统处理**：低强调状态行，只说明“正在转录”“已提取 3 个地点”等过程，不伪造确定性。
- 输入区固定在底部，支持文本、语音、图片、地点；每个图标须有文字标签或可访问名称，上传进度和失败状态要可见。

桌面端右栏使用 `{component.evidence-panel}` 展示“本次采集中发现”：人物、地点、物产、事件、记忆。每项是小型 archive card，可确认、编辑或标为待核验。移动端右栏移至转录文本之后，不能遮挡输入区。

## 9. 模块色与状态

五个模块同属一套纸色/墨色系统，只将模块色用于细小的导航编号、图标、状态点、标签、区块小标题、选中指示与少量关键按钮：

| 模块 | 色彩 | 使用语境 |
|---|---|---|
| 采风 | `{colors.indigo}` | 访谈、采集、地点信息 |
| 编志 | `{colors.moss}` | 归档、整理、物产材料 |
| 定调 | `{colors.clay}` | 品牌判断、编辑决策 |
| 观潮 | `{colors.ochre}` | 趋势观察、待确认洞察 |
| 出山 | `{colors.forest}` | 发布、输出与主行动 |

状态要搭配文字：例如“已核验”“待补充”“草稿”“已发布”。错误使用 Clay，但不能只靠红色边框或红字传达。

## 10. 按钮、表单与交互

使用 `{component.button-primary}` 作为页面的一个主要行动（如“开始采风”“发布档案”）；主按钮色为 Forest。次级行动用 `{component.button-secondary}`；破坏性操作显式使用 `{component.button-destructive}` 并在不可逆操作前二次确认。

- Hover 只表达可操作性：背景轻变、边框加深或卡片上移不超过 1px；不使用发光、弹跳或缩放。
- Active/pressed 要有即时反馈；disabled 必须禁用交互并保留可读的原因提示。
- 键盘焦点必须清晰：使用 `{component.text-input-focused}` 同等可见的 3px Forest 半透明外环，不能以 `outline: none` 取代。
- 过渡时间 120–220ms，使用 `ease-out` 或无弹性曲线；遵从 `prefers-reduced-motion`，关闭非必要位移和自动播放。
- 表单标签始终可见，placeholder 不能代替 label；在字段附近显示具体错误、帮助文案与成功状态。

## 11. 特殊编辑元素

可有限使用手绘下划线、铅笔批注、日期戳、档案编号、纸张分隔线、地图坐标、植物标签、照片说明、引号和手写箭头。它们仅为证据或编辑过程服务：如把批注贴近其所注释的文字、以 `aria-label` / 文本提供等价信息、在小屏不覆盖内容。

每页最多混用 1–3 类。批注色以 `{colors.muted-ink}` 或模块辅助色低透明度呈现；不能将手写字体用于长文、按钮、导航或表单，也不能把装饰性元素置于正文下方导致对比度下降。

## 12. 可访问性与语义 HTML

- 使用 `header`、`nav`、`main`、`article`、`section`、`aside`、`figure`、`figcaption` 等语义元素；访谈转录可用有序时间线或文章段落。
- 每页一个 h1，标题层级连续；不能用字重/字号模拟标题而跳过语义层级。
- 所有控件可键盘访问，焦点顺序与视觉顺序一致；弹窗、抽屉和菜单应处理焦点陷阱、Esc 关闭与焦点归还。
- 图标按钮提供 `aria-label`，状态变化使用合适的 `aria-live`，表单错误与字段通过 `aria-describedby` 关联。
- 点击目标应至少 44 × 44px；视觉上较小的图标控件以透明内边距补足触控面积。
- 不自动播放音频；音频须提供播放、暂停、时长、转录与下载/来源信息（权限允许时）。

## 13. 响应式行为

| 断点 | 行为 |
|---|---|
| Mobile < 768px | 侧栏变抽屉；标题 display-xl 降至 32px；卡片单列；采风证据栏移至正文后；输入区仍易触及。 |
| Tablet 768–1023px | 紧凑侧栏或抽屉；档案卡 2 列；正文与元数据栏可上下排列。 |
| Desktop ≥ 1024px | 240px 侧栏；档案卡 3 列；采风采用主转录栏 + 右侧证据栏。 |
| Wide ≥ 1440px | 内容最大宽度封顶；增加外侧留白，不能无限拉长正文行宽。 |

网格通过减少列数而非缩小字体或压缩点击区域来适配。表格应允许横向滚动并保留表头关联；长地点、标签与档案名可换行，不能截断关键内容。上传照片保持比例，音频波形和时间轴在窄屏改为纵向信息流。

## 14. 工程与迭代约束

1. 所有视觉值优先引用本文件 token；新增颜色、字号、圆角或间距必须先扩展 token，再使用。
2. 组件以可复用的基础结构实现；变体（`-hover`、`-active`、`-focused`、状态色）通过明确 API/类名表达，不能靠页面级临时覆盖。
3. 内容与呈现分离：Field Note、人物、地点、来源、图片说明等使用结构化数据；AI 摘要、转录与人工编辑版本要可追溯。
4. 先实现空、加载、错误、无权限和长内容状态，再打磨视觉；所有关键流程在键盘和移动端验证。
5. 使用真实或明确标注的示例数据。不要用虚构“地方故事”冒充真实田野材料。
6. 每次迭代集中处理一个组件及其全状态，检查深浅背景、中文断行、长 metadata、缩放 200% 和 reduced-motion。

## 15. Do / Do Not Use

### Do

- 以 Paper、Ink、真实材料和清晰档案层级建立页面。
- 使用 Serif 标题 + Sans 正文的安静编辑出版物节奏。
- 为照片、扫描件、录音和原话提供出处、说明、时间地点与权限语境。
- 让 AI 的提取、推断和待核验内容清晰可辨、可编辑、可追溯。
- 以小面积模块色支持流程识别，保持全产品一致。

### Do Not Use

- 蓝紫 AI 渐变、黑色科技感 dashboard、neon、glassmorphism。
- 大量 emoji、过度圆角、大面积 drop shadow、弹跳动画、卡通或 3D 插画。
- 民族图腾背景、苗绣/蜡染纹样大面积铺陈、银饰图案装饰、古风边框、仿宣纸卷轴 UI。
- 旅游宣传风 banner、传统文化符号堆砌、将地方生活异域化或商品化的视觉叙事。
- 没有来源的“纪实”照片、未经标注的 AI 生成图，或把 AI 内容表述为田野事实。

最终效果应让用户感觉自己打开的是一本持续生长、可被检索与协作编纂的数字田野志，同时获得现代 Agent 产品所需的效率、清晰度与可靠性。
