# 便签本 · Sticky — 拆票与验收

> 依据：`../SPEC.md` v4.3 与 `../design/mockup.html`（用户已确认的双模块设计稿）｜ 日期：2026-11-13（v4.1 / v4.2 补充：2026-11-16，v4.3 补充：2026-11-17）

## 0. 依赖顺序

```
T-30 规格与拆票（本文）
  └─ T-31 双模块数据模型与存储迁移（RED → GREEN）
       └─ T-32 核心纯逻辑 workspace.ts（RED → GREEN）
            └─ T-33 状态机 useWorkspace.ts（RED → GREEN）
                 ├─ T-34 视觉系统 base.css（RED → GREEN）
                 └─ T-35 双模块 UI App.vue（RED → GREEN）
                      └─ T-36 文档同步与全量验收
                           └─ T-38 记事本导入 txt（v4.1，RED → GREEN）
                                ├─ T-39 扩展图标换成便签本品牌图形（RED → GREEN）
                                └─ T-40 分键增量存储与写入保护（v4.2，RED → GREEN）
                                     └─ T-41 网页选中文本右键存为便签（v4.3，RED → GREEN）
```

**v4.1 决策来源**：grill-me 追问后用户回复「按 1」——一个 txt = 一篇新文档，文件名作标题、支持多选、不追加不覆盖。B~E 由代理按推荐收口：自动识别编码、1 MB / 20 个上限、文件栏 + 下拉双入口、本轮不做 md 渲染、不新增权限。

**v4.2 决策来源**：用户问「能不能弄个 sqlite 存一下，都存浏览器恐怕会影响性能或者长期会丢数据」。核对实现与 Chrome / SQLite 官方文档后给出结论：性能瓶颈是「每次输入整库序列化」，与存储引擎无关；SQLite WASM 的 OPFS 仍在扩展 origin 内，卸载 / 删 profile 时一样被清，且要 COOP/COEP 与独占锁（侧栏 + 全屏页会撞锁）。给出四选项后用户选「按推荐修性能（推荐）」：debounce + 分键增量写 + 写入失败持久提示 + `unlimitedStorage`；**明确不做**磁盘备份 / SQLite / IndexedDB / 导出。

**v4.3 决策来源**：用户要求「在浏览器上选中文本，右键出现存为便签选项，点击存为便签，可将选中内容存为一个便签」。核对 Chrome 资料后确认 `contexts: ['selection']` 的 `OnClickData.selectionText` 由浏览器在右键时直接提供，**不需要 `host_permissions` / 内容脚本 / `activeTab` / `scripting`**；菜单须在 `onInstalled` 里 `removeAll()` 后创建一次（worker 顶层重复 create 会因 duplicate id 报错）。按代理推荐收口：一段选中 = 一张新便签、标题取首个非空行、正文原样、不弹窗、不记来源 URL、界面开着则即时刷新 + toast、没开则静默落盘；只新增 `contextMenus` 一项权限，无安装警告。

沿用 v3 已完成的工程骨架（Vue3 + TS + Vite + Vitest、MV3 manifest、`page.html` / `sidepanel.html` 双入口、`vite.config.ts` 的根页生成、T-27 全屏页守卫）。

## 1. 状态表

| Ticket | 标题 | 状态 | 单测数 |
|---|---|---|---|
| T-30 | 规格与拆票 | 完成 | 1 |
| T-31 | 数据模型与存储迁移 | 完成 | 22 |
| T-32 | 核心纯逻辑 `workspace.ts` | 完成 | 14 |
| T-33 | 状态机 `useWorkspace.ts` | 完成 | 12 |
| T-34 | 视觉系统 `base.css` | 完成 | 7（与 T-35 同文件） |
| T-35 | 双模块 UI `App.vue` | 完成 | 6 + 7（design / security） |
| T-36 | 文档同步与全量验收 | 完成 | 全量 84 |
| T-37 | 全屏页卡死回归（v3 已完成，守卫保留） | 完成 | 4 |
| T-38 | 记事本导入 txt（v4.1） | 完成 | 28 + 3 条守卫修订 |
| T-39 | 扩展图标换成便签本品牌图形 | 完成 | 5 |
| T-40 | 分键增量存储与写入保护（v4.2） | 完成 | 18（另修订 storage / import / manifest / useWorkspace 守卫） |
| T-41 | 网页选中文本右键存为便签（v4.3） | 完成 | 19（另修订 manifest / security / import / incremental 守卫） |

