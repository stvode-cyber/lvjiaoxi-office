/* 测试 L：Writer「直接下载 PDF 文件」核心能力（浏览器无关部分）
   - SvgRaster.buildPageSvg：分页 DOM → 带内联样式的外国对象 SVG
   - PdfTool.writeImagePdf：mediaW/mediaH 独立控制 MediaBox（高 DPI 光栅 + 真实纸张尺寸）
*/
const assert = require("assert");
const SvgRaster = require("./app/js/modules/svg-raster.js");
const PdfTool = require("./app/js/pdf-tool.js");

let pass = 0; const log = [];
function ok(name, cond) { if (!cond) throw new Error("FAIL: " + name); pass++; log.push("✓ " + name); }

(async () => {
  // 1) buildPageSvg 基础结构
  const inner = '<div class="pp-page" style="width:100px;height:140px">标题</div>';
  const svg = SvgRaster.buildPageSvg(inner, 100, 140, 2);
  ok("svg 根含尺寸 200x280（scale=2）", svg.includes('width="200"') && svg.includes('height="280"'));
  ok("svg 含 foreignObject", svg.includes("<foreignObject"));
  ok("svg 含 xhtml 命名空间", svg.includes('xmlns="http://www.w3.org/1999/xhtml"'));
  ok("svg 含内联样式（.pp-page）", svg.includes(".pp-page"));
  ok("svg 内容含 transform:scale(2)", svg.includes("transform:scale(2)"));
  ok("svg 内含原始 innerHtml", svg.includes(inner));
  ok("svg 为合法 <svg ...> 开头", svg.trim().startsWith("<svg"));

  // 2) buildPageSvg 默认 scale=2
  const svgD = SvgRaster.buildPageSvg(inner, 100, 140);
  ok("默认 scale=2 → 200x280", svgD.includes('width="200"') && svgD.includes('height="280"'));

  // 3) writeImagePdf 默认（无 media）→ MediaBox = 像素尺寸
  const px = new Uint8Array(4 * 4 * 4).fill(255); // 4x4 白
  const b1 = await PdfTool.writeImagePdf([{ width: 4, height: 4, data: px }]);
  const s1 = Buffer.from(b1).toString("latin1");
  ok("默认 PDF 以 %PDF 开头", s1.startsWith("%PDF"));
  ok("默认 MediaBox = 像素 4x4", s1.includes("/MediaBox [0 0 4 4]"));
  ok("默认图像宽高 = 4x4", s1.includes("/Width 4 /Height 4"));
  ok("默认含单页 /Page", (s1.match(/\/Type \/Page[^s]/g) || []).length === 1);
  ok("默认可被子模块解析", PdfTool.parsePdf(b1).pages.length === 1);

  // 4) writeImagePdf 带 mediaW/mediaH → MediaBox 独立为真实纸张尺寸（A4≈595x842）
  const b2 = await PdfTool.writeImagePdf([{ width: 1000, height: 1414, data: new Uint8Array(1000 * 1414 * 4).fill(255), mediaW: 595, mediaH: 842 }]);
  const s2 = Buffer.from(b2).toString("latin1");
  ok("带 media → MediaBox = 595x842（A4 点）", s2.includes("/MediaBox [0 0 595 842]"));
  ok("带 media → 图像仍为高 DPI 1000x1414", s2.includes("/Width 1000 /Height 1414"));
  ok("带 media → 缩放铺满（cm 用 595 842）", s2.includes("595 0 0 842 0 0 cm"));
  ok("带 media → 可解析为 1 页", PdfTool.parsePdf(b2).pages.length === 1);

  // 5) 多页 + media 一致性
  const b3 = await PdfTool.writeImagePdf([
    { width: 200, height: 282, data: new Uint8Array(200 * 282 * 4).fill(255), mediaW: 595, mediaH: 842 },
    { width: 200, height: 282, data: new Uint8Array(200 * 282 * 4).fill(200), mediaW: 595, mediaH: 842 }
  ]);
  const s3 = Buffer.from(b3).toString("latin1");
  ok("多页 media → 两页 MediaBox 均为 A4", (s3.match(/MediaBox \[0 0 595 842\]/g) || []).length === 2);
  ok("多页 → 解析为 2 页", PdfTool.parsePdf(b3).pages.length === 2);

  console.log(log.join("\n"));
  console.log("\n[L] 通过 " + pass + " / " + pass + " 断言");
})().catch(e => { console.error(log.join("\n")); console.error("\n[L] 失败：" + e.message); process.exit(1); });
