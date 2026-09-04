/* ============================================================
   绿角犀 Office · 业务板块：订单
   本地优先：订单数据以 doc(type="order") 存于 IndexedDB/本地存储
   纯逻辑（validateOrder / summarize）与 DOM 渲染分离，便于单测
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const $ = s => (global.document || {}).querySelector && global.document.querySelector(s);

  const ORDER_STATUSES = ["待处理", "进行中", "已完成", "已取消"];
  const DEFAULT_AMOUNT = 0;

  // ---------- 纯逻辑（可单测） ----------
  function normAmount(v) {
    const n = typeof v === "string" ? parseFloat(v) : Number(v);
    return (isFinite(n) && n >= 0) ? Math.round(n * 100) / 100 : null;
  }
  function validateOrder(f) {
    f = f || {};
    const errors = [];
    const customer = String(f.customer == null ? "" : f.customer).trim();
    if (!customer) errors.push("请填写客户名称");
    const amount = normAmount(f.amount);
    if (amount === null) errors.push("金额需为不小于 0 的数字");
    const status = ORDER_STATUSES.includes(f.status) ? f.status : "待处理";
    return { ok: errors.length === 0, errors, customer, amount, status, note: String(f.note || "").trim() };
  }
  function summarize(list) {
    const byStatus = {};
    ORDER_STATUSES.forEach(s => byStatus[s] = 0);
    let sum = 0, count = 0;
    (list || []).forEach(d => {
      const st = ORDER_STATUSES.includes(d.status) ? d.status : "待处理";
      byStatus[st]++;
      count++;
      const n = normAmount(d.amount); if (n !== null) sum += n;
    });
    return { count, sum, byStatus,
      active: byStatus["进行中"] + byStatus["待处理"] };
  }

  // ---------- 数据访问 ----------
  async function list() {
    const all = await OS.store.list();
    return (all || []).filter(d => d.type === "order")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  async function create(fields) {
    const v = validateOrder(fields);
    if (!v.ok) return { error: v.errors.join("；") };
    const now = Date.now();
    const doc = {
      id: OS.util.uid("ord"),
      type: "order",
      name: "订单·" + v.customer,
      data: { customer: v.customer, amount: v.amount, status: v.status, note: v.note },
      createdAt: now, updatedAt: now, compat: "A"
    };
    await OS.store.put(doc);
    return { ok: true, doc };
  }
  async function remove(id) { await OS.store.remove(id); }

  // ---------- 格式 ----------
  function fmtMoney(n) {
    const x = normAmount(n); if (x === null) return "—";
    return "¥" + x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const p = n => (n < 10 ? "0" : "") + n;
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- DOM 渲染 ----------
  async function render(el) {
    if (!el) return;
    const rows = await list();
    const s = summarize(rows);
    el.innerHTML = `
      <div class="panel-head"><h2>订单</h2><span class="muted">销售与采购订单 · 本地存储</span><button class="btn tiny" data-export>导出 CSV</button></div>
      <div class="panel-grid">
        <div class="panel-card"><div class="pt-name">订单总数</div><div class="pt-desc">${s.count}</div></div>
        <div class="panel-card"><div class="pt-name">成交总额</div><div class="pt-desc">${fmtMoney(s.sum)}</div></div>
        <div class="panel-card"><div class="pt-name">进行中/待处理</div><div class="pt-desc">${s.byStatus["进行中"] + s.byStatus["待处理"]}</div></div>
      </div>
      <div class="panel-card" style="margin-top:14px">
        <div class="pt-name">新建订单</div>
        <div class="order-form">
          <input id="ord-customer" data-pane="customer" placeholder="客户名称" />
          <input id="ord-amount" data-pane="amount" type="number" min="0" step="0.01" placeholder="金额 (¥)" />
          <select id="ord-status" data-pane="status">${ORDER_STATUSES.map(st => `<option>${st}</option>`).join("")}</select>
          <input id="ord-note" data-pane="note" placeholder="备注（可选）" />
          <button class="btn tiny primary" id="ord-add">＋ 新建订单</button>
        </div>
        <p id="ord-msg" class="form-msg" hidden></p>
      </div>
      <div class="panel-card" style="margin-top:14px">
        <div class="pt-name">订单列表</div>
        ${rows.length
          ? `<table class="biz-table">
              <thead><tr><th>客户</th><th>金额</th><th>状态</th><th>创建时间</th><th></th></tr></thead>
              <tbody>
                ${rows.map(r => `
                  <tr data-order-id="${r.id}">
                    <td>${esc(r.data.customer)}</td>
                    <td>${fmtMoney(r.data.amount)}</td>
                    <td><span class="tag tag-${tagCls(r.data.status)}">${esc(r.data.status)}</span></td>
                    <td class="muted">${fmtDate(r.createdAt)}</td>
                    <td><button class="btn tiny danger" data-del="${r.id}">删除</button></td>
                  </tr>`).join("")}
              </tbody>
            </table>`
          : `<div class="panel-empty">暂无订单。使用上方表单新建第一笔订单。</div>`}
      </div>`;

    el.querySelector("#ord-add").addEventListener("click", async () => {
      const msg = el.querySelector("#ord-msg");
      const f = {
        customer: el.querySelector("#ord-customer").value,
        amount: el.querySelector("#ord-amount").value,
        status: el.querySelector("#ord-status").value,
        note: el.querySelector("#ord-note").value
      };
      const r = await create(f);
      if (!r.ok) { msg.textContent = r.error; msg.hidden = false; return; }
      msg.hidden = true;
      for (const id of ["#ord-customer", "#ord-amount", "#ord-note"]) el.querySelector(id).value = "";
      await render(el); // 刷新列表与统计
    });

    // 导出 CSV
    const ex = el.querySelector("[data-export]");
    if (ex && OS.export) ex.addEventListener("click", () =>
      OS.export.csv("订单.csv",
        ["客户", "金额", "状态", "备注", "创建时间"],
        rows.map(r => [r.data.customer, r.data.amount, r.data.status, r.data.note, fmtDate(r.createdAt)])));

    el.querySelectorAll("[data-del]").forEach(b => {
      b.addEventListener("click", async () => {
        if (confirm("确定删除该订单？")) { await remove(b.dataset.del); await render(el); }
      });
    });
  }

  function tagCls(status) {
    return ("待处理" === status || "进行中" === status) ? "warn" : ("已完成" === status ? "ok" : "muted");
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  OS.biz = OS.biz || {};
  OS.biz.orders = {
    ORDER_STATUSES, DEFAULT_AMOUNT,
    validateOrder, summarize, list, create, remove, render, fmtMoney, fmtDate
  };
})(window);