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

## T-42 · 便签详情改为可拖拽底部抽屉，修掉拖拽误关（v4.4）

- **需求**：用户两条反馈——①「编辑区域太小了」；②「便签弹出时点击遮罩默认关闭，导致拖动编辑器大小时误操作点到遮罩，遮罩误关闭，希望点击遮罩不要关闭」。复核后用户改口径：抽屉化之后**保留**点击遮罩关闭，但要求「拖拽时别被当成点击遮罩」。
- **事实核对**：`.detail` 原为 `width:min(460px,100%)` 居中弹窗 + `place-items:center`，高度 auto，正文 `.detail__body` 固定 `min-height:116px`；侧栏再高正文也只有 116px，这是「太小」的真因。误关真因是正文 `resize: vertical` 的原生手柄贴在卡片右下角，指针滑出 3~5px 就落到 `.detail-veil` 上触发 `@click.self` 关闭。
- **范围**：只动 `src/ui/App.vue`（抽屉状态机、拖拽、守卫、Esc）、`src/ui/styles/base.css`（`.detail*` 全套）、`design/mockup.html`、`SPEC.md §7.2`、`README.md`、`tests/design.test.ts`（新增 T-36 组 7 条）、版本 0.4.3 → 0.4.4。不改存储、不改 core、不加依赖、不动记事本模块。
- **GREEN**：
  - 形态：`.detail-veil` 改 `display:flex; align-items:flex-end`，抽屉贴底、上圆角、下无边框，`sheetIn` / `sheetOut` 两个 transform 动画。
  - 形态二期（用户第二轮反馈「看着还是弹窗」+「按钮放顶部更合适」）：面板改**铺满整宽、左右与底部贴边**、只有上沿细线 + `0 -12px 32px` 向上投影、内容列 `max-width:720px` 居中；遮罩 `.34` → `.18`。`复制全文 / 复制密码 / 删除` 收敛成头部图标按钮，`完成` 主色，`×` 收尾，`.detail__foot` 整块删除，底部不再被按钮条切掉一截。
  - 形态三期（用户第三轮反馈「这块 UI 太奇怪，哪里像个编辑记事本」）：问题不在配色而在**编辑区被做成了表单控件**——`1px` 边框 + `--surface-2` 灰底 + 蓝色 focus 环，3 行内容落在 500px 高的框里。改为纸面：标题 `--fs-xl`（宽屏 `--fs-2xl`）、`letter-spacing:-.4px`；正文等宽 13px / 1.9（宽屏 14px / 1.95）、**无边框 · 无底色 · 无 focus 环**、`caret-color: accent`、`::selection: highlight`；`.detail__head` 改左侧「字数 · 时间」+ 右侧按钮，并加一道 1px 下边线把操作栏和纸面分开，原来的「编辑便签」标签删掉（标题本身就是语境）。
  - 形态四期（用户第四轮反馈「关闭和最大化做成苹果电脑窗口那种交互」）：头部最左加 `.detail__lights` 三色圆点（`#ff5f57` / `#febc2e` / `#28c840`），静止是圆点、整组悬停才由 `::after` 显出 `× − +`；红=关闭、绿=50%/80% 最大化切换（复用 `toggleSheetHeight()`）、黄=收起成 `SHEET_COLLAPSED_PX=54` 的底部细条，再按黄灯 / 点细条 / 按绿灯都能展开。收起态隐藏标题、正文、字数，只留「便签已收起 · 点这里展开」；收起前高度存在 `heightBeforeMinimize` 内存变量，不写盘，`onViewportResize()` 也跳过 clamp。原来的 × 按钮删掉，由红灯接替。
  - 高度：`clampSheet()` 把 `max(30vh,200px)` ~ `min(80vh,100vh-16px)` 夹住，初始 50vh；正文 `flex:1 1 auto; min-height:60px; resize:none`，吃掉抽屉剩余高度。
  - 拖拽：`.detail__grip`（36×4px 横杠）与 `.detail__head`（`closest('button,input,…')` 排除按钮）共用一个 pointerdown 入口，`setPointerCapture` + 4px 阈值；自由高度不吸附；双击把手在 50% / 80% 归位。
  - 防误关三层：指针捕获让 `pointerup` 落在抽屉上（`click` 目标是把手而非遮罩）；`dragEndedAt` + 250ms 时间闸；`onVeilClick()` 首行判 `dragPointer !== null` 直接 return。**下拉到底不关闭**。
  - 关闭出口：遮罩、红灯、「完成」、`Esc`（`isComposing` / `keyCode 229` 忽略，避免中文输入法取消候选词时误关）；`closeDetail()` 先 `flushWrites()` 再播 160ms 下滑，`closing` 锁重复关闭。三个窗口按钮全部 `@click.stop`，否则黄灯的 click 会冒泡到 `.detail__head` 的「点细条展开」，刚收起就被立刻还原。
  - 记忆：`sticky.sheet.h.panel` / `sticky.sheet.h.page` 按 sidepanel / 全屏页分键存 `localStorage`，读写都 try/catch，隐私模式下静默退回 50vh。
