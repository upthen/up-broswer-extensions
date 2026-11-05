# 任务拆解与实施计划

## 0. 实施进度（持续更新）

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| M0 立项 | ✅ 完成 | 仓库、README、功能矩阵、技术选型已定 |
| M1 骨架 | ✅ 完成 | MV3 manifest、Vite 多入口（弹窗/全屏/侧边栏/background）、设计 token、storage 封装、图标 |
| M2 引擎 | ✅ 完成 | `core/json` 全套；44 个 Vitest 用例全绿（解析/错误定位/格式化/压缩/排序/转义/修复/统计） |
| M3 编辑器 | ✅ 完成 | 原站 A1–A15 全部可交互；UI 冒烟测试 16 项全绿（`npm run smoke`） |
| M4 增强 | 🟡 第一批完成 | B1 树形视图、B2 JSONPath、B3 代码生成已交付；B4 格式互转、B5 Diff、B6 时间戳、B8 编码工具待下一批 |
| M5 打磨 | 🟡 部分 | 历史记录、主题、字号、快捷键已完成；多语言、Worker 大文件优化待做 |
| M6 发布 | ⏳ 未开始 | 商店素材、隐私说明、打包分发 |

实施中与原计划的偏差（已确认或有明确理由）：

- 原站 `F11` 是页面内全屏，浏览器不给我们拦截系统 `F11`，因此实现为「沉浸模式」（隐藏顶栏 + Esc 退出），按钮与快捷键都保留了。
- 未做右键菜单取词（B7），v1 范围只到 JSON 模块，避免申请多余权限。
- 背景脚本只保留命令与侧边栏唤起逻辑，`permissions` 仍仅 `storage` + `sidePanel`，无 host 权限；第二阶段也未新增任何权限。
- M4 的 JSONPath 没有引入第三方库：MV3 的 CSP 禁止 `eval` / `new Function`，过滤表达式用递归下降解释器求值，因此也是零依赖、可单测。
- 代码生成按「先推断结构、再按语言渲染」拆两层，TS/Go/Java/Python/Rust 共用同一份 Schema，新增语言只需写一个 emit 分支。

### M4 第一批验收记录（2026-11-05）

| 项 | 结果 |
|---|---|
| `npm test` | 79 个用例全绿（json 44 / query 17 / codegen 18） |
| `npm run smoke` | 16 项主流程断言全绿（原 A 组功能无回归） |
| `npm run smoke:views` | 15 项增强视图断言全绿（切换/展开/筛选/过滤/换语言/改根名/切回文本） |
| `npm run typecheck` | 零错误 |
| 视觉校验 | 亮/暗、1280 全屏与 340 侧边栏截图确认无溢出，见 `docs/screenshots/` |
| 扩展加载 | 两种目录加载方式均通过 CDP `Extensions.loadUnpacked` 实测，弹窗/全屏页/侧边栏正常渲染 |

下一批建议顺序：B8 编码工具（Base64/URL/JWT，纯本地、性价比最高）→ B4 格式互转 → B5 Diff。

## 1. 项目定位

| 项 | 内容 |
| --- | --- |
| 中文名 | 研发好朋友 |
| 英文名 | **DevBuddy**（备选：DevMate / DevKit / CodePal，可改） |
| 一句话 | 离线可用的开发者工具箱浏览器扩展，第一个模块复刻锤子工具的 JSON 格式化 |
| 形态 | Chrome / Edge 扩展（Manifest V3），兼容 Firefox 作为后续可选项 |
| 原则 | 数据不出本机；核心逻辑与 UI 解耦；每个工具一个模块，可独立增删 |

## 2. 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 构建 | Vite 5 + TypeScript | 多入口构建（popup / 全页 / options / background / content），产物体积可控 |
| 框架 | Vue 3.5（`<script setup>`） | 目录里已有大量 Vue 工程，认知成本最低；比 React 更轻，适合小工具 |
| 编辑器 | **CodeMirror 6** + `@codemirror/lang-json` | 比 Monaco 小一个数量级（~200KB vs ~3MB），MV3 无 CSP/eval 风险，折叠/查找/错误标注开箱可用 |
| 状态 | 组合式函数 + `reactive`（不引 Pinia） | 单页工具，无需全局 store，少一个依赖少一份复杂度 |
| 样式 | 原生 CSS + 设计 token（CSS 变量） | 避免 Tailwind 构建差异；亮/暗主题靠变量切换，一处改全局 |
| 图标 | Lucide（ISC/MIT，按需 import） | 免费商用、风格统一 |
| 单测 | Vitest | 只测 `src/core`（纯函数），覆盖修复/排序/转义边界用例 |
| 打包 | 手写 `manifest.json` + Vite 多入口 | 不依赖 `@crxjs` 这类维护不稳的插件，构建链可控 |

**不引入的东西**：Monaco、Element Plus/Ant Design（体积与风格都不合适）、任何联网 SDK、任何需要 eval 的模板引擎（MV3 CSP 禁止）。

## 3. 目录结构

