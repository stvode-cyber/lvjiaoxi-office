/* 绿角犀 Office · Writer 页面设置 jsdom 联调测试 */
const { JSDOM } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");
const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} }; };

const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return null; } }; } };
OS.toast = () => {};
OS.util = {
  debounce: f => f,
  escapeHtml: s => String(s == null ? "" : s),
  fmtTime: t => new Date(t).toLocaleString(),
  download() {},
  readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; }, local: { critique: t => t } };
OS.icons = { svg: () => "<svg></svg>" };
OS.blankDoc = t => ({ type: t, data: {} });
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/writer.js"), "utf8");
const s = window.document.createElement("script");
s.textContent = code;
window.document.body.appendChild(s);

const mod = window.OS.modules.writer;
const host = window.document.createElement("div");
window.document.body.appendChild(host);
const ctx = { markDirty() {}, openBackstage() {} };
const inst = mod.mount(host, { name: "t", type: "writer", data: mod.blank() }, ctx);

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); } }
const pageEl = host.querySelector(".writer-page");
const padAll = (v) => pageEl.style.paddingTop === v && pageEl.style.paddingRight === v && pageEl.style.paddingBottom === v && pageEl.style.paddingLeft === v;

// 1) 默认 A4 纵向 25mm
let st = inst.pageAPI.style();
ok("default width A4 portrait = 605px", st.width === "605px");
ok("default minHeight A4 portrait = 934px", st.minHeight === "934px");
ok("default padding 25mm = 94px all", padAll("94px"));
ok("box-sizing border-box", st.boxSizing === "border-box");
ok("paper background default white", pageEl.style.backgroundColor === "rgb(255, 255, 255)");

// 2) 横向
inst.pageAPI.set({ orientation: "landscape" });
st = inst.pageAPI.style();
ok("landscape width A4 = 934px", st.width === "934px");
ok("landscape minHeight A4 = 605px", st.minHeight === "605px");

// 3) 改页边距 10mm（顺带恢复纵向）
inst.pageAPI.set({ orientation: "portrait", margin: { top: 10, right: 10, bottom: 10, left: 10 } });
st = inst.pageAPI.style();
ok("10mm padding = 38px all", padAll("38px"));
ok("A4 portrait 10mm width = 718px", st.width === "718px");

// 4) A3 横向
inst.pageAPI.set({ size: "A3", orientation: "landscape", margin: { top: 25, right: 25, bottom: 25, left: 25 } });
st = inst.pageAPI.style();
ok("A3 landscape width = 1398px", st.width === "1398px");
ok("A3 landscape minHeight = 934px", st.minHeight === "934px");

// 5) get 返回正确对象
const pg = inst.pageAPI.get();
ok("get size A3", pg.size === "A3");
ok("get orientation landscape", pg.orientation === "landscape");
ok("get margin 25", pg.margin.top === 25 && pg.margin.left === 25);

// 6) metrics
const m = inst.pageAPI.metrics();
ok("metrics A3 landscape = 420x297", m.w === 420 && m.h === 297);

// 7) printCss
inst.pageAPI.set({ size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } });
ok("printCss A4 portrait 25mm", inst.pageAPI.printCss() === "@page{size:210mm 297mm;margin:0}");
// print style element 注入 head
const ps = window.document.getElementById("pg-print-style");
ok("print style element injected", !!ps);
ok("print style has @page", ps && ps.textContent.indexOf("@page{size:210mm 297mm") === 0);
ok("print style hides ribbon", ps && ps.textContent.indexOf(".ribbon") !== -1);

// 8) 弹窗构建 + 交互
inst.pageAPI.open();
let ov = host.querySelector(".pg-overlay");
ok("modal opened", !!ov);
ok("modal has A4 selected", ov.querySelector(".pg-size").value === "A4");
// 切到横向并点确定
ov.querySelector('.pg-orient button[data-o="landscape"]').click();
ov.querySelector(".pg-ok").click();
ov = host.querySelector(".pg-overlay");
ok("modal closed after ok", !ov);
ok("after modal orientation = landscape", inst.pageAPI.get().orientation === "landscape");
ok("after modal width = 934px", inst.pageAPI.style().width === "934px");

// 9) 取消不生效
inst.pageAPI.open();
ov = host.querySelector(".pg-overlay");
ov.querySelector('.pg-size').value = "A5";
ov.querySelector(".pg-cancel").click();
ok("cancel keeps A4-size source", inst.pageAPI.get().size === "A4");

// 10) serialize 持久化
const ser = inst.serialize();
ok("serialize has page", ser.page && ser.page.size === "A4" && ser.page.orientation === "landscape");

// 11) 重新挂载还原页面设置
const host2 = window.document.createElement("div");
window.document.body.appendChild(host2);
const inst2 = mod.mount(host2, { name: "t2", type: "writer", data: ser }, ctx);
ok("reload size restored", inst2.pageAPI.get().size === "A4");
ok("reload orientation restored", inst2.pageAPI.get().orientation === "landscape");

const summary = `PAGE TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAILURES: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_page_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
