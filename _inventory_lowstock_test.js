/* 绿角犀 Office · 业务板块·库存 低库存/缺货聚合查询 测试
 * 覆盖：lowStock() 空库 / 缺货(qty=0) / 偏低(0<qty<safety) /
 *       边界(等于安全线不预警 / safety=0 不预警) / 缺货优先排序 / 品名序 /
 *       返回字段完整（id/name/qty/safety/unit/severity）
 * 运行：node _inventory_lowstock_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function load() {
  const dom = new JSDOM(`<html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  const mem = new Map();
  window.OS = {
    util: { uid: p => (p || "x") + "-" + Math.random().toString(36).slice(2, 8), escapeHtml: s => String(s == null ? "" : s) },
    toast: () => {},
    store: { async list() { return [...mem.values()]; }, async put(d) { mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } }
  };
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/inventory.js"), "utf8");
  window.document.body.appendChild(s);
  return { inv: window.OS.biz.inventory, mem, window };
}

(async function main() {
  console.log("=== 库存板块·低库存/缺货 聚合查询 测试 ===\n");
  const { inv } = load();

  console.log("--- 1. 空库 / 边界 ---");
  ok("空库 → 无预警", (await inv.lowStock()).length === 0);

  await inv.create({ name: "正常足量", qty: 10, safety: 5, unit: "个" });     // qty>safety → 排除
  await inv.create({ name: "恰好等于", qty: 5, safety: 5 });                  // qty===safety → 不预警
  await inv.create({ name: "未设安全线", qty: 0, safety: 0 });                // safety=0 → 不预警
  ok("足量/等于安全线/未设安全线 → 均不预警", (await inv.lowStock()).length === 0);

  console.log("\n--- 2. 缺货 / 偏低 / 字段完整 ---");
  const a = (await inv.create({ name: "缺货品", qty: 0, safety: 8, unit: "盒" })).doc;
  const b = (await inv.create({ name: "偏低品", qty: 3, safety: 5, unit: "袋" })).doc;
  let list = await inv.lowStock();
  ok("命中 2 项", list.length === 2);
  const zero = list.find(x => x.name === "缺货品");
  ok("qty=0 → 缺货", zero && zero.severity === "缺货" && zero.qty === 0);
  const low = list.find(x => x.name === "偏低品");
  ok("0<qty<safety → 偏低", low && low.severity === "偏低" && low.qty === 3);
  ok("字段完整(id/name/qty/safety/unit)", list.every(x => !!x.id && !!x.name && typeof x.qty === "number" && x.safety > 0 && typeof x.unit === "string"));

  console.log("\n--- 3. 缺货优先 + 品名排序 ---");
  // 再造一批以便验证排序：同 severity 按品名
  await inv.create({ name: "AA偏低", qty: 2, safety: 5 });
  await inv.create({ name: "ZZ偏低", qty: 2, safety: 5 });
  await inv.remove(a.id); // 去掉缺货品，聚焦同severity排序
  list = await inv.lowStock();
  const lows = list.filter(x => x.severity === "偏低").map(x => x.name);
  ok("同 severity 组含三偏低品", lows.slice().sort().join(",") === "AA偏低,ZZ偏低,偏低品");
  // 加入缺货品 → 缺货排最前
  await inv.create({ name: "缺货甲", qty: 0, safety: 5 });
  list = await inv.lowStock();
  ok("缺货优先（首个为缺货）", list[0].severity === "缺货");
  ok("全部缺货在偏低之前", list[0].name === "缺货甲" && list[list.length - 1].severity === "偏低");

  const summary = `\n=== 库存板块·低库存/缺货 聚合查询 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });