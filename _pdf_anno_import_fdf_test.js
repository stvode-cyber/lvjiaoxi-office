/* 绿角犀 Office · PDF 注释导入 FDF/XFDF 解析 测试（纯逻辑，node 直跑）
   验证 importFromRaw 上游的 FDF/XFDF 文本解析层：类型映射、坐标提取、页码、
   颜色、内嵌子字典容错、ink 坐标、坏数据跳过，以及解析后归一化(默认 Letter)。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-anno.js");
  const A = global.OS.PdfAnno;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  // —— FDF 样本（含内嵌 /AP 子字典，验证容错）——
  const fdf = `<< /Type /Annot /Subtype /Text /Rect [100 700 140 740] /Contents (Hello note) /C [1 0 0] /P 2 0 R >>
<< /Subtype /Highlight /Rect [50 600 200 620] /Contents (Marked) >>
<< /AP << /N <<>> >> /Subtype /Square /Rect [10 10 100 100] /Page 3 >>
<< /Subtype /Ink /Rect [5 5 35 35] /InkList [[10 10 20 20 30 30]] >>
<< /Subtype /Unknown /Rect [1 1 2 2] >>`;

  const pf = A.parseFdfText(fdf);
  ok("FDF 解析出 4 条有效注释(未知类型跳过)", pf.length === 4);
  ok("FDF Text→note 类型映射", pf[0].type === "note");
  ok("FDF Highlight→highlight 映射", pf[1].type === "highlight");
  ok("FDF Square→rect 映射", pf[2].type === "rect");
  ok("FDF 内嵌 /AP 子字典未被误吞", pf[2].rect && pf[2].rect[0] === 10);
  ok("FDF Ink 提取坐标点", pf[3].type === "pen" && Array.isArray(pf[3].points) && pf[3].points.length === 3);
  ok("FDF /Page 3 解析为页码 3", pf[2].page === 3);
  ok("FDF 颜色数组 [1 0 0] 保留", Array.isArray(pf[0].color) && pf[0].color[0] === 1);
  ok("FDF /Contents 文本提取", pf[0].text === "Hello note");

  // —— importFromFdf 归一化（默认 Letter 612×792）——
  const rf = A.importFromFdf(fdf);
  ok("importFromFdf 返回 4 条", rf.annotations.length === 4);
  ok("importFromFdf 非画笔项坐标已归一化(<1)", rf.annotations.filter(a => a.type !== "pen").every(a => a.x < 1 && a.y < 1 && (a.w == null || a.w < 1) && (a.h == null || a.h < 1)));
  const pen = rf.annotations.find(a => a.type === "pen");
  ok("importFromFdf 画笔点已归一化(<1)", pen && pen.points.every(p => p[0] < 1 && p[1] < 1));
  // Text 在 (100,700)-(140,740)：y 翻转 → y = (792-740)/792 ≈ 0.0657
  const note = rf.annotations[0];
  ok("Text 归一化 y 翻转正确", Math.abs(note.y - (792 - 740) / 792) < 1e-6);
  ok("Text 归一化 x 正确", Math.abs(note.x - 100 / 612) < 1e-6);
  ok("Text 颜色归一化为 #ff0000", note.color === "#ff0000");

  // 自定义页面尺寸（A4 595×842）
  const rfA4 = A.importFromFdf(fdf, { pageWidth: 595, pageHeight: 842 });
  ok("A4 尺寸下 x 重新归一化", Math.abs(rfA4.annotations[0].x - 100 / 595) < 1e-6);

  // —— XFDF 样本 ——
  const xfdf = `<xfdf><annots>
<text page="0"><contents><![CDATA[XD note]]></contents><rect x="50" y="700" width="40" height="40"/><color>1 0 0</color></text>
<highlight page="1"><contents>HL</contents><rect x="10" y="600" width="150" height="20"/></highlight>
</annots></xfdf>`;
  const px = A.parseXfdfText(xfdf);
  ok("XFDF 解析出 2 条", px.length === 2);
  ok("XFDF 类型映射", px[0].type === "note" && px[1].type === "highlight");
  ok("XFDF page 0-based→1-based", px[0].page === 1 && px[1].page === 2);
  ok("XFDF rect=x/y/width/height 解析", px[0].rect[0] === 50 && px[0].rect[2] === 90 && px[0].rect[3] === 740);
  ok("XFDF CDATA 文本提取", px[0].text === "XD note");

  const rx = A.importFromXfdf(xfdf);
  ok("importFromXfdf 返回 2 条且归一化", rx.annotations.length === 2 && rx.annotations.every(a => a.x < 1));
  ok("XFDF 颜色→#ff0000", rx.annotations[0].color === "#ff0000");

  // —— 容错 ——
  ok("空字符串 FDF 返回 error", A.importFromFdf("").error === "未解析到注释");
  ok("无 /Rect 的 FDF 跳过", A.parseFdfText("<< /Subtype /Text >>").length === 0);
  ok("纯 JSON 仍走 importFromRaw(old path)不崩", typeof A.importFromRaw([{type:"note",x:0.1,y:0.1,w:0.1,h:0.1,page:1}]).annotations.length === "number");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
