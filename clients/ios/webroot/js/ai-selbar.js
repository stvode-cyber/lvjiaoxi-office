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

    async function quickAct(mode, how) {
      const s = getSel();
      if (!s || !s.text || !s.text.trim()) { OS.toast("请先选中文字", "warn"); return; }
      const label = (OS.AI.MODES[mode] && OS.AI.MODES[mode].label) || mode;
      // 加个"处理中"状态
      bar.querySelectorAll(".sel-btn").forEach(b => b.disabled = true);
      try {
        let out, source = "local";
        // 判断是否配了云端（provider 存在 + 非 local-only 模式）
        const provider = OS.AI.getProvider && OS.AI.getProvider();
        const localOnly = !!(OS.settings && OS.settings.get("dataLocalOnly"));
        if (provider && !localOnly && typeof OS.AI.run === "function") {
          // 云端流式处理
          try {
            const sysPrompt = _systemPrompt(mode);
            const result = await OS.AI.run({
              mode,
              system: sysPrompt,
              user: s.text,
              onDelta: null, // selbar 场景直接等完整结果
              signal: null,
              allowCloud: true
            });
            out = result.text;
            source = result.source || "cloud";
          } catch (cloudErr) {
            console.warn("[AI selbar] 云端失败，回退本地:", cloudErr.message);
            out = OS.AI.local[mode] ? OS.AI.local[mode](s.text) : OS.AI.runLocal(mode, s.text);
          }
        } else {
          // 纯本地
          out = OS.AI.local[mode] ? OS.AI.local[mode](s.text) : OS.AI.runLocal(mode, s.text);
        }
        if (!out) { hide(); return; }
        try { if (how === "replace") s.replace(out); else s.insertAfter(out); }
        catch (e) { OS.toast("应用失败：" + e.message, "warn"); }
        onApplied();
        hide();
        OS.toast("AI · " + label + " 已应用（" + (source === "cloud" ? "云端" : "本地") + "）", "ok");
      } catch (e) {
        OS.toast("AI 处理失败：" + e.message, "warn");
        hide();
      } finally {
        bar.querySelectorAll(".sel-btn").forEach(b => b.disabled = false);
      }
    }

    /** 不同模式的系统提示词（用于云端大模型） */
    function _systemPrompt(mode) {
      const prompts = {
        polish: "你是一个中文文本润色助手。你的任务是把用户提供的文本改得更通顺、更书面、更专业，但不要改变原意。保持语言简洁，不要添加多余的前缀后缀或解释性文字。只输出润色后的文本，不要输出任何其他内容。",
        rewrite: "你是一个中文文本改写助手。你的任务是换一种说法来表达用户提供的文本，保持信息完整但改变表达方式。可以换句式、换同义词、调整语序。只输出改写后的文本。",
        expand: "你是一个中文文本扩写助手。在用户提供的文本之后补充相关的论述和细节，使内容更丰富、更有说服力。保持主题一致。",
        explain: "你是一个中文概念解释助手。请用通俗的语言解释用户选中的内容，帮助读者理解核心概念。",
        summarize: "你是一个中文文本摘要助手。请提炼用户提供文本的核心要点，生成简明扼要的摘要。",
        outline: "你是一个中文大纲生成助手。基于用户提供的文本，生成结构化的大纲，用数字编号列表呈现。",
        translate: "你是一个中英双向翻译助手。请准确翻译用户提供的文本，保持专业术语的准确性。",
        continue: "你是一个中文续写助手。基于用户提供文本的结尾主题，合理地续写下一段内容。",
      };
      return prompts[mode] || "你是一个中文文本处理助手，请根据用户的需求处理文本。";
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
