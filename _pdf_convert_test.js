/* 绿角犀 Office · PDF → DOCX 文本提取测试（验证 OS.PdfConvert 纯逻辑 + 生成可编辑 DOCX 闭环） */
/* 说明：复用 exporter 测试 harness（jsdom + 真实 npm JSZip）。真实 npm JSZip 的 async() 在纯 Node 下可解析，
   DOMParser 仍来自 jsdom；故本测试可断言 DOCX 实际内容（文本 / 标题样式 / 分页符）。 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const APP = "D:/源码存档/绿角犀办公软件/app";
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
window.JSZip = JSZip;            // 真实 npm JSZip：async() 在纯 Node 下可同步解析

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
loadJS("js/export-ooxml.js");      // 注入 OS.Exporter
loadJS("js/modules/pdf-convert.js"); // 注入 OS.PdfConvert（运行时引用 OS.Exporter）

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  const C = OS.PdfConvert;
  ok("OS.PdfConvert 已加载", !!C && typeof C.clusterLines === "function" && typeof C.pdfToDocxHtml === "function" && typeof C.pdfToDocx === "function");

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

  // —— 纯逻辑：行聚类 ——
  const lines = C.clusterLines(pages[0]);
  ok("clusterLines 第1页行数=4(标题+3正文行，y间距大独立成行)", lines.length === 4);
  ok("clusterLines 行序按 y 升序", lines[0].y <= lines[1].y && lines[1].y <= lines[2].y);
  ok("clusterLines 标题行 h 最大(0.03)", Math.abs(lines[0].h - 0.03) < 1e-9);

  // 行内乱序 → 按 x 排序后拼接
  const unsorted = [{ text: "B", x: 0.3, y: 0.1, h: 0.015 }, { text: "A", x: 0.1, y: 0.1, h: 0.015 }];
  const u = C.clusterLines(unsorted);
  ok("clusterLines 同行合并+行内按 x 排序", u.length === 1 && u[0].text === "A B");

  // 空文本 span 被忽略
  const withEmpty = [{ text: "", x: 0.1, y: 0.1, h: 0.015 }, { text: "有字", x: 0.1, y: 0.2, h: 0.015 }];
  ok("clusterLines 忽略空文本 span", C.clusterLines(withEmpty).length === 1);

  // —— 纯逻辑：HTML 生成 ——
  const html = C.pdfToDocxHtml(pages);
  ok("pdfToDocxHtml 含 <h2> 标题", /<h2>Chapter One<\/h2>/.test(html));
  ok("pdfToDocxHtml 含 <p> 正文", /<p>The quick brown fox\.<\/p>/.test(html) && /<p>Jumps over the dog\.<\/p>/.test(html) && /<p>Second line here\.<\/p>/.test(html));
  ok("pdfToDocxHtml 跨页分页(div.page-break)", /<div class="page-break"><\/div>/.test(html));

  // —— 闭环：生成 DOCX 并验证内容 ——
  const zip = C.pdfToDocx(pages, "测试PDF");
  ok("pdfToDocx 返回 zip", !!zip && typeof zip.file === "function");
  const docXml = await zip.file("word/document.xml").async("string");
  ok("DOCX 含提取标题文本", /Chapter One/.test(docXml));
  ok("DOCX 含提取正文文本(两行)", /The quick brown fox/.test(docXml) && /Jumps over the dog/.test(docXml));
  ok("DOCX 含第二页文本", /Page two content/.test(docXml));
  ok("DOCX 标题转为 Heading2 样式", /w:val="Heading2"/.test(docXml));
  ok("DOCX 含分页符", /w:type="page"/.test(docXml));

  // —— 坏数据容错 ——
  ok("clusterLines(null) 返回 []", C.clusterLines(null).length === 0);
  ok("clusterLines([]) 返回 []", C.clusterLines([]).length === 0);
  ok("pdfToDocxHtml(null) 返回空串", C.pdfToDocxHtml(null) === "");
  ok("pdfToDocx(空pages) 仍返回 zip", !!C.pdfToDocx([], "空"));

  // —— 改进：列表检测 ——
  ok("detectListType 无序 •", C.detectListType("• item") === "unordered");
  ok("detectListType 无序 -", C.detectListType("- item") === "unordered");
  ok("detectListType 无序 *", C.detectListType("* item") === "unordered");
  ok("detectListType 有序 1.", C.detectListType("1. item") === "ordered");
  ok("detectListType 有序 1)", C.detectListType("1) item") === "ordered");
  ok("detectListType 有序 (1)", C.detectListType("(1) item") === "ordered");
  ok("detectListType 非列表正文", C.detectListType("普通正文") === null);

  // —— 改进：列表 HTML 输出 ——
  const listPages = [[
    { text: "• First item", x: 0.1, y: 0.1, h: 0.015 },
    { text: "• Second item", x: 0.1, y: 0.14, h: 0.015 },
    { text: "• Third item", x: 0.1, y: 0.18, h: 0.015 },
    { text: "Normal paragraph", x: 0.1, y: 0.25, h: 0.015 }
  ]];
  const listHtml = C.pdfToDocxHtml(listPages);
  ok("pdfToDocxHtml 列表含 <ul>", /<ul>/.test(listHtml));
  ok("pdfToDocxHtml 列表含 <li>", /<li>/.test(listHtml));
  ok("pdfToDocxHtml 列表后关闭 </ul>", /<\/ul>/.test(listHtml));
  ok("pdfToDocxHtml 列表后跟正文", /<\/ul>\s*<p>Normal/.test(listHtml));

  // —— 改进：段落合并 ——
  const paraPages = [[
    { text: "First line of paragraph.", x: 0.1, y: 0.1, h: 0.015 },
    { text: "Second line same paragraph.", x: 0.1, y: 0.116, h: 0.015 },  // 间距 0.016 → 同段
    { text: "New paragraph starts.", x: 0.1, y: 0.16, h: 0.015 }           // 间距 0.044 → 新段
  ]];
  const paraHtml = C.pdfToDocxHtml(paraPages);
  ok("pdfToDocxHtml 段落合并含 <br>", /<br>/.test(paraHtml));
  ok("pdfToDocxHtml 段落合并: 两段, 每段含正确文本",
    /<p>First line of paragraph\.<br>Second line same paragraph\.<\/p>/.test(paraHtml));
  ok("pdfToDocxHtml 段落分离: 新段独立",
    /<p>New paragraph starts\.<\/p>/.test(paraHtml));

  // —— 改进：多级标题 ——
  const hPages = [[
    { text: "Level 1 Heading", x: 0.1, y: 0.05, h: 0.050 },  // 远大于 med → h1
    { text: "Level 2 Heading", x: 0.1, y: 0.12, h: 0.035 },  // 明显大于 med → h2
    { text: "Level 3 Heading", x: 0.1, y: 0.19, h: 0.024 },  // 稍大于 med → h3
    { text: "Body text line 1", x: 0.1, y: 0.26, h: 0.015 },
    { text: "Body text line 2", x: 0.1, y: 0.30, h: 0.015 },
    { text: "Body text line 3", x: 0.1, y: 0.34, h: 0.015 },
    { text: "Body text line 4", x: 0.1, y: 0.38, h: 0.015 },
    { text: "Body text line 5", x: 0.1, y: 0.42, h: 0.015 }
  ]];
  const hHtml = C.pdfToDocxHtml(hPages);
  ok("pdfToDocxHtml 多级标题 h1", /<h1>Level 1 Heading<\/h1>/.test(hHtml));
  ok("pdfToDocxHtml 多级标题 h2", /<h2>Level 2 Heading<\/h2>/.test(hHtml));
  ok("pdfToDocxHtml 多级标题 h3", /<h3>Level 3 Heading<\/h3>/.test(hHtml));
  ok("pdfToDocxHtml 多级标题后正文 <p>", /<p>Body text line 1<\/p>/.test(hHtml));

  console.log(`\n_pdf_convert_test: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log("失败项:", fails.join("; ")); process.exit(1); }
})();
