/* 绿角犀 Office · 表格 撤销/重做 + 合并单元格 + 数据验证 jsdom 联调测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () {
  return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} };
};
function makeZipStub() { const files = {}; const zip = { file(n, c) { files[n] = c; return zip; }, folder() { return zip; }, generateAsync() { return Promise.resolve({ _files: files }); } }; return zip; }
window.JSZip = function () { return makeZipStub(); };

const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return null; } }; } };
OS.toast = () => {};
OS.util = {
  uid: p => (p || "id") + Math.random().toString(36).slice(2, 8),
  debounce: f => f, escapeHtml: s => String(s == null ? "" : s), fmtTime: t => new Date(t).toLocaleString(),
  download(b, n) {}, readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; }, local: { critique: t => t } };
OS.icons = { svg: () => "<svg></svg>" };
OS.blankDoc = t => ({ type: t, data: {} });
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/spreadsheet.js"), "utf8");
const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);

const mod = window.OS.modules.spreadsheet;
const host = window.document.createElement("div"); window.document.body.appendChild(host);
const ctx = { markDirty() {}, openBackstage() {} };

const inst = mod.mount(host, { name: "T", type: "spreadsheet", data: { rows: 30, cols: 10, cells: { A1: { v: "顶" } }, styles: {}, charts: [], condFormats: [], filters: [] } }, ctx);

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

function sheetCells() { return inst.serialize().sheets[inst.activeSheet()].cells; }

// 1) 基础撤销 / 重做（单元格编辑）
inst.selectCell("A1");
inst.commit("B1", 42);
ok("commit 写入 B1=42", sheetCells().B1 && sheetCells().B1.v === 42);
ok("canUndo 为真", inst.canUndo() === true);
inst.undo();
ok("undo 后 B1 消失", !sheetCells().B1);
ok("A1 仍保留", sheetCells().A1 && sheetCells().A1.v === "顶");
ok("canRedo 为真", inst.canRedo() === true);
inst.redo();
ok("redo 后 B1 恢复", sheetCells().B1 && sheetCells().B1.v === 42);

// 2) 合并单元格
inst.selectCell("B2"); inst.extendTo("D3");
const merged = inst.mergeSelection("merge");
ok("mergeSelection 成功", merged === true);
ok("merges 记录 1 条", inst.merges().length === 1);
const serMerge = inst.serialize();
ok("序列化含 merge(B2:D3,merge)", serMerge.sheets[0].merge.length === 1 && serMerge.sheets[0].merge[0].range === "B2:D3" && serMerge.sheets[0].merge[0].type === "merge");
const b2 = host.querySelector('td[data-ref="B2"]');
ok("B2 colspan=3", b2.getAttribute("colspan") === "3");
ok("B2 rowspan=2", b2.getAttribute("rowspan") === "2");
const c2 = host.querySelector('td[data-ref="C2"]');
ok("C2 被合并隐藏(merged-hidden)", c2.classList.contains("merged-hidden"));

// 3) 撤销合并 / 重做合并
inst.undo();
ok("undo 后 merges 清空", inst.merges().length === 0);
ok("undo 后 B2 无 colspan", !host.querySelector('td[data-ref="B2"]').getAttribute("colspan"));
inst.redo();
ok("redo 后 merges 恢复", inst.merges().length === 1);

// 4) 取消合并
const um = inst.unmerge("B2:D3");
ok("unmerge 成功", um === true);
ok("unmerge 后 merges 为 0", inst.merges().length === 0);

// 5) 跨列居中合并
inst.selectCell("B2"); inst.extendTo("D2");
inst.mergeSelection("center");
ok("center 合并带 merged-center 类", host.querySelector('td[data-ref="B2"]').classList.contains("merged-center"));
ok("center 合并 colspan=3", host.querySelector('td[data-ref="B2"]').getAttribute("colspan") === "3");

// 6) 数据验证（下拉列表）
inst.setValidation("A1:A3", { type: "list", list: ["优", "良", "中"] });
ok("validations 记录 1 条", inst.validations().length === 1);
ok("list 校验通过(优)", inst.validateCell("A1", "优").ok === true);
ok("list 校验拒绝(差)", inst.validateCell("A1", "差").ok === false);
ok("空值默认允许", inst.validateCell("A1", "").ok === true);
ok("序列化含 validation", inst.serialize().sheets[0].validations.length === 1);

// 7) 撤销 / 重做 验证
inst.undo();
ok("undo 后 validations 清空", inst.validations().length === 0);
inst.redo();
ok("redo 后 validations 恢复", inst.validations().length === 1);

// 8) 数据验证（数值区间）
inst.setValidation("B1:B3", { type: "number", min: 1, max: 10 });
ok("数字校验区间内通过", inst.validateCell("B1", "5").ok === true);
ok("数字校验超上限失败", inst.validateCell("B1", "20").ok === false);
ok("数字校验非数字失败", inst.validateCell("B1", "abc").ok === false);

// 9) 删除验证
const rm = inst.removeValidation("A1:A3");
ok("removeValidation 成功", rm === true);
ok("remove 后仅剩数字规则", inst.validations().length === 1);

// 10) 撤销栈可跨多种操作（编辑→合并→验证 顺序撤销）
inst.undo(); // 撤销 removeValidation（数字规则回到两条）
ok("undo removeValidation 后恢复 2 条", inst.validations().length === 2);
inst.undo(); // 撤销 number setValidation
ok("再 undo 后仅 1 条(list)", inst.validations().length === 1);

const summary = `SHEET-TOOLS TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
fs.writeFileSync(path.join(APP, "..", "_sheettools_result.txt"), summary);
console.log(summary);
process.exit(fail ? 1 : 0);
