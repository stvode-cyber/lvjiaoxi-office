/*
 * 绿角犀 Office · PDF 链接/URI 提取（OS.PdfLinks）
 * 纯逻辑零依赖模块：从 PDF 原始字节提取所有外部 URI 链接与内部跳转（GoTo），
 * 用于「外链审计 / 文档导航盘点」。来源包括：
 *   ① 页面标注（/Subtype /Link，带 /P 页对象号）
 *   ② 文档大纲（Outline /Title + /A /URI 动作）
 *   ③ 独立 /URI action（兜底扫描，不依赖对象边界）
 * 兼容字面串 (/URI (http://...)) 与 UTF-16BE 十六进制串 (/URI <FEFF...>)。
 *
 * 暴露：
 *   decodeHexUtf16(hex)      把 <FEFF....> 十六进制 UTF-16BE 解码为字符串
 *   extractLinks(bytes)      主函数 → { links, total, uriCount, gotoCount, externalCount, byPage }
 *   summarize(res)           派生统计 { total, uriCount, gotoCount, externalCount, pagesWithLinks, topPage }
 *   toMarkdown(res, opts)    外链审计 Markdown 报告（按来源分组）
 *   toHtml(res)              HTML 片段（外链可点击）
 */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  /** 把 bytes 转 latin1 风格字符串，便于正则扫描（非 ASCII 字节保留高字节，不影响 ASCII 模式匹配）。 */
  function bytesToString(bytes) {
    if (!bytes) return "";
    let s = "";
    const n = bytes.length;
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i] & 0xff);
    return s;
  }

  /** 解码 UTF-16BE 十六进制串（可带 < > 与空白）；剥离 FEFF BOM；返回字符串或 ""。 */
  function decodeHexUtf16(raw) {
    if (!raw) return "";
    let h = String(raw).replace(/[<>\s]/g, "");
    if (h.length % 2 !== 0) return "";
    if (h.slice(0, 4).toUpperCase() === "FEFF") h = h.slice(4);
    const units = [];
    for (let i = 0; i + 4 <= h.length; i += 4) {
      const cu = parseInt(h.slice(i, i + 4), 16);
      if (isNaN(cu)) return "";
      units.push(cu);
    }
    let s = "";
    for (let i = 0; i < units.length; i++) {
      const cu = units[i];
      if (cu >= 0xd800 && cu <= 0xdbff && i + 1 < units.length) {
        const lo = units[i + 1];
        if (lo >= 0xdc00 && lo <= 0xdfff) { s += String.fromCharCode(cu, lo); i++; continue; }
      }
      s += String.fromCharCode(cu);
    }
    return s;
  }

  /** 从 txt[start] === '(' 开始做括号平衡扫描，返回字面串内容（含转义解析）与结束索引。 */
  function matchLiteral(txt, start) {
    let i = start + 1, depth = 1, out = "";
    while (i < txt.length && depth > 0) {
      const c = txt[i];
      if (c === "\\") {
        const n = txt[i + 1];
        if (n === "n") out += "\n";
        else if (n === "r") out += "\r";
        else if (n === "t") out += "\t";
        else if (n === "b") out += "\b";
        else if (n === "f") out += "\f";
        else out += (n != null ? n : "");
        i += 2; continue;
      }
      if (c === "(") { depth++; out += "("; i++; continue; }
      if (c === ")") { depth--; if (depth === 0) break; out += ")"; i++; continue; }
      out += c; i++;
    }
    return { end: i, content: out };
  }

  /** 扫描所有 /URI (...) 字面串，返回内容数组（已做括号平衡 + 转义解析）。 */
  function extractUriLiterals(txt) {
    const re = /\/URI\s*\(/g; let m; const out = [];
    while ((m = re.exec(txt))) {
      const open = m.index + m[0].length - 1; // '(' 的位置
      const lit = matchLiteral(txt, open);
      if (lit.content) out.push(lit.content);
    }
    return out;
  }

  /** 扫描所有 /URI <hex> 十六进制串，解码后返回数组。 */
  function extractUriHex(txt) {
    const re = /\/URI\s*<([0-9A-Fa-f\s]+)>/g; let m; const out = [];
    while ((m = re.exec(txt))) {
      const s = decodeHexUtf16(m[1]);
      if (s) out.push(s);
    }
    return out;
  }

  /** 主函数：从 PDF 原始字节提取链接。返回结构化结果（按 kind+target 去重，标注/大纲优先于兜底）。 */
  function extractLinks(bytes) {
    const txt = bytesToString(bytes);
    const links = [];
    const seen = new Set();

    function pushLink(link) {
      const key = link.kind + "|" + link.target;
      if (seen.has(key)) return;
      seen.add(key);
      links.push(link);
    }

    // ① 标注中的 /Subtype /Link（带页对象号）
    const objRe = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
    let m;
    while ((m = objRe.exec(txt))) {
      const objNum = +m[1];
      const body = m[2];
      if (!/\/Subtype\s*\/Link/.test(body)) continue;
      let page = null;
      const pM = /\/(?:P|Pg)\s+(\d+)\s+0\s+R/.exec(body);
      if (pM) page = +pM[1];
      const aM = /\/A\s*<<([\s\S]*?)>>/.exec(body);
      const act = aM ? aM[1] : body;
      const uriLit = /\/URI\s*\(/.exec(act);
      const uriHexM = /\/URI\s*<([0-9A-Fa-f\s]+)>/.exec(act);
      if (uriLit || uriHexM) {
        const target = uriLit ? matchLiteral(act, uriLit.index + uriLit[0].length - 1).content : decodeHexUtf16(uriHexM[1]);
        if (target) pushLink({ kind: "uri", target, source: "annotation", page, objNum });
        continue;
      }
      if (/\/S\s*\/GoTo/.test(act)) {
        const dM = /\/D\s*\[?\s*(\d+)/.exec(act) || /\/D\s*\(([^)]*)\)/.exec(act) || /\/D\s*\/(\w+)/.exec(act);
        const target = dM ? dM[1] : "";
        pushLink({ kind: "goto", target, source: "annotation", page, objNum });
      }
    }

    // ② 大纲（Outline）/Title + /URI
    const titleLit = /\/Title\s*\(([^)]*)\)[\s\S]{0,600}?\/URI\s*\(/.exec(txt);
    if (titleLit) {
      const re = /\/Title\s*\(([^)]*)\)[\s\S]{0,600}?\/URI\s*\(/g; let tm;
      while ((tm = re.exec(txt))) {
        const open = tm.index + tm[0].length - 1;
        const target = matchLiteral(txt, open).content;
        if (target) pushLink({ kind: "uri", target, source: "outline", page: null, objNum: null });
      }
    }
    const titleHex = /\/Title\s*\(([^)]*)\)[\s\S]{0,600}?\/URI\s*<([0-9A-Fa-f\s]+)>/g;
    while ((m = titleHex.exec(txt))) {
      const target = decodeHexUtf16(m[2]);
      if (target) pushLink({ kind: "uri", target, source: "outline", page: null, objNum: null });
    }

    // ③ 兜底：独立 /URI action（不依赖对象边界，source=action）
    extractUriLiterals(txt).forEach(t => { if (t) pushLink({ kind: "uri", target: t, source: "action", page: null, objNum: null }); });
    extractUriHex(txt).forEach(t => { if (t) pushLink({ kind: "uri", target: t, source: "action", page: null, objNum: null }); });

    // 统计
    const byPage = {};
    let uriCount = 0, gotoCount = 0, externalCount = 0;
    for (const l of links) {
      if (l.kind === "uri") {
        uriCount++;
        if (/^https?:\/\//i.test(l.target)) externalCount++;
      } else gotoCount++;
      if (l.page != null) byPage[l.page] = (byPage[l.page] || 0) + 1;
    }
    return { links, total: links.length, uriCount, gotoCount, externalCount, byPage };
  }

  /** 派生统计。 */
  function summarize(res) {
    res = res || { links: [], total: 0, uriCount: 0, gotoCount: 0, externalCount: 0, byPage: {} };
    let topPage = null, topN = -1;
    for (const p in res.byPage) {
      if (res.byPage[p] > topN) { topN = res.byPage[p]; topPage = +p; }
    }
    return {
      total: res.total, uriCount: res.uriCount, gotoCount: res.gotoCount,
      externalCount: res.externalCount, pagesWithLinks: Object.keys(res.byPage).length, topPage
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  const SRC_LABEL = { annotation: "标注", outline: "大纲", action: "动作" };
  const KIND_LABEL = { uri: "外链", goto: "跳转" };

  /** 生成分组 Markdown 报告。 */
  function toMarkdown(res, opts) {
    opts = opts || {};
    if (!res || !res.total) return "# PDF 链接审计\n\n（未检测到链接）\n";
    const lines = ["# " + (opts.title || "PDF 链接审计"), ""];
    const sum = summarize(res);
    lines.push(`- 总计：${sum.total} 条（外链 ${sum.uriCount} / 内部跳转 ${sum.gotoCount}；其中 http(s) 外链 ${sum.externalCount}）`);
    lines.push(`- 涉及页面：${sum.pagesWithLinks} 页` + (sum.topPage != null ? `；链接最多页：第 ${sum.topPage} 页` : ""));
    lines.push("");
    const groups = { annotation: [], outline: [], action: [], goto: [] };
    for (const l of res.links) {
      if (l.kind === "goto") groups.goto.push(l);
      else groups[l.source] = groups[l.source] || [], groups[l.source].push(l);
    }
    const order = ["annotation", "outline", "action", "goto"];
    for (const g of order) {
      const arr = groups[g] || [];
      if (!arr.length) continue;
      lines.push(`## ${g === "goto" ? "内部跳转（GoTo）" : (SRC_LABEL[g] || g) + "链接"}（${arr.length}）`);
      for (const l of arr) {
        const page = l.page != null ? ` · 第 ${l.page} 页` : "";
        lines.push(`- [${KIND_LABEL[l.kind]}] ${l.target}${page}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /** 生成 HTML 片段（外链可点击）。 */
  function toHtml(res) {
    if (!res || !res.total) return "<div class='lk-empty'>（未检测到链接）</div>";
    const parts = [];
    for (const l of res.links) {
      const badge = l.kind === "uri" ? (SRC_LABEL[l.source] || "链接") : "跳转";
      const page = l.page != null ? `第 ${l.page} 页` : "—";
      const body = l.kind === "uri"
        ? `<a href="${escapeHtml(l.target)}" target="_blank" rel="noopener" style="color:#2563eb;word-break:break-all">${escapeHtml(l.target)}</a>`
        : `<span style="word-break:break-all">${escapeHtml(l.target)}</span>`;
      parts.push(
        `<div style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;display:flex;gap:8px;align-items:baseline">` +
        `<span style="flex:none;background:#eef;color:#345;padding:1px 6px;border-radius:4px;font-size:11px">${escapeHtml(badge)}</span>` +
        `<span style="flex:none;color:#888;width:54px">${escapeHtml(page)}</span>` +
        `<span style="flex:1">${body}</span></div>`
      );
    }
    return parts.join("");
  }

  const Api = { decodeHexUtf16, extractLinks, summarize, toMarkdown, toHtml, _bytesToString: bytesToString, _matchLiteral: matchLiteral, _extractUriLiterals: extractUriLiterals };
  OS.PdfLinks = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
