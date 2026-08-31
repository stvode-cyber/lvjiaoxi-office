/*
 * _pdf_anno_timeline_test.js —— OS.PdfAnnoTimeline 回归测试
 * 覆盖：排序/按天分组/dateKey 四形态/派生统计/缺字段回落/导出/空输入边界。
 * 运行：node _pdf_anno_timeline_test.js
 */
const T = require("./app/js/modules/pdf-anno-timeline.js");

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`✗ ${name}\n    期望: ${JSON.stringify(want)}\n    实际: ${JSON.stringify(got)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error(`✗ ${name}`); }
}

const MS_0830_08 = Date.UTC(2026, 7, 30, 8, 0, 0);
const MS_0830_10 = Date.UTC(2026, 7, 30, 10, 0, 0);
const MS_0830_12 = Date.UTC(2026, 7, 30, 12, 0, 0);
const MS_0831_09 = Date.UTC(2026, 7, 31, 9, 0, 0);
const MS_0831_15 = Date.UTC(2026, 7, 31, 15, 0, 0);

const annos = [
  { id: "a1", type: "highlight", author: "林", page: 3, created: MS_0830_10, text: "重要段落" },
  { id: "a2", type: "note", author: "王", page: 1, created: MS_0830_12, text: "a < b 说明" },
  { id: "a3", type: "highlight", author: "林", page: 5, created: MS_0831_09, text: "结论" },
  { id: "a4", type: "note", author: "林", page: 2, text: "无创建时间" },               // 缺 created
  { id: "a5", type: "highlight", author: "林", page: 4, created: MS_0831_09 / 1000, text: "秒时间戳" }, // 秒级
  { id: "a6", type: "highlight", author: "林", page: 6, created: "2026-08-31T09:00:00Z", text: "ISO 串" },
  { id: "a7", type: "note", author: "王", page: 7, created: new Date(MS_0830_10), text: "Date 对象" },
  { id: "a8", type: "note", author: "王", page: 8, created: "不是日期", text: "非法时间" },
  { id: "a9", type: "highlight", page: 2, created: MS_0830_08, text: "缺作者" },        // 缺 author
  { id: "a10", type: "note", author: "林", created: MS_0831_15, text: "缺页码" }          // 缺 page
];

// 1-3. 空/非数组边界
eq("空数组 total", T.buildTimeline([]).total, 0);
eq("null → total 0", T.buildTimeline(null).total, 0);
eq("非数组 → total 0", T.buildTimeline("x").total, 0);

const tl = T.buildTimeline(annos);

// 4-8. 总量与按天分组
eq("total", tl.total, 10);
eq("entries(天数)", tl.entries.length, 3);
eq("Day1 日期键", tl.entries[0].dateKey, "2026-08-30");
eq("Day1 条目数", tl.entries[0].items.length, 4);
eq("Day2 日期键", tl.entries[1].dateKey, "2026-08-31");
eq("Day2 条目数", tl.entries[1].items.length, 4);
eq("Day3 未知日期", tl.entries[2].dateKey, "未知日期");
eq("Day3 条目数", tl.entries[2].items.length, 2);

// 9. 升序排序（同天按时间）
eq("升序[0]=a9(08:00)", tl.flat[0].id, "a9");
eq("升序[1]=a1(10:00)", tl.flat[1].id, "a1");
eq("升序[3]=a2(12:00)", tl.flat[3].id, "a2");

// 10-16. dateKey 四形态 + 边界
eq("dateKey(ms)", T.dateKey(MS_0830_10), "2026-08-30");
eq("dateKey(秒)", T.dateKey(MS_0830_10 / 1000), "2026-08-30");
eq("dateKey(ISO)", T.dateKey("2026-08-31T09:00:00Z"), "2026-08-31");
eq("dateKey(Date)", T.dateKey(new Date(MS_0830_10)), "2026-08-30");
eq("dateKey(非法串)", T.dateKey("不是日期"), "");
eq("dateKey(null)", T.dateKey(null), "");
eq("dateKey(undefined)", T.dateKey(undefined), "");

// 17-18. 派生统计
const sum = T.summarize(tl);
eq("sum.total", sum.total, 10);
eq("sum.days", sum.days, 3);
eq("sum.topAuthor", sum.topAuthor, "林");
eq("sum.perType.highlight", sum.perType.highlight, 5);

// 19-20. 缺字段回落
ok("缺 author → 未署名", annos.find(a => a.id === "a9") && tl.flat.find(a => a.id === "a9").author === "未署名");
ok("缺 page → 0", tl.flat.find(a => a.id === "a10").page === 0);

// 21. Markdown 导出
const md = T.toMarkdown(tl);
ok("MD 含标题", md.indexOf("# 批注时间线") >= 0);
ok("MD 含日期", md.indexOf("2026-08-30") >= 0);
ok("MD 空态", T.toMarkdown({ entries: [] }).indexOf("暂无批注") >= 0);

// 22-23. HTML 导出 + 转义
const html = T.toHtml(tl);
ok("HTML 含 data-page=3", html.indexOf('data-page="3"') >= 0);
ok("HTML 含 data-page=0(缺页码)", html.indexOf('data-page="0"') >= 0);
ok("HTML 转义 < 为 &lt;", html.indexOf("a &lt; b") >= 0 && html.indexOf("a < b") === -1);
ok("HTML 空态", T.toHtml({ entries: [] }).indexOf("暂无批注") >= 0);

console.log(`\n_pdf_anno_timeline_test: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
