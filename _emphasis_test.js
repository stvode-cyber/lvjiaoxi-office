/* 绿角犀 Office · 演示点击强调动画 jsdom 联调测试 */
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
OS.util = { uid: p => (p || "id") + Math.random().toString(36).slice(2, 8), debounce: f => f, escapeHtml: s => String(s == null ? "" : s) };
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; } };
OS.icons = { svg: () => "<svg></svg>" };
OS.shell = { snippet: () => "" };
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/presentation.js"), "utf8");
const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);

const mod = window.OS.modules.presentation;
const ctx = { markDirty() {}, openBackstage() {} };
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

const host = window.document.createElement("div"); window.document.body.appendChild(host);
const inst = mod.mount(host, { name: "P", type: "presentation" }, ctx);
// 默认每页元素带 emphasis:{type:"none"}
ok("默认 emphasis none", inst.serialize().slides[0].elements[0].emphasis && inst.serialize().slides[0].elements[0].emphasis.type === "none");

// 选中元素（点击编辑主画布中的元素）
host.querySelector(".pres-canvas-area .pres-canvas .el").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok("emphasisAPI.set 返回 true", inst.emphasisAPI.set("pulse") === true);
ok("序列化保存 emphasis=pulse", inst.serialize().slides[0].elements[0].emphasis.type === "pulse");

// 直接对 DOM 元素施加强调动画
const fake = window.document.createElement("div");
inst.emphasisAPI.apply(fake);
ok("apply 写入 em-pulse 动画", fake.style.animation.indexOf("em-pulse") !== -1);

// 动画结束后还原为空（避免重放入场）
let ended = false;
fake.addEventListener("animationend", () => { ended = true; });
fake.dispatchEvent(new window.Event("animationend"));
ok("animationend 后还原", fake.style.animation === "");

// 放映时点击元素触发强调
host.querySelector('[data-act="present"]').click();
const presEl = window.document.querySelector(".presenter .p-main .slide .el");
ok("放映画布存在元素", !!presEl);
presEl.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok("放映点击触发 em-pulse", presEl.style.animation.indexOf("em-pulse") !== -1);

// 退出放映
const exitBtn = window.document.querySelector('.presenter [data-p="exit"]');
if (exitBtn) exitBtn.click();

const summary = `EMPHASIS TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_emphasis_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
