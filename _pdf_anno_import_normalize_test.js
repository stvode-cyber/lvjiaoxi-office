/* 绿角犀 Office · PDF 注释导入坐标归一化测试（纯逻辑，node 直跑）
   验证 importFromRaw 的 opts.normalize + opts.dims：外部 PDF 点空间坐标 → 内部 0..1 归一化（y 翻转）。
   同时确认「无 opts 时保持原行为」，不破坏既有测试。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-anno.js");
  const Anno = global.OS.PdfAnno;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }
  function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

  // 模拟一页 PDF 的点尺寸（Letter 横向近似）
  const DIMS = { 1: { w: 612, h: 792 }, 2: { w: 612, h: 792 } };
  const dimsOf = p => DIMS[p];

  // —— 1. PDF 点空间 rect → 归一化（y 翻转）——
  // rect [x1,y1,x2,y2] = [72,720,200,760]，原点左下
  let r = Anno.importFromRaw(
    [{ page: 1, type: "highlight", rect: [72, 720, 200, 760] }],
    { normalize: true, dims: dimsOf }
  );
  ok("归一化后得 1 条", r.annotations.length === 1 && r.skipped === 0);
  const a = r.annotations[0];
  ok("x 归一化 = 72/612", near(a.x, 72 / 612));
  ok("y 翻转归一化 = (792-(720+40))/792", near(a.y, (792 - 760) / 792));
  ok("w 归一化 = 128/612", near(a.w, 128 / 612));
  ok("h 归一化 = 40/792", near(a.h, 40 / 792));
  ok("坐标均 <= 1（归一化成功）", a.x <= 1 && a.y <= 1 && a.w <= 1 && a.h <= 1);

  // —— 2. 无 opts 时不做归一化（保持原始点空间，向后兼容）——
  r = Anno.importFromRaw([{ page: 1, type: "highlight", rect: [72, 720, 200, 760] }]);
  ok("无 opts 保留原始坐标 x=72", r.annotations[0].x === 72);
  ok("无 opts 保留原始坐标 y=720", r.annotations[0].y === 720);

  // —— 3. 已是归一化坐标（<=1）+ normalize opts → 不变 ——
  r = Anno.importFromRaw(
    [{ page: 1, type: "highlight", rect: [0.1, 0.1, 0.4, 0.3] }],
    { normalize: true, dims: dimsOf }
  );
  ok("已归一化坐标不被二次缩放 x=0.1", near(r.annotations[0].x, 0.1));
  ok("已归一化坐标不被二次缩放 y=0.1", near(r.annotations[0].y, 0.1));

  // —— 4. note 文本批注：PDF 点空间 + 文本映射 + 归一化 ——
  r = Anno.importFromRaw(
    [{ page: 1, type: "text", rect: [50, 700, 150, 740], contents: "审阅意见" }],
    { normalize: true, dims: dimsOf }
  );
  ok("note 别名 + 文本保留", r.annotations[0].type === "note" && r.annotations[0].text === "审阅意见");
  ok("note 坐标归一化(x/y)", near(r.annotations[0].x, 50 / 612) && near(r.annotations[0].y, (792 - 740) / 792));

  // —— 5. pen 画笔点序列：归一化 + y 翻转 ——
  r = Anno.importFromRaw(
    [{ page: 2, type: "Ink", inkList: [[[0, 0], [612, 792]]] }],
    { normalize: true, dims: dimsOf }
  );
  const pts = r.annotations[0].points;
  ok("pen 点1 归一化 [0,1]", near(pts[0][0], 0) && near(pts[0][1], 1));
  ok("pen 点2 归一化 [1,0]", near(pts[1][0], 1) && near(pts[1][1], 0));

  // —— 6. 缺 dims 时：坐标 >1 不强制归一化（best-effort，不崩）——
  r = Anno.importFromRaw(
    [{ page: 9, type: "highlight", rect: [72, 720, 200, 760] }],
    { normalize: true, dims: p => DIMS[p] } // page 9 无尺寸
  );
  ok("缺页尺寸时不崩、保留原始坐标", r.annotations.length === 1 && r.annotations[0].x === 72);

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
