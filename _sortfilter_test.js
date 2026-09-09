/* 绿角犀 Office · 表格排序与筛选 jsdom 联调测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return { measureText: () => ({ width: 0 }) }; };

function ribStub() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return window.document.createElement("div"); } }; }
const OS = {};
OS.Ribbon = { create() { return ribStub(); } };
OS.toast = () => {};
OS.util = {
  uid: p => (p || "id") + Math.random().toString(36).slice(2, 8),
  debounce: f => f, escapeHtml: s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  download() {}, readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; } };
OS.icons = { svg: () => "<svg></svg>" };
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/spreadsheet.js"), "utf8");
const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);

const mod = window.OS.modules.spreadsheet;
const ctx = { markDirty() {}, openBackstage() {} };

// 数据集：A=名称(文本), B=数值, C=公式(=B*2)
function dataSet() {
  return {
    rows: 20, cols: 5,
    cells: {
      A2: { v: "香蕉" }, B2: { v: 30 }, C2: { f: "=B2*2" },
      A3: { v: "苹果" }, B3: { v: 10 }, C3: { f: "=B3*2" },
      A4: { v: "橙子" }, B4: { v: 20 }, C4: { f: "=B4*2" }
    },
    styles: {}, charts: [], condFormats: [], filters: []
  };
}

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

const host = window.document.createElement("div"); window.document.body.appendChild(host);
const inst = mod.mount(host, { name: "T", type: "spreadsheet", data: dataSet() }, ctx);

// 1) 升序排序（按 B 列）后，数值与名称对应归位，公式相对引用随行偏移
inst.sortRange("A2:C4", "B", true);
const d = inst.serialize();
ok("排序后 B2=10", d.cells.B2 && d.cells.B2.v === 10);
ok("排序后 B3=20", d.cells.B3 && d.cells.B3.v === 20);
ok("排序后 B4=30", d.cells.B4 && d.cells.B4.v === 30);
ok("排序后 A2=苹果", d.cells.A2 && d.cells.A2.v === "苹果");
ok("排序后 A4=香蕉", d.cells.A4 && d.cells.A4.v === "香蕉");
ok("公式随行偏移 C2==B2*2", d.cells.C2 && d.cells.C2.f === "=B2*2");
ok("公式随行偏移 C4==B4*2", d.cells.C4 && d.cells.C4.f === "=B4*2");

// 2) 降序排序（重置数据后）
const host2 = window.document.createElement("div"); window.document.body.appendChild(host2);
const inst2 = mod.mount(host2, { name: "T2", type: "spreadsheet", data: dataSet() }, ctx);
inst2.sortRange("A2:C4", "B", false);
const d2 = inst2.serialize();
ok("降序 B2=30", d2.cells.B2.v === 30 && d2.cells.A2.v === "香蕉");
ok("降序 B4=10", d2.cells.B4.v === 10 && d2.cells.A4.v === "苹果");

// 3) 筛选：仅显示 A 列包含「蕉」的行（排序后香蕉在第4行）
const host3 = window.document.createElement("div"); window.document.body.appendChild(host3);
const inst3 = mod.mount(host3, { name: "T3", type: "spreadsheet", data: dataSet() }, ctx);
inst3.sortRange("A2:C4", "B", true); // 香蕉→第4行
inst3.applyFilter({ range: "A2:C4", col: "A", op: "contains", v: "蕉" });
const vis = inst3.visibleRows();
ok("筛选可见行仅 [4]", vis && vis.length === 1 && vis[0] === 4);
const table = host3.querySelector("table.sheet");
ok("第2行被隐藏", table.querySelector('th.rowhead[data-row="2"]').parentElement.classList.contains("filtered-out"));
ok("第3行被隐藏", table.querySelector('th.rowhead[data-row="3"]').parentElement.classList.contains("filtered-out"));
ok("第4行可见", !table.querySelector('th.rowhead[data-row="4"]').parentElement.classList.contains("filtered-out"));
ok("filters() 记录规则", inst3.filters().length === 1 && inst3.filters()[0].op === "contains");

// 4) 清除筛选恢复全部可见
inst3.clearFilters();
ok("清除后可见行 null", inst3.visibleRows() === null);
ok("清除后第2行不再隐藏", !table.querySelector('th.rowhead[data-row="2"]').parentElement.classList.contains("filtered-out"));

// 5) 持久化：带 filters 的数据重载后自动隐藏（多工作表模型下 filters 存于 sheets[activeSheet]）
const dataWithFilter = inst3.serialize();
dataWithFilter.sheets[dataWithFilter.activeSheet].filters = [{ range: "A2:C4", col: "A", op: "contains", v: "橙" }];
const host4 = window.document.createElement("div"); window.document.body.appendChild(host4);
const inst4 = mod.mount(host4, { name: "T4", type: "spreadsheet", data: dataWithFilter }, ctx);
const vis4 = inst4.visibleRows();
ok("重载后筛选持久化（橙→第3行）", vis4 && vis4.length === 1 && vis4[0] === 3);

const summary = `SORT-FILTER TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_sortfilter_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
