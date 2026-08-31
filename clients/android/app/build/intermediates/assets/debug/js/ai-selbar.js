/* ============================================================
   绿角犀 Office · 共享「选区 AI 浮层」工厂 (OS.AI.createSelToolbar)
   被 Writer / 表格 / 演示 / 脑图 复用：选中文字即浮出 AI 操作条，
   一键润色/改写/扩写/解释（可逆），并支持「建议批注/批注」「AI 助手」。
   设计要点：
   - 浮层用 position:fixed，按选区视口坐标定位，不依赖容器定位上下文；
   - 各模块通过 opts.getSelection() 提供 {text, rect, replace, insertAfter, suggest?, manual?}；
   - 快速操作走本地引擎（OS.AI.local），经模块自身的 replace/insertAfter 落地，保证可撤销；
   - 「助手」按钮调起 OS.shell.openAI(text) 进入流式 AI 助手（云端 SSE / 本地模拟流式）。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  OS.AI = OS.AI || {};

  function safeRect(range) {
    try {
      const f = range && range.getBoundingClientRect;
      if (typeof f === "function") { const r = range.getBoundingClientRect(); if (r && (r.top || r.left || r.width || r.height)) return r; }
    } catch (e) { /* 无头环境无布局 */ }
    return null;
  }

  OS.AI.createSelToolbar = function (opts) {
    const container = opts.container;
    const getSel = opts.getSelection || function () { return null; };
    const onApplied = opts.onApplied || function () {};
    const features = Object.assign(
      { replace: true, insert: true, suggest: false, manual: false, assistant: true },
      opts.features || {}
    );

    const bar = document.createElement("div");
    bar.className = "sel-toolbar";
    bar.style.position = "fixed";
    bar.hidden = true;
    container.appendChild(bar);

    function btn(label, title, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sel-btn";
      b.textContent = label;
      b.title = title;
      b.addEventListener("mousedown", e => e.preventDefault()); // 防止点击时丢失选区
      b.addEventListener("click", onClick);
      return b;
    }

    if (features.replace) {
      bar.appendChild(btn("润色", "更书面、通顺地替换选区", () => quickAct("polish", "replace")));
      bar.appendChild(btn("改写", "换一种说法替换选区", () => quickAct("rewrite", "replace")));
    }
    if (features.insert) {
      bar.appendChild(btn("扩写", "在选区后补充展开论述", () => quickAct("expand", "after")));
      bar.appendChild(btn("解释", "在选区后插入概念解释", () => quickAct("explain", "after")));
    }
    if (features.suggest) bar.appendChild(btn("建议批注", "AI 生成审阅建议并以批注首条呈现", doSuggest));
    if (features.manual) bar.appendChild(btn("批注", "手动新建批注", doManual));
    if (features.assistant) bar.appendChild(btn("助手", "打开 AI 助手（流式处理选区）", doAssistant));

    let lastRect = null;

    function refresh() {
      const s = getSel();
      if (s && s.text && s.text.trim()) { lastRect = s.rect || null; show(); }
      else hide();
    }
    function show() { bar.hidden = false; position(); }
    function hide() { bar.hidden = true; }

    function position() {
      const h = bar.offsetHeight || 36, w = bar.offsetWidth || 220;
      let top, left;
      if (lastRect && (lastRect.top || lastRect.left || lastRect.width || lastRect.height)) {
        const r = lastRect;
        top = r.top - h - 8;
        if (top < 4) top = r.bottom + 8;
        left = r.left + r.width / 2 - w / 2;
      } else { top = 8; left = 8; }
      top = Math.max(4, Math.min(top, (global.innerHeight || 800) - h - 4));
      left = Math.max(4, Math.min(left, (global.innerWidth || 1200) - w - 4));
      bar.style.top = top + "px";
      bar.style.left = left + "px";
    }

    function quickAct(mode, how) {
      const s = getSel();
      if (!s || !s.text || !s.text.trim()) { OS.toast("请先选中文字", "warn"); return; }
      let out;
      try { out = OS.AI.local[mode] ? OS.AI.local[mode](s.text) : OS.AI.runLocal(mode, s.text); }
      catch (e) { OS.toast("AI 处理失败：" + e.message, "warn"); hide(); return; }
      if (!out) { hide(); return; }
      try { if (how === "replace") s.replace(out); else s.insertAfter(out); }
      catch (e) { OS.toast("应用失败：" + e.message, "warn"); }
      onApplied();
      hide();
      const label = (OS.AI.MODES[mode] && OS.AI.MODES[mode].label) || mode;
      OS.toast("AI · " + label + " 已应用（可撤销）", "ok");
    }
    function doSuggest() {
      const s = getSel();
      if (!s || !s.suggest) { OS.toast("请先选中文字", "warn"); return; }
      try { s.suggest(); } catch (e) { OS.toast("生成失败：" + e.message, "warn"); }
      hide();
    }
    function doManual() {
      const s = getSel();
      if (!s || !s.manual) { OS.toast("请先选中文字", "warn"); return; }
      try { s.manual(); } catch (e) { OS.toast("失败：" + e.message, "warn"); }
      hide();
    }
    function doAssistant() {
      const s = getSel();
      const text = (s && s.text) ? s.text : "";
      if (OS.shell && OS.shell.openAI) OS.shell.openAI(text);
      hide();
    }

    function onResize() { if (!bar.hidden) position(); }
    function onScroll() { if (!bar.hidden) position(); }

    document.addEventListener("selectionchange", refresh);
    container.addEventListener("scroll", onScroll, true);
    global.addEventListener("resize", onResize);

    return {
      refresh,
      hide,
      destroy() {
        document.removeEventListener("selectionchange", refresh);
        container.removeEventListener("scroll", onScroll, true);
        global.removeEventListener("resize", onResize);
        bar.remove();
      }
    };
  };

  OS.AI.safeRect = safeRect;
})(window);
