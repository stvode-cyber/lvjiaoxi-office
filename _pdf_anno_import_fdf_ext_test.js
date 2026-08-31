/* 批注导入扩展测试（FDF/XFDF）：ink 多笔画 + 高亮 quadPoints 精确区 + XFDF 扩展元素 + 容错
 * 运行：node _pdf_anno_import_fdf_ext_test.js
 */
global.window = global;
global.OS = {};
require("./app/js/modules/pdf-anno.js");
const A = global.OS.PdfAnno;
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.002);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("✗ " + name); } }

// 1. FDF ink 双笔画 → 2 笔画
{
  const fdf = `<< /Subtype /Ink /Rect [5 5 95 95] /InkList [[10 10 20 20 30 30][40 40 50 50 60 60]] >>`;
  const r = A.importFromFdf(fdf);
  ok("FDF ink 双笔画数=2", r.annotations.filter(a => a.type === "pen").some(a => a.inkList.length === 2));
}
// 2. FDF ink 单笔画（无内层括号）→ 1 笔画
{
  const fdf = `<< /Subtype /Ink /Rect [1 1 2 2] /InkList [70 70 80 80 90 90] >>`;
  const r = A.importFromFdf(fdf);
  ok("FDF ink 单笔画数=1", r.annotations.filter(a => a.type === "pen").some(a => a.inkList.length === 1));
}
// 3. FDF ink 笔画点归一化正确（第一笔起点 10,10 → /612, (792-10)/792）
{
  const fdf = `<< /Subtype /Ink /Rect [5 5 95 95] /InkList [[10 10 20 20 30 30][40 40 50 50 60 60]] >>`;
  const r = A.importFromFdf(fdf);
  const pen = r.annotations.find(a => a.type === "pen" && a.inkList.length === 2);
  ok("FDF ink 点归一化 x", pen && near(pen.inkList[0][0][0], 10 / 612));
  ok("FDF ink 点归一化 y(翻转)", pen && near(pen.inkList[0][0][1], (792 - 10) / 792));
}
// 4. FDF highlight quadPoints → 8 个数
{
  const fdf = `<< /Subtype /Highlight /Rect [100 700 200 720] /QuadPoints [100 720 200 720 100 700 200 700] /Contents (HL) >>`;
  const r = A.importFromFdf(fdf);
  const hl = r.annotations.find(a => a.type === "highlight");
  ok("FDF hl quadPoints 长度=8", hl && hl.quadPoints && hl.quadPoints.length === 8);
}
// 5. FDF highlight quadPoints 归一化（x=100/612, y=(792-720)/792）
{
  const fdf = `<< /Subtype /Highlight /Rect [100 700 200 720] /QuadPoints [100 720 200 720 100 700 200 700] /Contents (HL) >>`;
  const r = A.importFromFdf(fdf);
  const hl = r.annotations.find(a => a.type === "highlight");
  ok("FDF hl quad x 归一化", hl && near(hl.quadPoints[0], 100 / 612));
  ok("FDF hl quad y 翻转", hl && near(hl.quadPoints[1], (792 - 720) / 792));
}
// 6. XFDF ink 多笔画（<stroke> 子元素）→ 2 笔画
{
  const xfdf = `<xfdf><annots><ink page="0"><inklist><stroke>10 10 20 20 30 30</stroke><stroke>40 40 50 50 60 60</stroke></inklist></ink></annots></xfdf>`;
  const r = A.importFromXfdf(xfdf);
  ok("XFDF ink 双笔画数=2", r.annotations.filter(a => a.type === "pen").some(a => a.inkList.length === 2));
}
// 7. XFDF highlight quadPoints → 8 个数
{
  const xfdf = `<xfdf><annots><highlight page="1"><rect x="100" y="700" width="100" height="20"/><quadpoints>100 720 200 720 100 700 200 700</quadpoints></highlight></annots></xfdf>`;
  const r = A.importFromXfdf(xfdf);
  const hl = r.annotations.find(a => a.type === "highlight");
  ok("XFDF hl quadPoints 长度=8", hl && hl.quadPoints && hl.quadPoints.length === 8);
}
// 8. XFDF ink 单笔画（无 stroke 子元素，整体内容）→ 1 笔画
{
  const xfdf = `<xfdf><annots><ink page="0"><inklist>10 10 20 20 30 30</inklist></ink></annots></xfdf>`;
  const r = A.importFromXfdf(xfdf);
  ok("XFDF ink 单笔画数=1", r.annotations.filter(a => a.type === "pen").some(a => a.inkList.length === 1));
}
// 9. 既有 FDF 回归：text/highlight/square 类型仍解析
{
  const fdf = `<< /Subtype /Text /Rect [100 700 140 740] /Contents (Hello) >>
<< /Subtype /Highlight /Rect [50 600 200 620] /Contents (Mark) >>
<< /Subtype /Square /Rect [10 10 100 100] /Page 3 >>`;
  const r = A.importFromFdf(fdf);
  const types = r.annotations.map(a => a.type);
  ok("FDF 回归 text+highlight+rect", types.indexOf("note") >= 0 && types.indexOf("highlight") >= 0 && types.indexOf("rect") >= 0);
}
// 10. 混合 FDF 多类型计数（2 ink + 1 highlight）
{
  const fdf = `<< /Subtype /Ink /Rect [5 5 95 95] /InkList [[10 10 20 20][30 30 40 40]] >>
<< /Subtype /Ink /Rect [1 1 2 2] /InkList [70 70 80 80] >>
<< /Subtype /Highlight /Rect [100 700 200 720] /QuadPoints [100 720 200 720 100 700 200 700] >>`;
  const r = A.importFromFdf(fdf);
  ok("混合 FDF ink=2 + hl=1", r.annotations.filter(a => a.type === "pen").length === 2 && r.annotations.filter(a => a.type === "highlight").length === 1);
}
// 11. 未知类型跳过（skipped 计数）
{
  const fdf = `<< /Subtype /Unknown /Rect [1 1 2 2] >>
<< /Subtype /Text /Rect [100 700 140 740] /Contents (Keep) >>`;
  const r = A.importFromFdf(fdf);
  ok("未知类型被跳过(仅 text 保留)", r.annotations.length === 1 && r.annotations[0].type === "note");
}
// 12. 容错：坏 InkList 不抛错（缺笔画点数<2 → skipped，不崩）
{
  let threw = false, r;
  try {
    const fdf = `<< /Subtype /Ink /Rect [1 1 2 2] /InkList [10] >>`;
    r = A.importFromFdf(fdf);
  } catch (e) { threw = true; }
  ok("坏 InkList 不抛错", !threw && r && Array.isArray(r.annotations));
}

console.log((fail === 0 ? "✓ 全部通过" : "✗ 有失败") + "：通过 " + pass + " / " + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
