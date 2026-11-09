# 历史域名卡片墙 · 技术规格 (SPEC v1.2.1)

> 日期：2026-11-09 ｜ 项目目录：Git 仓库 `up-broswer-extensions` 的 `history-by-domain/` 子目录（本机：`D:/Personal/history-by-domain/history-by-domain`）｜ 状态：v1.2.1 已实现（含 v1.0 / v1.1 / v1.2 全部内容）
> 本文是设计决策的唯一固化结果，是写码的依据。**任何偏离本文的改动，先改本文件对应章节，再改代码。**
>
> **v1.1 变更（2026-11-09）**：新增「卡片一键清除某域名全部历史」与「卡片超过 10 页时新开详情页展示」。前者是本扩展**唯一的写操作**，把"纯只读"基线改为"只读为主 + 一处受控删除"；`history` 权限本身已涵盖 `deleteUrl`，**权限清单不变**。详见 §6.7 / §9.8 / §10.7。
>
> **v1.2 变更（2026-11-09）**：新增「域名作用域搜索」——选中某张卡片后，顶部搜索框只在该域名（含子域）的记录里搜索。数据由一次全量分段枚举缓存到内存，之后每次输入零 history 调用；详情页的页内过滤同步升级为同一套多词搜索与高亮。纯新增读能力，**权限清单仍不变**。详见 §6.8 / §9.9。
>
> **v1.2.1 修复（2026-11-09）**：详情页「← 返回卡片墙」点击无反应。根因是该动作经 `focus-panel` 交给 service worker 执行异步聚焦，而 MV3 worker 可在 `panel-ping` / `tabs.update` 途中被回收，且监听器未保持消息通道、详情页又无兜底。改为由详情页直接执行 `panel-focus.js` 的握手与聚焦，失联时必定新开面板；`sw.js` 不再注册 `onMessage`，主面板对 `panel-ping` 改为同步回包。**权限清单仍不变**。详见 §9.4 / §9.8。

## 0. 一句话

一个以 Chrome 历史库为唯一数据源的 MV3 原生扩展：不落库、不建索引、不加后台；点图标打开一个常驻全屏标签页，首屏只拉最近 200 条按注册域名聚成卡片，卡面直接给出可点的最近 3 页，长尾折叠、全量按需分段加载；搜索交给浏览器原生索引再精排并让卡片墙原地变形；选中某个域名即可把搜索限定在它内部，长列表改由独立详情页摊平展示，卡片右上角可经二次确认清除该域名（含所有子域）的全部历史。

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
  "name": "历史域名卡片墙",
  "version": "1.2.1",
  "description": "把浏览历史按域名聚合成卡片，支持全量搜索、按域名限定搜索与清除记录。本地运行，不上传任何数据。",
  "permissions": ["history", "favicon"],
  "action": {
    "default_title": "打开历史域名卡片墙",
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
      "description": "打开历史域名卡片墙"
    }
  },
  "omnibox": { "keyword": "h" }
}
```

### 3.2 权限说明

| 权限 | 用途 | 备注 |
|---|---|---|
| `history` | `chrome.history.search` 读取历史；`chrome.history.deleteUrl` 按 URL 删除 | 安装时会触发"读取和更改您的浏览记录"警告，这是本插件唯一的高敏权限。**v1.1 起该警告名副其实**：删除由用户逐次确认触发，没有静默写入 |
| `favicon` | 允许使用 `chrome-extension://<id>/_favicon/` URL | 官方要求必须声明；仅在未声明 `tabs` 时额外触发一条图标权限提示 |
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
3. 安装时会出现 `history` 带来的"读取和更改您的浏览记录"警告，以及 `favicon` 权限提示，属预期。**v1.1 起该权限确实会用于按域名删除历史**，但只在你逐次确认后触发，没有静默写入。
4. 点工具栏图标（或 `Alt+H`）打开面板；修改代码后在扩展页点「刷新」，无需构建。
5. 按 §11 逐条验收；首轮重点验证 `startTime: 0` 与 `maxResults` 是否被正确覆盖，以及验收 16/18/24/28/31/34/35 各条（确认前置条件、两阶段顺序、详情页不抢答握手、域内输入零 API 调用、退出后自动全局搜索、返回卡片墙与关掉面板后的兜底）。**改过 `sw.js` / `manifest.json` 后必须在扩展页点「刷新」并关掉旧详情标签重新打开**，否则旧页面仍跑旧模块。

---

**变更规则**：本规格的任何修改都在此文件内进行并更新版本号；实现若与本文冲突，以本文为准，先讨论改规格再动代码。

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0 | 2026-11-09 | 九项设计决策固化；M0–M5 实现 |
| v1.1 | 2026-11-09 | 新增按域名清除（唯一写通道 §6.7）、超过 10 页的详情页 §9.8、安全约束 7/8、验收 15–24、M6/M7；权限清单不变 |
| v1.2 | 2026-11-09 | 新增域名作用域搜索（§6.8 / §9.9）、`scope-view.js` 共用列表渲染、详情页升级为多词搜索与高亮、安全约束 9、验收 25–33、M8；权限清单仍不变 |
| v1.2.1 | 2026-11-09 | 修复详情页「返回卡片墙」点击无反应：新增 `panel-focus.js`，聚焦逻辑移出 service worker，主面板同步回包，移除 sw.js 的 `onMessage`；验收 34–36、M9；权限清单仍不变 |
