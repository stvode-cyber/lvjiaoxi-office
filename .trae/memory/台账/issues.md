# 踩坑台账（Growth Ledger · 分级版）

> **分级规则**：L1 模块聚合坑（3+ 条同模块子坑，根因相似） / L2 独立实例坑 / archived 历史归档
> **升级触发**：同模块 L2 实例 ≥ 3 条 → 新建 L1 聚合，原 L2 移进子坑列表
> **新增入口**：所有新坑先进 L2。每轮收尾检查升级阈值
> **快速扫**：`(Get-Content issues.md -Raw) -split '---' | Select-Object -First 4`


---

## [P0] [L1|electron] Electron 运行时反复踩坑（5 条子坑）

- **子坑数**：5 条
- **核心根因**：Electron 默认开启 contextIsolation + CSP 严格模式，render 层 global ≠ window ≠ Node.js globals，第三方库（OOXML/JSZip/pdf.js 等）只挂 window 或只看 Node globals 导致静默失败
- **总预防规则**：
  1. 所有异步操作加 `.catch(err => OS.toast("..." + err.message, "err"))`，**绝不**裸 await
  2. pdf.js 加载用 `dataUrlToU8(dataUrl)` → 不直接喂 data:URL（CSP img-src 拦截）
  3. render 层要挂全局对象 → 用 `window.OS` / `global.OS` 双写
  4. window.prompt/confirm/alert → Electron render 层**不支持**，全换自定义 toast
  5. CSC_LINK 空指针 → electron-builder 打包前必须非空检查
- **关联文件**：electron/main.js, app/js/shell.js, app/js/auth.js
- **子坑列表**（时间倒序）：
  - [2026-09-30] [electron-csp-dataurl] Electron CSP 拦截 pdf.js 的 data:URL → PDF 全白屏（改前：loadPdf 里直接喂 data:；改后：dataUrlToU8 转 Uint8Array）
  - [2026-09-30] [electron-window-prompt] window.prompt/confirm/alert 在 render 层不支持 → Uncaught Error → 主线程卡死
  - [2026-09-30] [electron-CDP-must-before-whenReady] appendSwitch 必须在 app.whenReady() 之前调（CDP 初始化时序）
  - [2026-09-30] [electron-builder-csclink-null] electron-builder CSC_LINK 空指针崩溃
  - [2026-09-30] [electron-contextIsolation-window] contextIsolation 下 global ≠ window → 第三方库只挂 window → OOXML 导入静默失败


---

## [P0] [L1|shell] Shell 状态管理反复踩坑（3 条子坑）

- **子坑数**：3 条
- **核心根因**：shell.js 函数嵌套过深（`_on` 定义在 renderTopPanel 内部但被外层引用），tabs.push 后忘了 renderTabbar 刷新 DOM，openDoc 无 await 导致时序竞争
- **总预防规则**：
  1. 所有 tab 状态变更（push/splice）后**立刻**调 renderTabbar / updateTabBar
  2. openDoc / closeTab 等异步操作**必须** await + 进度条粒度细化
  3. 闭包内引用函数 → 确保作用域一致，不把内部定义的 `_on` 拿到外层用
- **关联文件**：app/js/shell.js, app/js/tasks.js
- **子坑列表**（时间倒序）：
  - [2026-09-30] [shell-_-on-scope] shell.js `_on` 定义在 renderTopPanel 内部但被外层函数调用 → ReferenceError
  - [2026-09-30] [shell-openDoc-缺renderTabbar] openDoc 里 tabs.push 后没调 renderTabbar → tabbar 无 DOM
  - [2026-09-30] [shell-openDoc-无await] openDoc 无 await + 进度条粒度粗 → "95% 卡死"假象


---

## [P0] [L1|boot] 启动与冒烟测试反复踩坑（2 条子坑）

