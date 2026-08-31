/*
 * _pdf_docinfo_test.js — OS.PdfDocInfo 单元自测（零依赖，node 直跑）
 * 覆盖：/Info 解析 + 字面值解码 + PDF 日期解析 + XMP 解析 + 中文 UTF-16BE 解码 + 负例。
 */
const C = require("./app/js/modules/pdf-docinfo.js");
const enc = s => new TextEncoder().encode(s);

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

// —— PDF_A：标准 ASCII /Info + XMP 流 ——
const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Title="XMP Title" pdf:Producer="XMPProducer" pdf:Keywords="xk1;xk2">
<pdf:Author>ShouldNotAppear</pdf:Author>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:creator><rdf:Seq><rdf:li>Creator A</rdf:li><rdf:li>Creator B</rdf:li></rdf:Seq></dc:creator>
<dc:description>Some desc</dc:description>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<xmp:CreateDate>2023-12-31T12:00:00+08:00</xmp:CreateDate>
<xmp:ModifyDate>2024-01-01T00:00:00Z</xmp:ModifyDate>
<xmp:CreatorTool>CreatorToolX</xmp:CreatorTool>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
<xmpMM:DocumentID>uuid:abc-123</xmpMM:DocumentID>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

const pdfA = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 9 0 R /Metadata 3 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Title (Hello) /Author (Alice) /Subject (Test) /Keywords (PDF;test) /Creator (Acrobat) /Producer (MyApp) /CreationDate (D:20231231120000+08'00') /ModDate (D:20240101000000Z) /Version /1.4 >>\nendobj\n" +
  "3 0 obj\n<< /Type /Metadata /Subtype /XML /Length " + xmp.length + " >>\nstream\n" + xmp + "\nendstream\nendobj\n" +
  "9 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 9 0 R >>\nendobj\n" +
  "trailer\n<< /Info 2 0 R >>\n%%EOF\n"
);

const rA = C.parseDocInfo(pdfA);
console.log("PDF_A：");
ok("hasInfo = true", rA.hasInfo === true);
ok("info.Title = Hello", rA.info.Title === "Hello");
ok("info.Author = Alice", rA.info.Author === "Alice");
ok("info.Subject = Test", rA.info.Subject === "Test");
ok("info.Keywords = PDF;test", rA.info.Keywords === "PDF;test");
ok("info.Creator = Acrobat", rA.info.Creator === "Acrobat");
ok("info.Producer = MyApp", rA.info.Producer === "MyApp");
ok("info.CreationDate 原始串", rA.info.CreationDate === "D:20231231120000+08'00'");
ok("infoHuman.CreationDate 解析", rA.infoHuman.CreationDate === "2023-12-31 12:00:00 (+08:00)");
ok("infoHuman.ModDate 解析(UTC)", rA.infoHuman.ModDate === "2024-01-01 00:00:00 UTC");
ok("info.Version = 1.4", rA.info.Version === "1.4");

console.log("PDF_A XMP：");
ok("hasMetadata = true", rA.hasMetadata === true);
ok("xmp.Title = XMP Title", rA.xmp.Title === "XMP Title");
ok("xmp.Creator 两值", Array.isArray(rA.xmp.Creator) && rA.xmp.Creator.length === 2 && rA.xmp.Creator[0] === "Creator A" && rA.xmp.Creator[1] === "Creator B");
ok("xmp.Description = Some desc", rA.xmp.Description === "Some desc");
ok("xmp.CreateDate 含 2023-12-31", typeof rA.xmp.CreateDate === "string" && rA.xmp.CreateDate.indexOf("2023-12-31") >= 0);
ok("xmp.ModifyDate 含 2024-01-01", typeof rA.xmp.ModifyDate === "string" && rA.xmp.ModifyDate.indexOf("2024-01-01") >= 0);
ok("xmp.CreatorTool = CreatorToolX", rA.xmp.CreatorTool === "CreatorToolX");
ok("xmp.Producer = XMPProducer", rA.xmp.Producer === "XMPProducer");
ok("xmp.Keywords = xk1;xk2", rA.xmp.Keywords === "xk1;xk2");
ok("xmp.DocumentID = uuid:abc-123", rA.xmp.DocumentID === "uuid:abc-123");
ok("xmpRaw 含 x:xmpmeta", typeof rA.xmpRaw === "string" && rA.xmpRaw.indexOf("<x:xmpmeta") >= 0);

// summarize / toMarkdown / toHtml
const sA = C.summarize(rA);
ok("summarize.title = Hello", sA.title === "Hello" && sA.hasInfo === true && sA.hasMetadata === true);
const mdA = C.toMarkdown(rA, { title: "X 文档信息" });
ok("toMarkdown 含文档信息字典", mdA.indexOf("文档信息字典") >= 0 && mdA.indexOf("标题") >= 0 && mdA.indexOf("XMP 元数据") >= 0);
const htmlA = C.toHtml(rA);
ok("toHtml 含标题/作者", htmlA.indexOf("标题") >= 0 && htmlA.indexOf("作者") >= 0 && htmlA.indexOf("XMP") >= 0);

// —— PDF_B：中文 UTF-16BE 标题/作者（字面值字节级解码） ——
function utf16be(str) {
  const out = [0xFE, 0xFF];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    out.push((cp >> 8) & 0xff, cp & 0xff);
  }
  return Uint8Array.from(out);
}
function concat(parts) {
  let len = 0; for (const p of parts) len += p.length;
  const buf = new Uint8Array(len); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
const titleBE = utf16be("中文标题");
const authorBE = utf16be("张三");
const pdfB = concat([
  enc("%PDF-1.7\n1 0 obj\n<< /Pages 9 0 R >>\nendobj\n2 0 obj\n<< /Title ("),
  titleBE,
  enc(") /Author ("),
  authorBE,
  enc(") /Subject (\u4e2d\u6587\u4e3b\u9898) >>\nendobj\n9 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] >>\nendobj\n5 0 obj\n<< /Type /Page /Parent 9 0 R >>\nendobj\ntrailer\n<< /Info 2 0 R >>\n%%EOF\n")
]);
const rB = C.parseDocInfo(pdfB);
console.log("PDF_B（中文 UTF-16BE）：");
ok("info.Title 中文解码 = 中文标题", rB.info.Title === "中文标题");
ok("info.Author 中文解码 = 张三", rB.info.Author === "张三");
ok("info.Subject 中文 = 中文主题", rB.info.Subject === "中文主题");
ok("toMarkdown 含中文标题", C.toMarkdown(rB).indexOf("中文标题") >= 0);

// —— PDF_C：无 /Info 无 /Metadata（负例） ——
const pdfC = enc("%PDF-1.7\n1 0 obj\n<< /Pages 9 0 R >>\nendobj\n9 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] >>\nendobj\n5 0 obj\n<< /Type /Page /Parent 9 0 R >>\nendobj\ntrailer\n<< >>\n%%EOF\n");
const rC = C.parseDocInfo(pdfC);
console.log("PDF_C（无信息）：");
ok("hasInfo = false", rC.hasInfo === false);
ok("hasMetadata = false", rC.hasMetadata === false);
ok("info = null", rC.info === null);
ok("xmp = null", rC.xmp === null);

console.log("\n=== PDF DocInfo 测试：" + pass + " 通过 / " + fail + " 失败 ===");
process.exit(fail ? 1 : 0);
