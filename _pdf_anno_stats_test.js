/* ============================================================
   绿角犀 Office · PDF 批注统计面板 测试（AE）
   零依赖，直接 node _pdf_anno_stats_test.js 运行
   ============================================================ */
"use strict";
const A = require("./app/js/modules/pdf-anno-stats.js");

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + "  得到 " + g + "  期望 " + w); }
}
function ok(name, cond, tip) {
  if (cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (tip ? "  " + tip : "")); }
}

// —— 合成批注集合 ——
const T1 = Date.UTC(2026, 7, 30, 10, 0, 0);          // 2026-08-30 10:00Z
const T1S = Math.floor(T1 / 1000);                    // 同一时刻的「秒」时间戳
const T3 = Date.UTC(2026, 8, 1, 9, 0, 0);             // 2026-09-01 09:00Z
const annos = [
  { id: 1, type: "highlight", page: 1, color: "#ff0000", author: "张三", created: T1,  text: "重要段落", layer: "审阅" },
  { id: 2, type: "highlight", page: 1, color: "#ff0000", author: "张三", created: T1,  text: "另一段",   layer: "审阅" },
  { id: 3, type: "pen",       page: 2, color: "#00ff00", author: "李四", created: T1,  text: "abc",      layer: "default", visible: false },
  { id: 4, type: "note",      page: 3, color: "#0000ff", author: "李四", created: T3,  text: "",        layer: "default" },
  { id: 5, type: "rect",      page: 2, color: "#00ff00", author: "",     created: "2026-08-31T10:00:00Z", text: "xy", layer: "批注" },
  { id: 6, type: "highlight", page: 2, color: "#ff0000", author: "张三", created: T1,  text: "补充",     layer: "审阅" }
];

const S = A.aggregate(annos);

// —— 基础计数 ——
eq("总数 total", S.total, 6);
eq("可见 visibleCount", S.visibleCount, 5);
eq("隐藏 hiddenCount", S.hiddenCount, 1);

// —— 维度聚合 ——
eq("byType.highlight", S.byType.highlight, 3);
eq("byType.pen", S.byType.pen, 1);
eq("byType.note", S.byType.note, 1);
eq("byType.rect", S.byType.rect, 1);
eq("byAuthor.张三", S.byAuthor["张三"], 3);
eq("byAuthor.李四", S.byAuthor["李四"], 2);
eq("byAuthor 空作者回落「未署名」", S.byAuthor["未署名"], 1);
eq("byColor.#ff0000", S.byColor["#ff0000"], 3);
eq("byColor.#00ff00", S.byColor["#00ff00"], 2);
eq("byLayer.审阅", S.byLayer["审阅"], 3);
eq("byPage['2']", S.byPage["2"], 3);
eq("byPage['1']", S.byPage["1"], 2);
eq("byDate['2026-08-30']", S.byDate["2026-08-30"], 4);
eq("byDate['2026-08-31']（ISO 串入参）", S.byDate["2026-08-31"], 1);
eq("byMonth['2026-08']", S.byMonth["2026-08"], 5);
eq("byMonth['2026-09']", S.byMonth["2026-09"], 1);

// —— 文本量 ——
eq("textTotal（4+3+3+0+2+2）", S.textTotal, 14);
eq("textAvg（14/6 保留两位）", S.textAvg, 2.33);

// —— 派生指标 ——
eq("busiestPage", S.busiestPage, { page: "2", count: 3 });
eq("topAuthor", S.topAuthor, { author: "张三", count: 3 });
eq("firstDate", S.firstDate, "2026-08-30");
eq("lastDate", S.lastDate, "2026-09-01");

// —— rank 排序与占比 ——
const rt = A.rank(S.byType);
eq("rank: 首项为 highlight", rt[0].key, "highlight");
eq("rank: 首项 count", rt[0].count, 3);
eq("rank: 首项 pct（3/6）", rt[0].pct, 50);
eq("rank: 中文标签", rt[0].label, "高亮");
eq("rank: limit 截断", A.rank(S.byType, 2).length, 2);
eq("rank(null)", A.rank(null), []);
eq("rank({})", A.rank({}), []);

// —— dateKey 多形态兼容 ——
eq("dateKey: 毫秒时间戳", A.dateKey(T1), "2026-08-30");
eq("dateKey: 秒时间戳", A.dateKey(T1S), "2026-08-30");
eq("dateKey: ISO 字符串", A.dateKey("2026-08-31T10:00:00Z"), "2026-08-31");
eq("dateKey: Date 对象", A.dateKey(new Date(T1)), "2026-08-30");
eq("dateKey: null", A.dateKey(null), "");
eq("dateKey: 非法串", A.dateKey("garbage"), "");
eq("monthKey: 截断到月", A.monthKey(T1), "2026-08");

// —— 边界：空输入 / 非数组 / 缺字段 ——
const e0 = A.aggregate([]);
eq("空数组: total", e0.total, 0);
eq("空数组: textAvg", e0.textAvg, 0);
eq("空数组: busiestPage", e0.busiestPage, null);
eq("空数组: topAuthor", e0.topAuthor, null);
eq("非数组(null): total", A.aggregate(null).total, 0);
eq("非数组(对象): total", A.aggregate({ a: 1 }).total, 0);

const e1 = A.aggregate([{}]);
eq("缺省批注: byType.unknown", e1.byType.unknown, 1);
eq("缺省批注: byAuthor 未署名", e1.byAuthor["未署名"], 1);
eq("缺省批注: byColor 默认", e1.byColor["默认"], 1);
eq("缺省批注: byLayer default", e1.byLayer["default"], 1);
eq("缺省批注: byPage['0']", e1.byPage["0"], 1);
eq("缺省批注: visible 默认可见", e1.visibleCount, 1);
eq("缺省批注: 无日期不进 byDate", Object.keys(e1.byDate).length, 0);

// —— 导出 ——
const mdEmpty = A.toMarkdown(e0);
ok("toMarkdown 空: 含无批注提示", mdEmpty.indexOf("（无批注）") >= 0);
const md = A.toMarkdown(S, { title: "测试统计" });
ok("toMarkdown: 标题", md.indexOf("# 测试统计") === 0, md.slice(0, 20));
ok("toMarkdown: 含总条数", md.indexOf("共 6 条批注") >= 0);
ok("toMarkdown: 含按类型段", md.indexOf("## 按类型") >= 0);
ok("toMarkdown: 中文类型标签", md.indexOf("高亮") >= 0);
ok("toMarkdown: 含最活跃作者", md.indexOf("最活跃作者：张三") >= 0);
ok("toMarkdown: 含批注最多页", md.indexOf("批注最多页：第 2 页") >= 0);
ok("toMarkdown: 含时间跨度", md.indexOf("2026-08-30 ~ 2026-09-01") >= 0);
eq("toMarkdown(null)", A.toMarkdown(null), "");

const csv = A.toCsv(S);
ok("toCsv: 表头", csv.indexOf("维度,键,数量,占比%") === 0, csv.slice(0, 30));
ok("toCsv: 类型行", csv.indexOf("类型,高亮,3,50") >= 0);
ok("toCsv: 作者行", csv.indexOf("作者,张三,3,50") >= 0);
ok("toCsv: 月份维度存在", csv.indexOf("月份,2026-08,5,") >= 0);
eq("toCsv(null)", A.toCsv(null), "");
// CSV 转义：作者名带逗号与引号
const csvEsc = A.toCsv(A.aggregate([{ type: "note", author: 'a,b"c' }]));
ok("toCsv: 逗号引号转义", csvEsc.indexOf('"a,b""c"') >= 0, csvEsc);

console.log("\n" + (fail ? "✘" : "✔") + " PDF 批注统计面板（AE）：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
