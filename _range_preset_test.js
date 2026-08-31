/* PDF 导出范围预设测试（U）
   验证：range-preset.js 的 parsePageList / resolvePreset / resolvePagePreset /
   resolveSheetPreset / createStore。
   纯逻辑、零依赖、Node 可直接跑。
*/
const RP = require("./app/js/modules/range-preset.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {
  // 1) parsePageList：区间 + 单页
  ok("parsePageList 1,3-5,8", eqArr(RP.parsePageList("1,3-5,8", 20), [1, 3, 4, 5, 8]));
  // 2) parsePageList：all
  ok("parsePageList all", eqArr(RP.parsePageList("all", 5), [1, 2, 3, 4, 5]));
  // 3) parsePageList：越界裁剪
  ok("parsePageList 越界裁剪 1-10/总4", eqArr(RP.parsePageList("1-10", 4), [1, 2, 3, 4]));
  // 4) parsePageList：去重 + 排序
  ok("parsePageList 去重排序 5,3,3-4", eqArr(RP.parsePageList("5,3,3-4", 20), [3, 4, 5]));

  // 5) resolvePreset：odd
  ok("resolvePreset odd 总6", eqArr(RP.resolvePreset("odd", { total: 6 }), [1, 3, 5]));
  // 6) resolvePreset：even
  ok("resolvePreset even 总6", eqArr(RP.resolvePreset("even", { total: 6 }), [2, 4, 6]));
  // 7) resolvePreset：current
  ok("resolvePreset current", eqArr(RP.resolvePreset("current", { total: 10, current: 3 }), [3]));
  // 8) resolvePreset：对象 list
  ok("resolvePreset {kind:list}", eqArr(RP.resolvePreset({ kind: "list", value: "2,4-6" }, { total: 10 }), [2, 4, 5, 6]));

  // 9) resolvePagePreset 别名
  ok("resolvePagePreset 别名", eqArr(RP.resolvePagePreset("all", 3), [1, 2, 3]));

  // 10) resolveSheetPreset：all
  ok("resolveSheetPreset all", eqArr(RP.resolveSheetPreset("all", ["A", "B", "C"], 0), [0, 1, 2]));
  // 11) resolveSheetPreset：current（0-based 索引）
  ok("resolveSheetPreset current", eqArr(RP.resolveSheetPreset("current", 3, 1), [1]));
  // 12) resolveSheetPreset：list
  ok("resolveSheetPreset list 1,3", eqArr(RP.resolveSheetPreset({ kind: "list", value: "1,3" }, 4, 0), [0, 2]));
  // 13) resolveSheetPreset：数字即 0-based 索引
  ok("resolveSheetPreset 数字索引", eqArr(RP.resolveSheetPreset(2, 4, 0), [2]));

  // 14) createStore：增删查
  const store = RP.createStore({ 我的预设: "1,3-5" });
  ok("createStore 初始 list", store.list().indexOf("我的预设") >= 0);
  ok("createStore get", store.get("我的预设") === "1,3-5");
  store.set("奇数页", "odd");
  ok("createStore set/has", store.has("奇数页") && store.get("奇数页") === "odd");
  store.delete("奇数页");
  ok("createStore delete", !store.has("奇数页"));
  ok("createStore all 数量", Object.keys(store.all()).length === 1);

  console.log("U PDF 导出范围预设：" + (fail === 0 ? "通过 " + pass + " / " + (pass + fail) + "，全部通过 ✅" : "通过 " + pass + " / " + (pass + fail) + " ❌（" + fail + " 失败）"));
  process.exit(fail === 0 ? 0 : 1);
})();
