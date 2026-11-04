# 研发好朋友 · DevBuddy

一个纯本地的开发者工具箱浏览器扩展（Chrome / Edge，MV3）。第一模块复刻
[toolhelper.cn 的 JSON 格式化](https://www.toolhelper.cn/JSON/JSONFormat)，后续按插件化方式扩展更多开发小工具。

**核心理念：数据不出本机。** 所有解析、格式化、转换、生成都在浏览器内完成，不联网、不上传、不登录。

## 文档

- [docs/PLAN.md](docs/PLAN.md) — 任务拆解、技术选型、里程碑、验收标准
- [docs/FEATURES.md](docs/FEATURES.md) — 功能清单（可做 / 需服务端 / 做不了 / 收费项）

## 开发

```bash
npm install
npm run dev      # 监听构建，产出 dist/
npm run build    # 生产构建
npm test         # 单元测试（core 纯函数）
```

加载方式：`chrome://extensions` → 开启开发者模式 → 加载已解压的扩展程序 → 选择 `dist/`。

## 目录约定

- `src/core/**` 只放纯函数，不碰 DOM / chrome API，必须可单测。
- `src/ui/**` 只放视图与交互，业务逻辑一律从 `core` 调用。
- `src/shared/**` 放跨上下文能力（storage / i18n / 消息 / 日志）。
