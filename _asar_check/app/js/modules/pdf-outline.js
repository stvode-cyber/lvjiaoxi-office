/* ============================================================
   绿角犀 Office · PDF 书签目录（Outline / TOC，纯逻辑，零依赖）
   ------------------------------------------------------------
   1) parseRawOutline(bytes)：直接扫描 PDF 原始字节还原书签树
      - 扫描 `N 0 obj ... endobj` 对象，按文档顺序建立「页对象号 → 页码」映射
      - 定位 /Type /Outlines 根节点，沿 /First（首个子项）/ /Next（同级下一项）
        / /First（子节点）递归重建层级
      - 页码取自 /Dest [N 0 R ...] 或 /A << /S /GoTo /D [N 0 R ...] >>
      - 标题支持字面串 (...)、十六进制串 <...>，含 UTF-16BE（FEFF 前缀）解码
   2) normalizeOutline(raw, pageNumByObj)：归一化 pdf.js `getOutline()` 结果
   3) flattenOutline / toMarkdown / toHtml / searchOutline：目录消费侧
   不依赖 pdf.js，可在 node 直跑单测。
   暴露：OS.PdfOutline
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // —— PDF 字符串解码 ——
  function parsePdfString(raw) {
    if (raw == null) return "";
    raw = String(raw).trim();
    if (!raw) return "";
    if (raw[0] === "(") {
      let out = "", i = 1;
      while (i < raw.length) {
        const c = raw[i];
        if (c === "\\") {
          const nx = raw[i + 1];
          if (nx === "n") out += "\n";
          else if (nx === "r") out += "\r";
          else if (nx === "t") out += "\t";
          else if (nx === "b") out += "\b";
          else if (nx === "f") out += "\f";
          else if (nx === "(") out += "(";
          else if (nx === ")") out += ")";
          else if (nx === "\\") out += "\\";
          else if (nx && /[0-7]/.test(nx)) {
            const oct = raw.substr(i + 1, 3).match(/^[0-7]{1,3}/);
            if (oct) { out += String.fromCharCode(parseInt(oct[0], 8)); i += oct[0].length; }
          }
          i += 2;
        } else if (c === ")") { break; }
        else { out += c; i++; }
      }
      return out;
    }
    if (raw[0] === "<") {
      const hex = raw.slice(1).replace(/>.*$/, "").replace(/[^0-9A-Fa-f]/g, "");
      const bytes = [];
      for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16) || 0);
      // UTF-16BE（BOM FEFF）优先，否则按单字节 latin1
      if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
        let s = "";
        for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return s;
      }
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
    return raw;
  }

  // 取字典中 /Key 对应的串（字面串或十六进制串）
  function dictString(dict, key) {
    const re = new RegExp("/" + key + "\\s*(?=[(<])");
    const m = re.exec(dict);
    if (!m) return "";
    const start = m.index + m[0].length;
    if (dict[start] === "(") {
      let depth = 0, i = start;
      for (; i < dict.length; i++) {
        if (dict[i] === "\\") { i++; continue; }
        if (dict[i] === "(") depth++;
        else if (dict[i] === ")") { depth--; if (depth === 0) { i++; break; } }
      }
      return parsePdfString(dict.slice(start, i));
    }
    const end = dict.indexOf(">", start);
    return parsePdfString(dict.slice(start, end === -1 ? dict.length : end + 1));
  }

  // 取 /Key N 0 R 引用中的对象号
  function dictRef(dict, key) {
    const m = new RegExp("/" + key + "\\s+(\\d+)\\s+\\d+\\s+R").exec(dict);
    return m ? parseInt(m[1], 10) : null;
  }

  // 从 /A << ... >> 子字典中取 /D 数组的首个页引用
  function actionDestPage(dict, pageNumByObj) {
    const aIdx = dict.indexOf("/A");
    if (aIdx === -1) return null;
    let aStart = -1, depth = 0, i = aIdx;
    for (; i < dict.length; i++) {
      if (dict[i] === "<" && dict[i + 1] === "<") { if (aStart === -1) aStart = i; depth++; i++; }
      else if (dict[i] === ">" && dict[i + 1] === ">") { depth--; i++; if (depth === 0) break; }
    }
    if (aStart === -1) return null;
    const aDict = dict.slice(aStart, Math.min(i + 1, dict.length));
    const m = /\/D\s*\[\s*(\d+)\s+\d+\s+R/.exec(aDict);
    if (!m) return null;
    const num = parseInt(m[1], 10);
    return pageNumByObj && pageNumByObj[num] != null ? pageNumByObj[num] : null;
  }

  // 解析书签项的目标页码
  function destPageOf(dict, pageNumByObj) {
    let m = /\/Dest\s*\[\s*(\d+)\s+\d+\s+R/.exec(dict);
    if (!m) return actionDestPage(dict, pageNumByObj);
    const num = parseInt(m[1], 10);
    return pageNumByObj && pageNumByObj[num] != null ? pageNumByObj[num] : null;
  }

  function toText(bytes) {
    if (typeof bytes === "string") return bytes;
    if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
      const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
      let s = "";
      for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i] & 0xff);
      return s;
    }
    if (bytes && bytes.buffer) return toText(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return "";
  }

  // 扫描 PDF 中所有 `N 0 obj ... endobj`，返回 [{num, dict}]
  function scanObjects(txt) {
    const out = [];
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const num = parseInt(m[1], 10);
      const start = m.index + m[0].length;
      let end = txt.indexOf("endobj", start);
      if (end === -1) end = txt.length;
      const body = txt.slice(start, end);
      const ds = body.indexOf("<<");
      if (ds === -1) continue;
      let depth = 0, i = ds;
      for (; i < body.length; i++) {
        if (body[i] === "<" && body[i + 1] === "<") { depth++; i++; }
        else if (body[i] === ">" && body[i + 1] === ">") { depth--; i++; if (depth === 0) break; }
      }
      const dict = body.slice(ds, Math.min(i + 1, body.length));
      out.push({ num, dict });
    }
    return out;
  }

  // 从原始字节还原书签树：Array<{title, page, items}>
  function parseRawOutline(bytes) {
    const txt = toText(bytes);
    if (!txt) return [];
    const objs = scanObjects(txt);
    if (!objs.length) return [];

    // 页对象号 → 页码（按文档出现顺序，1-based）
    const pageNumByObj = {};
    let pi = 0;
    objs.forEach(o => {
      if (/\/Type\s*\/Page(?!s)/.test(o.dict)) { pi++; pageNumByObj[o.num] = pi; }
    });

    const byNum = {};
    objs.forEach(o => { if (byNum[o.num] == null) byNum[o.num] = o; });

    const root = objs.find(o => /\/Type\s*\/Outlines/.test(o.dict));
    if (!root) return [];
    const first = dictRef(root.dict, "First");
    if (first == null) return [];

    // 沿 /First（子节点）/ /Next（同级下一项）递归重建
    function build(startNum, seen) {
      const items = [];
      let num = startNum;
      let guard = 0;
      while (num != null && byNum[num] && !seen[num] && guard++ < 5000) {
        seen[num] = 1;
        const o = byNum[num];
        const node = {
          title: dictString(o.dict, "Title") || "",
          page: destPageOf(o.dict, pageNumByObj),
          items: []
        };
        const childFirst = dictRef(o.dict, "First");
        if (childFirst != null) node.items = build(childFirst, seen);
        items.push(node);
        num = dictRef(o.dict, "Next");
      }
      return items;
    }
    return build(first, {});
  }

  // 归一化 pdf.js getOutline() 结果（dest 可为页码/数组/命名目标）
  function normalizeOutline(raw, pageNumByObj) {
    const walk = (arr) => {
      if (!Array.isArray(arr)) return [];
      return arr.map(it => {
        it = it || {};
        let page = null;
        if (typeof it.page === "number") page = it.page;
        else if (typeof it.dest === "number") page = it.dest;
        else if (Array.isArray(it.dest) && it.dest.length) {
          const d0 = it.dest[0];
          if (typeof d0 === "number") page = d0;
          else if (d0 && typeof d0.num === "number") page = (pageNumByObj && pageNumByObj[d0.num] != null) ? pageNumByObj[d0.num] : null;
        }
        return { title: String(it.title == null ? "" : it.title), page, items: walk(it.items) };
      });
    };
    return walk(raw);
  }

  // 扁平化（供列表渲染）：[{title, page, level}]，level 从 1 开始
  function flattenOutline(tree, level) {
    const out = [];
    (Array.isArray(tree) ? tree : []).forEach(n => {
      const lv = level || 1;
      out.push({ title: n.title, page: n.page, level: lv });
      if (n.items && n.items.length) out.push.apply(out, flattenOutline(n.items, lv + 1));
    });
    return out;
  }

  // Markdown 目录（缩进两空格一级，附页码）
  function toMarkdown(tree, level) {
    const lv = level || 1;
    const pad = new Array(Math.max(0, lv - 1)).fill("  ").join("");
    return (Array.isArray(tree) ? tree : []).map(n => {
      const line = pad + "- " + (n.title || "(无标题)") + (n.page != null ? "  (p." + n.page + ")" : "");
      const kids = (n.items && n.items.length) ? ("\n" + toMarkdown(n.items, lv + 1)) : "";
      return line + kids;
    }).join("\n");
  }

  // HTML 目录（嵌套 ul/li，data-page 供点击跳转）
  function toHtml(tree) {
    if (!Array.isArray(tree) || !tree.length) return "";
    return "<ul style='margin:0;padding-left:18px;list-style:none'>" + tree.map(n => {
      const jump = n.page != null ? " data-page='" + n.page + "' style='cursor:pointer;color:#1a73e8'" : " style='color:#888'";
      const label = String(n.title || "(无标题)").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const kids = (n.items && n.items.length) ? toHtml(n.items) : "";
      return "<li style='margin:2px 0'><span" + jump + ">" + label + (n.page != null ? " <small style='color:#999'>p." + n.page + "</small>" : "") + "</span>" + kids + "</li>";
    }).join("") + "</ul>";
  }

  // 搜索目录（保留命中节点的祖先链）
  function searchOutline(tree, q) {
    const s = String(q == null ? "" : q).trim().toLowerCase();
    if (!s) return Array.isArray(tree) ? tree : [];
    const walk = (arr) => {
      const out = [];
      (Array.isArray(arr) ? arr : []).forEach(n => {
        const kids = walk(n.items);
        const selfHit = String(n.title || "").toLowerCase().indexOf(s) !== -1;
        if (selfHit) out.push({ title: n.title, page: n.page, items: n.items || [] });
        else if (kids.length) out.push({ title: n.title, page: n.page, items: kids });
      });
      return out;
    };
    return walk(tree);
  }

  const Api = {
    parseRawOutline, normalizeOutline, flattenOutline, toMarkdown, toHtml, searchOutline,
    _parsePdfString: parsePdfString, _dictString: dictString, _dictRef: dictRef, _scanObjects: scanObjects
  };
  OS.PdfOutline = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
