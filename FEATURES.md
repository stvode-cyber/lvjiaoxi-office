# 绿角犀 Office · 功能清单与完成度

> 本文按 **已实现 / 部分实现 / 规划中** 三档标注，避免对外夸大承诺。
> 标注依据：`app/` 代码回查 + 测试覆盖（88 套件全绿，含云后端 25 断言 + 前端同步 16 断言 + AI 代理 12 断言 + 统一账号回归 + PDF 批注模型 31 断言 + PDF 光栅写入器 14 断言 + PDF 签名 17 断言 + PDF 文本索引 28 断言 + PDF 表单字段 24 断言 + OOXML 导入图片往返 14 断言 + PDF 文本提取 19 断言 + PDF 文本转换(TXT/MD) 19 断言 + PDF→Excel(CSV) 文本提取 18 断言 + PDF→Excel 坐标聚类 15 断言 + PDF→Excel 多表块隔离 15 断言 + MindMap 导出(docx/md/ofd) 16 断言 + PDF 注释导入 14 断言 + PDF 注释导入坐标归一化 15 断言 + PDF 注释 FDF/XFDF 导入 26 断言 + PDF 注释 FDF 扩展(多笔迹/quadPoints) 14 断言 + PDF 注释导入扩展(FreeText/Stamp/Link+图片盖章) 20 断言 + Writer 直接下载 PDF(光栅→PDF) 19 断言 + Presentation 直接下载 PDF(光栅→PDF) 10 断言 + Spreadsheet 直接下载 PDF(光栅→PDF) 18 断言 + PDF 注释导出 JSON round-trip 闭环 50 断言 + PDF 注释 AP 内嵌图像解析 15 断言 + 表格/演示 PDF 导出范围选项 32 断言 + PDF 注释 AP 矢量外观解析 28 断言 + 批注图层分组 + RGBA 叠加合成 25 断言 + PDF 导出范围预设 18 断言 + 批注搜索与过滤 23 断言 + 批注审阅清单导出(MD/CSV) 16 断言 + PDF 文档属性解析 15 断言 + 批注图层可见性 7 断言 + 批注批量操作 19 断言 + PDF 文档对比(文本 Diff) 40 断言 + PDF 书签目录(Outline) 29 断言 + PDF 附件提取 28 断言 + PDF 页码标签 32 断言 + PDF 批注统计面板 67 断言 + PDF 文档结构树 28 断言 + PDF 批注时间线 34 断言 + PDF 链接/URI 提取 27 断言 + PDF 加密与权限检测 43 断言 + PDF 数字签名验证 25 断言 + PDF 表单字段提取 34 断言 + PDF 文档信息/元数据提取 33 断言 + PDF 页面属性/页面树信息提取 50 断言 + PDF 字体信息提取 74 断言 + PDF 动作/JavaScript 安全审计 37 断言 + PDF 合并/拆分回归 + PDF 1.5+ 对象流(ObjStm)解析扩展）。
> 架构：零构建经典脚本 SPA，全局 `OS.*` 命名空间，本地优先、离线可用。

## 一、文档模块

| 模块 | 状态 | 说明 |
|---|---|---|
| **Writer 文字** | ✅ 已实现 | 流式排版、样式/大纲、批注评论、查找替换、页面设置；导出 DOCX / HTML / TXT / PDF（含独立「导出」功能区：①「导出 PDF」走浏览器 print-to-PDF；②**「下载 PDF 文件」**零依赖光栅化分页 DOM（含页眉页脚/页码）→ `OS.PdfTool.writeImagePdf` → 直接下载 .pdf，免打印对话框） |
| **Spreadsheet 表格** | ✅ 已实现 | 公式引擎、冻结窗格、图表、条件格式、排序/筛选、数据验证；导出 XLSX / CSV / HTML / JSON / **PDF（直接下载：活动表按行分页光栅化 → `OS.PdfTool.writeImagePdf` → 免打印对话框，支持「行区间范围」「选工作表」「范围预设下拉（全部工作表/当前工作表）」导出，多工作表可一次成册）** |
| **Presentation 演示** | ✅ 已实现 | 母版、过渡/动画、分页；导出 PPTX / **PDF（直接下载：逐页幻灯片光栅化 → `OS.PdfTool.writeImagePdf` → 免打印对话框，支持「页码范围」「范围预设下拉（全部页/奇数页/偶数页/当前页）」导出）** |
| **PDF** | 🟡 部分实现 | **阅读**（pdf.js 离线渲染）+ **合并/拆分**（零依赖字节级，支持 PDF 1.4 内联对象 + PDF 1.5+ 对象流(/ObjStm，FlateDecode 压缩)经解析展开）+ **批注**（高亮/画笔/文字批注/矩形/签名印章，随文档 `data.annotations` 持久化、可导出 JSON 侧车、**可扁平化为带批注 PDF**）**已实现** + **文本层/搜索**（覆盖层可选中/复制 + 全文搜索高亮）**已实现** + **表单填写**（文本框拖拽绘制可编辑文字、复选框点击放置可勾选，随文档 `data.annotations` 持久化、**参与导出带批注 PDF 扁平化**）**已实现** + **PDF→DOCX 文本提取**（按归一化坐标聚类成行、大字号判 `<h2>` 标题、跨页分页，复用 `OS.Exporter.buildDocx` 生成可编辑 DOCX）**已实现，版面还原有限** + **PDF→Excel(CSV) 文本提取**（基于逐项 x 坐标的列边界聚类，跨表行自动对齐、段落型行降级单格、Excel 可直接打开）**已实现** + **PDF 注释导入/反向读回**（工具栏「导入批注」按钮读取外部 JSON/FDF/XFDF，自动归一化坐标并注入当前文档 `data.annotations`，支持 type 别名/quadPoints/颜色数组/文本映射，坏数据容错跳过）**已实现** + **批注导出 JSON round-trip 闭环**（`exportToRaw`/`exportJSON` 与 `importFromRaw` 互逆，全类型无损）+ **批注导入解析 PDF 内嵌 AP 资源流**（读取 `/AP` 外观字典引用的图像 XObject，解码 FlateDecode→PNG / DCTDecode→JPEG，提取图章/签名真实图像注入 `image` 字段）**已实现**；**子类型已扩展为 FreeText(自由文本框) / Stamp(图章，含图片盖章 image 反向读回) / Link(链接 URI) / 表单 textfield/checkbox / sign / highlight/pen/rect/note**，覆盖常见批注形态；**PDF 注释 AP 矢量外观解析**（解释 Form XObject 内容流中的矢量绘制命令——路径/曲线/填充/描边/CTM 变换，还原矢量图章/签名外观，与 AP 位图解析互补，存入 `vector` 字段并 `exportToRaw`/`importFromRaw` 闭环）**已实现**；**批注图层分组**（add 支持 layer/visible 字段，stats 增加 byLayer/visibleCount，新增 groupByLayer/setLayer/setVisible；RGBA 叠加合成原语 `OS.RgbaComposite` 提供 over 算子与 flattenPageWithOverlays）**已实现**；**PDF 导出范围预设**（纯模块 `OS.RangePreset` 提供 parsePageList/resolvePreset/resolvePagePreset/resolveSheetPreset/createStore，表格/演示 PDF 导出新增「范围预设」下拉复用）**已实现**；**批注搜索与过滤**（纯模块 `OS.PdfAnnoFilter`：文本搜索 + 按类型/图层/页码/可见性复合过滤，批注面板「搜索与过滤」组实时联动渲染）**已实现**；**批注审阅清单导出**（纯模块 `OS.PdfAnnoSummary`：`toMarkdown`/`toCsv`/`summarizeByPage`，一键导出 MD/CSV 审阅清单，便于归档协同）**已实现**；**PDF 文档属性解析**（纯模块 `OS.PdfProps`：扫描 Info 字典提取标题/作者/主题/创建者/生产者/创建·修改时间，批注面板「文档属性」弹窗）**已实现**；**批注图层可见性切换**（基于 T 的 layer/visible 模型：`renderAnnotations` 跳过 `visible===false`，面板「切换选中图层 / 全部显示」按钮控制整图层显隐）**已实现**；**批注批量操作**（纯模块 `OS.PdfAnnoBatch`：`bulkDelete`/`bulkSetColor`/`bulkSetLayer`/`bulkSetVisible`/`bulkSetAuthor`/`currentScope`，作用于「搜索与过滤」当前筛选结果，面板「批量操作」组支持删除/归层/改色/显隐筛选结果）**已实现**；**PDF 文档对比（文本层 Diff）**（纯模块 `OS.PdfDiff`：基于 LCS 最长公共子序列的 `diffLines` 行级差异 / `diffWords` 词级差异 / `summarize` 摘要统计 / `diffDocs` 文档级入口，支持忽略空白与忽略大小写，批注面板「文档对比」弹窗粘贴另一版本文本后生成「新增(+绿) / 删除(-红) / 未变」彩色对照报告与增·删·未变占比）**已实现**；**PDF 书签目录（Outline / TOC）**（纯模块 `OS.PdfOutline`：`parseRawOutline` 直接扫描 PDF 原始字节还原书签树——扫描 `N 0 obj…endobj` 建立「页对象号→页码」映射、定位 `/Type /Outlines` 后沿 `/First` 子节点与 `/Next` 同级链递归重建层级，页码取自 `/Dest [N 0 R…]` 或 `/A <</S /GoTo /D [N 0 R…]>>`，标题支持字面串/十六进制串含 UTF-16BE(BOM FEFF) 解码；另提供 `normalizeOutline` 归一化 pdf.js `getOutline()` 结果、`flattenOutline` 扁平化带层级、`toMarkdown`/`toHtml` 导出、`searchOutline` 保留祖先链搜索；批注面板「书签目录」弹窗支持点击条目跳转对应页、标题搜索过滤、一键导出 Markdown 目录）**已实现**；**docx→PDF 已落地**（浏览器 print-to-PDF：Writer 导出菜单列「PDF（打印）」、后台「打印」复用打印分页样式表 + `window.print()`，含页眉页脚与逐页页码，见 `docx-to-pdf-策略.md`）；**PDF 动作/JavaScript 安全审计**（纯模块 `OS.PdfActions`：解析 /OpenAction(引用/内联/目标数组) + /AA 附加动作(Catalog/页面/批注，事件 O/E/X/Po/PC/WP/WC/DS/DC…) + /A 动作引用 + /Names JavaScript 名称树 + 全文档动作对象(JavaScript/Launch/SubmitForm/ImportData/GoToR/E/URI/Named)，/JS 片段字节级解码(字面串转义+八进制/十六进制，UTF-16BE→UTF-8→Latin-1)，Launch/SubmitForm/ImportData 目标提取，风险分级 高/中/低/info + 自动执行判定，批注面板「安全审计」弹窗风险降序 + 跳页 + 导出审计报告 MD）**已实现** |
| **MindMap 脑图** | ✅ 已实现 | 节点编辑 / 大纲式梳理；导出 JSON / SVG / PNG / Markdown / DOCX / OFD |

## 二、格式兼容（导入 / 导出）

| 能力 | 状态 | 说明 |
|---|---|---|
| **OOXML 导出** | ✅ 已实现 | DOCX / XLSX / PPTX 由 `OS.Exporter` 原生生成（JSZip 打包规范 XML），非 HTML 包装；**DOCX 现含图片嵌入**（Writer 插入的图片为 base64 内联，导出真实落到 `word/media/*` + `wp:inline/pic:pic` drawing run + 关系 + 内容类型），不再静默丢弃 |
| **OOXML 导入（往返）** | ✅ 已实现 | `OS.Importer` 解析 docx / xlsx / pptx，可再编辑；兼容等级见 `OS.COMPAT`（A 完全 / B 基本 / C 只读）；**DOCX 现可往返图片**（导出带图 DOCX → 导入读回 `<img data:...>`，图片不丢，外部链接图片优雅跳过） |
| **ODF 导入** | ✅ 已实现 | odt / ods / odp |
| **OFD 导出** | ✅ 已实现 | writer / presentation → OFD（GB/T 33190 国标版式） |
| **OFD 导入** | ✅ 已实现 | `parseOfd` 已支持 |
| **PDF⇄Office 转换** | 🟡 部分实现 | **PDF→DOCX/TXT/MD 文本提取已实现**（纯文本层提取、按坐标聚类成行、大字号判标题，版面还原有限）；**PDF→Excel(CSV) 文本提取已实现**（基于逐项 x 坐标的列边界聚类，跨表行对齐、段落型行降级单格）；**PDF 注释导入/反向读回已实现**（外部 JSON/FDF/XFDF→内部模型，含 FDF/XFDF 文本解析层 `parseFdfText`/`parseXfdfText`，支持 FreeText/Stamp(含图片盖章 image)/Link/表单/签名等子类型与坐标归一化、坏数据容错跳过）；**docx→PDF 已落地**（浏览器 print-to-PDF 复用 DOCX 管道，见 `docx-to-pdf-策略.md`） |
| **多格式打开** | ✅ 已实现 | .pdf / .html / .txt / .csv / .md / .ofd 等 |
| **PDF 附件提取** | ✅ 已实现 | 从 PDF `/Names /EmbeddedFiles` 名称树（平铺 `/Names` 与递归 `/Kids` 两种形态）解析内嵌文件，沿 Filespec→/EF→/F|/UF 定位文件流，自动解压 `/Filter /FlateDecode`（Node zlib 兜底，浏览器走 pdf.js `getAttachments`）；面板列出附件并支持逐条下载 / 导出附件清单(MD)，支持 UTF-16BE 中文文件名解码 |
| **PDF 页码标签** | ✅ 已实现 | 解析 PDF `/PageLabels` 数字树（间接引用 `N 0 R` 与内联 `<<>>` 两种形态），生成每页人类可读标签（十进制 / 大写罗马 R / 小写罗马 r / 大写字母 A / 小写字母 a），支持前缀 P（字面串或 UTF-16BE 十六进制，含 FEFF BOM 剥离）与起始值 St；面板列出「第 N 页 — 标签」、点击或按标签跳转、导出清单(MD)；`OS.PdfPageLabels.parseRawPageLabels`/`buildLabels`/`labelToPage`/`pageToLabel`；_pdf_pagelabels_test 32 断言 |
| **PDF 批注统计面板** | ✅ 已实现 | 按类型 / 作者 / 颜色 / 日期 / 月份 / 页面 / 图层七维聚合当前文档批注，给出文本总量与均值、时间跨度、批注最多页、最活跃作者；弹窗以占比条形图呈现（颜色维度用批注真实色着色），可导出统计报告（Markdown / CSV）；`OS.PdfAnnoStats.aggregate`/`rank`/`toMarkdown`/`toCsv`；_pdf_anno_stats_test 67 断言 |
| **PDF 表单字段提取** | ✅ 已实现 | 从 /AcroForm → /Fields（含 /Kids 递归）解析表单字段：名称/类型(文本框·复选·单选·下拉·列表·签名域)/当前值/默认值/选项/只读·必填等标志位/所在页；兼容 UTF-16BE/UTF-8 中文名值；面板浏览 + 导出清单(MD)；`OS.PdfFormFields.parseFormFields`/`summarize`/`toMarkdown`/`toHtml`；_pdf_formfields_test 34 断言 |
| **PDF 文档信息/元数据提取** | ✅ 已实现 | 解析 /Info 字典（标题/作者/主题/关键词/创建者/生产者/创建时间/修改时间，兼容 UTF-16BE·UTF-8·Latin-1 字面值）+ /Metadata XMP 流（pdf:Title/dc:creator/dc:description/xmp:CreateDate/xmp:ModifyDate/xmp:CreatorTool/pdf:Producer/pdf:Keywords/xmpMM:DocumentID，元素形式与属性形式双解析）；PDF 日期串 D:YYYYMMDD…→可读；面板浏览(Info+XMP) + 导出报告(MD)；取代旧「文档属性」按钮（更全面、中文解码更强），`OS.PdfDocInfo.parseDocInfo`/`summarize`/`toMarkdown`/`toHtml`；_pdf_docinfo_test 33 断言 |
| **PDF 页面属性/页面树信息提取** | ✅ 已实现 | 解析 PDF 页面树（/Pages → /Kids 递归，支持嵌套 /Pages 与间接 MediaBox 引用），逐页提取 MediaBox/CropBox/Rotate/资源（字体·图像·XObject 计数，图像含间接引用解析）；识别标准纸张尺寸（A4/A3/A5/A2/A1/A0/B4/B5/Letter/Legal/Tabloid…）、有效方向（旋转 90/270 翻转盒方向）、旋转角；派生文档级摘要（纸张尺寸分布·尺寸一致性·主流纸张·方向分布·旋转分布）；面板浏览逐页属性（点击跳页）+ 导出报告(MD)；`OS.PdfPageInfo.parsePageTree`/`summarize`/`toMarkdown`/`toHtml`；_pdf_pageinfo_test 50 断言 |
| **PDF 字体信息提取** | ✅ 已实现 | 遍历页面树收集每页 `/Resources /Font`（页面自身缺失时沿 /Parent 链向上继承），逐字体解析 BaseFont（含 `ABCDEF+` 子集前缀剥离）/ Subtype（Type0·Type1·TrueType·MMType1·Type3·CIDFontType0/2）/ Encoding（预定义名·引用取 BaseEncoding·Differences 自定义）/ ToUnicode 映射 / 嵌入标志（FontFile·FontFile2·FontFile3，**Type0 经 /DescendantFonts 下钻 CIDFont 的 FontDescriptor**；Type3 字形由内容流过程定义视为已嵌入）/ Flags 九位（等宽·衬线·符号·手写·非符号·斜体·全大写·小型大写·强制加粗，字体字典优先、FontDescriptor 兜底）/ 字符范围与宽度表；按字体对象去重并合并使用页；派生摘要（类型分布·已嵌入/未嵌入·子集数·标准 14 数·含 ToUnicode 数·**未嵌入且非标准 14 的风险字体清单**）；面板浏览（风险红条提示）+ 导出报告(MD)；`OS.PdfFonts.parseFonts`/`summarize`/`toMarkdown`/`toHtml`；_pdf_fonts_test 74 断言 |
| **PDF 文档结构树** | ✅ 已实现 | 从 PDF `/StructTreeRoot` 解析 tagged PDF 逻辑结构树（沿 `/K` 数组递归 StructElem：`/S` 语义类型 H1/P/Table、`/T` 标题字面串或 UTF-16BE 十六进制、`/Pg` 关联页码、`/K` 子结构可嵌套，MCID/MCR 叶子不展开）；面板分级展示结构 + 搜索（标题/类型）+ 点击跳页 + 导出结构(MD)；`OS.PdfStructTree.parseRawStructTree`/`flattenStruct`/`toMarkdown`/`toHtml`/`searchStruct`；_pdf_structtree_test 28 断言 |
| **PDF 批注时间线** | ✅ 已实现 | 按创建时间升序排列批注并**按天分组**展示时间线流（时间值兼容毫秒时间戳 / 秒时间戳 / ISO 串 / Date 对象）；给出总数·天数·最活跃作者·时间跨度；面板时间线流 + 点击条目跳转到对应页 + 导出时间线(MD)；`OS.PdfAnnoTimeline.buildTimeline`/`summarize`/`toMarkdown`/`toHtml`；_pdf_anno_timeline_test 34 断言 |
| **PDF 链接/URI 提取（外链审计）** | ✅ 已实现 | 从 PDF 原始字节提取所有外部 URI 链接与内部跳转（GoTo），用于外链审计；来源覆盖页面标注（/Subtype /Link，带 /P 页对象号）、文档大纲（Outline /Title + /A /URI）、独立 /URI action 兜底；兼容字面串 (/URI (...)) 与 UTF-16BE 十六进制串 (/URI <FEFF...>) 解码；按 kind+target 去重，给出外链/跳转计数、涉及页、http(s) 外链数；面板列出来源徽标 + 页码 + 链接（外链可点击）+ 导出报告(MD)；`OS.PdfLinks.extractLinks`/`summarize`/`toMarkdown`/`toHtml`；_pdf_links_test 27 断言 |
| **PDF 数字签名验证** | ✅ 已实现 | 从 PDF 原始字节扫描所有签名对象（/Type /Sig 签名值对象，及 /FT /Sig、/Subtype /Sig 签名域），提取签名者/Name·原因/Reason·地点/Location·时间/M·联系/ContactInfo·子过滤器/SubFilter(PKCS#7·CAdES·X.509)·过滤器/Filter·原始 CMS/PKCS7 容器字节(/Contents)·证书引用(/Cert)·引用类型(/Reference→/DocMDP·/UR·/FieldMDP)；由 /SubFilter 推断摘要算法提示(SHA256/SHA1)。字面串按字节解析兼容 UTF-16BE/UTF-8/Latin-1（正确解码中文签名者名）。**纯元数据提取，不验证签名真实性**；面板列出每项 + 导出验证报告(MD)；`OS.PdfSignature.parseSignatures`/`summarize`/`toMarkdown`/`toHtml`；_pdf_signature_test 25 断言 |
| **PDF 加密与权限检测** | ✅ 已实现 | 从 PDF 原始字节解析 trailer/root 引用的 /Encrypt 字典：/Filter(→/Standard)/V/R/Length/P/O/U/EncryptMetadata/CFM/StmF/StrF（含 /CF 嵌套字典平衡切分）；解码 /P 权限位为可读清单（打印/修改/复制/批注/填表/提取无障碍/组装/高分辨率打印），判定算法族（RC4-40/RC4/AES-128/AES-256）与强度；纯解析不解密，标记「打开需密码（用户或所有者）」；面板列出算法/强度/密钥长度/权限✅❌ + 导出报告(MD)；`OS.PdfEncrypt.parseEncryption`/`decodePermissions`/`summarize`/`toMarkdown`/`toHtml`；_pdf_encrypt_test 43 断言 |

> 说明：原生 OOXML/OFD 导出与往返导入**已完整打通**，属本项目真实能力，可对外承诺。格式类能力中 **PDF⇄Office 转换** 的 PDF→Excel（坐标列聚类）/ PDF 注释导入（含 FDF/XFDF 解析）/ docx→PDF 均已落地，不再属"未启动"大型项。

## 三、账户 · 个人空间 · 备档（新增子系统）

| 能力 | 状态 | 说明 |
|---|---|---|
| **统一账号（本地+云端同一账号）** | ✅ 已实现 | 同一用户名/密码既是本地离线账户（SHA-256 存 localStorage，永远可登录、离线可用），又是云端账户（服务端 scrypt + HMAC token，50MB 个人云）。登录永远先本地校验，再尽力连云端取 token；云端用户不存在(404)自动用相同密码补注册统一两端，密码不一致/后端不可达则静默降级为纯本地（不报错、不阻断） |
| 云端账户（真实后端） | ✅ 已实现 | 零依赖 Node 服务 `server/index.js` 实现 `/api/auth/*`（scrypt 密码哈希 + HMAC 签名 token；登录区分 404 用户不存在 / 401 密码错误）+ 文档/备档同步 + 50MB 配额；前端 `OS.CloudSync` 登录后双向同步，备档可跨设备恢复 |
| 50 MB 个人空间配额 | ✅ 已实现 | 文档 + 备档计入配额（本地展示 + **服务端强制**），账户抽屉展示进度（>80% 黄、>95% 红） |
| 每 5 分钟自动备档 | ✅ 已实现 | 多版本（每文档保留 20 份），可回滚；空间告急自动清理最旧一半 |
| 记住我（持久会话） | ✅ 已实现 | 勾选后写入 localStorage，下次打开免登录 |
| **登录设定（可选登录）** | ✅ 已实现 | 默认**不强制登录**——启动直接以游客身份进入，离线可用、本地功能完整；登录仅用于启用 50MB 个人云同步。可在「账户与存储」开启「启动时要求登录」切换为强制模式；即便强制，登录页也提供「以游客身份进入」跳过入口。策略判定抽为纯模块 `OS.AuthPolicy.shouldGate()`（容错：无 settings / 异常一律视为不强制），`_auth_policy_test` 7 断言 |
| 空间导出/导入 | ✅ 已实现 | 全部文档 + 备档打包为 `.lvjx`，可迁移/外部备份 |
| **.lvjx 口令加密** | ✅ 已实现 | 导出可选口令（PBKDF2-SHA256 + AES-GCM-256），导入加密文件时提示输入口令 |
| 备档占用分离展示 | ✅ 已实现 | 账户抽屉分别显示「文档占用 / 备档占用」 |
| 后台自动更新 | ✅ 已实现 | **全自动更新模式（v1.0.15）**：启动即检查发布清单，发现新版本后台静默下载（不打断）；桌面端经 electron-updater 走 generic feed（lujax.fun/releases）自动下载，退出时自动安装，或下载完一键「立即重启」；Web/PWA 经 Service Worker 后台接管、刷新即生效；账户抽屉可手动「检查更新」 |

> 安全提示：本地账户密码仅 SHA-256 哈希（非 bcrypt/argon2），**请勿复用重要在线账户密码**（登录页已提示）。

## 四、外壳与通用能力

| 能力 | 状态 |
|---|---|
| 开始页（新建/打开/最近） | ✅ 已实现 |
| 多标签 + 动态功能区 ribbon | ✅ 已实现 |
| 命令面板（Ctrl/Cmd+K） | ✅ 已实现 |
| 主题切换（亮/暗） | ✅ 已实现 |
| 撤销/重做、保存 | ✅ 已实现 |
| AI 引擎（本地离线 + 云端可选） | ✅ 已实现 | 本地离线指令链（总结/润色/改写/扩写/续写/大纲/翻译/解释/审阅）全功能可用；云端走 OpenAI 风格流式——支持「服务端 AI 代理」（自托管时经同源 `/api/ai/chat` 转发，真实 Key 仅存服务器 `LVJX_AI_*`，不下发前端）或自有 endpoint（密钥存本机）。开启「数据不出域」仍优先本地，代理未配置时自动回退本地，绝不静默失败 |

## 五、交付形态

| 平台 | 状态 |
|---|---|
| Windows（exe 安装包 + 便携） | ✅ 已构建 |
| Android（debug + 自签名 release APK） | ✅ 已构建（AAB 待生成） |
| iOS（Xcode 工程） | ⚠️ 源码工程（需 Mac 编译） |
| 华为 HarmonyOS（DevEco 工程） | ⚠️ 源码工程（需 DevEco 编译） |
| PWA（离线可安装） | ✅ 已实现 |
| Windows 文件关联 / 默认打开方式 | ✅ 已实现 |

### Windows 桌面安装包（NSIS）· 文件关联 / 默认打开方式
- 安装包 `绿角犀 Office Setup 1.0.3.exe`（NSIS）安装时**写入注册表**：① 卸载信息 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` ② App Paths 注册（系统可识别 exe）③ **文件类型关联** `HKCU\Software\Classes\<ext>` + progId，使绿角犀出现在各格式的「默认打开方式 / 打开方式」列表并可设为默认。
- 关联格式：**.pdf / .ofd / .lvjx（自家存档）/ .docx / .xlsx / .pptx**。
- 双击关联文件（或命令行携带路径）启动绿角犀时，主进程 `electron/main.js` 经 `process.argv` / `second-instance` / `open-file` 捕获路径 → 读为 base64 → IPC `app:open-file` 推前端 → 前端 `shell.js` 还原为 File 直接打开（复用导入逻辑：pdf→PDF 阅读、docx/xlsx/pptx/ofd→导入、txt/md/csv/html→对应模块）。
- 浏览器 / Web 版不受影响（`electronAPI` 不存在时自动跳过，纯前端逻辑不变）。
- 测试：`_file_args_test.js` 12 项断言覆盖参数提取；全链 **81 套件 0 失败**。

## 六、已知工程事项（见各模块文档）

- 自动备档默认与文档同库（IndexedDB）；**现已可选接入云端账户**（`server/`），清浏览器数据后可从个人云恢复，不必仅靠 `.lvjx` 外部导出。本地账户仍建议定期导出 `.lvjx` 外部备份。
- 云端后端默认签名密钥仅用于本地开发，生产须用 `LVJX_CLOUD_SECRET` 设置强密钥；云端账户与「数据不出域」开关相互独立（AI 仍走本地）。
- 零构建全局 `OS.*` 架构在代码量增长后维护成本上升，已评估向原生 ESM 迁移（暂缓，避免冲击现有回归）。
- 测试为 jsdom 单文件 stub + 真实 HTTP 后端测试，缺完整 E2E；导出/登录/云同步已有集成断言覆盖核心路径。
- PDF 合并/拆分为自研零依赖实现，**仅支持 PDF 1.4 风格、xref 表、内联对象（含 stream）**；不支持 object stream / xref stream（PDF 1.5+ 压缩结构），此类 PDF 会提示「合并/拆分失败」。批注已可用（覆盖层绘制 + 文档内持久化，新增「签名」工具：弹出手写板采集笔画 → 作为印章盖到当前可视页，墨迹随文档持久化并参与「导出带批注 PDF」扁平化）；**阅读器新增文本层（覆盖层可选中/复制）+ 全文搜索高亮**（纯逻辑索引 `OS.PdfText`，不依赖 pdf.js 可单测）；**表单填写已可用**（文本框拖拽绘制可编辑文字、复选框点击放置可勾选，随文档持久化并参与「导出带批注 PDF」扁平化）；**PDF⇄Office 转换** 已部分实现（🟡）：PDF→DOCX/TXT/MD 文本提取已实现（版面还原有限）；PDF→Excel（基于 x 坐标列边界聚类）/ docx→PDF（浏览器 print-to-PDF）均已落地，但版面还原仍有限。
