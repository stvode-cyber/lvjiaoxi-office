/* 绿角犀 Office · 备注/批注导出讲稿附录 jsdom 联调测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = "D:/源码存档/绿角犀办公软件/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} }; };

// JSZip 桩：记录写入的文件，generateAsync 返回一个含 _files 的伪 blob
function makeZipStub() {
  const files = {};
  const zip = {
    file(name, content) { files[name] = content; return zip; },
    folder() { return zip; },
    generateAsync() { return Promise.resolve({ _files: files }); }
  };
  return zip;
}
window.JSZip = function () { return makeZipStub(); };

const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return null; } }; } };
let downloads = [];
OS.toast = () => {};
OS.util = {
  uid: (p) => (p || "id") + Math.random().toString(36).slice(2, 8),
  debounce: f => f,
  escapeHtml: s => String(s == null ? "" : s),
  fmtTime: t => new Date(t).toLocaleString(),
  download(blob, name) { downloads.push({ blob, name }); },
  readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; }, local: { critique: t => t } };
OS.icons = { svg: () => "<svg></svg>" };
OS.blankDoc = t => ({ type: t, data: {} });
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/presentation.js"), "utf8");
const s = window.document.createElement("script");
s.textContent = code;
window.document.body.appendChild(s);

// export-ooxml（提供 OS.Exporter）
const exCode = fs.readFileSync(path.join(APP, "js/export-ooxml.js"), "utf8");
const s2 = window.document.createElement("script");
s2.textContent = exCode;
window.document.body.appendChild(s2);

const mod = window.OS.modules.presentation;
const host = window.document.createElement("div");
window.document.body.appendChild(host);
const ctx = { markDirty() {}, openBackstage() {} };
const pdata = {
  slides: [
    { bg: "#ffffff", notes: "欢迎各位来宾", elements: [{ id: "a", type: "text", x: 0, y: 0, w: 100, h: 30, text: "开场致辞", fontSize: 32, color: "#111827", bold: true }] },
    { bg: "#ffffff", notes: "", elements: [{ id: "b", type: "text", x: 0, y: 0, w: 100, h: 30, text: "总结回顾", fontSize: 32, color: "#111827", bold: true }] }
  ]
};
const inst = mod.mount(host, { name: "Demo", type: "presentation", data: pdata }, ctx);

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  // 1) scriptHtml 内容
  const sh = inst.scriptHtml();
  ok("scriptHtml 含第1页标题", sh.indexOf("第 1 页 · 开场致辞") !== -1);
  ok("scriptHtml 含第1页备注", sh.indexOf("欢迎各位来宾") !== -1);
  ok("scriptHtml 含第2页标题", sh.indexOf("第 2 页 · 总结回顾") !== -1);
  ok("scriptHtml 第2页无备注占位", sh.indexOf("（本页暂无备注）") !== -1);
  ok("scriptHtml 是完整 HTML", sh.indexOf("<!DOCTYPE html>") === 0);

  // 2) exportAs html
  downloads = [];
  inst.exportAs("html");
  ok("html 下载被触发", downloads.length === 1);
  ok("html 文件名带_讲稿", downloads[0] && downloads[0].name === "Demo_讲稿.html");
  const htmlText = await downloads[0].blob.text();
  ok("html 下载内容与 scriptHtml 一致", htmlText === sh);
  ok("html 下载含备注文本", htmlText.indexOf("欢迎各位来宾") !== -1);

  // 3) exportDoc docx（讲稿）
  downloads = [];
  const name = await window.OS.Exporter.exportDoc({ type: "presentation", name: "Demo", data: pdata }, "docx");
  ok("docx 导出返回文件名", name === "Demo.docx");
  ok("docx 下载被触发", downloads.length === 1);
  const dfile = downloads[0].blob._files["word/document.xml"];
  ok("docx 含 word/document.xml", !!dfile);
  ok("docx 文档含备注文本", dfile && dfile.indexOf("欢迎各位来宾") !== -1);
  ok("docx 文档含标题", dfile && dfile.indexOf("开场致辞") !== -1);

  const summary = `NOTES-EXPORT TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  fs.writeFileSync(path.join(APP, "..", "_notes_export_result.txt"), summary);
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.message); console.log(e && e.stack); process.exit(2); });
