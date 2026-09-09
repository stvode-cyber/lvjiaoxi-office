/* 绿角犀 Office · 演示母版版式 + 箭头形状 + 撤销重做 jsdom 联调测试 */
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

// 1) 默认版式
ok("默认版式 title-content", inst.layout() === "title-content");
ok("layouts 列表含 4 项", inst.layouts().length === 4);

// 2) 撤销 / 重做（增元素）
const before = inst.serialize().slides[0].elements.length;
inst.addEl({ text: "X" });
ok("addEl 增加元素", inst.serialize().slides[0].elements.length === before + 1);
ok("canUndo 为真", inst.canUndo() === true);
inst.undo();
ok("undo 后元素数恢复", inst.serialize().slides[0].elements.length === before);
ok("canRedo 为真", inst.canRedo() === true);
inst.redo();
ok("redo 后元素数恢复+1", inst.serialize().slides[0].elements.length === before + 1);

// 3) 母版版式：标题+内容 生成占位元素
inst.setLayout("title-content");
let s0 = inst.serialize().slides[0];
ok("setLayout 序列化 layout", s0.layout === "title-content");
ok("含 title 占位", s0.elements.some(e => e.role === "title" && e.placeholder));
ok("含 content 占位", s0.elements.some(e => e.role === "content" && e.placeholder));
// 再次应用相同版式应保持幂等（不会重复添加占位）
inst.setLayout("title-content");
ok("重复应用版式幂等", inst.serialize().slides[0].elements.filter(e => e.placeholder).length === 2);
// 空白版式清除占位
inst.setLayout("blank");
s0 = inst.serialize().slides[0];
ok("blank 清除占位", s0.layout === "blank" && s0.elements.filter(e => e.placeholder).length === 0);

// 4) 箭头形状
inst.addEl({ type: "shape", shape: "arrow", stroke: "#111827", w: 180, h: 24 });
const arrow = inst.serialize().slides[0].elements.find(e => e.shape === "arrow");
ok("arrow 元素序列化", !!arrow && arrow.shape === "arrow");
const svg = host.querySelector(".pres-canvas-area .pres-canvas svg");
ok("arrow 渲染 svg 元素", !!svg);

// 5) 撤销 / 重做（增幻灯片）
const n0 = inst.serialize().slides.length;
host.querySelector('[data-act="add"]').click();
ok("add 幻灯片 +1", inst.serialize().slides.length === n0 + 1);
inst.undo();
ok("undo 幻灯片数恢复", inst.serialize().slides.length === n0);
inst.redo();
ok("redo 幻灯片数恢复+1", inst.serialize().slides.length === n0 + 1);

// 6) 删除选中元素
inst.setCur(0);
const elDom = host.querySelector(".pres-canvas-area .pres-canvas .el");
elDom.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const cntBefore = inst.serialize().slides[0].elements.length;
inst.deleteEl();
ok("deleteEl 减少一个元素", inst.serialize().slides[0].elements.length === cntBefore - 1);

const summary = `PRES-MASTER TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_presmaster_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
