/* ============================================================
   绿角犀 Office · 业务板块：库存
   库存商品台账：doc(type="inventory") 存于 IndexedDB/本地存储
   模型：{ name, qty, safety(安全库存), unit, note }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  // ---------- 纯逻辑（可单测） ----------
  function normInt(v) {
    const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
    return (Number.isInteger(n) && n >= 0) ? n : null;
  }
  function validateItem(f) {
    f = f || {};
    const errors = [];
    const name = String(f.name == null ? "" : f.name).trim();
    if (!name) errors.push("请填写品名");
    const qty = normInt(f.qty);
    if (qty === null) errors.push("数量需为非负整数");
    const safety = normInt(f.safety);
    if (safety === null) errors.push("安全库存需为非负整数");
    // 低库存不拒绝创建（需能录入偏低/缺货品项以展示预警）
    return { ok: errors.length === 0, errors, name, qty, safety,
      unit: String(f.unit == null ? "" : f.unit).trim(), note: String(f.note || "").trim() };
  }
  function summarize(list) {
    let totalKinds = 0, totalQty = 0, lowCount = 0;
    (list || []).forEach(d => {
      totalKinds++;
      totalQty += normInt(d.qty) || 0;
      const s = normInt(d.safety) || 0;
      if (s > 0 && (normInt(d.qty) || 0) < s) lowCount++;
    });
    return { totalKinds, totalQty, lowCount };
  }

  // ---------- 数据访问 ----------
  async function list() {
    const all = await OS.store.list();
    return (all || []).filter(d => d.type === "inventory")
      .sort((a, b) => (a.data.name || "").localeCompare(b.data.name || "", "zh"));
  }
  async function create(fields) {
    const v = validateItem(fields);
    if (!v.ok) return { error: v.errors.join("；") };
    const now = Date.now();
    const doc = {
      id: OS.util.uid("inv"), type: "inventory", name: "库存·" + v.name,
      data: { name: v.name, qty: v.qty, safety: v.safety, unit: v.unit, note: v.note },
      createdAt: now, updatedAt: now, compat: "A"
    };
    await OS.store.put(doc);
    return { ok: true, doc };
  }
  async function remove(id) { await OS.store.remove(id); }

  // ---------- DOM 渲染 ----------
  async function render(el) {
    if (!el) return;
    const rows = await list();
    const s = summarize(rows);
    el.innerHTML = `
      <div class="panel-head"><h2>库存</h2><span class="muted">商品与库存台账 · 本地存储</span></div>
      <div class="panel-grid">
        <div class="panel-card"><div class="pt-name">品项</div><div class="pt-desc">${s.totalKinds}</div></div>
        <div class="panel-card"><div class="pt-name">库存总量</div><div class="pt-desc">${s.totalQty}</div></div>
        <div class="panel-card"><div class="pt-name">低于安全线</div><div class="pt-desc">${s.lowCount}</div></div>
      </div>
      <div class="panel-card" style="margin-top:14px">
        <div class="pt-name">新增品项</div>
        <div class="order-form">
          <input id="inv-name" placeholder="品名" />
          <input id="inv-qty" type="number" min="0" step="1" placeholder="数量" />
          <input id="inv-safety" type="number" min="0" step="1" placeholder="安全库存" />
          <input id="inv-unit" placeholder="单位（件/箱…）" />
          <input id="inv-note" placeholder="备注" />
          <button class="btn tiny primary" id="inv-add">＋ 新增品项</button>
        </div>
        <p id="inv-msg" class="form-msg" hidden></p>
      </div>
      <div class="panel-card" style="margin-top:14px">
        <div class="pt-name">库存台账</div>
        ${rows.length
          ? `<table class="biz-table">
              <thead><tr><th>品名</th><th>数量</th><th>安全库存</th><th>单位</th><th>状态</th><th></th></tr></thead>
              <tbody>
                ${rows.map(r => {
                  const low = normInt(r.data.safety) > 0 && (normInt(r.data.qty) || 0) < normInt(r.data.safety);
                  const zero = (normInt(r.data.qty) || 0) === 0;
                  const cls = zero ? "muted" : (low ? "warn" : "ok");
                  const label = zero ? "缺货" : (low ? "偏低" : "正常");
                  return `<tr data-inv-id="${r.id}">
                    <td>${esc(r.data.name)}</td>
                    <td>${normInt(r.data.qty) ?? 0}</td>
                    <td class="muted">${normInt(r.data.safety) ?? 0}</td>
                    <td class="muted">${esc(r.data.unit)}</td>
                    <td><span class="tag tag-${cls}">${label}</span></td>
                    <td><button class="btn tiny danger" data-del="${r.id}">删除</button></td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>`
          : `<div class="panel-empty">暂无库存品项。使用上方表单新增第一个品项。</div>`}
      </div>`;

    const msg = el.querySelector("#inv-msg");
    el.querySelector("#inv-add").addEventListener("click", async () => {
      const f = { name: el.querySelector("#inv-name").value, qty: el.querySelector("#inv-qty").value,
        safety: el.querySelector("#inv-safety").value, unit: el.querySelector("#inv-unit").value, note: el.querySelector("#inv-note").value };
      const r = await create(f);
      if (!r.ok) { msg.textContent = r.error; msg.hidden = false; return; }
      msg.hidden = true;
      ["#inv-name", "#inv-qty", "#inv-safety", "#inv-unit", "#inv-note"].forEach(id => el.querySelector(id).value = "");
      await render(el);
    });
    el.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (confirm("确定删除该品项？")) { await remove(b.dataset.del); await render(el); }
    }));
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  OS.biz = OS.biz || {};
  OS.biz.inventory = { validateItem, summarize, list, create, remove, render };
})(window);