---
version: 2.0
name: MountainLore-design-system
description: "MountainLore / 山风风物志的界面设计系统。风格以 guipin 原型为唯一视觉基准：地方档案册的暖纸、靛蓝布面、苔藓绿与明黄标记。"

colors:
  paper: "#F2EDDE"
  paper-elevated: "#FFFDF6"
  paper-muted: "#F1EEE3"
  paper-highlight: "#FAF1CF"
  canvas: "#D5D8CF"
  ink: "#292F27"
  ink-inverse: "#FFF9E9"
  muted-ink: "#71807A"
  muted-soft: "#8A958D"
  border: "#CFC4AD"
  border-soft: "#DDD4C4"
  indigo: "#0F4A63"
  indigo-deep: "#0A3549"
  indigo-cloth: "#154F68"
  moss: "#68755A"
  moss-deep: "#365B48"
  moss-soft: "#E1E8DC"
  yellow: "#F1C84B"
  yellow-deep: "#D29F20"
  yellow-soft: "#FBEBBB"
  rose: "#C74657"
  rose-deep: "#A13E4F"
  rose-soft: "#F8DFE0"
  source-soft: "#E8EBE4"
  online-soft: "#E6EDF0"
  focus-ring: "#0F4A63"

typography:
  display:
    fontFamily: "Noto Serif SC, STSong, Songti SC, serif"
    fontWeight: 600
  body:
    fontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontWeight: 400
  metadata:
    fontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: 10px
    fontWeight: 600
    letterSpacing: 0.7px
  h1: { fontSize: 31px, lineHeight: 1.2, letterSpacing: -0.8px }
  h2: { fontSize: 23px, lineHeight: 1.45 }
  h3: { fontSize: 18px, lineHeight: 1.5 }
  body-md: { fontSize: 14px, lineHeight: 1.75 }
  body-sm: { fontSize: 12px, lineHeight: 1.7 }
  caption: { fontSize: 10px, lineHeight: 1.5 }

rounded:
  xs: 1px
  sm: 2px
  md: 4px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  section: 48px
---

# MountainLore「山风风物志」设计系统

## 1. 视觉方向

MountainLore 是记录、编纂和推出地方物产故事的工作台。界面应像一本正在使用的地方档案册，而不是旅游宣传页、复古店铺或通用 SaaS 后台。

以 `frontend/public/guipin/` 中的最终原型为准：暖米色纸张承载大部分信息；深靛蓝像布质封面和工作台的深色内页；苔藓绿用于归档和稳定状态；明黄像贴在档案上的标记条；玫瑰红只用来作编号、校注、风险和待办标识。层级来自纸面、细线、排版和少量明亮标记，而不是渐变、玻璃和大面积照片。

**真实材料优先。** 照片、访谈原话、地点、时间、来源和产品信息比装饰重要。手工质感只能帮助传达“正在整理的档案”，不能遮挡内容或伪造田野事实。

## 2. 配色规范（本次核心更新）

### 色彩角色

| 角色 | Token / 色值 | 使用方式 |
|---|---|---|
| 主画布纸色 | `paper` / #F2EDDE | 主页面、工作区底色；页面主要面积。 |
| 抬升纸面 | `paper-elevated` / #FFFDF6 | 卡片、表单、资料页与可阅读内容的底。 |
| 次级纸面 | `paper-muted` / #F1EEE3 | 列表栏、次级分区、静态占位。 |
| 外部画布 | `canvas` / #D5D8CF | 应用壳层之外的衬底；不进入正文区域。 |
| 正文墨色 | `ink` / #292F27 | 标题、正文、图标和关键数字。 |
| 靛蓝主色 | `indigo` / #0F4A63 | 主行动、深色信息面、导航图标、链接、关键数据。 |
| 靛蓝深色 | `indigo-deep` / #0A3549 | 靛蓝背景上的 pressed / 深层边缘；避免作正文背景。 |
| 苔藓绿 | `moss` / #68755A | 来源、归档、已同步、稳定/安全状态。 |
| 明黄 | `yellow` / #F1C84B | 选中条、编号、重点流程、深靛蓝面上的主按钮。 |
| 玫瑰红 | `rose` / #C74657 | FIELD NOTE、批注、待跟进、风险状态；小面积文字和细线。 |
| 暖灰边线 | `border` / #CFC4AD | 卡片边界、输入框、规则线。 |

### 配色比例与规则

