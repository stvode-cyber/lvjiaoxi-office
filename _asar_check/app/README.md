# 绿角犀 Office · 跨平台办公套件（原型）

基于《类 WPS 办公套件 · 产品设计文档 v3.0（去商业化版）》实现的**跨平台办公套件原型**。
采用「统一核心 + 原生壳」架构（PRD §关键技术设计），核心为纯 Web 应用，可运行于任意带浏览器的平台，并可通过 Electron / Tauri / PWA 封装到桌面与移动端。

## 运行方式

### 方式一：直接打开（最简单）
双击 `index.html` 即可在浏览器中运行（无需联网即可使用 Writer / Spreadsheet / Presentation / MindMap 四大模块；PDF 阅读与 OOXML/OFD 导入导出需联网加载 JSZip，离线会自动提示）。

### 方式二：本地静态服务器（推荐，启用 PWA / Service Worker / 跨域文件读取）
```bash
# 使用 Python
cd app && python -m http.server 8080
# 或 Node
cd app && npx serve .
# 浏览器访问 http://localhost:8080
```

## 已实现能力（对应 PRD 模块）

| 模块 | PRD 章节 | 原型能力 |
|------|----------|----------|
| Writer 文字处理 | 3.1 | 流式排版、标题/样式、加粗/斜体/下划线/删除线、对齐、项目符号/编号、缩进、表格、图片、链接、撤销/重做；导出 HTML/**DOCX(原生)**/PDF/TXT |
| Spreadsheet 表格 | 3.2 | 自研公式引擎（兼容 Excel 函数集，约 35 个函数：SUM/AVERAGE/IF/VLOOKUP/ROUND…）、单元格格式、冻结窗格、导出 CSV/HTML/JSON/PDF/**XLSX(原生)** |
| Presentation 演示 | 3.3 | 幻灯片编辑、文本框/形状、母版背景、演讲者视图（上一页/下一页/预览）、导出 JSON/PDF/PNG/**PPTX(原生)**/**OFD(国标版式)** |
| PDF 工具 | 3.4 | 基于 PDF.js 的阅读（页面跳转/缩放）、合并/拆分（零依赖字节级，支持常见 PDF 1.4 内联对象）、批注（高亮/画笔/文字批注/矩形/签名印章，覆盖层 + 文档内持久化 + 扁平化导出）、文本层/全文搜索、表单填写（文本框/复选框）、**文本提取导出 DOCX（按坐标聚类成行、大字号判标题，版面还原有限）** |
| MindMap 脑图/图示 | 6 | 思维导图树形自动布局、自由流程图（节点+连线）、节点增删改/拖拽/缩放、双击编辑、导出 SVG/PNG/JSON、导入 JSON |
| 文件导入 | 3.1 / 附录 A | 结构化导入 **DOCX / XLSX / PPTX**（OOXML）、**ODT / ODS / ODP**（ODF）、**OFD**（国标 GB/T 33190 版式文档，按页面映射到演示幻灯片）；保留标题/格式/列表/表格/超链接/公式/版式坐标；导入文档兼容等级标记为 B |
| 文件导出 | 3.1 | **原生导出（无 CDN 转换库）**：Writer→DOCX、Spreadsheet→XLSX（值+公式）、Presentation→PPTX、Presentation/Writer→OFD；导出的文件可被本套件再导入，构成**往返闭环** |
| 统一存储 | 附录 A | IndexedDB 本地文档库 + UOM 文档模型；自动保存、最近文档、兼容等级徽章 |
| 设计系统 | 九 | 浅色/深色双主题、8px 栅格、命令面板（Ctrl/Cmd+K）、键盘快捷键 |
| AI / 数据不出域 | 3.6.5 | 设置中提供「数据不出域」开关（混合调度决策树本地兜底） |

## 架构

