---

## [P0] [tesseract-worker-in-inline-script] worker.min.js 被 script 标签直接加载到主线程

- 问题：index.html 里写了 script src=worker.min.js 把 Web Worker 脚本当普通 JS 加载到主线程，每次页面加载 12+ 次 dispatchHandlers 异常（TypeError: t.action is not a function）
- 解决：移除那行 script 标签。Tesseract.createWorker 会在 OCR 真正被调用时动态 new Worker 加载
- 效果：初始页面从 12+ 次异常变成零异常
- 根因：worker-*.js 脚本里的 self.addEventListener('message', handler) 在主线程 context 下初始化时，self 不是 WorkerGlobalScope，dispatchHandlers 里的 t.action 为 undefined
- 预防：任何 worker-*.js / *worker.min.js 绝对不能用 script src 直接加载
- 关联文件：app/index.html
- 首次踩坑：2026-09-16（持续了好几天没被发现，因为之前 CDP 只显示 "Uncaught" 没 stack，诊断层加了全局 error handler 后才看到完整 stack）
- 复发次数：1

---

## [P0] [boot-test-regex-eats-body] boot test 的 script regex 被注释里的 script 文本击穿

- 问题：在 index.html 加的 worker 移除注释里不小心出现了 script 这个精确字符串，boot test 的正则 str.replace(/<script[\s\S]*?<\/script>/g, '') 从注释里的 script 开始非贪婪匹配，一直吃到真正的闭合 script 标签，结果把整个 body + 所有 app scripts 都吃掉了
- 解决：注释里的 script 改成 "inline as a direct tag"（不用尖括号）
- 根因：JS 正则 <script[\s\S]*?<\/script> 不理解 HTML 注释，会把注释里的 script 文本当作真正标签匹配起点
- 预防：在 HTML 文件的注释 / 文本节点里避免写 <script> / </script> 这些精确模式字符串
- 关联文件：app/index.html, _app_boot_test.js
- 首次踩坑：2026-09-16
- 复发次数：1

# 踩坑台账

> 每条：问题 / 解决方法 / 根因 / 预防 / 严重程度 / 关联文件。
> 严重程度：P0=阻断发布 / P1=影响核心体验 / P2=影响局部 / P3=不爽但能用
> 格式：`---` 分隔每条，时间倒序追加。

---

## [P0] [shell-openDoc-缺renderTabbar] openDoc 里 tabs.push 后没调 renderTabbar，tabbar 无 DOM

- **问题**：import 完 XMind 后 openDoc 全跑完了、toast "已打开" 弹了、mindmap 也渲染了，但 **tabbar 上没有那个 tab 按钮** — 用户看不到 tab 以为卡死；自动化查 `.tab.length = 0`
- **解决**：openDoc 里 `tabs.push(t)` 后、`activate(t)` 前加 `renderTabbar()`
- **效果**：tabbar DOM 正确渲染，active class 正确，用户能看到 tab
- **根因**：openDoc 是唯一的 tabs.push 入口，但之前只调 activate 里的 `document.querySelectorAll(".tab").forEach(el => el.classList.toggle("active", ...))` 去设 active class — 但 tabbar 上根本没有新 tab 的 DOM 元素，querySelectorAll 遍历空集合啥也没做
- **预防规则**：
  1. **任何 tabs.push/splice 操作** 后必须调 renderTabbar()
  2. **自动化测试** 必须检查 `.tab` DOM 元素数量而非只看内存变量
- **关联文件**：app/js/shell.js L351
- **首次踩坑**：2026-09-16（CDP 完整链路自动化发现）
- **复发次数**：1（从 shell-openDoc-无await 修复后发现）
- **是否入 Skill**：待定

---

## [P2] [shell-openDoc-无await] openDoc 无 await + 进度条粒度粗导致"95% 卡死"假象

- **问题**：导入 XMind 时进度条停在 95% "保存到本地" 很久才消失，用户以为卡死；实际是 store.put 完后 openDoc(doc) 没 await，Tasks.run 认为快完了但主线程还在同步 mount 800ms+
- **解决**：
  1. importFileObj 里 store.put 后加 `r.step("渲染中...", 1.0)` — 进度条立即走完 100%
  2. `await openDoc(doc)` — Promise 链保持完整（虽然 openDoc 内部全同步）
  3. openDoc 加 `console.time/timeLog` 埋点（[OPEN-DOC] tag），以后卡了看 console 就能定位
- **效果**：2501 节点完整链路 832ms，用户看到进度条 100% "渲染中..." → toast "导入完成"，不再觉得卡死
- **根因**：
  - Tasks.run 回调是同步/混合执行 — store.put (52ms) 完后 mount (779ms) 同步占主线程，Tasks.run 必须等 openDoc 返回才算 done
  - 进度条只给到 0.95（"保存到本地"），没给 mount 阶段 step，导致用户看到"停住"
- **预防规则**：
  1. **Tasks.run 回调里的长操作**（>200ms）必须有对应 step 进度，不能只给前半段
  2. **所有 openDoc/doc load 类调用** 必须 `await`（哪怕函数内同步），保持 Promise 链语义完整
  3. 长同步操作考虑 rAF 分帧让事件循环喘口气
- **关联文件**：app/js/shell.js
- **首次踩坑**：2026-09-16（CDP 完整链路量化发现）
- **复发次数**：0
- **是否入 Skill**：待定

---

## [P2] [mindmap-渲染性能] O(N²) 查询 + fitNode 重复计算导致 mount 3000 节点 1344ms

- **问题**：3000 节点 mindmap mount 耗时 1344ms，主线程阻塞导致 UI 假死，用户以为卡死
- **解决**：
  1. mount 开头建 `_nodeById` / `_childrenMap` 两个 Map 索引，getNode/childrenOf 从 O(N) → O(1)
  2. layoutMap() 入口调 `_rebuildIndex()`（O(N)，每次布局前重建）
  3. fitNode 加 `_fitSig` 缓存（text+fontSize+maxW hash），layoutMap.place + render 各调一次只算一次
- **效果**：3000 节点 1344ms → **436ms（↓67.6%）**，500 节点 79ms（用户无感知）
- **根因**：
  - `getNode(id) = data.nodes.find()` → O(N) 线性扫描，edgesForRender 每条边调 2 次 = 2×N 次扫描
  - `childrenOf(id) = data.nodes.filter()` → 每次调用重建数组，layoutMap 递归里反复调
  - `fitNode(n)` 无缓存 → layoutMap.place 和 render 各调一次，Canvas measureText 每节点重算
- **预防规则**：
  1. **节点查询密集的场景**（布局/渲染）必须用 Map 索引：id→node, parentId→[children]
  2. **重计算函数**（Canvas measureText / layout）必须加 signature 缓存
  3. **导入/大节点数 mount** 必须先测性能再合入
- **关联文件**：app/js/modules/mindmap.js
- **首次踩坑**：2026-09-16
- **复发次数**：0
- **是否入 Skill**：待定

---

## [P2] [parseXmind-国际化title] XMind 2020+ 的 title 可能是国际化对象而非字符串 → .trim() 抛 TypeError

- **问题**：parseXmind 递归 xmJsonToNodes 时，title 是 `{ zh_CN: "xxx", en_US: "xxx" }` 格式的对象，L1015 `(rootTopic.title || ...).trim()` 把对象当字符串调 .trim() → TypeError
- **解决**：在 .trim() 前先检测 typeof !== "string" → 取 zh_CN / en_US / Object.values()[0]；同时 children.forEach 加 ch null 守卫
- **根因**：XMind 2020+ content.json 支持多语言 title，但代码假设 title 一定是纯字符串
- **预防规则**：解析任何第三方 JSON 前先看字段的**实际类型**（可能是 union type）；String 字段处理前先 `typeof === "string"` 守卫
- **关联文件**：app/js/import-ooxml.js
- **首次踩坑**：2026-09-15（CDP 抓到 12 次 Uncaught Exception）
- **复发次数**：1
- **是否入 Skill**：待定

---

## [P1] [Promise-无timeout] Promise 链无 timeout 兜底导致 UI 卡死