- 约 **65–75%** 使用纸色（`paper`、`paper-elevated`、`paper-muted`），文字以 `ink` 为主。
- `indigo` 是唯一深色大色块，可用于左侧封面式导航、故事卡、资产头图或一个明确的主行动区域；同一屏不超过 2 个深靛蓝大面。
- `yellow` 只承担“看这里”的职责：选中左线、2–4px 规则线、编号、印章边框或深靛蓝面上的 CTA。不得作为大段正文底色或常规按钮底。
- `moss` 表达归档、来源、完成、实物与本地；`rose` 表达编辑标记、提醒、风险。任何状态都必须同时提供文本或图标。
- 禁止蓝紫渐变、霓虹色、纯黑背景、冷灰分隔线。纸色 UI 不使用高饱和整块彩色卡片。
- 不用 CSS 渐变制造质感。若需要材料感，使用现有纸纹、布面或图像素材，并保持文字区干净、对比清晰。

### 状态色

| 状态 | 视觉 | 文案示例 |
|---|---|---|
| 已归档 / 已同步 | `moss` + `moss-soft` | 已归档、已同步、来源已记录 |
| 待确认 / 高亮步骤 | `yellow` + `yellow-soft` | 待核验、下一步、重点材料 |
| 编辑批注 / 风险 | `rose` + `rose-soft` | 待补充、需确认、风险提示 |
| 错误 | `rose-deep` + 明确图标 | 上传失败、保存失败 |
| 信息 / 在线内容 | `indigo` + `online-soft` | 在线资料、可继续查看 |

普通文字与背景须达到 WCAG AA（至少 4.5:1）。`yellow` 不可直接承载白色小字；在黄色底上使用 `indigo` 或 `ink`。

## 3. 字体与信息层级

标题、产品名、地方名和叙事引语使用 `display`（宋体 / Serif）；正文、表单和导航使用 `body`（现代无衬线）。不要把手写字体用于正文、按钮或表单。

- 页面标题：31px Serif；靠留白和尺度建立层级，不依赖重阴影。
- 区块标题：23px Serif；卡片标题：18px Serif。
- 正文：14px Sans，1.7–1.8 行高；辅助文案：12px；资料编号和标签：9–10px。
- `FIELD NOTE 012`、日期、来源等使用小号、字距略开的 metadata 样式；玫瑰红仅作标签色，不把长段元信息染红。
- 中文长文阅读宽度控制在约 680–720px；保持完整的地点名、人名和来源，不以省略号隐藏关键证据。

## 4. 布局与容器

- 桌面端采用档案工作台：左侧约 186px 靛蓝导航，中部主工作区，必要时右侧约 244px 的资料栏；内容区在宽屏封顶，避免行长无限变宽。
- 主内容使用 12 列概念网格，常规间距 16–24px；区块间距 48px。移动端逐步减列，不缩小文字和点击面积。
- 卡片是暖白纸面 + 1px 暖灰边线，默认阴影极淡；可用 2–4px 的硬质黄/靛蓝偏移阴影来传达装订、标签的触感，但同一视区不要满屏使用。
- 边角以近直角为主（1–4px）。有意的不齐整边缘、轻微倾斜或纸签形状仅用于少数可替换的小模块，不能用于表单字段、主导航或数据表格。
- 规则线可使用 `border` 实线或低强调虚线；重点规则线为 2–3px `yellow`。

## 5. 组件准则

### 导航与主行动

- 左侧导航用 `indigo` / `indigo-cloth` 深底，文字为 `ink-inverse`；每个流程项可以是一张浅纸签，当前项以 `yellow` 左线或硬阴影标示。
- 每页只保留一个常规主行动：`indigo` 底、暖白字、右下 `yellow` 3px 硬阴影。Hover 仅加深或上移不超过 2px。
- 深靛蓝故事卡内的主行动可反转为 `yellow` 底 + `indigo` 字；常规次级行动则用纸底、靛蓝描边/下划线。

### 卡片、表单与标签

- 标准内容卡使用 `paper-elevated`；标题、说明、来源与操作按由上到下的编辑次序排列。不要把每张卡都做成彩色面板。
- 表单采用“纸面上的字段”：可见标签 + 暖灰底线/边框 + 明确帮助与错误文案。焦点为 3px `focus-ring` 半透明外环。
- 标签应为小而方正的纸签（1–2px 圆角）：来源用 `source-soft`，完成用 `moss-soft`，待确认用 `yellow-soft`，风险用 `rose-soft`。
- 证据链、时间线和步骤流使用靛蓝节点、明黄连线、纸色内容块；色彩只辅助信息，节点仍必须含序号与名称。

