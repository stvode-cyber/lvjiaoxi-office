/* ============================================================
   绿角犀 Office · Writer 文字处理模块
   对应 PRD 3.1：流式排版、样式/大纲、批注、OOXML 双向保真、PDF/OFD 导出
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  function blank() {
    return {
      html: '<h1>未命名文档</h1><p><br></p>', comments: [],
      page: { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } },
      header: { left: "", center: "", right: "" },
      footer: { left: "", center: "", right: "" }
    };
  }

  function mount(host, doc, ctx) {
    const data = (doc.data && doc.data.html) ? doc.data : blank();
    data.comments = data.comments || [];
    const DEF_PAGE = { size: "A4", orientation: "portrait", margin: { top: 25, right: 25, bottom: 25, left: 25 } };
    data.page = Object.assign({}, DEF_PAGE, data.page || {});
    data.page.margin = Object.assign({}, DEF_PAGE.margin, (data.page && data.page.margin) || {});
    const DEF_HF = { left: "", center: "", right: "" };
    data.header = Object.assign({}, DEF_HF, data.header || {});
    data.footer = Object.assign({}, DEF_HF, data.footer || {});

    const wrap = document.createElement("div");
    wrap.className = "module-wrap writer-wrap";
    wrap.innerHTML = `
      <div class="writer-main">
        <div class="doc-surface">
          <div class="page writer-page" contenteditable="true" spellcheck="false"></div>
        </div>
        <aside class="cmt-panel" id="cmt-panel">
          <div class="cmt-panel-head">
            <span class="cmt-panel-title">评论</span>
            <span class="cmt-count" id="cmt-count"></span>
            <button class="cmt-toggle" id="cmt-toggle" title="显示/隐藏评论">${OS.icons.svg("eye", 16)}</button>
          </div>
          <div class="cmt-list" id="cmt-list"></div>
        </aside>
      </div>
      <div class="writer-statusbar" id="writer-statusbar">
        <span id="sb-words">字数 0</span>
        <span id="sb-chars">字符 0</span>
        <span id="sb-paras">段落 0</span>
        <span id="sb-read">约 0 分钟</span>
      </div>
      <div class="find-panel" id="find-panel" hidden>
        <div class="find-row">
          <input class="find-input" id="find-input" placeholder="查找" />
          <button class="find-btn" id="find-prev" title="上一个 (Shift+Enter)">↑</button>
          <button class="find-btn" id="find-next" title="下一个 (Enter)">↓</button>
          <span class="find-count" id="find-count"></span>
          <button class="find-btn" id="find-close" title="关闭">✕</button>
        </div>
        <div class="find-row">
          <input class="find-input" id="find-replace-input" placeholder="替换为（可留空）" />
          <button class="find-btn primary" id="find-replace" title="替换当前匹配">替换</button>
          <button class="find-btn primary" id="find-all" title="替换全部匹配">全部</button>
          <label class="find-case"><input type="checkbox" id="find-case" /> 区分大小写</label>
        </div>
      </div>`;
    host.appendChild(wrap);
    const page = wrap.querySelector(".writer-page");
    const panel = wrap.querySelector("#cmt-panel");
    const listEl = wrap.querySelector("#cmt-list");
    const countEl = wrap.querySelector("#cmt-count");

    let comments = data.comments;
    let activeCid = null;
    let panelOpen = true;
    let navIdx = -1;

    const mark = OS.util.debounce(() => ctx.markDirty(), 400);
    page.addEventListener("input", e => {
      const cell = e.target.closest && e.target.closest(".wh-cell");
      if (cell) {
        const zoneEl = cell.closest(".wh-header, .wh-footer");
        const zone = zoneEl && zoneEl.dataset.zone;
        const col = cell.classList.contains("wh-l") ? "left" : cell.classList.contains("wh-c") ? "center" : "right";
        if (zone) data[zone][col] = cell.innerHTML;
      }
      mark(); updateStatus();
    });

    function exec(cmd, val) {
      page.focus();
      try { document.execCommand(cmd, false, val || null); } catch (e) {}
      ctx.markDirty();
    }

    /* ---------- P0 增强：字体 / 段落 / 剪贴板 辅助 ---------- */
    function setFontSize(px) {
      page.focus();
      try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
      try { document.execCommand("fontSize", false, px + "px"); } catch (e) {}
      try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
      ctx.markDirty();
    }

    function bumpFontSize(dir) {
      const sel = window.getSelection();
      let cur = 16;
      if (sel && sel.anchorNode) {
        let n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode;
        while (n && n !== page && !n.style) n = n.parentNode;
        const cs = n && n.style ? getComputedStyle(n) : null;
        if (cs && cs.fontSize) { const m = parseFloat(cs.fontSize); if (!isNaN(m)) cur = m; }
      }
      const next = Math.max(8, Math.min(72, Math.round(cur + dir * 2)));
      setFontSize(next);
    }

    function setLineHeight(lh) {
      page.focus();
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      let node = sel.anchorNode;
      if (!node) return;
      if (node.nodeType === 3) node = node.parentNode;
      const blocks = ["P", "DIV", "LI", "H1", "H2", "H3", "BLOCKQUOTE", "TD", "TH"];
      let target = node;
      while (target && target !== page && !blocks.includes(target.tagName)) target = target.parentNode;
      if (target && target !== page) target.style.lineHeight = lh;
      else page.style.lineHeight = lh;
      ctx.markDirty();
    }

    function multiLevelList() {
      exec("insertOrderedList");
      // 已在列表内时，缩进形成 1.1 / 1.1.1 嵌套层级
      setTimeout(() => exec("indent"), 0);
    }

    function doPaste() {
      page.focus();
      try { document.execCommand("paste"); }
      catch (e) { OS.toast("请使用 Ctrl+V 粘贴", "warn"); }
    }

    let brushFormat = null;
    function toggleFormatBrush() {
      const sel = window.getSelection();
      if (!brushFormat) {
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { OS.toast("先选中带格式的文字", "warn"); return; }
        const n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode;
        const cs = getComputedStyle(n);
        brushFormat = {
          fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, textDecoration: cs.textDecoration,
          color: cs.color, fontFamily: cs.fontFamily, fontSize: cs.fontSize
        };
        OS.toast("已复制格式，选中目标文字应用", "ok");
      } else {
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { OS.toast("请选中要应用格式的文字", "warn"); return; }
        page.focus();
        try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
        if (/bold|700|800|900/.test(brushFormat.fontWeight)) document.execCommand("bold");
        if (brushFormat.fontStyle === "italic") document.execCommand("italic");
        if (/underline/.test(brushFormat.textDecoration)) document.execCommand("underline");
        if (brushFormat.color && brushFormat.color !== "rgba(0, 0, 0, 0)") document.execCommand("foreColor", false, brushFormat.color);
        try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
        brushFormat = null;
        OS.toast("已应用格式", "ok");
        ctx.markDirty();
      }
    }

    /* ---------- P1 增强：边框 / 底纹 / 字符边框 / 排序 ---------- */
    function currentBlock() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      let node = sel.anchorNode;
      if (!node) return null;
      if (node.nodeType === 3) node = node.parentNode;
      const blocks = ["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH"];
      let target = node;
      while (target && target !== page && !blocks.includes(target.tagName)) target = target.parentNode;
      return (target && target !== page) ? target : page;
    }

    function applyBlockStyle(prop, val) {
      const blk = currentBlock();
      if (!blk) return;
      page.focus();
      blk.style[prop] = val;
      ctx.markDirty();
    }

    function wrapCharBorder() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { OS.toast("请先选中文字", "warn"); return; }
      page.focus();
      const range = sel.getRangeAt(0);
      const span = document.createElement("span");
      span.style.border = "1px solid currentColor";
      span.style.padding = "0 1px";
      try { range.surroundContents(span); }
      catch (e) {
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
      ctx.markDirty();
      OS.toast("已加字符边框", "ok");
    }

    function sortParagraphs(desc) {
      page.focus();
      const sel = window.getSelection();
      let container = page;
      if (sel && sel.rangeCount) {
        let n = sel.anchorNode;
        if (n && n.nodeType === 3) n = n.parentNode;
        let p = n;
        while (p && p !== page && p.tagName !== "UL" && p.tagName !== "OL") p = p.parentNode;
        if (p && p !== page) container = p;
      }
      const items = Array.from(container.children).filter(el =>
        /^(P|DIV|LI|H1|H2|H3|H4|H5|H6|BLOCKQUOTE)$/.test(el.tagName));
      if (items.length < 2) { OS.toast("需要至少两个段落才能排序", "warn"); return; }
      const sorted = items.slice().sort((a, b) => {
        const ta = a.textContent.trim().toLowerCase(), tb = b.textContent.trim().toLowerCase();
        return desc ? tb.localeCompare(ta, "zh") : ta.localeCompare(tb, "zh");
      });
      sorted.forEach(el => container.appendChild(el));
      ctx.markDirty();
      OS.toast(desc ? "已按降序排序" : "已按升序排序", "ok");
    }

    function genId() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

    /* ---------- 选区 → 新建批注 ---------- */
    function getSelectionRange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      if (!page.contains(range.commonAncestorContainer)) return null;
      if (!sel.toString().trim()) return null;
      return range;
    }

    function wrapSelection(range, cid) {
      const span = document.createElement("span");
      span.className = "cmt";
      span.dataset.cid = cid;
      try { range.surroundContents(span); }
      catch (e) {
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
      return span;
    }

    function finalizeNewComment(cid) {
      setPanelOpen(true);
      renderComments();
      activeCid = cid;
      highlightCard(cid);
      const input = listEl.querySelector('.cmt-card[data-cid="' + cid + '"] .cmt-input');
      if (input) input.focus();
      ctx.markDirty();
    }

    function addComment() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { OS.toast("请先选中要评论的文字", "warn"); return; }
      const range = sel.getRangeAt(0);
      const text = sel.toString();
      if (!text.trim()) { OS.toast("请先选中要评论的文字", "warn"); return; }
      const cid = genId();
      wrapSelection(range, cid);
      sel.removeAllRanges();
      comments.push({ id: cid, quote: text, author: "我", createdAt: Date.now(), resolved: false, replies: [] });
      finalizeNewComment(cid);
      OS.toast("已添加批注", "ok");
    }

    // AI 审阅建议：以「AI 建议」身份写入首条回复，不破坏原文
    function addCommentWithSuggestion(suggestion) {
      const range = getSelectionRange();
      if (!range) { OS.toast("请先选中要审阅的文字", "warn"); return; }
      const text = range.toString();
      if (!text.trim()) { OS.toast("请先选中要审阅的文字", "warn"); return; }
      const cid = genId();
      wrapSelection(range, cid);
      comments.push({
        id: cid, quote: text, author: "我", createdAt: Date.now(), resolved: false,
        replies: [{ author: "AI 建议", createdAt: Date.now(), text: suggestion != null ? suggestion : OS.AI.local.critique(text) }]
      });
      finalizeNewComment(cid);
      OS.toast("已生成 AI 审阅建议", "ok");
    }

    /* ---------- 渲染评论列表 ---------- */
    function renderComments() {
      listEl.innerHTML = "";
      const pending = comments.filter(c => !c.resolved);
      const resolved = comments.filter(c => c.resolved);
      countEl.textContent = comments.length
        ? (pending.length ? pending.length + " 条待处理" : "全部已解决")
        : "";
      if (!comments.length) {
        listEl.innerHTML = '<div class="cmt-empty">暂无评论。<br>选中正文中的文字，再点「新建批注」即可添加。</div>';
        return;
      }
      pending.concat(resolved).forEach(c => listEl.appendChild(commentCard(c)));
    }

    function commentCard(c) {
      const card = document.createElement("div");
      card.className = "cmt-card" + (c.resolved ? " resolved" : "") + (c.id === activeCid ? " active" : "");
      card.dataset.cid = c.id;
      const repliesHtml = (c.replies || []).map(r =>
        `<div class="cmt-reply"><div class="cmt-reply-head"><b>${OS.util.escapeHtml(r.author)}</b><span>${OS.util.fmtTime(r.createdAt)}</span></div><div class="cmt-reply-text">${OS.util.escapeHtml(r.text)}</div></div>`
      ).join("");
      card.innerHTML = `
        <div class="cmt-card-head">
          <span class="cmt-avatar">${OS.util.escapeHtml((c.author || "我").slice(0, 1))}</span>
          <span class="cmt-author">${OS.util.escapeHtml(c.author || "我")}</span>
          <span class="cmt-time">${OS.util.fmtTime(c.createdAt)}</span>
          ${c.resolved ? '<span class="cmt-badge">已解决</span>' : ''}
        </div>
        <div class="cmt-quote" title="跳到正文">${OS.util.escapeHtml(c.quote || "")}</div>
        <div class="cmt-replies">${repliesHtml}</div>
        <div class="cmt-add">
          <input type="text" class="cmt-input" placeholder="回复…" />
          <button class="cmt-send" title="发送回复">${OS.icons.svg("chevron-right", 16)}</button>
        </div>
        <div class="cmt-actions">
          <button class="cmt-btn cmt-resolve">${c.resolved ? "重新打开" : "解决"}</button>
          <button class="cmt-btn cmt-del" title="删除批注">${OS.icons.svg("trash", 14)}</button>
        </div>`;
      card.querySelector(".cmt-quote").onclick = () => focusInText(c.id, true);
      card.querySelector(".cmt-resolve").onclick = () => toggleResolve(c.id);
      card.querySelector(".cmt-del").onclick = () => deleteComment(c.id);
      const input = card.querySelector(".cmt-input");
      const send = () => { const v = input.value.trim(); if (!v) return; addReply(c.id, v); };
      card.querySelector(".cmt-send").onclick = send;
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); send(); } });
      return card;
    }

    function addReply(cid, text) {
      const c = comments.find(x => x.id === cid); if (!c) return;
      c.replies = c.replies || [];
      c.replies.push({ author: "我", text, createdAt: Date.now() });
      renderComments();
      const input = listEl.querySelector('.cmt-card[data-cid="' + cid + '"] .cmt-input');
      if (input) input.focus();
      ctx.markDirty();
    }

    function toggleResolve(cid) {
      const c = comments.find(x => x.id === cid); if (!c) return;
      c.resolved = !c.resolved;
      const s = page.querySelector('[data-cid="' + cid + '"]');
      if (s) s.classList.toggle("cmt-resolved", c.resolved);
      renderComments();
      ctx.markDirty();
    }

    function deleteComment(cid) {
      if (!confirm("删除这条批注？正文中的高亮会保留为普通文字。")) return;
      const s = page.querySelector('[data-cid="' + cid + '"]');
      if (s) {
        const parent = s.parentNode;
        while (s.firstChild) parent.insertBefore(s.firstChild, s);
        parent.removeChild(s);
        if (parent.normalize) parent.normalize();
      }
      comments = comments.filter(x => x.id !== cid);
      if (activeCid === cid) activeCid = null;
      renderComments();
      ctx.markDirty();
    }

    function resolveAll() {
      let n = 0;
      comments.forEach(c => {
        if (!c.resolved) { c.resolved = true; n++; const s = page.querySelector('[data-cid="' + c.id + '"]'); if (s) s.classList.add("cmt-resolved"); }
      });
      if (n) { renderComments(); ctx.markDirty(); OS.toast("已解决 " + n + " 条批注", "ok"); }
      else OS.toast("没有待处理的批注", "warn");
    }

    /* ---------- 导航 ---------- */
    function navComment(dir) {
      const pending = comments.filter(c => !c.resolved);
      if (!pending.length) { OS.toast("没有待处理的批注", "warn"); return; }
      navIdx = (navIdx + dir + pending.length) % pending.length;
      focusInText(pending[navIdx].id, true);
    }

    function focusInText(cid, scroll) {
      const s = page.querySelector('[data-cid="' + cid + '"]');
      if (!s) return;
      activeCid = cid;
      s.classList.remove("cmt-flash"); void s.offsetWidth; s.classList.add("cmt-flash");
      if (scroll && s.scrollIntoView) s.scrollIntoView({ block: "center", behavior: "smooth" });
      setPanelOpen(true);
      highlightCard(cid);
    }

    function highlightCard(cid) {
      listEl.querySelectorAll(".cmt-card").forEach(el => el.classList.toggle("active", el.dataset.cid === cid));
      const card = listEl.querySelector('.cmt-card[data-cid="' + cid + '"]');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: "nearest" });
    }

    /* ---------- 面板显隐 ---------- */
    function setPanelOpen(open) {
      panelOpen = open;
      panel.classList.toggle("hidden", !open);
      wrap.querySelector("#cmt-toggle").classList.toggle("off", !open);
      page.classList.toggle("cmt-hidden", !open);
    }
    function togglePanel() { setPanelOpen(!panelOpen); }

    /* ---------- 文中点击联动 ---------- */
    page.addEventListener("click", e => {
      const tocLink = e.target.closest(".toc-link");
      if (tocLink) {
        const t = document.getElementById(tocLink.dataset.target);
        if (t) {
          if (t.scrollIntoView) { try { t.scrollIntoView({ block: "start" }); } catch (er) {} }
          try { const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(t); sel.removeAllRanges(); sel.addRange(r); } catch (er) {}
          page.focus();
        }
        return;
      }
      const s = e.target.closest(".cmt");
      if (s && s.dataset.cid) {
        activeCid = s.dataset.cid;
        highlightCard(s.dataset.cid);
        if (!panelOpen) setPanelOpen(true);
      }
    });

    function syncResolvedSpans() {
      comments.forEach(c => {
        const s = page.querySelector('[data-cid="' + c.id + '"]');
        if (s) s.classList.toggle("cmt-resolved", !!c.resolved);
      });
    }

    /* ---------- 页面设置（纸张 / 方向 / 页边距 / 打印） ---------- */
    const PAGE_SIZES = {
      A3: [297, 420], A4: [210, 297], A5: [148, 210], B5: [176, 250],
      Letter: [215.9, 279.4], "16K": [184, 260]
    };
    const DPI = 96, MM_PER_IN = 25.4;
    const mmToPx = mm => Math.round(mm * DPI / MM_PER_IN);
    function pageMetrics(setup) {
      const dims = PAGE_SIZES[setup.size] || PAGE_SIZES.A4;
      let w = dims[0], h = dims[1];
      if (setup.orientation === "landscape") { const t = w; w = h; h = t; }
      return { w: w, h: h };
    }
    function buildPrintCss() {
      const pm = pageMetrics(data.page);
      return "@page{size:" + pm.w + "mm " + pm.h + "mm;margin:0}";
    }
    function ensurePrintStyle() {
      let el = document.getElementById("pg-print-style");
      if (!el) { el = document.createElement("style"); el.id = "pg-print-style"; document.head.appendChild(el); }
      el.textContent = buildPrintCss() + "\n@media print{" +
        ".ribbon,.writer-statusbar,.cmt-panel,.find-panel,.pg-overlay,.writer-wrap{display:none!important}" +
        ".pp-root{display:block!important}" +
        ".pp-page{box-shadow:none!important;margin:0!important;page-break-after:always}" +
        "}";
    }
    function applyPageSetup() {
      const m = data.page.margin;
      const pm = pageMetrics(data.page);
      const contentW = pm.w - m.left - m.right;
      const contentH = pm.h - m.top - m.bottom;
      page.style.boxSizing = "border-box";
      page.style.width = mmToPx(contentW) + "px";
      page.style.minHeight = mmToPx(contentH) + "px";
      page.style.padding = mmToPx(m.top) + "px " + mmToPx(m.right) + "px " + mmToPx(m.bottom) + "px " + mmToPx(m.left) + "px";
      if (!page.style.backgroundColor) page.style.backgroundColor = "#fff";
      page.style.boxShadow = "0 1px 4px rgba(0,0,0,.18)";
      page.style.borderRadius = "2px";
      positionHF();
      ensurePrintStyle();
      ctx.markDirty();
    }
    function closePageSetup() { const ov = wrap.querySelector(".pg-overlay"); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
    function openPageSetup() {
      closePageSetup();
      const ov = document.createElement("div");
      ov.className = "pg-overlay";
      const sizes = Object.keys(PAGE_SIZES);
      ov.innerHTML = '<div class="pg-modal">' +
        '<div class="pg-title">页面设置</div>' +
        '<div class="pg-row">' +
          '<label class="pg-field"><span>纸张大小</span><select class="pg-size">' + sizes.map(k => '<option' + (k === data.page.size ? " selected" : "") + '>' + k + '</option>').join("") + '</select></label>' +
          '<div class="pg-field"><span>方向</span><div class="pg-orient">' +
            '<button type="button" data-o="portrait"' + (data.page.orientation === "portrait" ? ' class="on"' : "") + '>纵向</button>' +
            '<button type="button" data-o="landscape"' + (data.page.orientation === "landscape" ? ' class="on"' : "") + '>横向</button>' +
          '</div></div>' +
        '</div>' +
        '<div class="pg-row">' +
          '<label class="pg-field"><span>上边距 (mm)</span><input type="number" class="pg-mt" value="' + data.page.margin.top + '" min="0" max="80"></label>' +
          '<label class="pg-field"><span>下边距 (mm)</span><input type="number" class="pg-mb" value="' + data.page.margin.bottom + '" min="0" max="80"></label>' +
        '</div>' +
        '<div class="pg-row">' +
          '<label class="pg-field"><span>左边距 (mm)</span><input type="number" class="pg-ml" value="' + data.page.margin.left + '" min="0" max="80"></label>' +
          '<label class="pg-field"><span>右边距 (mm)</span><input type="number" class="pg-mr" value="' + data.page.margin.right + '" min="0" max="80"></label>' +
        '</div>' +
        '<div class="pg-preview" id="pg-preview"></div>' +
        '<div class="pg-actions"><button class="pg-cancel">取消</button><button class="pg-ok primary">确定</button></div>' +
      '</div>';
      wrap.appendChild(ov);
      const preview = ov.querySelector("#pg-preview");
      const upd = () => {
        const size = ov.querySelector(".pg-size").value;
        const orient = ov.querySelector(".pg-orient .on").dataset.o;
        const m = { top: +ov.querySelector(".pg-mt").value || 0, bottom: +ov.querySelector(".pg-mb").value || 0, left: +ov.querySelector(".pg-ml").value || 0, right: +ov.querySelector(".pg-mr").value || 0 };
        const dims = PAGE_SIZES[size] || PAGE_SIZES.A4; let w = dims[0], h = dims[1];
        if (orient === "landscape") { const t = w; w = h; h = t; }
        const cw = w - m.left - m.right, ch = h - m.top - m.bottom;
        preview.innerHTML = "纸张 <b>" + size + "</b> · <b>" + (orient === "portrait" ? "纵向" : "横向") + "</b> · " + Math.round(w) + "×" + Math.round(h) + "mm<br>可打印区域 " + Math.round(cw) + "×" + Math.round(ch) + "mm";
      };
      ov.querySelectorAll(".pg-orient button").forEach(b => b.onclick = () => { ov.querySelectorAll(".pg-orient button").forEach(x => x.classList.remove("on")); b.classList.add("on"); upd(); });
      ov.querySelector(".pg-size").onchange = upd;
      ["pg-mt", "pg-mb", "pg-ml", "pg-mr"].forEach(c => ov.querySelector("." + c).addEventListener("input", upd));
      upd();
      const close = () => { if (ov.parentNode) ov.parentNode.removeChild(ov); };
      ov.querySelector(".pg-cancel").onclick = close;
      ov.addEventListener("click", e => { if (e.target === ov) close(); });
      ov.querySelector(".pg-ok").onclick = () => {
        data.page.size = ov.querySelector(".pg-size").value;
        data.page.orientation = ov.querySelector(".pg-orient .on").dataset.o;
        data.page.margin = {
          top: +ov.querySelector(".pg-mt").value || 0, bottom: +ov.querySelector(".pg-mb").value || 0,
          left: +ov.querySelector(".pg-ml").value || 0, right: +ov.querySelector(".pg-mr").value || 0
        };
        applyPageSetup();
        close();
        OS.toast("已更新页面设置", "ok");
      };
    }
    function doPrint() { try { if (typeof window.print === "function") window.print(); } catch (e) {} }

    /* ---------- 页眉 / 页脚 / 页码 ---------- */
    // 字段令牌：&[PAGE] 当前页 / &[PAGES] 总页数 / &[DATE] 日期 / &[TIME] 时间 / &[TITLE] 文档标题
    function resolveTokens(s, p, n) {
      if (!s) return "";
      s = String(s);
      if (p != null) s = s.replace(/&\[PAGE\]/g, String(p));
      if (n != null) s = s.replace(/&\[PAGES\]/g, String(n));
      s = s.replace(/&\[DATE\]/g, new Date().toLocaleDateString("zh-CN"));
      s = s.replace(/&\[TIME\]/g, new Date().toLocaleTimeString("zh-CN"));
      s = s.replace(/&\[TITLE\]/g, OS.util.escapeHtml(doc.name || ""));
      return s;
    }
    function bandHtml(zone) {
      return '<div class="wh-' + zone + '" data-zone="' + zone + '">' +
        '<div class="wh-cell wh-l" contenteditable="true"></div>' +
        '<div class="wh-cell wh-c" contenteditable="true"></div>' +
        '<div class="wh-cell wh-r" contenteditable="true"></div></div>';
    }
    // 正文（不含页眉页脚），用于序列化 / 字数 / 导出 / 打印分页
    function bodyHtml() {
      const c = page.cloneNode(true);
      c.querySelectorAll(".wh-header, .wh-footer").forEach(e => e.remove());
      return c.innerHTML;
    }
    function bodyText() {
      const c = page.cloneNode(true);
      c.querySelectorAll(".wh-header, .wh-footer").forEach(e => e.remove());
      return c.textContent || "";
    }
    function renderHeaderFooterCells() {
      page.querySelectorAll(".wh-header .wh-cell").forEach(cell => {
        const col = cell.classList.contains("wh-l") ? "left" : cell.classList.contains("wh-c") ? "center" : "right";
        cell.innerHTML = resolveTokens(data.header[col], null, null);
      });
      page.querySelectorAll(".wh-footer .wh-cell").forEach(cell => {
        const col = cell.classList.contains("wh-l") ? "left" : cell.classList.contains("wh-c") ? "center" : "right";
        cell.innerHTML = resolveTokens(data.footer[col], null, null);
      });
    }
    function positionHF() {
      const m = data.page.margin;
      const hEl = page.querySelector(".wh-header"), fEl = page.querySelector(".wh-footer");
      if (hEl) hEl.style.height = mmToPx(m.top) + "px";
      if (fEl) fEl.style.height = mmToPx(m.bottom) + "px";
    }
    function openHeaderFooter() {
      const ov = document.createElement("div");
      ov.className = "pg-overlay hf-overlay";
      const zoneHtml = (zone, label) => {
        const d = data[zone];
        return '<div class="hf-zone"><div class="hf-zone-title">' + label + '</div>' +
          '<label class="hf-field"><span>左 (left)</span><textarea class="hf-l" rows="2">' + OS.util.escapeHtml(d.left) + '</textarea></label>' +
          '<label class="hf-field"><span>中 (center)</span><textarea class="hf-c" rows="2">' + OS.util.escapeHtml(d.center) + '</textarea></label>' +
          '<label class="hf-field"><span>右 (right)</span><textarea class="hf-r" rows="2">' + OS.util.escapeHtml(d.right) + '</textarea></label></div>';
      };
      ov.innerHTML = '<div class="pg-modal hf-modal">' +
        '<div class="pg-title">页眉 / 页脚</div>' +
        '<div class="hf-tokens">' +
          '<span>插入字段：</span>' +
          '<button type="button" data-tk="&[PAGE]">第 &[PAGE] 页</button>' +
          '<button type="button" data-tk="&[PAGES]">共 &[PAGES] 页</button>' +
          '<button type="button" data-tk="&[DATE]">日期</button>' +
          '<button type="button" data-tk="&[TIME]">时间</button>' +
          '<button type="button" data-tk="&[TITLE]">标题</button>' +
        '</div>' +
        zoneHtml("header", "页眉") +
        zoneHtml("footer", "页脚") +
        '<div class="pg-actions"><button class="pg-cancel">取消</button><button class="pg-ok primary">确定</button></div>' +
      '</div>';
      wrap.appendChild(ov);
      let lastFocus = null;
      ov.querySelectorAll("textarea").forEach(t => t.addEventListener("focus", () => lastFocus = t));
      ov.querySelectorAll(".hf-tokens button").forEach(b => b.onclick = () => {
        if (!lastFocus) { const all = ov.querySelectorAll("textarea"); lastFocus = all[all.length - 1]; }
        const tk = b.dataset.tk, s = lastFocus, start = s.selectionStart, end = s.selectionEnd;
        s.value = s.value.slice(0, start) + tk + s.value.slice(end);
        s.focus(); s.selectionStart = s.selectionEnd = start + tk.length;
      });
      const close = () => { if (ov.parentNode) ov.parentNode.removeChild(ov); };
      ov.querySelector(".pg-cancel").onclick = close;
      ov.addEventListener("click", e => { if (e.target === ov) close(); });
      ov.querySelector(".pg-ok").onclick = () => {
        const zones = ov.querySelectorAll(".hf-zone");
        const hz = zones[0], fz = zones[1];
        data.header = { left: hz.querySelector(".hf-l").value, center: hz.querySelector(".hf-c").value, right: hz.querySelector(".hf-r").value };
        data.footer = { left: fz.querySelector(".hf-l").value, center: fz.querySelector(".hf-c").value, right: fz.querySelector(".hf-r").value };
        renderHeaderFooterCells();
        close();
        ctx.markDirty();
        OS.toast("已更新页眉页脚", "ok");
      };
    }

    // 导出用：把页眉页脚作为顶部 / 底部区块（页码令牌在连续导出中保留为占位）
    function exportHF() {
      const block = zone => {
        const d = data[zone];
        const cell = col => '<div class="doc-hf-' + col + '">' + resolveTokens(d[col], null, null) + '</div>';
        return '<div class="doc-hf doc-hf-' + zone + '">' + cell("left") + cell("center") + cell("right") + '</div>';
      };
      return { header: block("header"), footer: block("footer") };
    }

    /* ---------- 打印分页（确定性窗口切片，逐页重复页眉页脚 + 正确页码） ---------- */
    function splitByPageBreak(html) {
      const d = document.createElement("div"); d.innerHTML = html;
      const segs = []; let buf = [];
      Array.from(d.children).forEach(ch => {
        if (ch.classList && ch.classList.contains("page-break")) { segs.push(buf.join("")); buf = []; }
        else buf.push(ch.outerHTML);
      });
      segs.push(buf.join(""));
      return segs;
    }
    function measureSeg(html, Cw, measureFn) {
      if (measureFn) return measureFn(html, Cw);
      const m = document.createElement("div"); m.className = "pp-measure"; m.style.width = Cw + "px"; m.innerHTML = html;
      document.body.appendChild(m); const h = m.scrollHeight || 0; m.remove(); return h;
    }
    function makeHF(zone, p, n) {
      const d = zone === "header" ? data.header : data.footer;
      const box = document.createElement("div"); box.className = "pp-" + zone;
      ["left", "center", "right"].forEach(col => {
        const c = document.createElement("div"); c.className = "pp-cell pp-" + col[0];
        c.innerHTML = resolveTokens(d[col], p, n);
        box.appendChild(c);
      });
      return box;
    }
    function buildPrintPages(opts) {
      opts = opts || {};
      const m = data.page.margin, pm = pageMetrics(data.page);
      const W = mmToPx(pm.w), H = mmToPx(pm.h);
      const ml = mmToPx(m.left), mr = mmToPx(m.right), mt = mmToPx(m.top), mb = mmToPx(m.bottom);
      const Cw = W - ml - mr, Ch = H - mt - mb;
      const segs = splitByPageBreak(bodyHtml());
      const segPages = segs.map(s => Math.max(1, Math.ceil(measureSeg(s, Cw, opts.measureFn) / Ch)));
      const total = segPages.reduce((a, b) => a + b, 0);
      const root = document.createElement("div"); root.className = "pp-root";
      let pageNo = 0;
      segs.forEach((s, si) => {
        const cnt = segPages[si];
        for (let k = 0; k < cnt; k++) {
          pageNo++;
          const box = document.createElement("div"); box.className = "pp-page";
          box.style.width = W + "px"; box.style.height = H + "px";
          box.style.padding = mt + "px " + mr + "px " + mb + "px " + ml + "px";
          box.style.boxSizing = "border-box"; box.style.position = "relative"; box.style.overflow = "hidden";
          box.appendChild(makeHF("header", pageNo, total));
          const content = document.createElement("div"); content.className = "pp-content";
          content.style.position = "absolute"; content.style.top = mt + "px"; content.style.left = ml + "px";
          content.style.width = Cw + "px"; content.style.height = Ch + "px"; content.style.overflow = "hidden";
          content.style.transform = "translateY(" + (-k * Ch) + "px)";
          content.innerHTML = s;
          box.appendChild(content);
          box.appendChild(makeHF("footer", pageNo, total));
          root.appendChild(box);
        }
      });
      return root;
    }
    function doPrintPaginated() {
      const root = buildPrintPages();
      document.body.appendChild(root);
      const cleanup = () => { if (root.parentNode) root.parentNode.removeChild(root); window.removeEventListener("afterprint", cleanup); };
      window.addEventListener("afterprint", cleanup);
      try { window.print(); } catch (e) { cleanup(); }
    }
    function openPrintPreview() {
      const root = buildPrintPages();
      root.classList.add("pp-preview");
      const ov = document.createElement("div"); ov.className = "pp-preview-overlay";
      ov.innerHTML = '<div class="pp-preview-bar"><span>打印预览</span>' +
        '<button class="pp-do-print primary">打印</button><button class="pp-close">关闭</button></div>';
      const scroll = document.createElement("div"); scroll.className = "pp-preview-scroll";
      scroll.appendChild(root); ov.appendChild(scroll);
      document.body.appendChild(ov);
      ov.querySelector(".pp-close").onclick = () => ov.remove();
      ov.querySelector(".pp-do-print").onclick = () => {
        const cleanup = () => { ov.remove(); window.removeEventListener("afterprint", cleanup); };
        window.addEventListener("afterprint", cleanup);
        try { window.print(); } catch (e) { cleanup(); }
      };
      ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    }

    /* ---------- 功能区（标签页） ---------- */
    const ribbon = OS.Ribbon.create({
      file: { onOpen: ctx.openBackstage },
      tabs: [
        {
          id: "home", label: "开始", groups: [
            {
              label: "剪贴板", items: [
                { kind: "btn", icon: "paste", title: "粘贴 (Ctrl+V)", onClick: doPaste },
                { kind: "btn", icon: "cut", title: "剪切 (Ctrl+X)", onClick: () => exec("cut") },
                { kind: "btn", icon: "copy", title: "复制 (Ctrl+C)", onClick: () => exec("copy") },
                { kind: "btn", icon: "highlight", title: "格式刷", onClick: toggleFormatBrush }
              ]
            },
            {
              label: "字体", items: [
                { kind: "select", title: "字体", width: 120, value: "",
                  options: [
                    { value: "", label: "默认字体" },
                    { value: "Microsoft YaHei", label: "微软雅黑" },
                    { value: "SimSun", label: "宋体" },
                    { value: "SimHei", label: "黑体" },
                    { value: "KaiTi", label: "楷体" },
                    { value: "NSimSun", label: "新宋体" },
                    { value: "Arial", label: "Arial" },
                    { value: "Times New Roman", label: "Times New Roman" }
                  ],
                  onChange: v => { if (v) exec("fontName", v); } },
                { kind: "select", title: "字号", width: 60, value: "",
                  options: [
                    { value: "", label: "默认" },
                    { value: "8", label: "8" }, { value: "9", label: "9" }, { value: "10", label: "10" },
                    { value: "11", label: "11" }, { value: "12", label: "12" }, { value: "14", label: "14" },
                    { value: "16", label: "16" }, { value: "18", label: "18" }, { value: "20", label: "20" },
                    { value: "22", label: "22" }, { value: "24", label: "24" }, { value: "28", label: "28" },
                    { value: "32", label: "32" }, { value: "36", label: "36" }, { value: "48", label: "48" }
                  ],
                  onChange: v => { if (v) setFontSize(parseInt(v, 10)); } },
                { kind: "btn", glyph: "A+", title: "增大字号", onClick: () => bumpFontSize(1) },
                { kind: "btn", glyph: "A-", title: "减小字号", onClick: () => bumpFontSize(-1) },
                { kind: "btn", glyph: "⌫", title: "清除格式", onClick: () => exec("removeFormat") },
                { kind: "btn", glyph: "B", title: "加粗 (Ctrl+B)", onClick: () => exec("bold") },
                { kind: "btn", glyph: "I", title: "斜体 (Ctrl+I)", onClick: () => exec("italic") },
                { kind: "btn", glyph: "U", title: "下划线 (Ctrl+U)", onClick: () => exec("underline") },
                { kind: "btn", glyph: "S", title: "删除线", onClick: () => exec("strikeThrough") },
                { kind: "btn", glyph: "x²", title: "上标", onClick: () => exec("superscript") },
                { kind: "btn", glyph: "x₂", title: "下标", onClick: () => exec("subscript") },
                { kind: "color", title: "字体颜色", onInput: v => exec("foreColor", v) },
                { kind: "color", title: "文本突出显示", onInput: v => exec("hiliteColor", v) },
                { kind: "btn", glyph: "▣", title: "字符边框（选中文字加框）", onClick: wrapCharBorder },
                {
                  kind: "select", title: "样式", width: 110, value: "p",
                  options: [
                    { value: "p", label: "正文" }, { value: "h1", label: "标题 1" },
                    { value: "h2", label: "标题 2" }, { value: "h3", label: "标题 3" },
                    { value: "h4", label: "标题 4" }, { value: "h5", label: "标题 5" },
                    { value: "h6", label: "标题 6" }, { value: "subtitle", label: "副标题" },
                    { value: "blockquote", label: "引用" }
                  ],
                  onChange: v => {
                    if (v === "subtitle") { exec("formatBlock", "<p>"); applyBlockStyle("fontSize", "18px"); applyBlockStyle("color", "#666"); return; }
                    exec("formatBlock", v === "p" ? "<p>" : (v === "blockquote" ? "<blockquote>" : "<" + v + ">"));
                  }
                }
              ]
            },
            {
              label: "段落", items: [
                { kind: "btn", icon: "align-left", title: "左对齐", onClick: () => exec("justifyLeft") },
                { kind: "btn", icon: "align-center", title: "居中", onClick: () => exec("justifyCenter") },
                { kind: "btn", icon: "align-right", title: "右对齐", onClick: () => exec("justifyRight") },
                { kind: "btn", icon: "align-justify", title: "两端对齐", onClick: () => exec("justifyFull") },
                { kind: "btn", icon: "list-bullet", title: "项目符号", onClick: () => exec("insertUnorderedList") },
                { kind: "btn", icon: "list-number", title: "编号", onClick: () => exec("insertOrderedList") },
                { kind: "btn", icon: "list-number", title: "多级列表", onClick: multiLevelList },
                { kind: "btn", icon: "indent", title: "增加缩进", onClick: () => exec("indent") },
                { kind: "btn", icon: "outdent", title: "减少缩进", onClick: () => exec("outdent") },
                { kind: "select", title: "行距", width: 64, value: "1.5",
                  options: [
                    { value: "1", label: "1.0" }, { value: "1.15", label: "1.15" },
                    { value: "1.5", label: "1.5" }, { value: "2", label: "2.0" }, { value: "2.5", label: "2.5" }
                  ],
                  onChange: v => setLineHeight(v) },
                { kind: "color", title: "段落底纹（背景色）", onInput: v => applyBlockStyle("backgroundColor", v) },
                { kind: "color", title: "段落边框（边框色）", onInput: v => applyBlockStyle("border", "1px solid " + v) },
                { kind: "btn", glyph: "⇧A", title: "段落升序排序", onClick: () => sortParagraphs(false) },
                { kind: "btn", glyph: "⇩A", title: "段落降序排序", onClick: () => sortParagraphs(true) }
              ]
            },
            {
              label: "编辑", items: [
                { kind: "btn", icon: "undo", title: "撤销 (Ctrl+Z)", onClick: () => exec("undo") },
                { kind: "btn", icon: "redo", title: "重做 (Ctrl+Y)", onClick: () => exec("redo") },
                { kind: "btn", icon: "search", title: "查找 (Ctrl+F)", onClick: () => { openFindReplace(); if (findInput) setTimeout(() => findInput.focus(), 0); } },
                { kind: "btn", icon: "replace", title: "替换", onClick: () => { openFindReplace(); if (findReplaceInput) setTimeout(() => findReplaceInput.focus(), 0); } },
                { kind: "btn", glyph: "全", title: "全选 (Ctrl+A)", onClick: () => exec("selectAll") }
              ]
            }
          ]
        },
        {
          id: "insert", label: "插入", groups: [
            {
              label: "表格", items: [
                { kind: "btn", icon: "table", title: "插入 3×3 表格", onClick: () => exec("insertHTML",
                  '<table><tbody>' + Array.from({ length: 3 }).map(() =>
                    '<tr>' + Array.from({ length: 3 }).map(() => '<td>　</td>').join("") + '</tr>').join("") + '</tbody></table><p><br></p>') }
              ]
            },
            {
              label: "页面 / 目录", items: [
                { kind: "btn", icon: "page-break", title: "插入分页符（打印时另起一页）", label: "分页符", onClick: insertPageBreak },
                { kind: "btn", icon: "toc", title: "插入目录（根据标题 1-3 自动生成）", label: "目录", onClick: insertToc }
              ]
            },
            {
              label: "对象", items: [
                { kind: "btn", icon: "image", title: "插入图片", onClick: () => fileInput.click() },
                { kind: "btn", icon: "link", title: "插入链接", onClick: () => { const u = prompt("输入链接地址：", "https://"); if (u) exec("createLink", u); } },
                { kind: "btn", icon: "divider", title: "分割线", onClick: () => exec("insertHorizontalRule") }
              ]
            }
          ]
        },
        {
          id: "design", label: "设计", groups: [
            {
              label: "页面", items: [
                {
                  kind: "color", title: "页面颜色", onInput: v => { page.style.background = v; ctx.markDirty(); }
                },
                {
                  kind: "btn", icon: "file", title: "重置页面颜色", onClick: () => { page.style.background = ""; ctx.markDirty(); }
                },
                {
                  kind: "btn", icon: "page-setup", title: "页面设置（纸张 / 方向 / 页边距）", onClick: openPageSetup
                },
                {
                  kind: "btn", icon: "header", title: "页眉 / 页脚（含页码字段）", label: "页眉页脚", onClick: openHeaderFooter
                },
                {
                  kind: "btn", icon: "preview", title: "打印预览（分页 + 逐页页眉页脚）", label: "打印预览", onClick: openPrintPreview
                },
                {
                  kind: "btn", icon: "print", title: "打印 (Ctrl+P)", onClick: doPrintPaginated
                }
              ]
            }
          ]
        },
        {
          id: "review", label: "审阅", groups: [
            {
              label: "批注", items: [
                { kind: "btn", icon: "comment", title: "新建批注（先选中文字）", onClick: addComment },
                { kind: "btn", icon: "arrow-up", title: "上一条（待处理）", onClick: () => navComment(-1) },
                { kind: "btn", icon: "arrow-down", title: "下一条（待处理）", onClick: () => navComment(1) },
                { kind: "btn", icon: "check-all", title: "全部标记为已解决", onClick: resolveAll }
              ]
            },
            {
              label: "视图", items: [
                { kind: "btn", icon: "eye", title: "显示/隐藏评论窗格", onClick: togglePanel }
              ]
            }
          ]
        },
        {
          id: "export", label: "导出", groups: [
            {
              label: "导出为", items: [
                { kind: "btn", icon: "pdf", title: "导出为 PDF（浏览器打印 → 另存为 PDF）", label: "导出 PDF", onClick: () => exportAs("pdf") },
                { kind: "btn", icon: "download", title: "直接生成并下载 PDF 文件（光栅化分页内容，无需打印对话框）", label: "下载 PDF 文件", onClick: downloadPdfFile },
                { kind: "btn", icon: "preview", title: "打印预览（分页 + 逐页页眉页脚）", label: "打印预览", onClick: openPrintPreview },
                { kind: "btn", icon: "print", title: "打印 (Ctrl+P)", onClick: doPrintPaginated }
              ]
            }
          ]
        }
      ]
    });

    // 插入图片
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.hidden = true;
    wrap.appendChild(fileInput);
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0]; if (!f) return;
      const url = await OS.util.readFile(f, true);
      exec("insertHTML", `<img src="${url}" alt="${OS.util.escapeHtml(f.name)}">`);
      fileInput.value = "";
    });

    wrap.querySelector("#cmt-toggle").addEventListener("click", togglePanel);
    page.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); ctx.saveNow && ctx.saveNow(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFindReplace(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); doPrintPaginated(); }
    });

    /* ---------- 查找 / 替换 + 字数统计 ---------- */
    const statusbar = wrap.querySelector("#writer-statusbar");
    const sbWords = wrap.querySelector("#sb-words");
    const sbChars = wrap.querySelector("#sb-chars");
    const sbParas = wrap.querySelector("#sb-paras");
    const sbRead = wrap.querySelector("#sb-read");

    const findPanel = wrap.querySelector("#find-panel");
    const findInput = wrap.querySelector("#find-input");
    const findReplaceInput = wrap.querySelector("#find-replace-input");
    const findCount = wrap.querySelector("#find-count");
    const findCase = wrap.querySelector("#find-case");
    const findState = { query: "", matchCase: false, marks: [], idx: -1 };

    function unwrap(mark) {
      if (!mark || !mark.parentNode) return;
      const t = document.createTextNode(mark.textContent);
      mark.parentNode.replaceChild(t, mark);
      if (t.parentNode) t.parentNode.normalize();
    }
    function clearFind() {
      findState.marks.forEach(unwrap);
      findState.marks = [];
      findState.idx = -1;
      findCount.textContent = "";
    }
    function runFind() {
      clearFind();
      const q = findInput.value;
      findState.query = q;
      findState.matchCase = findCase.checked;
      if (!q) { updateStatus(); return; }
      const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
          let p = n.parentNode;
          while (p && p !== page) {
            if (p.classList && (p.classList.contains("wh-header") || p.classList.contains("wh-footer"))) return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const matches = [];
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue) continue;
        const text = findState.matchCase ? node.nodeValue : node.nodeValue.toLowerCase();
        const q2 = findState.matchCase ? q : q.toLowerCase();
        let from = 0, idx;
        while ((idx = text.indexOf(q2, from)) !== -1) {
          matches.push({ node: node, start: idx, end: idx + q.length });
          from = idx + q.length;
        }
      }
      // 从后往前包裹，保证同一文本节点内的偏移始终有效
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        const after = m.node.splitText(m.start);
        const mid = after.splitText(m.end - m.start);
        const mark = document.createElement("mark");
        mark.className = "find-hit";
        m.node.parentNode.insertBefore(mark, after);
        mark.appendChild(after);
        // mid 留在 mark 之后，保持文档结构
      }
      findState.marks = Array.from(page.querySelectorAll(".find-hit"));
      if (findState.marks.length) { findState.idx = 0; highlightCur(); }
      else findCount.textContent = "无匹配";
      updateStatus();
    }
    function highlightCur() {
      findState.marks.forEach((m, i) => m.classList.toggle("find-cur", i === findState.idx));
      const cur = findState.marks[findState.idx];
      if (cur) {
        try {
          const r = document.createRange();
          r.selectNodeContents(cur);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          page.focus();
        } catch (e) {}
        if (cur.scrollIntoView) { try { cur.scrollIntoView({ block: "center" }); } catch (e) {} }
      }
      findCount.textContent = (findState.marks.length ? (findState.idx + 1) + " / " + findState.marks.length : "0 / 0");
    }
    function gotoFind(dir) {
      if (!findState.marks.length) return;
      findState.idx = (findState.idx + dir + findState.marks.length) % findState.marks.length;
      highlightCur();
    }
    function replaceCur() {
      if (!findState.marks.length) { OS.toast("没有可替换的内容", "warn"); return; }
      const cur = findState.marks[findState.idx];
      cur.textContent = findReplaceInput.value;
      unwrap(cur);
      findState.marks.splice(findState.idx, 1);
      if (!findState.marks.length) { findCount.textContent = "已替换"; findState.idx = -1; updateStatus(); return; }
      if (findState.idx >= findState.marks.length) findState.idx = 0;
      highlightCur();
      ctx.markDirty();
      updateStatus();
      OS.toast("已替换 1 处", "ok");
    }
    function replaceAll() {
      if (!findState.marks.length) { OS.toast("没有可替换的内容", "warn"); return; }
      const n = findState.marks.length;
      const rep = findReplaceInput.value;
      findState.marks.forEach(m => { m.textContent = rep; unwrap(m); });
      findState.marks = [];
      findState.idx = -1;
      findCount.textContent = "已替换 " + n + " 处";
      ctx.markDirty();
      updateStatus();
      OS.toast("已替换全部 " + n + " 处", "ok");
    }
    function openFindReplace() {
      findPanel.hidden = false;
      findInput.focus();
      if (findInput.value) runFind();
    }
    function closeFind() {
      findPanel.hidden = true;
      clearFind();
    }
    // 全局文档搜索：扫描正文块（排除页眉页脚），返回可定位的命中
    function search(query) {
      const q = (query || "").trim(); const out = [];
      if (!q) return out;
      const ql = q.toLowerCase();
      const blocks = page.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,td,blockquote,pre,figcaption");
      blocks.forEach(el => {
        if (el.closest(".wh-header, .wh-footer")) return;
        const t = el.textContent || "";
        if (t.toLowerCase().indexOf(ql) === -1) return;
        out.push({
          label: el.tagName.toLowerCase() + "：" + t.replace(/\s+/g, " ").slice(0, 36),
          previewHtml: OS.shell.snippet(t, q),
          goto: () => {
            if (el.scrollIntoView) { try { el.scrollIntoView({ block: "center" }); } catch (e) {} }
            el.classList.remove("search-flash"); void el.offsetWidth; el.classList.add("search-flash");
          }
        });
      });
      return out;
    }
    // 程序化查找替换（供外壳 Ctrl/Cmd+H 跨文档调用）：遍历正文文本节点（排除页眉页脚）
    function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function walkTextNodes(root, cb) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let n; while ((n = walker.nextNode())) nodes.push(n);
      nodes.forEach(cb);
    }
    function replaceAllText(query, replacement, opts) {
      const q = (query || "").trim();
      if (!q) return 0;
      const mc = opts && opts.matchCase;
      const re = new RegExp(escapeRegex(q), mc ? "g" : "gi");
      const rep = String(replacement == null ? "" : replacement).replace(/\$/g, "$$");
      let count = 0;
      walkTextNodes(page, node => {
        if (node.parentNode && node.parentNode.nodeType === 1 &&
            node.parentNode.closest && node.parentNode.closest(".wh-header, .wh-footer")) return;
        const t = node.nodeValue;
        if (!t) return;
        if (re.test(t)) {
          count += (t.match(re) || []).length;
          node.nodeValue = t.replace(re, rep);
        }
      });
      if (count) { ctx.markDirty(); updateStatus(); }
      return count;
    }
    function updateStatus() {
      const text = bodyText();
      const words = text.replace(/\s/g, "").length;
      const chars = text.length;
      const tmp = document.createElement("div"); tmp.innerHTML = bodyHtml();
      const paras = tmp.querySelectorAll("p,h1,h2,h3,h4,li,blockquote,td,pre").length;
      const mins = words ? Math.max(1, Math.ceil(words / 300)) : 0;
      sbWords.textContent = "字数 " + words;
      sbChars.textContent = "字符 " + chars;
      sbParas.textContent = "段落 " + paras;
      sbRead.textContent = "约 " + mins + " 分钟";
    }

    findInput.addEventListener("input", runFind);
    findCase.addEventListener("change", runFind);
    findInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); gotoFind(e.shiftKey ? -1 : 1); }
    });
    findReplaceInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); replaceCur(); }
    });
    wrap.querySelector("#find-next").addEventListener("click", () => gotoFind(1));
    wrap.querySelector("#find-prev").addEventListener("click", () => gotoFind(-1));
    wrap.querySelector("#find-replace").addEventListener("click", replaceCur);
    wrap.querySelector("#find-all").addEventListener("click", replaceAll);
    wrap.querySelector("#find-close").addEventListener("click", closeFind);
    updateStatus();

    /* ---------- 选区 AI 浮层（复用共享工厂 ai-selbar.js） ---------- */
    function getSelection() {
      const r = getSelectionRange();
      if (!r) return null;
      const text = r.toString();
      if (!text.trim()) return null;
      return {
        text,
        rect: OS.AI.safeRect(r),
        replace(out) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r.cloneRange());
          try { document.execCommand("delete", false, null); document.execCommand("insertText", false, out); } catch (e) {}
          ctx.markDirty();
        },
        insertAfter(out) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r.cloneRange());
          sel.collapseToEnd();
          try { document.execCommand("insertParagraph", false, null); document.execCommand("insertText", false, out); } catch (e) {}
          ctx.markDirty();
        },
        suggest() {
          const rr = getSelectionRange();
          if (!rr) { OS.toast("请先选中要审阅的文字", "warn"); return; }
          addCommentWithSuggestion();
        },
        manual() { addComment(); }
      };
    }
    const selbar = OS.AI.createSelToolbar({
      container: wrap,
      features: { replace: true, insert: true, suggest: true, manual: true, assistant: true },
      getSelection,
      onApplied() {}
    });

    function load(html) {
      page.innerHTML = bandHtml("header") + (html || "") + bandHtml("footer");
      renderHeaderFooterCells();
      ctx.markDirty();
    }

    /* ---------- 目录 / 分页符 ---------- */
    function headingId(h, i) { if (h.id) return h.id; const id = "toc-h-" + (i + 1); h.id = id; return id; }
    // 根据正文标题 1-3 生成目录 HTML（同时给标题补 id，便于锚点跳转）
    function buildTocHtml() {
      const hs = Array.from(page.querySelectorAll("h1, h2, h3"));
      if (!hs.length) return "";
      const items = hs.map((h, i) => {
        const id = headingId(h, i);
        const lvl = +h.tagName.charAt(1);
        const text = (h.textContent || "").trim() || "(无标题)";
        return '<a class="toc-link toc-l' + lvl + '" data-target="' + id + '" href="#' + id + '">' + OS.util.escapeHtml(text) + '</a>';
      }).join("");
      return '<nav class="toc" contenteditable="false"><div class="toc-title">目录</div>' + items + '</nav>';
    }
    // 在光标处（无选区则在文末）插入节点，兼容无 execCommand 的环境
    function insertNodeAtCaret(frag) {
      const sel = window.getSelection();
      let range = null;
      if (sel && sel.rangeCount) { range = sel.getRangeAt(0); if (!page.contains(range.commonAncestorContainer)) range = null; }
      if (!range) { range = document.createRange(); range.selectNodeContents(page); range.collapse(false); }
      const last = frag.lastChild; // insertNode 会把 frag 的子节点移走，需先留存末节点
      range.insertNode(frag);
      if (last) { range.setStartAfter(last); range.collapse(true); }
      if (sel) { sel.removeAllRanges(); try { sel.addRange(range); } catch (e) {} }
      ctx.markDirty();
    }
    function insertToc() {
      const html = buildTocHtml();
      if (!html) { OS.toast("暂无标题，请先使用「标题 1-3」", "warn"); return; }
      const tmp = document.createElement("div"); tmp.innerHTML = html + "<p><br></p>";
      const frag = document.createDocumentFragment();
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      insertNodeAtCaret(frag);
      OS.toast("已插入目录", "ok");
    }
    function insertPageBreak() {
      const tmp = document.createElement("div");
      tmp.innerHTML = '<div class="page-break" contenteditable="false" data-page-break><span>分 页 符</span></div><p><br></p>';
      const frag = document.createDocumentFragment();
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      insertNodeAtCaret(frag);
      OS.toast("已插入分页符", "ok");
    }

    /* ---------- 直接下载 PDF 文件（光栅化分页 DOM → PDF，零依赖，免去打印对话框） ---------- */
    function buildPageSvg(innerHtml, W, H, scale) {
      if (!OS.SvgRaster || !OS.SvgRaster.buildPageSvg) throw new Error("SvgRaster 未就绪");
      return OS.SvgRaster.buildPageSvg(innerHtml, W, H, scale);
    }
    function rasterizeSvg(svgStr, W2, H2) {
      return new Promise((resolve) => {
        const img = new Image();
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = W2; c.height = H2;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W2, H2);
          try { ctx.drawImage(img, 0, 0, W2, H2); } catch (e) { /* 跨域图片可能绘制失败，保持白底 */ }
          let data;
          try { data = new Uint8Array(ctx.getImageData(0, 0, W2, H2).data); }
          catch (e) { data = new Uint8Array(W2 * H2 * 4).fill(255); } // 画布被跨域污染时降级为白页
          resolve({ data, w: W2, h: H2 });
        };
        img.onerror = () => resolve({ data: new Uint8Array(W2 * H2 * 4).fill(255), w: W2, h: H2 });
        img.src = url;
      });
    }
    async function downloadPdfFile() {
      if (!OS.PdfTool || !OS.PdfTool.writeImagePdf) { OS.toast("PDF 引擎未就绪", "warn"); return; }
      const root = buildPrintPages();
      root.style.position = "fixed"; root.style.left = "-99999px"; root.style.top = "0";
      root.style.display = "block"; // 覆盖 .pp-root{display:none}
      document.body.appendChild(root);
      const boxes = Array.prototype.slice.call(root.querySelectorAll(".pp-page"));
      if (!boxes.length) { root.remove(); OS.toast("没有可导出的页面", "warn"); return; }
      const scale = 2; // 光栅 2x 保证清晰度
      const pages = [];
      try {
        for (const box of boxes) {
          const W = box.offsetWidth || parseInt(box.style.width) || 794;
          const H = box.offsetHeight || parseInt(box.style.height) || 1123;
          const svg = buildPageSvg(box.outerHTML, W, H, scale);
          const r = await rasterizeSvg(svg, Math.round(W * scale), Math.round(H * scale));
          // MediaBox 以 PDF 点（1pt=1/72in）表达：CSS px 按 96dpi → pt 换算（×0.75）= 真实纸张尺寸
          pages.push({ width: r.w, height: r.h, data: r.data, mediaW: Math.round(W * 0.75), mediaH: Math.round(H * 0.75) });
        }
        const bytes = await OS.PdfTool.writeImagePdf(pages);
        OS.util.download(new Blob([bytes], { type: "application/pdf" }), (doc.name || "文档") + ".pdf");
        OS.toast("已生成 PDF 文件（" + pages.length + " 页）", "ok");
      } catch (e) {
        OS.toast("PDF 生成失败：" + (e && e.message || e), "warn");
      } finally {
        root.remove();
      }
    }

    async function exportAs(fmt) {
      const title = doc.name || "文档";
      const hf = exportHF();
      const withCmt = hf.header + bodyHtml() + commentsAppendixHtml() + hf.footer;
      if (fmt === "html") {
        OS.util.download(new Blob([wrapHtml(withCmt, title)], { type: "text/html" }), title + ".html");
        return;
      }
      if (fmt === "txt") {
        const t = (hf.header + bodyText() + hf.footer).replace(/<[^>]+>/g, "");
        OS.util.download(new Blob([t], { type: "text/plain" }), title + ".txt");
        return;
      }
      if (fmt === "docx") {
        // 原生 DOCX 走统一导出 OS.Exporter（shell 统一导出任务已路由）；此处为模块内兜底
        if (OS.Exporter && OS.Exporter.exportDoc) {
          OS.Exporter.exportDoc({ type: "writer", name: title, data: { html: wrapHtml(withCmt, title) } }, "docx");
          return;
        }
        OS.toast("DOCX 引擎未就绪，已降级导出 HTML", "warn");
        OS.util.download(new Blob([wrapHtml(withCmt, title)], { type: "text/html" }), title + ".html");
        return;
      }
      if (fmt === "pdf") doPrintPaginated();
    }

    /* ---------- 批注附录（HTML / DOCX 末尾附言） ---------- */
    function commentsAppendixHtml() {
      if (!comments.length) return "";
      const fmtTime = t => OS.util.fmtTime ? OS.util.fmtTime(t) : new Date(t).toLocaleString();
      const items = comments.map(c => {
        const replies = (c.replies || []).map(r =>
          `<li><b>${OS.util.escapeHtml(r.author || "")}</b>：${OS.util.escapeHtml(r.text || "")}</li>`).join("");
        return `<article class="cmt-a-item">
          <blockquote class="cmt-a-quote">${OS.util.escapeHtml(c.quote || "")}</blockquote>
          <p class="cmt-a-meta">${OS.util.escapeHtml(c.author || "我")} · ${fmtTime(c.createdAt)}${c.resolved ? " · 已解决" : " · 待处理"}</p>
          ${replies ? `<ul class="cmt-a-replies">${replies}</ul>` : ""}
        </article>`;
      }).join("");
      return `<section class="cmt-appendix"><h2>批注附录</h2><hr>${items}</section>`;
    }

    function wrapHtml(body, title) {
      return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${OS.util.escapeHtml(title)}</title>
      <style>body{font-family:-apple-system,"Microsoft YaHei","PingFang SC",sans-serif;max-width:820px;margin:32px auto;padding:0 24px;line-height:1.7;color:#1a2332}
      h1{font-size:26px}h2{font-size:21px}h3{font-size:17px}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #dfe4ea;padding:6px 10px}img{max-width:100%}
      .cmt{background:#fff3bf;border-bottom:2px solid #f0c000}
      .doc-hf{display:flex;justify-content:space-between;align-items:flex-end;font-size:12px;color:#6b7a8d;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #e3e8ef}
      .doc-hf-footer{margin:14px 0 0;padding-top:6px;border-bottom:none;border-top:1px solid #e3e8ef}
      .doc-hf-left{flex:1;text-align:left}.doc-hf-center{flex:1;text-align:center}.doc-hf-right{flex:1;text-align:right}
      .cmt-appendix{margin-top:40px;border-top:2px solid #c9d2dd;padding-top:18px}
      .cmt-appendix h2{font-size:20px;color:#33425b}
      .cmt-a-item{margin:0 0 18px;padding-bottom:14px;border-bottom:1px dashed #d8e0ea}
      .cmt-a-quote{margin:6px 0;padding:8px 12px;background:#fff3bf;border-left:4px solid #f0c000;border-radius:4px;color:#5b4a00}
      .cmt-a-meta{margin:4px 0;font-size:13px;color:#6b7a8d}
      .cmt-a-replies{margin:6px 0 0;padding-left:20px}.cmt-a-replies li{margin:2px 0}</style></head>
      <body>${body}</body></html>`;
    }

    // 初始化：还原已解决态与列表
    page.innerHTML = bandHtml("header") + (data.html || "") + bandHtml("footer");
    renderHeaderFooterCells();
    syncResolvedSpans();
    renderComments();
    applyPageSetup();

    return {
      serialize() { return { html: bodyHtml(), comments: comments, page: JSON.parse(JSON.stringify(data.page)), header: JSON.parse(JSON.stringify(data.header)), footer: JSON.parse(JSON.stringify(data.footer)) }; },
      importHtml(h) { load(h); },
      exportAs,
      search,
      replaceAll: replaceAllText,
      tocAPI: {
        html: () => buildTocHtml(),
        insert: insertToc,
        insertPageBreak: insertPageBreak,
        pageBreaks: () => page.querySelectorAll(".page-break").length,
        tocLinks: () => page.querySelectorAll(".toc-link").length
      },
      hfAPI: {
        set(o) { if (o.header) Object.assign(data.header, o.header); if (o.footer) Object.assign(data.footer, o.footer); renderHeaderFooterCells(); ctx.markDirty(); },
        get: () => ({ header: JSON.parse(JSON.stringify(data.header)), footer: JSON.parse(JSON.stringify(data.footer)) }),
        open: openHeaderFooter,
        cells: () => page.querySelectorAll(".wh-header .wh-cell, .wh-footer .wh-cell").length,
        bodyHtml: bodyHtml,
        resolve: (s, p, n) => resolveTokens(s, p, n)
      },
      printAPI: {
        preview: openPrintPreview,
        print: doPrintPaginated,
        buildPages: (opts) => buildPrintPages(opts),
        pageCount: (opts) => buildPrintPages(opts).children.length
      },
      pdfFileAPI: {
        download: downloadPdfFile,
        buildPageSvg,
        rasterizeSvg
      },
      focus() { page.focus(); },
      undo() { exec("undo"); },
      redo() { exec("redo"); },
      ribbon,
      pageAPI: {
        get: () => JSON.parse(JSON.stringify(data.page)),
        set: o => {
          if (o.size) data.page.size = o.size;
          if (o.orientation) data.page.orientation = o.orientation;
          if (o.margin) Object.assign(data.page.margin, o.margin);
          applyPageSetup();
        },
        metrics: () => pageMetrics(data.page),
        style: () => ({ width: page.style.width, minHeight: page.style.minHeight, padding: page.style.padding, boxSizing: page.style.boxSizing, background: page.style.background }),
        open: openPageSetup,
        printCss: () => buildPrintCss(),
        print: doPrint
      },
      findAPI: {
        open: openFindReplace,
        close: closeFind,
        run: runFind,
        next: () => gotoFind(1),
        prev: () => gotoFind(-1),
        replace: replaceCur,
        replaceAll: replaceAll,
        setQuery: q => { findInput.value = q; },
        count: () => findState.marks.length,
        status: () => ({ query: findState.query, idx: findState.idx, total: findState.marks.length }),
        words: () => (page.textContent || "").replace(/\s/g, "").length
      },
      destroy() {
        clearFind();
        if (selbar && selbar.destroy) selbar.destroy();
        if (ribbon.el) ribbon.el.remove();
        wrap.remove();
      }
    };
  }

  OS.modules = OS.modules || {};
  OS.modules.writer = { type: "writer", blank, mount };
  OS.blankDoc = (function (orig) {
    return function (t) { if (t === "writer") return blank(); return orig ? orig(t) : { type: t, data: {} }; };
  })(OS.blankDoc);
})(window);
