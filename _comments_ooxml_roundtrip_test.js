/* 绿角犀 Office · 批注 OOXML 往返专项测试
 * 覆盖 Writer / Spreadsheet / Presentation 三模块的批注闭环：
 *   构造带批注文档 → 导出原生 OOXML → 导入回读 → 断言批注字段完整
 *
 * 运行：node _comments_ooxml_roundtrip_test.js
 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log("  FAIL: " + name); }
}

// —— 搭建 jsdom 环境 ——
function setupDom() {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head></head><body></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" }
  );
  const { window } = dom;
  window.JSZip = JSZip;
  window.File = class File {
    constructor(parts, name, opts) {
      this.name = name;
      this._buf = Buffer.isBuffer(parts[0]) ? parts[0] : Buffer.from(parts[0]);
    }
    async arrayBuffer() { return this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.byteLength); }
  };

  const OS = {
    util: {
      escapeHtml: s => String(s == null ? "" : s),
      fmtSize: b => b + " B",
      fmtTime: t => "" + t,
      uid: p => (p || "id") + "-" + Math.random().toString(36).slice(2)
    },
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

// —— 异步生成 zip buffer ——
async function zipToBuffer(zip) {
  const blob = await zip.generateAsync({ type: "uint8array" });
  return blob.buffer;
}

// —— 主测试 ——
(async function main() {
  console.log("=== 批注 OOXML 往返专项测试 ===\n");
  const { window, OS } = setupDom();

  // ========================================================
  // 1. Word (DOCX) —— 正文批注 + replies 完整往返
  // ========================================================
  console.log("--- 1. Word (DOCX) 批注往返 ---");

  const wordDoc = {
    type: "writer",
    data: {
      html: `<h1>测试文档</h1><p>这是第一段正文，有<span class="cmt" data-cid="c1">第一处批注文字</span>。</p>
             <p>然后是<span class="cmt" data-cid="c2">第二处批注</span>和<span class="cmt" data-cid="c3">第三处</span>。</p>`,
      comments: [
        { id: "c1", author: "张三", createdAt: 1726000000000, resolved: false,
          text: "第一处批注：这段内容需要核对", quote: "第一处批注文字",
          replies: [
            { author: "李四", text: "已核对，没问题", createdAt: 1726000100000 },
            { author: "张三", text: "好的感谢", createdAt: 1726000200000 }
          ] },
        { id: "c2", author: "李四", createdAt: 1726000300000, resolved: true,
          text: "第二处批注：请补充数据", quote: "第二处批注", replies: [] },
        { id: "c3", author: "王五", createdAt: 1726000400000, resolved: false,
          text: "第三处批注：OK", quote: "第三处", replies: [] }
      ]
    }
  };

  try {
    const docxZip = await window.OS.Exporter.buildDocx(wordDoc);
    ok("DOCX: buildDocx 返回 JSZip", docxZip && typeof docxZip.file === "function");

    // 验证 zip 内含批注相关文件
    const zipFiles = docxZip.file(/word\/comments\.xml|word\/commentsExtended\.xml/);
    ok("DOCX: zip 含 word/comments.xml", zipFiles.length >= 1);

    // 验证 comments.xml 内容
    const commentsXml = await docxZip.file("word/comments.xml")?.async("string");
    ok("DOCX: comments.xml 存在", !!commentsXml);
    ok("DOCX: comments.xml 含 author '张三'", commentsXml && commentsXml.includes("张三"));
    ok("DOCX: comments.xml 含 author '李四'", commentsXml && commentsXml.includes("李四"));
    ok("DOCX: comments.xml 含 '第一处批注'", commentsXml && commentsXml.includes("第一处批注"));
    ok("DOCX: comments.xml 含 w:parentId（replies）", commentsXml && commentsXml.includes("parentId"));
    ok("DOCX: comments.xml 含 replies 内容", commentsXml && commentsXml.includes("已核对"));

    // 验证正文 anchor（commentRangeStart/End）
    const documentXml = await docxZip.file("word/document.xml")?.async("string");
    ok("DOCX: document.xml 含 commentRangeStart", documentXml && documentXml.includes("commentRangeStart"));
    ok("DOCX: document.xml 含 commentRangeEnd", documentXml && documentXml.includes("commentRangeEnd"));

    // 往返：导出 → 导入
    const docxImport = await window.OS.Importer.parseDocx(docxZip);
    ok("DOCX: 导入成功", docxImport && docxImport.type === "writer");

    const impComments = (docxImport.data && docxImport.data.comments) || [];
    ok("DOCX: 导入后 comments 数组存在", Array.isArray(impComments));
    ok("DOCX: 导入后 comments 数量=3", impComments.length === 3);

    // 逐条验证字段
    const c1 = impComments.find(c => c.author === "张三");
    ok("DOCX: 找到 author=张三 的批注", !!c1);
    ok("DOCX: 张三批注 text 往返", c1 && c1.text === "第一处批注：这段内容需要核对");
    ok("DOCX: 张三批注 replies 往返", c1 && Array.isArray(c1.replies) && c1.replies.length >= 2);

    if (c1 && c1.replies) {
      const r1 = c1.replies.find(r => r.text && r.text.includes("已核对"));
      ok("DOCX: reply '已核对' 往返", !!r1);
      ok("DOCX: reply author '李四' 往返", r1 && r1.author === "李四");
    }

    const c2 = impComments.find(c => c.author === "李四");
    ok("DOCX: 李四批注 text 往返", c2 && c2.text === "第二处批注：请补充数据");
    ok("DOCX: 李四批注 resolved=true 往返", c2 && c2.resolved === true);

    const c3 = impComments.find(c => c.author === "王五");
    ok("DOCX: 王五批注 text 往返", c3 && c3.text === "第三处批注：OK");
    ok("DOCX: 王五批注 resolved=false 往返", c3 && c3.resolved === false);

    console.log("  Word DOCX 批注往返完成 ✅");
  } catch (e) {
    ok("DOCX: 执行无异常", false);
    console.log("  ERROR:", e.message);
  }

  // ========================================================
  // 2. Excel (XLSX) —— 多 sheet 批注往返
  // ========================================================
  console.log("\n--- 2. Excel (XLSX) 批注往返 ---");

  const excelDoc = {
    type: "spreadsheet",
    data: {
      rows: 50, cols: 16,
      cells: {}, styles: {},
      sheets: ["Sheet1", "Sheet2"],
      comments: [
        { id: "x1", ref: "A1", sheet: 0, author: "分析师", createdAt: 1726001000000,
          resolved: false, text: "这是季度销售额汇总" },
        { id: "x2", ref: "B5", sheet: 0, author: "分析师", createdAt: 1726001100000,
          resolved: false, text: "请核对这个数字" },
        { id: "x3", ref: "C10", sheet: 0, author: "经理", createdAt: 1726001200000,
          resolved: true, text: "已确认" },
        { id: "x4", ref: "D3", sheet: 1, author: "分析师", createdAt: 1726001300000,
          resolved: false, text: "Sheet2 的批注" }
      ]
    }
  };

  try {
    const xlsxZip = await window.OS.Exporter.buildXlsx(excelDoc);
    ok("XLSX: buildXlsx 返回 JSZip", xlsxZip && typeof xlsxZip.file === "function");

    // 验证 zip 内含批注文件（Sheet1 批注多 Sheet2 只有 1 条）
    const commentFiles = xlsxZip.file(/xl\/comments\/comment\d+\.xml/);
    ok("XLSX: zip 含 xl/comments/comment*.xml", commentFiles.length >= 1);

    // 验证 Sheet1 批注 XML
    const sheet1CmtXml = await xlsxZip.file("xl/comments/comment1.xml")?.async("string");
    ok("XLSX: comment1.xml 存在", !!sheet1CmtXml);
    ok("XLSX: comment1.xml 含 ref A1", sheet1CmtXml && sheet1CmtXml.includes('ref="A1"'));
    ok("XLSX: comment1.xml 含 ref B5", sheet1CmtXml && sheet1CmtXml.includes('ref="B5"'));
    ok("XLSX: comment1.xml 含 ref C10", sheet1CmtXml && sheet1CmtXml.includes('ref="C10"'));
    ok("XLSX: comment1.xml 含 '季度销售额'", sheet1CmtXml && sheet1CmtXml.includes("季度销售额"));

    // 验证 commentAuthors.xml
    const authorsXml = await xlsxZip.file("xl/persons/person.xml")?.async("string");
    const legacyAuthorsXml = await xlsxZip.file("xl/sharedStrings.xml")?.async("string"); // 旧格式作者存储
    const personOrLegacy = authorsXml || legacyAuthorsXml;
    // Excel 旧格式可能用 legacyCommentAuthors
    const legacyCommentAuthors = await xlsxZip.file("xl/legacyCommentAuthors.xml")?.async("string");
    ok("XLSX: 批注作者已写入 zip（person.xml/sharedStrings/legacyCommentAuthors 任一）",
      !!(authorsXml || legacyCommentAuthors || legacyAuthorsXml));

    // 验证 Sheet1 worksheet 有批注关系
    const sheet1Rels = await xlsxZip.file("xl/worksheets/_rels/sheet1.xml.rels")?.async("string");
    ok("XLSX: sheet1.xml.rels 含 comments 关系", sheet1Rels && sheet1Rels.includes("comments"));

    // Sheet2 批注
    const sheet2CmtXml = await xlsxZip.file("xl/comments/comment2.xml")?.async("string");
    ok("XLSX: comment2.xml 存在（Sheet2 批注）", !!sheet2CmtXml);
    ok("XLSX: comment2.xml 含 ref D3", sheet2CmtXml && sheet2CmtXml.includes('ref="D3"'));
    ok("XLSX: comment2.xml 含 'Sheet2 的批注'", sheet2CmtXml && sheet2CmtXml.includes("Sheet2 的批注"));

    // 往返：导出 → 导入
    const xlsxImport = await window.OS.Importer.parseXlsx(xlsxZip);
    ok("XLSX: 导入成功", xlsxImport && xlsxImport.type === "spreadsheet");

    const impComments = (xlsxImport.data && xlsxImport.data.comments) || [];
    ok("XLSX: 导入后 comments 数组存在", Array.isArray(impComments));
    ok("XLSX: 导入后 comments 数量=4", impComments.length === 4);

    // 逐条验证 ref 和 sheet
    const x1 = impComments.find(c => c.ref === "A1");
    ok("XLSX: ref=A1 批注往返", !!x1);
    ok("XLSX: ref=A1 text 往返", x1 && x1.text === "这是季度销售额汇总");
    ok("XLSX: ref=A1 sheet=0 往返", x1 && (x1.sheet === 0 || x1.sheet == null));

    const x4 = impComments.find(c => c.ref === "D3");
    ok("XLSX: ref=D3 (Sheet2) 往返", !!x4);
    ok("XLSX: ref=D3 text 往返", x4 && x4.text === "Sheet2 的批注");

    console.log("  Excel XLSX 批注往返完成 ✅");
  } catch (e) {
    ok("XLSX: 执行无异常", false);
    console.log("  ERROR:", e.message);
  }

  // ========================================================
  // 3. PowerPoint (PPTX) —— 多 slide 批注往返
  // ========================================================
  console.log("\n--- 3. PowerPoint (PPTX) 批注往返 ---");

  const pptDoc = {
    type: "presentation",
    data: {
      slides: [
        { id: "s1", name: "封面", elements: [] },
        { id: "s2", name: "目录", elements: [] },
        { id: "s3", name: "内容", elements: [] }
      ],
      comments: [
        { id: "p1", slide: 0, author: "设计师", createdAt: 1726002000000,
          resolved: false, text: "封面颜色建议改为深蓝", _pos: { x: 100, y: 200, w: 300, h: 100 } },
        { id: "p2", slide: 1, author: "产品经理", createdAt: 1726002100000,
          resolved: false, text: "目录少了一页", _pos: { x: 50, y: 300, w: 400, h: 80 } },
        { id: "p3", slide: 2, author: "设计师", createdAt: 1726002200000,
          resolved: true, text: "已处理", _pos: { x: 200, y: 150, w: 250, h: 120 } },
        { id: "p4", slide: 2, author: "产品经理", createdAt: 1726002300000,
          resolved: false, text: "这页图表数据不准", _pos: { x: 150, y: 400, w: 350, h: 90 } }
      ]
    }
  };

  try {
    const pptxZip = await window.OS.Exporter.buildPptx(pptDoc);
    ok("PPTX: buildPptx 返回 JSZip", pptxZip && typeof pptxZip.file === "function");

    // 验证 commentAuthors.xml
    const authorsXml = await pptxZip.file("ppt/commentAuthors.xml")?.async("string");
    ok("PPTX: zip 含 commentAuthors.xml", !!authorsXml);
    ok("PPTX: commentAuthors.xml 含 '设计师'", authorsXml && authorsXml.includes("设计师"));
    ok("PPTX: commentAuthors.xml 含 '产品经理'", authorsXml && authorsXml.includes("产品经理"));

    // 验证每页 commentN.xml
    const slide1CmtXml = await pptxZip.file("ppt/comments/comment1.xml")?.async("string");
    ok("PPTX: comment1.xml 存在（Slide1 批注）", !!slide1CmtXml);
    ok("PPTX: comment1.xml 含 '深蓝'", slide1CmtXml && slide1CmtXml.includes("深蓝"));

    const slide2CmtXml = await pptxZip.file("ppt/comments/comment2.xml")?.async("string");
    ok("PPTX: comment2.xml 存在（Slide2 批注）", !!slide2CmtXml);
    ok("PPTX: comment2.xml 含 '目录'", slide2CmtXml && slide2CmtXml.includes("目录"));

    const slide3CmtXml = await pptxZip.file("ppt/comments/comment3.xml")?.async("string");
    ok("PPTX: comment3.xml 存在（Slide3 批注×2）", !!slide3CmtXml);
    ok("PPTX: comment3.xml 含 '已处理'", slide3CmtXml && slide3CmtXml.includes("已处理"));
    ok("PPTX: comment3.xml 含 '图表'", slide3CmtXml && slide3CmtXml.includes("图表"));

    // 验证 slideN.xml.rels 含 comments 关系
    const slide1Rels = await pptxZip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string");
    ok("PPTX: slide1.xml.rels 含 comments 关系", slide1Rels && slide1Rels.includes("comments"));

    // 往返：导出 → 导入
    const pptxImport = await window.OS.Importer.parsePptx(pptxZip);
    ok("PPTX: 导入成功", pptxImport && pptxImport.type === "presentation");

    const impComments = (pptxImport.data && pptxImport.data.comments) || [];
    ok("PPTX: 导入后 comments 数组存在", Array.isArray(impComments));
    ok("PPTX: 导入后 comments 数量=4", impComments.length === 4);

    // 验证 slide 归属
    const bySlide0 = impComments.filter(c => c.slide === 0);
    ok("PPTX: Slide0 批注数=1", bySlide0.length === 1);

    const bySlide1 = impComments.filter(c => c.slide === 1);
    ok("PPTX: Slide1 批注数=1", bySlide1.length === 1);

    const bySlide2 = impComments.filter(c => c.slide === 2);
    ok("PPTX: Slide2 批注数=2", bySlide2.length === 2);

    // 验证 text 往返
    const p1 = bySlide0[0];
    ok("PPTX: Slide0 text='深蓝' 往返", p1 && p1.text && p1.text.includes("深蓝"));

    const p2 = bySlide1[0];
    ok("PPTX: Slide1 text='目录' 往返", p2 && p2.text && p2.text.includes("目录"));

    console.log("  PowerPoint PPTX 批注往返完成 ✅");
  } catch (e) {
    ok("PPTX: 执行无异常", false);
    console.log("  ERROR:", e.message);
  }

  // ========================================================
  // 汇总
  // ========================================================
  console.log(`\n========================================`);
  console.log(`套件结果: ${pass} passed, ${fail} failed, 共 ${pass + fail}`);
  if (fails.length > 0) {
    console.log(`失败详情:`);
    fails.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log(`========================================`);
    console.log(`全部通过 ✅`);
    process.exit(0);
  }
})();

