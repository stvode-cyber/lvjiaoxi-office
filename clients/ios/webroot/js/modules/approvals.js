/* ============================================================
   绿角犀 Office · 业务板块：审批
   单据审批流：doc(type="approval") 存于 IndexedDB/本地存储
   模型：{ subject, kind(类型), applicant(申请人), status(待审批/已通过/已驳回), note }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  const APPROVAL_STATUSES = ["待审批", "已通过", "已驳回"];
  const APPROVAL_KINDS = ["请假", "报销", "采购", "用印", "其他"];

  // ---------- 纯逻辑（可单测） ----------
  function validateRequest(f) {
    f = f || {};
    const errors = [];
    const subject = String(f.subject == null ? "" : f.subject).trim();
    if (!subject) errors.push("请填写事由");
    const kind = APPROVAL_KINDS.includes(f.kind) ? f.kind : "其他";
    const applicant = String(f.applicant == null ? "" : f.applicant).trim();
    if (!applicant) errors.push("请填写申请人");
    const status = APPROVAL_STATUSES.includes(f.status) ? f.status : "待审批";
    return { ok: errors.length === 0, errors, subject, kind, applicant, status, note: String(f.note || "").trim() };
  }
  function summarize(list) {
    const byStatus = {}; APPROVAL_STATUSES.forEach(s => byStatus[s] = 0);
    (list || []).forEach(d => { const st = APPROVAL_STATUSES.includes(d.status) ? d.status : "待审批"; byStatus[st]++; });
    return { count: (list || []).length, byStatus, pending: byStatus["待审批"] };
  }

  // ---------- 数据访问 ----------
  async function list() {
    const all = await OS.store.list();
    return (all || []).filter(d => d.type === "approval")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  async function create(fields) {
    const v = validateRequest(fields);
    if (!v.ok) return { error: v.errors.join("；") };
    const now = Date.now();
    const doc = {
      id: OS.util.uid("apr"), type: "approval", name: "审批·" + v.subject,
      data: { subject: v.subject, kind: v.kind, applicant: v.applicant, status: v.status, note: v.note },
      createdAt: now, updatedAt: now, compat: "A"
    };
    await OS.store.put(doc);
    return { ok: true, doc };
  }
  async function update(id, patch) {
    const doc = await OS.store.get(id); if (!doc) return { error: "记录不存在" };
    const cur = doc.data.status;
    const next = patch.status;
    // 状态变更 → 追加 statusHistory 留痕
    if (next && next !== cur && APPROVAL_STATUSES.includes(next)) {
      doc.data = Object.assign({}, doc.data, patch, {
        statusHistory: ((doc.data && doc.data.statusHistory) || []).concat([{ status: next, ts: Date.now() }])
      });
    } else {
      doc.data = Object.assign({}, doc.data, patch);
    }
    await OS.store.put(doc);
    return { ok: true, doc };
  }
  async function remove(id) { await OS.store.remove(id); }

  // 单条审批详情：结构化返回（含状态流转历史）
  function detailData(doc) {
    const d = (doc && doc.data) || {};
    return {
      id: doc ? doc.id : "", subject: d.subject, kind: d.kind, applicant: d.applicant,
      status: d.status, note: d.note, createdAt: doc ? doc.createdAt : 0, updatedAt: doc ? doc.updatedAt : 0,
      history: (d.statusHistory || []).map(h => ({ status: h.status, ts: h.ts }))
    };
  }
  async function detail(id) {
    const all = await OS.store.list();
    const doc = (all || []).find(d => d.id === id && d.type === "approval");
    if (!doc) return { error: "记录不存在" };
    return { data: detailData(doc) };
  }

  // 批量删除：仅删除存在且 type=approval 的目标，返回缺失项（幂等安全，不误删其他类型）
  async function batchRemove(ids) {
    const all = await OS.store.list();
    const valid = new Set((all || []).filter(d => d.type === "approval").map(d => d.id));
    const targets = [...new Set((ids || []).filter(Boolean))];
    const present = targets.filter(id => valid.has(id));
    await Promise.all(present.map(id => OS.store.remove(id)));
    return { requested: targets.length, removed: present.length,
      missing: targets.filter(id => !valid.has(id)) };
  }

  // 批量流转：仅对待审批项生效（终态不再流转），返回跳过项
  async function batchSetStatus(ids, status) {
    const valid = APPROVAL_STATUSES.includes(status) && status !== "待审批";
    const targets = [...new Set((ids || []).filter(Boolean))];
    const all = await OS.store.list();
    const byId = {}; (all || []).forEach(d => { byId[d.id] = d; });
    let updated = 0;
    const skipped = [];
    for (const id of targets) {
      const d = byId[id];
      if (!d || d.type !== "approval") { skipped.push(id); continue; }
      if (d.data.status !== "待审批" || !valid) { skipped.push(id); continue; }
      d.data = Object.assign({}, d.data, { status, statusHistory: ((d.data && d.data.statusHistory) || []).concat([{ status, ts: Date.now() }]) });
      await OS.store.put(d);
      updated++;
    }
    return { requested: targets.length, updated, skipped };
  }

  // ---------- DOM 渲染 ----------
  async function render(el) {
    if (!el) return;
    const rows = await list();
    const s = summarize(rows);
    el.innerHTML = `
      <div class="panel-head"><h2>审批</h2><span class="muted">单据审批流 · 本地存储</span><button class="btn tiny" data-export>导出 CSV</button></div>
      <div class="panel-grid">
        <div class="panel-card"><div class="pt-name">待审批</div><div class="pt-desc">${s.pending}</div></div>
        <div class="panel-card"><div class="pt-name">已通过</div><div class="pt-desc">${s.byStatus["已通过"]}</div></div>
        <div class="panel-card"><div class="pt-name">已驳回</div><div class="pt-desc">${s.byStatus["已驳回"]}</div></div>
      </div>
      <div class="panel-card" style="margin-top:14px">
        <div class="pt-name">发起申请</div>
        <div class="order-form">
          <input id="apr-subject" placeholder="事由" />
          <select id="apr-kind">${APPROVAL_KINDS.map(k => `<option>${k}</option>`).join("")}</select>
          <input id="apr-applicant" placeholder="申请人" />
          <input id="apr-note" placeholder="备注（可选）" />
          <span></span><span></span>
          <button class="btn tiny primary" id="apr-add">＋ 提交申请</button>
        </div>
        <p id="apr-msg" class="form-msg" hidden></p>
      </div>
      <div class="panel-card" style="margin-top:14px">
        <div class="pt-name">审批列表
          <span class="batch-tools" hidden>
            <span class="muted" data-bc>已选 0 项</span>
            <button class="btn tiny" data-batch-pass>批量通过</button>
            <button class="btn tiny" data-batch-reject>批量驳回</button>
            <button class="btn tiny danger" data-batch-del>批量删除</button>
          </span>
        </div>
        ${rows.length
          ? `<table class="biz-table">
              <thead><tr><th><input type="checkbox" data-check-all title="全选" /></th><th>事由</th><th>类型</th><th>申请人</th><th>状态</th><th></th></tr></thead>
              <tbody>
                ${rows.map(r => `
                  <tr data-apr-id="${r.id}">
                    <td><input type="checkbox" data-check="${r.id}" title="选择" /></td>
                    <td>${esc(r.data.subject)}</td>
                    <td class="muted">${esc(r.data.kind)}</td>
                    <td>${esc(r.data.applicant)}</td>
                    <td><span class="tag tag-${tagCls(r.data.status)}">${esc(r.data.status)}</span></td>
                    <td>
                      <button class="btn tiny" data-detail="${r.id}">详情</button>
                      ${r.data.status === "待审批"
                        ? `<button class="btn tiny" data-act="pass" data-id="${r.id}">通过</button>
                           <button class="btn tiny danger" data-act="reject" data-id="${r.id}">驳回</button>`
                        : `<button class="btn tiny danger" data-del="${r.id}">删除</button>`}
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>`
          : `<div class="panel-empty">暂无审批记录。使用上方表单发起第一笔申请。</div>`}
      </div>
      <div class="detail-host" data-detail-host hidden></div>`;

    const msg = el.querySelector("#apr-msg");
    el.querySelector("#apr-add").addEventListener("click", async () => {
      const f = { subject: el.querySelector("#apr-subject").value, kind: el.querySelector("#apr-kind").value,
        applicant: el.querySelector("#apr-applicant").value, status: "待审批", note: el.querySelector("#apr-note").value };
      const r = await create(f);
      if (!r.ok) { msg.textContent = r.error; msg.hidden = false; return; }
      msg.hidden = true;
      ["#apr-subject", "#apr-applicant", "#apr-note"].forEach(id => el.querySelector(id).value = "");
      await render(el);
    });
    // 导出 CSV
    const ex = el.querySelector("[data-export]");
    if (ex && OS.export) ex.addEventListener("click", () =>
      OS.export.csv("审批.csv",
        ["事由", "类型", "申请人", "状态", "备注"],
        rows.map(r => [r.data.subject, r.data.kind, r.data.applicant, r.data.status, r.data.note])));

    el.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async () => {
      await update(b.dataset.id, { status: b.dataset.act === "pass" ? "已通过" : "已驳回" });
      await render(el);
    }));
    el.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (confirm("确定删除该记录？")) { await remove(b.dataset.del); await render(el); }
    }));

    // 详情展开：填充详情面板并显示；含状态流转时间线
    el.querySelectorAll("[data-detail]").forEach(b => b.addEventListener("click", async () => {
      const r = await detail(b.dataset.detail);
      const host = el.querySelector("[data-detail-host]");
      if (!r.data) { if (OS.toast) OS.toast(r.error, ""); return; }
      host.innerHTML = approvalDetailHTML(r.data);
      host.hidden = false;
      const c = host.querySelector("[data-detail-close]");
      if (c) c.addEventListener("click", () => { host.hidden = true; host.innerHTML = ""; });
    }));

    // 批量勾选：批量通过 / 批量驳回 / 批量删除
    if (OS.biz.common) OS.biz.common.bindBatchTools(el, {
      batchFn: batchRemove,
      reload: () => render(el),
      actions: [
        { sel: "[data-batch-pass]", confirm: "确定通过选中的 %n 项？",
          run: async ids => {
            const r = await batchSetStatus(ids, "已通过");
            if (OS.toast) OS.toast("已通过 " + r.updated + " 项" + (r.skipped.length ? "；跳过终态/无效 " + r.skipped.length + " 项" : ""), "");
          } },
        { sel: "[data-batch-reject]", confirm: "确定驳回选中的 %n 项？",
          run: async ids => {
            const r = await batchSetStatus(ids, "已驳回");
            if (OS.toast) OS.toast("已驳回 " + r.updated + " 项" + (r.skipped.length ? "；跳过终态/无效 " + r.skipped.length + " 项" : ""), "");
          } }
      ]
    });
  }

  function tagCls(status) {
    return status === "已通过" ? "ok" : (status === "已驳回" ? "warn" : "muted");
  }
  // 详情面板 HTML
  function approvalDetailHTML(d) {
    const hist = (d.history || []).map((h, i) =>
      `<li>${i + 1}. <b>${esc(h.status)}</b> · ${fmtTime(h.ts)}</li>`).join("");
    return `<div class="panel-card" style="margin-top:14px">
      <div class="pt-name">审批详情 <button class="btn tiny" data-detail-close>收起</button></div>
      <table class="kv">
        <tr><th>事由</th><td>${esc(d.subject)}</td></tr>
        <tr><th>类型</th><td>${esc(d.kind)}</td></tr>
        <tr><th>申请人</th><td>${esc(d.applicant)}</td></tr>
        <tr><th>状态</th><td>${esc(d.status)}</td></tr>
        <tr><th>备注</th><td>${esc(d.note || "—")}</td></tr>
        <tr><th>创建时间</th><td>${fmtTime(d.createdAt)}</td></tr>
        <tr><th>最近更新</th><td>${fmtTime(d.updatedAt)}</td></tr>
      </table>
      <div class="pt-name" style="margin-top:8px">状态流转 <span class="muted">${(d.history || []).length} 次</span></div>
      ${hist ? `<ul class="detail-list">${hist}</ul>` : `<p class="muted">暂无状态变更。</p>`}
    </div>`;
  }
  function fmtTime(t) {
    if (!t) return "—";
    const d = new Date(t);
    return (d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) +
      " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2));
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  OS.biz = OS.biz || {};
  OS.biz.approvals = { APPROVAL_STATUSES, APPROVAL_KINDS, validateRequest, summarize, list, create, update, remove, batchRemove, batchSetStatus, detailData, detail, render };
})(window);