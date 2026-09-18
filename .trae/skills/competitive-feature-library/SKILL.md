---
name: competitive-feature-library
description: 绿角犀 Office 竞品功能库 — 市场调查员沉淀的可吸收热门功能清单
---

# 竞品功能库

> 持续更新，从竞品吸收的可落地功能。按优先级排序。

## P0 — 必做（直接提升核心竞争力）

| # | 功能 | 来源 | 描述 | 绿角犀实现建议 | 改动量 |
|---|------|------|------|---------------|--------|
| 1 | **AI 块级编辑** | GenOffice | AI 不是聊天框外挂，而是直接编辑选中段落/选中单元格/选中幻灯片 | 在 Writer/Sheet/PDF 各模块的工具栏加 "AI 改写/续写/总结" 按钮 → window.AI.edit({module, target, instruction}) | 中（UI + AI 桥） |
| 2 | **PDF 真实文本编辑** | GenOffice, ONLYOFFICE | 直接重写 PDF 页面内容流，不是覆盖注释 | PDFium WASM 提取文本坐标/字体 → 重建内容流 → 重新序列化 | 大（需要 Rust/WASM sidecar 或 C++ addon） |
| 3 | **BYOK 模式** | GenOffice, Presenton | Bring Your Own Key：用户自己填 API Key，绿角犀不托管密钥 | 账户设置页加 "AI 提供商" 配置面板（Claude/OpenAI/Gemini/DeepSeek） | 小（settings panel + fetch wrapper） |
| 4 | **PDFium WASM 加速** | A3S Office, obsidian-pdf-plus | 比 pdf.js 快 3-5 倍的渲染 + 支持真实文本坐标 | 把 pdf.js 渲染层换成 PDFium WASM，pdf-lib 保留做字节操作 | 中（替换渲染层） |
| 5 | **版本快照 + Diff** | GenOffice | 保存时自动快照关键版本，可回看两个版本的差异 | Store 层加 version_history[]，UI 加 "历史版本" 面板 → 并排 diff | 中（Store 扩展 + UI） |

## P1 — 应该做（提升体验）

| # | 功能 | 来源 | 描述 | 实现建议 |
|---|------|------|------|---------|
| 6 | **本地 OCR** | GenOffice, Stirling-PDF | 扫描版 PDF 转可编辑（系统原生 API / PaddleOCR WASM） | Windows: WMI Windows.Media.Ocr；macOS: Vision framework；或 WASM 版 PaddleOCR |
| 7 | **表单构建 + 收集** | ONLYOFFICE | PDF 里直接拖拽建表单（文本/下拉/单选/签名），填完可一键收齐 | PDF 模块加表单工具面板 → AcroForm 生成 → 填写 → 收集到一个目录 |
| 8 | **页面拖拽重排** | ONLYOFFICE, Stirling-PDF | 左侧缩略图面板，拖拽排序、旋转、删除、从别的 PDF 拖入 | 实现缩略图列表 + HTML5 Drag & Drop → pdf-lib 重组 Pages 数组 |
| 9 | **批注 → Markdown** | obsidian-pdf-plus | PDF 上高亮/批注 → 自动在旁边生成 .md 笔记链接 | 批注时弹出 "写入笔记" 按钮 → 生成 `[page 5](note.md#pdf-p5)` 链接 |
| 10 | **Rust Sidecar** | GenOffice, A3S Office | Excel 公式计算/PDF 内容流重写 → Rust 处理，比 JS 快 10x | package.json 加 cargo build，Electron main 用 child_process spawn Rust binary |

## P2 — 锦上添花

| # | 功能 | 来源 | 描述 |
|---|------|------|------|
| 11 | **幻灯片 AI 生成** | Presenton | 输主题 → AI 自动出大纲 → 生成每页内容和配图 | AI 面板 → prompt → 结构化 JSON → 渲染 slides |
| 12 | **撤销/重做历史栈** | 所有竞品 | 每个模块有独立的 Command Stack（UndoManager） | 把直接 DOM 操作包装成 Command 对象，execute / undo / redo |
| 13 | **PDF 插件市场** | Stirling-PDF 思路 | 社区贡献的 PDF 工具（比如去黑边、加 Bates 编号） | 在 pdf-app.js 里暴露 window.PDFTools.register(name, fn) 接口 |
| 14 | **云备份 + 多端同步** | MS 365 / WPS | 本地 .lvjx 自动同步到绿角犀云 | 后台 sync worker + 冲突合并（Last-Write-Wins 或 CRDT） |
| 15 | **快捷键体系** | 所有竞品 | Ctrl+S 保存、Ctrl+F 搜索、Ctrl+Z 撤销、Alt+/ 命令面板 | OS.hotkeys 全局监听 → 分模块路由 |
| 16 | **打印预览 + 导出 PDF** | 所有竞品 | 每个模块右上角 "打印" 按钮 → PDFium 渲染 → pdf-lib 存 | OS.print(host) → 截图或 printToPDF API |
| 17 | **深色/浅色主题切换** | GenOffice, ONLYOFFICE | 1 秒切换，token 全链路适配 | 已有基础，补齐所有模块的深色模式 CSS |
| 18 | **文件加密（AES-256）** | Stirling-PDF, ONLYOFFICE | 导出时可选密码保护 | Store.put 时加 encrypt(password) → AES-256-GCM + scrypt KDF |

## 竞品已踩的坑（避坑）

| 竞品 | 踩的坑 | 绿角犀避坑建议 |
|------|--------|---------------|
| GenOffice | Alpha 状态 AI 路由走云端服务端（非 BYOK 时） | 全程本地处理 + BYOK，绝不发送用户文档到绿角犀服务器 |
| ONLYOFFICE | C++ 核心编译慢、跨端二进制大 | 保持纯 JS 真源 + Electron 打包，不用 C++ |
| Stirling-PDF | Java 重、Docker-only 体验 | 保持 Electron 桌面优先 |
| A3S Office | PDFium runtime 初始化慢（~300ms） | 预加载 + lazy surface（按需请求模块） |
| Bentopdf | WASM 体积大（PDFium ~15MB） | 按需加载：阅读器用 pdf.js，编辑时才拉 PDFium WASM |
