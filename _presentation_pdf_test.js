/* M: Presentation 直接下载 PDF —— 纯逻辑验证（零 DOM 依赖部分）
   - svg-raster.buildPageSvg 支持自定义 css（幻灯片样式），且默认 css 在传入时被替换
   - pdf-tool.writeImagePdf 支持 mediaW/mediaH（真实 16:9 幻灯片版面 792×445 pt）
*/
global.window = global; global.OS = {};
require("./app/js/modules/svg-raster.js");
require("./app/js/pdf-tool.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

(async () => {
  const SR = OS.SvgRaster;
  // 1) 默认 css
  const def = SR.buildPageSvg("<div>x</div>", 760, 427, 2);
  ok("默认 CSS 含正文排版样式", def.indexOf(".pp-page") !== -1 && def.indexOf("<style>") !== -1);
  ok("默认 SVG 尺寸按 scale 放大", def.indexOf('width="1520"') !== -1 && def.indexOf('height="854"') !== -1);

  // 2) 自定义 css（幻灯片）
  const slideCss = ".pres-canvas{position:relative}.pres-canvas .el{position:absolute}";
  const cus = SR.buildPageSvg("<div class='pres-canvas'>s</div>", 760, 427, 2, slideCss);
  ok("自定义 CSS 被内联", cus.indexOf(slideCss) !== -1);
  ok("传入自定义 CSS 后不含默认 .pp-page 规则", cus.indexOf(".pp-page") === -1);
  ok("自定义 SVG 仍为合法 foreignObject 结构", cus.indexOf("<foreignObject") !== -1 && cus.indexOf("</svg>") !== -1);

  // 3) writeImagePdf 支持 mediaW/mediaH（16:9 幻灯片）
  function makePage(w, h) {
    const data = new Uint8Array(w * h * 4).fill(255);
    // 填充一个红色像素块以便非全白校验存在
    for (let i = 0; i < 200; i++) { data[i * 4] = 220; }
    return { width: w, height: h, data, mediaW: 792, mediaH: Math.round(792 * h / w) };
  }
  const pages = [makePage(1520, 854), makePage(1520, 854), makePage(1520, 854)];
  const bytes = await OS.PdfTool.writeImagePdf(pages);
  const txt = Buffer.from(bytes).toString("latin1");
  ok("生成的 PDF 以 %PDF- 开头", txt.indexOf("%PDF-") === 0);
  ok("PDF 含 3 个 /Type /Page", (txt.match(/\/Type \/Page[^s]/g) || []).length === 3);
  ok("MediaBox 使用 792×445 pt（16:9 版面）", txt.indexOf("/MediaBox [0 0 792 445]") !== -1);
  ok("图像流使用 FlateDecode", txt.indexOf("/Filter /FlateDecode") !== -1);

  // 4) 单页也正确
  const one = await OS.PdfTool.writeImagePdf([makePage(1520, 854)]);
  const oneTxt = Buffer.from(one).toString("latin1");
  ok("单页 PDF 含 1 个 /Type /Page", (oneTxt.match(/\/Type \/Page[^s]/g) || []).length === 1);

  console.log("\nM 测试：" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
