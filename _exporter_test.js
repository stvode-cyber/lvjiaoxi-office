/* 绿角犀 Office · 原生 OOXML/OFD 导出管线测试（验证 OS.Exporter 真实生成规范包结构） */
/* 说明：JSZip 的 async()/generateAsync() 在 jsdom 下会挂起（浏览器中正常），故本测试仅做结构断言：
   验证各原生格式构建器运行无异常、且产出符合 OOXML/OFD 规范的部件文件名。内容往返在浏览器中由 OS.Importer 验证。 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
window.JSZip = JSZip;            // 用真实 npm JSZip：其 async() 在纯 Node 下可同步解析；jsdom 注入版会挂起

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
loadJS("js/export-ooxml.js");     // 注入 OS.Exporter（global.JSZip 已由上方赋值）

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  const E = OS.Exporter;
  ok("OS.Exporter 已加载", !!E && typeof E.buildDocx === "function" && typeof E.buildXlsx === "function" && typeof E.buildPptx === "function" && typeof E.buildOfd === "function");

  const writerDoc = { type: "writer", name: "测试文档", data: { html: "<h1>标题</h1><p>正文段落</p><ul><li>项一</li></ul>" } };
  const ssDoc = { type: "spreadsheet", name: "测试表格", data: { cells: { A1: { v: "姓名" }, B1: { v: "分数" }, A2: { v: "张三" }, B2: { v: 95 } }, charts: [] } };
  const presDoc = { type: "presentation", name: "测试演示", data: { slides: [ { items: [ { type: "title", text: "封面" }, { type: "body", text: "要点一" } ] } ] } };

  // DOCX：原生 wordprocessingml 包
  const docx = E.buildDocx(writerDoc);
  ok("buildDocx 生成 word/document.xml", !!docx.file("word/document.xml"));
  ok("buildDocx 生成 [Content_Types].xml", !!docx.file("[Content_Types].xml"));
  ok("buildDocx 生成 word/styles.xml", !!docx.file("word/styles.xml"));

  // DOCX 图片嵌入：应用内插入图片为 data: URI（readAsDataURL），须真实落到 word/media + drawing run
  const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const writerDocImg = { type: "writer", name: "带图文档", data: { html: '<h1>带图</h1><p>前<img src="data:image/png;base64,' + PNG_1x1 + '" alt="测试图">后</p>' } };
  const docxImg = E.buildDocx(writerDocImg);
  ok("DOCX 图片导出生成 word/media/image1.png", !!docxImg.file("word/media/image1.png"));
  const docXmlImg = await docxImg.file("word/document.xml").async("string");
  ok("DOCX 图片导出 document.xml 含 <w:drawing>", /<w:drawing>/.test(docXmlImg));
  ok("DOCX 图片导出 document.xml 含 r:embed 关系引用", /r:embed="rId50"/.test(docXmlImg));
  const docRelsImg = await docxImg.file("word/_rels/document.xml.rels").async("string");
  ok("DOCX 图片导出 rels 含 image 关系", /Type="[^"]*\/image"/.test(docRelsImg) && /Target="media\/image1\.png"/.test(docRelsImg));
  const ctImg = await docxImg.file("[Content_Types].xml").async("string");
  ok("DOCX 图片导出 [Content_Types] 含 png 默认类型", /Extension="png"/.test(ctImg) && /image\/png/.test(ctImg));
  // 非 data: URI 图片优雅跳过（不崩、不产生 media）
  const writerDocExt = { type: "writer", name: "外链图文档", data: { html: '<p><img src="https://example.com/a.png">文</p>' } };
  const docxExt = E.buildDocx(writerDocExt);
  ok("DOCX 外部图片 src 优雅跳过（无 media）", !docxExt.file("word/media/image1.png"));

  // XLSX：原生 spreadsheetml 包
  const xlsx = E.buildXlsx(ssDoc);
  ok("buildXlsx 生成 xl/worksheets/sheet1.xml", !!xlsx.file("xl/worksheets/sheet1.xml"));
  ok("buildXlsx 生成 xl/workbook.xml", !!xlsx.file("xl/workbook.xml"));
  ok("buildXlsx 生成 xl/sharedStrings.xml", !!xlsx.file("xl/sharedStrings.xml"));

  // PPTX：原生 presentationml 包
  const pptx = E.buildPptx(presDoc);
  ok("buildPptx 生成 ppt/presentation.xml", !!pptx.file("ppt/presentation.xml"));
  ok("buildPptx 生成 ppt/slides/slide1.xml", !!pptx.file("ppt/slides/slide1.xml"));

  // OFD：国标版式包
  const ofd = E.buildOfd(writerDoc);
  ok("buildOfd 生成 OFD.xml", !!ofd.file("OFD.xml"));
  ok("buildOfd 生成 Doc_0/Document.xml", !!ofd.file("Doc_0/Document.xml"));

  const summary = `EXPORTER TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  fs.writeFileSync(path.join(APP, "..", "_exporter_result.txt"), summary);
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.message); console.log(e && e.stack); process.exit(2); });
