/* ============================================================
   绿角犀 Office · 批注搜索与过滤（纯逻辑，零依赖）
   ------------------------------------------------------------
   提供批注集合的文本搜索、按类型/图层/页码/可见性过滤，
   以及按类型计数。被 pdf.js 的批注面板「搜索」组复用，
   亦可独立在 Node 下 require 测试。
   暴露：OS.PdfAnnoFilter = { matchAnnotation, searchAnnotations,
          filterAnnotations, countByType }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // 可搜索的文本字段（大小写不敏感子串匹配）
  function searchableText(a) {
    if (!a || typeof a !== "object") return "";
    return [
      a.text, a.author, a.type, a.note, a.subject,
      a.uri, a.label, a.name, a.content
    ].filter(function (v) { return typeof v === "string" && v.length; })
      .join(" ").toLowerCase();
  }

  // 单条批注是否命中查询串（空串/纯空白 = 命中全部）
  function matchAnnotation(a, query) {
    if (!query || !query.trim()) return true;
    return searchableText(a).indexOf(query.trim().toLowerCase()) !== -1;
  }

  // 文本搜索：返回命中查询的批注数组（输入非法返回空数组）
  function searchAnnotations(annos, query) {
    if (!Array.isArray(annos)) return [];
    if (!query || !query.trim()) return annos.slice();
    return annos.filter(function (a) { return matchAnnotation(a, query); });
  }

  // 复合过滤：opts 各约束可选（undefined / null / 空 = 不约束）
  //   types:   [typeStr,...]   类型白名单
  //   layers:  [layerStr,...]  图层白名单（批注无 layer 字段时，layers 给定则排除）
  //   pages:   [pageNum,...]   页码白名单
  //   visible: true|false|null 可见性约束（undefined 视为可见）
  //   query:   string          文本搜索串
  function filterAnnotations(annos, opts) {
    if (!Array.isArray(annos)) return [];
    opts = opts || {};
    const types = Array.isArray(opts.types) ? opts.types : null;
    const layers = Array.isArray(opts.layers) ? opts.layers : null;
    const pages = Array.isArray(opts.pages) ? opts.pages : null;
    const hasVisible = opts.visible === true || opts.visible === false;
    return annos.filter(function (a) {
      if (types && types.indexOf(a.type) === -1) return false;
      if (layers) {
        const lay = (a.layer == null ? "" : String(a.layer));
        if (layers.indexOf(lay) === -1) return false;
      }
      if (pages && pages.indexOf(a.page) === -1) return false;
      if (hasVisible) {
        const vis = a.visible == null ? true : !!a.visible;
        if (vis !== opts.visible) return false;
      }
      if (!matchAnnotation(a, opts.query)) return false;
      return true;
    });
  }

  // 按类型计数：返回 { type: count }
  function countByType(annos) {
    const m = {};
    if (!Array.isArray(annos)) return m;
    annos.forEach(function (a) {
      const t = a && a.type ? a.type : "unknown";
      m[t] = (m[t] || 0) + 1;
    });
    return m;
  }

  const Api = {
    matchAnnotation: matchAnnotation,
    searchAnnotations: searchAnnotations,
    filterAnnotations: filterAnnotations,
    countByType: countByType
  };

  OS.PdfAnnoFilter = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
