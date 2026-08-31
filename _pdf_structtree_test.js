/* PDF 文档结构树（StructTreeRoot）纯模块单测 —— 零依赖，node 直跑 */
const A = require("./app/js/modules/pdf-structtree.js");

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const ok = got === exp;
  console.log((ok ? "  ✔ " : "  ✘ ") + name + "  got=" + JSON.stringify(got) + (ok ? "" : " exp=" + JSON.stringify(exp)));
  ok ? pass++ : fail++;
}
function ok(name, cond) {
  console.log((cond ? "  ✔ " : "  ✘ ") + name);
  cond ? pass++ : fail++;
}

// —— 字节组装（ASCII 内容安全；中文标题走十六进制串避免 enc 截断）——
function enc(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
function assemble(parts) {
  let len = 0; parts.forEach(p => len += (p instanceof Uint8Array ? p.length : p.length));
  const out = new Uint8Array(len); let o = 0;
  parts.forEach(p => { const b = (p instanceof Uint8Array) ? p : enc(p); out.set(b, o); o += b.length; });
  return out;
}

// —— 合成 ①：嵌套结构 + MCID 叶子 + 多页 ——
// StructTreeRoot /K [4 0 R 7 0 R]；4(H1,有标题,P1)→/K[6 0 R]；6(P,无标题,P1,/K[0] MCID 叶子)；7(P,无标题,P2)
const pdf1 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /StructTreeRoot 2 0 R /Pages 3 0 R >> endobj\n",
  "2 0 obj << /Type /StructTreeRoot /K [ 4 0 R 7 0 R ] >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [5 0 R 8 0 R] /Count 2 >> endobj\n",
  "4 0 obj << /Type /StructElem /S /H1 /T (Chapter One) /Pg 5 0 R /K [ 6 0 R ] >> endobj\n",
  "5 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "6 0 obj << /Type /StructElem /S /P /Pg 5 0 R /K [ 0 ] >> endobj\n",
  "7 0 obj << /Type /StructElem /S /P /Pg 8 0 R >> endobj\n",
  "8 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const t1 = A.parseRawStructTree(pdf1);

// 1-11 树形结构
eq("tree length", t1.length, 2);
eq("top[0].type", t1[0].type, "H1");
eq("top[0].title", t1[0].title, "Chapter One");
eq("top[0].page", t1[0].page, 1);
eq("top[0].children.length", t1[0].children.length, 1);
eq("top[0].child.type", t1[0].children[0].type, "P");
eq("top[0].child.title(fallback)", t1[0].children[0].title, "P");
eq("top[0].child.page", t1[0].children[0].page, 1);
eq("top[1].type", t1[1].type, "P");
eq("top[1].title(fallback)", t1[1].title, "P");
eq("top[1].page", t1[1].page, 2);

// 12-13 扁平化
const flat = A.flattenStruct(t1);
eq("flatten length", flat.length, 3);
ok("flatten levels", flat[0].level === 0 && flat[1].level === 1 && flat[2].level === 0);

// 14-15 toMarkdown
const md = A.toMarkdown(t1);
ok("md: has H1 label", md.indexOf("H1: Chapter One") >= 0);
ok("md: has page", md.indexOf("(p.1)") >= 0);

// 16-17 toHtml
const html = A.toHtml(t1);
ok("html: data-page 1", html.indexOf("data-page='1'") >= 0);
ok("html: data-page 2", html.indexOf("data-page='2'") >= 0);

// 18-19 搜索
const s1 = A.searchStruct(t1, "Chapter One");
eq("search by title: top count", s1.length, 1);
eq("search by title: child kept", s1[0].children.length, 1);
const s2 = A.searchStruct(t1, "P");
eq("search by type P: count", s2.length, 2);

// 20-21 空/无结构
eq("empty input", A.parseRawStructTree(new Uint8Array(0)).length, 0);
const pdfNo = assemble(["%PDF-1.4\n", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n", "2 0 obj << /Type /Pages >> endobj\n", "%%EOF"]);
eq("no StructTreeRoot", A.parseRawStructTree(pdfNo).length, 0);

// —— 合成 ②：十六进制 UTF-16BE 标题 + /Document 语义 ——
// 4 0 obj << /S /Document /T <FEFF00410042> /Pg 5 0 R >>  → 标题 "AB"
const pdf2 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /StructTreeRoot 2 0 R /Pages 3 0 R >> endobj\n",
  "2 0 obj << /Type /StructTreeRoot /K [ 4 0 R ] >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [5 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /StructElem /S /Document /T <FEFF00410042> /Pg 5 0 R >> endobj\n",
  "5 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const t2 = A.parseRawStructTree(pdf2);
eq("hex: type", t2[0].type, "Document");
eq("hex: decoded title", t2[0].title, "AB");
eq("hex: page", t2[0].page, 1);

// —— 合成 ③：/K 非数组（单个引用，无方括号）—— 退化为单引用解析 ——
const pdf3 = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /StructTreeRoot 2 0 R /Pages 3 0 R >> endobj\n",
  "2 0 obj << /Type /StructTreeRoot /K 4 0 R >> endobj\n",
  "3 0 obj << /Type /Pages /Kids [5 0 R] /Count 1 >> endobj\n",
  "4 0 obj << /Type /StructElem /S /Sect /T (Sec) /Pg 5 0 R >> endobj\n",
  "5 0 obj << /Type /Page /Parent 3 0 R >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);
const t3 = A.parseRawStructTree(pdf3);
eq("non-array K: count", t3.length, 1);
eq("non-array K: type", t3[0].type, "Sect");
eq("non-array K: page", t3[0].page, 1);

console.log("\n=== PDF StructTree: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
