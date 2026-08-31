/* ============================================================
   绿角犀 Office · PDF 批注统计面板（纯逻辑，零依赖）
   ------------------------------------------------------------
   把批注集合做多维度聚合统计（类型/作者/颜色/日期/月份/页面/图层），
   并给出文本量、最活跃页、最活跃作者、时间跨度等指标，
   可导出 Markdown / CSV 统计报告。
   暴露：OS.PdfAnnoStats = { TYPE_LABELS, typeLabel, dateKey, monthKey,
          aggregate, rank, toMarkdown, toCsv }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  const TYPE_LABELS = {
    highlight: "高亮", pen: "画笔", note: "文字批注", rect: "矩形",
    sign: "签名", textfield: "文本框", checkbox: "复选框",
    freetext: "自由文本", stamp: "图章", link: "链接",
    unknown: "未知"
  };
  function typeLabel(t) { return TYPE_LABELS[t] || (t || "未知"); }

  function isVisible(a) { return a && a.visible == null ? true : !!a.visible; }
  function textOf(a) {
    if (!a) return "";
    if (a.text != null) return String(a.text);
    if (a.uri != null) return String(a.uri);
    return "";
  }

  // —— 时间键：兼容 Date / 毫秒时间戳 / 秒时间戳 / ISO 字符串 ——
  // 10 位及以下视为「秒」，其余视为「毫秒」
  function dateKey(v) {
    if (v == null) return "";
    let d;
    if (v instanceof Date) d = v;
    else if (typeof v === "number" && isFinite(v)) d = new Date(v < 1e12 ? v * 1000 : v);
    else {
      const n = Number(v);
      if (n > 0 && isFinite(n)) d = new Date(n < 1e12 ? n * 1000 : n);
      else d = new Date(String(v));
    }
    if (!d || isNaN(d.getTime())) return "";
    const p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function monthKey(v) { const k = dateKey(v); return k ? k.slice(0, 7) : ""; }

  function bump(m, k) { if (k === "" || k == null) return; m[k] = (m[k] || 0) + 1; }

  // —— 主聚合 ——
  function aggregate(annos) {
    const list = Array.isArray(annos) ? annos : [];
    const s = {
      total: list.length,
      visibleCount: 0, hiddenCount: 0,
      byType: {}, byAuthor: {}, byColor: {},
      byDate: {}, byMonth: {}, byPage: {}, byLayer: {},
      textTotal: 0, textAvg: 0,
      busiestPage: null, topAuthor: null,
      firstDate: "", lastDate: ""
    };
    const dates = [];
    list.forEach(function (a) {
      if (isVisible(a)) s.visibleCount += 1; else s.hiddenCount += 1;
      bump(s.byType, a.type || "unknown");
      bump(s.byAuthor, a.author || "未署名");
      bump(s.byColor, a.color || "默认");
      bump(s.byLayer, a.layer || "default");
      bump(s.byPage, String(a.page == null ? 0 : a.page));
      const dk = dateKey(a.created);
      if (dk) { bump(s.byDate, dk); bump(s.byMonth, dk.slice(0, 7)); dates.push(dk); }
      s.textTotal += textOf(a).length;
    });
    s.textAvg = list.length ? Math.round((s.textTotal / list.length) * 100) / 100 : 0;
    const bp = rank(s.byPage, 1)[0];
    s.busiestPage = bp ? { page: bp.key, count: bp.count } : null;
    const ta = rank(s.byAuthor, 1)[0];
    s.topAuthor = ta ? { author: ta.key, count: ta.count } : null;
    if (dates.length) {
      dates.sort();
      s.firstDate = dates[0];
      s.lastDate = dates[dates.length - 1];
    }
    return s;
  }

  // —— 排序 + 占比：{k:n} → [{key,label,count,pct}]（count 降序，同值按键自然序）——
  function rank(obj, limit) {
    if (!obj || typeof obj !== "object") return [];
    const keys = Object.keys(obj);
    if (!keys.length) return [];
    let total = 0;
    keys.forEach(function (k) { total += obj[k]; });
    const arr = keys.map(function (k) {
      return {
        key: k,
        label: typeLabel(k),
        count: obj[k],
        pct: total ? Math.round((obj[k] / total) * 1000) / 10 : 0
      };
    });
    arr.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
    });
    return limit ? arr.slice(0, limit) : arr;
  }

  function escCsv(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function section(L, name, obj, useLabel) {
    const r = rank(obj);
    if (!r.length) return;
    L.push("## " + name + "（" + r.length + " 项）");
    r.forEach(function (x) {
      L.push("- " + (useLabel ? x.label : x.key) + "：" + x.count + " 条（" + x.pct + "%）");
    });
    L.push("");
  }

  // —— 导出 Markdown 统计报告 ——
  function toMarkdown(s, opts) {
    opts = opts || {};
    if (!s) return "";
    const L = ["# " + (opts.title || "批注统计报告"), ""];
    L.push("共 " + s.total + " 条批注（显示 " + s.visibleCount + " / 隐藏 " + s.hiddenCount + "）");
    L.push("");
    if (!s.total) { L.push("_（无批注）_"); return L.join("\n"); }
    L.push("- 文本总量：" + s.textTotal + " 字，平均 " + s.textAvg + " 字/条");
    if (s.firstDate) L.push("- 时间跨度：" + s.firstDate + " ~ " + s.lastDate);
    if (s.busiestPage) L.push("- 批注最多页：第 " + s.busiestPage.page + " 页（" + s.busiestPage.count + " 条）");
    if (s.topAuthor) L.push("- 最活跃作者：" + s.topAuthor.author + "（" + s.topAuthor.count + " 条）");
    L.push("");
    section(L, "按类型", s.byType, true);
    section(L, "按作者", s.byAuthor, false);
    section(L, "按颜色", s.byColor, false);
    section(L, "按日期", s.byDate, false);
    section(L, "按页面", s.byPage, false);
    section(L, "按图层", s.byLayer, false);
    return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // —— 导出 CSV（长表：维度 / 键 / 数量 / 占比）——
  function toCsv(s) {
    if (!s) return "";
    const rows = [["维度", "键", "数量", "占比%"].join(",")];
    const dims = [
      ["类型", s.byType, true], ["作者", s.byAuthor, false],
      ["颜色", s.byColor, false], ["日期", s.byDate, false],
      ["月份", s.byMonth, false], ["页面", s.byPage, false],
      ["图层", s.byLayer, false]
    ];
    dims.forEach(function (d) {
      rank(d[1]).forEach(function (x) {
        rows.push([d[0], escCsv(d[2] ? x.label : x.key), x.count, x.pct].join(","));
      });
    });
    return rows.join("\n");
  }

  const Api = {
    TYPE_LABELS: TYPE_LABELS, typeLabel: typeLabel,
    dateKey: dateKey, monthKey: monthKey,
    aggregate: aggregate, rank: rank,
    toMarkdown: toMarkdown, toCsv: toCsv
  };
  OS.PdfAnnoStats = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
