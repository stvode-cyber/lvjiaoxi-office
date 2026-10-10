# 项目上下文 · 交接快照

> **新 AI 接手，先读这个！** 顶部 30 秒读完项目当前在哪、最近干了啥、下一个方向。
> 详细规则/历史剧情 → `AGENTS.md` / `decisions.md` / `issues.md`

---

## 🎯 交付快照（新 AI 读这里就够了）

**当前阶段**：v1.1.6 全功能迭代收尾 — Excel 兼容快捷键 + XLSX 格式双向导入导出 + PPTX 性能优化 + 底部导航单层合并

| 项 | 值 |
|---|---|
| 测试基线 | **109/109 全绿**（任何改动后先跑 `node scripts/run-tests.js`） |
| 最新 dist | `dist\绿角犀 Office Setup 1.1.6.exe` — **17:55**（含 PDF→DOCX 全链路 + PPTX blipFill + Excel 快捷键 + XLSX 格式双向 + 底部单层） |
| 发布状态 | ❌ GitHub push + VPS 上传待执行（换网络后跑 `git push origin HEAD:main` + `git push origin v1.1.6` + `scripts/publish-latest.bat`） |
| 版本号 | 1.1.6（源码/pubspec/dist 三处一致，铁律不能漂） |
| 用户账号 | aiuser / aiuser2 / aiuserB — 密码统一 **123456**（server/data/*.json，scrypt 哈希） |
| 台账状态 | decisions.md 最新 #47（XLSX 格式完整导入导出），issues.md 最新 L2 blipFill 路径折叠 + 坐标系定论 |
| 代码待 push | **13 个 commit 本地已提交**（9c638db → 8d71db7，含 v1.1.6 tag） |

---

## 🚨 新 AI 必做 Checklist（换电脑 / 新对话启动）

```bash
# 0) 读台账
Get-Content .trae/memory/台账/context.md -TotalCount 25
(Get-Content .trae/memory/台账/issues.md -Raw) -split '---' | Select-Object -First 4
(Get-Content .trae/memory/台账/decisions.md -Raw) -split '---' | Select-Object -First 4

# 1) 跑测试（必须 105/105 绿，红了先修）
node scripts/run-tests.js

# 2) 首次换电脑
npm install
node scripts/run-tests.js
npm run dist:local    # 打 Setup.exe（可选，需 electron-builder）

# 3) 开发模式
npm start              # Electron 桌面端
npm run cloud          # 启动云后端（localhost:PORT）
```

---

## 📊 模块状态（2026-10-10 快照）

| 模块 | 状态 | 备注 |
|------|------|------|
| Writer | ✅ | 富文本 + docx/html/md 导出 |
| Spreadsheet | ✅ **大幅增强** | Excel 兼容快捷键 + XLSX 格式完整双向（粗斜下/边框/填充/字色/合并）+ SheetJS BIFF5/8 |
| Presentation | ✅ | PPTX 背景完整三层继承 + blipFill 图片背景 + base64 O(N) 性能优化 |
| MindMap | ✅ | XMind/MD/OPML 导入 |
| PDF | 🟢 | PDF→DOCX + PDF→Excel + 字体样式还原 + 三栏版面 + OCR |
| AI 面板 | ✅ | BYOK 四供应商 |
| Electron | ✅ | 多窗口 + 大文件闪退修复 + 隐藏菜单栏 + 底部单层合并 |
| 客户端 | 🟡 | Win ✅ / Android ✅ / PWA ✅ / iOS & HarmonyOS 源码同步 |

---

## 🛠 这轮核心改动（2026-10-08 ~ 10-10）— 必读

### 1. XLSX 格式完整双向导入导出（2026-10-10）

**根因**：原来 parseXlsx 只导入 cells/values/formulas，返回 `styles: {}` 空对象，merge 字段不存在。用户反馈"打开 Excel 格式全丢了"。

**导入端补了**（`import-ooxml.js` parseXlsx +65/-5）：
- styles.xml 并行预读（第三个 Promise.all 成员）
- fonts 解析：`<b/><i/><u/><color rgb="FFrrggbb"/>` → bold/italic/underline/color
- fills 解析：`<patternFill patternType="solid"><fgColor rgb="..."/>` → bg
- borders 解析：`<left/right/top/bottom style="thin"><color/></...>` → 12 种线型 + 颜色
- cellXfs 解析：fontId/fillId/borderId + applyFont/applyFill/applyBorder 开关
- 单元格 s 属性查 cellXfs 组合 → `styles[ref] = { bold, bg, border: {left:{style,color},...} }`
- mergeCells 导入：`<mergeCell ref="A1:B2"/>` → merges 数组

**导出端补了**（`export-ooxml.js` buildXlsx +87/-10）：
- styles.xml 从硬编码改动态生成：fonts/fills/borders/cellXfs 全部按 cellXfs+apply* 开关写
- 单元格加 `s="N"` 属性（xfId 去重：font+bg+border 三键拼接，相同组合复用同一个 xfId）
- 空值但有样式的格子 → `<c ref s="N"/>`（否则边框/填充丢失）
- mergeCells 写入 sheetXml

**Excel 惯例**：fillId 0=none、1=gray125（必须保留，否则 Excel 打开报损坏）；cellStyleXfs count 固定 1；xfId 0。

### 2. Excel 兼容快捷键（2026-10-10）

用户要求按 Excel 兼容模式改（Enter=下移、F2=编辑、Ctrl+B/I/U=粗斜下等）。

**新增快捷键**（`modules/spreadsheet.js` keydown handler 重写 +45 行）：

| 快捷键 | 功能 |
|---|---|
| F2 | 进入编辑（保留内容，光标到末尾） |
| Shift+Enter | 提交后上移 |
| Ctrl+B / I / U | 粗体/斜体/下划线 |
| Ctrl+Space | 选整列 |
| Shift+Space | 选整行 |
| Ctrl+Arrow | 跳数据边缘 |
| Ctrl+Shift+Arrow | 跳数据边缘 + 扩展选区 |
| Ctrl+D | 向下填充（**修复公式相对引用偏移**：原代码直接复制 src.f 不偏移 → 改用 FE.adjustFormula + writeCell） |
| Ctrl+Enter | 选区批量填充 |
| Ctrl+Home / Ctrl+End | 跳 A1 / 数据右下角 |
| PageUp / PageDown | 翻屏 20 行 |
| Ctrl+; / Ctrl+Shift+; | 当前日期 / 当前时间 |

Ribbon 字体组原来只有 B，现在加了 I 和 U 按钮。

### 3. PPTX 性能优化（2026-10-10）

用户反馈"打开文件慢"，诊断后找到头号元凶：

**根因**：base64 编码逐字节 `bin += String.fromCharCode(u8[i])` — O(N²) 字符串拼接（一张 2MB 图片 = 3-5 秒）。

**修法**（`import-ooxml.js` parsePptx）：
- base64：chunk 8192 + `Array.apply(null, chunk).map(String.fromCharCode).join("")` — O(N)
- rels + layoutBg 预读从 3 个串行 for 循环 → `Promise.all` 并行
- timing 打点：控制台搜 `[PPTX]` 看 media+rels 预读 / parsePptx 总耗时

**同时修了** blipFill 路径折叠 bug（`/../` 只替换没去掉上级目录 → while 循环 + `/[^/]+\/\.\.\//` 正确折叠）+ 补 10 条 blipFill 测试。

### 4. 底部导航三层合一 + 全局 footer 注入（2026-10-10）

用户要"底部只要一层"。

**前**：sheet-tabs（Sheet1/＋）+ sheet-statusbar（求和/平均/计数）+ 全局 footer#statusbar（就绪/缩放）= 三层。

**后**：单层 `.sheet-bottombar`（sheets-tabs 左 + footer#statusbar 右）。
- sheet-statusbar 隐藏（求和/平均留了 hidden 给内部测试用）
- 全局 footer#statusbar 在 spreadsheet 激活时被 `injectIntoSheetBottom()` 注入到 sheet-bottombar 右边
- 其他模块（Writer/PDF/PPT）不变，还是两层或一层（各自模块底栏 + 全局 footer）

**关键文件**：`app/css/style.css`（新 `.sheet-bottombar` 样式）+ `app/js/shell.js`（模块切换时调用 showFooter 或 inject）+ `app/js/modules/spreadsheet.js`（底部 bar 渲染）

### 5. 顶部导航 4 层 → 2 层（省 ~80px）— 历史（2026-10-08）

| 层 | 改前 | 改后 |
|----|------|------|
| 1 | titlebar（46px） | titlebar（**40px**，吸收了 app-nav） |
| 2 | **app-nav 独立行（38px）** | **已删除**（合并进 titlebar .tb-left） |
| 3 | ribbon tabstrip（28px） | ribbon tabstrip（**24px**） |
| 4 | ribbon panel（40px） | ribbon panel（**36px**） |
| 5 | Electron 原生菜单栏（~30px） | **已隐藏**（setMenuBarVisibility(false)，保留快捷键） |
| **合计** | **~182px** | **~100px** |

**关键文件**：
- `app/index.html` — `<nav class="app-nav">` 从独立行移进 `.tb-left`
- `app/css/style.css` — CSS 变量 `--title-h:46→40`, `--tabstrip-h:28→24`, `--ribbon-h:40→36`；`.app-nav{display:none!important}` 独立行隐藏；`.tb-left .app-nav{display:flex!important}` 父选择器覆盖
- `electron/main.js` — `autoHideMenuBar:true` + `setMenuBarVisibility(false)`

### 2. 多窗口支持（双击第二个文件弹第二个窗口）

**根因**：旧代码 `let win` 单窗口变量 + `second-instance` 把新文件塞给旧窗口覆盖掉。

**修法**：
- `let win` → `const windows = new Set()`（多窗口集合）
- 每个窗口自带 `__state = { pendingFiles:[], webReady:false }`
- `second-instance` → `createWindow(paths)` 开新窗口（不是塞给旧的）
- `app:renderer-ready` 通过 `BrowserWindow.fromWebContents(evt.sender)` 定位 sender 窗口
- **保留** `requestSingleInstanceLock`（共享 HTTP server + 省内存）

**文件**：`electron/main.js`（148 行改动）

### 3. 大文件闪退（fs.readFileSync 阻塞主进程）

**根因**：`fs.readFileSync(path)` 同步阻塞 Electron 主进程 → watchdog 杀进程。

**修法**：`fs.statSync/readFileSync` → `await fs.promises.stat/readFile` + `Promise.all(paths.map(...))`

**铁律**：Electron main 进程里 `*Sync` **一律禁用**！

**文件**：`electron/main.js#L172-181`

### 4. .xls 格式打不开（白名单漏了）

**根因**：`KNOWN_EXT` 数组缺 `.xls`，双击 .xls 被 main 进程过滤掉。renderer 侧早就完整支持 BIFF5/8（SheetJS parseXls）。

**修法**：`electron/file-args.js` KNOWN_EXT 加 `.xls`；测试同步改。

### 5. PPTX 背景全白 Round 2（slideLayout 中间层）

**根因**：你 F12 贴的日志 `bgNode: false` → PPTX 背景继承链是 **slide → layout → master** 三层，之前只做了 `slide → master`（缺 layout 中间层）。很多 PPT 把背景设在 layout 上。

**修法**：
- 新增 `extractBgFillColor(bgNode)` — 覆盖 solidFill/gradFill/bgRef/srgbClr/schemeClr 所有 PPTX 标准类型
- 预解析所有 `slideLayout1.xml ~ N.xml` 的 bg → `layoutBgMap`
- 继承链升级：`slide 自己的 bg → layoutBg（通过 rels 找） → masterBg → "#ffffff"`

**同时修了**：CSS `.pres-canvas{background:#fff}` 硬编码白底 → `background:var(--bg)`

**文件**：`app/js/import-ooxml.js`（+90 行） + `app/css/style.css`

### 6. 用户密码重置

后端只存 scrypt hash + salt，无法反推。直接算新 hash 覆盖：

| 用户名 | 密码 | 文件 |
|--------|------|------|
| aiuser | 123456 | server/data/aiuser.json |
| aiuser2 | 123456 | server/data/aiuser2.json |
| aiuserB | 123456 | server/data/aiuserB.json |

---

## 🔧 铁律（高频踩坑压缩版，6 条最常犯）

1. **Electron main 进程里 `*Sync` 一律禁用** — `fs.readFileSync` 阻塞 Chromium 事件循环 → watchdog 杀进程 → 闪退。必须 `fs.promises` + `await`
2. **PPTX 背景三层继承链** — slide 自己 → slideLayout（通过 rels 找 target）→ slideMaster。跳了中间 layout 层就会全白
3. **CSS 硬编码白底覆盖内联 style** — `.pres-canvas{background:#fff}` 比 JS 设的 `canvas.style.background` 优先级高？不，内联 style 优先级更高。但如果 canvas 元素上**没设内联 style**（render 忘了），CSS 硬编码就会露出来。保险做法：CSS 用 `var(--bg)` 让 JS 控
4. **`second-instance` 事件** — 必须开新窗口 `createWindow(paths)`，不能塞给旧窗口。保留 `requestSingleInstanceLock` 省内存
5. **KNOWN_EXT 白名单容易漏旧版格式** — .xls/.doc/.ppt 二进制格式，installer 注册了关联但 main 进程过滤掉 = 打不开
6. **`setMenuBarVisibility(false)` 而非删除 Menu** — 删除 Menu = 所有快捷键失效。隐藏 UI 层但保留 accelerator/role

> 详细 15 条铁律 + 踩坑子坑列表 → `issues.md`

---

## 🚀 换电脑 Checklist

```bash
cd "d:\源码存档\绿角犀办公软件"
npm install              # 首次 5-10 分钟
node scripts/run-tests.js  # 必须 104/104 绿
npm start                # Electron 开发模式
npm run dist:local       # 打 Setup.exe（electron-builder 需装好）
```

---

## 📋 变更日志（2026-10-10 顶部追加）

- **[2026-10-10] XLSX 格式完整双向导入导出 + Excel 兼容快捷键 + PPTX 性能 + 底部导航单层**
  - parseXlsx 补 styles.xml（fonts/fills/borders/cellXfs）+ mergeCells → 返回完整 data.styles + data.merge
  - buildXlsx 从硬编码 styles.xml 改动态生成 + 单元格 s 属性（xfId 去重）+ 空值格子写 `<c ref s/>` + mergeCells 写入
  - Excel 兼容快捷键（方案 A）：F2/Shift+Enter/Ctrl+B/I/U/Ctrl+Space/Shift+Space/Ctrl+Arrow/Ctrl+D/Ctrl+Enter/Ctrl+Home/End/PageUp/Down/Ctrl+;/Ctrl+Shift+;
  - Ctrl+D 修复公式相对引用偏移（原代码直接复制 src.f，改用 FE.adjustFormula + writeCell）
  - PPTX base64 编码 O(N²)→O(N) + rels/layoutBg 预读串行→并行
  - blipFill 路径折叠 bug 修复 + 10 条 blipFill 测试
  - 底部三层（sheet-tabs + sheet-statusbar + footer#statusbar）合一：单层 sheet-bottombar + 全局 footer 注入
  - Ribbon 字体组加 I/U 按钮
  - 测试 109/109 绿 / dist 17:55 / 13 个 commit 本地已提交（待 push）

- **[2026-10-09] PDF 提取层坐标系实锤修正 + Form XObject 嵌套图片（覆盖 #40 定论错误）**
  - 真实三栏 PDF 端到端实测（pdf-lib 生成→pdf.js 真实解析）实锤：textContent transform 是 y-up，#40 的 y-down 实锤方法错了（批注 y 来自 DOM 指针事件）
  - 修复：提取层 y 翻转 y-down（_textSpansFromTC）→ 真实 PDF 全文/表格/多栏反序全修；#40 的升序方向在 y-down 数据下才真正成立
  - 矩阵左乘→右乘（postmultiply 语义）：pdf-lib 多步 cm 链图片矩形不再算飞
  - Form XObject 嵌套图片递归提取（paintFormXObjectBegin/End 栈配平 + form Matrix 右乘叠加）
  - 归一化下沉纯函数 _textSpansFromTC / _walkImageRects（node 可测）
  - _pdf_3col_e2e_test.js 12 断言（首个真实 PDF 端到端套件）
  - 测试 107/107 绿 / sw.js CACHE v29→v30 / 四端已同步

- **[2026-10-09] PDF→DOCX 三栏版面还原 + y 方向颠倒修复**
  - detectColumnSeps 递归二分 K-means（最多三栏），检测输入改 items 级 x（基线对齐场景可检出）
  - 跨栏判定 some→every（防单栏+2 列表格被误吞）
  - 多栏段落预构建（每栏一整段 + 共享 colMinY 事件 y 保栏序），insertPreserved 删除
  - **顺带修复**：renderTableBlock / colGroups baseY 降序→升序 — 原假设 y-up 实际 y-down（批注 top=y*bh 实锤），表格/多栏栏内行序在真实 PDF 一直颠倒（issues#27）
  - _pdf_convert_3col_test.js 17 断言（三栏 + 双栏回归 + 单栏回归 + 表格共存）
  - 测试 106/106 绿 / sw.js CACHE v28→v29 / 四端已同步

- **[2026-10-09] PPTX 背景 Round 2 + 密码重置 + 台账交接准备**
  - 新增 slideLayout 预解析 + 三层继承链（slide → layout → master）
  - extractBgFillColor 覆盖所有 PPTX 标准背景类型
  - CSS `.pres-canvas` 硬编码白底 → `var(--bg)`
  - 三个用户密码统一重置为 123456（scrypt hash 重算覆盖）
  - context.md 全面更新为交接快照格式
  - 测试 104/104 绿 / dist 09:43

- **[2026-10-08] 顶部导航合并 + 多窗口 + 大文件闪退 + .xls 修复**
  - 顶部导航 4 层 → 2 层（省 ~80px）：titlebar 吸收 app-nav + Electron 菜单栏隐藏
  - 多窗口：second-instance 开新窗口，每个窗口独立 __state
  - fs.readFileSync 同步 → fs.promises 异步（大文件不再闪退）
  - electron/file-args.js KNOWN_EXT 加 .xls

- **[2026-10-03] PDF→DOCX 完整链路 + 台账 Growth Ledger 升级**
  - detectColumnSep K-means K=2 双峰检测
  - PDF→DOCX 导出 UI 打通 + 真实 IEEE 论文验证
  - 台账 Growth Ledger 分级：6 L1 聚合 + 13 L2 + archived

---

## 📁 台账文件速查

| 文件 | 什么时候读 |
|------|----------|
| **`context.md`（本文件）** | **新 AI 第一读**：30 秒快照 |
| `issues.md` | 踩坑清单，L1 聚合坑含「总预防规则」 |
| `decisions.md` | 架构决策 / 方案选择理由 |
| `index.md` | 模块→决策/坑 映射表 |
| `STATUS.md` | 模块状态总览 |

---

## 📂 目录地图（关键路径）

| 路径 | 干啥的 |
|------|--------|
| `app/` | **Web 真源**（所有客户端镜像源） |
| `app/js/modules/` | 各模块实现（writer / spreadsheet / presentation / mindmap / pdf-* / shell ...） |
| `app/js/import-ooxml.js` | OOXML 解析（docx/xlsx/pptx → 内部结构） |
| `app/css/style.css` | 全局样式（CSS 变量 `--ribbon-h`/`--tabstrip-h`/`--title-h` 控制导航高度） |
| `electron/main.js` | Electron 主进程（多窗口 + 文件打开 + updater） |
| `electron/file-args.js` | 命令行参数 + KNOWN_EXT 白名单 |
| `server/` | 云后端（scrypt 密码 + JWT） |
| `scripts/run-tests.js` | 测试套件入口 |
| `dist/` | 构建产物（NSIS 安装包） |
| `_*_test.js` | **测试套件**（根目录，jsdom stub） |

---

## ⚠️ 已知遗留问题（非阻断）

1. **~~PPTX 图片背景未处理~~ 已修复** — `blipFill` 类型已实现（rels 预解析 slideLayout/slideMaster + resolveMediaByRels 通用化 + extractBgFillColor blipFill 路径 → url(data:) 渲染）
2. **多窗口 HTTP server 共享** — 保留了单实例锁，但多个 BrowserWindow 共享 127.0.0.1:PORT（OK，不影响）
3. **顶层导航紧凑型小** — 如果用户反馈按钮太小，可以加"标准模式/紧凑模式"切换
4. **侧边栏模块 tab（演示/文档/表格/PDF）没合并** — 这些是左侧 sidebar 的，不是顶部的
