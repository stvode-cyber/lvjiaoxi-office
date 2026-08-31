/* ============================================================
   绿角犀 Office · Office 风格标签页功能区 (OS.Ribbon)
   标签条(文件/开始/插入/设计/视图) + 分组命令栏 + 分组底注
   返回自包含 DOM：{ el, activate(id), tabs, getTab(id) }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // —— 单项渲染 ——
  function buildItem(it) {
    if (it.kind === "input") {
      const wrap = el(`<div class="rctl"></div>`);
      const inp = el(`<input class="rinp" type="${it.type || "text"}" title="${it.title || ""}" value="${it.value != null ? it.value : ""}" placeholder="${it.placeholder || ""}">`);
      if (it.width) inp.style.width = it.width + "px";
      if (it.onInput) inp.addEventListener("input", e => it.onInput(e.target.value, e));
      if (it.onChange) inp.addEventListener("change", e => it.onChange(e.target.value, e));
      wrap.appendChild(inp);
      return wrap;
    }

    if (it.kind === "select") {
      const wrap = el(`<div class="rctl"></div>`);
      const sel = el(`<select class="rsel" title="${it.title || ""}"></select>`);
      (it.options || []).forEach(o => {
        const op = el(`<option value="${o.value}">${o.label}</option>`);
        if (o.value === it.value) op.selected = true;
        sel.appendChild(op);
      });
      if (it.width) sel.style.width = it.width + "px";
      sel.addEventListener("change", e => it.onChange && it.onChange(e.target.value, e));
      wrap.appendChild(sel);
      return wrap;
    }

    if (it.kind === "color") {
      const wrap = el(`<div class="rctl rcolor-wrap" title="${it.title || "颜色"}"></div>`);
      const inp = el(`<input type="color" class="rcolor">`);
      if (it.value) inp.value = it.value;
      inp.addEventListener("input", e => it.onInput && it.onInput(e.target.value, e));
      wrap.appendChild(inp);
      if (it.label) wrap.appendChild(el(`<span class="rcolor-cap">${it.label}</span>`));
      return wrap;
    }

    if (it.kind === "split") {
      const box = el(`<div class="rbtn-split"></div>`);
      if (it.r) box.dataset.r = it.r;
      const main = el(`<button class="rbtn${it.glyph ? " glyph" : ""}" title="${it.title || it.label || ""}"></button>`);
      if (it.glyph) main.appendChild(el(`<span class="rbtn-glyph">${it.glyph}</span>`));
      else if (it.icon) main.insertAdjacentHTML("beforeend", OS.icons.svg(it.icon, it.iconSize || 18));
      if (it.label) main.appendChild(el(`<span class="rbtn-cap">${it.label}</span>`));
      const caret = el(`<button class="rbtn rbtn-caret" title="">${OS.icons.svg("chevron", 12)}</button>`);
      const menu = el(`<div class="rbtn-menu" hidden></div>`);
      (it.menu || []).forEach(m => {
        if (m.divider) { menu.appendChild(el(`<div class="rmenu-div"></div>`)); return; }
        const mi = el(`<button class="rmenu-item">${m.icon ? OS.icons.svg(m.icon, 16) : ""}<span>${m.label}</span></button>`);
        mi.addEventListener("click", e => { e.stopPropagation(); menu.hidden = true; box.classList.remove("open"); m.onClick && m.onClick(e); });
        menu.appendChild(mi);
      });
      main.addEventListener("click", e => { it.onClick && it.onClick(e); });
      caret.addEventListener("click", e => {
        e.stopPropagation();
        const open = box.classList.toggle("open");
        menu.hidden = !open;
        if (open) positionMenu(box, menu);
      });
      box.appendChild(main); box.appendChild(caret); box.appendChild(menu);
      return box;
    }

    // 默认：按钮
    const b = el(`<button class="rbtn${it.glyph ? " glyph" : ""}${it.iconOnly ? " icon-only" : ""}" title="${it.title || it.label || ""}"></button>`);
    if (it.r) b.dataset.r = it.r;
    if (it.glyph) b.appendChild(el(`<span class="rbtn-glyph">${it.glyph}</span>`));
    else if (it.icon) b.insertAdjacentHTML("beforeend", OS.icons.svg(it.icon, it.iconSize || 18));
    if (it.label && !it.iconOnly) b.appendChild(el(`<span class="rbtn-cap">${it.label}</span>`));
    if (it.active) b.classList.add("active");
    b.addEventListener("click", e => {
      if (it.toggle) b.classList.toggle("active");
      it.onClick && it.onClick(e);
    });
    return b;
  }

  function positionMenu(box, menu) {
    const r = box.getBoundingClientRect();
    menu.style.minWidth = Math.max(r.width, 160) + "px";
  }

  // 关闭所有已展开的下拉
  document.addEventListener("click", () => {
    document.querySelectorAll(".rbtn-split.open").forEach(b => { b.classList.remove("open"); const m = b.querySelector(".rbtn-menu"); if (m) m.hidden = true; });
  });

  // —— 分组渲染 ——
  function buildGroup(g) {
    const grp = el(`<div class="rgroup"></div>`);
    if (g.rconn) grp.dataset.rconn = g.rconn;
    const body = el(`<div class="rgroup-body"></div>`);
    (g.items || []).forEach(it => {
      if (it.kind === "sep") body.appendChild(el(`<div class="rsep"></div>`));
      else body.appendChild(buildItem(it));
    });
    grp.appendChild(body);
    if (g.label) grp.appendChild(el(`<div class="rgroup-cap">${g.label}</div>`));
    return grp;
  }

  // —— 组件工厂 ——
  function create(spec) {
    const comp = el(`<div class="ribbon-comp"></div>`);
    const strip = el(`<div class="ribbon-tabstrip"></div>`);

    let panels = {};
    let tabBtns = {};

    function activate(id) {
      Object.keys(panels).forEach(k => {
        panels[k].hidden = k !== id;
        tabBtns[k].classList.toggle("active", k === id);
      });
    }

    // 文件标签（特殊：打开后台）
    if (spec.file) {
      const ft = el(`<button class="ribbon-tab tab-file" title="文件">文件</button>`);
      ft.addEventListener("click", () => spec.file.onOpen && spec.file.onOpen());
      strip.appendChild(ft);
    }

    (spec.tabs || []).forEach((tab, i) => {
      const t = el(`<button class="ribbon-tab" title="${tab.label}">${tab.label}</button>`);
      tabBtns[tab.id] = t;
      t.addEventListener("click", () => { activate(tab.id); spec.onTab && spec.onTab(tab.id); });
      strip.appendChild(t);

      const panel = el(`<div class="ribbon-panel" data-tab="${tab.id}"></div>`);
      (tab.groups || []).forEach(g => panel.appendChild(buildGroup(g)));
      if (tab.groups && tab.groups.length) panel.appendChild(el(`<div class="rgroup rgroup-end"></div>`));
      panels[tab.id] = panel;
      comp.appendChild(panel);
    });

    comp.appendChild(strip);
    comp.insertBefore(strip, comp.firstChild);

    // 默认激活第一个文档标签
    const first = (spec.tabs || [])[0];
    if (first) activate(first.id);

    return {
      el: comp,
      activate,
      tabs: (spec.tabs || []).map(t => t.id),
      getTab: id => panels[id],
      onTab: spec.onTab || null
    };
  }

  OS.Ribbon = { create, buildItem, buildGroup };
})(window);
