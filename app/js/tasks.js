/* ============================================================
   绿角犀 Office · 任务进程管理器 (OS.Tasks)
   后台异步任务调度 + 进度可视化（仿 Office 保存/上传状态）
   - OS.Tasks.run(title, fn(reporter), opts) 启动一个任务
   - reporter.step(label, p) / reporter.progress(p) / reporter.cancel()
   - 状态栏"任务"入口 + 右侧滑出面板列出任务卡与进度条
   - 支持 indeterminate（无总进度）、可取消、完成/错误 toast
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  const tasks = [];          // 全部任务（含已完成，用于面板回溯）
  let panelEl = null, listEl = null, emptyEl = null;
  let badgeEl = null;        // 状态栏任务按钮容器
  let seq = 0;

  function esc(s) { return OS.util ? OS.util.escapeHtml(s || "") : String(s || ""); }
  function activeCount() { return tasks.filter(t => t.status === "running" || t.status === "queued").length; }
  function get(id) { return tasks.find(t => t.id === id); }

  /* ---------------- DOM ---------------- */
  function ensureDom() {
    if (panelEl) return;
    panelEl = document.createElement("aside");
    panelEl.className = "task-panel";
    panelEl.id = "task-panel";
    panelEl.hidden = true;
    panelEl.innerHTML =
      `<div class="task-panel-head">
         <span class="task-panel-title">${OS.icons.svg("tasks", 18)}<span>任务进程</span></span>
         <button class="icon-btn" id="task-panel-close" title="收起">${OS.icons.svg("close", 16)}</button>
       </div>
       <div class="task-list" id="task-list"></div>
       <div class="task-empty" id="task-empty">${OS.icons.svg("tasks", 26)}<span>暂无进行中的任务</span></div>`;
    document.body.appendChild(panelEl);
    listEl = panelEl.querySelector("#task-list");
    emptyEl = panelEl.querySelector("#task-empty");
    panelEl.querySelector("#task-panel-close").onclick = hidePanel;
  }

  function showPanel() { ensureDom(); panelEl.hidden = false; render(); }
  function hidePanel() { if (panelEl) panelEl.hidden = true; }
  function togglePanel() { panelEl && !panelEl.hidden ? hidePanel() : showPanel(); }

  function statusLabel(s) {
    return { running: "进行中", done: "已完成", error: "失败", canceled: "已取消", queued: "排队中" }[s] || s;
  }

  function render() {
    if (!listEl) return;
    const show = tasks.slice(-14).reverse();   // 最近 14 个，新的在上
    listEl.innerHTML = "";
    show.forEach(t => listEl.appendChild(card(t)));
    emptyEl.hidden = show.length > 0;
    updateBadge();
  }

  function card(t) {
    const el = document.createElement("div");
    el.className = "task-card task-" + t.status;
    const indeterminate = t.progress == null;
    const pct = indeterminate ? "" : Math.round(t.progress * 100) + "%";
    el.innerHTML =
      `<div class="task-card-top">
         <span class="task-title">${esc(t.title)}</span>
         <span class="task-status task-status-${t.status}">${statusLabel(t.status)}</span>
       </div>
       <div class="task-step">${esc(t.step || "")}</div>
       <div class="task-bar"><div class="task-bar-fill ${indeterminate ? "indeterminate" : ""}" style="${indeterminate ? "" : "width:" + (t.progress * 100) + "%"}"></div></div>
       <div class="task-meta">
         <span class="task-pct">${pct}</span>
         ${t.cancelable && t.status === "running" ? `<button class="task-cancel" data-cancel="${t.id}">取消</button>` : ""}
       </div>`;
    const cb = el.querySelector("[data-cancel]");
    if (cb) cb.onclick = () => cancel(t.id);
    return el;
  }

  function updateBadge() {
    if (!badgeEl) return;
    const n = activeCount();
    badgeEl.hidden = n === 0;
    const c = badgeEl.querySelector(".sb-tasks-count");
    if (c) c.textContent = n;
  }

  function cancel(id) {
    const t = get(id); if (!t || t.status !== "running") return;
    t.status = "canceled";
    if (t._onCancel) { try { t._onCancel(); } catch (e) {} }
    render();
    OS.toast("已取消：" + t.title, "warn");
  }

  /* ---------------- 主入口 ---------------- */
  function run(title, fn, opts) {
    opts = opts || {};
    ensureDom();
    const id = "task-" + (++seq);
    const t = {
      id, title,
      status: opts.queued ? "queued" : "running",
      step: opts.step || "",
      progress: opts.indeterminate === false ? 0 : null,
      cancelable: !!opts.cancelable,
      _onCancel: opts.onCancel || null,
      createdAt: Date.now()
    };
    tasks.push(t);
    if (!opts.quiet) showPanel();
    render();

    const reporter = {
      step(label, p) { if (label != null) t.step = label; if (p != null) t.progress = p; if (t.status === "running") render(); },
      progress(p) { t.progress = p; if (t.status === "running") render(); },
      setCancelable(c, fn2) { t.cancelable = c; t._onCancel = fn2 || t._onCancel; render(); },
      cancel() { cancel(id); }
    };

    const settle = (status, toastMsg, toastKind) => {
      t.status = status;
      if (status === "done") t.progress = 1;
      render();
      if (status !== "running" && activeCount() === 0 && !opts.quiet) {
        setTimeout(() => { if (activeCount() === 0) hidePanel(); }, 2600);
      }
      if (!opts.quiet && toastMsg) OS.toast(toastMsg, toastKind || (status === "error" ? "err" : "ok"));
    };

    Promise.resolve()
      .then(() => fn(reporter))
      .then(() => settle("done", opts.doneMsg || null))
      .catch(err => {
        t.error = err && err.message ? err.message : String(err);
        settle("error", "任务失败：" + t.error);
      });

    return { id, task: t, reporter };
  }

  function setBadgeEl(el) { badgeEl = el; updateBadge(); }

  OS.Tasks = { run, cancel, togglePanel, showPanel, hidePanel, activeCount, setBadgeEl, _tasks: tasks };
  if (OS.util && OS.util.log) OS.util.log("Tasks ready");
})(window);
