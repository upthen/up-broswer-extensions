# 便签本 · Sticky — 技术规格

> v4.3 · 2026-11-17 · 写码依据
> **v4 按已确认的视觉设计稿施工**：`design/mockup.html`（双模块提案 v3.1）。v1 加密账号库、v2 明文账号库、v3 单列大卡片便签本全部作废。
> **v4.1 新增**：记事本支持导入本地 `.txt`（一个文件 = 一篇新文档）。明确不含导出 / 备份。
> **v5.2 变更**：记事本回到 **左源码 / 右预览的分栏编辑**（「分栏 / 源码 / 预览」三档，默认分栏）。v5.1 的所见即所得（`contenteditable` + 反向序列化）交互面过大、bug 难收敛，已下线；渲染仍由 `src/core/markdown.ts` 本地实现，不引第三方解析器，输入整体转义后只生成白名单标签。
> **v4.2 新增**：存储由「单键整库」改为「按条目分键 + 增量写入」，旧整库自动迁移；输入 250ms 节流；加 `unlimitedStorage` 解除 10 MB 上限；写入失败持久提示。仍不做导出 / 备份 / SQLite / 同步。
> **v4.3 新增**：网页选中文本后右键「存为便签」，一段选中内容 = 一张新便签；只加 `contextMenus` 权限，不注入脚本、不读页面 DOM、不记录来源 URL。

## 1. 目标与非目标

**目标**：一个 Chromium MV3 扩展，提供两个互不干扰的本地记录模块：

- **便签**：小卡片按 n*n 瀑布网格铺开，一眼扫完，点开卡片才进入编辑。适合短信息（地址 / 账号 / 密码 / 命令）。
- **记事本**：一整页沉浸式编辑器，顶部或左侧切换文件。适合长文本。
- **网页选中文本 → 右键「存为便签」**（v4.3）：浏览器在右键时把选中文本直接交给扩展，不读取页面 DOM、不注入脚本。

打开即用、输入即存、明文、纯本地。

**明确不做**（不要以任何形式加回来）：

- 按域名 / IP / 端口归组、当前站点自动命中、URL 解析
- 两个模块之间的数据互通（如「便签转文档」）—— 心智不同、会产生副本不一致、扩大明文面
- 主密码、加密、解锁、锁定、会话密钥
- 批量数据导入导出（CSV / JSON）、备份、同步、跨设备通道、自动捕获表单、自动填充、内容脚本
  - **例外**：v4.1 允许「单/多个本地 `.txt` → 记事本新文档」这一**只读入**功能；它不导出、不备份、不解析结构化数据，不属于上面被禁止的「导入导出」
- 第三方 Markdown 解析器（`marked` / `markdown-it` / `DOMPurify`）、`v-html` 指令、原始 HTML 透传、`.md` 文件导入
- 密码强度检测、生成器、改密提醒、审计日志、回收站、团队分享

## 2. 决策基线

| 项 | 决定 |
|---|---|
| 模块切换 | 顶栏 52px 一级分段切换器「便签 / 记事本」，各带数量徽章；两个模块共用同一根顶栏，不另占纵向空间 |
| 数据 | `WorkspaceFile { version: 2, notes: TextEntry[], docs: TextEntry[] }`；两类条目结构相同但**完全独立** |
| 存储 | `chrome.storage.local`，**明文**；v3 布局 `sticky.workspace.v3` 只存 id 顺序，每条便签 / 文档一个键；v2 整库 `sticky.workspace.v2` 与 v1 `sticky.notes.v1` 自动迁移一次 |
| 便签布局 | CSS 多列瀑布：侧栏 2 列 / 中宽 3 列 / 全屏 4 列；卡片只显示标题 + 最多 4 行摘要 |
| 便签编辑 | 点卡片弹出详情浮层，标题 + 正文输入即存；无保存按钮、无编辑态切换 |
| 卡片操作 | 复制全文 / 复制密码 / 更多收进 hover 角标与「⋯」菜单，避免窄卡片溢出 |
| 记事本布局 | 全屏：左侧 240px 文件栏 + 右侧整页无边框书写区；侧栏：文件栏收成顶部下拉 |
| 记事本编辑 | **左源码 / 右预览**：等宽 `textarea` 写 Markdown，右侧 `.md` 实时渲染，两栏各自滚动并联动；输入即存；顶部一条极轻工具条（文件名 / 字数 / 更新时间 / 视图切换 / 复制全文） |
| Markdown 视图 | 「分栏 / 源码 / 预览」三档；默认分栏；视图偏好存 `localStorage`，v5.1 的 `wys` 迁移为分栏 |
| txt 导入 | 仅记事本；一个 `.txt` = 一篇**新文档**（文件名作标题、正文原样）；支持多选；不追加、不覆盖、不去重；不新增权限 |
| 右键存为便签 | `contexts: ['selection']`，一段选中内容 = **一张新便签**；标题取首个非空行前 24 字、正文只 trim 首尾；不弹窗、不追问、不记录来源 URL；已打开的侧栏 / 全屏页即时刷新并提示 |
| 搜索 | 便签模块标题 + 正文，空格分词 AND，大小写不敏感；记事本模块不提供全文搜索 |
| 初始内容 | 首次启动播种 8 张便签（用户提供的服务账号）；**记事本不预置虚构文档**，给空状态与「＋ 新建文档」 |
| 视觉 | 严格沿用 `design/mockup.html` 的 token：`--accent #3b5bdb`、微暖纸感底 `#f8f8f6`、1px 细边 + 双层柔阴影、地址/账号/密码行等宽字体 |
| UI 载体 | 同一个 `App.vue` 挂载到侧栏 `sidepanel.html` 与全屏页 `index.html`；侧栏可一键「全屏打开」 |
| 权限 | `["storage", "sidePanel", "unlimitedStorage", "contextMenus"]`，`host_permissions: []`，零网络请求、无内容脚本 |
| 工程 | Vue 3 + TypeScript + Vite + Vitest；目录沿用 `site-keys/` |

## 3. 数据模型（`src/core/types.ts`）

```ts
export interface TextEntry {
  id: string
  title: string
  content: string          // 完全自由的多行文本，插件不解析、不校验、不改写
  createdAt: number
  updatedAt: number
}
export type Note = TextEntry
export type Doc = TextEntry
export type EntryKind = 'notes' | 'docs'
export type ModuleId = 'stickies' | 'notebook'

export interface WorkspaceFile {
  version: 2
  notes: Note[]
  docs: Doc[]
}
export interface EntryPatch { title?: string; content?: string }
export interface SeedNote { title: string; content: string }
```

- `id` 用 `crypto.randomUUID()`，仅新建时生成。
- `title` 留空按 `normalizeTitle()` 兜底：标题 trim → 正文首个非空行前 24 字 → `未命名便签` / `未命名文档`（由调用方传兜底词）。
- 排序：加载时按 `updatedAt` 降序；编辑过程中**不重排**，避免光标跳动。新建条目插到最前。
- `extractPassword(content)` 仍只用于「复制密码」按钮，不解析同行、不改动正文。

## 4. 存储与迁移（`src/core/storage.ts`）— v4.2 分键布局

内存里的 `WorkspaceFile.version` 仍是 `2`（文档格式没变）；下面的 **v3 指磁盘布局**。

- 纯接口 `KeyValueStore { get, set, remove, getAll, setMany, removeMany }`；浏览器实现只在 `src/platform/chromeStores.ts`。`getAll()` 对应 `storage.local.get(null)`，`setMany()` 是同一批原子写入。
- 键：`META_KEY = 'sticky.workspace.v3'` → `{ version: 3, notes: id[], docs: id[] }`（只存顺序）；`NOTE_PREFIX = 'sticky.note.v3.'` / `DOC_PREFIX = 'sticky.doc.v3.'` + id → 单条 `TextEntry`。旧键 `sticky.workspace.v2`（整库）与 `sticky.notes.v1` 只作迁移来源。
- `loadWorkspace(store)` 优先级：v3 meta 合法 → 按 id 顺序组装（缺失 / 损坏的条目跳过，不抛异常）；否则 v2 整库合法 → 拆成分键；否则 v1 旧库合法 → 转成 `{ notes, docs: [] }` 再拆分。**迁移先写新键、成功后才删旧键**，可重入，用户已录入的内容不丢；其它情况返回 `null`，由 `init()` 播种。
- 增量写入：`applyWrite(store, items, removeKeys)` 先写后删（中途失败只留孤儿键，不丢数据）。改一条只写那一条的键，连 meta 都不动；新建 / 删除 / 清空 / 批量导入则把新条目与 meta 放在**同一次 `setMany`** 里。
- `saveWorkspace(store, file)` 是整库覆盖，只用于播种、测试与 `clearWorkspace`；会清掉不再引用的条目键。`clearWorkspace` 保留**空 meta 键**（不是删键），否则下次启动会重新播种。
- `clearNotes(store)` 只写 `notes: []` 的 meta 并删便签条目键，文档原样保留。
- **v4.3 信号键** `SELECTION_SIGNAL_KEY = 'sticky.selection.v3'`：后台右键保存成功后，与 meta、新便签条目放在**同一次 `setMany`** 里写一个很小的 `{ ok, id, at, reason? }`；失败时单独写 `ok:false`。它既不是索引也不是条目，`loadWorkspace()` 会自然忽略；界面只监听这一个键的变化，**不会因为自己每次输入落盘而反复全量读盘**。
- 不用 SQLite / IndexedDB：数据量只有几十条短文本，没有 JOIN / 聚合需求；SQLite WASM 的 OPFS 仍在扩展 origin 内、卸载时一样被清，还要 COOP/COEP 与独占锁（侧栏 + 全屏页会撞锁）。数据要跨过「卸载 / 删 profile」边界只能靠导出备份，本版按非目标明确不做。