- **问题**：导入 XMind 卡在 95%（"构建文档模型"后 store.create/store.put await 永不 settle）；首次踩坑是 auth.js boot hang（store.init 永不 settle）。**tasks.js run() Promise 链没有任何 timeout**，只要 fn 内部某个 await 卡住，整个任务永远悬挂
- **解决**：三级保险 ①store.js tx() 加 `_withTimeout(5s)` + `_autoFailover()`（timeout/error → 自动切 localstorage 模式） ②openDB 已加 3s timeout + onblocked ③tasks.js run() 全局 `_wrap(60s timeout)` — **任何 await 永不 settle 也能让任务失败退出**
- **根因**：IndexedDB 是事件驱动 API，transaction 的 oncomplete/onerror 理论上可能都不触发（浏览器 bug/连接断开/版本冲突）；任何外部 API Promise 都不能假设"一定会 settle"；**Tasks.run 只给 await 链没给 chain 本身加 timeout**
- **预防规则**：
  1. **所有外部 API Promise**（IndexedDB / fetch / WebCrypto / IPC）必须包 `withTimeout(ms, label)`
  2. **任何"可能 hang"的 async 函数**必须设计降级路径（切 localStorage / 返回 cached 值 / 显式 error）
  3. **Tasks.run / 导入导出流程**必须有全局 timeout 兜底（默认 60s），不能让 await 链永不 settle
  4. 模板：`function withTimeout(p, ms, label) { return new Promise((res, rej) => { let done=false; setTimeout(()=>{if(!done){done=true;rej(new Error("timeout "+ms+"ms: "+label));}},ms); p.then(v=>{if(!done){done=true;res(v);}},e=>{if(!done){done=true;rej(e);}}); }); }`
- **关联文件**：app/js/store.js ✅ / app/js/tasks.js ✅ / app/js/shell.js / app/js/auth.js
- **首次踩坑**：2026-09-15（auth.js boot hang）
- **复发次数**：2（auth.js + 本轮 store.put 95%）
- **是否入 Skill**：待定（复发 2 次，≥3 次考虑入 ledger-keeper 增强版）

---

## [2026-09-15] Electron contextIsolation 下 global ≠ window，第三方库只挂 window 导致 OOXML 导入静默失败

- **问题**：.xls 打开无反应（实际 throw "未加载 SheetJS"）；.pptx 图片缺失；.xmind 卡死（同样 JSZip undefined 导致后续逻辑 undefined 报错循环）
- **解决**：import-ooxml.js 加 `_pickLib(name)` 辅助函数，按 `window[name] → globalThis[name] → global[name]` 顺序查找，全部改成局部变量 `JSZip / XLSX`
- **根因**：Electron 配了 `contextIsolation: true + nodeIntegration: false`，第三方库（xlsx.full.min.js）只挂 `window.XLSX`，JSZip 用 UMD 挂 global/self/window；但 import-ooxml.js 用 `global.XLSX` 和 `global.JSZip`，在 Electron 下 `global`（Node VM global）≠ `window`（DOM），所以都是 undefined
- **预防**：在任何 Electron renderer 脚本里引用第三方库，必须 `(typeof window !== "undefined" && window.LIB) || globalThis.LIB`，**绝对不要假设 global === window**
- **严重程度**：P0
- **关联**：electron/main.js (webPreferences) / app/js/import-ooxml.js / app/js/modules/spreadsheet.js / app/js/modules/presentation.js / app/js/modules/mindmap.js
- **辅助**：index.html `<input type="file" accept=...>` 补 `.xls/.xmind/.opml/.json`（之前缺失）

---


## [2026-09-15] PDF 模块 escapeHtml 转发 OS.util 在 Node 环境 undefined

- **问题**：7 个 PDF 模块的 escapeHtml 函数裸调 `OS.util.escapeHtml(s)`，Node 单测直接 require 时 util.js 未加载导致 TypeError
- **解决**：每个 PDF 模块 escapeHtml 加 `global.OS?.util?.escapeHtml` 存在性守卫 + 内置 fallback 实现
- **根因**：浏览器 util.js 先加载、PDF 模块后运行所以 OK；但 Node 单测直接 require 模块时 util.js 未注入全局 → `OS.util` 为 undefined
- **预防**：任何"转发到 OS.*"的工具函数必须做守卫 + 本地 fallback，禁止假设加载顺序
- **严重程度**：P1
- **关联**：app/js/modules/pdf-{preflight,docinfo,anno-timeline,encrypt,formfields,history,links,signature}.js
- **快速排查清单**：
  1. 跑 `npm test` 看红色套件 → 全是 `TypeError: Cannot read properties of undefined (reading 'xxx')`
  2. 定位到 `function escapeHtml(s) { return OS.util.escapeHtml(s); }` 这种转发函数
  3. 修复模板：`const u = (global.OS && OS.util); if (u && u.escapeHtml) return u.escapeHtml(s); return /* fallback */`
- **修复代价**：8 个文件 × 替换 4 行 → 零回归

---

## [2026-09-15] shell.js `_on` 定义在 renderTopPanel 内部但被外层函数调用

- **问题**：boot / renderDashboard / globalSearch / globalReplace 调用 `_on()` 时 ReferenceError（jsdom 严格模式暴露）
- **解决**：将 `_Listeners` + `_on` + `_offAll` 从 renderTopPanel 内部提升到 shell.js IIFE 顶层
- **根因**：renderTopPanel 重构时在内部声明 `const _on` 做局部事件管理，但忘了删除其他地方对同名变量的旧引用；浏览器非严格模式可能 silent fail 或隐式挂到 window
- **预防**：IIFE 内共享工具函数/变量必须声明在顶层；重构时 grep 扫同名引用
- **严重程度**：P1
- **关联**：app/js/shell.js（Line 17-20 新增顶层声明，原 Line 40 局部声明已删除）
- **快速排查清单**：
  1. 跑 `_app_boot_test.js` 看 `jsdomErrors: Uncaught [ReferenceError: xxx is not defined]`
  2. 搜 `const xxx = (...) =>` 局部声明 → 看这个名字是否被其他函数调用
  3. 修复模板：提升到 IIFE 顶层 + 加 `// TODO: [坑-xxx-scope] 预防：必须顶层声明`
- **修复代价**：1 个文件 × 移动 3 行声明 → 零回归

---

## [2026-09-15] koa-connect wrapper 导致 ctx 泄漏

- **问题**：Express 中间件通过 koa-connect 桥接到 Koa 后，ctx.request.body 偶发 undefined
- **解决**：重写为原生 Koa middleware，不走 wrapper
- **根因**：koa-connect 内部代理层对 request 对象做了浅拷贝，流式 body 在拷贝后丢失
- **预防**：所有 Koa 路由禁止使用 koa-connect；新写中间件一律原生 Koa 风格
- **严重程度**：P0
- **关联**：electron/main.js / server/index.js / scripts/*.js

---

## [2026-09-15] XMind 导入 mkNode 默认颜色 bug

- **问题**：mkNode 主题变量 undefined 导致思维导图节点渲染成黑色
- **解决**：给 mkNode 默认值 `#2563eb` 并在 importXmind 中显式传 color 参数，根节点用 `#1e3a5f`
- **根因**：XMind content.json 没 theme 字段时，渲染逻辑走到了 `undefined || fallback` 但 fallback 漏写
- **预防**：所有渲染函数默认值必须显式硬编码，禁止"依赖上游总会传"；解析 JSON 前先判空
- **严重程度**：P1
- **关联**：app/js/modules/mindmap.js

---

## [2026-09-15] electron-builder CSC_LINK 空指针崩溃

- **问题**：release.yml 在无证书环境下注入空 CSC_LINK，electron-builder 直接崩溃 exit code 1
- **解决**：加 `if: env.CSC_LINK` 条件，空则不注入证书变量
- **根因**：CI 脚本假设所有环境都有证书，开发机本地构建时环境变量缺失
- **预防**：所有 secrets 环境变量必须 `if: env.XXX` 守卫，禁止裸引用
- **严重程度**：P0
- **关联**：electron/main.js / electron/*.js

---

## [2026-09-15] 启动时 OS 对象 undefined ✅ 已修复 2026-09-15

- **问题**：冷启动后立即触发 AI 功能，报 OS is not defined
- **解决**：在 renderer 入口加 `await OS.ready()`，所有子模块 mount 完成才 resolve
- **根因**：boot() 是同步函数 — enterApp 是 async 但 boot 没 await 就继续跑图标注入/AI 按钮绑定/登录检查；store.init 异步完成前 AI 功能已可被触发
- **修复文件**：app/js/auth.js（+5s 超时兜底 auto-resolve）、app/js/shell.js（boot 改 async + 首行 await store.init）
- **实际修复**：双层防御 — ①auth.js OS._ready 加 5s 超时兜底（永不 hang）②shell.js boot 首行 await OS.store.init() 确保后续代码全在 store 已就绪状态下执行
- **验证**：96/96 ✅ + auth.js/shell.js TODO 标签已命中 ledger-precheck
- **预防**：所有跨模块调用前先检查 `OS?.ready`；模块 mount 用 Promise 链而非裸 setTimeout
- **严重程度**：P1
- **关联**：app/js/auth.js / app/js/store.js

---

## [2026-09-15] Toast 容器未挂载到 body ✅ 已修复 2026-09-15

- **问题**：UX 测试找不到 toast DOM，用户操作后无反馈
- **修复文件**：app/js/util.js（+84/-9 重写 OS.toast）
- **实际修复**：三层防御 — ①ensureHost() 主动 appendChild 到 body ②_toastQueue body 未 ready 时缓存 DOMContentLoaded 后 flush ③console 兜底 Node/无 DOM 环境分级输出 log/warn/error
- **已修复**：三层防御（ensureHost + queue + console 兜底），不再依赖 index.html 硬写 toast-host
- **根因**：toastContainer 只 render 到 Virtual DOM 没真正 commit
- **预防**：全局组件（Toast/Tooltip/Modal）必须在 App mount 阶段主动 appendChild 到 body
- **严重程度**：P1
- **关联**：app/js/util.js / app/js/shell.js

---

## [2026-09-15] PowerShell 正则引号地狱

- **问题**：含单引号/反斜杠的正则在 PowerShell 里解析失败
- **解决**：改走 Node 脚本执行审计逻辑，PowerShell 只做外壳
- **根因**：PowerShell 5 引号转义规则与 bash/Python 完全不同，跨平台脚本必炸
- **预防**：复杂正则 / 文件扫描一律写 Node 脚本，PowerShell 只负责调用
- **严重程度**：P2
- **关联**：scripts/run-tests.js / scripts/*.js

---

## [2026-09-15] fileAssoc 硬编码绝对路径跨环境炸

- **问题**：测试脚本硬编码 `C:\xxx`，换机器就找不到
- **解决**：全部换成 `__dirname` 相对路径
- **根因**：开发机本地调试时偷懒写死
- **预防**：禁止任何源码出现 `C:\` / `/home/` 等绝对路径；grep 扫 `[A-Z]:\\[a-z]` 拦截
- **严重程度**：P1
- **关联**：app/js/**/*.js / scripts/*.js

---

## [2026-09-15] 订单/库存/审批残留引用导致白屏

- **问题**：删了 UI 和模块文件但没删 CSS 类名和 JS 事件绑定，点击残留元素触发 404
- **解决**：全局 grep `order|inventory|approval`，命中文件全部清理
- **根因**：删代码只删看得见的 UI，没扫下游依赖链
- **预防**：功能下线流程 = UI 删除 + JS 模块删除 + CSS 清理 + 事件解绑 + 路由移除 + grep 验证 六步走
- **严重程度**：P1
- **关联**：app/js/shell.js / app/index.html / app/css/*.css


---

## [P0] [mindmap-NaN-path] layoutMap.place 只从 root 递归 → 孤立节点坐标 undefined → SVG path 抛 NaN 异常风暴 → 主线程卡死

- **问题**：用户 XMINDYI.xmind 有坏数据（悬空 parent / 环 / rootId 不匹配），layoutMap() 的 count() + place() 只从 root 递归，不在子树里的节点永远不会被 place，x/y 保持 undefined。edgePath() 拼 SVG path → "MNaN,0 CNaN..."。**每节点画边抛一次 DOM exception** → 几千节点 = 几千次异常 → render 主线程被异常处理拖死
- **日志铁证**：render-console.log 最后 50 行全是 Error: <path> attribute d: Expected number, "MNaN,0 CNaN,0 NaN…". (mindmap.js:169) — 连续刷屏直到进程被用户 kill
- **根因**：
  1. layoutMap() 只做 root 子树遍历，不覆盖所有 nodes
  2. edgePath() 不校验 NaN 坐标，直接拼字符串
  3. parseXmind 不清理悬空 parent，坏数据一路传到渲染
- **修复**：
  1. **parseXmind post-parse 防御**：清理悬空 parent + 校验 rootId
  2. **layoutMap 孤立节点兜底**：place(root) 后遍历所有 nodes，不在 _placed 里的强制分配 y 位置
  3. **edgePath NaN 防御**：!Number.isFinite(a.x) 等检查 → return null；render 里 if(!d) return 跳过
  4. **rootId 兜底**：getNode(data.rootId) 找不到时，自动找第一个 !n.parent 的节点
- **效果**：坏数据 → 最多节点位置丑一点，**绝不卡死**
- **坑位**：L111-154 layoutMap，L168-191 edgePath/render
- **关联文件**：app/js/modules/mindmap.js, app/js/import-ooxml.js
- **首次踩坑**：2026-09-16
- **复发次数**：N/A（首次发现即根治）
- **是否入 Skill**：待定

---

## [P2] [electron-CDP-must-before-whenReady] appendSwitch 必须在 app.whenReady() 之前调

- **问题**：把 pp.commandLine.appendSwitch('remote-debugging-port','9222') 写在 pp.whenReady().then(() => {...}) 内部 → CDP 端口永远不开 → 卡死时没法远程连上去抓快照
- **修复**：移到文件顶部，pp.whenReady 之前
- **坑位**：electron/main.js L7-9
- **首次踩坑**：2026-09-16

---

## [P0] [electron-window-prompt] window.prompt()/confirm()/alert() 在 Electron render 层不支持 → 抛 Uncaught Error → 主线程卡死

- **问题**：mindmap.js 的 loadAIOutline()（AI 生成脑图按钮）调了 prompt()。Electron contextIsolation 下不支持原生 dialog API，每次调抛 Uncaught Error: prompt() is and will not be supported. — 连续多次调用时主线程被异常拖死
- **日志铁证**：render-console.log 里 [GLOBAL-ERR] Uncaught Error: prompt() is and will not be supported. at mindmap.js:462 连续出现 3 次
- **修复**：在 index.html 末尾注入全局 OS.prompt/OS.confirm/OS.alert（CSS + HTML 模态框），并兜底 patch window.prompt/confirm/alert 指向 OS.*
- **坑位**：L462 mindmap.js，全局兜底在 index.html
- **首次踩坑**：2026-09-16

---

## [P0] [mindmap-fitNode-NaN] fitNode/renderNode 在 fontSize 缺失 / x/y 未 place 时算出 NaN → SVG path 渲染异常 → 卡死

- **问题**：两层 NaN 风暴：
  1. 导入 XMind 坏数据：孤立节点不在 root 子树 → x/y 未 place → edgePath 拼 "MNaN,0 CNaN..." → 每节点一次 DOM exception → 卡死
  2. 新建脑图模板数据缺 fontSize → undefined * 1.45 = NaN → lineH = NaN → h = NaN → renderNode 里 ect height=NaN → 同样卡死
- **修复**（多层防御）：
  1. parseXmind post-parse 清理悬空 parent
  2. layoutMap rootId 兜底 + 孤立节点强制 place
  3. fitNode fontSize 默认值 + measureText 过滤非 finite + 最终 w/h 默认值
  4. renderNode 坐标归零 + tspan y 防御 + n.w-44 防负值
  5. edgePath Number.isFinite 检查 return null
- **效果**：坏数据最多节点位置丑，**绝不卡死**
- **坑位**：fitNode L94-117, renderNode L211-252, layoutMap L111-154, edgePath L181-190
- **首次踩坑**：2026-09-16
