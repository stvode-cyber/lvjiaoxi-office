/* 绿角犀 Office · 业务板块·库存 流水「按时间筛选 + 分页」 测试
 * 覆盖：filterLog（类型/时间范围/备注关键词 + 组合）/ pageLog（分页切片、越界夹取、空集）/
 *       台账「流水」面板：筛选控件存在、按类型筛选生效、分页上一页/下一页、
 *       筛选中撤销保持、重置还原
 * 运行：node _inventory_log_page_test.js
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
  console.log("=== 库存板块·流水 筛选 + 分页 测试 ===\n");
  const { inv, mem, window } = load();
  window.confirm = () => true;

  console.log("--- 1. filterLog 纯逻辑（类型 / 时间 / 关键词 / 组合） ---");
  const base = 1700000000000;
  const hist = [
    { delta: 5, note: "补货 A", ts: base },
    { delta: -2, note: "领用 B", ts: base + 100000 },
    { delta: 3, note: "入库 C", ts: base + 200000 },
    { delta: -1, note: "领用 D", ts: base + 300000 },
    { delta: 4, note: "补货 E", ts: base + 400000, revoked: true },
  ];
  ok("筛选全部保留 5 条", inv.filterLog(hist, {}).length === 5);
  ok("仅入库(含已撤销) = 3 条", inv.filterLog(hist, { kind: "in" }).length === 3);
  ok("仅出库 = 2 条", inv.filterLog(hist, { kind: "out" }).length === 2);
  ok("时间区间 [base+150000, base+350000] = 2 条", inv.filterLog(hist, { from: base + 150000, to: base + 350000 }).length === 2);
  ok("备注关键词 '领用' = 2 条", inv.filterLog(hist, { q: "领用" }).length === 2);
  ok("组合：出库 + 关键词 '领用' = 2 条", inv.filterLog(hist, { kind: "out", q: "领用" }).length === 2);
  ok("组合：入库 + 时间前段 = 2 条", inv.filterLog(hist, { kind: "in", to: base + 250000 }).length === 2);
  ok("空历史 = 0 条", inv.filterLog([], { kind: "out" }).length === 0);

  console.log("\n--- 2. pageLog 纯逻辑（切片 / 越界夹取 / 空集） ---");
  const items = Array.from({ length: 15 }, (_, i) => i + 1);
  const p1 = inv.pageLog(items, { page: 1, pageSize: 10 });
  ok("第1页 10 条", p1.items.length === 10 && p1.page === 1);
  ok("总条数 15 / 2 页 / offset 0", p1.total === 15 && p1.pages === 2 && p1.offset === 0);
  ok("第1页内容 1..10", p1.items[0] === 1 && p1.items[9] === 10);
  const p2 = inv.pageLog(items, { page: 2, pageSize: 10 });
  ok("第2页 5 条 / offset 10 / 内容 11..15", p2.items.length === 5 && p2.offset === 10 && p2.items[4] === 15);
  const piao = inv.pageLog(items, { page: 99, pageSize: 10 });
  ok("页号越界自动夹取到末页", piao.page === 2 && piao.items.length === 5);
  const pz = inv.pageLog(items, { page: 0 });
  ok("page<=1 回到第1页", pz.page === 1);
  const pem = inv.pageLog([], { page: 1, pageSize: 10 });
  ok("空集 0 条 / 1 页 / 内容空", pem.total === 0 && pem.pages === 1 && pem.items.length === 0);

  console.log("\n--- 3. 台账「流水」面板：筛选 + 分页 DOM ---");
  const c = (await inv.create({ name: "齿轮", qty: 0, safety: 5, unit: "个" })).doc;
  // 造 12 条出库流水（入库 +1 共 6 次 → 累计 +6，qty=6）
  for (let i = 0; i < 12; i++) await inv.adjustQty(c.id, 1, "周领用" + (i % 3));
  await inv.adjustQty(c.id, -1, "日常领用X");
  const el = window.document.createElement("div");
  await inv.render(el);
  const host = el.querySelector("[data-detail-host]");
  el.querySelector("[data-log]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("面板打开且含筛选控件", host.hidden === false && !!host.querySelector("[data-filter]"));
  ok("含类型/日期/关键词控件", !!host.querySelector("[data-f-kind]") && !!host.querySelector("[data-f-from]") && !!host.querySelector("[data-f-q]"));
  ok("默认展示全部(13条)第1/2页", host.textContent.indexOf("共 13 条") >= 0 && host.textContent.indexOf("第 1/2 页") >= 0);

  // 按类型筛选：仅出库
  host.querySelector("[data-f-kind]").value = "out";
  host.querySelector("[data-filter]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("筛选出库后只剩 1 条 / 第 1/1 页", host.textContent.indexOf("共 1 条") >= 0 && host.textContent.indexOf("第 1/1 页") >= 0);

  // 重置还原
  host.querySelector("[data-reset]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("重置后回到全部 13 条 / 第 1/2 页", host.textContent.indexOf("共 13 条") >= 0);

  // 翻页
  const next = host.querySelector("[data-page-next]");
  ok("第1页下一页可用", next && next.disabled === false);
  next.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("翻到第 2/2 页", host.textContent.indexOf("第 2/2 页") >= 0);
  const prev = host.querySelector("[data-page-prev]");
  ok("第2页上一页可用", prev && prev.disabled === false);
  prev.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("翻回第 1/2 页", host.textContent.indexOf("第 1/2 页") >= 0);

  // 备注关键词筛选（在既有页面重填后保留控件绑定）
  const q = host.querySelector("[data-f-q]");
  q.value = "日常领用";
  host.querySelector("[data-filter]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("关键词筛选 '日常领用' = 1 条", host.textContent.indexOf("共 1 条") >= 0);

  // 撤销最近一笔后屏幕保留在筛选结果（无匹配则显示空）
  const undo = host.querySelector("[data-undo]");
  ok("仍有撤销按钮(未撤销流水存在)", !!undo && undo.disabled === false);
  undo.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  const after = await inv.detail(c.id);
  ok("撤销生效 qty 回退", after.data.qty === 12);
  ok("撤销后面板仍展开(保留筛选)", host.hidden === false);
  // 收起
  host.querySelector("[data-detail-close]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  ok("收起后隐藏", host.hidden === true);

  const summary = `\n=== 库存板块·流水 筛选 + 分页 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });