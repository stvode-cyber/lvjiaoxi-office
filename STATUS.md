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
| 05 外壳与通用 | [总纲](模块/05_外壳与通用_总纲.md) | ✅ 已实现 | 开始页 / ribbon / 命令面板 / 主题 / AI |
| 06 客户端与交付 | [总纲](模块/06_客户端与交付_总纲.md) | 🟡 部分实现 | Win / Android / PWA ✅；iOS / HarmonyOS ⚠️ 源码工程 |
| 07 发版与更新 | [总纲](模块/07_发版与更新_总纲.md) | ✅ 已实现 | 版本单一真源 / 全自动更新模式(启动检查+后台自动下载+退出自动装，generic feed 已接通 lujax.fun/releases) / 合规素材 |
| 08 测试与质量 | [总纲](模块/08_测试与质量_总纲.md) | ✅ 已实现 | 92 套件 91 通过（1 云服务超时）；E2E 已补（171 断言） |

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

- **测试**：`npm test` 整链 **92 套件，91 通过**（1 个云服务偶发超时为网络原因，隔离跑 51/51 绿）。含 AK=PDF 表单字段提取 34 断言、AL=PDF 文档信息/元数据提取 33 断言、AM=PDF 页面属性/页面树信息提取 50 断言、AN=PDF 字体信息提取 74 断言、AP=PDF 动作/JavaScript 安全审计 37 断言、AQ=PDF 结构预检 42 断言、AR=PDF 文档历史 39 断言；_updater_autoupdate_test 11 断言锁定 v1.0.15 自动更新正向链路；**E2E 测试**：_e2e_roundtrip_test 73 断言 + _e2e_scenarios_test 98 断言 = **171 断言**覆盖 DOCX/XLSX/PPTX/OFD 往返 + 批量并发 + 主题/MIME/模板/导出边界/云同步/util。
- **同源**：四端经 `sync-clients` 与 `app/` 一致 ✅。
- **2026-09-01 新增 PDF 1.5+ 对象流(ObjStm)合并/拆分支持**：`parsePdf`/`mergePdfs`/`splitPdf` 改异步（ObjStm 解压依赖 DecompressionStream），并修复 `extractStreamData` 末行 EOL 与 `extractFirstBalancedDict` 末位 `>` 偏移两处解析 bug（后者会让 ObjStm 对象字典丢失末位 `>`，合并真实 1.5+ PDF 时会输出畸形页面字典）；新增 `_pdf_merge_test` 12 断言 + `_pdf_tool_test` 回归全覆盖，整链 87 套件 0 失败。
- **2026-09-02 新增 AP=PDF 动作/JavaScript 安全审计**：`OS.PdfActions`（app/js/modules/pdf-actions.js）解析 /OpenAction（动作引用/内联动作/目标数组三形态）+ /AA 附加动作（Catalog/页面/批注，事件 O/E/X/U/D/Po/PC/WP/WC/DS/DC…）+ /A 动作引用 + /Names /JavaScript 名称树 + 全文档动作对象（JavaScript/Launch/SubmitForm/ImportData/GoTo(R/E)/URI/Named 等）；/JS 片段字节级解码（字面串 PDF 转义+八进制 / 十六进制；UTF-16BE→UTF-8→Latin-1）；Launch/SubmitForm/ImportData 目标（文件/URL）提取；风险分级 高(JS·Launch)/中(SubmitForm·ImportData)/低/info + 自动执行判定；面板（风险降序 + data-page 跳页）+ 导出审计报告 MD；_pdf_actions_test 37 断言。**同轮修复 sliceDict 族潜在缺陷**：pdf-actions/pdf-fonts/pdf-docinfo/pdf-encrypt/pdf-formfields/pdf-pageinfo 六模块平衡切分闭合 `>>` 处丢末位 `>`（与 AO 同族），嵌套字典解析失衡，统一改 `slice(startIdx, i + 1)`，六模块单测回归全绿。整链 **88 套件 0 失败**。

- **2026-09-02 新增 AQ=PDF 结构预检/完整性诊断**：`OS.PdfPreflight`（app/js/modules/pdf-preflight.js，复用 OS.PdfTool._inflate/parseObjStm 展开 PDF 1.5+ 对象流）只读体检 17 项：PDF 头版本、%%EOF、startxref、xref 表/流、trailer /Root、Root 对象定义、/Catalog 类型、/Size 一致性、悬挂引用（字典部分全文引用扫描，流二进制不参与）、重复对象定义、页面树环（自带 visited 安全走树，不依赖 OS.PdfTool.parsePdf 的无环保护递归）、页数 0、流 /Length 缺失/间接引用/失配（±2 容差，endstream 前 EOL 剥除后比对）、ObjStm 解压失败、孤儿对象；按 错误/警告/提示 三级 + verdict(errors/warnings/pass)；面板（级别色条 + 对象/页数/引用统计）+ 导出诊断报告 MD；_pdf_preflight_test 42 断言（8 组合成 PDF：健康/悬挂引用/重复对象/缺 trailer/页面树环/流 Length 三态/ObjStm 健康/缺 EOF+版本 2.9 + MD/HTML 导出）。整链 **90 套件 0 失败**。

- **2026-09-03 新增 AR=PDF 文档历史/增量更新审计**：`OS.PdfHistory`（app/js/modules/pdf-history.js，零依赖字节级）沿 trailer /Prev 链回溯每次保存版本（versionCount、逐版 xrefOffset/Size/Root/Info/viaStream），统计 %%EOF/startxref/xref 段计数，检测线性化(/Linearized)、/Prev 链断裂(chainBroken)、计数不一致(count-mismatch)；verdict(single/multi/broken)；面板(版本表 + 结论色条) + 导出历史报告 MD；_pdf_history_test 39 断言（8 组合成 PDF：单版本/两版本/三版本/线性化/xref 流/计数不一致/链断裂/MD+HTML 导出）。整链 **90 套件 0 失败**。
- **最后更新**：2026-09-04（新增 E2E 测试 _e2e_roundtrip_test 73 断言 + _e2e_scenarios_test 98 断言；PDF 转换改进：段落合并/列表检测/多级标题；git remote 配置完成，41 commit + 17 tag 已推 GitHub `stvode-cyber/lvjiaoxi-office`；Windows 安装包 v1.0.16 重建；全量测试 92 套件 91 通过（1 云服务超时）；清理 _asar_check 临时产物 + dist/ 旧版本）。

---

## 四、导航

- 功能明细 → [FEATURES.md](FEATURES.md)
- 范围 / 模块地图 / 关系 → [工程总纲.md](工程总纲.md)
- 各模块详情 → [模块/](模块/)
- 讨论与未定方案 → [讨论与处理/](讨论与处理/)
- 长期决策 → [MEMORY.md](MEMORY.md)
