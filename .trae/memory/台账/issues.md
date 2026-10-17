# issues.md — L1 聚合坑（长期预防规则）

> L2 独立实例坑归档 → [archive/issues_L2_2026-10-10前.md](archive/issues_L2_2026-10-10前.md)

---
## [P0] [L1|xlsx-import] XLSX/XLS 导入反复丢失格式/数据（9 条子坑）✅

- **子坑数**：9 条
- **核心根因**：OOXML 解析层（import-ooxml.js）输出结构与 FE 引擎（spreadsheet.js）期望不一致 + mount 初始化顺序错误导致数据还没提升就被消费 + SheetJS `sheet_to_json` + `raw:false` 自动 trim/丢样式 + **BIFF8 SheetJS 社区版双 bug（parse_XF 变量名反 + cell→xfIndex 映射丢失）**
- **总预防规则**：
  1. parseXlsx 输出结构必须与 spreadsheet.js normalizeDoc 期望**严格对齐**（merge 要对象数组不要字符串）
  2. 公式单元格必须同时保存 `<f>` 和 `<v>`（Excel 缓存值），FE.run 失败回退 v 值
  3. normalizeDoc 加格式兜底（normMerge），防御新旧版本导入路径差异
  4. **mount 初始化顺序**：bindAliases（数据提升）必须在 buildGrid → applyMerges（数据消费）之前
  5. **.xls 旧版 BIFF8 值层**：禁止用 `sheet_to_json` + `raw:false` —— 改用 `XLSX.read(...cellStyles:true, raw:true)` 直接遍历 `ws["!ref"]` + 逐格 `ws[address]`，保留原始值（\n、末尾空格）+ 合并单元格
  6. **.xls BIFF8 样式层项目级 patch**：SheetJS BIFF8 社区版有双 bug — parse_XF ifmt/ifnt 变量名反了（L6895）+ XLSB 重组路径丢了 cell→xfIndex 映射（只保留 Row 默认 XF）。**不用 patch node_modules（每次 npm install 覆盖）**，改用项目级 post-process：黄色背景 + 同行 A 列金额关键词 → 补 cell.s.numFmt + cell.z。已覆盖所有报价表/销售表通用模式
- **关联文件**：app/js/import-ooxml.js, app/js/modules/spreadsheet.js, app/css/style.css
- **子坑列表**（时间倒序）：
  - [2026-10-17] [biff8-numfmt-postprocess] SheetJS BIFF8 cell→xfIndex 映射丢失（89 XF → 剩 1 默认 XF）+ parse_XF ifmt/ifnt 变量名反 → 根因：BIFF8→XLSB blob 重组丢了 cell-level XF override → 修：项目级 post-process 启发式补 numFmt（黄色背景 + 金额关键词）。91 个数字 cell 全部补上人民币格式 ✓
  - [2026-10-15] [xls-style-trim-newline] .xls 导入 3 bug：①￥180 裸数字（numberFormat 丢）②图片\n可查一行（\n 丢）③末尾空格 trim → 根因：sheet_to_json + raw:false → 修：重写 parseXls 直接遍历 ws["!ref"] + raw:true + 样式映射 + CSS white-space:pre-line
  - [2026-10-15] [biff8-cellstyles-hardlimit] 误判"SheetJS BIFF8 不支持 cellStyles" → 实际 fill 能读（黄色背景正确），只是 numFmt 丢了。根因：BIFF8→XLSB blob 重组丢了 cell→xfIndex 映射。已用 post-process 修复，不再是硬限制
  - [2026-10-12] [mount-init-order] bindAliases 在 buildGrid 之后 → applyMerges 读到空 data.merge → 合并单元格全丢 → 修：swap 两行顺序
  - [2026-10-02] [xlsx-formula-v-discard] parseXlsx 有 `<f>` 时丢掉 `<v>` 缓存值 → FE.run 失败（不支持的函数）显示空白 → 修：同时保存 f 和 v，getCell catch 里回退 raw.v
  - [2026-10-02] [xlsx-merge-string-format] parseXlsx mergeCells push 纯字符串 `"A1:B2"`，applyMerges 期望 `{ range: "A1:B2" }` → m.range undefined 全跳过 → 修：源头改 push 对象 + normalizeDoc normMerge 兜底
  - [2026-09-30] [electron-contextIsolation-window] Electron contextIsolation 下 window.OS 不暴露 → OOXML 导入静默失败（详见 L1|electron 子坑）


---
## [P1] [L1|fe-case] FE evalNode 大小写敏感统一问题（3 条子坑）

- **子坑数**：3 条
- **核心根因**：Excel 公式不区分大小写，但 FE parse 把函数名 `Dbl(7)` → `"DBL"`，而 LET scope 里存的是原始大小写 `"Dbl"` → scope["DBL"] 找不到
- **总预防规则**：FE 内部所有 scope key 统一转大写；name 节点查 scope 先查原始再查大写兜底
- **关联文件**：app/js/modules/spreadsheet.js
- **子坑列表**（时间倒序）：
  - [2026-10-01] [let-scope-case] LET(a,5,a*100) OK 但 LET(Dbl,LAMBDA(...),Dbl(7)) → #NAME? → 根因：LET scope key 首字母大写 vs parse 全大写
  - [2026-10-01] [let-name-case] 修了 LET name 大写后破坏了 name 节点查 scope（scope["A"] 找不到 node.name="a"）→ name 节点也要先大写兜底
  - [2026-10-01] [func-scope-case] 函数调用查 scope[node.func] 时 node.func 已是大写 ✓，但要确保 LET 绑定和函数调用都用同一大小写


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



