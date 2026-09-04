/* 绿角犀 Office · Spreadsheet 公式引擎扩展测试（新增 40+ 函数 + matchCrit 通配符）
   覆盖：COUNTIF/COUNTIFS/SUMIFS/AVERAGEIF/AVERAGEIFS/MAXIFS/MINIFS
        IFERROR/IFNA/IFS/SWITCH
        ROUNDUP/ROUNDDOWN/TRUNC/EVEN/ODD
        RANK/RANK.EQ/LARGE/SMALL
        MEDIAN/MODE/MODE.SNGL
        STDEV/STDEV.S/STDEV.P/VAR/VAR.S/VAR.P
        PERCENTILE/QUARTILE
        SUBSTITUTE/REPT/FIND/SEARCH/CLEAN/PROPER/EXACT
        ISNUMBER/ISTEXT/ISBLANK/ISERROR/ISNA/ISLOGICAL/NA
        RAND/RANDBETWEEN
        matchCrit 通配符扩展（* ? ~）
*/
const { JSDOM } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");
const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";

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
function run(f, gc) { return FE.run(f, gc || (() => "")); }
function cells(map) { return (ref) => (ref in map ? map[ref] : ""); }

/* ---------- 数学舍入 & 数值函数 ---------- */
ok("ROUNDUP(1.234,2)=1.24", run("=ROUNDUP(1.234,2)") === 1.24);
ok("ROUNDUP(1.231,2)=1.24", run("=ROUNDUP(1.231,2)") === 1.24);
ok("ROUNDUP(-1.234,2)=-1.24", run("=ROUNDUP(-1.234,2)") === -1.24);
ok("ROUNDDOWN(1.239,2)=1.23", run("=ROUNDDOWN(1.239,2)") === 1.23);
ok("ROUNDDOWN(-1.239,2)=-1.23", run("=ROUNDDOWN(-1.239,2)") === -1.23);
ok("TRUNC(1.999)=1", run("=TRUNC(1.999)") === 1);
ok("TRUNC(-1.999)=-1", run("=TRUNC(-1.999)") === -1);
ok("TRUNC(123.456,-1)=120", run("=TRUNC(123.456,-1)") === 120);
ok("EVEN(1)=2", run("=EVEN(1)") === 2);
ok("EVEN(2)=2", run("=EVEN(2)") === 2);
ok("EVEN(-3)=-4", run("=EVEN(-3)") === -4);
ok("ODD(1)=1", run("=ODD(1)") === 1);
ok("ODD(2)=3", run("=ODD(2)") === 3);
ok("ODD(-2)=-3", run("=ODD(-2)") === -3);

/* ---------- 条件分支 ---------- */
ok('IFERROR(#DIV/0!,fb)⇒fb', run('=IFERROR("#DIV/0!","fb")') === "fb");
ok('IFERROR(123,fb)⇒123', run('=IFERROR(123,"fb")') === 123);
ok('IFNA(#N/A,fb)⇒fb', run('=IFNA("#N/A","fb")') === "fb");
ok('IFNA(#VALUE!,fb)⇒原值', run('=IFNA("#VALUE!","fb")') === "#VALUE!");
ok("IFS 第一真命中", run("=IFS(1>2,10,1=1,20,TRUE,30)") === 20);
ok("IFS 全假⇒#N/A", run("=IFS(FALSE,1,FALSE,2)") === "#N/A");
ok('SWITCH 命中"二"', run('=SWITCH(2,1,"一",2,"二",3,"三")') === "二");
ok('SWITCH 默认值', run('=SWITCH(9,1,"A",2,"B","其他")') === "其他");
ok("SWITCH 无默认⇒#N/A", run("=SWITCH(9,1,A,2,B)") === "#N/A");

/* ---------- 排名与 LARGE/SMALL ---------- */
{
  const gc = cells({ A1:3, A2:1, A3:4, A4:1, A5:5 });
  close("LARGE 1=5", run("=LARGE(A1:A5,1)", gc), 5);
  close("LARGE 2=4", run("=LARGE(A1:A5,2)", gc), 4);
  close("LARGE 5=1", run("=LARGE(A1:A5,5)", gc), 1);
  close("SMALL 1=1", run("=SMALL(A1:A5,1)", gc), 1);
  close("SMALL 4=4", run("=SMALL(A1:A5,4)", gc), 4);
  ok("LARGE k=0⇒#NUM!", run("=LARGE(A1:A5,0)", gc) === "#NUM!");
  ok("SMALL k=99⇒#NUM!", run("=SMALL(A1:A5,99)", gc) === "#NUM!");
  close("RANK(4,降序)=2", run("=RANK(4,A1:A5)", gc), 2);
  close("RANK(4,升序)=4", run("=RANK(4,A1:A5,1)", gc), 4);
  close("RANK.EQ 别名", run("=RANK.EQ(4,A1:A5)", gc), 2);
}

