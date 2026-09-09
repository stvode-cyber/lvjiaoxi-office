/* 绿角犀 Office · 演示切换动画 jsdom 联调测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} }; };

function ribStub() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return window.document.createElement("div"); } }; }
const OS = {};
OS.Ribbon = { create() { return ribStub(); } };
OS.toast = () => {};
OS.util = {
  uid: p => (p || "id") + Math.random().toString(36).slice(2, 8),
  debounce: f => f, escapeHtml: s => String(s == null ? "" : s), fmtTime: t => new Date(t).toLocaleString(),
  download() {}, readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; } };
OS.icons = { svg: () => "<svg></svg>" };
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/presentation.js"), "utf8");
const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);

const mod = window.OS.modules.presentation;
const ctx = { markDirty() {}, openBackstage() {} };

// 每实例独立的新鲜 3 页：fade / push / none
function slides3() { return [
  { bg: "#fff", transition: { type: "fade", duration: 500 }, elements: [] },
  { bg: "#fff", transition: { type: "push", duration: 600 }, elements: [] },
  { bg: "#fff", transition: { type: "none", duration: 500 }, elements: [] }
]; }

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

// 1) 数据模型 + 单页 setTransition + 序列化
const host = window.document.createElement("div"); window.document.body.appendChild(host);
const inst = mod.mount(host, { name: "T", type: "presentation", data: { slides: slides3() } }, ctx);
ok("blank 默认 transition", mod.blank().slides[0].transition.type === "none" && mod.blank().slides[0].transition.duration === 500);
ok("载入保留 transition", inst.transition(0).type === "fade" && inst.transition(0).duration === 500);

inst.setTransition({ type: "zoom", duration: 800 });
ok("setTransition 改当前页", inst.transition(0).type === "zoom" && inst.transition(0).duration === 800);
ok("setTransition 不动其他页", inst.transition(1).type === "push");
ok("setTransition 序列化持久化", inst.serialize().slides[0].transition.type === "zoom");
ok("transition 不含 all 键", inst.transition(0).all === undefined);

// 2) 应用到全部（独立实例，避免污染）
const hostA = window.document.createElement("div"); window.document.body.appendChild(hostA);
const instA = mod.mount(hostA, { name: "TA", type: "presentation", data: { slides: slides3() } }, ctx);
instA.setTransition({ type: "wipe", duration: 400, all: true });
ok("全部应用：页0", instA.transition(0).type === "wipe" && instA.transition(0).duration === 400);
ok("全部应用：页1", instA.transition(1).type === "wipe");
ok("全部应用：页2", instA.transition(2).type === "wipe");
ok("全部应用不泄漏 all 键", instA.transition(1).all === undefined);

// 3) 编辑区预览（主画布用 .pres-canvas-area > .pres-canvas，避免命中缩略图）
const host2 = window.document.createElement("div"); window.document.body.appendChild(host2);
const inst2 = mod.mount(host2, { name: "T2", type: "presentation", data: { slides: slides3() } }, ctx);
inst2.setCur(0);
inst2.previewTransition();
const cv = host2.querySelector(".pres-canvas-area > .pres-canvas");
ok("预览写入编辑区动画", cv && cv.style.animation.indexOf("tr-fade") !== -1 && cv.style.animation.indexOf("500ms") !== -1);

// 4) 放映视图：首屏动画 + 导航方向
inst2.setCur(0);
host2.querySelector('[data-act="present"]').click();
const p = window.document.querySelector(".presenter");
ok("放映视图已打开", !!p);
let slideEl = p.querySelector(".p-main .slide");
ok("首屏按本页 transition（fade）", slideEl.style.animation.indexOf("tr-fade") !== -1 && slideEl.style.animation.indexOf("500ms") !== -1);

p.querySelector('[data-p="next"]').click();
slideEl = p.querySelector(".p-main .slide");
ok("下一页 push 正向", slideEl.style.animation.indexOf("tr-push") !== -1 && slideEl.style.animation.indexOf("tr-push-rev") === -1 && slideEl.style.animation.indexOf("600ms") !== -1);

p.querySelector('[data-p="next"]').click();
slideEl = p.querySelector(".p-main .slide");
ok("none 页清空动画", slideEl.style.animation === "" || slideEl.style.animation === "none");

p.querySelector('[data-p="prev"]').click();
slideEl = p.querySelector(".p-main .slide");
ok("上一页 push 反向 -rev", slideEl.style.animation.indexOf("tr-push-rev") !== -1);

p.querySelector('[data-p="exit"]').click();
ok("退出后移除放映视图", !window.document.querySelector(".presenter"));

const summary = `TRANSITION TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_transition_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
