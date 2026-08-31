/* ============================================================
   绿角犀 Office · MindMap 脑图 / Diagram 图示模块
   对应 PRD 第 6 章：思维导图（树形自动布局）+ 自由图示（节点+连线）
   基于 SVG 渲染，原生格式存储，可导出 SVG / PNG / JSON，可导入 JSON
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const SVGNS = "http://www.w3.org/2000/svg";
  const MEASURE_FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif';

  function uid(p) { return OS.util.uid(p || "n"); }
  function mkNode(text, x, y, parent) {
    return { id: uid("n"), x: x || 0, y: y || 0, text: text || "", color: "#2563eb", shape: "rounded", fontSize: 14, parent: parent || null, isRoot: false };
  }
  function blank() {
    const root = mkNode("中心主题", 0, 0);
    root.isRoot = true; root.color = "#1e3a5f";
    return { mode: "map", nodes: [root], edges: [], rootId: root.id };
  }

  function mount(host, doc, ctx) {
    const data = (doc.data && doc.data.nodes) ? doc.data : blank();
    if (!data.edges) data.edges = [];
    if (!data.rootId && data.mode === "map" && data.nodes.length) data.rootId = data.nodes[0].id;
    let mode = data.mode || "map";
    let selId = null, connectFrom = null, connectMode = false, panning = null, dragNode = null;
    let tx = 40, ty = 40, k = 1, editorEl = null, editingNode = null;

    /* ---------- 文本测量 / 自动换行 / 自动尺寸 ---------- */
    const _mc = document.createElement("canvas").getContext("2d");
    function wrapText(text, maxWidth, fontSize) {
      _mc.font = fontSize + "px " + MEASURE_FONT;
      const lines = [];
      String(text == null ? "" : text).split("\n").forEach(para => {
        if (para === "") { lines.push(""); return; }
        let cur = "";
        for (let i = 0; i < para.length; i++) {
          const ch = para[i], test = cur + ch;
          if (_mc.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = ch; }
          else cur = test;
        }
        if (cur) lines.push(cur);
      });
      return lines;
    }
    function fitNode(n) {
      const padX = 22, padY = 12, lineH = n.fontSize * 1.45, maxW = 240;
      const lines = wrapText(n.text, maxW, n.fontSize);
      const w = Math.min(maxW, Math.max(90, Math.max(1, ...lines.map(l => _mc.measureText(l).width)) + padX * 2));
      const h = Math.max(40, lines.length * lineH + padY * 2);
      n.w = w; n.h = h; n._lines = lines; n._lineH = lineH;
    }

    /* ---------- 树 / 查询 ---------- */
    function getNode(id) { return data.nodes.find(n => n.id === id); }
    function childrenOf(id) { return data.nodes.filter(n => n.parent === id); }

    /* ---------- 思维导图自动布局（水平树） ---------- */
    function layoutMap() {
      const root = getNode(data.rootId);
      if (!root) return;
      const LEAF_H = 46, X_STEP = 260;
      const leaves = {};
      function count(n) {
        const ch = childrenOf(n.id);
        if (!ch.length) { leaves[n.id] = 1; return 1; }
        let s = 0; ch.forEach(c => s += count(c)); leaves[n.id] = s; return s;
      }
      count(root);
      let cursor = 0;
      function place(n, depth) {
        n.x = depth * X_STEP + 60;
        const ch = childrenOf(n.id);
        if (!ch.length) { n.y = cursor + LEAF_H / 2; cursor += LEAF_H; }
        else { ch.forEach(c => place(c, depth + 1)); n.y = (ch[0].y + ch[ch.length - 1].y) / 2; }
        fitNode(n);
      }
      place(root, 0);
    }

    /* ---------- 坐标换算 ---------- */
    function toWorld(cx, cy) {
      const r = svg.getBoundingClientRect();
      return { x: (cx - r.left - tx) / k, y: (cy - r.top - ty) / k };
    }

    /* ---------- 渲染 ---------- */
    function edgesForRender() {
      return mode === "map"
        ? data.nodes.filter(n => n.parent).map(n => ({ from: n.parent, to: n.id }))
        : data.edges;
    }
    function edgePath(a, b) {
      if (mode === "map") {
        const sx = a.x + a.w / 2, sy = a.y, ex = b.x - b.w / 2, ey = b.y, mx = (sx + ex) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}`;
      }
      const sx = a.x, sy = a.y, ex = b.x, ey = b.y, mx = (sx + ex) / 2, my = (sy + ey) / 2;
      return `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}`;
    }
    function render() {
      view.setAttribute("transform", `translate(${tx},${ty}) scale(${k})`);
      view.innerHTML = "";
      const eg = document.createElementNS(SVGNS, "g");
      edgesForRender().forEach(e => {
        const a = getNode(e.from), b = getNode(e.to);
        if (!a || !b) return;
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("class", "mm-edge");
        p.setAttribute("d", edgePath(a, b));
        eg.appendChild(p);
      });
      view.appendChild(eg);
      const ng = document.createElementNS(SVGNS, "g");
      data.nodes.forEach(n => { fitNode(n); ng.appendChild(renderNode(n)); });
      view.appendChild(ng);
      zoomLabel.textContent = Math.round(k * 100) + "%";
    }
    function renderNode(n) {
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "mm-node" + (n.id === selId ? " selected" : ""));
      g.setAttribute("transform", `translate(${n.x},${n.y})`);
      g.dataset.id = n.id;
      let shape;
      if (n.shape === "ellipse") {
        shape = document.createElementNS(SVGNS, "ellipse");
        shape.setAttribute("rx", n.w / 2); shape.setAttribute("ry", n.h / 2);
      } else if (n.shape === "diamond") {
        shape = document.createElementNS(SVGNS, "polygon");
        const w = n.w / 2, h = n.h / 2;
        shape.setAttribute("points", `0,${-h} ${w},0 0,${h} ${-w},0`);
      } else {
        shape = document.createElementNS(SVGNS, "rect");
        shape.setAttribute("x", -n.w / 2); shape.setAttribute("y", -n.h / 2);
        shape.setAttribute("width", n.w); shape.setAttribute("height", n.h);
        if (n.shape !== "rect") shape.setAttribute("rx", 14);
      }
      shape.setAttribute("fill", n.color || "#2563eb");
      shape.setAttribute("stroke", "rgba(0,0,0,.15)");
      shape.setAttribute("stroke-width", "1.5");
      g.appendChild(shape);
      const lines = n._lines || wrapText(n.text, n.w - 44, n.fontSize);
      const lineH = n._lineH || n.fontSize * 1.45;
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "central");
      if (n.isRoot) t.setAttribute("font-weight", "700");
      const startY = -(lines.length - 1) * lineH / 2;
      lines.forEach((ln, i) => {
        const ts = document.createElementNS(SVGNS, "tspan");
        ts.setAttribute("x", "0"); ts.setAttribute("y", (startY + i * lineH));
        ts.textContent = ln; t.appendChild(ts);
      });
      g.appendChild(t);
      return g;
    }

    /* ---------- 结构 DOM ---------- */
    const wrap = document.createElement("div");
    wrap.className = "module-wrap";
    wrap.tabIndex = 0;
    wrap.innerHTML = `
      <div class="mm-body">
        <div class="mm-canvas-area" data-area>
          <svg data-svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
            <g class="mm-viewport" data-view></g>
          </svg>
          <div class="mm-zoom">
            <button data-z="out" title="缩小">－</button>
            <span data-zoom>100%</span>
            <button data-z="in" title="放大">＋</button>
            <button data-z="fit" title="适应窗口">⤢</button>
          </div>
        </div>
        <div class="mm-side" data-side>
          <div class="field"><label>模式</label>
            <div style="display:flex;gap:6px">
              <button class="btn" data-mode="map" style="flex:1">🧠 思维导图</button>
              <button class="btn" data-mode="diagram" style="flex:1">🔗 图示</button>
            </div>
          </div>
          <div data-sel-field hidden>
            <div class="field"><label>节点文字</label><textarea data-text placeholder="双击节点可快速编辑"></textarea></div>
            <div class="field"><label>文字颜色</label><input type="color" data-color></div>
            <div class="field"><label>形状</label>
              <select data-shape>
                <option value="rounded">圆角矩形</option>
                <option value="rect">矩形</option>
                <option value="ellipse">椭圆</option>
                <option value="diamond">菱形</option>
              </select>
            </div>
            <div class="field"><label>字号</label><input type="number" data-size min="10" max="48" value="14"></div>
            <div class="field" style="display:flex;gap:6px">
              <button class="btn" data-act="child" style="flex:1">＋ 子</button>
              <button class="btn" data-act="sib" style="flex:1">＋ 同级</button>
              <button class="btn" data-act="del" style="flex:1">🗑</button>
            </div>
          </div>
          <hr style="border:none;border-top:1px solid var(--rule);margin:10px 0">
          <div class="field" data-diagram-only hidden><label>连线模式</label>
            <button class="btn" data-act="connect" style="width:100%">🔗 点两节点连线</button></div>
          <div class="field"><button class="btn" data-act="autolayout" style="width:100%">⤡ 自动布局 / 适应</button></div>
          <div class="field"><button class="btn" data-act="example" style="width:100%">✨ 载入示例脑图</button></div>
          <input type="file" data-import accept=".json,application/json" hidden>
        </div>
      </div>`;
    host.appendChild(wrap);

    const area = wrap.querySelector("[data-area]");
    const svg = wrap.querySelector("[data-svg]");
    const view = wrap.querySelector("[data-view]");
    const zoomLabel = wrap.querySelector("[data-zoom]");
    const importInput = wrap.querySelector("[data-import]");

    /* ---------- 文本编辑浮层 ---------- */
    function closeEditor() {
      if (editorEl) {
        try { editorEl.removeEventListener("blur", editorEl._commit); } catch (e) {}
        editorEl.remove(); editorEl = null;
      }
      editingNode = null;
    }
    function commitEditor() {
      if (!editorEl || !editingNode) { closeEditor(); return; }
      const n = editingNode;
      n.text = editorEl.value;
      closeEditor(); fitNode(n); render(); syncSide(); ctx.markDirty();
    }
    function openEditor(n) {
      closeEditor();
      const r = svg.getBoundingClientRect();
      const left = r.left + (n.x - n.w / 2) * k + tx;
      const top = r.top + (n.y - n.h / 2) * k + ty;
      const ed = document.createElement("textarea");
      ed.className = "mm-editor"; ed.value = n.text;
      ed.style.left = left + "px"; ed.style.top = top + "px";
      ed.style.width = (n.w * k) + "px"; ed.style.height = (n.h * k) + "px";
      ed.style.fontSize = (n.fontSize * k) + "px";
      document.body.appendChild(ed); ed.focus(); ed.select();
      const commit = () => commitEditor();
      ed._commit = commit;
      ed.addEventListener("blur", commit);
      ed.addEventListener("keydown", ev => {
        if (ev.key === "Escape") { ev.preventDefault(); ed.blur(); }
        else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); ed.blur(); }
        ev.stopPropagation();
      });
      editorEl = ed; editingNode = n;
      if (typeof mmSelbar !== "undefined") mmSelbar.refresh();
    }

    /* ---------- 选择 / 侧栏同步 ---------- */
    function syncSide() {
      const n = getNode(selId);
      const selFields = wrap.querySelectorAll("[data-sel-field]");
      selFields.forEach(f => f.hidden = !n);
      if (n) {
        wrap.querySelector("[data-text]").value = n.text;
        wrap.querySelector("[data-color]").value = toHex(n.color);
        wrap.querySelector("[data-shape]").value = n.shape;
        wrap.querySelector("[data-size]").value = n.fontSize;
      }
      wrap.querySelector("[data-diagram-only]").hidden = mode !== "diagram";
      updateModeBtns();
    }
    function toHex(c) {
      if (!c) return "#2563eb";
      if (c[0] === "#") return c;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return "#2563eb";
      const p = m[1].split(",").map(x => +x);
      return "#" + p.slice(0, 3).map(x => x.toString(16).padStart(2, "0")).join("");
    }

    /* ---------- 增删节点 ---------- */
    function addChild() {
      const p = getNode(selId);
      if (!p) { OS.toast("先选中一个节点", "warn"); return; }
      const n = mkNode("分支", p.x + 260, p.y, p.id);
      data.nodes.push(n); selId = n.id;
      if (mode === "map") layoutMap();
      render(); syncSide(); ctx.markDirty(); openEditor(n);
    }
    function addSib() {
      const p = getNode(selId);
      if (!p) { OS.toast("先选中一个节点", "warn"); return; }
      if (p.isRoot) return addChild();
      const n = mkNode("分支", p.x + 260, p.y, p.parent);
      data.nodes.push(n); selId = n.id;
      if (mode === "map") layoutMap();
      render(); syncSide(); ctx.markDirty(); openEditor(n);
    }
    function delNode() {
      const n = getNode(selId);
      if (!n) return;
      if (n.isRoot) { OS.toast("根节点不可删除", "warn"); return; }
      const toDel = new Set([n.id]);
      if (mode === "map") {
        (function rec(id) { childrenOf(id).forEach(c => { toDel.add(c.id); rec(c.id); }); })(n.id);
      }
      data.nodes = data.nodes.filter(x => !toDel.has(x.id));
      data.edges = data.edges.filter(e => !toDel.has(e.from) && !toDel.has(e.to));
      if (mode === "map") { data.nodes.forEach(x => { if (x.parent && toDel.has(x.parent)) x.parent = null; }); layoutMap(); }
      selId = null; render(); syncSide(); ctx.markDirty();
    }

    /* ---------- 连线 ---------- */
    function handleConnect(id) {
      if (!connectFrom) { connectFrom = id; OS.toast("已选起点，点击目标节点", "ok"); updateConnectBtn(); return; }
      if (connectFrom !== id) {
        data.edges.push({ id: uid("e"), from: connectFrom, to: id });
        ctx.markDirty();
      }
      connectFrom = null; connectMode = false; updateConnectBtn(); render();
    }
    function updateConnectBtn() {
      const on = connectMode || !!connectFrom;
      const act = wrap.querySelector('[data-act="connect"]'); if (act) act.classList.toggle("active", on);
      const rb = ribbon.el.querySelector('[data-r="connect"]'); if (rb) rb.classList.toggle("active", on);
    }

    /* ---------- 模式切换 ---------- */
    function setMode(m) {
      mode = m; data.mode = m;
      if (m === "map" && data.nodes.length) layoutMap(); else fit();
      syncSide(); render(); ctx.markDirty(); updateModeBtns();
    }
    function updateModeBtns() {
      wrap.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
      ribbon.el.querySelectorAll('[data-r="map"],[data-r="diagram"]').forEach(b => b.classList.toggle("active", b.dataset.r === mode));
      const connG = ribbon.el.querySelector("[data-r-conn]"); if (connG) connG.hidden = mode !== "diagram";
    }

    /* ---------- 缩放 / 适配 ---------- */
    function zoomBy(f) {
      const cx = area.clientWidth / 2, cy = area.clientHeight / 2;
      const wx = (cx - tx) / k, wy = (cy - ty) / k;
      k = Math.min(3, Math.max(0.2, k * f));
      tx = cx - wx * k; ty = cy - wy * k; render();
    }
    function fit() {
      if (!data.nodes.length) return;
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      data.nodes.forEach(n => {
        fitNode(n);
        minX = Math.min(minX, n.x - n.w / 2); minY = Math.min(minY, n.y - n.h / 2);
        maxX = Math.max(maxX, n.x + n.w / 2); maxY = Math.max(maxY, n.y + n.h / 2);
      });
      const pad = 60, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
      k = Math.min(3, Math.max(0.2, Math.min(area.clientWidth / w, area.clientHeight / h)));
      tx = (area.clientWidth - w * k) / 2 - minX * k;
      ty = (area.clientHeight - h * k) / 2 - minY * k;
      render();
    }

    /* ---------- 示例 ---------- */
    function loadExample() {
      data.nodes = []; data.edges = [];
      const root = mkNode("绿角犀 Office", 0, 0); root.isRoot = true; root.color = "#1e3a5f";
      data.nodes.push(root); data.rootId = root.id;
      const colors = ["#2563eb", "#0d9488", "#d97706", "#db2777", "#7c3aed"];
      const branches = [
        ["文字处理 Writer", ["流式排版", "样式大纲", "批注", "OOXML 保真"]],
        ["表格 Spreadsheet", ["公式引擎", "条件格式", "图表", "CSV/JSON"]],
        ["演示 Presentation", ["母版", "动画切换", "演讲者视图"]],
        ["脑图 / 图示", ["思维导图", "流程图", "自动布局"]],
        ["AI 助手", ["上下文感知", "可逆改动", "数据不出域"]]
      ];
      branches.forEach((b, i) => {
        const p = mkNode(b[0], 0, 0, root.id); p.color = colors[i % colors.length]; data.nodes.push(p);
        b[1].forEach(t => data.nodes.push(mkNode(t, 0, 0, p.id)));
      });
      selId = null; mode = "map"; data.mode = "map"; layoutMap(); render(); syncSide(); updateModeBtns(); ctx.markDirty();
      OS.toast("已载入示例脑图", "ok");
    }

    /* ---------- 导入 / 导出 ---------- */
    function importJson(file) {
      file.text().then(t => {
        try {
          const d = JSON.parse(t);
          if (d && d.nodes) {
            data.mode = d.mode || "map"; data.nodes = d.nodes; data.edges = d.edges || [];
            data.rootId = d.rootId || (d.nodes[0] && d.nodes[0].id);
            selId = null; mode = data.mode;
            if (mode === "map") layoutMap(); else fit();
            render(); syncSide(); updateModeBtns(); ctx.markDirty();
            OS.toast("已导入", "ok");
          } else OS.toast("JSON 格式无效", "err");
        } catch (err) { OS.toast("解析失败：" + err.message, "err"); }
      });
    }
    const EXPORT_INK = { light: "#1a2332", dark: "#e6edf5" };
    const EXPORT_MUTED = { light: "#5a6c7d", dark: "#9fb0c3" };
    const EXPORT_BG = { light: "#ffffff", dark: "#1a212c" };
    function buildExportSvg() {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      data.nodes.forEach(n => {
        fitNode(n);
        minX = Math.min(minX, n.x - n.w / 2); minY = Math.min(minY, n.y - n.h / 2);
        maxX = Math.max(maxX, n.x + n.w / 2); maxY = Math.max(maxY, n.y + n.h / 2);
      });
      const pad = 40; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const W = Math.ceil(maxX - minX), H = Math.ceil(maxY - minY);
      const theme = OS.theme.get();
      const ink = EXPORT_INK[theme], muted = EXPORT_MUTED[theme];
      let body = "";
      edgesForRender().forEach(e => {
        const a = getNode(e.from), b = getNode(e.to);
        if (!a || !b) return;
        body += `<path d="${edgePath(a, b)}" fill="none" stroke="${muted}" stroke-width="2"/>`;
      });
      data.nodes.forEach(n => {
        const w = n.w, h = n.h, x = n.x, y = n.y;
        let s;
        if (n.shape === "ellipse") s = `<ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}" fill="${n.color}" stroke="rgba(0,0,0,.15)" stroke-width="1.5"/>`;
        else if (n.shape === "diamond") { const hw = w / 2, hh = h / 2; s = `<polygon points="${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}" fill="${n.color}" stroke="rgba(0,0,0,.15)" stroke-width="1.5"/>`; }
        else s = `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${n.shape === "rect" ? 0 : 14}" fill="${n.color}" stroke="rgba(0,0,0,.15)" stroke-width="1.5"/>`;
        body += s;
        const lines = n._lines || wrapText(n.text, w - 44, n.fontSize);
        const lineH = n._lineH || n.fontSize * 1.45;
        const startY = y - (lines.length - 1) * lineH / 2;
        let txt = `<text text-anchor="middle" dominant-baseline="central" font-family='${MEASURE_FONT}' font-size="${n.fontSize}" fill="${ink}"${n.isRoot ? ' font-weight="700"' : ''}>`;
        lines.forEach((ln, i) => { txt += `<tspan x="${x}" y="${startY + i * lineH}">${OS.util.escapeHtml(ln)}</tspan>`; });
        txt += "</text>";
        body += txt;
      });
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX} ${minY} ${W} ${H}"><rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="${EXPORT_BG[theme]}"/>${body}</svg>`;
    }
    function exportAs(fmt) {
      const title = doc.name || "脑图";
      if (fmt === "json") { OS.util.download(new Blob([JSON.stringify(serialize())], { type: "application/json" }), title + ".json"); return; }
      const s = buildExportSvg();
      if (fmt === "svg") { OS.util.download(new Blob([s], { type: "image/svg+xml" }), title + ".svg"); return; }
      if (fmt === "png") {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
          const cc = c.getContext("2d");
          cc.fillStyle = EXPORT_BG[OS.theme.get()]; cc.fillRect(0, 0, c.width, c.height); cc.drawImage(img, 0, 0);
          c.toBlob(b => OS.util.download(b, title + ".png"));
        };
        img.onerror = () => OS.toast("PNG 导出失败，已改导出 SVG", "err");
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
      }
    }
    function serialize() {
      return {
        mode, rootId: data.rootId,
        nodes: data.nodes.map(n => ({
          id: n.id, x: Math.round(n.x), y: Math.round(n.y), text: n.text,
          color: n.color, shape: n.shape, fontSize: n.fontSize, parent: n.parent, isRoot: !!n.isRoot
        })),
        edges: data.edges.map(e => ({ id: e.id, from: e.from, to: e.to, label: e.label || "" }))
      };
    }

    /* ---------- 事件绑定 ---------- */
    svg.addEventListener("pointerdown", e => {
      if (editorEl) { editorEl.blur(); return; }
      const g = e.target.closest(".mm-node");
      if (g) {
        const id = g.dataset.id;
        if (connectMode) { handleConnect(id); return; }
        selId = id; render(); syncSide();
        const w = toWorld(e.clientX, e.clientY);
        const n = getNode(id);
        dragNode = { id, dx: w.x - n.x, dy: w.y - n.y };
      } else {
        selId = null; render(); syncSide();
        panning = { sx: e.clientX, sy: e.clientY, tx, ty };
        area.classList.add("panning");
      }
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    });
    svg.addEventListener("pointermove", e => {
      if (dragNode) {
        const w = toWorld(e.clientX, e.clientY);
        const n = getNode(dragNode.id);
        if (n) { n.x = w.x - dragNode.dx; n.y = w.y - dragNode.dy; }
        render();
      } else if (panning) {
        tx = panning.tx + (e.clientX - panning.sx);
        ty = panning.ty + (e.clientY - panning.sy);
        view.setAttribute("transform", `translate(${tx},${ty}) scale(${k})`);
      }
    });
    svg.addEventListener("pointerup", e => {
      if (dragNode) { dragNode = null; ctx.markDirty(); }
      if (panning) { panning = null; area.classList.remove("panning"); }
      try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
    });
    svg.addEventListener("dblclick", e => {
      const g = e.target.closest(".mm-node");
      if (g) { openEditor(getNode(g.dataset.id)); }
      else if (mode === "diagram") {
        const w = toWorld(e.clientX, e.clientY);
        const n = mkNode("节点", w.x, w.y); data.nodes.push(n); selId = n.id; render(); syncSide(); openEditor(n);
      }
    });
    area.addEventListener("wheel", e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

    wrap.addEventListener("keydown", e => {
      if (editorEl) return;
      if (e.key === "Delete" || e.key === "Backspace") { if (selId) { e.preventDefault(); delNode(); } }
      else if (e.key === "Tab") { if (selId) { e.preventDefault(); addChild(); } }
      else if (e.key === "Enter") { if (selId) { e.preventDefault(); openEditor(getNode(selId)); } }
      else if (e.key === "Escape") { connectMode = false; connectFrom = null; updateConnectBtn(); render(); }
    });

    // 侧栏
    wrap.querySelector("[data-mode=\"map\"]").addEventListener("click", () => setMode("map"));
    wrap.querySelector("[data-mode=\"diagram\"]").addEventListener("click", () => setMode("diagram"));
    wrap.querySelector("[data-text]").addEventListener("input", e => { const n = getNode(selId); if (n) { n.text = e.target.value; fitNode(n); render(); ctx.markDirty(); } });
    wrap.querySelector("[data-color]").addEventListener("input", e => { const n = getNode(selId); if (n) { n.color = e.target.value; render(); ctx.markDirty(); } });
    wrap.querySelector("[data-shape]").addEventListener("change", e => { const n = getNode(selId); if (n) { n.shape = e.target.value; fitNode(n); render(); ctx.markDirty(); } });
    wrap.querySelector("[data-size]").addEventListener("input", e => { const n = getNode(selId); if (n) { n.fontSize = +e.target.value || 14; fitNode(n); render(); ctx.markDirty(); } });
    wrap.querySelector('[data-act="child"]').addEventListener("click", addChild);
    wrap.querySelector('[data-act="sib"]').addEventListener("click", addSib);
    wrap.querySelector('[data-act="del"]').addEventListener("click", delNode);
    wrap.querySelector('[data-act="connect"]').addEventListener("click", () => { connectMode = !connectMode; if (!connectMode) connectFrom = null; updateConnectBtn(); render(); });
    wrap.querySelector('[data-act="autolayout"]').addEventListener("click", () => { if (mode === "map") layoutMap(); else fit(); render(); ctx.markDirty(); });
    wrap.querySelector('[data-act="example"]').addEventListener("click", loadExample);
    importInput.addEventListener("change", e => { const f = e.target.files[0]; if (f) { importJson(f); } e.target.value = ""; });
    wrap.querySelector('[data-z="in"]').addEventListener("click", () => zoomBy(1.15));
    wrap.querySelector('[data-z="out"]').addEventListener("click", () => zoomBy(1 / 1.15));
    wrap.querySelector('[data-z="fit"]').addEventListener("click", fit);

    // 功能区 ribbon（标签页）
    const ribbon = OS.Ribbon.create({
      file: { onOpen: ctx.openBackstage },
      tabs: [
        {
          id: "home", label: "开始", groups: [
            {
              label: "模式", items: [
                { kind: "btn", icon: "node-add", title: "思维导图模式", label: "脑图", r: "map", onClick: () => setMode("map") },
                { kind: "btn", icon: "node-child", title: "自由图示模式", label: "图示", r: "diagram", onClick: () => setMode("diagram") }
              ]
            },
            {
              label: "节点", items: [
                { kind: "btn", icon: "node-child", title: "添加子节点 (Tab)", label: "子节点", r: "child", onClick: addChild },
                { kind: "btn", icon: "plus", title: "添加同级节点", label: "同级", r: "sib", onClick: addSib },
                { kind: "btn", icon: "trash", title: "删除节点 (Del)", label: "删除", r: "del", onClick: delNode }
              ]
            }
          ]
        },
        {
          id: "insert", label: "插入", groups: [
            { label: "连线", rconn: "y", items: [
              { kind: "btn", icon: "node-add", title: "点两节点连线", label: "连线", r: "connect", onClick: () => { connectMode = !connectMode; if (!connectMode) connectFrom = null; updateConnectBtn(); render(); } }
            ] }
          ]
        },
        {
          id: "view", label: "视图", groups: [
            { label: "缩放 / 导出", items: [
              { kind: "btn", icon: "fit", title: "自动布局 / 适应窗口", label: "适应", r: "fit", onClick: () => { if (mode === "map") layoutMap(); else fit(); render(); ctx.markDirty(); } },
              { kind: "btn", icon: "image", title: "导出 PNG", label: "PNG", r: "png", onClick: () => exportAs("png") },
              { kind: "btn", icon: "export", title: "导出 SVG", label: "SVG", r: "svg", onClick: () => exportAs("svg") },
              { kind: "btn", icon: "save", title: "导出 JSON", label: "JSON", r: "json", onClick: () => exportAs("json") }
            ] }
          ]
        }
      ]
    });

    // 双击画布空白处也能新建思维导图中心主题（仅在空画布）
    // 初始化
    if (mode === "map" && data.nodes.length) layoutMap(); else fit();
    render(); syncSide(); updateModeBtns();
    wrap.focus();

    /* ---------- 选区 AI 浮层（复用共享工厂 ai-selbar.js） ---------- */
    const mmSelbar = OS.AI.createSelToolbar({
      container: wrap,
      features: { replace: true, insert: true, assistant: true },
      getSelection() {
        if (!editorEl || document.activeElement !== editorEl || !editingNode) return null;
        const s = editorEl.selectionStart, e = editorEl.selectionEnd;
        const text = editorEl.value.slice(s, e);
        if (!text.trim()) return null;
        const rect = editorEl.getBoundingClientRect();
        const fake = { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right };
        return {
          text,
          rect: fake,
          replace(out) {
            const ns = editorEl.selectionStart, ne = editorEl.selectionEnd;
            editorEl.value = editorEl.value.slice(0, ns) + out + editorEl.value.slice(ne);
            editorEl.selectionStart = editorEl.selectionEnd = ns + out.length;
            commitEditor();
          },
          insertAfter(out) {
            const ne = editorEl.selectionEnd;
            editorEl.value = editorEl.value.slice(0, ne) + "\n" + out + editorEl.value.slice(ne);
            editorEl.selectionStart = editorEl.selectionEnd = ne + 1 + out.length;
            commitEditor();
          }
        };
      },
      onApplied() {}
    });

    return {
      serialize, exportAs,
      focus() { wrap.focus(); },
      ribbon,
      destroy() { if (mmSelbar) mmSelbar.destroy(); closeEditor(); if (ribbon.el) ribbon.el.remove(); wrap.remove(); }
    };
  }

  OS.modules = OS.modules || {};
  OS.modules.mindmap = { type: "mindmap", blank, mount };
  OS.blankDoc = (function (orig) {
    return function (t) { if (t === "mindmap") return blank(); return orig ? orig(t) : { type: t, data: {} }; };
  })(OS.blankDoc);
})(window);