```
devbuddy/
├─ public/
│  ├─ manifest.json            # MV3 清单（静态，构建时拷贝）
│  └─ icons/                   # 16/32/48/128 图标
├─ src/
│  ├─ core/                    # 纯函数引擎，零 DOM、零 chrome API，可单测
│  │  ├─ json/
│  │  │  ├─ parse.ts           # 容错解析（A3/A5）
│  │  │  ├─ format.ts          # 格式化 / 压缩 / 缩进（A2/A4）
│  │  │  ├─ sort.ts            # 键排序（A6）
│  │  │  ├─ escape.ts          # 转义 / 反转义（A7）
│  │  │  ├─ repair.ts          # 修复流水线 + 变更诊断（A5）
│  │  │  └─ stat.ts            # 统计（A13）
│  │  ├─ convert/              # YAML/XML/CSV/TOML 互转（B4）
│  │  ├─ codegen/              # TS/Go/Java/Python/Rust（B3）
│  │  ├─ query/                # JSONPath / jq（B2）
│  │  └─ diff/                 # 结构 diff（B5）
│  ├─ ui/
│  │  ├─ App.vue               # 外壳：顶栏 + 侧边模块导航 + 主区
│  │  ├─ pages/
│  │  │  ├─ JsonFormat.vue     # 主页面（对照原站布局）
│  │  │  ├─ Settings.vue
│  │  │  └─ Popup.vue          # 图标弹窗：快速格式化
│  │  ├─ components/
│  │  │  ├─ EditorPane.vue     # CodeMirror 封装（受控、主题、错误标注）
│  │  │  ├─ Toolbar.vue        # 缩进/动作/排序/转义
│  │  │  ├─ SearchBar.vue      # Ctrl+F / Alt+F
│  │  │  ├─ TreeView.vue       # 树形视图（B1）
│  │  │  ├─ StatusBar.vue      # 统计与错误提示
│  │  │  └─ Toast.vue
│  │  ├─ composables/          # useEditor / useHistory / useTheme / useHotkeys
│  │  └─ styles/tokens.css     # 颜色/间距/字号 token，亮暗两套
│  ├─ background/index.ts      # 右键菜单、命令快捷键、下载、跨域 fetch（预留）
│  ├─ content/index.ts         # 页面悬浮球 + 选中文本注入（B7）
│  └─ shared/                  # storage / i18n / message / logger
├─ tests/                      # core 用例
├─ docs/                       # PLAN.md / FEATURES.md
├─ vite.config.ts
└─ tsconfig.json
```

**关键设计**：`core` 里全是 `string → string` / `string → Result` 的纯函数，UI 只是薄壳。好处是——同一套引擎既能给扩展用，将来也能零成本搬去做 CLI 或网站，且能全量单测。

## 4. 里程碑与验收标准

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| **M0 立项**（本次） | 仓库、README、PLAN、功能清单；确认范围与技术选型 | 你确认功能清单与 4 项待定选项 |
| **M1 骨架** | MV3 manifest、Vite 多入口、Vue 外壳、设计 token、图标、storage 封装、消息通道 | `dist/` 能加载进 Chrome，扩展图标点开有 UI，亮暗主题切换正常 |
| **M2 引擎** | `core/json` 全套（解析/格式化/压缩/排序/转义/修复/统计）+ Vitest 用例 | 50+ 边界用例全绿：空串、纯空白、深嵌套、大数组、`\u` 转义、注释、尾逗号、单引号、全角引号、BOM |
| **M3 编辑器** | CodeMirror 集成、双栏、错误定位、查找栏、折叠、全屏、工具栏、拖拽/粘贴/示例、复制下载 | 原站 A1–A15 全部可交互跑通，操作路径与原站一致（含 F11 / Ctrl+F / Alt+F） |
| **M4 增强** | 树形视图、JSONPath、代码生成、格式互转、Diff、时间戳 | 每个增强功能都能独立演示，且不破坏主流程 |
| **M5 打磨** | 历史记录、快捷键自定义、多语言、空态与错误文案、Worker 大文件优化 | 10MB JSON 格式化不卡死主线程（<2s）；所有报错是中文人话 |
| **M6 发布** | 图标/截图/隐私说明、打包 zip、可选上架 | 提交商店材料齐全；或本地 zip 可直接分发 |

预估工作量：M1+2+3 是主体，M4 按功能逐个加，每个功能 0.5–2 小时。

## 5. 主要风险与对策

| 风险 | 对策 |
| --- | --- |
| 容错修复写出「错误的正确结果」 | 修复后必须列出改动点，并保留「原始内容」一键回滚；修复失败明确报错而非静默给半成品 |
| 大文件卡死主线程 | 解析/格式化走 Web Worker；超过 5MB 自动提示并切 Worker；超过 100MB 给出性能警告 |
| CodeMirror 换文档时重建编辑器导致状态丢失 | `EditorView.setState` 更新而非重建；滚动位置与撤销栈按需保留 |
| MV3 CSP 禁 eval | 不引入 eval 类模板引擎；Vite 构建设 `target: es2020`，避免内联脚本 |
| 右键菜单/命令在扩展更新后残留 | 用 `chrome.runtime.onInstalled` 重建菜单，`update` 时先 `removeAll` |
| 中文错误文案与真实解析器报错对不上 | 自研容错解析器统一出「行/列 + 原因 + 建议」，不直接透传 `JSON.parse` 的英文信息 |

## 6. 待你确认

1. **英文名**：用 `DevBuddy` 还是你另定？
2. **v1 范围**：只做 JSON 模块（A 组 15 项），还是顺带把 B8 编码工具/B3 代码生成这类高性价比增强一起做？
3. **扩展形态**：点图标弹窗小工具 + 独立全屏页（推荐），还是直接做成侧边栏 Side Panel？
4. **AI 能力**：v1 完全不做（默认），还是留 BYOK（用户自填 Key）入口？