```
app/
├── index.html            # 应用外壳（仪表盘 + 编辑器区 + 覆盖层）
├── manifest.webmanifest  # PWA 清单（可安装到所有平台）
├── sw.js                 # Service Worker（离线缓存应用外壳）
├── icon.svg
├── css/style.css         # 设计系统（双主题）
└── js/
    ├── util.js           # 全局命名空间 OS、主题、设置、Toast、下载
    ├── store.js          # IndexedDB 存储 + UOM 文档模型
    ├── shell.js          # 外壳控制器：标签/功能区调度/导入导出/命令面板/账户
    ├── import-ooxml.js  # 结构化文件导入（OOXML: docx/xlsx/pptx · ODF: odt/ods/odp · OFD 国标版式）
    ├── export-ooxml.js  # 原生文件导出（DOCX / XLSX / PPTX / OFD，JSZip 打包，可往返导入）
    └── modules/
        ├── writer.js       # 文字处理
        ├── spreadsheet.js  # 表格 + 自研公式引擎 (OS.FormulaEngine)
        ├── presentation.js # 演示
        ├── pdf.js          # PDF 阅读
        └── mindmap.js      # 脑图 / 图示 (PRD 6)
```

**跨平台核心思路**：所有编辑逻辑运行在浏览器（Web 标准），各端"原生壳"仅负责承载与令牌/生物识别桥接（PRD §关键技术设计）。模块通过统一契约挂载：
`OS.modules[type].mount(host, doc, ctx) → { serialize(), exportAs(fmt), destroy() }`，
外壳负责调度、功能区注入、自动保存与跨文档存储。

## 跨平台打包

- **Web / PWA**：已内置 manifest + Service Worker，localhost/https 下可被「安装到桌面/主屏」，离线可用。
- **桌面（Windows / macOS / Linux）**：用 Electron 或 Tauri 加载本目录即可。
  - Electron：`new BrowserWindow({ webPreferences:{contextIsolation:true} })` 指向 `index.html`（file 协议）或本地服务。
  - Tauri（`tauri.conf.json` → `distDir: "app"`, `devPath: "http://localhost:8080"`）。
- **移动端（Android / iOS）**：Capacitor 将本目录作为 Web 资源打包；或 PWA「添加到主屏幕」。

## 已知边界（原型范围）

- 公式引擎覆盖常用函数子集，未含数组公式/动态数组溢出、宏（VBA/JS 沙箱）。
- 文件导入为**结构化（非像素级）**：DOCX/XLSX/PPTX/ODT/ODS/ODP/OFD 经 DOMParser 解析，保留标题/格式/列表/表格/超链接/公式/版式坐标，但复杂版面（文本框绕排、分栏、批注修订、母版主题、图表对象、OFD 矢量图形与图片）未完全还原，兼容等级 **B**（PRD 3.1 兼容性矩阵）。OFD 为固定版式格式，按页面映射为演示幻灯片，可继续编辑文本。
- 实时协同（CRDT）、AI 大模型调用、打印优化、全文索引为 PRD 后续章节，本原型预留接口与开关，未实现。脑图/图示已初步实现（见上），未含 AI 生成与文档双向转换。
- 导出为**原生格式，不依赖任何 CDN 转换库**（仅用 JSZip 打包规范 XML）；DOCX/XLSX/PPTX/OFD 均可用本套件 `OS.Importer` 再导入，构成往返闭环。导出保留标题/格式/列表/表格/超链接/公式/版式坐标；表格表头（th）在往返中归一为数据单元格（td），属兼容等级 B 的可接受差异。
- 导入依赖 JSZip（CDN 引入）。`file://` 离线打开时若无 JSZip，导入/导出会提示联网后重试；通过本地服务器运行时可正常导入与导出。

## 下一步

1. OOXML/ODF/OFD **导入 + 原生导出（往返闭环）** 已实现（结构化，等级 B）；下一步提升至像素级保真（A 级：文本框/批注/图表对象/OFD 矢量图形与图片还原，PRD 3.1）。
2. 脑图/图示深化：AI 一键生成脑图、与 Writer 文档双向转换（PRD 3.7/3.8）。
3. 实现 CRDT 协同与离线队列（PRD 3.5）。
4. 接入 AI 助手（本地轻量模型 + 云端大模型混合调度，PRD 3.6）。
