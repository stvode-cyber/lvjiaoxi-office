# STATUS · 状态总览

> **状态-only 导航**。详细功能完成度见 [FEATURES.md](FEATURES.md)；模块划分与关系见 [工程总纲.md](工程总纲.md) 与各 [模块总纲](模块/)。
> 本文件只汇总「到哪了、卡哪了、去哪看」，不展开实现细节。

---

## 一、模块状态

| 模块 | 总纲 | 整体状态 | 一句话 |
|------|------|----------|--------|
| 01 文档编辑 | [总纲](模块/01_文档编辑_总纲.md) | ✅ 核心已实现 | 五模块 + MindMap 可实跑 |
| 02 PDF | [总纲](模块/02_PDF_总纲.md) | 🟡 部分实现 | 阅读/合并拆分/批注(类型齐全+图层+AP图像/矢量)/表单/文本层/多格式导出/属性解析/书签目录/附件提取 ✅；PDF→Excel/PDF→DOCX 版面还原有限；链接提取（外链审计）✅ |
| 03 格式兼容 | [总纲](模块/03_格式兼容_总纲.md) | ✅ 已实现 | OOXML / ODF / OFD 打通；PDF⇄Office 部分 |
| 04 账户与云端 | [总纲](模块/04_账户与云端_总纲.md) | ✅ 已实现 | 统一账号 / 云端 / 备档 / .lvjx 加密 |
| 05 外壳与通用 | [总纲](模块/05_外壳与通用_总纲.md) | ✅ 已实现 | 开始页 / ribbon / 命令面板 / 主题 / AI；顶部主导航五板块（工作台/订单/库存/审批/我的） |
| 09 业务板块 | —（并入 05 外壳） | ✅ 已实现 | 订单/库存/审批 本地 CRUD（IndexedDB）+ 我的（账户/偏好/关于）+ CSV 导出 + 批量操作（批量删除/审批批量通过·驳回）+ 库存出入库（数量调整 + 流水）+ 订单单条状态流转（下拉 + statusHistory 留痕）+ 订单/审批详情展开（状态流转时间线）+ 库存流水明细（查看/汇总 + 撤销最近一笔）+ 库存流水按时间筛选 + 分页 + 导出 CSV）+ 工作台聚合「库存预警」（低库存/缺货品项，一键跳转库存）+「业务概览」（订单/审批统计卡片，一键跳转）+「成交额趋势」（近 7 日订单成交额 SVG 折线图）+ 审批意见留痕（通过可填意见、驳回必填理由，时间线展示） |
| 06 客户端与交付 | [总纲](模块/06_客户端与交付_总纲.md) | 🟡 部分实现 | Win / Android / PWA ✅；iOS / HarmonyOS ⚠️ 源码工程 |
| 07 发版与更新 | [总纲](模块/07_发版与更新_总纲.md) | ✅ 已实现 | 版本单一真源 / 全自动更新模式(启动检查+后台自动下载+退出自动装，generic feed 已接通 lujax.fun/releases) / 合规素材 |
| 08 测试与质量 | [总纲](模块/08_测试与质量_总纲.md) | ✅ 已实现 | **110 套件 0 失败**；E2E 已补（171 断言） |

---

## 二、关键阻塞 / 大型 / 边界

| 级别 | 项 | 归属 | 说明 |
|------|----|------|------|
| 🟡 边界 | PDF→Excel（版面还原有限：文本+列边界聚类，无像素级表格） | 02 / 03 | 已实现可用，版面还原有限 |
| 🟡 边界 | PDF→DOCX/TXT/MD（版面还原有限） | 02 | 仅文本层 + 标题判别，无图片/表格/多栏 |
| 🟡 边界 | PDF→DOCX 版面还原 | 02 | 纯文本提取，非像素级版面 |
| ⚠️ 人工 | iOS / HarmonyOS 编译与上架 | 06 | 需 Mac / DevEco + 签名证书 + 隐私页 |
| ⚠️ 人工 | 商店合规（Android 自适应图标 / iOS LaunchScreen / PrivacyInfo） | 07 | 素材已生成，上架为人工项 |

---

## 三、基线指标（实跑证据）

