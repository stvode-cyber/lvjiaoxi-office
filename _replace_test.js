/* 绿角犀 Office · 文档内查找替换 jsdom 联调测试（验证各模块 replaceAll） */
const { JSDOM } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");
const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";

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
  download() {}, readFile: () => Promise.resolve(""), fmtTime: () => "", fmtSize: () => ""
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; } };
OS.icons = { svg: () => "<svg></svg>" };
OS.shell = { snippet(text, q) {
  const t = String(text == null ? "" : text);
  const ql = (q || "").toLowerCase(); const tl = t.toLowerCase();
  const idx = tl.indexOf(ql);
  if (idx === -1 || !q) return OS.util.escapeHtml(t.slice(0, 80));
  const start = Math.max(0, idx - 30);
  const end = Math.min(t.length, idx + q.length + 30);
  const before = (start > 0 ? "…" : "") + t.slice(start, idx);
  const mid = t.slice(idx, idx + q.length);
  const after = t.slice(idx + q.length, end) + (end < t.length ? "…" : "");
  return OS.util.escapeHtml(before) + "<mark>" + OS.util.escapeHtml(mid) + "</mark>" + OS.util.escapeHtml(after);
} };
window.OS = OS;

function loadMod(file) {
  const code = fs.readFileSync(path.join(APP, "js/modules/" + file), "utf8");
  const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);
}
["writer.js", "presentation.js", "spreadsheet.js"].forEach(loadMod);

const ctx = { markDirty() {}, openBackstage() {} };
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

/* ===== Writer ===== */
// 场景1：计数 + 排除页眉 + 序列化不含原词
const wHost = window.document.createElement("div"); window.document.body.appendChild(wHost);
const wInst = window.OS.modules.writer.mount(wHost, {
  name: "报告", type: "writer",
  data: {
    html: '<h1>第一章 项目计划</h1><p>这是项目计划的详细说明，项目计划需要排期。</p><p>第二章内容涉及项目计划。</p>',
    comments: [], page: { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } },
    header: { left: "", center: "项目计划", right: "" }, footer: { left: "", center: "", right: "" } }
}, ctx);
let n = wInst.replaceAll("项目计划", "项目规划");
ok("writer 正文替换计数=4", n === 4);
let whtml = wInst.serialize().html;
ok("writer 正文全部替换", (whtml.match(/项目规划/g) || []).length === 4);
ok("writer 序列化不含原词", whtml.indexOf("项目计划") === -1);
// 页眉不应被替换（排除 zone）
ok("writer 排除页眉", wHost.querySelector(".wh-header").textContent.indexOf("项目计划") !== -1);

// 场景2：默认不区分大小写
const wHost2 = window.document.createElement("div"); window.document.body.appendChild(wHost2);
const wInst2 = window.OS.modules.writer.mount(wHost2, {
  name: "c", type: "writer",
  data: { html: "<p>Apple 与 apple 与 APPLE</p>", comments: [], page: { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } }, header: { left: "", center: "", right: "" }, footer: { left: "", center: "", right: "" } }
}, ctx);
let n2 = wInst2.replaceAll("apple", "橙子");
ok("writer 默认不区分大小写=3", n2 === 3);
ok("writer 全部替换为橙子", (wInst2.serialize().html.match(/橙子/g) || []).length === 3);

// 场景3：区分大小写
const wHost3 = window.document.createElement("div"); window.document.body.appendChild(wHost3);
const wInst3 = window.OS.modules.writer.mount(wHost3, {
  name: "c3", type: "writer",
  data: { html: "<p>Apple 与 apple 与 APPLE</p>", comments: [], page: { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } }, header: { left: "", center: "", right: "" }, footer: { left: "", center: "", right: "" } }
}, ctx);
let n3 = wInst3.replaceAll("apple", "橙子", { matchCase: true });
ok("writer 区分大小写仅小写=1", n3 === 1);
ok("writer 仅小写被替换", wInst3.serialize().html === "<p>Apple 与 橙子 与 APPLE</p>");

/* ===== Spreadsheet ===== */
const sHost = window.document.createElement("div"); window.document.body.appendChild(sHost);
const sInst = window.OS.modules.spreadsheet.mount(sHost, {
  name: "表", type: "spreadsheet",
  data: { rows: 20, cols: 5, cells: { A1: { v: "苹果" }, B1: { v: "苹果汁" }, A2: { f: "=SUM(苹果)" } }, styles: {}, charts: [], condFormats: [], filters: [] }
}, ctx);
let sn = sInst.replaceAll("苹果", "橙子");
ok("spreadsheet 值与公式替换计数=3", sn === 3);
let sser = sInst.serialize();
ok("spreadsheet 值已替换", sser.cells.A1.v === "橙子");
ok("spreadsheet 公式已替换", sser.cells.A2.f === "=SUM(橙子)");
// 撤销恢复
let undone = sInst.undo();
ok("spreadsheet 撤销返回真", undone === true);
sser = sInst.serialize();
ok("spreadsheet 撤销恢复原值", sser.cells.A1.v === "苹果" && sser.cells.A2.f === "=SUM(苹果)");

/* ===== Presentation ===== */
const pHost = window.document.createElement("div"); window.document.body.appendChild(pHost);
const pInst = window.OS.modules.presentation.mount(pHost, {
  name: "演示", type: "presentation",
  data: { slides: [
    { bg: "#fff", notes: "", transition: { type: "none", duration: 500 }, layout: "title-content", elements: [{ id: "e1", type: "text", x: 0, y: 0, w: 100, h: 40, text: "季度总结", fontSize: 24, color: "#111", bold: true, anim: { type: "none", duration: 400, delay: 0 }, emphasis: { type: "none" } }] },
    { bg: "#fff", notes: "", transition: { type: "none", duration: 500 }, layout: "title-content", elements: [{ id: "e2", type: "text", x: 0, y: 0, w: 100, h: 40, text: "年度总结 与 总结报告", fontSize: 24, color: "#111", bold: true, anim: { type: "none", duration: 400, delay: 0 }, emphasis: { type: "none" } }] }
  ] }
}, ctx);
let pn = pInst.replaceAll("总结", "汇总");
ok("presentation 多页替换计数=3", pn === 3);
let pser = pInst.serialize();
ok("presentation 第一页替换", pser.slides[0].elements[0].text === "季度汇总");
ok("presentation 第二页替换", pser.slides[1].elements[0].text === "年度汇总 与 汇总报告");
pInst.undo();
pser = pInst.serialize();
ok("presentation 撤销恢复", pser.slides[0].elements[0].text === "季度总结");

const summary = `REPLACE TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_replace_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