/* ---------- 统计：MEDIAN/MODE/STDEV/VAR/PERCENTILE/QUARTILE ---------- */
{
  const gc = cells({ A1:2, A2:4, A3:6, A4:8, A5:10 });
  close("MEDIAN(奇数样本)=6", run("=MEDIAN(A1:A5)", gc), 6);
  close("MEDIAN(偶数样本)=5", run("=MEDIAN(2,4,6,8)"), 5);
  ok("MEDIAN()⇒#NUM!", run("=MEDIAN()") === "#NUM!");
  close("MODE=2", run("=MODE(1,2,3,2,4)"), 2);
  ok("MODE()⇒#N/A", run("=MODE()") === "#N/A");
  // [2,4,6,8,10]: mean=6, Σ(x-μ)² = 16+4+0+4+16 = 40; 样本 var = 40/4=10; 总体 var = 40/5=8
  close("STDEV.S=√10≈3.16227766", run("=STDEV.S(A1:A5)", gc), Math.sqrt(10), 1e-6);
  close("STDEV 别名", run("=STDEV(A1:A5)", gc), Math.sqrt(10), 1e-6);
  close("STDEV.P=√8≈2.8284", run("=STDEV.P(A1:A5)", gc), Math.sqrt(8), 1e-6);
  close("VAR.S=10", run("=VAR.S(A1:A5)", gc), 10, 1e-9);
  close("VAR 别名=10", run("=VAR(A1:A5)", gc), 10, 1e-9);
  close("VAR.P=8", run("=VAR.P(A1:A5)", gc), 8, 1e-9);
  ok("STDEV.S 单元素⇒#DIV/0!", run("=STDEV.S(A1)") === "#DIV/0!");
  close("PERCENTILE(0.5)=6", run("=PERCENTILE(A1:A5,0.5)", gc), 6, 1e-9);
  close("PERCENTILE(0.25)=4", run("=PERCENTILE(A1:A5,0.25)", gc), 4, 1e-9);
  ok("PERCENTILE(1.5)⇒#NUM!", run("=PERCENTILE(A1:A5,1.5)", gc) === "#NUM!");
  close("QUARTILE(0)=2", run("=QUARTILE(A1:A5,0)", gc), 2, 1e-9);
  close("QUARTILE(1)=4", run("=QUARTILE(A1:A5,1)", gc), 4, 1e-9);
  close("QUARTILE(2)=6", run("=QUARTILE(A1:A5,2)", gc), 6, 1e-9);
  close("QUARTILE(3)=8", run("=QUARTILE(A1:A5,3)", gc), 8, 1e-9);
  close("QUARTILE(4)=10", run("=QUARTILE(A1:A5,4)", gc), 10, 1e-9);
  ok("QUARTILE(5)⇒#NUM!", run("=QUARTILE(A1:A5,5)", gc) === "#NUM!");
}

/* ---------- 文本函数 ---------- */
ok('SUBSTITUTE 全替换', run('=SUBSTITUTE("a_b_c","_","-")') === "a-b-c");
ok('SUBSTITUTE 指定第2次', run('=SUBSTITUTE("a_b_c","_","-",2)') === "a_b-c");
ok("REPT(x,3)=xxx", run('=REPT("x",3)') === "xxx");
ok("REPT(ab,2)=abab", run('=REPT("ab",2)') === "abab");
ok("FIND(o,Hello)=5", run('=FIND("o","Hello")') === 5);
ok("FIND(l,Hello,1)=3 (第一个l)", run('=FIND("l","Hello",1)') === 3);
ok("FIND(l,Hello,4)=4 (第二个l，从第4位1-based即index3开始)", run('=FIND("l","Hello",4)') === 4);
ok("FIND 不存在⇒#VALUE!", run('=FIND("z","Hello")') === "#VALUE!");
ok("SEARCH 大小写不敏感", run('=SEARCH("O","Hello")') === 5);
ok("CLEAN 去除控制字符", run("=CLEAN(\"A\x01B\x0DC\")") === "ABC");
ok('PROPER("hello WORLD")="Hello World"', run('=PROPER("hello WORLD")') === "Hello World");
ok("EXACT 大小写敏感相等", run('=EXACT("A","A")') === true);
ok("EXACT 大小写不等", run('=EXACT("A","a")') === false);

/* ---------- IS 系列 / NA / RAND / RANDBETWEEN ---------- */
ok("ISNUMBER(123)=true", run("=ISNUMBER(123)") === true);
ok('ISNUMBER("a")=false', run('=ISNUMBER("a")') === false);
ok('ISTEXT("abc")=true', run('=ISTEXT("abc")') === true);
ok("ISTEXT(123)=false", run("=ISTEXT(123)") === false);
ok('ISBLANK("")=true', run('=ISBLANK("")') === true);
ok('ISBLANK("x")=false', run('=ISBLANK("x")') === false);
ok('ISERROR("#DIV/0!")=true', run('=ISERROR("#DIV/0!")') === true);
ok("ISERROR(1)=false", run("=ISERROR(1)") === false);
ok('ISNA("#N/A")=true', run('=ISNA("#N/A")') === true);
ok('ISNA("#VALUE!")=false', run('=ISNA("#VALUE!")') === false);
ok("ISLOGICAL(TRUE)=true", run("=ISLOGICAL(TRUE)") === true);
ok("ISLOGICAL(1)=false", run("=ISLOGICAL(1)") === false);
ok("NA()=#N/A", run("=NA()") === "#N/A");
{
  const r1 = run("=RAND()"), r2 = run("=RAND()");
  ok("RAND() x2 in [0,1)且不等", r1 >= 0 && r1 < 1 && r2 >= 0 && r2 < 1 && r1 !== r2);
  const rb = run("=RANDBETWEEN(1,10)");
  ok("RANDBETWEEN(1,10) 在范围", Number.isInteger(rb) && rb >= 1 && rb <= 10);
  ok("RANDBETWEEN lo>hi⇒#NUM!", run("=RANDBETWEEN(10,1)") === "#NUM!");
}

/* ---------- 条件聚合 ---------- */
{
  // A=部门，B=销售额，C=城市
  const gc = cells({
    A1:"销售", B1:100, C1:"北京",
    A2:"销售", B2:200, C2:"上海",
    A3:"技术", B3:300, C3:"北京",
    A4:"技术", B4:400, C4:"上海",
    A5:"销售", B5:500, C5:"北京"
  });
  close("COUNTIF(部门=销售)=3", run('=COUNTIF(A1:A5,"销售")', gc), 3);
  close('COUNTIF(B>250)=3', run('=COUNTIF(B1:B5,">250")', gc), 3);
  close('COUNTIFS(销售·北京)=2', run('=COUNTIFS(A1:A5,"销售",C1:C5,"北京")', gc), 2);
  close('COUNTIFS(技术·上海·B>350)=1', run('=COUNTIFS(A1:A5,"技术",C1:C5,"上海",B1:B5,">350")', gc), 1);
  ok("COUNTIFS 参数奇数⇒#VALUE!", run('=COUNTIFS(A1:A5,"x",C1:C5)', gc) === "#VALUE!");
  close("SUMIF(销售) 合计=800", run('=SUMIF(A1:A5,"销售",B1:B5)', gc), 800);
  close("SUMIFS(销售·北京)=600", run('=SUMIFS(B1:B5,A1:A5,"销售",C1:C5,"北京")', gc), 600);
  close("AVERAGEIF(技术)=350", run('=AVERAGEIF(A1:A5,"技术",B1:B5)', gc), 350);
  close("AVERAGEIFS(销售·上海)=200", run('=AVERAGEIFS(B1:B5,A1:A5,"销售",C1:C5,"上海")', gc), 200);
  close("MAXIFS(销售·北京)=500", run('=MAXIFS(B1:B5,A1:A5,"销售",C1:C5,"北京")', gc), 500);
  close("MINIFS(技术)=300", run('=MINIFS(B1:B5,A1:A5,"技术")', gc), 300);
  ok("MAXIFS 参数奇数⇒#VALUE!", run("=MAXIFS(B1:B5,A1:A5)", gc) === "#VALUE!");
}

/* ---------- matchCrit 通配符 ---------- */
{
  const gc = cells({ A1:"Apple", A2:"Banana", A3:"Apricot", A4:"Cherry", A5:"A?" });
  close('通配 A* = 3', run('=COUNTIF(A1:A5,"A*")', gc), 3);      // Apple/Apricot/A? 三项
  close('通配 *a* = 4（大小写不敏感：Apple/Apricot/A?/Banana 均含A或a）', run('=COUNTIF(A1:A5,"*a*")', gc), 4);
  close('通配 ??????（6字符）= 2', run('=COUNTIF(A1:A5,"??????")', gc), 2); // Banana/Cherry都是6字母
  close('通配 A~? 字面=1', run('=COUNTIF(A1:A5,"A~?")', gc), 1); // A? 转义
  close('SUMIF(A*) 求和', (() => {
    const g2 = cells({ A1:"Ax", A2:"Bx", A3:"Ay", B1:10, B2:20, B3:30 });
    return run('=SUMIF(A1:A3,"A*",B1:B3)', g2);
  })(), 40);
  close('通配 ?p?le = Apple (5字符中含p位)', (() => {
    const g3 = cells({ A1:"Apple", A2:"Apply", A3:"Banana" });
    return run('=COUNTIF(A1:A3,"?pp?e")', g3);
  })(), 1); // Apple
}

/* ---------- 与既有函数回归：IF/SUM/ROUND/VLOOKUP 仍可正常运行 ---------- */
ok("IF(TRUE,a,b)=a", run('=IF(TRUE,"a","b")') === "a");
close("SUM(1..5)=15", run("=SUM(1,2,3,4,5)"), 15);
ok("ROUND(1.235,2)=1.24", run("=ROUND(1.235,2)") === 1.24);
{
  const gc = cells({ A1:"x", A2:"y", B1:10, B2:20 });
  close("VLOOKUP(y,range,2,false)=20", run('=VLOOKUP("y",A1:B2,2,1)', gc), 20);
}
ok("未知函数⇒#NAME?", run("=FOOBAR(1,2,3)") === "#NAME?");
ok("除零⇒#DIV/0!", run("=1/0") === "#DIV/0!");

/* ---------- 汇总 ---------- */
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail) { console.log("FAIL:\n  " + fails.join("\n  ")); process.exit(1); }
process.exit(0);
