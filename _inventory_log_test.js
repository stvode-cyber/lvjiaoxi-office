/* 绿角犀 Office · 业务板块·库存 流水明细 + 撤销最近一笔 测试
 * 覆盖：summarizeLog 汇总（未撤销计入） / detailData / detail /
 *       undoAdjust（撤销入/出、连续撤销、无可撤销拒、revoked 标记 + 反向记录）/
 *       台账 DOM「流水」展开 → 汇总 → 撤销 → 收起
 * 运行：node _inventory_log_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

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
  console.log("=== 库存板块·流水明细 + 撤销 测试 ===\n");
  const { inv, mem, window } = load();
  window.confirm = () => true;

  console.log("--- 1. summarizeLog / detailData 纯逻辑 ---");
  const sum = inv.summarizeLog([{ delta: 5 }, { delta: -2 }, { delta: 3 }, { delta: -1, revoked: true }]);
  ok("汇总 入+出+跳过已撤销", sum.inSum === 8 && sum.outSum === 2 && sum.valid === 3);
  ok("空流水全零", (() => { const s = inv.summarizeLog([]); return s.inSum === 0 && s.outSum === 0 && s.valid === 0; })());

  const dd = inv.detailData({ id: "x", data: { name: "A", qty: 5, safety: 2, unit: "盒", history: [{ delta: 3, cur: 4, note: "入", ts: 1 }, { delta: -1, cur: 3, ts: 2 }] } });
  ok("detailData 汇总", dd.inSum === 3 && dd.outSum === 1 && dd.qty === 5);
  ok("detailData history 结构化", dd.history.length === 2 && dd.history[0].cur === 4 && dd.history[0].revoked === false);

  console.log("\n--- 2. detail(id) ---");
  const c = (await inv.create({ name: "螺丝", qty: 10, safety: 5, unit: "盒" })).doc;
  await inv.adjustQty(c.id, 5, "补货");
  const di = await inv.detail(c.id);
  ok("detail(id) ok", di.ok && di.data.name === "螺丝" && di.data.history.length === 1 && di.data.inSum === 5);
  const dx = await inv.detail("inv-nope");
  ok("detail 缺失报错", dx.error);
  mem.set("ord-a", { id: "ord-a", type: "order", data: {} });
  const cross = await inv.detail("ord-a");
  ok("detail 跨类型不返", cross.error);

  console.log("\n--- 3. undoAdjust（撤销最近一笔 + 连续 + 无可撤销） ---");
  // 10 → +5=15 → -2=13
  await inv.adjustQty(c.id, -2, "领用");
  let doc = await inv.detail(c.id);
  ok("撤销前面板 qty=13", doc.data.qty === 13 && doc.data.valid === 2);

  const u1 = await inv.undoAdjust(c.id);
  ok("撤销出库 → qty=15", u1.ok && u1.prev === 15);
  doc = await inv.detail(c.id);
  ok("原流水标记已撤销", doc.data.history[1].revoked === true);
  ok("追加反向撤销记录", doc.data.history.length === 3 && doc.data.history[2].note.indexOf("撤销") >= 0);
  ok("汇总剔除已撤销出库与撤销记录", doc.data.outSum === 0 && doc.data.inSum === 5);

  const u2 = await inv.undoAdjust(c.id);
  ok("再撤录入库 → qty=10", u2.ok && u2.prev === 10);
  doc = await inv.detail(c.id);
  ok("二次撤销后 inSum=0 valid=0", doc.data.inSum === 0 && doc.data.valid === 0);

  const u3 = await inv.undoAdjust(c.id);
  ok("无原始流水可撤 → 拒绝", !u3.ok && u3.error);
  doc = await inv.detail(c.id);
  ok("拒绝后数量不变 qty=10", doc.data.qty === 10);

  console.log("\n--- 4. 台账 DOM「流水」展开 → 汇总 → 撤销 → 收起 ---");
  await inv.adjustQty(c.id, 3, "补货"); // 加一笔，使撤销按钮可用且 qty 有变化空间（10→13）
  const el = window.document.createElement("div");
  await inv.render(el);
  const logBtn = el.querySelector("[data-log]");
  ok("渲染出流水按钮", !!logBtn);
  const host = el.querySelector("[data-detail-host]");
  ok("存在流水容器(hidden)", host && host.hidden === true);
  logBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("点流水后面板显示", host.hidden === false);
  ok("面板含累计出入库", host.textContent.indexOf("累计入库") >= 0 && host.textContent.indexOf("累计出库") >= 0);
  const undo = host.querySelector("[data-undo]");
  ok("面板提供撤销按钮", !!undo);
  undo.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  doc = await inv.detail(c.id);
  ok("DOM 撤销生效 → qty=10", doc.data.qty === 10);
  ok("撤销后面板仍展开", host.hidden === false);
  host.querySelector("[data-detail-close]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  ok("点收起后隐藏", host.hidden === true);

  const summary = `\n=== 库存板块·流水明细 + 撤销 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });