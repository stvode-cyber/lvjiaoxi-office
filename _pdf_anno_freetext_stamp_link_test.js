/* O: 批注导入扩展 FreeText / Stamp / Link + 图片盖章反向读回 —— 纯逻辑验证 */
global.window = global; global.OS = {};
require("./app/js/modules/pdf-anno.js");
const A = OS.PdfAnno;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

const dims = () => ({ w: 612, h: 792 });

// 1) add() 直接建模三类
let out = [];
let f = A.add(out, { type: "freetext", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06, text: "自由文本" });
ok("add freetext 建模正确", f && f.type === "freetext" && f.text === "自由文本" && f.x === 0.1 && f.w === 0.3);
out = [];
let s = A.add(out, { type: "stamp", page: 1, x: 0.2, y: 0.2, w: 0.1, h: 0.1, text: "已审批", image: "data:image/png;base64,AAAA" });
ok("add stamp 建模正确（含 image）", s && s.type === "stamp" && s.text === "已审批" && s.image === "data:image/png;base64,AAAA");
out = [];
let l = A.add(out, { type: "link", page: 1, x: 0.05, y: 0.05, w: 0.3, h: 0.04, uri: "https://example.com" });
ok("add link 建模正确（uri）", l && l.type === "link" && l.uri === "https://example.com");

// 2) importFromRaw 归一化（PDF 用户空间 → 0..1，y 翻转）
const r = A.importFromRaw([
  { type: "stamp", rect: [100, 700, 200, 760], page: 1, text: "Approved" },
  { type: "link", rect: [50, 50, 250, 70], page: 1, uri: "https://x.com" },
  { type: "freetext", rect: [10, 600, 210, 640], page: 2, text: "Box" }
], { normalize: true, dims });
ok("importFromRaw 无错误", r.skipped === 0 && r.annotations.length === 3);
const st = r.annotations.find(a => a.type === "stamp");
ok("stamp 坐标归一化 x=100/612", Math.abs(st.x - 100 / 612) < 1e-6);
ok("stamp y 翻转：(792-(700+60))/792", Math.abs(st.y - (792 - 760) / 792) < 1e-6);
ok("stamp 文本保留", st.text === "Approved");
const lk = r.annotations.find(a => a.type === "link");
ok("link uri 保留", lk.uri === "https://x.com");
ok("link 坐标归一化 w=200/612", Math.abs(lk.w - 200 / 612) < 1e-6);
const ft = r.annotations.find(a => a.type === "freetext");
ok("freetext 文本与坐标", ft.text === "Box" && Math.abs(ft.w - 200 / 612) < 1e-6);

// 3) parseFdfText：stamp / link / freetext / 图片盖章
const fdf = [
  "<< /Subtype /Stamp /Rect [100 700 200 760] /Contents (Approved) /T (Bob) >>",
  "<< /Subtype /Link /Rect [50 50 250 70] /A << /S /URI /URI (https://example.com) >> >>",
  "<< /Subtype /FreeText /Rect [10 600 210 640] /Contents (Hello FT) >>",
  "<< /Subtype /Stamp /Rect [10 10 110 110] /IMG (data:image/png;base64,IMGDATA) >>"
].join("\n");
const pf = A.parseFdfText(fdf);
ok("FDF 解析出 4 条", pf.length === 4);
const pfStamp = pf.find(x => x.type === "stamp");
ok("FDF stamp 类型映射正确", pfStamp && pfStamp.type === "stamp" && pfStamp.text === "Approved");
const pfLink = pf.find(x => x.type === "link");
ok("FDF link 捕获 URI", pfLink && pfLink.uri === "https://example.com");
const pfFt = pf.find(x => x.type === "freetext");
ok("FDF freetext 类型映射正确", pfFt && pfFt.type === "freetext");
const pfImg = pf.find(x => x.image);
ok("FDF 图片盖章反向读回 image", pfImg && pfImg.image === "data:image/png;base64,IMGDATA");

// 4) parseXfdfText：link(href) / stamp(image) / freetext
const xfdf = [
  '<link page="0" href="https://x.com"><rect x="10" y="10" width="100" height="20"/></link>',
  '<stamp page="0"><rect x="10" y="10" width="50" height="50"/><contents>Seal</contents><image>data:image/png;base64,SEAL</image></stamp>',
  '<freetext page="0"><rect x="10" y="10" width="200" height="40"/><contents>Note box</contents></freetext>'
].join("\n");
const px = A.parseXfdfText(xfdf);
ok("XFDF 解析出 3 条", px.length === 3);
const pxLink = px.find(x => x.type === "link");
ok("XFDF link 捕获 href（且 page 0→1）", pxLink && pxLink.uri === "https://x.com" && pxLink.page === 1);
const pxStamp = px.find(x => x.type === "stamp");
ok("XFDF stamp 文本 + 图片读回", pxStamp && pxStamp.text === "Seal" && pxStamp.image === "data:image/png;base64,SEAL");
const pxFt = px.find(x => x.type === "freetext");
ok("XFDF freetext 文本", pxFt && pxFt.text === "Note box");

// 5) 回归：未知类型 / 缺坐标 仍跳过不阻塞
const bad = A.importFromRaw([
  { type: "frobnicate", rect: [0, 0, 1, 1] },
  { type: "stamp" } // 缺坐标
], { normalize: true, dims });
ok("未知类型/缺坐标被跳过（skipped=2, annotations=0）", bad.skipped === 2 && bad.annotations.length === 0);

console.log("\nO 测试：" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