- **验收**：12 文件 / **169 用例全绿**（158 + 抽屉 7 + 三灯 4）；`typecheck` 零错误；`build` 成功；headless Chrome 实测收起 54px → 还原 393px → 最大化 628px → 收起态最大化 628px → 红灯关闭，全部符合预期。
- **明确未做**：下拉关闭、吸附档位、遮罩点击切换便签、抽屉内富文本、记事本编辑器改造、真机触屏手势验收。

---

## T-43 · 记事本支持 Markdown 渲染（v5.0）

- **需求**：用户一句「记事本需支持 markdown 格式文本渲染」。v4.1 的守卫曾明确写死「不渲染 md」，本票正式推翻该约束。
- **范围**：新增 `src/core/markdown.ts`（纯函数渲染器）与 `tests/markdown.test.ts`；改 `src/ui/App.vue`（三档视图、`renderedDoc`、标题去重）、`src/ui/styles/base.css`（`.editor__pane*` / `.md*` / `.md-check`）、`tests/design.test.ts`、`tests/import.test.ts`、`tests/security.test.ts`、`SPEC.md`（v5.0 声明 + §7.3.1）、`README.md`、版本 0.4.4 → 0.5.0。不动存储、不加依赖、不新增权限。
- **GREEN**：
  - 渲染器：先整段 `escapeHtml`（`& < > " '`），再按块解析 + 只拼白名单标签；行内代码先抽占位符，避免代码里的 `*` `_` 被当成强调；链接 / 图片走 `http(s)` / `mailto` / 相对路径白名单，`javascript:` / `data:` 降级为字面文本。
  - 支持范围：ATX 标题、`**粗**` / `*斜*` / `~~删~~`、反引号行内代码、围栏代码块（语言 class）、引用（递归渲染块）、有序 / 无序 / 嵌套列表、任务列表、GFM 表格（含 `:---` 对齐）、`---`、段落内单换行转 `<br />`。
  - 视图：`.editor__bar` 加 `.seg.seg--sm`「编辑 / 分栏 / 预览」；`.editor__page.is-split` 两列 grid、预览列中缝 1px；`.is-preview` 单列、内容限宽 760 居中。宽屏（≥900px）默认分栏、侧栏默认编辑；偏好写 `sticky.doc.view`，窗口拖窄时从分栏自动退回编辑。
  - 标题去重：`showDocHeading` 检测正文首个非空行，已是 `#` 标题就不补 `.md-doc-title`，避免截图里出现两条一样的 H1。
  - 任务框：用 `.md-check` 只读 span（完成态主色底 + 白色对勾），不用原生 `disabled` checkbox——禁用态在浅色背景上明显发灰。
