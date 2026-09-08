/* 绿角犀 Office · 业务板块·订单 单条状态流转（含 statusHistory 留痕）测试
 * 覆盖：planStatus 纯逻辑 / setStatus 数据访问（合法流转/同状态拒/非法状态拒/缺失/跨类型）/
 *       列表 DOM 状态下拉 → 流转落库交互
 * 运行：node _order_status_test.js
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
  return { oz: window.OS.biz.orders, mem, window };
}

(async function main() {
  console.log("=== 订单板块·状态流转 测试 ===\n");
  const { oz, mem, window } = load();
  window.confirm = () => true;

  console.log("--- 1. planStatus 纯逻辑 ---");
  ok("待处理→进行中 合法", (() => { const p = oz.planStatus("待处理", "进行中"); return p.ok && p.to === "进行中"; })());
  ok("已完成→待处理 可回退", oz.planStatus("已完成", "待处理").ok === true);
  ok("已取消→已完成 可恢复", oz.planStatus("已取消", "已完成").ok === true);
  ok("同状态被拒", oz.planStatus("进行中", "进行中").ok === false);
  ok("非法状态被拒", oz.planStatus("待处理", "已完成X").ok === false);
  ok("非法当前状态回退待处理", (() => { const p = oz.planStatus("未知", "已完成"); return p.ok && p.to === "已完成"; })());

  console.log("\n--- 2. setStatus 数据访问（含 statusHistory） ---");
  const r = await oz.create({ customer: "甲方", amount: 100, status: "待处理" });
  const id = r.doc.id;

  const s1 = await oz.setStatus(id, "进行中");
  ok("流转→进行中", s1.ok && s1.plan.to === "进行中");
  ok("落库后状态=进行中", (await oz.list())[0].data.status === "进行中");
  ok("statusHistory 条数 1", (await oz.list())[0].data.statusHistory.length === 1);
  const h1 = (await oz.list())[0].data.statusHistory[0];
  ok("留痕 status=进行中", h1.status === "进行中");

  const same = await oz.setStatus(id, "进行中");
  ok("同状态被拒且不改", same.ok === false && (await oz.list())[0].data.status === "进行中");

  const s2 = await oz.setStatus(id, "已完成", "验收合格");
  ok("流转→已完成", s2.ok);
  const h2 = (await oz.list())[0].data.statusHistory;
  ok("留痕累计 2 条 + 备注", h2.length === 2 && h2[1].note === "验收合格");

  const bad = await oz.setStatus(id, "不存在的状态");
  ok("非法状态被拒且数量不变", bad.ok === false && (await oz.list())[0].data.status === "已完成");

  const miss = await oz.setStatus("ord-nope", "待处理");
  ok("缺失订单报错", miss.error && !miss.ok);

  mem.set("inv-m", { id: "inv-m", type: "inventory", data: { name: "品" } });
  const cross = await oz.setStatus("inv-m", "待处理");
  ok("他类型不被误改", cross.error);

  console.log("\n--- 3. 订单列表 DOM 状态下拉 → 流转落库 ---");
  // 新建两个干净订单，验证下拉渲染与 change 交互
  const el = window.document.createElement("div");
  const dc = (await oz.create({ customer: "丙", amount: 10, status: "待处理" })).doc;
  const dd = (await oz.create({ customer: "丁", amount: 20, status: "待处理" })).doc;
  await oz.render(el);
  const sels = [...el.querySelectorAll("[data-status]")];
  ok("渲染出行内状态下拉(≥2)", sels.length >= 2);

  const firstId = sels[0].dataset.status;
  const secondId = sels[1].dataset.status;
  const firstIsC = firstId === dc.id; // 前两 select 对应 dc 或 dd 均可
  const secId = firstIsC ? dd.id : dc.id;
  const curList = await oz.list();
  const mapStatus = id => (curList.find(d => d.id === id) || {}).data;
  ok("下拉默认选中当前状态", sels.every(s => s.value === mapStatus(s.dataset.status).status));
  ok("下拉含 4 个选项", sels[0].options.length === 4);

  // 改首个 select → 仅该行流转，另一行不变
  sels[0].value = "已完成";
  sels[0].dispatchEvent(new window.Event("change"));
  await new Promise(rr => setTimeout(rr, 30));
  ok("change 后首个订单=已完成", (await oz.list()).find(d => d.id === firstId).data.status === "已完成");
  ok("另一订单仍待处理", (await oz.list()).find(d => d.id === secId).data.status === "待处理");

  const summary = `\n=== 订单板块·状态流转 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });