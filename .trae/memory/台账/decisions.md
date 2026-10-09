
---


---


---


---


---


---


---

## [2026-10-09] PDF→DOCX 三栏版面还原：递归二分 K-means + 多栏段落预构建（顺带修复 y 方向颠倒）

- **选了啥**：多栏检测从双栏泛化到最多三栏 — ① 新函数 detectColumnSeps 递归二分 K-means（整体 K=2 得 sep → 左右子集各再分一次，depth=1 防过拆，单栏子集因 dist<0.15 防抖被拒），返回 []/[sep]/[sep1,sep2]；② 检测输入从「合并行 x」改「items 级 x」（真实多栏排版栏内基线对齐，合并行 x 全是左栏起点退化成单峰）；③ 跨栏判定 some→every（必须跨所有 sep，防「单栏+2 列表格」表格两列在右子集形成假双峰被吞）；④ 主流程 N 栏 buckets 拆行 + 每栏预构建一整段 + 栏段共享 colMinY 事件 y 保栏序
- **为啥**：project_memory 既定任务（"三栏版面支持需作为多栏版面还原的后续优化方向"）；真实杂志/论文三栏排版栏内基线完全对齐，旧输入根本检不出
- **顺带修复**（issues#27）：renderTableBlock / colGroups baseY 降序→升序 — 原假设 y-up，实际 extractAllPagesSpans 是 y-down（批注 top=y*bh 实锤），表格/多栏栏内行序在真实 PDF 一直颠倒；insertPreserved 删除，preserved 改独立成段按自身 y 穿插
- **备选方案**：K-means K=3 直接跑 — 排除，初值敏感易收敛错；递归二分每步都是已验证的 K=2 逻辑
- **已知边界**：三栏行要求左中右都有 item（every），某栏缺字的行走 preserved 普通 prose；三栏+3 列表格同页可能误判（crossSep<5 回滚兜底）；四栏不支持（depth=1）
- **关联文件**：app/js/modules/pdf-convert.js（detectColumnSeps L291-310、主流程 L114-191、events L209-212、renderTableBlock L80）、_pdf_convert_3col_test.js（17 断言）、app/sw.js CACHE v28→v29
- **决策人**：用户「执行吧」拍板

---


---

## [2026-10-09] v1.1.6 发布到 VPS + 恢复 lujax.fun/releases 更新源（nginx 443 补 /releases location）

- **做了啥**：12:29 Setup.exe（含图片嵌入）+ blockmap + latest.yml 已上传 `/var/www/lujax.fun/releases/`（sha256 25ed8789676d1110 双侧一致）；发现 `https://lujax.fun/releases/` 返回 API 404 — 根因是 `lujax-fun.conf.disabled`（8444 静态 vhost 未启用）且 8444 未监听；在 443 vhost `greenrhino-cloud-ssl.conf` 的 catch-all 前补 `location ^~ /releases/ { alias /var/www/lujax.fun/releases/; }`，nginx -t 通过后 reload
- **为啥**：旧客户端 generic feed 指向 `https://lujax.fun/releases`（443），feed 挂了自动更新就全断；server 侧已验证 latest.yml 200 + EXE 206
- **备选方案**：启用 8444 vhost — 排除，因为旧客户端 feed URL 写死 443
- **已知约束**：本机网络对 lujax.fun 有 SNI 级 TLS 干扰（IP 直连 200，带 SNI reset）— 客户端在其它网络正常，本机内测只能手动下载（与既有记忆一致）
- **关联文件**：VPS /etc/nginx/conf.d/greenrhino-cloud-ssl.conf（备份 .bak-20261009）、dist/、electron/feed-config.js
- **决策人**：用户「执行吧」拍板发布

---

## [2026-10-09] PDF→DOCX 图片嵌入：pdf.js operator list 提取 + 像素归一化 600×800 网格

- **选了啥**：extractAllPagesSpans 增加图片提取 — getOperatorList 遍历 paintImageXObject/paintJpegXObject/paintInlineImageXObject，save/restore/transform 栈算 CTM → imageRect 归一化（与文本 span 同坐标系 x=e/vpW, y=f/vpH）→ Canvas 缩放转 PNG dataURL；纯函数沉淀 OS.PdfConvert._imgUtils（multiplyM/imageRect/expandRGBA/targetPx）
- **为啥**：下游链路早已就绪（pdfToDocxHtml 图片分支 + buildDocx drawingRun 从 PNG 头读尺寸），唯独 extractAllPagesSpans 只提文本不提取图片 → 图片分支是死代码；项目记忆列为下一个开发任务
- **关键设计**：
  1. 像素归一化到 600×800 页网格（与 pdf-convert wAttr/hAttr 约定一致）→ buildDocx 从 PNG 头读到的就是目标显示尺寸，exporter 零改动
  2. 小图过滤（<8px 图标/项目符号跳过）+ 1600px 上限防 DOCX 爆体积
  3. page.objs.get callback 形式等未解析对象 + 10s 超时兜底防挂死
  4. 每页/每图独立 try/catch — 丢图不丢字（遵 L1 electron 总预防规则：绝不裸 await）
- **已知边界**：Form XObject 内嵌套图片不递归；SMask 掩码图不特殊处理；多栏 y 序沿用 prose 既有约定
- **关联文件**：app/js/modules/pdf.js L131-228, app/js/modules/pdf-convert.js L181+L327-402, app/sw.js CACHE v27→v28, _pdf_convert_image_test.js（30 断言）
- **决策人**：用户拍板「按方案开始新功能迭代」

---

## [2026-09-30] PDF→DOCX 版面还原加表格识别（复用 pdfToExcel 工具链）

- **选了啥**：pdfToDocxHtml 加表格识别 — 复用 pdfToExcel 已成熟的 isTableLike / clusterTableBlocks / detectSeparators（直方图众数法 v2）/ lineToCells 4 个工具函数，渲染成 HTML <table>
- **为啥**：STATUS.md 🟡 边界 — "PDF→DOCX/TXT/MD 版面还原有限：仅文本层 + 标题判别，无图片/表格/多栏"；伪 gap 修复自动复用（pdfToExcel v2 直方图法 → pdfToDocxHtml 也受益，表头被拆的伪 gap 自动合并）
- **技术要点**：
  1. 两套行格式并行：lineItems（有 items 数组）做表格识别 + clusterLines（有 text/h）做正文渲染
  2. clusterLines L55-60 把 items 数组丢了 → 必须单独 call lineItems
  3. 表格行 baseY 和 prose 行 y 做 Set 过滤（注意两个函数 tol 不同但 y 值基本一致）
  4. 渲染事件按 y 排序穿插 → 表格和段落保持原始视觉顺序
  5. renderTableBlock 里 rows 按 baseY 降序 → 表头（y 最大）先渲染在顶部
  6. 单行 table block 跳过（isTableLike 无跨行依据）
- **效果**：纯测试页里 PDF→DOCX 从 10 个 <p> 变成 2 个 <p> + 1 个完整 <table border="1">；伪 gap bug 自动修复（表头"年月"拆成"年"+"月" → 合并成"年月"在同一列）
- **STATUS.md 🟡→✅ 推进**：PDF→DOCX 版面还原从"纯文本提取"升为"文本+表格识别+标题+列表"
- **关联文件**：app/js/modules/pdf-convert.js L74-180（新增 renderTableBlock + 改 pdfToDocxHtml）
- **决策人**：上一个 commit pdfToExcel detectSeparators 修复后想到"复用同一工具链"
## [2026-09-30] PDF→Excel 列边界检测：primary 行优先 → 直方图众数法

- **选了啥**：detectSeparators 从 primary 行优先 + 容差合并，改为**所有表格行 gaps 直方图 + 众数 bin + minSupport 过滤 + 双路回退**
- **为啥**：旧版 primary 行优先有 1 个实锤 bug —— 表头被 PDF 解析器拆成多段（如"年月"→"年"+"月"）时，primary 行的 gapsOf 产出伪 gap → 伪 sep 被保留 → 输出多 1 列（2024-03,,3000 空列）
- **新算法**：
  1. 收集所有表格行的所有 gap 坐标
  2. 建直方图（bin 宽 = tol = 0.035）
  3. minSupport = max(2, ceil(总行数*0.5)) — 只保留至少半数行都有的 gap
  4. 高斯加权合并相邻 bin
- **双路回退**：单行表回退 gapsOf(primary)；直方图空结果（minSupport 太严如 2 行表其中 1 行缺列）回退 primary 行优先
- **效果**：伪 gap bug 修复（测试 case "表头被拆产生 3 个 gap" 从 4 列 → 正确 3 列）；旧行为 104/104 全绿
- **STATUS.md 🟡 边界改进**：PDF→Excel 版面还原从"文本+列边界聚类"升为"文本+列边界直方图众数"
- **关联文件**：app/js/modules/pdf-convert.js L320-363
- **决策人**：手工测试构造 bug case 触发
## [2026-09-30] ledger-precheck 智能跳过已修复条目（标题含 ✅）

- **选了啥**：parseIssues 加 2 行逻辑 — 读取 section 的标题行，includes("✅") 的直接 continue
- **为啥**：issues.md 30/30 全标 ✅ 后，precheck 每次扫出 38 行 [OK] 噪音（全是已修复的坑 + 已有 TODO 的文件），改前改后零信息量
- **效果**：precheck 改后输出 ✓ 台账扫描：目标路径无命中历史坑 — 只扫真正没修的坑，干净
- **改法**：L36-38 在 link regex 之前加 titleLine 匹配 + ✅ 检查
- **遗留**：未来可能需要加 --all 标志让用户强制扫全部（包括已修复的），目前没需求
- **关联文件**：scripts/ledger-precheck.js L36-38
- **决策人**：issues.md 全标 ✅ 后触发
## [2026-09-30] issues.md 28 条全部标 ✅ — 台账治理终极目标达成

- **选了啥**：给 issues.md 全部 28 条条目补 ✅ 2026-09-30 台账治理补标 后缀，零未标
- **为啥**：之前 issues.md 只有 2/28 条（boot-os-undefined / toast-not-mounted-body）标了 ✅，其余 26 条要么代码里已经有 TODO 预防注释（= 已修）要么有明确解决方案；台账漂移导致 ledger-info-stale 条目反复报自己过时
- **验证方法**：precheck 输出 [OK] 的 slug 列表（17 个 = 有 TODO）+ 代码 grep 验证（office-shortcuts-missing 在 shell.js L228-L234 已实现）
- **发现**：office-shortcuts-missing（Ctrl+N/O/W/P 缺失）早在 shell.js L228-L234 就实现了，但 issues.md 没更新 → 典型的台账漂移
- **效果**：issues.md 28/28 条有状态标记；台账 = 真源，不再误导后来 AI
- **关联文件**：.trae/memory/台账/issues.md（26 条标题追加 ✅）
- **决策人**：ledger-info-stale 条目触发"查账"
## [2026-09-30] 第二轮高频文件补 TODO（6 文件 6 条）→ 剩余 8 条全故意不加

- **选了啥**：spreadsheet.js / presentation.js / pdf-app.js / electron/main.js / run-tests.js / index.html 共 6 文件补 6 条 TODO
  - spreadsheet + presentation: contextIsolation-window（第三方库引用 window≠global）
  - pdf-app: electron-csp-dataurl（CSP img-src 别删）
  - electron/main.js: contextIsolation-window（webPreferences 开了 contextIsolation）
  - run-tests: powershell-regex-quote-hell（PowerShell 调脚本时引号）
  - index.html: powershell-batch-todo-newline（HTML 注释格式 + 换行）
- **为啥**：第一轮补了 10 文件 26 条，收窄 glob 后 precheck 剩 14 条建议；筛出高频改核心文件优先补
- **故意不加的 8 条**：app/css/*.css（加注释会暴露成可见文本）、*.md 文档（不是代码）、C:/Program Files/...（不在仓库）、_shell_shortcuts_test.js（测试文件低频改）
- **效果**：核心高频文件 precheck 全 OK；总建议补 TODO 14→8（剩余全非核心）
- **关联文件**：app/js/modules/spreadsheet.js / presentation.js / pdf-app.js / electron/main.js / scripts/run-tests.js / app/index.html
- **决策人**：precheck 剩余缺口分析
## [2026-09-30] issues.md 4 条关联 glob 收窄 → precheck 噪音 -70%

- **选了啥**：把 4 条写得太宽的关联 glob 收窄成实际有关的具体文件
  - ileassoc-hardcoded-absolute: pp/js/**/*.js / scripts/*.js → pp/js/shell.js
  - koa-connect-ctx-leak: electron/main.js / server/index.js / scripts/*.js → electron/main.js
  - powershell-regex-quote-hell: scripts/run-tests.js / scripts/*.js → scripts/run-tests.js, scripts/bump-version.js
  - electron-builder-csclink-null: electron/main.js / electron/*.js → electron/main.js
- **为啥**：precheck 扫 47 条建议，34 条来自这 4 条宽 glob（fileAssoc 12 + koa 10 + PS regex 8 + csclink 4）；实际 grep 验证：scripts/ 里根本没有 koa 引用、硬编码路径只在 shell.js、csclink 只在 main.js
- **效果**：precheck 建议补 TODO 从 47 → 14（-70%）；总行数从 ~100 → 67
- **教训**：issues.md 关联文件写 glob 前先 grep 验证实际命中范围
- **关联文件**：.trae/memory/台账/issues.md（4 条条目 L189 L211 L249 L260）
- **决策人**：precheck 噪音来源分析发现
## [2026-09-30] 沉淀 agents-ledger-workflow Skill

- **选了啥**：创建 .trae/skills/agents-ledger-workflow/SKILL.md，把 AGENTS §7 台账五步闭环（扫台账→选任务→实现→验证→写台账+commit 带 ref）沉淀为 workspace 级 skill
- **为啥**：同一会话里完整跑了 3 轮闭环（fix precheck / 补 issues.md severity / 补 26 条 TODO），每次都是触发型流程，值得让后续 AI 一接手就自动调用
- **Skill 里包含**：触发条件、五步流程图、每步具体命令、避坑清单（PowerShell 批量写/HTML 注释踩坑）、台账格式模板、工具链速查、实战数据
- **关联文件**：.trae/skills/agents-ledger-workflow/SKILL.md
- **决策人**：Skill Accumulation 规则触发（同流程执行 ≥3 次）
## [2026-09-30] 核心 9 文件补 26 条 TODO 预防注释

- **选了啥**：shell.js(6) / mindmap.js(4) / import-ooxml.js(3) / electron/main.js(1) / auth.js(2) / tasks.js(2) / pdf.js(2) / store.js(1) / bump-version.js(2) + index.html(2) 共 10 文件 26 条 TODO 预防注释；JS 用 // TODO: [坑-slug] 预防: xxx，HTML 用 <!-- TODO: ... -->
- **为啥**：ledger-precheck 扫出 71 条建议，绝大多数是 issues.md 关联 glob 太宽的噪音（如 ileAssoc 关联 app/js/**/*.js）；核心高频改文件 + P0/P1 坑值得加；scripts/ 下大部分文件 koa-connect/PowerShell-regex 的 TODO 是误导性的（脚本根本不用 koa）
- **踩的坑**：第一次用 PowerShell 批量写时 index.html 两条 TODO 连在一起无换行 + 用了 JS // 注释（HTML 不认），导致 boot test 16 挂 → 立刻 git checkout 回滚 → 改用 Edit 工具逐文件精确 old_string→new_string 替换，每条独立一行
- **故意不加的**：electron/main.js 的 contextIsolation-window — 主进程没 window 对象，坑在 preload/renderer；scripts/ 下 koa-connect/PowerShell-regex/fileAssoc 批量噪音
- **关联文件**：app/js/shell.js / app/js/modules/mindmap.js / app/js/import-ooxml.js / electron/main.js / app/js/auth.js / app/js/tasks.js / app/js/modules/pdf.js / app/js/store.js / scripts/bump-version.js / app/index.html
- **决策人**：AI 批量补 TODO 时踩 PowerShell 换行坑

---

## [2026-10-01] PDF→DOCX 多栏版面还原

- **选了啥**：在 pdf-convert.js 的 pdfToDocxHtml 里加 detectColumnSep（gap 直方图单一 dominant peak 检测）+ 双栏 prose 重排（左栏从上到下 → 右栏从上到下）
- **为啥**：双栏 PDF 跨栏 prose 行有大 gap → isTableLike=true → 被误判成表格 → 输出变成 <table> 而非段落 + 列表；阅读顺序也错（行交替而非左栏读完再右栏）
- **核心算法**：
  1. detectColumnSep：gap histogram 找 dominant peak（bins[0].n >= 半数行 + bins[0].n >= bins[1].n * 2 确保单一 peak）
  2. colSep 存在 → 跨栏行（item<colSep + item>=colSep）= proseRowLines，从 tableCandidates 排除
  3. 安全回滚：如果排除后 tableCandidates 空 + crossSep < 5 → 回滚为表格（2 列表格 vs 双栏 prose 无法区分，保守选表格）
  4. 重排：按 colSep 拆 proseRowLines → 左组 baseY 降序 + 右组 baseY 降序 → 合并
- **避坑**：2 列表格和双栏 prose 结构完全一致（每行 2 item + 1 gap），detectColumnSep 会同时触发；crossSep < 5 行是区分阈值（真实双栏 prose 通常 ≥5 行）
- **备选方案**：detectSeparators 数量区分（1 个 sep 无法区分）、列对齐方差（真实 PDF 里双栏 prose 列也严格对齐）→ 都不行
- **关联文件**：app/js/modules/pdf-convert.js（detectColumnSep L224 + pdfToDocxHtml 流程改造 L108-135 + prose 重排 L140-158）
- **决策人**：AI 自主开发

---

## [2026-10-01b] PDF→DOCX 多栏版面还原（二次迭代）

- **选了啥**：修复 detectColumnSep + prose 重排流程，加多轮安全回滚 + insertPreserved
- **为啥**：上版 crossSep 过滤后丢失标题/备注、items>=3 多列表格行误判、sort 打乱左栏右栏顺序
- **本轮新增安全机制**：
  1. gapRows 只看 items=2 的行（多列表格 items>=3 跳过，避免 dominant ratio 被干扰）
  2. crossSep 剔除 items>=3 的行（多列表格特征），只保留 items=2 纯双栏 prose
  3. crossSep.length < 5 → 回滚（2 列表格 vs 双栏 prose，保守判表格）
  4. insertPreserved 保留未被多栏覆盖的 prose 行（标题、备注等 items=1）
  5. 重排后不 sort（避免打乱「左栏先→右栏后」阅读顺序）
