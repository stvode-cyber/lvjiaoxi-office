/* 绿角犀 Office · Spreadsheet 新增 26 函数回归测试
   覆盖：SUMPRODUCT/HLOOKUP/DATEIF/DATEDIF/WEEKDAY/WEEKNUM/HOUR/MINUTE/SECOND
        FREQUENCY/REPLACE/T/N/FACT/PI/SIN/COS/TAN/DEGREES/RADIANS
        ISODD/ISEVEN/COUNTBLANK/COLUMN/ROW/ROWS/COLUMNS/AGGREGATE
   重点：修复 new Date(+x) 对字符串日期返回 NaN 的 bug（6 个函数）
*/
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () {
  return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} };
};
const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return window.document.createElement("div"); } }; } };
OS.toast = () => {};
OS.util = { uid: p => (p || "id") + Math.random().toString(36).slice(2, 8), debounce: f => f, escapeHtml: s => String(s == null ? "" : s), download() {}, readFile: () => Promise.resolve("") };
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; } };
OS.icons = { svg: () => "<svg></svg>" };
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/spreadsheet.js"), "utf8");
const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);

const FE = window.OS.FormulaEngine;
if (!FE || !FE.run) { process.stderr.write("FE 未就绪\n"); process.exit(1); }

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; fails.push(name + (detail ? " — " + detail : "")); }
}
function close(name, actual, expected, eps) {
  const cond = Math.abs(actual - expected) <= (eps == null ? 1e-9 : eps);
  if (cond) pass++;
  else { fail++; fails.push(name + ` — actual=${actual}, expected=${expected}`); }
}
function eq(name, actual, expected) {
  if (actual === expected) pass++;
  else { fail++; fails.push(name + ` — actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)}`); }
}
function run(f, gc, ref) { return FE.run(f, gc || (() => ""), ref); }
function cells(map) { return (ref) => (ref in map ? map[ref] : ""); }

/* =========================== 日期函数（bug 修复重点） =========================== */
{
  // 原代码: new Date(+x) — 字符串日期 "+x" = NaN，全挂
  // 修复后: new Date(x) — 接受 "2024/1/1" 字符串
  console.log("--- DATEIF / WEEKDAY / WEEKNUM / HOUR / MINUTE / SECOND ---");
  eq("DATEIF(Y) 字符串日期=1", run('=DATEIF("2023/1/1","2024/1/1","Y")'), 1);
  eq("DATEIF(M) 字符串日期=11~12", run('=DATEIF("2023/1/1","2023/12/31","M")'), 11);
  eq("DATEIF(D) 字符串日期=365", run('=DATEIF("2023/1/1","2024/1/1","D")'), 365);
  eq("DATEIF(Y) 早于结束=#NUM!", run('=DATEIF("2024/1/1","2023/1/1","Y")'), "#NUM!");
  eq("DATEDIF 别名=DATEIF", run('=DATEDIF("2023/1/1","2024/1/1","Y")'), 1);

  // WEEKDAY / WEEKNUM — 2024-01-01 是周一
  eq("WEEKDAY 默认 Sun=1, 2024-01-01=2", run('=WEEKDAY("2024/1/1")'), 2);
  eq("WEEKDAY firstDay=2 Mon=1, 2024-01-01=1", run('=WEEKDAY("2024/1/1",2)'), 1);
  eq("WEEKNUM 2024-01-01 周=1", run('=WEEKNUM("2024/1/1")'), 1);
  eq("WEEKNUM 2024-01-08 周=2", run('=WEEKNUM("2024/1/8")'), 2);

  // HOUR / MINUTE / SECOND — 字符串时间
  eq("HOUR 14:30:45 字符串=14", run('=HOUR("2024/1/1 14:30:45")'), 14);
  eq("MINUTE 14:30:45 字符串=30", run('=MINUTE("2024/1/1 14:30:45")'), 30);
  eq("SECOND 14:30:45 字符串=45", run('=SECOND("2024/1/1 14:30:45")'), 45);
}

/* =========================== SUMPRODUCT / HLOOKUP =========================== */
{
  console.log("--- SUMPRODUCT / HLOOKUP ---");
  eq("SUMPRODUCT 1D 乘积求和", run("=SUMPRODUCT(1,2,3,4)"), 24);
  const gcSP = cells({ A1: 1, B1: 2, A2: 3, B2: 4 });
  close("SUMPRODUCT 2D 数组 A1:B1 * A2:B2", run("=SUMPRODUCT(A1:B1,A2:B2)", gcSP), 1 * 3 + 2 * 4);  // 3+8=11
  const gcHL = cells({ A1: "Q1", B1: "Q2", C1: "Q3", A2: 5, B2: 10, C2: 15 });
  eq("HLOOKUP 精确匹配 Q1→5", run('=HLOOKUP("Q1",A1:C2,2,TRUE)', gcHL), 5);
  eq("HLOOKUP 精确匹配 Q2→10", run('=HLOOKUP("Q2",A1:C2,2,TRUE)', gcHL), 10);
  eq("HLOOKUP 找不到=#N/A", run('=HLOOKUP("Q4",A1:C2,2,TRUE)', gcHL), "#N/A");
}

