/* 绿角犀 Office · PDF 注释导入（反向读回）测试（纯逻辑，node 直跑）
   验证 importFromRaw：多种原始格式 → 内部 annotation 模型，含别名/坐标/颜色/文本映射与坏数据容错。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-anno.js");
  const Anno = global.OS.PdfAnno;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  // —— 基础原始高亮 [x,y,w,h] ——
  let r = Anno.importFromRaw([{ page: 1, type: "highlight", rect: [0.1, 0.1, 0.4, 0.3] }]);
  ok("导入基础高亮 1 条", r.annotations.length === 1 && r.skipped === 0);
  ok("高亮坐标还原", r.annotations[0].x === 0.1 && r.annotations[0].y === 0.1 && r.annotations[0].w === 0.3 && r.annotations[0].h === 0.2);
  ok("高亮生成 id", typeof r.annotations[0].id === "string" && r.annotations[0].id.length > 0);

  // —— type 别名 underline → highlight ——
  r = Anno.importFromRaw([{ page: 2, type: "underline", rect: [0, 0, 1, 0.1] }]);
  ok("别名 underline→highlight", r.annotations.length === 1 && r.annotations[0].type === "highlight");

  // —— quadPoints 高亮 → bbox ——
  r = Anno.importFromRaw([{ page: 1, type: "highlight", quadPoints: [0.1, 0.5, 0.5, 0.5, 0.1, 0.4, 0.5, 0.4] }]);
  ok("quadPoints 还原 bbox", r.annotations.length === 1 && Math.abs(r.annotations[0].x - 0.1) < 1e-9 && Math.abs(r.annotations[0].w - 0.4) < 1e-9 && Math.abs(r.annotations[0].h - 0.1) < 1e-9);

  // —— 颜色数组 [255,0,0] → #ff0000 ——
  r = Anno.importFromRaw([{ page: 1, type: "rect", rect: [0, 0, 0.2, 0.2], color: [255, 0, 0] }]);
  ok("颜色数组转 hex", r.annotations[0].color === "#ff0000");

  // —— note 文本映射 contents ——
  r = Anno.importFromRaw([{ page: 1, type: "note", rect: [0.3, 0.3, 0.05, 0.05], contents: "批注内容" }]);
  ok("note 文本映射", r.annotations.length === 1 && r.annotations[0].type === "note" && r.annotations[0].text === "批注内容");

  // —— pen points（含 inkList 数组形态）——
  r = Anno.importFromRaw([{ page: 1, type: "Ink", inkList: [[[0, 0], [0.1, 0.2], [0.3, 0.1]]] }]);
  ok("pen inkList 还原", r.annotations.length === 1 && r.annotations[0].type === "pen" && r.annotations[0].points.length === 3);

  // —— checkbox 状态 ——
  r = Anno.importFromRaw([{ page: 1, type: "checkbox", rect: [0.2, 0.2, 0.03, 0.03], checked: true }]);
  ok("checkbox 选中态", r.annotations.length === 1 && r.annotations[0].checked === true);

  // —— 已是内部格式直接接受 ——
  r = Anno.importFromRaw([{ id: "x1", page: 1, type: "highlight", x: 0.1, y: 0.1, w: 0.2, h: 0.1 }]);
  ok("内部格式直收", r.annotations.length === 1 && r.annotations[0].id === "x1");

  // —— JSON 字符串输入 ——
  r = Anno.importFromRaw(JSON.stringify([{ page: 1, type: "highlight", rect: [0.1, 0.1, 0.5, 0.4] }]));
  ok("JSON 字符串输入", r.annotations.length === 1);

  // —— 坏数据容错 ——
  r = Anno.importFromRaw([
    { page: 1, type: "highlight" },                 // 缺坐标 → 跳过
    { page: 1, type: "unknownType", rect: [0, 0, 1, 1] }, // 未知类型 → 跳过
    "garbage",                                      // 非对象 → 跳过
    { page: 1, type: "rect", rect: [0, 0, 0.2, 0.2] }  // 有效
  ]);
  ok("坏数据跳过计数", r.skipped === 3 && r.annotations.length === 1);

  r = Anno.importFromRaw(null);
  ok("非数组输入不崩", r.error && r.annotations.length === 0);

  // —— 批量 + stats 校验 ——
  r = Anno.importFromRaw([
    { page: 1, type: "highlight", rect: [0.1, 0.1, 0.3, 0.2] },
    { page: 1, type: "note", rect: [0.5, 0.5, 0.05, 0.05], contents: "A" },
    { page: 2, type: "rect", rect: [0, 0, 0.2, 0.2] }
  ]);
  const st = Anno.stats(r.annotations);
  ok("批量 stats 总数对", st.total === 3 && st.byPage[1] === 2 && st.byPage[2] === 1);

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
