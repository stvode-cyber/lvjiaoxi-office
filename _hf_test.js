/* 绿角犀 Office · Writer 页眉页脚 + 页码 + 打印分页 jsdom 联调测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = "D:/源码存档/绿角犀办公软件/app";

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
const inst = mod.mount(host, { name: "测试文档", type: "writer", data: mod.blank() }, ctx);

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); } }
const pageEl = host.querySelector(".writer-page");

// 1) 默认页眉页脚带渲染
ok("页眉存在", !!pageEl.querySelector(".wh-header"));
ok("页脚存在", !!pageEl.querySelector(".wh-footer"));
ok("页眉 3 个单元格", pageEl.querySelectorAll(".wh-header .wh-cell").length === 3);
ok("页脚 3 个单元格", pageEl.querySelectorAll(".wh-footer .wh-cell").length === 3);
ok("hfAPI.cells = 6", inst.hfAPI.cells() === 6);

// 2) hfAPI.set 更新数据并回填单元格（屏显保留字面令牌）
inst.hfAPI.set({ header: { left: "左", center: "第 &[PAGE] 页 / 共 &[PAGES] 页", right: "" }, footer: { left: "", center: "&[DATE]", right: "&[TITLE]" } });
let h = inst.hfAPI.get();
ok("set 后 header.center 持久化", h.header.center === "第 &[PAGE] 页 / 共 &[PAGES] 页");
ok("set 后 footer.right = 标题令牌", h.footer.right === "&[TITLE]");
const centerCell = pageEl.querySelector(".wh-header .wh-c");
ok("屏显单元格保留字面 &[PAGE]", centerCell.textContent.indexOf("&[PAGE]") !== -1);
ok("屏显单元格保留字面 &[PAGES]", centerCell.textContent.indexOf("&[PAGES]") !== -1);

// 3) resolveTokens
ok("resolve PAGE/PAGES", inst.hfAPI.resolve("第 &[PAGE] 页 / 共 &[PAGES] 页", 3, 10) === "第 3 页 / 共 10 页");
ok("resolve TITLE", inst.hfAPI.resolve("标题:&[TITLE]", null, null) === "标题:" + "测试文档");
ok("resolve DATE 非空且非字面令牌", (() => { const r = inst.hfAPI.resolve("&[DATE]", null, null); return r.length > 0 && r.indexOf("&[DATE]") === -1; })());

// 4) bodyHtml 排除页眉页脚
const bh = inst.hfAPI.bodyHtml();
ok("bodyHtml 无 wh-header", bh.indexOf("wh-header") === -1);
ok("bodyHtml 无 wh-footer", bh.indexOf("wh-footer") === -1);
ok("bodyHtml 含正文 h1", bh.indexOf("未命名文档") !== -1);

// 5) serialize 含 header/footer
const ser = inst.serialize();
ok("serialize 含 header", ser.header && ser.header.center.indexOf("&[PAGE]") !== -1);
ok("serialize 含 footer", ser.footer && ser.footer.right === "&[TITLE]");
ok("serialize body 不含 bands", ser.html.indexOf("wh-header") === -1);

// 6) 重新挂载还原
const host2 = window.document.createElement("div");
window.document.body.appendChild(host2);
const inst2 = mod.mount(host2, { name: "测试文档", type: "writer", data: ser }, ctx);
ok("重载 header.center 还原", inst2.hfAPI.get().header.center.indexOf("&[PAGE]") !== -1);

// 7) 打印分页：每页重复页眉页脚 + 正确页码
// 用 measureFn 桩返回固定高度 2000px，A4 纵向内容区 Ch≈934px → ceil(2000/934)=3 页
const measure2000 = () => 2000;
const N = inst.printAPI.pageCount({ measureFn: measure2000 });
ok("分页总数 = 3", N === 3);
const root = inst.printAPI.buildPages({ measureFn: measure2000 });
ok("buildPages 生成 3 个 pp-page", root.children.length === 3);
const p0 = root.children[0], p1 = root.children[1], p2 = root.children[2];
ok("每页含 pp-header", !!p0.querySelector(".pp-header") && !!p1.querySelector(".pp-header") && !!p2.querySelector(".pp-header"));
ok("每页含 pp-footer", !!p0.querySelector(".pp-footer"));
ok("第1页 PAGE=1", p0.querySelector(".pp-header .pp-c").innerHTML.indexOf("第 1 页") !== -1);
ok("第1页 PAGES=3", p0.querySelector(".pp-header .pp-c").innerHTML.indexOf("共 3 页") !== -1);
ok("第2页 PAGE=2", p1.querySelector(".pp-header .pp-c").innerHTML.indexOf("第 2 页") !== -1);
ok("第3页 PAGE=3", p2.querySelector(".pp-header .pp-c").innerHTML.indexOf("第 3 页") !== -1);
ok("页脚含标题令牌解析", p0.querySelector(".pp-footer .pp-r").innerHTML.indexOf("测试文档") !== -1);
const c0 = p0.querySelector(".pp-content").getAttribute("style");
const c1 = p1.querySelector(".pp-content").getAttribute("style");
const mmToPx = mm => Math.round(mm * 96 / 25.4);
const Ch = mmToPx(297) - mmToPx(25) - mmToPx(25); // 935
ok("内容窗口 translateY 偏移", c0.indexOf("translateY(0px)") !== -1 && c1.indexOf("translateY(-" + Ch + "px)") !== -1);

// 8) 分页符：插入后多一段，页数为 2 段×3 = 6
inst.importHtml('<h1>甲</h1><div class="page-break" contenteditable="false" data-page-break><span>分 页 符</span></div><h1>乙</h1>');
const N2 = inst.printAPI.pageCount({ measureFn: measure2000 });
ok("含分页符后页数 = 6（两段各3页）", N2 === 6);
ok("importHtml 后仍有页眉页脚带", !!host.querySelector(".writer-page .wh-header"));

// 9) 弹窗构建 + 保存
inst.hfAPI.open();
let ov = host.querySelector(".hf-overlay");
ok("hf 弹窗打开", !!ov);
ok("hf 弹窗含 2 个 zone", ov.querySelectorAll(".hf-zone").length === 2);
ov.querySelectorAll(".hf-zone")[0].querySelector(".hf-c").value = "封面 &[PAGE]";
ov.querySelector(".pg-ok").click();
ov = host.querySelector(".hf-overlay");
ok("hf 弹窗保存后关闭", !ov);
ok("hf 保存后 center 更新且持久化", inst.hfAPI.get().header.center === "封面 &[PAGE]");

const summary = `HF TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAILURES: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_hf_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
