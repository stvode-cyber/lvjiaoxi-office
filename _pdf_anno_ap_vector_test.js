/* 批注导入解析 PDF 内嵌 AP 矢量外观测试（S）
   验证：pdf-content.js 的 tokenizeContent / parseContentStream（CTM、路径、颜色、CMYK、
   曲线）/ extractApVector（Form XObject 矢量提取），以及 pdf-anno 的 vector 字段
   add/importFromRaw/exportToRaw 闭环 + resolvePdfAnnotations 端到端。
   纯逻辑、零依赖、Node 可直接跑。
*/
global.window = global;
global.OS = {};
require("./app/js/pdf-tool.js");
require("./app/js/modules/pdf-content.js");
require("./app/js/modules/pdf-anno.js");
const A = OS.PdfAnno;
const C = OS.PdfContent;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }
const approx = (a, b) => Math.abs(a - b) < 1e-3;
const near = (a, b) => Math.abs(a - b) <= 1.5; // 颜色取整容差

(async () => {
  // —— 1) tokenizeContent 基础分词 ——
  const toks = C.tokenizeContent("1 0 0 1 10 20 cm /F1 12 Tf (Hi) Tj");
  ok("分词产出操作符 cm/Tf/Tj", toks.some(t => t.t === "op" && t.v === "cm") && toks.some(t => t.t === "op" && t.v === "Tf") && toks.some(t => t.t === "op" && t.v === "Tj"));
  ok("分词产出名字 /F1", toks.some(t => t.t === "name" && t.v === "F1"));
  ok("分词产出字符串 (Hi)", toks.some(t => t.t === "str" && t.v === "Hi"));
  ok("分词产出数字 10/20", toks.some(t => t.t === "num" && t.v === 10) && toks.some(t => t.t === "num" && t.v === 20));

  // —— 2) CTM：平移 + 缩放作用于矩形 ——
  let s = C.parseContentStream("1 0 0 1 10 20 cm 0 0 50 30 re f");
  ok("平移后 1 个 fill 操作", s.ops.length === 1 && s.ops[0].op === "fill");
  ok("矩形经平移 → [10,20,50,30]", s.ops[0].path[0].rect[0] === 10 && s.ops[0].path[0].rect[1] === 20 && s.ops[0].path[0].rect[2] === 50 && s.ops[0].path[0].rect[3] === 30);
  ok("默认填充黑色", s.ops[0].fill[0] === 0 && s.ops[0].fill[1] === 0 && s.ops[0].fill[2] === 0);

  // —— 3) CTM：y 方向缩放 0.5 ——
  s = C.parseContentStream("1 0 0 0.5 0 0 cm 0 0 100 100 re f");
  ok("y 缩放 0.5 → 高度 50", s.ops[0].path[0].rect[3] === 50);

  // —— 4) 路径：move/line/curve ——
  s = C.parseContentStream("0 0 m 10 10 l 20 0 c 5 5 25 5 30 0 f");
  ok("路径含 3 段 (m/l/c)", s.ops[0].path.length === 3);
  ok("首段为 move", s.ops[0].path[0].m != null);
  ok("末段为 curve，含 6 参数", s.ops[0].path[2].c != null && s.ops[0].path[2].c.length === 6);

  // —— 5) 颜色：填充 RGB / 描边 RGB + 线宽 ——
  s = C.parseContentStream("1 0 0 rg 0 0 100 100 re f");
  ok("填充 RGB 红 [255,0,0]", s.ops[0].fill[0] === 255 && s.ops[0].fill[1] === 0 && s.ops[0].fill[2] === 0);
  s = C.parseContentStream("0 0.5 1 RG 5 w 0 0 50 50 re S");
  ok("描边 RGB [0,128,255]", s.ops[0].op === "stroke" && s.ops[0].stroke[0] === 0 && s.ops[0].stroke[1] === 128 && s.ops[0].stroke[2] === 255);
  ok("线宽 5 被记录", s.ops[0].lineWidth === 5);

  // —— 6) CMYK 填充（0,1,1,0 → 红）——
  s = C.parseContentStream("0 1 1 0 k 0 0 100 100 re f");
  ok("CMYK(0,1,1,0) → 近似红", near(s.ops[0].fill[0], 255) && s.ops[0].fill[1] === 0 && s.ops[0].fill[2] === 0);

  // —— 7) extractApVector：Form XObject 矢量内容 → 返回 ops ——
  const getVecForm = (n) => {
    if (n === 1) return { dict: "/Subtype /Form /BBox [0 0 100 60]", stream: new Uint8Array(0), streamStr: "1 0 0 1 0 0 cm 1 0 0 rg 10 10 80 40 re f" };
    return null;
  };
  const vec = A.extractApVector("/AP << /N 1 0 R >>", getVecForm);
  ok("Form 矢量：解出 ops", !!vec && vec.ops.length >= 1);
  ok("Form 矢量：首个为 fill 红", vec && vec.ops[0].op === "fill" && vec.ops[0].fill[0] === 255);
  ok("Form 矢量：bbox 已计算", !!vec && vec.bbox != null);

  // —— 8) extractApVector：仅 Do 图像（无矢量）→ null ——
  const getImgForm = (n) => {
    if (n === 1) return { dict: "/Subtype /Form /BBox [0 0 100 60]", stream: new Uint8Array(0), streamStr: "q 100 0 0 60 0 0 cm /Im0 Do Q" };
    return null;
  };
  const vecImg = A.extractApVector("/AP << /N 1 0 R >>", getImgForm);
  ok("仅图像 Form → null（交回 extractApImage）", vecImg === null);

  // —— 9) 端到端：构造最小 PDF（矢量图章 + note）——
  const parts = [];
  const S = (str) => parts.push(Buffer.from(str, "latin1"));
  S("%PDF-1.4\n");
  S("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  S("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  S("3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [4 0 R 9 0 R] >>endobj\n");
  S("4 0 obj<< /Type /Annot /Subtype /Stamp /Rect [100 700 200 760] /AP << /N 5 0 R >> /Contents (Vec Stamp) >>endobj\n");
  S("5 0 obj<< /Type /XObject /Subtype /Form /BBox [0 0 100 60] >>\nstream\n1 0 0 1 0 0 cm 1 0 0 rg 0 0 90 50 re f\nendstream\nendobj\n");
  S("9 0 obj<< /Type /Annot /Subtype /Note /Rect [50 50 70 70] /Contents (A note) >>endobj\n");
  S("trailer\n<< /Root 1 0 R >>\n%%EOF\n");
  const pdfBytes = new Uint8Array(Buffer.concat(parts));

  const parsed = await OS.PdfTool.parsePdf(pdfBytes);
  ok("端到端 parsePdf 找到 1 页", parsed.pages.length === 1);
  const res = await A.resolvePdfAnnotations(parsed, (num) => ({ w: 612, h: 792 }));
  ok("端到端 解析出 2 个批注", res.annotations.length === 2);
  const stamp = res.annotations.find(a => a.type === "stamp");
  const note = res.annotations.find(a => a.type === "note");
  ok("矢量图章带 vector 字段", !!stamp && Array.isArray(stamp.vector) && stamp.vector.length >= 1);
  ok("矢量图章 vector 首个为 fill 红", stamp && stamp.vector[0].op === "fill" && stamp.vector[0].fill[0] === 255);
  ok("矢量图章无位图 image（区分于 Q）", stamp && stamp.image == null);
  ok("矢量图章文本保留", stamp && stamp.text === "Vec Stamp");
  ok("note 坐标归一化", note && approx(note.x, 50 / 612) && approx(note.y, (792 - 70) / 792));

  // —— 10) vector 字段 round-trip（add → exportToRaw → importFromRaw）——
  const annos = [];
  A.add(annos, { page: 1, type: "stamp", x: 0.1, y: 0.1, w: 0.2, h: 0.1, text: "V",
    vector: [{ op: "fill", path: [{ rect: [0, 0, 10, 10] }], fill: [255, 0, 0], winding: "nonzero" }] });
  const raw = A.exportToRaw(annos);
  const back = A.importFromRaw(raw);
  ok("round-trip：vector 被保留", back.annotations.length === 1 && Array.isArray(back.annotations[0].vector) && back.annotations[0].vector[0].op === "fill");
  ok("round-trip：vector 颜色保留", back.annotations[0].vector[0].fill[0] === 255 && back.annotations[0].vector[0].fill[2] === 0);

  console.log("\nS 批注 AP 矢量外观解析：通过 " + pass + " / " + (pass + fail) + (fail ? "（✗ " + fail + " 失败）" : "，全部通过 ✅"));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