## 5. 核心纯逻辑（`src/core/workspace.ts`）

- `createEmptyWorkspace()`、`normalizeTitle(title, content, fallback)`
- `addEntry(file, kind, { title, content }, id, now)` / `updateEntry(file, kind, id, patch, now)` / `deleteEntry(file, kind, id)` —— 不可变更新，只动指定 kind
- `searchEntries(entries, query)` —— 多词 AND，命中 `title + content`，空 query 返回全部；**保留原对象引用**（UI 的 v-model 依赖）
- `sortByUpdated(entries)` —— 降序，同值按 `createdAt` 降序
- `extractPassword(content)` —— 逐行匹配 `/^\s*(密\s*码|password|passwd|pwd)\s*[:：]\s*(.+?)\s*$/i`，取最后一个匹配
- `countChars(content)` —— 去空白后的字符数，仅用于编辑器工具条显示
- `excerpt(content, maxLines)` —— 卡片摘要，取前 N 个非空行，超长截断；不改变存储内容

### 5.1 txt 导入纯逻辑（`src/core/textFile.ts`，v4.1）

- 常量：`MAX_IMPORT_BYTES = 1 MiB`、`MAX_IMPORT_FILES = 20`、`TXT_ACCEPT = '.txt,text/plain'`（**不含 `.md`**）。
- `decodeTextFile(bytes)` → `{ text, encoding }`，识别顺序：BOM（UTF-8 `EF BB BF` / UTF-16LE `FF FE` / UTF-16BE `FE FF`）→ 无 BOM 的 UTF-16LE（NUL 占比 > 20% 且长度为偶数）→ `TextDecoder('utf-8', { fatal: true })` → 失败回退 `TextDecoder('gb18030')`。BOM 一律剥掉；**正文原样，不做 CRLF 归一化、不 trim、不改写**。
- `titleFromFileName(name)`：去掉路径分隔符与末尾 `.txt`（大小写不敏感），空白名兜底 `未命名文档`，超长截断 80 字。
- `isTxtFile(name)` / `planImport(sources)` → `{ entries, skipped }`：按选择顺序生成条目；非 `.txt` / 超过 1 MiB / 超过 20 个 / 解码失败逐个跳过并给原因，**一个坏文件不阻塞其他文件**；超限文件在 UI 层就不读进内存。
- 该模块只用 `TextDecoder` 与纯数据结构，不碰浏览器扩展 API / DOM / 网络 / 控制台；`TextDecoder` 由 Chromium 114+ 与 Node 运行时提供。

## 6. 状态机（`src/ui/composables/useWorkspace.ts`）

`createWorkspaceController({ local, now, seed, makeId })`，状态 `loading | ready`。浏览器能力由依赖注入，便于 TDD 用 `MemoryStore` 测试；不持有密钥、不加解密、不发消息给 service worker。