- **验收**：13 文件 / **185 用例全绿**（原 169 + markdown 13 + 视图 3）；`typecheck` 零错误；`build` 成功；无头 Chrome 实测 1280px 分栏与 500px 预览两种形态，标题、任务框、代码块、表格均正确，无重复标题、无溢出。
- **明确未做**：所见即所得（行内编辑渲染结果）、便签抽屉里的 Markdown、代码高亮、脚注 / 定义列表 / 自动链接、图片上传与本地文件引用、导出 / 打印。

---

---

## T-44 · 记事本改成所见即所得编辑（v5.1）

- **需求**：Markdown 支持行内编辑——写的时候就该看到排版，而不是「左边源码右边预览」。
- **交互决策**：
  - 视图从「编辑 / 分栏 / 预览」三档收敛成「编辑（所见即所得）/ 源码」两档；所见即所得是默认。既然编辑区本身就是渲染结果，分栏与纯预览都成了同一份内容的重复呈现。
  - 表格按「单元格内联可编辑」实现：点进 `td` / `th` 直接改，序列化还原成管道行与对齐标记。
- **数据流**：**DOM 是编辑期唯一真源，Markdown 是序列化产物**。`state.content` 仍存 Markdown 纯文本，导入、复制全文、增量写入、便签数据全部不受影响；只有切文档 / 撤销时才整体重渲染。
- **实现拆分**：
  - `src/ui/editor/rules.ts`：行首块级标记与行内闭合标记的**纯正则判定**，不碰 DOM，可单测。
  - `src/ui/editor/caret.ts`：`closestBlock` / `caretOffset` / `setCaret`，把光标统一表示成「块 + 块内字符偏移」。改完 DOM 再按偏移还原，是整套交互的地基。
  - `src/ui/editor/serialize.ts`：DOM → Markdown。只认 `renderMarkdown` 产出的白名单标签，不认识的节点降级成纯文本。
  - `src/ui/editor/history.ts`：模块单例快照栈（Markdown + 块序号 + 块内偏移）。
  - `src/ui/MarkdownEditor.vue`：把上面四块接起来，负责渲染、回车拆块、Tab 缩进、退格合并、粘贴、撤销、输入法守卫。
- **安全**：全仓**不再有 `v-html`**，编辑器只用 `renderMarkdown()` 的转义结果填 `innerHTML`；反向走 `blocksToMarkdown()`。粘贴一律只取 `text/plain`，多行再交给本地渲染器。攻击面比 v5.0 更小。
- **验收**：`typecheck` 0 错误，**226 用例全绿**（新增 `rules` 17、`markdownEditor` 14、`history` 8，共 39 条；改写 5 条旧用例）；`build` 通过。无头 Chrome 实测：`## ` → h2、`- ` → 列表、Tab 缩进、`**粗**` → strong、列表项退格合并、`Ctrl+Z` 还原、多行粘贴拆块、表格改单元格后序列化正确。
- **明确未做**：代码块语法高亮、图片拖拽上传、脚注 / 定义列表、跨块选区拖拽、表格列宽拖拽与行列增删。

## T-45 · 记事本回到「左源码 / 右预览」（v5.2）

- **需求**：v5.1 的所见即所得 bug 太多，改回左侧 Markdown 源码、右侧渲染效果的分栏模式。
- **决策**：
  - 视图改为「分栏 / 源码 / 预览」三档，**分栏是默认**；切换用 `v-show` 而不是 `v-if`，文本域不重建，原生撤销栈、光标、选区都还在。
  - 放弃 DOM 反向序列化、自建撤销栈、光标偏移、回车拆块、Tab 缩进、行内输入即转这一整套逻辑，`src/ui/editor/` 四个模块整体删除。**Markdown 文本是唯一真源，预览是派生物**。
  - 文本域用 `v-model` 绑定到 `computed({ get, set })`，写回沿用原有 250ms 节流；`v-model` 自带 `compositionstart` / `compositionend` 守卫，中文组字不再需要手写状态机。
