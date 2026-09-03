/* ============================================================
   绿角犀 Office · PDF 文档历史 / 增量更新审计（零依赖，字节级）
   ------------------------------------------------------------
   AR：PDF 采用增量更新（incremental update）保存：每次修改/保存会把
   新对象追加到文件尾，再加一段自己的 xref + trailer（/Prev 指向前一版
   的 xref 偏移）+ startxref + %%EOF。本模块只读还原这份"修改历史"。

   诊断项（info/warn 二级，不修改文件）：
     1  version-count   沿 trailer /Prev 链回溯出的版本（保存次数）
     2  eof-count       文件中的 %%EOF 标记数
     3  startxref-count 文件中的 startxref 声明数
     4  count-mismatch  %%EOF / startxref / xref 段数不一致（可能截断/损坏） warn
     5  prev-break      /Prev 链回溯到的版本数 < 文件内 startxref 数（链断裂） warn
     6  linearized      文档经过线性化（Web 优化）
     7  xref-stream     使用了交叉引用流（/Type /XRef，PDF 1.5+）

   判定 verdict：single（单版本）/ multi（多版本，链完整）/ broken（链断裂或计数异常）。
   浏览器与 Node 双导出（同步接口，不依赖解压）。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // ---------------- 字节 / 字符串 ----------------
  function toStr(u8) {
    if (typeof u8 === "string") return u8;
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  // 平衡切分第一个 <<...>>（含定界符；闭合处 slice 至 i+1 保住末位 >）
  function firstBalancedDict(seg) {
    const open = seg.indexOf("<<");
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < seg.length; i++) {
      if (seg[i] === "<" && seg[i + 1] === "<") { depth++; i++; }
      else if (seg[i] === ">" && seg[i + 1] === ">") { depth--; i++; if (depth === 0) return seg.slice(open, i + 1); }
    }
    return null;
  }

  // 从 xref 偏移处读取该版 trailer 字典（优先经典 xref 表后的 trailer 关键字；
  // 否则按 xref 流对象（/Type /XRef）的字典取）
  function readTrailerAt(str, offset) {
    if (offset < 0 || offset >= str.length) return null;
    const seg = str.slice(offset, offset + 8192);
    let dict = null, viaStream = false;

    const ti = seg.indexOf("trailer");
    if (ti >= 0) {
      dict = firstBalancedDict(seg.slice(ti));
    } else {
      const xr = seg.indexOf("/XRef");
      if (xr >= 0) {
        const ob = seg.lastIndexOf("<<", xr);
        if (ob >= 0) { dict = firstBalancedDict(seg.slice(ob)); viaStream = true; }
      }
    }
    if (!dict) return null;

    const size = parseInt((/\/Size\s+(\d+)/.exec(dict) || [])[1], 10) || 0;
    const rootRef = parseInt((/\/Root\s+(\d+)\s+\d+\s+R/.exec(dict) || [])[1], 10) || 0;
    const infoRef = parseInt((/\/Info\s+(\d+)\s+\d+\s+R/.exec(dict) || [])[1], 10) || 0;
    const prevM = /\/Prev\s+(\d+)/.exec(dict);
    const prev = prevM ? parseInt(prevM[1], 10) : null;
    return { size, rootRef, infoRef, prev, viaStream };
  }

  // ---------------- 主解析 ----------------
  function parse(input) {
    const bytes = input instanceof Uint8Array ? input : (input ? new Uint8Array(input) : new Uint8Array(0));
    const str = toStr(bytes);
    const checks = [];

    function add(id, level, title, detail, count) {
      checks.push({ id, level, title, detail: detail || "", count: count == null ? 1 : count });
    }

    // 1. 所有 startxref 声明（值 = 各自 xref 的偏移）
    const startxrefs = [];
    const sxRe = /startxref\s+(\d+)/g;
    let m;
    while ((m = sxRe.exec(str)) !== null) startxrefs.push({ index: m.index, value: parseInt(m[1], 10) });

    // 2. %%EOF 计数
    const eofCount = (str.match(/%%EOF/g) || []).length;

    // 3. xref 表段计数
    const xrefSectionCount = (str.match(/(^|[\s\r\n>])xref\s*[\r\n]+\s*\d+\s+\d+/g) || []).length;

    // 4. xref stream 检测
    const hasXrefStream = /\/Type\s*\/?\s*XRef\b/.test(str);

    // 5. 线性化
    const linearized = /\/Linearized\b/.test(str);

    // 6. 沿 /Prev 链回溯（从最后一个 startxref 开始，链是新→旧，收集后倒序）
    const chain = [];
    const visited = new Set();
    let cur = startxrefs.length ? startxrefs[startxrefs.length - 1].value : 0;
    while (cur > 0 && cur < str.length && !visited.has(cur)) {
      visited.add(cur);
      const t = readTrailerAt(str, cur);
      if (!t) break;
      chain.push({ offset: cur, size: t.size, rootRef: t.rootRef, infoRef: t.infoRef, prev: t.prev, viaStream: t.viaStream });
      if (t.prev && t.prev > 0 && t.prev < cur) cur = t.prev;
      else break;
    }
    chain.reverse();
    const versions = chain.map((c, i) => ({
      version: i + 1,
      xrefOffset: c.offset,
      size: c.size,
      rootRef: c.rootRef,
      infoRef: c.infoRef,
      hasPrev: c.prev != null,
      prev: c.prev,
      viaStream: !!c.viaStream
    }));

    const versionCount = versions.length;
    const chainBroken = startxrefs.length > 0 && versionCount < startxrefs.length;

    // checks
    add("version-count", "info", "版本（保存次数）", "沿 trailer /Prev 链回溯到 " + versionCount + " 个版本" + (versionCount === 1 ? "（单次保存，无增量更新）" : ""), versionCount);
    if (startxrefs.length > 1) add("startxref-count", "info", "startxref 声明", "文件含 " + startxrefs.length + " 处 startxref，指向各版本交叉引用表", startxrefs.length);
    if (eofCount > 1) add("eof-count", "info", "%%EOF 标记", "文件含 " + eofCount + " 处 %%EOF，与增量保存次数相关", eofCount);

    if (chainBroken) add("prev-break", "warn", "/Prev 链断裂", "文件内 startxref " + startxrefs.length + " 处，但 /Prev 链只回溯到 " + versionCount + " 版，中间存在断裂（可能被截断或非标准工具编辑）", startxrefs.length - versionCount);

    const mismatch = !(eofCount === startxrefs.length && startxrefs.length === (xrefSectionCount + (hasXrefStream ? 1 : 0)));
    if (eofCount !== startxrefs.length) add("count-mismatch", "warn", "计数不一致", "%%EOF 标记 " + eofCount + " 处 ≠ startxref " + startxrefs.length + " 处，文件可能被截断或损坏", Math.abs(eofCount - startxrefs.length));

    if (linearized) add("linearized", "info", "线性化（Web 优化）", "文档含 /Linearized，经过线性化处理以便边下载边阅读", 1);
    if (hasXrefStream) add("xref-stream", "info", "交叉引用流", "使用了 /Type /XRef 交叉引用流（PDF 1.5+ 格式）", 1);

    checks.sort((a, b) => (a.level === "warn" && b.level !== "warn" ? -1 : a.level === b.level ? 0 : 1));
    const warnings = checks.filter(c => c.level === "warn").reduce((s, c) => s + c.count, 0);

    let verdict = "single";
    if (versionCount > 1) verdict = "multi";
    if (chainBroken || warnings) verdict = "broken";

    return {
      versions: versions,
      summary: {
        versionCount: versionCount,
        eofCount: eofCount,
        startxrefCount: startxrefs.length,
        xrefSectionCount: xrefSectionCount,
        hasXrefStream: hasXrefStream,
        linearized: linearized,
        chainBroken: chainBroken,
        verdict: verdict
      },
      checks: checks
    };
  }

  // ---------------- 导出 ----------------
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const VERDICT_TEXT = {
    single: "单版本（仅保存一次）",
    multi: "多版本（增量更新，链完整）",
    broken: "版本链异常（断裂或计数不一致）"
  };
  const LEVEL_TEXT = { warn: "警告", info: "提示" };

  function toMarkdown(res, opts) {
    const s = res.summary;
    const lines = [];
    lines.push("# " + ((opts && opts.title) || "PDF 文档历史报告"));
    lines.push("");
    lines.push("- **结论**：" + VERDICT_TEXT[s.verdict] + "（共 " + s.versionCount + " 版）");
    lines.push("- **保存历史**：" + s.versionCount + " 次 · **%%EOF**：" + s.eofCount + " · **startxref**：" + s.startxrefCount + " · **xref 段**：" + s.xrefSectionCount);
    lines.push("- **格式**：xref " + (s.hasXrefStream ? "流（PDF 1.5+）" : "表") + " · 线性化 " + (s.linearized ? "✓" : "✗"));
    lines.push("");
    if (s.versionCount) {
      lines.push("| 版本 | xref 偏移 | /Size | /Root | /Info | 格式 |");
      lines.push("|---|---|---|---|---|---|");
      for (const v of res.versions) {
        lines.push("| v" + v.version + " | " + v.xrefOffset + " | " + (v.size || "—") + " | " + (v.rootRef || "—") + " | " + (v.infoRef || "—") + " | " + (v.viaStream ? "xref 流" : "xref 表") + " |");
      }
      lines.push("");
    }
    for (const c of res.checks) {
      lines.push("- [" + LEVEL_TEXT[c.level] + "] " + c.title + " — " + c.detail);
    }
    lines.push("");
    lines.push("> 本报告由绿角犀 Office 文档历史审计生成（只读，不修改文件）。");
    return lines.join("\n");
  }

  function toHtml(res) {
    const s = res.summary;
    const color = { warn: "#8a6d00", info: "#57606a" };
    let html = "<div style='font:12px/1.6 sans-serif'>";
    html += "<div style='display:flex;gap:10px;margin-bottom:8px'>" +
      "<span>版本 <b>" + s.versionCount + "</b></span>" +
      "<span>%%EOF <b>" + s.eofCount + "</b></span>" +
      "<span>startxref <b>" + s.startxrefCount + "</b></span>" +
      "<span>xref " + (s.hasXrefStream ? "流" : "表") + "</span>" +
      "<span>线性化 " + (s.linearized ? "✓" : "✗") + "</span></div>";
    html += "<div style='padding:6px 10px;margin-bottom:8px;border-radius:6px;font-weight:bold;color:" + (s.verdict === "broken" ? "#d1242f" : "#1a7f37") + ";background:" + (s.verdict === "broken" ? "#fff0f0" : "#f0fff4") + "'>" + escapeHtml(VERDICT_TEXT[s.verdict]) + "</div>";
    if (s.versionCount) {
      html += "<table style='border-collapse:collapse;width:100%;margin-bottom:8px'><tr style='text-align:left;color:#555'>" +
        "<th style='padding:4px 8px;border-bottom:1px solid #ddd'>版本</th><th>xref 偏移</th><th>/Size</th><th>/Root</th><th>/Info</th><th>格式</th></tr>";
      for (const v of res.versions) {
        html += "<tr><td style='padding:3px 8px;border-bottom:1px solid #eee'>v" + v.version + "</td><td>" + v.xrefOffset + "</td><td>" + (v.size || "—") + "</td><td>" + (v.rootRef || "—") + "</td><td>" + (v.infoRef || "—") + "</td><td>" + (v.viaStream ? "xref 流" : "xref 表") + "</td></tr>";
      }
      html += "</table>";
    }
    for (const c of res.checks) {
      html += "<div style='display:flex;gap:8px;padding:4px 8px;border-bottom:1px solid #eee;align-items:baseline'>" +
        "<span style='flex:0 0 34px;font-weight:bold;color:" + color[c.level] + "'>" + LEVEL_TEXT[c.level] + "</span>" +
        "<span style='flex:0 0 150px;font-weight:bold'>" + escapeHtml(c.title) + "</span>" +
        "<span style='flex:1;color:#555'>" + escapeHtml(c.detail) + "</span></div>";
    }
    html += "</div>";
    return html;
  }

  const Api = { parse: parse, toMarkdown: toMarkdown, toHtml: toHtml };
  OS.PdfHistory = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
