# 网迹 · 技术规格 (SPEC v1.4.0)

> 日期：2026-11-09（v1.3.0 增补于 2026-11-17；v1.4.0 增补于 2026-11-18）｜ 项目目录：Git 仓库 `up-broswer-extensions` 的 `history-by-domain/` 子目录 ｜ 状态：v1.3.0 已实现；**v1.4.0 为本次改版规格（标签页管理，见 §17）**
> 本文是设计决策的唯一固化结果，是写码的依据。**任何偏离本文的改动，先改本文件对应章节，再改代码。**
>
> **v1.1 变更（2026-11-09）**：新增「卡片一键清除某域名全部历史」与「卡片超过 10 页时新开详情页展示」。前者是本扩展**唯一的写操作**，把"纯只读"基线改为"只读为主 + 一处受控删除"；`history` 权限本身已涵盖 `deleteUrl`，**权限清单不变**。详见 §6.7 / §9.8 / §10.7。
>
> **v1.2 变更（2026-11-09）**：新增「域名作用域搜索」——选中某张卡片后，顶部搜索框只在该域名（含子域）的记录里搜索。数据由一次全量分段枚举缓存到内存，之后每次输入零 history 调用；详情页的页内过滤同步升级为同一套多词搜索与高亮。纯新增读能力，**权限清单仍不变**。详见 §6.8 / §9.9。
>
> **v1.2.1 修复（2026-11-09）**：详情页「← 返回卡片墙」点击无反应。根因是该动作经 `focus-panel` 交给 service worker 执行异步聚焦，而 MV3 worker 可在 `panel-ping` / `tabs.update` 途中被回收，且监听器未保持消息通道、详情页又无兜底。改为由详情页直接执行 `panel-focus.js` 的握手与聚焦，失联时必定新开面板；`sw.js` 不再注册 `onMessage`，主面板对 `panel-ping` 改为同步回包。**权限清单仍不变**。详见 §9.4 / §9.8。
>
> **品牌名变更（2026-11-17）**：扩展显示名由「历史域名卡片墙」改为「**网迹**」——取「网络痕迹」之意，不绑定历史 / 书签 / 域名等具体功能，便于日后扩展数据源。工程目录名 `history-by-domain/` 保持不变（避免破坏路径、安装说明与自测脚本）。已同步 `manifest.json` / `index.html` / `README.md` / `安装说明.md` / `design/mockup.html` 与全部截图。
> **v1.4.0 变更（2026-11-18）**：新增「标签页」——顶栏分段控件扩为「历史 / 书签 / 标签页」三个 tab；只新增 `tabs` 权限读取标签元数据，按 eTLD+1 成卡，提供组级全部关闭 / 行级关闭其他 / 行级单独关闭三条受控写路径，重复标签只读标记。**零持久化、零 change 监听、零网络请求三条基线不变，不接管新标签页**。全部规格集中在 **§17**，与前文冲突时**以 §17 为准**。
> **v1.5.0 变更（2026-11-19）**：标签页侧**改为按主机名（host）成卡**，不再按 eTLD+1 合并子域——公司内部同一主域下的不同应用（`naui.` / `ai-gw.` / `www.`）被合并成一张卡反而更难用。同时三处操作形态调整：卡头与行内操作**默认隐形、悬浮卡片/行才出现**，操作按钮**统一图标化**（二次确认条保留文字），并修复「展开全部 N 个」点击无反应（按钮漏挂 `dataset.key`）。历史 / 书签侧的分组口径**不变**，仍按 eTLD+1。见 §17.3 / §17.4 / §17.5 与验收 76–79。
> **v1.5.1 变更（2026-11-19）**：顶栏分段控件顺序改为「**标签页 / 书签 / 历史**」——标签页是最常用视图，放第一位；默认落点同步改为标签页，**启动不再无条件读 90 天历史**，历史首屏改为首次切过去时才读（只读一次）。深链 `?tab=history` / `?tab=bookmarks` 仍然可用，非法值回落到标签页。见 §17.1 与验收 62 / 80。
>
> **v1.3.0 变更（2026-11-17）**：新增「书签」——顶栏分段控件在「历史 / 书签」两个 tab 间切换；书签侧为**完整管理**（文件夹卡片墙展示、纯内存搜索、新建书签 / 文件夹、改名、移动、删除、文件夹树弹层）。`bookmarks` 是 v1.0 以来**唯一新增权限**；「删除是唯一写操作」基线改为「历史删除 + 书签管理两类写操作」。全部规格集中写在 **§16**，与前文冲突时**以 §16 为准**。设计稿见 `design/mockup.html`。

## 0. 一句话

一个把浏览历史与浏览器书签聚合成卡片墙的 MV3 原生扩展：不落库、不建索引、不加后台；历史按注册域名、书签按用户自己的文件夹组织，点图标打开一个常驻全屏标签页，首屏只拉最近 200 条按注册域名聚成卡片，卡面直接给出可点的最近 3 页，长尾折叠、全量按需分段加载；搜索交给浏览器原生索引再精排并让卡片墙原地变形；选中某个域名即可把搜索限定在它内部，长列表改由独立详情页摊平展示，卡片右上角可经二次确认清除该域名（含所有子域）的全部历史。

---

## 1. 目标与非目标

**目标**

- 让"打开过但没收藏"的网站能被重新找到，主视图是按域名组织的卡片墙。
- 首屏极轻、搜索覆盖全量、全程零持久化。
- 权限面最小，不产生任何数据副本。
- 卡片保持紧凑：单个域名的长列表不撑长网格，改由独立页面承载。
- 提供按域名清除历史的能力，且删除前给出准确范围与不可逆提示。
- 支持「先锁定域名、再输入关键词」的两段式找回，作用域内的搜索完整、即输即得。

**非目标（明确不做，不要在实现时顺手加）**

- 不做收藏夹替代品：无置顶、隐藏、备注、标签、自定义分组、改名。
- 不接管新标签页，不做 popup，不做 content script。
- 不抓取正文、不建全文/拼音索引、不做跨设备同步。
- 不新增/导入历史记录；除 §6.7 的删除外不改动历史，且不做撤销、回收站、删除备份（删除不可逆，见 §10.7）。
- 不监听 `onVisited` / `onVisitRemoved`，不引入常驻后台监听。
- 不做隐私/敏感域名过滤（用户明确选择；投屏与旁人在场的风险由其自行承担）。
- 不做 Firefox / Safari 适配，不上架商店（本地 unpacked 自用）。

---

## 2. 决策基线

| # | 分支 | 决策 |
|---|---|---|
| 1 | A 数据 | 零落库，以 `chrome.history` 为唯一数据源；读为主，唯一写操作是 §6.7 的按域名删除；上限约 90 天，无痕记录天然不可见 |
| 2 | A 性能 | 首屏 200 条聚合 → "加载全部"按周分段 → 搜索下推原生索引，不为搜索建内存全量副本 |
| 3 | B 归组 | 按 eTLD+1 合并子域，内置精简 PSL 固化成 Set；特殊 URL 归「本地 / 其他」 |
| 4 | B 长尾 | 主墙按热度，一次性域名折叠进「其它 N 个域名」，搜索兜底全量 |
| 5 | C 卡片 | 正面常驻最近 3 页标题直达，底部展开全部；无自定义元数据；不做隐私过滤 |
| 6 | D 搜索 | 原生查询 + 前端精排；卡片墙原地变形 + 即时搜（200ms / ≥2 字 / query 缓存） |
| 7 | E 入口 | 独立全屏标签页，图标点击复用；`Alt+H` 与地址栏 `h` 关键字作补充 |
| 8 | F 工程 | MV3 + 原生 JS/CSS 零构建，Chromium only，keyed DOM + 事件委托 + 分批渲染 |
| 9 | 权限 | 仅 `history` + `favicon`；无 `storage`、无 `tabs`、无 host 权限、无后台常驻。**v1.1 不变**：`history` 已含 `deleteUrl` 能力 |
| 10 | v1.1 清除 | 卡片右上角清除该 eTLD+1（含全部子域）的历史：先全量统计 → 二次确认 → 逐 URL 删除；「本地 / 其他」桶不可删 |
| 11 | v1.1 详情页 | 卡片 `pageCount > 10` 时不在卡内展开，新标签打开 `detail.html` 全量平铺；≤10 页仍卡内展开 |
| 12 | v1.2 域内搜索 | 点卡片放大镜锁定域名 → 顶部搜索框只搜该域名（含子域）；一次全量枚举缓存到内存，之后输入零 API 调用；详情页共用同一套多词匹配与高亮 |

---

## 3. 运行环境与权限

### 3.1 `manifest.json`（基线，可直接落盘）

```json
{
  "manifest_version": 3,
  "name": "网迹",
  "version": "1.3.0",
  "description": "把浏览历史按域名、书签按文件夹聚合成卡片，支持全量搜索、域内限定搜索、清除历史与书签管理。本地运行，不上传任何数据。",
  "permissions": ["history", "favicon", "bookmarks"],
  "action": {
    "default_title": "打开网迹",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png"
    }
  },
  "background": { "service_worker": "sw.js" },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "commands": {
    "_execute_action": {
      "suggested_key": { "default": "Alt+H" },
      "description": "打开网迹"
    }
  },
  "omnibox": { "keyword": "h" }
}
```

### 3.2 权限说明

| 权限 | 用途 | 备注 |
|---|---|---|
| `history` | `chrome.history.search` 读取历史；`chrome.history.deleteUrl` 按 URL 删除 | 安装时会触发"读取和更改您的浏览记录"警告。**v1.1 起该警告名副其实**：删除由用户逐次确认触发，没有静默写入 |
| `favicon` | 允许使用 `chrome-extension://<id>/_favicon/` URL | 官方要求必须声明；仅在未声明 `tabs` 时额外触发一条图标权限提示 |
| `bookmarks` | `chrome.bookmarks.getTree` 读取书签树；`create` / `update` / `move` / `remove` / `removeTree` 管理书签 | **v1.3.0 新增**。安装会多一条「读取和更改您的书签」警告；即使只浏览书签也需声明，无法规避。写操作一律由用户点击触发 |
| `commands` / `omnibox` | 快捷键与地址栏关键字 | 不是权限，不产生警告 |

**明确不声明**：`tabs`、`<all_urls>`、`storage`、`webRequest`、任何 `host_permissions`、任何 `content_scripts`。

> 为什么不用 `tabs.query({ url: ... })` 做标签复用：按 URL pattern 查询需要 `tabs` 权限或该 URL 的 host 权限，与决策 9 冲突。改用 §9.4 的握手方案，**全程不读 `tab.url`**。

### 3.3 数据边界

Chrome 本地历史通常保留约 90 天；用户手动清除或过期后，卡片墙同步变空。无痕窗口的访问不进 `chrome.history`，因此天然不可见。这些是设计前提，不是缺陷，不写补偿逻辑。

v1.1 起本扩展会**主动删除**历史（§6.7）：删除范围以 90 天内的全量枚举结果为准，操作不可逆、无回收站；外部来源的删除（浏览器设置里清历史）仍按 §6.6 由用户刷新面板体现，插件不监听删除事件。

---

## 4. 文件结构

```
history-by-domain/
├── SPEC.md              本文件
├── 安装说明.md          本地加载步骤 + 权限说明
├── manifest.json
├── sw.js                service worker：action 点击、omnibox、面板单实例握手（v1.2.1 起不注册 onMessage）
├── index.html           全屏页面板（主 UI 页面）
├── detail.html          v1.1 域名详情页（新标签打开，承载 >10 页的完整列表）
├── detail.js            v1.1 详情页：全量枚举、域内搜索、返回卡片墙
├── panel-focus.js       v1.2.1 返回卡片墙：ping 握手、聚焦、失联兜底（可注入 chrome 做单测）
├── scope-view.js        v1.2 域内结果列表：行结构、高亮、分批 append（主面板与详情页共用）
├── styles.css           主面板、作用域视图与详情页共用
├── app.js               入口：状态机、渲染编排、事件委托、竞态控制、删除编排、域名作用域
├── history.js           数据层：三条只读通道 + 一条写通道、分段、去重、缓存
├── domain.js            eTLD+1 解析、特殊 URL 判定、卡片聚合、域名归属判定
├── psl-data.js          精简公共后缀表（静态数组，构建时固化）
├── search.js            全局精排、域内多词过滤、打分、高亮（含 HTML 转义）
└── icons/               icon16.png / icon32.png / icon48.png / icon128.png
```

- 使用原生 ES modules：`<script type="module" src="./app.js"></script>`。扩展页面由 `chrome-extension://` 提供，支持模块脚本；**不引任何构建工具、包管理器、CDN、外部字体**。
- `sw.js` 只做三件事：响应 `action.onClicked`、`omnibox.onInputEntered`、图标点击时的面板复用。**v1.2.1 起刻意不注册 `chrome.runtime.onMessage`**：既避免异步聚焦途中 worker 被回收，也避免它作为「不回包的接收方」干扰 `panel-ping` 广播。不缓存数据、不设定时器、不注册 `onVisited` / `onVisitRemoved`。MV3 service worker 可被随时回收，**这是设计前提**：面板页与详情页各自持有状态并直接调 `chrome.history`，不依赖 service worker 存活。
- **详情页刻意不注册 `chrome.runtime.onMessage`**：一旦响应 `panel-ping` 就会抢答单实例握手，导致点图标时 focus 到详情页而非卡片墙（§9.4）。它只**发送** `panel-ping`，并由 `panel-focus.js` 在本页完成聚焦与兜底，不经 service worker。

---

## 5. 数据模型

### 5.1 Chrome 返回的 `HistoryItem`（只读输入）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 历史项 ID |
| `url` | string | 完整 URL |
| `title` | string | 页面标题，**可能为空或含任意字符** |
| `lastVisitTime` | number | epoch 毫秒，**该 URL 最后一次**访问 |
| `visitCount` | number | 该 URL 累计访问次数 |
| `typedCount` | number | 地址栏输入次数（不使用） |

> `history.search` 对**每个 URL 只返回一条**（最后一次访问），不是访问时间线。想拿历次访问需逐 URL `getVisits`，与性能目标冲突，明确不做。

### 5.2 内部 `PageItem`

```
{ url, title, lastVisitTime, visitCount, host, regDomain }
```

### 5.3 `DomainCard`

| 字段 | 说明 |
|---|---|
| `key` | eTLD+1 字符串，或特殊桶 `'__local__'` |
| `label` | 展示名 |
| `hosts` | `Set<string>`，卡内子域集合 |
| `pages` | `PageItem[]`，按 `lastVisitTime` 降序 |
| `pageCount` | `pages.length` |
| `totalVisits` | `Σ page.visitCount` |
| `lastVisitTime` | `max(pages.lastVisitTime)` |
| `isTail` | 见 §8 |
| `isSpecial` | 是否为「本地 / 其他」桶 |

### 5.4 `PanelState`（全部在 `app.js` 模块作用域内）

```
mode: 'recent' | 'all' | 'search'
cards: Map<string, DomainCard>
query: string
generation: number           // 异步竞态版本号
allLoaded: boolean
searchCache: Map<string, PageItem[]>   // 上限 30 条 query，LRU
cardEls: Map<string, HTMLElement>     // keyed DOM 复用
confirmKey: string | null             // v1.1 正在二次确认清除的卡片 key
deleteBusy: boolean                   // v1.1 扫描/删除全局锁
deleteView: { key, phase, text, urls? } | null   // v1.1 卡内确认条状态
INLINE_LIMIT = 10                    // v1.1 常量：卡内展开上限
scopeKey: string | null              // v1.2 域名作用域；非 null 时搜索只在该域名内
scopeQuery: string                   // v1.2 作用域内的当前关键词
scopePages: PageItem[]               // v1.2 该域名 90 天全量页面（仅内存）
scopeCache: Map<string, PageItem[]>  // v1.2 上限 5 个域名，LRU
scopeLoading: boolean / scopeProgress: string / scopeGen: number
```

**生命周期**：标签页关闭即全部释放。不写 `chrome.storage`、IndexedDB、localStorage、sessionStorage，不写文件，不发网络请求。用户主动点「加载全部域名」后内存里会临时持有全量聚合结果；v1.1 的删除/详情页扫描只在操作期间临时持有 URL 清单；v1.2 的 `scopeCache` 在**用户主动锁定域名后**才持有该域名的全量页面，上限 5 个域名。三者都是显式用户行为触发的临时内存数据，**不持久化、不上传**，且全局搜索路径不依赖其中任何一个。

---

## 6. 数据层：三条只读通道 + 一条写通道（`history.js`）

### 6.1 通用约定：必须显式覆盖的两个默认值

```
chrome.history.search({ text, startTime, endTime, maxResults })
```

| 参数 | 不传时的行为 | 本规格要求 |
|---|---|---|
| `text` | 留空检索所有页面 | 首屏 / 分段显式传 `''` |
| `startTime` | **默认最近 24 小时** | **所有调用显式传 `0`**，否则"全量"退化成"今天" |
| `maxResults` | **默认 100** | 首屏 `200`，分段 `1000`，搜索 `1000` |
| `endTime` | 不限 | 仅分段时使用 |

其他事实：无 `domain` 参数；`text` 匹配 URL 与标题、按词 AND，不支持正文、拼音、正则；返回值顺序不保证，**实现必须自行按 `lastVisitTime` 排序**。

### 6.2 通道一：首屏

```js
const items = await chrome.history.search({ text: '', startTime: 0, maxResults: 200 });
```

→ 协议过滤 → `PageItem[]` → `domain.js` 聚合 → 主墙排序 → 渲染。**一次 API 调用**，`mode = 'recent'`。

### 6.3 通道二：加载全部（分段）

```
WEEK = 7 * 86400_000
HORIZON = 90 * 86400_000
SEG_CAP = 1000
cursor = Date.now()
while (cursor > Date.now() - HORIZON):
    start = max(cursor - WEEK, Date.now() - HORIZON)
    part = search({ text:'', startTime:start, endTime:cursor, maxResults:SEG_CAP })
    if (part.length >= 500):        // 见下方说明，按天再切该周
        part = 逐日查询合并(part 所在周)
    merge 到 cards（按 url 去重）
    每批让出主线程一次（await new Promise(r => requestAnimationFrame(r))），增量更新 UI
    cursor = start
```

- **段间天然不重复**：`search` 按 `lastVisitTime` 为每个 URL 返回一条，时间窗口互不重叠；相邻段共用边界，按 `url` 去重兜底。
- **细分阈值取 500 而非 1000**：Chrome 文档未明示 `maxResults` 的硬上限，若内部 clamp 到更小值，"等于 1000 才细分"会永远不触发、静默丢数据。用 500 作保守触发条件，无论上限多少都安全。
- 约 13 段，进度可见（"已加载 N / 13 周"），用户可中途取消（`generation` 自增作废后续结果）。
- 完成后 `mode = 'all'`，`allLoaded = true`，按钮变为「已加载全部」。

### 6.4 通道三：搜索

```js
const gen = ++state.generation;
const raw = await chrome.history.search({ text: query, startTime: 0, maxResults: 1000 });
if (gen !== state.generation) return;   // 过期结果直接丢弃
```

- **触发条件**：`debounce 200ms` + `query.trim().length >= 2` + 相同 query 命中 `searchCache` 则零调用。
- **降级召回**：若 `raw.length < 3` 且 query 含空格，拆词取前 3 个并发各查一次，按 `url` 合并去重（至多 4 次调用）。
- **搜索不预加载全量**：无论 `mode` 是 `recent` 还是 `all`，搜索始终独立走原生索引，不留内存副本。

### 6.5 前端精排（`search.js`）

Chrome 原生 `text` 已按词 AND 完成召回，**前端不再做硬性 AND 过滤**——中文/分词差异下硬过滤会误杀本已找到的结果。改为加权排序：

```
score = 域名命中       100
      + 全部词命中      60
      + 标题命中        40
      + 路径命中        10
      + 时间新鲜度     0~20（越近越高）
```

同分按 `lastVisitTime` 降序。命中词在标题 / URL 中包 `<mark>` 高亮（先转义再拼接，见 §10）。

> 这是决策 6「多词 AND」的工程细化：AND 由原生查询承担，前端承担排序与高亮。理由记录在此，避免实现时被当成漏做。

### 6.6 缓存与失效

- `searchCache` 仅内存，`Map` 上限 30 条 query，超出删最早一条。
- 面板页不监听 `chrome.history.onVisited` / `onVisitRemoved`；切回标签页时若距上次加载 > 60 秒，重新跑通道一刷新首屏（唯一的一致性补偿，不引入常驻监听）。
- **删除后必须 `searchCache.clear()`**：否则再次搜索同一关键词会命中旧缓存，已删页面会"复活"到卡片墙上。删除期间同时禁止 `loadAll` 启动、暂停 `visibilitychange` 刷新。

### 6.7 写通道：按域名清除（`history.js`，v1.1）

**API 约束**：`chrome.history` 没有按域名删除的能力。

| API | 为何不用 |
|---|---|
| `deleteRange({ startTime, endTime })` | 按时间段删，会误伤同时间访问的其它域名 |
| `deleteAll()` | 全清，远超用户意图 |
| `deleteUrl({ url })` | **唯一可用**：删该 URL 的全部访问记录，幂等 |

因此必须"先枚举该域名下全部 URL，再逐条 `deleteUrl`"。枚举**不能**用 `history.search({ text: 域名 })`：`text` 是全文词匹配，既可能漏召（分词差异 / `maxResults` 截断），又可能误命中 URL 里含该域名的其它站点（如 `https://other.com/?ref=google.com`）；删除场景不容许这两种误差。

**统一口径**：`scanHistory(match, onProgress, isCancelled)` 复用 §6.3 的 `iterateAll`（按周分段 + 满 500 按天细分），对每条 `HistoryItem` 调 `domain.js` 的 `matchesDomain` / `belongsToDomain` 做本地精确判定——与 `aggregate` 用的是同一个 `normalizeItem` / `getRegDomain`，保证「卡片显示的页面」「详情页列出的页面」「被删的页面」三者完全一致。结果按 `url` 去重，保留 Chrome 原始 `item.url`（`deleteUrl` 必须传原样值，不能用 `new URL().href` 的归一化形式）。

**两阶段，顺序不可调换**：

```
阶段一  scanHistory(...)       // 只读，跑完 13 段，得到完整 urls[] 与累计访问次数
        ↓ 用户看到准确数量与范围，二次确认
阶段二  deleteUrls(urls, ...)  // 每批 10 条并发 deleteUrl，进度可见
        ↓ 同步内存视图、清空 searchCache、移除该卡 DOM、重渲染
```

> **绝不能边查边删**：删除会改变 `lastVisitTime`，使按时间分段的游标失效，导致静默漏删。这是本通道最容易写错的地方，验收 18 专门验证「所有 `search` 调用都早于首次 `deleteUrl`」。

- `deleteUrls` 返回 `{ deletedUrls, deleted, failed, attempted, cancelled }`；失败的 URL 不进入 `deletedUrls`，UI 按 `regDomain` 兜底清理已加载视图，并向用户显示失败数。
- 取消只在**当前批次结束后**生效，不会半批中断；取消或用户在别处发起新操作（`confirmKey` 变化）都会中止扫描。
- 「本地 / 其他」桶（`__local__`）混杂 `chrome://` / `file://` / localhost / 内网主机，删除语义不清，**不提供清除入口**，`matchesDomain` 对它恒返回 `false`；详情页的 `belongsToDomain` 则允许它（只读列举无风险）。

### 6.8 域内搜索通道（`search.js` + `scope-view.js`，v1.2）

**与全局搜索是两条不同路径，不要混用**：

| | 全局搜索（§6.4 / §6.5） | 域内搜索（本节） |
|---|---|---|
| 候选来源 | `history.search({ text })` 原生召回 | `scanHistory(belongsToDomain)` 全量枚举该域名 |
| 完整性 | 受 `maxResults=1000` 截断、原生分词影响 | 90 天内该域名全部 URL，按 `url` 去重 |
| 过滤 | **软排序**（硬过滤会误杀中文/分词差异） | **硬过滤**（多词 AND、子串匹配，数据集完整可靠） |
| 每次输入 | 1 次 `history.search`（缓存命中 0 次） | **0 次 API 调用**，纯内存 |
| 内存 | 不留全量副本 | 每域名一份 `PageItem[]`，`scopeCache` 上限 5 |

> 这是对决策 2「不为搜索建内存全量副本」的**有界例外**：全局搜索仍严格下推原生索引、不建副本；只有用户主动锁定某个域名后，才为**那一个域名**建一份临时缓存（通常几十到几百条），标签页关闭即释放。它等价于「加载全部域名」的子集，不是全量索引。

**取数（渐进两步，秒出 + 补全）**：

```
进入作用域：
  1) scopeCache 命中 → 直接用缓存，零查询
  2) 未命中 → 先用 basePages 里该域名的页面立即渲染（可能只是一部分）
              同时后台跑 scanHistory(...) 按 13 周分段补全，进度可见
              完成后写入 scopeCache（上限 5，LRU）
```

`scanHistory` 与 §6.7 的删除、§9.8 的详情页共用**同一个** `belongsToDomain` / `getRegDomain` 口径，因此「卡片显示的页面」「域内搜索的空间」「详情页列出的页面」「被删的页面」四者完全一致，且都包含该 eTLD+1 的所有子域。

**匹配（`filterInScope(pages, query)`，纯函数）**：

- 空 query → 返回按 `lastVisitTime` 降序的全部页面（即该域名完整列表）。
- 非空 → `splitWords` 拆词（小写、至多 6 词），要求**每个词**都出现在 `title + url + path` 的拼接串里（AND）；命中后按「标题命中 40 / URL 命中 10 / 整串命中 20」加权，同分按最近访问排序。
- 不调 `chrome.*`，不修改入参数组，空/非法输入返回空数组。
- 高亮复用 `highlight()`（先转义再包 `<mark>`），标题与 URL 都经过它，不引入可执行标签。

**渲染（`scope-view.js`）**：主面板作用域视图与详情页共用 `renderRows(container, pages, words, isCancelled)`，每批 50 行 append、批间 `requestAnimationFrame`，`isCancelled` 由调用方的 `renderGen` 驱动。

---

## 7. 域名归组（`domain.js` + `psl-data.js`）

### 7.1 算法

```
getRegDomain(hostname):
  labels = hostname.toLowerCase().split('.')
  if labels.length == 1:  return hostname          // 内网主机名，如 uih-office
  从右往左找 PSL 表中最长匹配的后缀（label 数 k）
  若未命中: k = 1                                // 兜底：取最后两段
  return labels.slice(-(k + 1)).join('.')
```

`psl-data.js` 导出一个静态字符串数组（public suffix，不含前导点），运行时 `new Set()` 一次，查表 O(1)。内容范围：

- 常见单段后缀：`com` `net` `org` `io` `dev` `ai` `cn` `uk` `jp` `hk` `tw` …
- 常见二段后缀：`com.cn` `net.cn` `org.cn` `gov.cn` `edu.cn` `co.uk` `org.uk` `co.jp` `ne.jp` `com.hk` `com.tw` `com.au` `co.kr` …
- PRIVATE 段常见托管域：`github.io` `gitlab.io` `pages.dev` `vercel.app` `netlify.app` `herokuapp.com` `appspot.com` `cloudfront.net` `s3.amazonaws.com` `workers.dev` …

**不联网、不运行时解析 PSL 原始文件、不引第三方包**；表可在实现时从 publicsuffix.org 裁剪一次后固化，之后不自动更新。

### 7.2 判定示例

| URL host | 最长匹配后缀 | `regDomain` / 卡片 key |
|---|---|---|
| `mail.google.com` | `com` | `google.com` |
| `docs.google.com` | `com` | `google.com`（与上同一张卡） |
| `a.b.com.cn` | `com.cn` | `b.com.cn` |
| `foo.github.io` | `github.io` | `foo.github.io`（独立成卡） |
| `bar.github.io` | `github.io` | `bar.github.io`（不与 foo 合并） |
| `uih-office` | 无点 | `uih-office`（正常域名） |

### 7.3 特殊 URL

| 形态 | 处理 |
|---|---|
| `http:` / `https:` | 正常归组 |
| `chrome://` `edge://` `about:` `chrome-extension://` `file://` `data:` | 归入 `'__local__'` 桶，标签「本地 / 其他」，排最后且默认折叠；桶为空则不渲染 |
| 纯 IPv4 / IPv6 / `localhost` | 归入 `'__local__'` 桶 |
| IDN punycode `xn--` | 保留 punycode 作 key（MVP 不做展示层解码） |

---

## 8. 卡片模型、热度与长尾

```
card.totalVisits   = Σ page.visitCount
card.pageCount     = pages.length
card.lastVisitTime = max(pages.lastVisitTime)
card.isTail        = (card.totalVisits <= 1)
                     && (Date.now() - card.lastVisitTime > 7 * 86400_000)
```

- **主墙排序**：`lastVisitTime` 降序；`visitCount` 用于同域内页面排序与 `isTail` 判定。
- **长尾折叠**：`isTail` 的卡进「其它 N 个域名」，折叠区展开前**不创建 DOM**；展开后内部同样按时间排序。
- 用 AND 而非 OR：避免把"常去但一个月没打开"的老站也折叠掉，那类恰恰是要找回的目标。这是对决策 4「一次性 / 很久没去」的精确固化。
- **搜索态不套用长尾折叠**：搜索是明确意图，命中即展示。
- `'__local__'` 桶永远排在最后，不参与 `isTail` 判定。

---

## 9. 渲染与交互

### 9.1 布局（`index.html` + `styles.css`）

```
┌ 搜索框（autofocus，placeholder: 搜索域名或页面标题）────────┐
├ 状态行：最近 N 个域名 · 共 M 页 · 数据来自浏览器历史 ──────┤
├ 卡片网格：repeat(auto-fill, minmax(280px, 1fr)) ───────────┤
├ 「加载全部域名」按钮（进度 / 已加载完成）──────────────────┤
└ 「其它 N 个域名」折叠区 ─────────────────────────────────┘
```

浅色主题，系统字体，无外部资源。

### 9.2 卡片

- 头部：favicon 32px、域名 label、统计行（`N 页 · M 次 · 最近 X 前`），右侧 `.card-tools` 两个淡显图标按钮：**放大镜（仅在此域名内搜索，hover 变蓝）** 与 **垃圾桶（清除，hover 变红）**；「本地 / 其他」桶两者都不显示。
- 主体：**最近 3 条页面标题**常驻，点击标题 → `chrome.tabs.create({ url })` 新标签打开，不打断当前页。
- 底部按 `pageCount` 分流（v1.1，阈值 `INLINE_LIMIT = 10`，详见 §9.8）：
  - `≤ 3`：无按钮。
  - `4 ~ 10`：`查看全部 N 页` 卡内展开；展开后列表底部另有「在新页查看该域名完整列表 ↗」（首屏 200 条可能只加载了该域名的一部分）。
  - `> 10`：`在新页查看全部 N 页 ↗` → 新标签打开 `detail.html?domain=<key>`，**卡片本身不展开**。
  - 加载全部后若 `pageCount` 从 ≤10 涨过 10，强制折叠已展开的卡，避免卡片突然被撑长。
- 标题为空时回退展示 URL 的 pathname；`title` 一律 `textContent` 写入。

### 9.3 搜索时：卡片墙原地变形

- 命中 `PageItem[]` → 重新聚合成 `DomainCard` → 就地更新/新建卡片 DOM；不匹配的已有卡加 `hidden` class（**不销毁、不整墙重建**）。
- 卡内命中词高亮；搜索态隐藏「加载全部域名」按钮与折叠区。
- 清空搜索框 → 恢复进入搜索前的 `mode` 与卡片状态，零加载。
- 顶部 `?q=` 参数：页面加载时预填搜索框并触发一次搜索（供 omnibox 使用）。

### 9.4 入口与单实例复用（关键，`sw.js` + `index.html`）

不读 `tab.url`、不声明 `tabs` 权限。改用扩展上下文之间的握手，面板页自己"报到"：

```js
// sw.js
async function openOrFocusPanel(q) {
  try {
    const pong = await Promise.race([
      chrome.runtime.sendMessage({ type: 'panel-ping' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 300))
    ]);
    if (pong?.tabId) {
      await chrome.tabs.update(pong.tabId, { active: true });
      if (pong.windowId) await chrome.windows.update(pong.windowId, { focused: true }).catch(() => {});
      if (q) chrome.runtime.sendMessage({ type: 'panel-query', q });
      return;
    }
  } catch { /* 面板未打开或超时，走新建 */ }
  const url = chrome.runtime.getURL('index.html') + (q ? '?q=' + encodeURIComponent(q) : '');
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => openOrFocusPanel());
chrome.omnibox.onInputEntered.addListener((text) => openOrFocusPanel(text.trim()));
```

```js
// index.html 的模块脚本（v1.2.1：缓存自身 tabId，优先同步回包）
let selfTab = null;
chrome.tabs.getCurrent().then((tab) => { selfTab = tab; }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'panel-ping') {
    if (selfTab?.id != null) {
      sendResponse({ tabId: selfTab.id, windowId: selfTab.windowId });
      return;                          // 同步响应，避免广播中其它端口提前终结 Promise
    }
    chrome.tabs.getCurrent().then((tab) =>
      sendResponse({ tabId: tab?.id, windowId: tab?.windowId })).catch(() => sendResponse({}));
    return true;                       // 异步兜底
  }
  if (msg?.type === 'panel-query') { setSearchInput(msg.q); }
});
```

- `chrome.tabs.getCurrent()` 在扩展标签页可用，返回的 `id` / `windowId` 不是敏感字段，不需要 `tabs` 权限。
- `tabs.create` / `tabs.update` / `windows.update` 均不需要权限；超时 300ms 保证面板卡住时图标点击不会无响应。
- service worker 不保存任何 tabId，被回收后逻辑依然正确。
- **详情页绝不响应 `panel-ping`**（v1.1）：`runtime.sendMessage` 是广播，详情页一旦抢答，点图标就会 focus 到详情页而不是卡片墙。因此 `detail.js` 完全不注册 `onMessage` 监听器。
- **v1.2.1 返回链路修复**：原实现让详情页发 `focus-panel`、由 `sw.js` 的 `onMessage` 监听器执行异步聚焦。但监听器既不 `sendResponse` 也不 `return true`，MV3 worker 可能在 `panel-ping` / `tabs.update` 途中被回收，而详情页没有任何兜底 → 点击「什么都没发生」。现改为 `detail.js` 直接调用 `panel-focus.js` 的 `focusPanel()`：发 `panel-ping` → `tabs.update` + `windows.update` 聚焦；**任何一步失联都必定 `tabs.create` 新开面板**。`sw.js` 不再注册 `onMessage`（不再是广播接收方），也就不存在被提前回收的中间人。详见 §9.8。

### 9.5 快捷键与地址栏

- `Alt+H`：`commands._execute_action` 触发 action，等价于点图标。
- 地址栏 `h 关键词`：`omnibox.keyword = 'h'`，`onInputEntered` 走 §9.4；面板已开则 `panel-query` 填入搜索框，未开则带 `?q=` 新建。
- 两者都是加法，不改变主入口。

### 9.6 favicon

```js
function faviconURL(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
}
```

`pageUrl` 传该卡任一页面的完整 URL（取最近一条）。浏览器缓存层供图，扩展自己不抓、不存。取不到图时显示域名首字母占位块（纯 CSS，无网络请求）。

### 9.7 渲染约束

- **keyed DOM 复用**：`Map<key, HTMLElement>`，只在文本变化时更新节点；新增/隐藏用 class 切换。
- **事件委托**：网格容器上只绑一个 `click` 监听，用 `data-action` / `data-url` 分发，卡片增删不重绑事件。
- **分批渲染**：每批 30 张卡，批间 `requestAnimationFrame` 让出主线程；长尾区与卡内展开同样按需创建。
- **竞态**：任何异步返回先比对 `state.generation`，过期即丢弃，避免快速输入时旧结果覆盖新结果；删除/详情页的扫描另用 `renderGen` 独立作废过期渲染。

### 9.8 清除域名记录与详情页（v1.1）

**清除流程（两步确认，卡内完成，不弹窗、不遮挡）**

| 阶段 | 界面 | 可取消 |
|---|---|---|
| 点右上角清除 | 卡内浅色进度条「正在统计 X… N/13 周，已找到 M 个页面」 | 是 |
| 统计完成 | 卡内红底确认条：「将永久删除 `X` **及其所有子域** 的 N 个页面（累计 M 次访问）。此操作不可撤销。」+ [取消] [确认删除] | 是 |
| 确认 | 「正在删除 X 的 n/N 个页面（f 个失败）…」 | 是（下批生效） |
| 完成 | 卡片消失，底部状态行显示「已清除 X 的 N 个页面」；搜索态强制重跑当前 query | — |

- 统计阶段是**纯只读**：即使取消也没有任何副作用。只有第二次点击「确认删除」才写历史。
- 全局锁 `deleteBusy`：同一时刻只允许一个扫描/删除流程；期间禁用「加载全部域名」与其它卡片的清除按钮。
- 删除完成后的同步：从 `basePages` 移除命中 URL（并按 `regDomain` 兜底清理，兼容 `u.href` 与原始 `item.url` 的形式差异）→ 重建 `baseCards` → `searchCache.clear()` → 从两个 `elsMap` 与 DOM 中移除该卡 → `render()`。
- 扫描结果为 0 时显示「没有找到可删除的历史记录」，3 秒后自动收起。

**详情页（`detail.html` + `detail.js`）**

- 触发：卡片 `pageCount > 10` 时点「在新页查看全部 N 页」、卡内展开后点「在新页查看该域名完整列表」，或作用域视图点「在新页打开 ↗」（后两者可带 `?q=` 预填关键词）。
- 取数：调 `scanHistory((item) => belongsToDomain(item, key), ...)` 做 90 天全量枚举，与主面板清除、作用域搜索同一口径；顶部显示 `N/13 周` 进度。
- 展示：全宽列表，每行「标题 + 完整 URL + 访问次数 + 相对时间」，按 `lastVisitTime` 降序；每批 50 行 append、批间 `requestAnimationFrame`。过滤框走 §6.8 的 `filterInScope`（多词 AND + 加权排序 + 命中高亮），120ms 防抖，**零额外历史查询**，与主面板作用域视图完全同构（共用 `scope-view.js`）。
- `domain` 参数校验：`^[a-z0-9.-]+$`、长度 ≤ 253、不等于 `__local__`；无效则显示错误且不做任何查询。所有文本经 `highlight()`（先转义）或 `textContent` 写入，点链接前协议白名单校验。
- 「← 返回卡片墙」（**v1.2.1 修复**）：调用本页 `panel-focus.js` 的 `focusPanel()` —— 发 `panel-ping` 拿到主面板上报的 tabId → `tabs.update(active)` + `windows.update(focused)`；**超时 / 无响应 / tab 已关闭，任一情况都兜底 `tabs.create` 新开面板**，点击必有可见结果。按钮期间禁用并短暂显示「正在返回…」/「已新开卡片墙」/「返回失败，请点工具栏图标」。全程**不经 service worker**，不受 MV3 worker 回收影响；`focusPanel(api, timeoutMs)` 可注入假 chrome 对象单测。
- **详情页不放清除按钮**：避免两个标签页各自持有待删清单、产生状态不一致。清除入口唯一，在主卡片上。

### 9.9 域名作用域：选一个域名，只搜它（v1.2）

**入口**：点卡片头部放大镜图标（`data-action="scope-enter"`）。「本地 / 其他」桶不显示该入口。

**进入后界面**：

```
┌ 搜索框（placeholder 变为「在 google.com 内搜索标题或网址」）────────┐
├ [仅在 google.com 内搜索 ×]  含所有子域 · 按 Esc 或点 × 恢复全局搜索 ─┤
│                                              [在新页打开 ↗]          │
├ 状态行：仅搜索 google.com · 命中 N / M 个页面 · 累计 X 次访问 ──────┤
└ 全宽结果列表（标题 + URL + 次数 + 时间，命中词高亮）──────────────┘
```

- 卡片墙、长尾折叠区、「加载全部域名」按钮一并隐藏；结果用全宽列表铺开，**不把长列表塞回卡片**（与 §9.2 的 10 页限制同理）。
- 进入时若搜索框已有文字，直接作为域内首查，不用重打。
- **渐进加载**：先用已加载数据立即出结果，同时后台按 13 周补全，状态行显示「正在补全… N/13 周」；补全后自动刷新。缓存命中则完全零查询、秒开。
- 输入即搜：120ms 防抖、**无 ≥2 字符门槛**（纯内存过滤，单字也有意义）；每次输入 **0 次 `history` 调用**。空输入展示该域名全部页面。
- 结果行点击 → 协议白名单校验后新标签打开；高亮与排序见 §6.8。

**退出**：点 chip 的 `×`、按 `Esc`，或从 omnibox 发来全局查询。退出时 `scopeGen += 1` 作废在途扫描，**保留搜索框里的词并自动重新发起一次全局搜索**（≥2 字符时），语义是"去掉域名限定"而非"取消搜索"。

**与其他流程的互斥**（避免状态打架）：

| 流程 | 作用域激活时 |
|---|---|
| 加载全部域名 | 按钮隐藏，`loadAll()` 直接 return |
| 切回标签页刷新首屏 | 跳过，不 merge `firstScreen()` |
| omnibox `h 关键词` | 先 `exitScope()` 再全局搜 |
| 清除某域名 | 删除完成后 `scopeCache.delete(key)`；若作用域正指向被删域名则直接退出 |
| 详情页 | 不注册 `onMessage`，只发 `panel-ping` 并自行聚焦（§9.4 / §9.8） |

- 「在新页打开 ↗」把当前作用域域名与关键词一起带到 `detail.html?domain=…&q=…`，便于把结果留在独立标签页对照。

---

## 10. 安全与隐私约束（硬性）

1. 所有来自历史的 `title` / `url` 插入 DOM 必须用 `textContent` 或先 `escapeHtml`；只有高亮拼接允许 `innerHTML`，且顺序必须是"先转义 → 再包 `<mark>`"。
2. 点击打开链接前用 `new URL()` 校验协议，仅允许 `http:` / `https:`；其余忽略，不给 `data:` / `javascript:` 任何执行机会。
3. **零网络请求**：不使用 `fetch` / `XMLHttpRequest` / WebSocket / 外部字体 / CDN；MV3 CSP 也会拦截远程脚本，代码不依赖任何例外。
4. **零持久化**：不调用 `chrome.storage`、IndexedDB、localStorage、File System；不写任何文件。
5. 不声明 `tabs`、`<all_urls>`、content script、webRequest；不读取当前活动标签的 URL 或标题。
6. 不做隐私过滤是用户明确决定：规格中不实现排除列表、不做自动隐藏，也不在 UI 上声称"已保护隐私"。
7. **删除是本扩展唯一的写操作，必须受控**（v1.1）：只能由用户点「确认删除」触发；确认前必须先完成只读全量统计，并展示准确数量、域名、子域范围与"不可撤销"。**禁止**在首屏、搜索、切回标签页、详情页加载等任何自动流程中调用 `deleteUrl`。
8. 删除与详情页的匹配一律走 `domain.js` 的 `belongsToDomain` / `matchesDomain`，**禁止把 `history.search({ text: 域名 })` 的结果直接拿来删**（会误删 URL 中含该域名的其它站点）。「本地 / 其他」桶不可删除。
9. **域内搜索是纯只读**（v1.2）：`filterInScope` 不得调用任何 `chrome.*`；`scopeCache` 只在内存中、上限 5 个域名、不持久化，不得借这条通道把"全量历史"搬进内存。作用域与删除共用枚举口径，但**作用域视图绝不触发 `deleteUrl`**。

---

## 11. 性能预算与验收

| 指标 | 目标 | 验证方式 |
|---|---|---|
| 首屏可见 | < 300 ms | `performance.mark` 打点 |
| 首屏 history 调用 | 恰好 1 次，`maxResults=200` | DevTools 断点计数 |
| 搜索响应 | 200 ms debounce + 原生查询，感知 < 350 ms | 手动计时 |
| 搜索 history 调用 | 每 query ≤ 1 次（降级 ≤ 4 次），缓存命中 0 次 | 计数日志 |
| 加载全部 | 分段渐进，主线程单次阻塞 < 16 ms | Performance 面板 |
| 首屏 DOM | ≤ 30 张卡；长尾展开前不建 DOM | Elements 面板 |
| 内存 | 仅"加载全部"后临时持有全量，标签页关闭即释放；搜索路径不依赖它 | 任务管理器 |
| 权限 | manifest 仅 `history` + `favicon` | `chrome://extensions` 权限列表 |
| 网络 | 面板生命周期内 0 次外部请求 | Network 面板（只看 `_favicon` 内部 URL） |
| 清除统计 | 复用 13 段分段、进度可见，**统计阶段 0 次写操作** | 调用计数：确认前 `deleteUrl` 为 0 |
| 详情页 | 每批 50 行；页内过滤 0 次额外 `history` 调用 | 调用计数 / Performance 面板 |
| 域内搜索（首次进入） | 先用已加载数据秒出，再 13 段补全，进度可见 | 首屏可见 < 100 ms，补全期间界面可交互 |
| 域内搜索（输入时） | **每次输入 0 次 `history` 调用**，120ms 防抖 | DevTools 调用计数 |
| 域内搜索（缓存命中） | 0 次 `history` 调用，直接渲染 | 调用计数 |

**功能验收清单**

1. 首次点图标打开面板；再次点击 focus 原标签，**不新开**。
2. 首屏出现域名卡片，每张显示最近 3 个可点页面标题。
3. `mail/drive/docs.google.com` 合并成一张 `google.com` 卡。
4. `foo.github.io` 与 `bar.github.io` 各自成卡。
5. 点页面标题在新标签打开正确 URL。
6. `查看全部 N 页` 展开该域名完整列表。
7. `加载全部域名` 分段加载、进度可见、中途不卡死，可取消。
8. 「其它 N 个域名」折叠区可展开，内部按时间排序。
9. 搜索 30 天前的关键词能命中（验证 `startTime: 0` 没被默认值坑掉）。
10. 清空搜索立即还原；快速连打不出现旧结果覆盖新结果。
11. 标题含 `<img onerror=...>` 的伪造历史项不触发脚本执行。
12. 无痕窗口访问过的站不出现。
13. 清空浏览器历史后刷新面板，卡片墙为空。
14. 全程无外部网络请求。
15. 卡片右上角有清除按钮；「本地 / 其他」桶没有。
16. 点清除先出现统计进度，再出现红底确认条，文案含域名、页面数、访问次数、"及其所有子域"与"不可撤销"；确认前 `deleteUrl` 调用数为 0。
17. 点「取消」不产生任何删除；再次点清除可重新开始。
18. 确认后**所有 `history.search` 调用都早于首次 `deleteUrl`**（两阶段，无静默漏删）；删除后重新扫描该域名为 0。
19. 删除完成该域名卡片立即消失；URL 里含该域名字符串的其它站仍完好。
20. 删除后重新搜索同一关键词，已删页面不"复活"（验证 `searchCache.clear()`）。
21. `pageCount > 10` 的卡片按钮为「在新页查看全部 N 页」，点击新开详情标签，卡片本身不撑长。
22. `4 ≤ pageCount ≤ 10` 仍在卡内展开，展开后有直达详情页入口；加载全部后若涨过 10 页自动强制折叠。
23. 详情页列出该域名含子域的全部页面，可页内过滤、点标题新标签打开；「返回卡片墙」focus 已开面板而非新开。
24. 详情页打开状态下点工具栏图标，仍 focus 主面板（验证详情页未抢答 `panel-ping`）。
25. 每张正常域名卡片头部有放大镜图标；「本地 / 其他」桶没有。
26. 点放大镜后出现「仅在 X 内搜索」chip，卡片墙/长尾/「加载全部域名」隐藏，改为全宽结果列表；状态行显示命中数与总数。
27. 进入时搜索框已有文字则直接作为域内首查；补全进度 `N/13 周` 可见，补全后列表自动变长。
28. 域内输入即搜：单字可用、120ms 防抖、**每敲一个字 `history` 调用数为 0**；清空输入显示该域名全部页面。
29. 多词 AND 生效（`api guide` 不命中只有单个词的页面）；中文、大小写不敏感；命中词在标题与 URL 中高亮。
30. 域内结果只含该域名及其子域，不含 URL 里含该域名的其它站点，也不含特殊 URL。
31. 点 `×` 或按 `Esc` 退出后，卡片墙恢复，**同一个词自动发起全局搜索**（不必重打）；退出会作废在途补全扫描。
32. 「在新页打开 ↗」带 `?domain=…&q=…`，详情页预填关键词且高亮一致；详情页过滤同样支持多词 AND。
33. 域内搜索全程不触发 `deleteUrl`；清除某域名后其 `scopeCache` 失效，重新进入会重新枚举。
34. **v1.2.1** 详情页点「← 返回卡片墙」切回已开的主面板（不新开标签）；按钮短暂显示「正在返回…」后恢复，Console 有 `[panel-focus] result: focused`。
35. **v1.2.1** 关掉主面板标签后仍从详情页点返回：自动新开一个卡片墙标签（不会毫无反应）。
36. **v1.2.1** `panel-ping` 由主面板同步回包；详情页打开状态下点工具栏图标仍 focus 主面板，且 `sw.js` 控制台无 `onMessage` 相关报错。

---

## 12. 实现顺序

| 里程碑 | 内容 | 完成判据 |
|---|---|---|
| **M0** | `manifest.json`、icons、`sw.js`、空 `index.html`、§9.4 握手 | 点图标能开/复用标签页；权限清单正确 |
| **M1** | `history.js` 通道一 + `domain.js` + `psl-data.js` + 首屏聚合 | 控制台能打印出正确的 `Map<regDomain, DomainCard>` |
| **M2** | 卡片渲染、最近 3 页直达、卡内展开、favicon | 验收 2/3/4/5/6 通过 |
| **M3** | `search.js`、通道三、卡片墙原地变形、缓存与竞态 | 验收 9/10 通过 |
| **M4** | 通道二分段加载、长尾折叠、`Alt+H`、omnibox `h` | 验收 1/7/8 通过 |
| **M5** | keyed DOM、分批渲染、XSS 防护、`安装说明.md`、跑完整验收清单 | §11 的 1–14 通过 |
| **M6** | v1.1 写通道：`scanHistory` / `deleteUrls` / `matchesDomain`、卡片清除按钮与两步确认、删除后状态同步 | 验收 15–20 通过 |
| **M7** | v1.1 详情页：`detail.html` / `detail.js`、10 页分流、当时的 `focus-panel`（已在 v1.2.1 由 M9 替换） | 验收 21–24 通过 |
| **M8** | v1.2 域内搜索：`filterInScope` / `scope-view.js`、主面板作用域状态机与 chip、渐进补全与缓存、详情页升级为多词搜索 | 验收 25–33 通过 |
| **M9** | v1.2.1 修复返回链路：`panel-focus.js`、详情页自执行聚焦与兜底、主面板同步回包、移除 sw.js 的 `onMessage` | 验收 34–36 通过 |

---

## 13. 已知限制（是设计取舍，不是 bug）

- 浏览器历史只保留约 90 天；清除历史后卡片墙同步变空；无痕记录不可见。
- 搜索只匹配 URL 与标题，**不含正文、不支持拼音 / 正则 / 模糊容错**。
- 大量页面标题无辨识度（"首页"、"控制台"、"Dashboard"），这是**找回率的最大风险**；在不落库、不抓正文的约束下无解，只能靠 §6.5 的加权排序缓解。
- 每个 URL 只有最后一次访问时间，没有访问时间线。
- favicon 依赖浏览器自身缓存，过期太久的站可能取不到图，回退为字母占位。
- 精简 PSL 表可能漏掉小众后缀，兜底规则（取最后两段）会把个别站点错误合并。
- 不做跨设备同步，依赖 Chrome 账号自身的历史同步。
- **v1.1 清除范围以 90 天内的全量分段枚举为准**：若 Chrome 对 `maxResults` 内部截断且恰好落在段边界，极端情况下可能漏删个别页面（与「加载全部域名」同源风险）。删除不可逆，无撤销、无回收站、无备份。
- **v1.1 不监听 `onVisitRemoved`**：在浏览器设置里手动清历史，或详情页打开期间在主面板删除，另一个标签页不会自动刷新，需切回并刷新（与 §6.6 一致）。
- 详情页只读，不提供清除入口；清除只在主卡片上，避免两个标签页各持一份待删清单。
- **v1.2 `scopeCache` 是内存快照**：锁定域名后若期间在别处新访问了该站或删除了历史，缓存不会自动更新；退出再进入同一域名仍走缓存。按 F5 刷新面板可拿到最新数据（与 §6.6 一致，不引入常驻监听）。
- 域内搜索覆盖约 90 天内可枚举的全部 URL，同样受 `maxResults` 极端截断影响；仍不搜网页正文、不支持拼音 / 正则。
- 不做隐私过滤；卡片墙比浏览器历史页醒目得多，投屏或旁人在场时需注意。
- 仅 Chromium（Chrome / Edge）MV3，不支持 Firefox / Safari。

---

## 14. 安装与本地验证

1. Chrome / Edge 打开 `chrome://extensions`，开启右上角「开发者模式」。
2. 点「加载已解压的扩展程序」，选择仓库内 `history-by-domain/` 子目录（包含 `manifest.json` 的那一层，不是仓库根）。
3. 安装时会出现 `history` 带来的"读取和更改您的浏览记录"、`favicon` 图标提示，以及 **v1.3.0 起 `bookmarks` 带来的"读取和更改您的书签"** 警告，均属预期。浏览历史确认后会被按域名删除、书签会在你逐次点击后被增删改，都没有静默写入。
4. 点工具栏图标（或 `Alt+H`）打开面板；修改代码后在扩展页点「刷新」，无需构建。
5. 按 §11 逐条验收；首轮重点验证 `startTime: 0` 与 `maxResults` 是否被正确覆盖，以及验收 16/18/24/28/31/34/35 各条（确认前置条件、两阶段顺序、详情页不抢答握手、域内输入零 API 调用、退出后自动全局搜索、返回卡片墙与关掉面板后的兜底）。**v1.3.0 另按 §16.9 的 37–48 逐条验收**。**改过 `sw.js` / `manifest.json` 后必须在扩展页点「刷新」并关掉旧详情标签重新打开**，否则旧页面仍跑旧模块；新增 `bookmarks` 权限后尤其要重新加载一次。

---

**变更规则**：本规格的任何修改都在此文件内进行并更新版本号；实现若与本文冲突，以本文为准，先讨论改规格再动代码。

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0 | 2026-11-09 | 九项设计决策固化；M0–M5 实现 |
| v1.1 | 2026-11-09 | 新增按域名清除（唯一写通道 §6.7）、超过 10 页的详情页 §9.8、安全约束 7/8、验收 15–24、M6/M7；权限清单不变 |
| v1.2 | 2026-11-09 | 新增域名作用域搜索（§6.8 / §9.9）、`scope-view.js` 共用列表渲染、详情页升级为多词搜索与高亮、安全约束 9、验收 25–33、M8；权限清单仍不变 |
| v1.2.1 | 2026-11-09 | 修复详情页「返回卡片墙」点击无反应：新增 `panel-focus.js`，聚焦逻辑移出 service worker，主面板同步回包，移除 sw.js 的 `onMessage`；验收 34–36、M9；权限清单仍不变 |
| v1.3.0 | 2026-11-17 | 新增书签 tab 与完整书签管理、顶栏分段控件、树形弹层、`bookmarks.js` 数据层、详情页 `source=bookmarks`；权限清单新增 `bookmarks`（v1.0 以来首次变化）；§16、安全约束 10–13、验收 37–48、M10 |

---

## 16. v1.3.0 书签与双 tab（本章覆盖前文同编号条目）

**优先级**：本章与前文冲突时**以本章为准**；**§16.13（用户 2026-11-17 反馈修订）优先级高于 §16.1–§16.12**。被修订的既有条目：

| 位置 | 原表述 | v1.3.0 |
|---|---|---|
| §1 非目标 1 | 不做收藏夹替代品 | **作废**；改为书签展示与完整管理。仍不做置顶、备注、标签、拖拽排序、撤销 / 回收站、导入导出 |
| §1 目标 1 | 让"打开过但没收藏"的网站能被重新找到 | 扩展为「历史与书签统一找回」 |
| 决策 1 | `chrome.history` 为唯一数据源、删除是唯一写操作 | 历史 tab 仍如此；新增书签 tab 与第二类写操作 |
| 决策 9 | 仅 `history` + `favicon` | 改为 + `bookmarks` |
| 安全约束 7 | 删除是唯一写操作 | 两类写操作；本条仍完整约束**历史删除** |
| §10.3 / §10.4 | 零网络 / 零持久化 | **不变**，书签侧同样遵守 |
| §3.3 / §14 | 权限提示两项 | 增加 `bookmarks` 警告说明 |

### 16.1 形态

顶栏 brand 右侧两个分段按钮「历史 / 书签」，不额外占纵向空间。~~两个 tab 同形~~（**已由 §16.13 修订**：历史 = 域名卡片墙，书签 = 文件夹卡片墙；顶栏 / 搜索框 / 状态行仍同形）。设计稿见 `design/mockup.html` 与 `design/shots/10-spec-and-tokens.png` 的「两 tab 控件差异对照表」。

### 16.2 权限

`manifest.json` 加 `bookmarks`，version `1.3.0`，`description` 与 `default_title` 同步。安装会多一条「读取和更改您的书签」警告；即使代码只读也必须声明该权限，无规避方案。仍不声明 `tabs` / `storage` / host 权限，不注册常驻后台监听。

### 16.3 数据层（新增 `bookmarks.js`）

- 以 `chrome.bookmarks.getTree()` 的**全量重读为唯一真值**：不缓存、不监听 `onCreated` / `onRemoved` / `onChanged` / `onMoved`、不落盘。触发点仅三处：切到书签 tab、每次写操作成功后、标签页切回可见时。
- 与历史侧「13 周分段 + `scopeCache` 内存快照」刻意不同：书签树通常几百~几千节点，一次 `getTree()` 毫秒级，全量重读天然避开两个标签页各持一份旧清单、以及浏览器书签管理器里改了面板不知道的问题。
- `BookmarkTreeNode` → `PageItem`：复用 `domain.js` 的 `normalizeItem()`（URL 解析 / eTLD+1 / 特殊 URL 归 `__local__`）；`dateAdded → lastVisitTime`，`visitCount = 0`；附加 `id` / `parentId` / `folderPath`（面包屑）/ `folderType` / `unmodifiable` / `locked`。按**节点 id** 唯一，**不按 url 去重**（同一网址可收藏在多个文件夹）。
- 卡片聚合产出与 `DomainCard` 同形，但按 id 去重、**不套用 `isTail` 长尾折叠**（`visitCount` 恒 0 会把所有老书签折没）。排序按「最近添加」；统计行写「N 个书签 · 添加于 X 前」，行内写「添加于 X 前」，**不出现「N 次访问」**。
- 文件夹节点（无 `url`）不进卡片墙；`folderPath` 由展平时的祖先文件夹名组成。
- **内置根节点判定不得硬编码 id 全锁**：Chrome 官方规定「书签栏 / 其他书签」不可重命名、移动、删除，根节点不可增删项，受管节点（`unmodifiable: "managed"`）一律不可写；`folderType: "mobile"` 的移动端书签**可被扩展修改**。判定 = `unmodifiable === 'managed'` ∨ `folderType ∈ {bookmarks-bar, other, managed}` ∨ 无 `parentId` ∨（`folderType` 缺失的老版本用 id `'1'` / `'2'` 兜底）。`ROOT_NODE_ID` 常量需 Chrome 145+，不得依赖。
- 写操作均为 Promise（MV3 / Chrome 90+），无需 callback 包装。

### 16.4 展示模型

- 书签 tab 主视图仍是**域名卡片墙**，不是文件夹树；文件夹信息降为每行书签的面包屑。
- 卡片右上角**只有放大镜**（域内搜索），历史 tab 仍是「放大镜 + 垃圾桶」。两个 tab 的写入口严格隔离。
- 写操作只在**行 hover 菜单**（改名 / 移动到… / 删除）+ 状态行右侧「+ 新建书签」「+ 新建文件夹」「文件夹」；卡片级不提供批量删除。
- 不显示「加载全部域名」（`getTree()` 已全量）；>10 条仍给「在新页查看全部 N 个书签 ↗」。
- 特殊 URL（`chrome://` / `file://` / `javascript:`）归「本地 / 其他」桶，只展示不打开（安全约束 2 不变）。

### 16.5 搜索与作用域

- 书签 tab 全程**纯内存硬过滤**（`filterInScope` 同款）：单字即搜、120ms 防抖、多词 AND、命中高亮、每次输入 0 次 API 调用；候选字段含标题 / URL / 路径 / **`folderPath`**（placeholder 写了「文件夹」就要搜得到）。
- 与历史全局搜索（≥2 字 / 200ms / 原生召回 / 软排序）的手感差异是**已接受的取舍**，记录为已知限制。
- 放大镜 → 域内作用域：chip「仅在 X 内搜索书签」+ × / Esc 退出 +「在新页打开 ↗」+ 全宽结果列表；复用 `scope-view.js` 行渲染。退出时保留词并按当前 tab 重查。
- 详情页 `detail.html?source=bookmarks&domain=…&q=…`，标题标「书签详情」，**只读、无任何写入口**（与历史详情页不放清除按钮同一理由）。

### 16.6 写操作与两步确认

- 写通道：`create`（有 url = 书签，无 url = 文件夹）、`update`（改名）、`move`、`remove`（叶子）、`removeTree`（文件夹）。
- 每次写成功后必须重读 `getTree()` 并重渲染；失败给出可见提示，不静默吞掉。
- 删除走**两步确认 + 只读统计子树**：行内先显示「将删除『X』（含 N 个子文件夹 / M 个书签），此操作不可撤销」，第二次点「确认删除」才执行；统计阶段 0 次写调用。无撤销 / 回收站 / 删除备份。
- 新建书签时 URL 须过协议白名单（http/https），拒绝 `javascript:` 等。
- 空文件夹统一收进**树形弹层**：树里可见空文件夹、可新建 / 改名 / 删除 / 移动，并兼任「移动到…」目标选择器；卡片墙只渲染有 url 的书签。操作后 toast + 弹层保持打开。

### 16.7 安全与隐私（补充 §10）

10. 零网络请求、零持久化、零常驻 change 监听三条基线在书签侧同样生效；`activeTab` 只存模块内存。
11. 书签写操作只能由用户点击触发；**禁止**在切 tab、切回可见、重读、搜索、详情页加载等自动流程中调用任何写 API。
12. 两类写操作互斥：删除统计 / 二次确认进行中禁用 tab 切换；切换 tab 作废在途扫描与搜索竞态版本、关闭树弹层。
13. 书签 `title` / `url` 插入 DOM 一律 `textContent` 或先 `escapeHtml`；仅高亮拼接允许 `innerHTML`，且顺序为「先转义 → 再包 `<mark>`」。

### 16.8 tab 状态机

- `activeTab: 'history' | 'bookmarks'`，默认 `history`，**会话内记忆**（标签页关闭即忘），不写任何存储；`?tab=bookmarks` 深链直达。
- 切换保留搜索框文字并按新数据源自动重查（对齐退出域内作用域）；单字词切回历史 tab 因 ≥2 字门槛无结果，是已知偏差。
- `Alt+H` / omnibox `h` 入口不变，作用于当前 tab；面板单实例握手与「详情页不响应 `panel-ping`」不变。

### 16.9 验收（37–48，与 §11 同口径）

37. 权限清单恰为 `history` + `favicon` + `bookmarks`，无 `storage` / `tabs` / host 权限；产物无 `fetch` / `XMLHttpRequest` / `WebSocket` / 外部资源。
38. 新开面板默认历史 tab；切到书签再切回状态保持；关标签重开回历史；`?tab=bookmarks` 直达书签。
39. 两个 tab 顶栏与卡片墙同形；历史卡右上两工具、书签卡只有放大镜；书签 tab 无「加载全部域名」、无长尾折叠。
40. 书签统计行与详情页只出现「添加于 X 前」，无「N 次访问」；排序按 `dateAdded` 降序。
41. 同一 URL 收藏在两个文件夹时，卡片墙保留两条（按 id 不去重）。
42. 全局搜索：单字即搜、120ms、多次输入 0 次 `chrome.bookmarks.search` 调用；多词 AND、中文、命中高亮；能搜到 `folderPath` 里的文件夹名。
43. 域内作用域：chip / × / Esc / 新页打开齐全；详情页带 `source=bookmarks` 且无写入口。
44. 空文件夹在树弹层可见，可新建并 toast；「书签栏 / 其他书签」三操作置灰，移动端书签可操作。
45. 删除：确认前 0 次写 API；文案含子文件夹数 / 书签数 /「不可撤销」；确认后 `getTree()` 重读，卡片与树同步。
46. 重命名 / 移动 / 新建后重读生效；在浏览器自带书签管理器里改动，切回面板可见（重读为真值）。
47. 删除统计或二次确认期间 tab 切换被禁用；切换会作废在途异步并关弹层。
48. `javascript:` 书签只展示不打开；点击链接仍只放行 http/https。

### 16.10 实现顺序 M10

`M10-a` `manifest.json`（权限 / 版本 / 文案）→ `M10-b` `bookmarks.js`（数据层，纯逻辑可独立验证）→ `M10-c` `index.html` + `styles.css`（分段控件 / 行菜单 / 面包屑 / 树弹层）→ `M10-d` `app.js`（activeTab 状态机、书签视图、搜索、写操作、两步确认、互斥）→ `M10-e` `detail.html` / `detail.js`（`source=bookmarks` 只读）→ `M10-f` 文档同步（`安装说明.md` / 根 `README.md`）→ `M10-g` 按 37–48 验收。

### 16.11 已知限制与非目标

- 书签数据不缓存、不监听变更：别处改动需切回面板 / 重进 tab 才可见（重读兜底），不保证实时。
- 两个 tab 搜索手感不一致（见 16.5），是刻意取舍。
- **不做**：跨源合并 /「已收藏」标记、拖拽排序、撤销 / 回收站、书签导入导出、深色主题、详情页写入口、`tabs` / `storage` 新权限。
- `bookmarks` 权限警告文案带「更改」，即使只用读能力也会出现。

### 16.12 视觉偏好：圆角（用户 2026-11-17 追加，优先级高于设计稿早期版本）

- **普通矩形圆角统一 3–4px**：卡片、画板、弹层 / 浮层、输入框、普通按钮、确认条、列表容器、空态框、toast、favicon 底、品牌方块等一律不超过 4px，极小元素可 3px。
- **圆形按钮不动**：`border-radius: 50%` 的真圆形按钮（如作用域 chip 上的 ×）与 `999px` 胶囊控件（pill 标签、胶囊分段控件）保持原样。
- `styles.css` 与 `design/mockup.html` 必须同步：设计稿变量改为 `--r-xs:3px` / `--r-sm|md|lg:4px` / `--r-pill:999px`，所有显式 5–20px 圆角改成 4px，并重新生成截图。
- 只改圆角，不改布局尺寸、间距与阴影。

### 16.13 修订：书签 tab 改为「按文件夹排列」（用户 2026-11-17 反馈，优先级最高）

> 用户看到 v1.3.0 实现后反馈：**「没按照书签文件夹排列吗，看着是按域名排的，那样我不太方便找内容」**。
> 本章覆盖 §16.1 / §16.3 / §16.4 / §16.5 / §16.9 / §16.11 中与下文冲突的条目，也覆盖早期设计稿 s02/s06/s07/s08/s09/s10 的对应表述。**§16.13 优先级高于 §16.1–§16.12**。

**根因**：v1.3.0 为追求「两个 tab 同形」，把书签也按 `regDomain` 聚合成卡片，与用户「按自己整理的文件夹找内容」的心智相反。历史 tab 仍按域名聚合（零回归），**两个 tab 不再同形**。

#### 16.13.1 展示模型：文件夹卡片墙

- **一张卡片 = 一个书签文件夹**。遍历 `readAll()` 展平后的全部文件夹节点，排除虚拟根节点 `id '0'`；卡片按 **Chrome 书签树前序顺序**（即用户在书签管理器里自己排的顺序）排列，**不再按 `dateAdded` 降序**。
- 卡片头：文件夹图标 + 文件夹名 + **完整路径面包屑**（`[...folderPath, title].join(' / ')`）+「N 个书签 · M 个子文件夹」；右上角保留放大镜（进入该文件夹作用域），并提供**文件夹级操作**：改名 / + 子文件夹 / 删除，复用树弹层同款两步确认；内置锁定节点（书签栏 / 其他书签）的改名与删除置灰，+ 子文件夹仍可用。
- 卡片内**只放该文件夹直属书签**（`parentId === folder.id`），不递归子文件夹；默认预览 3 条，可展开到 10 条，`> 10` 条给「在新页查看全部 N 个书签 ↗」。行级 hover 菜单（改名 / 移动到… / 删除）与两步确认**完全不变**。
- 行内第二行由「文件夹面包屑」改为**显示域名**（`host` / `regDomain`）：文件夹信息已在卡片头，避免重复；特殊 URL 显示「本地 / 其他」。
- **书签标题可读优先**（用户 2026-11-17 二次反馈）：行级 hover 菜单必须做成**浮层**（`position: absolute` + 默认 `pointer-events: none`），不得在 flex 布局里占位挤压标题；标题允许**两行**展示（`-webkit-line-clamp: 2`）后才省略；链接 `title` 属性同时给出**完整标题与网址**。实测标题可用宽度应 ≥ 行链接宽度的 60%。历史 tab 行结构不变。
- **写操作按钮图标化**（用户 2026-11-17 三次反馈「太占位置」）：行级三按钮（改名 / 移动到… / 删除）与卡片头三按钮（改名 / 新建子文件夹 / 删除文件夹）一律用**纯 SVG 图标**（`.bm-op--icon`，24×24、3px 圆角），不显示文字；语义由 `title` + `aria-label` 承担，危险操作保留红色 hover。禁用态只留 `disabled`（`title` 由图标按钮统一给，不重复）。设计稿 s03 放大图同步。`data-action` / `data-id` / `data-fid` 契约不变，e2e 靠属性定位故不受影响。
- **卡片头工具组右上角成组**（用户 2026-11-17 四、五次反馈「为什么不放这里」「默认就一个搜索框，中不中边不边」）：卡片头工具**不得拆成两组**——放大镜与三个管理图标（改名 / 新建子文件夹 / 删除）必须同处 `.card-head > .card-tools` 一行、右对齐成组；禁止把管理图标放到面包屑下方单独占一行。三条定位原则：
  1. **默认常显**：四枚图标一律 `opacity: 1`，**禁止 hover 才出现**。此前 `opacity: 0` 导致默认只剩一个半透明放大镜、右侧空出约 78px，正是用户所说「中不中、边不边」的根因；hover 只用于**提亮 / 着色**，不用于显隐。
  2. **贴右上角、顶部对齐**：`.card-tools { align-self: flex-start }` + `margin-top: 4px`，与 32px 文件夹图标同一水平带，不再垂直居中于两行文字之间悬空；工具组距卡片右边缘 ≤ 24px。
  3. **1 + 3 语义分组**：放大镜（只读查看）与三个写操作之间用 1px 竖线 + 6px 间距分开，危险项「删除」固定最右并用淡红区分；三层反馈为「默认中灰常显 → hover 卡片整体提亮 → hover 单按钮着色」。默认图标无边框无底色，避免常显后卡片显杂；禁用态 `opacity: 0.3`。
  面包屑 `.bm-card-path` 紧跟卡片头，其下无独立 ops 行。`data-action` 契约不变；e2e 须断言默认透明度、贴顶、分组线与标题区宽度。设计稿所有画板同步（不再有 `#s02` 强制展开特例）。
- 卡片底部列出**直接子文件夹入口 chips**（名称 + 递归书签数），点击进入该子文件夹的作用域视图，实现逐层下钻。
- **空文件夹显示为空卡片**（修订决策 B3 的「空文件夹统一收进树弹层」）：卡片给「此文件夹暂无书签」提示与 + 子文件夹入口；树弹层仍可见空文件夹。理由：按文件夹找内容时，看不见的空文件夹等于不存在。
- 找不到归属文件夹的书签（理论上不存在，防御性处理）归入虚拟卡片「未分类」。
- **不再有「本地 / 其他」域名桶**：`chrome://` / `file://` / `javascript:` 等特殊协议书签留在**其所属文件夹卡片**里，只展示不打开（安全约束 2 / 协议白名单不变）。

#### 16.13.2 作用域与详情页

- 放大镜语义由「域内搜索」改为「**文件夹内搜索**」：`scopeKey` 存 **folderId**，候选 = 该文件夹**及其所有子文件夹**的书签（`subtreePages()` 递归），chip「仅在文件夹『X』内搜索书签」+「含所有子文件夹 · 按 Esc 或点 × 恢复」+「在新页打开 ↗」，全宽结果列表行内显示完整文件夹路径。
- 详情页 `detail.html?source=bookmarks&folder=<folderId>&q=…`：标题为文件夹完整路径，列表为**该文件夹及所有子文件夹**的书签，**只读、零写入口**；`source=bookmarks&domain=…` 兼容分支保留（不回归验收 43）。
- 切 tab / 退出作用域 / Esc 的既有行为不变。

#### 16.13.3 搜索

- 仍是 `filterBookmarks()` **纯内存硬过滤**：单字即搜、120ms、多词 AND、命中高亮、零 API 调用；hay 仍含 `folderPath`，所以**搜文件夹名能带出该文件夹下的书签**。
- 搜索结果**仍按文件夹分组**成卡片（不退化成域名卡片），卡片内只显示命中的直属书签；卡片顺序仍是树前序。
- 状态行「命中 N / M 个书签 · 搜索范围：浏览器全部书签」不变；默认态改「共 N 个文件夹 · M 个书签 · 按书签文件夹排列」。

#### 16.13.4 不变项

全量重读为真值 / 不缓存 / 不监听 change 事件；权限清单；写操作只能由用户点击触发；`title` / `url` 一律转义后才进 DOM；两步确认 + 只读统计子树；树弹层与内置节点锁定口径；历史 tab 全部逻辑与验收 1–36 **零回归**；圆角 3–4px 偏好（§16.12）。

#### 16.13.5 验收增补（49–56，与 §16.9 同口径；37–48 中与本章冲突者以本章为准）

49. 书签 tab 首屏卡片标题是**文件夹名**而非域名，卡片顺序与 Chrome 书签树一致（非按时间倒序）。
50. 卡片内只有该文件夹**直属**书签；子文件夹的书签不混入父卡片；子文件夹 chips 可点并进入对应作用域。
51. 空文件夹有可见卡片与提示；树弹层同样可见；内置锁定节点的改名 / 删除置灰但可 + 子文件夹。
52. 全局搜索结果仍按文件夹分组，只显示命中行；搜文件夹名可命中其下书签；0 次 `chrome.bookmarks.search` 调用。
53. 文件夹作用域：chip 文案含文件夹名与「含所有子文件夹」，候选含所有后代书签，行内显示完整路径；× / Esc / 新页打开齐全。
54. `source=bookmarks&folder=<id>` 详情页标题为文件夹路径、含子文件夹书签、零写入口；`domain=` 兼容分支仍可用。
55. 特殊协议书签留在所属文件夹卡片内，只展示不打开；点击链接仍只放行 http/https。
56. 历史 tab 验收 1–36 零回归；权限恰为 `history` + `favicon` + `bookmarks`；零网络、零持久化、零常驻监听。
57. 书签行标题优先显示：行级菜单为浮层不占位（默认不可点）、标题两行 clamp、`title` 提示含标题与网址；标题可用宽度 ≥ 行链接宽度 60%。
58. 写操作按钮为纯图标（行级 3 个 + 卡片头 3 个）：按钮内无文字、有 svg、`title` / `aria-label` 齐全、宽高 24px；内置锁定节点的图标仍禁用。
59. 卡片头工具组：放大镜 + 改名 + 新建子文件夹 + 删除四枚图标同处 `.card-head > .card-tools` 一行右对齐；**默认（未 hover）四枚全部可见**（容器与放大镜 `opacity: 1`）、贴右上角顶部对齐、1+3 分组线为 1px、距右边缘 < 24px；面包屑下方无独立 ops 行；标题区宽度不被工具组挤压（实测 ≥ 120px）；设计稿全部画板同步且无强制展开特例。

---

## 17. v1.4.0 标签页管理（本章覆盖前文同编号条目）

**优先级**：本章与前文冲突时**以本章为准**。用户 2026-11-18 确认，参考 `zarazhangrui/tab-out`（Tab Out，MIT）的「分组卡片 + 两级关闭 + 点击跳转」骨架，但**不采纳**其新标签页接管、`storage`、常驻监听与音效彩带——用户实测反馈「接管新标签页太卡、不好用」。

### 17.1 被覆盖的旧条款

| 位置 | 原表述 | v1.4.0 |
|---|---|---|
| §1 非目标 | 不接管新标签页、不做 popup | **保留**；新增第三个分段 tab，形态仍为图标打开的独立全屏面板 |
| §2 决策 9 / §3.2 / §10.5 | 仅 `history` + `favicon`（+ `bookmarks`）；不声明 `tabs`、不读当前标签的 URL/标题 | 改为 `history` + `favicon` + `bookmarks` + **`tabs`**；这是唯一破例，且只破「读标签元数据」，不读网页正文、不注入脚本 |
| §16.2 / §16.11 | 不做 `tabs` / `storage` 新权限 | `tabs` 破例；**`storage` 仍不声明**，零持久化不变 |
| §10「零常驻 change 监听」 | 不注册任何事件监听 | **不变**；面板页内也不注册 `tabs.onCreated/onRemoved/onUpdated` |
| §11 验收 37 / §16.9 验收 56 | 权限清单恰为三项 | 权限清单恰为四项；零网络、零持久化、零常驻监听三条基线保留 |
| §16.8 tab 状态机 | `activeTab: 'history' | 'bookmarks'` | 扩为三值，新增 `tabs`；深链 `?tab=tabs`；会话内记忆不变 |
| §16.8 / 验收 62 | 默认落在历史，关面板重开回到历史 | **v1.5.1 起默认落在标签页**（最常用），分段控件顺序为「标签页 / 书签 / 历史」；历史首屏改为首次切过去才读 |
| §9.4 单实例握手 | 面板自身靠 `panel-ping` 聚焦 | **不变**；标签页管理模块须剔除自身与详情页，避免自我关闭 |

### 17.2 权限与数据边界

- `manifest.json`：`version 1.4.0`，`permissions` 恰为 `history` / `favicon` / `bookmarks` / `tabs`；无 `storage`、无 `activeTab`、无 `<all_urls>`、无 `host_permissions`、无 content script、无 `chrome_url_overrides`。
- `tabs` 权限只用于 `chrome.tabs.query({})` 读取 `url` / `title` / `favIconUrl` / `windowId` / `index` / `pinned`。不加它则查询结果的 URL 与标题为空，分组无从做起。
- `chrome.tabs.remove` / `update` / `get` 与 `chrome.windows.update` 本身不要求该权限；破例只在读侧。
- 数据读取时机**仅限**：切到「标签页」tab、页面 `visibilitychange` 回到可见、每次关闭操作完成后、用户点「刷新」。模块在切到该 tab 时才动态 `import()`，历史/书签首屏不加载其代码；深链直达标签页时跳过历史首屏读取。
- 不注册任何 `chrome.tabs` / `chrome.windows` 事件；service worker 不动；零 `fetch` / XHR / WebSocket / 外部字体；零 `chrome.storage` / localStorage / IndexedDB。
- 无痕窗口的标签在扩展默认未开启无痕模式时天然不可见，不写补偿逻辑。

### 17.3 数据模型与分组口径

- 浏览器 `tab.id` 为唯一标识；一行一个标签，**不按 URL 去重**（同一 URL 开三个就要有三行，否则无法逐条关闭）。
- 行模型在既有 `PageItem` 字段之上附加 `tabId` / `windowId` / `index` / `pinned` / `active` / `rawUrl` / `isDuplicate`。
- **必须经 `normalizeItem()` 的协议白名单**：只有 http/https 走 `getRegDomain()`；非 web 协议（含 `chrome-extension://`）归 `__local__`。直接把 URL 交给 `getRegDomain()` 会因「单标签主机原样返回」分支把扩展页误当成独立域名。
- 面板自身与详情页按扩展 URL 前缀剔除（可复用 `app.js` 已缓存的 `selfTab` 对应的扩展源）。
- 分组 key = `host`（**完整主机名**，v1.5.0 起）：`naui./ai-gw./www.united-imaging.com` **各自成卡**；`foo.github.io` / `bar.github.io` 同样各自成卡。不再按 eTLD+1 合并——历史侧仍按 eTLD+1，**两侧口径刻意不同**：历史要回答「这个站点我看了什么」，标签页要回答「我现在开着哪几个应用」。
- 成卡、组级关闭、行级「关闭其他」三处**必须共用同一个 key 口径**（`groupKeyOf()`）；任一处仍按 eTLD+1 圈范围，都会导致「全部关闭」跨到同主域的其他子域上。
- 特殊桶 `__local__` 显示于末位，含 `chrome://` / `file://` / `about:` / 原生 `chrome://newtab/` / `localhost` / IP / 内网单标签主机。
- 排序：卡片按标签数降序、同数按域名 A–Z，特殊桶固定最后；组内按 `windowId` → `index` → `tabId`；多窗口时每行显示窗口标识。
- 重复标记：仅当**完整 URL 字符串完全相等**（含 `#hash` 与查询串）才算重复；按标签栏顺序，第二个及以后显示只读「重复」标记；不自动去重、不提供去重按钮。
- 搜索：三个 tab 共用顶部搜索框，切换保留词并按新数据源重查；标签页侧为纯内存多词 AND 过滤（标题 / URL / host / regDomain），单字即搜、120ms 防抖、每次输入 0 次 API 调用。

### 17.4 展示与交互

- 沿用卡片墙视觉语言、3–4px 圆角、keyed DOM 与事件委托；卡片头显示「完整主机名 · N 个标签页」。
- **操作按钮优先用图标**（v1.5.0）：卡头「全部关闭」为 24×24 危险色图标（无圆圈的粗 ×，与行内圈 × 区分），顶部「刷新」为刷新图标；只有二次确认条的「取消 / 关闭标签页」保留文字——批量关闭是危险操作，纯图标会让确认失去明确性。
- **操作图标默认隐形，鼠标悬浮卡片 / 行（或键盘聚焦）才出现**（v1.5.0）。常显会让卡片显得拥挤，也更容易误点；隐形时必须同时关掉命中区域（`pointer-events: none`），否则会点到看不见的按钮。无 hover 能力的环境（`@media (hover: none)`）一律常显，否则永远点不到。
- 默认 3 条预览，「展开全部 N 个」为**文字 + 折叠箭头**，在卡内展开，**不跳详情页**（标签页数量级远小于历史，跳页会打断连续清理；详情页继续保持只读）；展开后箭头翻转、文案变「收起」。
- 行右侧两枚 24×24 SVG 图标按钮：「关闭其他」「单独关闭」，`title` / `aria-label` 承担语义、危险项 hover 着色，不挤压标题宽度；标题允许两行后省略。
- 行内副标题显示**路径**（特殊页显示协议，如 `chrome://settings`），不再重复卡头已有的主机名。
- 点击行（不是按钮）按 `tab.id` 聚焦：`chrome.tabs.update(id, { active: true })` + `chrome.windows.update(windowId, { focused: true })`，**不新建标签、不走 http/https 协议白名单**，特殊页也可跳转。面板会退到后台，切回可见时重读。
- 状态行显示「共 N 个标签页 · M 个站点」；关闭后用 toast 提示已关闭数量与 `Ctrl+Shift+T` 可恢复。
- 事件委托取 key 时必须能从所属卡片兜底（`pickActionKey()`）：v1.5.0 的「展开全部点了没反应」就是按钮漏挂 `dataset.key`、而处理器要求 key 非空导致的，兜底 + 接线静态断言共同防回归。

### 17.5 三条写路径（受控写操作）

关闭标签是可逆操作（浏览器提供 `Ctrl+Shift+T`），但整组关闭的爆炸半径大，因此：

| 路径 | 入口 | 范围 | 确认 | 固定标签 |
|---|---|---|---|---|
| 组级「全部关闭」 | 卡头图标按钮（悬浮卡片显形） | 同**主机名**跨全部窗口 | 两步确认 | 跳过 |
| 行级「关闭其他」 | 行内图标按钮（悬浮行显形） | 同**主机名**组内除本行外全部，跨全部窗口 | 两步确认 | 跳过；本行即使是固定页也保留 |
| 行级「单独关闭」 | 行按钮 | 仅该行 | 无确认，一点即关 | 不跳过 |

- 两步确认：第一次点击显示确认条，列出准确数量、跨窗口时的窗口范围（`窗口 1 ×2、窗口 2 ×1`）、被跳过的固定标签数，以及「可随时用 Ctrl+Shift+T 恢复」；**不得写「不可撤销」**，也**不得写「及其子域」**（v1.5.0 起范围就是一个主机名）。确认前 0 次 `chrome.tabs.remove` 调用；取消不产生副作用，可重新进入确认态。
- **确认执行时必须重新 `chrome.tabs.query({})`**，用最新列表按当前 key / tabId 重算目标 id 后再 remove，避免渲染时的陈旧 id 误关别的页面。
- 特殊桶**没有**组级关闭，也**禁止行级「关闭其他」**（否则等于换入口绕过口径），但保留逐条关闭。
- 写操作进行中禁止切换 tab；切走即作废确认态（`deactivate()` 清 pending）。在途读取用 generation 作废，旧结果不得覆盖新视图。
- 三条路径共用关闭后重读、重渲染、toast 与空组消失逻辑；重复标记随重读更新。

### 17.6 模块与工程

- 新增纯逻辑模块：归组、重复判定、排序、关闭目标计算、确认文案数据源，零 `chrome.*` 依赖，可用 Node 内置测试运行器直接断言（零依赖、零构建；扩展目录的最小包声明仅供 Node 使用，浏览器加载时忽略）。
- 新增标签页面板模块：读取、渲染、三条写路径、两步确认、竞态与互斥；只操作自身视图与共享状态行。
- `app.js` 扩 `activeTab` 三值、`setTabUI` / `switchTab`、搜索分流、可见性分流、`panel-query` 分流、`?tab=tabs` 深链与第三类写操作互斥；历史侧状态机与 `sw.js` / `domain.js` / `history.js` / `bookmarks.js` / `detail.*` 不改。
- 实现顺序 M11-a（manifest / HTML / 样式）→ M11-b（纯逻辑 + 测试）→ M11-c（只读视图）→ M11-d（三类关闭）→ M11-e（文档 / 验收）。

### 17.7 安全与隐私

1. 标签标题与 URL 插入 DOM 一律 `textContent` 或先转义；只有既有高亮通道允许受控 `innerHTML`。
2. 零网络请求、零持久化、零常驻 change 监听三条基线在标签页侧同样生效。
3. 所有写操作只能由用户点击触发；禁止在切 tab、切回可见、重读、搜索等自动流程中调用关闭 API。
4. 面板自身与详情页永不进入关闭目标集合；特殊桶不产生批量关闭目标。
5. 权限解释必须诚实：安装说明写明 `tabs` 只给标签元数据，不给页面正文、不给注入能力。

### 17.8 验收（60–75，与 §11 同口径；1–59 需回归）

60. 权限清单恰为 `history` + `favicon` + `bookmarks` + `tabs`；无 `storage` / `activeTab` / host 权限 / content script / `chrome_url_overrides`；产物无 `fetch` / XHR / WebSocket / 外部资源。
61. 不接管新标签页：Ctrl+T 仍是浏览器原生新标签页；面板仍由图标单实例打开，`panel-ping` 握手与详情页不抢答的行为不变。
62. 顶栏分段按钮顺序为「标签页 / 书签 / 历史」（v1.5.1）；打开面板默认落在标签页，首个按钮高亮、`aria-selected="true"`；`?tab=history` / `?tab=bookmarks` / `?tab=tabs` 均可达，非法值回落到标签页；切换保留搜索词；关面板重开回到标签页；写确认期间禁止切 tab。
63. 模块按需加载：未切到该 tab 时网络/模块请求里没有标签页模块；切到该 tab 才有一次 `chrome.tabs.query({})`；历史/书签首屏 0 次标签 API 调用。
64. 全部窗口的标签都列出；面板自身与 `detail.html` 不出现；无痕窗口标签默认不可见。
65. `naui./ai-gw./www.united-imaging.com` **各自成卡**（v1.5.0 起按主机名，不再按 eTLD+1 合并）；`foo.github.io` / `bar.github.io` 同样各自成卡；`chrome://` / `file://` / `localhost` / 原生新标签页归「本地 / 其他」且固定末位。
66. 同一 URL 开三个标签保留三行；组内按窗口与索引排序；多窗口行有窗口标识；固定标签有「已固定」。
67. 卡片按标签数降序、同数按主机名 A–Z；默认 3 条预览、「展开全部 N 个」点击后展开为全部、再点收回，全程不跳详情页。
68. 完整 URL 相等才算重复；hash 不同不重复；只标第二个及以后；标记只读、无去重按钮。
69. 搜索单字即搜、120ms、多词 AND、0 次标签 API 调用；切 tab 保留词；Esc 清空当前 tab 搜索。
70. 数据在切到该 tab / 切回可见 / 关闭后 / 点刷新时重读；停留期间别处开关标签不自动刷新（已知限制）；切走作废在途读取。
71. 点击行聚焦既有标签（含跨窗口），标签总数不变；`chrome://` / `file://` 行可跳转；标签已关闭时提示并自动刷新。
72. 组级「全部关闭」：首次点击出现确认条，含数量、跨窗口时的窗口范围、跳过固定数与恢复提示，无「不可撤销」也无「及其子域」；确认前 `tabs.remove` 调用数为 0；取消无副作用。
73. 确认后用最新标签列表重算目标：跨窗口同域名全部关闭；固定标签保留；面板不被关闭；关光某窗口标签会连带关闭该窗口，但面板所在窗口保留。
74. 「关闭其他」保留本行、关闭同主机名其余标签并继承确认与固定页跳过；特殊桶无「关闭其他」按钮；「单独关闭」一点即关、可关固定标签；三条路径关闭后重读、toast、空组消失，重复标记同步更新。
75. 关闭后可用 `Ctrl+Shift+T` 恢复；全程零网络请求、零 `chrome.storage` 写入、零常驻监听；历史与书签的既有验收 1–59 零回归。

v1.5.0 补充（76–79）：

76. 同主域不同子域各自成卡；组级「全部关闭」只关本主机名的标签，**不误关同主域的其他子域**；「关闭其他」同口径。
77. 「展开全部 N 个」点击生效：默认 3 行 → 展开为全部 → 再点收回 3 行；文案与折叠箭头状态同步。
78. 卡头与行内操作默认 `opacity: 0` 且不可命中；鼠标悬浮卡片 / 行或键盘聚焦后出现（实测非悬浮卡片保持 0）；`@media (hover: none)` 下常显。
79. 操作按钮图标化：卡头不再有文字「全部关闭」、顶部不再有文字「刷新」；二次确认条保留「取消 / 关闭标签页」文字。

v1.5.1 补充（80）：

80. 启动不再读历史：面板打开到切走之前 `chrome.history` 调用为 0；首次切到历史才读首屏，且只读一次（再次切回不重复读）；深链直达书签时仍预先读首屏，切回历史无需等待。

### 17.9 已知限制与非目标

- 停留在该 tab 时，别处在其它窗口开关标签不会自动刷新，靠切回可见或「刷新」按钮兜底（这是为避开 Tab Out 式常驻监听的刻意取舍）。
- 按主机名成卡后，同一主域的多个子域会各占一张卡，标签多时卡片更碎——这是刻意取舍：用户要的是「哪几个应用开着」而不是「哪家公司」。
- 精简 PSL 表的风险只作用于历史 / 书签侧；标签页侧按完整主机名成卡，不再依赖 PSL。
- 无痕窗口默认不可见；关闭标签虽可用 `Ctrl+Shift+T` 恢复，但插件自身不提供撤销、回收站或备份。
- 不做：稍后读、记住折叠态、badge 计数、首页/落地页独立分组、自动去重、音效彩带、跨源「已收藏」标记、详情页写入口、Firefox / Safari 适配、上架商店。

