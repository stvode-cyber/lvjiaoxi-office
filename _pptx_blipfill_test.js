/* 绿角犀 Office · PPTX blipFill 图片背景提取测试
 * 验证 extractBgFillColor 的 blipFill 路径 + resolveMediaByRels baseDir 通用化
 * 测试场景：slide/layout/master 三层 blipFill + solidFill 优先 + 无背景 fallback
 *
 * 运行：node _pptx_blipfill_test.js
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
  loadJS("js/import-ooxml.js");

  return { window, OS };
}

// —— 1x1 像素 PNG base64 ——
const PNG_1x1_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlQVR42mNk+M9QDwADoQG/B6Vd+QAAAABJRU5ErkJggg==";
const PNG_BUFFER = Buffer.from(PNG_1x1_B64, "base64");

// —— XML 模板 ——
const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;

function presentationXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;
}

function slideMasterXml(bgXml) {
  const bg = bgXml || "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr/><p:grpSpPr/></p:spTree></p:cSld></p:sldMaster>`;
}

function slideLayoutXml(bgXml) {
  const bg = bgXml || "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr/><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`;
}

function slideXml(bgXml) {
  const bg = bgXml || "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr/><p:grpSpPr/></p:spTree></p:cSld></p:sld>`;
}

function blipFillBg(rId) {
  return `<p:bg><p:bgPr><a:blipFill><a:blip r:embed="${rId}"/></a:blipFill></p:bgPr></p:bg>`;
}

function solidFillBg(color) {
  return `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:bgPr></p:bg>`;
}

function relsXml(rels) {
  const items = rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
}

const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";

// —— 构造 PPTX zip ——
async function makePptxZip(opts) {
  const zip = new JSZip();
  // presentation.xml
  zip.file("ppt/presentation.xml", presentationXml());
  // media image1.png
  zip.file("ppt/media/image1.png", PNG_BUFFER);
  // slideMaster
  zip.file("ppt/slideMasters/slideMaster1.xml", slideMasterXml(opts.masterBg));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", relsXml([
    { id: "rId1", type: REL_LAYOUT, target: "../slideLayouts/slideLayout1.xml" }
  ].concat(opts.masterImageRels || [])));
  // slideLayout
  zip.file("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml(opts.layoutBg));
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsXml(opts.layoutRels || []));
  // slide
  zip.file("ppt/slides/slide1.xml", slideXml(opts.slideBg));
  zip.file("ppt/slides/_rels/slide1.xml.rels", relsXml([
    { id: "rId1", type: REL_LAYOUT, target: "../slideLayouts/slideLayout1.xml" }
  ].concat(opts.slideImageRels || [])));
  return zip;
}

// —— 主测试 ——
async function main() {
  const { window } = setupDom();
  const parsePptx = window.OS.Importer.parsePptx;

  // 场景1：slide 自己的 bg 有 blipFill → bg = url(data:image/png...)
  {
    const zip = await makePptxZip({
      slideBg: blipFillBg("rId2"),
      slideImageRels: [{ id: "rId2", type: REL_IMAGE, target: "../media/image1.png" }]
    });
    const result = await parsePptx(zip);
    const bg = result.data.slides[0].bg;
    ok("S1 slide blipFill: 返回 url(data:...)", bg && bg.startsWith("url(data:image/png;base64,"));
    ok("S1 slide blipFill: base64 内容非空", bg && bg.length > "url(data:image/png;base64,".length + 10);
  }

  // 场景2：slide 无 bg, layout 有 blipFill → 从 layout 继承
  {
    const zip = await makePptxZip({
      slideBg: null,
      layoutBg: blipFillBg("rId2"),
      layoutRels: [{ id: "rId2", type: REL_IMAGE, target: "../media/image1.png" }]
    });
    const result = await parsePptx(zip);
    const bg = result.data.slides[0].bg;
    ok("S2 layout blipFill: 返回 url(data:...)", bg && bg.startsWith("url(data:image/png;base64,"));
    ok("S2 layout blipFill: base64 内容非空", bg && bg.length > "url(data:image/png;base64,".length + 10);
  }

  // 场景3：slide 和 layout 都无 bg, master 有 blipFill → 从 master 继承
  {
    const zip = await makePptxZip({
      slideBg: null,
      layoutBg: null,
      masterBg: blipFillBg("rId2"),
      masterImageRels: [{ id: "rId2", type: REL_IMAGE, target: "../media/image1.png" }]
    });
    const result = await parsePptx(zip);
    const bg = result.data.slides[0].bg;
    ok("S3 master blipFill: 返回 url(data:...)", bg && bg.startsWith("url(data:image/png;base64,"));
    ok("S3 master blipFill: base64 内容非空", bg && bg.length > "url(data:image/png;base64,".length + 10);
  }

  // 场景4：都无 bg → fallback #ffffff
  {
    const zip = await makePptxZip({ slideBg: null, layoutBg: null, masterBg: null });
    const result = await parsePptx(zip);
    const bg = result.data.slides[0].bg;
    ok("S4 无背景: fallback #ffffff", bg === "#ffffff");
  }

  // 场景5：solidFill 优先于 blipFill（solidFill 先匹配）
  {
    const bgXml = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="ff0000"/></a:solidFill><a:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:bgPr></p:bg>`;
    const zip = await makePptxZip({
      slideBg: bgXml,
      slideImageRels: [{ id: "rId2", type: REL_IMAGE, target: "../media/image1.png" }]
    });
    const result = await parsePptx(zip);
    const bg = result.data.slides[0].bg;
    ok("S5 solidFill 优先: bg=#ff0000", bg === "#ff0000");
  }

  // 场景6：blipFill 引用的 rId 在 rels 里不存在 → 降级到下一层
  {
    const zip = await makePptxZip({
      slideBg: blipFillBg("rId99"), // rId99 不存在
      slideImageRels: [], // 没有 image rels
      layoutBg: solidFillBg("2196f3") // layout 有 solidFill 蓝色
    });
    const result = await parsePptx(zip);
    const bg = result.data.slides[0].bg;
    // slide blipFill 解析失败（rId 不存在）→ slideOwnBg = null → fallback 到 layout
    ok("S6 blipFill rId 不存在: 降级到 layout solidFill #2196f3", bg === "#2196f3");
  }

  // 场景7：resolveMediaByRels baseDir 路径折叠 — layout 的 rels target 是 ../media/image1.png
  //       用 baseDir=ppt/slideLayouts/ → ppt/slideLayouts/../media/image1.png → ppt/media/image1.png
  //       已在场景2 隐式验证，这里显式断言 mediaMap 路径正确
  {
    const zip = await makePptxZip({
      slideBg: null,
      layoutBg: blipFillBg("rId2"),
      layoutRels: [{ id: "rId2", type: REL_IMAGE, target: "../media/image1.png" }]
    });
    const result = await parsePptx(zip);
    const bg = result.data.slides[0].bg;
    // 如果 baseDir 折叠错了，bg 会是 null 或 "#ffffff"
    ok("S7 baseDir 路径折叠: layout rels ../media/ 正确解析", bg && bg !== "#ffffff" && bg.startsWith("url(data:"));
  }

  console.log("\n========================================");
  console.log(`套件结果: ${pass} passed, ${fail} failed, 共 ${pass + fail}`);
  console.log("========================================");
  if (fail > 0) { process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