| 成员 | 行为 |
|---|---|
| `init()` | 读库 / 迁移 / 播种；按 `updatedAt` 排序两个列表；`activeDocId` 取第一篇文档 |
| `reload()` | **v4.3**：只读不写，后台右键保存后重读磁盘并刷新两个列表；不重置模块，当前文档失效时才回退到第一篇。调用方必须先 flush 未落盘的输入 |
| `setModule(id)` | 切换 `activeModule`，仅内存态，刷新后默认回便签 |
| `setActiveDoc(id)` | 切换当前文档 |
| `createNote/updateNote/removeNote` | 便签 CRUD，立即持久化 |
| `createDoc/updateDoc/removeDoc` | 文档 CRUD；删除当前文档时自动选中剩余第一篇，没有则置 `null` |
| `importDocs(entries)` | 批量导入：倒序插入保证第一份文件排最前，**整批只落盘一次**（避免 N 次全库序列化）；`activeDocId` 切到第一篇；空批次不写盘、不改选中项；返回 id 顺序与输入一致 |
| `clearNotes()` | 只清便签，保留文档 |
| `readPassword(id)` | 行识别，无匹配返回 `null` |

## 7. UI（`src/ui/App.vue` + `src/ui/styles/base.css`）

### 7.1 共用顶栏

- 品牌方块；窄栏只显示图标，宽屏显示「便签本 · Sticky」。
- `.seg` 分段切换器：便签（带张数）/ 记事本（带篇数），激活态白底 + 微阴影。
- 右侧「全屏打开」：扩展环境用 `chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })`，不需要 `tabs` 权限。

### 7.2 便签模块

- 工具条：搜索框（sticky）+ 主色新建按钮；窄栏按钮收成 34px 方形「＋」，宽屏显示「＋ 新建便签」。
- `.stickies` 多列瀑布，`.sticky` 卡片 `break-inside:avoid`；列数由视口宽度决定：`<700px` 2 列、`700–899px` 3 列、`≥900px` 4 列。
- 卡片内容：标题（超长省略）+ 摘要（等宽字体、最多 4 行）+ 更新时间；正文用 `excerpt()`，`white-space: pre-line` + `-webkit-line-clamp` 双保险。
- 操作：hover / focus 时淡入角标（复制全文、复制密码、⋯），「⋯」展开菜单含「编辑 / 删除」；点击卡片直接打开详情浮层。
- 详情抽屉（v4.4 由居中弹窗改为底部抽屉）：点卡片从底部升起，**面板铺满整宽、左右与底部贴边**，只有上沿一道细线和一道向上投影（这是「抽屉」与「浮在中间的弹窗」的分界）；内容列 `max-width: 720px` 居中，宽屏下不会拉成一行读不完的长条。遮罩降到 `rgba(27,36,48,.18)`，仍可点击关闭。
- 抽屉高度 `clamp(max(30vh, 200px), 50vh, min(80vh, 100vh - 16px))`，正文 `flex:1` 吃满剩余高度。**操作按钮全部排在头部**：头部最左是 macOS 式红黄绿三灯（红=关闭、黄=收起成 54px 细条、绿=50%/80% 最大化切换；静止是三色圆点，整组悬停才显出 `× − +`），其后是「字数 · 更新时间」（视口 ≤430px 时隐藏），右侧是复制全文 / 复制密码 / 删除（图标）+「完成」（主色）；底部不再有按钮条，整块高度留给正文。收起态隐藏标题、正文和字数，只留「便签已收起 · 点这里展开」，收起前的高度存在内存里、不写盘也不受 30% 下限约束。
- 编辑区是**纸面而不是表单**（与记事本 `.editor__page` 同一套视觉）：标题 `--fs-xl`（宽屏 `--fs-2xl`）、字重 650、`letter-spacing -.4px`；正文等宽 13px / 行高 1.9（宽屏 14px / 1.95），**无边框、无底色、无 focus 环**，`caret-color` 用主色、`::selection` 用 `--highlight`；操作栏与纸面之间只有一道 1px 分隔线。这样 3 行内容不会落在 500px 高的灰底框里像张表单。
- 拖拽改高：`.detail__grip` 把手条（36×4px 横杠）与 `.detail__head`（按钮除外）都可拖；Pointer Events + `setPointerCapture`，位移 > 4px 才进拖拽态；自由高度不做吸附，松手后按 `sticky.sheet.h.panel` / `sticky.sheet.h.page` 分键记忆；双击把手在 50% / 80% 之间归位；**下拉到底不关闭**。
- 关闭出口：点遮罩、头部红灯、右侧「完成」，外加 `Esc`（`isComposing` 时忽略，避免中文输入法取消候选词顺手关掉抽屉）。关闭先 `flushWrites()` 再播 160ms 下滑动画，动画期间 `closing` 锁住重复关闭。三个窗口按钮都用 `@click.stop`，避免冒泡到头部的「点细条展开」。
- 防误关：拖拽过与松手后 250ms 内，遮罩收到的 `click` 一律不当作关闭意图；正文不再用 textarea 原生 `resize` 手柄（那是指针滑出抽屉落到遮罩上的直接诱因）。
- 底部：明文风险说明 + 「清空全部便签」（二次确认）。

