/* 绿角犀 Office · PDF 合并/拆分 回归测试（纯函数，node 直跑） */
(function () {
  const T = require("./app/js/pdf-tool.js");
  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  // —— 最小化 fixture（含 stream，共享字体，验证引用重映射）——
  const A = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
6 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 20 180 Td (Hello Page 1) Tj ET
endstream
endobj
7 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 20 180 Td (Hello Page 2) Tj ET
endstream
endobj
trailer
<< /Size 8 /Root 1 0 R >>
startxref
0
%%EOF`;

  const B = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F2 6 0 R >> >> /Contents 7 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F2 6 0 R >> >> /Contents 8 0 R >>
endobj
5 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F2 6 0 R >> >> /Contents 9 0 R >>
endobj
6 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
7 0 obj
<< /Length 44 >>
stream
BT /F2 12 Tf 20 180 Td (Hello B 1) Tj ET
endstream
endobj
8 0 obj
<< /Length 44 >>
stream
BT /F2 12 Tf 20 180 Td (Hello B 2) Tj ET
endstream
endobj
9 0 obj
<< /Length 44 >>
stream
BT /F2 12 Tf 20 180 Td (Hello B 3) Tj ET
endstream
endobj
trailer
<< /Size 10 /Root 1 0 R >>
startxref
0
%%EOF`;

  // —— parsePdf ——
  ok("parsePdf(A) 解析出 2 页", T.parsePdf(A).pages.length === 2);
  ok("parsePdf(B) 解析出 3 页", T.parsePdf(B).pages.length === 3);
  ok("parsePdf(A) 找到 Root", T.parsePdf(A).root === 1);

  // —— remapRefs 纯函数 ——
  ok("remapRefs 偏移 +7", T.remapRefs("<< /Font << /F1 5 0 R >> /Contents 6 0 R >>", 7) ===
    "<< /Font << /F1 12 0 R >> /Contents 13 0 R >>");

  // —— mergePdfs ——
  const merged = T.mergePdfs([A, B]);
  ok("mergePdfs 返回 Uint8Array", merged instanceof Uint8Array);
  ok("mergePdfs 输出以 %PDF 开头", T._toStr(merged).indexOf("%PDF") === 0);
  const pm = T.parsePdf(merged);
  ok("合并后重新解析出 5 页", pm.pages.length === 5);
  ok("合并后 Root 存在", pm.root > 0);
  // B 的页面引用字体应被重映射为 6+7=13
  const mergedBPageDict = pm.dictStr(pm.pages[2]); // 第 3 页（原 B 第 1 页）
  ok("合并后 B 页字体引用已重映射(13 0 R)", /13 0 R/.test(mergedBPageDict));

  // —— splitPdf ——
  const s12 = T.splitPdf(A, [[1, 2]])[0];
  ok("splitPdf [1,2] 重新解析出 2 页", T.parsePdf(s12).pages.length === 2);
  const sIndiv = T.splitPdf(A, [[1, 1], [2, 2]]);
  ok("splitPdf 逐页产出 2 个文档", sIndiv.length === 2);
  ok("splitPdf 第1份 1 页", T.parsePdf(sIndiv[0]).pages.length === 1);
  ok("splitPdf 第2份 1 页", T.parsePdf(sIndiv[1]).pages.length === 1);

  // —— 合并后拆分（端到端）——
  const splitMerged = T.splitPdf(merged, [[1, 2], [3, 5]]);
  ok("合并后再拆分产出 2 份", splitMerged.length === 2);
  ok("再拆分第1份 2 页", T.parsePdf(splitMerged[0]).pages.length === 2);
  ok("再拆分第2份 3 页", T.parsePdf(splitMerged[1]).pages.length === 3);

  // —— 空范围不崩 ——
  const empty = T.splitPdf(A, [[99, 99]])[0];
  ok("空范围返回空 Uint8Array 不抛错", empty instanceof Uint8Array);

  console.log("PDF-TOOL: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
