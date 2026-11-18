# up-broswer-extensions

Browser Extensions of Upthen

仓库按「一个扩展一个子目录」组织，均为 Chrome / Edge Manifest V3、纯本地运行、不依赖服务端。

## 扩展列表

| 目录 | 名称 | 说明 |
| --- | --- | --- |
| [`devbuddy/`](devbuddy/) | 研发好朋友 · DevBuddy | JSON 工具（格式化 / 校验 / 修复 / 树形视图 / JSONPath / 五语言代码生成）、编码转换（Base64 / URL / Unicode / HTML 实体 / JWT 解码）、二维码生成与解码。Vue 3 + TypeScript + Vite，详见 [其 README](devbuddy/README.md) |
| [`history-by-domain/`](history-by-domain/) | 网迹 | 把浏览历史按域名、书签按书签文件夹、当前打开的标签页按域名聚成卡片墙，顶栏分段控件切换三个 tab；历史支持全量搜索、域内限定搜索与按域名清除，书签支持完整管理（新建 / 改名 / 移动 / 删除 / 文件夹树），标签页支持按域名成组关闭、保留本行关闭其他与逐条关闭。MV3 原生 JS 零构建，见目录内 `SPEC.md` §16 / §17、`安装说明.md` 与 `design/mockup.html` |
| [`site-keys/`](site-keys/) | 便签本 · Sticky | **便签小卡片 n*n 网格 + 整页记事本编辑器**双模块，打开就填、输入即存；记事本可导入本地 `.txt`（一个文件一篇文档），网页选中文本可右键「存为便签」。纯本地明文、按条分键增量存储、无口令、无归组、无导出备份。Vue 3 + TypeScript + Vite，见 [其 README](site-keys/README.md)、[SPEC](site-keys/SPEC.md) 与 [设计稿](site-keys/design/mockup.html) |

## 安装 / 开发

三个扩展都用「加载已解压的扩展程序」安装：打开 `chrome://extensions`（Edge 为 `edge://extensions`）→ 开启右上角「开发者模式」→ 选择对应扩展目录。

DevBuddy 是源码工程，`dist/`、`release/` 与根级 `manifest.json` 由构建生成且不入库，克隆后需先构建：

```bash
cd devbuddy
npm install
npm run build        # 产物在 dist/，同时生成根目录转发版 manifest.json
npm run pack         # 可选：打 zip / crx 安装包到 release/
```

构建后加载 `devbuddy/` 或 `devbuddy/dist/` 都可以。更多脚本（单测、UI 冒烟、截图、扩展验证）见 [devbuddy/README.md](devbuddy/README.md)。

Sticky 同为源码工程，需先 `cd site-keys && npm install && npm run build`，再加载 `site-keys/dist/`（推荐）或 `site-keys/`。单测 `npm test`、类型检查 `npm run typecheck`，详见 [site-keys/README.md](site-keys/README.md)。`history-by-domain/` 是零构建原生 JS，可直接加载目录；v1.4.0 起纯逻辑单测用 Node 内置测试运行器（无需安装依赖），在目录内执行 `npm test`。

## 许可

见 [LICENSE](LICENSE)。
