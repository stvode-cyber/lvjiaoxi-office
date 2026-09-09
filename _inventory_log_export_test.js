/* 绿角犀 Office · 业务板块·库存 流水「导出 CSV」 测试
 * 覆盖：logCsvRows（时间正序、入库/出库前缀、已撤销标记、结存/时间格式）/
 *       exportLogCsv（mock OS.export.csv：文件名/标题/行数；空历史；缺 OS.export 防护；
 *                      kind/关键词筛选举例）/
 *       台账「流水」面板：导出按钮存在、点击触发 OS.export.csv 且行数匹配
 * 运行：node _inventory_log_export_test.js
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
  const captured = [];
  window.OS = {
    util: { uid: p => (p || "x") + "-" + Math.random().toString(36).slice(2, 8) },
    toast: () => {},
    export: { csv: (fn, h, rows) => captured.push({ fn, h, rows }) },
    store: { async list() { return [...mem.values()]; }, async put(d) { mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } }
  };
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/inventory.js"), "utf8");
  window.document.body.appendChild(s);
  return { inv: window.OS.biz.inventory, mem, window, captured };
}

(async function main() {
  console.log("=== 库存板块·流水 导出 CSV 测试 ===\n");
  const { inv, mem, window, captured } = load();
  window.confirm = () => true;

  console.log("--- 1. logCsvRows 纯逻辑 ---");
  const base = 1700000000000;
  const hist = [
    { delta: 5, cur: 10, note: "补货 A", ts: base + 100000 },
    { delta: -2, cur: 8, note: "领用 B", ts: base + 300000 },
    { delta: 3, cur: 11, note: "入C", ts: base + 600000, revoked: true },
  ];
  const rows = inv.logCsvRows(hist);
  ok("时间正序(最早在顶/最新在末)", rows[0][4].indexOf("补货") >= 0 && rows[2][4].indexOf("入C") >= 0);
  ok("入库类型+数量带 +", rows[2][1] === "入库" && rows[2][2] === "+3");
  ok("已撤销行尾标记", rows[2][6] === "已撤销");
  ok("正常行状态为空", rows[0][6] === "");
  ok("首行 #=1（最早补货）", rows[0][0] === "1");
  ok("时间格式化含日期+时分", /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(rows[1][5]));
  ok("空历史 → 0 行", inv.logCsvRows([]).length === 0);

  console.log("\n--- 2. exportLogCsv mock OS.export.csv ---");
  const c = (await inv.create({ name: "轴承", qty: 0, safety: 5, unit: "个" })).doc;
  await inv.adjustQty(c.id, 1, "补货");
  await inv.adjustQty(c.id, -1, "领用");
  let r = await inv.exportLogCsv(c.id, {});
  ok("exportLogCsv ok + 条数 2", r.ok && r.total === 2 && captured.length === 1);
  let cap = captured[0];
  ok("文件名含品名", cap.fn.indexOf("轴承") >= 0 && cap.fn.indexOf(".csv") >= 0);
  ok("标题 7 列", cap.h.length === 7 && cap.h[0] === "#" && cap.h[1] === "类型" && cap.h[4] === "备注");
  ok("数据行 2 条", cap.rows.length === 2 && cap.rows[0][1] === "入库" && cap.rows[1][1] === "出库");

  // 筛选导出：仅出库导出 1 条（行数变化）
  await inv.exportLogCsv(c.id, { kind: "out" });
  ok("筛选出库导出 1 条", captured.length === 2 && captured[1].rows.length === 1 && captured[1].rows[0][1] === "出库");

  // 空历史（新建无流水的品项）
  const c2 = (await inv.create({ name: "空件", qty: 1, safety: 0 })).doc;
  const r2 = await inv.exportLogCsv(c2.id, {});
  ok("空流水导出 0 行", r2.ok && r2.total === 0 && captured.length === 3 && captured[2].rows.length === 0);

  // 缺 OS.export 防护
  const before = captured.length;
  const osExportBak = window.OS.export;
  window.OS.export = null;
  const r3 = await inv.exportLogCsv(c.id, {});
  ok("缺 OS.export 返回失败不写文件", !r3.ok && captured.length === before);
  window.OS.export = osExportBak;

  console.log("\n--- 3. 台账「流水」面板：导出按钮 + 点击触发 ---");
  await inv.adjustQty(c.id, 2, "补货X"); // 共 3 条
  const el = window.document.createElement("div");
  await inv.render(el);
  const host = el.querySelector("[data-detail-host]");
  el.querySelector('[data-log="' + c.id + '"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  const btn = host.querySelector("[data-export-log]");
  ok("面板含导出按钮", !!btn);
  const beforeD = captured.length;
  btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("点击导出触发 OS.export.csv 一次", captured.length === beforeD + 1);
  const last = captured[captured.length - 1];
  ok("面板导出含 3 条流水(出库1+入库2，撤销0)", last.rows.length === 3);

  const summary = `\n=== 库存板块·流水 导出 CSV 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });