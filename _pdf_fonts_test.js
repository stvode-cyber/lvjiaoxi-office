/*
 * _pdf_fonts_test.js — OS.PdfFonts 单元自测（零依赖，node 直跑）
 * 覆盖：页面树遍历取 /Resources /Font（含父节点继承）/ BaseFont 与子集前缀剥离 /
 *       Subtype 类型映射 / Encoding（名字·引用·Differences）/ ToUnicode /
 *       嵌入标志（FontFile·FontFile2·FontFile3，Type0 下钻 DescendantFonts）/ Type3 特殊判定 /
 *       标准 14 免风险 / Flags 位解析 / 字符范围·宽度表 /
 *       按对象去重合并使用页 / 逐页映射 / 摘要(类型分布·嵌入·子集·风险) / 无字体负例 /
 *       无页面树兜底全局扫描 / toMarkdown·toHtml。
 */
const C = require("./app/js/modules/pdf-fonts.js");
const enc = s => new TextEncoder().encode(s);

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

// —— PDF_A：2 页 · Type0 中文 CID（DescendantFonts→FontFile2 嵌入，跨页共用）+ TrueType 未嵌入 ——
const pdfA = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R 6 0 R ] /Count 2 >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 10 0 R /F2 11 0 R >> >> >>\nendobj\n" +
  "6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 10 0 R >> >> >>\nendobj\n" +
  "10 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEE+SimSun /Encoding /Identity-H /ToUnicode 20 0 R /DescendantFonts [ 12 0 R ] >>\nendobj\n" +
  "12 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEE+SimSun /FontDescriptor 13 0 R >>\nendobj\n" +
  "13 0 obj\n<< /Type /FontDescriptor /FontName /ABCDEE+SimSun /FontFamily (SimSun) /Flags 4 /FontFile2 14 0 R >>\nendobj\n" +
  "11 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /ArialMT /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [ 250 300 400 ] >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);

console.log("PDF_A：");
const rA = C.parseFonts(pdfA);
ok("hasPageTree = true", rA.hasPageTree === true);
ok("hasFonts = true", rA.hasFonts === true);
ok("totalPages = 2", rA.totalPages === 2);
ok("字体总数 = 2（按对象去重）", rA.summary.totalFonts === 2);
const f1 = rA.fonts.find(f => f.resName === "F1");
const f2 = rA.fonts.find(f => f.resName === "F2");
ok("F1 baseFont = ABCDEE+SimSun", f1 && f1.baseFont === "ABCDEE+SimSun");
ok("F1 子集前缀剥离 → family = SimSun", f1 && f1.family === "SimSun" && f1.subset === true && f1.subsetTag === "ABCDEE");
ok("F1 subtype = Type0", f1 && f1.subtype === "Type0");
ok("F1 typeLabel 含 CID 说明", f1 && f1.typeLabel.indexOf("Type0") === 0 && f1.typeLabel.indexOf("CID") > 0);
ok("F1 encoding = Identity-H", f1 && f1.encoding === "Identity-H");
ok("F1 toUnicode = true", f1 && f1.toUnicode === true);
ok("F1 经 DescendantFonts 下钻判定已嵌入", f1 && f1.embedded === true);
ok("F1 embeddedAs = FontFile2(TrueType)", f1 && f1.embeddedAs === "FontFile2(TrueType)");
ok("F1 descriptorSource = DescendantFonts", f1 && f1.descriptorSource === "DescendantFonts");
ok("F1 跨页去重 → pages = [1,2]", f1 && f1.pages.join(",") === "1,2");
ok("F2 baseFont = ArialMT，非子集", f2 && f2.baseFont === "ArialMT" && f2.subset === false);
ok("F2 subtype = TrueType", f2 && f2.subtype === "TrueType");
ok("F2 未嵌入 → embedded = false", f2 && f2.embedded === false && f2.hasDescriptor === false);
ok("F2 非标准14 且未嵌入 → risky = true", f2 && f2.isStandard14 === false && f2.risky === true);
ok("F2 仅用于第 1 页 → pages = [1]", f2 && f2.pages.join(",") === "1");
ok("F2 encoding = WinAnsiEncoding", f2 && f2.encoding === "WinAnsiEncoding");
ok("F2 字符范围 32–126 · 宽度表 3 项", f2 && f2.firstChar === 32 && f2.lastChar === 126 && f2.widthCount === 3);
ok("摘要 byType: Type0×1 · TrueType×1", rA.summary.byType.Type0 === 1 && rA.summary.byType.TrueType === 1);
ok("摘要 embeddedCount = 1", rA.summary.embeddedCount === 1);
ok("摘要 notEmbeddedCount = 1", rA.summary.notEmbeddedCount === 1);
ok("摘要 subsetCount = 1", rA.summary.subsetCount === 1);
ok("摘要 withToUnicode = 1", rA.summary.withToUnicode === 1);
ok("摘要 riskyCount = 1 且列出 ArialMT", rA.summary.riskyCount === 1 && rA.summary.riskyFonts.join(",") === "ArialMT");
ok("摘要 pagesWithFonts = 2", rA.summary.pagesWithFonts === 2);
ok("pageFonts[0] 含 2 个字体", rA.pageFonts[0].page === 1 && rA.pageFonts[0].fonts.length === 2);
ok("pageFonts[1] 含 1 个字体", rA.pageFonts[1].page === 2 && rA.pageFonts[1].fonts.length === 1);
ok("summarize.totalFonts = 2", C.summarize(rA).totalFonts === 2);
const mdA = C.toMarkdown(rA, { title: "文档A 字体信息" });
ok("toMarkdown 含标题", mdA.indexOf("# 文档A 字体信息") === 0);
ok("toMarkdown 含字体清单与 SimSun", mdA.indexOf("## 字体清单") > 0 && mdA.indexOf("SimSun") > 0);
ok("toMarkdown 含风险提示 ArialMT", mdA.indexOf("风险提示") > 0 && mdA.indexOf("ArialMT") > 0);
ok("toMarkdown 含逐页字体", mdA.indexOf("## 逐页字体") > 0 && mdA.indexOf("/F1(SimSun)") > 0);
ok("toHtml 含字体清单与风险条", C.toHtml(rA).indexOf("字体清单") > 0 && C.toHtml(rA).indexOf("⚠") > 0);

// —— PDF_B：标准 14（未嵌入但免风险）+ 内嵌 TrueType(FontFile2) + Type3 + Flags ——
const pdfB = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] /Count 1 >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 10 0 R /F2 11 0 R /F3 12 0 R >> >> >>\nendobj\n" +
  "10 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n" +
  "11 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /QQWWEE+MicrosoftYaHei /FontDescriptor 13 0 R /FirstChar 32 /LastChar 65535 >>\nendobj\n" +
  "13 0 obj\n<< /Type /FontDescriptor /FontName /QQWWEE+MicrosoftYaHei /FontFamily (Microsoft YaHei) /Flags 33 /FontFile2 14 0 R >>\nendobj\n" +
  "12 0 obj\n<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs 15 0 R >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);

console.log("PDF_B：");
const rB = C.parseFonts(pdfB);
ok("字体总数 = 3", rB.summary.totalFonts === 3);
const b1 = rB.fonts.find(f => f.resName === "F1");
const b2 = rB.fonts.find(f => f.resName === "F2");
const b3 = rB.fonts.find(f => f.resName === "F3");
ok("F1 = Helvetica 标准14 → isStandard14 = true", b1 && b1.isStandard14 === true);
ok("F1 未嵌入但标准14 → risky = false", b1 && b1.embedded === false && b1.risky === false);
ok("F2 子集 QQWWEE+ → family = MicrosoftYaHei", b2 && b2.subset === true && b2.family === "MicrosoftYaHei");
ok("F2 FontFile2 嵌入 → embedded = true", b2 && b2.embedded === true && b2.embeddedAs === "FontFile2(TrueType)");
ok("F2 descriptorSource = 自身", b2 && b2.descriptorSource === "自身");
ok("F2 Flags 33 → 等宽(1)+非符号(32)", b2 && b2.flags === 33 && b2.fixedPitch === true && b2.nonsymbolic !== undefined && b2.flagLabels.join("·") === "等宽·非符号");
ok("F3 Type3 → 视为已嵌入(Type3 字形过程)", b3 && b3.subtype === "Type3" && b3.embedded === true && b3.embeddedAs === "Type3 字形过程");
ok("摘要 standard14Count = 1", rB.summary.standard14Count === 1);
ok("摘要 embeddedCount = 2（TrueType + Type3）", rB.summary.embeddedCount === 2);
ok("摘要 notEmbeddedCount = 1（Helvetica）", rB.summary.notEmbeddedCount === 1);
ok("摘要 riskyCount = 0（标准14 免风险）", rB.summary.riskyCount === 0);
ok("摘要 byType: Type1×1 TrueType×1 Type3×1", rB.summary.byType.Type1 === 1 && rB.summary.byType.TrueType === 1 && rB.summary.byType.Type3 === 1);
const mdB = C.toMarkdown(rB);
ok("toMarkdown(B) 含「无未嵌入的非标准字体」", mdB.indexOf("无未嵌入的非标准字体") > 0);
ok("toHtml(B) 含绿色无风险条", C.toHtml(rB).indexOf("未发现未嵌入的非标准字体") > 0);

// —— PDF_C：资源继承（页面无 /Resources，父 /Pages 有）+ 内联字体字典 + Encoding 引用(Differences) ——
const pdfC = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] /Count 1 /Resources << /Font << /F1 10 0 R >> >> >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n" +
  "10 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /TimesNewRomanPSMT /Encoding 11 0 R /FontDescriptor 12 0 R >>\nendobj\n" +
  "11 0 obj\n<< /Type /Encoding /Differences [ 65 /Aacute ] >>\nendobj\n" +
  "12 0 obj\n<< /Type /FontDescriptor /FontName /TimesNewRomanPSMT /Flags 34 /FontFile3 13 0 R >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);

console.log("PDF_C：");
const rC = C.parseFonts(pdfC);
ok("资源继承生效 → 字体总数 = 1", rC.summary.totalFonts === 1);
const c1 = rC.fonts[0];
ok("继承字体 resName = F1", c1 && c1.resName === "F1");
ok("Encoding 引用含 Differences → 自定义(Differences)", c1 && c1.encoding === "自定义(Differences)");
ok("FontFile3 → 嵌入（CFF/OpenType 兜底）", c1 && c1.embedded === true && c1.embeddedAs.indexOf("FontFile3") === 0);
ok("Flags 34 → 衬线(2)+非符号(32)", c1 && c1.serif === true && c1.nonsymbolic === true && c1.flagLabels.join("·") === "衬线·非符号");
ok("逐页字体：第1页含 /F1", rC.pageFonts[0].fonts.length === 1 && rC.pageFonts[0].fonts[0].resName === "F1");

// —— PDF_D：无字体资源（负例）——
const pdfD = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] /Count 1 >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);
console.log("PDF_D（负例）：");
const rD = C.parseFonts(pdfD);
ok("hasFonts = false", rD.hasFonts === false);
ok("字体总数 = 0", rD.summary.totalFonts === 0);
ok("toMarkdown 提示未发现字体", C.toMarkdown(rD).indexOf("未发现 PDF 字体资源") > 0);
ok("toHtml 提示未发现字体", C.toHtml(rD).indexOf("未发现 PDF 字体资源") > 0);
ok("summarize(负例) totalFonts = 0", C.summarize(rD).totalFonts === 0);

// —— PDF_E：无页面树 → 兜底全局扫描 /Type /Font 对象 ——
const pdfE = enc(
  "%PDF-1.7\n" +
  "10 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /Verdana /FontDescriptor 11 0 R >>\nendobj\n" +
  "11 0 obj\n<< /Type /FontDescriptor /FontName /Verdana /Flags 32 >>\nendobj\n" +
  "12 0 obj\n<< /Type /XObject /Subtype /Image /Width 4 /Height 4 >>\nendobj\n" +
  "%%EOF\n"
);
console.log("PDF_E（无页面树兜底）：");
const rE = C.parseFonts(pdfE);
ok("hasPageTree = false", rE.hasPageTree === false);
ok("兜底扫描到 1 个字体", rE.summary.totalFonts === 1);
ok("兜底字体 baseFont = Verdana", rE.fonts[0] && rE.fonts[0].baseFont === "Verdana");
ok("兜底字体未嵌入（无 FontFile）", rE.fonts[0] && rE.embedded !== true && rE.fonts[0].embedded === false);
ok("兜底不误抓 XObject 图像对象", rE.fonts.every(f => f.baseFont !== null));

// —— 边界：空输入 / 非 PDF ——
console.log("边界：");
ok("空字节 → hasFonts=false", C.parseFonts(new Uint8Array(0)).hasFonts === false);
ok("非 PDF 字节 → hasFonts=false", C.parseFonts(enc("hello world 明文不是 PDF")).hasFonts === false);
ok("summarize(null) 安全返回", C.summarize(null).totalFonts === 0);
ok("splitSubset 无前缀", C.splitSubset("Arial").subset === false && C.splitSubset("Arial").family === "Arial");
ok("splitSubset 6位大写前缀", C.splitSubset("ABCDEF+SimSun").subset === true && C.splitSubset("ABCDEF+SimSun").family === "SimSun");
ok("splitSubset 小写前缀不算子集", C.splitSubset("abcdef+SimSun").subset === false);
ok("STANDARD_14 含 14 个", C.STANDARD_14.length === 14 && C.STANDARD_14.indexOf("ZapfDingbats") >= 0);

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
