/* 绿角犀 Office · 演示元素级进入动画 jsdom 联调测试 */
const { JSDOM } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");
const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";

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

// 带元素（含进入动画）的演示数据
function slidesWithEl() {
  return [{
    bg: "#fff", transition: { type: "none", duration: 500 },
    elements: [{ id: "elA", type: "text", x: 60, y: 60, w: 240, h: 80, text: "标题", fontSize: 32, color: "#111827", anim: { type: "none", duration: 400, delay: 0 } }]
  }];
}

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

// 1) 数据模型默认值
const b = mod.blank();
ok("blank 元素默认 anim none", b.slides[0].elements[0].anim.type === "none" && b.slides[0].elements[0].anim.duration === 400 && b.slides[0].elements[0].anim.delay === 0);

// 2) 编辑态主画布不附加进入动画（withAnim 默认 false）
const host = window.document.createElement("div"); window.document.body.appendChild(host);
const inst = mod.mount(host, { name: "T", type: "presentation", data: { slides: slidesWithEl() } }, ctx);
const editEl = host.querySelector(".pres-canvas-area > .pres-canvas .el");
ok("编辑态主画布元素无进入动画", editEl && (editEl.style.animation === "" || editEl.style.animation === "none"));

// 3) 选中元素 → animAPI.set → 序列化持久化
editEl.click();
ok("点击后选中元素", inst.animAPI.get(0)[0].type === "none");
const setOk = inst.animAPI.set({ type: "fly-up", duration: 600, delay: 200 });
ok("animAPI.set 返回成功", setOk === true);
ok("set 改元素 anim", inst.animAPI.get(0)[0].type === "fly-up" && inst.animAPI.get(0)[0].duration === 600 && inst.animAPI.get(0)[0].delay === 200);
ok("set 序列化持久化", inst.serialize().slides[0].elements[0].anim.type === "fly-up");

// 4) 编辑区预览写入 el-* 动画 + delay
inst.animAPI.preview();
const pv = host.querySelector(".pres-canvas-area > .pres-canvas .el");
ok("预览写入 el-fly-up", pv.style.animation.indexOf("el-fly-up") !== -1 && pv.style.animation.indexOf("600ms") !== -1 && pv.style.animation.indexOf("ease both") !== -1);
ok("预览写入 animation-delay", pv.style.animationDelay.indexOf("200ms") !== -1);

// 5) 放映视图：元素进入动画生效（el-*），且 delay 0 时不写 delay
const host2 = window.document.createElement("div"); window.document.body.appendChild(host2);
const inst2 = mod.mount(host2, { name: "T2", type: "presentation", data: { slides: [{
  bg: "#fff", transition: { type: "fade", duration: 500 },
  elements: [
    { id: "e1", type: "text", x: 40, y: 40, w: 200, h: 60, text: "A", fontSize: 28, color: "#111", anim: { type: "zoom", duration: 400, delay: 0 } },
    { id: "e2", type: "shape", shape: "rect", x: 300, y: 200, w: 160, h: 100, fill: "#93c5fd", anim: { type: "fly-left", duration: 600, delay: 300 } }
  ]
}] } }, ctx);
host2.querySelector('[data-act="present"]').click();
const p = window.document.querySelector(".presenter");
ok("放映视图打开", !!p);
const els = p.querySelectorAll(".p-main .slide .el");
ok("放映元素数=2", els.length === 2);
ok("元素1 zoom 无 delay", els[0].style.animation.indexOf("el-zoom") !== -1 && els[0].style.animation.indexOf("400ms") !== -1 && (els[0].style.animationDelay === "" || els[0].style.animationDelay === "0ms"));
ok("元素2 fly-left 带 delay", els[1].style.animation.indexOf("el-fly-left") !== -1 && els[1].style.animation.indexOf("600ms") !== -1 && els[1].style.animationDelay.indexOf("300ms") !== -1);
// 幻灯片切换动画（tr-fade）也作用在容器上
ok("幻灯片容器切换动画", p.querySelector(".p-main .slide").style.animation.indexOf("tr-fade") !== -1);
p.querySelector('[data-p="exit"]').click();
ok("退出移除放映", !window.document.querySelector(".presenter"));

// 6) 序列化往返保持元素动画
const reload = mod.mount(window.document.createElement("div"), { name: "R", type: "presentation", data: inst.serialize() }, ctx);
ok("重载保留元素 anim", reload.animAPI.get(0)[0].type === "fly-up" && reload.animAPI.get(0)[0].delay === 200);

const summary = `ENTRANCE TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_entrance_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
