/* ============================================================
   绿角犀 Office · 批注审阅清单导出（纯逻辑，零依赖）
   ------------------------------------------------------------
   把批注集合导出为 Markdown / CSV 审阅清单，便于归档与协同。
   暴露：OS.PdfAnnoSummary = { toMarkdown, toCsv, summarizeByPage,
          TYPE_LABELS }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  const TYPE_LABELS = {
    highlight: "高亮", pen: "画笔", note: "文字批注", rect: "矩形",
    sign: "签名", textfield: "文本框", checkbox: "复选框",
    freetext: "自由文本", stamp: "图章", link: "链接"
  };
  function label(t) { return TYPE_LABELS[t] || (t || "未知"); }

  function escCsv(v) {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function visibleOf(a) { return a && a.visible == null ? true : !!a.visible; }

  // 按页汇总：{ page: count }
  function summarizeByPage(annos) {
    const m = {};
    if (!Array.isArray(annos)) return m;
    annos.forEach(a => { const p = a.page || 0; m[p] = (m[p] || 0) + 1; });
    return m;
  }

  // 导出 Markdown 清单
  // opts: { title, groupByPage=true }
  function toMarkdown(annos, opts) {
    opts = opts || {};
    const list = Array.isArray(annos) ? annos : [];
    const title = opts.title || "批注审阅清单";
    const lines = ["# " + title, "", "共 " + list.length + " 条批注", ""];
    if (!list.length) { lines.push("_（无批注）_"); return lines.join("\n"); }
    if (opts.groupByPage === false) {
      list.forEach(a => lines.push("- [" + label(a.type) + "] 第" + (a.page || "?") + "页 " + (a.text || a.uri || "") + (a.author ? "（" + a.author + "）" : "")));
      return lines.join("\n");
    }
    const pages = {};
    list.forEach(a => { (pages[a.page] = pages[a.page] || []).push(a); });
    Object.keys(pages).map(Number).sort((x, y) => x - y).forEach(p => {
      lines.push("## 第 " + p + " 页（" + pages[p].length + " 条）");
      pages[p].forEach(a => lines.push("- [" + label(a.type) + "] " + (a.text || a.uri || "") + (a.author ? "（" + a.author + "）" : "")));
      lines.push("");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // 导出 CSV（含表头）
  function toCsv(annos) {
    const list = Array.isArray(annos) ? annos : [];
    const head = ["id", "type", "typeLabel", "page", "author", "text", "layer", "visible"];
    const rows = [head.join(",")];
    list.forEach(a => rows.push([
      a.id, a.type, label(a.type), a.page, a.author, a.text || a.uri || "", a.layer || "", visibleOf(a) ? "1" : "0"
    ].map(escCsv).join(",")));
    return rows.join("\n");
  }

  const Api = { TYPE_LABELS: TYPE_LABELS, summarizeByPage: summarizeByPage, toMarkdown: toMarkdown, toCsv: toCsv };
  OS.PdfAnnoSummary = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