### 7.3 记事本模块

- 全屏（`@media (min-width:900px)`）：`.nb-sidebar` 240px 常驻，含「文档 N 篇」「＋ 新建文档」、文件列表（当前项高亮、hover 出删除）、底部明文提示。
- 侧栏：侧栏隐藏，`.nb-bar` 显示当前文档下拉（自定义浮层，含文件列表与新建），另有字数与复制按钮。
- `.editor`：顶部 44px 极轻工具条；`.editor__page` 内标题 input（28px）+ `MarkdownEditor` 占满剩余高度，**无边框、无卡片阴影、白底**，行高 1.9。
- 空状态：还没有文档时给「＋ 新建文档」入口。

### 7.3.1 Markdown 渲染与分栏编辑（v5.2）

- 视图：`.editor__bar` 内 `.seg.seg--sm` 三档「分栏 / 源码 / 预览」，默认分栏。三档共用同一份 `docDraft.content`（Markdown 纯文本），切换只改显隐（`v-show`），文本域不重建，原生撤销栈与光标位置都保留。偏好写 `localStorage['sticky.doc.view']`；v5.1 存的 `wys` 迁移为分栏，`edit` 迁移为源码。
- 数据流向：**Markdown 文本是唯一真源**，预览是派生物。`textarea` 经 `v-model` 回写 `props.modelValue`（沿用 250ms 节流 + 增量写入），预览只做 `renderMarkdown(value) → innerHTML`。没有 DOM 反向序列化，也没有自建撤销栈——中文输入法、选区、撤销、粘贴全部由浏览器原生实现。
- 布局：`.mdx` 是两列 grid（`minmax(0,1fr) × 2`），左列 `.mdx__input` 等宽 13px / 1.9、无边框、无 focus 环，右列 `.mdx__pane--preview` 滚动、左侧 1px 分隔线。宽屏内容列仍收在 760px；`max-width: 899px`（侧栏）自动叠成上下两栏，源码在上、预览在下。
- 滚动：源码滚动时按 `scrollTop / (scrollHeight - clientHeight)` 的比例带动预览；预览不做反向同步。重排 `innerHTML` 前先记住阅读比例，重排后按比例还原，长文档里每敲一个字都不会弹回顶部。
- 安全：**先整体转义 `& < > " '`，再只拼接白名单标签**；预览把 `renderMarkdown()` 的结果写入 `innerHTML`（全仓已无 `v-html`）。链接与图片走协议白名单（`http` / `https` / `mailto` / 相对路径），`javascript:`、`data:` 等一律降级为字面文本。源码是纯文本域，外部 HTML 进不来。不引 `marked` / `markdown-it` / `DOMPurify`。
- 排版：`.md` 复用纸面字号（13px / 1.95，宽屏 `--fs-base`）；代码块用 `--surface-3` 底 + 1px 边；表格只画 1px 内框；任务框用 `.md-check` 只读方块（完成态主色底 + 白勾），不用原生 disabled checkbox（禁用态在浅色背景上发灰）。左对齐表格显式输出 `:---`，不被抹成 `---`。
- 标题去重：正文首行是 `# 标题` 时，它**就是**这篇的标题——标回 `doc.title`，同时收起上方那个标题输入框，避免同一句话上下各出现一次。
- 明确未做（v5.1 随所见即所得一并下线）：输入即转（行首标记直接变元素）、`Tab` 调列表层级、代码块语法高亮、表格单元格内编辑、行内拖拽。

### 7.4 txt 导入入口（v4.1）

