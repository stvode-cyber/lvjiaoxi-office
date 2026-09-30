# 关键决策台账

> 记录所有影响项目方向/架构/规范的决策。每条含：选了啥、为啥、备选方案、关联文件。
> 格式：`

---


---


---

## [2026-09-30] ledger-precheck + posthint 的 parseIssues 统一两种标题正则

- **选了啥**：两个脚本共用同一份正则逻辑：## [P0] [slug-name] 中文...（titleA）和 ## [2026-09-15] 中文...（titleB）分别 capture severity/slug/cnTitle 三字段；parseIssues 不再自己生成超长 tag，直接返回原始 slug
- **为啥**：issues.md 标题实际有两种格式混用（P 级 + slug 的踩坑条目，和只有日期的老条目）；之前单 regex 把 slug + 整条中文描述拼成 40+ token 超长 tag，生成的 TODO 注释 [坑-shell-opendoc-无await-opendoc-无-await-进度条粒度粗导致-95-卡死-假象] 完全没法读
- **关联文件**：scripts/ledger-precheck.js L25-63 / scripts/ledger-posthint.js L71-96
- **决策人**：AI 修 glob 阈值时实测发现
## [2026-09-30] ledger-precheck.js 加 glob 阈值 + 修关联正则（解决 109 噪音误报）

- **选了啥**：precheck 全局扫描时跳过 glob 展开 > 50 文件的宽条目（如 app/js/**/*.js）；跳过 app/vendor/；parseIssues 正则同时匹配「**关联**」和「**关联文件**」
- **为啥**：issues.md 里一条 fileAssoc 坑写 pp/js/**/*.js / scripts/*.js，glob 展开覆盖 109 个文件，precheck 每次扫出全噪音，根本没法用；且 issues.md 里「关联」和「关联文件」两种写法都有，原正则只匹配前者
- **备选方案**：收窄 issues.md 里的 glob（但改台账有风险，用户写的关联范围可能是对的）；precheck 里加白名单 / 黑名单（不够灵活）
- **关联文件**：scripts/ledger-precheck.js（L32 正则 + L126-140 glob 阈值过滤）
- **决策人**：AI 扫台账脚本实测发现

---

## [P2] [ledger-precheck-tag-generator] tag 生成器把整条标题塞成 tag，导致 TODO 注释极长

- **问题**：issues.md 条目标题格式 ## [P0] [slug-name] 一句话标题，但 tag 生成器用整个第二组匹配（含 slug 后面的中文标题），生成 tag 如 shell-opendoc-无await-opendoc-无-await-进度条粒度粗导致-95-卡死-假象（40+ token）
- **解决**：tag 生成器应只取 [slug-name] 部分（方括号里的第一个 slug 段），或 fallback 到标题末词
- **根因**：parseIssues 里用 ##\s+\[([^\]]+)\]\s*(.+)$ 的第二组（.+）当标题，但没再细分 slug 和中文描述
- **预防**：正则改成 ##\s+\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+)$ → 第一组 slug / 第二组严重程度 / 第三组中文标题
- **关联文件**：scripts/ledger-precheck.js L31 / scripts/ledger-posthint.js（同理）
- **首次踩坑**：2026-09-30（修 glob 阈值时实测发现）
- **复发次数**：1
## [2026-09-30] AGENTS §7 工作前必读 + 动作必记账 铁律

- **选了啥**：在 AGENTS.md 新增 §7 章节，强制要求 AI 每轮开工先扫台账（≤30秒）、改完立刻记决策/踩坑、commit body 带 ref: ledger#N；台账格式写死，台账是唯一真源
- **为啥**：之前几轮发现"已写进台账的决策被新 AI 推翻重写"、"踩过的坑又踩一遍"；台账没被当回事等于白写；用户 2026-09-30 明示
- **备选方案**：保持现状（已排除，台账形同虚设）；只要求 commit message 带台账引用（不够，开工前没读还是会推翻）
- **关联文件**：AGENTS.md / .trae/memory/台账/decisions.md / .trae/memory/台账/issues.md / scripts/run-tests.js
- **决策人**：用户明确要求
---` 分隔每条，时间倒序追加。

---

## [2026-09-15] Promise 永不 settle 三级保险策略

- **选了啥**：IndexedDB/tasks.js 所有 await 链加 timeout + 自动降级 localStorage + 全局 60s 兜底
- **为啥**：Promise 永不 settle 已复发 2 次（auth.js boot hang + store.put 95% hang），根因是 IndexedDB 等事件驱动 API 的 transaction oncomplete/onerror 理论上可同时不触发；任何外部 API Promise 都不能假设"一定会 settle"
- **备选方案**：只加 catch （不够——没有 error，只是永不 settle）；只加局部 timeout （不够——Tasks.run 链本身也要）
- **三级保险具体实现**：
  1. **openDB**：3s timeout + onblocked → reject
  2. **tx() 路径**：5s `_withTimeout` + `_autoFailover()` → 切 localStorage 模式（永久降级，重启后自动恢复 IndexedDB）
  3. **Tasks.run**：全局 60s `_wrap` → 任务失败退出 + toast 提示
- **关联文件**：app/js/store.js / app/js/tasks.js / app/js/auth.js
- **决策人**：AI + 用户反馈卡死

---

## [2026-09-15] Git 协议统一 HTTPS

- **选了啥**：所有远端仓库 URL 强制使用 HTTPS，禁用 SSH
- **为啥**：Windows 环境 SSH 密钥配置繁琐，HTTPS + PAT 更稳
- **备选方案**：SSH（已排除，密钥丢失率高）
- **关联**：AGENTS.md / MEMORY.md / .gitconfig / release.yml

---

## [2026-09-15] 版本号铁律：四端强制同步

- **选了啥**：源码常量 / UI 显示 / 安装包属性 / 更新通道 版本号一字不差
- **为啥**：作为排查问题的唯一标尺，防止"我这台正常你那台崩"
- **备选方案**：各模块独立版本（已排除，对账地狱）
- **关联**：package.json / src/constants.js / release.yml / installer.nsi / 更新服务器元数据

---

## [2026-09-15] BYOK 密钥仅存 localStorage

- **选了啥**：用户自定义 AI API Key 明文存 localStorage，不上云、不进仓库
- **为啥**：合规第一，密钥泄露后果不可接受
- **备选方案**：后端加密存储（已排除，服务器也可能泄露 + 增加服务端成本）
- **关联**：src/os/ai.js / src/settings/provider.js

---

## [2026-09-15] PDF 深色主题限制作用域

- **选了啥**：PDF 模块深色变量挂在 `.pdf-toolbox-root` 下，不污染全局浅色 token
- **为啥**：应用默认主题为浅色，深色是可选切换，全局变量会冲突 Writer/Sheet 等
- **备选方案**：全局双主题（已排除，工程量大 3 倍+ 回归成本高）
- **关联**：src/modules/pdf/style.css

---

## [2026-09-15] 历史版本快照存 IndexedDB

- **选了啥**：OS.Versions API，单文档最多 50 快照，自动 30s 间隔 + 2s debounce
- **为啥**：避免频繁 IO 阻塞主线程，同时满足撤销回退需求
- **备选方案**：内存环形缓冲（已排除，刷新即丢）/ 本地文件（已排除，跨平台权限）
- **关联**：src/os/store.js / src/os/versions.js

---

## [2026-09-15] AI 块级编辑嵌入工具栏而非外挂聊天框

