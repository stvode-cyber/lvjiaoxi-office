/* 绿角犀 Office · PDF→DOCX 图片嵌入测试
 * 验证：OS.PdfConvert._imgUtils 纯函数（矩阵/矩形/RGBA 展开/目标像素）
 *      + pdfToDocxHtml 图片 span 穿插排版 + 图片专属页不被丢弃
 *      + pdfToDocx 闭环：DOCX zip 内含 word/media 图片与 drawing 引用
 * 复用 _pdf_convert_test.js 同款 harness（jsdom + 真实 npm JSZip）
 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";
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
loadJS("js/export-ooxml.js");
loadJS("js/modules/pdf-convert.js");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

// 1×1 红 PNG（最小合法 PNG，供 DOCX 闭环断言）
const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  const C = OS.PdfConvert;
  const U = C._imgUtils;
  ok("_imgUtils 已导出", !!U && typeof U.multiplyM === "function" && typeof U.imageRect === "function" && typeof U.expandRGBA === "function" && typeof U.targetPx === "function");

  // —— multiplyM：矩阵相乘 ——
  const I = [1, 0, 0, 1, 0, 0];
  ok("multiplyM 单位阵不变", JSON.stringify(U.multiplyM(I, I)) === JSON.stringify(I));
  const T = [1, 0, 0, 1, 10, 20]; // 平移 (10,20)
  const S = [2, 0, 0, 3, 0, 0];   // 缩放 (2,3)
  // T×S：先缩放后平移 → [2,0,0,3,10,20]
  const TS = U.multiplyM(T, S);
  ok("multiplyM T×S 复合", TS[0] === 2 && TS[3] === 3 && TS[4] === 10 && TS[5] === 20);
  // S×T：先平移后缩放 → [2,0,0,3,20,60]
  const ST = U.multiplyM(S, T);
  ok("multiplyM S×T 复合", ST[0] === 2 && ST[3] === 3 && ST[4] === 20 && ST[5] === 60);

  // —— imageRect：CTM → 归一化矩形（vp 595×842）——
  const r1 = U.imageRect([200, 0, 0, -150, 50, 700], 595, 842);
  ok("imageRect 基本矩形", r1 && Math.abs(r1.x - 50 / 595) < 1e-9 && Math.abs(r1.y - 700 / 842) < 1e-9);
  ok("imageRect 翻转取绝对值宽高", r1 && Math.abs(r1.w - 200 / 595) < 1e-9 && Math.abs(r1.h - 150 / 842) < 1e-9);
  ok("imageRect 旋转 90° 宽高互换", (() => { const r = U.imageRect([0, 100, -60, 0, 0, 0], 1000, 1000); return r && Math.abs(r.w - 0.1) < 1e-9 && Math.abs(r.h - 0.06) < 1e-9; })());
  ok("imageRect 零宽返回 null", U.imageRect([0, 0, 0, 100, 0, 0], 595, 842) === null);
  ok("imageRect 非法输入返回 null", U.imageRect(null, 595, 842) === null && U.imageRect([1, 0, 0, 1, 0, 0], 0, 842) === null);
  ok("imageRect NaN 防护", U.imageRect([NaN, 0, 0, 100, 0, 0], 595, 842) === null);

  // —— expandRGBA：RGB / RGBA / 1bpp ——
  const rgb = U.expandRGBA({ width: 2, height: 1, kind: 2, data: new Uint8Array([255, 0, 0, 0, 255, 0]) });
  ok("expandRGBA RGB→RGBA", rgb && rgb.length === 8 && rgb[0] === 255 && rgb[1] === 0 && rgb[3] === 255 && rgb[4] === 0 && rgb[5] === 255);
  const rgba = U.expandRGBA({ width: 1, height: 1, kind: 3, data: new Uint8ClampedArray([1, 2, 3, 4]) });
  ok("expandRGBA RGBA 直通", rgba && rgba[0] === 1 && rgba[1] === 2 && rgba[2] === 3 && rgba[3] === 4);
  // 8×1 1bpp：0b10101010 → 黑白交替
  const bw = U.expandRGBA({ width: 8, height: 1, kind: 1, data: new Uint8Array([0b10101010]) });
  ok("expandRGBA 1bpp 位解包", bw && bw[0] === 255 && bw[4] === 0 && bw[8] === 255 && bw[12] === 0);
  ok("expandRGBA 1bpp alpha=255", bw && bw[3] === 255);
  // 缺 kind 按长度推断：2×2=4px，16 字节 → RGBA
  const infer = U.expandRGBA({ width: 2, height: 2, data: new Uint8Array(16).fill(7) });
  ok("expandRGBA 无 kind 按长度推断 RGBA", infer && infer[0] === 7 && infer.length === 16);
  ok("expandRGBA 坏数据返回 null", U.expandRGBA(null) === null && U.expandRGBA({ width: 0, height: 5, data: new Uint8Array(9) }) === null);

  // —— targetPx：600×800 网格 + 上限 + 小图过滤 ——
  const px = U.targetPx(0.5, 0.25);
  ok("targetPx 归一化→像素", px && px.tw === 300 && px.th === 200);
  ok("targetPx 超 1600 截断", (() => { const p = U.targetPx(5, 5); return p && p.tw === 1600 && p.th === 1600; })());
  ok("targetPx 小图返回 null（图标过滤）", U.targetPx(0.005, 0.005) === null);

  // —— pdfToDocxHtml：图片 span 穿插 ——
  const pages = [[
    { text: "Before image paragraph.", x: 0.1, y: 0.10, h: 0.015 },
    { image: PNG1, x: 0.2, y: 0.50, w: 0.4, h: 0.3 },
    { text: "After image paragraph.", x: 0.1, y: 0.90, h: 0.015 }
  ]];
  const html = C.pdfToDocxHtml(pages);
  ok("pdfToDocxHtml 含 <img", /<img src="data:image\/png;base64,/.test(html));
  ok("pdfToDocxHtml 图片按 y 穿插在段落之间",
    html.indexOf("Before image paragraph.") < html.indexOf("<img") && html.indexOf("<img") < html.indexOf("After image paragraph."));
  ok("pdfToDocxHtml 图片宽高属性", /width="240"/.test(html) && /height="240"/.test(html));

  // —— 图片专属页不被丢弃（回归：此前 proseOnly 空就整页 return 丢图）——
  const imgOnly = C.pdfToDocxHtml([[
    { image: PNG1, x: 0.1, y: 0.5, w: 0.5, h: 0.5 }
  ]]);
  ok("图片专属页保留 <img", /<img src="data:image\/png/.test(imgOnly));
  const twoPages = C.pdfToDocxHtml([
    [{ text: "Page one.", x: 0.1, y: 0.1, h: 0.015 }],
    [{ image: PNG1, x: 0.1, y: 0.5, w: 0.5, h: 0.5 }]
  ]);
  ok("第2页纯图片页保留且分页", /<img src="data:image\/png/.test(twoPages) && /<div class="page-break"><\/div>/.test(twoPages));

  // —— 空文本+空图片页仍只分页（不崩）——
  const emptyMix = C.pdfToDocxHtml([[], [{ text: "x", x: 0.1, y: 0.1, h: 0.015 }]]);
  ok("空页容错", /<div class="page-break"><\/div>/.test(emptyMix));

  // —— 闭环：pdfToDocx → DOCX zip 内含图片 ——
  const zip = C.pdfToDocx(pages, "图片测试");
  ok("pdfToDocx 返回 zip", !!zip && typeof zip.file === "function");
  const mediaFiles = zip.file(/word\/media\/image\d+\.png/);
  ok("DOCX 含 word/media 图片", mediaFiles.length >= 1);
  const pngBytes = await mediaFiles[0].async("uint8array");
  ok("DOCX 图片非空且为 PNG 头", pngBytes.length > 50 && pngBytes[0] === 0x89 && pngBytes[1] === 0x50);
  const docXml = await zip.file("word/document.xml").async("string");
  ok("DOCX document.xml 含 drawing 引用", /<w:drawing>/.test(docXml) && /<pic:pic/.test(docXml));
  ok("DOCX 图片前后文本保留", /Before image paragraph/.test(docXml) && /After image paragraph/.test(docXml));

  console.log(`\n_pdf_convert_image_test: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log("失败项:", fails.join("; ")); process.exit(1); }
})();
