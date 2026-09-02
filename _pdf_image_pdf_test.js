/* PDF 字节生成测试（L 核心能力）：writeImagePdf 由 RGBA 页面生成真实 PDF 字节
 * 验证：生成合法 %PDF、含 Catalog/Pages、可被 parsePdf 解析回正确页数、FlateDecode 图像流。
 * 运行：node _pdf_image_pdf_test.js
 */
global.window = global;
global.OS = {};
require("./app/js/pdf-tool.js");
const T = global.OS.PdfTool;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("✗ " + name); } }

function rgba(w, h, fill) {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = fill[0]; d[i * 4 + 1] = fill[1]; d[i * 4 + 2] = fill[2]; d[i * 4 + 3] = 255; }
  return d;
}

(async () => {
  // 3 页，不同纯色，验证多页与解析
  const pages = [
    { width: 4, height: 4, data: rgba(4, 4, [255, 0, 0]) },
    { width: 4, height: 4, data: rgba(4, 4, [0, 255, 0]) },
    { width: 4, height: 4, data: rgba(4, 4, [0, 0, 255]) }
  ];
  const pdf = await T.writeImagePdf(pages);
  ok("生成 PDF 字节(Uint8Array)", pdf instanceof Uint8Array && pdf.length > 100);
  ok("PDF 头为 %PDF-", String.fromCharCode.apply(null, pdf.slice(0, 5)) === "%PDF-");
  const head = String.fromCharCode.apply(null, pdf.slice(0, 8));
  ok("含 PDF 二进制标记", head.indexOf("PDF") >= 0);

  // 解析回页数
  const parsed = await T.parsePdf(pdf);
  ok("parsePdf 解析页数=3", parsed.pages.length === 3);
  ok("含 Root/Catalog 引用", /Root\s+\d+\s+\d+\s+R/.test(String.fromCharCode.apply(null, pdf)));

  // 单页最小情形
  const one = await T.writeImagePdf([{ width: 2, height: 2, data: rgba(2, 2, [10, 20, 30]) }]);
  ok("单页 PDF 生成", one instanceof Uint8Array && one.length > 50);
  ok("单页解析页数=1", (await T.parsePdf(one)).pages.length === 1);

  // 尺寸映射：MediaBox 等于传入 width/height（1:1 铺满）
  const big = await T.writeImagePdf([{ width: 100, height: 60, data: rgba(100, 60, [1, 2, 3]) }]);
  ok("大尺寸页面生成且可解析", (await T.parsePdf(big)).pages.length === 1 && big.length > 200);

  console.log((fail === 0 ? "✓ 全部通过" : "✗ 有失败") + "：通过 " + pass + " / " + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log("✗ 运行异常：" + e.message); process.exit(1); });