> v4.0 全量结果：8 个测试文件 / **84 用例全绿**；`typecheck` 零错误；`build` 成功；产物审计干净；四张真实渲染截图已存 `design/render/`。
> v4.1 全量结果：9 个测试文件 / **114 用例全绿**；`typecheck` 零错误；`build` 成功；主 JS 89.7 KB（gzip 33.4 KB）；真实浏览器跑通导入链路；新增三张截图 `design/render/05~07`。
> v4.2 全量结果：11 个测试文件 / **137 用例全绿**；`typecheck` 零错误；`build` 成功；主 JS 92.6 KB（gzip 34.3 KB）；真实浏览器注入假 `storage.local` 验证 debounce / 单键写入 / 失败提示与恢复。
> v4.3 全量结果：12 个测试文件 / **158 用例全绿**；`typecheck` 零错误；`build` 成功；真实浏览器加载 `background.js` + 侧栏产物跑通三次右键保存与「详情编辑中收到信号不丢字」。

---

## T-30 · 规格与拆票

- 输入：`design/mockup.html`（双模块提案 v3.1，用户回复「同意此设计，按设计施工」）。
- 产出：`SPEC.md` v4.0、`docs/TICKETS.md` 本文件。
- 明确的设计取舍（写进 SPEC）：两个模块数据**不互通**、不做「便签转文档」；模块切换进 52px 顶栏；便签 2/3/4 列瀑布；记事本全屏左栏 / 窄栏下拉；不预置虚构文档。

## T-31 · 数据模型与存储迁移

- **范围**：`src/core/types.ts`、`src/core/storage.ts`、`src/core/index.ts`。
- **RED**：
  - `WorkspaceFile { version: 2, notes, docs }`；`createEmptyWorkspace()` 返回空结构。
  - 键名 `sticky.workspace.v2`，旧键 `sticky.notes.v1`。
  - `loadWorkspace` 往返一致、坏数据（版本错 / 缺数组 / 元素类型错 / 顶层非对象）一律返回 `null`。
  - **迁移**：只写旧键时，返回 `{ version:2, notes:旧数据, docs:[] }`，同时新键写入、旧键删除；再次加载不重复迁移；新旧键同时存在时以新键为准。
  - `clearWorkspace` 写空结构（保留键，不重新播种）；`clearNotes` 只清 `notes` 保留 `docs`。
- **GREEN**：按 SPEC §4 实现，保证用户 v3 已录入的 8 张便签与编辑内容不丢。
- **验收**：storage 全部用例通过，且 `src/core` 无任何浏览器 API。

## T-32 · 核心纯逻辑 `workspace.ts`

- **范围**：新建 `src/core/workspace.ts`，删除 `src/core/notes.ts`。
- **RED**：`normalizeTitle` 三级兜底且可传 fallback；`addEntry/updateEntry/deleteEntry` 只动指定 kind、不可变、时间戳正确、找不到 id 原样返回；`searchEntries` 多词 AND / 大小写不敏感 / 保留原引用；`sortByUpdated` 降序不改入参；`extractPassword` 中英文冒号与多行取最后；`countChars` 去空白；`excerpt` 截断不改原文。
- **GREEN**：统一条目操作，便签与文档共用函数但数据互不相通。
- **验收**：workspace 全部用例通过；`core` 纯逻辑守卫通过。

## T-33 · 状态机 `useWorkspace.ts`

- **范围**：新建 `src/ui/composables/useWorkspace.ts`，删除 `useNotes.ts`。
- **RED**：
  - `loading → ready`；无库时播种 8 张便签且 `docs` 为空；已有库不重复播种；清空后不补回。
  - `setModule` 切换 `activeModule`；默认 `stickies`。
  - `createNote/updateNote/removeNote`、`createDoc/updateDoc/removeDoc` 立即持久化；两类数据操作互不干扰。
  - `activeDocId` 初始取第一篇；新建文档自动选中；删除当前文档自动选中剩余第一篇，删光置 `null`。
  - `clearNotes()` 只清便签；`readPassword` 行识别；无任何 `setup/unlock/lock` 分支。
- **GREEN**：按 SPEC §6 实现，依赖注入 `local/now/seed/makeId`。
- **验收**：useWorkspace 全部用例通过。

## T-34 · 视觉系统 `base.css`

- **范围**：重写 `src/ui/styles/base.css`。
- **RED**（源码守卫）：
  - `:root` 含设计稿 token：`--accent:#3b5bdb`、`--bg:#f8f8f6`、`--surface-2`、`--accent-soft`、`--shadow-pop`、`--nav-w:240px`、`--topbar-h:52px`、`--card-min:150px`、字号与间距阶梯。
  - 含 `.topbar` / `.seg` / `.stickies` / `.sticky` / `.detail-veil` / `.nb-sidebar` / `.editor__body` / `.float-toast`。
  - `.stickies` 有 2 / 3 / 4 列规则；`.editor__body` 是 textarea 且 `border:0` / `resize:none`（整页书写区无边框）。
  - 不含 v3 的 `.note-card` 大卡片样式；不引用外部字体 / 图片 / CDN。
- **GREEN**：按设计稿 token 落地，响应式只用媒体查询（`<700px` 2 列、`700–899px` 3 列、`≥900px` 4 列；`≥900px` 显示左文件栏并隐藏窄栏下拉）。
- **验收**：design 守卫通过；产物 CSS 无 `http://` / `https://` 外链（SVG namespace 除外）。

## T-35 · 双模块 UI `App.vue`

- **范围**：重写 `src/ui/App.vue`；`src/ui/sidepanel.ts` / `page.ts` 入口不变。
- **RED**（源码守卫）：
  - 顶栏分段切换器含「便签」「记事本」与数量徽章；保留 `getURL('index.html')` + `chrome.tabs.create`（T-27）。
  - 便签模块：`.stickies` 网格、`.sticky` 卡片、hover 角标与「⋯」菜单、`.detail-veil` 详情浮层、搜索 / 新建 / 清空、复制全文 / 复制密码。
  - 记事本模块：`.nb-sidebar` 文件栏、`.nb-bar` 下拉、`.editor__page` 整页编辑器、新建 / 删除 / 切换文档、复制全文。
  - 所有输入走串行写入队列；无保存按钮、无编辑态切换；v4.0 时无 `type="file"`（**v4.1 T-38 按用户新需求解禁，仅限 txt 读入**）。
  - UI 不含「主密码 / 解锁 / scope / 便签转文档」等旧概念或新功能。
  - 不写 `console`、不发网络、不注入脚本。
- **GREEN**：按 SPEC §7 实现，图标用内联 SVG sprite。
- **验收**：design / security 守卫通过，`vue-tsc` 零错误。

## T-36 · 文档同步与全量验收

- 更新 `README.md`（双模块用法、v1→v2 迁移、风险、验收状态）、根目录 `README.md` 条目、`package.json` 版本与描述、工作区记忆。
- 跑 `npm test` / `npm run typecheck` / `npm run build`。
- 产物审计：无 `fetch(` / `XHR` / `chrome.scripting` / `<all_urls>` / `PBKDF2` / `AES-GCM` / `storage.session` / `主密码` / `立即锁定` / `note-card`。
- 视觉抽查：用无头浏览器渲染构建页或静态快照（受 `chrome.storage` 限制时如实说明，不声称真机通过）。

## T-37 · 全屏页卡死回归（v3 已完成，守卫保留）

- 现象：点「全屏打开」停在「正在打开便签本…若没有跳转，请点此。」
- 根因：根 `index.html` 的内联跳转脚本被 MV3 CSP 禁止。
- 修复：`vite.config.ts` 的 `closeBundle` 直接生成可运行的根 `index.html`（资源前缀 `dist/assets/`）。
- 守卫：`tests/manifest.test.ts` 的 T-27 四条，禁止改回转发页。

## T-38 · 记事本导入 txt（v4.1）

