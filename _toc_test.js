/* 绿角犀 Office · Writer 目录 / 分页符 jsdom 联调测试 */
const { JSDOM } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");
const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} }; };

function makeZipStub() { const files = {}; const zip = { file(n, c) { files[n] = c; return zip; }, folder() { return zip; }, generateAsync() { return Promise.resolve({ _files: files }); } }; return zip; }
window.JSZip = function () { return makeZipStub(); };

const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return null; } }; } };
let downloads = [];
OS.toast = () => {};
OS.util = {
  uid: p => (p || "id") + Math.random().toString(36).slice(2, 8),
  debounce: f => f, escapeHtml: s => String(s == null ? "" : s), fmtTime: t => new Date(t).toLocaleString(),
  download(b, n) { downloads.push({ blob: b, name: n }); }, readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; }, local: { critique: t => t } };
OS.icons = { svg: () => "<svg></svg>" };
window.OS = OS;

const wcode = fs.readFileSync(path.join(APP, "js/modules/writer.js"), "utf8");
const s1 = window.document.createElement("script"); s1.textContent = wcode; window.document.body.appendChild(s1);
const xcode = fs.readFileSync(path.join(APP, "js/export-ooxml.js"), "utf8");
const s2 = window.document.createElement("script"); s2.textContent = xcode; window.document.body.appendChild(s2);

const mod = window.OS.modules.writer;
const host = window.document.createElement("div"); window.document.body.appendChild(host);
const ctx = { markDirty() {}, openBackstage() {} };

const doc = { name: "T", type: "writer", data: { html: '<h1>第一章</h1><p>内容一</p><h2>1.1 小节</h2><p>内容二</p><h3>细节</h3><p>内容三</p>' } };
const inst = mod.mount(host, doc, ctx);

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

// 1) TOC 生成
const tocHtml = inst.tocAPI.html();
ok("toc 含 nav 容器", tocHtml.indexOf('<nav class="toc"') !== -1);
ok("toc 含 3 个链接", (tocHtml.match(/toc-link/g) || []).length === 3);
ok("toc 链接带 data-target", tocHtml.indexOf('data-target="toc-h-1"') !== -1);
ok("标题获得 id", !!host.querySelector("h1").id);
ok("h1 id 为 toc-h-1", host.querySelector("h1").id === "toc-h-1");
ok("h3 id 为 toc-h-3", host.querySelector("h3").id === "toc-h-3");

// 2) 插入 TOC 到正文
inst.tocAPI.insert();
ok("插入后存在 .toc", host.querySelector(".toc") !== null);
ok("插入后 3 个 toc-link", inst.tocAPI.tocLinks() === 3);

// 3) 点击跳转：锚点目标可被定位
const link = host.querySelector(".toc-link");
ok("toc 链接目标存在", window.document.getElementById(link.dataset.target) === host.querySelector("h1"));

// 4) 分页符
inst.tocAPI.insertPageBreak();
ok("插入分页符", inst.tocAPI.pageBreaks() === 1);
ok("分页符带 data-page-break", host.querySelector(".page-break").dataset.pageBreak !== undefined);
ok("序列化含分页符", inst.serialize().html.indexOf("page-break") !== -1);

// 5) DOCX 原生导出保留分页符 + 目录
(async () => {
  downloads = [];
  await window.OS.Exporter.exportDoc({ type: "writer", name: "T", data: inst.serialize() }, "docx");
  ok("docx 下载触发", downloads.length === 1);
  const docXml = downloads[0].blob._files["word/document.xml"];
  ok("docx 含分页符 <w:br page>", docXml.indexOf('<w:br w:type="page"/>') !== -1);
  ok("docx 含 toc hyperlink 锚点", docXml.indexOf('w:hyperlink w:anchor="toc-h-1"') !== -1);
  ok("docx toc 含标题文本", docXml.indexOf("第一章") !== -1);

  const summary = `TOC TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  fs.writeFileSync(path.join(APP, "..", "_toc_result.txt"), summary);
  console.log(summary);
  process.exit(fail ? 1 : 0);
})();
