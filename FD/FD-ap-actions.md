# FD-AP · PDF 动作/JavaScript 安全审计（OS.PdfActions）

- **日期**：2026-09-02
- **字母位**：AP（AA~AO 之后，字母序特性族第 43 项）

## 说明（这功能干嘛的）
从 PDF 原始字节零依赖解析「会自动执行/有外发风险的动作」并给出安全审计报告：
- /OpenAction 三形态（动作引用 / 内联动作 / 目标数组——数组是跳转非脚本，不算高险）
- /AA 附加动作（Catalog/页面/批注字典，事件 O/E/X/U/D/Po/PC/PV/WP/WC/WS/DS/DC…）
- /A 动作引用（链接/页面/大纲条目）
- /Names /JavaScript 名称树（文档级 JS，名称树引用与独立兜底双路径）
- 全文档动作对象扫描（/S 为已知动作类型，或无 /S 但带 /JS 的兜底识别）
- /JS 片段字节级解码：字面串（PDF 转义 + 八进制 \ooo）/ 十六进制；UTF-16BE(FEFF)→UTF-8(fatal)→Latin-1
- Launch/SubmitForm/ImportData 目标（文件/参数/URL）提取（/Win 子字典下钻）
- 风险分级：高(JavaScript·Launch) / 中(SubmitForm·ImportData) / 低(URI·GoToR/E·Named) / info；自动执行判定（OpenAction via 或自动事件）
面板（风险降序 + data-page 跳页）+ 导出审计报告 MD。补齐安全检测族：加密检测(AI) → 签名验证(AJ) → **安全审计(AP)**。

## 注释（细节 · 坑）
- **sliceDict 族末位 `>` 丢失缺陷（本轮最大收获，AO 同族 bug）**：pdf-fonts 模板的平衡切分在闭合 `>>` 处 `return txt.slice(startIdx, i)`，i 停在第二个 `>` 上，切片**不含末位 `>`**。单层字典靠 `dictEntries` 的 `lastIndexOf(">>")` 启发式侥幸可用（故 AN 字体 74 断言没暴露）；**嵌套字典（/Names 三层）必失衡**——外层字典缺 `>` → lastIndexOf 命中内层 → /Names 值被截成 `<<`。修复：`slice(startIdx, i + 1)`。同缺陷波及 6 模块：pdf-actions/pdf-fonts/pdf-docinfo/pdf-encrypt/pdf-formfields/pdf-pageinfo，统一修复后六套单测回归全绿。
  - **对照**：pdf-pagelabels 的 `extractBalanced` 是另一套正确实现（`i++; break` 后 slice 含闭合符），勿误改。
- 合成测试 PDF **必须带 `trailer << /Root 1 0 R >>`**，否则 findRootDict（锚 /Root regex）找不到 Catalog，整表全挂——第一轮 18 断言全红的根因。
- 字面串转义在 JS 源码里要双转义：PDF 里 `\"` 写成 `\\(\"`；八进制 `\050` 写成 `\\050`。
- /S /Trans 不登记（页面 /Trans 过渡效果常见，登记会噪音化）；StructElem 的 /S /P、/H1 等不在 ACTION_KINDS 白名单，天然不误报。
- OpenAction 为目标数组 `[3 0 R /Fit]` 时是 info 级跳转，不能计高险。
- 引用归属用 viaMap（obj → [{via,event,containerObj}]），pass1 建记录、pass2-4 只补 via，最后统一合并——同对象多来源（如既 OpenAction 又被 AA 引用）合并为一条记录多 via。
- 本会话工具层发现：Edit 工具偶发「幻影写入」（回执成功但磁盘未变），**每次 Edit 后必须 grep/Read 回查**；批量修改宁可用整文件 Write 原子重写。

## 目标（对应 G / VG）
- **G**：PDF 全特性边界（解析族补完安全审计维度；阅读/合并拆分/批注/签名/加密/审计闭环）
- **VG**：四端同源（sync-clients 后 iOS/HarmonyOS 同步 8 文件）+ 全量门禁 0 失败

## 关联
- ↔ 报错 E：本特性单测暴露 sliceDict 族 6 模块缺陷（对应 AO 的 extractFirstBalancedDict 修复经验，跨特性复用成功）
- ↔ 决策 Dc：动作风险分级口径（JS/Launch=高，SubmitForm/ImportData=中，URI/GoTo=低）；Trans 不登记防噪音；/JS 无 /S 兜底判 JS
- ↔ 动作 A：commit 见 2026-09-02 日志；_pdf_actions_test 37 断言；整链 88 套件 0 失败；未 bump 版本（发布随下次打包批量走）
