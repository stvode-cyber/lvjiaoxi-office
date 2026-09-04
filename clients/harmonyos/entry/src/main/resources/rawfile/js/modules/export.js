/* ============================================================
   绿角犀 Office · 通用导出
   toCSV：RFC4180 CSV 序列化（纯逻辑，可单测）
   csv： 以 UTF-8 BOM 触发下载（兼容 Excel 中文）
   ============================================================ */
(function (global) {
  "use strict";

  // 纯函数：行/列 → CSV 文本（RFC4180）
  function toCSV(headers, rows) {
    const esc = v => {
      const s = String(v == null ? "" : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const headerLine = (headers || []).map(esc).join(",");
    const bodyLines = (rows || []).map(r => r.map(esc).join(","));
    return [headerLine].concat(bodyLines).join("\r\n");
  }

  // 触发浏览器下载（数据行来自深拷贝数组，避免持有 DOM）
  function csv(filename, headers, rows) {
    const text = "\ufeff" + toCSV(headers, rows);
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename || "export.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // 业务行 → 二维数组（按列导出）
  function pick(rows, cols) {
    return rows.map(r => cols.map(c => c.pick(r)));
  }

  global.OS = global.OS || {};
  global.OS.export = { toCSV, csv, pick };
})(window);