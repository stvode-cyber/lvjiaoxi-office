/* AQ：PDF 结构预检（OS.PdfPreflight）单测 —— 8 组合成 PDF × 多断言 */
"use strict";
const OS = require("./app/js/pdf-tool.js");          // 提供 _inflate/_deflate/parseObjStm + 初始化全局 OS
const T = require("./app/js/modules/pdf-preflight.js");

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
function findCheck(res, id) { return res.checks.find(c => c.id === id) || null; }
function levelOf(res, id) { const c = findCheck(res, id); return c ? c.level : null; }

// 健康文档构造器（1 Catalog / 2 Pages / 3 Page + xref 表 + trailer + startxref）
function healthy() {
  return "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000060 00000 n \n0000000119 00000 n \n" +
    "trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n";
}

(async function main() {

  // ---------- A：健康文档 → pass，零问题 ----------
  section("A 健康文档");
  const A = await T.parse(toBytes(healthy()));
  ok("A1 verdict=pass", A.summary.verdict === "pass");
  ok("A2 零错误零警告", A.summary.errors === 0 && A.summary.warnings === 0);
  ok("A3 页数=1", A.summary.pageCount === 1);
  ok("A4 对象数=3", A.summary.objectCount === 3);
  ok("A5 引用计数>0", A.summary.totalRefs >= 4);
  ok("A6 xref 表识别", A.hasXrefTable === true && A.hasXrefStream === false);
  ok("A7 Root=1 /Size=4 /maxNum=3", A.rootRef === 1 && A.sizeVal === 4 && A.maxNum === 3);
  ok("A8 检查项=0", A.summary.checksCount === 0);

  // ---------- B：悬挂引用 ----------
  section("B 悬挂引用（/Outlines 99 0 R 未定义）");
  const bStr = healthy().replace("<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Catalog /Pages 2 0 R /Outlines 99 0 R >>");
  const B = await T.parse(toBytes(bStr));
  ok("B1 verdict=errors", B.summary.verdict === "errors");
  ok("B2 dangling-refs=error", levelOf(B, "dangling-refs") === "error");
  ok("B3 缺失对象=99", (findCheck(B, "dangling-refs") || {}).detail || "".indexOf ? (findCheck(B, "dangling-refs").detail.indexOf("99") >= 0) : false);
  ok("B4 错误数≥1", B.summary.errors >= 1);

  // ---------- C：重复对象定义 ----------
  section("C 重复对象定义");
  const cStr = healthy().replace("xref\n", "3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\nxref\n");
  const C = await T.parse(toBytes(cStr));
  ok("C1 verdict=warnings", C.summary.verdict === "warnings");
  ok("C2 duplicate-objects=warn", levelOf(C, "duplicate-objects") === "warn");
  ok("C3 数量=1", (findCheck(C, "duplicate-objects") || {}).count === 1);
  ok("C4 零错误", C.summary.errors === 0);

  // ---------- D：缺 trailer /Root ----------
  section("D 缺 trailer /Root");
  const dStr = "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000060 00000 n \n0000000119 00000 n \n" +
    "startxref\n9\n%%EOF\n";
  const D = await T.parse(toBytes(dStr));
  ok("D1 verdict=errors", D.summary.verdict === "errors");
  ok("D2 trailer-root=error", levelOf(D, "trailer-root") === "error");
  ok("D3 rootRef=0", D.rootRef === 0);

  // ---------- E：页面树环（安全走树，不得栈溢出） ----------
  section("E 页面树环");
  const eStr = "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 2 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 2 >>\nendobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000060 00000 n \n0000000119 00000 n \n" +
    "trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n";
  const E = await T.parse(toBytes(eStr));
  ok("E1 verdict=errors（未栈溢出）", E.summary.verdict === "errors");
  ok("E2 page-tree-cycle=error", levelOf(E, "page-tree-cycle") === "error");
  ok("E3 环计数=1", (findCheck(E, "page-tree-cycle") || {}).count === 1);

  // ---------- F：流 /Length 三态（缺失 / 间接引用 / 失配） ----------
  section("F 流 /Length 三态");
  const fStr = "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n" +
    "4 0 obj\n<< /Length 500 >>\nstream\nBT ET\nendstream\nendobj\n" +
    "5 0 obj\n<< /Type /XObject /Subtype /Image >>\nstream\nDATA\nendstream\nendobj\n" +
    "6 0 obj\n<< /Length 7 0 R >>\nstream\nAB\nendstream\nendobj\n" +
    "7 0 obj\n<< /Length 2 >>\nendobj\n" +
    "xref\n0 8\n0000000000 65535 f \n0000000009 00000 n \n0000000060 00000 n \n0000000119 00000 n \n0000000200 00000 n \n0000000260 00000 n \n0000000330 00000 n \n0000000400 00000 n \n" +
    "trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n";
  const F = await T.parse(toBytes(fStr));
  ok("F1 verdict=warnings", F.summary.verdict === "warnings");
  ok("F2 stream-length-mismatch=warn", levelOf(F, "stream-length-mismatch") === "warn");
  ok("F3 失配对象=4 且声明500≠实际5", ((findCheck(F, "stream-length-mismatch") || {}).detail || "").indexOf("500") >= 0);
  ok("F4 stream-length-missing=warn", levelOf(F, "stream-length-missing") === "warn");
  ok("F5 stream-length-ref=info", levelOf(F, "stream-length-ref") === "info");
  ok("F6 零错误", F.summary.errors === 0);

  // ---------- G：ObjStm（PDF 1.5+）健康文档无误报 ----------
  section("G ObjStm 健康文档");
  const d2 = "<< /Type /Catalog /Pages 3 0 R >>";
  const d3 = "<< /Type /Pages /Kids [4 0 R] /Count 1 >>";
  const d4 = "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] >>";
  const seg2 = "2 0 " + d2 + "\n";
  const seg3 = "3 0 " + d3 + "\n";
  const seg4 = "4 0 " + d4;
  const off3 = seg2.length, off4 = off3 + seg3.length;
  const head = "2 0 3 " + off3 + " 4 " + off4 + " ";
  const body = head + seg2 + seg3 + seg4;
  const comp = await OS._deflate(body);
  const gStr = "%PDF-1.5\n" +
    "1 0 obj\n<< /Type /ObjStm /N 3 /First " + head.length + " /Filter /FlateDecode /Length " + comp.length + " >>\nstream\n" + OS._toStr(comp) + "\nendstream\nendobj\n" +
    "xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \n" +
    "trailer\n<< /Size 5 /Root 2 0 R >>\nstartxref\n9\n%%EOF\n";
  const G = await T.parse(toBytes(gStr));
  ok("G1 verdict=pass", G.summary.verdict === "pass");
  ok("G2 对象数=4（容器展开后移除）", G.summary.objectCount === 3);
  ok("G3 页数=1", G.summary.pageCount === 1);
  ok("G4 无悬挂误报", levelOf(G, "dangling-refs") === null);
  ok("G5 无 ObjStm 失败", levelOf(G, "objstm-fail") === null);
  ok("G6 maxNum=4", G.maxNum === 4);

  // ---------- H：缺 %%EOF + 非常规版本 ----------
  section("H 缺 EOF + 版本 2.9");
  const hStr = "%PDF-2.9\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n" +
    "trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n9\n";
  const H = await T.parse(toBytes(hStr));
  ok("H1 verdict=errors", H.summary.verdict === "errors");
  ok("H2 eof=warn", levelOf(H, "eof") === "warn");
  ok("H3 xref=error（无表无流）", levelOf(H, "xref") === "error");
  ok("H4 版本识别=2.9 info", levelOf(H, "header-version") === "info" && H.header.version === "2.9");

  // ---------- 导出 ----------
  section("导出");
  const md = T.toMarkdown(A, { title: "导出测试" });
  ok("I1 MD 含标题与结论", md.indexOf("# 导出测试") === 0 && md.indexOf("结构完好") > 0);
  ok("I2 MD 健康文档无问题表", md.indexOf("检查通过") > 0);
  const mdB = T.toMarkdown(B, { title: "问题报告" });
  ok("I3 MD 问题文档含表格行", mdB.indexOf("| 错误 |") >= 0 && mdB.indexOf("悬挂引用") >= 0);
  const html = T.toHtml(B);
  ok("I4 HTML 含级别与条目", html.indexOf("#d1242f") >= 0 && html.indexOf("dangling") < 0 && html.indexOf("悬挂引用") >= 0);

  // ---------- 汇总 ----------
  console.log("\n========================");
  console.log("通过 " + pass + " / 失败 " + fail);
  if (fail > 0) process.exit(1);
})().catch(e => { console.error("FATAL:", e && e.stack || e); process.exit(1); });
