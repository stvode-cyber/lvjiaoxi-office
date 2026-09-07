/* ============================================================
   绿角犀 Office · 业务板块：共享工具
   批量勾选工具条（orders / inventory / approvals 复用）：
   列表需含 [data-check] 行复选框 + [data-check-all] 全选 +
   .batch-tools 工具条（[data-bc] 计数、[data-batch-del] 批量删除等）
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  // 绑定勾选与批量工具条
  // opts = {
  //   batchFn: ids => Promise<{requested, removed, missing}>,  // [data-batch-del] 删除按钮
  //   reload: () => Promise,                                   // 操作后刷新（通常 render(el)）
  //   actions: [{ sel, confirm(含 %n), run(ids) => Promise }]  // 附加批量按钮（如审批 通过/驳回）
  // }
  function bindBatchTools(el, opts) {
    if (!el || !opts) return;
    const boxes = [...(el.querySelectorAll("[data-check]") || [])];
    const tools = el.querySelector(".batch-tools");
    if (!tools || !boxes.length) return;
    const allBox = el.querySelector("[data-check-all]");
    const countEl = el.querySelector("[data-bc]");
    const reload = opts.reload || (() => Promise.resolve());
    const collect = () => boxes.filter(b => b.checked).map(b => b.dataset.check);
    const refresh = () => {
      const n = collect().length;
      tools.hidden = n === 0;
      if (countEl) countEl.textContent = "已选 " + n + " 项";
      if (allBox) allBox.checked = n > 0 && n === boxes.length;
    };
    boxes.forEach(b => b.addEventListener("change", refresh));
    if (allBox) allBox.addEventListener("change", () => {
      boxes.forEach(b => { b.checked = allBox.checked; });
      refresh();
    });

    const bind = (sel, handler, confirmMsg) => {
      const btn = el.querySelector(sel);
      if (!btn) return;
      btn.addEventListener("click", async () => {
        const ids = collect();
        if (!ids.length) return;
        if (confirmMsg && typeof confirm === "function" &&
            !confirm(confirmMsg.replace("%n", String(ids.length)))) return;
        await handler(ids);
        await reload();
      });
    };

    bind("[data-batch-del]", async ids => {
      const r = await opts.batchFn(ids);
      if (OS.toast) OS.toast("已删除 " + r.removed + " 项" + (r.missing && r.missing.length ? "；跳过 " + r.missing.length + " 项不存在" : ""), "");
    }, "确定删除选中的 %n 项？");

    (opts.actions || []).forEach(a => bind(a.sel, a.run, a.confirm));
  }

  OS.biz = OS.biz || {};
  OS.biz.common = { bindBatchTools };

  if (OS.util && OS.util.log) OS.util.log("BizCommon ready");
})(window);
