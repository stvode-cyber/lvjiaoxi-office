/* 绿角犀 Office · PDF 真实提取链路端到端测试（node 直跑）
   与纯合成测试的区别：用 pdf-lib 真实生成 PDF → vendor pdf.js 真实解析
   （getTextContent / getOperatorList）→ 走生产归一化代码（_textSpansFromTC /
   _walkImageRects）→ pdfToDocxHtml 断言顺序。
   覆盖：
   A. 真实三栏 PDF：栏序 L→M→R、栏内阅读序、标题在最前
   B. 真实单栏 PDF：行序不颠倒（y-up→y-down 翻转回归 —— 2026-10-09 坑：
      pdf.js transform 是用户空间 y-up，不归一则真实 PDF 全文反序）
   C. Form XObject 嵌套图片：非单位 Matrix 叠加后矩形正确 + 页级图片共存
   D. 真实表格行序：表头在上（y-down 升序回归）
   备注：pdf.js 标准字体 warning 无害；workerSrc 用相对路径（cwd=仓库根）。 */
global.window = global;
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
eval(fs.readFileSync(path.join(ROOT, "app/vendor/pdf.min.js"), "utf8"));
const _plm = { exports: {} };
(new Function("module", "exports", fs.readFileSync(path.join(ROOT, "app/vendor/pdf-lib.min.js"), "utf8")))(_plm, _plm.exports);
const PDFLib = _plm.exports;
require(path.join(ROOT, "app/js/modules/pdf-convert.js"));
const C = global.OS.PdfConvert;
const pdfjs = global.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = "./app/vendor/pdf.worker.min.js";

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

async function extractSpans(bytes) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const pg = await pdf.getPage(1);
  const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  return { spans: C._textSpansFromTC(tc.items, vp.width, vp.height), page: pg, vp };
}

(async () => {
  const { PDFDocument, PDFName, StandardFonts } = PDFLib;

  /* ---------- A. 真实三栏 PDF ---------- */
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("Three Column Paper", { x: 30, y: 770, font: bold, size: 16 });
    for (let i = 1; i <= 10; i++) {
      const y = 765 - i * 25; // L01 最顶 … L10 最底
      const t = (i < 10 ? "0" : "") + i;
      page.drawText("L" + t, { x: 30, y, font, size: 10 });
      page.drawText("M" + t, { x: 230, y, font, size: 10 });
      page.drawText("R" + t, { x: 430, y, font, size: 10 });
    }
    const { spans } = await extractSpans(await doc.save());
    const html = C.pdfToDocxHtml([spans]);
    const iL1 = html.indexOf("L01"), iL10 = html.indexOf("L10");
    const iM1 = html.indexOf("M01"), iM10 = html.indexOf("M10");
    const iR1 = html.indexOf("R01"), iR10 = html.indexOf("R10");
    ok("A1 三栏文本全在", [iL1, iL10, iM1, iM10, iR1, iR10].every(i => i >= 0));
    ok("A2 栏序：栏1全部 → 栏2 → 栏3", iL10 < iM1 && iM10 < iR1);
    ok("A3 栏内阅读序：01 在 10 前（三栏都是）", iL1 < iL10 && iM1 < iM10 && iR1 < iR10);
    const iTitle = html.indexOf("Three Column Paper");
    ok("A4 标题在所有栏文本之前", iTitle >= 0 && iTitle < iL1);
  }

  /* ---------- B. 真实单栏 PDF（y 翻转回归） ---------- */
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 8; i++) {
      page.drawText("P0" + i, { x: 30, y: 765 - i * 25, font, size: 10 });
    }
    const { spans } = await extractSpans(await doc.save());
    const html = C.pdfToDocxHtml([spans]);
    const i1 = html.indexOf("P01"), i8 = html.indexOf("P08");
    ok("B1 单栏行序不颠倒（P01 在 P08 前）", i1 >= 0 && i8 >= 0 && i1 < i8);
    const rows = C.pdfToExcelRows([spans]);
    ok("B2 PDF→Excel 行序同样不颠倒", String(rows[0]).indexOf("P01") >= 0);
  }

  /* ---------- C. Form XObject 嵌套图片（非单位 Matrix）+ 页级图片 ---------- */
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const img = await doc.embedPng(Buffer.from(png1x1, "base64"));
    // 页级图片：cm [100,0,0,50,50,600] → 期望 x=50/600, y=1-650/800, w=100/600, h=50/800
    page.drawImage(img, { x: 50, y: 600, width: 100, height: 50 });
    // Form XObject：Matrix [0.5,0,0,0.5,1,2]，内容 cm 恒等画 Im1
    const formRef = doc.context.register(doc.context.stream("q 1 0 0 1 0 0 cm /Im1 Do Q", {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1],
      Matrix: [0.5, 0, 0, 0.5, 1, 2],
      Resources: { XObject: { Im1: img.ref } }
    }));
    // 页面追加内容：cm [100,0,0,100,50,80] 画 Fm1
    // 右乘合成 CTM = T×FM = [50,0,0,50,150,280] → x=0.25, y=1-330/800, w=50/600, h=50/800
    const extraRef = doc.context.register(doc.context.stream("q 100 0 0 100 50 80 cm /Fm1 Do Q", {}));
    page.node.addContentStream(extraRef);
    const res = page.node.lookup(PDFName.of("Resources"));
    const xo = res.lookup(PDFName.of("XObject"));
    xo.set(PDFName.of("Fm1"), formRef);

    const bytes = await doc.save();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    const pg = await pdf.getPage(1);
    const ops = await pg.getOperatorList();
    const hits = C._walkImageRects(ops.fnArray, ops.argsArray, pdfjs.OPS, 600, 800);
    ok("C1 共提取 2 张图（页级 + 嵌套 form 内）", hits.length === 2);
    const near = (a, b) => Math.abs(a - b) < 1e-3;
    const pageImg = hits.find(h => near(h.x, 50 / 600));
    ok("C2 页级图矩形正确", !!pageImg && near(pageImg.y, 1 - 650 / 800) && near(pageImg.w, 100 / 600) && near(pageImg.h, 50 / 800));
    const formImg = hits.find(h => near(h.x, 0.25));
    ok("C3 嵌套 form 图矩形正确（Matrix 已叠加）", !!formImg && near(formImg.y, 1 - 330 / 800) && near(formImg.w, 50 / 600) && near(formImg.h, 50 / 800));
    ok("C4 y 均为 y-down（顶 0 底 1 范围内）", hits.every(h => h.y >= 0 && h.y <= 1));
  }

  /* ---------- D. 真实表格行序（表头在上） ---------- */
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("H1", { x: 100, y: 700, font, size: 10 });
    page.drawText("H2", { x: 300, y: 700, font, size: 10 });
    page.drawText("c11", { x: 100, y: 680, font, size: 10 });
    page.drawText("c12", { x: 300, y: 680, font, size: 10 });
    const { spans } = await extractSpans(await doc.save());
    const html = C.pdfToDocxHtml([spans]);
    // cell 现在可能包 inline span（font-family/font-size），用 >H1< / >c11< 匹配更鲁棒
    const iH = html.indexOf(">H1<"), iC = html.indexOf(">c11<");
    ok("D1 识别为表格", /<table/.test(html));
    ok("D2 表头行在数据行之前", iH >= 0 && iC >= 0 && iH < iC);
  }

  console.log((fail === 0 ? "✓ 全部通过" : "✗ 有失败") + "：通过 " + pass + " / " + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("  ✗ 异常：" + (e && e.message)); process.exit(1); });
