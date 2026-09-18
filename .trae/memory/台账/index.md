# 台账索引

> 按模块组织，快速定位 decisions / issues / 关联文件。
> 每条条目带 `[D]` 决策 或 `[I]` 坑，可点击跳转。

---

## 全局 / 架构

- [D] 版本号四端强制同步 → decisions.md#2026-09-15
- [D] Git 协议统一 HTTPS → decisions.md#2026-09-15
- [D] AI 面板嵌入工具栏 → decisions.md#2026-09-15
- [D] BYOK 密钥 localStorage → decisions.md#2026-09-15
- [D] 历史版本快照 IndexedDB → decisions.md#2026-09-15
- [I] OS 对象 undefined 冷启动炸 → issues.md#2026-09-15
- [I] Toast 容器未挂 body → issues.md#2026-09-15
- [I] koa-connect wrapper ctx 泄漏 → issues.md#2026-09-15
- [I] electron-builder CSC_LINK 空崩 → issues.md#2026-09-15
- [I] 订单/库存/审批残留引用白屏 → issues.md#2026-09-15
- [I] PowerShell 正则引号地狱 → issues.md#2026-09-15
- [I] 硬编码绝对路径跨环境炸 → issues.md#2026-09-15
- [I] shell.js `_on` 局部声明被外层调用 → issues.md#2026-09-15
- 关联文件：app/js/shell.js（已修复 + 坑标签 TODO 已注入）

## Mindmap 思维导图

- [D] 7 色循环主题 + 根节点深色 → decisions.md#2026-09-15
- [I] mkNode 默认颜色 undefined 黑渲染 → issues.md#2026-09-15
- 关联文件：app/js/modules/mindmap.js

## OOXML 导入链

- [I] P0：Electron contextIsolation 下 global ≠ window，JSZip/XLSX 只挂 window → issues.md#2026-09-15
- 关联文件：app/js/import-ooxml.js（已修复 + TODO 标签已注入）
- 影响范围：.xls 静默失败 / .pptx 图片缺失 / .xmind 卡死

## PDF 工具箱

- [D] 深色主题 `.pdf-toolbox-root` 局部作用域 → decisions.md#2026-09-15
- [I] escapeHtml 转发 OS.util Node 环境 undefined → issues.md#2026-09-15
- 关联文件：app/js/modules/pdf-{preflight,docinfo,anno-timeline,encrypt,formfields,history,links,signature}.js

## Sheet 表格

- [D] AI 公式转换本地规则引擎 → decisions.md#2026-09-15（隐含）
- 关联文件：app/js/modules/spreadsheet.js

## Presentation 幻灯片

- [D] 5 段式大纲 + 云端/本地双模式 → decisions.md#2026-09-15（隐含）
- 关联文件：app/js/modules/presentation.js

## CI / 构建

- [D] 更新走 VPS lujax.fun → decisions.md#2026-09-15
- [I] CSC_LINK 无证书崩溃 → issues.md#2026-09-15
- 关联文件：.github/workflows/release.yml / electron/main.js / package.json

## 测试

- [I] 8 红单 = 7 PDF escapeHtml + 1 shell _on 作用域（已修复 → 96/96）
- 关联脚本：scripts/ledger-precheck.js（改前扫坑，零依赖）
- 用法：`node scripts/ledger-precheck.js [路径...]` → exit 1=有文件缺 TODO

---

> **怎么用**：每次新对话开头 Agent 自动读 context.md 简报；改文件前扫 issues.md 命中的坑；做完关键决策追 decisions.md。
