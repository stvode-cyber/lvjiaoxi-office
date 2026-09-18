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
  // TODO: [坑-mknode-color] 预防：渲染函数默认值必须显式硬编码，禁止依赖"上游总会传"；解析 JSON 前先判空
  function mkNode(text, x, y, parent, color) {
    return { id: uid("n"), x: x || 0, y: y || 0, text: text || "", color: color || "#2563eb", shape: "rounded", fontSize: 14, parent: parent || null, isRoot: false };
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

    /* ---------- O(1) 索引：mount 开头建一次，mutation 后 rebuild ---------- */
    const _nodeById = new Map();   // id → node  替代 data.nodes.find()
    const _childrenMap = new Map(); // parentId → [node, node, ...]  替代 data.nodes.filter()
    function _rebuildIndex() {
      _nodeById.clear(); _childrenMap.clear();
      data.nodes.forEach(n => {
        _nodeById.set(n.id, n);
        if (n.parent) {
          if (!_childrenMap.has(n.parent)) _childrenMap.set(n.parent, []);
          _childrenMap.get(n.parent).push(n);
        }
      });
    }
    _rebuildIndex();

    /* ---------- Undo/Redo（显式 snapshot 模式，同 spreadsheet/presentation）----------
       mutation 函数开头手动调 _snapshot()，存"mutation 之前"的 data 到 undoStack */
    const _undoStack = [], _redoStack = [];
    function _snapshot() {
      _undoStack.push(JSON.parse(JSON.stringify(data)));
      if (_undoStack.length > 100) _undoStack.shift();
      _redoStack.length = 0;
    }
    function _restore(snap) {
      const r = JSON.parse(JSON.stringify(snap));
      Object.keys(data).forEach((k) => delete data[k]);
      Object.assign(data, r);
      _rebuildIndex();
      selId = null;
      layoutMap(); render(); syncSide(); ctx.markDirty();
    }
    function _undo() {
      if (!_undoStack.length) return false;
      _redoStack.push(JSON.parse(JSON.stringify(data)));
      _restore(_undoStack.pop());
      return true;
    }
    function _redo() {
      if (!_redoStack.length) return false;
      _undoStack.push(JSON.parse(JSON.stringify(data)));
      _restore(_redoStack.pop());
      return true;
    }
    function _canUndo() { return _undoStack.length > 0; }
    function _canRedo() { return _redoStack.length > 0; }

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
      // 🔥 兜底：fontSize 可能缺失（store 持久化 / 外部导入数据不完整）
      if (!n.fontSize || !Number.isFinite(n.fontSize)) n.fontSize = 14;
      const padX = 22, padY = 12, lineH = n.fontSize * 1.45, maxW = 240;
      const sig = (n.text || "") + "|" + n.fontSize + "|" + maxW;
      if (n._fitSig === sig && Number.isFinite(n.w) && Number.isFinite(n.h)) return;
      n._fitSig = sig;
      const lines = wrapText(n.text, maxW, n.fontSize);
      // 🔥 兜底：空 lines 或 measureText 返回 NaN
      let maxTextW = 1;
      try {
        if (lines.length) {
          const widths = lines.map(l => _mc.measureText(l).width).filter(w => Number.isFinite(w));
          if (widths.length) maxTextW = Math.max(1, ...widths);
        }
      } catch(e) {}
      const w = Math.min(maxW, Math.max(90, maxTextW + padX * 2));
      const h = Math.max(40, lines.length * (Number.isFinite(lineH)?lineH:n.fontSize*1.45) + padY * 2);
      // 🔥 最终兜底：任何不是 finite 的值都强制默认
      n.w = Number.isFinite(w) ? w : 120;
      n.h = Number.isFinite(h) ? h : 40;
      n._lines = lines;
      n._lineH = Number.isFinite(lineH) ? lineH : n.fontSize * 1.45;
    }

    /* ---------- 树 / 查询 ---------- */
    function getNode(id) { return _nodeById.get(id); }
    function childrenOf(id) { return _childrenMap.get(id) || []; }

    /* ---------- 思维导图自动布局（水平树） ---------- */
    function layoutMap() { console.time("[MINDMAP-LAYOUT]");
      _rebuildIndex();
      const root = getNode(data.rootId);
      if (!root) {
        // 🔥 rootId 找不到兜底：用第一个有 parent 指向它的节点，或直接第一个节点
        data.rootId = data.nodes.find(n => !n.parent)?.id || data.nodes[0]?.id;
        if (!data.rootId) { console.warn('[MINDMAP] 没有任何节点可布局'); return; }
        console.warn('[MINDMAP-LAYOUT] rootId 不存在，改用', data.rootId);
      }
      const LEAF_H = 46, X_STEP = 260, MAX_DEPTH = 50;
      const leaves = {}, _visited = new Set();
      function count(n, depth) {
        if (depth > MAX_DEPTH || _visited.has(n.id)) { leaves[n.id] = 1; return 1; }
        _visited.add(n.id);
        const ch = childrenOf(n.id);
        if (!ch.length) { leaves[n.id] = 1; return 1; }
        let s = 0; ch.forEach(c => s += count(c, depth + 1)); leaves[n.id] = s; return s;
      }
      count(getNode(data.rootId), 0);
      let cursor = 0;
      const _placed = new Set();
      function place(n, depth) {
        if (!n || depth > MAX_DEPTH || _placed.has(n.id)) return;
        _placed.add(n.id);
        n.x = depth * X_STEP + 60;
        const ch = childrenOf(n.id);
        if (!ch.length) { n.y = cursor + LEAF_H / 2; cursor += LEAF_H; }
        else { ch.forEach(c => place(c, depth + 1)); const first = childrenOf(n.id)[0], last = childrenOf(n.id)[childrenOf(n.id).length - 1]; if (first && last && Number.isFinite(first.y) && Number.isFinite(last.y)) n.y = (first.y + last.y) / 2; else n.y = cursor + LEAF_H / 2; }
        fitNode(n);
      }
      place(getNode(data.rootId), 0);

      // 🔥 防御：所有没被 place 的孤立节点给默认位置（root 找错 / 环 / 悬空 parent 都会触发）
      let orphanCount = 0;
      data.nodes.forEach(n => {
        if (!_placed.has(n.id)) {
          n.x = 0; n.y = cursor + LEAF_H / 2; cursor += LEAF_H;
          _placed.add(n.id); orphanCount++;
          fitNode(n);
        }
      });
      if (orphanCount > 0) console.warn('[MINDMAP-LAYOUT] 有', orphanCount, '个孤立节点（不在 root 子树下），已强制布局');
      console.timeEnd("[MINDMAP-LAYOUT]");
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
      // 🔥 NaN 防御：坏数据 / 未 place 过的节点跳过
      if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
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
        const d = edgePath(a, b);
        if (!d) return;  // 🔥 NaN 防御
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("class", "mm-edge");
        p.setAttribute("d", d);
        eg.appendChild(p);
      });
      view.appendChild(eg);
      const ng = document.createElementNS(SVGNS, "g");
      data.nodes.forEach(n => { fitNode(n); ng.appendChild(renderNode(n)); });
      view.appendChild(ng);
      zoomLabel.textContent = Math.round(k * 100) + "%";
    }
    function renderNode(n) {
      // 🔥 坐标兜底：任何非 finite 坐标都强制归零（布局 bug 时不会炸）
      if (!Number.isFinite(n.x)) n.x = 0;
      if (!Number.isFinite(n.y)) n.y = 0;
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
      const lines = n._lines || wrapText(n.text, Math.max(50, n.w - 44), n.fontSize);
      const lineH = Number.isFinite(n._lineH) ? n._lineH : n.fontSize * 1.45;
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "central");
      if (n.isRoot) t.setAttribute("font-weight", "700");
      const startY = -(lines.length - 1) * lineH / 2;
      lines.forEach((ln, i) => {
        const ts = document.createElementNS(SVGNS, "tspan");
        const ty = startY + i * lineH;
        ts.setAttribute("x", "0"); ts.setAttribute("y", Number.isFinite(ty) ? ty : 0);
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
          <div class="field"><button class="btn" data-act="ai-outline" style="width:100%;background:var(--accent);color:var(--accent-ink)">🤖 AI 生成脑图</button></div>
          <input type="file" data-import accept=".json,.xmind,.md,.markdown,.opml,.opml.xml,application/json" hidden>
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
    _snapshot();
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

    /* ---------- AI 生成脑图（抄 WPS 2026 轻量版：OS.AI.local.outline 转层级）---------- */
    function loadAIOutline() {
    _snapshot();
      const topic = prompt("🤖 AI 生成脑图\n\n请输入主题或关键词（如：产品规划、项目管理、季度报告）", "产品规划");
      if (!topic) return;
      OS.toast("AI 正在构思「" + topic + "」…");
      // 用本地 outline + 解析层级
      let outline = topic;
      try {
        if (OS.AI && OS.AI.local && typeof OS.AI.local.outline === "function") {
          outline = OS.AI.local.outline(topic);
        }
      } catch (e) { console.warn("AI outline 失败，用默认层级", e); }
      // 解析带编号的层级文本 → 节点树
      const lines = outline.split("\n").map(l => l.trim()).filter(Boolean);
      const colors = ["#2563eb", "#0d9488", "#d97706", "#db2777", "#7c3aed", "#dc2626", "#16a34a"];
      data.nodes = []; data.edges = [];
      const root = mkNode(topic, 0, 0); root.isRoot = true; root.color = "#1e3a5f";
      data.nodes.push(root); data.rootId = root.id;
      // 解析：行首数字/缩进决定层级（一、→ Level 1，1. → Level 2，1.1 → Level 3）
      const parentStack = [root.id]; // [root, L1, L2, ...]
      lines.forEach((raw) => {
        const text = raw.replace(/^[\s\u3000]*[\d一二三四五六七八九十]+[.、．]\s*/, "").trim();
        if (!text) return;
        // 估算层级：通过数字前缀判断
        let level = 0;
        const m1 = raw.match(/^(\d+)\.(\d+)\.(\d+)/); if (m1) level = 3;
        else { const m2 = raw.match(/^(\d+)\.(\d+)/); if (m2) level = 2; else if (/^[\d一二三四五六七八九十]+[.、．]/.test(raw)) level = 1; else level = 1; }
        // 缩进也作为辅助
        const indent = (raw.match(/^\s*/) || [""])[0].length;
        if (indent >= 6) level = Math.max(level, 3); else if (indent >=  2) level = Math.max(level, 2);
        // 调整 parentStack 长度
        while (parentStack.length > level + 1) parentStack.pop();
        const pId = parentStack[parentStack.length - 1];
        const node = mkNode(text, 0, 0, pId);
        const parent = data.nodes.find(n => n.id === pId);
        const isBranch = parent && parent.parent === root.id;
        node.color = isBranch ? colors[(data.nodes.filter(n => n.parent === root.id).length - 1) % colors.length] : "#64748b";
        data.nodes.push(node);
        parentStack.push(node.id);
      });
      selId = null; mode = "map"; data.mode = "map"; layoutMap(); render(); syncSide(); updateModeBtns(); ctx.markDirty();
      OS.toast("AI 脑图已生成：" + data.nodes.length + " 个节点", "ok");
    }

    /* ---------- 导入 / 导出 ---------- */
    const BRANCH_COLORS = ["#2563eb", "#0d9488", "#d97706", "#db2777", "#7c3aed", "#dc2626", "#16a34a"];

    /* ---- XMind .xmind / .xmind.zip 导入 ---- */
    async function importXmind(file) {
      try {
        const buf = await file.arrayBuffer();
        // JSZip 在 renderer 层通过 require 可用（electron nodeIntegration=true）
        let JSZip; try { JSZip = require("jszip"); } catch (e) { JSZip = window.JSZip; }
        if (!JSZip) { OS.toast("需要 JSZip 支持，请联系开发者", "err"); return; }
        const zip = await JSZip.loadAsync(buf);
        // XMind v3: content.json 在 content 目录下；v1/v2: 直接在根目录
        let content;
        if (zip.files["content.json"]) content = JSON.parse(await zip.files["content.json"].async("string"));
        else if (zip.files["content/content.json"]) content = JSON.parse(await zip.files["content/content.json"].async("string"));
        else { OS.toast("不认识的 XMind 文件结构", "err"); return; }
        if (!Array.isArray(content)) content = [content];
        // 多画布 XMind 只取第一个
        const rootTopic = content[0].rootTopic || content[0].rootTopic || content[0];
        if (!rootTopic || !rootTopic.title) { OS.toast("XMind 根节点找不到", "err"); return; }

        // 递归转换 topic → node
        data.nodes = []; data.edges = [];
        let depthIdx = 0;
        function walkTopic(topic, parentId, depth) {
          const color = BRANCH_COLORS[depth % BRANCH_COLORS.length];
          const text = (topic.title || topic.title || topic.text || "").trim();
          if (!text) return;
          const isFirst = data.nodes.length === 0;
          const id = uid("n");
          data.nodes.push({ id, x: 0, y: 0, text, color: isFirst ? "#1e3a5f" : color, shape: "rounded", fontSize: isFirst ? 16 : 14, parent: parentId, isRoot: isFirst });
          if (isFirst) data.rootId = id;
          // 子节点：attached (XMind v3) 或 children (旧格式) 或直接 children
          const kids = (topic.children && topic.children.attached) || topic.children || topic.subtopics || [];
          (kids || []).forEach(kt => walkTopic(kt, id, depth + 1));
        }
        walkTopic(rootTopic, null, 0);
        if (!data.nodes.length) { OS.toast("XMind 为空", "err"); return; }
        data.mode = "map"; selId = null; mode = "map";
        layoutMap(); render(); syncSide(); updateModeBtns(); ctx.markDirty();
        OS.toast("已从 XMind 导入 " + data.nodes.length + " 节点", "ok");
      } catch (err) {
        console.error("[mindmap] XMind 导入失败:", err);
        OS.toast("XMind 解析失败：" + err.message, "err");
      }
    }

    /* ---- Markdown 大纲导入 ---- */
    function importMarkdown(file) {
      file.text().then(t => {
        try {
          const lines = t.split("\n");
          data.nodes = []; data.edges = [];
          let parentStack = [null]; // parentStack[level] = parentId
          let rootId = null;
          let levelCount = {}; // 每个 level 的序号，用于分配颜色
          for (const raw of lines) {
            const m = raw.match(/^(#{1,6})\s+(.+)$/);
            if (!m) continue;
            const level = m[1].length; // 1-6
            const text = m[2].trim();
            // parent = 最近的 < level 的节点
            let parentId = null;
            for (let l = level - 1; l >= 1; l--) {
              if (parentStack[l]) { parentId = parentStack[l]; break; }
            }
            const depth = level - 1;
            const color = BRANCH_COLORS[depth % BRANCH_COLORS.length];
            const id = uid("n");
            const isFirst = !rootId;
            if (isFirst) rootId = id;
            data.nodes.push({ id, x: 0, y: 0, text, color: isFirst ? "#1e3a5f" : color, shape: "rounded", fontSize: isFirst ? 16 : 14, parent: parentId, isRoot: isFirst });
            parentStack[level] = id;
            // 清理更深层的 parent
            for (let l = level + 1; l <= 6; l++) parentStack[l] = null;
          }
          if (!data.nodes.length) { OS.toast("Markdown 里没找到标题 (#)", "err"); return; }
          data.rootId = rootId; data.mode = "map";
          selId = null; mode = "map";
          layoutMap(); render(); syncSide(); updateModeBtns(); ctx.markDirty();
          OS.toast("已从 Markdown 导入 " + data.nodes.length + " 节点", "ok");
        } catch (err) { OS.toast("Markdown 解析失败：" + err.message, "err"); }
      });
    }

    /* ---- OPML 大纲导入（兼容 OmniOutliner / WorkFlowy） ---- */
    function importOpml(file) {
      file.text().then(t => {
        try {
          const xml = new DOMParser().parseFromString(t, "text/xml");
          const parseError = xml.querySelector("parsererror");
          if (parseError) { OS.toast("OPML XML 解析失败", "err"); return; }
          data.nodes = []; data.edges = [];
          let rootId = null;
          function walkOutline(outline, parentId, depth) {
            const text = outline.getAttribute("text") || outline.getAttribute("title") || "";
            if (!text) { // 有些 OPML 的 title 在子 <title> 元素
              const tEl = outline.getElementsByTagName("title")[0];
              if (tEl) text = tEl.textContent;
            }
            if (!text) return;
            const color = BRANCH_COLORS[depth % BRANCH_COLORS.length];
            const id = uid("n");
            const isFirst = !rootId;
            if (isFirst) rootId = id;
            data.nodes.push({ id, x: 0, y: 0, text, color: isFirst ? "#1e3a5f" : color, shape: "rounded", fontSize: isFirst ? 16 : 14, parent: parentId, isRoot: isFirst });
            outline.childNodes.forEach(child => {
              if (child.nodeName === "outline") walkOutline(child, id, depth + 1);
            });
          }
          const outlines = xml.getElementsByTagName("outline");
          // 顶层 outline
          for (let i = 0; i < outlines.length; i++) {
            if (!outlines[i].parentElement || outlines[i].parentElement.nodeName !== "outline") {
              walkOutline(outlines[i], null, 0);
            }
          }
          if (!data.nodes.length) { OS.toast("OPML 为空", "err"); return; }
          data.rootId = rootId; data.mode = "map";
          selId = null; mode = "map";
          layoutMap(); render(); syncSide(); updateModeBtns(); ctx.markDirty();
          OS.toast("已从 OPML 导入 " + data.nodes.length + " 节点", "ok");
        } catch (err) { OS.toast("OPML 解析失败：" + err.message, "err"); }
      });
    }

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
      if (fmt === "md") { OS.util.download(new Blob([toMarkdown(data)], { type: "text/markdown;charset=utf-8" }), title + ".md"); OS.toast("已导出 Markdown", "ok"); return; }
      if (fmt === "docx") {
        if (OS.Exporter && typeof OS.Exporter.buildDocx === "function") {
          OS.Exporter.buildDocx({ type: "writer", name: title, data: { html: toDocxHtml(data) } }).generateAsync({ type: "blob" }).then(b => OS.util.download(b, title + ".docx"));
          OS.toast("已导出 DOCX", "ok");
        } else OS.toast("导出器未就绪", "err");
        return;
      }
      if (fmt === "ofd") {
        if (OS.Exporter && typeof OS.Exporter.buildOfd === "function") {
          OS.Exporter.buildOfd({ type: "mindmap", name: title, data: { xml: toOfdXml(data) } });
          OS.toast("已导出 OFD", "ok");
        } else {
          OS.util.download(new Blob([toOfdXml(data)], { type: "application/xml" }), title + ".ofd.xml");
          OS.toast("已导出 OFD 内容（XML 骨架）", "ok");
        }
        return;
      }
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
    wrap.querySelector('[data-act="ai-outline"]').addEventListener("click", loadAIOutline);
    importInput.addEventListener("change", e => {
      const f = e.target.files[0];
      if (f) {
        const name = (f.name || "").toLowerCase();
        if (name.endsWith(".xmind") || name.endsWith(".xmind.zip")) importXmind(f);
        else if (name.endsWith(".md") || name.endsWith(".markdown")) importMarkdown(f);
        else if (name.endsWith(".opml") || name.endsWith(".opml.xml")) importOpml(f);
        else importJson(f);
      }
      e.target.value = "";
    });
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
              { kind: "btn", icon: "md", title: "导出 Markdown（树形大纲）", label: "MD", r: "md", onClick: () => exportAs("md") },
              { kind: "btn", icon: "docx", title: "导出 Word（标题层级）", label: "Word", r: "docx", onClick: () => exportAs("docx") },
              { kind: "btn", icon: "table", title: "导出 OFD（国产版式）", label: "OFD", r: "ofd", onClick: () => exportAs("ofd") },
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
      destroy() { if (mmSelbar) mmSelbar.destroy(); closeEditor(); if (ribbon.el) ribbon.el.remove(); wrap.remove(); },
      // ↓↓ UndoManager 接入
      undo: _undo,
      redo: _redo,
      canUndo: _canUndo,
      canRedo: _canRedo
    };
  }

  // —— 纯逻辑导出（不依赖 DOM，可单测）——
  function _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function _buildTree(data) {
    if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return [];
    const map = {}; data.nodes.forEach(n => map[n.id] = n);
    const childrenOf = id => data.nodes.filter(n => n.parent === id);
    const out = [];
    const root = data.nodes.find(n => n.isRoot) || data.nodes[0];
    (function walk(id, depth) {
      const n = map[id]; if (!n) return;
      out.push({ depth: depth, text: n.text, shape: n.shape, color: n.color });
      childrenOf(id).forEach(c => walk(c.id, depth + 1));
    })((data.rootId || root.id), 0);
    return out;
  }
  function toMarkdown(data) {
    const tree = _buildTree(data);
    if (!tree.length) return "";
    return tree.map(t => "  ".repeat(t.depth) + "- " + (t.text || "")).join("\n") + "\n";
  }
  function toDocxHtml(data) {
    const tree = _buildTree(data);
    if (!tree.length) return "";
    return tree.map(t => {
      if (t.depth === 0) return "<h1>" + _esc(t.text) + "</h1>";
      if (t.depth === 1) return "<h2>" + _esc(t.text) + "</h2>";
      return "<p>" + "  ".repeat(t.depth - 2) + _esc(t.text) + "</p>";
    }).join("\n");
  }
  function toOfdXml(data) {
    const tree = _buildTree(data);
    if (!tree.length) return "";
    const paras = tree.map(t => '    <ofd:Paragraph><ofd:TextCode>' + _esc(t.text || "") + '</ofd:TextCode></ofd:Paragraph>').join("\n");
    return '<?xml version="1.0" encoding="UTF-8"?>\n<ofd:Content xmlns:ofd="http://www.ofdspec.org/2016">\n' + paras + '\n</ofd:Content>';
  }

  function _undoCore(initialData, options) {
    const {
      onRestore = () => {},
      maxStack = 100
    } = options || {};

    const undoStack = [], redoStack = [];
    let pending = null;   // 上一次 markDirty 时的 data clone（"mutation 后"状态）
    // 双次提交模式：
    //   1st markDirty:  pending = clone(data)          // 存下当前状态
    //   2nd markDirty:  undoStack.push(pending);       // pending 是上一次状态 = undo 目标
    //                   pending = clone(data)          // 再存当前
    // undo() 前 commitSnap() 把 pending 入栈，pop 出上上一次状态

    function snapshot() {
      // snapshot() 是 mutation **之前**调的（spreadsheet 风格），立即入栈
      undoStack.push(JSON.parse(JSON.stringify(initialData)));
      if (undoStack.length > maxStack) undoStack.shift();
      redoStack.length = 0;
    }

    // 深恢复：先清空所有旧 key 再 Object.assign（避免数组引用残留）
    function _restoreFrom(snapClone) {
      Object.keys(initialData).forEach((k) => delete initialData[k]);
      Object.assign(initialData, snapClone);
    }

    function undo() {
      if (!undoStack.length) return false;
      redoStack.push(JSON.parse(JSON.stringify(initialData)));
      _restoreFrom(undoStack.pop());
      onRestore("undo");
      return true;
    }

    function redo() {
      if (!redoStack.length) return false;
      undoStack.push(JSON.parse(JSON.stringify(initialData)));
      _restoreFrom(redoStack.pop());
      onRestore("redo");
      return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }
    function stackSize() { return { undo: undoStack.length, redo: redoStack.length }; }

    // 额外暴露 markDirty/commitSnap 给 mindmap mount 闭包 hook（但 mount 里已不用 hook 了）
    function markDirty() { snapshot(); }       // 兼容旧接口
    function commitSnap() { /* 已无 pending，空操作 */ }

    return { snapshot, markDirty, commitSnap, undo, redo, canUndo, canRedo, stackSize };
  }OS.modules = OS.modules || {};
  OS.modules.mindmap = { type: "mindmap", blank, mount, toMarkdown, toDocxHtml, toOfdXml, _buildTree, _undoCore };
  OS.blankDoc = (function (orig) {
    return function (t) { if (t === "mindmap") return blank(); return orig ? orig(t) : { type: t, data: {} }; };
  })(OS.blankDoc);
})(window);
