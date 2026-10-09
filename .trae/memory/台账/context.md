# 项目上下文 · 交接快照

> **新 AI 接手，先读这个！** 顶部 30 秒读完项目当前在哪、最近干了啥、下一个方向。
> 详细规则/历史剧情 → `AGENTS.md` / `decisions.md` / `issues.md`

---

## 🎯 交付快照（新 AI 读这里就够了）

**当前阶段**：v1.1.6 稳定化 — 顶部导航三层合并 + 多窗口修复 + PPTX 背景完整链路 + 大文件闪退修复

| 项 | 值 |
|---|---|
| 测试基线 | **104/104 全绿**（必须保持，任何改动后先跑 `node scripts/run-tests.js`） |
| 最新 dist | `dist\绿角犀 Office Setup 1.1.6.exe` — **09:43**（已装） |
| 用户账号 | aiuser / aiuser2 / aiuserB — 密码统一 **123456**（server/data/*.json，scrypt 哈希） |
| 台账状态 | decisions.md 10+ 条（含顶部导航/多窗口/PPTX背景三轮修复），issues.md L1 聚合坑 |

---

## 🚨 新 AI 必做 Checklist（换电脑 / 新对话启动）

```bash
# 0) 读台账
Get-Content .trae/memory/台账/context.md -TotalCount 25
(Get-Content .trae/memory/台账/issues.md -Raw) -split '---' | Select-Object -First 4
(Get-Content .trae/memory/台账/decisions.md -Raw) -split '---' | Select-Object -First 4

# 1) 跑测试（必须 104/104 绿，红了先修）
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

## 📊 模块状态（2026-10-09 快照）

| 模块 | 状态 | 备注 |
|------|------|------|
| Writer | ✅ | 富文本 + docx/html/md 导出 |
| Spreadsheet | ✅ | AI 公式 + SheetJS BIFF5/8（.xls + .xlsx） |
| Presentation | ✅ | **刚修完 PPTX 背景完整链路**（slide → layout → master 三层继承） |
| MindMap | ✅ | XMind/MD/OPML 导入 |
| PDF | 🟢 | PDF→DOCX + PDF→Excel + OCR + makeSearchablePDF |
| AI 面板 | ✅ | BYOK 四供应商 |
| 业务板块 | ✅ | 订单/库存/审批 |
| Electron | ✅ | **刚修完**：多窗口 + 大文件闪退 + 隐藏菜单栏 |
| 客户端 | 🟡 | Win ✅ / Android ✅ / PWA ✅ / iOS & HarmonyOS 源码同步 |

---

## 🛠 这轮核心改动（2026-10-08 ~ 09）— 必读

### 1. 顶部导航 4 层 → 2 层（省 ~80px）

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

## 📋 变更日志（2026-10-09 顶部追加）

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

1. **PPTX 图片背景未处理** — `blipFill` 类型跳过了（简化），只有 solidFill/gradFill/schemeClr 有颜色
2. **多窗口 HTTP server 共享** — 保留了单实例锁，但多个 BrowserWindow 共享 127.0.0.1:PORT（OK，不影响）
3. **顶层导航紧凑型小** — 如果用户反馈按钮太小，可以加"标准模式/紧凑模式"切换
4. **侧边栏模块 tab（演示/文档/表格/PDF）没合并** — 这些是左侧 sidebar 的，不是顶部的
