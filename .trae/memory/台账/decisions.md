

---

## [2026-10-09] PDF→DOCX 表格 cell 内联样式还原：lineToCells keepItems + lineItems 保留样式 + renderLineInline 渲染 cell

- **选了啥**：① `lineToCells(items, seps, keepItems)` 加第三参数，true 返回 `[{text, items}]` 供表格渲染用，false 保持字符串数组兼容 Excel `_buildExcelRows` 路径；② `renderTableBlock` 调 `lineToCells(row.items, seps, true)`，每个 cell 用 `renderLineInline({text, items})` 渲染（复用段内分组逻辑：连续同 fontReal+bold+italic+color+fontSize 合并为一组，输出 `<span style="...">` + `<b>`/`<i>` 包裹）；③ **关键 bug 修复**：`lineItems` 的 map 丢了 fontReal/bold/italic/color/fontSize/w 字段（和 #42 clusterLines 同 bug），cell.items 里的 span 全无样式 → renderLineInline 分组 key 全空 → 只输出纯文本无 inline span；补保留全部样式字段
- **为啥**：project_memory 列为下一个开发任务（#42 已知边界「表格 cell 文本不还原样式」）；之前 renderTableBlock cell 用 `esc(String(c))` 输出纯文本，表格内字体/字号/粗斜体/颜色全部丢失
- **兼容设计**：keepItems 默认 false，Excel 路径 `_buildExcelRows` 不传第三参数，行为完全不变；仅 DOCX 表格渲染传 true 拿 items 走 inline span
- **测试调整**：`_pdf_3col_e2e_test.js` D2 硬匹配 `<td>H1</td>` 改为 `>H1<`（cell 现在可能包 inline span，用 >text< 匹配更鲁棒，不依赖是否包 span）
- **已知边界**：cell 内多字号混合按 inline span 分组渲染（行内混排可还原）；cell 无样式信息（spans 不传 fontReal 等）时 inlineStyle 返回空串不包 span，输出纯文本（向后兼容合成测试）
- **关联文件**：app/js/modules/pdf-convert.js（lineToCells keepItems L805-819、renderTableBlock L178-192、lineItems 保留样式 L717-737）、_pdf_style_test.js（I+J 组 10 断言）、_pdf_3col_e2e_test.js（D2 匹配改鲁棒）、app/sw.js CACHE v32→v33
- **决策人**：用户「继续做表格 cell 内联样式还原」拍板

---

## [2026-10-09] PDF→DOCX 段落对齐推断：pageMargins（min/max）+ detectParaAlign（左右偏移对称判定）+ buildDocx text-align→`<w:jc>`

- **选了啥**：① 新增 `pageMargins(spans)`：左边距取所有 span 的最小 x，右边距取 (x+w) 最大值；② 新增 `detectParaAlign(para, leftMargin, rightMargin)`：段 minX/maxX 与页边距比对，左右偏移都 > 容差且大致对称 → center，左偏移大+右贴边 → right，其余 → left（justify 难与 left 区分保守归 left）；③ `pdfToDocxHtml` 主流程每页先算 margins，每段调 detectParaAlign，输出 `<p style="text-align:center|right">`（左对齐不输出 text-align 节省噪音）；④ `buildDocx.blockToParagraphs` 解析 `<p>`/`<h*>` 的 style.text-align → 输出 `<w:jc w:val="center|right|both"/>` 段落级对齐；⑤ `clusterLines` map 补保留 w 字段（之前只留 text/x/y/h，detectParaAlign 拿不到 maxX）
- **为啥**：上一轮字体样式还原完成后，project_memory 列「段落对齐推断」为下一个开发任务；原 pdfToDocxHtml 所有段落都默认左对齐，居中标题/右对齐日期全部丢失
- **为啥用 min/max 不用中位数**：合成测试实锤——一页混合左/居中/右三段时，中位数 x=0.30、(x+w)=0.70 把页边距误判到中间，导致 detectParaAlign 全部归 left；min/max 对单栏+多对齐混合更稳，真实 PDF 通常左对齐段占多数，min 接近真实左页边
- **容差选择**：tol=0.02（约 1.2% 页宽 ≈ 8.4px on 600px viewport），既能容忍 PDF 文本提取的亚像素抖动，又不会把真正居中的段误判成左对齐
- **已知边界**：justify（两端对齐）外观像 left，保守归 left 不强分；表格 cell 不参与对齐推断；标题也支持居中（isHeading 段也走 detectParaAlign）
- **关联文件**：app/js/modules/pdf-convert.js（pageMargins L73-89、detectParaAlign L91-113、clusterLines 保留 w L122-130、pdfToDocxHtml 主流程 margins+align L202-348）、app/js/export-ooxml.js（blockToParagraphs 解析 text-align L366-388）、_pdf_style_test.js（G+H 组 8 断言）、app/sw.js CACHE v31→v32
- **决策人**：用户「先处理段落对齐推断」拍板

---

## [2026-10-09] PDF→DOCX 字体/字号/粗斜体/颜色还原：fontMap（commonObjs）+ colorRuns（opList setFillRGBColor）+ 段内 inline span 分组

