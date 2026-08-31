/* 页码范围选择测试（R·Presentation 部分）
   验证：OS.SvgRaster.pageRange 将 1-based 含端点范围夹紧为 0-based 含端点。
   纯逻辑、零依赖、Node 可直接跑。
*/
global.window = global;
global.OS = {};
require("./app/js/modules/svg-raster.js");
const SR = OS.SvgRaster;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }

ok("total=10 全选 [0,9]", JSON.stringify(SR.pageRange(10)) === JSON.stringify([0, 9]));
ok("startPage=3 → [2,9]", JSON.stringify(SR.pageRange(10, { startPage: 3 })) === JSON.stringify([2, 9]));
ok("endPage=5 → [0,4]", JSON.stringify(SR.pageRange(10, { endPage: 5 })) === JSON.stringify([0, 4]));
ok("start=3 end=5 → [2,4]", JSON.stringify(SR.pageRange(10, { startPage: 3, endPage: 5 })) === JSON.stringify([2, 4]));
ok("start=8 end=3 翻转夹紧 → [7,7]", JSON.stringify(SR.pageRange(10, { startPage: 8, endPage: 3 })) === JSON.stringify([7, 7]));
ok("start=100 越界夹紧 → [9,9]", JSON.stringify(SR.pageRange(10, { startPage: 100 })) === JSON.stringify([9, 9]));
ok("单页 5 → [4,4]", JSON.stringify(SR.pageRange(10, { startPage: 5, endPage: 5 })) === JSON.stringify([4, 4]));
ok("total=1 全选 [0,0]", JSON.stringify(SR.pageRange(1)) === JSON.stringify([0, 0]));

console.log("\nR 页码范围：通过 " + pass + " / " + (pass + fail) + (fail ? "（✗ " + fail + " 失败）" : "，全部通过 ✅"));
process.exit(fail ? 1 : 0);
