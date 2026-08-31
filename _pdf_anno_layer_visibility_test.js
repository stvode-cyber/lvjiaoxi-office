/* 批注图层可见性（Y）测试：纯逻辑，零依赖，Node 直跑 */
const Anno = require("./app/js/modules/pdf-anno.js");
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log("  ✗ " + name); } }

const A = [
  { id: "a1", type: "highlight", page: 1, layer: "L1", visible: true },
  { id: "a2", type: "note", page: 1, layer: "L1", visible: true },
  { id: "a3", type: "sign", page: 2, layer: "L2", visible: true },
  { id: "a4", type: "rect", page: 2, layer: "L2", visible: true }
];

// setVisibleForLayer
ok("隐藏整个 L1 返回影响数=2", Anno.setVisibleForLayer(A, "L1", false) === 2);
ok("L1 两条均不可见", A[0].visible === false && A[1].visible === false);
ok("L2 不受影响", A[2].visible === true && A[3].visible === true);
ok("恢复 L1 可见", Anno.setVisibleForLayer(A, "L1", true) === 2 && A[0].visible === true);

// 无 layer 字段默认归为 default
const B = [{ id: "b1", type: "note", page: 1 }];
ok("默认图层名 default", Anno.setVisibleForLayer(B, undefined, false) === 1 && B[0].visible === false);

// 与 groupByLayer / stats 协同：隐藏后 count by visible
const stats = Anno.stats(A);
ok("stats.visibleCount 反映可见数", stats.visibleCount === 4);

// 不存在的图层返回 0
ok("隐藏不存在图层返回 0", Anno.setVisibleForLayer(A, "ZZZ", false) === 0);

console.log(`批注图层可见性（Y）：通过 ${pass} / ${pass + fail}${fail ? "，失败 " + fail : "，全部通过 ✅"}`);
process.exit(fail ? 1 : 0);
