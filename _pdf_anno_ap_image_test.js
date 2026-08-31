/* 批注导入解析 PDF 内嵌 AP 资源流测试（Q）
   验证：decodeImageXObject（DCTDecode 直通 / FlateDecode→PNG）、
   extractApImage（直接图像 / Form XObject 内嵌图像）、
   resolvePdfAnnotations 端到端（构造最小 PDF → 图章真实图像 + 普通批注坐标归一化）。
   纯逻辑、零依赖、Node 可直接跑。
*/
global.window = global;
global.OS = {};
require("./app/js/pdf-tool.js");
require("./app/js/modules/pdf-anno.js");
const A = OS.PdfAnno;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }
const approx = (a, b) => Math.abs(a - b) < 1e-4;

// 最小 PNG 解码器（仅支持 8bit RGB / filter=0），用于像素级验证
async function decodePng(b64) {
  const bytes = Buffer.from(b64, "base64");
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47)) throw new Error("非 PNG");
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  let pos = 8; const idat = [];
  while (pos < bytes.length) {
    const len = bytes.readUInt32BE(pos); const type = bytes.toString("ascii", pos + 4, pos + 8);
    if (type === "IDAT") idat.push(bytes.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  let total = 0; idat.forEach(d => total += d.length);
  const comp = new Uint8Array(total); let p = 0; idat.forEach(d => { comp.set(d, p); p += d.length; });
  const raw = await OS.PdfTool._inflate(comp);
  const stride = w * 3; const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) { out.set(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride); }
  return { w, h, rgb: out };
}

(async () => {
  // —— 1) decodeImageXObject：DCTDecode 直通（JPEG 不解码，原样封装）——
  const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xAA, 0xBB, 0xFF, 0xD9]);
  const j = await A.decodeImageXObject("/Width 4 /Height 3 /ColorSpace /DeviceRGB /Filter /DCTDecode", jpegBytes);
  ok("DCTDecode 返回 jpeg 格式", j && j.format === "jpeg");
  ok("DCTDecode dataUrl 前缀", j && j.dataUrl.indexOf("data:image/jpeg;base64,") === 0);
  ok("DCTDecode 字节原样保留", j && Buffer.from(j.dataUrl.split(",")[1], "base64").equals(Buffer.from(jpegBytes)));

  // —— 2) extractApImage：直接图像 XObject（DCTDecode）——
  const getDirect = (n) => n === 1
    ? { dict: "/Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /Filter /DCTDecode", stream: jpegBytes, streamStr: "" }
    : null;
  const dImg = await A.extractApImage("/AP << /N 1 0 R >>", getDirect);
  ok("直接图像：解出 jpeg", dImg && dImg.format === "jpeg");

  // —— 3) extractApImage：Form XObject 内嵌图像 ——
  const getForm = (n) => {
    if (n === 1) return { dict: "/Subtype /Form /Resources << /XObject << /Im0 2 0 R >> >>", stream: new Uint8Array(0), streamStr: "q 100 0 0 60 0 0 cm /Im0 Do Q" };
    if (n === 2) return { dict: "/Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /Filter /DCTDecode", stream: jpegBytes, streamStr: "" };
    return null;
  };
  const fImg = await A.extractApImage("/AP << /N 1 0 R >>", getForm);
  ok("Form 内嵌图像：解出 jpeg", fImg && fImg.format === "jpeg");

  // —— 4) 端到端：构造最小 PDF（图章 FlateDecode 图像 + 普通 note）——
  const rgb2x2 = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]); // 2x2 RGB
  const deflated = await OS.PdfTool._deflate(rgb2x2);
  const parts = [];
  const S = (s) => parts.push(Buffer.from(s, "latin1"));
  S("%PDF-1.4\n");
  S("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  S("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  S("3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [4 0 R 9 0 R] >>endobj\n");
  S("4 0 obj<< /Type /Annot /Subtype /Stamp /Rect [100 700 200 760] /AP << /N 5 0 R >> /Contents (Hello Stamp) >>endobj\n");
  S("5 0 obj<< /Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << /XObject << /Im0 6 0 R >> >>\nstream\nq 100 0 0 60 0 0 cm /Im0 Do Q\nendstream\nendobj\n");
  S("6 0 obj<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length " + deflated.length + " >>\nstream\n");
  parts.push(Buffer.from(deflated));
  S("\nendstream\nendobj\n");
  S("9 0 obj<< /Type /Annot /Subtype /Note /Rect [50 50 70 70] /Contents (A note) >>endobj\n");
  S("trailer\n<< /Root 1 0 R >>\n%%EOF\n");
  const pdfBytes = new Uint8Array(Buffer.concat(parts));

  const parsed = OS.PdfTool.parsePdf(pdfBytes);
  ok("parsePdf 找到 1 个页面", parsed.pages.length === 1);
  const res = await A.resolvePdfAnnotations(parsed, (num) => ({ w: 612, h: 792 }));
  ok("解析出 2 个批注（图章 + note）", res.annotations.length === 2);
  const stamp = res.annotations.find(a => a.type === "stamp");
  const note = res.annotations.find(a => a.type === "note");
  ok("图章存在且带 image", !!stamp && typeof stamp.image === "string");
  ok("图章 image 为 PNG dataUrl", !!stamp && stamp.image.indexOf("data:image/png;base64,") === 0);
  if (stamp) {
    const dec = await decodePng(stamp.image.split(",")[1]);
    ok("PNG 尺寸 2x2", dec.w === 2 && dec.h === 2);
    ok("PNG 像素与原始 RGB 一致", dec.rgb.length === rgb2x2.length && dec.rgb.every((v, i) => v === rgb2x2[i]));
    ok("图章文本保留", stamp.text === "Hello Stamp");
  }
  ok("note 坐标归一化 x", note && approx(note.x, 50 / 612));
  ok("note 坐标归一化 y（左下→左上翻转）", note && approx(note.y, (792 - 70) / 792));
  ok("note 文本保留", note && note.text === "A note");

  console.log("\nQ 批注 AP 资源流解析：通过 " + pass + " / " + (pass + fail) + (fail ? "（✗ " + fail + " 失败）" : "，全部通过 ✅"));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
