/* 表格导出 PDF 范围选项测试（R·Spreadsheet 部分）
   验证：buildSheetPages（行区间/每页行数分页/越界夹紧）、
   buildWorkbookPages（单表/多表/选工作表）、collectSheets。
   纯逻辑、零依赖、Node 可直接跑。
*/
global.window = global;
global.OS = {};
require("./app/js/modules/sheet-export.js");
const SE = OS.SheetExport;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }

function colToIdx(l) { let n = 0; for (let i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n - 1; }
function idxToCol(i) { let s = ""; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// 5 行 3 列
const cells = {};
for (let r = 1; r <= 5; r++) for (let c = 1; c <= 3; c++) cells[idxToCol(c) + r] = (c === 1 ? "R" + r : "V" + r + "c" + c);
const cellText = ref => (cells[ref] == null ? "" : cells[ref]);
const cellStyle = () => "";

// 1) buildSheetPages：每页 2 行 → 3 页
const p = SE.buildSheetPages(cells, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml, rowsPerPage: 2, title: "T" });
ok("range.r = 5", p.range.r === 5);
ok("range.c = 3", p.range.c === 3);
ok("分页数 = ceil(5/2) = 3", p.pages.length === 3);
ok("第1页 行1-2", p.pages[0].startRow === 1 && p.pages[0].endRow === 2);
ok("第2页 行3-4", p.pages[1].startRow === 3 && p.pages[1].endRow === 4);
ok("第3页 行5-5", p.pages[2].startRow === 5 && p.pages[2].endRow === 5);
ok("HTML 含 table 标签", p.pages[0].html.indexOf("<table") !== -1);
ok("HTML 含列头 A/B/C", p.pages[0].html.indexOf(">A<") !== -1 && p.pages[0].html.indexOf(">B<") !== -1);
ok("HTML 含单元格内容 R1", p.pages[0].html.indexOf("R1") !== -1);

// 2) 行区间 [2,4] → 2 页（2-3, 4-4）
const p2 = SE.buildSheetPages(cells, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml, rowsPerPage: 2, startRow: 2, endRow: 4, title: "T" });
ok("区间[2,4] 分页数=2", p2.pages.length === 2);
ok("区间[2,4] 第1页 2-3", p2.pages[0].startRow === 2 && p2.pages[0].endRow === 3);
ok("区间[2,4] 第2页 4-4", p2.pages[1].startRow === 4 && p2.pages[1].endRow === 4);

// 3) 越界夹紧
const p3 = SE.buildSheetPages(cells, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml, rowsPerPage: 2, startRow: 10, endRow: 99, title: "T" });
ok("startRow 越界 → 空页", p3.pages.length === 0);
const p4 = SE.buildSheetPages(cells, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml, rowsPerPage: 2, startRow: 4, endRow: 99, title: "T" });
ok("endRow 越界夹紧到 5", p4.pages.length === 1 && p4.pages[0].endRow === 5);

// 4) buildWorkbookPages：单表
const wb1 = SE.buildWorkbookPages({ cells }, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml });
ok("单表：sheets 数=1", wb1.sheets.length === 1);
ok("单表：totalPages=1（5行<32）", wb1.totalPages === 1);

// 5) buildWorkbookPages：多表 + 选工作表
const data = {
  sheets: [
    { name: "S1", cells },
    { name: "S2", cells: (function () { const m = {}; for (let r = 1; r <= 10; r++) for (let c = 1; c <= 3; c++) m[idxToCol(c) + r] = "x"; return m; })() }
  ]
};
const wb2 = SE.buildWorkbookPages(data, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml });
ok("多表：sheets 数=2", wb2.sheets.length === 2);
ok("多表：totalPages=2", wb2.totalPages === 2);
const wb3 = SE.buildWorkbookPages(data, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml, sheetIndex: 1 });
ok("选工作表 S2：sheets 数=1", wb3.sheets.length === 1);
ok("选工作表 S2：标题正确", wb3.sheets[0].title === "S2");
ok("选工作表 S2：totalPages=1", wb3.totalPages === 1);
const wb4 = SE.buildWorkbookPages(data, { colToIdx, idxToCol, cellText, cellStyle, escapeHtml, sheetIndex: 99 });
ok("选工作表越界 → 空", wb4.sheets.length === 0 && wb4.totalPages === 0);

// 6) collectSheets 退化
ok("collectSheets 单表退化", SE.collectSheets({ cells }).length === 1 && SE.collectSheets({ cells })[0].title === "Sheet1");
ok("collectSheets 多表", SE.collectSheets(data).length === 2 && SE.collectSheets(data)[1].title === "S2");

console.log("\nR 表格导出范围：通过 " + pass + " / " + (pass + fail) + (fail ? "（✗ " + fail + " 失败）" : "，全部通过 ✅"));
process.exit(fail ? 1 : 0);
