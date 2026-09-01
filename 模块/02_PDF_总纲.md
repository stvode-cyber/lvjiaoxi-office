# 模块 02 · PDF 总纲

> 模块级总纲：只负责「模块目的 / 包含子文件 / 当前状态 / 与其他模块关系」。
> 具体实现细节下沉到子文件（本轮仅规划，见 §二）。

## 一、模块目的

PDF 全链路能力：**阅读 / 合并拆分 / 批注 / 签名 / 文本层 / 表单 / 转换**。
Web 真源位于 `app/js/modules/{pdf,pdf-anno,pdf-text,pdf-convert}.js`，本地优先、离线可用。

## 二、包含子文件

| 子文件 | 内容 | 状态 |
|--------|------|------|
| `reading.md` | pdf.js 离线渲染阅读器、覆盖层、页面导航 | ✅ 已实现 |
| `merge-split.md` | 零依赖字节级合并/拆分（PDF 1.4 内联对象；不支持 object/xref stream） | ✅ 已实现 |
| `annotate.md` | 高亮/画笔/文字/矩形/签名/自由文本/图章/链接/表单；`data.annotations` 持久化、JSON 侧车、扁平化、图层、搜索过滤、审阅清单、AP 位图/矢量解析、导入(FDF/XFDF) | ✅ 已实现 |
| `text-layer.md` | 文本层覆盖（可选中/复制）+ 全文搜索高亮（`OS.PdfText` 纯逻辑可单测） | ✅ 已实现 |
| `form.md` | 文本框拖拽绘制可编辑、复选框勾选；参与导出带批注 PDF 扁平化 | ✅ 已实现 |
| `convert.md` | PDF→DOCX / TXT / MD 文本提取（版面还原有限）；PDF→Excel(CSV) 文本提取（坐标列聚类）；docx→PDF（print-to-PDF 落地） | ✅ 已实现（版面还原有限） |

## 三、当前状态

| 子能力 | 状态 | 说明 |
|--------|------|------|
| 阅读（pdf.js 离线渲染） | ✅ 已实现 | 离线渲染、覆盖层 |
| 合并/拆分 | ✅ 已实现 | 零依赖字节级；仅支持 PDF 1.4 风格内联对象，不支持 object stream / xref stream |
| 批注 | ✅ 已实现 | 类型齐全（highlight/pen/note/rect/sign/freetext/stamp/link/textfield/checkbox）+ 图层分组 + 可见性 + RGBA 叠加合成；`data.annotations` 持久化、JSON 侧车、可扁平化 |
| 批注导入/反向读回 | ✅ 已实现 | 外部 JSON/FDF/XFDF 自动归一化坐标注入；支持 FreeText/Stamp(含图片盖章)/Link/表单/签名子类型；坏数据容错 |
| 批注 AP 资源流解析 | ✅ 已实现 | 位图（FlateDecode→PNG / DCTDecode→JPEG）+ 矢量（内容流路径/曲线/填充/描边/CTM）；`image`/`vector` 字段 round-trip |
| 批注搜索与过滤 | ✅ 已实现 | `OS.PdfAnnoFilter` 文本搜索 + 按类型/图层/页码/可见性复合过滤，面板实时联动 |
| 批注审阅清单导出 | ✅ 已实现 | `OS.PdfAnnoSummary` 导出 Markdown / CSV 审阅清单 |
| 批注图层可见性 | ✅ 已实现 | `renderAnnotations` 跳过 `visible===false`；整图层显隐切换 |
| 文本层 / 搜索 | ✅ 已实现 | 覆盖层可选中/复制 + 全文搜索高亮（`OS.PdfText`） |
| 表单填写 | ✅ 已实现 | 文本框/复选框绘制，持久化并参与扁平化 |
| PDF→DOCX 文本提取 | ✅ 已实现（版面还原有限） | 坐标聚类成行、大字号判标题、跨页分页，复用 `OS.Exporter.buildDocx` |
| PDF→TXT / Markdown | ✅ 已实现（版面还原有限） | `OS.PdfConvert.pdfToText` / `pdfToMarkdown` |
| PDF→Excel(CSV) | ✅ 已实现（版面还原有限） | 坐标列边界聚类 + 多表块隔离，Excel 可直接打开 |
| docx→PDF | ✅ 已落地（print-to-PDF） | 浏览器打印分页样式表 + `window.print()` |
| PDF 文档属性解析 | ✅ 已实现（已并入 DocInfo） | 原 `OS.PdfProps` 仅扫描 Info 字典；现由 AL 的 `OS.PdfDocInfo` 全面取代（Info + XMP + 更强中文解码），`pdf-props.js` 仍保留并单测，按钮已指向 DocInfo |
| 批注批量操作 | ✅ 已实现 | `OS.PdfAnnoBatch` 批量删除/改色/归层/显隐，作用于筛选结果 |
| PDF 文档对比（Diff） | ✅ 已实现 | `OS.PdfDiff` 基于 LCS 的行级/词级差异 + 摘要；弹窗粘贴另一版本 → 增(+绿)/删(-红)/未变彩色报告，支持忽略空白与大小写 |
| PDF 书签目录（Outline） | ✅ 已实现 | `OS.PdfOutline` 从原始字节还原书签树（页对象号→页码映射、`/Outlines`+`/First`+`/Next` 递归、`/Dest` 与 `/A GoTo` 页码、UTF-16BE 标题）；弹窗点击条目跳页 + 搜索过滤 + 导出 Markdown 目录 |
| PDF 附件提取（EmbeddedFiles） | ✅ 已实现 | `OS.PdfAttachments` 解析 `/Names /EmbeddedFiles` 名称树（平铺 `/Names` + 递归 `/Kids`），Filespec→/EF→/F|/UF 定位文件流、识别 `/Filter /FlateDecode` 并解压（Node zlib 兜底 / 浏览器走 `getAttachments`）；面板列出并逐条下载 + 导出清单(MD)，支持 UTF-16BE 中文文件名；_pdf_attachments_test 28 断言 |
| PDF 页码标签（PageLabels） | ✅ 已实现 | `OS.PdfPageLabels` 解析 `/PageLabels` 数字树（间接引用 `N 0 R` 与内联 `<<>>`），叶子字典 `/S`(R/r/A/a/D) `/P`(字面串或 UTF-16BE 十六进制，含 FEFF BOM 剥离) `/St`；`buildLabels` 生成每页标签、`toRoman`/`toBijectiveAlpha` 转换、`labelToPage`/`pageToLabel` 互查；面板列出「第 N 页 — 标签」并点击/按标签跳转 + 导出清单(MD)；_pdf_pagelabels_test 32 断言 |
| PDF 批注统计面板（AE） | ✅ 已实现 | `OS.PdfAnnoStats` 七维聚合（byType/byAuthor/byColor/byDate/byMonth/byPage/byLayer）+ 可见隐藏计数 + 文本量(textTotal/avg) + 时间跨度 + busiestPage/topAuthor；`rank` 排序占比（count 降序、同值键自然序）、`dateKey` 兼容毫秒/秒时间戳/ISO 串/Date；面板占比条形图（颜色维度用批注真实色着色）+ 导出统计(MD/CSV)；_pdf_anno_stats_test 67 断言 |
| PDF 文档结构树（StructTreeRoot） | ✅ 已实现 | `OS.PdfStructTree` 解析 `/StructTreeRoot`：沿 `/K` 数组递归 StructElem（`/S` 语义类型、`/T` 标题字面串或 UTF-16BE 十六进制、`/Pg` 关联页、`/K` 子结构嵌套；MCID/MCR 叶子不展开）；`flattenStruct`/`toMarkdown`/`toHtml`(data-page 跳页)/`searchStruct`；面板分级结构 + 搜索 + 跳页 + 导出 MD；_pdf_structtree_test 28 断言 |
| PDF 批注时间线（AnnoTimeline） | ✅ 已实现 | `OS.PdfAnnoTimeline` 按创建时间升序排序 + 按天分组（`dateKey` 兼容毫秒/秒时间戳/ISO 串/Date）；`buildTimeline` 返回 {entries(天→条目),flat,total,spanStart,spanEnd}、`summarize` 派生 total/days/perType/topAuthor/起止；`toMarkdown`/`toHtml`(data-page 跳页) 导出；面板时间线流 + 点击跳页 + 导出 MD；_pdf_anno_timeline_test 34 断言 |
| PDF 链接/URI 提取（Links） | ✅ 已实现 | `OS.PdfLinks` 从原始字节提取外部 URI 链接与内部跳转（GoTo）：来源含页面标注（/Subtype /Link + /P 页对象号）、文档大纲（Outline /Title + /A /URI）、独立 /URI action 兜底；兼容字面串与 UTF-16BE 十六进制串（<FEFF...>）解码；按 kind+target 去重，统计外链/跳转数、涉及页、http(s) 外链数；面板来源徽标 + 页码 + 可点击外链 + 导出 MD；_pdf_links_test 27 断言 |
| PDF 加密与权限检测（Encryption） | ✅ 已实现 | `OS.PdfEncrypt` 解析 /Encrypt 字典（/Filter/V/R/Length/P/O/U/EncryptMetadata/CFM/StmF/StrF，含 /CF 嵌套字典平衡切分）；解码 /P 权限位八项可读清单、判定算法族(RC4-40/RC4/AES-128/AES-256)与强度；纯解析不解密；面板算法/强度/密钥长度/权限✅❌ + 导出 MD；_pdf_encrypt_test 43 断言 |
| PDF 数字签名验证（Signature） | ✅ 已实现 | `OS.PdfSignature` 扫描 /Type /Sig 签名值对象及 /FT /Sig、/Subtype /Sig 签名域：提取 /Name·/Reason·/Location·/M·/ContactInfo·/SubFilter(PKCS#7·CAdES·X.509)·/Filter·/Contents(原始 CMS/PKCS7 容器字节)·/Cert·/Reference(→/DocMDP·/UR·/FieldMDP)，由 /SubFilter 推断摘要算法提示；字面串字节级解码兼容 UTF-16BE/UTF-8/Latin-1（中文签名者名正确还原）；纯元数据提取不验证真实性；面板逐项 + 导出 MD；_pdf_signature_test 25 断言 |
| PDF 表单字段提取（FormFields） | ✅ 已实现 | `OS.PdfFormFields` 解析 /AcroForm → /Fields（含 /Kids 递归）：字段名/类型(文本框·复选·单选·下拉·列表·签名域)/当前值/默认值/选项/只读·必填等标志位/所在页；兼容 UTF-16BE/UTF-8 中文名值；面板浏览 + 导出清单(MD)；_pdf_formfields_test 34 断言 |
| PDF 文档信息/元数据提取（DocInfo） | ✅ 已实现 | `OS.PdfDocInfo` 解析 /Info 字典（标题/作者/主题/关键词/创建者/生产者/创建时间/修改时间，兼容 UTF-16BE·UTF-8·Latin-1 字面值）+ /Metadata XMP 流（pdf:Title/dc:creator/dc:description/xmp:CreateDate/xmp:ModifyDate/xmp:CreatorTool/pdf:Producer/pdf:Keywords/xmpMM:DocumentID，兼容元素形式与属性形式）；PDF 日期串 D:YYYYMMDD…→可读；面板浏览(Info+XMP) + 导出报告(MD)；取代旧 OS.PdfProps「文档属性」按钮（更全面、中文解码更强）；_pdf_docinfo_test 33 断言 |
| PDF 页面属性/页面树信息提取（PageInfo） | ✅ 已实现 | `OS.PdfPageInfo` 解析页面树（/Pages → /Kids 递归，支持嵌套 /Pages 与间接 MediaBox 引用）：逐页提取 MediaBox/CropBox/Rotate/资源（字体·图像·XObject 计数，图像含间接引用解析）；识别标准纸张(A4/Letter/…)、有效方向(旋转90/270翻转)、旋转角；派生摘要（尺寸分布·一致性·主流纸张·方向·旋转分布）；面板浏览逐页属性(点击跳页) + 导出报告(MD)；_pdf_pageinfo_test 50 断言 |
| PDF 字体信息提取（Fonts） | ✅ 已实现 | `OS.PdfFonts` 遍历页面树收集每页 /Resources /Font（页面缺失时沿 /Parent 链继承）：逐字体解析 BaseFont（含 ABCDEF+ 子集前缀剥离）/ Subtype(Type0·Type1·TrueType·MMType1·Type3·CIDFontType0/2)/ Encoding(预定义名·引用 BaseEncoding·Differences)/ ToUnicode/ 嵌入标志(FontFile·FontFile2·FontFile3，Type0 经 /DescendantFonts 下钻 CIDFont 的 FontDescriptor；Type3 视为已嵌入)/ Flags 九位(字体字典优先、FontDescriptor 兜底)/ 字符范围与宽度表；按对象去重合并使用页；派生摘要(类型分布·嵌入·子集·标准14·ToUnicode·**未嵌入且非标准14 的风险字体清单**)；面板浏览(风险红条) + 导出报告(MD)；_pdf_fonts_test 74 断言 |

## 四、与其他模块关系

- **下游 → 格式兼容（03）**：导出带批注 DOCX 复用 `OS.Exporter.buildDocx`；PDF→DOCX 是 PDF⇄Office 转换的一环。
- **上游 ← 文档编辑（01）**：Presentation/Writer 可导出 PDF；批注/表单持久化于文档 `data`。
- **上游 ← 账户云端（04）**：PDF 文档经统一账号备档/同步。
- **被 测试质量（08）** 覆盖（批注模型 31、光栅 14、签名 17、文本索引 28、表单 24、PDF 文本提取 19、PDF 文本转换 19、PDF→Excel 文本/聚类/多表块 18/15/15、AP 位图 15、AP 矢量 28、图层+RGBA 25、范围预设 18、搜索过滤 23、审阅清单 16、文档属性 15、图层可见性 7、批量操作 19、文档对比 40、书签目录 29、附件提取 28、页码标签 32、批注统计 67、文档结构树 28、批注时间线 34、表单字段 34、文档信息 33、页面属性 50、字体信息 74 等，整链 85 套件 0 失败）。

## 五、具体内容入口

详见 §二 子文件（待建）。PDF⇄Office 转换属大型能力，建议走 `讨论与处理/` 排期后再回写。