- **测试**：`npm test` 整链 **110 套件，0 失败** + 四端同源 ✅。含 AK=PDF 表单字段提取 34 断言、AL=PDF 文档信息/元数据提取 33 断言、AM=PDF 页面属性/页面树信息提取 50 断言、AN=PDF 字体信息提取 74 断言、AP=PDF 动作/JavaScript 安全审计 37 断言、AQ=PDF 结构预检 42 断言、AR=PDF 文档历史 39 断言、业务板块（订单 25 / 库存+审批 30 / 我的 15 / CSV 导出 14 / 批量操作 24 / 库存出入库 24 / 订单状态流转 21 / 详情展开 23 / 库存流水撤销 24 / 库存流水筛选·分页 29 / 库存流水导出 CSV 17 / 低库存聚合查询 9 / 工作台业务概览 14 / 成交额趋势 10 / **审批意见留痕 18** 断言）；_updater_autoupdate_test 11 断言锁定 v1.0.15 自动更新正向链路；**E2E 测试**：_e2e_roundtrip_test 73 断言 + _e2e_scenarios_test 98 断言 = **171 断言**覆盖 DOCX/XLSX/PPTX/OFD 往返 + 批量并发 + 主题/MIME/模板/导出边界/云同步/util。
- **同源**：四端经 `sync-clients` 与 `app/` 一致 ✅。
- **2026-09-01 新增 PDF 1.5+ 对象流(ObjStm)合并/拆分支持**：`parsePdf`/`mergePdfs`/`splitPdf` 改异步（ObjStm 解压依赖 DecompressionStream），并修复 `extractStreamData` 末行 EOL 与 `extractFirstBalancedDict` 末位 `>` 偏移两处解析 bug（后者会让 ObjStm 对象字典丢失末位 `>`，合并真实 1.5+ PDF 时会输出畸形页面字典）；新增 `_pdf_merge_test` 12 断言 + `_pdf_tool_test` 回归全覆盖，整链 87 套件 0 失败。
- **2026-09-02 新增 AP=PDF 动作/JavaScript 安全审计**：`OS.PdfActions`（app/js/modules/pdf-actions.js）解析 /OpenAction（动作引用/内联动作/目标数组三形态）+ /AA 附加动作（Catalog/页面/批注，事件 O/E/X/U/D/Po/PC/WP/WC/DS/DC…）+ /A 动作引用 + /Names /JavaScript 名称树 + 全文档动作对象（JavaScript/Launch/SubmitForm/ImportData/GoTo(R/E)/URI/Named 等）；/JS 片段字节级解码（字面串 PDF 转义+八进制 / 十六进制；UTF-16BE→UTF-8→Latin-1）；Launch/SubmitForm/ImportData 目标（文件/URL）提取；风险分级 高(JS·Launch)/中(SubmitForm·ImportData)/低/info + 自动执行判定；面板（风险降序 + data-page 跳页）+ 导出审计报告 MD；_pdf_actions_test 37 断言。**同轮修复 sliceDict 族潜在缺陷**：pdf-actions/pdf-fonts/pdf-docinfo/pdf-encrypt/pdf-formfields/pdf-pageinfo 六模块平衡切分闭合 `>>` 处丢末位 `>`（与 AO 同族），嵌套字典解析失衡，统一改 `slice(startIdx, i + 1)`，六模块单测回归全绿。整链 **88 套件 0 失败**。

- **2026-09-02 新增 AQ=PDF 结构预检/完整性诊断**：`OS.PdfPreflight`（app/js/modules/pdf-preflight.js，复用 OS.PdfTool._inflate/parseObjStm 展开 PDF 1.5+ 对象流）只读体检 17 项：PDF 头版本、%%EOF、startxref、xref 表/流、trailer /Root、Root 对象定义、/Catalog 类型、/Size 一致性、悬挂引用（字典部分全文引用扫描，流二进制不参与）、重复对象定义、页面树环（自带 visited 安全走树，不依赖 OS.PdfTool.parsePdf 的无环保护递归）、页数 0、流 /Length 缺失/间接引用/失配（±2 容差，endstream 前 EOL 剥除后比对）、ObjStm 解压失败、孤儿对象；按 错误/警告/提示 三级 + verdict(errors/warnings/pass)；面板（级别色条 + 对象/页数/引用统计）+ 导出诊断报告 MD；_pdf_preflight_test 42 断言（8 组合成 PDF：健康/悬挂引用/重复对象/缺 trailer/页面树环/流 Length 三态/ObjStm 健康/缺 EOF+版本 2.9 + MD/HTML 导出）。整链 **90 套件 0 失败**。

- **2026-09-03 新增 AR=PDF 文档历史/增量更新审计**：`OS.PdfHistory`（app/js/modules/pdf-history.js，零依赖字节级）沿 trailer /Prev 链回溯每次保存版本（versionCount、逐版 xrefOffset/Size/Root/Info/viaStream），统计 %%EOF/startxref/xref 段计数，检测线性化(/Linearized)、/Prev 链断裂(chainBroken)、计数不一致(count-mismatch)；verdict(single/multi/broken)；面板(版本表 + 结论色条) + 导出历史报告 MD；_pdf_history_test 39 断言（8 组合成 PDF：单版本/两版本/三版本/线性化/xref 流/计数不一致/链断裂/MD+HTML 导出）。整链 **90 套件 0 失败**。
- **最后更新**：2026-09-08（修复测试环境：项目迁 D 盘后 jsdom/jszip 外部路径失效 → 改为项目 devDependency，36 测试文件 APP 路径迁移，E2E/「我的」版本断言改从 package.json 动态读取；全量门禁 **99 套件 0 失败** + 四端同源 ✅；同步回写 v1.0.17 文档。**同日新增业务板块批量操作**：biz-common 共享批量工具条 + 订单/库存批量删除 + 审批批量通过/驳回/删除，新增 _biz_batch_test 24 断言，门禁升至 **100 套件 0 失败** + 四端同源 ✅。**同日再增库存出入库**：planAdjust/adjustQty 数量调整 + history 流水，新增 _inventory_adjust_test 24 断言，门禁升至 **101 套件 0 失败** + 四端同源 ✅）。**同日再增订单单条状态流转**：planStatus/setStatus + statusHistory 留痕，列表状态列改行内下拉，新增 _order_status_test 21 断言，门禁升至 **102 套件 0 失败** + 四端同源 ✅）。**同日新增订单/审批详情展开**：订单/审批列表「详情」按钮展开详情面板 + 状态流转时间线，审批补 statusHistory 留痕（update/批量），新增 _biz_detail_test 23 断言，门禁升至 **103 套件 0 失败** + 四端同源 ✅）。**同日再增库存流水明细**：summarizeLog（仅统计未撤销流水的累计入库/出库/有效笔数）+ detailData/detail + undoAdjust（撤销最近一笔未撤销流水，mark revoked + 追加反向记录保留审计痕迹，撤销记录本身视为已撤销防振荡）；台账「流水」按钮展开面板（当前库存/累计出入库/有效流水 + 明细表 + 撤销按钮，撤销后重填保持展开），新增 _inventory_log_test 24 断言，门禁升至 **104 套件 0 失败** + 四端同源 ✅）。**同日再增库存流水按时间筛选 + 分页**：filterLog（类型/时间范围/备注关键词组合）+ pageLog（分页切片、页越界夹取、空集安全）；流水面板新增筛选栏（类型/日期/关键词 + 筛选·重置）与分页（上一页/下一页/页码），撤销后重填保持筛选与页码，新增 _inventory_log_page_test 29 断言，门禁升至 **105 套件 0 失败** + 四端同源 ✅）。**同日再增库存流水导出 CSV**：logCsvRows（时间正序、入/出库 +/- 前缀、已撤销标记）+ exportLogCsv（按当前筛选导出，复用 OS.export.csv，UTF-8 BOM 兼容 Excel 中文）；流水面板新增「导出 CSV」按钮导出当前筛选结果，新增 _inventory_log_export_test 17 断言，门禁升至 **106 套件 0 失败** + 四端同源 ✅）。**同日再增工作台聚合「库存预警」**：lowStock（低于安全线或缺货品项聚合，缺货优先排序）+ dashboard「库存预警」区块（现有量/安全库存/缺货·偏低标签卡片，点击或「去库存处理」跳转库存视图，无命中自动隐藏），新增 _inventory_lowstock_test 9 断言，门禁升至 **107 套件 0 失败** + 四端同源 ✅）。**同日再增工作台聚合「业务概览」**：orders.dashStats（总数/进行中/待处理/已完成/成交总额）+ approvals.dashStats（总数/待审批/已通过/已驳回）+ dashboard「业务概览」区块（订单卡 · 审批卡，点击卡片跳转对应视图），新增 _biz_dashboard_test 14 断言，门禁升至 **108 套件 0 失败** + 四端同源 ✅）。**2026-09-09 工作台趋势图表化**：orders.aggregateDaily（按日聚合、近 N 天连续升序、无数据日 0 填充）+ orders.trend(days) + dashboard「成交额趋势」区块（近 7 日订单成交额 → 内联 SVG 折线，网格/面积/数据点/数值/日标签，零依赖自适应），新增 _biz_trend_test 10 断言，门禁升至 **109 套件 0 失败** + 四端同源 ✅）。**2026-09-10 审批意见留痕**：`approvals.setStatus(id, status, comment)`（通过可填意见留空、**驳回必填理由**，否则仍为待审批）+ `update` 携 comment + `detailData` 历史回显 + 详情时间线展示意见 + UI 通过/驳回走 prompt，新增 _approval_comment_test 18 断言，门禁升至 **110 套件 0 失败** + 四端同源 ✅）。
- **v1.0.17（2026-09-04 升版）**：顶部主导航五板块（工作台/订单/库存/审批/我的）+ 订单/库存/审批本地 CRUD（IndexedDB）+ 「我的」（账户/偏好/关于）+ 业务 CSV 导出（RFC4180 + UTF-8 BOM）+ 随包并入 E2E 测试与 PDF 转换改进；发布脚本版本无关化（`publish-latest.bat` 从 latest.yml 动态读版本）；tag v1.0.17 已推 GitHub。

---

## 四、导航

- 功能明细 → [FEATURES.md](FEATURES.md)
- 范围 / 模块地图 / 关系 → [工程总纲.md](工程总纲.md)
- 各模块详情 → [模块/](模块/)
- 讨论与未定方案 → [讨论与处理/](讨论与处理/)
- 长期决策 → [MEMORY.md](MEMORY.md)