- **需求**：用户「给记事本模块新增一个功能，导入 txt 文本文件」，grill-me Q1 选 1（一个 txt = 一篇新文档）；同时询问 md 渲染的性能开销——结论是**性能不是瓶颈，外来 HTML 破坏零网络约束与设计形态才是**，故本轮明确不做 md 渲染。
- **范围**：新增 `src/core/textFile.ts` + `tests/import.test.ts`；改 `useWorkspace.ts`（`importDocs`）、`App.vue`、`base.css`、`core/index.ts`；修订 `tests/security.test.ts` / `tests/design.test.ts` 里的 `type="file"` 禁止断言；文档同步。
- **RED**：删掉旧守卫的禁止断言后先写 28 条新测试，`textFile` 模块不存在导致整个测试文件无法收集 + 2 条守卫失败；随后 core 守卫又抓到新模块注释里写了 `chrome.*` 字面量（真实误伤，已改措辞）。
- **GREEN**：
  - 解码：BOM（UTF-8 / UTF-16LE / UTF-16BE）→ 无 BOM UTF-16LE 的 NUL 特征 → 严格 UTF-8 → GB18030 兜底；正文原样不改写。
  - `planImport()` 纯函数产出 `{ entries, skipped }`；非 txt / 超 1 MB / 超过 20 个 / 解码失败逐个跳过。
  - `importDocs()` 倒序插队、**整批一次落盘**、`activeDocId` 切到第一篇；空批次不写盘。
  - UI 两个「导入 txt」次级按钮 + 一个隐藏多选文件选择器；无预览确认弹窗、无新权限、不缓存文件、不保存路径。
- **验收**：28 条导入测试 + 全量 114 用例通过；产物无 `v-html` / Markdown 解析库 / 网络调用；真实浏览器注入 2 txt + 1 md → 2 篇文档、GBK 正确解码、md 被跳过、自动切到第一篇。
- **明确未做**：`.md` 导入、Markdown 渲染、预览 / 分栏、导出 / 备份、批量改编码、真机系统文件对话框手工验收。

## T-39 · 扩展图标换成便签本品牌图形

- **需求**：用户「插件的 icon 要更新一下，当前还是钥匙」。产品已从账号库重做成便签 / 记事本双模块，但 `public/icons/icon{16,32,48,128}.png` 仍是 v1 的蓝色底 + 白钥匙。
- **范围**：只换图标资源与其生成脚本，不动 manifest（四档路径本就正确）、不动界面内联 SVG、不加权限、不加网络请求。
- **RED**：新增 `tests/icons.test.ts` 5 条守卫，跑出真实红灯——脚本无「便签」且含 `ring/shaft/tooth` 旧绘制变量；128 图标中心区域白色占比仅 0.206（旧钥匙几乎全是蓝底）。
- **GREEN**：重写 `scripts/make-icons.mjs`：
  - 品牌蓝渐变圆角底（`#3b5bdb` / `--accent-hover #2f4cc4`）+ 白色便签纸 + 品牌蓝文字横线；48 / 128 再叠一张 `--highlight #fff2b8` 淡黄便签并画右下折角；16 / 32 用「一张白纸 + 两道粗线」的极简形态保证可辨认。
  - 沿用零依赖手写 PNG（`node:zlib`），新增 4×4 超采样 + alpha 加权平均，圆角与斜边不再有黑边 / 锯齿。
  - `npm run icons` 重新生成 → `npm run build` 复制进 `dist/icons/`。
- **验收**：`npm test` 10 文件 / 119 用例全绿；`typecheck` 零错误；`build` 成功；`public/icons/` 与 `dist/icons/` 四份 SHA-256 逐一一致；128 / 16 目视抽查确认为便签纸、无钥匙残留。
- **文档 / 预览**：`SPEC.md` §8/§12、`README.md`（安装提示 / 目录 / 验收状态）同步；新增 `design/icon-preview.html`（浅色 / 深色工具栏、四档尺寸与放大对照、扩展管理页卡片模拟，纯本地无外链）。内置静态预览服务只提供单个 HTML、不给相对路径图片，因此 `make-icons.mjs` 会把四档 PNG 以 `data URI` 幂等内嵌进预览页（按 `data-icon` 定位替换 `src`），`npm run icons` 连跑两次文件哈希一致。
- **明确未做**：页面 favicon、深色主题反色图标、`.ico` / SVG 版本；Chrome 对扩展页未指定 favicon 时沿用 manifest 图标。真机工具栏图标是否刷新需在 `chrome://extensions` 重新加载后确认（Chrome 有图标缓存）。

## T-40 · 分键增量存储与写入保护（v4.2）

