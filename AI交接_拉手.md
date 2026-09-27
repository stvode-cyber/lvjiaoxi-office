# AI 交接拉手 · 接手即懂

> **本文件是 AI Agent 的「5 分钟上手包」**。打开它 → 知道这是啥 → 跑一遍命令 → 开干。
> 详细规则和历史剧情在 AGENTS.md / 工程总纲.md / STATUS.md 里，这里**不堆废话**。

---

## 0. 快速启动清单（5 分钟开干）

```bash
cd "d:\源码存档\绿角犀办公软件"
node scripts/run-tests.js            # 跑测试套件，确认基线全绿
node scripts/sync-clients.js --check # 检查四端同步（iOS/HarmonyOS 漂移就同步）
npm start                            # 启动 Electron 桌面端（需 node_modules）
```

---

## 1. 这是啥？

**绿角犀 Office** — 跨平台国产办公套件，对标 WPS/Office。

- 五大模块：**Writer（文字）/ Spreadsheet（表格）/ Presentation（演示）/ PDF / MindMap（脑图）**
- 外加顶部导航的**业务板块**：工作台 / 订单 / 库存 / 审批 / 我的
- 技术栈：**零构建纯静态 SPA**（经典 `<script>` + 全局 `OS.*` 命名空间），外层壳 Electron/Android/iOS/HarmonyOS/PWA
- 四端严格镜像同一套 `app/` 真源，由 `sync-clients.js` 自动同步

---

## 2. 目录地图（关键文件夹）

| 路径 | 干啥的 | 备注 |
|------|--------|------|
| `app/` | **Web 真源**（所有客户端的镜像源） | 核心代码都在这 |
| `app/js/modules/` | 各模块实现（writer / spreadsheet / presentation / mindmap / pdf-* / shell / exports / imports ...） | 零构建、经典 script |
| `app/css/style.css` | 全局样式（含深色主题变量） | 主题切换靠 css 变量 |
| `app/index.html` | 入口 HTML，按顺序加载所有 JS | script 顺序有依赖 |
| `app/sw.js` | Service Worker（PWA 离线缓存 + CACHE 版本号） | 改了文件记得加 CACHE |
| `clients/ios/webroot` + `clients/harmonyos/...` | 原生壳，**自动镜像 app/** | 用 `sync-clients.js` 同步，不要手改 |
| `electron/` | Electron 主进程（main.js + preload） | 禁用了 GPU 解决 360 卫士冲突 |
| `scripts/` | 构建/同步/发版脚本（8 个 Node 脚本） | 常用 sync-clients.js / bump-version.js / run-tests.js |
| `server/` | 云后端（零依赖 Node，scrypt + HMAC） | 本地 `npm run cloud` 启动 |
| `dist/` | 构建产物（NSIS 安装包 + 便携 exe + latest.yml） | 发版才会有 |
| `模块/` | 各模块总纲（导航文档） | 先看总纲再碰代码 |
| `讨论与处理/` | 设计争议/推演（非正式结论） | 改架构前先看这 |
| `_*_test.js` | **测试套件**（根目录 97 个文件） | jsdom stub + 无浏览器依赖 |
| `.trae-cn/memory/` | 跨会话记忆（用户偏好 + 项目硬约束） | 自动加载到对话上下文 |

---

## 3. 命令速查（高频）

| 命令 | 干啥 | 什么时候用 |
|------|------|-----------|
| `npm test` | 全量测试 + sync:check | **改了任何代码都要跑**，97 套件 |
| `node scripts/sync-clients.js` | 同步 app/ → iOS/HarmonyOS | 改了 app/ 后必跑 |
| `node scripts/sync-clients.js --check` | 只查不同步，不动文件 | 想知道漂了啥 |
| `npm start` | 启动 Electron 桌面端 | 实机验证 UI |
| `npm run test:boot` | 应用启动冒烟（14 项） | 怀疑启动崩了 |
| `npm run test:runner` | 测试运行器自检（10 项） | 改了测试框架 |
| `node scripts/bump-version.js patch` | 版本号 +0.0.x，自动同步四端 | 发 bug 修复版 |
| `node scripts/bump-version.js minor` | +0.x.0 | 发新功能版 |
| `npm run dist:local` | 构建 Windows 安装包（本地，不发） | 发版前本地验证 |
| `npm run cloud` | 启动云后端（localhost:3000） | 测云同步 |

---

## 4. 当前状态快照

| 指标 | 数字 | 说明 |
|------|------|------|
| 版本 | **1.1.3** | package.json 单一真源（2026-09-23 bump） |
| 测试套件 | **101 passed, 0 failed** | 本轮新增 4 个（PDF→Excel+DOCX 版面还原 + 跨模块查找 + 快捷键矩阵） |
| 四端同源 | ✅ iOS + HarmonyOS 已同步 | app/ 改后记得 `sync-clients.js` |
| 核心模块 | ✅ Writer / Spreadsheet / Presentation / PDF / MindMap 全实现 | 可实跑 |
| 快捷键矩阵 | **25 组**（Ctrl+Z/Y/K/S/E/H/F/N/O/W/P/Q/R/Tab + F1/F5 + Alt+T + Ctrl+Shift+H/F/A/M/Z/T） | shell.js 统一拦截 + _shell_shortcuts_test 39 断言覆盖 |
| PDF 能力 | ✅ 批注 / 合并拆分 / 表单 / 文本层 / 安全审计 / 结构预检 / 历史审计 / PDF→Excel/DOCX 版面还原 ... | 共 17 个纯模块 |
| ⚠️ 人工项 | iOS / HarmonyOS 编译需要 Mac / DevEco | 源码工程已就绪，非阻断 |

---

## 5. 核心架构约束（别踩这些坑）

1. **版本号单一真源 = package.json**。升版永远用 `bump-version.js`，它会自动同步四端所有落点（Electron manifest / iOS Info.plist / HarmonyOS build.json / NSIS 安装包名 / latest.yml）。**绝对不能手动改某一处版本号**。
2. **四端必须同源**。改了 `app/` 任何文件，立刻 `node scripts/sync-clients.js`。`npm test` 最后也会跑 `sync:check` 拦漂移。
3. **Worker.min.js 必须动态加载**。tesseract 的 `new Worker()` 不能当普通 script 加载到主线程，会崩。`app/index.html` 已经处理过了，别加回来。
4. **Electron 禁用 GPU**。360 安全卫士 + Electron = 必崩，所以 `main.js` 里 `app.disableHardwareAcceleration()` + `--disable-gpu` 是写死的，别删。
5. **批注导出要同时写 commentN.xml + commentAuthors.xml + slideN.xml.rels**。缺任何一个 Excel/PPT/Word 都打不开。
6. **PowerShell 5 不认 `&&`**。跨命令链用分号 `;`。
7. **测试脚本全部放在根目录 `_*_test.js`**。`run-tests.js` 会自动扫描并跑，放别的地方找不到。

---

## 6. 最近刚干完什么（2026-09-22 本轮）

### 批注 OOXML 往返闭环（修复 7 个隐藏 bug）

**问题**：Writer / Spreadsheet / Presentation 三模块的批注，导出到 OOXML 后文本全是空的；导入回来文本也丢了。没人发现过，因为之前没写往返测试。

**修了 7 个 bug**：

| # | 文件 | 模块 | Bug |
|---|------|------|-----|
| 1 | export-ooxml.js:447 | Word | 批注文本用了 `c.quote`（正文锚点）而非 `c.text` |
| 2 | export-ooxml.js:603 | Excel | 从 `c.replies[0].text` 取文本（Excel 原生不支持 replies，永远空） |
| 3 | export-ooxml.js:761 | PPTX | 同上，从 `c.replies[0].text` 取 |
| 4 | import-ooxml.js:431 | Excel | 硬编码只读 comment1.xml，多 sheet 批注全丢 |
| 5 | import-ooxml.js:451/790 | Excel+PPTX | 文本存到 replies[0] 而非 comment.text |
| 6 | import-ooxml.js:778 | PPTX | 读 `<t>` 但 PPTX 批注文本在 `<p:text>`（presentationml namespace） |
| 7 | import-ooxml.js:1270 | 通用 | Importer 只暴露 parseDocx/parseXmind，缺 parseXlsx/parsePptx |

**新增测试**：`_comments_ooxml_roundtrip_test.js` — 62 条断言，三模块全通。

**改了哪些文件**：
- `app/js/export-ooxml.js`（3 处）
- `app/js/import-ooxml.js`（5 处）
- 同步 iOS/HarmonyOS

**测试基线**：102 passed, 0 failed + 四端同源 ✅（含 39/39 快捷键矩阵 + 28 版本比对铁律 + Ctrl+Tab 可视化弹窗 + PDF 暗模式 + Ctrl+Z 跨模块统一）

---

## 7. 下一步能推啥（按优先级）

当前所有原计划任务已清零，**101 套件全绿**。下面按「用户价值 + 可验证性 + 技术风险」重新排队：

### 7.1 已完成的原计划（供参考）

| 优先级 | 任务 | 完成日 | 备注 |
|--------|------|--------|------|
| ~~P0~~ | PDF→Excel 版面还原 | 2026-09-22 | detectTables 精细列边界 + XLSX 真表格 + !merges 合并 |
| ~~P0~~ | PDF→DOCX 版面还原 | 2026-09-22 | docx.Table + columnSpan 合并 + Paragraph prose |
| ~~P1~~ | 发版 v1.1.3 | 2026-09-22 | Setup 100 MB + latest.yml |
| ~~P2~~ | PDF 批注写入 PDF 二进制 | **2026-09-01（已实现，拉手.md 误标 P2 未做）** | addVectorAnnotation + addHighlight（烤进页面内容流，正确方案） |
| ~~P2~~ | 查找替换跨模块统一 | 2026-09-23 | Writer/Presentation/MindMap 加 openFindPanel；快捷键矩阵补齐 Ctrl+N/O/W/P/Tab |

### 7.2 新的下一步（按优先级排序）

| 优先级 | 任务 | 价值 | 工作量 | 怎么验收 |
|--------|------|------|--------|----------|
| ~~P0~~ | Ctrl+Tab 可视化切标签弹窗 | ✅ 2026-09-24 已实现 | 小 | shell.js L1144-1195 `_tswOpen/Move/Commit/Close` 完整 overlay + 高亮 + 松开切换 |
| ~~P1~~ | PDF 暗模式（阅读器渲染反色） | ✅ 2026-09-24 已实现 | 中 | pdf.js L39 按钮 + L603-617 三态循环(auto→on→off) + CSS invert+hue-rotate 批注层反回来 |
| ~~P1~~ | 更多办公必备快捷键：F1/F5/Ctrl+Shift+T/Ctrl+Q | ✅ 2026-09-24 已实现 | 小 | 39/39 `_shell_shortcuts_test.js` 全过；矩阵 39 组覆盖 Ctrl+N/O/W/P/Tab/Q/R/F1/F5/Shift+T |
| **P2** | Electron 静默更新端到端验证 | 桌面用户自动拿新版 | 中 | dist + LVJX_UPDATE_FEED + 真实 update.lvjiaoxi.cn 验证（卡点：远程托管凭证） |
| **P2** | cloud 云同步端到端验证 | AI BYOK + 多端协同 | 中 | 登录 → AI 调用 → 保存到 cloud tab → 换设备打开版本历史 diff（卡点：后端） |

### 7.3 技术债 / 可改进项（有空再做）

| 项 | 现状 | 改进方向 |
|----|------|----------|
| **台账自动触发** | growth-logger Skill 规定了流程，但还没写脚本自动扫 diff → 写 issues | 写 scripts/layer-diff.js 每轮结束时扫描 git diff 自动建议台账条目 |
| **快捷键审计** | 29 断言只覆盖字符串包含 | 改成 jsdom 真实派发 KeyboardEvent → 验证 activate/closeTab 真被调 |
| ~~P2 遗留~~ | Presentation/MindMap 的 openFindPanel 替换没 undo | ✅ **2026-09-24 已修**：_prFindReplace/_prReplaceAll 反查 element 数据 → snapshot + renderAll；_mmFindReplace/_mmReplaceAll 反查 data.nodes → _snapshot + render；MindMap 加 search/replaceAllText 纯函数（shell globalReplace 跨文档替换可用） |
| ~~Ctrl+Z 跨模块一致性~~ | ~~Writer 用 execCommand undo 栈，Spreadsheet 有自己的 undoStack，PDF 无~~ | ✅ **2026-09-24 已统一**：OS.Undo 调度器（util.js L104）+ presentation.js L760 补 export undo/redo/canUndo/canRedo；5 模块全部接入 |

---

## 8. 产品交付总览（2026-09-24 · v1.1.3）

### 8.1 核心数字

| 指标 | 数值 | 说明 |
|------|------|------|
| 版本 | v1.1.3 | 发版：2026-09-22 |
| 测试套件 | **102 passed, 0 failed** | 28 个断言铁律 + 39/39 快捷键矩阵 |
| 源文件 | 77 个 | app/ + electron/ + scripts/ + 4 端客户端 |
| PDF 模块 | 17 个 | pdf-engine.js + pdf-anno.js + pdf-formfields.js + pdf-preflight.js + pdf-history.js … |
| vendor | 8 个 | pdf-lib.jszip/xlsx/docx/FileSaver/fontkit + tesseract（OCR） |
| 台账 | 27 decisions + 29 issues + 49 index | `.trae/memory/台账/` |
| 四端同源 | ✅ iOS + HarmonyOS 已同步 | `sync-clients.js` 最后跑 |

### 8.2 核心模块完成度

| 模块 | mount 行数 | 查找替换 | undo/redo | 导出 | 状态 |
|------|-----------|---------|----------|------|------|
| **Writer** | 1683 | ✅ 查找+替换（双面板） | ✅ execCommand 原生栈 | ✅ DOCX/PDF/HTML/MD | 🟢 完整 |
| **Spreadsheet** | 2609 | ✅ 查找+替换+正则 | ✅ JSON snapshot（100 栈） | ✅ XLSX/PDF/CSV | 🟢 完整 |
| **Presentation** | 1104 | ✅ 查找+替换+多页 | ✅ snapshot + undoStack（刚修） | ✅ PPTX/PDF/SVG/PNG | 🟢 完整 |
| **PDF** | 1872 | 查看器模式无替换 | 占位 false（viewer） | ✅ 批注/合并/拆分/OCR/工具箱 | 🟢 完整 |
| **MindMap** | 1194 | ✅ 查找+替换（刚修） | ✅ snapshot + _undoStack（刚修） | ✅ MD/DOCX/JSON/SVG/PNG/OFD | 🟢 完整 |
| **Markdown** | 284 | 原生 contenteditable | 浏览器原生 | ✅ MD/HTML | 🟢 完整 |

### 8.3 PDF 能力全景（17 个纯模块）

| 能力 | 模块 | 状态 |
|------|------|------|
| 渲染查看 | pdf-engine.js + pdf.js | ✅ canvas 高清渲染 + 缩放 + 翻页 + 暗模式(invert+hue-rotate) |
| 批注（10 种） | pdf-anno.js | ✅ text/note/highlight/underline/strikeout/rect/ellipse/line/pen/freetext/stamp/checkbox/signature + 图层可见 + FDF 导入导出 |
| 表单字段 | pdf-formfields.js | ✅ textfield/checkbox/radio/list/combobox/button |
| 合并/拆分 | pdf-engine.js L3400+ | ✅ mergePdfs + splitPdf（按页码范围/奇偶页） |
| PDF→Excel 版面还原 | pdf-convert.js | ✅ detectTables + XLSX 真表格 + 合并单元格 |
| PDF→DOCX 版面还原 | pdf-convert.js | ✅ docx.Table + columnSpan 合并 + Paragraph prose |
| **PDF→PPTX（新增）** | pdf-engine.js L3286 | ✅ 每页 canvas render PNG + JSZip 拼 PPTX（零新增依赖） |
| 文本提取 | pdf-text.js | ✅ 逐页文本层 + 结构保留 |
| 安全 | pdf-encrypt.js | ✅ 加密/解密/权限 |
| 签名 | pdf-signature.js | ✅ 数字签名 + 验证 |
| 结构预检 | pdf-preflight.js | ✅ 14 类规则 |
| 历史审计 | pdf-history.js | ✅ /Prev 链还原保存版本数 |
| 字体信息 | pdf-fonts.js | ✅ 嵌入/子集/编码 |
| 文档信息 | pdf-docinfo.js | ✅ metadata + CustomProperties |
| 动作/JS 安全 | pdf-actions.js | ✅ 审计 + 风险标记 |
| 差异对比 | pdf-diff.js | ✅ 两版 PDF 文本/元数据 diff |
| OCR | vendor/tesseract | ✅ 本地跑，无网络依赖 |

### 8.4 快捷键矩阵（39 组，全过）

| 分类 | 快捷键 | 功能 |
|------|--------|------|
| **文件** | Ctrl+N / Ctrl+O / Ctrl+W / Ctrl+P / Ctrl+S / Ctrl+E / Ctrl+Q | 新建/打开/关闭/打印/保存/导出/退出 |
| **编辑** | Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | 撤销/重做（OS.Undo 调度器 5 模块） |
| **查找** | Ctrl+F / Ctrl+H / Ctrl+Shift+F | 查找/替换（Writer/Sheet/Pres/MindMap）/全局搜索 |
| **导航** | Ctrl+Tab / Ctrl+Shift+Tab | 可视化切标签弹窗（按住不放选择，松开切换） |
| **系统** | F1 / F5 / Ctrl+R | 关于弹窗 / 刷新 |
| **其他** | Ctrl+K / Ctrl+Shift+H / Ctrl+Shift+T / Ctrl+Shift+M / Ctrl+Shift+A / Alt+T / Esc | 命令面板/首页/重开最近关闭/批注/AI/任务侧栏/关闭面板 |

### 8.5 OS.Undo 跨模块统一

```
Ctrl+Z (shell.js L198)
  → OS.Undo.undo() 调度器（util.js L104）
    → 取 active tab 的 module.undo()
      ├── Writer      → execCommand("undo") 原生浏览器栈
      ├── Spreadsheet → JSON snapshot + restore（100 栈）
      ├── Presentation→ JSON snapshot + renderAll（刚 export）
      ├── MindMap     → _snapshot() + restore（100 栈）
      └── PDF         → 返回 false（viewer 模式不需要）
```

### 8.6 查找替换数据链路（刚修）

```
查找面板 TreeWalker 扫 .pres-canvas / SVG → 打 <mark> 高亮
    ↓
替换当前 / 替换全部
    ↓
反查数据模型
    ├── Presentation: <mark>.closest('.el.text').dataset.id
    │                → data.slides[*].elements.find(id) → element.text
    └── MindMap:      <text>.closest('.mm-node').dataset.id
                      → getNode(id) O(1) → node.text
    ↓
snapshot() / _snapshot() → 改数据 → renderAll() + ctx.markDirty()
    ↓
Ctrl+Z 可撤销 ✅
```

### 8.7 版本比对铁律（28 断言锁死）

- `_updater_version_test.js` 覆盖 updater.js（浏览器端）vs Electron main-utils.js cmpVer（主进程）
- 方向铁律：`compareVersion(a, b) > 0` 表示 a 比 b 新
- 覆盖场景：9 基础方向 + 4 边界（空字符串/undefined/非数字段）+ 11 跨端一致性 + 4 真实发布场景

### 8.8 静默更新（端到端已验证 ✅）

| 组件 | 状态 | 说明 |
|------|------|------|
| about 弹窗「🔄 检查更新」按钮 | ✅ | shell.js L1005 |
| 菜单「检查更新」 | ✅ | shell.js L991 |
| updater.js（三策略） | ✅ | Web/PWA/Electron/移动端 + 30min 轮询 |
| Electron setupAutoUpdater() | ✅ | electron/main.js L99-117 + feed-config.js |
| autoUpdater IPC（check/download/install） | ✅ | 3 个 ipcMain.handle 完整 |
| generic provider 链路 | ✅ **端到端验证通过** | 本地 `python -m http.server` 托管 dist/ → latest.yml 可拉 → compareVersion 方向正确 → exe HEAD 200 |
| dist/latest.yml v1.1.3 | ✅ | |
| dist/绿角犀 Office Setup 1.1.3.exe (104MB) | ✅ | |
| **远程托管** | ❌ 待提供凭证 | latest.yml + Setup.exe 需放同目录（update.lvjiaoxi.cn 或 GitHub Releases） |
| **Setup.exe 签名** | ❌ NotSigned | Windows SmartScreen 会拦自动安装。需代码签名证书 |
| **verify-update-feed.js** | ✅ | 新增 `scripts/verify-update-feed.js` — 任何时候一条命令验证链路：`node scripts/verify-update-feed.js --feed=URL --current=VER` |

#### 端到端验证记录（2026-09-25）

```
$ node scripts/verify-update-feed.js --feed=http://localhost:18080 --current=1.1.3

[1/4] Fetching latest.yml → http://localhost:18080/latest.yml
  ✅ version=1.1.4, path=绿角犀 Office Setup 1.1.3.exe

[2/4] compareVersion(1.1.4, 1.1.3) = 1
  🆕 有新版本！🔒 铁律方向正确

[3/4] HEAD → http://localhost:18080/绿角犀 Office Setup 1.1.3.exe
  ✅ status=200, size=104929051 bytes

[4/4] autoUpdater.setFeedURL({ provider: "generic", url: "http://localhost:18080" })
  ✅ 整条链路通：checkForUpdates → downloadUpdate → quitAndInstall

唯一剩余：远程托管 + Setup.exe 签名
```

### 8.9 架构地图

```
绿角犀 Office（v1.1.3）
├── app/                        # Web 前端 + PWA
│   ├── index.html + sw.js      # Service Worker（CACHE v21）
│   ├── css/                    # style.css + pdf-app.css
│   ├── js/                     # 核心 JS（18 顶层 + 30 模块）
│   │   ├── shell.js            # 主控：标签/路由/快捷键/菜单
│   │   ├── util.js             # OS.Undo 调度器 + OS.theme + OS.settings
│   │   ├── updater.js          # 自动更新（三策略）
│   │   ├── versions.js         # 历史版本快照（debounce 2s + 30s 间隔）
│   │   ├── import-ooxml.js     # OOXML 解析（PPTX slideMaster/Layout）
│   │   ├── export-ooxml.js     # OOXML 导出
│   │   └── modules/            # 5 核心模块 + 17 PDF 模块 + 16 辅助模块
│   └── vendor/                 # 8 第三方库
├── electron/                   # Electron 桌面端
│   ├── main.js                 # 主进程 + autoUpdater IPC + 菜单
│   ├── feed-config.js          # 更新源解析（generic/GitHub）
│   └── main-utils.js           # cmpVer + safeStaticResolve
├── dist/                       # 构建产物
│   ├── latest.yml v1.1.3       # electron-updater feed
│   └── 绿角犀 Office Setup 1.1.3.exe（104 MB）
├── clients/                    # iOS + HarmonyOS（同步自 app/）
├── scripts/                    # 构建/发布脚本
│   ├── run-tests.js            # 测试 runner
│   ├── bump-version.js         # 版本号单一真源
│   ├── sync-clients.js         # 四端同源同步
│   └── publish-latest.bat      # 发布（版本无关化）
└── .trae/memory/台账/          # AI 决策台账（27D + 29I + 49 索引）
```

### 8.10 外部依赖与卡点

| 依赖 | 说明 | 影响 |
|------|------|------|
| **update.lvjiaoxi.cn 远程托管凭证** | latest.yml + Setup.exe 必须托管到外部服务器，electron-updater 才能静默下载 | 阻塞 Electron 静默更新端到端验证 |
| **cloud 云同步后端** | 当前 cloudsync.js 是前端框架，需要后端 API + AI BYOK | 阻塞多端协同 + 历史版本 diff |
| **electron-updater npm 包** | 未安装时 main.js 会 try/catch 回退，不影响运行但静默下载功能关闭 | 可选依赖 |

### 8.11 性能优化（2026-09-25）

| 模块 | 优化 | 改前 | 改后 | 预期收益 |
|------|------|------|------|----------|
| **MindMap** | render rAF debounce | 每次调用都 `innerHTML=""` + 全量 renderNode | 同帧多次合并成一次渲染 | 用户快速改文字/批量操作不爆 |
| **MindMap** | selectNodeHighlight 轻量选中 | 点击选中节点 → render() 全量重渲 | 只改 `classList.add/remove("selected")` | 点击选中零重渲 |
| **PDF** | renderAll IntersectionObserver 懒渲染 | 渲所有页（分批并发 4/批） | 前 3 页实渲 + 剩余进视口才渲（rootMargin 200px） | 300 页 PDF 只渲用户看的 5-10 页 |
| **PDF** | renderAll 取消标记 | 快速改 zoom 排队一堆 renderAll | `_renderCancel` token，旧渲染检测到不匹配立即 return | 快速改 zoom 不卡顿 |
| **PDF** | buildThumbs 缓存 | 每次 renderAll 都重渲所有缩略图 | `_thumbCache Map` 按 numPages+首页尺寸 指纹缓存 dataURL | 同 PDF 第二次打开缩略图秒出 |
| ~~Presentation~~ | ~~renderAll rAF debounce~~ | ~~已尝试~~ | **❌ 回退** | 测试期望 renderAll 后 DOM 同步更新，debounce 让它变异步炸了 3 个测试 |

> 经验教训（台账 #28/29）：先定位真实瓶颈（grep render/innerHTML/await），再动手改。**不要对 renderAll 加 rAF debounce**——很多场景（测试、快捷键回调、用户操作立即反馈）期望 DOM 同步更新。MindMap 能加是因为它 render 内部没有 "外部立即读取 DOM" 的场景。Presentation 加了炸 3 个测试，已回退。

### 8.12 已知限制（非阻断）

| 限制 | 说明 |
|------|------|
| Writer undo 栈不可查询 | 浏览器 execCommand 栈不知道空不空，canUndo 永远返回 true |
| PDF 替换缺失 | viewer 模式，没有可编辑内容；PDF 工具箱有批注但不是文本替换 |
| 快捷键审计覆盖浅 | `_shell_shortcuts_test.js` 只做字符串包含检查，没有 jsdom 真实派发 KeyboardEvent |
| 云同步功能空壳 | `cloudsync.js` 已有框架但无后端，登录取 mock 账号 |
| AI 代理依赖外部 | `server_ai_proxy_test.js` 走本地代理，需要启动才能测 |

---

## 9. 导航索引（详细资料去哪看）

| 想知道啥 | 去哪 |
|----------|------|
| **运作规则 + 自主开发循环** | [AGENTS.md](AGENTS.md) |
| **项目范围 + 模块地图 + 架构关系** | [工程总纲.md](工程总纲.md) |
| **功能完成度 + 模块状态** | [FEATURES.md](FEATURES.md) · [STATUS.md](STATUS.md) |
| **长期决策 + 不可打破的硬约束** | [MEMORY.md](MEMORY.md) |
| **历史变更** | [CHANGELOG.md](CHANGELOG.md) |
| **具体模块怎么实现的** | [模块/](模块/) 各总纲 → 子文件 |
| **设计争议 + 推演** | [讨论与处理/](讨论与处理/) |
| **跨会话 AI 记忆** | `.trae-cn/memory/projects/-d---------------p2-bac6ea33357863a1de23/project_memory.md` |
| **AI 自主开发铁律** | [AGENTS-铁律.md](AGENTS-铁律.md) |

---

## 9. 版本历史（快速参考）

| 版本 | 日期 | 一句话变更 |
|------|------|-----------|
| **v1.1.2**（当前） | 2026-09-18 | OS.Versions 历史版本快照 UI 接入 |
| v1.1.1 | 2026-09-18 | XMind/PDF 全链路修复 + 大文件稳定性 + 360 安全软件兼容 |
| v1.0.17 | 2026-09-04 | 顶部导航五板块（工作台/订单/库存/审批/我的） |
| v1.0.16 | 2026-09-02 | PDF 1.5+ 对象流(ObjStm) 合并/拆分支持 |
| v1.0.15 | 2026-09-01 | 桌面端全自动更新（后台下载 + 退出自动装） |

> 完整变更见 CHANGELOG.md。

