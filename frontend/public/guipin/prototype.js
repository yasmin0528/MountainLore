const A = "/guipin/assets/";

const nav = [
  ["collect", "采风", "从产品与人开始"],
  ["tide", "观潮", "本周消费灵感"],
  ["launch", "出山", "把事实变成物料"],
];

const cropItems = [
  ["刺梨", "sticker-cili.png"], ["酸汤", "sticker-sour-soup.png"],
  ["辣椒", "sticker-chili.png"], ["贵州茶", "sticker-tea.png"],
  ["抹茶", "sticker-matcha.png"], ["蓝莓", "sticker-blueberry.png"],
  ["猕猴桃", "sticker-kiwi.png"], ["自定义", "sticker-custom.png"],
];

const icon = (name) => `<svg class="icon icon-${name}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const tag = (text, kind="paper") => `<span class="tag ${kind}">${text}</span>`;

function symbols() {
  return `<svg class="symbols" aria-hidden="true"><symbol id="i-field" viewBox="0 0 24 24"><path d="M3 18c4-1 5-5 8-7 3-2 6-2 10-1M4 6c3 2 4 5 4 9M14 4c3 3 4 7 4 12"/></symbol><symbol id="i-wave" viewBox="0 0 24 24"><path d="M3 12c2-7 4 7 6 0s4 7 6 0 4 7 6 0"/></symbol><symbol id="i-book" viewBox="0 0 24 24"><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 1V4Zm0 16h14"/></symbol><symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h13m-5-5 5 5-5 5"/></symbol><symbol id="i-spark" viewBox="0 0 24 24"><path d="m12 3 1.5 6.5L20 12l-6.5 1.5L12 20l-1.5-6.5L4 12l6.5-2.5L12 3Z"/></symbol><symbol id="i-leaf" viewBox="0 0 24 24"><path d="M20 4C11 4 5 8 5 15c0 3 2 5 5 5 7 0 10-7 10-16ZM4 21c3-5 7-8 13-11"/></symbol><symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l4 2"/></symbol></svg>`;
}

function side(active) {
  return `<aside class="sidebar">
    <div class="brand"><span class="brand-seal">贵</span><div><b>贵品风物志</b><small>贵州风物工作台</small></div></div>
    <nav class="nav-list">${nav.map(([key, label, sub]) => `<button class="nav-row ${active===key?"active":""}" data-target="${key}"><span>${icon(key === "collect" ? "field" : key === "tide" ? "spark" : "leaf")}</span><div><b>${label}</b><small>${sub}</small></div></button>`).join("")}</nav>
    <div class="sidebar-spacer"></div>
    <button class="archive-nav ${active === "archive" ? "active" : ""}" data-target="archive">${icon("book")}<span>档案</span><em>3</em></button>
    <div class="sidebar-foot">第贰卷 · 山地品牌志</div>
  </aside>`;
}

function header(section, title, intro, action = "保存当前进度") {
  return `<header class="topbar"><div class="crumb"><span>贵州刺梨 · 山野醒口</span></div><div class="top-status"><span class="sync-dot"></span>资料已保留</div></header>
  <section class="page-title"><div><span class="section-kicker">${section}</span><h1>${title}</h1><p>${intro}</p></div>${action ? `<button class="main-action">${action} ${icon("arrow")}</button>` : ""}</section>`;
}

function rightRail(title, content) {
  return `<aside class="right-rail"><div class="rail-title"><span>编志助手</span><b>${title}</b></div>${content}<div class="rail-foot">材料会随采风持续补充</div></aside>`;
}

function shell(active, section, title, intro, content, rail, action) {
  return `${symbols()}<div class="shell"><div class="paper-noise"></div>${side(active)}<div class="workspace ${rail ? "" : "no-rail"}"><div class="workspace-wash"></div><main class="main-area">${header(section, title, intro, action)}${content}</main>${rail ? rightRail(section, rail) : ""}</div></div>`;
}

function factMeta(source, status, note) {
  return `<div class="fact-meta">${tag(source,"source")} ${tag(status,status.includes("确认") || status.includes("补") ? "warning" : "safe")} ${tag(note,note.includes("暂") ? "warning" : "soft")}</div>`;
}

