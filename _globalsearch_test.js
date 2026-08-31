/* 绿角犀 Office · 全局文档搜索 jsdom 联调测试（验证各模块 search()） */
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
// 与 shell.js 中 snippet 保持一致的实现（模块 search 会调用 OS.shell.snippet）
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
const wHost = window.document.createElement("div"); window.document.body.appendChild(wHost);
const wInst = window.OS.modules.writer.mount(wHost, {
  name: "报告", type: "writer",
  data: { html: '<h1>第一章 项目计划</h1><p>这是项目计划的详细说明，项目计划需要排期。</p><p>第二章内容。</p>',
    comments: [], page: { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } },
    header: { left: "", center: "机密", right: "" }, footer: { left: "", center: "", right: "" } }
}, ctx);
let r = wInst.search("项目计划");
ok("writer 命中正文（排除页眉）", r.length === 2);
ok("writer 预览含 <mark> 包裹", r.length && r[0].previewHtml.indexOf("<mark>项目计划</mark>") !== -1);
ok("writer 标签为块类型", r.length && /^h1|p/.test(r[0].label));
// 搜索页眉中的「机密」应被排除
ok("writer 排除页眉命中", wInst.search("机密").length === 0);
// goto 不报错
let threw = false; try { r[0].goto(); } catch (e) { threw = true; }
ok("writer goto 不抛错", !threw);

/* ===== Presentation ===== */
const pHost = window.document.createElement("div"); window.document.body.appendChild(pHost);
const pInst = window.OS.modules.presentation.mount(pHost, {
  name: "演示", type: "presentation",
  data: { slides: [
    { bg: "#fff", notes: "", transition: { type: "none", duration: 500 }, elements: [{ id: "e1", type: "text", x: 0, y: 0, w: 100, h: 40, text: "季度总结", fontSize: 24, color: "#111", bold: true, anim: { type: "none", duration: 400, delay: 0 } }] },
    { bg: "#fff", notes: "", transition: { type: "none", duration: 500 }, elements: [{ id: "e2", type: "text", x: 0, y: 0, w: 100, h: 40, text: "年度报告", fontSize: 24, color: "#111", bold: true, anim: { type: "none", duration: 400, delay: 0 } }] }
  ] }
}, ctx);
r = pInst.search("年度");
ok("presentation 命中第2页", r.length === 1 && r[0].label.indexOf("第 2 页") !== -1);
ok("presentation 预览含 <mark>", r.length && r[0].previewHtml.indexOf("<mark>年度</mark>") !== -1);
threw = false; try { r[0].goto(); } catch (e) { threw = true; }
ok("presentation goto 不抛错", !threw);
ok("presentation goto 后画布显示第2页文本", pHost.querySelector(".pres-canvas-area .pres-canvas").textContent.indexOf("年度报告") !== -1);

/* ===== Spreadsheet ===== */
const sHost = window.document.createElement("div"); window.document.body.appendChild(sHost);
const sInst = window.OS.modules.spreadsheet.mount(sHost, {
  name: "表", type: "spreadsheet",
  data: { rows: 20, cols: 5, cells: { A1: { v: "苹果" }, B1: { v: "香蕉" }, A2: { v: 10 } }, styles: {}, charts: [], condFormats: [], filters: [] }
}, ctx);
r = sInst.search("香蕉");
ok("spreadsheet 命中 B1", r.length === 1 && r[0].label.indexOf("B1") === 0);
ok("spreadsheet 预览含 <mark>", r.length && r[0].previewHtml.indexOf("<mark>香蕉</mark>") !== -1);
threw = false; try { r[0].goto(); } catch (e) { threw = true; }
ok("spreadsheet goto 不抛错", !threw);
ok("spreadsheet goto 后选中 B1", sInst.status().active === "B1");
// 公式单元格也能搜到
const sHost2 = window.document.createElement("div"); window.document.body.appendChild(sHost2);
const sInst2 = window.OS.modules.spreadsheet.mount(sHost2, {
  name: "表2", type: "spreadsheet",
  data: { rows: 20, cols: 5, cells: { A1: { v: "合计" }, B1: { f: "=SUM(A2:A9)" } }, styles: {}, charts: [], condFormats: [], filters: [] }
}, ctx);
r = sInst2.search("SUM");
ok("spreadsheet 公式文本可搜", r.length === 1 && r[0].label.indexOf("B1") === 0);

const summary = `GLOBAL-SEARCH TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_globalsearch_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
