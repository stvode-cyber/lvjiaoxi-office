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

  // 批量删除：仅删除存在且 type=inventory 的目标，返回缺失项（幂等安全，不误删其他类型）
  async function batchRemove(ids) {
    const all = await OS.store.list();
    const valid = new Set((all || []).filter(d => d.type === "inventory").map(d => d.id));
    const targets = [...new Set((ids || []).filter(Boolean))];
    const present = targets.filter(id => valid.has(id));
    await Promise.all(present.map(id => OS.store.remove(id)));
    return { requested: targets.length, removed: present.length,
      missing: targets.filter(id => !valid.has(id)) };
  }

  // 调整量：允许负整数（出库），拒绝 0 / 非整数
  function normDelta(v) {
    const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
    return (Number.isInteger(n) && n !== 0) ? n : null;
  }
  // 出入库计划：纯逻辑（可单测）。delta 正=入库，负=出库；拒绝出库后库存为负
  function planAdjust(cur, delta) {
    const c = normInt(cur);
    if (c === null) return { ok: false, error: "当前数量无效" };
    const n = normDelta(delta);
    if (n === null) return { ok: false, error: "调整量需为非 0 整数" };
    const next = c + n;
    if (next < 0) return { ok: false, error: "出库超出当前库存（当前 " + c + "）" };
    return { ok: true, cur: c, delta: n, next };
  }
  // 出入库：校验后更新数量并追加流水记录（history）
  async function adjustQty(id, delta, note) {
    const all = await OS.store.list();
    const doc = (all || []).find(d => d.id === id && d.type === "inventory");
    if (!doc) return { ok: false, error: "品项不存在" };
    const p = planAdjust(doc.data.qty, delta);
    if (!p.ok) return { ok: false, error: p.error };
    const hist = ((doc.data && doc.data.history) || []).concat([
      { ts: Date.now(), delta: p.delta, cur: p.next, note: String(note == null ? "" : note).trim() }
    ]);
    doc.data = Object.assign({}, doc.data, { qty: p.next, history: hist });
    doc.updatedAt = Date.now();
    await OS.store.put(doc);
    return { ok: true, doc, plan: p };
  }

  // 抵扣汇总：仅统计未撤销的流水（入库+/出库−）
  function summarizeLog(hist) {
    let inSum = 0, outSum = 0, revoked = 0;
    (hist || []).forEach(h => {
      if (h.revoked) { revoked++; return; }
      const n = normDelta(h.delta);
      if (n === null) return;
      if (n > 0) inSum += n; else outSum += -n;
    });
    return { inSum, outSum, valid: (hist || []).length - revoked };
  }
  // 流水筛选：kind='in'|'out'|''全部；from/to 时间戳毫秒范围；q 备注关键词（纯逻辑，可单测）
  function filterLog(hist, o) {
    o = o || {};
    const kind = (o.kind === "in" || o.kind === "out") ? o.kind : "";
    const from = Number(o.from); const f = isFinite(from) ? from : 0;
    const to = Number(o.to); const t = isFinite(to) ? to : Infinity;
    const q = String(o.q == null ? "" : o.q).trim();
    return (hist || []).filter(h => {
      const n = normDelta(h.delta);
      if (kind && (kind === "in" ? !(n > 0) : !(n < 0))) return false;
      const ts = (h.ts || 0);
      if (ts < f || ts > t) return false;
      if (q && String(h.note || "").indexOf(q) < 0) return false;
      return true;
    });
  }
  // 分页：items 为筛选后数组（纯逻辑，可单测）。pageSize 缺省 10，分页越界自动夹取
  function pageLog(items, o) {
    o = o || {};
    const size = Number(o.pageSize) >= 1 ? Math.floor(Number(o.pageSize)) : 10;
    const total = (items || []).length;
    const pages = Math.max(1, Math.ceil(total / size));
    let p = Number(o.page) >= 1 ? Math.floor(Number(o.page)) : 1;
    if (p > pages) p = pages;
    const slice = (items || []).slice((p - 1) * size, p * size);
    return { items: slice, page: p, pageSize: size, total, pages, offset: (p - 1) * size };
  }
  // 库存详情：结构化返回（含出入库流水 + 汇总）。纯逻辑：不转义、数量整数
  function detailData(doc) {
    const d = (doc && doc.data) || {};
    const hist = (d.history || []).map(h => ({ delta: normDelta(h.delta), cur: normInt(h.cur), note: h.note, ts: h.ts, revoked: !!h.revoked }));
    const sum = summarizeLog(hist);
    return {
      id: doc ? doc.id : "", name: d.name, qty: normInt(d.qty), safety: normInt(d.safety), unit: d.unit,
      status: d.status, note: d.note, createdAt: doc ? doc.createdAt : 0, updatedAt: doc ? doc.updatedAt : 0,
      history: hist, inSum: sum.inSum, outSum: sum.outSum, valid: sum.valid
    };
  }
  // 单条详情（含流水）
  async function detail(id) {
    const all = await OS.store.list();
    const doc = (all || []).find(d => d.id === id && d.type === "inventory");
    if (!doc) return { ok: false, error: "品项不存在" };
    return { ok: true, data: detailData(doc) };
  }
  // 撤销最近一笔未撤销流水（mark revoked + 追加反向记录，保留审计痕迹）
  async function undoAdjust(id) {
    const all = await OS.store.list();
    const doc = (all || []).find(d => d.id === id && d.type === "inventory");
    if (!doc) return { ok: false, error: "品项不存在" };
    const hist = ((doc.data && doc.data.history) || []);
    let idx = -1;
    for (let i = hist.length - 1; i >= 0; i--) { if (!hist[i].revoked) { idx = i; break; } }
    if (idx < 0) return { ok: false, error: "无可撤销的流水" };
    const target = hist[idx];
    const tdelta = normDelta(target.delta);
    const prev = normInt(target.cur) - tdelta;
    const revoked = hist.map((h, i) => i === idx ? Object.assign({}, h, { revoked: true }) : h);
    const record = { ts: Date.now(), delta: -tdelta, cur: prev,
      note: "撤销" + (tdelta > 0 ? "入库" : "出库") + " " + Math.abs(tdelta), revoked: true, revokeOf: target.ts };
    doc.data = Object.assign({}, doc.data, { qty: prev, history: revoked.concat([record]) });
    doc.updatedAt = Date.now();
    await OS.store.put(doc);
    return { ok: true, doc, prev, delta: tdelta };
  }

  // ---------- DOM 渲染 ----------
  async function render(el) {
    if (!el) return;
    const rows = await list();
    const s = summarize(rows);
    el.innerHTML = `
      <div class="panel-head"><h2>库存</h2><span class="muted">商品与库存台账 · 本地存储</span><button class="btn tiny" data-export>导出 CSV</button></div>
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
        <div class="pt-name">库存台账
          <span class="batch-tools" hidden>
            <span class="muted" data-bc>已选 0 项</span>
            <button class="btn tiny danger" data-batch-del>批量删除</button>
          </span>
        </div>
        ${rows.length
          ? `<table class="biz-table">
              <thead><tr><th><input type="checkbox" data-check-all title="全选" /></th><th>品名</th><th>数量</th><th>安全库存</th><th>单位</th><th>状态</th><th></th></tr></thead>
              <tbody>
                ${rows.map(r => {
                  const low = normInt(r.data.safety) > 0 && (normInt(r.data.qty) || 0) < normInt(r.data.safety);
                  const zero = (normInt(r.data.qty) || 0) === 0;
                  const cls = zero ? "muted" : (low ? "warn" : "ok");
                  const label = zero ? "缺货" : (low ? "偏低" : "正常");
                  return `<tr data-inv-id="${r.id}">
                    <td><input type="checkbox" data-check="${r.id}" title="选择" /></td>
                    <td>${esc(r.data.name)}</td>
                    <td>${normInt(r.data.qty) ?? 0}</td>
                    <td class="muted">${normInt(r.data.safety) ?? 0}</td>
                    <td class="muted">${esc(r.data.unit)}</td>
                    <td><span class="tag tag-${cls}">${label}</span></td>
                    <td class="inv-ops">
                      <input class="inv-adj" type="number" min="0" step="1" placeholder="数量" title="出入库数量" />
                      <button class="btn tiny" data-adjust="in" data-id="${r.id}">入库</button>
                      <button class="btn tiny danger" data-adjust="out" data-id="${r.id}">出库</button>
                      <button class="btn tiny" data-log="${r.id}">流水</button>
                      <button class="btn tiny danger" data-del="${r.id}">删除</button>
                    </td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>`
          : `<div class="panel-empty">暂无库存品项。使用上方表单新增第一个品项。</div>`}
      </div>
      <div class="detail-host" data-detail-host hidden></div>`;

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
    // 导出 CSV
    const ex = el.querySelector("[data-export]");
    if (ex && OS.export) ex.addEventListener("click", () =>
      OS.export.csv("库存.csv",
        ["品名", "数量", "安全库存", "单位", "备注"],
        rows.map(r => [r.data.name, r.data.qty, r.data.safety, r.data.unit, r.data.note])));

    el.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (confirm("确定删除该品项？")) { await remove(b.dataset.del); await render(el); }
    }));

    // 出/入库：读行内数量输入，in=+值 / out=-值
    el.querySelectorAll("[data-adjust]").forEach(b => b.addEventListener("click", async () => {
      const tr = b.closest("tr");
      const v = tr ? (tr.querySelector(".inv-adj") || {}).value : "";
      const delta = b.dataset.adjust === "in" ? v : ("-" + v);
      const r = await adjustQty(b.dataset.id, delta);
      if (OS.toast) OS.toast(r.error || (b.dataset.adjust === "in" ? "已入库，当前 " + r.plan.next : "已出库，当前 " + r.plan.next), "");
      await render(el);
    }));

    // 流水明细：打开面板（可撤销最近一笔）
    el.querySelectorAll("[data-log]").forEach(b => b.addEventListener("click", () =>
      openLog(el.querySelector("[data-detail-host]"), b.dataset.log)));

    // 批量勾选 + 批量删除
    if (OS.biz.common) OS.biz.common.bindBatchTools(el, { batchFn: batchRemove, reload: () => render(el) });
  }

  // 流水面板状态（筛选 + 分页），供重填时保持不变
  const LOG_STATE = { id: null, kind: "", from: "", to: "", q: "", page: 1 };
  // 打开流水面板：重置筛选分页并按 id 渲染
  async function openLog(host, id) {
    LOG_STATE.id = id; LOG_STATE.kind = ""; LOG_STATE.from = ""; LOG_STATE.to = ""; LOG_STATE.q = ""; LOG_STATE.page = 1;
    host.innerHTML = "";
    host.hidden = false;
    await renderLogPanel(host);
  }
  // 渲染流水面板（含筛选 + 分页 + 撤销），事件统一在此绑定
  async function renderLogPanel(host) {
    const r = await detail(LOG_STATE.id);
    if (!r.ok) { if (OS.toast) OS.toast(r.error, ""); return; }
    const d = r.data;
    const filtered = filterLog(d.history, {
      kind: LOG_STATE.kind,
      from: LOG_STATE.from ? new Date(LOG_STATE.from).getTime() : 0,
      to: LOG_STATE.to ? new Date(LOG_STATE.to).getTime() : Infinity,
      q: LOG_STATE.q
    });
    const pg = pageLog(filtered, { page: LOG_STATE.page, pageSize: 10 });
    host.innerHTML = logHTML(d, LOG_STATE, filtered.length, pg);
    const c = host.querySelector("[data-detail-close]");
    if (c) c.addEventListener("click", () => { host.hidden = true; host.innerHTML = ""; });
    const ex = host.querySelector("[data-export-log]");
    if (ex) ex.addEventListener("click", () => exportLogCsv(LOG_STATE.id, {
      kind: LOG_STATE.kind,
      from: LOG_STATE.from ? new Date(LOG_STATE.from).getTime() : 0,
      to: LOG_STATE.to ? new Date(LOG_STATE.to).getTime() : Infinity,
      q: LOG_STATE.q
    }));
    host.querySelector("[data-filter]").addEventListener("click", () => {
      LOG_STATE.kind = host.querySelector("[data-f-kind]").value;
      LOG_STATE.from = host.querySelector("[data-f-from]").value;
      LOG_STATE.to = host.querySelector("[data-f-to]").value;
      LOG_STATE.q = host.querySelector("[data-f-q]").value;
      LOG_STATE.page = 1;
      renderLogPanel(host);
    });
    host.querySelector("[data-reset]").addEventListener("click", () => {
      LOG_STATE.kind = ""; LOG_STATE.from = ""; LOG_STATE.to = ""; LOG_STATE.q = ""; LOG_STATE.page = 1;
      renderLogPanel(host); // 清空输入由重填完成
    });
    const prev = host.querySelector("[data-page-prev]"), next = host.querySelector("[data-page-next]");
    if (prev) prev.addEventListener("click", () => { if (LOG_STATE.page > 1) { LOG_STATE.page--; renderLogPanel(host); } });
    if (next) next.addEventListener("click", () => { if (LOG_STATE.page < pg.pages) { LOG_STATE.page++; renderLogPanel(host); } });
    const u = host.querySelector("[data-undo]");
    if (u) u.addEventListener("click", async () => {
      const rr = await undoAdjust(LOG_STATE.id);
      if (OS.toast) OS.toast(rr.ok ? ("已撤销，当前 " + rr.prev) : rr.error, "");
      await renderLogPanel(host); // 重填面板，保留筛选与页码
    });
  }
  // 流水面板 HTML（st=筛选状态，todo=筛选后总条数，pg=分页结果）
  function logHTML(d, st, todo, pg) {
    const rows = [...(pg.items || [])].reverse().map((h, i) => {
      const t = h.delta > 0 ? "入库" : "出库";
      return `<tr class="${h.revoked ? "muted" : ""}">
        <td>${pg.offset + pg.items.length - i}</td>
        <td>${t}</td>
        <td>${h.delta > 0 ? "+" : ""}${h.delta}</td>
        <td>${h.cur}</td>
        <td>${esc(h.note || "—")}</td>
        <td class="muted">${fmtTime(h.ts)}</td>
        <td>${h.revoked ? `<span class="tag tag-muted">已撤销</span>` : ""}</td>
      </tr>`;
    }).join("");
    return `<div class="panel-card" style="margin-top:14px">
      <div class="pt-name">出入库流水 · ${esc(d.name)} <button class="btn tiny" data-export-log>导出 CSV</button> <button class="btn tiny" data-detail-close>收起</button></div>
      <table class="kv">
        <tr><th>当前库存</th><td>${d.qty} ${esc(d.unit || "")}</td></tr>
        <tr><th>累计入库</th><td class="ok">+${d.inSum}</td></tr>
        <tr><th>累计出库</th><td class="warn">-${d.outSum}</td></tr>
        <tr><th>有效流水</th><td class="muted">${d.valid} 笔${(d.history || []).length - d.valid ? " · 含已撤销 " + ((d.history || []).length - d.valid) + " 笔" : ""}</td></tr>
        <tr><th>备注</th><td>${esc(d.note || "—")}</td></tr>
      </table>
      <div class="log-filter" style="margin-top:8px">
        <select data-f-kind>
          <option value="">全部类型</option>
          <option value="in" ${st.kind === "in" ? "selected" : ""}>入库</option>
          <option value="out" ${st.kind === "out" ? "selected" : ""}>出库</option>
        </select>
        <input data-f-from type="date" value="${st.from}" title="开始日期" />
        <input data-f-to type="date" value="${st.to}" title="结束日期" />
        <input data-f-q placeholder="备注关键词" value="${esc(st.q)}" />
        <button class="btn tiny primary" data-filter>筛选</button>
        <button class="btn tiny" data-reset>重置</button>
      </div>
      <div class="pt-name" style="margin-top:8px">明细（共 ${todo} 条，第 ${pg.page}/${pg.pages} 页）
        <button class="btn tiny" data-page-prev${pg.page > 1 ? "" : " disabled"}>上一页</button>
        <button class="btn tiny" data-page-next${pg.page < pg.pages ? "" : " disabled"}>下一页</button>
        <button class="btn tiny" data-undo${d.valid ? "" : " disabled"}>撤销最近一笔</button>
      </div>
      ${rows ? `<table class="biz-table"><thead><tr><th>#</th><th>类型</th><th>数量</th><th>结存</th><th>备注</th><th>时间</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="muted">${pg.total === 0 && d.history && d.history.length ? "无匹配筛选的流水。" : "暂无出入库流水。"}</p>`}
    </div>`;
  }
  // ---------- 流水导出 CSV ----------
  const LOG_CSV_HEADER = ["#", "类型", "数量", "结存", "备注", "时间", "状态"];
  // 流水 → CSV 行（纯逻辑，可单测）：按时间正序输出（最早在顶、行号递增）
  function logCsvRows(hist) {
    const sorted = [...(hist || [])].sort((a, b) => ((a && a.ts) || 0) - ((b && b.ts) || 0));
    return sorted.map((h, i) => [
      String(i + 1), h.delta > 0 ? "入库" : "出库",
      (h.delta > 0 ? "+" : "") + h.delta,
      h.cur == null ? "" : String(h.cur),
      String(h.note == null ? "" : h.note),
      fmtTime(h.ts),
      h.revoked ? "已撤销" : ""
    ]);
  }
  // 导出流水 CSV：读取明细 → 按 opts 筛选（复用 filterLog，kind/from/to/q 毫秒）→ 写 CSV
  async function exportLogCsv(id, opts) {
    if (!OS.export || !OS.export.csv) { if (OS.toast) OS.toast("当前环境不支持 CSV 导出", ""); return { ok: false }; }
    const r = await detail(id);
    if (!r.ok) { if (OS.toast) OS.toast(r.error, ""); return { ok: false }; }
    const d = r.data;
    const filtered = filterLog(d.history, opts || {});
    OS.export.csv("库存流水·" + (d.name || "品项") + ".csv", LOG_CSV_HEADER, logCsvRows(filtered));
    return { ok: true, total: filtered.length, name: d.name };
  }
  // 低库存/缺货品项聚合（纯逻辑可单测）：低于安全线或缺货 → [{id,name,qty,safety,unit,severity}]
  async function lowStock() {
    const rows = await list();
    const out = [];
    (rows || []).forEach(d => {
      const dd = d.data || {};
      const name = String(dd.name || "");
      const qty = normInt(dd.qty);
      const safety = normInt(dd.safety) || 0;
      const q = qty == null ? 0 : qty;
      if (safety > 0 && q < safety) {
        out.push({ id: d.id, name, qty: q, safety, unit: String(dd.unit || ""), severity: q === 0 ? "缺货" : "偏低" });
      }
    });
    // 缺货优先，其次按品名
    out.sort((a, b) => (a.severity === "缺货" ? 0 : 1) - (b.severity === "缺货" ? 0 : 1) || a.name.localeCompare(b.name, "zh"));
    return out;
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
  OS.biz.inventory = { validateItem, summarize, list, create, remove, batchRemove, planAdjust, adjustQty, summarizeLog, filterLog, pageLog, detailData, detail, undoAdjust, logCsvRows, exportLogCsv, lowStock, render };
})(window);