- **子坑数**：2 条
- **核心根因**：boot test 的 script regex `str.replace(/<script[\s\S]*?<\/script>/g, '')` 不理解 HTML 注释，被注释里的 script 文本击穿；OS 对象 undefined 时启动无保护
- **总预防规则**：
  1. HTML 注释里**绝对不能**出现 `<script>` / `</script>` 精确字符串（用"inline as a direct tag"替代）
  2. 启动冒烟脚本先检查 OS 是否已挂载到 window
- **关联文件**：app/index.html, _app_boot_test.js, scripts/run-tests.js
- **子坑列表**：
  - [2026-09-30] [boot-test-regex-eats-body] script regex 被注释里的 script 文本击穿 → 把整个 body + 所有 app scripts 都吃掉
  - [2026-09-15] [boot-os-undefined] 启动时 OS 对象 undefined


---

## [P2] [L1|powershell] PowerShell 批处理反复踩坑（2 条子坑）

- **子坑数**：2 条
- **核心根因**：PowerShell 5 的 [System.Collections.Generic.List] 类型转换、双引号 regex 引号地狱、批量写文件换行丢失
- **总预防规则**：
  1. **批量改多文件 + 要求精确格式时**，不用 PowerShell foreach 写文件 → 改用 Edit 工具逐文件替换
  2. HTML 文件注释用 `<!-- -->` 不用 JS `//`（浏览器不认）
  3. PowerShell 双引号里 regex pattern 有引号时先转义或用单引号
- **关联文件**：scripts/*.ps1, scripts/*.js
- **子坑列表**：
  - [2026-09-30] [powershell-batch-todo-newline] PowerShell 批量写 TODO 换行丢失 + HTML 用 JS 注释
  - [2026-09-30] [powershell-regex-quote-hell] PowerShell 正则引号地狱


---

## [P2] [L1|mindmap] 思维导图模块反复踩坑（2 条子坑）

- **子坑数**：2 条
- **核心根因**：mindmap layoutMap.place 只从 root 递归导致孤立节点坐标 undefined → SVG path NaN；渲染 O(N²) 查询 + fitNode 重复计算
- **总预防规则**：
  1. 布局算法必须处理无父节点的孤立节点（至少给默认坐标 {x:0,y:0}）
  2. fitNode 调用次数做缓存（visited map）避免 O(N²)
- **关联文件**：app/js/modules/mindmap.js
- **子坑列表**：
  - [2026-09-30] [mindmap-渲染性能] O(N²) 查询 + fitNode 重复计算 → mount 3000 节点 1344ms
  - [2026-09-30] [mindmap-NaN-path] layoutMap.place 只从 root 递归 → 孤立节点坐标 undefined → SVG path 抛 NaN


---

## [P0] [L2|tesseract-worker-in-inline-script] worker.min.js 被 script 标签直接加载到主线程

- **问题**：index.html 里写了 `<script src=worker.min.js>` 把 Web Worker 脚本当普通 JS 加载到主线程，每次页面加载 12+ 次 dispatchHandlers 异常（TypeError: t.action is not a function）
- **解决**：移除那行 script 标签。Tesseract.createWorker 会在 OCR 真正被调用时动态 new Worker 加载
- **根因**：worker-*.js 脚本里的 `self.addEventListener('message', handler)` 在主线程 context 下初始化时，self 不是 WorkerGlobalScope
- **预防**：任何 worker-*.js / *worker.min.js **绝对不能**用 script src 直接加载
- **关联文件**：app/index.html
- **首次踩坑**：2026-09-16


---

## [P2] [L2|parseXmind-internationalized-title] XMind 2020+ title 可能是国际化对象而非字符串

- **问题**：XMind 2020+ 的 title 可能是 `{"default": "...", "en_US": "..."}` 对象而非纯字符串 → `.trim()` 抛 TypeError
- **解决**：加类型判断 + 取 `.default` 或第一个非空值
- **关联文件**：app/js/modules/mindmap.js


---

## [P1] [L2|Promise-no-timeout] Promise 链无 timeout 兜底导致 UI 卡死

- **问题**：Electron IPC / pdf.js 渲染等异步操作无 timeout → 网络问题 / 文件损坏时 UI 永远等
- **解决**：关键 Promise 包装 `Promise.race([op, new Promise(r => setTimeout(() => r(new Error("超时")), 30000))])`
- **关联文件**：app/js/shell.js, app/js/modules/pdf.js


---

## [P2] [L2|koa-connect-ctx-leak] koa-connect wrapper 导致 ctx 泄漏

- **关联文件**：server/*.js


---

## [P1] [L2|xmind-mknode-color] XMind 导入 mkNode 默认颜色 bug

- **关联文件**：app/js/modules/mindmap.js


---

## [P1] [L2|toast-not-mounted-body] Toast 容器未挂载到 body

- **关联文件**：app/js/shell.js, app/index.html


---

## [P1] [L2|fileassoc-hardcoded-absolute] fileAssoc 硬编码绝对路径跨环境炸

- **关联文件**：scripts/*.js, electron/main.js


---

## [P2] [L2|order-inventory-approval-residue] 订单/库存/审批残留引用导致白屏

- **关联文件**：app/js/store.js, app/js/tasks.js


---

## [P1] [L2|pptx-zipfile-null] JSZip zip.file() 返回 null 后调 .async() → Cannot read properties of null

- **关联文件**：app/js/export-ooxml.js


---

## [P1] [L2|installer-asar-not-updated] 安装版 app.asar 不自动更新

- **关联文件**：scripts/bump-version.js, electron/main.js


---

## [P2] [L2|ledger-info-stale] 台账/拉手.md 里的功能状态可能过时

- **关联文件**：.trae/memory/台账/index.md, AI交接_拉手.md


---

## [P2] [L2|office-shortcuts-missing] Ctrl+N/O/W/P 四大基础快捷键全缺失

- **关联文件**：app/js/shell.js


---

## [P3] [L2|shortcut-test-fragile] 快捷键矩阵测试用字符串包含匹配，改一下函数名就全挂

- **关联文件**：_shell_shortcuts_live_test.js


---

# 历史归档（已修复 + 3 个月未复发）

> 本区块存已稳定修复、3 个月内未再复发的老坑，只留一句话标题和解决概要

- [archived|2026-09-15] boot-os-undefined：启动时 OS 对象 undefined → 加 window.OS 挂载保护
- [archived|2026-09-15] toast-not-mounted-body：Toast 容器未挂载到 body → mount 时 appendChild
- [archived|2026-09-15] installer-asar-not-updated：安装版 app.asar 不自动更新 → bump-version 加 asar 重建


---

## [P0] [L1|pdf] PDF 模块反复踩坑（8 条子坑）

- **子坑数**：8 条
- **核心根因**：pdf-convert.js 的多栏/表格/image 识别互相干扰；**rows gap histogram 依赖 items.length===2 的干净行**，但真实 IEEE 论文里同一行有脚注编号/参考文献引用塞了 5-22 个 items，导致 dominant ratio 不够 → 多栏漏判
- **总预防规则**：
  1. 多栏检测**不依赖 rows 结构**，改用 K-means K=2 对 prose spans 的 x 坐标整体做双峰检测
  2. detectColumnSep 只看 x 坐标数组，阈值：两峰间距 ≥ 0.15 + 较小群 ≥ 15%
  3. prose 重排后**绝不**整体 sort（会打乱左→右阅读顺序）
  4. 任何替换部分行的逻辑，先保存"不在替换范围的其他行"（preserved）
  5. pdf.js textContent transforms 归一化（x=transform[4]/vp.width 等）是稳定模板，搜索/导出共用
- **关联文件**：app/js/modules/pdf.js, pdf-convert.js, pdf-engine.js, export-ooxml.js
- **子坑列表**（时间倒序）：
  - [2026-10-03] [pdf-kmeans-columns] rows gap histogram → K-means K=2 双峰检测，真实 IEEE 论文端到端验证通过（旧方案 5/105 行 items=2 → dominant ratio 0.20 < 0.50 阈值不触发；新方案 x 坐标整体 79/26 双峰 → 触发重排）
  - [2026-10-02] [pdf-export-word-ui-ready] PDF→DOCX 导出 UI 全链路打通
  - [2026-10-01] [pdf-image-passthrough] pdfToDocxHtml 新增 image span 支持
  - [2026-10-01] [pdf-builddocx-image-already-ready] buildDocx 已就绪
  - [2026-10-01] [pdf-multicolumn-items3-conflict] detectColumnSep 被多列表格 items>=3 干扰
  - [2026-10-01] [pdf-multicolumn-preserved-lost] prose 重排覆盖丢失标题/备注
  - [2026-10-01] [pdf-multicolumn-sort-destroys-order] prose 重排后 sort 打乱阅读顺序
  - [2026-09-30] [pdf-escapehtml-osutil] PDF 模块 escapeHtml 转发 OS.util 在 Node 环境 undefined


---

## [P1] [L2] tesseract.js 7.x langPath 必须有 .traineddata.gz

- **现象**：Electron 渲染进程 OCR 报 ENOENT: open '.../lang-data/eng.traineddata.gz'
- **根因**：tesseract.js 7.x langPath 设计为浏览器远程 fetch + gzip 解压路径，**强制要求 .gz 压缩包存在**。光解压好的 .traineddata 它无视。
- **修复**：vendor/tesseract/lang-data/ 下同时放 .traineddata 和 .traineddata.gz（重复一份，约 30 MB 冗余）
- **预防**：以后加新语言包，必须同时下 .gz 原始包（别只解压）。下载源：https://tessdata.projectnaptha.com/4.0.0/{lang}.traineddata.gz
- **关联文件**：app/vendor/tesseract/lang-data/

---

## [L2|Presentation] CSS transform:scale 不占文档空间 → 缩略图被裁

- **现象**：左侧幻灯片缩略图"显示不全"——高度被压扁，画面被截掉 80%
- **根因**：renderSlide 用 	ransform: scale(0.184) 缩 16:9 幻灯片到 140px 宽。CSS transform **只改变视觉、不改变文档空间占位**——元素在文档里仍然占 760×427，只有视觉上缩成 140×78。而 .pres-thumb 容器设了 overflow:hidden + 硬写 height=78px → 78px 容器里放 427px 高的内容 → 裁掉 82%
- **修复**：不用 transform scale，硬写缩后宽高（width: W*scale + height: H*scale）。renderEl 内部元素本来就乘了 scale，transform 是冗余的
- **预防**：CSS transform scale 只适合纯视觉修饰的场景（hover 放大、动画），**绝对不能用来做布局尺寸计算**
- **关联文件**：app/js/modules/presentation.js（L171-182 renderSlide + L259-271 renderThumbs）

---

## [L2|Presentation] 中间画布（.pres-canvas）硬写 760×427 不适屏

- **现象**：中间 16:9 幻灯片画布被直接塞进 .pres-canvas-area，固定 760×427，不随 viewport 大小缩放 → 窗口小则画布被裁，窗口大则大片留白
- **根因**：① CSS L690 .pres-canvas 硬写 width:760px height:427px position:absolute left:0 top:0；② mount 里**完全没有** resize/fitScale 事件监听
- **修复**：mount 内新增 itScale() 函数 —— 算 .pres-canvas-area clientWidth/clientHeight → scale = min(aw/760, ah/427) → translate 居中 + scale → 改 canvas.style.transform；加 ResizeObserver + window.resize 双监听
- **技术要点**：transform translate 从 left:0 top:0 起平移，transformOrigin: top left → 居中公式 	x=(areaW-760*scale)/2, ty=(areaH-427*scale)/2 正确
- **关联文件**：app/js/modules/presentation.js（L287-308 fitScale + renderAll 调用 + ResizeObserver）
- **验证**：104/104 绿 + dist:local 13:17 重打

---

## [L2|Presentation] CSS transform:scale + overflow:hidden 渲染顺序坑

- **现象**：缩略图被裁掉 80%，只显示左上角小部分；数字编号 tnum 被覆盖看不见
- **根因**：CSS 渲染顺序是 **layout → overflow clip → paint → transform**！
  `
  .pres-canvas { width:760px; transform: scale(0.184) }
  .pres-thumb  { overflow: hidden; width:140px; height:78px }
  
  步骤 1 layout: .pres-canvas 文档空间占 760×427
  步骤 2 overflow clip: .pres-thumb 按 140×78 裁 → .pres-canvas 只剩左上角 140×78
  步骤 3 transform: 被裁后的 140×78 再 scale(0.184) → 只剩 25×14 视觉！
  `
- **修复**：彻底不用 transform scale + overflow:hidden 组合！
  - renderSlide 硬写缩后宽高（W*scale × H*scale），和 renderEl 内部元素乘 scale 完全匹配
  - 父容器不需要 overflow:hidden（canvas 正好填满）
  - 也不需要 position:absolute（正常文档流）
- **预防铁律**：
  1. **transform scale 只适合纯视觉动画**（hover 放大、进入动画），**绝对不能用来做布局尺寸！**
  2. **overflow:hidden 和 transform scale 同时存在时，前者先裁后者再缩 → 必出问题**
  3. 布局尺寸计算必须硬写 width/height，别用 transform 投机取巧
- **关联文件**：app/js/modules/presentation.js（renderSlide + renderThumbs）
- **踩坑次数**：这是本轮第 3 次改 renderSlide，每次都在 transform scale 上翻车

---

## [L2|Presentation] CSS class 复用冲突：.pres-canvas 被两条路径共享

- **现象**：缩略图 canvas 画面"飘走"——只显示幻灯片的左半部分或中间部分，不是完整 16:9
- **根因**：renderSlide（缩略图路径）和 renderMain（主画布路径）**都创建 .pres-canvas class 元素**，但 CSS L690 的 .pres-canvas 规则是给主画布写的：
  `css
  .pres-canvas{ position:absolute; left:0; top:0; overflow:hidden; width:760px; height:427px }
  `
  renderSlide 创建的缩略图 canvas 继承了 position:absolute，但它的父容器 .pres-thumb 没设 position:relative → absolute 元素飘到最近 positioned ancestor → 画面截断
- **修复**：renderSlide 里用 JS 内联 style 显式覆盖：
  `js
  el.style.position = "static";
  el.style.left = "auto";
  el.style.top = "auto";
  el.style.overflow = "visible";
  `
  （width/height 之前已经硬写缩后尺寸覆盖了 CSS 的 760×427）
- **预防铁律**：
  1. **同一个 CSS class 不能被两条语义不同的路径共用**！主画布和缩略图画布的布局需求完全不同（absolute vs static、overflow hidden vs visible）
  2. **未来正确做法**：renderSlide 创建的元素改 class 名（比如 .pres-canvas-mini），彻底隔离 CSS 规则
  3. **临时兜底**：JS 创建元素时用内联 style 覆盖所有 CSS class 的冲突属性
- **踩坑次数**：这是 renderSlide 第 4 次修改。每次都在 CSS class 复用上翻车
- **关联文件**：app/js/modules/presentation.js renderSlide + app/css/style.css L690

---

## [P2] [L2|pdf-img-only-page-dropped] 图片专属页被 early-return 整页丢弃 ✅

- **现象**：pdfToDocxHtml 对「只有图片没有文本/表格」的页整页 return，图片全部丢失
- **根因**：early-return 条件 `!proseOnly.length && !tableSlots.length` 没把 imageSpans 算进去 — 图片分支上线前是死代码，该条件从未暴露
- **修复**：条件补 `&& !imageSpans.length`
- **预防**：给「备用分支」接数据时，先审计所有 early-return / 空值分支是否把新数据类型算进去
- **关联文件**：app/js/modules/pdf-convert.js L181
- **修复验证**：_pdf_convert_image_test.js「图片专属页保留 <img>」「第2页纯图片页保留且分页」2 断言，105/105 全绿
