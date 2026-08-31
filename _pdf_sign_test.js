/* 绿角犀 Office · PDF 签名批注 回归测试（纯逻辑，node 直跑）
   验证 OS.PdfAnno 新增 sign（签名印章）类型的模型与几何。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-anno.js");
  const Anno = global.OS.PdfAnno;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  ok("COLORS.sign 墨黑存在", Anno.COLORS.sign === "#1c1b18");

  // —— add sign：笔画 + 放置 ——
  const arr = [];
  const strokes = [[[0, 0], [0.2, 0.5], [0.5, 0.3]], [[0.1, 0.8], [0.6, 0.9]]];
  const s = Anno.add(arr, { page: 1, type: "sign", strokes, x: 0.4, y: 0.6, w: 0.3, h: 0.15 });
  ok("add sign 返回对象且生成 id", s && typeof s.id === "string" && s.id.length > 0);
  ok("add sign 落库", arr.length === 1 && arr[0].type === "sign");
  ok("add sign 保存笔画数组（2 笔）", Array.isArray(s.strokes) && s.strokes.length === 2);
  ok("add sign 保存每笔点序列", s.strokes[0].length === 3 && s.strokes[1].length === 2);
  ok("add sign 保存放置 x/y/w/h", s.x === 0.4 && s.y === 0.6 && s.w === 0.3 && s.h === 0.15);
  ok("add sign 默认颜色取 COLORS.sign", s.color === Anno.COLORS.sign);

  // 自定义墨色
  const s2 = Anno.add(arr, { page: 1, type: "sign", strokes: [[[0, 0], [1, 1]]], x: 0, y: 0, w: 0.2, h: 0.2, color: "#33691e" });
  ok("add sign 支持自定义墨色", s2.color === "#33691e");

  // 空 / 缺失笔画容错
  const sBad = Anno.add(arr, { page: 2, type: "sign" });
  ok("add sign 缺笔画 -> 空数组不崩", Array.isArray(sBad.strokes) && sBad.strokes.length === 0);

  // —— getPage / stats ——
  ok("getPage 包含 sign", Anno.getPage(arr, 1).filter(a => a.type === "sign").length === 2);
  const st = Anno.stats(arr);
  ok("stats.total=3", st.total === 3);
  ok("stats.byType.sign=3", st.byType.sign === 3);
  ok("stats.byType 仍含其他四类", st.byType.highlight === 0 && st.byType.pen === 0 && st.byType.note === 0 && st.byType.rect === 0);

  // —— update / remove ——
  ok("update sign 生效", Anno.update(arr, s.id, { x: 0.1 }).x === 0.1);
  ok("remove sign 命中", Anno.remove(arr, s2.id) === true && Anno.getById(arr, s2.id) === null);

  // —— 序列化往返 ——
  const arr2 = [];
  Anno.add(arr2, { page: 5, type: "sign", strokes: [[[0, 0], [0.5, 0.5]]], x: 0.2, y: 0.3, w: 0.25, h: 0.12 });
  const json = Anno.toJSON(arr2);
  const back = Anno.fromJSON(json);
  ok("sign JSON 往返保真", back.length === 1 && back[0].type === "sign" && back[0].strokes.length === 1 && back[0].strokes[0].length === 2);
  ok("sign fromJSON(坏串) -> []", Anno.fromJSON("{bad").length === 0);

  console.log("PDF-SIGN: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
