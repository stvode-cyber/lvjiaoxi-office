/* 绿角犀 Office · PDF → TXT / Markdown 文本提取测试（验证 OS.PdfConvert.pdfToText / pdfToMarkdown 纯逻辑） */
/* 说明：复用 exporter 测试 harness（jsdom + 真实 npm JSZip）以与 _pdf_convert_test.js 保持一致；
   纯文本/Markdown 导出不依赖 JSZip，但加载 export-ooxml 不影响本测试。 */
const { JSDOM } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const JSZip = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jszip");
const fs = require("fs");
const path = require("path");

const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
window.JSZip = JSZip;

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
loadJS("js/export-ooxml.js");        // 注入 OS.Exporter（保持与 _pdf_convert_test 一致）
loadJS("js/modules/pdf-convert.js"); // 注入 OS.PdfConvert

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  const C = OS.PdfConvert;
  ok("OS.PdfConvert 已加载且含 pdfToText/pdfToMarkdown", !!C && typeof C.pdfToText === "function" && typeof C.pdfToMarkdown === "function");

  // 假 pages：与 pdf.js 文本层一致（x 页左向右、y 页顶向下、h 归一化字号）
  const pages = [
    [
      { text: "Chapter One", x: 0.1, y: 0.05, h: 0.03 },   // 大字号 → 标题
      { text: "The quick brown fox.", x: 0.1, y: 0.12, h: 0.015 },
      { text: "Jumps over the dog.", x: 0.1, y: 0.16, h: 0.015 },
      { text: "Second line here.", x: 0.1, y: 0.20, h: 0.015 }
    ],
    [
      { text: "Page two content.", x: 0.1, y: 0.1, h: 0.015 }
    ]
  ];

  // —— pdfToText：纯文本拼接 ——
  const txtPlain = C.pdfToText(pages);
  ok("pdfToText 返回字符串", typeof txtPlain === "string");
  ok("pdfToText 含第一页全部行", txtPlain.includes("Chapter One") && txtPlain.includes("The quick brown fox.") && txtPlain.includes("Jumps over the dog.") && txtPlain.includes("Second line here."));
  ok("pdfToText 含第二页文本", txtPlain.includes("Page two content."));
  ok("pdfToText 默认不含页码分隔标记", !txtPlain.includes("第 2 页"));
  ok("pdfToText 以换行结尾", txtPlain.endsWith("\n"));

  const txtMarked = C.pdfToText(pages, { pageMarkers: true });
  ok("pdfToText(pageMarkers) 含跨页分隔「--- 第 2 页 ---」", txtMarked.includes("--- 第 2 页 ---"));
  ok("pdfToText(pageMarkers) 仍含两页文本", txtMarked.includes("Chapter One") && txtMarked.includes("Page two content."));

  // —— pdfToMarkdown：标题判别 + 段落 ——
  const md = C.pdfToMarkdown(pages);
  ok("pdfToMarkdown 返回字符串", typeof md === "string");
  ok("pdfToMarkdown 大字号行判为 ## 标题", /## Chapter One/.test(md));
  ok("pdfToMarkdown 含正文段落", md.includes("The quick brown fox.") && md.includes("Jumps over the dog."));
  ok("pdfToMarkdown 含第二页文本(跨页空行分隔)", md.includes("Page two content."));
  ok("pdfToMarkdown 以换行结尾", md.endsWith("\n"));

  // —— 坏数据容错（与 pdfToDocx 一致：null/[]/非数组 返回空串）——
  ok("pdfToText(null) 返回空串", C.pdfToText(null) === "");
  ok("pdfToText([]) 返回空串", C.pdfToText([]) === "");
  ok("pdfToText(非数组) 返回空串", C.pdfToText("not-array") === "");
  ok("pdfToMarkdown(null) 返回空串", C.pdfToMarkdown(null) === "");
  ok("pdfToMarkdown([]) 返回空串", C.pdfToMarkdown([]) === "");
  ok("pdfToMarkdown({}) 返回空串", C.pdfToMarkdown({}) === "");

  console.log(`\n_pdf_convert_text_test: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log("失败项:", fails.join("; ")); process.exit(1); }
})();
