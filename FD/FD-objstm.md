# FD-objstm · PDF 1.5+ 对象流（/ObjStm）合并/拆分支持

## 说明
绿角犀 Office PDF 工具补齐 PDF 1.5+ 的对象流解析：把打包进 `/ObjStm`（FlateDecode 压缩）的对象展开还原，使「PDF 合并 / 拆分」对 1.5+ 版本不再因对象被塞进 ObjStm 而提取到 0 个对象 → 静默失败。

## 注释（细节 · 坑）
- `parsePdf` 必须改为 **async**：展开 ObjStm 依赖 `DecompressionStream` 异步 inflate；`mergePdfs`/`splitPdf` 同步调用方全部加 `await`，4 个测试文件（`_pdf_tool_test`/`_pdf_image_test`/`_pdf_image_pdf_test`/`_writer_pdf_file_test`）已接 await 回归。
- `extractStreamData` 须**剥 `endstream` 前 EOL**（`\r\n`/`\n`/`\r`），否则 inflate 报 `ERR_TRAILING_JUNK_AFTER_STREAM_END`。
- `extractFirstBalancedDict` 命中 `>>` 须 `slice(open, i+1)` **含末位 `>`**：原 `slice(open, i)` 丢掉尾 `>`，会让合并真实 1.5+ PDF 时吐畸形页面字典（**非表面问题**，会导致合并产物页面损坏）。
- ObjStm 偏移表偏移**相对 `First` 计量**，非绝对文件偏移。
- 零依赖字节级解析；沙箱无 pdf.js / 真实 Canvas 运行环境，靠纯逻辑单测覆盖（不靠目检）。

## 目标（对应 G / VG）
- **G**：绿角犀 Office「PDF 全特性」边界补齐——解析族覆盖 1.4 内联对象 + 1.5+ 对象流（ObjStm）。
- **VG**：全功能可交付、四端同源（iOS / HarmonyOS / Web / Desktop 同一 `pdf-tool.js` 真源，改后 `sync-clients`）。

## 关联（↔报错 / ↔决策 / ↔动作）
- ↔E `E-2026-09-01-objstm-trailing-junk`：`ERR_TRAILING_JUNK_AFTER_STREAM_END` → `extractStreamData` 剥 EOL 修复。
- ↔E `E-2026-09-01-objstm-missing-gt`：ObjStm 对象字典丢尾 `>` → `extractFirstBalancedDict` 改 `slice(open, i+1)` 修复。
- ↔Dc `Dc-2026-09-01-pdf-async`：`parsePdf` 改 async（ObjStm 展开需异步 inflate），调用方 await 回归一并处理。
- ↔A `A-2026-09-01-objstm`：新增 `_pdf_merge_test.js`（12 断言：parseObjStm 单元 / 1.4 回归 / 1.5+ 展开 / 混合合并）；全量门禁 **87 套件 0 失败**（修复前 5 失败）；bump **1.0.16**；commit `9e32df0`（28 文件 +451/−98）；tag `v1.0.16`；四端同源 grep 校验含 `slice(open, i+1)`。
