/* 绿角犀 Office · PDF 字体/样式还原端到端测试（node 直跑）
   验证：真实 PDF（pdf-lib 生成带粗体/斜体/彩色文本）→ pdf.js 解析 →
   _textSpansFromTC（带 fontMap + colorRuns）→ pdfToDocxHtml → 断言 inline
   span + style + <b>/<i> 已还原。
   覆盖：
   A. _textSpansFromTC 扩展字段：fontReal / bold / italic / color / fontSize
   B. _colorRunsFromOps：合成 ops 数组走查颜色状态机
   C. 端到端：pdfToDocxHtml 输出含 font-family/color/font-size/<b>/<i>
   备注：pdf.js 标准字体 warning 无害；workerSrc 用绝对路径（cwd=仓库根）。 */
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
pdfjs.GlobalWorkerOptions.workerSrc = path.join(ROOT, "app/vendor/pdf.worker.min.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

// 从 page.commonObjs 异步取每个 fontName 的 {name, bold, italic} —— 复刻 pdf.js extractFontMap 逻辑
function extractFontMap(page, items) {
  return new Promise((resolve) => {
    if (!page || !page.commonObjs || !Array.isArray(items)) return resolve(null);
    const fids = new Set();
    for (const it of items) if (it && it.fontName) fids.add(it.fontName);
    if (!fids.size) return resolve(null);
    const map = {};
    let pending = fids.size;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(map); } };
    const timer = setTimeout(finish, 5000);
    for (const fid of fids) {
      try {
        const v = page.commonObjs.get(fid, (d) => {
          if (d && (d.name || d.bold || d.italic)) map[fid] = { name: d.name, bold: d.bold, italic: d.italic };
          if (--pending === 0) { clearTimeout(timer); finish(); }
        });
        if (v) {
          if (v.name || v.bold || v.italic) map[fid] = { name: v.name, bold: v.bold, italic: v.italic };
          if (--pending === 0) { clearTimeout(timer); finish(); }
        }
      } catch (e) { if (--pending === 0) { clearTimeout(timer); finish(); } }
    }
  });
}

