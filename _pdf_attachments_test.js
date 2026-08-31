/* AC 测试：PDF 附件（EmbeddedFiles）提取与解压 */
const zlib = require("zlib");
const A = require("./app/js/modules/pdf-attachments.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }
function eq(name, a, b) { ok(name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", JSON.stringify(a) === JSON.stringify(b)); }

// 把字符串转成 latin1 字节
function enc(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
// 拼接 ascii 段 + 二进制段
function assemble(parts) {
  let len = 0; parts.forEach(p => len += (p instanceof Uint8Array ? p.length : p.length));
  const out = new Uint8Array(len); let o = 0;
  parts.forEach(p => { const b = (p instanceof Uint8Array) ? p : enc(p); out.set(b, o); o += b.length; });
  return out;
}
// Uint8Array → 字符串
function b2s(u) { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] & 0xff); return s; }
// 生成 UTF-16BE 十六进制 PDF 字串（含 FEFF BOM）
function utf16beHex(str) {
  let h = "FEFF";
  for (let i = 0; i < str.length; i++) h += ("0000" + str.charCodeAt(i).toString(16)).slice(-4);
  return h;
}

// —— 合成 ①：平铺 Names + FlateDecode 压缩 + /F 文件名 ——
const payload1 = "hello world";                       // 11 字节
const comp1 = new Uint8Array(zlib.deflateRawSync(Buffer.from(payload1)));
const pdf1 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /Names << /EmbeddedFiles << /Names [(report.txt) 2 0 R] >> >> /Pages 3 0 R >> endobj\n",
  "2 0 obj << /Type /Filespec /F (report.txt) /EF << /F 4 0 R >> >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [5 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /EmbeddedFile /Subtype /text#2Fplain /Filter /FlateDecode /Params << /Size " + payload1.length + " >> >> stream\n",
  comp1,
  "\nendstream endobj\n",
  "5 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const a1 = A.parseRawAttachments(pdf1);

// 1. 解析出 1 个附件
eq("flat: count", a1.length, 1);
// 2. 文件名来自 /F
eq("flat: name", a1[0].name, "report.txt");
// 3. mime 来自 /Subtype text#2Fplain → text/plain
eq("flat: mime", a1[0].mime, "text/plain");
// 4. 解压后 size
eq("flat: size", a1[0].size, payload1.length);
// 5. 解压成功（FlateDecode 已解）
eq("flat: compressed flag", a1[0].compressed, false);
// 6. 解压内容还原
eq("flat: content", b2s(a1[0].data), "hello world");

// —— 合成 ②：/Kids 递归 + /UF 文件名优先 + 未压缩流 ——
// 注：enc() 仅做 latin1 字节，故此处用 ASCII 文件名避免多字节截断假象；
// 真正的多字节（中文）文件名解码由下方 pdf4（UTF-16BE 十六进制串）覆盖。
const payload2 = "plain attachment data";             // 21 字节（未压缩）
const pdf2 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /Names << /EmbeddedFiles << /Kids [6 0 R] >> >> /Pages 3 0 R >> endobj\n",
  "2 0 obj << /Type /Filespec /UF (fileA.txt) /F (A.txt) /EF << /UF 4 0 R >> >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [5 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /EmbeddedFile /Subtype /text#2Fplain >> stream\n", enc(payload2), "\nendstream endobj\n",
  "5 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "6 0 obj << /Names [(fileA.txt) 2 0 R] >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const a2 = A.parseRawAttachments(pdf2);
// 7. /Kids 递归定位到 1 个附件
eq("kids: count", a2.length, 1);
// 8. /UF 优先于 /F 作为文件名
eq("kids: uf name", a2[0].name, "fileA.txt");
// 9. 未压缩流：compressed=false 且内容原样
eq("kids: compressed flag", a2[0].compressed, false);
eq("kids: content", b2s(a2[0].data), payload2);
eq("kids: size", a2[0].size, payload2.length);

// —— 合成 ③：两个附件（平铺 Names 多对）+ 第二附件 FlateDecode ——
const payload3a = "first file contents";
const payload3b = "second compressed";
const comp3b = new Uint8Array(zlib.deflateRawSync(Buffer.from(payload3b)));
const pdf3 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /Names << /EmbeddedFiles << /Names [(a.txt) 2 0 R (b.bin) 3 0 R] >> >> /Pages 4 0 R >> endobj\n",
  "2 0 obj << /Type /Filespec /F (a.txt) /EF << /F 5 0 R >> >> endobj\n",
  "3 0 obj << /Type /Filespec /F (b.bin) /EF << /F 6 0 R >> >> endobj\n",
  "4 0 obj << /Type /Pages /Kids [7 0 R] /Count 1 >> endobj\n",
  "5 0 obj << /Type /EmbeddedFile /Subtype /text#2Fplain >> stream\n", enc(payload3a), "\nendstream endobj\n",
  "6 0 obj << /Type /EmbeddedFile /Filter /FlateDecode /Params << /Size " + payload3b.length + " >> >> stream\n", comp3b, "\nendstream endobj\n",
  "7 0 obj << /Type /Page /Parent 4 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const a3 = A.parseRawAttachments(pdf3);
// 10. 平铺多对 → 2 个附件
eq("multi: count", a3.length, 2);
eq("multi: names", a3.map(x => x.name), ["a.txt", "b.bin"]);
eq("multi: a content", b2s(a3[0].data), payload3a);
eq("multi: b decompressed", b2s(a3[1].data), payload3b);

// —— 合成 ④：UTF-16BE 十六进制 /UF 文件名（中文文件名真实编码方式）——
// payload 用 ASCII，避免 enc() 对多字节正文截断造成的测试假象；
// 此处重点验证「中文文件名」经模块自身 hex/UTF-16BE 解码是否正确。
const payload4 = "attachment payload v4 (ascii)";
const cnName = "附件.txt";                            // 真实中文文件名
const pdf4 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /Names << /EmbeddedFiles << /Names [<" + utf16beHex(cnName) + "> 2 0 R] >> >> /Pages 3 0 R >> endobj\n",
  "2 0 obj << /Type /Filespec /UF <" + utf16beHex(cnName) + "> /EF << /F 4 0 R >> >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [5 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /EmbeddedFile /Subtype /text#2Fplain >> stream\n", enc(payload4), "\nendstream endobj\n",
  "5 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const a4 = A.parseRawAttachments(pdf4);
// 11. UTF-16BE 中文文件名正确解码
eq("utf16be: count", a4.length, 1);
eq("utf16be: name", a4[0].name, cnName);
eq("utf16be: content", b2s(a4[0].data), payload4);

// —— 边界：无 EmbeddedFiles / 空输入 / 单树节点无文件 ——
eq("no embeddedfiles", A.parseRawAttachments("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"), []);
eq("empty input", A.parseRawAttachments(""), []);
eq("empty input (null)", A.parseRawAttachments(null), []);
// 名称树指向不存在的 filespec → 跳过，得空
const pdfBad = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /Names << /EmbeddedFiles << /Names [(x) 99 0 R] >> >> /Pages 2 0 R >> endobj\n",
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
  "3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
eq("dangling ref -> empty", A.parseRawAttachments(pdfBad), []);

// —— decodeName / subtypeToMime 单元 ——
eq("decodeName #2F", A._decodeName("text#2Fplain"), "text/plain");
eq("mime xml", A._subtypeToMime("application#2Fxml"), "application/xml");
eq("mime unknown", A._subtypeToMime(""), "application/octet-stream");

// —— toMarkdown 导出 ——
const md = A.toMarkdown(a3);
ok("md has a.txt", md.indexOf("a.txt") !== -1);
ok("md has b.bin", md.indexOf("b.bin") !== -1);
ok("md empty list", A.toMarkdown([]) === "（无附件）");

console.log("AC PDF 附件 EmbeddedFiles：" + (fail === 0 ? "通过 " + pass + " / " + pass + "，全部通过 ✅" : pass + " 通过, " + fail + " 失败 ❌"));
process.exit(fail === 0 ? 0 : 1);
