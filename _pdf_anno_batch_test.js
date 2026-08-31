/* 绿角犀 Office · Z 批注批量操作 · 单元测试
 * 纯逻辑：pdf-anno-batch.js（bulkDelete/bulkSetColor/bulkSetLayer/
 * bulkSetVisible/bulkSetAuthor/collectIds/currentScope）
 * 运行：node _pdf_anno_batch_test.js
 */
(function () {
  global.window = global;
  global.OS = global.OS || {};
  require("./app/js/modules/pdf-anno-filter.js"); // 提供 PdfAnnoFilter（currentScope 依赖）
  const B = require("./app/js/modules/pdf-anno-batch.js");

  let pass = 0, fail = 0;
  function ok(name, cond) {
    if (cond) { pass++; console.log("  ✓ " + name); }
    else { fail++; console.log("  ✗ " + name); }
  }
  function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b)); }

  // 构造样本
  const mk = () => [
    { id: "a", type: "highlight", color: "#ff0", layer: "L1", visible: true, text: "苹果" },
    { id: "b", type: "note", color: "#f00", layer: "L1", visible: true, text: "香蕉" },
    { id: "c", type: "highlight", color: "#0f0", layer: "L2", visible: false, text: "橙子 apple" },
    { id: "d", type: "pen", color: "#00f", layer: "L2", visible: true, text: "葡萄" }
  ];

  // 1. collectIds
  eq("collectIds 提取 id", B.collectIds(mk()), ["a", "b", "c", "d"]);

  // 2. bulkDelete（数组）
  {
    const a = mk();
    const n = B.bulkDelete(a, ["a", "c"]);
    ok("bulkDelete 移除数量", n === 2);
    eq("bulkDelete 剩余 id", a.map(x => x.id), ["b", "d"]);
  }

  // 3. bulkDelete（空集合）
  ok("bulkDelete 空 id 集合返回 0", B.bulkDelete(mk(), []) === 0);

  // 4. bulkSetColor
  {
    const a = mk();
    const n = B.bulkSetColor(a, ["a", "b"], "#123456");
    ok("bulkSetColor 命中数", n === 2);
    ok("bulkSetColor 生效", a[0].color === "#123456" && a[1].color === "#123456" && a[2].color === "#0f0");
  }

  // 5. bulkSetLayer
  {
    const a = mk();
    const n = B.bulkSetLayer(a, ["c", "d"], "L9");
    ok("bulkSetLayer 命中数", n === 2);
    ok("bulkSetLayer 生效", a[2].layer === "L9" && a[3].layer === "L9");
  }

  // 6. bulkSetVisible
  {
    const a = mk();
    const n = B.bulkSetVisible(a, ["a", "b", "d"], false);
    ok("bulkSetVisible 命中数", n === 3);
    ok("bulkSetVisible 生效", a[0].visible === false && a[1].visible === false && a[3].visible === false && a[2].visible === false);
  }

  // 7. bulkSetAuthor
  {
    const a = mk();
    const n = B.bulkSetAuthor(a, ["a"], "张三");
    ok("bulkSetAuthor 命中数", n === 1);
    ok("bulkSetAuthor 生效", a[0].author === "张三");
  }

  // 8. toIdSet 兼容 Set 入参
  {
    const a = mk();
    const n = B.bulkSetColor(a, new Set(["a"]), "#abc");
    ok("Set 入参兼容", n === 1 && a[0].color === "#abc");
  }

  // 9. currentScope：全量（无过滤）
  {
    const a = mk();
    const ids = B.currentScope(a, {});
    eq("currentScope 无过滤=全部", ids, ["a", "b", "c", "d"]);
  }

  // 10. currentScope：按 query 文本
  {
    const a = mk();
    const ids = B.currentScope(a, { query: "apple" });
    eq("currentScope query=apple（仅 c 含 apple）", ids, ["c"]);
  }

  // 11. currentScope：按 type
  {
    const a = mk();
    const ids = B.currentScope(a, { type: "highlight" });
    eq("currentScope type=highlight", ids.sort(), ["a", "c"]);
  }

  // 12. currentScope：query + type 组合
  {
    const a = mk();
    const ids = B.currentScope(a, { query: "apple", type: "highlight" });
    eq("currentScope query+type 交集", ids, ["c"]);
  }

  // 13. currentScope 与批量删除闭环：删除筛选结果后数量减少
  {
    const a = mk();
    const ids = B.currentScope(a, { type: "highlight" });
    const n = B.bulkDelete(a, ids);
    ok("批量闭环：删除高亮 2 条", n === 2 && a.length === 2);
    eq("批量闭环：剩余", a.map(x => x.id), ["b", "d"]);
  }

  console.log("\nZ 批注批量操作：通过 " + pass + " / " + (pass + fail) + (fail ? "，失败 " + fail + " ✗" : "，全部通过 ✅"));
  process.exit(fail ? 1 : 0);
})();
