# up-broswer-extensions

Browser Extensions of Upthen

仓库按「一个扩展一个子目录」组织，均为 Chrome / Edge Manifest V3、纯本地运行、不依赖服务端。

## 扩展列表

| 目录 | 名称 | 说明 |
| --- | --- | --- |
| [`devbuddy/`](devbuddy/) | 研发好朋友 · DevBuddy | JSON 工具（格式化 / 校验 / 修复 / 树形视图 / JSONPath / 五语言代码生成）、编码转换（Base64 / URL / Unicode / HTML 实体 / JWT 解码）、二维码生成与解码。Vue 3 + TypeScript + Vite，详见 [其 README](devbuddy/README.md) |
| [`history-by-domain/`](history-by-domain/) | 按域名浏览历史 | 按域名整理浏览器历史记录的 MV3 扩展，见目录内 `SPEC.md` 与安装说明 |

## 安装 / 开发

两个扩展都用「加载已解压的扩展程序」安装：打开 `chrome://extensions`（Edge 为 `edge://extensions`）→ 开启右上角「开发者模式」→ 选择对应扩展目录。

DevBuddy 是源码工程，`dist/`、`release/` 与根级 `manifest.json` 由构建生成且不入库，克隆后需先构建：

```bash
cd devbuddy
npm install
npm run build        # 产物在 dist/，同时生成根目录转发版 manifest.json
npm run pack         # 可选：打 zip / crx 安装包到 release/
```

构建后加载 `devbuddy/` 或 `devbuddy/dist/` 都可以。更多脚本（单测、UI 冒烟、截图、扩展验证）见 [devbuddy/README.md](devbuddy/README.md)。

## 许可

见 [LICENSE](LICENSE)。
