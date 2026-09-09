/* 绿角犀 Office · 端到端往返测试（E2E Round-Trip）
 * 覆盖 Writer / Spreadsheet / Presentation 三大模块的完整闭环：
 *   创建文档 → 导出原生 OOXML → 导入回读 → 验证内容一致
 * 以及发布产物完整性、PDF 工具模块 API 完整性。
 *
 * 运行：node _e2e_roundtrip_test.js
 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";
const RESULT_FILE = path.join(APP, "..", "_e2e_roundtrip_result.txt");
// 版本单一真源：从 package.json 读取，避免随升版漂移
const PKG = JSON.parse(fs.readFileSync(path.join(APP, "..", "package.json"), "utf8"));
const VER = PKG.version;
const VER_RE = VER.replace(/\./g, "\\.");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

// —— 搭建 jsdom 环境（加载 Exporter + Importer）——
function setupDom() {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head></head><body></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" }
  );
  const { window } = dom;
  window.JSZip = JSZip;
  // 补齐 importFile 需要的 API
  window.File = class File {
    constructor(parts, name, opts) {
      this.name = name;
      this._buf = Buffer.isBuffer(parts[0]) ? parts[0] : Buffer.from(parts[0]);
    }
    async arrayBuffer() { return this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.byteLength); }
  };

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
  loadJS("js/export-ooxml.js");
  loadJS("js/import-ooxml.js");

  return { window, OS };
}

// —— 异步生成 zip buffer（JSZip → ArrayBuffer）——
async function zipToBuffer(zip) {
  const blob = await zip.generateAsync({ type: "uint8array" });
  return blob.buffer;
}

// —— 测试用例 ——
(async function main() {
  console.log("=== E2E 端到端往返测试 ===\n");

  // ---- 1. 发布产物完整性验证 ----
  console.log("--- 1. 发布产物完整性 ---");
  const distDir = path.join(APP, "..", "dist");
  const required = [
    "绿角犀 Office Setup " + VER + ".exe",
    "绿角犀 Office " + VER + ".exe",
    "latest.yml"
  ];
  for (const f of required) {
    const full = path.join(distDir, f);
    ok("RELEASE: 存在 " + f, fs.existsSync(full));
    if (fs.existsSync(full)) {
      const stat = fs.statSync(full);
      ok("RELEASE: " + f + " 大小 > 0", stat.size > 0);
    }
  }
  const ymlPath = path.join(distDir, "latest.yml");
  if (fs.existsSync(ymlPath)) {
    const yml = fs.readFileSync(ymlPath, "utf8");
    ok("RELEASE: latest.yml 版本为 " + VER, new RegExp("version:\\s*" + VER_RE).test(yml));
    ok("RELEASE: latest.yml 含 releaseDate", /releaseDate:/.test(yml));
  }

  // ---- 2. 模块加载 ---- 
  console.log("\n--- 2. 模块加载 ---");
  const { window, OS } = setupDom();
  const E = OS.Exporter;
  const I = OS.Importer;

  ok("E2E: Exporter 已加载（buildDocx）", !!E && typeof E.buildDocx === "function");
  ok("E2E: Exporter 已加载（buildXlsx）", typeof E.buildXlsx === "function");
  ok("E2E: Exporter 已加载（buildPptx）", typeof E.buildPptx === "function");
  ok("E2E: Exporter 已加载（buildOfd）", typeof E.buildOfd === "function");
  ok("E2E: Importer 已加载（importFile）", !!I && typeof I.importFile === "function");
  ok("E2E: Importer 已加载（parseDocx）", typeof I.parseDocx === "function");

  // ---- 3. Writer DOCX 往返（含复杂格式）----
  console.log("\n--- 3. Writer DOCX 往返 ---");
  {
    const writerDoc = {
      type: "writer", name: "E2E 测试文档",
      data: { html: [
        "<h1>一级标题</h1>",
        "<h2>二级标题</h2>",
        "<p>普通段落，包含<b>加粗</b>、<i>斜体</i>和<u>下划线</u>。</p>",
        "<ul><li>列表项一</li><li>列表项二</li></ul>",
        "<ol><li>有序 1</li><li>有序 2</li></ol>",
        "<p>末尾段落。</p>"
      ].join("\n") }
    };

    const zip = E.buildDocx(writerDoc);
    ok("DOCX: 含 word/document.xml", !!zip.file("word/document.xml"));
    ok("DOCX: 含 [Content_Types].xml", !!zip.file("[Content_Types].xml"));
    ok("DOCX: 含 word/styles.xml", !!zip.file("word/styles.xml"));

    // 导入回读
    const result = await I.parseDocx(zip);
    ok("DOCX: 返回 writer 类型", result && result.type === "writer");
    const html = result.data.html || "";
    ok("DOCX: 保留标题", /一级标题/.test(html));
    ok("DOCX: 保留加粗", /加粗/.test(html));
    ok("DOCX: 保留列表项", /列表项一/.test(html) && /列表项二/.test(html));
    ok("DOCX: 保留有序列表", /有序 1/.test(html));
    ok("DOCX: 保留末尾段落", /末尾段落/.test(html));

    // 通过 importFile 再验证一遍
    const buf = await zipToBuffer(zip);
    const file = new window.File([Buffer.from(buf)], "test.docx");
    const result2 = await I.importFile(file);
    ok("DOCX(importFile): 返回 writer 类型", result2 && result2.type === "writer");
    ok("DOCX(importFile): 保留标题", result2 && result2.data && /一级标题/.test(result2.data.html || ""));
  }

  // ---- 4. Spreadsheet XLSX 导出 + 结构验证 ----
  console.log("\n--- 4. Spreadsheet XLSX ---");
  {
    const ssDoc = {
      type: "spreadsheet", name: "E2E 表格测试",
      data: {
        cells: {
          A1: { v: "姓名", b: true }, B1: { v: "年龄" }, C1: { v: "分数" },
          A2: { v: "张三" }, B2: { v: 28 }, C2: { v: 95 },
          A3: { v: "李四" }, B3: { v: 35 }, C3: { v: 87 },
          A4: { v: "王五" }, B4: { v: 22 }, C4: { v: 92 },
          A5: { v: "合计" }, B5: { v: 85 }, C5: { v: 274 }
        },
        colWidths: { A: 120, B: 80, C: 80 }
      }
    };

    const zip = E.buildXlsx(ssDoc);
    ok("XLSX: 含 xl/worksheets/sheet1.xml", !!zip.file("xl/worksheets/sheet1.xml"));
    ok("XLSX: 含 xl/workbook.xml", !!zip.file("xl/workbook.xml"));
    ok("XLSX: 含 xl/sharedStrings.xml", !!zip.file("xl/sharedStrings.xml"));

    // 通过 importFile 导入验证
    const buf = await zipToBuffer(zip);
    const file = new window.File([Buffer.from(buf)], "test.xlsx");
    const result = await I.importFile(file);
    ok("XLSX: 返回 spreadsheet 类型", result && result.type === "spreadsheet");
    const cells = result.data && result.data.cells;
    ok("XLSX: cells 存在", !!cells);
    ok("XLSX: 保留姓名", cells && cells.A1 && cells.A1.v === "姓名");
    ok("XLSX: 保留张三", cells && cells.A2 && cells.A2.v === "张三");
    ok("XLSX: 保留李四", cells && cells.A3 && cells.A3.v === "李四");
    ok("XLSX: 保留分数 95", cells && cells.C2 && cells.C2.v === 95);
    ok("XLSX: 保留分数 87", cells && cells.C3 && cells.C3.v === 87);
    ok("XLSX: 保留合计", cells && cells.A5 && cells.A5.v === "合计");
  }

  // ---- 5. Presentation PPTX 导出 + 结构验证 ----
  console.log("\n--- 5. Presentation PPTX ---");
  {
    const presDoc = {
      type: "presentation", name: "E2E 演示测试",
      data: {
        slides: [
          { elements: [{ type: "text", x: 40, y: 40, w: 600, h: 60, fontSize: 44, bold: true, text: "封面标题", color: "#111827" }, { type: "text", x: 40, y: 120, w: 600, h: 40, fontSize: 24, text: "副标题", color: "#555555" }] },
          { elements: [{ type: "text", x: 40, y: 40, w: 600, h: 60, fontSize: 36, bold: true, text: "第二页", color: "#111827" }, { type: "text", x: 40, y: 120, w: 600, h: 30, fontSize: 20, text: "要点一", color: "#333333" }, { type: "text", x: 40, y: 160, w: 600, h: 30, fontSize: 20, text: "要点二", color: "#333333" }] },
          { elements: [{ type: "text", x: 40, y: 40, w: 600, h: 60, fontSize: 44, bold: true, text: "结尾页", color: "#111827" }, { type: "text", x: 40, y: 120, w: 600, h: 40, fontSize: 24, text: "感谢观看", color: "#555555" }] }
        ]
      }
    };

    const zip = E.buildPptx(presDoc);
    ok("PPTX: 含 ppt/presentation.xml", !!zip.file("ppt/presentation.xml"));
    ok("PPTX: 含 3 张幻灯片",
      !!zip.file("ppt/slides/slide1.xml") &&
      !!zip.file("ppt/slides/slide2.xml") &&
      !!zip.file("ppt/slides/slide3.xml")
    );

    // 通过 importFile 导入验证
    const buf = await zipToBuffer(zip);
    const file = new window.File([Buffer.from(buf)], "test.pptx");
    const result = await I.importFile(file);
    ok("PPTX: 返回 presentation 类型", result && result.type === "presentation");
    const slides = result.data && result.data.slides;
    ok("PPTX: 有 3 张幻灯片", slides && slides.length === 3);
    if (slides && slides.length >= 3) {
      ok("PPTX: 幻灯片1含封面标题", slides[0].elements && slides[0].elements.some(i => (i.text || "").indexOf("封面标题") !== -1));
      ok("PPTX: 幻灯片3含感谢观看", slides[2].elements && slides[2].elements.some(i => (i.text || "").indexOf("感谢观看") !== -1));
    }
  }

  // ---- 6. OFD 导出 + 结构验证 ----
  console.log("\n--- 6. OFD 导出 ---");
  {
    const ofdDoc = {
      type: "writer", name: "OFD 测试",
      data: { html: "<h1>OFD 标题</h1><p>OFD 正文段落</p>" }
    };
    const zip = E.buildOfd(ofdDoc);
    ok("OFD: 含 OFD.xml", !!zip.file("OFD.xml"));
    ok("OFD: 含 Doc_0/Document.xml", !!zip.file("Doc_0/Document.xml"));
  }

  // ---- 7. PDF 工具模块 API 完整性 ----
  console.log("\n--- 7. PDF 工具模块 ---");
  {
    const { window: w2 } = setupDom();
    // 先加载 pdf-tool.js
    const pdfToolCode = fs.readFileSync(path.join(APP, "js/pdf-tool.js"), "utf8");
    let s = w2.document.createElement("script");
    s.textContent = pdfToolCode;
    w2.document.body.appendChild(s);

    // 逐个加载所有 PDF 审计模块（它们会注册到 w2.OS）
    const auditModules = [
      {name: "PdfEncrypt", file: "pdf-encrypt.js"},
      {name: "PdfSignature", file: "pdf-signature.js"},
      {name: "PdfActions", file: "pdf-actions.js"},
      {name: "PdfFonts", file: "pdf-fonts.js"},
      {name: "PdfPreflight", file: "pdf-preflight.js"},
      {name: "PdfHistory", file: "pdf-history.js"},
      {name: "PdfDocInfo", file: "pdf-docinfo.js"},
      {name: "PdfPageInfo", file: "pdf-pageinfo.js"},
      {name: "PdfFormFields", file: "pdf-formfields.js"},
      {name: "PdfOutline", file: "pdf-outline.js"},
      {name: "PdfPageLabels", file: "pdf-pagelabels.js"},
      {name: "PdfStructTree", file: "pdf-structtree.js"},
      {name: "PdfLinks", file: "pdf-links.js"},
      {name: "PdfAttachments", file: "pdf-attachments.js"},
      {name: "PdfDiff", file: "pdf-diff.js"},
      {name: "PdfAnnoStats", file: "pdf-anno-stats.js"},
      {name: "PdfAnnoTimeline", file: "pdf-anno-timeline.js"},
      {name: "PdfAnnoFilter", file: "pdf-anno-filter.js"},
      {name: "PdfAnnoBatch", file: "pdf-anno-batch.js"},
      {name: "PdfAnnoSummary", file: "pdf-anno-summary.js"},
    ];
    for (const mod of auditModules) {
      const code = fs.readFileSync(path.join(APP, "js/modules", mod.file), "utf8");
      s = w2.document.createElement("script");
      s.textContent = code;
      w2.document.body.appendChild(s);
    }

    const PT = w2.OS && w2.OS.PdfTool;
    ok("PDF: PdfTool 已注册", !!PT);
    ok("PDF: parsePdf", typeof PT.parsePdf === "function");
    ok("PDF: mergePdfs", typeof PT.mergePdfs === "function");
    ok("PDF: splitPdf", typeof PT.splitPdf === "function");
    ok("PDF: writeImagePdf", typeof PT.writeImagePdf === "function");

    for (const mod of auditModules) {
      ok("PDF: " + mod.name + " 已注册", !!(w2.OS && w2.OS[mod.name]));
    }
  }

  // ---- 8. 多格式批量并发导入 ----
  console.log("\n--- 8. 批量并发导入 ---");
  {
    const docs = [
      { type: "writer", name: "批量A", data: { html: "<p>批量文档 A</p>" } },
      { type: "writer", name: "批量B", data: { html: "<p>批量文档 B</p>" } },
      { type: "writer", name: "批量C", data: { html: "<p>批量文档 C</p>" } }
    ];
    const zips = docs.map(d => E.buildDocx(d));
    const results = await Promise.all(zips.map(z => I.parseDocx(z)));
    ok("BATCH: 3 篇全部导入成功", results.length === 3 && results.every(r => r && r.type === "writer"));
    ok("BATCH: 文档 A 内容保留", results[0].data.html && /批量文档 A/.test(results[0].data.html));
    ok("BATCH: 文档 B 内容保留", results[1].data.html && /批量文档 B/.test(results[1].data.html));
    ok("BATCH: 文档 C 内容保留", results[2].data.html && /批量文档 C/.test(results[2].data.html));
  }

  // ---- 汇总 ----
  const summary = `\n=== E2E 端到端往返测试: ${pass} passed, ${fail} failed ===`
    + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  fs.writeFileSync(RESULT_FILE, summary + "\n", "utf8");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("FATAL", e && e.message, e && e.stack);
  fs.writeFileSync(RESULT_FILE, "FATAL: " + (e && e.stack || e) + "\n", "utf8");
  process.exit(2);
});