- **布局**：
  - `.mdx` 两列 grid（`minmax(0,1fr) × 2`），左列等宽 13px / 1.9、无边框无 focus 环，右列滚动 + 左侧 1px 分隔线；内容列仍收在 760px。
  - `max-width: 899px` 自动叠成上下两栏（源码在上、预览在下），侧栏里不做两列各 190px 的硬挤。
  - 两栏各自滚动：源码滚动按比例带动预览，预览不回推；重排 `innerHTML` 前记住阅读比例、重排后还原，长文档不会每敲一个字就弹回顶部。
- **安全**：预览仍只接 `renderMarkdown()` 的转义结果（全仓无 `v-html`），源码是纯文本域，外部 HTML 连进入的机会都没有。
- **验收**：`typecheck` 0 错误，**193 用例全绿**（删除 `rules` / `history` 两套旧用例，`markdownEditor` 改写为组件级 5 条，新增 `design` T-45 6 条）；`build` 通过，主 JS 99.85 KB（gzip 37.29 KB），比 v5.1 少约 12 KB。无头 Chrome 实测：1280px 分栏（左源码右预览、分隔线居中）、500px 上下叠放、纯源码 / 纯预览两档均无溢出与错位。
- **明确未做**：代码块语法高亮、工具栏插入按钮（粗体 / 链接等）、列表回车自动续行、滚动位置逐块对齐（用的是整栏比例）。