- 全屏 `.nb-sidebar` 与窄栏 `.nb-dropdown` 各放一个 `.file-new.file-new--sub`「导入 txt」次级按钮，都调用同一个 `pickFiles()`；沿用文件栏按钮尺寸，只降低视觉权重，不另起一行。
- 单个隐藏 `<input type="file" :accept="TXT_ACCEPT" multiple hidden @change="onFilesPicked">`；`input.value = ''` 允许连续选同一文件。
- 流程：选文件 → 逐个 `file.arrayBuffer()`（超限文件跳过不读）→ `planImport()` → 有条目才 `importDocs()` 一次写入 → 刷新本地 `docs` / `activeDocId` / `docDraft` → 收起下拉 → toast 汇总成功数与首个跳过原因；全部跳过时用错误提示。
- 不写日志、不缓存文件、不保存磁盘路径、不上传；导入的源 `.txt` 由用户自行保管 / 删除。
- **不需要 `host_permissions`**：`<input type="file">` + `File.arrayBuffer()` 都在扩展页内完成；当前四项权限见 §9（v4.3 的 `contextMenus` 只服务于右键保存，与 txt 导入无关）。

### 7.5 输入即存与反馈

- 输入先 **250ms debounce**：同一条目连续敲字只保留最后一次快照，不同条目各自排队，互不覆盖；到点后统一 `flushWrites()` 排进**串行写入队列**（`pending = pending.then(...)`），避免并发覆盖丢字。
- 切换视图、失焦（`blur`）、页面隐藏（`visibilitychange`）/ 关闭（`pagehide`）、以及新建 / 删除 / 导入等结构操作前都会先 flush，尽量不把最后一次输入留在内存里。
- 写盘成功后才更新内存镜像；写入失败时抛错并显示**不会自动消失**的「改动没有保存」条幅，下一次成功写入才清除。结构操作失败同样走这条提示，不再只弹一个 5 秒就消失的普通错误。
- toast 用 `.float-toast`（成功语义浅绿）；错误用 `.notice--err`；删除用 `window.confirm`。
- 明文直显，不遮蔽、不隐藏。

### 7.6 右键存为便签（v4.3）

- 菜单在 `chrome.runtime.onInstalled` 里 `contextMenus.removeAll()` 之后创建**一次**：`{ id: 'sticky-save-selection', title: '存为便签', contexts: ['selection'] }`。菜单项属于扩展而非 worker，**不得在 worker 顶层重复创建**（重复 id 会报错）。
- `contextMenus.onClicked` 只处理该 id，把 `info.selectionText` 交给 `createSelectionSaver()`；浏览器在右键时已捕获选中文本，无需 `tabs` / `activeTab` / `scripting` / `host_permissions` / 内容脚本 / `window.getSelection()`。
- core 的 `createSelectionSaver()` 持有**串行队列**：每次先 `loadWorkspace()`（让 v2 / v1 旧库先完成迁移，新索引不会挡住旧数据），再生成条目，最后把 meta + 条目 + 成功信号放进**同一次 `setMany`**；空白选中不写盘；失败写 `ok:false` 信号并抛错，一次失败不卡死队列。
- 标题沿用 `normalizeTitle()`（首个非空行前 24 字），正文只 trim 首尾、内部缩进 / 空行 / 换行原样；**不追加来源 URL、不追问标题、不弹确认框**。
- 界面只监听 `storage.onChanged` 里那一个信号键：成功 → `flushWrites()` → `await pending` → `controller.reload()` → 同步 refs、重绑详情浮层 draft、清空搜索词、toast「已存为便签」；失败 → 普通错误提示。**先 flush 再 reload**，绝不覆盖正在编辑且尚未落盘的字。
- 没有界面打开时静默落盘（下次打开自然在）；侧栏与全屏页同时打开时各自刷新与提示，数据只有一份。
- 全新安装且从未打开过界面时直接右键保存：会建立空索引 + 这一条便签，**不会补播 8 张示例便签**（用户主动存的内容不该被示例数据淹没）。

## 8. 视觉系统与响应式（`src/ui/styles/base.css`）

- `:root` 完整落地设计稿 token：配色、字号阶梯、4px 间距阶梯、圆角、双层阴影、动效时长、`--nav-w/--topbar-h/--seg-h/--card-min`。
- 界面图标为**内联 SVG sprite**（`<symbol>` + `<use>`），无外部字体 / 图片 / CDN / JS 库。
- 扩展图标（`public/icons/icon{16,32,48,128}.png`）由 `scripts/make-icons.mjs` 零依赖生成：品牌蓝圆角底 + 白色便签纸 + 蓝色文字横线；48 / 128 再叠一张淡黄便签并带右下折角，16 / 32 简化成白纸两道线。配色沿用 `--accent #3b5bdb` / `--highlight #fff2b8`，与 `i-logo` 同一套视觉；4×4 超采样抗锯齿，保证 16px 不糊。`npm run icons` 重新生成，`npm run build` 复制进 `dist/icons/`。**不得回到旧账号库的钥匙图形**，由 `tests/icons.test.ts` 守卫。预览见 `design/icon-preview.html`（图标以 data URI 内嵌，由同一脚本幂等刷新，离线 / 内置静态预览都能显示）。
- 不使用设计稿中仅用于提案页的类（`.canvas` / `.doc-section` / `.frame` / `.state-grid` 等）。
- 响应式只用 CSS 媒体查询，不引入 JS 断点判断。

## 9. MV3 清单与构建

- `permissions: ["storage", "sidePanel", "unlimitedStorage", "contextMenus"]`；`host_permissions: []`；无 `scripting` / `tabs` / `activeTab` / `clipboardWrite` / `downloads` / `history` / `content_scripts`。`unlimitedStorage` 只解除 `storage.local` 的 10 MB 配额（`QUOTA_BYTES`）；`contextMenus` 只用于注册右键项、没有安装警告；两者都不带来网络或站点访问能力。
- `side_panel.default_path: sidepanel.html`；`background.service_worker: background.js`（type module）；`commands.open-sticky` 快捷键 `Alt+Shift+S`。
- service worker 只做三件事：`onInstalled` 设置点击图标打开侧栏并注册右键菜单、`onCommand` 打开侧栏、`contextMenus.onClicked` 把选中文本交给 core 落盘；不读页面 DOM、不注入脚本、不发网络请求。
- 构建输入 `page.html` + `sidepanel.html` + `src/background/index.ts`；收尾把 `dist/page.html` 落为 `dist/index.html`，在根目录生成转发版 `manifest.json`，并把 `dist/index.html` 的资源前缀改为 `dist/assets/` 后写一份**可运行的根 `index.html`**，使 `site-keys/` 与 `site-keys/dist/` 都能加载。
- 两种加载方式下 `chrome.runtime.getURL('index.html')` 都必须指向真应用页。根 `index.html` **不得用内联脚本做跳转**：MV3 `extension_pages` 的 CSP 禁止内联脚本，转发会静默失败并卡在「正在打开便签本…」。该约束由 `tests/manifest.test.ts` 的 T-27 守卫测试固化。
- 关闭 Vite 的 `modulePreload` polyfill，避免产物混入 `fetch(`。

## 10. 安全约束（守卫测试覆盖）

1. `src/core/` 不引用 `chrome.*` / DOM / `fetch` / `XHR` / `console` / `localStorage`。
2. 唯一引用 `chrome.storage` 的文件是 `src/platform/chromeStores.ts`，带 `typeof chrome !== 'undefined'` 保护。
3. `src/ui/` 与 `src/background/` 不写 `console`、不发网络请求、不调用 `chrome.scripting`。
4. 权限清单恰为四项（`storage` / `sidePanel` / `unlimitedStorage` / `contextMenus`），`host_permissions` 为空，无 `activeTab` / `tabs` / `scripting` / 内容脚本。右键菜单只以 `contexts: ['selection']` 注册一次，且后台源码不得出现 `executeScript` / `tabs.sendMessage` / `window.getSelection`。
5. 只允许本地 `.txt` 读入；**无导出、无备份、无同步、无任何跨设备通道**，UI 源码不得出现 `导出` / `download` / `createObjectURL` / `v-html` / Markdown 解析库。
6. 无「便签转文档」等模块互通功能。
7. 文件选择器 `accept` 恰为 `.txt,text/plain`，不接收 `.md`；导入逻辑不产生任何网络请求。

## 11. 残留风险（写进 README 与界面）

1. 便签与文档内容**明文**存本机；能读 Chrome profile 的程序或人可看到全部内容。
2. 本机任何人打开侧栏即可直接查看、复制、修改、删除，无任何口令保护。
3. 剪贴板内容是明文，可能被其他程序读到。
4. 清 profile / 卸载扩展 = 数据消失，本版**不提供导出备份**。
5. 首次播种的 8 张便签含明文密码，也在源码与构建产物里；请勿把该仓库推到公共远端。
6. 请只放开发 / 测试信息，不要保存个人或生产凭证。
7. 导入的源 `.txt` 是独立明文文件，插件不保管、不删除；单文件 1 MiB / 一次 20 个的上限仍在，但 v4.2 分键后它只影响单次写入体积与启动时的内存占用，不再让每次按键都变卡。编码识别失败时可能得到乱码，需自行检查导入结果。
8. **v4.2 明确未做的持久性**：数据仍只在扩展沙箱内，卸载扩展 / 删除 Chrome profile 时一起消失；`unlimitedStorage` 只管配额，不是备份。要跨过这条边界必须做导出 / 备份，本版按非目标不做（用户本轮选择「只修性能与配额」）。
9. debounce 窗口内若进程被强杀（浏览器崩溃 / 系统断电），最后 250ms 的输入可能来不及落盘；已用 `blur` / `visibilitychange` / `pagehide` 提前 flush 把窗口压到最小。
10. **v4.3 右键保存的边界**：选中内容是明文，存进库后与其它便签同样无口令保护；没有界面打开时保存成功也没有任何提示（下次打开自然在），保存失败若界面未打开同样无法通知。侧栏与全屏页同时打开且**都在编辑同一条**时，仍可能相互覆盖（v3 分键只降低了冲突面，没做跨上下文事务）。右键菜单不会出现在 `chrome://` 等浏览器受保护页面。

## 12. 验收标准

- `npm test` 全绿；`npm run typecheck` 零错误；`npm run build` 成功。
- 产物审计：无 `fetch(` / `XHR` / `chrome.scripting` / `<all_urls>` / `PBKDF2` / `AES-GCM` / `storage.session` / `主密码` / `立即锁定`。
- 源码审计：不存在 v3 的 `notes.ts` / `useNotes.ts` / `.note-card` 单列大卡片样式。
- 视觉守卫：base.css 含设计稿 token 与 2/3/4 列规则；App.vue 含分段切换器、瀑布网格、详情浮层、整页编辑器与文件栏。
- txt 导入守卫：UTF-8 / BOM / GB18030 / UTF-16 解码、文件名取标题、体积与数量上限、批量一次写入、重载后仍存在、便签不受影响；产物无 `v-html` / Markdown 解析库 / 网络调用。
- 扩展图标守卫：四档 PNG 为合法 RGBA、四角透明、主体是白色便签纸，生成脚本不含旧钥匙绘制逻辑；`dist/icons/` 与 `public/icons/` 一致。
- v4.2 分键守卫：v1 / v2 → v3 迁移不丢数据、改一条只写一个条目键、新建 / 导入同批写 meta 与条目、删除同步清键、写入失败不更新内存镜像；`unlimitedStorage` 在权限清单里且 `host_permissions` 仍为空。
- v4.2 真实浏览器抽查：注入假的 `storage.local` 后连打 5 次 → 输入期间 0 次写、debounce 后 1 次写且只含 1 个条目键；模拟写入失败 → 持久「改动没有保存」条幅出现，重试成功后消失，落盘标题为 `retry-ok`。**这仍不是 Chrome 扩展环境真机验收。**
- v4.3 右键保存守卫：空白跳过、标题取首行、v1/v2 迁移前置不丢旧数据、串行两次 / 并发两次不丢、写盘失败不留孤儿且写失败信号、`contextMenus` 恰为第四项权限、菜单只创建一次且 `contexts` 为 `selection`、界面只监听信号键并在 reload 前 flush。
- v4.3 真实浏览器抽查：注入假的扩展 API 后加载**真实 `background.js` 与侧栏产物**，触发 `onInstalled` → 菜单项为「存为便签」/ `['selection']`；连续三次 `onClicked` → 便签 8→9→10→11，新条目始终在最前、成功信号写入、toast 出现；在详情浮层里输入后立刻右键 → 未落盘的编辑内容仍在磁盘上。**这仍不是 Chrome 扩展环境真机右键验收。**
- 真机：侧栏与全屏页都能打开、两个模块切换正常、输入即存、刷新后内容仍在、复制可用。（未在浏览器里实测前不声称通过。）
- 已用无头浏览器加载实际页面跑通完整导入链路（2 个 txt + 1 个 md → 2 篇文档、跳过 md、GBK 解码为「中文测试」、自动切到第一篇），截图在 `design/render/05~07`；**Chrome 扩展环境里的真实文件选择器手工验收仍未执行**。