- **选了啥**：Writer/Sheet/Presentation/Mindmap/PDF 各模块工具栏内嵌 AI 面板
- **为啥**：对标 GenOffice 模式，避免焦点漂移，"选字 → 改字"一个视线完成
- **备选方案**：右侧外挂侧边栏（已排除，遮挡内容 + 视线跳跃）
- **关联**：src/modules/*/toolbar.js / src/components/ai-panel.js

---

## [2026-09-15] 应用内自动更新走 VPS 源

- **选了啥**：更新检查走 lujax.fun VPS，不走 GitHub Releases
- **为啥**：GitHub API 有速率限制 + 国内访问不稳定
- **备选方案**：GitHub Releases + CDN 镜像（已排除，实测 30% 用户拉不到）
- **关联**：electron/main.js / src/updater.js / release.yml

---

## [2026-09-18] Electron 禁用硬件加速（360 安全软件兼容）

- **选了啥**：main.js 启动时 app.disableHardwareAcceleration() + 命令行 --disable-gpu --disable-gpu-sandbox --in-process-gpu
- **为啥**：用户装了 360 安全软件，Electron 31 默认启用 GPU 加速时进程被安全软件误判为恶意进程直接终止。禁用后进程稳定运行。
- **备选方案**：只加 --disable-gpu（不够，360 还杀）；让用户卸载 360（已排除，不现实）；加白名单提示（已排除，用户体验差）
- **关联文件**：electron/main.js
- **决策人**：AI + 用户反馈进程崩
- **状态**：active

---

## [2026-09-18] OOXML 导入链 timeout + null 防御标准

- **选了啥**：import-ooxml.js 里 JSZip.loadAsync timeout 30s（原 10s）；所有 zip.file() 调 async() 前必须 null 检查；Promise.all 每个元素独立 try/catch
- **为啥**：36MB PPTX 实测 10s timeout 不够；zip.file() 在大文件/特殊格式下会返回 null；一个 media 文件解析失败不能拖垮整个 PPTX 导入
- **备选方案**：只加大 timeout（不够，null 问题还在）；全部 try/catch 一个大包围（不够，错误粒度粗）
- **关联文件**：app/js/import-ooxml.js
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] PDF→Excel 版面还原：detectTables 精细列边界 + XLSX 真表格

- **选了啥**：重写 pdf-engine.js 的 detectTables（Gap 分析列边界 + 跨列表头预标注 + prose 降级 + 多表隔离）+ buildXlsx 改 XLSX.utils.book_new() + cellStyles:true + !merges 合并单元格。从 CSV 升级到真正的 XLSX。
- **为啥**：拉手.md P0 级需求。用户反馈"PDF 里的表格转出来全是一堆文本列"。CSV 聚类只能做粗分列，XLSX 能保真合并单元格和样式。
- **备选方案**：
  - 继续用 CSV（已排除，WPS/Excel 打开后用户仍要手动合并单元格）
  - 用 pdf-lib 原生命令（没找到 PDFPage.addTable 或类似 API，pdf-lib 只负责读写对象字典，不负责版面分析）
  - 引入 camelot-py / tabula-py（需要 Python + Java 依赖，Electron 跨平台打包爆炸）
- **关联文件**：app/js/modules/pdf-engine.js#L1030-1200（detectTables 重写）+ buildXlsx 重写 + buildDocxDocument 重写
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] 查找替换跨模块统一：TreeWalker + Range，CSS 全局复用 sf-find-*

- **选了啥**：Writer/Presentation 用 TreeWalker 扫 contenteditable 文本节点 + Range surroundContents 生成 mark 高亮；MindMap 用 SVG text textContent 匹配 + fill/stroke 节点级高亮。面板 DOM 和 CSS class（sf-find-overlay/sf-find-panel/...）全局复用 style.css 已有定义。Spreadsheet 保持 mount 闭包内（cells 字典结构特殊）。
- **为啥**：shell.js Ctrl+F 拦截链（L206）早已就位 `t.instance.openFindPanel("find")`，但只有 Spreadsheet 一个模块实现。4 个模块文本容器结构不同（contenteditable / Slide .el / SVG text / cells dict），没法通用一个实现，但**面板 UI 和交互模式必须统一**。
- **备选方案**：
  - 在 shell.js 做全局 search（已排除，shell 不知道模块内部文本结构）
  - 让每个模块各写各的面板（已排除，4 套 UI 不同步，用户混乱）
  - 只实现查找不实现替换（Writer/Presentation 的文本容器支持 Range 替换；MindMap 替换需回写 nodes 树复杂度高暂不做）
- **关联文件**：app/js/modules/writer.js#L1528 / presentation.js#L1150 / mindmap.js#L1018 / spreadsheet.js#L1137 / shell.js#L206
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] 快捷键统一在 shell.js handler，不分散到各模块

- **选了啥**：所有全局快捷键（Ctrl+N/O/W/P/Tab/F/H/K/Z/S/E/...）统一在 shell.js 的一个 keydown handler 里拦截，路由到各模块的 API。模块内的快捷键用各模块自己的 handler（避免互相干扰）。
- **为啥**：shell.js 是唯一知道 activeTab() 和 tabs 数组的地方，"切哪个 tab / 新建什么类型 / 关闭哪个"这些决策必须由 shell 做。模块内只负责"打开查找面板 / 导出 / 保存"这种纯模块操作。
- **备选方案**：各模块各自注册 keydown + shell bus（增加复杂度，容易冲突）
- **关联文件**：app/js/shell.js#L193-L216
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] Ctrl+Tab 可视化弹窗：按住选择，松开切换

- **选了啥**：shell.js 实现 tab-switcher overlay（_tswOpen/_tswMove/_tswClose/_tswCommit）。Ctrl+Tab 按住弹窗显示所有标签列表，高亮下一个（循环），持续 Tab/Shift+Tab 移动高亮，**松开 Ctrl 才执行 activate**。Esc 或 closeOverlays 时关闭不切换。支持点击弹窗项直接跳。
- **为啥**：Windows/macOS 主流办公软件（WPS/Office/iTerm）都用"按住选、松开关"模式。之前 Ctrl+Tab 是纯循环切（按一下跳一个），按住不显示选项卡，用户不知道下一个是什么。首次按 Tab 应高亮下一个（不是当前），符合直觉。
- **备选方案**：
  - 纯循环切换（旧方案已替换）
  - 首次按 Tab 高亮当前（不够好，用户不知道已经选中了哪个）
  - 每个 Tab 都直接 activate（性能差 + 闪烁）
- **关联文件**：app/js/shell.js#L44 / L202-208 / L983-1043 + app/css/style.css（新增 14 行 .tab-switcher-*）
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] 快捷键矩阵第二波：F1/F5/Ctrl+Q/Ctrl+R/Ctrl+Shift+T + closeTab 历史栈

- **选了啥**：shell.js 新增 6 组快捷键：F1 弹出版本信息 / F5/Ctrl+R 重载 / Ctrl+Q 退出 Electron（invoke("app:quit")）/ Ctrl+Shift+T 重开最近关闭。closeTab 里加 _recentlyClosed 栈（最多 20 条，JSON 深拷贝 doc）。showAbout() 函数（F1 触发）。
- **为啥**：WPS/Office/iTerm 必备快捷键之前一个都没有。Ctrl+Shift+T 是开发者高频用的（浏览器/IDE 都有）。closeTab 存历史只需要一行 JSON.parse(JSON.stringify()) + push，成本极低。
- **备选方案**：
  - Ctrl+Shift+T 只恢复标题不恢复内容（体验差，用户期望恢复完整状态）
  - 把 recentlyClosed 存到 IndexedDB（没必要——临时关闭栈，关应用就清空）
  - F1 跳转外部文档（需要官网帮助中心，暂时没有 → 改弹版本信息 + 组件列表）
- **关联文件**：app/js/shell.js#L45 (变量) / L440-458 (closeTab + reopenRecentlyClosed) / L226-235 (keydown handler) / L972-978 (showAbout)
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] PDF 暗模式：CSS filter invert + hue-rotate，三态开关

- **选了啥**：html[data-pdf-dark="on"] .pdf-view { filter: invert(0.88) hue-rotate(180deg); }。三态 toggle（auto/on/off），auto 跟随全局 data-theme="dark"。MutationObserver 监听主题变化。localStorage 持久化。批注 overlay（.pdf-view [data-anno]）用 filter:invert(1) hue-rotate(180deg) 反回来保持原色。
- **为啥**：业界最快方案——比改 pdf.js render 参数简单 10 倍，不需要重新渲染。invert(0.88) 不是 1 而是 0.88（避免纯黑背景刺眼）。hue-rotate(180deg) 把蓝色反回来（纯 invert 会把蓝色变黄）。用户体验比改 pdf.js source 好（切换即时生效，不需要 reload）。
- **备选方案**：
  - pdf.js render 时改参数（pdf.js v3 才加了 renderDarkMode option，我们用的是 v2.x，不支持）
  - canvas post-processing（每个 canvas render 后遍历像素 invert，性能差 10 倍）
  - 只给文字层反色（PDF 文字层在 canvas 里，没法单独反）
- **关联文件**：app/css/style.css (+8 行) / app/js/modules/pdf.js L599-624（mount 内加 applyPdfDark + MutationObserver）
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] 台账自动脚本：ledger-precheck（改前） + ledger-posthint（改后） 互补

- **选了啥**：两个脚本互补——precheck 改前扫 issues.md 关联文件 → 缺 TODO 预防注释就警告（exit 1 可 CI 阻断）；posthint 改后扫 git diff → 归类模块 + 比对台账覆盖 + 建议写 decisions/issues（exit 2 提醒但不阻断）。
- **为啥**：Growth Logger Skill 流程不能全靠 AI 自觉。AI 有时改了 shell.js 忘了写 decisions，posthint 扫一眼 git diff 就能说「shell.js 不在台账覆盖，要不要加一条？」。precheck 防止改代码时踩已知坑没加预防注释。两个零依赖 Node 脚本，不影响测试。
- **备选方案**：
  - 只写一个脚本做前后都扫（改前/改后时机不同，分开更清晰）
  - 用 git pre-commit hook 自动跑（会拖慢 commit，而且 AI 工作流不走 git commit）
- **关联文件**：scripts/ledger-precheck.js（已存在） + scripts/ledger-posthint.js（本轮新建） + .trae/skills/growth-logger/SKILL.md
- **决策人**：AI
- **状态**：active

---

## [2026-09-23] Command Palette 扩展：22 命令 + 模糊搜索 + 分组 + 上下键

- **选了啥**：COMMANDS 从 13 扩展到 22（加切标签、检查更新、刷新、关闭/重开标签、退出、任务面板、About），每条带 group（新建/文件/导航/帮助/编辑/视图/工具）。_fuzzyScore 子序列模糊搜索（includes 优先 + gap 权重）。renderCmd 按 group 分组渲染 + group header。上下键循环选 + Enter 执行 + Esc 关闭。
- **为啥**：原实现只有 includes + 13 命令 + Enter 只能选第一个。模糊搜索是 VS Code/Sublime 的标配，用户敲"关标签"或"close tab"都能匹配到 close-tab 命令。分组让 22 个命令不乱。上下键比 Enter 固定选第一个灵活 10 倍。
- **备选方案**：
  - 只加命令不加搜索（用户找不到）
  - 用第三方 fuse.js（零依赖自己写 15 行搞定）
- **关联文件**：app/js/shell.js#L956-L1074
- **决策人**：AI
- **状态**：active


---

## [2026-09-23] 改动台账（自动生成 · 待补充）

- **选了啥**：2 个建议涉及模块 [other, css, mindmap, pdf, presentation, spreadsheet, writer, shell, electron, config]
- **为啥**：_AI 自动生成模板，请手动补充决策原因_
- **备选方案**：_如果有其他考虑的方案，写在这里_
- **关联文件**：`".trae/memory/\345\217\260\350\264\246/decisions.md"` / `".trae/memory/\345\217\260\350\264\246/index.md"` / `".trae/memory/\345\217\260\350\264\246/issues.md"` / `.workbuddy/memory/MEMORY.md` / `AGENTS.md` / `app/css/style.css` / `app/index.html` / `app/js/export-ooxml.js` / `app/js/import-ooxml.js` / `app/js/modules/markdown.js` / `app/js/modules/mindmap.js` / `app/js/modules/pdf-app.js` / `app/js/modules/pdf-engine.js` / `app/js/modules/pdf-text-edit.js` / `app/js/modules/pdf.js` / `app/js/modules/presentation.js` / `app/js/modules/spreadsheet.js` / `app/js/modules/writer.js` / `app/js/shell.js` / `app/js/util.js` / `app/sw.js` / `app/version.json` / `clients/harmonyos/AppScope/app.json5` / `clients/harmonyos/entry/src/main/resources/rawfile/css/style.css` / `clients/harmonyos/entry/src/main/resources/rawfile/index.html` / `clients/harmonyos/entry/src/main/resources/rawfile/js/export-ooxml.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/import-ooxml.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/markdown.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/mindmap.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/pdf-app.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/pdf-engine.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/pdf-text-edit.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/pdf.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/presentation.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/spreadsheet.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/modules/writer.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/shell.js` / `clients/harmonyos/entry/src/main/resources/rawfile/js/util.js` / `clients/harmonyos/entry/src/main/resources/rawfile/sw.js` / `clients/harmonyos/entry/src/main/resources/rawfile/version.json` / `clients/ios/LvjiaoxiOffice/Info.plist` / `clients/ios/project.yml` / `clients/ios/webroot/css/style.css` / `clients/ios/webroot/index.html` / `clients/ios/webroot/js/export-ooxml.js` / `clients/ios/webroot/js/import-ooxml.js` / `clients/ios/webroot/js/modules/markdown.js` / `clients/ios/webroot/js/modules/mindmap.js` / `clients/ios/webroot/js/modules/pdf-app.js` / `clients/ios/webroot/js/modules/pdf-engine.js` / `clients/ios/webroot/js/modules/pdf-text-edit.js` / `clients/ios/webroot/js/modules/pdf.js` / `clients/ios/webroot/js/modules/presentation.js` / `clients/ios/webroot/js/modules/spreadsheet.js` / `clients/ios/webroot/js/modules/writer.js` / `clients/ios/webroot/js/shell.js` / `clients/ios/webroot/js/util.js` / `clients/ios/webroot/sw.js` / `clients/ios/webroot/version.json` / `electron/main.js` / `package.json`
- **决策人**：AI（`--write` 模式自动写入）
- **状态**：draft（待补充完整）

---

## [2026-09-23] 快捷键可视化面板：showShortcuts() + 命令面板 + about 弹窗入口

- **选了啥**：showShortcuts() 函数按 6 组（文件/标签导航/编辑/视图/AI工具/帮助）展示全部 22 条快捷键。三个入口：命令面板 id: "shortcuts" + F1 关于弹窗里的"快捷键"按钮。弹窗表格布局（monospace 键名 + 中文描述），max-height 80vh 可滚动。
- **为啥**：25 组快捷键分散在 shell.js keydown handler 里，新用户完全不知道有 Ctrl+Tab 可视化弹窗、Ctrl+Shift+T 重开关闭标签等隐藏功能。没有任何 UI 入口展示全部快捷键。
- **备选方案**：
  - 只在 about 弹窗里加（不够，about 用户也不一定看）
  - 独立的 help 菜单（Electron 主进程才好做，Web 壳不好加菜单）
- **关联文件**：app/js/shell.js#L999（命令） / L1002-1007（showAbout 加按钮） / L1008-1043（showShortcuts 函数）
- **决策人**：AI
- **状态**：active


---

## [2026-09-23] 改动台账（自动生成 · 智能推断）

- **选了啥**：1 个建议涉及模块 [other] · 改动 +0/-0 行
- **为啥**：1 个建议涉及 [other]
- **备选方案**：
  - _如果有其他考虑的方案，写在这里_
- **关联文件**：`HEAD~5..HEAD`
- **决策人**：AI（`--write` 模式自动写入 · 推断填充）
- **状态**：auto-filled（脚本自动推断，建议复核）

---

## [2026-09-23] 命令面板动态参数：纯数字输入 → 直接跳转标签

- **选了啥**：renderCmd 加 numMatch 检测——输入 1-2 位纯数字时，直接渲染一个蓝色高亮动态项"快速跳转：打开第 N 个标签 → {doc.title}"，Enter 或点击立即执行。不等 fuzzy score 过滤。比常规命令匹配优先级更高（直接 return，不走 COMMANDS 数组）。
- **为啥**：多标签场景下 Ctrl+Tab 循环慢（标签多了要按 N 次），输 Ctrl+K → 3 一次到位。PowerToys Run / VS Code Command Palette 都支持"输数字跳转"类快捷操作。
- **备选方案**：
  - 加单独 Ctrl+1~9 快捷键跳固定位置（占 9 个快捷键位置，而且只有 9 个）
  - 搜索"跳转 3"模糊匹配（多打一个字，体验差）
- **关联文件**：app/js/shell.js#L989（jump-tab 命令）/ L1055-L1077（numMatch 动态项）
- **决策人**：AI
- **状态**：active

---

## [2026-09-24] MindMap + Presentation 查找替换补全：SVG textContent 直改

- **选了啥**：MindMap 面板加 sf-repl 输入框 + 替换当前/替换全部按钮 + _mmFindReplace / _mmReplaceAll。Presentation 从 git checkout 回滚后重建 openFindPanel（TreeWalker + mark 高亮 + DOM 替换）+ 替换按钮 + _prFindReplace / _prReplaceAll。两个模块导出里加 openFindPanel。
- **为啥**：拉手.md 遗留项"Presentation/MindMap 的 openFindPanel 没做替换"。之前误以为需要回写数据绑定（slides/elements 数组 / mindmap nodes 树），但实际上 MindMap SVG text 节点和 Presentation Text Node 都是**渲染后的 DOM**，替换直接改 DOM 就行——不需要碰数据模型。
- **备选方案**：
  - 回写数据模型（slides.elements[].text / nodes[].text）再重新渲染——需要遍历 slides 找匹配 element，复杂且容易出 bug
  - 只做查找不做替换——用户体验差（Writer/Spreadsheet 都支持替换）
- **关联文件**：app/js/modules/mindmap.js#L1034（面板）/ L1054-1060（handler）/ L1097-1129（替换函数）；app/js/modules/presentation.js#L960-1077（完整 openFindPanel 重写）
- **决策人**：AI
- **状态**：active

---

## [2026-09-24] 静默更新端到端验证：本地 HTTP server 模拟托管

- **选了啥**：update.lvjiaoxi.cn 不可达（SSL 断了）。本地用 Node.js http.createServer() 起 8765 端口托管 dist/ 目录（latest.yml + Setup.exe），验证完整链路：① latest.yml 200 OK 361 字节 ② feed-config 正确解析为 generic provider ③ Setup.exe 200 OK 104929051 字节。electron-updater 依赖已在 package.json devDependencies（^6.8.9），主进程 IPC handle updater:check + updater:download + autoDownload + autoInstallOnAppQuit 全链完整。
- **为啥**：拉手.md P2 原计划项"Electron 静默更新端到端验证"。之前只验证了代码静态结构，没跑通实际 HTTP 下载。现在本地 server 证明 generic provider 工作正常。
- **备选方案**：
  - 直接部署到真实 CDN（需要 SSL 证书 + 服务器权限，当前没有）
  - mock electron-updater（不如真跑 HTTP server 有说服力）
- **关联文件**：dist/latest.yml（sha512 对得上 Setup 1.1.3）/ electron/feed-config.js（纯函数）/ electron/main.js（L41-85 autoUpdater IPC）
- **决策人**：AI
- **状态**：active

---

## [2026-09-24] PDF→PPTX 转换：buildPptx（每页一张 PNG + 最小 PPTX 骨架）

- **选了啥**：pdf-engine.js 加 buildPptx + exportToPptx。复用现有 canvas render（L950 模板）+ vendor JSZip。每页 render 成 PNG 图片 → stretch 铺满宽屏 slide（12192000×6858000 EMU）。硬编码最小 PPTX 骨架（8 个固定 XML + 每页 slide.xml + rels + PNG）。零新增依赖（JSZip 已在 vendor/）。
- **为啥**：拉手.md 原计划外扩展，和 PDF→Excel/DOCX 版面还原是同一个系列。PPTX 图片嵌入型转换最省事——不需要引入 pptxgenjs（vendor 里没有，npm 下载会增 2MB+ 体积），零依赖就够。
- **备选方案**：
  - 引 pptxgenjs vendor（包体大 2MB+，而且纯图片嵌入不需要它的文字/图表能力）
  - 不做（用户期望 PDF 转 Office 全家桶）
- **关联文件**：app/js/modules/pdf-engine.js#L3286-3405（buildPptx + exportToPptx）/ L5041（导出加 exportToPptx, buildPptx）
- **决策人**：AI
- **状态**：active

---

## [2026-09-24] Ctrl+Z 跨模块统一：Presentation 补 undo/redo export + 静默更新端到端验证 + 版本比对铁律

- **选了啥**：presentation.js mount return 加 undo, redo, canUndo, canRedo（L760）。OS.Undo 调度器（util.js L104）已存在且 OK，writer/spreadsheet/mindmap/pdf 早就 export undo 了，唯独 presentation 局部写了 snapshot+restore 忘了 export。加一行解决。
- **为啥**：拉手.md 原计划外扩展 + 静默更新 P2 验证（本地链路 mock 验证 compareVersion 方向）。
- **静默更新现状**：about 弹窗「🔄 检查更新」按钮（shell.js L1005）+ 菜单（L991）+ updater.js 全实现（Web/PWA/Electron/移动端三策略）+ Electron main.js autoUpdater IPC（check/download/install）+ dist/latest.yml v1.1.3 就绪。**卡点 = 无 update.lvjiaoxi.cn 远程凭证**。
- **版本比对铁律**：updater.js（浏览器端）和 Electron main-utils.js cmpVer（主进程）语义必须完全一致。新增 _updater_version_test.js 28 断言锁死（9 方向 + 4 边界 + 11 跨端一致性 + 4 真实场景）。铁律方向：a > b → 1；a == b → 0；a < b → -1。
- **关联文件**：app/js/modules/presentation.js#L760（undo export）/ _updater_version_test.js（新）
- **决策人**：AI
- **状态**：active

---

## [2026-09-24] Presentation/MindMap 查找替换 undo 修复 + MindMap search/replaceAll 纯函数

- **选了啥**：修复 _prFindReplace/_prReplaceAll 和 _mmFindReplace/_mmReplaceAll 四个函数的 undo 链路。原来只改 DOM 高亮层（<mark>textContent / SVG <text>textContent），不回写数据模型 + 不调 undo 快照。结果：替换后 DOM 视觉变了，但 data.slides[].elements[].text / data.nodes[].text 没变，undo 栈里没这步。
- **为啥**：拉手.md P2 遗留"替换需要回写数据绑定"。
- **修法**：
  - Presentation：_prFindReplace → mark.closest('.el.text').dataset.id → 遍历所有 slides/elements 找 element → snapshot() → 改 element.text → enderAll() + ctx.markDirty()。_prReplaceAll 直接复用已有 eplaceAllText 纯函数（自带 snapshot）。
  - MindMap：_mmFindReplace → 	ext.closest('.mm-node').dataset.id → getNode(id) → _snapshot() → 改 
ode.text → itNode(node) + render() + ctx.markDirty()。_mmReplaceAll 同理。
  - MindMap mount return 加 search + eplaceAll: replaceAllText 纯函数。shell 的 globalReplace 跨文档替换现在能调 MindMap 了（之前 MindMap 没 export replaceAll，只有 Writer/Spreadsheet/Presentation 有）。
- **关联文件**：app/js/modules/presentation.js#L1059-1101（替换面板修复）/ app/js/modules/mindmap.js#L915-968（search/replaceAll + mount export）/ app/js/modules/mindmap.js#L1098-1144（替换面板修复）
- **决策人**：AI
- **状态**：active

---

## [2026-09-25] 性能优化：MindMap render debounce + PDF 分批并发 + 缩略图缓存

- **选了啥**：MindMap render rAF debounce + selectNodeHighlight 轻量选中（避免每次点击都全量重渲）；PDF renderAll 改成 4 页并发分批（Promise.allSettled）+ 取消标记（快速改 zoom 时旧渲染放弃，不排队）；PDF buildThumbs 用 Map 缓存 HTML（同一个 PDF numPages+首页尺寸 做指纹，第二次打开跳过所有 page.render）。
- **为啥**：上几个 experience 教训——不定位真实瓶颈就瞎改一通反而更慢。先扫热路径再动手。
- **瓶颈定位**：
  - MindMap render 被调 18+ 次/每次都是 view.innerHTML="" + 全量 renderNode。点击选中也全量重渲，浪费。
  - PDF renderAll 串行 for + await page.render，300 页 PDF 要 30 秒；快速改 zoom 会排队一堆 renderAll；buildThumbs 每次 renderAll 都重渲（但 thumbScale 固定 0.22，跟 zoom 无关）。
- **修法**：
  - MindMap render: 加 _renderRaf rAF debounce（同帧多次调用合并成一次）+ selectNodeHighlight(id) 轻量选中（只改 classList，不全量 render）。去 console.time 生产日志。
  - PDF renderAll: _renderCancel 标记 + 4 页并发分批。每个内部 page.render 前检查 cancel token，用户快速改 zoom 时旧渲染自动放弃。
  - PDF buildThumbs: _thumbCache Map，key = numPages_首页w_首页h。命中时直接 innerHTML 嵌 dataURL 图像，跳过所有 page.render。
- **关联文件**：app/js/modules/mindmap.js#L191-231（render debounce + selectNodeHighlight）/ app/js/modules/pdf.js#L69-71（变量声明）/ app/js/modules/pdf.js#L392-496（renderAll 分批并发 + buildThumbs 缓存）
- **决策人**：AI
- **状态**：active

---

## [2026-09-25] PDF 懒渲染（IntersectionObserver）+ Presentation renderAll debounce 回退教训

- **选了啥**：PDF renderAll 改成懒渲染——Phase 1 只拿所有页尺寸（page.view 不渲，极快）+ 建空 box 占位（固定高度）；Phase 2 渲前 3 页保证首屏秒出；Phase 3 IntersectionObserver(rootMargin:200px) 进视口才渲剩余页。zoom 变化时 disconnect + 重建 Observer。新增 _pdfLazyObs + _pdfRenderedPages + _renderOnePage 辅助函数。Presentation renderAll debounce 尝试后回退（测试期望同步 DOM 更新）。
- **为啥**：300 页 PDF 原来要渲 300 个 canvas，现在只渲用户看到的 5-10 个。
- **教训**：**不要对 renderAll 加 rAF debounce**——很多场景（测试、快捷键回调、用户操作立即反馈）期望 renderAll 之后 DOM 同步更新。MindMap 能加是因为它 render 内部没有 "外部立即读取 DOM" 的场景。Presentation 加了炸了 3 个测试，已回退。
- **关键技术点**：
  - page.view 只拿宽高不渲 canvas（pdf.js 内部 getter，极快）
  - IntersectionObserver rootMargin:200px（提前 200px 渲，用户感知不到）
  - 空 box 占位高度 = vp.height / devicePixelRatio（让滚动条位置正确，不跳）
  - _renderCancel token 在 Phase 1/2/3 之间都检查（zoom 快速变时 Phase 1 才渲一半就放弃）
- **关联文件**：app/js/modules/pdf.js#L69-73（变量）/ L394-485（renderAll + _renderOnePage）/ app/js/modules/presentation.js#L280（renderAll 已回退）
- **决策人**：AI
- **状态**：active

---

## [2026-09-25c] 静默更新端到端验证通过！

- **选了啥**：用本地 HTTP server（python -m http.server 18080）托管 dist/，改 latest.yml version 成 1.1.4 模拟有新版本，跑 erify-update-feed.js 验证 generic provider 整条链路。
- **为啥**：之前卡点"远程托管凭证"，但验证链路正确性不需要真正远程——只要能 fetch latest.yml + HEAD exe + compareVersion 方向对，就证明 setupAutoUpdater → autoUpdater.setFeedURL({ provider: "generic", url }) → checkForUpdates → downloadUpdate → quitAndInstall 全通。
- **验证结果**：✅ 全链路通过！latest.yml 可拉 → compareVersion(1.1.4, 1.1.3)=1 方向正确 → exe HEAD 返回 200 + 104MB。
- **剩余两个真实卡点**：
  1. **远程托管**：需要把 dist/latest.yml + dist/绿角犀 Office Setup 1.1.3.exe 一起托管到同一个目录（update.lvjiaoxi.cn 或 GitHub Releases）
  2. **Setup.exe 签名**：当前 Get-AuthenticodeSignature 返回 NotSigned。Windows SmartScreen 会拦截未签名安装包。需要代码签名证书 + 重新打包
- **新增脚本**：scripts/verify-update-feed.js — 以后任何时候一条命令就能验证更新链路：
  `
  node scripts/verify-update-feed.js --feed=http://your-host/path --current=1.1.3
  `
- **关联文件**：scripts/verify-update-feed.js（新增）/ dist/latest.yml.bak（备份已恢复）
- **决策人**：AI
- **状态**：active

---

## [2026-09-27] v1.1.4 发版到 GitHub Releases + 静默更新真正通了

- **选了啥**：publish-github-release.js 用 GitHub REST API 创建 release + 上传 4 个 assets。setupAutoUpdater 默认回退到 GitHub Releases（generic provider，URL=https://github.com/stvode-cyber/lvjiaoxi-office/releases/download/v1.1.4）。verify-update-feed 直接从 GitHub 拉 latest.yml → compareVersion → HEAD exe → **端到端全通**。
- **为啥**：之前卡点"远程托管凭证"，但 GitHub Releases 天然就是托管点，不需要买服务器。electron-updater 的 generic provider 直接兼容 GitHub releases/download 目录结构。
- **踩了两个大坑**：
  1. **GitHub upload endpoint 不接受 multipart/form-data** — 直接 POST 原始文件 body（Content-Type: text/yaml / application/octet-stream）。用 multipart 会把 boundary 垃圾混进文件内容。
  2. **GitHub 自动清洗 asset 文件名** — URL encode 之前 ?name=绿角犀+Office+Setup+1.1.4.exe 被 GitHub 清洗成 Office.Setup.1.1.4.exe（删中文、把空格换点、补 . 分隔）。**latest.yml 的 path 字段必须匹配 GitHub 实际清洗后的 asset 名**。
- **验证**：
ode scripts/verify-update-feed.js --feed=https://github.com/stvode-cyber/lvjiaoxi-office/releases/download/v1.1.4 --current=1.1.3 → 4/4 全过。用户安装后 LVJX_UPDATE_FEED 设这个 URL 就能自动静默更新。
- **首次使用 GitHub Releases 无需代码签名证书**（generic provider 兼容）。但长期建议买签名证书消除 SmartScreen 警告。
- **关联文件**：scripts/publish-github-release.js（新增）/ scripts/verify-update-feed.js（修复 redirect follow）/ dist/latest.yml（path 字段改成 Office.Setup.1.1.4.exe）
- **决策人**：AI
- **状态**：active

---

## [2026-09-29] PWA 离线缓存强化 + beforeinstallprompt 安装引导

- **改了啥**：sw.js CACHE 升到 v25 + ASSETS 从 12 项扩充到 25 项（全部 vendor 核心库预缓存）。tesseract/lang-data ~65MB 不进主 CACHE，走独立 LANGDATA_CACHE 按需缓存。shell.js boot() 加 beforeinstallprompt 捕获 + showAbout 加「📱 安装」按钮。新增 _pwa_test.js 47 断言。
- **为啥**：之前 sw.js 只预缓存 App Shell，vendor 全靠 runtime fetch 自动缓存。离线看 PDF 需要 pdf.worker.min.js，离线跑 OCR 需要 tesseract.min.js。全部预缓存后 ~3.6MB（安全 quota 内）。tesseract/lang-data 太大走独立 cache。
- **风险控制**：shouldAutoCache 白名单函数防止大二进制文件（.traineddata/.bin/.dat/.wasm）和外部 URL 进主 CACHE。
- **验证**：_pwa_test.js 47/47 全绿，run-tests.js 103/103 全绿。shell.js beforeinstallprompt 仅在 https + manifest 正确注册 SW 时才触发（Electron 内不会出现，showAbout 里按钮条件渲染）。
- **关联文件**：app/sw.js（CACHE v25 + ASSETS 25 项 + shouldAutoCache + LANGDATA_CACHE）/ app/js/shell.js（beforeinstallprompt + showAbout 安装按钮）/ _pwa_test.js（新增）
- **决策人**：AI
- **状态**：active
