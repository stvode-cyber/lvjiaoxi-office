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

  // 批量删除：仅删除存在且 type=order 的目标，返回缺失项（幂等安全，不误删其他类型）
  async function batchRemove(ids) {
    const all = await OS.store.list();
    const valid = new Set((all || []).filter(d => d.type === "order").map(d => d.id));
    const targets = [...new Set((ids || []).filter(Boolean))];
    const present = targets.filter(id => valid.has(id));
    await Promise.all(present.map(id => OS.store.remove(id)));
    return { requested: targets.length, removed: present.length,
      missing: targets.filter(id => !valid.has(id)) };
  }

  // 状态流转计划：纯逻辑（可单测）。目标状态须合法且与当前不同
  function planStatus(cur, to) {
    if (!ORDER_STATUSES.includes(to)) return { ok: false, error: "非法状态：" + to };
    if (to === cur) return { ok: false, error: "状态未变化（当前已是 " + cur + "）" };
    return { ok: true, cur, to };
  }
  // 单条状态流转：校验后更新状态并追加 statusHistory 留痕
  async function setStatus(id, to, note) {
    const all = await OS.store.list();
    const doc = (all || []).find(d => d.id === id && d.type === "order");
    if (!doc) return { ok: false, error: "订单不存在" };
    const cur = ORDER_STATUSES.includes(doc.data.status) ? doc.data.status : "待处理";
    const p = planStatus(cur, to);
    if (!p.ok) return { ok: false, error: p.error };
    const hist = ((doc.data && doc.data.statusHistory) || []).concat([
      { status: p.to, ts: Date.now(), note: String(note == null ? "" : note).trim() }
    ]);
    doc.data = Object.assign({}, doc.data, { status: p.to, statusHistory: hist });
    doc.updatedAt = Date.now();
    await OS.store.put(doc);
    return { ok: true, doc, plan: p };
  }

  // 详情数据（结构化，供详情面板/DOM 使用）。纯逻辑：不转义、金额数字
  function detailData(doc) {
    const d = (doc && doc.data) || {};
    return {
      id: doc ? doc.id : "", customer: d.customer, amount: normAmount(d.amount),
      status: d.status, note: d.note, createdAt: doc ? doc.createdAt : 0, updatedAt: doc ? doc.updatedAt : 0,
      history: (d.statusHistory || []).map(h => ({ status: h.status, ts: h.ts, note: h.note }))
    };
  }
  // 单条详情：返回规格化详情对象（含状态流转历史）
  async function detail(id) {
    const all = await OS.store.list();
    const doc = (all || []).find(d => d.id === id && d.type === "order");
    if (!doc) return { ok: false, error: "订单不存在" };
    return { ok: true, data: detailData(doc) };
  }

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
        <div class="pt-name">订单列表
          <span class="batch-tools" hidden>
            <span class="muted" data-bc>已选 0 项</span>
            <button class="btn tiny danger" data-batch-del>批量删除</button>
          </span>
        </div>
        ${rows.length
          ? `<table class="biz-table">
              <thead><tr><th><input type="checkbox" data-check-all title="全选" /></th><th>客户</th><th>金额</th><th>状态</th><th>创建时间</th><th></th></tr></thead>
              <tbody>
                ${rows.map(r => `
                  <tr data-order-id="${r.id}">
                    <td><input type="checkbox" data-check="${r.id}" title="选择" /></td>
                    <td>${esc(r.data.customer)}</td>
                    <td>${fmtMoney(r.data.amount)}</td>
                    <td>
                      <select class="ord-st" data-status="${r.id}" title="流转状态"
                        >${ORDER_STATUSES.map(st =>
                          `<option value="${st}"${st === r.data.status ? " selected" : ""}>${esc(st)}</option>`
                        ).join("")}</select>
                    </td>
                    <td class="muted">${fmtDate(r.createdAt)}</td>
                    <td><button class="btn tiny" data-detail="${r.id}">详情</button><button class="btn tiny danger" data-del="${r.id}">删除</button></td>
                  </tr>`).join("")}
              </tbody>
            </table>`
          : `<div class="panel-empty">暂无订单。使用上方表单新建第一笔订单。</div>`}
      </div>
      <div class="detail-host" data-detail-host hidden></div>`;

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

    // 单条状态流转：下拉改状态 → 校验留痕 → 刷新
    el.querySelectorAll("[data-status]").forEach(sel => {
      sel.addEventListener("change", async () => {
        const r = await setStatus(sel.dataset.status, sel.value);
        if (OS.toast) OS.toast(r.error || ("状态已更新为" + r.plan.to), "");
        await render(el);
      });
    });

    // 详情展开：填充详情面板并显示；含状态流转时间线
    el.querySelectorAll("[data-detail]").forEach(b => b.addEventListener("click", async () => {
      const r = await detail(b.dataset.detail);
      const host = el.querySelector("[data-detail-host]");
      if (!r.ok) { if (OS.toast) OS.toast(r.error, ""); return; }
      host.innerHTML = orderDetailHTML(r.data);
      host.hidden = false;
      const c = host.querySelector("[data-detail-close]");
      if (c) c.addEventListener("click", () => { host.hidden = true; host.innerHTML = ""; });
    }));

    // 批量勾选 + 批量删除
    if (OS.biz.common) OS.biz.common.bindBatchTools(el, { batchFn: batchRemove, reload: () => render(el) });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // 详情面板 HTML
  function orderDetailHTML(d) {
    const hist = (d.history || []).map((h, i) =>
      `<li>${i + 1}. <b>${esc(h.status)}</b> · ${fmtDate(h.ts)}${h.note ? " · " + esc(h.note) : ""}</li>`).join("");
    return `<div class="panel-card" style="margin-top:14px">
      <div class="pt-name">订单详情 <button class="btn tiny" data-detail-close>收起</button></div>
      <table class="kv">
        <tr><th>客户</th><td>${esc(d.customer)}</td></tr>
        <tr><th>金额</th><td>${fmtMoney(d.amount)}</td></tr>
        <tr><th>状态</th><td>${esc(d.status)}</td></tr>
        <tr><th>备注</th><td>${esc(d.note || "—")}</td></tr>
        <tr><th>创建时间</th><td>${fmtDate(d.createdAt)}</td></tr>
        <tr><th>最近更新</th><td>${fmtDate(d.updatedAt)}</td></tr>
      </table>
      <div class="pt-name" style="margin-top:8px">状态流转 <span class="muted">${(d.history || []).length} 次</span></div>
      ${hist ? `<ul class="detail-list">${hist}</ul>` : `<p class="muted">暂无状态变更。</p>`}
    </div>`;
  }

  OS.biz = OS.biz || {};
  OS.biz.orders = {
    ORDER_STATUSES, DEFAULT_AMOUNT,
    validateOrder, summarize, list, create, remove, batchRemove, planStatus, setStatus, detailData, detail, render, fmtMoney, fmtDate
  };
})(window);