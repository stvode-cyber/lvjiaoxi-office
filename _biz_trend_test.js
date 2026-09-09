/* 绿角犀 Office · 业务板块 工作台「成交额趋势」 测试
 * 覆盖：aggregateDaily（按日桶聚合、近 N 天连续升序、无数据日 0 填充、跨日归桶）/
 *       orders.trend（读 store → days/data 结构）/
 *       金额两位小数、多笔同日累加
 * 运行：node _biz_trend_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = "D:/源码存档/绿角犀办公软件/app";
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function load() {
  const dom = new JSDOM(`<html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  const mem = new Map();
  window.OS = {
    util: { uid: p => (p || "x") + "-" + Math.random().toString(36).slice(2, 8) },
    toast: () => {},
    store: { async list() { return [...mem.values()]; }, async put(d) { mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } }
  };
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/orders.js"), "utf8");
  window.document.body.appendChild(s);
  return { orders: window.OS.biz.orders, mem, window };
}

(async function main() {
  console.log("=== 业务板块·工作台「成交额趋势」 测试 ===\n");
  const { orders } = load();
  const agg = orders.aggregateDaily;

  // 固定 now：2026-09-09 12:00 本地
  const NOW = new Date(2026, 8, 9, 12, 0, 0).getTime();
  const D2 = new Date(2026, 8, 8, 10, 0, 0).getTime();   // 昨天
  const D2_2 = new Date(2026, 8, 8, 20, 30, 0).getTime(); // 昨天（另一笔）
  const D5 = new Date(2026, 8, 4, 9, 0, 0).getTime();    // 5 天前

  console.log("--- 1. aggregateDaily 纯逻辑 ---");
  let data = agg([], 7, NOW);
  ok("空数据 → 7 天且全 0", data.length === 7 && data.every(d => d.amount === 0 && d.count === 0));
  ok("升序且首日距今 days-1", data[0].date === "2026-09-03" && data[6].date === "2026-09-09");

  data = agg([
    { ts: D2, amount: 100 }, { ts: D2_2, amount: 250.5 }, // 同昨天归桶累加
    { ts: D5, amount: 40 },                                // 5 天前
  ], 7, NOW);
  ok("昨天两笔累加 → 350.5", data[6].amount === 0 && data[5].amount === 350.5 && data[5].count === 2);
  ok("5 天前那笔落在对应日", data[1].amount === 40 && data[1].count === 1);
  ok("中间无数据日为 0", data[2].amount === 0 && data[3].amount === 0 && data[4].amount === 0);
  ok("今天计 0（无今日数据）", data[6].amount === 0);

  // 金额两位小数（每笔入账即舍入到分）
  data = agg([{ ts: D2, amount: 0.005 }, { ts: D2_2, amount: 0.005 }], 7, NOW); // 每笔 0.005→0.01，两笔 0.02
  ok("两位小数累加 0.02", data[5].amount === 0.02);

  console.log("\n--- 2. orders.trend（读 store） ---");
  let t = await orders.trend(7);
  ok("空库 days=7 且 data 7 项", t.days === 7 && t.data.length === 7);
  await orders.create({ customer: "A", amount: 300, status: "已完成" });
  await orders.create({ customer: "B", amount: 120.5, status: "进行中" });
  t = await orders.trend(7);
  ok("today 两笔累加 420.5", t.data[t.data.length - 1].amount === 420.5 && t.data[t.data.length - 1].count === 2);
  ok("数据总结构 { days, data }", typeof t.days === "number" && t.data.every(d => "date" in d && "amount" in d && "count" in d));

  const summary = `\n=== 业务板块·工作台「成交额趋势」 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });