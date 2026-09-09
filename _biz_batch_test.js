/* 绿角犀 Office · 业务板块·批量操作 纯逻辑测试
 * 覆盖：orders/inventory 的 batchRemove / approvals 的 batchRemove+batchSetStatus
 *       （幂等去重、缺失项、不误删/改其他类型、终态不流转）
 * 运行：node _biz_batch_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function loadBiz() {
  const dom = new JSDOM(`<html><head></head><body></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  const mem = new Map();
  window.OS = {
    util: { uid: p => (p || "x") + "-" + Math.random().toString(36).slice(2, 8), log: () => {} },
    toast: () => {},
    store: {
      async list() { return [...mem.values()]; },
      async get(id) { return mem.get(id) || null; },
      async put(d) { mem.set(d.id, d); return d; },
      async remove(id) { mem.delete(id); }
    }
  };
  for (const m of ["biz-common", "orders", "inventory", "approvals"]) {
    const code = fs.readFileSync(path.join(APP, "js/modules/" + m + ".js"), "utf8");
    const s = window.document.createElement("script");
    s.textContent = code;
    window.document.body.appendChild(s);
  }
  return { oz: window.OS.biz.orders, iz: window.OS.biz.inventory, az: window.OS.biz.approvals, mem, window };
}

(async function main() {
  console.log("=== 业务板块·批量操作 纯逻辑测试 ===\n");

  console.log("--- 1. orders.batchRemove ---");
  {
    const { oz, mem } = loadBiz();
    const o1 = (await oz.create({ customer: "甲", amount: 1 })).doc;
    const o2 = (await oz.create({ customer: "乙", amount: 2 })).doc;
    const o3 = (await oz.create({ customer: "丙", amount: 3 })).doc;
    // 混入一条其他类型，验证不误删
    mem.set("inv-x", { id: "inv-x", type: "inventory", data: { name: "品A" } });

    const r0 = await oz.batchRemove([]);
    ok("空数组 → requested 0", r0.requested === 0 && r0.removed === 0);
    const r1 = await oz.batchRemove([o1.id, o2.id]);
    ok("删除 2 项", r1.removed === 2 && r1.missing.length === 0);
    ok("store 中订单剩 1 条", (await oz.list()).length === 1);
    ok("其他类型未被误删", mem.has("inv-x"));
    const r2 = await oz.batchRemove([o1.id, "ord-nope"]);
    ok("缺失项计入 missing", r2.removed === 0 && r2.missing.length === 2 && r2.missing.includes("ord-nope"));
    const r3 = await oz.batchRemove([o3.id, o3.id, "inv-x"]);
    ok("重复 id 去重 + 不删其他类型", r3.requested === 2 && r3.removed === 1 && r3.missing.length === 1);
  }

  console.log("\n--- 2. inventory.batchRemove ---");
  {
    const { iz, mem } = loadBiz();
    const i1 = (await iz.create({ name: "纸", qty: 10, safety: 5 })).doc;
    const i2 = (await iz.create({ name: "笔", qty: 3, safety: 5 })).doc;
    mem.set("ord-y", { id: "ord-y", type: "order", data: { customer: "丁" } });

    const r = await iz.batchRemove([i1.id, i2.id, "inv-miss"]);
    ok("删除 2 项 + 1 缺失", r.removed === 2 && r.missing.length === 1);
    ok("库存列表为空", (await iz.list()).length === 0);
    ok("订单未被误删", mem.has("ord-y"));
  }

  console.log("\n--- 3. approvals.batchRemove ---");
  {
    const { az, mem } = loadBiz();
    const a1 = (await az.create({ subject: "请假", kind: "请假", applicant: "王" })).doc;
    const a2 = (await az.create({ subject: "报销", kind: "报销", applicant: "李" })).doc;
    mem.set("ord-z", { id: "ord-z", type: "order", data: { customer: "戊" } });

    const r = await az.batchRemove([a1.id, a2.id, "apr-miss"]);
    ok("删除 2 项 + 1 缺失", r.removed === 2 && r.missing.length === 1);
    ok("审批列表为空", (await az.list()).length === 0);
    ok("订单未被误删", mem.has("ord-z"));
  }

  console.log("\n--- 4. approvals.batchSetStatus ---");
  {
    const { az, mem } = loadBiz();
    const p1 = (await az.create({ subject: "采购", kind: "采购", applicant: "赵" })).doc;   // 待审批
    const p2 = (await az.create({ subject: "用印", kind: "用印", applicant: "钱" })).doc;   // 待审批
    const done = (await az.create({ subject: "已通过项", kind: "其他", applicant: "孙" })).doc;
    await az.update(done.id, { status: "已通过" });
    mem.set("ord-w", { id: "ord-w", type: "order", data: { customer: "己" } });

    const r1 = await az.batchSetStatus([p1.id, p2.id], "已通过");
    ok("待审批 2 项全部通过", r1.updated === 2 && r1.skipped.length === 0);
    ok("状态已落库", (await az.list()).find(d => d.id === p1.id).data.status === "已通过");

    const r2 = await az.batchSetStatus([done.id, p2.id, "apr-x", "ord-w"], "已驳回");
    ok("终态/无效/他类型全部跳过", r2.updated === 0 && r2.skipped.length === 4);

    const r3 = await az.batchSetStatus([p1.id], "待审批");
    ok("流转回待审批被拒", r3.updated === 0 && r3.skipped.length === 1);

    const r4 = await az.batchSetStatus([p1.id], "非法状态");
    ok("非法状态被拒", r4.updated === 0 && r4.skipped.length === 1);

    ok("已通过项状态未被改", (await az.list()).find(d => d.id === done.id).data.status === "已通过");
  }

  console.log("\n--- 5. 订单面板 DOM 批量交互（勾选→工具条→批量删除） ---");
  {
    const { oz, window } = loadBiz();
    window.confirm = () => true;
    await oz.create({ customer: "A", amount: 1 });
    await oz.create({ customer: "B", amount: 2 });
    await oz.create({ customer: "C", amount: 3 });
    const el = window.document.createElement("div");
    await oz.render(el);
    ok("渲染出 3 行复选框", el.querySelectorAll("[data-check]").length === 3);
    const tools = el.querySelector(".batch-tools");
    ok("工具条初始隐藏", tools.hidden === true);

    const boxes = el.querySelectorAll("[data-check]");
    boxes[0].checked = true;
    boxes[1].checked = true;
    boxes[0].dispatchEvent(new window.Event("change"));
    boxes[1].dispatchEvent(new window.Event("change"));
    ok("勾选 2 项后工具条显示", tools.hidden === false);
    ok("计数显示已选 2 项", el.querySelector("[data-bc]").textContent === "已选 2 项");

    const del = el.querySelector("[data-batch-del]");
    await del.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 30)); // 等异步批量删除 + render 完成
    ok("批量删除后剩 1 行", el.querySelectorAll("[data-check]").length === 1);
    ok("store 中订单剩 1 条", (await oz.list()).length === 1);
  }

  const summary = `\n=== 业务板块·批量操作 纯逻辑测试: ${pass} passed, ${fail} failed ===`
    + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });
