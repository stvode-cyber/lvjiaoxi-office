/* ============================================================
   绿角犀 Office · 应用外壳 (Shell)
   仪表盘 / 多标签 / 标签页功能区调度 / 标题栏 / 状态栏 / 文件后台 /
   主题 / 命令面板 / 导入导出 / 自动保存
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const $ = s => document.querySelector(s);
  const ICON = () => OS.icons;

  let tabs = [];           // { id, doc, instance, dirty }
  let activeId = null;
  let saveTimer = null;
  let zoom = 100;

  function activeTab() { return tabs.find(t => t.id === activeId); }
  function activeInst() { const t = activeTab(); return t && t.instance; }

  function boot() {
    // 顶栏图标注入
    $("#qa-save").innerHTML = ICON().svg("save", 18);
    $("#qa-undo").innerHTML = ICON().svg("undo", 18);
    $("#qa-redo").innerHTML = ICON().svg("redo", 18);
    $("#btn-cmd").innerHTML = ICON().svg("search", 18);
    $("#btn-theme").innerHTML = ICON().svg("contrast", 18);
    $("#btn-account").innerHTML = ICON().svg("user", 18);

    // 还原 AI 云端配置（仅本机持久化）
    try { const saved = OS.settings.get("aiProvider"); if (saved && saved.endpoint) OS.AI.setProvider(saved); } catch (e) {}

    // AI 助手入口
    $("#btn-ai").innerHTML = ICON().svg("spark", 18);
    $("#btn-ai").addEventListener("click", openAI);
    $("#ai-close").addEventListener("click", closeAI);
    $("#ai-send").addEventListener("click", aiSend);
    $("#ai-text").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); aiSend(); } });

    OS.store.init().then(renderDashboard);

    if (global.pdfjsLib) global.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    // 原生壳（Electron / Capacitor / HarmonyOS WebView）下跳过 Service Worker 注册，避免离线双缓存与 file:// 协议报错
    var isNativeShell = /Electron/i.test(navigator.userAgent) || (global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
    if (!isNativeShell && location.protocol.startsWith("http") && "serviceWorker" in navigator)
      navigator.serviceWorker.register("sw.js").catch(() => {});

    // 顶栏 / 快速访问
    $("#btn-theme").addEventListener("click", () => OS.theme.toggle());
    $("#qa-save").addEventListener("click", () => saveNow());
    $("#qa-undo").addEventListener("click", () => activeInst() && activeInst().undo && activeInst().undo());
    $("#qa-redo").addEventListener("click", () => activeInst() && activeInst().redo && activeInst().redo());
    $("#btn-account").addEventListener("click", openAccount);
    $("#btn-cmd").addEventListener("click", openCmd);
    $("#btn-open").addEventListener("click", () => $("#file-input").click());
    $("#file-input").addEventListener("change", onFile);

    // 开始页模板搜索（实时过滤画廊）
    const tplSearch = $("#tpl-search");
    if (tplSearch) tplSearch.addEventListener("input", e => renderGallery(e.target.value));

    document.addEventListener("click", e => {
      const n = e.target.closest("[data-new]");
      if (n) newDoc(n.dataset.new);
      const t = e.target.closest("[data-tpl]");
      if (t) newDoc(t.dataset.module, t.dataset.tpl);
    });

    document.addEventListener("keydown", e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); openCmd(); }
      else if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); saveNow(); }
      else if ((e.ctrlKey || e.metaKey) && k === "e") { e.preventDefault(); showExportMenu(); }
      else if ((e.ctrlKey || e.metaKey) && k === "h" && e.shiftKey) { e.preventDefault(); goHome(); }
      else if ((e.ctrlKey || e.metaKey) && k === "h" && !e.shiftKey) { e.preventDefault(); openReplace(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === "f") { e.preventDefault(); openSearch(); }
      else if (e.altKey && k === "t") { e.preventDefault(); OS.Tasks && OS.Tasks.togglePanel(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === "a") { e.preventDefault(); openAI(); }
      else if (e.key === "Escape") closeOverlays();
    });

    OS.bus.on("doc-renamed", doc => { const t = tabs.find(x => x.id === doc.id); if (t) renderTab(t); });
  }

  /* ---------------- 仪表盘 / 开始页 ---------------- */
  /* 模板画廊渲染：支持搜索过滤 + 收藏分组 */
  function renderGallery(rawQuery) {
    const gallery = $("#tpl-gallery");
    if (!gallery) return;
    gallery.innerHTML = "";
    const q = (rawQuery || "").trim().toLowerCase();
    const T = OS.Templates || { list: [], groups: [], byId: () => null };
    const modLabel = {};
    T.groups.forEach(g => { modLabel[g.module] = g.label; });

    function makeCard(tpl) {
      const faved = OS.Favorites.isFav(tpl.id);
      const card = document.createElement("button");
      card.className = "tpl-card" + (faved ? " is-fav" : "") + (tpl.isCustom ? " is-custom" : "");
      card.dataset.tpl = tpl.id;
      card.dataset.module = tpl.module;
      card.innerHTML =
        `<button class="tpl-star ${faved ? "on" : ""}" type="button" title="${faved ? "取消收藏" : "收藏模板"}" aria-label="收藏模板">${faved ? "★" : "☆"}</button>` +
        (tpl.isCustom ? `<button class="tpl-del" type="button" title="删除模板" aria-label="删除模板">🗑</button>` : "") +
        `<div class="tpl-thumb">${tpl.thumb || ""}</div>` +
        `<div class="tpl-meta"><div class="tpl-name">${OS.util.escapeHtml(tpl.name)}</div>` +
        `<div class="tpl-desc">${OS.util.escapeHtml(tpl.desc)}</div></div>`;
      card.querySelector(".tpl-star").addEventListener("click", e => {
        e.stopPropagation(); // 避免触发「新建文档」
        OS.Favorites.toggle(tpl.id);
        renderGallery($("#tpl-search") ? $("#tpl-search").value : "");
      });
      if (tpl.isCustom) {
        card.querySelector(".tpl-del").addEventListener("click", e => {
          e.stopPropagation();
          if (confirm(`删除模板「${tpl.name}」？此操作不可撤销。`)) {
            OS.CustomTemplates.remove(tpl.id);
            renderGallery($("#tpl-search") ? $("#tpl-search").value : "");
            OS.toast("已删除模板", "ok");
          }
        });
      }
      return card;
    }

    function appendGroup(label, items, fav) {
      if (!items.length) return;
      const wrap = document.createElement("div");
      wrap.className = "tpl-group" + (fav ? " fav" : "");
      const head = document.createElement("div");
      head.className = "tpl-group-head" + (fav ? " fav" : "");
      head.textContent = label;
      wrap.appendChild(head);
      const row = document.createElement("div");
      row.className = "tpl-row";
      items.forEach(t => row.appendChild(makeCard(t)));
      wrap.appendChild(row);
      gallery.appendChild(wrap);
    }

    const customs = OS.CustomTemplates ? OS.CustomTemplates.all() : [];

    if (q) {
      const merged = T.list.concat(customs);
      const filtered = merged.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        (modLabel[t.module] || "").toLowerCase().includes(q) ||
        (t.isCustom && "自定义".includes(q)));
      if (filtered.length) appendGroup("搜索结果", filtered, false);
      else {
        const empty = document.createElement("p");
        empty.className = "tpl-empty";
        empty.textContent = "没有匹配“" + (rawQuery || "").trim() + "”的模板";
        gallery.appendChild(empty);
      }
      return;
    }

    // 无搜索词：收藏分组置顶 + 自定义分组 + 模块分组（已收藏/自定义项从原分组隐藏，避免重复）
    const favs = OS.Favorites.all().map(id => T.byId(id)).filter(Boolean);
    appendGroup("★ 收藏", favs, true);
    appendGroup("自定义", customs.filter(t => !OS.Favorites.isFav(t.id)), false);
    T.groups.forEach(g => appendGroup(g.label, g.items.filter(t => !OS.Favorites.isFav(t.id)), false));
  }

  async function renderDashboard() {
    renderGallery($("#tpl-search") ? $("#tpl-search").value : "");
    // 最近文档
    const docs = await OS.store.list();
    const grid = $("#recent-grid");
    grid.innerHTML = "";
    $("#recent-count").textContent = docs.length ? `（${docs.length}）` : "";
    $("#recent-empty").hidden = docs.length > 0;
    docs.forEach(d => grid.appendChild(docCard(d)));
  }

  function docCard(d) {
    const info = OS.TYPE_INFO[d.type] || { ico: "📄", name: d.type, accent: "#64748b" };
    const accent = (OS.Templates && OS.Templates.list.find(t => t.module === d.type && t.id.endsWith("-blank"))
      ? OS.Templates.list.find(t => t.module === d.type && t.id.endsWith("-blank")).accent : "#64748b");
    const el = document.createElement("div");
    el.className = "doc-card"; el.dataset.id = d.id;
    el.innerHTML = `<div class="doc-ico" style="--doc-accent:${accent}">${info.ico}</div>
      <div class="doc-name">${OS.util.escapeHtml(d.name)}</div>
      <div class="doc-meta">${info.name} · ${OS.util.fmtTime(d.updatedAt)} · ${OS.util.fmtSize(d.size || 0)}</div>
      <button class="doc-del" title="删除" aria-label="删除">🗑</button>`;
    el.addEventListener("click", () => openDoc(d));
    el.querySelector(".doc-del").addEventListener("click", async e => {
      e.stopPropagation();
      if (confirm(`确定删除「${d.name}」？此操作不可撤销。`)) {
        await OS.store.remove(d.id); renderDashboard(); OS.toast("已删除", "ok");
      }
    });
    return el;
  }

  /* ---------------- 文档打开/新建 ---------------- */
  async function newDoc(type, templateId) {
    const doc = await OS.store.create({ type });
    if (templateId && OS.Templates) {
      const tpl = OS.Templates.byId(templateId);
      if (tpl) {
        doc.data = tpl.build();
        doc.name = tpl.name;
        doc.compat = "A";
        await OS.store.put(doc);
      }
    }
    openDoc(doc);
  }

  async function openDoc(doc) {
    const existing = tabs.find(t => t.id === doc.id);
    if (existing) { activate(existing); return; }
    $("#dashboard").hidden = true;
    $("#editor").hidden = false;
    $("#ribbon-host").hidden = false;
    $("#statusbar").hidden = false;

    const hostEl = $("#module-host");
    $("#ribbon-host").innerHTML = "";
    const inst = OS.modules[doc.type].mount(hostEl, doc, {
      ribbonHost: $("#ribbon-host"),
      markDirty,
      saveNow,
      openBackstage
    });
    const t = { id: doc.id, doc, instance: inst, dirty: false };
    t.wrap = hostEl.lastElementChild;
    tabs.push(t);
    activate(t);
    OS.toast(`已打开：${doc.name}`, "ok");
  }

  function activate(t) {
    activeId = t.id;
    // 仅显示当前文档的模块容器，隐藏其余（修复多标签堆叠遮挡）
    tabs.forEach(x => { if (x.wrap) x.wrap.style.display = (x.id === t.id) ? "" : "none"; });
    document.querySelectorAll(".tab").forEach(el => el.classList.toggle("active", el.dataset.id === t.id));

    // 功能区切换
    const host = $("#ribbon-host"); host.innerHTML = "";
    const ribbon = t.instance.ribbon || t.instance._ribbon;
    if (ribbon) host.appendChild(ribbon.el || ribbon);
    host.hidden = !ribbon;

    // 兼容徽章 + 标题
    const badge = $("#compat-badge");
    if (t.doc.compat && OS.COMPAT[t.doc.compat]) {
      badge.hidden = false; badge.textContent = OS.COMPAT[t.doc.compat].label;
      badge.style.background = OS.COMPAT[t.doc.compat].color
        .replace("var(--ok)", "#0e7c3a").replace("var(--warn)", "#b9700f").replace("var(--danger)", "#c4312b");
      badge.style.color = "#fff";
    } else badge.hidden = true;

    updateTitle();
    renderStatusbar();
    zoom = 100; applyZoom(0);
  }

  function updateTitle() {
    const t = activeTab(); if (!t) { $("#doc-title").textContent = ""; return; }
    $("#doc-title").innerHTML = OS.util.escapeHtml(t.doc.name) + (t.dirty ? '<span class="dirty">●</span>' : "");
    document.title = t.doc.name + " · 绿角犀 Office";
  }

  function closeTab(id) {
    const i = tabs.findIndex(t => t.id === id); if (i < 0) return;
    const t = tabs[i];
    if (t.dirty && !confirm(`「${t.doc.name}」有未保存改动，仍要关闭？`)) return;
    if (t.instance.destroy) t.instance.destroy();
    tabs.splice(i, 1);
    if (activeId === id) {
      activeId = tabs.length ? tabs[tabs.length - 1].id : null;
      if (activeId) activate(tabs.find(t => t.id === activeId));
      else goHome();
    }
    renderTabbar();
  }

  function renderTabbar() {
    const bar = $("#tabbar"); bar.innerHTML = "";
    tabs.forEach(t => {
      const info = OS.TYPE_INFO[t.doc.type] || { ico: "📄" };
      const el = document.createElement("button");
      el.className = "tab" + (t.id === activeId ? " active" : "");
      el.dataset.id = t.id;
      el.innerHTML = `<span class="tab-ico">${info.ico}</span><span class="tab-name">${OS.util.escapeHtml(t.doc.name)}</span>${t.dirty ? '<span class="dirty-dot"></span>' : ""}<span class="tab-close">✕</span>`;
      el.addEventListener("click", e => {
        if (e.target.classList.contains("tab-close")) { e.stopPropagation(); closeTab(t.id); }
        else activate(t);
      });
      bar.appendChild(el);
    });
  }
  function renderTab(t) { renderTabbar(); updateTitle(); }

  function goHome() {
    if (activeId && activeTab() && activeTab().dirty) saveNow();
    $("#editor").hidden = true; $("#dashboard").hidden = false;
    $("#ribbon-host").hidden = true; $("#ribbon-host").innerHTML = "";
    $("#statusbar").hidden = true;
    $("#doc-title").textContent = "";
    closeBackstage();
    document.title = "绿角犀 Office · 跨平台办公套件";
    renderDashboard();
  }

  /* ---------------- 保存 ---------------- */
  async function persist(t) {
    if (!t) return;
    t.doc.data = t.instance.serialize();
    await OS.store.put(t.doc);
    t.dirty = false; renderTabbar(); updateTitle();
  }
  function markDirty() {
    const t = activeTab(); if (!t) return;
    t.dirty = true; renderTabbar(); updateTitle();
    if (OS.settings.get("autosave")) { clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(t).catch(() => {}), 1200); }
  }
  async function saveNow() {
    const t = activeTab(); if (!t) return;
    if (!OS.Tasks) { try { await persist(t); OS.toast("已保存", "ok"); } catch (e) { OS.toast("保存失败：" + e.message, "err"); } return; }
    OS.Tasks.run("保存 " + t.doc.name, async r => {
      r.step("读取编辑内容");
      t.doc.data = t.instance.serialize();
      r.step("写入本地数据库");
      await OS.store.put(t.doc);
      r.step("完成");
      t.dirty = false; renderTabbar(); updateTitle();
    }, { doneMsg: "已保存" });
  }

  /* ---------------- 状态栏 ---------------- */
  function applyZoom(delta) {
    zoom = Math.max(50, Math.min(400, zoom + delta));
    const wrap = document.querySelector("#module-host .module-wrap");
    if (wrap) wrap.style.zoom = zoom / 100;
    const v = document.querySelector(".sb-zoomval"); if (v) v.textContent = zoom + "%";
  }
  function renderStatusbar() {
    const t = activeTab(); if (!t) return;
    const info = OS.TYPE_INFO[t.doc.type] || { name: t.doc.type };
    const comp = OS.COMPAT[t.doc.compat];
    const sb = $("#statusbar");
    sb.innerHTML = `
      <span class="sb-item">${info.name}</span>
      <span class="sb-item">${OS.util.fmtSize(t.doc.size || 0)}</span>
      ${comp ? `<span class="sb-item" style="color:${comp.color.replace('var(--ok)','#0e7c3a').replace('var(--warn)','#b9700f').replace('var(--danger)','#c4312b')}">${comp.label}</span>` : ""}
      <span class="sb-item sb-spacer"></span>
      <span class="sb-item sb-tasks" id="sb-tasks" hidden>
        <button id="sb-tasks-btn" title="任务进程 (Alt+T)">${ICON().svg("tasks", 14)}<span>任务</span><b class="sb-tasks-count">0</b></button>
      </span>
      <span class="sb-item" id="sb-ready">就绪</span>
      <span class="sb-item sb-zoom">
        <button id="zb-out" title="缩小">−</button>
        <span class="sb-zoomval" id="zb-val" title="重置为 100%">${zoom}%</span>
        <button id="zb-in" title="放大">＋</button>
      </span>`;
    sb.querySelector("#zb-out").onclick = () => applyZoom(-10);
    sb.querySelector("#zb-in").onclick = () => applyZoom(10);
    sb.querySelector("#zb-val").onclick = () => { zoom = 100; applyZoom(0); };
    const tasksBtn = sb.querySelector("#sb-tasks-btn");
    if (tasksBtn) {
      tasksBtn.onclick = () => OS.Tasks && OS.Tasks.togglePanel();
      OS.Tasks && OS.Tasks.setBadgeEl(sb.querySelector("#sb-tasks"));
    }
  }

  /* ---------------- 导入 ---------------- */
  async function onFile(e) {
    const f = e.target.files[0]; if (!f) return; e.target.value = "";
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!OS.Tasks) return OS.toast(`正在导入 ${f.name} …`);
    OS.Tasks.run("导入 " + f.name, async (r) => {
      r.step("读取文件");
      if (ext === "pdf") {
        const url = await OS.util.readFile(f, true);
        const doc = await OS.store.create({ type: "pdf", name: f.name });
        doc.data = { name: f.name, dataUrl: url }; await OS.store.put(doc); openDoc(doc); return;
      }
      if (ext === "html") {
        const html = await OS.util.readFile(f, false);
        const doc = await OS.store.create({ type: "writer", name: f.name.replace(/\.html?$/i, "") });
        doc.data = { html: htmlBody(html) }; await OS.store.put(doc); openDoc(doc); return;
      }
      if (ext === "txt" || ext === "md") {
        const txt = await OS.util.readFile(f, false);
        const html = txt.split(/\n{2,}/).map(p => `<p>${OS.util.escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
        const doc = await OS.store.create({ type: "writer", name: f.name });
        doc.data = { html: `<h1>${OS.util.escapeHtml(f.name)}</h1>` + html }; await OS.store.put(doc); openDoc(doc); return;
      }
      if (ext === "csv") {
        const txt = await OS.util.readFile(f, false);
        const doc = await OS.store.create({ type: "spreadsheet", name: f.name });
        doc.data = csvToSheet(txt); await OS.store.put(doc); openDoc(doc); return;
      }
      if (["docx", "xlsx", "pptx", "odt", "ods", "odp", "ofd"].includes(ext)) {
        const r2 = await OS.Importer.importFile(f, (s, p) => r.step(s, p));
        if (r2) {
          r.step("保存到本地");
          const doc = await OS.store.create({ type: r2.type, name: f.name.replace(/\.[^.]+$/i, "") });
          doc.data = r2.data; doc.compat = r2.compat || "B";
          await OS.store.put(doc); openDoc(doc);
          if (r2.note) OS.toast(r2.note, "ok");
          return;
        }
      }
      throw new Error("暂不支持该格式：" + ext);
    }, { doneMsg: "导入完成" });
  }
  function htmlBody(html) {
    const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    return m ? m[1] : html;
  }
  function csvToSheet(txt) {
    const rows = txt.split(/\r?\n/).filter(r => r.length);
    const cells = {};
    rows.forEach((r, i) => {
      r.split(",").forEach((c, j) => { const v = c.trim().replace(/^"|"$/g, ""); if (v) cells[OS.FormulaEngine.idxToCol(j + 1) + (i + 1)] = { v: isNaN(+v) && v !== "" ? v : +v }; });
    });
    return { rows: Math.max(rows.length, 50), cols: 16, cells, styles: {} };
  }

  /* ---------------- 导出菜单 ---------------- */
  function showExportMenu() {
    const t = activeTab(); if (!t) { OS.toast("没有打开的文档", "warn"); return; }
    const fmts = {
      writer: [["html", "HTML 网页"], ["docx", "DOCX (Word) · 原生"], ["pdf", "PDF（打印）"], ["txt", "纯文本"]],
      spreadsheet: [["csv", "CSV"], ["xlsx", "XLSX (Excel) · 原生"], ["html", "HTML"], ["pdf", "PDF（打印）"], ["json", "JSON"]],
      presentation: [["pptx", "PPTX (PowerPoint) · 原生"], ["html", "HTML 讲稿（备注）"], ["docx", "DOCX 讲稿（备注）"], ["ofd", "OFD 版式 (国标)"], ["json", "JSON"], ["pdf", "PDF（打印）"], ["png", "PNG 图片"]],
      mindmap: [["svg", "SVG 矢量图"], ["png", "PNG 图片"], ["json", "JSON 数据"]],
      pdf: [["pdf", "原始 PDF"], ["json", "JSON 元数据"]]
    }[t.doc.type] || [["json", "JSON"]];
    const NATIVE = ["docx", "xlsx", "pptx", "ofd"];
    const ov = document.createElement("div");
    ov.className = "overlay"; ov.id = "export-overlay";
    ov.innerHTML = `<div class="drawer"><div class="drawer-head"><h3>导出 · ${OS.util.escapeHtml(t.doc.name)}</h3><button class="icon-btn" data-x>✕</button></div>
      <div class="drawer-body">${fmts.map(([f, l]) => `<button class="btn" data-fmt="${f}" style="display:block;width:100%;margin-bottom:8px;justify-content:flex-start">${l}</button>`).join("")}</div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => {
      if (e.target === ov || e.target.dataset.x) { ov.remove(); return; }
      const b = e.target.closest("[data-fmt]");
      if (b) {
        const f = b.dataset.fmt;
        const label = (fmts.find(x => x[0] === f) || [f, f])[1];
        runExport(t, f, label, NATIVE.includes(f));
        ov.remove();
      }
    });
  }

  /* 统一导出任务（原生格式走 OS.Exporter，其余走模块 exportAs） */
  function runExport(tab, f, label, native) {
    if (!OS.Tasks) {
      if (native && OS.Exporter) OS.Exporter.exportDoc(tab.doc, f).catch(err => OS.toast("导出失败：" + err.message, "err"));
      else if (tab.instance.exportAs) tab.instance.exportAs(f);
      return;
    }
    OS.Tasks.run("导出 " + label, async r => {
      r.step("准备 " + f.toUpperCase());
      if (native && OS.Exporter) {
        await OS.Exporter.exportDoc(tab.doc, f, (s, p) => r.step(s, p));
      } else if (tab.instance.exportAs) {
        tab.instance.exportAs(f);
      } else {
        throw new Error("当前模块不支持导出：" + f);
      }
      r.step("完成");
    }, { doneMsg: null });
  }

  /* ---------------- 文件后台 (Backstage) ---------------- */
  function openBackstage() {
    const t = activeTab(); if (!t) return;
    const root = $("#backstage-root");
    const doc = t.doc;
    const info = OS.TYPE_INFO[doc.type] || { name: doc.type, ext: "" };
    const comp = OS.COMPAT[doc.compat];
    root.innerHTML = `
      <div class="backstage">
        <nav class="backstage-nav">
          <div class="bs-brand"><span class="dot"></span>文件</div>
          <div class="bs-label">操作</div>
          <button data-bs="info" class="active">${ICON().svg("info", 18)}<span>信息</span></button>
          <button data-bs="save">${ICON().svg("save", 18)}<span>保存</span></button>
          <button data-bs="template">${ICON().svg("star", 18)}<span>我的模板</span></button>
          <button data-bs="export">${ICON().svg("export", 18)}<span>导出</span></button>
          <button data-bs="print">${ICON().svg("print", 18)}<span>打印</span></button>
          <div class="bs-label">文档</div>
          <button data-bs="close">${ICON().svg("close", 18)}<span>关闭</span></button>
        </nav>
        <div class="backstage-content" id="bs-content">
          <button class="bs-close" id="bs-close" title="返回 (Esc)">✕</button>
          ${bsInfoHTML(doc, info, comp)}
        </div>
      </div>`;
    const bs = root.querySelector(".backstage");
    const content = root.querySelector("#bs-content");
    root.querySelector("#bs-close").onclick = closeBackstage;

    // 渲染「我的模板」管理列表（含删除）
    function renderCustomList(ul) {
      const items = OS.CustomTemplates ? OS.CustomTemplates.all() : [];
      ul.innerHTML = "";
      if (!items.length) {
        ul.innerHTML = '<p class="muted">还没有自定义模板。编辑文档后点「保存为模板」即可创建，它会出现在开始页的「自定义」分组。</p>';
        return;
      }
      items.forEach(it => {
        const row = document.createElement("div");
        row.className = "bs-tpl-item";
        const typeName = (OS.TYPE_INFO[it.module] || { name: it.module }).name;
        row.innerHTML =
          `<span class="bs-tpl-name">${OS.util.escapeHtml(it.name)}</span>` +
          `<span class="bs-tpl-mod">${OS.util.escapeHtml(typeName)}</span>` +
          `<button class="bs-tpl-del" title="删除模板" aria-label="删除模板">🗑</button>`;
        row.querySelector(".bs-tpl-del").addEventListener("click", () => {
          if (confirm(`删除模板「${it.name}」？此操作不可撤销。`)) {
            OS.CustomTemplates.remove(it.id);
            renderCustomList(ul);
            renderDashboard();
            OS.toast("已删除模板", "ok");
          }
        });
        ul.appendChild(row);
      });
    }

    bs.querySelector(".backstage-nav").addEventListener("click", e => {
      const b = e.target.closest("[data-bs]"); if (!b) return;
      bs.querySelectorAll(".backstage-nav button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      const k = b.dataset.bs;
      if (k === "info") content.innerHTML = `<button class="bs-close" id="bs-close">✕</button>` + bsInfoHTML(doc, info, comp), content.querySelector("#bs-close").onclick = closeBackstage;
      else if (k === "save") { saveNow(); content.innerHTML = `<button class="bs-close" id="bs-close">✕</button><h2>保存</h2><p class="bs-sub">文档已保存到本机存储。</p><div class="bs-actions"><button class="btn primary" id="bs-done">完成</button></div>`; content.querySelector("#bs-close").onclick = closeBackstage; content.querySelector("#bs-done").onclick = closeBackstage; }
      else if (k === "template") {
        content.innerHTML = `<button class="bs-close" id="bs-close">✕</button>` +
          `<h2>我的模板</h2>` +
          `<p class="bs-sub">将当前文档保存为可复用的个人模板，出现在开始页「自定义」分组。</p>` +
          `<div class="bs-tpl-form">` +
            `<input id="bs-tpl-name" class="bs-input" placeholder="模板名称" value="${OS.util.escapeHtml(doc.name)}">` +
            `<button class="btn primary" id="bs-tpl-save">${ICON().svg("plus", 16)} 保存为模板</button>` +
          `</div>` +
          `<div class="bs-tpl-actions">` +
            `<button class="btn" id="bs-tpl-export">${ICON().svg("download", 16)} 导出模板包</button>` +
            `<button class="btn" id="bs-tpl-import">${ICON().svg("upload", 16)} 导入模板包</button>` +
            `<input type="file" id="bs-tpl-file" accept="application/json,.json" hidden>` +
          `</div>` +
          `<div class="bs-tpl-list" id="bs-tpl-list"></div>`;
        content.querySelector("#bs-close").onclick = closeBackstage;
        const listEl = content.querySelector("#bs-tpl-list");
        renderCustomList(listEl);
        content.querySelector("#bs-tpl-save").addEventListener("click", () => {
          const name = content.querySelector("#bs-tpl-name").value.trim() || doc.name;
          const data = t.instance.serialize();
          OS.CustomTemplates.add({ name, module: doc.type, data });
          renderCustomList(listEl);
          renderDashboard();
          OS.toast("已保存为模板：" + name, "ok");
        });
        content.querySelector("#bs-tpl-export").addEventListener("click", () => {
          const json = OS.CustomTemplates.exportAll();
          OS.util.download(new Blob([json], { type: "application/json" }), "绿角犀模板包.json");
          OS.toast("已导出模板包", "ok");
        });
        const fileInput = content.querySelector("#bs-tpl-file");
        content.querySelector("#bs-tpl-import").addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", async (e) => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          try {
            const text = await f.text();
            const r = OS.CustomTemplates.importFrom(text);
            renderCustomList(listEl);
            renderDashboard();
            if (r.errors) OS.toast(`导入完成：新增 ${r.added}，跳过 ${r.skipped}，失败 ${r.errors}`, "warn");
            else OS.toast(`已导入模板包：新增 ${r.added}，跳过 ${r.skipped}`, "ok");
          } catch (err) { OS.toast("导入失败：" + ((err && err.message) || err), "error"); }
          fileInput.value = "";
        });
      }
      else if (k === "export") { closeBackstage(); showExportMenu(); }
      else if (k === "print") { closeBackstage(); if (t.instance.exportAs) t.instance.exportAs("pdf"); else window.print(); }
      else if (k === "close") { closeBackstage(); closeTab(doc.id); }
    });
  }
  function bsInfoHTML(doc, info, comp) {
    return `<h2>信息</h2><p class="bs-sub">${info.name} · ${OS.util.escapeHtml(doc.name)}</p>
      <div class="bs-info-grid">
        <div class="bs-info-card"><h4>类型</h4><div class="val">${info.name}（.${info.ext}）</div></div>
        <div class="bs-info-card"><h4>大小</h4><div class="val">${OS.util.fmtSize(doc.size || 0)}</div></div>
        <div class="bs-info-card"><h4>兼容等级</h4><div class="val" style="color:${comp ? comp.color.replace('var(--ok)','#0e7c3a').replace('var(--warn)','#b9700f').replace('var(--danger)','#c4312b') : 'inherit'}">${comp ? comp.label : "未知"}</div></div>
        <div class="bs-info-card"><h4>修改时间</h4><div class="val">${OS.util.fmtTime(doc.updatedAt)}</div></div>
      </div>
      <p class="muted">${comp ? comp.desc : ""}</p>
      <div class="bs-actions">
        <button class="btn primary" id="bs-save2">${ICON().svg("save", 16)} 保存</button>
        <button class="btn" id="bs-exp2">${ICON().svg("export", 16)} 导出</button>
      </div>`;
  }
  function closeBackstage() { const r = $("#backstage-root"); if (r) r.innerHTML = ""; }

  /* ---------------- 命令面板 ---------------- */
  const COMMANDS = [
    { id: "new-writer", label: "新建文档", hint: "Writer", run: () => newDoc("writer") },
    { id: "new-sheet", label: "新建表格", hint: "Spreadsheet", run: () => newDoc("spreadsheet") },
    { id: "new-pres", label: "新建演示", hint: "Presentation", run: () => newDoc("presentation") },
    { id: "new-mindmap", label: "新建脑图/图示", hint: "MindMap", run: () => newDoc("mindmap") },
    { id: "new-pdf", label: "新建 PDF 视图", hint: "PDF", run: () => newDoc("pdf") },
    { id: "open", label: "打开文件", hint: "导入", run: () => $("#file-input").click() },
    { id: "save", label: "保存", hint: "Ctrl/Cmd+S", run: saveNow },
    { id: "search", label: "全局搜索文档", hint: "Ctrl/Cmd+Shift+F", run: openSearch },
    { id: "replace", label: "查找替换", hint: "Ctrl/Cmd+H", run: openReplace },
    { id: "export", label: "导出", hint: "Ctrl/Cmd+E", run: showExportMenu },
    { id: "home", label: "返回首页", hint: "Ctrl/Cmd+Shift+H", run: goHome },
    { id: "ai", label: "打开 AI 助手", hint: "Ctrl/Cmd+Shift+A", run: openAI },
    { id: "theme", label: "切换深色/浅色主题", hint: "", run: () => OS.theme.toggle() }
  ];
  function openCmd() {
    const ov = $("#cmd-overlay"); ov.hidden = false;
    const input = $("#cmd-input"); input.value = ""; input.focus();
    renderCmd("");
    input.oninput = () => renderCmd(input.value);
    ov.onclick = e => { if (e.target === ov) closeOverlays(); };
  }
  function renderCmd(q) {
    const list = $("#cmd-list"); list.innerHTML = "";
    const ql = q.trim().toLowerCase();
    const matched = COMMANDS.filter(c => !ql || c.label.toLowerCase().includes(ql) || (c.hint || "").toLowerCase().includes(ql));
    matched.forEach((c, i) => {
      const li = document.createElement("li"); li.className = i === 0 ? "active" : "";
      li.innerHTML = `<span>${c.label}</span><span class="cmd-hint">${c.hint || ""}</span>`;
      li.onclick = () => { c.run(); closeOverlays(); };
      list.appendChild(li);
    });
    input.onkeydown = e => {
      if (e.key === "Enter") { const first = list.querySelector("li"); if (first) first.click(); }
    };
  }
  function closeOverlays() {
    $("#cmd-overlay").hidden = true;
    const ex = document.getElementById("export-overlay"); if (ex) ex.remove();
    $("#acct-overlay").hidden = true;
    $("#ai-drawer").hidden = true;
    closeSearch();
    closeBackstage();
  }

  /* ---------------- AI 助手（Copilot 风格） ---------------- */
  const AI_SYS = {
    summarize: "请用简洁的中文总结用户提供的内容，保留关键信息与逻辑顺序。",
    polish: "请将用户提供的中文文本润色得更书面、通顺、专业，不改变原意。",
    rewrite: "请在不改变原意的前提下，用另一种表达改写用户文本。",
    expand: "请基于用户提供的文本进行合理扩写与展开论述。",
    continue: "请基于用户提供的文本进行自然续写。",
    outline: "请基于主题生成结构清晰的中文大纲。",
    translate: "请处理用户文本的翻译任务（术语对照 / 译文）。",
    explain: "请解释用户选中的概念或内容。"
  };
  function aiContext() {
    const t = activeTab(); if (!t) return null;
    return {
      doc: t.doc, inst: t.instance,
      selText() { const s = window.getSelection ? window.getSelection().toString() : ""; return (s || "").trim(); },
      fullText() { return getFullText(t.doc); },
      replaceSelection(text) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed) {
          try { document.execCommand("insertText", false, text); markDirty(); return true; } catch (e) {}
        }
        return false;
      },
      insertText(text) {
        if (this.replaceSelection(text)) return true;
        try { document.execCommand("insertText", false, text); markDirty(); return true; } catch (e) {}
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
        OS.toast("已复制到剪贴板，请粘贴到文档", "ok"); return false;
      }
    };
  }
  function getFullText(doc) {
    const d = doc.data || {};
    if (doc.type === "writer") return OS.AI.stripHtml(d.html || "");
    if (doc.type === "spreadsheet") {
      const c = d.cells || {};
      return Object.keys(c).sort().map(k => c[k].v != null ? c[k].v : "").filter(Boolean).join("\n");
    }
    if (doc.type === "presentation") {
      return (d.slides || []).map(s => (s.elements || []).map(e => e.text || "").join(" ")).join("\n");
    }
    if (doc.type === "mindmap") {
      return (d.nodes || []).map(n => n.text || "").join("\n");
    }
    if (doc.type === "pdf") return "";
    return "";
  }
  function refreshAIContext() {
    const ctx = aiContext();
    const el = $("#ai-ctx");
    if (!ctx) { el.textContent = "未打开文档（可做自由问答）"; el.classList.add("ai-ctx-empty"); return; }
    el.classList.remove("ai-ctx-empty");
    const sel = ctx.selText();
    const full = ctx.fullText();
    if (sel) el.textContent = "📄 " + ctx.doc.name + " · 已选中 " + sel.length + " 字";
    else if (full) el.textContent = "📄 " + ctx.doc.name + " · 全文 " + full.length + " 字（未选中，将处理全文）";
    else el.textContent = "📄 " + ctx.doc.name + " · 暂无可提取文本";
  }
  function renderAICards() {
    const wrap = $("#ai-cards"); wrap.innerHTML = "";
    Object.keys(OS.AI.MODES).forEach(m => {
      const b = document.createElement("button");
      b.className = "ai-card"; b.dataset.mode = m;
      b.innerHTML = '<span class="ai-card-label">' + OS.AI.MODES[m].label + '</span><span class="ai-card-hint">' + OS.AI.MODES[m].hint + '</span>';
      b.onclick = () => runAI(m, "");
      wrap.appendChild(b);
    });
    const free = document.createElement("button");
    free.className = "ai-card ai-card-free"; free.dataset.mode = "";
    free.innerHTML = '<span class="ai-card-label">自由提问</span><span class="ai-card-hint">直接对话</span>';
    free.onclick = () => $("#ai-text").focus();
    wrap.appendChild(free);
  }
  function openAI() {
    const d = $("#ai-drawer"); d.hidden = false;
    refreshAIContext(); renderAICards();
    const chat = $("#ai-chat");
    if (!chat.querySelector(".ai-welcome")) {
      chat.innerHTML = '<div class="ai-welcome"><p>我是你的办公助手，可以帮你 <b>总结、润色、改写、扩写、续写、生成大纲、翻译、解释</b> 文档内容。</p><p class="muted">选中文字后点指令可针对选区处理；不选中则处理全文；也可直接提问。本地引擎离线可用，配置云端后自动升级。</p></div>';
    }
    setTimeout(() => $("#ai-text").focus(), 30);
  }
  function closeAI() { $("#ai-drawer").hidden = true; }
  function addChatBubble(role, text) {
    const chat = $("#ai-chat");
    const welcome = chat.querySelector(".ai-welcome"); if (welcome) welcome.remove();
    const b = document.createElement("div");
    b.className = "ai-msg ai-msg-" + role;
    const inner = document.createElement("div");
    inner.className = "ai-bubble";
    inner.textContent = text || (role === "ai" ? "正在思考…" : "");
    b.appendChild(inner);
    chat.appendChild(b);
    chat.scrollTop = chat.scrollHeight;
    return inner;
  }
  function typewriter(el, text, ctx, mode) {
    el.textContent = "";
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 70));
    const timer = setInterval(() => {
      i += step; el.textContent = text.slice(0, i);
      const chat = $("#ai-chat"); if (chat) chat.scrollTop = chat.scrollHeight;
      if (i >= text.length) {
        clearInterval(timer); el.textContent = text;
        if (ctx && text && text.trim() && mode !== "translate" && mode !== "explain") {
          const bar = document.createElement("div"); bar.className = "ai-actions";
          const ins = document.createElement("button"); ins.className = "btn small";
          ins.textContent = "插入到文档";
          ins.onclick = () => { if (ctx.insertText(text)) OS.toast("已插入到文档", "ok"); };
          bar.appendChild(ins);
          el.appendChild(bar);
        }
      }
    }, 12);
  }
  async function runAI(mode, instruction) {
    const ctx = aiContext();
    let basis = "", srcLabel = "";
    if (ctx) {
      const sel = ctx.selText();
      if (sel) { basis = sel; srcLabel = "选中文本"; }
      else { basis = ctx.fullText(); srcLabel = "全文"; }
    }
    const user = basis
      ? (instruction ? instruction + "\n\n【" + srcLabel + "】\n" + basis : basis)
      : (instruction || "");
    addChatBubble("user", instruction || (mode ? OS.AI.MODES[mode].label : "提问"));
    const aiBubble = addChatBubble("ai", "");
    const msgEl = aiBubble.parentElement;
    const status = document.createElement("div");
    status.className = "ai-status";
    status.textContent = "⏳ 生成中…";
    msgEl.appendChild(status);
    try {
      const sys = AI_SYS[mode] || "你是绿角犀 Office 的智能助手，擅长中文办公场景的文档处理。";
      const acc = { text: "", source: "local" };
      const res = await OS.AI.run({
        mode, system: sys, user, allowCloud: true,
        onDelta: d => {
          acc.text += d;
          aiBubble.textContent = acc.text;
          const chat = $("#ai-chat"); if (chat) chat.scrollTop = chat.scrollHeight;
        }
      });
      acc.text = res.text; acc.source = res.source;
      aiBubble.textContent = res.text;
      status.textContent = res.source === "cloud" ? "☁ 云端模型 · 已流式输出" : "🖥 本地引擎 · 离线可用";
      status.classList.add("ai-status-" + res.source);
      if (ctx && res.text && res.text.trim()) addAIActions(msgEl, res.text, ctx, mode);
    } catch (e) {
      aiBubble.textContent = "出错了：" + e.message;
      status.textContent = "⚠ 生成失败";
    }
  }
  function addAIActions(msgEl, text, ctx, mode) {
    const bar = document.createElement("div"); bar.className = "ai-actions";
    const ins = document.createElement("button"); ins.className = "btn small"; ins.textContent = "插入到文档";
    ins.onclick = () => { if (ctx.insertText(text)) OS.toast("已插入到文档", "ok"); };
    const rep = document.createElement("button"); rep.className = "btn small"; rep.textContent = "替换选区";
    rep.onclick = () => {
      if (ctx.replaceSelection(text)) OS.toast("已替换选区", "ok");
      else OS.toast("请先在文档中选中要替换的文本", "warn");
    };
    bar.appendChild(ins); bar.appendChild(rep);
    msgEl.appendChild(bar);
  }
  function aiSend() {
    const ta = $("#ai-text"); const v = ta.value.trim(); if (!v) return;
    ta.value = "";
    runAI("", v);
  }

  /* ---------------- 账户/设置抽屉 ---------------- */
  function openAccount() {
    const s = OS.settings.all();
    const ov = $("#acct-overlay"); ov.hidden = false;
    const body = $("#acct-body");
    body.innerHTML = `
      <div class="setting-row"><div><div class="sr-label">数据不出域</div><div class="sr-desc">开启后 AI 等功能仅使用本地模型，数据不发送到云端（PRD 3.6.5）</div></div>
        <label class="switch"><input type="checkbox" id="set-local" ${s.dataLocalOnly ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="setting-row"><div><div class="sr-label">自动保存</div><div class="sr-desc">编辑后自动写入本地存储</div></div>
        <label class="switch"><input type="checkbox" id="set-auto" ${s.autosave ? "checked" : ""}><span class="slider"></span></label></div>
      <h3 class="sr-h">AI 云端（可选增强）</h3>
      <p class="sr-desc">配置后 AI 助手自动升级为真实大模型流式响应（OpenAI 风格接口 /chat/completions）。开启「数据不出域」时仍优先本地。配置仅保存在本机。</p>
      <div class="setting-row col"><div class="sr-label">接口地址</div><input id="ai-endpoint" class="bs-input" placeholder="https://api.openai.com/v1/chat/completions"></div>
      <div class="setting-row col"><div class="sr-label">API Key</div><input id="ai-key" type="password" class="bs-input" placeholder="sk-..."></div>
      <div class="setting-row col"><div class="sr-label">模型</div><input id="ai-model" class="bs-input" placeholder="gpt-4o-mini"></div>
      <div class="bs-actions">
        <button class="btn" id="ai-test">测试连接</button>
        <button class="btn primary" id="ai-save">保存</button>
        <button class="btn" id="ai-clear">清除</button>
      </div>
      <p class="muted" id="ai-cfg-status" style="font-size:12px"></p>
      <hr style="border:none;border-top:1px solid var(--rule);margin:12px 0">
      <p class="muted" style="font-size:12px">存储模式：<b id="store-mode"></b></p>
      <p class="muted" style="font-size:12px">所有文档保存在本机（IndexedDB / 本地）。开启「数据不出域」后，内容不会离开此设备。</p>
      <p class="muted" style="font-size:12px;margin-top:8px">当前账户：<b>本地账户</b>（示例版未接入云端账户体系）</p>`;
    body.querySelector("#set-local").onchange = e => OS.settings.set("dataLocalOnly", e.target.checked);
    body.querySelector("#set-auto").onchange = e => OS.settings.set("autosave", e.target.checked);
    const savedP = OS.AI.getProvider() || {};
    const epEl = body.querySelector("#ai-endpoint"), keyEl = body.querySelector("#ai-key"), modelEl = body.querySelector("#ai-model"), cfgEl = body.querySelector("#ai-cfg-status");
    epEl.value = savedP.endpoint || ""; keyEl.value = savedP.apiKey || ""; modelEl.value = savedP.model || "";
    body.querySelector("#ai-save").onclick = () => {
      const cfg = { endpoint: epEl.value.trim(), apiKey: keyEl.value.trim(), model: modelEl.value.trim() || "gpt-4o-mini" };
      if (!cfg.endpoint) { cfgEl.textContent = "请填写接口地址。"; return; }
      OS.AI.setProvider(cfg);
      cfgEl.textContent = "✓ 已保存云端配置（仅本机），AI 助手将优先走真实流式模型。";
    };
    body.querySelector("#ai-clear").onclick = () => {
      OS.AI.setProvider(null);
      epEl.value = ""; keyEl.value = ""; modelEl.value = "";
      cfgEl.textContent = "已清除云端配置，AI 走本地引擎。";
    };
    body.querySelector("#ai-test").onclick = async () => {
      cfgEl.textContent = "正在测试连接…";
      try {
        const txt = await OS.AI.completeCloud({ system: "你是测试助手。", user: "请只回复：OK", onDelta: null });
        cfgEl.textContent = "✓ 连接成功，模型返回：" + (txt || "").slice(0, 40);
      } catch (e) { cfgEl.textContent = "✗ 连接失败：" + e.message; }
    };
    body.querySelector("#store-mode").textContent = OS._storeMode || "未知";
    $("#acct-close").onclick = () => ov.hidden = true;
    ov.onclick = e => { if (e.target === ov) ov.hidden = true; };
  }

  // 启动
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* ---------------- 全局文档搜索（跨所有打开的文档） ---------------- */
  function snippet(text, q) {
    const t = String(text == null ? "" : text);
    const ql = (q || "").toLowerCase(); const tl = t.toLowerCase();
    const idx = tl.indexOf(ql);
    if (idx === -1 || !q) return OS.util.escapeHtml(t.slice(0, 80));
    const start = Math.max(0, idx - 30);
    const end = Math.min(t.length, idx + q.length + 30);
    const before = (start > 0 ? "…" : "") + t.slice(start, idx);
    const mid = t.slice(idx, idx + q.length);
    const after = t.slice(idx + q.length, end) + (end < t.length ? "…" : "");
    return OS.util.escapeHtml(before) + "<mark>" + OS.util.escapeHtml(mid) + "</mark>" + OS.util.escapeHtml(after);
  }
  // 跨文档检索：优先调用各模块的 search()，否则退化为整篇文本匹配
  function globalSearch(q, scope) {
    const out = [];
    if (!q || !q.trim()) return out;
    const list = (scope === "active" && activeTab()) ? [activeTab()] : tabs;
    list.forEach(t => {
      const inst = t.instance;
      if (inst && typeof inst.search === "function") {
        inst.search(q).forEach(r => out.push(Object.assign({ tab: t, docName: t.doc.name, docType: t.doc.type }, r)));
      } else {
        const full = getFullText(t.doc);
        if (full.toLowerCase().indexOf(q.toLowerCase()) !== -1) {
          out.push({ tab: t, docName: t.doc.name, docType: t.doc.type, label: "（整篇）", previewHtml: snippet(full, q), goto: null });
        }
      }
    });
    return out;
  }
  function openSearch() {
    let ov = document.getElementById("global-search-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "global-search-overlay"; ov.className = "overlay"; ov.hidden = true;
      ov.innerHTML = `
        <div class="gs-panel">
          <div class="gs-head">
            <span class="gs-title">${OS.icons.svg("search", 16)} 全局文档搜索</span>
            <button class="icon-btn" data-gs-close title="关闭">✕</button>
          </div>
          <div class="gs-bar">
            <input class="gs-input" placeholder="输入关键词，跨所有打开的文档检索…" />
            <div class="gs-scope">
              <button data-scope="all" class="on">全部文档</button>
              <button data-scope="active">当前文档</button>
            </div>
          </div>
          <div class="gs-count" id="gs-count"></div>
          <div class="gs-results" id="gs-results"></div>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener("click", e => { if (e.target === ov || e.target.closest("[data-gs-close]")) closeSearch(); });
      const input = ov.querySelector(".gs-input");
      const resultsEl = ov.querySelector("#gs-results");
      const countEl = ov.querySelector("#gs-count");
      let scope = "all";
      ov.querySelectorAll(".gs-scope button").forEach(b => b.onclick = () => {
        ov.querySelectorAll(".gs-scope button").forEach(x => x.classList.remove("on"));
        b.classList.add("on"); scope = b.dataset.scope; render();
      });
      function render() {
        const q = input.value;
        const res = globalSearch(q, scope);
        countEl.textContent = q.trim() ? (res.length ? res.length + " 处匹配" : "无匹配") : "";
        resultsEl.innerHTML = "";
        if (!q.trim()) return;
        if (!res.length) { resultsEl.innerHTML = '<div class="gs-empty">没有匹配的文档内容</div>'; return; }
        res.forEach(r => {
          const info = OS.TYPE_INFO[r.docType] || { ico: "📄", name: r.docType };
          const item = document.createElement("button");
          item.className = "gs-item";
          item.innerHTML =
            `<span class="gs-doc">${info.ico} ${OS.util.escapeHtml(r.docName)}</span>` +
            `<span class="gs-label">${OS.util.escapeHtml(r.label || "")}</span>` +
            `<span class="gs-preview">${r.previewHtml || ""}</span>`;
          item.onclick = () => focusResult(r);
          resultsEl.appendChild(item);
        });
      }
      ov._render = render;
    }
    ov.hidden = false;
    const input = ov.querySelector(".gs-input"); input.value = ""; input.focus();
    if (ov._render) ov._render();
  }
  function closeSearch() { const ov = document.getElementById("global-search-overlay"); if (ov) ov.hidden = true; }
  function focusResult(r) {
    if (r.tab) activate(r.tab);
    if (r.goto) { try { r.goto(); } catch (e) {} }
    closeSearch();
    if (r.tab) renderStatusbar();
  }

  /* ---------------- 跨文档查找替换（Ctrl/Cmd+H） ---------------- */
  // 遍历指定范围（当前文档 / 全部打开的文档）的模块 replaceAll，返回统计
  function globalReplace(q, replacement, opts, scope) {
    if (!q || !q.trim()) return { docs: 0, count: 0 };
    const list = (scope === "active" && activeTab()) ? [activeTab()] : tabs;
    let docs = 0, count = 0;
    list.forEach(t => {
      const inst = t.instance;
      if (inst && typeof inst.replaceAll === "function") {
        const n = inst.replaceAll(q, replacement, opts);
        if (n) { docs++; count += n; }
      }
    });
    return { docs, count };
  }
  function openReplace() {
    let ov = document.getElementById("replace-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "replace-overlay"; ov.className = "overlay"; ov.hidden = true;
      ov.innerHTML = `
        <div class="gs-panel">
          <div class="gs-head">
            <span class="gs-title">${OS.icons.svg("replace", 16)} 查找替换</span>
            <button class="icon-btn" data-rp-close title="关闭">✕</button>
          </div>
          <div class="gs-bar" style="flex-direction:column;align-items:stretch;gap:8px">
            <input class="gs-input" id="rp-find" placeholder="查找内容…" />
            <input class="gs-input" id="rp-repl" placeholder="替换为（留空表示删除）…" />
            <div class="gs-scope" style="justify-content:flex-start;gap:12px">
              <label class="rp-case"><input type="checkbox" id="rp-case" /> 区分大小写</label>
              <button data-scope="active">当前文档</button>
              <button data-scope="all" class="on">全部打开的文档</button>
            </div>
          </div>
          <div class="gs-count" id="rp-count"></div>
          <div class="gs-results" style="padding-top:8px">
            <button class="btn primary" data-rp-do style="width:100%">替换全部</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener("click", e => { if (e.target === ov || e.target.closest("[data-rp-close]")) closeReplace(); });
      const findEl = ov.querySelector("#rp-find");
      const replEl = ov.querySelector("#rp-repl");
      const countEl = ov.querySelector("#rp-count");
      const caseEl = ov.querySelector("#rp-case");
      let scope = "all";
      ov.querySelectorAll(".gs-scope [data-scope]").forEach(b => b.onclick = () => {
        ov.querySelectorAll(".gs-scope [data-scope]").forEach(x => x.classList.remove("on"));
        b.classList.add("on"); scope = b.dataset.scope;
      });
      ov._replace = () => {
        const q = findEl.value;
        const opts = { matchCase: caseEl.checked };
        const res = globalReplace(q, replEl.value, opts, scope);
        countEl.textContent = q.trim()
          ? (res.count ? `已在 ${res.docs} 个文档中替换 ${res.count} 处` : "没有可替换的内容")
          : "";
        if (res.count) OS.toast(`替换 ${res.count} 处（${res.docs} 个文档）`, "ok");
      };
      ov.querySelector("[data-rp-do]").onclick = () => ov._replace();
      findEl.addEventListener("keydown", e => { if (e.key === "Enter") ov._replace(); });
      replEl.addEventListener("keydown", e => { if (e.key === "Enter") ov._replace(); });
    }
    ov.hidden = false;
    ov.querySelector("#rp-find").focus();
  }
  function closeReplace() { const ov = document.getElementById("replace-overlay"); if (ov) ov.hidden = true; }

  OS.shell = { boot, newDoc, openDoc, saveNow, openBackstage, closeBackstage, globalSearch, openSearch, closeSearch, openReplace, closeReplace, globalReplace, snippet };
})(window);