function collect() {
  const crops = cropItems.map(([name,img],i) => `<button class="crop ${i===0?"selected":""}"><img src="${A}${img}" alt="${name}"/><b>${name}</b>${i===0?"<i>已选</i>":""}</button>`).join("");
  const content = `<section class="collect-layout">
    <div class="field-form paper-card"><div class="card-rule"></div><div class="mini-title"><span>采风起笔</span><b>先填三项基本信息</b></div>
      <div class="form-row"><label>主营产品 <em>必填</em></label><div class="crop-strip">${crops}</div></div>
      <div class="two-fields"><label>品牌 / 主体名称<input value="赫章山野刺梨社" aria-label="品牌或主体名称"/></label><label>主要产地<input value="贵州省 · 毕节市 · 赫章县" aria-label="主要产地"/></label></div>
      <p class="form-hint">这些信息能帮你把后面的内容整理得更清楚。</p>
    </div>
    <div class="story-card"><div class="story-head"><div><span class="section-kicker">自由讲述</span><h2>从一件真事开始，不必写得完整。</h2></div><img src="${A}sticker-cili.png" alt="刺梨贴纸"/></div>
      <div class="story-box"><div><span>可写产品、人物、地方，也可放一段语音或一张图</span><small>0 / 2,000 字</small></div><p>“秋天摘果那几天，邻居会来帮忙。第一口刺梨很酸，等一会儿才闻到一点果香。”</p><footer><button>${icon("wave")} 收一段语音</button><span>已保存草稿</span></footer></div>
      <div class="story-bottom"><span>提交后，只会再问 2–3 个关键问题；不想答的可以跳过。</span><button class="main-action">开始整理 ${icon("arrow")}</button></div>
    </div>
  </section>`;
  const rail = `<article class="rail-note"><span>本次采风会关注</span><ol><li><b>谁在做</b><small>人物、家族或合作关系</small></li><li><b>怎么做</b><small>加工与保存方式</small></li><li><b>为什么被记住</b><small>地方吃法、顾客反馈</small></li></ol></article><div class="source-list"><span>可加入的材料</span><p>${icon("book")} 产品规格或检测文件</p><p>${icon("wave")} 语音、访谈与旧照片</p></div>`;
  return shell("collect", "采风", "先记下三件事，再开始讲故事", "真实比完整更重要。这里收集的每一段材料，都会留下来源与确认状态。", content, rail, "稍后继续");
}

function followup() {
  const content = `<section class="followup-layout"><article class="asked-card"><div class="question-order"><span>追问 1 / 3</span><div><i class="on"></i><i></i><i></i></div></div><div class="heard"><span>我先从你刚才的话里记下</span><b>秋天采摘</b><b>邻里帮忙</b><b>先酸后香</b></div><div class="big-question"><span>人物与关系</span><h2>那几天最常在果园里的人是谁？他和这份刺梨，有没有一件你想留下的事？</h2><p>把“谁在做”问具体，后面才知道该从哪里讲起。没有合适的答案也没关系。</p></div><div class="answer-area"><label>你的回答 <small>可写、可说，也可以稍后补</small></label><p>比如：是我母亲，她一直记得外婆把鲜果分给邻居的习惯……</p><footer><button>${icon("wave")} 用语音回答</button><button class="quiet-button">跳过这题</button><button class="main-action">记录并继续 ${icon("arrow")}</button></footer></div></article><aside class="followup-side"><div class="ripped-label">不重复问已经说过的事</div><p>这轮只补人物。下一题会根据你的回答，可能追问加工细节或当地的吃法。</p><div class="mini-sources">已使用<br/><b>自由讲述 · 文字草稿</b></div></aside></section>`;
  const rail = `<article class="rail-note"><span>追问原则</span><p class="large-copy">少问一句空的，多问一句能留下来的。</p></article><div class="source-list"><span>当前材料</span><p>文字草稿 · 已保存</p><p>产品与产地 · 已填写</p></div>`;
  return shell("collect", "采风 · 动态追问", "只问一个关键细节", "你可以跳过，系统会把不知道的地方明确留作待补信息。", content, rail, "结束采风");
}

function chronicle() {
  const content = `<section class="chronicle-grid"><article class="archive-card product-card"><header><span>产品信息</span><i>01</i></header><div class="product-signal"><img src="${A}sticker-cili.png" alt="刺梨贴纸"/><div><b>贵州刺梨原汁</b><p>第一口酸亮，之后能闻见果香。现有形态为 30ml 便携小瓶。</p></div></div>${factMeta("你的描述","还要确认","可先参考")}<footer><span>子产品</span><b>原汁 · 果脯 · 冲泡粉</b></footer></article>
  <article class="archive-card story-archive"><header><span>品牌故事</span><i>02</i></header><div class="story-scrap"><img src="${A}sticker-tea.png" alt="茶叶贴纸"/><p>采摘季，邻居会到果园搭把手。大家总说：鲜果刚摘下来那一口，最有劲。</p></div>${factMeta("自由讲述","还需补充","先别对外用")}<a>打开原始文字 ${icon("arrow")}</a></article>
  <article class="chain-card"><header><div><span>产品加工链</span><h2>从山间鲜果，到手里的完整一瓶</h2></div><div class="chain-stamp">重点编录</div></header><div class="chain-flow"><div><b>01</b><span>采收分选</span><small>果园记录待补</small></div><div><b>02</b><span>清洗去刺</span><small>工艺口述待确认</small></div><div><b>03</b><span>低温打浆</span><small>加工单待上传</small></div><div><b>04</b><span>灌装质检</span><small>检测报告待补</small></div><div><b>05</b><span>包装发出</span><small>规格表已确认</small></div></div><footer><span>这条链路会决定：包装文案、渠道资料与待补证明。</span><button>补一份材料 ${icon("arrow")}</button></footer></article></section>`;
  const rail = `<article class="rail-note highlight"><span>下一步最值得补</span><h3>加工单与灌装规格</h3><p>补上它们后，“怎么做”就能写进包装和产品介绍里。</p><button class="quiet-button">查看待补清单</button></article><div class="source-list"><span>现有材料</span><p>${tag("你的描述","source")} 3 条</p><p>${tag("上传材料","safe")} 1 条</p><p>${tag("还需补充","warning")} 2 条</p></div>`;
  return shell("collect", "采风 · 编志", "把零散经历整理成一册风物档案", "先把产品、故事与工艺过程理清，再决定怎么介绍给别人。", content, rail, "生成档案摘要");
}

function tide() {
  const trend = (top, title, fit, text, note, cls="") => `<article class="trend ${cls}"><div class="trend-number">${top}</div><div><div class="trend-line"><span>${fit}</span><small>本周参考方向</small></div><h2>${title}</h2><p>${text}</p><footer><span>${note}</span><button>用这个灵感出山 ${icon("arrow")}</button></footer></div></article>`;
  const content = `<section class="tide-head"><div><span class="section-kicker">第 35 周 · 每周刷新</span><h2>借一阵风，但不改产品事实。</h2></div><div class="tide-filter">贵州刺梨 <i></i> 山野醒口 <i></i> 年轻通勤</div></section><section class="trend-list">${trend("01","把“第一口清醒”留给上山以后","高适配","轻户外与短途出行内容里，酸感可以被写成走出空调房后的味觉醒转。","不要延伸为补能、营养或功效表达。","yellow-edge")}${trend("02","一人份，也能喝见贵州的山风","中适配","小瓶装可进入通勤桌面、午后休息和一个人的轻分享场景。","适合做小红书图文；不引用没有日期的热榜说法。")} ${trend("03","节日不必只讲礼盒，也可以讲带回一口地方","低适配","中秋前的送礼节点可用，但品牌还缺清晰的礼赠规格与授权素材。","现在先收集规格，不建议立刻生成促销承诺。","moss-edge")}</section>`;
  return shell("tide", "观潮", "让品牌先有自己的气味，再借一阵风", "本周整理了几个可参考的表达角度；是否采用，仍以你的产品和实际情况为准。", content, null, "刷新本周灵感");
}

function launch() {
  const content = `<section class="launch-layout"><article class="chat-sheet"><header><div><span>出山对话</span><b>这次想让哪一部分先被看见？</b></div><button class="history-button">${icon("clock")} 历史对话 4</button></header><div class="chat-blank"><img src="${A}sticker-cili.png" alt="刺梨贴纸"/><p>我会根据你已经填写的内容，生成适合这次目标的草稿。</p></div><div class="chat-field"><span>可以这样说：想把“先酸后香”做成适合通勤的一套小红书内容</span><button>${icon("arrow")}</button></div></article><div class="launch-choices"><button class="choice-card physical"><span>出山方向 01</span><h2>实体物料设计</h2><p>包装概念、展台单页、品鉴卡与渠道资料。</p><i>${icon("leaf")}</i></button><button class="choice-card online"><span>出山方向 02</span><h2>线上图文生成</h2><p>小红书封面、图文正文与电商详情页结构。</p><i>${icon("spark")}</i></button></div></section>`;
  return shell("launch", "出山", "让整理好的风物，长成能被看见的东西", "选择一个方向开始；每次生成都会留下本次内容和对话记录。", content, null, "打开历史对话");
}

function archive() {
  const content = `<section class="archive-layout"><div class="project-list"><div class="list-header"><span>个人项目</span><button>＋ 新建档案</button></div><button class="project active"><span class="project-mark yellow">刺</span><div><b>赫章山野刺梨社</b><small>采风已完成 · 编志进行中</small></div><em>08.28</em></button><button class="project"><span class="project-mark indigo">茶</span><div><b>都匀云雾茶 · 试验档</b><small>等待补充产品资料</small></div><em>08.25</em></button><button class="project"><span class="project-mark moss">辣</span><div><b>黔北糟辣椒合作社</b><small>已收藏 2 条观潮灵感</small></div><em>08.19</em></button></div><div class="archive-detail"><div class="detail-head"><div><span class="section-kicker">赫章山野刺梨社</span><h2>一颗刺梨，正在长成自己的工作空间</h2></div><button class="main-action">进入这个项目 ${icon("arrow")}</button></div><div class="asset-river"><article><span>产品信息</span><b>5</b><p>形态、口感、子产品</p></article><article><span>品牌故事</span><b>3</b><p>人物、采摘记忆、反馈</p></article><article class="chain-asset"><span>加工链</span><b>5</b><p>从采收到包装的节点</p></article><article><span>观潮灵感</span><b>3</b><p>本周可讨论主题</p></article><article><span>出山版本</span><b>4</b><p>对话与物料快照</p></article></div><div class="asset-note"><span>当前提醒</span><p>加工单、灌装规格和可公开的产地范围仍在待补清单中；它们不会混入对外物料。</p><button>继续补材料 ${icon("arrow")}</button></div></div></section>`;
  const rail = `<article class="rail-note"><span>项目沉淀</span><p class="large-copy">档案不是收藏夹，是每一次出山前都能回来的底稿。</p></article><div class="source-list"><span>当前项目</span><p>${tag("已确认","safe")} 5 条事实</p><p>${tag("待补","warning")} 2 项材料</p><p>${tag("已生成","soft")} 4 个版本</p></div>`;
  return shell("archive", "档案", "每一个品牌，都有一间自己的风物工作室", "进入项目，就能查看从采风到出山沉淀下来的材料、判断和版本。", content, rail, "查看项目轨迹");
}

function archive() {
  const brand = (mark, name, product, state, count, cls, target = "assetdetail") => `<button class="brand-folder ${cls}" data-target="${target}"><span class="folder-tab">${mark}</span><div class="brand-pattern"></div><div class="folder-copy"><span>${product}</span><b>${name}</b><small>${state}</small></div><footer><em>${count}</em><span>进入资产详情 ${icon("arrow")}</span></footer></button>`;
  const content = `<section class="directory-intro"><div><span class="section-kicker">个人档案目录</span><h2>一格一品牌，先找到那一页，再翻开它的风物资产。</h2></div><button class="new-folder">＋ 新建品牌档案</button></section><section class="brand-directory">${brand("刺","赫章山野刺梨社","贵州刺梨","采风已完成 · 编志进行中","12 项资产","cili")}${brand("茶","都匀云雾茶 · 试验档","贵州茶","等待补充产品资料","5 项资产","tea")}${brand("辣","黔北糟辣椒合作社","糟辣椒","已收藏 2 条观潮灵感","8 项资产","chili")}${brand("汤","凯里酸汤小作坊","酸汤","尚未开始采风","0 项资产","soup")}${brand("果","黔西蓝莓园","蓝莓","物料讨论中","9 项资产","berry")}${brand("＋","新建一页风物志","自定义产品","从产品、主体、产地开始","开始建档","new", "collect")}</section><p class="directory-note">点开品牌，即可进入独立的资产详情页；不同品牌的材料、判断与生成版本彼此独立。</p>`;
  const rail = `<article class="rail-note"><span>档案的用法</span><p class="large-copy">先按品牌归档，再从同一份底稿里持续出山。</p></article><div class="source-list"><span>你的目录</span><p>${tag("进行中","warning")} 2 个品牌</p><p>${tag("已沉淀","safe")} 3 个品牌</p><p>${tag("空白页","paper")} 1 个新建入口</p></div>`;
  return shell("archive", "档案", "个人品牌档案目录", "每一个框是一间独立的品牌工作室；点击后，再查看该品牌积累下来的全部资产。", content, rail, "新建档案");
}

function assetdetail() {
  const content = `<section class="asset-hero"><div class="dong-cloth"></div><div class="asset-hero-copy"><span class="section-kicker">赫章山野刺梨社 · 品牌资料</span><h2>从一段秋日采摘，走到一册能反复使用的品牌底稿。</h2><div>${tag("编志进行中","warning")} ${tag("贵州刺梨","source")} ${tag("资料 12 项","soft")}</div></div><button class="back-directory" data-target="archive">← 回到品牌目录</button></section><section class="asset-detail-grid"><article class="asset-summary paper-card"><header><span>资料摘要</span><b>12</b></header><div class="summary-row"><span>产品信息</span><em>5</em><p>形态、口感、子产品</p></div><div class="summary-row"><span>品牌故事</span><em>3</em><p>人物、采摘记忆、反馈</p></div><div class="summary-row highlight-row"><span>产品加工过程</span><em>5</em><p>采收、分选、打浆、灌装、包装</p></div></article><article class="asset-main"><header><div><span>重点内容</span><h3>产品加工过程</h3></div><button>查看全部工艺材料 ${icon("arrow")}</button></header><div class="asset-chain"><span>采收分选</span><i></i><span>清洗去刺</span><i></i><span>低温打浆</span><i></i><span>灌装质检</span><i></i><span>包装发出</span></div><p>已收录 1 项规格；加工单和灌装记录还没补齐，这部分暂不用于对外介绍。</p><div class="asset-tags">${tag("上传材料","safe")} ${tag("你的讲述","source")} ${tag("还差 2 项","warning")}</div></article><article class="asset-outbound"><span>最近一次出山</span><h3>“先酸后香”的通勤内容方向</h3><p>内容草稿 · 2026.08.28</p><button class="quiet-button">打开版本记录</button></article></section>`;
  const rail = `<article class="rail-note highlight"><span>当前提醒</span><h3>还差两份工艺材料</h3><p>补齐加工单与灌装规格后，可以把这条加工链用于渠道资料与包装说明。</p><button class="quiet-button">查看待补清单</button></article><div class="source-list"><span>资产状态</span><p>${tag("已确认","safe")} 5 条事实</p><p>${tag("待补","warning")} 2 项材料</p><p>${tag("已生成","soft")} 4 个版本</p></div>`;
  return shell("archive", "档案 · 品牌资料", "赫章山野刺梨社", "这里只展示这个品牌的资料、加工过程和已经做过的物料。", content, rail, "继续补材料");
}

const screens = { collect, followup, chronicle, tide, launch, archive, assetdetail };
const key = new URLSearchParams(location.search).get("screen") || "collect";
document.getElementById("app").innerHTML = (screens[key] || collect)();

document.querySelectorAll("[data-target]").forEach(button => button.addEventListener("click", () => {
  const target = button.dataset.target;
  location.search = `?screen=${target}`;
}));
