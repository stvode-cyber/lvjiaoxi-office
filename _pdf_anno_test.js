/* 绿角犀 Office · PDF 批注模型 回归测试（纯逻辑，node 直跑）
   通过桥接 window=global 加载浏览器 IIFE 模块，验证 OS.PdfAnno 数据模型与几何。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-anno.js");
  const Anno = global.OS.PdfAnno;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  ok("OS.PdfAnno 已挂载", !!Anno && typeof Anno.add === "function");
  ok("COLORS 含四类", Anno.COLORS.highlight && Anno.COLORS.pen && Anno.COLORS.note && Anno.COLORS.rect);

  // —— add ——
  const arr = [];
  const h = Anno.add(arr, { page: 1, type: "highlight", x: 0.1, y: 0.1, w: 0.3, h: 0.2 });
  ok("add 高亮返回对象且生成 id", h && typeof h.id === "string" && h.id.length > 0);
  ok("add 高亮落库", arr.length === 1 && arr[0].type === "highlight");
  ok("add 默认颜色取 COLORS", h.color === Anno.COLORS.highlight);

  const n = Anno.add(arr, { page: 1, type: "note", x: 0.5, y: 0.5, text: "批注内容" });
  ok("add 文字批注存 text", n.text === "批注内容");

  const p = Anno.add(arr, { page: 2, type: "pen", points: [[0, 0], [0.1, 0.2], [0.3, 0.1]] });
  ok("add 画笔存点序列", p.points.length === 3);

  const r = Anno.add(arr, { page: 2, type: "rect", x: 0.2, y: 0.2, w: 0.5, h: 0.4, color: "#123456" });
  ok("add 矩形支持自定义颜色", r.color === "#123456");

  // —— remove / update / getById ——
  ok("remove 命中", Anno.remove(arr, h.id) === true);
  ok("remove 后数量 -1", arr.length === 3);
  ok("remove 未命中返回 false", Anno.remove(arr, "nope") === false);
  ok("getById 命中", Anno.getById(arr, n.id).text === "批注内容");
  ok("update 生效", Anno.update(arr, n.id, { text: "改后" }).text === "改后" && Anno.getById(arr, n.id).text === "改后");

  // —— getPage / stats ——
  ok("getPage 按页过滤 page1", Anno.getPage(arr, 1).length === 1);
  ok("getPage 按页过滤 page2", Anno.getPage(arr, 2).length === 2);
  const st = Anno.stats(arr);
  ok("stats.total=3", st.total === 3);
  ok("stats.byPage[2]=2", st.byPage[2] === 2);
  ok("stats.byType.note=1", st.byType.note === 1);
  ok("stats.byType.pen=1", st.byType.pen === 1);
  ok("stats.byType.rect=1", st.byType.rect === 1);

  // —— clearPage ——
  const cleared = Anno.clearPage(arr, 2);
  ok("clearPage 清空第2页", cleared === 2 && Anno.getPage(arr, 2).length === 0);

  // —— 序列化往返 ——
  const arr2 = [];
  Anno.add(arr2, { page: 3, type: "highlight", x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  const json = Anno.toJSON(arr2);
  ok("toJSON 产出合法 JSON 串", typeof json === "string" && JSON.parse(json).length === 1);
  const back = Anno.fromJSON(json);
  ok("fromJSON 往返保真", back.length === 1 && back[0].page === 3 && back[0].type === "highlight");
  ok("fromJSON(null) -> []", Anno.fromJSON(null).length === 0);
  ok("fromJSON(坏串) -> []", Anno.fromJSON("{bad").length === 0);
  ok("fromJSON(已是数组) 透传", Anno.fromJSON([{ id: "x" }]).length === 1);

  // —— 几何 ——
  const nr = Anno.normRect(10, 20, 30, 40, 100, 200);
  ok("normRect 归一化正确", nr.x === 0.1 && nr.y === 0.1 && nr.w === 0.3 && nr.h === 0.2);
  const dr = Anno.denormRect(nr, 100, 200);
  ok("denormRect 反归一化正确", dr.x === 10 && dr.y === 20 && dr.w === 30 && dr.h === 40);
  const bb = Anno.polyBBox([[0, 0], [100, 50], [50, 100]], 200, 200);
  ok("polyBBox 计算包围盒", bb.x === 0 && bb.y === 0 && Math.abs(bb.w - 0.5) < 1e-9 && Math.abs(bb.h - 0.5) < 1e-9);
  ok("polyBBox 空点返回 null", Anno.polyBBox([], 200, 200) === null);

  // —— newId 唯一 ——
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(Anno.newId());
  ok("newId 50 次无重复", ids.size === 50);

  console.log("PDF-ANNO: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
