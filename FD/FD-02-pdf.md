# FD-02-pdf · PDF 全特性

## 说明
PDF 阅读 / 合并拆分 / 批注（类型齐全 + 图层 + AP 图像/矢量）/ 表单字段 / 文本层 / 多格式导出 / 属性解析 / 书签目录 / 附件提取 / 链接提取（外链审计）/ 加密与权限检测 / 数字签名验证 / 字体信息 / 页面信息 / 文档信息 / 1.5+ 对象流(ObjStm) 解析。

## 注释（细节 · 坑）
- 零依赖**字节级**解析（自研 `app/js/pdf-tool.js`），沙箱无 pdf.js / 真实 Canvas 运行环境，靠纯逻辑单测覆盖。
- 字面串分词、`(` 起 `)` 止；操作数栈解释内容流；引用正则捕对象号非代数。
- PDF→Excel / PDF→DOCX / TXT / MD 版面还原**有限**（文本提取，非像素级）——属已知边界，非阻断。
- 1.5+ ObjStm 解析见专项卡 `FD-objstm.md`（`parsePdf` 改 async 等两处 bug 修复）。

## 目标（对应 G / VG）
- **G**：PDF 全特性边界补齐（解析族覆盖 1.4 内联 + 1.5+ 对象流）。
- **VG**：全功能可交付、四端同源。

## 关联（↔报错 / ↔决策 / ↔动作）
- ↔E `E-2026-09-01-objstm-trailing-junk`（ERR_TRAILING_JUNK → extractStreamData 剥 EOL）
- ↔E `E-2026-09-01-objstm-missing-gt`（对象字典丢尾 `>` → extractFirstBalancedDict 改 slice(open,i+1)）
- ↔Dc `Dc-2026-09-01-pdf-async`（parsePdf 改 async，调用方 await 回归）
- ↔A `A-2026-09-01-objstm`（commit `9e32df0` / tag `v1.0.16` / `_pdf_merge_test` 12 断言）；模块总纲 `模块/02_PDF_总纲.md`