(async () => {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const OPS = pdfjs.OPS;

  /* ---------- B. _colorRunsFromOps 单元测（合成 ops）---------- */
  {
    // 模拟：setFillRGBColor(204,26,26) → showText → setFillRGBColor(0,0,0) → showText
    const fnArray = [OPS.setFillRGBColor, OPS.showText, OPS.setFillRGBColor, OPS.showText];
    const argsArray = [
      [204, 26, 26], ["run1"], [0, 0, 0], ["run2"]
    ];
    const runs = C._colorRunsFromOps(fnArray, argsArray, OPS);
    ok("B1 colorRuns 数量 = 2", runs.length === 2);
    ok("B2 run1 颜色 = #cc1a1a", runs[0] && runs[0].color === "#cc1a1a");
    ok("B3 run2 颜色 = #000000", runs[1] && runs[1].color === "#000000");
  }

  /* ---------- B2. setFillGray + CMYK 覆盖 ---------- */
  {
    const fnArray = [OPS.setFillGray, OPS.showText, OPS.setFillCMYKColor, OPS.showText];
    const argsArray = [
      [128], ["g"], [0.5, 0.4, 0.3, 0.2], ["c"]
    ];
    const runs = C._colorRunsFromOps(fnArray, argsArray, OPS);
    ok("B4 灰度 → #808080", runs[0] && runs[0].color === "#808080");
    // CMYK(0.5,0.4,0.3,0.2) → R=255×(1-0.5)×(1-0.2)=102, G=255×(1-0.4)×(1-0.2)=122, B=255×(1-0.3)×(1-0.2)=143
    ok("B5 CMYK → #667a8f", runs[1] && runs[1].color === "#667a8f");
  }

  /* ---------- B3. colorRuns 数量与 textContent items 数不匹配时降级 ---------- */
  {
    // 只构造 1 个 colorRun，但下游会过滤空 str 后传入多个 items
    const fnArray = [OPS.setFillRGBColor, OPS.showText];
    const argsArray = [[10, 20, 30], ["only"]];
    const runs = C._colorRunsFromOps(fnArray, argsArray, OPS);
    // 仅校验 colorRuns 本身正确，降级逻辑在 _textSpansFromTC
    ok("B6 单条 colorRuns 正确", runs.length === 1 && runs[0].color === "#0a141e");
  }

  /* ---------- A+C. 真实 PDF 端到端 ---------- */
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const obli = await doc.embedFont(StandardFonts.HelveticaOblique);
    // 三段：普通黑 12pt、粗体红 18pt、斜体蓝 10pt
    page.drawText("Normal plain", { x: 30, y: 770, font: helv, size: 12, color: rgb(0, 0, 0) });
    page.drawText("Bold title", { x: 30, y: 740, font: bold, size: 14, color: rgb(0.8, 0.1, 0.1) });
    page.drawText("Italic body", { x: 30, y: 710, font: obli, size: 10, color: rgb(0.1, 0.4, 0.8) });

    const bytes = await doc.save();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    const pg = await pdf.getPage(1);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    const opList = await pg.getOperatorList();

    const colorRuns = C._colorRunsFromOps(opList.fnArray, opList.argsArray, OPS);
    const fontMap = await extractFontMap(pg, tc.items);
    const spans = C._textSpansFromTC(tc.items, vp.width, vp.height, fontMap, colorRuns);

    // A. 字段断言
    const normal = spans.find(s => /Normal/.test(s.text));
    const boldSpan = spans.find(s => /Bold/.test(s.text));
    const italicSpan = spans.find(s => /Italic/.test(s.text));
    ok("A1 普通段 fontReal=Helvetica", normal && normal.fontReal === "Helvetica");
    ok("A2 粗体段 fontReal=Helvetica-Bold", boldSpan && boldSpan.fontReal === "Helvetica-Bold");
    ok("A3 斜体段 fontReal=Helvetica-Oblique", italicSpan && italicSpan.fontReal === "Helvetica-Oblique");
    ok("A4 粗体段 bold=true", boldSpan && boldSpan.bold === true);
    ok("A5 斜体段 italic=true", italicSpan && italicSpan.italic === true);
    ok("A6 粗体段 color=#cc1a1a", boldSpan && boldSpan.color === "#cc1a1a");
    ok("A7 斜体段 color=#1a66cc", italicSpan && italicSpan.color === "#1a66cc");
    ok("A8 普通段字号 12pt", normal && normal.fontSize === 12);
    ok("A9 粗体段字号 14pt", boldSpan && boldSpan.fontSize === 14);

    // C. pdfToDocxHtml 输出断言
    const html = C.pdfToDocxHtml([spans]);
    // 验证 inline span 含 font-family/color/font-size
    ok("C1 HTML 含 font-family:'Helvetica-Bold'", html.indexOf("font-family:'Helvetica-Bold'") >= 0);
    ok("C2 HTML 含 font-family:'Helvetica-Oblique'", html.indexOf("font-family:'Helvetica-Oblique'") >= 0);
    ok("C3 HTML 含 color:#cc1a1a", html.indexOf("color:#cc1a1a") >= 0);
    ok("C4 HTML 含 color:#1a66cc", html.indexOf("color:#1a66cc") >= 0);
    // 粗体 14pt → 14×96/72=18.67→round=19px
    ok("C5 HTML 含 font-size:19px（粗体段）", html.indexOf("font-size:19px") >= 0);
    // 斜体 10pt → 10×96/72=13.33→round=13px
    ok("C6 HTML 含 font-size:13px（斜体段）", html.indexOf("font-size:13px") >= 0);
    // 粗体用 <b> 包裹
    ok("C7 HTML 含 <b> 标签", html.indexOf("<b>") >= 0);
    // 斜体用 <i> 包裹
    ok("C8 HTML 含 <i> 标签", html.indexOf("<i>") >= 0);
    // 普通 12pt → 16px
    ok("C9 HTML 含 font-size:16px（普通段）", html.indexOf("font-size:16px") >= 0);
  }

  /* ---------- D. 颜色配对降级：colorRuns 数 != items 数 → color=null ---------- */
  {
    // 故意给空 colorRuns，触发降级
    const items = [
      { str: "hello", transform: [10, 0, 0, 10, 30, 770], width: 50, fontName: "f1" }
    ];
    const spans = C._textSpansFromTC(items, 600, 800, { f1: { name: "X", bold: false, italic: false } }, []);
    ok("D1 colorRuns 不匹配 → color=null", spans[0] && spans[0].color === null);
    ok("D2 仍保留 fontReal", spans[0] && spans[0].fontReal === "X");
    ok("D3 仍保留 fontSize", spans[0] && spans[0].fontSize === 10);
  }

  /* ---------- F. 合成 spans 直接测 pdfToDocxHtml（绕开 PDF 链路）---------- */
  {
    const spans = [
      { text: "Normal", x: 0.05, y: 0.05, w: 0.1, h: 0.015, fontSize: 12, fontReal: "Helvetica", bold: false, italic: false, color: "#000000" },
      { text: "Bold",   x: 0.05, y: 0.10, w: 0.05, h: 0.0175, fontSize: 14, fontReal: "Helvetica-Bold", bold: true, italic: false, color: "#cc1a1a" },
      { text: "Italic", x: 0.05, y: 0.15, w: 0.05, h: 0.0125, fontSize: 10, fontReal: "Helvetica-Oblique", bold: false, italic: true, color: "#1a66cc" }
    ];
    const html = C.pdfToDocxHtml([spans]);
    ok("F1 HTML 含 font-family:'Helvetica'", html.indexOf("font-family:'Helvetica'") >= 0);
    ok("F2 HTML 含 font-family:'Helvetica-Bold'", html.indexOf("font-family:'Helvetica-Bold'") >= 0);
    ok("F3 HTML 含 color:#cc1a1a", html.indexOf("color:#cc1a1a") >= 0);
    ok("F4 HTML 含 <b>", html.indexOf("<b>") >= 0);
    ok("F5 HTML 含 <i>", html.indexOf("<i>") >= 0);
  }

  /* ---------- E. 兼容旧调用：不传 fontMap/colorRuns 时仍工作 ---------- */
  {
    const items = [{ str: "legacy", transform: [10, 0, 0, 10, 30, 770], width: 50, fontName: "f1" }];
    const spans = C._textSpansFromTC(items, 600, 800);
    ok("E1 旧调用：fontReal=null", spans[0] && spans[0].fontReal === null);
    ok("E2 旧调用：bold=false", spans[0] && spans[0].bold === false);
    ok("E3 旧调用：color=null", spans[0] && spans[0].color === null);
    ok("E4 旧调用：fontSize 保留", spans[0] && spans[0].fontSize === 10);
  }

  console.log((fail === 0 ? "✓ 全部通过" : "✗ 有失败") + "：通过 " + pass + " / " + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("  ✗ 异常：" + (e && e.message)); process.exit(1); });
