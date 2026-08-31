/* ============================================================
   绿角犀 Office · 批注批量操作（纯逻辑，零依赖）
   ------------------------------------------------------------
   提供对批注集合的批量编辑：按 id 集合批量删除 / 改色 / 归层 /
   显隐 / 改作者。被 pdf.js 批注面板「批量」组复用（作用于当前
   筛选结果），亦可独立在 Node 下 require 测试。
   暴露：OS.PdfAnnoBatch = { bulkDelete, bulkSetColor,
          bulkSetLayer, bulkSetVisible, bulkSetAuthor,
          collectIds, currentScope }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // id 入参归一：支持数组 [id,...] 或对象/Set 形式的"存在即选中"
  function toIdSet(ids) {
    const s = new Set();
    if (Array.isArray(ids)) {
      ids.forEach(function (id) { if (id != null) s.add(id); });
    } else if (ids && typeof ids === "object") {
      // Set 或 { id: true } 形式
      if (typeof ids.forEach === "function") ids.forEach(function (id) { if (id != null) s.add(id); });
      else Object.keys(ids).forEach(function (k) { if (ids[k]) s.add(k); });
    }
    return s;
  }

  // 批量删除：从 annos 中移除 id 集合命中的批注，返回移除数量
  function bulkDelete(annos, ids) {
    if (!Array.isArray(annos)) return 0;
    const set = toIdSet(ids);
    if (!set.size) return 0;
    let n = 0;
    for (let i = annos.length - 1; i >= 0; i--) {
      if (set.has(annos[i].id)) { annos.splice(i, 1); n++; }
    }
    return n;
  }

  // 通用：对 id 集合命中的批注调用 fn(a)，返回命中数量
  function eachMatched(annos, ids, fn) {
    if (!Array.isArray(annos)) return 0;
    const set = toIdSet(ids);
    if (!set.size) return 0;
    let n = 0;
    annos.forEach(function (a) { if (set.has(a.id)) { fn(a); n++; } });
    return n;
  }

  function bulkSetColor(annos, ids, color) {
    return eachMatched(annos, ids, function (a) { if (color != null) a.color = color; });
  }
  function bulkSetLayer(annos, ids, layer) {
    return eachMatched(annos, ids, function (a) { a.layer = (layer == null ? "" : String(layer)); });
  }
  function bulkSetVisible(annos, ids, visible) {
    return eachMatched(annos, ids, function (a) { a.visible = !!visible; });
  }
  function bulkSetAuthor(annos, ids, author) {
    return eachMatched(annos, ids, function (a) { if (author != null) a.author = author; });
  }

  // 从批注/对象数组收集 id（支持传入批注数组或 {id,...} 数组）
  function collectIds(items) {
    const out = [];
    if (Array.isArray(items)) items.forEach(function (a) { if (a && a.id != null) out.push(a.id); });
    return out;
  }

  // 计算"当前筛选作用域"的 id 集合：复用 PdfAnnoFilter.filterAnnotations
  // 入参：annos + 筛选状态 { query, type }（type 为单类型字符串或 null/"" 表示全部）
  function currentScope(annos, filterState) {
    if (!Array.isArray(annos)) return [];
    filterState = filterState || {};
    const opts = {};
    if (filterState.query) opts.query = filterState.query;
    if (filterState.type) opts.types = [filterState.type];
    const matched = (OS.PdfAnnoFilter && OS.PdfAnnoFilter.filterAnnotations)
      ? OS.PdfAnnoFilter.filterAnnotations(annos, opts)
      : annos.slice();
    return collectIds(matched);
  }

  const Api = {
    bulkDelete: bulkDelete,
    bulkSetColor: bulkSetColor,
    bulkSetLayer: bulkSetLayer,
    bulkSetVisible: bulkSetVisible,
    bulkSetAuthor: bulkSetAuthor,
    collectIds: collectIds,
    currentScope: currentScope,
    _toIdSet: toIdSet
  };
  OS.PdfAnnoBatch = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
