/* 条件格式 jsdom 联调测试 —— 结果写入 _cond_result.txt */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";
const code = fs.readFileSync(path.join(APP, "js/modules/spreadsheet.js"), "utf8");

const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { runScripts: "dangerously" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return { measureText: () => ({ width: 0 }) }; };

// —— 最小化 OS 桩（仅满足 mount 运行所需）——
const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return null; } }; } };
OS.toast = () => {};
OS.util = {
  escapeHtml: s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])),
  download() {}
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; } };
OS.blankDoc = t => ({ type: t, data: {} });
window.OS = OS;

const s = window.document.createElement("script");
s.textContent = code;
window.document.body.appendChild(s);

const mod = window.OS.modules.spreadsheet;
const host = window.document.createElement("div");
window.document.body.appendChild(host);
const ctx = { markDirty() {}, openBackstage() {} };
const inst = mod.mount(host, { name: "t", type: "spreadsheet", data: mod.blank() }, ctx);

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("FAIL:", name); } }

const C = col => "C" + col;
// 写入数值
inst.commit("B1", "10"); inst.commit("B2", "60"); inst.commit("B3", "80");
inst.commit("B4", "30"); inst.commit("B5", "55");
// 重复值用例
inst.commit("C1", "1"); inst.commit("C2", "2"); inst.commit("C3", "2");
inst.commit("C4", "3"); inst.commit("C5", "1");

function bg(ref) { const td = host.querySelector(`td[data-ref="${ref}"]`); return td ? td.style.backgroundColor : ""; }
function barImg(ref) { const td = host.querySelector(`td[data-ref="${ref}"]`); return td ? td.style.backgroundImage : ""; }
function hasBarClass(ref) { const td = host.querySelector(`td[data-ref="${ref}"]`); return td ? td.classList.contains("cf-bar") : false; }

// 1) 突出显示单元格：大于 50
inst.addCondFormat({ id: "r1", type: "cell", range: "B1:B5", op: "gt", v: "50", bg: "#ffc7ce" });
ok("cell.highlight B2", bg("B2") === "rgb(255, 199, 206)");
ok("cell.highlight B3", bg("B3") === "rgb(255, 199, 206)");
ok("cell.highlight B5", bg("B5") === "rgb(255, 199, 206)");
ok("cell.no-highlight B1", bg("B1") === "");
ok("cell.no-highlight B4", bg("B4") === "");

// 2) 介于 30~60
inst.removeCondFormat("r1");
inst.addCondFormat({ id: "r2", type: "cell", range: "B1:B5", op: "between", v: "30", v2: "60", bg: "#c6efce" });
ok("between B1(10) off", bg("B1") === "");
ok("between B2(60) on", bg("B2") === "rgb(198, 239, 206)");
ok("between B3(80) off", bg("B3") === "");
ok("between B4(30) on", bg("B4") === "rgb(198, 239, 206)");

// 3) 色阶（双色）min..max
inst.removeCondFormat("r2");
inst.addCondFormat({ id: "r3", type: "scale", range: "B1:B5", minColor: "#f8696b", maxColor: "#63be7b" });
ok("scale B1=min", bg("B1") === "rgb(248, 105, 107)");
ok("scale B3=max", bg("B3") === "rgb(99, 190, 123)");
const midColor = bg("B2"); // 60 在 10..80 之间应被插值（非纯端点色）
ok("scale B2 interpolated (not endpoint)", midColor !== "rgb(248, 105, 107)" && midColor !== "rgb(99, 190, 123)" && midColor.startsWith("rgb("));

// 4) 数据条
inst.removeCondFormat("r3");
inst.addCondFormat({ id: "r4", type: "bar", range: "B1:B5", color: "#638ec6" });
ok("bar B3 (max=80) pct 100", /100\.0%/.test(barImg("B3")));
ok("bar B1 (min=10) pct ~0", /0\.0%/.test(barImg("B1")));
ok("bar B2 has bar class", hasBarClass("B2"));
ok("bar B4 (>0) nonzero width", /[1-9]\d*\.\d%/.test(barImg("B4")) || /[1-9]\d%/.test(barImg("B4")));

// 5) 项目选取：前 2 项
inst.removeCondFormat("r4");
inst.addCondFormat({ id: "r5", type: "top", range: "B1:B5", n: 2, percent: false, top: true, bg: "#ffeb9c" });
ok("top2 B3(80) on", bg("B3") === "rgb(255, 235, 156)");
ok("top2 B2(60) on", bg("B2") === "rgb(255, 235, 156)");
ok("top2 B1(10) off", bg("B1") === "");