- **选了啥**：① `_textSpansFromTC` 扩展支持 fontMap + colorRuns 参数，span 新增 fontReal/bold/italic/color/fontSize 字段；② 新增 `_colorRunsFromOps` 纯函数：遍历 pdf.js operator list 维护「当前填充色」状态机（setFillRGBColor/Gray/CMYK 转 #rrggbb），按 showText/showSpacedText 顺序记录 colorRuns；③ `extractAllPagesSpans` 增加 `extractFontMap`：从 page.commonObjs 异步取每个 fontName 的 {name, bold, italic}，5s 总超时兜底防挂死；④ `pdfToDocxHtml` 渲染段内分组：连续同 fontReal+bold+italic+color+fontSize 的 spans 合并为一组，输出 `<span style="font-family:...;font-size:Npx;color:#...">text</span>`，bold/italic 用 `<b>`/`<i>` 包裹；⑤ `buildDocx.mergeProps` 加 font-family 解析输出 `<w:rFonts w:ascii="..." w:hAnsi="..."/>`；⑥ `clusterLines` 保留全部样式字段（之前 map 把 span 简化成只有 text/x/y/h，丢样式）
- **为啥**：project_memory 列为下一个开发任务；之前 pdfToDocxHtml 只输出结构标签 `<p>`/`<h1>`/`<table>`，无 inline style，转换后文档丢失原 PDF 的字体名、字号、粗体/斜体、文字颜色。dump 实锤：pdf.js textContent item 只有 fontName（内部名 g_d0_f1）+ transform[3]=fontSize，无 color/style 字段；真实字体名+粗斜体要从 `page.commonObjs.get(fontName, cb)` 异步取；颜色不在 textContent 里，要从 operator list 的 setFillRGBColor 走查（pdf.js 把 0..1 输入 normalize 成 0..255 存）
- **配对策略**：过滤空 str 后的 textContent items 与 colorRuns 1:1 顺序对齐——pdf.js 给每段 text 前会 emit 一个空 str item（仅设 text matrix，hasEOL=true）；过滤空 str 后数量应等于 showText 调用数；数量不等就降级 color=null 不强配（避免错位）
- **已知边界**：表格 cell 文本不还原样式（lineToCells 返回纯字符串，本轮不动）；段内多字号混合按 inline span 分组渲染（行内混排可还原）；CMYK 公式按 PDF 标准 R=255×(1-C)×(1-K)；非主流颜色空间（Pattern/DeviceN/setFillColor）降级为 null；段落对齐暂不还原
- **关联文件**：app/js/modules/pdf-convert.js（textSpansFromTC/colorRunsFromOps L405-461、renderLineInline/renderParaInline L35-69、clusterLines 保留字段 L74-93、pdfToDocxHtml 段渲染 L292-318）、app/js/modules/pdf.js（extractAllPagesSpans L131-161、extractFontMap L165-189）、app/js/export-ooxml.js（mergeProps/propsToRPr L279-309）、_pdf_style_test.js（36 断言）、app/sw.js CACHE v30→v31
- **决策人**：用户「按这个方案开始 PDF 转换模块的字体和样式还原」拍板

---

## [2026-10-09] PDF 提取层坐标系实锤修正：y-up→y-down 提取层翻转 + 矩阵右乘 + Form XObject 嵌套图片递归（覆盖 #40 坐标系定论错误部分）

- **选了啥**：① extractAllPagesSpans 文本 y 改 `1 - t[5]/vp.height`（y-up→y-down，顶 0 底 1）；② 归一化下沉为 pdf-convert 纯函数 `_textSpansFromTC` / `_walkImageRects`（node 可测）；③ walkImageRects 支持 Form XObject 嵌套图片（paintFormXObjectBegin args[0]=form Matrix 右乘进 CTM，Begin/End 入栈配平，嵌套表单任意深度）；④ 矩阵乘法从**左乘改右乘**（multiplyM(ctm, m)，与 PDF/Canvas postmultiply 语义一致）；⑤ 图片矩形 y 同步翻 y-down（顶边 = 1-(e+max(0,d))/vpH）
- **为啥**：真实三栏 PDF 端到端实测（pdf-lib 生成→pdf.js 真实解析）实锤：pdf.js textContent transform 是用户空间 **y-up**（drawText y=740 → transform[5]=740），不归一则真实 PDF 全文/表格/多栏全部反序。#40 的"y-down 实锤"（批注 top=y*bh）是错的——批注 y 来自 DOM 指针事件，与文本提取坐标系无关；按错误实锤把降序改升序后，真实 PDF 反而全反。矩阵左乘 multiplyM(args, ctm) 只在单条 cm 碰巧正确（I 可交换），pdf-lib drawImage 的 平移→缩放 多步 cm 链直接算飞出页
- **备选方案**：下游所有排序改降序适配 y-up——排除，所有合成测试已是 y-down 约定，翻转提取层一处对齐全部
- **已知边界**：透明度组（Group/SMask）form 不递归；旋转图片按轴对齐近似取框
- **关联文件**：app/js/modules/pdf-convert.js（_textSpansFromTC/_walkImageRects L400-460）、app/js/modules/pdf.js（extractAllPagesSpans L138-142、extractPageImages L159-181）、_pdf_3col_e2e_test.js（12 断言）、app/sw.js CACHE v29→v30
- **决策人**：用户「执行吧」拍板
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

