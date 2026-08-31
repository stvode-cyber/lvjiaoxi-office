/*
 * 绿角犀 Office · PDF 批注时间线（OS.PdfAnnoTimeline）
 * 纯逻辑零依赖模块：把批注按创建时间升序排序、按天分组，生成时间线视图。
 * 与 AE 批注统计面板互补——AE 是「聚合分布」，本模块是「时间顺序流」。
 *
 * 暴露：
 *   dateKey(v)            把 Date / 毫秒时间戳 / 秒时间戳(<1e12) / ISO 串 归一为 'YYYY-MM-DD'，非法返回 ''
 *   buildTimeline(annos)  排序+按天分组，返回 { entries, flat, total, spanStart, spanEnd }
 *   summarize(tl)         派生 { total, days, perType, topAuthor, earliest, latest }
 *   toMarkdown(tl)        按天分组的 Markdown 报告
 *   toHtml(tl)            带 data-page 跳页锚点的 HTML 片段
 */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  /** 把时间值归一为 UTC 日期键 'YYYY-MM-DD'；非法/缺省返回 ''。 */
  function dateKey(v) {
    if (v == null) return "";
    let d;
    if (v instanceof Date) d = v;
    else if (typeof v === "number") {
      if (!isFinite(v)) return "";
      d = new Date(v < 1e12 ? v * 1000 : v); // 秒时间戳(<1e12) → 毫秒
    } else if (typeof v === "string") {
      const t = Date.parse(v);
      if (isNaN(t)) return "";
      d = new Date(t);
    } else {
      return "";
    }
    if (isNaN(d.getTime())) return "";
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /** 取排序用时间戳（毫秒）；缺省/非法 → Infinity（沉到末尾）。 */
  function tsOf(a) {
    const c = a ? a.created : null;
    if (c == null) return Infinity;
    if (c instanceof Date) return c.getTime();
    if (typeof c === "number") {
      if (!isFinite(c)) return Infinity;
      return c < 1e12 ? c * 1000 : c;
    }
    if (typeof c === "string") {
      const t = Date.parse(c);
      return isNaN(t) ? Infinity : t;
    }
    return Infinity;
  }

  /** 归一单条批注，缺字段回落到安全默认。 */
  function normAnno(a) {
    a = a || {};
    return {
      id: a.id != null ? a.id : "",
      type: a.type || "未知",
      author: a.author || "未署名",
      page: typeof a.page === "number" && isFinite(a.page) ? a.page : 0,
      color: a.color || "",
      text: a.text || "",
      created: a.created != null ? a.created : null
    };
  }

  /** 构建时间线：升序排序 + 按天分组。 */
  function buildTimeline(annos) {
    if (!Array.isArray(annos)) {
      return { entries: [], flat: [], total: 0, spanStart: null, spanEnd: null };
    }
    const flat = annos.map(normAnno).sort((a, b) => tsOf(a) - tsOf(b));
    const entries = [];
    let cur = null;
    for (const a of flat) {
      const k = dateKey(a.created) || "未知日期";
      if (!cur || cur.dateKey !== k) {
        cur = { dateKey: k, items: [] };
        entries.push(cur);
      }
      cur.items.push(a);
    }
    const tsList = flat.map(tsOf).filter((t) => isFinite(t));
    return {
      entries,
      flat,
      total: flat.length,
      spanStart: tsList.length ? new Date(Math.min.apply(null, tsList)).toISOString() : null,
      spanEnd: tsList.length ? new Date(Math.max.apply(null, tsList)).toISOString() : null
    };
  }

  /** 派生统计：总数 / 天数 / 各类型计数 / 最活跃作者 / 起止时间。 */
  function summarize(tl) {
    if (!tl || !Array.isArray(tl.flat)) {
      return { total: 0, days: 0, perType: {}, topAuthor: null, earliest: null, latest: null };
    }
    const perType = {};
    const byAuthor = {};
    let topAuthor = null;
    let topN = -1;
    for (const a of tl.flat) {
      perType[a.type] = (perType[a.type] || 0) + 1;
      byAuthor[a.author] = (byAuthor[a.author] || 0) + 1;
      if (byAuthor[a.author] > topN) {
        topN = byAuthor[a.author];
        topAuthor = a.author;
      }
    }
    return {
      total: tl.total,
      days: tl.entries.length,
      perType,
      topAuthor,
      earliest: tl.spanStart,
      latest: tl.spanEnd
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /** 生成按天分组的 Markdown 报告。 */
  function toMarkdown(tl) {
    if (!tl || !tl.entries.length) return "# 批注时间线\n\n（暂无批注）\n";
    const lines = ["# 批注时间线", ""];
    for (const e of tl.entries) {
      lines.push(`## ${e.dateKey}（${e.items.length} 条）`);
      for (const a of e.items) {
        const page = a.page ? `第 ${a.page} 页` : "未定位页";
        const txt = a.text ? `：${String(a.text).slice(0, 80)}` : "";
        lines.push(`- [${a.type}] ${page} · ${a.author}${txt}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /** 生成带 data-page 跳页锚点的 HTML 片段。 */
  function toHtml(tl) {
    if (!tl || !tl.entries.length) return "<div class='tl-empty'>（暂无批注）</div>";
    const parts = [];
    for (const e of tl.entries) {
      parts.push(`<div class='tl-day'><h4>${escapeHtml(e.dateKey)}（${e.items.length}）</h4><ul>`);
      for (const a of e.items) {
        const page = a.page || 0;
        const txt = escapeHtml(a.text || "");
        parts.push(
          `<li data-page="${page}"><span class='tl-type'>[${escapeHtml(a.type)}]</span> 第 ${page} 页 · ${escapeHtml(a.author)}：${txt}</li>`
        );
      }
      parts.push("</ul></div>");
    }
    return parts.join("");
  }

  const Api = { dateKey, buildTimeline, summarize, toMarkdown, toHtml, _normAnno: normAnno, _tsOf: tsOf };
  OS.PdfAnnoTimeline = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
