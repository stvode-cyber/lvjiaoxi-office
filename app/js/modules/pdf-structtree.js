/* ============================================================
   绿角犀 Office · PDF 文档结构树（StructTreeRoot / tagged PDF 逻辑结构，纯逻辑，零依赖）
   ------------------------------------------------------------
   1) parseRawStructTree(bytes)：直接扫描 PDF 原始字节还原逻辑结构树
      - 扫描 `N 0 obj ... endobj` 对象，按文档顺序建立「页对象号 → 页码」映射
      - 定位 /Type /StructTreeRoot 根，沿 /K 数组中的 StructElem 间接引用递归建树
      - 每个结构元素：/S 语义类型（H1/P/Table/Sect…）、/T 标题（字面串或 UTF-16BE 十六进制）、
        /Pg 关联页对象号（→页码）、/K 子结构元素（可嵌套）
      - /K 数组中的整数（MCID）与 MCR 字典视为叶子内容引用，不展开
   2) flattenStruct / toMarkdown / toHtml / searchStruct：结构消费侧（与 Outline 同范式）
   不依赖 pdf.js，可在 node 直跑单测。
   暴露：OS.PdfStructTree
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // —— PDF 字符串解码（字面串 / 十六进制串，含 UTF-16BE）——
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

  // 取字典中 /Key 对应的串（字面串或十六进制串），带名字边界（避免 /T 命中 /Title）
  function dictString(dict, key) {
    const re = new RegExp("/" + key + "(?![A-Za-z0-9])\\s*(?=[(<])");
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

  // 取 /Key N 0 R 引用中的对象号（对象号，非代数）
  function dictRef(dict, key) {
    const m = new RegExp("/" + key + "(?![A-Za-z0-9])\\s+(\\d+)\\s+\\d+\\s+R").exec(dict);
    return m ? parseInt(m[1], 10) : null;
  }

  // 取 /Key 后的名字标记（如 /S /H1），返回不带 / 的名字
  function dictName(dict, key) {
    const m = new RegExp("/" + key + "(?![A-Za-z0-9])\\s+(/[A-Za-z0-9]+)").exec(dict);
    return m ? m[1].slice(1) : "";
  }

  // 取 /Key 后的 [ ... ] 数组内容（平衡括号）；非数组时退化为单个引用
  function extractArrayAfter(dict, key) {
    const re = new RegExp("/" + key + "(?![A-Za-z0-9])\\s*");
    const m = re.exec(dict);
    if (!m) return "";
    const open = dict.indexOf("[", m.index);
    if (open === -1) {
      const rm = /\d+\s+\d+\s+R/.exec(dict.slice(m.index));
      return rm ? rm[0] : "";
    }
    let depth = 0, i = open;
    for (; i < dict.length; i++) {
      if (dict[i] === "[") depth++;
      else if (dict[i] === "]") { depth--; if (depth === 0) break; }
    }
    return dict.slice(open, i + 1);
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

  // 从原始字节还原结构树：Array<{id,type,title,page,children,depth}>
  function parseRawStructTree(bytes) {
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

    const root = objs.find(o => /\/Type\s*\/StructTreeRoot/.test(o.dict));
    if (!root) return [];

    function pageOf(dict) {
      const ref = dictRef(dict, "Pg");
      if (ref == null) return null;
      return pageNumByObj[ref] != null ? pageNumByObj[ref] : null;
    }

    function build(num, seen, depth) {
      if (seen[num]) return null;
      const o = byNum[num];
      if (!o) return null;
      seen[num] = 1;
      const type = dictName(o.dict, "S") || "Unknown";
      const title = dictString(o.dict, "T") || dictString(o.dict, "Alt") || "";
      const node = {
        id: num,
        type,
        title: title || type,
        page: pageOf(o.dict),
        children: [],
        depth: depth || 0
      };
      const kArr = extractArrayAfter(o.dict, "K");
      if (kArr) {
        const refs = kArr.match(/\d+\s+\d+\s+R/g) || [];
        refs.forEach(r => {
          const m = /(\d+)\s+\d+\s+R/.exec(r);
          if (!m) return;
          const childNum = parseInt(m[1], 10);
          const co = byNum[childNum];
          if (co && /\/Type\s*\/StructElem/.test(co.dict)) {
            const child = build(childNum, seen, (depth || 0) + 1);
            if (child) node.children.push(child);
          }
        });
      }
      return node;
    }

    const kArr = extractArrayAfter(root.dict, "K");
    const refs = kArr.match(/\d+\s+\d+\s+R/g) || [];
    const tree = [];
    const seen = {};
    refs.forEach(r => {
      const m = /(\d+)\s+\d+\s+R/.exec(r);
      if (!m) return;
      const num = parseInt(m[1], 10);
      const o = byNum[num];
      if (o && /\/Type\s*\/StructElem/.test(o.dict)) {
        const n = build(num, seen, 0);
        if (n) tree.push(n);
      }
    });
    return tree;
  }

  // 扁平化（供列表渲染）：[{type,title,page,level}]，level 从 0 开始
  function flattenStruct(tree, level) {
    const out = [];
    (Array.isArray(tree) ? tree : []).forEach(n => {
      const lv = level || 0;
      out.push({ type: n.type, title: n.title, page: n.page, level: lv });
      if (n.children && n.children.length) out.push.apply(out, flattenStruct(n.children, lv + 1));
    });
    return out;
  }

  // Markdown 结构大纲（缩进两空格一级，附页码）
  function toMarkdown(tree, level) {
    const lv = level || 0;
    const pad = new Array(lv).fill("  ").join("");
    return (Array.isArray(tree) ? tree : []).map(n => {
      const label = (n.type ? n.type + ": " : "") + (n.title || "(未命名)");
      const line = pad + "- " + label + (n.page != null ? "  (p." + n.page + ")" : "");
      const kids = (n.children && n.children.length) ? ("\n" + toMarkdown(n.children, lv + 1)) : "";
      return line + kids;
    }).join("\n");
  }

  // HTML 嵌套 ul/li，data-page 供点击跳转
  function toHtml(tree) {
    if (!Array.isArray(tree) || !tree.length) return "";
    return "<ul style='margin:0;padding-left:18px;list-style:none'>" + tree.map(n => {
      const jump = n.page != null ? " data-page='" + n.page + "' style='cursor:pointer;color:#1a73e8'" : " style='color:#888'";
      const label = String((n.type ? n.type + " · " : "") + (n.title || "(未命名)")).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      const kids = (n.children && n.children.length) ? toHtml(n.children) : "";
      return "<li style='margin:2px 0'><span" + jump + ">" + label + (n.page != null ? " <small style='color:#999'>p." + n.page + "</small>" : "") + "</span>" + kids + "</li>";
    }).join("") + "</ul>";
  }

  // 搜索结构（保留命中节点的祖先链）；匹配标题或语义类型
  function searchStruct(tree, q) {
    const s = String(q == null ? "" : q).trim().toLowerCase();
    if (!s) return Array.isArray(tree) ? tree : [];
    const walk = (arr) => {
      const out = [];
      (Array.isArray(arr) ? arr : []).forEach(n => {
        const kids = walk(n.children);
        const selfHit = String(n.title || "").toLowerCase().indexOf(s) !== -1 || String(n.type || "").toLowerCase().indexOf(s) !== -1;
        if (selfHit) out.push({ type: n.type, title: n.title, page: n.page, children: n.children || [] });
        else if (kids.length) out.push({ type: n.type, title: n.title, page: n.page, children: kids });
      });
      return out;
    };
    return walk(tree);
  }

  const Api = {
    parseRawStructTree, flattenStruct, toMarkdown, toHtml, searchStruct,
    _parsePdfString: parsePdfString, _dictString: dictString, _dictRef: dictRef, _dictName: dictName,
    _extractArrayAfter: extractArrayAfter, _scanObjects: scanObjects
  };
  OS.PdfStructTree = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