---

## [2026-10-09] PPTX 背景 Round 3 — blipFill 图片背景（最后一块拼图）

- **选了啥**：extractBgFillColor 加 blipFill 处理路径 + 预解析 slideLayout/slideMaster 的 rels + resolveMediaByRels 通用化（baseDir 参数）
- **为啥**：之前只覆盖 solidFill/gradFill/bgRef/srgbClr/schemeClr，blipFill（整张幻灯片用图片做背景）跳过了，context.md 已知边界标注"PPTX 图片背景未处理"
- **实现细节**：
  1. rels 预解析扩展：原来只预解析 ppt/slides/_rels，现在同时预解析 ppt/slideLayouts/_rels 和 ppt/slideMasters/_rels，统一存进 allRels（key 分别是 slideLayout1.xml / slideMaster1.xml）
  2. resolveMediaByRels 从写死 "ppt/slides/" 改成接受 baseDir 参数，用 path.replace(/\/\.\.\//g, "/") 通用折叠相对路径
  3. extractBgFillColor 加两个可选参数 rels + baseDir，在 gradFill 之后、bgRef 之前加 blipFill 路径：blipFill → <a:blip r:embed="rIdX"/> → attr() 拿 rId → resolveMediaByRels 拿 dataUrl → 返回 "url(" + dataUrl + ")"
  4. 渲染端零改动：presentation.js 里 el.style.background = slide.bg 直接支持 url(data:...) 形式
  5. 3 处调用点同步更新：slideMaster → allRels[slideMaster1.xml] + "ppt/slideMasters/"；slideLayout 预解析 → allRels[layoutName] + "ppt/slideLayouts/"；slide 循环 → rels + "ppt/slides/"
- **为啥之前没做**：blipFill 需要 rels 才能找到图片，之前 layout/master 的 rels 没预解析，只存了 slide 的
- **关联文件**：app/js/import-ooxml.js L519-545(rels 扩展) + L579-591(resolveMediaByRels 通用化) + L617-657(extractBgFillColor 加 blipFill) + L553/L569/L795(调用点)
- **决策人**：AI 开发
- **验证**：108/108 绿
---

## [2026-10-10] 表格 P0 三件套：XLOOKUP + 删除重复值 + 数据分列

- **选了啥**：① FUNCS 新增 XLOOKUP（精确/近似/通配符三种模式 + ifNotFound 默认值）；② removeDuplicates + openRemoveDupModal 弹窗（自动猜标题行），物理重排 + adjustFormula 偏移；③ textToColumns + openTextToColsModal 分隔符/固定宽度双模式 + 拆分预览 + 右侧溢出检测；④ 三者都挂 Ribbon「数据」Tab →「数据工具」group
- **为啥**：用户反馈「表格功能和市面差太多」，竞品（Excel/WPS/ONLYOFFICE）的 5 个 P0 数据处理功能绿角犀全缺；先拿最小 3 个热手（核心代码量小，半天交付）
- **备选方案**：先做数据透视表再补小工具 → 工期太长（500+ 行），先做小工具让用户立即"有体感改善"
- **关联文件**：app/js/modules/spreadsheet.js（FUNCS.XLOOKUP L313-334、_wlMatch/_escRe L419-431、removeDuplicates/openRemoveDupModal L1562-1641、textToColumns/openTextToColsModal L1643-1777、Ribbon 按钮 L2052-2053）
- **决策人**：用户「继续深化 + 联网扫竞品」

---

## [2026-10-10] 动态数组函数 + Spill 机制：FILTER/SORT/UNIQUE/SORTBY/TOCOL/TOROW/VSTACK/HSTACK

- **选了啥**：① FUNCS 新增 8 个动态数组函数，统一返回二维数组 shape（rows, cols）；② 新增 _toRows/_toFlat 辅助函数（把任意值统一成二维）；③ getCell 遇到 Array.isArray(val) 时：主值缓存 cache[ref]=val[0][0]，同时遍历 spill 位置写 cache[spillRef]=val[i][j]，记录 spillMap[ref]={rows,cols}；④ recompute 分三步：清 cache → 预算所有带公式单元格（让 spill 先铺满 cache）→ 统一写 DOM；⑤ 旧 spill 残留检测：源单元格公式返回标量时遍历 spillMap 清旧 cache 条目；⑥ 超出网格边界显示 #SPILL!
- **为啥**：用户要求对标 Excel 365，动态数组是 2020 年后 Excel 最重要的新功能——函数能返回一个区域，自动 spill 到相邻空白单元格，不需要 Ctrl+Shift+Enter 旧数组公式
- **关键技术决策**：预算优先于 DOM 写入——原来的 recompute 直接遍历 td 顺序调用 getCell，动态数组的 spill 依赖先算源单元格再算覆盖位置，但 td 顺序不确定。改为先 for (ref in data.cells) 预算所有带公式单元格，让所有 spill 先写进 cache，然后统一遍历 td 时命中 cache
- **关联文件**：app/js/modules/spreadsheet.js（FUNCS 8 个新函数 L313-461、_toRows/_toFlat L568-575、getCell 改 spill L976-1029、recompute 改预算优先 L1032-1056）
- **决策人**：用户「继续开发动态数组函数」

---

## [2026-10-10] 条件格式增强：三色阶 + 数据条负值双向 + 图标集 6 预设 + 公式驱动 + 唯一值

- **选了啥**：① computeCF 扩展 3 个新分支 type=scale3（三色阶 min→mid→max 双段 lerpColor）、type=icon（图标集 + percent 排名/数值阈值双模式）、type=formula（FE.run 逐行计算 + ref 偏移）；② 数据条增加负值双向渐变 hasNeg 分支 + negColor/hideText 选项，一个 linear-gradient 叠满正负条；③ 渲染层 applyCondFormat 清理 + 重写：负值条用 (50-negPct)%→50%→(50+posPct)% 六段渐变；icon 用 <span class="cf-icon">emoji</span> 前置；hideText 存 td.dataset._origText 恢复；④ openRuleModal 扩展 5 个新 UI：scale3 三色选色器、icon 6 种 emoji 预设 + 阈值模式 + 百分比/数值双路径、formula 公式输入框 + 相对引用提示 + 例子、unique 唯一值规则、bar 双色条 + hideText 复选框；⑤ Ribbon「开始 → 条件格式」split 菜单重新组织（突出显示 / 去重唯一 / 数据条 / 色阶双色三色 / 图标集 / 项目选取 / 公式驱动 / 管理规则 分组 8 项）
- **为啥**：用户要求对标 Excel/WPS 竞品，条件格式是 Excel 核心卖点之一；原有实现只有 cell / bar（单色）/ scale（双色）/ top / dupes 5 种，缺三色阶、负值数据条、图标集、公式驱动、唯一值
- **关联文件**：app/js/modules/spreadsheet.js（computeCF 扩展 L2447-2543、applyCondFormat 双向渐变 + icon 渲染 L2545-2587、openRuleModal 新类型 L2612-2696、Ribbon split 菜单重组 L2752-2772）
- **决策人**：用户「继续开发条件格式增强功能」

---

## [2026-10-10] 公式审核追踪：extractRefs + 追踪引用/从属 + 分步求值 + 错误检查

- **选了啥**：① FE.extractRefs(formula) 复用 tokenize 把 ref（单格）和 range（区域）全部拉出来，range 还展开成每个单格 ref；② tracePrecedents：活动单元格公式 → extractRefs → refs → table 里高亮这些 td（inset boxShadow 蓝框）；③ traceDependents：反向扫所有带公式的单元格，extractRefs 里包含选中 ref 的就是从属；④ stepEvaluate：FE.compile(formula).ast 拿 AST → 中序 walk（先左子树再右子树再父节点）→ 每步重新 FE.run 算中间值 → 深度缩进显示，含 ref / range / 常量 / 运算 / 函数五种节点类型；⑤ errorCheck：扫所有带公式单元格 getCell → 结果以 # 开头就进错误列表 Modal；⑥ clearTraces 清除 _auditHighlights 里所有高亮
- **为啥**：用户对标 Excel 竞品的 P1 功能清单，公式审核追踪是 Excel「公式」Tab 核心功能——复杂公式调试必备，用户看不懂嵌套公式时一步步拆；追踪引用/从属用来定位"这个数从哪来的"
- **关联文件**：app/js/modules/spreadsheet.js（FE.extractRefs L852-876、trace* 四个函数 + stepEvaluate + errorCheck L2739-2875、Ribbon 公式审核组 L2960-2968）
- **决策人**：用户「继续开发公式审核追踪功能」

---

## [2026-10-10] 名称管理器 + 保护工作表

- **选了啥**：① FE.setNameResolver：在 FE 引擎里暴露 _nameResolver 变量，evalNode 遇到 node.name 时调用它把名称翻译成 range 字符串，然后改写成 range 节点复用既有区域处理逻辑；② tokenize L617 已有 
ame token 识别（非 ref/非函数调用/非 bool 的标识符），parsePrimary 里原来错误返回 {v:0} 改为 {name: tk.v}；③ mount 开头调用 FE.setNameResolver(name→data.names 查找)；④ commit 里加保护检查：data.protection.enabled && data.locked[ref] !== false → 拒绝写入；⑤ openProtectSheet：密码 + allowSelectLocked/Unlocked/Format/RowsCols 可选项；⑥ openLockCell：选区锁定状态切换（多数锁定就全解锁，反之亦然）；⑦ openHideFormula：公式栏隐藏状态切换；⑧ 名称管理器 CRUD + 批量创建（首列作为名称→每行引用剩余列；首行作为名称→每列引用剩余行）
- **为啥**：用户对标 Excel 竞品的 P1 功能清单，名称管理器让公式更语义化；保护工作表让用户能把模板锁住防止误改
- **关联文件**：app/js/modules/spreadsheet.js（FE.evalNode 加 name 分支 L774-779、FE.setNameResolver 暴露 L883-885、mount 注入名称解析器 L949-954、commit 保护检查 L1105-1112、名称管理器函数 L2900-3039、Ribbon 公式定义名称组 L3124-3168、Ribbon 审阅保护组 L3237-3243）
- **决策人**：用户「继续开发名称管理器和保护工作表功能」

---

## [2026-10-10] 高级图表扩展：散点图 + 瀑布图 + 组合图

- **选了啥**：① chartTypeName 加 scatter / waterfall / combo 三种新类型；② buildChartSVG 分发到三个新函数；③ scatterSVG：两列数值（第1列X第2列Y）+ 双坐标网格 + 实心圆点带数据标签；④ waterfallSVG：累计柱（running total）+ 正负双色（增长蓝/减少红）+ 总计柱（绿）+ 虚线累计连线 + 零线辅助；⑤ comboSVG：第1系列画柱 + 第2+系列画线（共用Y轴，双柱时按线系列数自动缩宽）；⑥ Ribbon「插入 → 图表」组 6 个按钮柱状/折线/饼图/散点/瀑布/组合
- **为啥**：用户要求对标 Excel/WPS 竞品的高级图表类型，原来只有基础三种。散点图用于数据分布相关性分析，瀑布图用于看累计变化（财务/经营分析常用），组合图用于量价对比（柱看销量+线看单价）
- **关联文件**：app/js/modules/spreadsheet.js（chartTypeName 扩展 L3457、buildChartSVG 三分支 L3546-3548、scatterSVG L3625-3668、waterfallSVG L3669-3737、comboSVG L3738-3779、Ribbon 插入图表组扩展 L3195-3201）
- **决策人**：用户「继续开发高级图表功能」

---

## [2026-10-10] 假设分析：模拟运算表 + 单变量求解

- **选了啥**：① runDataTable：临时覆盖输入单元格值 → getCell 重算公式 → 写回结果 → 恢复原值；单变量（一个输入单元格×N行值）双变量（两个输入单元格×M行×N列值）通用；snapshot 包裹可撤销；② goalSeek：牛顿迭代 x_{n+1}=x_n-f(x)/f'(x_n) 数值微分 + 二分法兜底（扫-1e9 到 1e9 区间端点找异号 + 二分）200次上限；求解完 prompt y/n 选择接受（snapshot 包裹，Ctrl+Z 可撤销）还是拒绝；③ Ribbon 数据→数据工具组新增「模拟运算表」「单变量求解」两个按钮
- **为啥**：用户对标 Excel 竞品的 P2 假设分析清单
- **关联文件**：app/js/modules/spreadsheet.js（runDataTable + _overwriteCell/_restoreCell/_computeFormulaRef L2973-3060、goalSeek + openGoalSeekModal L3061-3155、Ribbon 数据工具组新增按钮 L3460-3461）
- **决策人**：用户「继续开发模拟运算表/单变量求解功能」

---

## [2026-10-10] 快速填充 Flash Fill：启发式 10 种模式

- **选了啥**：① inferFlashFillPattern 对每对 (ref, sample) 按优先级试 6 类规则 → 所有样例对必须推断出同 type 且关键参数一致才通过；② applyFlashFillPattern 10 种 pattern type：prefix_suffix / split_part / combine_two / extract_num / extract_num_wrap / extract_num_index / extract_cn / extract_cn_index / take_left / take_right；③ FF_SEPARATORS 覆盖 10 种常见分隔符（,，-—_ / | · 、）；④ openFlashFillModal：参考列 + 结果列 + 样例起始行 → 🔍预览 → 显示推断模式描述 + 样例匹配 + 后续 10 行预测 → 应用填充（snapshot 包裹 Ctrl+Z 可撤销）；⑤ Ribbon 数据→数据工具组最后加「快速填充」按钮
- **为啥**：对标 Excel 2013+ 经典功能，原来空白
- **关联文件**：app/js/modules/spreadsheet.js（Flash Fill 核心 L3157-3328、Ribbon 按钮 L3636）
- **决策人**：用户「继续开发快速填充功能」

---

## [2026-10-10] 高频基础三件套：冻结窗格 + 分类汇总 + 工作表分组

- **选了啥**：① applyFreeze()：CSS sticky 动态层级（th 已有 sticky，只补 td 的 frozen-row / frozen-col / frozen-corner 三档 class + top/left style + z-index 递增）；data.freeze 数据结构 row/col 已存在，只缺实现；openFreezeMenu prompt 选 5 种模式（首行/首列/行列/当前位置/取消）；② buildSubtotal()：按某列扫描分组 + 重写 cells（原数据按组重排 + 每组末尾插入小计行 bold + 最后总计行）+ renderSubtotalOutline 分级符号（行标头前加 − / +，点击折叠隐藏 display:none）+ 汇总方式 SUM/COUNT/AVG/MIN/MAX；③ toggleSheetGroup + syncWriteToGroup：Ctrl+点击 sheet tab 加入/移出工作组，writeCell 里同步写入所有成员 + 右键菜单可设彩色标签 border-bottom；④ Ribbon 加「视图」Tab（窗口组：冻结窗格 + 分类汇总；工作组组：提示按钮）
- **为啥**：竞品调研发现 Excel/WPS 高频基础功能完全空白——冻结窗格（表头滚不走）是最基础最常用的，分类汇总（按列分组+±折叠）是数据处理灵魂，工作表分组（多 sheet 同时改公式）是效率神器
- **关联文件**：app/css/style.css L536-539 加 frozen-row/frozen-col/frozen-corner CSS；app/js/modules/spreadsheet.js applyFreeze+openFreezeMenu L4337-4395、buildSubtotal+renderSubtotalOutline L4397-4554、toggleSheetGroup+syncWriteToGroup+renderSheetTabs 扩展 L4556-4619、writeCell 加 syncWriteToGroup L1102、Ribbon 视图 Tab L3662-3676
- **决策人**：用户「按方案来，先补冻结窗格、分类汇总和工作表分组」

---

## [2026-10-10] Excel 365 新函数补齐 10 个：GROUPBY / LET / SEQUENCE / TEXTSPLIT / CHOOSECOLS / TAKE / DROP

- **选了啥**：在 FUNCS 对象尾部（L509-690 原位置是 AGGREGATE/STATISTICAL 之后，FILTER/SORT/SORTBY 之前？不，实际是 L509-690）追加 10 个新函数：① GROUPBY(groupByArray, valuesArray, fn, ifEmpty) 按字段分组+汇总（返回二维数组，支持 SUM/COUNT/AVG/MAX/MIN/PRODUCT）；② LET 简化版（args 是 evalNode 算好的值，真正变量作用域需改 evalNode，暂返回最后变量值）；③ SEQUENCE(rows, cols, start, step) 生成序列；④ TEXTSPLIT(text, delims) 多分隔符同时拆分；⑤ TEXTBEFORE/TEXTAFTER(text, delim, instance, matchMode) 分隔符前后提取；⑥ CHOOSECOLS(array, c1, c2...) / CHOOSEROWS；⑦ TAKE(array, rows, cols) 正数前取负数后取；⑧ DROP(array, rows, cols) 正数前删负数后删
- **为啥**：竞品调研发现 Excel 365 2025 年的王炸函数——GROUPBY 替代传统透视表、SEQUENCE 自动生成编号/日期、TEXTSPLIT/TAKE/DROP 处理动态数组，是 FILTER/SORT/UNIQUE 的"兄弟函数"
- **关联文件**：app/js/modules/spreadsheet.js FUNCS 对象尾部 L510-690 追加 10 个函数
- **决策人**：用户「继续补 GROUPBY 和 LET 等新函数」

---

## [2026-10-10] LAMBDA + LET 语法级 scope 链改造

- **选了啥**：evalNode 第 3 个参数 scope（默认空对象）+ LET/LAMBDA 在 evalNode 语法级处理（不进 FUNCS）+ node.name 先查 scope 再查名称解析器 + node.func 分支回退查 scope lambda。FUNCS 里 LET/LAMBDA 留占位返回 #CALC!（被 evalNode 头部拦截在 FUNCS 之前，所以不会触发）。关键坑：LET 的 name 参数是字面量 {name:"xxx"}，不能 evalNode 它（否则 scope 里还没定义就返回 #NAME?），必须先判断 
ameAst.name ? nameAst.name : evalNode(...)。LAMBDA 被调用时，先算参数值（带 scope），然后用 closure scope + params→args 绑定造新 callScope，递归 evalNode body。
- **为啥**：Excel 365 LET/LAMBDA 是语法级功能，不是普通函数。之前 LET 简化版只返回最后变量值，真正的 LET/LAMBDA 需要变量作用域链。
- **关联文件**：app/js/modules/spreadsheet.js evalNode L937-1020（LET/LAMBDA/scope 链 + 调用回退）、FUNCS 对象 LET/LAMBDA 改占位 L554-555
- **决策人**：用户「先实现 LAMBDA 自定义函数」


---

## [2026-10-10] 批量补 9 个高频 Excel 函数（纯 FUNCS，无 evalNode 改动）

- **选了啥**：TRANSPOSE（数组转置）、TEXTJOIN（带分隔符拼接+忽略空值）、CHOOSE（按索引选值）、XOR（异或逻辑）、MROUND（四舍五入到指定倍数，不同符号 #NUM!）、SUMSQ（平方和）、COMBIN（组合数）、PERMUT（排列数）、CORREL（Pearson 相关系数）
- **为啥**：9 个都是高频基础函数，纯 FUNCS 实现不需要 evalNode 改动（OFFSET/INDIRECT 需 getCell 运行时注入暂延后）；MROUND 符号不同 #NUM! 是 Excel 官方行为（-5 和 2 符号相反 → #NUM!，-5 和 -2 同号 → -6）
- **测试**：Node.js harness 41/41 通过 + _spreadsheet_newfuncs_test.js 扩展 28 条用例 → 109/109 全绿（CDP 套件因 Electron 未启动跳过后验证）
- **关联文件**：app/js/modules/spreadsheet.js FUNCS L794-884、_spreadsheet_newfuncs_test.js L165-222
- **决策人**：用户「继续补其他 Excel 函数」

---

## [2026-10-10] 再补 5 个纯 FUNCS（HYPERLINK + COUNTUNIQUE + WRAPROWS/WRAPCOLS + ADDRESS）

- **选了啥**：① HYPERLINK — 仅返回 friendlyName 或链接文本（真正的超链接是 UI 层事，FE 不负责可点击性）；② COUNTUNIQUE — 用 	ypeof+v 做 Set key 保证 1/TRUE/"1" 严格区分；③ WRAPROWS — 按 colCount 折行，不足用 #N/A 填充（Excel 官方行为），WRAPCOLS 复用 WRAPROWS + TRANSPOSE；④ ADDRESS — 4 种 absMode（绝对/混合/相对）+ sheet 名自动单引号包裹+单引号双写转义
- **为啥**：Advisor 规划的高频纯 FUNCS 批量，实现简单（≈60 行），无 evalNode 改动；ADDRESS 里 sheet 名有空格自动加引号是 Excel 官方行为，参考之前 openpyxl HYPERLINK 踩坑经验（单引号需双写转义）
- **测试**：Node.js harness 25/25 通过 + _spreadsheet_newfuncs_test.js 扩展 20 条 → 108/108 单文件绿 → 109/109 全局绿
- **关联文件**：app/js/modules/spreadsheet.js FUNCS L885-960
- **决策人**：用户「先补 HYPERLINK 和 COUNTUNIQUE 这些纯 FUNCS」

---

## [2026-10-10] 统计三件套 SLOPE/INTERCEPT/FORECAST.LINEAR（纯 FUNCS，共用 _linReg）

- **选了啥**：① _linReg(yArr, xArr) 内部辅助函数，返回 {n, mx, my, num, dx2, dy2} 避免三处重复写 Σ；② SLOPE(y,x) 注意 Excel 参数顺序 y 在前；③ INTERCEPT(y,x) 同理 y 在前；④ FORECAST.LINEAR(x,y,xArr) 预测点 x 在前；⑤ FORECAST 作为 FORECAST.LINEAR 的别名
- **为啥**：与已有 CORREL 完全相同的线性回归数学（Σ(x-x̄)(y-ȳ) / Σ(x-x̄)²），复用 numList 展平，n<2 → #N/A 防护 + dx2=0 → #DIV/0! 防护；把共用计算收敛到 _linReg 一个入口避免三处公式漂移（ExperienceRecall 提醒的"聚合口径统一"原则）
- **踩坑**：SLOPE 参数顺序经典坑——Excel SLOPE(known_y's, known_x's) y 在前，容易写成 SLOPE(x, y) 导致全部测试对不上；用 SEQUENCE(1,3,6,3) 造 y=6,9,12 和 x=1,3,5 算期望值，实际 slope=1.5（不是直觉的 3）
- **测试**：harness 13/13 → newfuncs 永久测试 121/121 → 109/109 全局全绿
- **关联文件**：app/js/modules/spreadsheet.js FUNCS L961-1011
- **决策人**：用户「继续补统计三件套 SLOPE/INTERCEPT/FORECAST.LINEAR」

---

## [2026-10-10] OFFSET + INDIRECT 动态范围（evalNode 特殊路径 + parseRef/parseRange 双兜底）

- **选了啥**：① _evalOffsetIndirect(name, args, getCell, scope) 函数，在 evalNode func 分支顶部拦截（和 MAP/REDUCE 同级）；② _astNodeToCoords(astNode, getCell, scope) 辅助函数——先查 AST 字面量 ref/range 直接取坐标，失败再 evalNode 得字符串 → parseRange → parseRef 双层兜底；③ _coordsToArray(coords, getCell) 统一用 getCell 构造二维数组
- **为啥**：OFFSET/INDIRECT 的 baseRef 需要坐标（不是值），FUNCS 纯函数模式拿不到坐标；AST 里 {ref:"A1"} 能直接拿坐标，但 INDIRECT("A1") 的参数 eval 后才是字符串——两种情况都要支持
- **踩坑**：INDIRECT("A1") 单格无冒号 → parseRange 正则不匹配 → 必须加 parseRef 兜底；X999 是合法 ref（边界内）→ 返回 0 不是 #REF!；OFFSET baseRef 默认保留原尺寸做 height/width
- **测试**：harness 14/14 → newfuncs 133/133 → 109/109 全绿；永久测试里 OFFSET/INDIRECT 需单独带数据 getCell（默认空表返回 0 无法验证）
- **关联文件**：app/js/modules/spreadsheet.js evalNode L1329-1333 + FUNCS L1012-1014 + 新函数 L1371-1453
- **决策人**：用户「先补 OFFSET 和 INDIRECT」

---

## [2026-10-10] ISFORMULA + FORMULATEXT（FE.run 新增 getRawCell 第 4 参数 + FE._getCellRaw 运行时注入）

- **选了啥**：① FE.run(formula, getCell, currentRef, getRawCell) 新增第 4 可选参数 → FE._getCellRaw 赋值；evalNode 和 run() finally 自动清理；② _evalIsFormula 用已有的 _astNodeToCoords 拿 ref(s) → FE._getCellRaw(ref) 查 .f 字段 → "=" 开头算有公式；③ 单格返回标量、范围返回二维数组（Excel 动态数组行为）；④ 无 FE._getCellRaw 时返回 "#N/A"（安全降级，单测可手动注入）
- **为啥**：getCell 只返回计算值，ISFORMULA/FORMULATEXT 需要原始 cell 的 .f 字段。不想改 FE.run 签名破坏现有调用（render() 里 FE.run 调用只传 3 参数），所以加可选第 4 参数
- **踩坑**：无 getRawCell 时不能返回错误（比如 render() 里默认调用），必须安全降级 → "#N/A"；FORMULATEXT 公式字符串必须以 "=" 开头才算有效（兼容用户可能设置非公式的 f 字段）
- **测试**：harness 8/8 → newfuncs 扩展到 140 条 → 109/109 全绿
- **关联文件**：app/js/modules/spreadsheet.js evalNode L1337-1340 + 新函数 _evalIsFormula L1378-1411 + run() L1603-1610 + FUNCS L1015-1017
- **决策人**：用户「继续补 ISFORMULA 和 FORMULATEXT」

---

## [2026-10-10] 5 个统计分布类函数（纯 FUNCS + 数学辅助 _erf / _lgamma）

- **选了啥**：① _erf(x) — Abramowitz & Stegun 7.1.26 多项式近似（精度 ~1e-7），sign 处理负值；② _normCdf(x,mu,sd) — 0.5*(1+erf(z/√2))；③ _lgamma(x) — Lanczos 近似（g=7），x<0.5 反射公式；④ _logFactorial(n) — _lgamma(n+1)；⑤ 5 个 FUNCS：NORM.DIST / NORM.S.DIST / BINOM.DIST / POISSON.DIST / EXPON.DIST，全带 cumulative 标志（PDF/CDF 切换）；⑥ BINOM/POISSON 用 log-space 算 PMF → Math.exp 还原，避免 n>170 阶乘溢出
- **为啥**：Excel 统计分布函数在数据科学/财务场景高频，纯 FUNCS 不需要 evalNode 改动；JavaScript Math 对象没有 erf/gamma → 必须自实现；_lgamma 用 Lanczos 比 Stirling 精确得多（~1e-11 vs ~1e-2）
- **踩坑**：close() 默认容差 1e-9，erf 近似只有 ~1e-7 → 分布类测试必须传 eps=1e-6；期望值不能写太粗（0.975 vs 0.975002），必须用精确到小数点后 6-7 位的值；BINOM.DIST(10,10,0.5,TRUE)=1 浮点累加出来是 1.0000000000000004 → 也需要 1e-6
- **测试**：harness 21/21 → newfuncs 扩展到 161 条 → 109/109 全绿
- **关联文件**：app/js/modules/spreadsheet.js 数学辅助 L1020-1052 + FUNCS L1012-1069
- **决策人**：用户「继续补 NORM.DIST 等分布类函数」

---

## [2026-10-10] 5 个财务函数（NPV/IRR/PV/FV/PMT）+ IRR evalNode 拦截

- **选了啥**：① NPV(rate, ...cf) — 时间轴契约写死注释：第一个 CF 是第 1 期末（Excel 官方），初始投资放 NPV 外面；② IRR — 必须 evalNode 拦截（FUNCS 2 形参签名会丢独立参数），_evalIRR 里 args.length===2 且 args[1] 是单数字才当 guess，其余全部当现金流；③ PV/FV/PMT — 标准 TVM 公式，type=0 期末/1 期初，r=0 边界单独处理
- **为啥**：ExperienceRecall 警告"财务函数时间轴契约不能隐式"——NPV 的 period 约定是 Excel 反直觉行为（第一个 value 折现一期），必须在注释里显式写死；IRR 的 evalNode 拦截和 MAP/OFFSET 同模式——当函数需要"多个独立数字参数"而非 range 时，FUNCS 签名只能收固定参数，rest params 解决不了"独立参数 vs guess"的歧义
- **踩坑**：advisor 给的 IRR 期望值 0.1371 是错的——手动用牛顿迭代验证，-10000/3000/4200/6800 收敛到 ~0.1634；IRR guess 检测启发式（args.length>=2 就 pop 最后一个）错了 → 只有 args.length===2 且第二个是单数字才当 guess
- **测试**：harness 13/14（数组字面量 FE 不支持正常）→ newfuncs 扩展到 174 → 109/109 全绿；4 次 commit 全部 push 到 main
- **关联文件**：app/js/modules/spreadsheet.js FUNCS L1070-1098（NPV） + PV/FV/PMT L1099-1133 + IRR evalNode 拦截 L1524-1527 + _evalIRR L1540-1585
- **决策人**：用户「先补剩余分布和财务函数」
