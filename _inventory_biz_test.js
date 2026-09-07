/* 绿角犀 Office · 业务板块·库存 纯逻辑测试
 * 运行：node _inventory_biz_test.js
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
    store: { async list() { return [...mem.values()]; }, async put(d) { mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } }
  };
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/inventory.js"), "utf8");
  window.document.body.appendChild(s);
  return window.OS.biz.inventory;
}

(async function main() {
  console.log("=== 库存板块纯逻辑测试 ===\n");
  const inv = load();
  console.log("--- 1. validateItem ---");
  ok("缺品名不通过", inv.validateItem({ name: "", qty: 1, safety: 0 }).ok === false);
  ok("负数量不通过", inv.validateItem({ name: "A", qty: -1, safety: 0 }).ok === false);
  ok("小数数量不通过", inv.validateItem({ name: "A", qty: 1.5, safety: 0 }).ok === false);
  ok("安全库存非负整数校验", inv.validateItem({ name: "A", qty: 5, safety: "abc" }).ok === false);
  ok("低库存仍允许创建（用于预警）", inv.validateItem({ name: "A", qty: 2, safety: 5 }).ok === true);
  ok("合法通过", inv.validateItem({ name: " 螺丝 ", qty: 10, safety: 2 }).ok === true);
  ok("品名去空格", inv.validateItem({ name: " 螺丝 " }).name === "螺丝");

  console.log("\n--- 2. summarize ---");
  ok("空列表全零", (() => { const s = inv.summarize([]); return s.totalKinds === 0 && s.totalQty === 0 && s.lowCount === 0; })());
  ok("总量与品项", inv.summarize([{ qty: 5 }, { qty: 3 }]).totalQty === 8 && inv.summarize([{ qty: 5 }, { qty: 3 }]).totalKinds === 2);
  ok("预警计数", inv.summarize([{ qty: 2, safety: 5 }, { qty: 10, safety: 5 }]).lowCount === 1);

  console.log("\n--- 3. create / list / remove ---");
  const bad = await inv.create({ name: "", qty: 1, safety: 0 });
  ok("非法返回 error", !!bad.error);
  const r1 = await inv.create({ name: "甲", qty: 10, safety: 2, unit: "件" });
  ok("创建成功", r1.ok === true);
  const r2 = await inv.create({ name: "乙", qty: 0, safety: 5 });
  ok("第二品项成功", r2.ok === true);
  ok("list 2 条且仅 inventory", (await inv.list()).length === 2);
  await inv.remove(r1.doc.id);
  ok("删除后剩 1", (await inv.list()).length === 1);

  const summary = `\n=== 库存板块测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });