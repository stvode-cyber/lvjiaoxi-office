/* ============================================================
   绿角犀 Office · PDF 文本索引（纯逻辑）
   - 接收「已归一化到页面盒子（0..1）」的文本 span 列表
   - 提供全文搜索（大小写不敏感、跨页）与页面文本拼接
   - 不依赖 pdf.js，可在 node 直跑单测
   ============================================================ */
(function (global) {
  "use strict";
  const OS = (global.OS = global.OS || {});

  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

  // 清洗单个 span：缺字段补默认，坐标夹取到 0..1
  function cleanSpan(s) {
    s = s || {};
    const text = typeof s.text === "string" ? s.text : "";
    return {
      text,
      x: clamp01(isNum(s.x) ? s.x : 0),
      y: clamp01(isNum(s.y) ? s.y : 0),
      w: isNum(s.w) && s.w >= 0 ? s.w : 0,
      h: isNum(s.h) && s.h >= 0 ? s.h : 0
    };
  }

  // pages: Array<Array<{text,x,y,w,h}>>，每个内层数组为一页的 span（归一化 0..1）
  function buildIndex(pages) {
    const safe = Array.isArray(pages) ? pages : [];
    const out = safe.map(page => {
      const arr = Array.isArray(page) ? page : [];
      return arr.map(cleanSpan);
    });
    return { pages: out, counts: out.map(p => p.length) };
  }

  // 在索引中搜索 query（大小写不敏感、跨页、子串匹配 span）
  // 返回命中列表：{page, text, x, y, w, h}（page 为 1-based）
  function search(index, query) {
    const hits = [];
    if (!index || !Array.isArray(index.pages)) return hits;
    const q = typeof query === "string" ? query.trim().toLowerCase() : "";
    if (!q) return hits;
    index.pages.forEach((spans, i) => {
      const pageNo = i + 1;
      spans.forEach(s => {
        if (s.text && s.text.toLowerCase().indexOf(q) !== -1) {
          hits.push({ page: pageNo, text: s.text, x: s.x, y: s.y, w: s.w, h: s.h });
        }
      });
    });
    return hits;
  }

  // 命中页集合（去重，升序）
  function hitPages(index, query) {
    const set = {};
    search(index, query).forEach(h => { set[h.page] = true; });
    return Object.keys(set).map(Number).sort((a, b) => a - b);
  }

  // 拼接某页文本（span 之间用换行分隔，近似阅读顺序）
  function pageText(index, page) {
    if (!index || !Array.isArray(index.pages)) return "";
    const i = (typeof page === "number" ? page : 1) - 1;
    const spans = index.pages[i];
    if (!spans) return "";
    return spans.map(s => s.text).join("\n");
  }

  // 全文纯文本（所有页拼接，页间空行）
  function allText(index) {
    if (!index || !Array.isArray(index.pages)) return "";
    return index.pages.map((_, i) => pageText(index, i + 1)).join("\n\n");
  }

  const api = { buildIndex, search, hitPages, pageText, allText, _cleanSpan: cleanSpan };
  OS.PdfText = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);