// 5b) 项目选取：后 1 项（最小）
inst.removeCondFormat("r5");
inst.addCondFormat({ id: "r6", type: "top", range: "B1:B5", n: 1, percent: false, top: false, bg: "#ddebf7" });
ok("bottom1 B1(10) on", bg("B1") === "rgb(221, 235, 247)");
ok("bottom1 B5(55) off", bg("B5") === "");

// 6) 重复值
inst.removeCondFormat("r6");
inst.addCondFormat({ id: "r7", type: "dupes", range: "C1:C5", bg: "#ffc7ce" });
ok("dupes C1(1) on", bg("C1") === "rgb(255, 199, 206)");
ok("dupes C2(2) on", bg("C2") === "rgb(255, 199, 206)");
ok("dupes C3(2) on", bg("C3") === "rgb(255, 199, 206)");
ok("dupes C4(3) off", bg("C4") === "");
ok("dupes C5(1) on", bg("C5") === "rgb(255, 199, 206)");

// 7) 移除规则后样式清空
inst.removeCondFormat("r7");
ok("after remove C1 cleared", bg("C1") === "");
ok("after remove B3 cleared", bg("B3") === "");

// 8) 计算接口
const cf = inst.computeCF();
ok("computeCF returns object", typeof cf === "object");
ok("cfStyleOf B1 null when no rules", inst.cfStyleOf("B1") === null);
inst.addCondFormat({ id: "r8", type: "cell", range: "B1:B5", op: "gt", v: "70", bg: "#c6efce" });
ok("cfStyleOf B3 has bg", inst.cfStyleOf("B3") && inst.cfStyleOf("B3").bg === "rgb(198, 239, 206)");
ok("condFormats count", inst.condFormats().length === 1);

// 9) 手动填充优先于条件格式（precedence）
inst.removeCondFormat("r8");
inst.commit("D1", "42");
inst.addCondFormat({ id: "r9", type: "cell", range: "D1:D1", op: "gt", v: "1", bg: "#ffc7ce" });
// 手动设置 D1 填充色
inst.selectCell("D1");
// 通过 setStyle 路径设置手动 bg
inst.ribbon; // noop
// 直接走 commit 路径不可设样式，改为用内部 data.styles + applyFmt 模拟
window.OS; // ensure
// 设置手动样式后重新应用
host.querySelector(`td[data-ref="D1"]`).style.backgroundColor = ""; // reset
inst.selectCell("D1");
// 触发 setStyle 经由 ribbon 不可达，这里直接验证：手动样式在 data.styles 存在时条件格式不覆盖
dataStyleSet("D1", "#0000ff");
ok("manual bg beats cond bg", bg("D1") === "rgb(0, 0, 255)");
function dataStyleSet(ref, color) {
  inst.serialize().styles[ref] = Object.assign(inst.serialize().styles[ref] || {}, { bg: color });
  inst.applyCondFormat();
}

// 10) HTML 导出含条件格式填充
inst.removeCondFormat("r9");
inst.addCondFormat({ id: "r10", type: "cell", range: "B1:B5", op: "gt", v: "50", bg: "#ffc7ce" });
let captured = "";
const realDownload = OS.util.download;
OS.util.download = (blob) => { captured = "downloaded"; };
inst.exportAs("html");
OS.util.download = realDownload;
ok("html export invoked", captured === "downloaded");
ok("condFormats persisted in data", inst.serialize().condFormats.length >= 1);

// 11) 规则弹窗 / 管理器 UI 构建不报错
inst.openRuleModal("cell");
ok("rule modal (cell) opens", !!host.querySelector(".cf-overlay"));
inst.openManager();
const overlays = host.querySelectorAll(".cf-overlay");
ok("manager opens", overlays.length >= 1);
overlays.forEach(o => o.remove());
inst.openRuleModal("scale");
ok("rule modal (scale) opens", !!host.querySelector(".cf-overlay"));
host.querySelectorAll(".cf-overlay").forEach(o => o.remove());
inst.openRuleModal("top");
ok("rule modal (top) opens", !!host.querySelector(".cf-overlay"));
host.querySelectorAll(".cf-overlay").forEach(o => o.remove());

const summary = `\n=== 条件格式测试 ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
fs.writeFileSync(path.join(APP, "../_cond_result.txt"), summary, "utf8");
console.log(summary);
process.exit(fail ? 1 : 0);
