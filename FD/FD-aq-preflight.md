# FD-AQ · PDF 结构预检/完整性诊断（Preflight）

## 说明
`app/js/modules/pdf-preflight.js`（OS.PdfPreflight）：对任意 PDF 做只读结构体检，17 项诊断按 错误/警告/提示 三级输出 verdict（errors/warnings/pass）。覆盖：头版本 / %%EOF / startxref / xref 表·流 / trailer /Root / Root 定义 / Catalog 类型 / Size 一致性 / 悬挂引用 / 重复对象 / 页面树环 / 页数 0 / 流 Length 缺失·间接引用·失配 / ObjStm 解压失败 / 孤儿对象。PDF 1.5+ 对象流复用 `OS.PdfTool._inflate` + `parseObjStm` 展开后参与判定。面板（级别色条 + 对象/页数/引用统计）+ 导出诊断报告 MD。

## 注释（细节·坑）
- **不依赖 OS.PdfTool.parsePdf**：其页面树 walk 递归无 visited 环保护，遇 /Kids 环直接栈溢出；preflight 自带扫描 + 带 visited 的安全走树。
- 引用扫描只做**字典部分**（"stream" 关键字之前），流二进制不参与正则，避免压缩数据里的随机字节产生幻影引用。
- 对象扫描正则 `(\d+)\s+\d+\s+obj(?![\d])` 仍可能被流二进制随机命中（幻影对象号）——实测 deflate 输出可产生 `\d+ \d+ obj` 序列；判孤儿/悬挂时以"未被引用"兜底，不影响 verdict 主链路。
- 流 /Length 比对先剥 endstream 前 EOL（与 OS.PdfTool.extractStreamData 同逻辑）再 ±2 容差，否则正常流必误报。
- **合成测试坑**：ObjStm 偏移表 head 必须是严格 `num off num off…` 交错（"2 0 3 38 4 84 "），写错一位（"2 0 0 3…"）parseObjStm 会把 offset 3 当对象号 → 幻影对象 38。
- trailer /Root 与 /Size 用全文扫描取**最后一个**（增量更新语义）。
- xref 表检测正则锚 `[\s\r\n>]xref\s*[\r\n]+\d+\s+\d+`——前缀类含 `>` 但不含 `t`，排除 startxref 误命中。

## 目标
- G：补充 PDF 审计族（加密→签名→动作→字体→**结构完整性**）最后一环，交付可信的"文件是否能被正常解析"结论。
- VG：绿灯 = _pdf_preflight_test 42 断言全过 + 全量门禁 89 套件 0 失败 + 四端同源。

## 关联
- ↔ E（引擎链）：与 pdf-encrypt / pdf-signature / pdf-actions 同属只读审计族
- ↔ Dc（文档）：02_PDF_总纲.md Preflight 行
- ↔ A（资产）：FD 卡体系
