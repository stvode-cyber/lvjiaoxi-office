/* 批注导出 JSON 一键 round-trip 闭环测试
   验证：add(多类型) → exportToRaw / exportJSON → importFromRaw → 结构与坐标无损
   纯逻辑、零依赖、Node 可直接跑。
*/
global.window = global;
global.OS = {};
require("./app/js/modules/pdf-anno.js");
const A = OS.PdfAnno;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

// 构造一组覆盖全部类型的内部批注
const annos = [];
A.add(annos, { page: 1, type: "highlight", x: 0.1, y: 0.2, w: 0.5, h: 0.05, quadPoints: [0.1,0.25,0.6,0.25,0.1,0.2,0.6,0.2] });
A.add(annos, { page: 1, type: "pen", inkList: [[[0.1,0.1],[0.2,0.3],[0.4,0.2]],[[0.5,0.5],[0.6,0.6]]] });
A.add(annos, { page: 2, type: "note", x: 0.3, y: 0.4, text: "备注文本" });
A.add(annos, { page: 2, type: "rect", x: 0.2, y: 0.2, w: 0.3, h: 0.3, color: "#66bb6a" });
A.add(annos, { page: 3, type: "sign", x: 0.1, y: 0.1, w: 0.2, h: 0.1, strokes: [[[0.0,0.0],[0.5,1.0]],[[1.0,0.0],[0.5,1.0]]] });
A.add(annos, { page: 3, type: "textfield", x: 0.4, y: 0.4, w: 0.2, h: 0.05, text: "表单值" });
A.add(annos, { page: 3, type: "checkbox", x: 0.7, y: 0.7, w: 0.02, h: 0.02, checked: true });
A.add(annos, { page: 4, type: "freetext", x: 0.1, y: 0.1, w: 0.4, h: 0.08, text: "自由文本" });
A.add(annos, { page: 4, type: "stamp", x: 0.5, y: 0.5, w: 0.2, h: 0.2, text: "SEAL", image: "data:image/png;base64,AAAA" });
A.add(annos, { page: 4, type: "link", x: 0.1, y: 0.8, w: 0.2, h: 0.04, uri: "https://example.com" });

// 1) exportToRaw 数量与类型一致
const raw = A.exportToRaw(annos);
ok("导出数量一致 (10)", raw.length === 10);
ok("导出类型集合完整", raw.every((r,i) => r.type === annos[i].type));

// 2) exportJSON 可被 JSON 解析且等价
const json = A.exportJSON(annos);
ok("exportJSON 可被解析", (() => { try { return Array.isArray(JSON.parse(json)); } catch(e){ return false; } })());

// 3) round-trip：exportToRaw → importFromRaw → 结构/坐标无损
const rt = A.importFromRaw(raw, {}).annotations;
ok("round-trip 数量一致 (10)", rt.length === 10);

function cmpType(i, extra) {
  const o = annos[i], r = rt[i];
  ok("RT#" + i + " type", r.type === o.type);
  ok("RT#" + i + " page", r.page === o.page);
  ok("RT#" + i + " id 保留", r.id === o.id);
  if (extra) extra(o, r);
}
cmpType(0, (o,r) => {
  ok("HL x", approx(r.x,o.x) && approx(r.y,o.y) && approx(r.w,o.w) && approx(r.h,o.h));
  ok("HL quadPoints", JSON.stringify(r.quadPoints) === JSON.stringify(o.quadPoints.map(n=>Math.round(n*1e6)/1e6)));
});
cmpType(1, (o,r) => {
  ok("PEN inkList 笔画数", r.inkList.length === o.inkList.length);
  ok("PEN 首笔点相等", JSON.stringify(r.inkList[0]) === JSON.stringify(o.inkList[0]));
  ok("PEN points 派生", r.points.length === o.inkList[0].length + o.inkList[1].length);
});
cmpType(2, (o,r) => { ok("NOTE text", r.text === o.text && approx(r.x,o.x) && approx(r.y,o.y)); });
cmpType(3, (o,r) => { ok("RECT color+rect", r.color === o.color && approx(r.x,o.x) && approx(r.w,o.w)); });
cmpType(4, (o,r) => {
  ok("SIGN rect+strokes", approx(r.x,o.x) && approx(r.w,o.w) && r.strokes.length === o.strokes.length && JSON.stringify(r.strokes[0]) === JSON.stringify(o.strokes[0]));
});
cmpType(5, (o,r) => { ok("TF text+rect", r.text === o.text && approx(r.x,o.x) && approx(r.w,o.w)); });
cmpType(6, (o,r) => { ok("CB checked+rect", r.checked === true && approx(r.x,o.x) && approx(r.w,o.w)); });
cmpType(7, (o,r) => { ok("FT text", r.text === o.text && approx(r.w,o.w)); });
cmpType(8, (o,r) => { ok("STAMP image+text", r.image === o.image && r.text === o.text && approx(r.w,o.w)); });
cmpType(9, (o,r) => { ok("LINK uri", r.uri === o.uri && approx(r.w,o.w)); });

// 4) 二次导出一致性（导出->导入->导出 应与首次导出等价）
const raw2 = A.exportToRaw(rt);
ok("二次导出与首次导出 JSON 等价", JSON.stringify(raw2) === JSON.stringify(raw));

// 5) 空输入安全
ok("空数组导出安全", Array.isArray(A.exportToRaw(null)) && A.exportToRaw(null).length === 0);
ok("空数组导入安全", A.importFromRaw(A.exportToRaw([]), {}).annotations.length === 0);

console.log("\nP 批注导出 round-trip：通过 " + pass + " / " + (pass + fail) + (fail ? "（✗ " + fail + " 失败）" : "，全部通过 ✅"));
process.exit(fail ? 1 : 0);