- **端到端验证**：6/6 通过（双栏 prose + 3 列表格 + 标题 + 备注 + 列表 + prose 不在 table 里）
- **回归**：104/104 测试全绿
- **避坑教训**：
  - items>=3 是多列表格和双栏 prose 的关键区分特征（双栏 prose 每行只有 2 个 items）
  - dominant peak 检查必须只看 items=2 的行，否则表格多 gap peak 会盖过 prose gap
  - 重排 prose 不能整体 sort，会打乱左栏→右栏阅读顺序
- **关联文件**：app/js/modules/pdf-convert.js（insertPreserved L275 + 流程改造 L108-176）
- **决策人**：AI 自主开发

---

## [2026-10-01c] PDF→DOCX 多栏版面还原：真实 IEEE 论文端到端验证通过

- **选了啥**：下载 4.5MB arXiv:1207.0809v1（真实双栏天文论文）→ pdfjs-dist@3 legacy 解析 → pdfToDocxHtml 端到端跑通
- **为啥**：之前只在 mock spans 上验证，必须走一次"真实 PDF → pdf.js spans → pdf-convert.js"全链路才能证明 detectColumnSep + 重排逻辑在真实场景里不崩
- **结果**：
  - 3 页各 113/105/143 spans，左栏 47+63+59 / 右栏 41+23+51（明显双栏分布）
  - 输出 11805 chars，93 段落，包含标题、作者、单位地址、检测到表格
  - 104/104 回归全绿，boot test 14/14 全绿
- **踩的坑**：
  - pdfjs-dist v6 只有 ESM + Node native crypto 问题 → 降级到 pdfjs-dist@3（legacy build 可用）
  - 真实 PDF spans 含上标下标混排（"1 Physics Dept." + 上标 1）→ 不影响，pdf-convert 不处理字体样式只处理布局
- **关联文件**：package.json（pdfjs-dist 降级到 @3）、app/js/modules/pdf-convert.js
- **决策人**：AI 自主开发 Trust-but-Verify 铁律触发

---

## [2026-10-01d] PDF→DOCX 图片嵌入：pdf-convert.js 支持 image span + 上游集成路径

- **选了啥**：pdfToDocxHtml 的 pages spans 支持混装 {image: "data:image/png;base64,...", x, y, w, h} 图片 span，events 渲染加 kind:"img" → 输出 <p><img src=data:URI width height /></p>（buildDocx 已自动处理 drawingRun）
- **为啥**：buildDocx 已有完整 <img> → DOCX drawing 嵌入（L317 已处理 data: URI），只需 pdf-convert.js 输出 img 标签。图片 span 混装进同一 pages 数组，向后兼容（文本 span 不受影响）
- **端到端验证**：1x1 PNG base64 + 标题 + 正文 + 图注 → 输出含 <img src="data:image/png;base64,..." width="180" height="160" />，events 按 y 排序穿插在表格/段落之间
- **回归**：104/104 全绿
- **上游集成**（后续）：pdf.js 层需要提取页面 xObject/image → 转 data: URI → 混装进 spans 传给 pdfToDocxHtml
  - pdf.js API：page.getOperatorList() → 找 paintImageXObject → page.getXObject(name) → ImageData → canvas.toDataURL()
  - 但 pdf.js 页面渲染时其实已经在画 canvas 上了，可以直接从 canvas 取图片（前提是 canvas 没被 taint）
- **关联文件**：app/js/modules/pdf-convert.js（L102-106 分离、L204-220 events）、app/js/export-ooxml.js（已就绪 L177-268）
- **决策人**：AI 自主开发

---

## [2026-10-02] PDF→DOCX 导出 UI 全链路打通

- **选了啥**：pdf.js 模块侧栏加 "📄 导出 Word (.docx)" 按钮 → loadPdf 后后台预提取 textContent spans → export-word handler 调 PdfConvert.pdfToDocxHtml → Exporter.buildDocx → util.download
- **为啥**：pdf-convert.js 的 image span 支持和多栏重排都已验证，但没有 UI 入口让用户真正用起来。这轮把"打开 PDF → 导出 Word"的完整链路闭合
- **架构**：
  - extractAllPagesSpans()（新增）：page.getTextContent() → 归一化 {text,x,y,w,h} spans（复用 L559-573 里已有的 pdf.js transforms 解析逻辑）
  - 预提取时机：loadPdf 成功后 .then(ps => _pages = ps).catch(() => {}) 后台异步跑，不阻断阅读
  - 导出 handler：检查 _pages 是否已就绪（没就绪就同步等一下）→ PdfConvert → buildDocx → download
- **回归**：104/104 + 14/14 全绿
- **关联文件**：app/js/modules/pdf.js（L42 按钮 + L71 _pages + L122-123 预提取 + L127-151 extractAllPagesSpans + L721-737 handler）
- **决策人**：AI 自主开发

---

## [2026-10-03] 台账升级为 Growth Ledger（3 层分级 + 自动归类）

- **选了啥**：issues.md 3 层分级系统 — L1 模块聚合坑 / L2 独立实例坑 / archived 历史归档。同模块 L2 ≥ 3 条且根因可归 → 自动升级为 L1 聚合坑
- **为啥**：旧版 34 条全是独立 slug，每条没归类，读台账时像"失忆的备忘录"——AI 接手找不到模块级架构规律，同类坑反复踩。分级后 L1 聚合坑附"总预防规则"（跨子坑通用），AI 扫一眼就知道模块层该防什么
- **数量控制**：L1 ≤ 15 / L2 ≤ 50，超阈值触发清理（升 L1 或归档）
- **归档规则**：已修复 + 3 个月未复发 → 移入 archived 区（只留一句话标题）
- **本轮重构成果**：34 条独立 L2 → 6 L1 聚合（pdf 7 条 / electron 5 条 / shell 3 条 / boot 2 条 / powershell 2 条 / mindmap 2 条）+ 13 L2 剩余 + 3 archived
- **关联文件**：AGENTS.md §7.3（格式定义 + 分级规则）、.trae/memory/台账/issues.md（全量重构）
- **决策人**：用户明示 + AI 自主开发

---

## [2026-10-03b] PDF→DOCX 完整链路 Node 端端到端验证通过

- **选了啥**：用 arXiv:1207.0809v1（IEEE 4.3MB 双栏天文论文）跑完整链路：pdfjs v3 → textContent → pdfToDocxHtml → buildDocx → 写出 ieee-converted.docx → 解包验证
- **结果**：
  - 14 页 PDF 前 3 页 → 361 spans → 11573 chars HTML → 24.5 KB DOCX
  - word/document.xml 含 124 段落，纯文本量 10559 chars（和 html 一致，无丢失）
  - 含表格（IEEE 论文有数据表格），不含 undefined/NaN 垃圾字符
  - Node 端环境用 jsdom window 注入后 eval export-ooxml.js（IIFE 接受 global 参数）
- **关联文件**：app/js/modules/pdf-convert.js（K-means detectColumnSep）、app/js/export-ooxml.js（buildDocx）
- **决策人**：AI 自主开发

---

## [2026-10-03c] STATUS.md PDF 模块状态升级 🟡→🟢

- **选了啥**：STATUS.md 02 PDF 模块从 🟡 部分实现 → **🟢 可用**。边界项 PDF→DOCX 从 🟡 边界 → ✅ 已解
- **为啥**：本轮完成的 PDF→DOCX 完整链路（多栏 K-means + 表格 + 图片 span + 导出 UI + 真实 IEEE 论文端到端验证 24.5KB .docx）已跨越"版面还原有限"的旧描述
- **保留 🟡 边界**：PDF→Excel（无像素级表格）、PDF→TXT/MD
- **关联文件**：STATUS.md（L13 + L29）
- **决策人**：AI 自主开发

---

## [2026-10-03d] PDF→Excel UI 打通（CSV 直接下载 + 复用 _pages spans）

- **选了啥**：pdf.js 工具栏加导出 Excel CSV 按钮 + 事件绑定，复用 _pages 预提取 spans 调 pdfToExcel
- **为啥**：pdfToExcel 核心逻辑已在 L537 实现，但 UI 只绑定了 export-word，excel 没绑定；选 CSV 而非 buildXlsx 是因为 buildXlsx 要 cells 对象格式，是另一层工作
- **关联文件**：app/js/modules/pdf.js（L43 按钮 + L740-756 绑定）
- **决策人**：AI 自主开发

---

## [2026-10-03e] PDF→Excel 真 .xlsx 完整链路对接

- **选了啥**：pdf-convert.js 拆三层（_buildExcelRows → pdfToExcelRows/pdfToExcel → rowsToCells）+ pdf.js Excel 按钮改用 buildXlsx
- **为啥**：
  1. 原 pdfToExcel 内部 rows 构造和 CSV stringify 耦合，xlsx 对接拿不到 rows 数组
  2. rowsToCells 加本地 _colName 实现（pdf-convert.js 独立模块，不能依赖 export-ooxml.js 的 colName）
  3. IEEE 前 3 页真 .xlsx 22.8 KB（ZIP PK 格式 ✅），122 行 → 124 cells refs
- **关联文件**：pdf-convert.js（L537-598 重构 + api 加 2 函数）、pdf.js（L740-758 改 buildXlsx 路径）
- **决策人**：AI 自主开发

---

## [2026-10-03f] PDF 侧边栏导出 4 件套（Word+Excel+TXT+MD 全 UI 打通）

- **选了啥**：侧边栏快捷入口从 Word+Excel 2 个 → 4 个（加 TXT/MD）。4 个全部走新版 _pages 路径（extractAllPagesSpans → pdfToText/pdfToMarkdown）
- **为啥**：
  1. exportAsText/Markdown 函数已存在（L1831/1850），批注工具箱菜单也有按钮（L896/897），但走旧路径 textIndex.pages
  2. _pages 格式是 spans 数组，pdfToText/Markdown 内部 clusterLines(spans) 完全兼容 → 侧边栏 4 个按钮统一新版数据源
- **MD 标题识别说明**：IEEE 前 3 页字号差异小（论文格式），没触发 h3 阈值（med*1.3）→ 无 # 标题，正常。有大字号标题的 PDF 才会触发
- **关联文件**：pdf.js（L44-45 按钮模板 + L762-794 绑定）
- **决策人**：AI 自主开发

---

## [2026-10-03g] 追加 pdfToExcelRows / rowsToCells 单元测试（21 新用例）

- **选了啥**：_pdf_convert_excel_test.js 追加 21 个新断言（pdfToExcelRows 7 + rowsToCells 8 + Z→AA 边界 1 + 原 12 → 共 33）
- **为啥**：新增的 pdfToExcelRows/rowsToCells 是 pdf-convert.js 重构核心（_buildExcelRows 解耦产物），直接被 pdf.js Excel 按钮调用 → 必须有回归保护
- **覆盖点**：rows 返回值类型/行数/列数/pageMarkers、cells A1 引用生成/缺列留空/空行容错、Z→AA 列名边界
- **关联文件**：_pdf_convert_excel_test.js（L51-80 追加区）
- **决策人**：AI 自主开发

---

## [2026-10-03h] dist:local 打包成功 1.1.4（含本轮全部 PDF 导出改动）

- **选了啥**：electron-builder --win --publish never，CSC_LINK 留空 → 自动跳过签名（AGENTS §6 不花钱）
- **为啥**：本轮改动（pdf-convert.js 重构 + pdf.js 4 按钮 + buildXlsx 对接 + 21 新单测）全部进产物
- **验证**：Electron 启动 +257ms loadURL 无 crash、dist:local exit=0、产物时间戳更新
- **产物**：dist\绿角犀 Office Setup 1.1.4.exe + 绿角犀 Office 1.1.4.exe
- **关联文件**：无新文件，dist/ 更新
- **决策人**：AI 自主开发

---

## [2026-10-03i] exportAsXxx 4 函数统一数据源（_pages 优先 + textIndex.pages fallback）

- **选了啥**：L1847-1916 的 exportAsWord/Text/Markdown/Excel 全部加 _pages 优先 → textIndex.pages fallback 模式；exportAsExcel 顺便升级为真 .xlsx（buildXlsx 对接）
- **为啥**：侧边栏按钮（L42-45）和批注工具箱菜单（L894-898）都绑定这 4 个函数——之前走不同数据源，容易产生"同一份 PDF 两个入口导出结果不一致"的用户困惑
- **架构收益**：
  1. 侧边栏 4 按钮（各自独立实现）+ 工具箱 4 按钮（统一走 exportAsXxx）→ 现在 8 个入口**全部**优先 _pages
  2. 	extIndex.pages 仅作安全网 fallback（_pages 为空时兜底），不再是主路径
- **关联文件**：pdf.js（L1847-1916 重构区）
- **决策人**：AI 自主开发

---

## [2026-10-08a] dist:local 重打包 1.1.4（含 exportAsXxx 统一）+ STATUS.md PDF 边界清完

- **选了啥**：
  1. npm run dist:local 重打（上次 09:27 不含 exportAsXxx 统一改动，pdf.js 14:28 才改）
  2. STATUS.md L30 PDF→TXT/MD 🟡 边界 → ✅ 已解
  3. STATUS.md 边界区 PDF 相关 3 项 **全 ✅ 已解**（Excel / DOCX / TXT+MD）
  4. 只剩 2 个 ⚠️ 人工（iOS/HarmonyOS + 商店合规，花钱跳过）
- **验证**：dist:local exit=0，104/104 全绿，IEEE 端到端链路（docx/xlsx/txt/md）全验证过
- **关联文件**：dist/（产物更新）、STATUS.md（L30）
- **决策人**：AI 自主开发

---

## [2026-10-08b] 正式发版 v1.1.5（PDF→Office 版面还原迭代收官）

- **选了啥**：bump-version patch 1.1.4 → 1.1.5 + dist:local exit=0
- **为啥**：本轮 8 轮工作（PDF 4 导出全打通 + buildXlsx 对接 + exportAsXxx 统一 + 21 新单测）完整收官
- **版本注入**：
  - package.json ✅
  - index.html ✅
  - sw.js CACHE v25 → v26（Service Worker 强制刷新）
  - version.json ✅
  - iOS build 10104 → 10105 ✅
  - HarmonyOS code 1001004 → 1001005 ✅
- **产物**：dist\绿角犀 Office 1.1.5.exe (99.9 MB) + Setup 1.1.5.exe (100.1 MB) + latest.yml version: 1.1.5
- **验证**：104/104 全绿 + latest.yml 正确 + IEEE 端到端链路已验证
- **踩坑**：bump 后未立刻 dist → _e2e_roundtrip_test 3 个 RELEASE 断言 fail（发版流程顺序问题，不是代码 bug）
- **关联文件**：package.json / app/index.html / app/sw.js / version.json / dist/*
- **决策人**：AI 自主开发

---

## [2026-10-08c] v1.1.6 PDF OCR 扫描件识别（tesseract.js 7.0.0）

- **选了啥**：tesseract.js 7.0.0（纯 JS + WASM，零原生依赖）+ LazyLib 懒加载 + 侧边栏 OCR 按钮 + eng + chi_sim 语言包
- **为啥**：
  - 架构约束：**零原生依赖**（所有 dependencies 纯 JS），tesseract.js 完美符合
  - electron-builder build.files "app/**/*" 自动打包 vendor/tesseract/lang-data/ 进 app.asar
  - LazyLib 已在 util.js L244 预注册 Tesseract（留了位），直接对接
- **踩坑**：
  - tesseract.js 7.x API 变了：createWorker(langs, OEM, options) 一步到位（旧版 loadLanguage+initialize 已废弃）
  - Node 侧 require("canvas") 原生库装不上 → OCR 必须跑在 **Electron 渲染进程**（天然 DOM canvas）
  - tesseract.min.js 默认是 UMD（file:// 协议 fetch worker.min.js 会被 CORS 拦）→ 主进程注册了 http server serve app/，所以走 http:// 加载，不触发 file:// CORS