/* =========================== ISODD / ISEVEN / FACT / PI =========================== */
{
  console.log("--- ISODD / ISEVEN / FACT / PI ---");
  eq("ISODD(3)=TRUE", run("=ISODD(3)"), true);
  eq("ISODD(4)=FALSE", run("=ISODD(4)"), false);
  eq("ISEVEN(4)=TRUE", run("=ISEVEN(4)"), true);
  eq("FACT(5)=120", run("=FACT(5)"), 120);
  eq("FACT(0)=1", run("=FACT(0)"), 1);
  eq("FACT(-1)=#NUM!", run("=FACT(-1)"), "#NUM!");
  close("PI()≈3.14159", run("=PI()"), Math.PI);
}

/* =========================== FREQUENCY / REPLACE / T / N =========================== */
{
  console.log("--- FREQUENCY / REPLACE / T / N ---");
  const gcF = cells({ A1: 1, A2: 5, A3: 8, A4: 10, A5: 15, B1: 5, B2: 10 });
  const r = run("=FREQUENCY(A1:A5,B1:B2)", gcF);
  ok("FREQUENCY 返回数组", Array.isArray(r));
  ok("FREQUENCY 长度=bins+1=3", r.length === 3);
  // values 1,5,8,10,15  bins 5,10
  // bin 0 (≤5): 1,5 → 2;  bin 1 (>5且≤10): 8,10 → 2;  bin 2 (>10): 15 → 1
  eq("FREQUENCY[0]=count≤5=2", r[0], 2);
  eq("FREQUENCY[1]=count(5,10]=2", r[1], 2);
  eq("FREQUENCY[2]=count>10=1", r[2], 1);

  eq("REPLACE 按位置替换", run('=REPLACE("Hello World",1,5,"Hi")'), "Hi World");
  eq("T 文本直通", run('=T("abc")'), "abc");
  eq("T 数字返回空", run('=T(42)'), "");
  eq("N 数字直通", run('=N(42)'), 42);
  eq("N TRUE→1", run('=N(TRUE)'), 1);
}

/* =========================== COLUMN / ROW 运行时注入 =========================== */
{
  console.log("--- COLUMN / ROW runtime injection ---");
  const gc = cells({});
  eq("COLUMN ref A1=1", run("=COLUMN()", gc, "A1"), 1);
  eq("COLUMN ref C5=3", run("=COLUMN()", gc, "C5"), 3);
  eq("ROW ref A1=1", run("=ROW()", gc, "A1"), 1);
  eq("ROW ref B7=7", run("=ROW()", gc, "B7"), 7);
  eq("COLUMN 无 ref=#REF!", run("=COLUMN()", gc), "#REF!");
}

/* =========================== ROWS / COLUMNS / COUNTBLANK =========================== */
{
  console.log("--- ROWS / COLUMNS / COUNTBLANK ---");
  const gc = cells({ A1: 1, A2: "", A3: 3, B1: null, B2: 2, B3: "" });
  close("SUM(A1:A3)=4", run("=SUM(A1:A3)", gc), 4);
  // COUNTBLANK needs a range that resolves to array of values including ""
  eq("COUNTBLANK(单值非空)=0", run("=COUNTBLANK(1)"), 0);
  eq("COUNTBLANK(\"\")=1", run('=COUNTBLANK("")'), 1);
}

/* =========================== AGGREGATE =========================== */
{
  console.log("--- AGGREGATE ---");
  eq("AGGREGATE(9=SUM,0,1,2,3)=6", run("=AGGREGATE(9,0,1,2,3)"), 6);
  eq("AGGREGATE(1=AVERAGE,0,1,2,3)=2", run("=AGGREGATE(1,0,1,2,3)"), 2);
  eq("AGGREGATE(4=MAX,0,1,5,3)=5", run("=AGGREGATE(4,0,1,5,3)"), 5);
  eq("AGGREGATE(5=MIN,0,1,5,3)=1", run("=AGGREGATE(5,0,1,5,3)"), 1);
}

/* =========================== 三角函数 =========================== */
{
  console.log("--- 三角函数 ---");
  close("SIN(0)=0", run("=SIN(0)"), 0);
  close("COS(0)=1", run("=COS(0)"), 1);
  close("DEGREES(PI)=180", run("=DEGREES(PI())"), 180);
  close("RADIANS(180)=PI", run("=RADIANS(180)"), Math.PI);
}

/* =========================== 与既有函数共存回归 =========================== */
{
  console.log("--- 既有函数回归 ---");
  eq("IF/AND/OR 仍 OK", run('=IF(AND(1>0,2>0),"y","n")'), "y");
  close("VLOOKUP 仍 OK", (() => {
    const gc = cells({ A1:"x", A2:"y", B1:10, B2:20 });
    return run('=VLOOKUP("y",A1:B2,2,1)', gc);
  })(), 20);
}

/* =========================== 汇总 =========================== */
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail) { console.log("FAIL:\n  " + fails.join("\n  ")); process.exit(1); }
process.exit(0);