- **需求**：用户担心「都存浏览器会影响性能、长期会丢数据」，问能不能改 SQLite。核对后确认：性能瓶颈是每次 `@input` 都 `saveWorkspace()` 整库序列化；`chrome.storage.local` 配额 10 MB（Chrome 113 及更早 5 MB），而导入上限是 1 MB × 20 个，累计可超配额，写入 reject 只弹 5 秒 toast → 界面看着存了、刷新才发现没存。**SQLite 治不了「长期丢数据」**：OPFS / IndexedDB 同属扩展 origin，卸载 / 删 profile 一起清，还可能被磁盘压力回收；标准 SQLite WASM 要 COOP/COEP + SharedArrayBuffer，OPFS 文件独占锁会和「侧栏 + 全屏页同时打开」冲突。用户选「按推荐修性能」。
- **范围**：`src/core/storage.ts` 重写、`src/platform/chromeStores.ts` 补批量接口、`src/ui/composables/useWorkspace.ts` 改增量提交、`src/ui/App.vue` 加 debounce / flush / 持久错误条幅、`public/manifest.json` 加 `unlimitedStorage`；版本 0.4.1 → 0.4.2。不改 UI 形态、不加备份、不引入任何依赖。
- **RED**：先写 `tests/incremental.test.ts` 18 条守卫，跑出真实红灯（17 失败：新常量 / 批量接口 / 迁移 / 增量写 / 失败保护 / debounce / unlimitedStorage 全不存在）。同步修订 `tests/storage.test.ts` / `import.test.ts` / `useWorkspace.test.ts` / `manifest.test.ts` 里对旧整库键与两项权限的断言。
- **GREEN**：
  - v3 布局：`META_KEY = sticky.workspace.v3` 只存两类 id 顺序，每条便签 / 文档一个 `sticky.note.v3.*` / `sticky.doc.v3.*` 键；`KeyValueStore` 增加 `getAll / setMany / removeMany`，浏览器侧对应 `get(null) / set(items) / remove(keys)`。
  - 迁移：v3 meta → v2 整库 → v1 旧库三级回退；**先写新键、成功后才删旧键**，可重入；坏数据返回 null 不抛错；内存 `WorkspaceFile.version` 仍是 2，避免牵动 UI 与纯逻辑。
  - 增量：`applyWrite()` 先写后删；改一条只写那一个条目键（连 meta 都不动）；新建 / 删除 / 清空 / 批量导入把 meta 与条目放进**同一次 `setMany`**；写盘成功后才更新内存镜像，失败直接抛错。
  - UI：250ms debounce、按条目 key 合并快照（不同条目互不覆盖）；切换视图 / 失焦 / `visibilitychange` / `pagehide` 先 flush；结构操作走 `runAction()` 排队；写入失败显示**持久**「改动没有保存」条幅，直到有一次成功写入才清除。
  - 权限：`unlimitedStorage` 解除 10 MB 配额，`host_permissions` 仍为空。
- **验收**：11 文件 / **137 用例全绿**；`typecheck` 零错误；`build` 成功；主 JS 92.6 KB（gzip 34.3 KB，比 v4.1 只多约 2.9 KB），无新依赖、无网络调用。真实浏览器注入假 `storage.local`：连打 5 次 → 输入期间 0 次写、debounce 后 1 次写且只含 1 个条目键；模拟写入失败 → 持久条幅出现，重试成功后消失，落盘标题 `retry-ok`。
- **明确未做**：导出 / 备份 / 自动写用户磁盘目录、SQLite、IndexedDB、跨设备同步；**卸载扩展 / 删 profile 仍会丢数据**，README 与 SPEC 已如实写明。debounce 250ms 窗口内进程被强杀仍有极小概率丢最后一点输入。真机 Chrome 扩展环境手工验收仍未执行。

## T-41 · 网页选中文本右键存为便签（v4.3）

- **需求**：用户「在浏览器上选中文本，右键出现存为便签选项，点击存为便签，可将选中内容存为一个便签」。
- **事实核对**：`contextMenus` + `contexts: ['selection']` 的 `OnClickData.selectionText` 由浏览器在右键时捕获，无需内容脚本 / `host_permissions` / `activeTab` / `tabs.sendMessage`；MV3 service worker 里 `create()` 的 `onclick` 不可用，必须用 `contextMenus.onClicked`；菜单项属于扩展而非 worker，在 `onInstalled` 里 `removeAll()` → `create()` 幂等注册一次，顶层重复 create 会因 duplicate id 失败。
- **范围**：新增 `src/core/selection.ts`（纯逻辑）、重写 `src/background/index.ts`（第三件事）、`useWorkspace.ts` 加 `reload()`、`App.vue` 加信号监听与 `syncFromController()`、`core/index.ts` 导出、`public/manifest.json` 加 `contextMenus`；版本 0.4.2 → 0.4.3。不改 UI 形态、不加来源 URL、不引入依赖。
- **RED**：先写 `tests/selection.test.ts` 19 条，并在 `manifest.test.ts` / `security.test.ts` / `incremental.test.ts` / `import.test.ts` 修订权限与后台守卫。真实红灯：新模块 `selection.ts` 不存在（整文件加载失败）+ 5 个测试文件 / 6 条用例失败（四项权限、后台菜单注册、core 分层，以及 v4.1 / v4.2 两处旧权限断言）。
- **GREEN**：
  - core：`normalizeSelection()` 只 trim 首尾；`makeSelectionNote()` 标题沿用 `normalizeTitle()`（首个非空行前 24 字）、正文原样；`createSelectionSaver()` 单例持**串行 Promise 队列**，每次先 `loadWorkspace()` 让 v2 / v1 旧库完成迁移，再 `applyWrite()` 把 meta + 条目 + 成功信号放进同一次 `setMany`；空白不写盘，失败写 `ok:false` 信号并抛错、不卡死队列。
  - background：`onInstalled` 里 `removeAll()` → `create({ id: 'sticky-save-selection', title: '存为便签', contexts: ['selection'] })`；`onClicked` 只认该 id，把 `info.selectionText` 交给 saver；`onCommand` / `setPanelBehavior` 原样保留。
  - UI：`storage.onChanged` **只监听** `sticky.selection.v3` 一个键；成功 → `flushWrites()` → `await pending` → `controller.reload()` → `syncFromController()`（重绑详情浮层 draft、清搜索词）→ toast「已存为便签」；失败 → 普通错误提示。抽出 `syncFromController()` 供 init 与 reload 共用。
  - 权限：`contextMenus` 成为第四项，`host_permissions` 仍为空；SPEC §2 / §7.4 / §9 / §10 里沿袭的「两项权限」历史描述一并校正。
- **验收**：12 文件 / **158 用例全绿**；`typecheck` 零错误；`build` 成功；产物审计无 `fetch` / `executeScript` / `window.getSelection` / `<all_urls>` 等。真实浏览器注入假扩展 API、加载**真实 `background.js` 与侧栏产物**：`onInstalled` → 菜单「存为便签」/ `['selection']`；三次 `onClicked` → 便签 8→9→10→11、新条目在最前、成功信号写入、toast 出现；详情浮层输入后立刻右键 → 未落盘内容仍在磁盘上。
- **明确未做**：记录来源 URL / 页面标题、弹窗改标题、自动打开侧栏、桌面通知 / 角标、选中图片或链接、`.md` 解析、跨上下文事务锁、真机系统右键菜单手工验收。

---

## 实现偏差记录（T-36 填写，v4.1 由 T-38 补充，v4.2 由 T-40 补充，v4.3 由 T-41 补充）

1. **记事本不预置文档**：设计稿里的 4 篇文档是明确标注的「示意数据」。实现里不写入虚构内容，首次进入给空状态 + 「＋ 新建文档」，避免用户一打开就要删示例。
2. **新建便签后直接弹出详情浮层**：设计稿只画了「点卡片进入编辑」，没规定新建后的行为。因为卡片本身是只读摘要，新建后必须给一个可输入的地方，所以直接打开浮层并聚焦标题。
3. **宽屏仍保留 sticky 顶栏与工具条**：设计稿在全屏 frame 里把 `.topbar` / `.toolbar` 设为 `static`（那是静态模拟窗口的画法）。实际全屏页内容会滚动，保留 sticky 更好用。
4. **窄栏「＋」按钮**：设计稿窄栏是 34px 方形图标按钮、宽屏是完整文案按钮；实现用同一个按钮 + CSS 隐藏文案，避免两套 DOM。
5. **卡片摘要双保险**：`excerpt()` 先截断到 4 行 / 每行 80 字，CSS 再用 `-webkit-line-clamp:4` 收口；长 URL 不会撑破卡片。
6. **非扩展环境回退到内存存储**：`useWorkspace.ts` 的 defaultDeps 在检测不到 `chrome.storage.local` 时用 `MemoryStore`，仅用于 `npx vite` 本地预览与真实渲染抽查；扩展页面始终写 `chrome.storage.local`，行为未变。
7. **详情浮层 / 编辑器绑定始终非空的 draft 对象**：避免可空值让 `v-model` 类型收窄失败，同时也保住「直接改本地数组对象」的输入即存链路。
8. **真机（Chrome 扩展环境）手工验收仍未执行**：已用无头浏览器加载实际页面完成四个视图的渲染抽查，但 `chrome.storage.local` 的持久化、复制按钮、快捷键需要在真实扩展里确认，README 已如实标注。
9. **v4.1 解禁 `type="file"`**：v4.0 的 SPEC / 守卫把「不做导入导出」一并固化成禁止文件选择器；用户新需求只做**读入**、仍禁导出 / 备份，因此守卫改为「必须含 `type="file"` + `accept` 只收 txt，且不得出现 `导出` / `download` / `v-html` / Markdown 库」。
10. **v4.1 导入体积上限**：当时没有顺手重构 `saveWorkspace` 的整库写入（改动面太大、超出本票范围），改用 1 MB / 20 个上限把风险压住；README 与 SPEC 曾写明「大文档会让每次按键变卡」。**该限制已在 v4.2 T-40 解决**：改为分键增量写后，上限只约束单次写入体积与启动内存，不再影响打字。
11. **v4.1 真实导入链路用的是脚本注入 `File`**：Vite 预览页里向隐藏 input 塞 `DataTransfer` 并派发 `change`，验证的是完整业务链路，**不是**系统文件选择对话框；README 已明确区分，不声称真机通过。
12. **v4.2 保留 `saveWorkspace()` 整库 API**：它只用于首次播种、测试与 `clearWorkspace`，不再出现在输入链路上；保留它比删掉再到处写全量拆分逻辑更安全，也让旧的往返测试能继续覆盖「播种 → 重载」。
13. **v4.2 内存镜像在写盘成功后才更新**：写入失败时 UI 输入框里的草稿仍显示用户刚敲的字（不清空、不打断打字），内存镜像保持旧值，靠持久错误条幅明确告知「没存上」；下一次成功写入会把最新草稿补回镜像。没有做强制覆盖输入框的回滚，那会让光标跳走。
14. **v4.2 的 `unlimitedStorage` 不是备份**：它只解除 `storage.local` 的 10 MB 配额上限；卸载扩展 / 删 profile 仍会清掉全部数据。用户本轮明确选择「只修性能与配额」，因此没有加导出 / 自动写磁盘目录。
15. **v4.3 后台直接写正式便签，不设「收件箱」中转键**：少一层消费逻辑、少一处并发竞争，但必须保证 v2 / v1 旧库先迁移（否则新 meta 会把旧数据挡住），所以 saver 每次先 `loadWorkspace()`，并用串行队列防止连续右键的「读索引 → 写索引」互相覆盖。代价是后台与已打开的 UI 并发写同一个 meta 仍有理论冲突（v3 分键本来就没有跨上下文事务），README / SPEC 已如实标注。
16. **v4.3 全新安装且从未打开界面时右键保存，不补播 8 张示例便签**：此时库里没有 meta，后台建空索引 + 这一条便签即可。这是有意选择——用户主动存的第一条内容不该被示例数据淹没；已安装且打开过界面（或已有旧库）的用户完全不受影响。
17. **v4.3 用「信号键」而不是 `runtime.sendMessage` 或全量 `storage.onChanged`**：全量监听会把刚做好的「增量写」退化成「每次输入落盘后全量读盘」；消息通道在页面未打开 / 正在加载时无法保证送达，还要处理无接收者的报错。一个很小的信号键与 meta / 条目同批原子写入，界面只在收到它时才 reload，零额外权限、侧栏与全屏页自动同步。
