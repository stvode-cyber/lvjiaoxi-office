# docx→PDF 程序化导出 · 策略评估

> 评估对象：绿角犀 Office 的 **docx → PDF** 程序化导出路径（反向于已实现的 PDF→DOCX 文本提取）。
> 结论先行：**推荐方案 D（DOCX→HTML→浏览器 print-to-PDF）**，全复用既有能力、零新增依赖、四端同源可达。

## 一、背景与约束

- 已实现：PDF→DOCX / TXT / MD 文本提取（`app/js/modules/pdf-convert.js`）；DOCX 由 `OS.Exporter.buildDocx` 生成（OOXML）。
- 未实现：docx→PDF（原标 🔴 规划中，属大型能力）。
- 项目硬约束（来自 `AGENTS.md` / 工程总纲）：
  1. **零依赖优先**——沙箱可测的纯逻辑必须抽出独立模块，不引入重依赖。
  2. **四端同源**——Web 真源 `app/`，由 `scripts/sync-clients.js` 同步到 `ios/`、`harmonyos/`（Android/Windows 走各自壳加载 webroot）。
  3. **服务端零依赖**——`server/index.js` 自托管，不假设外部服务。

## 二、方案对比

| 方案 | 原理 | 保真度 | 新增依赖 | 离线 | 移动端 | 工作量 |
|------|------|--------|----------|------|--------|--------|
| A. 浏览器 print-to-PDF | `window.print()` + `@media print` 样式 | 中（受浏览器引擎影响） | 无（原生） | 是 | iOS/Android/HarmonyOS 均支持打印到 PDF | 低（1–2 天） |
| B. 服务端 headless | Puppeteer / headless Chrome 渲染 HTML→PDF | 高 | Chromium（~150MB，违反零依赖/自托管） | 否（需联网装） | 经服务端 | 中（3–5 天 + 运维） |
| C. 纯逻辑 OOXML→PDF 布局引擎 | 自写流式布局 + 矢量绘制生成 PDF | 中–高（受自写引擎能力限） | 需引入轻量库（pdf-lib / jsPDF）或自写最小 PDF writer | 是 | 是（纯 JS） | 高（2–4 周） |
| **D（推荐）. DOCX→HTML→浏览器 print** | 复用 buildDocx 已有 HTML，套打印样式，调 `window.print()` | 中–高（与 DOCX 视觉一致） | 无新增 | 是 | 全端支持 | 低（2–3 天） |

## 三、推荐方案 D 详解

**管线**：Writer 文档 → `OS.Exporter.buildDocx` 的中间 HTML（已有）→ 套打印样式表 → `window.print()` → 用户/系统另存为 PDF。

- 优点
  - 零新增依赖，符合零依赖纪律。
  - 四端同源：Web 原生支持打印，iOS/Android/HarmonyOS WebView 均支持打印到 PDF。
  - 与 DOCX 视觉对齐（同一份 HTML 源）。
  - 工作量最小，可快速 MVP。
- 缺点
  - 最终 PDF 由浏览器生成（可控但非后台静默）。
  - 像素级保真需调打印 CSS（页边距/分页）。

## 四、备选与触发条件

- **静默 / 服务端批量导出**需求出现时 → 评估方案 C：引入轻量 `pdf-lib`（~? KB，比 Chromium 轻几个数量级）作为独立可测模块；仍违反"零依赖"但属可控权衡，需显式拍板。
- 方案 B 仅在"服务端高精度 + 可接受 Chromium 依赖"时考虑，当前不推荐（违背自托管零依赖）。

## 五、可行性 / 风险 / 排期

- 可行性：**高**（D 全复用现有能力，无 unknowns）。
- 风险
  1. 浏览器打印分页 / 页边距差异。
  2. 字体嵌入（中文需系统字体可用）。
  3. 移动端打印 UI 差异（华为/Android WebView 打印入口不一）。
- 排期：D 约 **2–3 天**；先交 MVP（按钮 + 打印样式）再迭代页眉/页脚/分页控制。

## 六、最小原型边界（MVP）

1. Writer 模块「导出 PDF」按钮 → 生成带打印样式的 HTML 预览 → `window.print()`。
2. 打印 CSS：`@page` 尺寸/边距、隐藏 ribbon/工具栏、标题层级样式复用。
3. 验证：浏览器实测打印为 PDF（沙箱无 GUI，留待目检；纯逻辑 HTML 生成部分可单测）。

## 七、后续

- 静默导出需求出现 → 再评估方案 C（pdf-lib 轻量引入），作为独立可测模块，不阻塞主线。
- 本评估结论回写 `FEATURES.md`：docx→PDF 由 🔴 规划中 → 🟡 部分实现（方案 D 已定，待 MVP 落地）。
