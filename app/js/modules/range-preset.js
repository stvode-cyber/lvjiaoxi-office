/* PDF 导出范围预设（U）
   零依赖、纯逻辑、Node 可直接 require。
   提供：
   - parsePageList(str, total)        : "1,3-5,8" -> [1,3,4,5,8]（1-based，裁剪/排序/去重）
   - resolvePreset(preset, ctx)       : 命名预设 -> 页号数组（1-based）；ctx={total,current}
   - resolvePagePreset(preset,t,cur)  : 页导向别名（presentation 用）
   - resolveSheetPreset(preset,sheets,cur): 工作表导向别名 -> 0-based 索引数组（spreadsheet 用）
   - createStore(initial)             : 预设存储（内存态，get/set/has/delete/list/all）
   preset 支持："all" | "odd" | "even" | "current" | {kind:"list",value:"1,3-5"} | 列表字符串 | 单页数字。
*/
(function (root) {
  "use strict";

  // "1,3-5,8" / "1-3, 7" -> [1,3,4,5,8]，裁剪到 [1,total]，排序去重
  function parsePageList(str, total) {
    const t = (total | 0);
    const raw = [];
    if (str == null) return raw;
    const s = String(str).trim().toLowerCase();
    if (s === "all" || s === "*" || s === "") {
      for (let i = 1; i <= t; i++) raw.push(i);
      return raw;
    }
    s.split(/[,\s]+/).forEach(tok => {
      tok = tok.trim();
      if (!tok) return;
      if (tok.indexOf("-") >= 0) {
        const p = tok.split("-");
        let a = parseInt(p[0], 10), b = parseInt(p[1], 10);
        if (isNaN(a) || isNaN(b)) return;
        if (a > b) { const t2 = a; a = b; b = t2; }
        for (let i = a; i <= b; i++) raw.push(i);
      } else {
        const n = parseInt(tok, 10);
        if (!isNaN(n)) raw.push(n);
      }
    });
    const seen = {}, res = [];
    raw.forEach(n => {
      if (n >= 1 && (t === 0 || n <= t) && !seen[n]) { seen[n] = 1; res.push(n); }
    });
    res.sort((x, y) => x - y);
    return res;
  }

  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
  function clampOne(arr, total) { return arr.filter(n => n >= 1 && (total === 0 || n <= total)); }

  // 命名预设 -> 页号数组（1-based）
  function resolvePreset(preset, ctx) {
    ctx = ctx || {};
    const total = (ctx.total | 0);
    const current = (ctx.current | 0) || 1;
    let kind = preset, value = null;
    if (preset && typeof preset === "object") { kind = preset.kind; value = preset.value; }
    if (typeof kind === "number") return clampOne([kind], total);
    switch (String(kind == null ? "" : kind).toLowerCase()) {
      case "all":
      case "*": return range(1, total);
      case "odd": { const r = []; for (let i = 1; i <= total; i += 2) r.push(i); return r; }
      case "even": { const r = []; for (let i = 2; i <= total; i += 2) r.push(i); return r; }
      case "current": return clampOne([current], total);
      case "list": return parsePageList(value, total);
      default: return parsePageList(kind, total);
    }
  }

  function resolvePagePreset(preset, total, current) {
    return resolvePreset(preset, { total: total, current: current });
  }

  // 工作表导向：preset -> 0-based 索引数组
  function resolveSheetPreset(preset, sheets, current) {
    let count = 0;
    if (Array.isArray(sheets)) count = sheets.length;
    else if (typeof sheets === "number") count = sheets;
    const cur = (current | 0);
    let kind = preset, value = null;
    if (preset && typeof preset === "object") { kind = preset.kind; value = preset.value; }
    const toIdx = (arr) => arr.map(n => n - 1).filter(i => i >= 0 && (count === 0 || i < count));
    if (typeof kind === "number") { const i = kind | 0; return (i >= 0 && (count === 0 || i < count)) ? [i] : []; }
    switch (String(kind == null ? "" : kind).toLowerCase()) {
      case "all":
      case "*": { const r = []; for (let i = 0; i < count; i++) r.push(i); return r; }
      case "current": return toIdx(clampOne([cur + 1], count));
      case "list": return toIdx(parsePageList(value, count));
      default: return toIdx(parsePageList(kind, count));
    }
  }

  // 预设存储（内存态，可增删查；不持久化，由调用方决定是否落盘）
  function createStore(initial) {
    const map = {};
    if (initial && typeof initial === "object") {
      Object.keys(initial).forEach(k => { map[k] = initial[k]; });
    }
    return {
      get(k) { return map[k]; },
      set(k, v) { map[k] = v; return v; },
      has(k) { return Object.prototype.hasOwnProperty.call(map, k); },
      delete(k) { const had = this.has(k); delete map[k]; return had; },
      list() { return Object.keys(map); },
      all() { return Object.assign({}, map); }
    };
  }

  const api = {
    parsePageList, resolvePreset, resolvePagePreset, resolveSheetPreset, createStore,
    _range: range, _clampOne: clampOne
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.OS = root.OS || {}; root.OS.RangePreset = api; }
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
