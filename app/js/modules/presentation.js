/* ============================================================
   绿角犀 Office · Presentation 演示模块
   对应 PRD 3.3：母版、动画切换、演讲者视图、导出视频/图片
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const W = 760, H = 427;

  function blank() {
    return { slides: [{ bg: "#ffffff", notes: "", transition: { type: "none", duration: 500 }, layout: "title-content", elements: [{ id: OS.util.uid("el"), type: "text", x: 220, y: 170, w: 320, h: 90, text: "点击编辑标题", fontSize: 32, color: "#111827", bold: true, anim: { type: "none", duration: 400, delay: 0 }, emphasis: { type: "none" } }] }] };
  }

  // 切换动画：每页可携带 transition:{type,duration(ms)}
  const TRANSITIONS = [
    { value: "none", label: "无" },
    { value: "fade", label: "淡入" },
    { value: "push", label: "推进" },
    { value: "wipe", label: "擦除" },
    { value: "zoom", label: "缩放" },
    { value: "flip", label: "翻转" }
  ];
  const TRANSITION_DURATIONS = [
    { value: "300", label: "快速 (0.3s)" },
    { value: "500", label: "标准 (0.5s)" },
    { value: "800", label: "慢速 (0.8s)" }
  ];
  function transitionOf(slide) { return (slide && slide.transition) || { type: "none", duration: 500 }; }
  // 元素级进入动画：每个元素可携带 anim:{type,duration(ms),delay(ms)}
  const ANIMS = [
    { value: "none", label: "无" },
    { value: "fade", label: "淡入" },
    { value: "fly-up", label: "上浮" },
    { value: "fly-down", label: "下沉" },
    { value: "fly-left", label: "左入" },
    { value: "fly-right", label: "右入" },
    { value: "zoom", label: "缩放" },
    { value: "pop", label: "弹入" },
    { value: "spin", label: "旋转" }
  ];
  const ANIM_DURATIONS = [
    { value: "300", label: "快 (0.3s)" },
    { value: "400", label: "标准 (0.4s)" },
    { value: "600", label: "慢 (0.6s)" },
    { value: "800", label: "极慢 (0.8s)" }
  ];
  function animOf(elm) { return (elm && elm.anim) || { type: "none", duration: 400, delay: 0 }; }
  // 放映时点击元素触发的强调动画
  const EMPHASIS = [
    { value: "none", label: "无" },
    { value: "pulse", label: "脉冲高亮" },
    { value: "grow", label: "放大" },
    { value: "spin", label: "旋转" },
    { value: "shake", label: "抖动" }
  ];
  function emphasisOf(elm) { return (elm && elm.emphasis) || { type: "none" }; }
  // 在放映元素上施加强调动画（临时覆盖，结束后还原为无动画，避免重放入场）
  function applyEmphasis(domEl, emph) {
    if (!domEl || !emph || emph.type === "none") return;
    domEl.style.animation = "none"; void domEl.offsetWidth;
    domEl.style.animation = "em-" + emph.type + " 600ms ease";
    domEl.addEventListener("animationend", function () { domEl.style.animation = ""; }, { once: true });
  }
  // 把切换动画应用到某个幻灯片容器（仅动画进入的那一页，无需保留旧页）
  function applyTransition(slideEl, tr, dir) {
    if (!slideEl) return;
    if (!tr || tr.type === "none") { slideEl.style.animation = ""; return; }
    const dirKey = (tr.type === "push" || tr.type === "wipe") && dir === "prev" ? "-rev" : "";
    const key = "tr-" + tr.type + dirKey;
    slideEl.style.animation = "none";
    void slideEl.offsetWidth; // 强制 reflow 以重启动画
    slideEl.style.animation = key + " " + (tr.duration || 500) + "ms ease both";
  }

  function escHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function firstTitle(slide) {
    const t = (slide.elements || []).find(e => e.type === "text" && e.text && e.text.trim());
    return t ? t.text.trim() : "";
  }
  // 演讲者讲稿（备注）HTML：每页列出标题与备注（顶层 h2/p 以便 DOCX 导出解析）
  function speakerScriptHtml(doc) {
    const slides = (doc.data && doc.data.slides) || [];
    const blocks = slides.map((s, i) => {
      const title = firstTitle(s) || ("幻灯片 " + (i + 1));
      const notes = (s.notes || "").trim();
      return '<h2>第 ' + (i + 1) + ' 页 · ' + escHtml(title) + '</h2>' +
        (notes ? '<p>' + escHtml(notes).replace(/\n/g, '<br>') + '</p>' : '<p class="muted">（本页暂无备注）</p>');
    }).join('<hr>');
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + escHtml(doc.name || "演示讲稿") + '</title>' +
      '<style>body{font-family:-apple-system,"Microsoft YaHei",sans-serif;max-width:820px;margin:32px auto;padding:0 24px;line-height:1.7;color:#1a2332}' +
      'h1{font-size:26px}h2{font-size:20px;color:#33425b;margin-top:28px}hr{border:none;border-top:1px dashed #d8e0ea;margin:18px 0}.muted{color:#9aa7b5}</style>' +
      '</head><body><h1>' + escHtml(doc.name || "演示讲稿") + '</h1>' + blocks + '</body></html>';
  }
  OS.speakerScriptHtml = speakerScriptHtml;

  function mount(host, doc, ctx) {
    const data = doc.data && doc.data.slides ? doc.data : blank();
    let cur = 0;
    let presRangeText = ""; // PDF 导出页码范围暂存
    let presPreset = "";    // PDF 导出范围预设（all/odd/even/current），由「PDF 页码范围」下拉设置

    const undoStack = [], redoStack = [];
    function snapshot() {
      try { undoStack.push(JSON.parse(JSON.stringify({ slides: data.slides, cur: cur }))); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; } catch (e) {}
    }
    function restore(snap) {
      data.slides = JSON.parse(JSON.stringify(snap.slides));
      cur = Math.min(snap.cur != null ? snap.cur : cur, data.slides.length - 1);
      selEl = null;
      renderAll();
      ctx.markDirty();
    }
    function undo() { if (!undoStack.length) return false; redoStack.push(JSON.parse(JSON.stringify({ slides: data.slides, cur: cur }))); restore(undoStack.pop()); return true; }
    function redo() { if (!redoStack.length) return false; undoStack.push(JSON.parse(JSON.stringify({ slides: data.slides, cur: cur }))); restore(redoStack.pop()); return true; }
    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }

    const wrap = document.createElement("div");
    wrap.className = "module-wrap";
    wrap.innerHTML = `
      <div class="pres-wrap">
        <div class="pres-thumbs"></div>
        <div class="pres-canvas-area"><div class="pres-canvas"></div></div>
        <div class="pres-side">
          <div class="field"><label>幻灯片</label>
            <div style="display:flex;gap:6px">
              <button class="btn" data-act="add" style="flex:1">＋ 新建</button>
              <button class="btn" data-act="del">🗑 删除</button>
            </div>
          </div>
          <div class="field"><label>背景色</label><input type="color" data-bg></div>
          <hr style="border:none;border-top:1px solid var(--rule);margin:8px 0">
          <div class="field"><label>选中元素</label><span class="muted" data-sel-info>未选中</span></div>
          <div class="field"><label>文字内容</label><textarea data-text placeholder="双击画布编辑"></textarea></div>
          <hr style="border:none;border-top:1px solid var(--rule);margin:8px 0">
          <div class="field"><label>演讲者备注 / 讲稿</label><textarea data-notes class="notes-input" placeholder="为本页写下演讲者备注，放映时显示在演讲者视图中"></textarea></div>
          <div class="field"><label>字号</label><input type="number" data-size value="24"></div>
          <div class="field"><label>文字颜色</label><input type="color" data-color></div>
          <div class="field"><label>填充色（形状）</label><input type="color" data-fill></div>
          <div class="field" style="display:flex;gap:6px">
            <button class="btn" data-act="add-text" style="flex:1">＋ 文本框</button>
            <button class="btn" data-act="add-rect" style="flex:1">▭ 矩形</button>
            <button class="btn" data-act="add-ell" style="flex:1">◯ 圆</button>
          </div>
          <div class="field" style="display:flex;gap:6px">
            <button class="btn" data-act="add-arrow" style="flex:1">➤ 箭头</button>
            <button class="btn" data-act="del-el" style="flex:1">🗑 删除元素</button>
          </div>
          <div class="field"><button class="btn" data-act="present" style="width:100%">▶ 演讲者视图</button></div>
        </div>
      </div>`;
    host.appendChild(wrap);

    const thumbs = wrap.querySelector(".pres-thumbs");
    const canvas = wrap.querySelector(".pres-canvas");
    const bgInput = wrap.querySelector("[data-bg]");
    const textInput = wrap.querySelector("[data-text]");
    const notesInput = wrap.querySelector("[data-notes]");
    const sizeInput = wrap.querySelector("[data-size]");
    const colorInput = wrap.querySelector("[data-color]");
    const fillInput = wrap.querySelector("[data-fill]");
    const selInfo = wrap.querySelector("[data-sel-info]");

    let selEl = null;
    let trTypeSel = null, trDurSel = null; // 切换页的两个下拉
    let animTypeSel = null, animDurSel = null, animDelayInput = null; // 动画页的控件
    let emphTypeSel = null; // 强调动画下拉
    let layoutSel = null; // 版式下拉

    function renderSlide(slide, scale, withAnim) {
      const el = document.createElement("div");
      el.className = "pres-canvas";
      el.style.width = W + "px"; el.style.height = H + "px"; el.style.background = slide.bg;
      el.style.transform = scale && scale !== 1 ? `scale(${scale})` : "";
      el.style.transformOrigin = "top left";
      (slide.elements || []).forEach(elm => el.appendChild(renderEl(elm, scale, withAnim)));
      return el;
    }
    function renderEl(elm, scale, withAnim) {
      const d = document.createElement("div");
      d.className = "el " + (elm.type === "text" ? "text" : elm.type === "image" ? "img" : "shape");
      d.dataset.id = elm.id;
      d.style.left = (elm.x * (scale || 1)) + "px"; d.style.top = (elm.y * (scale || 1)) + "px";
      d.style.width = (elm.w * (scale || 1)) + "px"; d.style.height = (elm.h * (scale || 1)) + "px";
      d.style.color = elm.color || "#111827"; d.style.fontSize = ((elm.fontSize || 24) * (scale || 1)) + "px";
      d.style.fontWeight = elm.bold ? "700" : "400";

      if (elm.type === "image") {
        // 图片：<img> 标签 + object-fit: cover
        d.style.background = "transparent";
        const img = document.createElement("img");
        img.src = elm.src || "";
        img.alt = "";
        img.style.width = "100%"; img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.display = "block";
        img.style.pointerEvents = "none";
        d.appendChild(img);
      } else if (elm.shape === "arrow") {
        // 箭头 / 连接线
        d.style.background = "transparent";
        const stroke = elm.stroke || "#111827";
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
        svg.setAttribute("viewBox", "0 0 " + elm.w + " " + elm.h);
        svg.setAttribute("preserveAspectRatio", "none"); svg.style.overflow = "visible";
        const mid = Math.max(1, Math.round(elm.h / 2));
        const defs = document.createElementNS(NS, "defs");
        const marker = document.createElementNS(NS, "marker");
        marker.setAttribute("id", "ah-" + elm.id); marker.setAttribute("markerWidth", "10"); marker.setAttribute("markerHeight", "10");
        marker.setAttribute("refX", "7"); marker.setAttribute("refY", "3"); marker.setAttribute("orient", "auto"); marker.setAttribute("markerUnits", "strokeWidth");
        const mpath = document.createElementNS(NS, "path"); mpath.setAttribute("d", "M0,0 L8,3 L0,6 Z"); mpath.setAttribute("fill", stroke);
        marker.appendChild(mpath); defs.appendChild(marker); svg.appendChild(defs);
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", "1"); line.setAttribute("y1", String(mid));
        line.setAttribute("x2", String(elm.w - 2)); line.setAttribute("y2", String(mid));
        line.setAttribute("stroke", stroke); line.setAttribute("stroke-width", String(Math.max(1, (elm.strokeWidth || 2))));
        line.setAttribute("marker-end", "url(#ah-" + elm.id + ")");
        svg.appendChild(line);
        d.appendChild(svg);
      } else {
        // 普通 shape 或 text：渲染 fill / stroke / 圆角
        if (elm.fill) d.style.background = elm.fill;
        if (elm.shape === "ellipse") d.style.borderRadius = "50%";
        if (elm.stroke) {
          const sw = Math.max(1, (elm.strokeWidth || 1)) * (scale || 1);
          d.style.border = sw + "px solid " + elm.stroke;
          d.style.boxSizing = "border-box";
        }
        // text 元素：放文字内容
        if (elm.type === "text") {
          d.textContent = elm.text || "";
          if (elm.align) d.style.textAlign = elm.align;
          // 文本框加 padding 让文字不贴边
          d.style.padding = "2px 4px";
          d.style.boxSizing = "border-box";
          d.style.overflow = "hidden";
        }
      }
      // 进入动画仅在放映/预览时附加（不污染编辑态与缩略图）
      if (withAnim) {
        const a = animOf(elm);
        if (a.type && a.type !== "none") {
          d.style.animation = "el-" + a.type + " " + (a.duration || 400) + "ms ease both";
          if (a.delay) d.style.animationDelay = (a.delay || 0) + "ms";
        }
      }
      return d;
    }

    function renderThumbs() {
      thumbs.innerHTML = "";
      data.slides.forEach((s, i) => {
        const box = document.createElement("div");
        box.className = "pres-thumb" + (i === cur ? " active" : "");
        box.style.height = (H * 140 / W) + "px";
        const sc = renderSlide(s, 140 / W);
        box.appendChild(sc);
        const num = document.createElement("span"); num.className = "tnum"; num.textContent = i + 1; box.appendChild(num);
        box.addEventListener("click", () => { cur = i; renderAll(); });
        thumbs.appendChild(box);
      });
    }

    function renderMain() {
      canvas.innerHTML = "";
      const s = data.slides[cur];
      canvas.style.background = s.bg;
      (s.elements || []).forEach(elm => {
        const d = renderEl(elm, 1);
        if (elm.id === (selEl && selEl.id)) d.classList.add("selected");
        canvas.appendChild(d);
      });
    }

    function renderAll() { renderThumbs(); renderMain(); syncPanel(); }

    function syncPanel() {
      const s = data.slides[cur];
      bgInput.value = rgbToHex(s.bg) || "#ffffff";
      notesInput.value = s.notes || "";
      if (selEl) {
        selInfo.textContent = `元素 #${selEl.id.slice(-4)} (${selEl.type})`;
        textInput.value = selEl.text || "";
        sizeInput.value = selEl.fontSize || 24;
        colorInput.value = rgbToHex(selEl.color) || "#111827";
        fillInput.value = rgbToHex(selEl.fill) || "#93c5fd";
        syncAnimControls();
      } else { selInfo.textContent = "未选中"; }
      if (layoutSel) layoutSel.value = layout();
      syncTransitionControls();
    }
    function syncTransitionControls() {
      if (!trTypeSel || !trDurSel) return;
      const t = transitionOf(data.slides[cur]);
      trTypeSel.value = t.type || "none";
      trDurSel.value = String(t.duration || 500);
    }
    function syncAnimControls() {
      if (!selEl || !animTypeSel || !animDurSel || !animDelayInput) return;
      const a = animOf(selEl);
      animTypeSel.value = a.type || "none";
      animDurSel.value = String(a.duration || 400);
      animDelayInput.value = a.delay || 0;
      syncEmphControls();
    }
    function syncEmphControls() {
      if (!emphTypeSel) return;
      emphTypeSel.value = (selEl ? emphasisOf(selEl).type : "none") || "none";
    }
    function rgbToHex(c) { if (!c) return "#ffffff"; if (c[0] === "#") return c; const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return "#ffffff"; const p = m[1].split(",").map(x => +x); return "#" + p.slice(0, 3).map(x => x.toString(16).padStart(2, "0")).join(""); }

    // 元素选择 + 拖拽
    canvas.addEventListener("click", e => {
      const el = e.target.closest(".el"); if (!el) { selEl = null; renderMain(); syncPanel(); return; }
      const id = el.dataset.id; selEl = (data.slides[cur].elements || []).find(x => x.id === id);
      renderMain(); syncPanel();
    });
    canvas.addEventListener("dblclick", e => {
      const el = e.target.closest(".el.text"); if (!el) return;
      el.setAttribute("contenteditable", "true"); el.focus();
      document.execCommand("selectAll", false, null);
    });
    canvas.addEventListener("blur", e => {
      const el = e.target.closest(".el[contenteditable]"); if (el) {
        el.removeAttribute("contenteditable");
        if (selEl) { snapshot(); selEl.text = el.textContent; ctx.markDirty(); }
      }
    }, true);
    // 拖拽移动
    let drag = null;
    canvas.addEventListener("pointerdown", e => {
      const el = e.target.closest(".el"); if (!el) return;
      const id = el.dataset.id; selEl = (data.slides[cur].elements || []).find(x => x.id === id);
      const r = el.getBoundingClientRect(); drag = { el, id, ox: e.clientX - r.left, oy: e.clientY - r.top };
      el.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
      if (!drag) return; const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left - drag.ox, y = e.clientY - r.top - drag.oy;
      drag.el.style.left = x + "px"; drag.el.style.top = y + "px";
      const obj = (data.slides[cur].elements || []).find(x => x.id === drag.id);
      if (obj) { obj.x = x; obj.y = y; }
    });
    canvas.addEventListener("pointerup", e => { if (drag) { snapshot(); drag = null; ctx.markDirty(); } });

    // 属性面板
    bgInput.addEventListener("input", () => { data.slides[cur].bg = bgInput.value; renderAll(); ctx.markDirty(); });
    textInput.addEventListener("input", () => { if (selEl) { selEl.text = textInput.value; renderMain(); ctx.markDirty(); } });
    sizeInput.addEventListener("input", () => { if (selEl) { selEl.fontSize = +sizeInput.value; renderMain(); ctx.markDirty(); } });
    colorInput.addEventListener("input", () => { if (selEl) { selEl.color = colorInput.value; renderMain(); ctx.markDirty(); } });
    fillInput.addEventListener("input", () => { if (selEl) { selEl.fill = fillInput.value; renderMain(); ctx.markDirty(); } });
    notesInput.addEventListener("input", () => { data.slides[cur].notes = notesInput.value; ctx.markDirty(); renderThumbs(); });

    function addEl(o) { snapshot(); const el = Object.assign({ id: OS.util.uid("el"), type: "text", x: 60, y: 60, w: 240, h: 80, text: "文字", fontSize: 24, color: "#111827", anim: { type: "none", duration: 400, delay: 0 }, emphasis: { type: "none" } }, o); (data.slides[cur].elements || (data.slides[cur].elements = [])).push(el); selEl = el; renderAll(); ctx.markDirty(); }
    function deleteEl() { if (!selEl) { OS.toast("请先选中一个元素", "warn"); return; } snapshot(); const arr = data.slides[cur].elements; const i = arr.findIndex(e => e.id === selEl.id); if (i >= 0) arr.splice(i, 1); selEl = null; renderAll(); ctx.markDirty(); }
    // 母版版式：用 placeholder 占位元素规范化当前页布局
    const LAYOUTS = ["title-content", "title-only", "section", "blank"];
    function layoutPlaceholders(layout) {
      if (layout === "title-only") return [{ role: "title", text: "点击编辑标题", x: 80, y: 60, w: W - 160, h: 80, fontSize: 32, bold: true, align: "left" }];
      if (layout === "section") return [{ role: "section", text: "节标题", x: 80, y: Math.round(H / 2) - 60, w: W - 160, h: 120, fontSize: 40, bold: true, align: "center" }];
      if (layout === "title-content") return [{ role: "title", text: "点击编辑标题", x: 80, y: 60, w: W - 160, h: 80, fontSize: 32, bold: true, align: "left" }, { role: "content", text: "点击添加内容", x: 80, y: 170, w: W - 160, h: H - 220, fontSize: 20, align: "left" }];
      return [];
    }
    function applyLayout(layout) {
      const s = data.slides[cur];
      s.elements = (s.elements || []).filter(e => !e.placeholder);
      layoutPlaceholders(layout).forEach(p => s.elements.push(Object.assign({ id: OS.util.uid("el"), type: "text", color: "#111827", placeholder: true, anim: { type: "none", duration: 400, delay: 0 }, emphasis: { type: "none" } }, p)));
      s.layout = layout;
    }
    function setLayout(layout) { snapshot(); data.slides[cur].layout = layout; applyLayout(layout); renderAll(); ctx.markDirty(); }
    function layout() { return data.slides[cur].layout || "title-content"; }
    wrap.querySelector('[data-act="add-text"]').addEventListener("click", () => addEl({ text: "文本框" }));
    wrap.querySelector('[data-act="add-rect"]').addEventListener("click", () => addEl({ type: "shape", shape: "rect", fill: "#93c5fd", w: 160, h: 100 }));
    wrap.querySelector('[data-act="add-ell"]').addEventListener("click", () => addEl({ type: "shape", shape: "ellipse", fill: "#fca5a5", w: 120, h: 120 }));
    wrap.querySelector('[data-act="add-arrow"]').addEventListener("click", () => addEl({ type: "shape", shape: "arrow", stroke: "#111827", w: 180, h: 24 }));
    wrap.querySelector('[data-act="del-el"]').addEventListener("click", deleteEl);
    wrap.querySelector('[data-act="add"]').addEventListener("click", () => { snapshot(); data.slides.splice(cur + 1, 0, { bg: "#ffffff", elements: [] }); cur++; renderAll(); ctx.markDirty(); });
    wrap.querySelector('[data-act="del"]').addEventListener("click", () => { if (data.slides.length > 1) { snapshot(); data.slides.splice(cur, 1); cur = Math.max(0, cur - 1); renderAll(); ctx.markDirty(); } else OS.toast("至少保留一页", "warn"); });

    // 演讲者视图
    let presenterEl = null;
    function showPresenter() {
      presenterEl = document.createElement("div");
      presenterEl.className = "presenter";
      presenterEl.innerHTML = `<div class="p-main"><div class="slide"></div></div>
        <aside class="p-notes-pane"><div class="p-notes-head">演讲者备注</div><div class="p-notes"></div></aside>
        <div class="p-foot"><button class="btn" data-p="prev">‹ 上一页</button><span data-pnum></span><button class="btn" data-p="next">下一页 ›</button>
        <button class="btn" data-p="exit" style="margin-left:auto">退出 (Esc)</button>
        <div class="p-next">下一页<div class="box"></div></div></div>`;
      document.body.appendChild(presenterEl);
      let navDir = "next"; // 进入方向：下一页=next，上一页=prev（用于推进/擦除方向）
      const draw = () => {
        const slideEl = presenterEl.querySelector(".p-main .slide");
        slideEl.innerHTML = "";
        slideEl.appendChild(renderSlide(data.slides[cur], 1, true));
        const nb = presenterEl.querySelector(".p-next .box"); nb.innerHTML = "";
        if (data.slides[cur + 1]) nb.appendChild(renderSlide(data.slides[cur + 1], 180 / W));
        const notesEl = presenterEl.querySelector(".p-notes");
        const nt = (data.slides[cur].notes || "").trim();
        notesEl.textContent = nt || "（本页暂无备注）";
        notesEl.classList.toggle("empty", !nt);
        presenterEl.querySelector("[data-pnum]").textContent = ` ${cur + 1} / ${data.slides.length} `;
        applyTransition(slideEl, transitionOf(data.slides[cur]), navDir);
      };
      draw();
      presenterEl.addEventListener("click", e => {
        const a = e.target.dataset.p; if (a === "exit") { presenterEl.remove(); presenterEl = null; return; }
        // 放映时点击元素 → 触发其强调动画
        const elm = e.target.closest(".p-main .slide .el");
        if (elm) {
          const obj = (data.slides[cur].elements || []).find(x => x.id === elm.dataset.id);
          applyEmphasis(elm, emphasisOf(obj));
          return;
        }
        if (a === "next" && cur < data.slides.length - 1) { navDir = "next"; cur++; draw(); }
        if (a === "prev" && cur > 0) { navDir = "prev"; cur--; draw(); }
      });
      presenterEl.tabIndex = 0;
      presenterEl.focus();
      presenterEl.addEventListener("keydown", e => {
        if (e.key === "Escape") { presenterEl.remove(); presenterEl = null; }
        if (e.key === "ArrowRight" && cur < data.slides.length - 1) { navDir = "next"; cur++; draw(); }
        if (e.key === "ArrowLeft" && cur > 0) { navDir = "prev"; cur--; draw(); }
      });
    }
    // 编辑区预览当前页切换效果
    function previewTransition() { applyTransition(canvas, transitionOf(data.slides[cur]), "next"); }
    // 编辑区预览当前页全部元素的进入动画
    function previewEntrance() {
      canvas.querySelectorAll(".el").forEach(d => {
        const obj = (data.slides[cur].elements || []).find(x => x.id === d.dataset.id);
        const a = animOf(obj);
        d.style.animation = ""; void d.offsetWidth; // 强制 reflow 重启
        if (a.type && a.type !== "none") {
          d.style.animation = "el-" + a.type + " " + (a.duration || 400) + "ms ease both";
          if (a.delay) d.style.animationDelay = (a.delay || 0) + "ms";
        }
      });
    }
    wrap.querySelector('[data-act="present"]').addEventListener("click", showPresenter);

    // 功能区（标签页）
    const ribbon = OS.Ribbon.create({
      file: { onOpen: ctx.openBackstage },
      tabs: [
        {
          id: "home", label: "开始", groups: [
            {
              label: "幻灯片", items: [
                { kind: "btn", icon: "slide-new", title: "新建幻灯片", label: "新建", onClick: () => { snapshot(); data.slides.splice(cur + 1, 0, { bg: "#ffffff", elements: [] }); cur++; renderAll(); ctx.markDirty(); } },
                { kind: "btn", icon: "trash", title: "删除幻灯片", label: "删除", onClick: () => { if (data.slides.length > 1) { snapshot(); data.slides.splice(cur, 1); cur = Math.max(0, cur - 1); renderAll(); ctx.markDirty(); } else OS.toast("至少保留一页", "warn"); } }
              ]
            },
            {
              label: "放映", items: [
                { kind: "btn", icon: "play", title: "演讲者视图", label: "放映", onClick: showPresenter }
              ]
            }
          ]
        },
        {
          id: "insert", label: "插入", groups: [
            {
              label: "对象", items: [
                { kind: "btn", icon: "text", title: "文本框", label: "文本框", onClick: () => addEl({ text: "文本框" }) },
                { kind: "btn", icon: "shape", title: "矩形", label: "矩形", onClick: () => addEl({ type: "shape", shape: "rect", fill: "#93c5fd", w: 160, h: 100 }) },
                { kind: "btn", icon: "shape-circle", title: "椭圆", label: "椭圆", onClick: () => addEl({ type: "shape", shape: "ellipse", fill: "#fca5a5", w: 120, h: 120 }) },
                { kind: "btn", icon: "arrow-right", title: "箭头", label: "箭头", onClick: () => addEl({ type: "shape", shape: "arrow", stroke: "#111827", w: 180, h: 24 }) }
              ]
            }
          ]
        },
        {
          id: "design", label: "设计", groups: [
            {
              label: "背景", items: [
                { kind: "color", title: "背景色", label: "背景", onInput: v => { data.slides[cur].bg = v; renderAll(); ctx.markDirty(); } }
              ]
            },
            {
              label: "版式", items: [
                { kind: "select", title: "幻灯片版式（规范标题/内容占位区）", value: "title-content", options: [{ value: "title-content", label: "标题 + 内容" }, { value: "title-only", label: "仅标题" }, { value: "section", label: "节标题" }, { value: "blank", label: "空白" }], onChange: v => setLayout(v) }
              ]
            }
          ]
        },
        {
          id: "transitions", label: "切换", groups: [
            {
              label: "切换到此幻灯片", items: [
                { kind: "select", title: "切换效果", value: "none", options: TRANSITIONS, onChange: v => { data.slides[cur].transition = Object.assign({}, transitionOf(data.slides[cur]), { type: v }); renderMain(); ctx.markDirty(); syncTransitionControls(); } },
                { kind: "select", title: "持续时间", value: "500", options: TRANSITION_DURATIONS, onChange: v => { data.slides[cur].transition = Object.assign({}, transitionOf(data.slides[cur]), { duration: +v }); ctx.markDirty(); syncTransitionControls(); } }
              ]
            },
            {
              label: "预览与全部", items: [
                { kind: "btn", icon: "play", title: "预览当前页切换效果", label: "预览", onClick: previewTransition },
                { kind: "btn", icon: "check-all", title: "把当前切换效果应用到全部幻灯片", label: "全部", onClick: () => { const t = transitionOf(data.slides[cur]); data.slides.forEach(s => s.transition = Object.assign({}, t)); ctx.markDirty(); OS.toast("已应用切换效果到全部幻灯片", "ok"); } }
              ]
            }
          ]
        },
        {
          id: "animations", label: "动画", groups: [
            {
              label: "元素进入动画", items: [
                { kind: "select", title: "进入效果（选中元素后设置）", value: "none", options: ANIMS, onChange: v => { if (selEl) { selEl.anim = Object.assign({}, animOf(selEl), { type: v }); renderMain(); ctx.markDirty(); syncAnimControls(); } else OS.toast("请先在画布选中一个元素", "warn"); } },
                { kind: "select", title: "持续时间", value: "400", options: ANIM_DURATIONS, onChange: v => { if (selEl) { selEl.anim = Object.assign({}, animOf(selEl), { duration: +v }); ctx.markDirty(); syncAnimControls(); } } },
                { kind: "input", title: "延迟 (ms，错峰入场)", type: "number", value: "0", onInput: v => { if (selEl) { selEl.anim = Object.assign({}, animOf(selEl), { delay: Math.max(0, +v || 0) }); ctx.markDirty(); syncAnimControls(); } } }
              ]
            },
            {
              label: "预览与全部", items: [
                { kind: "btn", icon: "play", title: "预览当前页元素进入动画", label: "预览", onClick: previewEntrance },
                { kind: "btn", icon: "check-all", title: "把当前选中元素的动画应用到本页全部元素", label: "本页全部", onClick: () => { if (!selEl) { OS.toast("请先选中一个元素作为模板", "warn"); return; } const t = animOf(selEl); data.slides[cur].elements.forEach(e => e.anim = Object.assign({}, t)); renderMain(); ctx.markDirty(); OS.toast("已应用到本页全部元素", "ok"); } }
              ]
            },
            {
              label: "元素强调动画（放映时点击触发）", items: [
                { kind: "select", title: "强调效果（选中元素后设置；放映点击该元素即播放）", value: "none", options: EMPHASIS, onChange: v => { if (selEl) { selEl.emphasis = Object.assign({}, emphasisOf(selEl), { type: v }); ctx.markDirty(); syncEmphControls(); } else OS.toast("请先在画布选中一个元素", "warn"); } }
              ]
            }
          ]
        },
        {
          id: "export", label: "导出", groups: [
            {
              label: "导出为", items: [
                { kind: "btn", icon: "save", title: "导出为 JSON（可重新导入）", label: "JSON", onClick: () => exportAs("json") },
                { kind: "btn", icon: "preview", title: "导出演讲者讲稿 HTML（含备注）", label: "讲稿", onClick: () => exportAs("html") },
                { kind: "btn", icon: "pdf", title: "导出为 PDF（浏览器打印 → 另存为 PDF）", label: "导出 PDF", onClick: () => exportAs("pdf") },
                { kind: "btn", icon: "download", title: "直接生成并下载 PDF 文件（光栅化每页幻灯片，无需打印对话框）", label: "下载 PDF 文件", onClick: downloadPdfFile },
                { kind: "btn", icon: "image", title: "导出当前页为 PNG 图片", label: "PNG", onClick: () => exportAs("png") }
              ]
            },
            {
              label: "PDF 页码范围", items: [
                { kind: "select", title: "范围预设（优先于上方手动页码）", value: "", options: [{ value: "", label: "自定义（用下方输入）" }, { value: "all", label: "全部页" }, { value: "odd", label: "奇数页" }, { value: "even", label: "偶数页" }, { value: "current", label: "当前页" }], onChange: (v) => { presPreset = v || ""; } },
                { kind: "input", type: "text", placeholder: "如 2-5（留空=全部）", title: "仅导出指定页码范围，例如 2-5 或单页 3（预设选「自定义」时生效）", value: "", onInput: (v) => { presRangeText = v || ""; } },
                { kind: "btn", icon: "download", title: "按上方范围预设 / 页码范围下载 PDF 文件", label: "按范围下载 PDF", onClick: () => {
                  let opts = {};
                  if (presPreset) {
                    opts = { preset: presPreset, current: (typeof cur !== "undefined" ? cur : 0) + 1 };
                  } else {
                    const rt = (presRangeText || "").trim();
                    const m = /^(\d+)\s*-\s*(\d+)$/.exec(rt);
                    if (m) { opts.startPage = parseInt(m[1], 10); opts.endPage = parseInt(m[2], 10); }
                    else if (/^\d+$/.test(rt)) { const n = parseInt(rt, 10); opts.startPage = n; opts.endPage = n; }
                  }
                  downloadPdfFile(opts);
                } }
              ]
            }
          ]
        }
      ]
    });
    // 抓取切换页的两个下拉引用，便于与当前页同步
    const trTab = ribbon.getTab("transitions");
    if (trTab) { const sels = trTab.querySelectorAll("select.rsel"); trTypeSel = sels[0] || null; trDurSel = sels[1] || null; }
    // 抓取动画页的控件引用
    const animTab = ribbon.getTab("animations");
    if (animTab) {
      const sels = animTab.querySelectorAll("select.rsel");
      animTypeSel = sels[0] || null; animDurSel = sels[1] || null;
      animDelayInput = animTab.querySelector("input.rinp");
      emphTypeSel = sels[2] || null;
    }
    const designTab = ribbon.getTab("design");
    if (designTab) { const sels = designTab.querySelectorAll("select.rsel"); layoutSel = sels[0] || null; }

    // 幻灯片光栅化所需的额外内联样式（.pres-canvas / .el 由 renderSlide 写入内联样式，
    // 这里仅补充定位与容器规则，确保 SVG foreignObject 渲染与原画布一致）
    const SLIDE_RASTER_CSS = [
      "*{box-sizing:border-box;margin:0;padding:0}",
      "html,body{font-family:'Microsoft YaHei','PingFang SC',sans-serif}",
      ".pres-canvas{position:relative;overflow:hidden;background:#fff}",
      ".pres-canvas .el{position:absolute;overflow:hidden}",
      ".pres-canvas .el.text{padding:6px 8px;font-size:18px;line-height:1.4}",
      ".pres-canvas .el.shape{display:flex;align-items:center;justify-content:center}"
    ].join("");

    function presBuildPageSvg(innerHtml, w, h, scale) {
      if (!OS.SvgRaster || !OS.SvgRaster.buildPageSvg) throw new Error("SvgRaster 未就绪");
      return OS.SvgRaster.buildPageSvg(innerHtml, w, h, scale, SLIDE_RASTER_CSS);
    }
    function presRasterizeSvg(svgStr, w2, h2) {
      return new Promise((resolve) => {
        const img = new Image();
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = w2; c.height = h2;
          const cx = c.getContext("2d");
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, w2, h2);
          try { cx.drawImage(img, 0, 0, w2, h2); } catch (e) { /* 跨域图片可能绘制失败，保持白底 */ }
          let data;
          try { data = new Uint8Array(cx.getImageData(0, 0, w2, h2).data); }
          catch (e) { data = new Uint8Array(w2 * h2 * 4).fill(255); } // 画布被污染时降级为白页
          resolve({ data, w: w2, h: h2 });
        };
        img.onerror = () => resolve({ data: new Uint8Array(w2 * h2 * 4).fill(255), w: w2, h: h2 });
        img.src = url;
      });
    }
    // 直接生成并下载 PDF 文件：逐页渲染幻灯片 → 内联样式 SVG → 2x 光栅 → writeImagePdf
    // opts: { startPage, endPage }（1-based 含端点，缺省=全部）
    async function downloadPdfFile(opts) {
      if (!OS.PdfTool || !OS.PdfTool.writeImagePdf) { OS.toast("PDF 引擎未就绪", "warn"); return; }
      if (!data.slides.length) { OS.toast("没有可导出的幻灯片", "warn"); return; }
      // 页数范围：优先范围预设（OS.RangePreset），否则按 startPage/endPage
      let pagesIdx;
      if (opts && opts.preset) {
        pagesIdx = (OS.RangePreset ? OS.RangePreset.resolvePagePreset(opts.preset, data.slides.length, (typeof cur !== "undefined" ? cur : 0) + 1) : []);
      } else {
        const [a, b] = OS.SvgRaster.pageRange(data.slides.length, opts || {});
        pagesIdx = []; for (let i = a; i <= b; i++) pagesIdx.push(i);
      }
      const scale = 2;
      const pages = [];
      try {
        for (const i of pagesIdx) {
          if (i < 0 || i >= data.slides.length) continue;
          const s = renderSlide(data.slides[i], 1);
          document.body.appendChild(s); s.style.position = "fixed"; s.style.left = "-99999px"; s.style.top = "0";
          const svg = presBuildPageSvg(s.outerHTML, W, H, scale);
          s.remove();
          const r = await presRasterizeSvg(svg, Math.round(W * scale), Math.round(H * scale));
          // 16:9 幻灯片用 792×445 pt（标准 16:9 版面），光栅像素铺满
          pages.push({ width: r.w, height: r.h, data: r.data, mediaW: 792, mediaH: Math.round(792 * H / W) });
        }
        if (!pages.length) { OS.toast("所选页码范围没有可导出内容", "warn"); return; }
        const bytes = await OS.PdfTool.writeImagePdf(pages);
        OS.util.download(new Blob([bytes], { type: "application/pdf" }), (doc.name || "演示") + ".pdf");
        OS.toast("已生成 PDF 文件（" + pages.length + " 页）", "ok");
      } catch (e) {
        OS.toast("PDF 生成失败：" + (e && e.message || e), "warn");
      }
    }

    // 导出
    function exportAs(fmt) {
      const title = doc.name || "演示";
      if (fmt === "json") OS.util.download(new Blob([JSON.stringify(data)], { type: "application/json" }), title + ".json");
      else if (fmt === "html") OS.util.download(new Blob([speakerScriptHtml({ name: title, data: data })], { type: "text/html" }), title + "_讲稿.html");
      else if (fmt === "pdf") window.print();
      else if (fmt === "pdffile") downloadPdfFile();
      else if (fmt === "png") {
        // 尝试将当前页渲染为 PNG（foreignObject，最佳努力）
        tryExportPng(data.slides[cur], title);
      }
    }
    function tryExportPng(slide, title) {
      const s = renderSlide(slide, 1);
      document.body.appendChild(s); s.style.position = "fixed"; s.style.left = "-99999px";
      const xml = new XMLSerializer().serializeToString(s);
      s.remove();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${xml}</div></foreignObject></svg>`;
      const img = new Image();
      img.onload = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; c.getContext("2d").drawImage(img, 0, 0); c.toBlob(b => OS.util.download(b, title + ".png")); };
      img.onerror = () => OS.toast("图片导出需浏览器支持，已改导出 JSON", "warn");
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }

    /* ---------- 选区 AI 浮层（复用共享工厂 ai-selbar.js） ---------- */
    function activeElRange() {
      const el = canvas.querySelector('.el[contenteditable="true"]');
      if (!el) return null;
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.commonAncestorContainer)) return null;
      const text = r.toString();
      if (!text.trim()) return null;
      return { el, range: r };
    }
    const presSelbar = OS.AI.createSelToolbar({
      container: wrap,
      features: { replace: true, insert: true, assistant: true },
      getSelection() {
        const a = activeElRange();
        if (!a) return null;
        return {
          text: a.range.toString(),
          rect: OS.AI.safeRect(a.range),
          replace(out) {
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(a.range.cloneRange());
            try { document.execCommand("delete", false, null); document.execCommand("insertText", false, out); } catch (e) {}
            if (selEl) { selEl.text = a.el.textContent; ctx.markDirty(); }
            renderMain();
          },
          insertAfter(out) {
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(a.range.cloneRange());
            sel.collapseToEnd();
            try { document.execCommand("insertText", false, out); } catch (e) {}
            if (selEl) { selEl.text = a.el.textContent; ctx.markDirty(); }
            renderMain();
          }
        };
      },
      onApplied() {}
    });

    // 全局文档搜索：扫描每页元素文本，定位到对应幻灯片并选中元素
    function search(query) {
      const q = (query || "").trim(); const out = [];
      if (!q) return out;
      const ql = q.toLowerCase();
      data.slides.forEach((s, i) => {
        const title = firstTitle(s) || ("幻灯片 " + (i + 1));
        const els = s.elements || [];
        let hit = -1;
        els.forEach((e, j) => { if (hit === -1 && (e.text || "").toLowerCase().indexOf(ql) !== -1) hit = j; });
        if (hit !== -1) {
          const t = els[hit].text || "";
          out.push({
            label: "第 " + (i + 1) + " 页 · " + title,
            previewHtml: OS.shell.snippet(t, q),
            goto: () => { cur = i; renderAll(); selEl = els[hit]; renderMain(); syncPanel(); }
          });
        }
      });
      return out;
    }
    // 程序化查找替换（外壳 Ctrl/Cmd+H 跨文档调用）：在每页元素文本中替换，集成撤销快照
    function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function replaceAllText(query, replacement, opts) {
      const q = (query || "").trim();
      if (!q) return 0;
      const mc = opts && opts.matchCase;
      const rep = String(replacement == null ? "" : replacement).replace(/\$/g, "$$");
      snapshot();
      let count = 0;
      data.slides.forEach(s => {
        (s.elements || []).forEach(e => {
          if (typeof e.text !== "string") return;
          const re = new RegExp(escapeRegex(q), mc ? "g" : "gi");
          if (re.test(e.text)) {
            count += (e.text.match(re) || []).length;
            e.text = e.text.replace(re, rep);
          }
        });
      });
      if (count) { renderAll(); ctx.markDirty(); }
      return count;
    }

    renderAll();
    return {
      serialize() { return data; }, exportAs, focus() {}, ribbon,
      pdfFileAPI: { download: downloadPdfFile, buildPageSvg: presBuildPageSvg, rasterizeSvg: presRasterizeSvg },
      setCur(i) { cur = i; renderAll(); },
      search,
      replaceAll: replaceAllText,
      setNotes(t) { data.slides[cur].notes = t; notesInput.value = t; ctx.markDirty(); renderThumbs(); },
      notes() { return data.slides.map(s => s.notes || ""); },
      // 切换动画 API
      setTransition(opts) {
        const o = Object.assign({}, opts || {}); delete o.all; // all 仅是开关，不入存储
        const t = Object.assign({}, transitionOf(data.slides[cur]), o);
        if (opts && opts.all) data.slides.forEach(s => s.transition = Object.assign({}, t));
        else data.slides[cur].transition = t;
        ctx.markDirty(); syncTransitionControls();
      },
      transition(i) { return transitionOf(data.slides[i == null ? cur : i]); },
      previewTransition,
      // 元素进入动画 API
      animAPI: {
        get(i) { const s = data.slides[i == null ? cur : i]; return (s.elements || []).map(e => animOf(e)); },
        set(o) { if (!selEl) return false; selEl.anim = Object.assign({}, animOf(selEl), o); ctx.markDirty(); syncAnimControls(); return true; },
        preview() { previewEntrance(); }
      },
      // 元素强调动画 API（放映时点击触发）
      emphasisAPI: {
        types: EMPHASIS,
        get() { return emphasisOf(selEl); },
        set(type) { if (!selEl) return false; selEl.emphasis = { type: type || "none" }; ctx.markDirty(); syncEmphControls(); return true; },
        apply(domEl) { applyEmphasis(domEl, emphasisOf(selEl)); }
      },
      scriptHtml() { return speakerScriptHtml({ name: doc.name, data: data }); },
      // 母版版式 API
      layouts: () => LAYOUTS.slice(),
      layout,
      setLayout,
      deleteEl,
      addEl,
      // 撤销 / 重做 API
      undo,
      redo,
      canUndo,
      canRedo,
      destroy() { if (presSelbar) presSelbar.destroy(); if (presenterEl) presenterEl.remove(); if (ribbon.el) ribbon.el.remove(); wrap.remove(); }
    };
  }

  OS.modules = OS.modules || {};
  OS.modules.presentation = { type: "presentation", blank, mount };
  OS.blankDoc = (function (orig) { return function (t) { if (t === "presentation") return blank(); return orig ? orig(t) : { type: t, data: {} }; }; })(OS.blankDoc);
})(window);
