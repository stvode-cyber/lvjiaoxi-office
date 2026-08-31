/* 批注搜索与过滤（V）测试：纯逻辑，零依赖，Node 直跑 */
const F = require("./app/js/modules/pdf-anno-filter.js");
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }

// —— 构造样本批注 ——
const A = [
  { id: "a1", type: "highlight", page: 1, text: "重要条款", author: "张三", layer: "L1", visible: true },
  { id: "a2", type: "note", page: 1, text: "待确认", author: "李四", layer: "L1", visible: true },
  { id: "a3", type: "sign", page: 2, text: "", author: "王五", layer: "L2", visible: false },
  { id: "a4", type: "link", page: 3, uri: "https://example.com", author: "", layer: "L2", visible: true },
  { id: "a5", type: "highlight", page: 2, text: "Important clause", author: "Bob", layer: "L1", visible: true }
];

// matchAnnotation
ok("空串命中全部", F.matchAnnotation(A[0], "") === true);
ok("空白串命中全部", F.matchAnnotation(A[0], "   ") === true);
ok("子串命中 text", F.matchAnnotation(A[0], "条款") === true);
ok("作者命中", F.matchAnnotation(A[1], "李四") === true);
ok("英文不敏感", F.matchAnnotation(A[4], "important") === true);
ok("未命中返回 false", F.matchAnnotation(A[0], "不存在的词zzz") === false);

// searchAnnotations
ok("空查询返回全部副本", F.searchAnnotations(A, "").length === 5);
ok("文本搜索命中数", F.searchAnnotations(A, "条款").length === 1);
ok("作者搜索命中数", F.searchAnnotations(A, "王五").length === 1);
ok("uri 搜索命中", F.searchAnnotations(A, "example.com").length === 1);
ok("非法输入返回空数组", Array.isArray(F.searchAnnotations(null, "x")) && F.searchAnnotations(null, "x").length === 0);
ok("搜索不改原数组", (function () { const before = A.length; F.searchAnnotations(A, "条款"); return A.length === before; })());

// filterAnnotations
ok("按类型过滤", F.filterAnnotations(A, { types: ["highlight"] }).length === 2);
ok("按图层过滤", F.filterAnnotations(A, { layers: ["L2"] }).length === 2);
ok("按页码过滤", F.filterAnnotations(A, { pages: [2] }).length === 2);
ok("按可见性过滤(false)", F.filterAnnotations(A, { visible: false }).length === 1);
ok("按可见性过滤(true)", F.filterAnnotations(A, { visible: true }).length === 4);
ok("复合过滤 types+pages", F.filterAnnotations(A, { types: ["highlight"], pages: [2] }).length === 1);
ok("复合过滤 query+types", F.filterAnnotations(A, { query: "clause", types: ["highlight"] }).length === 1);
ok("layers 排除无 layer 项", F.filterAnnotations(A.concat([{ id: "x", type: "note", page: 1 }]), { layers: ["L1"] }).length === 3);

// countByType
const cnt = F.countByType(A);
ok("countByType 计数高亮", cnt.highlight === 2);
ok("countByType 计数签名", cnt.sign === 1);
ok("countByType 非法返回空", Object.keys(F.countByType(null)).length === 0);

console.log(`批注搜索与过滤（V）：通过 ${pass} / ${pass + fail}${fail ? "，失败 " + fail : "，全部通过 ✅"}`);
process.exit(fail ? 1 : 0);
