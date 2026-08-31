/* ============================================================
   绿角犀 Office · PDF 工具模块
   对应 PRD 3.4：阅读批注、合并拆分、PDF⇄Office 转换、表单填写、签名
   - 阅读（pdf.js 离线渲染）✅
   - 合并/拆分（零依赖字节级）✅
   - 批注（高亮/画笔/文字批注/矩形/签名印章，随文档持久化）✅ 新增
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const Anno = OS.PdfAnno;
  const PdfText = OS.PdfText;

  function blank() { return { name: "PDF 文件", dataUrl: "", annotations: [] }; }

  function mount(host, doc, ctx) {
    const data = doc.data && doc.data.dataUrl !== undefined ? doc.data : blank();
    data.annotations = Array.isArray(data.annotations) ? data.annotations : [];
    const wrap = document.createElement("div");
    wrap.className = "module-wrap";
    wrap.innerHTML = `
      <div class="pdf-wrap">
        <div class="pdf-side">
          <button class="btn primary" data-act="open" style="width:100%;margin-bottom:10px">📂 打开 PDF</button>
          <div class="field"><label>跳转页</label><input type="number" data-page min="1" value="1"></div>
          <div class="field"><label>缩放</label>
            <select data-zoom><option>0.8</option><option selected>1</option><option>1.25</option><option>1.5</option><option>2</option></select>
          </div>
          <hr style="border:none;border-top:1px solid var(--rule);margin:10px 0">
          <label class="muted" style="font-size:12px;display:block;margin-bottom:4px">合并多个 PDF（可多选）</label>
          <input type="file" data-merge accept="application/pdf" multiple hidden>
          <button class="btn" data-act="merge" style="width:100%;margin-bottom:8px">➕ 合并所选文件</button>
          <div class="field"><label>拆分页范围</label>
            <input type="text" data-ranges placeholder="如 1-2,3-5" style="width:100%">
          </div>
          <button class="btn" data-act="split" style="width:100%">✂ 按范围拆分</button>
          <p class="muted" style="font-size:11px;margin-top:8px">合并/拆分支持常见 PDF（1.4 风格内联对象）。</p>
        </div>
        <div class="pdf-search">
          <span style="font-size:13px">🔍</span>
          <input type="text" data-search placeholder="搜索 PDF 文字…（选中可复制）" style="flex:1;min-width:0">
          <span class="pdf-search-count" data-search-count></span>
        </div>
        <div class="pdf-view"></div>
      </div>`;
    host.appendChild(wrap);
    const view = wrap.querySelector(".pdf-view");
    const pageInput = wrap.querySelector("[data-page]");
    const zoomSel = wrap.querySelector("[data-zoom]");
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "application/pdf"; fileInput.hidden = true;
    wrap.appendChild(fileInput);
    const mergeInput = wrap.querySelector("[data-merge]");
    const rangesInput = wrap.querySelector("[data-ranges]");
    const annoFileInput = document.createElement("input");
    annoFileInput.type = "file"; annoFileInput.accept = ".json,application/json,.fdf,.xfdf"; annoFileInput.hidden = true;
    wrap.appendChild(annoFileInput);

    let pdfDoc = null, zoom = 1, textIndex = { pages: [] }, pageDims = {};
    let tool = "select";           // select | highlight | pen | note | rect
    let color = Anno.COLORS.highlight;
    let selId = null;
    let annoQuery = "";             // 批注搜索关键字（V：搜索与过滤）
    let annoTypeFilter = null;      // 批注类型过滤（null=全部）
    let batchLayerName = "";        // 批量归层目标图层名（Z：批量操作）
    let batchColor = "#ffeb3b";     // 批量改色目标色（Z：批量操作）

    function emptyState() {
      view.innerHTML = `<div class="pdf-empty"><div style="font-size:48px">📄</div>
        <p>打开一个 PDF 文件开始阅读${global.pdfjsLib ? "" : "（PDF 引擎需联网加载）"}</p>
        <button class="btn primary" data-act="open">📂 打开 PDF</button></div>`;
      view.querySelector('[data-act="open"]').addEventListener("click", () => fileInput.click());
    }

    function dataUrlToU8(d) {
      const i = d.indexOf(","); const b = atob(d.slice(i + 1));
      const u = new Uint8Array(b.length);
      for (let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k);
      return u;
    }
    function u8ToDataUrl(u, mime) {
      let bin = ""; const CH = 8192;
      for (let k = 0; k < u.length; k += CH) bin += String.fromCharCode.apply(null, u.subarray(k, k + CH));
      return "data:" + mime + ";base64," + btoa(bin);
    }
    async function openPdfBytes(u8, name) {
      const dataUrl = u8ToDataUrl(u8, "application/pdf");
      const nd = await OS.store.create({ type: "pdf", name: name || "PDF 文件.pdf" });
      nd.data = { dataUrl, annotations: [] };
      await OS.store.put(nd);
      if (OS.shell && OS.shell.openDoc) OS.shell.openDoc(nd);
    }

    async function loadPdf(dataUrl) {
      if (!global.pdfjsLib) { OS.toast("PDF 引擎未加载，请联网后重试", "err"); emptyState(); return; }
      view.innerHTML = "<p class='muted'>加载中…</p>";
      try {
        const loading = global.pdfjsLib.getDocument(dataUrl);
        pdfDoc = await loading.promise;
        pageInput.max = pdfDoc.numPages;
        renderAll();
        OS.toast(`已打开，共 ${pdfDoc.numPages} 页`, "ok");
      } catch (e) { OS.toast("PDF 解析失败：" + e.message, "err"); emptyState(); }
    }

    // —— 批注覆盖层 ——
    function buildOverlay(box, canvas, p) {
      const ovl = document.createElement("div");
      ovl.className = "pdf-ovl";
      ovl.style.position = "absolute";
      ovl.style.left = "0"; ovl.style.top = "0";
      ovl.style.width = canvas.style.width; ovl.style.height = canvas.style.height;
      ovl.style.pointerEvents = (tool === "select") ? "none" : "auto";
      ovl.style.cursor = (tool === "select") ? "default" : "crosshair";
      box.appendChild(ovl);
      ovl.addEventListener("pointerdown", e => onPointerDown(e, ovl, canvas, p));
      return ovl;
    }

    function renderAnnotations(box, canvas, p) {
      const ovl = box.querySelector(".pdf-ovl");
      if (!ovl) return;
      // 清掉旧的批注元素（保留指针监听的 ovl 容器）
      Array.from(ovl.children).forEach(c => c.remove());
      const rect = canvas.getBoundingClientRect();
      const bw = rect.width || canvas.clientWidth || 1;
      const bh = rect.height || canvas.clientHeight || 1;
      const pageAnno = (OS.PdfAnnoFilter ? OS.PdfAnnoFilter.filterAnnotations(Anno.getPage(data.annotations, p),
        { query: annoQuery, types: annoTypeFilter ? [annoTypeFilter] : null }) : Anno.getPage(data.annotations, p));
      pageAnno.forEach(a => {
        if (a.visible === false) return; // Y：图层/单条可见性控制
        if (a.type === "pen") {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("class", "anno anno-pen");
          svg.style.position = "absolute"; svg.style.left = "0"; svg.style.top = "0";
          svg.style.width = "100%"; svg.style.height = "100%";
          svg.style.pointerEvents = (tool === "select") ? "auto" : "none";
          const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
          const pts = a.points.map(pt => (pt[0] * bw) + "," + (pt[1] * bh)).join(" ");
          poly.setAttribute("points", pts);
          poly.setAttribute("fill", "none");
          poly.setAttribute("stroke", a.color);
          poly.setAttribute("stroke-width", "2.5");
          poly.setAttribute("stroke-linecap", "round");
          poly.setAttribute("stroke-linejoin", "round");
          svg.appendChild(poly);
          decorate(svg, a, ovl);
          ovl.appendChild(svg);
        } else if (a.type === "note") {
          const el = document.createElement("div");
          el.className = "anno anno-note";
          el.textContent = "📌";
          el.title = a.text || "批注";
          el.style.position = "absolute";
          el.style.left = (a.x * bw) + "px"; el.style.top = (a.y * bh) + "px";
          el.style.fontSize = "18px"; el.style.cursor = "pointer";
          el.style.pointerEvents = (tool === "select") ? "auto" : "none";
          el.style.transform = "translate(-2px,-20px)";
          decorate(el, a, ovl);
          ovl.appendChild(el);
        } else if (a.type === "sign") {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("class", "anno anno-sign");
          svg.style.position = "absolute"; svg.style.left = "0"; svg.style.top = "0";
          svg.style.width = "100%"; svg.style.height = "100%";
          svg.style.pointerEvents = (tool === "select") ? "auto" : "none";
          (a.strokes || []).forEach(stroke => {
            if (!stroke || stroke.length < 2) return;
            const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            const pts = stroke.map(pt => ((a.x + pt[0] * a.w) * bw) + "," + ((a.y + pt[1] * a.h) * bh)).join(" ");
            poly.setAttribute("points", pts);
            poly.setAttribute("fill", "none");
            poly.setAttribute("stroke", a.color || Anno.COLORS.sign);
            poly.setAttribute("stroke-width", Math.max(1.5, a.h * bh * 0.06));
            poly.setAttribute("stroke-linecap", "round");
            poly.setAttribute("stroke-linejoin", "round");
            svg.appendChild(poly);
          });
          decorate(svg, a, ovl);
          ovl.appendChild(svg);
        } else if (a.type === "textfield") {
          const el = document.createElement("div");
          el.className = "anno anno-field";
          el.style.position = "absolute";
          el.style.left = (a.x * bw) + "px"; el.style.top = (a.y * bh) + "px";
          el.style.width = (a.w * bw) + "px"; el.style.height = (a.h * bh) + "px";
          el.style.border = "1.5px solid " + (a.color || Anno.COLORS.textfield);
          el.style.background = "rgba(255,255,255,0.82)";
          el.style.boxSizing = "border-box";
          el.style.padding = "2px 4px";
          el.style.fontSize = Math.max(10, a.h * bh * 0.5) + "px";
          el.style.lineHeight = "1.2";
          el.style.color = "#1c1b18";
          el.style.overflow = "hidden";
          el.style.whiteSpace = "pre-wrap";
          el.style.wordBreak = "break-word";
          el.style.pointerEvents = (tool === "select") ? "auto" : "none";
          el.style.cursor = (tool === "select") ? "text" : "crosshair";
          el.textContent = a.text || "";
          decorate(el, a, ovl);
          ovl.appendChild(el);
        } else if (a.type === "checkbox") {
          const sz = Math.min(a.w, a.h);
          const el = document.createElement("div");
          el.className = "anno anno-check";
          el.style.position = "absolute";
          el.style.left = (a.x * bw) + "px"; el.style.top = (a.y * bh) + "px";
          el.style.width = (sz * bw) + "px"; el.style.height = (sz * bh) + "px";
          el.style.border = "1.5px solid " + (a.color || Anno.COLORS.checkbox);
          el.style.borderRadius = "3px";
          el.style.boxSizing = "border-box";
          el.style.background = a.checked ? "rgba(46,125,50,0.14)" : "rgba(255,255,255,0.82)";
          el.style.display = "flex"; el.style.alignItems = "center"; el.style.justifyContent = "center";
          el.style.fontSize = (sz * bh * 0.8) + "px";
          el.style.color = a.checked ? Anno.COLORS.checkbox : "transparent";
          el.style.pointerEvents = (tool === "select") ? "auto" : "none";
          el.style.cursor = (tool === "select") ? "pointer" : "crosshair";
          el.textContent = a.checked ? "✓" : "";
          decorate(el, a, ovl);
          ovl.appendChild(el);
        } else { // highlight / rect
          const el = document.createElement("div");
          el.className = "anno anno-shape";
          const x = a.x * bw, y = a.y * bh, w = a.w * bw, h = a.h * bh;
          el.style.position = "absolute";
          el.style.left = x + "px"; el.style.top = y + "px";
          el.style.width = w + "px"; el.style.height = h + "px";
          if (a.type === "highlight") {
            el.style.background = a.color; el.style.opacity = "0.4";
            el.style.mixBlendMode = "multiply";
          } else {
            el.style.border = "2px solid " + a.color; el.style.background = "transparent";
          }
          el.style.pointerEvents = (tool === "select") ? "auto" : "none";
          el.style.cursor = "pointer";
          decorate(el, a, ovl);
          ovl.appendChild(el);
        }
      });
    }

    function decorate(el, a, ovl) {
      if (tool === "select") {
        const canvas = ovl.parentElement && ovl.parentElement.querySelector("canvas.pdf-page");
        const pg = currentPageOf(ovl);
        const rerender = () => renderAnnotations(ovl.parentElement, canvas, pg);
        if (a.type === "checkbox") {
          el.addEventListener("click", ev => {
            ev.stopPropagation();
            a.checked = !a.checked;
            ctx.markDirty(); rerender();
          });
        } else if (a.type === "textfield") {
          el.addEventListener("dblclick", ev => {
            ev.stopPropagation();
            const t = (global.prompt ? global.prompt("编辑文本框内容：", a.text || "") : null);
            if (t !== null) { a.text = t; ctx.markDirty(); rerender(); }
          });
          el.addEventListener("click", ev => {
            ev.stopPropagation();
            selId = a.id; markSelected(ovl);
            OS.toast("已选中表单文本框，双击编辑文字；可点「删除批注」移除", "info");
          });
        } else {
          el.addEventListener("click", ev => {
            ev.stopPropagation();
            selId = a.id; markSelected(ovl);
            OS.toast("已选中批注，可点「删除批注」移除", "info");
          });
        }
      }
    }
    function markSelected(ovl) {
      Array.from(ovl.querySelectorAll(".anno")).forEach(c => c.style.outline = "");
      if (!selId) return;
      // 简单高亮：给选中批注描边
      const items = Anno.getPage(data.annotations, currentPageOf(ovl));
      // 用 data-id 标记
    }

    function currentPageOf(ovl) {
      const box = ovl.parentElement;
      return box ? (+box.dataset.p || 1) : 1;
    }

    // —— 指针绘制 ——
    let drawing = null;
    function onPointerDown(e, ovl, canvas, p) {
      if (tool === "select") return;
      e.preventDefault();
      const rect = ovl.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (tool === "note") {
        const text = (global.prompt ? global.prompt("输入批注文字：", "") : "");
        if (text == null) return;
        Anno.add(data.annotations, { page: p, type: "note", x: sx / rect.width, y: sy / rect.height, text, color });
        ctx.markDirty(); renderAnnotations(ovl.parentElement, canvas, p);
        OS.toast("已添加文字批注", "ok");
        return;
      }
      if (tool === "checkbox") {
        const size = 0.03;
        Anno.add(data.annotations, { page: p, type: "checkbox", x: sx / rect.width - size / 2, y: sy / rect.height - size / 2, w: size, h: size, checked: false, color });
        ctx.markDirty(); renderAnnotations(ovl.parentElement, canvas, p);
        OS.toast("已添加复选框", "ok");
        return;
      }
      if (tool === "pen") {
        drawing = { type: "pen", points: [[sx, sy]], color };
        ovl.setPointerCapture(e.pointerId);
        return;
      }
      // highlight / rect
      drawing = { type: tool, x0: sx, y0: sy, color };
      const prev = document.createElement("div");
      prev.className = "anno-preview"; prev.style.position = "absolute";
      prev.style.left = sx + "px"; prev.style.top = sy + "px"; prev.style.width = "0px"; prev.style.height = "0px";
      if (tool === "highlight") { prev.style.background = color; prev.style.opacity = "0.4"; prev.style.mixBlendMode = "multiply"; }
      else { prev.style.border = "2px solid " + color; }
      prev.style.pointerEvents = "none";
      ovl.appendChild(prev);
      drawing.preview = prev;
      ovl.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e, ovl, canvas, p) {
      if (!drawing) return;
      const rect = ovl.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (drawing.type === "pen") {
        drawing.points.push([x, y]);
        // 实时折线
        if (!drawing.svg) {
          drawing.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          drawing.svg.style.position = "absolute"; drawing.svg.style.left = "0"; drawing.svg.style.top = "0";
          drawing.svg.style.width = "100%"; drawing.svg.style.height = "100%"; drawing.svg.style.pointerEvents = "none";
          drawing.poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
          drawing.poly.setAttribute("fill", "none"); drawing.poly.setAttribute("stroke", drawing.color);
          drawing.poly.setAttribute("stroke-width", "2.5"); drawing.poly.setAttribute("stroke-linecap", "round"); drawing.poly.setAttribute("stroke-linejoin", "round");
          drawing.svg.appendChild(drawing.poly); ovl.appendChild(drawing.svg);
        }
        drawing.poly.setAttribute("points", drawing.points.map(pt => pt[0] + "," + pt[1]).join(" "));
      } else {
        const x0 = Math.min(drawing.x0, x), y0 = Math.min(drawing.y0, y);
        const w = Math.abs(x - drawing.x0), h = Math.abs(y - drawing.y0);
        drawing.preview.style.left = x0 + "px"; drawing.preview.style.top = y0 + "px";
        drawing.preview.style.width = w + "px"; drawing.preview.style.height = h + "px";
      }
    }
    function onPointerUp(e, ovl, canvas, p) {
      if (!drawing) return;
      const rect = ovl.getBoundingClientRect();
      if (drawing.type === "pen") {
        if (drawing.svg) drawing.svg.remove();
        if (drawing.points.length > 1) {
          Anno.add(data.annotations, { page: p, type: "pen", points: drawing.points.map(pt => [pt[0] / rect.width, pt[1] / rect.height]), color: drawing.color });
          ctx.markDirty(); renderAnnotations(ovl.parentElement, canvas, p);
          OS.toast("已添加画笔批注", "ok");
        }
      } else {
        if (drawing.preview) drawing.preview.remove();
        const x0 = Math.min(drawing.x0, e.clientX - rect.left), y0 = Math.min(drawing.y0, e.clientY - rect.top);
        const w = Math.abs((e.clientX - rect.left) - drawing.x0), h = Math.abs((e.clientY - rect.top) - drawing.y0);
        if (w > 3 && h > 3) {
          if (drawing.type === "textfield") {
            const text = (global.prompt ? global.prompt("输入文本框内容（可留空）：", "") : "") || "";
            Anno.add(data.annotations, { page: p, type: "textfield", x: x0 / rect.width, y: y0 / rect.height, w: w / rect.width, h: h / rect.height, text, color: drawing.color });
            ctx.markDirty(); renderAnnotations(ovl.parentElement, canvas, p);
            OS.toast("已添加表单文本框", "ok");
          } else {
            Anno.add(data.annotations, { page: p, type: drawing.type, x: x0 / rect.width, y: y0 / rect.height, w: w / rect.width, h: h / rect.height, color: drawing.color });
            ctx.markDirty(); renderAnnotations(ovl.parentElement, canvas, p);
            OS.toast(drawing.type === "highlight" ? "已添加高亮" : "已添加矩形批注", "ok");
          }
        }
      }
      drawing = null;
    }

    async function renderAll() {
      if (!pdfDoc) return;
      view.innerHTML = "";
      textIndex = { pages: [] };
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        const page = await pdfDoc.getPage(p);
        const scale = zoom * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        pageDims[p] = { w: page.view[2] - page.view[0], h: page.view[3] - page.view[1] };
        const box = document.createElement("div");
        box.className = "pdf-page-box"; box.dataset.p = p;
        box.style.position = "relative"; box.style.margin = "0 auto 16px";
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page"; canvas.dataset.p = p;
        const ctx2d = canvas.getContext("2d");
        canvas.height = vp.height; canvas.width = vp.width;
        canvas.style.width = (vp.width / (window.devicePixelRatio || 1)) + "px";
        canvas.style.height = (vp.height / (window.devicePixelRatio || 1)) + "px";
        await page.render({ canvasContext: ctx2d, viewport: vp }).promise;
        box.appendChild(canvas);
        view.appendChild(box);
        const spans = await buildTextLayer(box, canvas, page, vp);
        textIndex.pages[p - 1] = spans;
        const ovl = buildOverlay(box, canvas, p);
        renderAnnotations(box, canvas, p);
        ovl.addEventListener("pointermove", e => onPointerMove(e, ovl, canvas, p));
        ovl.addEventListener("pointerup", e => onPointerUp(e, ovl, canvas, p));
        ovl.addEventListener("pointercancel", e => onPointerUp(e, ovl, canvas, p));
      }
    }

    // —— 文本层（可选中/复制 + 供搜索）——
    async function buildTextLayer(box, canvas, page, vp) {
      const layer = document.createElement("div");
      layer.className = "pdf-text-layer";
      layer.style.position = "absolute"; layer.style.left = "0"; layer.style.top = "0";
      layer.style.width = canvas.style.width; layer.style.height = canvas.style.height;
      layer.style.pointerEvents = "auto";
      layer.style.userSelect = "text"; layer.style.webkitUserSelect = "text";
      box.appendChild(layer);
      const rect = canvas.getBoundingClientRect();
      const bw = rect.width || vp.width, bh = rect.height || vp.height;
      const spans = [];
      try {
        const tc = await page.getTextContent();
        const Util = global.pdfjsLib && global.pdfjsLib.Util;
        for (const it of tc.items) {
          if (!it.str) continue;
          let x = 0, y = 0, fontH = 10;
          if (Util && Array.isArray(it.transform)) {
            const tx = Util.transform(vp.transform, it.transform);
            x = tx[4]; y = tx[5]; fontH = Math.hypot(tx[2], tx[3]) || fontH;
          } else if (Array.isArray(it.transform)) {
            x = it.transform[4] || 0; y = it.transform[5] || 0; fontH = Math.abs(it.transform[3]) || fontH;
          }
          const w = it.width || fontH;
          spans.push({ text: it.str, x: x / vp.width, y: y / vp.height, w: w / vp.width, h: fontH / vp.height });
          const span = document.createElement("span");
          span.className = "pdf-text-span";
          span.textContent = it.str;
          span.dataset.text = it.str;
          span.style.position = "absolute";
          span.style.left = (x / vp.width * bw) + "px";
          span.style.top = (y / vp.height * bh) + "px";
          span.style.fontSize = (fontH / vp.height * bh) + "px";
          span.style.lineHeight = "1";
          span.style.color = "transparent";
          span.style.whiteSpace = "pre";
          span.style.cursor = "text";
          layer.appendChild(span);
        }
      } catch (e) { /* 文本层失败不阻断阅读 */ }
      return spans;
    }

    // —— 全文搜索高亮 ——
    function runSearch(q) {
      let first = null;
      view.querySelectorAll(".pdf-text-span").forEach(s => {
        const t = (s.dataset.text || "").toLowerCase();
        if (q && t.indexOf(q.toLowerCase()) !== -1) {
          s.style.background = "rgba(255,213,79,0.78)";
          if (!first) first = s;
        } else {
          s.style.background = "";
        }
      });
      const countEl = wrap.querySelector("[data-search-count]");
      if (!q) { if (countEl) countEl.textContent = ""; return; }
      const hits = PdfText.search(textIndex, q);
      if (countEl) countEl.textContent = hits.length ? ("找到 " + hits.length + " 处") : "无匹配";
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function refreshOverlays() {
      view.querySelectorAll(".pdf-page-box").forEach(box => {
        const p = +box.dataset.p;
        const canvas = box.querySelector("canvas");
        const ovl = box.querySelector(".pdf-ovl");
        if (ovl) ovl.style.pointerEvents = (tool === "select") ? "none" : "auto";
        if (ovl) ovl.style.cursor = (tool === "select") ? "default" : "crosshair";
        if (canvas) renderAnnotations(box, canvas, p);
      });
    }

    wrap.querySelector('[data-act="open"]').addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0]; if (!f) return;
      const url = await OS.util.readFile(f, true);
      data.dataUrl = url; data.name = f.name;
      doc.name = f.name; OS.bus.emit("doc-renamed", doc);
      ctx.markDirty(); loadPdf(url);
    });
    pageInput.addEventListener("change", () => {
      const c = view.querySelector(`canvas[data-p="${pageInput.value}"]`);
      if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    zoomSel.addEventListener("change", () => { zoom = +zoomSel.value; renderAll(); });

    // —— 全文搜索 ——
    const searchInput = wrap.querySelector("[data-search]");
    searchInput.addEventListener("input", () => runSearch(searchInput.value.trim()));

    // —— 真实合并 ——
    wrap.querySelector('[data-act="merge"]').addEventListener("click", () => mergeInput.click());
    mergeInput.addEventListener("change", async () => {
      const files = Array.from(mergeInput.files || []);
      if (files.length < 2) { OS.toast("请至少选择 2 个 PDF 进行合并", "warn"); return; }
      try {
        const parts = [];
        for (const f of files) parts.push(dataUrlToU8(await OS.util.readFile(f, true)));
        const merged = OS.PdfTool.mergePdfs(parts);
        await openPdfBytes(merged, "合并结果.pdf");
        OS.toast("已合并 " + files.length + " 个 PDF", "ok");
      } catch (e) { OS.toast("合并失败：" + e.message, "err"); }
    });

    // —— 批注导入（反向读回外部文件 → 注入文档模型）——
    annoFileInput.addEventListener("change", async () => {
      const f = annoFileInput.files[0]; if (!f) return;
      try {
        const text = await OS.util.readFile(f);
        const res = Anno.importFromRaw(text, { normalize: true, dims: p => pageDims[p] });
        if (res.error) { OS.toast("导入失败：" + res.error, "err"); return; }
        if (!res.annotations.length) { OS.toast("未解析到可导入批注（跳过 " + res.skipped + " 条）", "warn"); }
        else {
          data.annotations = data.annotations.concat(res.annotations);
          ctx.markDirty(); refreshOverlays();
          OS.toast("已导入 " + res.annotations.length + " 条批注" + (res.skipped ? "（跳过 " + res.skipped + " 条）" : ""), "ok");
        }
      } catch (e) { OS.toast("导入失败：" + e.message, "err"); }
      finally { annoFileInput.value = ""; }
    });

    // —— 真实拆分 ——
    wrap.querySelector('[data-act="split"]').addEventListener("click", async () => {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF 再拆分", "warn"); return; }
      const raw = (rangesInput.value || "").trim();
      if (!raw) { OS.toast("请填写拆分页范围，如 1-2,3-5", "warn"); return; }
      const ranges = raw.split(/[,\s]+/).map(t => {
        const parts = t.split("-"); const a = parseInt(parts[0], 10);
        const b = parts[1] != null ? parseInt(parts[1], 10) : a;
        return [a, b];
      }).filter(r => r[0] >= 1 && r[1] >= r[0]);
      if (!ranges.length) { OS.toast("页范围格式有误", "warn"); return; }
      try {
        const outs = OS.PdfTool.splitPdf(dataUrlToU8(data.dataUrl), ranges);
        for (let i = 0; i < outs.length; i++) {
          if (outs[i] && outs[i].length) await openPdfBytes(outs[i], "拆分_" + (i + 1) + ".pdf");
        }
        OS.toast("已拆分为 " + outs.filter(o => o && o.length).length + " 份", "ok");
      } catch (e) { OS.toast("拆分失败：" + e.message, "err"); }
    });

    // —— 批注工具组 ——
    function setTool(t) {
      tool = t;
      if (t !== "select") color = Anno.COLORS[t] || color;
      selId = null;
      refreshOverlays();
    }

    const ribbon = OS.Ribbon.create({
      file: { onOpen: ctx.openBackstage },
      tabs: [
        {
          id: "home", label: "开始", groups: [
            { label: "文件", items: [ { kind: "btn", icon: "file", title: "打开 PDF", label: "打开", onClick: () => fileInput.click() } ] },
            { label: "视图", items: [ { kind: "select", title: "缩放", width: 92, value: String(zoom),
                options: [ { value: "0.8", label: "80%" }, { value: "1", label: "100%" }, { value: "1.25", label: "125%" }, { value: "1.5", label: "150%" }, { value: "2", label: "200%" } ],
                onChange: v => { zoom = +v; renderAll(); } } ] }
          ]
        },
        {
          id: "anno", label: "批注", groups: [
            { label: "工具", items: [
              { kind: "btn", icon: "cursor", title: "选择/移动", label: "选择", onClick: () => setTool("select") },
              { kind: "btn", icon: "highlight", title: "拖拽框选高亮", label: "高亮", onClick: () => setTool("highlight") },
              { kind: "btn", icon: "pen", title: "自由画笔", label: "画笔", onClick: () => setTool("pen") },
              { kind: "btn", icon: "note", title: "点击添加文字批注", label: "文字批注", onClick: () => setTool("note") },
              { kind: "btn", icon: "rect", title: "拖拽画矩形", label: "矩形", onClick: () => setTool("rect") },
              { kind: "btn", icon: "edit", title: "手写签名并盖章到页面", label: "签名", onClick: () => openSignPad() },
              { kind: "btn", icon: "textfield", title: "拖拽画表单文本框", label: "文本框", onClick: () => setTool("textfield") },
              { kind: "btn", icon: "checkbox", title: "点击放置表单复选框", label: "复选框", onClick: () => setTool("checkbox") }
            ] },
            { label: "搜索与过滤", items: [
              { kind: "input", type: "text", width: 150, placeholder: "搜索批注文字/作者…", title: "按文字/作者/类型/链接过滤批注（留空显示全部）", value: "", onInput: (v) => { annoQuery = v || ""; refreshOverlays(); } },
              { kind: "select", width: 120, title: "按类型过滤", value: "", options: [
                  { value: "", label: "全部类型" },
                  { value: "highlight", label: "高亮" }, { value: "pen", label: "画笔" },
                  { value: "note", label: "文字批注" }, { value: "rect", label: "矩形" },
                  { value: "sign", label: "签名" }, { value: "textfield", label: "文本框" },
                  { value: "checkbox", label: "复选框" }, { value: "freetext", label: "自由文本" },
                  { value: "stamp", label: "图章" }, { value: "link", label: "链接" }
                ], onChange: (v) => { annoTypeFilter = v || null; refreshOverlays(); } }
            ] },
            { label: "批量操作", items: [
              { kind: "btn", icon: "trash", title: "删除当前筛选范围内的全部批注（先在上方的「搜索与过滤」中限定范围）", label: "删除筛选结果", onClick: () => {
                  const ids = OS.PdfAnnoBatch.currentScope(data.annotations, { query: annoQuery, type: annoTypeFilter || "" });
                  if (!ids.length) { OS.toast("当前筛选范围无批注", "info"); return; }
                  const n = OS.PdfAnnoBatch.bulkDelete(data.annotations, ids);
                  ctx.markDirty(); refreshOverlays(); OS.toast("已批量删除 " + n + " 条批注", "ok");
                } },
              { kind: "input", type: "text", width: 110, placeholder: "目标图层名", title: "批量将筛选结果归入该图层", value: "", onInput: (v) => { batchLayerName = v || ""; } },
              { kind: "btn", icon: "grid", title: "将筛选结果归入上方填写的图层名", label: "归层", onClick: () => {
                  const ids = OS.PdfAnnoBatch.currentScope(data.annotations, { query: annoQuery, type: annoTypeFilter || "" });
                  if (!ids.length) { OS.toast("当前筛选范围无批注", "info"); return; }
                  const name = (batchLayerName || "").trim() || "default";
                  const n = OS.PdfAnnoBatch.bulkSetLayer(data.annotations, ids, name);
                  ctx.markDirty(); refreshOverlays(); OS.toast("已将 " + n + " 条批注归入「" + name + "」", "ok");
                } },
              { kind: "select", width: 90, title: "批量改色目标色", value: "#ffeb3b", options: [
                  { value: "#ffeb3b", label: "黄" }, { value: "#ff5252", label: "红" },
                  { value: "#4caf50", label: "绿" }, { value: "#2196f3", label: "蓝" },
                  { value: "#9c27b0", label: "紫" }, { value: "#000000", label: "黑" }
                ], onChange: (v) => { batchColor = v || "#ffeb3b"; } },
              { kind: "btn", icon: "edit", title: "将筛选结果批量改为上方所选颜色", label: "改色", onClick: () => {
                  const ids = OS.PdfAnnoBatch.currentScope(data.annotations, { query: annoQuery, type: annoTypeFilter || "" });
                  if (!ids.length) { OS.toast("当前筛选范围无批注", "info"); return; }
                  const n = OS.PdfAnnoBatch.bulkSetColor(data.annotations, ids, batchColor);
                  ctx.markDirty(); refreshOverlays(); OS.toast("已批量改色 " + n + " 条批注", "ok");
                } },
              { kind: "btn", icon: "eye-off", title: "隐藏筛选范围内的全部批注", label: "隐藏筛选结果", onClick: () => {
                  const ids = OS.PdfAnnoBatch.currentScope(data.annotations, { query: annoQuery, type: annoTypeFilter || "" });
                  if (!ids.length) { OS.toast("当前筛选范围无批注", "info"); return; }
                  const n = OS.PdfAnnoBatch.bulkSetVisible(data.annotations, ids, false);
                  ctx.markDirty(); refreshOverlays(); OS.toast("已隐藏 " + n + " 条批注", "ok");
                } },
              { kind: "btn", icon: "preview", title: "显示筛选范围内的全部批注", label: "显示筛选结果", onClick: () => {
                  const ids = OS.PdfAnnoBatch.currentScope(data.annotations, { query: annoQuery, type: annoTypeFilter || "" });
                  if (!ids.length) { OS.toast("当前筛选范围无批注", "info"); return; }
                  const n = OS.PdfAnnoBatch.bulkSetVisible(data.annotations, ids, true);
                  ctx.markDirty(); refreshOverlays(); OS.toast("已显示 " + n + " 条批注", "ok");
                } }
            ] },

            { label: "管理", items: [
              { kind: "btn", icon: "trash", title: "删除选中批注", label: "删除批注", onClick: () => {
                  if (!selId) { OS.toast("请先用「选择」工具点选一个批注", "warn"); return; }
                  if (Anno.remove(data.annotations, selId)) { selId = null; ctx.markDirty(); refreshOverlays(); OS.toast("已删除批注", "ok"); }
                } },
              { kind: "btn", icon: "clear", title: "清空当前文档全部批注", label: "清空批注", onClick: () => {
                  if (!data.annotations.length) { OS.toast("暂无批注", "info"); return; }
                  data.annotations = []; selId = null; ctx.markDirty(); refreshOverlays(); OS.toast("已清空全部批注", "ok");
                } },
              { kind: "btn", icon: "comment", title: "将页面与批注扁平化导出为可分享 PDF", label: "导出带批注PDF", onClick: () => exportAnnotated() },
              { kind: "btn", icon: "docx", title: "将 PDF 文本提取为可编辑 DOCX（仅文本层，版面还原有限）", label: "导出为Word", onClick: () => exportAsWord() },
              { kind: "btn", icon: "txt", title: "将 PDF 文本提取为纯文本（.txt）", label: "导出为文本", onClick: () => exportAsText() },
              { kind: "btn", icon: "md", title: "将 PDF 文本提取为 Markdown（.md）", label: "导出为MD", onClick: () => exportAsMarkdown() },
              { kind: "btn", icon: "table", title: "将 PDF 文本按行/列提取为可编辑表格（CSV，Excel 可直接打开）", label: "导出为表格", onClick: () => exportAsExcel() },
              { kind: "btn", icon: "import", title: "从外部文件导入批注（JSON / FDF / XFDF，自动归一化坐标并注入当前文档）", label: "导入批注", onClick: () => annoFileInput.click() }
            ] },
            { label: "清单与属性", items: [
              { kind: "btn", icon: "md", title: "将全部批注导出为 Markdown 审阅清单", label: "批注清单(MD)", onClick: () => {
                  if (!data.annotations.length) { OS.toast("暂无批注", "info"); return; }
                  const md = OS.PdfAnnoSummary.toMarkdown(data.annotations, { title: (doc.name || "文档") + " 批注清单" });
                  OS.util.download(new Blob([md], { type: "text/markdown" }), (doc.name || "批注") + "_批注清单.md");
                  OS.toast("已导出批注清单（Markdown）", "ok");
                } },
              { kind: "btn", icon: "table", title: "将全部批注导出为 CSV 审阅清单", label: "批注清单(CSV)", onClick: () => {
                  if (!data.annotations.length) { OS.toast("暂无批注", "info"); return; }
                  const csv = OS.PdfAnnoSummary.toCsv(data.annotations);
                  OS.util.download(new Blob([csv], { type: "text/csv" }), (doc.name || "批注") + "_批注清单.csv");
                  OS.toast("已导出批注清单（CSV）", "ok");
                } },
              { kind: "btn", icon: "page-setup", title: "查看 PDF 文档属性（标题 / 作者 / 创建时间等）", label: "文档属性", onClick: () => showDocProps() },
              { kind: "btn", icon: "eye-off", title: "隐藏 / 显示「选中批注」所在的整个图层", label: "切换选中图层", onClick: () => {
                  if (!selId) { OS.toast("请先用「选择」工具点选一个批注", "warn"); return; }
                  const a = Anno.getById(data.annotations, selId); if (!a) return;
                  const layer = a.layer || "default";
                  const grp = (Anno.groupByLayer(data.annotations)[layer]) || [];
                  const anyHidden = grp.some(x => x.visible === false);
                  Anno.setVisibleForLayer(data.annotations, layer, anyHidden);
                  ctx.markDirty(); refreshOverlays();
                  OS.toast(anyHidden ? ("已显示图层「" + layer + "」") : ("已隐藏图层「" + layer + "」"), "ok");
                } },
              { kind: "btn", icon: "preview", title: "将所有图层批注恢复显示", label: "全部显示", onClick: () => {
                  Object.keys(Anno.groupByLayer(data.annotations)).forEach(l => Anno.setVisibleForLayer(data.annotations, l, true));
                  ctx.markDirty(); refreshOverlays(); OS.toast("已显示全部批注", "ok");
                } }
            ] },
            { label: "文档对比", items: [
              { kind: "btn", icon: "merge", title: "将当前文档文本与另一版本做差异对比：粘贴对比文本后生成增/删/未变彩色报告", label: "文档对比", onClick: () => showDocDiff() }
            ] },
            { label: "书签目录", items: [
              { kind: "btn", icon: "toc", title: "查看 PDF 书签目录（Outline），点击条目跳转到对应页，支持搜索与导出 Markdown", label: "书签目录", onClick: () => showOutline() }
            ] },
            { label: "附件", items: [
              { kind: "btn", icon: "download", title: "查看并下载 PDF 内嵌附件（EmbeddedFiles）：列出文档中打包的文件，逐条下载或导出附件清单", label: "附件列表", onClick: () => showAttachments() }
            ] },
            { label: "页码标签", items: [
              { kind: "btn", icon: "page-setup", title: "查看 PDF 页码标签（PageLabels）：列出每页人类可读标签（i/ii/1/A-3…），点击或按标签跳转，可导出清单", label: "页码标签", onClick: () => showPageLabels() }
            ] },
            { label: "统计", items: [
              { kind: "btn", icon: "chart", title: "按类型 / 作者 / 颜色 / 日期 / 页面 / 图层聚合统计当前文档批注，并导出统计报告（Markdown / CSV）", label: "批注统计", onClick: () => showAnnoStats() }
            ] },
            { label: "时间线", items: [
              { kind: "btn", icon: "line-chart", title: "按创建时间升序排列批注，按天分组展示时间线流，点击条目跳转到对应页，支持导出 Markdown", label: "批注时间线", onClick: () => showTimeline() }
            ] },
            { label: "结构", items: [
              { kind: "btn", icon: "node-child", title: "查看 PDF 文档结构树（StructTreeRoot，tagged PDF 逻辑结构）：列出语义结构（H1/P/Table…）分级与标题，点击跳页、搜索、导出 Markdown", label: "文档结构", onClick: () => showStructTree() }
            ] },
            { label: "链接", items: [
              { kind: "btn", icon: "link", title: "提取 PDF 中所有外部 URI 链接与内部跳转（外链审计）：标注链接 / 大纲链接 / 独立动作，列出并导出 Markdown 报告", label: "链接审计", onClick: () => showLinks() }
            ] },
            { label: "加密", items: [
              { kind: "btn", icon: "lock", title: "检测 PDF 是否加密：解析 /Encrypt 字典，列出算法(RC4/AES-128/AES-256)/强度/密钥长度/版本修订/权限清单(打印·修改·复制·批注·填表·提取无障碍·组装·高分辨率打印)，并导出检测报告(MD)", label: "加密检测", onClick: () => showEncryption() }
            ] }
          ]
        }
      ]
    });

    if (data.dataUrl) loadPdf(data.dataUrl); else emptyState();

    function exportAs(fmt) {
      if (fmt === "pdf" && data.dataUrl) OS.util.download(dataUrlToBlob(data.dataUrl), doc.name || "file.pdf");
      else if (fmt === "json") OS.util.download(new Blob([JSON.stringify(data)], { type: "application/json" }), (doc.name || "pdf") + ".json");
    }

    // data:URL（base64）→ 字节（供文档属性/书签目录等纯模块解析用）
    function dataUrlToBytes(url) {
      const m = /^data:.*?;base64,(.*)$/.exec(url || "");
      if (!m) return url;
      const bin = (global.atob ? global.atob(m[1]) : Buffer.from(m[1], "base64").toString("binary"));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }

    // X：文档属性（解析 PDF Info 字典）
    function showDocProps() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      const bytes = dataUrlToBytes(data.dataUrl);
      const info = (OS.PdfProps && OS.PdfProps.parseInfo) ? OS.PdfProps.parseInfo(bytes) : {};
      const rows = [
        ["文件名", doc.name || "—"],
        ["页数", (typeof pdfDoc !== "undefined" && pdfDoc && pdfDoc.numPages) ? pdfDoc.numPages : "—"],
        ["标题", info.title || "—"],
        ["作者", info.author || "—"],
        ["主题", info.subject || "—"],
        ["创建者", info.creator || "—"],
        ["生产者", info.producer || "—"],
        ["创建时间", info.creationdate || info.creationDate || "—"],
        ["修改时间", info.moddate || info.modDate || "—"]
      ];
      const esc = s => String(s == null ? "—" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const html = rows.map(r => "<div style='display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee'><span style='color:#888'>" + esc(r[0]) + "</span><b style='max-width:60%;text-align:right;word-break:break-all'>" + esc(r[1]) + "</b></div>").join("");
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML = "<div style='background:#fff;color:#222;min-width:340px;max-width:92vw;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'><h3 style='margin:0 0 12px'>文档属性</h3>" + html + "<div style='text-align:right;margin-top:14px'><button class='btn primary' id='dpclose'>关闭</button></div></div>";
      ov.addEventListener("click", e => { if (e.target === ov || e.target.id === "dpclose") ov.remove(); });
      document.body.appendChild(ov);
    }

    // AA：文档对比（文本差异 Diff）
    function showDocDiff() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      if (!OS.PdfDiff || !OS.PdfDiff.diffDocs) { OS.toast("对比引擎未就绪", "err"); return; }
      const cur = (OS.PdfText && OS.PdfText.allText) ? OS.PdfText.allText(textIndex) : "";
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(900px,94vw);max-height:90vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 10px'>文档对比（文本差异）</h3>" +
          "<div style='font-size:12px;color:#888;margin-bottom:8px'>当前文档：" + cur.split("\n").length + " 行文本。粘贴另一版本（如修订稿）到下方，点击「开始对比」生成增 / 删 / 未变报告。</div>" +
          "<textarea id='ddiff_in' style='width:100%;height:120px;resize:vertical;font:13px/1.5 monospace;padding:8px;border:1px solid #ccc;border-radius:6px' placeholder='在此粘贴另一版本文本…'></textarea>" +
          "<div style='display:flex;gap:16px;align-items:center;margin:8px 0'>" +
            "<label style='font-size:13px'><input type='checkbox' id='ddiff_ws'> 忽略空白差异</label>" +
            "<label style='font-size:13px'><input type='checkbox' id='ddiff_ci'> 忽略大小写</label>" +
            "<button class='btn primary' id='ddiff_run' style='margin-left:auto'>开始对比</button>" +
            "<button class='btn' id='ddiff_close'>关闭</button>" +
          "</div>" +
          "<div id='ddiff_out' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:8px;font:12px/1.5 monospace;white-space:pre-wrap;background:#fafafa'></div>" +
        "</div>";
      ov.addEventListener("click", e => { if (e.target === ov || e.target.id === "ddiff_close") ov.remove(); });
      document.body.appendChild(ov);
      const run = () => {
        const other = document.getElementById("ddiff_in").value || "";
        const opts = { ignoreWhitespace: document.getElementById("ddiff_ws").checked, ignoreCase: document.getElementById("ddiff_ci").checked };
        const res = OS.PdfDiff.diffDocs(cur, other, opts);
        const s = res.summary;
        const esc = t => String(t == null ? "" : t).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
        const stat = "<div style='padding:6px 8px;margin-bottom:6px;background:#fff;border:1px solid #ddd;border-radius:6px'>共 " + s.total + " 行 · <span style='color:#2e7d32'>新增 " + s.added + "（" + s.addedPct + "%）</span> · <span style='color:#c62828'>删除 " + s.removed + "（" + s.removedPct + "%）</span> · <span style='color:#555'>未变 " + s.unchanged + "（" + s.unchangedPct + "%）</span></div>";
        const lines = res.diff.map(o => {
          if (o.type === "eq") return "<div style='color:#444'>  " + esc(o.aText) + "</div>";
          if (o.type === "add") return "<div style='background:#e8f5e9;color:#1b5e20'>+ " + esc(o.bText) + "</div>";
          return "<div style='background:#ffebee;color:#b71c1c'>- " + esc(o.aText) + "</div>";
        }).join("");
        document.getElementById("ddiff_out").innerHTML = stat + lines;
      };
      document.getElementById("ddiff_run").addEventListener("click", run);
    }

    // AB：书签目录（Outline / TOC）
    // pdf.js 的 dest 可能是命名目标/显式目标数组，需解析为 1-based 页码
    async function resolveDestPages(items) {
      const out = [];
      for (const it of items || []) {
        const node = Object.assign({}, it);
        if (node.page == null && node.dest != null && typeof node.dest !== "number" && pdfDoc && pdfDoc.getDestination) {
          try {
            const dest = await pdfDoc.getDestination(node.dest);
            if (dest && dest[0]) node.page = (await pdfDoc.getPageIndex(dest[0])) + 1;
          } catch (e) { /* 解析失败则保留 page=null，仍可显示标题 */ }
        }
        node.items = await resolveDestPages(node.items);
        out.push(node);
      }
      return out;
    }

    async function showOutline() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      if (!OS.PdfOutline) { OS.toast("目录引擎未就绪", "err"); return; }
      let tree = [];
      try {
        if (pdfDoc && pdfDoc.getOutline) {
          const raw = await pdfDoc.getOutline();
          if (raw && raw.length) tree = OS.PdfOutline.normalizeOutline(await resolveDestPages(raw), null);
        }
        if (!tree.length) tree = OS.PdfOutline.parseRawOutline(dataUrlToBytes(data.dataUrl));
      } catch (e) {
        tree = OS.PdfOutline.parseRawOutline(dataUrlToBytes(data.dataUrl));
      }
      if (!tree.length) { OS.toast("该文档没有书签目录", "info"); return; }
      const flat = OS.PdfOutline.flattenOutline(tree);
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 10px'>书签目录<span style='font-size:12px;color:#888;font-weight:normal'> · 共 " + flat.length + " 条</span></h3>" +
          "<input id='ol_search' type='text' placeholder='搜索目录标题…' style='width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:6px;margin-bottom:8px'>" +
          "<div id='ol_body' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:8px;font-size:13px;background:#fafafa'>" + OS.PdfOutline.toHtml(tree) + "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='ol_md'>导出目录(MD)</button> <button class='btn primary' id='ol_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "ol_close") { ov.remove(); return; }
        if (e.target.id === "ol_md") {
          const md = "# " + (doc.name || "文档") + " 目录\n\n" + OS.PdfOutline.toMarkdown(tree);
          OS.util.download(new Blob([md], { type: "text/markdown" }), (doc.name || "目录") + "_目录.md");
          OS.toast("已导出目录（Markdown）", "ok");
          return;
        }
        const jump = e.target.closest ? e.target.closest("[data-page]") : null;
        if (jump) {
          const p = jump.getAttribute("data-page");
          const c = view.querySelector('canvas[data-p="' + p + '"]');
          if (c) { c.scrollIntoView({ behavior: "smooth", block: "start" }); if (pageInput) pageInput.value = p; }
          ov.remove();
        }
      });
      document.body.appendChild(ov);
      const si = document.getElementById("ol_search");
      if (si) si.addEventListener("input", () => {
        const q = si.value.trim();
        const t = q ? OS.PdfOutline.searchOutline(tree, q) : tree;
        document.getElementById("ol_body").innerHTML = OS.PdfOutline.toHtml(t);
      });
    }

    // AC：PDF 附件（EmbeddedFiles）查看与下载
    function renderAttachmentsPanel(list) {
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const row = (a, i) =>
        "<div style='display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #eee'>" +
          "<span style='flex:1;min-width:0;word-break:break-all'>" +
            "<b>" + esc(a.name || ("附件" + (i + 1))) + "</b>" +
            "<small style='color:#888;margin-left:6px'>" + esc(a.mime || "未知类型") + " · 约 " + (a.size || 0) + " 字节" + (a.compressed ? " · 原始流未解压" : "") + "</small>" +
            (a.desc ? "<br><span style='color:#666;font-size:12px'>" + esc(a.desc) + "</span>" : "") +
          "</span>" +
          "<button class='btn primary' data-dl='" + i + "'>下载</button>" +
        "</div>";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 10px'>PDF 附件<span style='font-size:12px;color:#888;font-weight:normal'> · 共 " + list.length + " 个</span></h3>" +
          "<div id='att_body' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:4px 8px;background:#fafafa'>" + list.map(row).join("") + "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='att_md'>导出清单(MD)</button> <button class='btn primary' id='att_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "att_close") { ov.remove(); return; }
        if (e.target.id === "att_md") {
          const md = "# " + (doc.name || "文档") + " 附件清单\n\n" + OS.PdfAttachments.toMarkdown(list);
          OS.util.download(new Blob([md], { type: "text/markdown;charset=utf-8" }), (doc.name || "附件") + "_附件清单.md");
          OS.toast("已导出附件清单（Markdown）", "ok");
          return;
        }
        const dl = e.target.getAttribute && e.target.getAttribute("data-dl");
        if (dl != null) {
          const a = list[+dl];
          if (!a || !a.data) { OS.toast("该附件无可下载数据（原始流未解压）", "warn"); return; }
          OS.util.download(new Blob([a.data], { type: a.mime || "application/octet-stream" }), a.name || ("attachment-" + dl));
          OS.toast("已下载：" + (a.name || ("附件" + dl)), "ok");
        }
      });
      document.body.appendChild(ov);
    }

    async function showAttachments() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      if (!OS.PdfAttachments) { OS.toast("附件引擎未就绪", "err"); return; }
      let list = [];
      // 优先用 pdf.js 解码（含 FlateDecode 解压，最可靠）
      if (pdfDoc && pdfDoc.getAttachments) {
        try {
          const atts = await pdfDoc.getAttachments();
          if (atts) {
            for (const k in atts) {
              const a = atts[k];
              if (!a) continue;
              list.push({ name: a.filename || k, mime: a.contentType || "application/octet-stream", size: (a.content && a.content.length) || 0, data: a.content, compressed: false, desc: a.description || "" });
            }
          }
        } catch (e) { list = []; }
      }
      // 回退：纯模块解析（与 Node 单测同款逻辑）
      if (!list.length) {
        try { list = OS.PdfAttachments.parseRawAttachments(dataUrlToBytes(data.dataUrl)); }
        catch (e) { list = []; }
      }
      if (!list.length) { OS.toast("该文档没有内嵌附件", "info"); return; }
      renderAttachmentsPanel(list);
    }

    // AD：PDF 页码标签（PageLabels）查看与按标签跳转
    function showPageLabels() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      if (!OS.PdfPageLabels) { OS.toast("页码标签引擎未就绪", "err"); return; }
      if (!pdfDoc || !pdfDoc.numPages) { OS.toast("请等待 PDF 加载完成", "warn"); return; }
      const leaves = OS.PdfPageLabels.parseRawPageLabels(dataUrlToBytes(data.dataUrl));
      const labels = OS.PdfPageLabels.buildLabels(pdfDoc.numPages, leaves);
      const hasLabels = leaves.length > 0;
      const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const rowHtml = labels.map((lab, i) =>
        "<div data-page='" + (i + 1) + "' style='display:flex;justify-content:space-between;gap:10px;padding:6px 8px;border-bottom:1px solid #eee;cursor:pointer'>" +
          "<span style='color:#888;width:64px;flex:none'>第 " + (i + 1) + " 页</span>" +
          "<b style='flex:1;text-align:right;word-break:break-all'>" + esc(lab || "—") + "</b>" +
        "</div>"
      ).join("");
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(520px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 4px'>PDF 页码标签<span style='font-size:12px;color:#888;font-weight:normal'> · 共 " + labels.length + " 页" + (hasLabels ? "" : "（文档未定义标签，按默认十进制显示）") + "</span></h3>" +
          "<input id='pl_jump' type='text' placeholder='输入标签跳转（如 ii / A-3 / 5）…' style='width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:6px;margin:8px 0'>" +
          "<div id='pl_body' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:4px 8px;background:#fafafa;font-size:13px'>" + rowHtml + "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='pl_md'>导出清单(MD)</button> <button class='btn primary' id='pl_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "pl_close") { ov.remove(); return; }
        if (e.target.id === "pl_md") {
          const md = OS.PdfPageLabels.toMarkdown(labels, { title: (doc.name || "文档") + " 页码标签" });
          OS.util.download(new Blob([md], { type: "text/markdown;charset=utf-8" }), (doc.name || "页码标签") + "_页码标签.md");
          OS.toast("已导出页码标签清单（Markdown）", "ok");
          return;
        }
        const jump = e.target.closest ? e.target.closest("[data-page]") : null;
        if (jump) {
          const p = jump.getAttribute("data-page");
          const c = view.querySelector('canvas[data-p="' + p + '"]');
          if (c) { c.scrollIntoView({ behavior: "smooth", block: "start" }); if (pageInput) pageInput.value = p; }
          ov.remove();
        }
      });
      document.body.appendChild(ov);
      const ji = document.getElementById("pl_jump");
      if (ji) ji.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        const q = ji.value.trim();
        const p = OS.PdfPageLabels.labelToPage(labels, q);
        if (p < 1) { OS.toast("未找到匹配标签：" + q, "warn"); return; }
        const c = view.querySelector('canvas[data-p="' + p + '"]');
        if (c) { c.scrollIntoView({ behavior: "smooth", block: "start" }); if (pageInput) pageInput.value = p; }
        ov.remove();
      });
    }

    // —— 文档结构树：解析 StructTreeRoot 逻辑结构，分级展示 + 跳页 + 搜索 + 导出 ——
    async function showStructTree() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      if (!OS.PdfStructTree) { OS.toast("结构树引擎未就绪", "err"); return; }
      if (!pdfDoc || !pdfDoc.numPages) { OS.toast("请等待 PDF 加载完成", "warn"); return; }
      let tree = [];
      try { tree = OS.PdfStructTree.parseRawStructTree(dataUrlToBytes(data.dataUrl)); } catch (e) { tree = []; }
      if (!tree.length) { OS.toast("该文档不是带标签的 PDF（无逻辑结构树）", "info"); return; }
      const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 4px'>文档结构树<span style='font-size:12px;color:#888;font-weight:normal'> · 共 " + tree.length + " 个顶层结构</span></h3>" +
          "<input id='st_search' type='text' placeholder='搜索结构（标题或类型，如 第一章 / H1）…' style='width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:6px;margin:8px 0'>" +
          "<div id='st_body' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:6px 10px;background:#fafafa;font-size:13px'>" + OS.PdfStructTree.toHtml(tree) + "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='st_md'>导出结构(MD)</button> <button class='btn primary' id='st_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "st_close") { ov.remove(); return; }
        if (e.target.id === "st_md") {
          const md = OS.PdfStructTree.toMarkdown(tree);
          OS.util.download(new Blob([md], { type: "text/markdown;charset=utf-8" }), (doc.name || "结构树") + "_结构树.md");
          OS.toast("已导出文档结构树（Markdown）", "ok");
          return;
        }
        const jump = e.target.closest ? e.target.closest("[data-page]") : null;
        if (jump) {
          const p = jump.getAttribute("data-page");
          const c = view.querySelector('canvas[data-p="' + p + '"]');
          if (c) { c.scrollIntoView({ behavior: "smooth", block: "start" }); if (pageInput) pageInput.value = p; }
          ov.remove();
        }
      });
      document.body.appendChild(ov);
      const si = document.getElementById("st_search");
      if (si) si.addEventListener("input", () => {
        const q = si.value.trim();
        const t = q ? OS.PdfStructTree.searchStruct(tree, q) : tree;
        document.getElementById("st_body").innerHTML = OS.PdfStructTree.toHtml(t);
      });
    }

    // —— 批注统计面板：按类型/作者/颜色/日期/页面/图层聚合，条形图展示占比 ——
    function showAnnoStats() {
      if (!OS.PdfAnnoStats) { OS.toast("统计引擎未就绪", "err"); return; }
      const annos = data.annotations || [];
      if (!annos.length) { OS.toast("暂无批注，无法统计", "info"); return; }
      const S = OS.PdfAnnoStats.aggregate(annos);
      const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const barBg = (x, isColorDim) =>
        (isColorDim && /^#[0-9a-fA-F]{3,8}$/.test(String(x.key))) ? String(x.key) : "#2f7d4f";
      // 单个维度块：名称 + 每项占比条形图
      function block(name, obj, useLabel, isColorDim) {
        const r = OS.PdfAnnoStats.rank(obj);
        if (!r.length) return "";
        const maxc = r[0].count || 1;
        const rows = r.map(x =>
          "<div style='margin:5px 0'>" +
            "<div style='display:flex;justify-content:space-between;font-size:12px'>" +
              "<span>" + esc(useLabel ? x.label : x.key) + "</span>" +
              "<span style='color:#666'>" + x.count + " 条 · " + x.pct + "%</span>" +
            "</div>" +
            "<div style='height:6px;background:#eee;border-radius:3px;overflow:hidden'>" +
              "<div style='height:100%;width:" + Math.max(2, Math.round(x.count / maxc * 100)) + "%;background:" + barBg(x, isColorDim) + "'></div>" +
            "</div>" +
          "</div>"
        ).join("");
        return "<div style='margin-bottom:12px'><b style='font-size:13px'>" + name + "</b>" + rows + "</div>";
      }
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 10px'>批注统计<span style='font-size:12px;color:#888;font-weight:normal'> · 共 " + S.total + " 条</span></h3>" +
          "<div style='font-size:12px;color:#555;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:8px 10px;margin-bottom:12px'>" +
            "显示 <b>" + S.visibleCount + "</b> · 隐藏 <b>" + S.hiddenCount + "</b> · 文本总量 <b>" + S.textTotal + "</b> 字 · 平均 <b>" + S.textAvg + "</b> 字/条" +
            (S.firstDate ? "<br>时间跨度：" + S.firstDate + " ~ " + S.lastDate : "") +
            (S.busiestPage ? "<br>批注最多：第 " + S.busiestPage.page + " 页（" + S.busiestPage.count + " 条）" : "") +
            (S.topAuthor ? "<br>最活跃作者：" + esc(S.topAuthor.author) + "（" + S.topAuthor.count + " 条）" : "") +
          "</div>" +
          "<div id='as_body' style='flex:1;overflow:auto;font-size:13px'>" +
            block("按类型", S.byType, true, false) +
            block("按作者", S.byAuthor, false, false) +
            block("按颜色", S.byColor, false, true) +
            block("按日期", S.byDate, false, false) +
            block("按页面", S.byPage, false, false) +
            block("按图层", S.byLayer, false, false) +
          "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='as_md'>导出统计(MD)</button> <button class='btn' id='as_csv'>导出统计(CSV)</button> <button class='btn primary' id='as_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "as_close") { ov.remove(); return; }
        if (e.target.id === "as_md") {
          const md = OS.PdfAnnoStats.toMarkdown(S, { title: (doc.name || "文档") + " 批注统计" });
          OS.util.download(new Blob([md], { type: "text/markdown;charset=utf-8" }), (doc.name || "批注") + "_批注统计.md");
          OS.toast("已导出批注统计（Markdown）", "ok");
          return;
        }
        if (e.target.id === "as_csv") {
          const csv = OS.PdfAnnoStats.toCsv(S);
          OS.util.download(new Blob([csv], { type: "text/csv;charset=utf-8" }), (doc.name || "批注") + "_批注统计.csv");
          OS.toast("已导出批注统计（CSV）", "ok");
        }
      });
      document.body.appendChild(ov);
    }

    // —— 批注时间线：按创建时间升序 + 按天分组，点击条目跳页 + 导出 MD ——
    function showTimeline() {
      if (!OS.PdfAnnoTimeline) { OS.toast("时间线引擎未就绪", "err"); return; }
      const annos = data.annotations || [];
      if (!annos.length) { OS.toast("暂无批注，无法生成时间线", "info"); return; }
      const tl = OS.PdfAnnoTimeline.buildTimeline(annos);
      const sum = OS.PdfAnnoTimeline.summarize(tl);
      const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(580px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 4px'>批注时间线<span style='font-size:12px;color:#888;font-weight:normal'> · 共 " + tl.total + " 条 / " + tl.entries.length + " 天</span></h3>" +
          "<div style='font-size:12px;color:#555;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:6px 10px;margin:6px 0 8px'>" +
            (sum.earliest ? "起：" + esc(sum.earliest.slice(0, 10)) + " &nbsp; 止：" + esc(sum.latest.slice(0, 10)) : "") +
            (sum.topAuthor ? "<br>最活跃：" + esc(sum.topAuthor) : "") +
          "</div>" +
          "<div id='tl_body' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:6px 10px;background:#fafafa;font-size:13px'>" + OS.PdfAnnoTimeline.toHtml(tl) + "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='tl_md'>导出时间线(MD)</button> <button class='btn primary' id='tl_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "tl_close") { ov.remove(); return; }
        if (e.target.id === "tl_md") {
          const md = OS.PdfAnnoTimeline.toMarkdown(tl);
          OS.util.download(new Blob([md], { type: "text/markdown;charset=utf-8" }), (doc.name || "批注") + "_时间线.md");
          OS.toast("已导出批注时间线（Markdown）", "ok");
          return;
        }
        const jump = e.target.closest ? e.target.closest("[data-page]") : null;
        if (jump) {
          const p = jump.getAttribute("data-page");
          const c = view.querySelector('canvas[data-p="' + p + '"]');
          if (c) { c.scrollIntoView({ behavior: "smooth", block: "start" }); if (pageInput) pageInput.value = p; }
          ov.remove();
        }
      });
      document.body.appendChild(ov);
    }

    // AH：PDF 链接/URI 提取（外链审计）—— 列出所有外部 URI 链接与内部跳转
    function showLinks() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      if (!OS.PdfLinks) { OS.toast("链接提取引擎未就绪", "err"); return; }
      let res = null;
      try { res = OS.PdfLinks.extractLinks(dataUrlToBytes(data.dataUrl)); } catch (e) { res = null; }
      if (!res || !res.total) { OS.toast("该文档未检测到链接（URI / 内部跳转）", "info"); return; }
      const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const rows = res.links.map(l => {
        const badge = l.kind === "uri" ? (l.source === "annotation" ? "标注" : l.source === "outline" ? "大纲" : "动作") : "跳转";
        const page = l.page != null ? "第 " + l.page + " 页" : "—";
        const body = l.kind === "uri"
          ? '<a href="' + esc(l.target) + '" target="_blank" rel="noopener" style="color:#2563eb;word-break:break-all">' + esc(l.target) + '</a>'
          : '<span style="word-break:break-all">' + esc(l.target) + '</span>';
        return '<div style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;display:flex;gap:8px;align-items:baseline">' +
          '<span style="flex:none;background:#eef;color:#345;padding:1px 6px;border-radius:4px;font-size:11px">' + esc(badge) + '</span>' +
          '<span style="flex:none;color:#888;width:54px">' + page + '</span>' +
          '<span style="flex:1">' + body + '</span></div>';
      }).join("");
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(620px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 4px'>PDF 链接审计<span style='font-size:12px;color:#888;font-weight:normal'> · 共 " + res.total + " 条（外链 " + res.uriCount + " / 跳转 " + res.gotoCount + "）</span></h3>" +
          "<div id='lk_body' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:4px 8px;background:#fafafa;margin-top:8px'>" + rows + "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='lk_md'>导出报告(MD)</button> <button class='btn primary' id='lk_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "lk_close") { ov.remove(); return; }
        if (e.target.id === "lk_md") {
          const md = OS.PdfLinks.toMarkdown(res, { title: (doc.name || "文档") + " 链接审计" });
          OS.util.download(new Blob([md], { type: "text/markdown;charset=utf-8" }), (doc.name || "链接") + "_链接审计.md");
          OS.toast("已导出链接审计报告（Markdown）", "ok");
        }
      });
      document.body.appendChild(ov);
    }

    function showEncryption() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return; }
      if (!OS.PdfEncrypt) { OS.toast("加密检测引擎未就绪", "err"); return; }
      let res = null;
      try { res = OS.PdfEncrypt.parseEncryption(dataUrlToBytes(data.dataUrl)); } catch (e) { res = null; }
      if (!res || !res.encrypted) { OS.toast("该文档未加密（未发现 /Encrypt）", "info"); return; }
      const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const permRows = (res.permissions && res.permissions.items || []).map(p =>
        '<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #eee;font-size:13px">' +
        '<span>' + esc(p.label) + '</span>' +
        '<span style="color:' + (p.allowed ? "#15803d" : "#b91c1c") + ';font-weight:600">' + (p.allowed ? "✅ 允许" : "⛔ 禁止") + '</span></div>'
      ).join("");
      const meta =
        '<div style="padding:4px 8px;font-size:13px;color:#333">' +
        '算法 <b>' + esc(res.algorithm) + '</b>（强度 ' + esc(res.strength) + '）｜ 密钥 ' + (res.keyLength != null ? res.keyLength + "bit" : "—") + ' ｜ R=' + (res.revision != null ? res.revision : "—") + ' ｜ 元数据加密：' + (res.encryptMetadata == null ? "—" : (res.encryptMetadata ? "是" : "否")) +
        '</div>';
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      ov.innerHTML =
        "<div style='background:#fff;color:#222;width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:10px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.3)'>" +
          "<h3 style='margin:0 0 4px'>PDF 加密检测<span style='font-size:12px;color:#888;font-weight:normal'> · 打开需密码（用户或所有者）</span></h3>" +
          meta +
          "<div id='enc_body' style='flex:1;overflow:auto;border:1px solid #eee;border-radius:6px;padding:4px 8px;background:#fafafa;margin-top:8px'>" + permRows + "</div>" +
          "<div style='text-align:right;margin-top:12px'><button class='btn' id='enc_md'>导出报告(MD)</button> <button class='btn primary' id='enc_close'>关闭</button></div>" +
        "</div>";
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.id === "enc_close") { ov.remove(); return; }
        if (e.target.id === "enc_md") {
          const md = OS.PdfEncrypt.toMarkdown(res, { title: (doc.name || "文档") + " 加密检测" });
          OS.util.download(new Blob([md], { type: "text/markdown;charset=utf-8" }), (doc.name || "加密") + "_加密检测.md");
          OS.toast("已导出加密检测报告（Markdown）", "ok");
        }
      });
      document.body.appendChild(ov);
    }

    // —— 扁平化导出：把每页渲染画布 + 批注覆盖层绘制到离屏画布，再写为真实 PDF ——
    async function exportAnnotated() {
      if (!pdfDoc) { OS.toast("请先打开一个 PDF 再导出", "warn"); return; }
      if (!global.pdfjsLib) { OS.toast("PDF 引擎未加载，请联网后重试", "err"); return; }
      const boxes = view.querySelectorAll(".pdf-page-box");
      if (!boxes.length) { OS.toast("当前没有可导出页面", "warn"); return; }
      try {
        const pages = [];
        for (const box of boxes) {
          const p = +box.dataset.p;
          const canvas = box.querySelector("canvas.pdf-page");
          if (!canvas) continue;
          const cw = canvas.width, ch = canvas.height;
          const off = document.createElement("canvas");
          off.width = cw; off.height = ch;
          const octx = off.getContext("2d");
          octx.drawImage(canvas, 0, 0);
          const cssW = parseFloat(canvas.style.width) || cw;
          const scale = cw / cssW;
          Anno.getPage(data.annotations, p).forEach(a => {
            if (a.type === "highlight") {
              octx.save(); octx.globalAlpha = 0.4; octx.fillStyle = a.color;
              octx.fillRect(a.x * cw, a.y * ch, a.w * cw, a.h * ch); octx.restore();
            } else if (a.type === "rect") {
              octx.strokeStyle = a.color; octx.lineWidth = 2 * scale;
              octx.strokeRect(a.x * cw, a.y * ch, a.w * cw, a.h * ch);
            } else if (a.type === "pen") {
              if (!a.points || a.points.length < 2) return;
              octx.strokeStyle = a.color; octx.lineWidth = 2 * scale;
              octx.lineJoin = "round"; octx.lineCap = "round"; octx.beginPath();
              a.points.forEach((pt, i) => { const X = pt[0] * cw, Y = pt[1] * ch; if (i === 0) octx.moveTo(X, Y); else octx.lineTo(X, Y); });
              octx.stroke();
            } else if (a.type === "note") {
              octx.fillStyle = a.color;
              octx.beginPath(); octx.arc(a.x * cw, a.y * ch, 6 * scale, 0, Math.PI * 2); octx.fill();
              octx.fillStyle = "#ffffff"; octx.font = (10 * scale) + "px sans-serif";
              octx.textBaseline = "middle"; octx.textAlign = "center";
              octx.fillText("!", a.x * cw, a.y * ch);
            } else if (a.type === "sign") {
              octx.strokeStyle = a.color || Anno.COLORS.sign;
              octx.lineWidth = Math.max(1.5, a.h * ch * 0.06);
              octx.lineJoin = "round"; octx.lineCap = "round";
              (a.strokes || []).forEach(stroke => {
                if (!stroke || stroke.length < 2) return;
                octx.beginPath();
                stroke.forEach((pt, i) => {
                  const X = (a.x + pt[0] * a.w) * cw, Y = (a.y + pt[1] * a.h) * ch;
                  if (i === 0) octx.moveTo(X, Y); else octx.lineTo(X, Y);
                });
                octx.stroke();
              });
            } else if (a.type === "textfield") {
              // 表单文本框：白底 + 边框 + 文字（图像型扁平化）
              octx.save();
              octx.fillStyle = "rgba(255,255,255,0.85)";
              octx.fillRect(a.x * cw, a.y * ch, a.w * cw, a.h * ch);
              octx.strokeStyle = a.color || Anno.COLORS.textfield;
              octx.lineWidth = 1.5 * scale;
              octx.strokeRect(a.x * cw, a.y * ch, a.w * cw, a.h * ch);
              octx.fillStyle = "#1c1b18";
              octx.font = (a.h * ch * 0.6) + "px sans-serif";
              octx.textBaseline = "top";
              octx.fillText(a.text || "", a.x * cw + 3, a.y * ch + 2);
              octx.restore();
            } else if (a.type === "checkbox") {
              // 表单复选框：见方边框 + 勾选时画 ✓
              const sz = Math.min(a.w, a.h) * cw;
              octx.save();
              octx.strokeStyle = a.color || Anno.COLORS.checkbox;
              octx.lineWidth = 1.5 * scale;
              octx.strokeRect(a.x * cw, a.y * ch, sz, sz);
              if (a.checked) {
                octx.fillStyle = a.color || Anno.COLORS.checkbox;
                octx.font = sz + "px sans-serif";
                octx.textBaseline = "top";
                octx.fillText("✓", a.x * cw + sz * 0.1, a.y * ch);
              }
              octx.restore();
            }
          });
          const img = octx.getImageData(0, 0, cw, ch);
          pages.push({ width: cw, height: ch, data: img.data });
        }
        if (!pages.length) { OS.toast("没有可导出的页面", "warn"); return; }
        const pdf = await OS.PdfTool.writeImagePdf(pages);
        const blob = new Blob([pdf], { type: "application/pdf" });
        const base = (doc.name || "file").replace(/\.pdf$/i, "");
        OS.util.download(blob, base + "_批注.pdf");
        OS.toast("已导出带批注 PDF（" + pages.length + " 页）", "ok");
      } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
    }

    // —— PDF → DOCX 文本提取（轻量骨架）：复用已建立的文本层索引，聚类成行生成可编辑 DOCX ——
    async function exportAsWord() {
      if (!pdfDoc) { OS.toast("请先打开一个 PDF 再导出", "warn"); return; }
      try {
        if (!textIndex || !textIndex.pages || !textIndex.pages.length) {
          OS.toast("当前文档尚未建立文本索引，请等待渲染完成", "warn"); return;
        }
        if (!OS.PdfConvert || typeof OS.PdfConvert.pdfToDocx !== "function") {
          OS.toast("转换组件未就绪", "err"); return;
        }
        const zip = OS.PdfConvert.pdfToDocx(textIndex.pages, doc.name || "PDF 转换");
        if (!zip) { OS.toast("转换失败：导出器未就绪", "err"); return; }
        const blob = await zip.generateAsync({ type: "blob" });
        const base = (doc.name || "document").replace(/\.pdf$/i, "");
        OS.util.download(blob, base + ".docx");
        OS.toast("已导出为可编辑 DOCX（文本提取，版面还原有限）", "ok");
    } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
  }

  // —— PDF → 纯文本：复用文本层索引，拼接各页文本（可选页码分隔）——
  async function exportAsText() {
    if (!pdfDoc) { OS.toast("请先打开一个 PDF 再导出", "warn"); return; }
    try {
      if (!textIndex || !textIndex.pages || !textIndex.pages.length) {
        OS.toast("当前文档尚未建立文本索引，请等待渲染完成", "warn"); return;
      }
      if (!OS.PdfConvert || typeof OS.PdfConvert.pdfToText !== "function") {
        OS.toast("转换组件未就绪", "err"); return;
      }
      const text = OS.PdfConvert.pdfToText(textIndex.pages, { pageMarkers: true });
      if (!text) { OS.toast("无文本可导出", "warn"); return; }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const base = (doc.name || "document").replace(/\.pdf$/i, "");
      OS.util.download(blob, base + ".txt");
      OS.toast("已导出为纯文本（" + text.length + " 字符）", "ok");
    } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
  }

  // —— PDF → Markdown：复用文本层索引，大字号行判 #/## 标题 ——
  async function exportAsMarkdown() {
    if (!pdfDoc) { OS.toast("请先打开一个 PDF 再导出", "warn"); return; }
    try {
      if (!textIndex || !textIndex.pages || !textIndex.pages.length) {
        OS.toast("当前文档尚未建立文本索引，请等待渲染完成", "warn"); return;
      }
      if (!OS.PdfConvert || typeof OS.PdfConvert.pdfToMarkdown !== "function") {
        OS.toast("转换组件未就绪", "err"); return;
      }
      const md = OS.PdfConvert.pdfToMarkdown(textIndex.pages);
      if (!md) { OS.toast("无文本可导出", "warn"); return; }
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const base = (doc.name || "document").replace(/\.pdf$/i, "");
      OS.util.download(blob, base + ".md");
      OS.toast("已导出为 Markdown（" + md.length + " 字符）", "ok");
    } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
  }

  // —— PDF → Excel(CSV)：复用文本层索引，按行/列启发式提取为 CSV ——
  async function exportAsExcel() {
    if (!pdfDoc) { OS.toast("请先打开一个 PDF 再导出", "warn"); return; }
    try {
      if (!textIndex || !textIndex.pages || !textIndex.pages.length) {
        OS.toast("当前文档尚未建立文本索引，请等待渲染完成", "warn"); return;
      }
      if (!OS.PdfConvert || typeof OS.PdfConvert.pdfToExcel !== "function") {
        OS.toast("转换组件未就绪", "err"); return;
      }
      const csv = OS.PdfConvert.pdfToExcel(textIndex.pages, { pageMarkers: true });
      if (!csv) { OS.toast("无文本可导出", "warn"); return; }
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const base = (doc.name || "document").replace(/\.pdf$/i, "");
      OS.util.download(blob, base + ".csv");
      OS.toast("已导出为表格 CSV（Excel 可直接打开，含 " + csv.split("\n").filter(Boolean).length + " 行）", "ok");
    } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
  }

  function dataUrlToBlob(u) { const [h, b] = u.split(","); const mime = /:(.*?);/.exec(h)[1]; const bin = atob(b); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: mime }); }

    // —— 签名手写板：采集笔画 -> 盖章到当前可视页 ——
    function openSignPad() {
      if (!pdfDoc) { OS.toast("请先打开一个 PDF 再签名", "warn"); return; }
      const PW = 360, PH = 150;
      const modal = document.createElement("div");
      modal.className = "pdf-sign-modal";
      modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999";
      modal.innerHTML = `
        <div style="background:var(--surface,#fff);border-radius:12px;padding:18px;width:${PW + 36}px;box-shadow:0 12px 40px rgba(0,0,0,.3)">
          <div style="font-weight:600;margin-bottom:8px">手写签名</div>
          <canvas class="sign-pad" width="${PW}" height="${PH}" style="width:${PW}px;height:${PH}px;border:1.5px dashed var(--rule,#aaa);border-radius:8px;background:#fafafa;touch-action:none;cursor:crosshair"></canvas>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button class="btn" data-act="clear">清除</button>
            <button class="btn" data-act="cancel">取消</button>
            <button class="btn primary" data-act="ok">盖章</button>
          </div>
        </div>`;
      (host.ownerDocument || document).body.appendChild(modal);
      const pad = modal.querySelector(".sign-pad");
      const pctx = pad.getContext("2d");
      pctx.strokeStyle = Anno.COLORS.sign; pctx.lineWidth = 2.2; pctx.lineJoin = "round"; pctx.lineCap = "round";
      let strokes = [], cur = null;
      function padXY(e) {
        const r = pad.getBoundingClientRect();
        const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
        return [Math.max(0, Math.min(PW, cx)), Math.max(0, Math.min(PH, cy))];
      }
      function down(e) { e.preventDefault(); cur = [padXY(e)]; strokes.push(cur); pad.setPointerCapture && pad.setPointerCapture(e.pointerId); }
      function move(e) { if (!cur) return; e.preventDefault(); const [x, y] = padXY(e); cur.push([x, y]); pctx.beginPath(); const n = cur.length; pctx.moveTo(cur[n - 2][0], cur[n - 2][1]); pctx.lineTo(x, y); pctx.stroke(); }
      function up() { cur = null; }
      pad.addEventListener("pointerdown", down);
      pad.addEventListener("pointermove", move);
      pad.addEventListener("pointerup", up);
      pad.addEventListener("pointercancel", up);
      modal.querySelector('[data-act="clear"]').addEventListener("click", () => { strokes = []; pctx.clearRect(0, 0, PW, PH); });
      modal.querySelector('[data-act="cancel"]').addEventListener("click", () => modal.remove());
      modal.querySelector('[data-act="ok"]').addEventListener("click", () => {
        if (!strokes.length || strokes.every(s => s.length < 2)) { OS.toast("请先手写签名", "warn"); return; }
        const normStrokes = strokes.map(s => s.map(pt => [pt[0] / PW, pt[1] / PH]));
        stampSignature(normStrokes);
        modal.remove();
      });
      modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
    }

    function stampSignature(strokes) {
      // 目标页：视图中距视口中心最近的一页
      const boxes = Array.from(view.querySelectorAll(".pdf-page-box"));
      if (!boxes.length) { OS.toast("当前没有可盖章的页面", "warn"); return; }
      let target = boxes[0], best = Infinity;
      const vc = (window.innerHeight || 800) / 2;
      boxes.forEach(b => { const r = b.getBoundingClientRect(); const c = r.top + r.height / 2; const d = Math.abs(c - vc); if (d < best) { best = d; target = b; } });
      const p = +target.dataset.p;
      // 笔画自身包围盒 -> 宽高比，决定印章尺寸
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      strokes.forEach(s => s.forEach(pt => { minX = Math.min(minX, pt[0]); minY = Math.min(minY, pt[1]); maxX = Math.max(maxX, pt[0]); maxY = Math.max(maxY, pt[1]); }));
      const sw = Math.max(maxX - minX, 0.0001), sh = Math.max(maxY - minY, 0.0001);
      let w = Math.min(0.32, 0.32); let h = w * (sh / sw);
      if (h > 0.32) { h = 0.32; w = h * (sw / sh); }
      const x = Math.max(0.02, Math.min(0.98 - w, 0.5 - w / 2));
      const y = Math.max(0.02, Math.min(0.98 - h, 0.82 - h / 2));
      const item = Anno.add(data.annotations, { page: p, type: "sign", strokes, x, y, w, h, color: Anno.COLORS.sign });
      ctx.markDirty();
      const canvas = target.querySelector("canvas.pdf-page");
      renderAnnotations(target, canvas, p);
      OS.toast("已盖章签名到当前页", "ok");
    }

    return {
      serialize() { return data; },
      exportAs,
      focus() {},
      ribbon,
      destroy() { wrap.remove(); }
    };
  }

  OS.modules = OS.modules || {};
  OS.modules.pdf = { type: "pdf", blank, mount };
  OS.blankDoc = (function (orig) { return function (t) { if (t === "pdf") return blank(); return orig ? orig(t) : { type: t, data: {} }; }; })(OS.blankDoc);
})(window);
