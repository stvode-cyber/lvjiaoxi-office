/* 绿角犀 Office · 结构化导入管线测试（验证 OS.Importer 真实解析 OOXML 包结构） */
/* 说明：复用 jsdom + 真实 npm JSZip（其 async() 在纯 Node 下可解析；jsdom 注入版会挂起）。
   闭环：先用 OS.Exporter.buildDocx 生成含 data: URI 图片的 DOCX（npm JSZip 实例），
   再 OS.Importer.parseDocx 解析，验证图片被读回为 <img data:...>，形成导出+导入图片往返。 */
const { JSDOM } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const JSZip = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jszip");
const fs = require("fs");
const path = require("path");

const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
window.JSZip = JSZip;            // 用真实 npm JSZip：async() 在纯 Node 下可同步解析

const OS = {
  util: { escapeHtml: s => String(s == null ? "" : s), fmtSize: b => b + " B", fmtTime: t => "" + t, uid: p => (p || "id") + "-" + Math.random().toString(36).slice(2) },
  bus: { on() {}, emit() {} },
  COMMANDS: {}, TYPE_INFO: {}, COMPAT: {}
};
window.OS = OS;

function loadJS(rel) {
  const code = fs.readFileSync(path.join(APP, rel), "utf8");
  const s = window.document.createElement("script");
  s.textContent = code;
  window.document.body.appendChild(s);
}
loadJS("js/export-ooxml.js");    // 注入 OS.Exporter
loadJS("js/import-ooxml.js");    // 注入 OS.Importer（复用同一 window.OS）

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  const E = OS.Exporter, I = OS.Importer;
  ok("OS.Importer 已加载且暴露 parseDocx", !!I && typeof I.parseDocx === "function");

  const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  // 无图文档：导入不应产生 <img>
  const writerPlain = { type: "writer", name: "纯文本", data: { html: "<h1>标题</h1><p>正文段落</p>" } };
  const zipPlain = E.buildDocx(writerPlain);
  const resPlain = await I.parseDocx(zipPlain);
  ok("parseDocx 无图文档返回 writer 类型", resPlain && resPlain.type === "writer");
  ok("parseDocx 无图文档 html 不含 <img>", !/<img\b/i.test(resPlain.data.html || ""));
  ok("parseDocx 无图文档保留标题文本", /<h1>标题<\/h1>/.test(resPlain.data.html || ""));

  // 带图文档：导出（含 media + drawing）→ 导入应读回 <img data:image/png;base64,...>
  const writerImg = { type: "writer", name: "带图文档", data: { html: '<h1>带图</h1><p>前<img src="data:image/png;base64,' + PNG_1x1 + '" alt="测试图">后</p>' } };
  const zipImg = E.buildDocx(writerImg);
  ok("导出带图 DOCX 含 word/media/image1.png（前置）", !!zipImg.file("word/media/image1.png"));
  const resImg = await I.parseDocx(zipImg);
  ok("parseDocx 带图文档返回 writer 类型", resImg && resImg.type === "writer");
  const imgHtml = resImg.data.html || "";
  ok("parseDocx 带图文档 html 含 <img>", /<img\b/i.test(imgHtml));
  ok("parseDocx 带图文档图片为 data:image/png;base64", /src="data:image\/png;base64,/.test(imgHtml));
  ok("parseDocx 带图文档图片 data URI 含原始 base64", imgHtml.indexOf(PNG_1x1) !== -1);
  ok("parseDocx 带图文档图片标签未被转义（含 <img 而非 &lt;img）", /<img src="data:image\/png;base64,/.test(imgHtml) && !/&lt;img/.test(imgHtml));
  ok("parseDocx 带图文档保留前后文本", /前/.test(imgHtml) && /后/.test(imgHtml));

  // 外部链接图片文档：导出时不产生 media/drawing，导入不崩、无 data:image
  const writerExt = { type: "writer", name: "外链图", data: { html: '<p><img src="https://example.com/a.png">文</p>' } };
  const zipExt = E.buildDocx(writerExt);
  const resExt = await I.parseDocx(zipExt);
  ok("parseDocx 外部链接图片文档不崩且返回 writer", resExt && resExt.type === "writer");
  ok("parseDocx 外部链接图片文档不产生 data:image", !/data:image\//.test(resExt.data.html || ""));
  ok("parseDocx 外部链接图片文档保留文本", /文/.test(resExt.data.html || ""));

  const summary = `IMPORTER TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  fs.writeFileSync(path.join(APP, "..", "_importer_result.txt"), summary);
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.message); console.log(e && e.stack); process.exit(2); });