### 动效与可访问性

- 动效 120–220ms、`ease-out`；仅用细微上移、边框加深或状态色变化，遵从 `prefers-reduced-motion`。
- 所有可点击目标至少 44 × 44px；图标按钮带 `aria-label`；表单 label 始终可见。
- 不以颜色作为唯一状态信号；弹窗/抽屉实现焦点管理与 Esc 关闭。

## 6. 现有 Sticker 资源（必须复用）

不重新生成同类插画。优先复用 `frontend/public/guipin/assets/` 下已生成的透明底 PNG 贴纸；它们均为 1254 × 1254，带手绘白色描边，适合放在暖纸或靛蓝布面上。

| 资源 | 适用对象 / 场景 | 推荐呈现 |
|---|---|---|
| `sticker-cili.png` | 刺梨项目、采风记录、物产档案 | 物产选择卡、档案头图旁。 |
| `sticker-tea.png` | 茶项目、制茶或产地档案 | 品牌文件夹、故事卡角落。 |
| `sticker-chili.png` | 辣椒项目、风味材料 | 物产选择与主题卡。 |
| `sticker-sour-soup.png` | 酸汤、地方饮食资料 | 饮食/配方相关档案卡。 |
| `sticker-blueberry.png` | 蓝莓项目 | 产品档案或产地资料。 |
| `sticker-kiwi.png` | 猕猴桃项目 | 产品档案或采集表单。 |
| `sticker-matcha.png` | 抹茶项目 | 品牌素材或线上版本入口。 |
| `sticker-custom.png` | 新建自定义项目、空的物产分类 | “新建档案”或待命名项目，标签牌可承载项目名称。 |

### Sticker 使用边界

- 每个内容卡最多 1 张、每个页面主视区最多 2–3 张；它们是“贴在档案上的实物标记”，不是背景花纹。
- 常规尺寸 44–108px；故事卡、空状态或头图中可达 140px。使用 `object-fit: contain`，不裁切、不拉伸。
- 可轻微旋转（建议 -6° 到 8°）并使用很淡的投影，以保留贴纸感；不得添加发光、3D、跳动或大面积重复。
- 贴纸旁始终保留文字名称、状态和操作，贴纸不能单独承担产品识别或按钮含义。非装饰性贴纸提供具体 `alt`，例如“刺梨手绘贴纸”。
- 不把贴纸放在长正文之下、不覆盖输入字段、不与真实田野图片争夺主视觉；真实照片与可追溯资料仍优先。

示例：

```tsx
<img
  src="/guipin/assets/sticker-cili.png"
  alt="刺梨手绘贴纸"
  className="product-sticker"
/>
```

```css
.product-sticker {
  width: clamp(44px, 8vw, 108px);
  height: auto;
  object-fit: contain;
  transform: rotate(-3deg);
  filter: drop-shadow(2px 3px 1px rgba(41, 47, 39, 0.16));
}
```

## 7. 材料质感与禁用项

可少量使用现有的 `indigo-paper-collage-v1.png` 作为侧栏、故事卡或资产头图的局部布面；不可整页铺满。纸纹应极轻，不能降低文本对比度或影响截图、打印与低性能设备。

禁止：蓝紫 AI 渐变、玻璃拟态、霓虹科技面板、大圆角胶囊 UI、满屏厚阴影、民俗图腾的大面积背景、仿古卷轴、旅游宣传式 Hero Banner、没有来源说明的“纪实”图片，以及成排重复的贴纸装饰。

最终的感受应是：一册正在被人认真编目、批注和推进的地方档案，而不是被装饰掩盖的“传统风格”页面。

## 8. 工程约束

1. 所有新增颜色、字号、圆角和间距优先从本文件 token 取值；若确需新增，先更新本文件。
2. 复用贴纸时使用以上公开资源路径，不复制、重命名或生成近似替代图。
3. 组件应覆盖空、加载、错误、禁用、长文本与移动端状态；先保证语义和可访问性，再添加纸张/贴纸细节。
4. 实现后在浅纸面、深靛蓝面、200% 缩放和小屏上核对文字对比、图片裁切与焦点状态。
