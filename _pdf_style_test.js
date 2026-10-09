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

  /* ---------- G. 段落对齐推断（_pageMargins + _detectParaAlign）---------- */
  {
    // 合成一页 spans：页边距 left=0.1, right=0.9
    // 三段：左对齐 x=0.1 w=0.5；居中 x=0.3 w=0.4；右对齐 x=0.4 w=0.5
    const spans = [
      { text: "Left line",   x: 0.10, y: 0.10, w: 0.50, h: 0.015, fontSize: 12, fontReal: "Helvetica" },
      { text: "Center line", x: 0.30, y: 0.20, w: 0.40, h: 0.015, fontSize: 12, fontReal: "Helvetica" },
      { text: "Right line",  x: 0.40, y: 0.30, w: 0.50, h: 0.015, fontSize: 12, fontReal: "Helvetica" }
    ];
    const m = C._pageMargins(spans);
    ok("G1 页左边距≈0.1", Math.abs(m.left - 0.1) < 0.05);
    ok("G2 页右边距≈0.9", Math.abs(m.right - 0.9) < 0.05);

    // 各段单行 paragraph（用 clusterLines 输出格式带 items）
    const paraL = [{ text: "Left line", x: 0.10, y: 0.10, h: 0.015, items: [spans[0]] }];
    const paraC = [{ text: "Center line", x: 0.30, y: 0.20, h: 0.015, items: [spans[1]] }];
    const paraR = [{ text: "Right line", x: 0.40, y: 0.30, h: 0.015, items: [spans[2]] }];
    ok("G3 左对齐段 → left", C._detectParaAlign(paraL, m.left, m.right) === "left");
    ok("G4 居中段 → center", C._detectParaAlign(paraC, m.left, m.right) === "center");
    ok("G5 右对齐段 → right", C._detectParaAlign(paraR, m.left, m.right) === "right");
  }

  /* ---------- H. pdfToDocxHtml 输出含 text-align ---------- */
  {
    const spans = [
      { text: "Left",   x: 0.10, y: 0.10, w: 0.50, h: 0.015, fontSize: 12, fontReal: "Helvetica" },
      { text: "Center", x: 0.30, y: 0.20, w: 0.40, h: 0.015, fontSize: 12, fontReal: "Helvetica" },
      { text: "Right",  x: 0.40, y: 0.30, w: 0.50, h: 0.015, fontSize: 12, fontReal: "Helvetica" }
    ];
    const html = C.pdfToDocxHtml([spans]);
    ok("H1 HTML 含 text-align:center", html.indexOf("text-align:center") >= 0);
    ok("H2 HTML 含 text-align:right", html.indexOf("text-align:right") >= 0);
    // 左对齐不输出 text-align（默认 left，不污染 style）
    const idxL = html.indexOf(">Left<");
    const idxLStyle = html.lastIndexOf("text-align", idxL);
    // Left 段附近不应有 text-align（容差：往前 50 字符内无 text-align:left）
    ok("H3 左对齐段不输出 text-align:left", !(idxLStyle >= 0 && idxL - idxLStyle < 50));
  }

  /* ---------- I. 表格 cell 内联样式还原（lineItems 保留样式 + lineToCells keepItems + renderLineInline）---------- */
  {
    // 合成两行表格：行 1 表头（红色粗体），行 2 数据（蓝色斜体）
    // 行内 gap 足够大（>gapThresh≈0.024）让 isTableLike 判定为表格，且需 ≥2 行才不跳过
    const spans = [
      { text: "项目", x: 0.10, y: 0.10, w: 0.05, h: 0.015, fontSize: 12, fontReal: "Helvetica-Bold", bold: true, color: "#cc1a1a" },
      { text: "金额", x: 0.50, y: 0.10, w: 0.05, h: 0.015, fontSize: 12, fontReal: "Helvetica-Bold", bold: true, color: "#cc1a1a" },
      { text: "苹果", x: 0.10, y: 0.15, w: 0.05, h: 0.015, fontSize: 12, fontReal: "Helvetica-Oblique", italic: true, color: "#1a66cc" },
      { text: "30",   x: 0.50, y: 0.15, w: 0.05, h: 0.015, fontSize: 12, fontReal: "Helvetica-Oblique", italic: true, color: "#1a66cc" }
    ];
    const html = C.pdfToDocxHtml([spans]);
    ok("I1 HTML 含 <table", html.indexOf("<table") >= 0);
    ok("I2 HTML 含 <td>", html.indexOf("<td>") >= 0);
    ok("I3 表头 cell 含粗体红色 span", html.indexOf("<b><span style=\"font-family:'Helvetica-Bold';font-size:16px;color:#cc1a1a\">项目</span></b>") >= 0);
    ok("I4 数据 cell 含斜体蓝色 span", html.indexOf("<i><span style=\"font-family:'Helvetica-Oblique';font-size:16px;color:#1a66cc\">苹果</span></i>") >= 0);
  }

  /* ---------- J. lineToCells keepItems 兼容（默认 false 返回字符串数组）---------- */
  {
    const items = [
      { text: "A", x: 0.10, y: 0.10, w: 0.05, h: 0.015, fontReal: "F", bold: true, color: "#ff0000" },
      { text: "B", x: 0.50, y: 0.10, w: 0.05, h: 0.015, fontReal: "F", italic: true, color: "#00ff00" }
    ];
    const seps = [0.30];
    // 默认（keepItems 不传）返回字符串数组，向后兼容 Excel 路径
    const cellsStr = C._lineToCells(items, seps);
    ok("J1 默认返回字符串数组", Array.isArray(cellsStr) && cellsStr.length === 2 && typeof cellsStr[0] === "string");
    ok("J2 字符串值正确", cellsStr[0] === "A" && cellsStr[1] === "B");
    // keepItems=true 返回对象数组带 items
    const cellsObj = C._lineToCells(items, seps, true);
    ok("J3 keepItems 返回对象数组", Array.isArray(cellsObj) && cellsObj.length === 2 && typeof cellsObj[0] === "object");
    ok("J4 对象含 text 字段", cellsObj[0].text === "A" && cellsObj[1].text === "B");
    ok("J5 对象含 items 数组", Array.isArray(cellsObj[0].items) && cellsObj[0].items.length === 1);
    ok("J6 items 保留样式字段", cellsObj[0].items[0].bold === true && cellsObj[0].items[0].color === "#ff0000");
  }

  console.log((fail === 0 ? "✓ 全部通过" : "✗ 有失败") + "：通过 " + pass + " / " + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("  ✗ 异常：" + (e && e.message)); process.exit(1); });