- **增量**：vendor/tesseract/ 64.4 MB（语言包为主，OCR 核心 ~170 KB）
- **关联文件**：
  - app/vendor/tesseract/*（tesseract.min.js + worker.min.js + lang-data/{chi_sim,eng}.traineddata）
  - app/js/modules/pdf-ocr.js（新建，OS.PDFOCR）
  - app/js/modules/pdf.js（L797-824 OCR 按钮绑定 + L46 按钮模板）
  - app/index.html（L329 加载 pdf-ocr.js）
  - package.json dependencies 加 tesseract.js
- **决策人**：AI 自主开发

---

## [2026-10-08d] pdf-engine.js ocrPDF + makeSearchablePDF 实现

- **选了啥**：pdf-engine.js L5027-5092 实现 ocrPDF（多页批量）+ makeSearchablePDF（可检索 PDF），复用 OS.PDFOCR.recognizePage
- **为啥**：工具箱 OCR 按钮（pdf-app.js L1686-1708）是占位骨架，调 E.ocrPDF 空函数。实现它 = v1.1.6 OCR 全链路打通
- **踩坑**：pdf-engine.js 内部 PDFLib 导出 PDFDocument.Font.Helvetica 未在顶层解构 → 需从 pdfDoc.getEmbeddedFont(PDFDocument.Font.Helvetica) 取
- **makeSearchablePDF 技术**：PDFLib 打开原 PDF → 逐页 drawText(opacity:0) 透明文字层 → save → 可检索 PDF（选中/搜索文字但看不见）
- **关联文件**：app/js/modules/pdf-engine.js（+66 行）
- **验证**：104/104 全绿 + dist:local 重打
- **决策人**：AI 自主开发

---

## [2026-10-08e] tesseract.js 真实 OCR 验证 + .gz 语言包打包坑

- **真实验证**：对用户上传的绿角犀 Office Presentation 编辑器截图（湘尔康枸杞配方滋补品）做 OCR
  - **置信度 75%**（桌面截图，非扫描件）
  - 识别出：绿角犀 Office / 文件·编辑·视图·窗口·帮助 / 工作台·我的 / 新建·删除 / 幻灯片放映 / 文字内容 / 演讲者备注 / 字号 24
  - 画布文字"湘尔康枸杞配方滋补"→"湘尔康构杞配方滋补"（构杞→枸杞小误差）
- **关键打包坑**：**tesseract.js 7.x 必须有 .traineddata.gz 压缩包**！光解压好的 .traineddata 它不认，会报 ENOENT 找 .gz
  - 根因：tesseract.js 7.x 设计时假设浏览器需要 fetch + gzip 解压（省网络流量），所以 langPath 下必须有原始 .gz
  - 解决：把已下载的 .trae/tmp/tessdata/*.gz 复制到 vendor/tesseract/lang-data/
- **增量体积**：+29.6 MB（chi_sim.gz 19.2 + eng.gz 10.4）→ lang-data 总 93.8 MB
- **产物**：v1.1.6 Portable 165.3 MB（前次 135.7 MB，差 29.6 MB 正好是 gz 包）
- **决策人**：AI 自主开发 + 用户上传图验证

---

## [2026-10-08f] 发版只出 NSIS 安装包，不要 Portable 绿色版

- **用户决策**：2026-10-08 用户明示：发版产物**只要安装版 Setup.exe，不需要 Portable 快捷 EXE**
- **改了啥**：
  1. package.json build.win.target：
sis + portable → 只留 
sis
  2. package.json 删 portable 配置块（artifactName）
  3. _e2e_roundtrip_test.js 删 Portable 断言（绿角犀 Office {VER}.exe 那行）
  4. AGENTS.md §6 加「发版产物」条目 + 更新 Setup 签名文案
- **验证**：dist:local 只出 绿角犀 Office Setup 1.1.6.exe（165.5 MB），104/104 全绿
- **决策人**：用户明示决策 + AI 执行

---

## [2026-10-08g] Ribbon 功能区紧凑化（合并压高度）

- **用户决策**：顶部功能区"太占空间了，合并起来"
- **改了啥**：
  1. CSS 变量 --ribbon-h:72→40 + --tabstrip-h:32→28（总高 104→68px，省 35%）
  2. .rgroup-cap { display:none } 隐藏分组底注（"幻灯片""放映"等）
  3. .rgroup-body 从 lex-wrap:wrap; max-width:248px → 
owrap; gap:1px（按钮全横向排）
  4. .rbtn 从 min-width:42px; padding:4px 7px; gap:3px; font-size:11px → 36px; 2px 5px; 1px; 10px
  5. .ribbon-panel padding 5px 6px → 2px 6px + 去掉 border-bottom
  6. .rgroup padding 2px 12px 0 → 0 8px
- **为啥**：Ribbon 面板默认高 72px + tabstrip 32px = 104px，加上用户截图里的额外导航行 → 太占画布空间
- **关联文件**：app/css/style.css L23 + L120-134
- **决策人**：用户反馈 + AI 执行
- **验证**：104/104 绿 + dist:local 重打

---

## [2026-10-08h] 顶部导航 4 层合并为 3 层（titlebar 吸收 app-nav）

- **用户反馈**：顶部有 6 层导航条，太占空间，联网学习后合并
- **改了啥**：
  1. **DOM 合并**：<nav class="app-nav" id="app-nav"> 从独立行移入 <header class="titlebar"> 的 .tb-left 内（品牌和 QA 按钮之间）
  2. **独立行隐藏**：原独立 <nav class="app-nav"> 行保持 DOM 结构但 CSS display:none!important
  3. **CSS 覆盖**：.tb-left .app-nav { display:flex!important } 父选择器覆盖全局 display:none
  4. **CSS 变量压高度**：title-h 46→40, tabstrip-h 28→24, ribbon-h 40→36
  5. **titlebar 内 nav 样式**：12px 字体, 去下划线, 居中对齐, 透明背景
- **高度变化**：
  - 改前：titlebar(46) + app-nav(38) + tabstrip(28) + panel(40) = **152px (4 层)**
  - 改后：titlebar(40) + tabstrip(24) + panel(36) = **100px (3 层)**
  - **节省 52px / 34%**
- **为啥**：用户截图显示 4 层内容条 + Electron 窗口条 = 视觉 5-6 层，画布被严重压缩
- **关联文件**：app/index.html L107-136, app/css/style.css L23+L86-95+L1133-1139
- **决策人**：用户反馈 + AI 参考 WPS/ONLYOFFICE 紧凑模式
- **踩坑**：e2e 测试 regex 严格匹配 class="app-nav" id="app-nav"，不能加额外 class；用 .tb-left .app-nav 父选择器覆盖是正确姿势

---

## [2026-10-08i] 隐藏 Electron 原生菜单栏（文件·编辑·视图·窗口·帮助）

- **用户反馈**：第二张截图显示编辑态还有一整行 Electron 原生菜单栏"文件·编辑·视图·窗口·帮助"，太占空间
- **改了啥**：
  1. electron/main.js BrowserWindow 构造加 utoHideMenuBar: true
  2. win.setMenu(createAppMenu(win)) 后加 win.setMenuBarVisibility(false)
  3. main.js（根目录备份）同步改
- **保留了啥**：
  - Menu 模板不删 → 快捷键继续生效（Ctrl+Shift+N 新建窗口、undo/redo/cut/copy/paste 等系统 role）
  - 按 **Alt** 键临时呼出菜单栏（autoHideMenuBar 行为）
- **为啥**：Electron 原生菜单栏占 30+px 高，但用户界面已有 titlebar+ribbon 覆盖所有功能；菜单栏内容（撤销/重做/复制/粘贴/全屏/DevTools）要么有键盘快捷键要么有 UI 按钮
- **关联文件**：electron/main.js L282+L294, main.js L265+L275
- **决策人**：用户截图 + AI 执行
- **验证**：104/104 绿 + dist 15:22 重打

---

## [2026-10-08j] 多窗口支持：双击第二个文档开新窗口

- **用户反馈**：没办法打开两个文件
- **根因**：Electron main.js 全局 let win 单窗口变量 + second-instance 事件把新文件推给旧窗口（openFileAt），而不是开新 BrowserWindow
- **改了啥**（electron/main.js）：
  1. 全局 let win / let pendingFiles / let webReady → 移除
  2. 新增 const windows = new Set() 管理所有窗口引用
  3. const w = new BrowserWindow(...) 取代 win =，每个窗口自己的 w.__state = { pendingFiles: [], webReady: false }
  4. openFileAt / lushPendingFiles → 拆为 eadFilePayload(p) + dispatchFileTo(win, payload) + lushWindowPending(win) 三个纯函数
  5. createWindow(initialPaths) 接受可选文件路径数组，预读后塞 pendingFiles
  6. second-instance → createWindow(paths) **开新窗口**（保留单实例锁，共享 HTTP server）
  7. pp:renderer-ready / pp:pending-files → 通过 BrowserWindow.fromWebContents(evt.sender) 定位到具体窗口
  8. setupAutoUpdater 里 4 处 if (win && ...) → BrowserWindow.getAllWindows().forEach(...) 遍历所有窗口广播
- **为啥保留单实例锁**：HTTP server（127.0.0.1:PORT）单进程足够，多窗口共享；去掉单实例锁会每个文件起独立进程 + 独立 server
- **踩坑**：renderer 侧 shell.js 不知道 main 改了——IPC 接口签名没变（pp:open-file / pp:pending-files / pp:renderer-ready），所以 **renderer 零改动**
- **关联文件**：electron/main.js L121-134(updater) + L170-196(helpers) + L266-326(createWindow) + L328-371(whenReady events)
- **决策人**：用户反馈 + AI 执行
- **验证**：104/104 绿 + dist:local 重打

---

## [2026-10-08k] .xls 格式打不开 — entry point 白名单缺扩展名

- **用户反馈**：XLS 格式打不开
- **根因**：electron/file-args.js KNOWN_EXT 缺 .xls — second-instance 事件收到 .xls 路径后 isKnownExt() 返回 false，文件被直接过滤掉，窗口开了但没有文件
- **renderer 侧现状**：完整支持！import-ooxml.js L1217 parseXls(buf) 用 SheetJS BIFF8 解析，L1254 ext === "xls" 分支已存在，返回和 xlsx 同结构的 { type: "spreadsheet", data: {...} }
- **改了啥**：electron/file-args.js KNOWN_EXT 数组加 .xls
- **为什么之前漏掉**：KNOWN_EXT 是早期硬编码的白名单，当时只列了 Office 2007+ 格式（xlsx/pptx），旧版二进制（xls/doc）忘了加；package.json fileAssociations 其实已经注册了 .xls —— Windows 能正确触发 second-instance，但 main 进程把它过滤掉了
- **关联文件**：electron/file-args.js L3
- **决策人**：用户反馈 + AI 执行
- **验证**：104/104 绿 + dist:local 重打

---

## [2026-10-08L] 修复闪退 — readFileSync 阻塞主进程（多窗口改造引入的回归）

- **用户反馈**：出现闪退问题 / PDF 完全没办法打开
- **根因**：多窗口改造（10-08j）把原来的异步 openFileAt（s.readFile 回调）拆成了同步 eadFilePayload（s.readFileSync + s.statSync）。双击大 PDF → 30-50MB 同步读 → 阻塞 Electron 主进程几百毫秒甚至几秒 → Electron watchdog 判定主进程无响应 → 杀进程 → 闪退。闪退了所以 PDF 打不开。
- **为啥之前没发现**：小文件（docx/xlsx/csv）同步读几十毫秒用户感知不到；大文件才触发 watchdog。用户第一次双击大 PDF 就必崩。
- **改了啥**（electron/main.js）：
  1. eadFilePayload（同步，return null/payload）→ eadFilePayloadAsync（async，return Promise）
  2. s.statSync → s.promises.stat
  3. s.readFileSync → s.promises.readFile
  4. createWindow 里 forEach 同步预读 → Promise.all(paths.map(readFilePayloadAsync)).then(...) 异步预读
- **教训**：主进程（main）里永远不要用 eadFileSync/writeFileSync/execSync —— 任何同步阻塞都会卡住 Chromium 事件循环，Electron watchdog 几十毫秒无响应就杀进程。异步 Promise.all + .then() 是主进程 I/O 操作的正确姿势。
- **关联文件**：electron/main.js L172-298
- **决策人**：用户反馈 + AI 修复
- **验证**：104/104 绿 + dist:local 重打

---

## [2026-10-08M] entry point 白名单补全 — .xls / .doc / .ppt

- **上一条 10-08k 只补了 .xls，这次一起补全旧版二进制**


---

## [2026-10-08N] PPTX 背景解析修复 — 覆盖所有标准类型

- **用户反馈**：PPT 的背景没有显示出来
- **根因**：parsePptx 背景解析只处理了 <bg><solidFill><srgbClr> 这一条 PPTX 路径，遗漏：
  1. <bg><bgPr> 包装层（实际 PPTX 标准结构是 bgPr 在 bg 里面，之前代码没穿透 bgPr）
  2. <solidFill><schemeClr> 主题色（只映射 6 个 accent + 2 个 bg/tx，硬编码 fallback）
  3. <gradFill> 渐变背景（完全跳过）
  4. <bgRef> 引用主题/slideLayout 背景（完全跳过）
- **改了啥**（app/js/import-ooxml.js）：
  1. 新增 extractBgFillColor(bgNode) — 完整覆盖 PPTX 背景的 bgPr/bgRef/solidFill/gradFill/srgbClr/schemeClr 所有路径
  2. 渐变背景取第一个 gs stop 颜色（简化处理）
  3. masterBg 和 slide bg 统一调 extractBgFillColor，消除之前碎片化的手动 if-else
- **为啥之前能漏**：测试用 PPTX 可能刚好是最简 solidFill srgbClr 结构。用户的 PPT 可能用了主题色、渐变、或 bgPr 包装
- **关联文件**：app/js/import-ooxml.js L529-537(masterBg) + L574-607(extractBgFillColor) + L738-742(slide bg)
- **决策人**：用户反馈 + AI 修复
- **验证**：104/104 绿 + dist 重打

---

## [2026-10-08P] PPTX 背景修复 Round 2 — 加 slideLayout fallback

- **用户反馈**：PPT 背景还是全白，F12 日志 gNode: false
- **根因**：PPTX 背景继承链是 **slide → layout → master** 三层，Round 1 只做了 slide → master（缺中间 layout 层）。用户的 PPT 把背景设在 slideLayout 上，slide 自己没有 bg 节点
- **改了啥**（app/js/import-ooxml.js）：
  1. 新增 **2.5 slideLayout 预解析**：遍历 ppt/slideLayouts/slideLayoutN.xml 所有文件，用 extractBgFillColor 提取背景色 → 存 layoutBgMap（{slideLayout1.xml: "#2196f3"}）
  2. slide 遍历里 rels 提前取（背景链路需要）
  3. 背景继承链升级：slide 自己的 bg → layoutBg → masterBg → "#ffffff"
  4. layoutBg 查询方式：遍历 rels values，regex 匹配 slideLayouts/(slideLayout\d+\.xml) → 查 layoutBgMap
- **教训**：PPTX 标准里 slideLayout 是独立层级，不能跳过。很多 PPT 把背景、主题色设在 layout 上而不是直接设在 slide 或 master
- **关联文件**：import-ooxml.js L539-554(layout 预解析) + L756-775(继承链)
- **决策人**：用户日志 + AI 修复
- **验证**：104/104 绿 + dist 重打 + 已装
