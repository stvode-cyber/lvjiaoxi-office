/* ============================================================
   绿角犀 Office · 表格导出 PDF 的纯逻辑（used-range 扫描 + 分页 HTML 构建）
   ------------------------------------------------------------
   零浏览器依赖：扫描单元格存储得到已使用范围，按行区间构建单页
   纯 HTML 表字符串。单元格文本/样式由调用方回调提供（含公式求值），
   本模块只负责布局与字符串拼装，便于 Node 单测。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // cells: { "A1": {...}, ... }；colToIdx: 列字母 -> 0-based 索引
  // 返回 { r: 最大有值行, c: 最大有值列 }（至少 1×1）
  function sheetUsedRange(cells, colToIdx) {
    let maxR = 0, maxC = 0;
    const store = cells || {};
    for (const ref in store) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const c = colToIdx(m[1]) + 1, r = parseInt(m[2], 10);
      if (c > maxC) maxC = c;
      if (r > maxR) maxR = r;
    }
    if (maxC < 1) maxC = 1;
    if (maxR < 1) maxR = 1;
    return { r: maxR, c: maxC };
  }

  // 构建单页（行区间 [startRow,endRow]）的纯 HTML 表字符串。
  // cellText(ref)/cellStyle(ref): 由调用方提供（cellStyle 返回样式字符串或 "")
  // idxToCol(c): 1-based 列 -> 列字母
  function buildSheetPageHtml(range, startRow, endRow, title, cellText, cellStyle, idxToCol, escapeHtml) {
    const esc = escapeHtml || (function (s) { return String(s == null ? "" : s); });
    let html = "<div class='ss-doc'><div class='ss-title'>" + esc(title) + "</div>";
    html += "<table class='ss-table'>";
    html += "<tr><th class='ss-h'></th>";
    for (let c = 1; c <= range.c; c++) html += "<th class='ss-h'>" + idxToCol(c) + "</th>";
    html += "</tr>";
    for (let r = startRow; r <= endRow; r++) {
      html += "<tr><th class='ss-rh'>" + r + "</th>";
      for (let c = 1; c <= range.c; c++) {
        const ref = idxToCol(c) + r;
        const style = cellStyle(ref);
        html += "<td class='ss-td'" + (style ? " style='" + style + "'" : "") + ">" + esc(cellText(ref)) + "</td>";
      }
      html += "</tr>";
    }
    html += "</table></div>";
    return html;
  }

  // 由 data 推断工作表列表：多表模型（data.sheets[i].{name,cells}）或单表（data.cells）
  function collectSheets(data) {
    if (data && Array.isArray(data.sheets) && data.sheets.length) {
      return data.sheets.map(s => ({ title: s.name || "Sheet", cells: s.cells || {} }));
    }
    return [{ title: "Sheet1", cells: (data && data.cells) || {} }];
  }

  // 构建单张工作表的全部分页 HTML（按行区间、行数/页 自动切分）。
  // opts: { colToIdx, idxToCol, cellText, cellStyle, escapeHtml, rowsPerPage=32, startRow, endRow, title }
  // 返回 { range:{r,c}, pages:[{html,startRow,endRow}] }
  function buildSheetPages(cells, opts) {
    opts = opts || {};
    const colToIdx = opts.colToIdx, idxToCol = opts.idxToCol;
    const cellText = opts.cellText || function () { return ""; };
    const cellStyle = opts.cellStyle || function () { return ""; };
    const escapeHtml = opts.escapeHtml || function (s) { return String(s == null ? "" : s); };
    const range = sheetUsedRange(cells, colToIdx);
    const rowsPerPage = opts.rowsPerPage || 32;
    let startRow = opts.startRow != null ? Math.max(1, opts.startRow | 0) : 1;
    let endRow = opts.endRow != null ? Math.min(range.r, opts.endRow | 0) : range.r;
    if (endRow < startRow) endRow = startRow;
    if (startRow > range.r) return { range, pages: [] };
    const title = opts.title || "Sheet";
    const pages = [];
    let k = 0;
    for (let s = startRow; s <= endRow; s += rowsPerPage) {
      const e = Math.min(endRow, s + rowsPerPage - 1);
      const suffix = (endRow - startRow + 1 > rowsPerPage) ? "（第 " + (++k) + " 页）" : "";
      const html = buildSheetPageHtml(range, s, e, title + suffix, cellText, cellStyle, idxToCol, escapeHtml);
      pages.push({ html, startRow: s, endRow: e });
    }
    return { range, pages };
  }

  // 构建整本工作簿的分页 HTML。
  // opts: { sheetIndex（null=全部）, startRow, endRow, rowsPerPage, colToIdx, idxToCol, cellText, cellStyle, escapeHtml }
  // 返回 { sheets:[{title,range,pages}], totalPages }
  function buildWorkbookPages(data, opts) {
    opts = opts || {};
    const sheets = collectSheets(data);
    let sel = sheets;
    if (opts.sheetIndex != null) {
      const i = opts.sheetIndex | 0;
      sel = (i >= 0 && i < sheets.length) ? [sheets[i]] : [];
    }
    const outSheets = []; let totalPages = 0;
    for (const sh of sel) {
      const pr = buildSheetPages(sh.cells, Object.assign({}, opts, { title: sh.title }));
      outSheets.push({ title: sh.title, range: pr.range, pages: pr.pages });
      totalPages += pr.pages.length;
    }
    return { sheets: outSheets, totalPages };
  }

  const api = { sheetUsedRange, buildSheetPageHtml, collectSheets, buildSheetPages, buildWorkbookPages };
  OS.SheetExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);
