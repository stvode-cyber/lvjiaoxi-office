/* 绿角犀 Office · 图表导出（XLSX 原生 + HTML SVG）jsdom 联调测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = "D:/源码存档/绿角犀办公软件/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} }; };

function makeZipStub() { const files = {}; const zip = { file(n, c) { files[n] = c; return zip; }, folder() { return zip; }, generateAsync() { return Promise.resolve({ _files: files }); } }; return zip; }
window.JSZip = function () { return makeZipStub(); };

const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return null; } }; } };
let downloads = [];
OS.toast = () => {};
OS.util = {
  uid: p => (p || "id") + Math.random().toString(36).slice(2, 8),
  debounce: f => f, escapeHtml: s => String(s == null ? "" : s), fmtTime: t => new Date(t).toLocaleString(),
  download(b, n) { downloads.push({ blob: b, name: n }); }, readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; }, local: { critique: t => t } };
OS.icons = { svg: () => "<svg></svg>" };
OS.blankDoc = t => ({ type: t, data: {} });
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/spreadsheet.js"), "utf8");
const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);
const exCode = fs.readFileSync(path.join(APP, "js/export-ooxml.js"), "utf8");
const s2 = window.document.createElement("script"); s2.textContent = exCode; window.document.body.appendChild(s2);

const mod = window.OS.modules.spreadsheet;
const host = window.document.createElement("div"); window.document.body.appendChild(host);
const ctx = { markDirty() {}, openBackstage() {} };
const inst = mod.mount(host, { name: "销售", type: "spreadsheet", data: mod.blank() }, ctx);

// 数据 + 选区域 + 插入图表
inst.commit("A1", "月份"); inst.commit("B1", "销量"); inst.commit("C1", "利润");
inst.commit("A2", "一月"); inst.commit("B2", 10); inst.commit("C2", 4);
inst.commit("A3", "二月"); inst.commit("B3", 20); inst.commit("C3", 9);
inst.commit("A4", "三月"); inst.commit("B4", 15); inst.commit("C4", 7);
inst.selectCell("A1"); inst.extendTo("C4");
inst.addChart("bar");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  const charts = inst.charts();
  ok("图表已插入", charts.length === 1 && charts[0].type === "bar");

  // 1) HTML 导出含 SVG
  downloads = [];
  inst.exportAs("html");
  ok("html 下载触发", downloads.length === 1);
  const htmlText = await downloads[0].blob.text();
  ok("html 含 <svg>", htmlText.indexOf("<svg") !== -1);
  ok("html 含图表标题", htmlText.indexOf("柱状图") !== -1);

  // 2) XLSX 原生图表
  downloads = [];
  await window.OS.Exporter.exportDoc({ type: "spreadsheet", name: "销售", data: inst.serialize() }, "xlsx");
  ok("xlsx 下载触发", downloads.length === 1);
  const files = downloads[0].blob._files;
  ok("含 xl/charts/chart1.xml", !!files["xl/charts/chart1.xml"]);
  ok("含 xl/drawings/drawing1.xml", !!files["xl/drawings/drawing1.xml"]);
  ok("含 sheet rels", !!files["xl/worksheets/_rels/sheet1.xml.rels"]);
  ok("Content_Types 含 chart override", !!files["[Content_Types].xml"] && files["[Content_Types].xml"].indexOf("drawingml.chart+xml") !== -1);
  const chartXml = files["xl/charts/chart1.xml"];
  // 良构性
  const parsed = new window.DOMParser().parseFromString(chartXml, "text/xml");
  ok("chart1.xml 良构（无 parsererror）", !parsed.querySelector("parsererror") && !!parsed.getElementsByTagName("c:chart").length);
  ok("chart 含 c:barChart", chartXml.indexOf("c:barChart") !== -1);
  ok("chart 引用 Sheet1 区域", chartXml.indexOf("Sheet1!$A$2:$A$4") !== -1);
  ok("chart 含数值引用 B 列", chartXml.indexOf("Sheet1!$B$2:$B$4") !== -1);
  // drawing1.xml 通过 r:id 引用 chart；字面路径 ../charts/chart1.xml 在 _rels/drawing1.xml.rels
  const drawingXml = files["xl/drawings/drawing1.xml"];
  ok("drawing 含 r:id 引用", drawingXml.indexOf("r:id") !== -1 && drawingXml.indexOf("c:chart") !== -1);
  const drawingRels = files["xl/drawings/_rels/drawing1.xml.rels"];
  ok("drawing rels 指向 chart", !!drawingRels && drawingRels.indexOf("../charts/chart1.xml") !== -1);

  const summary = `CHART-EXPORT TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  fs.writeFileSync(path.join(APP, "..", "_chart_export_result.txt"), summary);
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.message); console.log(e && e.stack); process.exit(2); });
