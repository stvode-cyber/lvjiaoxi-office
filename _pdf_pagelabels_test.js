/* AD = PDF 页码标签（PageLabels）解析与导航 —— 单测
 * 覆盖：间接引用 / 内联 / hex 中文前缀(FEFF BOM 剥离) / /St 自定义 / 无 PageLabels / 空输入
 *      / 标签↔页码互查 / 罗马数字 / 双射字母 转换单测
 */
const A = require("./app/js/modules/pdf-pagelabels.js");

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error("✗ " + name + "\n    got : " + g + "\n    want: " + w); }
}
function ok(name, cond) {
  if (cond) pass++; else { fail++; console.error("✗ " + name); }
}

// —— 字节装配（PDF 内容均为 ASCII）——
function enc(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
function assemble(parts) {
  let len = 0;
  parts.forEach(p => len += (p instanceof Uint8Array ? p.length : p.length));
  const out = new Uint8Array(len);
  let o = 0;
  parts.forEach(p => { const b = (p instanceof Uint8Array) ? p : enc(p); out.set(b, o); o += b.length; });
  return out;
}

// —— 合成①：间接引用 /PageLabels 2 0 R，三段样式 ——
const pdf1 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /PageLabels 2 0 R /Pages 3 0 R >> endobj\n",
  "2 0 obj << /Nums [ 0 << /S /D >> 2 << /S /r /P (Pre-) >> 5 << /S /A /St 1 >> ] >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const leaves1 = A.parseRawPageLabels(pdf1);
eq("indirect: leaf count", leaves1.length, 3);
eq("indirect: leaf0", { start: leaves1[0].start, style: leaves1[0].style, first: leaves1[0].first }, { start: 0, style: "D", first: 1 });
eq("indirect: leaf1 style+prefix", { style: leaves1[1].style, prefix: leaves1[1].prefix }, { style: "r", prefix: "Pre-" });
eq("indirect: leaf2 style+first", { style: leaves1[2].style, first: leaves1[2].first }, { style: "A", first: 1 });
const labels1 = A.buildLabels(8, leaves1);
eq("indirect: buildLabels", labels1, ["1", "2", "Pre-i", "Pre-ii", "Pre-iii", "A", "B", "C"]);

// —— 合成②：内联 /PageLabels，hex 前缀(0042=B) + /St 10 + 十进制 ——
const pdf2 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /PageLabels << /Nums [ 0 << /S /D >> 3 << /S /D /St 10 /P <0042> >> ] >> /Pages 3 0 R >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const leaves2 = A.parseRawPageLabels(pdf2);
eq("inline: leaf count", leaves2.length, 2);
eq("inline: leaf1 prefix+first", { prefix: leaves2[1].prefix, first: leaves2[1].first, style: leaves2[1].style }, { prefix: "B", first: 10, style: "D" });
const labels2 = A.buildLabels(6, leaves2);
eq("inline: buildLabels", labels2, ["1", "2", "3", "B10", "B11", "B12"]);

// —— 合成③：hex 中文前缀 + FEFF BOM 剥离 ——
const pdf3 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /PageLabels << /Nums [ 0 << /S /D /P <FEFF9644> >> ] >> /Pages 3 0 R >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
eq("cjk-hex(FEFF): buildLabels", A.buildLabels(2, A.parseRawPageLabels(pdf3)), ["附1", "附2"]);

// —— 合成④：hex 中文前缀(无 BOM) ——
const pdf4 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /PageLabels << /Nums [ 0 << /S /D /P <9644> >> ] >> /Pages 3 0 R >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
eq("cjk-hex(noBOM): buildLabels", A.buildLabels(2, A.parseRawPageLabels(pdf4)), ["附1", "附2"]);

// —— 无 PageLabels / 空输入 ——
const pdfNo = assemble(["%PDF-1.4\n", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n", "trailer << /Root 1 0 R >>\n%%EOF"]);
eq("no labels: parseRawPageLabels", A.parseRawPageLabels(pdfNo), []);
eq("no labels: buildLabels default decimal", A.buildLabels(5, []), ["1", "2", "3", "4", "5"]);
eq("null input: parseRawPageLabels", A.parseRawPageLabels(null), []);
eq("zero pages: buildLabels", A.buildLabels(0, []), []);

// —— 标签 ↔ 页码 互查 ——
eq("labelToPage: Pre-i", A.labelToPage(labels1, "Pre-i"), 3);
eq("labelToPage: Pre-ii", A.labelToPage(labels1, "Pre-ii"), 4);
eq("labelToPage: A", A.labelToPage(labels1, "A"), 6);
eq("labelToPage: case-insensitive", A.labelToPage(labels1, "pre-ii"), 4);
eq("labelToPage: not found", A.labelToPage(labels1, "zzz"), -1);
eq("labelToPage: decimal", A.labelToPage(["1", "2", "3"], "2"), 2);
eq("pageToLabel: 6", A.pageToLabel(labels1, 6), "A");
eq("pageToLabel: 1", A.pageToLabel(labels1, 1), "1");
eq("pageToLabel: out of range", A.pageToLabel(labels1, 99), "");

// —— 转换函数单测 ——
eq("toRoman(4,upper)", A.toRoman(4, true), "IV");
eq("toRoman(1990,upper)", A.toRoman(1990, true), "MCMXC");
eq("toRoman(4,lower)", A.toRoman(4, false), "iv");
eq("toRoman(0)", A.toRoman(0, true), "");
eq("toBijectiveAlpha(1)", A.toBijectiveAlpha(1, true), "A");
eq("toBijectiveAlpha(26)", A.toBijectiveAlpha(26, true), "Z");
eq("toBijectiveAlpha(27)", A.toBijectiveAlpha(27, true), "AA");
eq("toBijectiveAlpha(28)", A.toBijectiveAlpha(28, true), "AB");
eq("toBijectiveAlpha(1,lower)", A.toBijectiveAlpha(1, false), "a");

console.log("\nAD pdf-pagelabels: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
