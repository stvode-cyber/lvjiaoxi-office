/* PDF 链接/URI 提取（AH）纯模块单测 —— 零依赖，node 直跑 */
const A = require("./app/js/modules/pdf-links.js");

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
function contains(name, hay, needle) {
  const r = (hay || "").indexOf(needle) >= 0;
  console.log((r ? "  ✔ " : "  ✘ ") + name + (r ? "" : "  (missing: " + needle + ")"));
  r ? pass++ : fail++;
}

// —— 字节组装工具（与结构树/附件测试同款）——
function enc(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
function assemble(parts) {
  let len = 0; parts.forEach(p => len += (p instanceof Uint8Array ? p.length : p.length));
  const out = new Uint8Array(len); let o = 0;
  parts.forEach(p => { const b = (p instanceof Uint8Array) ? p : enc(p); out.set(b, o); o += b.length; });
  return out;
}

// 十六进制外链 "http://c.com" 的 UTF-16BE（带 FEFF BOM）
const HEX_C = "FEFF0068007400740070003A002F002F0063002E0063006F006D";

// —— 合成 PDF：标注链接(a,page2) + 大纲链接(b) + 标注GoTo(g,page3) + 十六进制外链(c) ——
const pdf = assemble([
  "%PDF-1.4\n",
  "1 0 obj << /Type /Catalog /Pages 2 0 R /Outlines 9 0 R >> endobj\n",
  "2 0 obj << /Type /Pages /Kids [5 0 R 6 0 R 7 0 R] /Count 3 >> endobj\n",
  // 标注链接 a（/Subtype /Link，/P 2 0 R → 第2页对象）
  "3 0 obj << /Type /Annot /Subtype /Link /P 2 0 R /A << /S /URI /URI (http://a.com) >> >> endobj\n",
  // 标注 GoTo g（/P 3 0 R → 第3页对象）
  "4 0 obj << /Type /Annot /Subtype /Link /P 3 0 R /A << /S /GoTo /D [3 /Fit] >> >> endobj\n",
  // 十六进制外链 c（独立 action，不在标注/大纲内）
  "5 0 obj << /Type /Page /Parent 2 0 R >> endobj\n",
  "6 0 obj << /Type /Page /Parent 2 0 R >> endobj\n",
  "7 0 obj << /Type /Page /Parent 2 0 R >> endobj\n",
  // 大纲条目 b（/Title + /A /URI）
  "8 0 obj << /Title (TOC) /A << /S /URI /URI (http://b.com) >> >> endobj\n",
  "9 0 obj << /Type /Outlines /First 8 0 R >> endobj\n",
  // 含十六进制外链 c 的 openaction 对象
  "10 0 obj << /S /URI /URI <" + HEX_C + "> >> endobj\n",
  "trailer << /Root 1 0 R >>\n%%EOF"
]);

const res = A.extractLinks(pdf);

// 1-4 数量统计
eq("total", res.total, 4);
eq("uriCount", res.uriCount, 3);
eq("gotoCount", res.gotoCount, 1);
eq("externalCount", res.externalCount, 3);

// 5-7 标注来源 a（含页对象号）
const a = res.links.find(l => l.target === "http://a.com");
ok("found a.com", !!a);
eq("a source", a && a.source, "annotation");
eq("a page", a && a.page, 2);

// 8-9 大纲来源 b
const b = res.links.find(l => l.target === "http://b.com");
ok("found b.com", !!b);
eq("b source", b && b.source, "outline");

// 10-11 十六进制解码 c
const c = res.links.find(l => l.target === "http://c.com");
ok("found hex c.com", !!c);
eq("c decoded", c && c.target, "http://c.com");

// 12 GoTo g
const g = res.links.find(l => l.kind === "goto");
ok("found goto", !!g);
eq("goto target", g && g.target, "3");

// 13 byPage 统计
ok("byPage has 2", res.byPage[2] === 1);
ok("byPage has 3", res.byPage[3] === 1);

// 14-15 summarize
const sum = A.summarize(res);
eq("sum.total", sum.total, 4);
eq("sum.pagesWithLinks", sum.pagesWithLinks, 2);

// 16-17 toMarkdown
const md = A.toMarkdown(res, { title: "测试 链接审计" });
contains("md: has a", md, "http://a.com");
contains("md: has b", md, "http://b.com");
contains("md: has goto", md, "内部跳转");

// 18-19 toHtml
const html = A.toHtml(res);
contains("html: a link", html, "http://a.com");
contains("html: clickable anchor", html, 'href="http://a.com"');

// 20-22 边界：空 / 无链接
eq("empty input total", A.extractLinks(new Uint8Array(0)).total, 0);
const pdfNo = assemble(["%PDF-1.4\n", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n", "2 0 obj << /Type /Pages >> endobj\n", "%%EOF"]);
eq("no links total", A.extractLinks(pdfNo).total, 0);

// 23 decodeHexUtf16 边界
eq("hex empty", A.decodeHexUtf16(""), "");
eq("hex AB", A.decodeHexUtf16("FEFF00410042"), "AB");

// 24 转义字面串（括号平衡）
const lit = A._matchLiteral("/URI (a\\)b (x) more)", 5);
eq("matchLiteral escaped", lit.content, "a)b (x) more");

console.log("\n=== PDF Links: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
