/*
 * _pdf_pageinfo_test.js — OS.PdfPageInfo 单元自测（零依赖，node 直跑）
 * 覆盖：页面树遍历 / MediaBox·CropBox·Rotate / 资源计数(字体·图像·XObject) /
 *       标准纸张识别(A4·Letter…) / 方向(有效方向=旋转翻转) / 纸张分布·一致性·主流纸张 /
 *       间接 MediaBox 引用 / 缺 MediaBox(继承)负例 / 无页面树负例 / toMarkdown·toHtml。
 */
const C = require("./app/js/modules/pdf-pageinfo.js");
const enc = s => new TextEncoder().encode(s);

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

// —— PDF_A：单页 A4 + 资源（字体2 / 图像1 / XObject1）——
const pdfA = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] /Count 1 >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /CropBox [0 0 595 842] /Rotate 0 /Resources << /Font << /F1 6 0 R /F2 7 0 R >> /XObject << /Im1 8 0 R >> >> >>\nendobj\n" +
  "8 0 obj\n<< /Type /XObject /Subtype /Image /Width 10 /Height 10 >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);

console.log("PDF_A：");
const rA = C.parsePageTree(pdfA);
ok("hasPageTree = true", rA.hasPageTree === true);
ok("totalPages = 1", rA.totalPages === 1);
ok("第1页 obj = 5", rA.pages[0].obj === 5);
ok("第1页 MediaBox 595×842", rA.pages[0].widthPt === 595 && rA.pages[0].heightPt === 842);
ok("第1页 widthMm ≈ 209.9", Math.abs(rA.pages[0].widthMm - 209.9) < 0.2);
ok("第1页 heightMm = 297", rA.pages[0].heightMm === 297);
ok("第1页 paperSize = A4", rA.pages[0].paperSize === "A4");
ok("第1页 orientation = portrait", rA.pages[0].orientation === "portrait");
ok("第1页 rotate = 0", rA.pages[0].rotate === 0);
ok("第1页 resources.fonts = 2", rA.pages[0].resources.fonts === 2);
ok("第1页 resources.images = 1", rA.pages[0].resources.images === 1);
ok("第1页 resources.xobjects = 1", rA.pages[0].resources.xobjects === 1);
ok("摘要 consistentSize = true", rA.summary.consistentSize === true);
ok("摘要 dominantSize = A4", rA.summary.dominantSize === "A4");
ok("摘要 orientations.portrait = 1", rA.summary.orientations.portrait === 1);
ok("摘要 orientations.landscape = 0", rA.summary.orientations.landscape === 0);
ok("摘要 distribution.A4 = [1]", Array.isArray(rA.summary.distribution.A4) && rA.summary.distribution.A4.length === 1 && rA.summary.distribution.A4[0] === 1);
ok("summarize.totalPages = 1", C.summarize(rA).totalPages === 1);

// —— PDF_B：3 页混合尺寸 + 旋转（A4 / Letter(旋转90) / A4横向）——
const pdfB = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R 6 0 R 7 0 R ] /Count 3 >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 0 >>\nendobj\n" +
  "6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 >>\nendobj\n" +
  "7 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Rotate 0 >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);

console.log("PDF_B：");
const rB = C.parsePageTree(pdfB);
ok("totalPages = 3", rB.totalPages === 3);
ok("页码顺序 = 1,2,3（遍历序）", rB.pages.map(p => p.num).join(",") === "1,2,3");
ok("第1页 A4 portrait", rB.pages[0].paperSize === "A4" && rB.pages[0].orientation === "portrait" && rB.pages[0].rotate === 0);
ok("第2页 Letter rotate90 → 有效横向", rB.pages[1].paperSize === "Letter" && rB.pages[1].rotate === 90 && rB.pages[1].orientation === "landscape");
ok("第3页 A4 横向(842×595)", rB.pages[2].paperSize === "A4" && rB.pages[2].widthPt === 842 && rB.pages[2].orientation === "landscape");
ok("摘要 consistentSize = false", rB.summary.consistentSize === false);
ok("摘要 dominantSize = A4", rB.summary.dominantSize === "A4");
ok("摘要 distribution.A4 = [1,3]", Array.isArray(rB.summary.distribution.A4) && rB.summary.distribution.A4.join(",") === "1,3");
ok("摘要 distribution.Letter = [2]", Array.isArray(rB.summary.distribution.Letter) && rB.summary.distribution.Letter.join(",") === "2");
ok("摘要 orientations.portrait = 1", rB.summary.orientations.portrait === 1);
ok("摘要 orientations.landscape = 2", rB.summary.orientations.landscape === 2);
ok("摘要 rotations 0×2 / 90×1", rB.summary.rotations["0"] === 2 && rB.summary.rotations["90"] === 1);

// —— PDF_C：嵌套页面树（/Pages 套 /Pages）——
const pdfC = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] >>\nendobj\n" +
  "3 0 obj\n<< /Type /Pages /Kids [ 10 0 R 11 0 R ] /Parent 2 0 R >>\nendobj\n" +
  "10 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] >>\nendobj\n" +
  "11 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);
console.log("PDF_C：");
const rC = C.parsePageTree(pdfC);
ok("嵌套页面树 totalPages = 2", rC.totalPages === 2);
ok("嵌套页面树 depth 标记", rC.pages[0].depth === 1 && rC.pages[1].depth === 1);
ok("嵌套页面树 obj 正确", rC.pages[0].obj === 10 && rC.pages[1].obj === 11);

// —— PDF_D：缺 MediaBox（应继承但本模块标未知）+ 无资源 ——
const pdfD = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /Rotate 0 >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);
console.log("PDF_D：");
const rD = C.parsePageTree(pdfD);
ok("缺 MediaBox：totalPages = 1", rD.totalPages === 1);
ok("缺 MediaBox：widthPt = null", rD.pages[0].widthPt === null);
ok("缺 MediaBox：paperSize = 未知", rD.pages[0].paperSize === "未知");
ok("缺 MediaBox：resources.has = false", rD.pages[0].resources.has === false);
ok("缺 MediaBox：orientation = null", rD.pages[0].orientation === null);

// —— PDF_E：间接 MediaBox 引用（/MediaBox 9 0 R → 数组对象）——
const pdfE = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] >>\nendobj\n" +
  "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox 9 0 R /Rotate 0 >>\nendobj\n" +
  "9 0 obj\n[0 0 612 792]\nendobj\n" +
  "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);
console.log("PDF_E：");
const rE = C.parsePageTree(pdfE);
ok("间接 MediaBox：totalPages = 1", rE.totalPages === 1);
ok("间接 MediaBox 解析为 Letter 612×792", rE.pages[0].widthPt === 612 && rE.pages[0].heightPt === 792 && rE.pages[0].paperSize === "Letter");

// —— PDF_F：无页面树（无 /Root）负例 ——
const pdfF = enc(
  "%PDF-1.7\n" +
  "1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
  "trailer\n<< >>\n%%EOF\n"
);
console.log("PDF_F：");
const rF = C.parsePageTree(pdfF);
ok("无页面树：hasPageTree = false", rF.hasPageTree === false);
ok("无页面树：totalPages = 0", rF.totalPages === 0);
ok("无页面树：toHtml 提示信息", C.toHtml(rF).indexOf("未发现") >= 0);

// —— toMarkdown / toHtml 导出形态 ——
console.log("导出：");
const mdA = C.toMarkdown(rA, { title: "X 页面属性" });
ok("toMarkdown 含文档摘要", mdA.indexOf("文档摘要") >= 0 && mdA.indexOf("总页数") >= 0);
ok("toMarkdown 含纸张分布", mdA.indexOf("纸张分布") >= 0 && mdA.indexOf("A4") >= 0);
ok("toMarkdown 含逐页属性", mdA.indexOf("逐页属性") >= 0 && mdA.indexOf("第 1 页") >= 0);
const htmlA = C.toHtml(rA);
ok("toHtml 含总页数", htmlA.indexOf("总页数") >= 0);
ok("toHtml 含跳页 data-page=1", htmlA.indexOf('data-page="1"') >= 0);
ok("toHtml 含 A4 与 mm 尺寸", htmlA.indexOf("A4") >= 0 && htmlA.indexOf("mm") >= 0);

const mdB = C.toMarkdown(rB, { title: "Y 页面属性" });
ok("toMarkdown(B) 含多尺寸 + Letter/A4", mdB.indexOf("存在多种页面尺寸") >= 0 && mdB.indexOf("Letter") >= 0 && mdB.indexOf("A4") >= 0);

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
