/* AR：PDF 文档历史 / 增量更新审计（OS.PdfHistory）单测 —— 8 组合成 PDF × 多断言 */
"use strict";
const T = require("./app/js/modules/pdf-history.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok  - " + name); }
  else { fail++; console.log("FAIL  - " + name); }
}
function section(t) { console.log("\n== " + t + " =="); }

function toBytes(s) {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}

// 增量更新构造器：bodies[i]=该版追加对象文本，sizes[i]=/Size，roots[i]=/Root 对象号，
// infos[i]=/Info 对象号（可空）。自动把上一版 xref 偏移写入 /Prev，startxref 用 pdf.length 精确计算（不手算）。
function makeIncremental(bodies, sizes, roots, infos) {
  let pdf = "%PDF-1.4\n";
  let prev = null;
  for (let i = 0; i < bodies.length; i++) {
    pdf += bodies[i] + "\n";
    const xrefOffset = pdf.length;
    pdf += "xref\n0 " + sizes[i] + "\n0000000000 65535 f \n";
    pdf += "trailer\n<< /Size " + sizes[i] + " /Root " + roots[i] + " 0 R";
    if (prev != null) pdf += " /Prev " + prev;
    if (infos && infos[i]) pdf += " /Info " + infos[i] + " 0 R";
    pdf += " >>\nstartxref\n" + xrefOffset + "\n%%EOF\n";
    prev = xrefOffset;
  }
  return pdf;
}

const B1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj";
const B2 = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj";

(function main() {

  // ---------- A：单版本 → single ----------
  section("A 单版本（仅保存一次）");
  const A = T.parse(toBytes(makeIncremental([B1], [4], [1], [null])));
  ok("A1 versionCount=1", A.summary.versionCount === 1);
  ok("A2 verdict=single", A.summary.verdict === "single");
  ok("A3 eofCount=1", A.summary.eofCount === 1);
  ok("A4 startxrefCount=1", A.summary.startxrefCount === 1);
  ok("A5 versions[0].size=4", A.versions[0].size === 4);
  ok("A6 versions[0].rootRef=1", A.versions[0].rootRef === 1);
  ok("A7 versions[0].hasPrev=false", A.versions[0].hasPrev === false);
  ok("A8 无 warn", A.summary.chainBroken === false && A.summary.verdict !== "broken");

  // ---------- B：两版本增量 → multi + /Prev 链 ----------
  section("B 两版本增量更新");
  const B = T.parse(toBytes(makeIncremental([B1, B2], [4, 5], [1, 1], [null, null])));
  ok("B1 versionCount=2", B.summary.versionCount === 2);
  ok("B2 verdict=multi", B.summary.verdict === "multi");
  ok("B3 eofCount=2", B.summary.eofCount === 2);
  ok("B4 startxrefCount=2", B.summary.startxrefCount === 2);
  ok("B5 v1.hasPrev=false", B.versions[0].hasPrev === false);
  ok("B6 v2.hasPrev=true", B.versions[1].hasPrev === true);
  ok("B7 v2.prev=v1.xrefOffset", B.versions[1].prev === B.versions[0].xrefOffset);
  ok("B8 v2.size=5", B.versions[1].size === 5);

  // ---------- C：三版本 → 逐版信息正确 ----------
  section("C 三版本增量更新");
  const B3 = "5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>\nendobj";
  const C = T.parse(toBytes(makeIncremental([B1, B2, B3], [4, 5, 6], [1, 1, 1], [null, null, null])));
  ok("C1 versionCount=3", C.summary.versionCount === 3);
  ok("C2 v3.prev=v2.xrefOffset", C.versions[2].prev === C.versions[1].xrefOffset);
  ok("C3 v3.size=6", C.versions[2].size === 6);
  ok("C4 v1/v2/v3 顺序正确", C.versions[0].version === 1 && C.versions[1].version === 2 && C.versions[2].version === 3);

  // ---------- D：线性化 → linearized ----------
  section("D 线性化文档");
  const Db1 = "1 0 obj\n<< /Linearized 1 /Type /Catalog /Pages 2 0 R >>\nendobj";
  const D = T.parse(toBytes(makeIncremental([Db1], [2], [1], [null])));
  ok("D1 linearized=true", D.summary.linearized === true);
  ok("D2 含 linearized check", D.checks.some(c => c.id === "linearized"));

  // ---------- E：xref 流 → viaStream ----------
  section("E 交叉引用流（PDF 1.5+）");
  const eBody = "%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  const xobj = "5 0 obj\n<< /Type /XRef /Size 6 /Root 1 0 R /W [1 2 1] /Length 12 >>\nstream\n0123456789ab\nendstream\nendobj\n";
  const xrOff = eBody.length;
  const E = T.parse(toBytes(eBody + xobj + "startxref\n" + xrOff + "\n%%EOF\n"));
  ok("E1 hasXrefStream=true", E.summary.hasXrefStream === true);
  ok("E2 versionCount=1", E.summary.versionCount === 1);
  ok("E3 versions[0].viaStream=true", E.versions[0].viaStream === true);
  ok("E4 rootRef=1", E.versions[0].rootRef === 1);

  // ---------- F：%%EOF 与 startxref 不一致 → count-mismatch ----------
  section("F 计数不一致（截断）");
  const F = T.parse(toBytes(makeIncremental([B1, B2], [4, 5], [1, 1], [null, null]).replace(/%%EOF\s*$/, "")));
  ok("F1 eofCount=1（被截断）", F.summary.eofCount === 1);
  ok("F2 startxrefCount=2", F.summary.startxrefCount === 2);
  ok("F3 含 count-mismatch warn", F.checks.some(c => c.id === "count-mismatch" && c.level === "warn"));
  ok("F4 verdict=broken", F.summary.verdict === "broken");

  // ---------- G：/Prev 链断裂 → broken ----------
  section("G /Prev 链断裂");
  const g1 = B1;
  const off1 = g1.length;
  const gPart1 = g1 + "xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n" + off1 + "\n%%EOF\n";
  const gBody2 = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  const off2 = gPart1.length + gBody2.length;
  const G = T.parse(toBytes(gPart1 + gBody2 + "xref\n0 2\n0000000000 65535 f \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n" + off2 + "\n%%EOF\n"));
  ok("G1 startxrefCount=2", G.summary.startxrefCount === 2);
  ok("G2 versionCount=1（链断裂只回溯 1 版）", G.summary.versionCount === 1);
  ok("G3 chainBroken=true", G.summary.chainBroken === true);
  ok("G4 verdict=broken", G.summary.verdict === "broken");

  // ---------- H：导出 MD / HTML ----------
  section("H 导出");
  const H = T.parse(toBytes(makeIncremental([B1, B2], [4, 5], [1, 1], [null, null])));
  const md = T.toMarkdown(H);
  const html = T.toHtml(H);
  ok("H1 MD 含结论", md.indexOf("多版本") >= 0);
  ok("H2 MD 含版本表", md.indexOf("| v1 |") >= 0 && md.indexOf("| v2 |") >= 0);
  ok("H3 MD 含标题", md.indexOf("PDF 文档历史报告") >= 0);
  ok("H4 HTML 含版本", html.indexOf("v2") >= 0);
  ok("H5 HTML 含 xref", html.indexOf("xref") >= 0);

  console.log("\n=== 结果：" + pass + " 通过 / " + fail + " 失败 ===");
  process.exit(fail ? 1 : 0);
})();
