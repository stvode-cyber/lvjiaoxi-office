/* ============================================================
   绿角犀 Office · 分页 DOM → SVG（foreignObject）光栅化标记生成
   ------------------------------------------------------------
   纯字符串构建，零浏览器依赖：给定一页内容的 HTML 字符串，
   生成可被 <img> 加载并绘制到 <canvas> 的 SVG（含内联排版样式）。
   浏览器侧由调用方负责 drawImage + getImageData → RGBA。
   同时导出到 Node（module.exports）以便单元测试。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // 内联到 SVG foreignObject 的样式（覆盖正文排版 + .pp-* 分页骨架）
  const PRINT_RASTER_CSS = [
    "*{box-sizing:border-box;margin:0;padding:0}",
    "html,body{font-family:-apple-system,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif;color:#1a2332;font-size:14px;line-height:1.6;background:#fff}",
    "h1{font-size:24px;margin:10px 0}h2{font-size:20px;margin:8px 0}h3{font-size:16px;margin:6px 0}",
    "p{margin:6px 0}blockquote{border-left:4px solid #c9d2dd;padding:4px 12px;color:#5b6b7d;margin:8px 0;background:#f7f9fb}",
    "table{border-collapse:collapse;margin:8px 0;width:100%}td,th{border:1px solid #dfe4ea;padding:5px 8px}",
    "img{max-width:100%}ul,ol{margin:6px 0 6px 22px}a{color:#2b6cb0}",
    ".pp-page{background:#fff;position:relative;overflow:hidden}",
    ".pp-content{overflow:hidden;position:absolute}",
    ".pp-header,.pp-footer{position:absolute;left:0;right:0;display:flex;gap:8px;font-size:10px;color:#6b7a8d;padding:0 2px;z-index:1}",
    ".pp-header{top:0;border-bottom:1px solid #e3e8ef}.pp-footer{bottom:0;border-top:1px solid #e3e8ef}",
    ".pp-cell{flex:1}.pp-l{text-align:left}.pp-c{text-align:center}.pp-r{text-align:right}"
  ].join("");

  // innerHtml: 单页内容（通常是一个 .pp-page 的 outerHTML）
  // W/H: 该页 CSS 像素尺寸；scale: 光栅倍率（如 2 → 输出 2x 清晰）
  // css: 可选，内联到 SVG 的样式字符串；不传则用默认正文排版样式
  // 返回 SVG 字符串（width/height 已按 scale 放大；内容以 transform:scale 铺满）
  function buildPageSvg(innerHtml, W, H, scale, css) {
    if (scale == null) scale = 2;
    const cssStr = css == null ? PRINT_RASTER_CSS : css;
    const W2 = Math.round(W * scale), H2 = Math.round(H * scale);
    const root = '<div class="pp-svg-root" style="width:' + W + 'px;height:' + H + 'px;transform:scale(' + scale + ');transform-origin:0 0">' + innerHtml + '</div>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W2 + '" height="' + H2 + '" viewBox="0 0 ' + W2 + ' ' + H2 + '">' +
      '<foreignObject x="0" y="0" width="' + W2 + '" height="' + H2 + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml"><style>' + cssStr + '</style>' + root + '</div>' +
      '</foreignObject></svg>';
  }

  // 页码范围选择：1-based 含端点 [startPage, endPage] → 0-based 含端点 [a, b]
  // 越界自动夹紧；缺省返回 [0, total-1]
  function pageRange(total, opts) {
    opts = opts || {};
    let a = 1, b = total;
    if (opts.startPage != null) a = Math.max(1, Math.min(total, opts.startPage | 0));
    if (opts.endPage != null) b = Math.max(a, Math.min(total, opts.endPage | 0));
    return [a - 1, b - 1];
  }

  const api = { buildPageSvg, PRINT_RASTER_CSS, pageRange };
  OS.SvgRaster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);