## 实现偏差记录（T-36 填写，v4.1 由 T-38 补充，v4.2 由 T-40 补充，v4.3 由 T-41 补充，v4.4 由 T-42 补充，v5.0 由 T-43 补充，v5.1 由 T-44 补充，v5.2 由 T-45 补充）

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
18. **v4.4 遮罩点击关闭按要求保留，靠事件层而非「禁掉关闭」来防误关**：用户最终选择保留遮罩关闭（不是彻底删掉），所以修复点在「拖拽不应产生一次遮罩点击」——指针捕获 + 4px 阈值 + 250ms 时间闸，而不是把 `@click.self` 删掉。代价是：真的空闲状态下点了遮罩仍会关闭，这是用户明确接受的行为，不再二次确认。
19. **v4.4 鼠标不 `preventDefault()`，触摸才 `preventDefault()`**：对 `pointerdown` 调 `preventDefault()` 会连带吞掉兼容鼠标事件，`dblclick` 随之失效，双击归位就没了；触摸 / 触控笔仍需它来挡合成 click，配合 `touch-action:none` 双保险。
20. **v4.4 抽屉高度上限同时受 80vh 与 `100vh - 16px` 约束**：只留 80% 时，全屏页顶部那条遮罩会高到让人以为抽屉没弹出来；留 16px 的缝既是视觉锚点，也保证任何窗口下抽屉都不会顶到屏幕最上沿。视口极小时两个约束可能打架，`Math.max(sheetMinPx(), …)` 让下限优先，正文不至于被压成 0。
21. **v4.4 抽屉「不像弹窗」靠的是三处几何，不是加动画**：①面板 `width:100%` 左右贴边（只有内容列 720px 居中，白底铺满整宽）；②只保留上沿细线 + 向上的投影，删掉四周的 `--shadow-pop`；③遮罩从 `.34` 降到 `.18`。任何一条留着，看起来都还是「浮在中间、从底下弹出来的卡片」。
22. **v4.4 按钮上移后仍保留「×」**：头部同时有主色「完成」和「×」，语义重复但照顾两套肌肉记忆（点按钮 vs 点右上角）；窄侧栏（≤430px）藏掉「字数 · 更新时间」后，`编辑便签 + 3 图标 + 完成 + ×` 在 360px 内容宽度里仍有余量。
23. **v4.4 用无头 Chrome 截图核形态时踩了坑**：`--window-size=400,780` 在本机 headless 下 `innerWidth` 实测是 500（窗口最小值），按 400 截图会把右侧裁掉，很容易误判成「按钮被挤出屏幕」。定位布局问题先打印 `innerWidth / scrollWidth / clientWidth`，不要只看截图。
24. **v4.4 编辑区「像记事本」的关键是删掉表单壳，不是加装饰**：边框 + 灰底 + focus 环会把 textarea 明确读成"输入控件"，内容再少就像一张没填完的表。改法是把标题提到 `--fs-xl` 当文档标题、正文直接落在面板白底上、只保留操作栏下的一道 1px 线；没有加横格纸背景——12px/1.9 的行高与 repeating-gradient 很难严格对齐，一旦错半像素就是廉价的"假笔记本"。
25. **v4.4 头部删掉「编辑便签」标签**：抽屉弹在便签网格上方，标题本身就是语境，加标签只是和标题抢层级；标签位改成「字数 · 更新时间」，反而多给了两条有用信息。`≤430px` 时这两条也会隐藏，只留按钮。
26. **v4.4 窗口按钮必须 `@click.stop`**：头部承担「点细条展开」的点击职责，三灯的 click 一旦冒泡就会触发 `onHeadClick()`，实测点黄灯高度从 393px → 54px → 立刻弹回 393px，看起来像按钮失灵。三个按钮统一加 `.stop` 后正常；收起态还复用 `dragEndedAt` 时间闸，避免拖完松手的一瞬被当成展开意图。
27. **v4.4 收起高度不进 `clampSheet()` 也不写盘**：54px 远低于 30% 下限，若走 `clampSheet()` 会被弹回 200px；若写进 `localStorage`，下次打开便签就直接是一条细缝。`heightBeforeMinimize` 只活在内存里，窗口 resize 时也特意跳过 clamp，这是收起态能成立的边界条件。
28. **v5.0 不引 `marked` / `markdown-it` / `DOMPurify`**：扩展页面里 `v-html` 的安全边界必须自己说了算。第三方解析器默认保留原始 HTML，还要再叠一层消毒库；两条依赖换来的语法完整度，对这个只渲染自己笔记的场景不值。自写渲染器的策略更窄也更硬——**输入先整体转义，之后只可能拼出白名单标签**，`onerror=` 这类属性连进入 HTML 的机会都没有。代价是不支持内联 HTML、脚注、定义列表等长尾语法，已在 SPEC 中列明。
29. **v5.0 分栏只在 ≥900px 提供**：400px 侧栏两列各 190px，长 URL 和代码块会挤成竖条，体验比单栏更差。因此窄栏只保留「编辑 / 预览」，分栏按钮用 CSS 隐藏；若用户在宽屏选了分栏再把窗口拖窄，`onViewportResize()` 会退回编辑，但**不会**在拖宽时自动升级——避免替用户做选择。
30. **v5.0 预览不无条件加文档标题**：文档标题是元数据，正文里的 `#` 才是内容。第一版无条件渲染 `.md-doc-title`，截图里出现了「标题栏 / 合成 H1 / 正文 H1」三层重复；改为正文首行已是标题时跳过合成标题，空文档仍补一个「未命名文档」占位。
31. **v5.0 任务框不用原生 checkbox**：`disabled` 的 checkbox 在浅色纸面上会被浏览器压成半透明灰块，完成态几乎看不出主色。改成 `.md-check` + `::after` 画的白色对勾，颜色完全跟随 token；它本身只读，所以用 `aria-hidden` 的 span 而不是假装可交互的控件。
32. **v5.0 改了 v4.1 的「不渲染 md」守卫，而不是删掉它**：旧用例把 `v-html`、`marked` 一类词全部列为禁止项，本票的需求正好推翻前提。处理方式是把守卫改写成「`v-html` 只能接 `renderedDoc`、必须来自 `core/markdown`，仍禁第三方解析 / 消毒库与任何导出下载」——约束从「不许做」变成「只许这样做」，防止以后有人顺手引一个库把转义链绕过去。
33. **v5.1 不用浏览器原生撤销**：所有结构改写都是 JS 直接动 DOM（`**粗**` → `<strong>`、回车拆块、退格合并），这些改动不进原生 undo 栈，Ctrl+Z 会还原出一个和 Markdown 源对不上的 DOM。改成自存「Markdown + 块序号 + 块内偏移」快照；500ms 内连续输入合并一步，否则打一句中文要按几十次撤销。
34. **v5.1 撤销栈必须是模块单例**：写在 `<script setup>` 里的「顶层变量」其实是每个实例各一份——切到「源码」再切回来自动销毁重建，实例级栈会跟着清空。实测时表现为「合并完切一下视图，Ctrl+Z 就没反应」。抽到 `editor/history.ts` 后靠 `syncDocument()` 区分「切视图（内容相同，保留）」和「换文档（内容不同，清空）」。
35. **v5.1 退格合并改了 DOM 必须立刻回写**：`handleBackspace` 只改 DOM，漏了 `emitValue()`，父组件的 `docDraft.content` 还是旧的；一切视图就按旧内容重渲染，合并结果被无声还原。同样的问题差点出现在粘贴上——凡是「改 DOM 但不经 `input` 事件」的路径，都要显式回写。
36. **v5.1 列表项里只认任务框标记**：早期版本在 `<li>` 里也执行标题 / 引用转换，会把 `<blockquote>`、`<h2>` 塞进 `<ul>`，产出非法结构；`- ` 重复输入还会把用户刚敲的符号吃掉。改成列表项内只转换 `[ ] ` → 任务框，其余标记一律当普通文字。
37. **v5.1 多行粘贴不往当前块里灌**：第一版把多行文本按 `<br>` 全塞进光标所在块，粘到标题里就变成「# 标题粘贴进来的」——标题被污染。改成「先拆块，再把解析后的节点插到新空段之前」，光标留在空段里可以接着写；代码块内仍按纯文本插入。
38. **v5.1 表格左对齐要显式输出 `:---`**：`renderMarkdown` 原先对 `:---` 返回空 align（等于不加 `style`），序列化回 Markdown 时就会退化成 `---`。虽然不是语义错误（默认就是左对齐），但用户的原始写法被悄悄改了；改成左对齐也输出 `text-align:left`，往返才真正无损。
39. **v5.1 正文首行 H1 直接当文档标题**：有了所见即所得，「第一行写 `# 标题`」变得非常自然，结果页面上出现「标题输入框 + 正文 H1」两条一样的标题。改成首行是 H1 时把它写回 `doc.title` 并收起标题输入框——同一份信息只出现一次，侧栏和顶栏也跟着同步。
40. **v5.1 测试补了 `happy-dom`（仅 devDependency）**：序列化是「数据会不会丢」的问题，靠无头浏览器逐项点太低效。用 happy-dom 在 vitest 里跑真实的 `document`，把「渲染 → 序列化 → 再渲染」的往返钉成 14 条断言（含嵌套列表、任务框、表格对齐、代码块、幂等性）。它不进扩展产物，只是测试环境。
41. **v5.2 选择「退回去」而不是继续修所见即所得**：v5.1 的 bug 都出在同一处——只要用户输入后要「就地改写 DOM」，就必须自己接管光标、拆块、合并、撤销、输入法，任何一条漏了都会在真机上暴露。分栏模式下这些全交回浏览器，代码量从 645 行降到 100 行以内。代价是失去了「写 `## ` 立刻变标题」的即时感，用右侧实时预览补偿；这是用户明确要求的取舍。
42. **v5.2 三档视图都留在工具条上，不按宽度藏按钮**：v5.0 曾在窄栏用 CSS 藏掉「分栏」，结果用户不知道这个功能存在。这一版窄栏保留按钮，只是把分栏降级成上下叠放——按钮点了始终有可见反馈，比「按宽度消失」更可预期。
