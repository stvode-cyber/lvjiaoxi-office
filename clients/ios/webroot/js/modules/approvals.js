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
    doc.data = Object.assign({}, doc.data, patch);
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
      <div class="panel-head"><h2>审批</h2><span class="muted">单据审批流 · 本地存储</span></div>
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
        <div class="pt-name">审批列表</div>
        ${rows.length
          ? `<table class="biz-table">
              <thead><tr><th>事由</th><th>类型</th><th>申请人</th><th>状态</th><th></th></tr></thead>
              <tbody>
                ${rows.map(r => `
                  <tr data-apr-id="${r.id}">
                    <td>${esc(r.data.subject)}</td>
                    <td class="muted">${esc(r.data.kind)}</td>
                    <td>${esc(r.data.applicant)}</td>
                    <td><span class="tag tag-${tagCls(r.data.status)}">${esc(r.data.status)}</span></td>
                    <td>
                      ${r.data.status === "待审批"
                        ? `<button class="btn tiny" data-act="pass" data-id="${r.id}">通过</button>
                           <button class="btn tiny danger" data-act="reject" data-id="${r.id}">驳回</button>`
                        : `<button class="btn tiny danger" data-del="${r.id}">删除</button>`}
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>`
          : `<div class="panel-empty">暂无审批记录。使用上方表单发起第一笔申请。</div>`}
      </div>`;

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
    el.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async () => {
      await update(b.dataset.id, { status: b.dataset.act === "pass" ? "已通过" : "已驳回" });
      await render(el);
    }));
    el.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (confirm("确定删除该记录？")) { await remove(b.dataset.del); await render(el); }
    }));
  }

  function tagCls(status) {
    return status === "已通过" ? "ok" : (status === "已驳回" ? "warn" : "muted");
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  OS.biz = OS.biz || {};
  OS.biz.approvals = { APPROVAL_STATUSES, APPROVAL_KINDS, validateRequest, summarize, list, create, update, remove, render };
})(window);