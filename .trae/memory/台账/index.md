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


- [D] PDF→Excel 版面还原：detectTables 精细列边界 + XLSX 真表格（cellStyles:true + !merges 合并） → decisions.md#2026-09-23
- [D] 查找替换跨模块统一：TreeWalker + Range，CSS 全局复用 sf-find-* → decisions.md#2026-09-23
- [D] 快捷键统一在 shell.js handler，不分散到各模块 → decisions.md#2026-09-23
- [I] 台账/拉手.md 里的功能状态可能过时（addVectorAnnotation 已实现但拉手.md 标 P2 未做） → issues.md#ledger-info-stale
- [I] Ctrl+N/O/W/P/Tab 四大基础快捷键全缺失 → issues.md#office-shortcuts-missing
- 关联文件：app/js/shell.js（快捷键 handler L201-L213）+ pdf-engine.js（detectTables L1030-1200）+ writer.js / presentation.js / mindmap.js（openFindPanel）
## Mindmap 思维导图

- [D] 7 色循环主题 + 根节点深色 → decisions.md#2026-09-15
- [I] mkNode 默认颜色 undefined 黑渲染 → issues.md#2026-09-15
- 关联文件：app/js/modules/mindmap.js

## OOXML 导入链

- [I] P0：Electron contextIsolation 下 global ≠ window，JSZip/XLSX 只挂 window → issues.md#2026-09-15
- 关联文件：app/js/import-ooxml.js（已修复 + TODO 标签已注入）
- 影响范围：.xls 静默失败 / .pptx 图片缺失 / .xmind 卡死

- [D] Ctrl+Tab 可视化弹窗：按住选择、松开切换 → decisions.md#2026-09-23
- [D] 快捷键矩阵第二波：F1/F5/Ctrl+Q/Ctrl+R/Ctrl+Shift+T + closeTab 历史栈 → decisions.md#2026-09-23
- [I] 快捷键矩阵测试用字符串包含匹配，改一下函数名就全挂 → issues.md#shortcut-test-fragile
- [D] PDF 暗模式：CSS filter invert + hue-rotate，三态开关（auto/on/off） → decisions.md#2026-09-23
- [D] 台账自动脚本：ledger-precheck（改前防坑） + ledger-posthint（改后提醒） → decisions.md#2026-09-23
- [D] Command Palette 扩展：22 命令 + 模糊搜索 + 分组 + 上下键 → decisions.md#2026-09-23
- [D] 改动台账（自动生成 · 2026-09-23） → decisions.md#2026-09-23
- [D] 快捷键可视化面板：showShortcuts() + 命令面板 + about 弹窗入口 → decisions.md#2026-09-23
- [D] 改动台账（自动生成 · 智能推断 · 2026-09-23） → decisions.md#2026-09-23
- [D] 命令面板动态参数：纯数字输入直接跳转标签 → decisions.md#2026-09-23
- [D] MindMap+Presentation 查找替换补全：DOM 直改不用碰数据模型 → decisions.md#2026-09-24
- [D] 静默更新端到端验证：本地 HTTP server 模拟托管通过 → decisions.md#2026-09-24
- [D] PDF→PPTX 转换：buildPptx 纯图片嵌入零依赖 → decisions.md#2026-09-24
- [D] Ctrl+Z 跨模块统一（Presentation 补 export）+ 静默更新本地端到端验证 + 版本比对铁律 28 断言 → decisions.md#2026-09-24
- [D] Presentation/MindMap 查找替换 undo 修复 + MindMap search/replaceAll 纯函数 → decisions.md#2026-09-24
- [D] 性能优化：MindMap render debounce + selectNodeHighlight + PDF 分批并发 + 缩略图缓存 → decisions.md#2026-09-25
- [D] PDF IntersectionObserver 懒渲染（前 3 页实渲 + 剩余进视口才渲）+ Presentation debounce 回退教训 → decisions.md#2026-09-25b
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

## Tasks / 进度

- [I] tasks-settle-step：settle 后 step 文字不变 → 视觉卡死 95%（已修）
- 关联文件：app/js/tasks.js

## OOXML 导入链（补充 v1.1.1）

- [I] electron-csp-dataurl：Electron CSP 拦 data:URL → PDF 白屏（已修，改用 Uint8Array）
- [I] pptx-zipfile-null：zip.file() 返回 null 调 .async() → 大 PPTX 崩（已修，加 null 防御 + timeout 30s）
- 关联文件：app/js/import-ooxml.js, app/js/modules/pdf.js

## Electron 主进程

- [D] disableHardwareAcceleration（360 安全软件兼容）
- [I] installer-asar-not-updated：安装版 app.asar 不自动同步（流程问题，已建立覆盖步骤）
- 关联文件：electron/main.js, C:\Program Files\lvjiaoxi-office\resources\app.asar
















