/* 绿角犀 Office · 业务板块·订单 纯逻辑测试
 * 覆盖：validateOrder 校验 / summarize 统计 / fmtMoney 金额格式 /
 *       create/list/remove 数据访问（内存 store 桩）
 * 运行：node _orders_biz_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const APP = "D:/源码存档/绿角犀办公软件/app";
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function loadOrders() {
  const dom = new JSDOM(`<html><head></head><body></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  // 内存 store 桩（仅订单使用到的子集）
  const mem = new Map();
  window.OS = {
    util: { uid: p => (p || "x") + "-" + Math.random().toString(36).slice(2, 8) },
    store: {
      async list() { return [...mem.values()]; },
      async put(d) { mem.set(d.id, d); return d; },
      async remove(id) { mem.delete(id); }
    }
  };
  const code = fs.readFileSync(path.join(APP, "js/modules/orders.js"), "utf8");
  const s = window.document.createElement("script");
  s.textContent = code;
  window.document.body.appendChild(s);
  return { oz: window.OS.biz.orders, jsdom: dom };
}

(async function main() {
  console.log("=== 订单板块纯逻辑测试 ===\n");
  const { oz } = loadOrders();

  console.log("--- 1. validateOrder ---");
  ok("空客户 → 不通过", oz.validateOrder({ customer: "", amount: 100 }).ok === false);
  ok("缺客户报错文案", oz.validateOrder({ customer: "  " }).errors.some(e => e.includes("客户")));
  ok("负金额 → 不通过", oz.validateOrder({ customer: "A", amount: -5 }).ok === false);
  ok("非数字金额 → 不通过", oz.validateOrder({ customer: "A", amount: "abc" }).ok === false);
  ok("合法 → 通过", oz.validateOrder({ customer: " 客户甲 ", amount: "100" }).ok === true);
  ok("客户去空格", oz.validateOrder({ customer: " 客户甲 " }).customer === "客户甲");
  ok("金额保留两位", oz.validateOrder({ customer: "A", amount: "100.999" }).amount === 101);
  ok("非法状态回退待处理", oz.validateOrder({ customer: "A", amount: 1, status: "X" }).status === "待处理");
  ok("合法状态保留", oz.validateOrder({ customer: "A", amount: 1, status: "已完成" }).status === "已完成");

  console.log("\n--- 2. summarize ---");
  ok("空列表全为零", (() => { const s = oz.summarize([]); return s.count === 0 && s.sum === 0 && s.byStatus["待处理"] === 0; })());
  ok("统计总金额", oz.summarize([
    { amount: 100, status: "已完成" },
    { amount: 50.5, status: "进行中" },
    { amount: "bad", status: "待处理" }
  ]).sum === 150.5);
  ok("状态计数", oz.summarize([
    { amount: 1, status: "已完成" }, { amount: 1, status: "已完成" }, { amount: 1, status: "进行中" }
  ]).byStatus["已完成"] === 2);
  ok("进行中+待处理活跃数", oz.summarize([
    { amount: 1, status: "待处理" }, { amount: 1, status: "进行中" }, { amount: 1, status: "已完成" }
  ]).active === 2);

  console.log("\n--- 3. fmtMoney / fmtDate ---");
  ok("金额 0 → ¥0.00", oz.fmtMoney(0) === "¥0.00");
  ok("金额千分位", oz.fmtMoney(1234.5) === "¥1,234.50");
  ok("非法金额 → —", oz.fmtMoney("xx") === "—");
  ok("空时间 → —", oz.fmtDate(0) === "—");

  console.log("\n--- 4. create / list / remove（内存 store） ---");
  const bad = await oz.create({ customer: "", amount: 1 });
  ok("非法创建返回 error 且不含 doc", bad.error && !bad.doc);
  const r1 = await oz.create({ customer: "甲方", amount: 200, status: "进行中", note: "加急" });
  ok("合法创建 ok", r1.ok === true);
  ok("创建写入金额规范化", r1.doc.data.amount === 200);
  const r2 = await oz.create({ customer: "乙方", amount: 88 });
  ok("第二条创建成功", r2.ok === true);
  const lst = await oz.list();
  ok("list 返回 2 条", lst.length === 2);
  ok("list 只含 type=order", lst.every(d => d.type === "order"));
  ok("聚合统计与列表一致", oz.summarize(lst).count === 2);
  await oz.remove(r1.doc.id);
  ok("删除后剩 1 条", (await oz.list()).length === 1);

  const summary = `\n=== 订单板块纯逻辑测试: ${pass} passed, ${fail} failed ===`
    + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });