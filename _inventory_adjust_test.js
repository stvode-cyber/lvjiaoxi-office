/* 绿角犀 Office · 业务板块·库存 出入库（数量调整 + 流水）测试
 * 覆盖：planAdjust 纯逻辑 / adjustQty 数据访问（入库/出库/超库/0量/缺失）/
 *       台账 DOM 出库入库交互（输入数量→点击按钮→状态落库）
 * 运行：node _inventory_adjust_test.js
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
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/inventory.js"), "utf8");
  window.document.body.appendChild(s);
  return { inv: window.OS.biz.inventory, mem, window };
}

(async function main() {
  console.log("=== 库存板块·出入库 测试 ===\n");
  const { inv, mem, window } = load();
  window.confirm = () => true;

  console.log("--- 1. planAdjust 纯逻辑 ---");
  ok("入库 5 → cur 10 → next 15", (() => { const p = inv.planAdjust(10, 5); return p.ok && p.next === 15 && p.delta === 5; })());
  ok("出库 -3 → next 7", inv.planAdjust(10, -3).next === 7);
  ok("出库超库存被拒", inv.planAdjust(2, -5).ok === false);
  ok("出库到 0 允许", inv.planAdjust(5, -5).next === 0);
  ok("调整量 0 被拒", inv.planAdjust(5, "0").ok === false);
  ok("调整量小数被拒", inv.planAdjust(5, 1.5).ok === false);
  ok("调整量字母被拒", inv.planAdjust(5, "ab").ok === false);
  ok("字符串负调整量解析 -2", inv.planAdjust(5, "-2").next === 3);
  ok("当前数量非法被拒", inv.planAdjust("bad", 1).ok === false);

  console.log("\n--- 2. adjustQty 数据访问（含流水） ---");
  const r1 = await inv.create({ name: "螺丝", qty: 10, safety: 5, unit: "盒" });
  const id = r1.doc.id;

  const in1 = await inv.adjustQty(id, 5, "补货");
  ok("入库 5 → qty 15", in1.ok && in1.plan.next === 15);
  ok("落库后 qty=15", (await inv.list())[0].data.qty === 15);

  const h1 = (await inv.list())[0].data.history;
  ok("流水记录条数 1", h1.length === 1);
  ok("流水 delta=5 cur=15 备注补货", h1[0].delta === 5 && h1[0].cur === 15 && h1[0].note === "补货");

  const out = await inv.adjustQty(id, -20, "");
  ok("出库 20 超库存被拒", out.ok === false);
  ok("失败不改数量", (await inv.list())[0].data.qty === 15);

  const in2 = await inv.adjustQty(id, 0);
  ok("调整量 0 被拒", in2.ok === false);

  const nope = await inv.adjustQty(id, -2, "领用");
  ok("出库 -2 → qty 13", nope.ok && (await inv.list())[0].data.qty === 13);
  ok("流水累计 2 条", (await inv.list())[0].data.history.length === 2);

  const miss = await inv.adjustQty("inv-nope", 1);
  ok("缺失品项报错", miss.error && !miss.ok);

  mem.set("ord-k", { id: "ord-k", type: "order", data: { customer: "Z" } });
  const cross = await inv.adjustQty("ord-k", 1);
  ok("他类型不被误改", cross.error);

  console.log("\n--- 3. 台账 DOM 出/入库交互（输入→点击→落库） ---");
  const el = window.document.createElement("div");
  await inv.render(el);
  ok("渲染出行内数量输入", el.querySelectorAll(".inv-adj").length === 1);
  ok("渲染出入库按钮各 1", el.querySelectorAll('[data-adjust="in"]').length === 1 && el.querySelectorAll('[data-adjust="out"]').length === 1);

  // 入库：输入 3 → 点「入库」
  el.querySelector(".inv-adj").value = "3";
  el.querySelector('[data-adjust="in"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok("DOM 入库后 qty=16", (await inv.list())[0].data.qty === 16);

  // 出库：输入 1000 → 点「出库」（超库被拒，数量不变）
  el.querySelector(".inv-adj").value = "1000";
  el.querySelector('[data-adjust="out"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok("DOM 超库出库被拒 qty 不变", (await inv.list())[0].data.qty === 16);

  const summary = `\n=== 库存板块·出入库 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });