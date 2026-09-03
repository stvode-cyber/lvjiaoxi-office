# FD-AR · PDF 文档历史 / 增量更新审计（History）

## 说明
`app/js/modules/pdf-history.js`（OS.PdfHistory）：对任意 PDF 做只读「修改历史」还原。PDF 增量更新保存会在文件尾追加新对象 + 一段自己的 xref + trailer（/Prev 指向前一版 xref 偏移）+ startxref + %%EOF。本模块从最后一个 startxref 起沿 trailer /Prev 链回溯，还原每次保存版本（versionCount、逐版 xrefOffset/Size/Root/Info/viaStream），并统计 %%EOF/startxref/xref 段计数、检测线性化(/Linearized)、/Prev 链断裂(chainBroken)、计数不一致(count-mismatch)。verdict：single（单版本）/ multi（多版本，链完整）/ broken（链断裂或计数异常）。面板版本表 + 结论色条 + 导出历史报告 MD。

## 注释（细节·坑）
- **/Prev 链是权威的**：增量更新各版 trailer 用 /Prev 指向上一版 xref 偏移，沿链回溯即可还原全部版本；%%EOF/startxref/xref 段计数仅作交叉验证。
- readTrailerAt 双路径：优先找 `trailer` 关键字（经典 xref 表后），找不到再按 `/Type /XRef`（xref 流对象）取字典——PDF 1.5+ 的 xref stream 版没有独立 trailer 段。
- firstBalancedDict 用**含末位 `>`** 的版本（`slice(open, i+1)`）——这是 AP 轮修过的 sliceDict 族缺陷，勿退回旧写法。
- **合成测试构造**：startxref 偏移必须用 `pdf.length` 实时计算（每版 xref 段拼接前取当前长度），手算必错位（沿用 ObjStm 偏移表教训）。
- 链断裂判定：`startxrefCount > versionCount`（文件里有 startxref 但 /Prev 没连上）。计数不一致：`eofCount !== startxrefCount`。
- 模块**同步**（不依赖解压），与 pdf-preflight（异步，ObjStm 解压）不同——UI 里 showHistory 无需 await。

## 目标
- G：补齐 PDF 只读审计族（加密→签名→动作→字体→结构→**历史**）最后一环，交付「文档被改过几次、是否多工具编辑、是否截断」的可信结论。
- VG：绿灯 = _pdf_history_test 39 断言全过 + 全量门禁 90 套件 0 失败 + 四端同源。

## 关联
- ↔ E（引擎链）：与 pdf-preflight 同属只读审计族，二者互补（preflight 取末版结构，history 还原全版本链）
- ↔ Dc（文档）：02_PDF_总纲.md History 行
- ↔ A（资产）：FD 卡体系
