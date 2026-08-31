/* ============================================================
   绿角犀 Office · 自定义模板 (OS.CustomTemplates)
   用户可将当前文档保存为可复用模板，出现在开始页「自定义」分组。
   数据属于用户偏好，落 localStorage（与文档数据、收藏隔离）；
   localStorage 不可用时回退内存数组（仅当前会话有效）。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const KEY = "lvjiaoxi-custom-templates";

  let cache = null;
  function load() {
    if (cache) return cache;
    cache = [];
    try {
      const raw = global.localStorage && global.localStorage.getItem(KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) cache = arr; }
    } catch (e) { cache = []; }
    return cache;
  }
  function save() {
    try { if (global.localStorage) global.localStorage.setItem(KEY, JSON.stringify(cache || [])); }
    catch (e) { /* localStorage 不可用：仅保留内存 */ }
  }

  // 取模块空白模板的 accent/thumb，保持缩略图风格一致
  function defaultMeta(module) {
    const blank = OS.Templates && OS.Templates.list.find(t => t.module === module && /blank$/.test(t.id));
    if (blank) return { accent: blank.accent, thumb: blank.thumb };
    return { accent: "#2563eb", thumb: "" };
  }

  // 把原始存储条目包装成「模板形态」：带 build()（深拷贝数据，避免共享引用）
  function wrap(e) {
    return {
      id: e.id,
      name: e.name,
      desc: e.desc || "我的自定义模板",
      module: e.module,
      accent: e.accent,
      thumb: e.thumb,
      isCustom: true,
      createdAt: e.createdAt,
      build: () => JSON.parse(JSON.stringify(e.data))
    };
  }

  OS.CustomTemplates = {
    all() { return load().map(wrap); },
    byId(id) { const e = load().find(x => x.id === id); return e ? wrap(e) : null; },
    add(spec) {
      spec = spec || {};
      const module = spec.module;
      const meta = defaultMeta(module);
      const entry = {
        id: "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: (spec.name || "未命名模板").trim() || "未命名模板",
        desc: spec.desc || "我的自定义模板",
        module: module,
        accent: meta.accent,
        thumb: meta.thumb,
        data: spec.data,
        createdAt: Date.now()
      };
      load().push(entry);
      save();
      return wrap(entry);
    },
    remove(id) {
      const arr = load().filter(x => x.id !== id);
      cache = arr;
      save();
    },
    // 导出全部自定义模板为标准分享包（JSON 字符串）
    exportAll() {
      const arr = load().map(e => ({
        id: e.id, name: e.name, desc: e.desc || "我的自定义模板",
        module: e.module, accent: e.accent, thumb: e.thumb,
        data: e.data, createdAt: e.createdAt
      }));
      return JSON.stringify({
        format: "lvjiaoxi-templates", version: 1,
        app: "绿角犀 Office", exportedAt: Date.now(), templates: arr
      }, null, 2);
    },
    // 从分享包文本导入：解析/校验/按 id 去重合并。返回 {added, skipped, errors}
    importFrom(text) {
      const res = { added: 0, skipped: 0, errors: 0 };
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { res.errors++; return res; }
      const arr = Array.isArray(parsed) ? parsed
        : (parsed && Array.isArray(parsed.templates) ? parsed.templates : null);
      if (!arr) { res.errors++; return res; }
      const known = (OS.modules && Object.keys(OS.modules)) || [];
      const existing = new Set(load().map(x => x.id));
      const imported = load().slice();
      arr.forEach(e => {
        if (!e || typeof e !== "object") { res.errors++; return; }
        if (typeof e.id !== "string" || !e.id) { res.errors++; return; }
        if (typeof e.module !== "string" || (known.length && !known.includes(e.module))) { res.errors++; return; }
        if (!e.data || typeof e.data !== "object") { res.errors++; return; }
        if (existing.has(e.id)) { res.skipped++; return; } // 同名 id 跳过，避免覆盖
        const meta = defaultMeta(e.module);
        imported.push({
          id: e.id,
          name: (typeof e.name === "string" && e.name.trim()) ? e.name.trim() : "导入的模板",
          desc: typeof e.desc === "string" ? e.desc : "导入的自定义模板",
          module: e.module,
          accent: typeof e.accent === "string" ? e.accent : meta.accent,
          thumb: typeof e.thumb === "string" ? e.thumb : meta.thumb,
          data: e.data,
          createdAt: typeof e.createdAt === "number" ? e.createdAt : Date.now()
        });
        existing.add(e.id);
        res.added++;
      });
      cache = imported;
      save();
      return res;
    }
  };
})(window);
