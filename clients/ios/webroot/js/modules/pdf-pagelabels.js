/* ============================================================
   绿角犀 Office · PDF 页码标签（PageLabels）解析与导航（纯逻辑，可单测、不依赖 pdf.js）
   用途：
   1) parseRawPageLabels(bytes)  —— 从 PDF 原始字节解析 /PageLabels 数字树
   2) buildLabels(numPages, leaves) —— 生成每页人类可读标签（i / ii / 1 / A-3 / B …）
   3) labelToPage / pageToLabel   —— 标签 ↔ 物理页码(1-based) 互查
   4) toRoman / toBijectiveAlpha  —— 罗马数字 / 字母序列转换（导出备用）
   5) toMarkdown                  —— 导出标签清单
   样式 S：D=十进制(默认) / R=大写罗马 / r=小写罗马 / A=大写字母 / a=小写字母
   前缀 P：字面串 (xxx) 或十六进制 <FEFF...>（UTF-16BE，支持中文前缀）
   起始 St：该区间第一页的数字值（默认 1）
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // —— 字节 → latin1 字符串（纯逻辑，不依赖 TextDecoder，Node/浏览器通用）——
  function bytesToStr(bytes) {
    if (!bytes) return "";
    let s = "";
    const n = bytes.length;
    // 分块避免超长字符串拼接的性能问题
    const CH = 8192;
    for (let i = 0; i < n; i += CH) {
      let part = "";
      const end = Math.min(i + CH, n);
      for (let j = i; j < end; j++) part += String.fromCharCode(bytes[j] & 0xff);
      s += part;
    }
    return s;
  }

  // —— 平衡截取：从 startIdx(指向 open 字符) 起，按 open/close 配对截取子串（含两端）——
  function extractBalanced(txt, startIdx, open, close) {
    if (startIdx < 0 || txt[startIdx] !== open) return null;
    let depth = 0;
    let i = startIdx;
    for (; i < txt.length; i++) {
      const c = txt[i];
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    return txt.slice(startIdx, i);
  }

  // —— 取对象字典：定位 "num 0 obj" 后第一个 << ，平衡截取 ——
  function getObjDict(txt, num) {
    const re = new RegExp(num + "\\s+0\\s+obj\\s*<<");
    const m = re.exec(txt);
    if (!m) return null;
    const openIdx = txt.indexOf("<<", m.index);
    if (openIdx < 0) return null;
    return extractBalanced(txt, openIdx, "<", ">");
  }

  // —— 定位 /PageLabels 字典：支持「间接引用N 0 R」与「内联 << >>」两种形态 ——
  function getPageLabelsDict(txt) {
    const m = /\/PageLabels\b/.exec(txt);
    if (!m) return null;
    let i = m.index + "/PageLabels".length;
    while (i < txt.length && /\s/.test(txt[i])) i++;
    // 内联形态：<< ... >>
    if (txt[i] === "<" && txt[i + 1] === "<") {
      return extractBalanced(txt, i, "<", ">");
    }
    // 间接引用形态：PageLabels 12 0 R
    const ref = /(\d+)\s+0\s+R/.exec(txt.slice(i, i + 40));
    if (ref) {
      const dict = getObjDict(txt, parseInt(ref[1], 10));
      if (dict) return dict;
    }
    return null;
  }

  // —— 解析前缀 P：（字面串）或 <十六进制 UTF-16BE> ——
  function parsePrefix(dictStr) {
    // 字面串
    const lit = /\/P\s*\(((?:[^()\\]|\\.)*)\)/.exec(dictStr);
    if (lit) {
      return lit[1]
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
    }
    // 十六进制串（UTF-16BE，常见于中文前缀）
    const hex = /\/P\s*<([0-9A-Fa-f\s]+)>/.exec(dictStr);
    if (hex) {
      const h = hex[1].replace(/\s+/g, "");
      // 去掉 UTF-16BE BOM FEFF（若存在）
      let body = h;
      if (body.slice(0, 4).toUpperCase() === "FEFF") body = body.slice(4);
      let out = "";
      for (let k = 0; k + 3 < body.length; k += 4) {
        const code = parseInt(body.substr(k, 4), 16);
        if (!isNaN(code)) out += String.fromCharCode(code);
      }
      return out;
    }
    return "";
  }

  // —— 解析单个叶子字典：{ start, style, prefix, first } ——
  function parseLeaf(startStr, dictStr) {
    const start = parseInt(startStr, 10) || 0;
    let style = "D";
    const sM = /\/S\s*\/([RDAr])/.exec(dictStr);
    if (sM) style = sM[1];
    const stM = /\/St\s+(\d+)/.exec(dictStr);
    const first = stM ? parseInt(stM[1], 10) : 1;
    return { start, style, prefix: parsePrefix(dictStr), first };
  }

  // —— 解析 /Nums 数组，返回叶子列表 ——
  function parseNums(arrStr) {
    const leaves = [];
    const re = /(\d+)\s*(<<[^]*?>>)/g;
    let m;
    while ((m = re.exec(arrStr))) {
      const leaf = parseLeaf(m[1], m[2]);
      if (leaf) leaves.push(leaf);
    }
    return leaves;
  }

  // 主入口①：从原始字节解析 PageLabels 叶子列表
  function parseRawPageLabels(bytes) {
    const txt = bytesToStr(bytes);
    if (!txt) return [];
    const dict = getPageLabelsDict(txt);
    if (!dict) return [];
    const numsM = /\/Nums\s*\[/.exec(dict);
    if (!numsM) return [];
    const arrStart = numsM.index + numsM[0].length - 1; // 指向 '['
    const arr = extractBalanced(dict, arrStart, "[", "]");
    if (!arr) return [];
    const leaves = parseNums(arr);
    leaves.sort((a, b) => a.start - b.start);
    return leaves;
  }

  // —— 罗马数字转换 ——
  function toRoman(n, upper) {
    if (!n || n < 1 || n > 3999) return "";
    const map = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
      [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
      [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
    ];
    let s = "";
    for (const [val, sym] of map) {
      while (n >= val) { s += sym; n -= val; }
    }
    return upper ? s : s.toLowerCase();
  }

  // —— 双射字母序列（A=1, Z=26, AA=27 …）——
  function toBijectiveAlpha(n, upper) {
    if (!n || n < 1) return "";
    const base = (upper ? "A" : "a").charCodeAt(0);
    let s = "";
    while (n > 0) {
      n -= 1;
      s = String.fromCharCode(base + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  function styleToStr(style, num) {
    switch (style) {
      case "R": return toRoman(num, true);
      case "r": return toRoman(num, false);
      case "A": return toBijectiveAlpha(num, true);
      case "a": return toBijectiveAlpha(num, false);
      case "D":
      default: return String(num);
    }
  }

  // 主入口②：生成每页标签数组（长度 = numPages，索引 0 对应第 1 页）
  function buildLabels(numPages, leaves) {
    const N = numPages > 0 ? numPages : 0;
    if (N === 0) return [];
    const out = new Array(N);
    if (!leaves || !leaves.length) {
      for (let i = 0; i < N; i++) out[i] = String(i + 1);
      return out;
    }
    for (let p = 0; p < N; p++) {
      // 找 start ≤ p 的最大叶子
      let leaf = leaves[0];
      for (let k = 0; k < leaves.length; k++) {
        if (leaves[k].start <= p) leaf = leaves[k];
        else break;
      }
      // 物理页早于第一个区间起点：退化为十进制页码（PDF 规范下该页无标签，给可读默认）
      if (p < leaves[0].start) {
        out[p] = String(p + 1);
        continue;
      }
      const num = leaf.first + (p - leaf.start);
      out[p] = (leaf.prefix || "") + styleToStr(leaf.style, num);
    }
    return out;
  }

  // 主入口③：标签(串) → 物理页码(1-based)；找不到返回 -1（先精确，后忽略大小写/前缀）
  function labelToPage(labels, query) {
    if (!Array.isArray(labels) || !query) return -1;
    const q = String(query).trim();
    if (!q) return -1;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === q) return i + 1;
    }
    const ql = q.toLowerCase();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i].toLowerCase() === ql) return i + 1;
    }
    // 容错：去掉前缀字母仅比较数字部分（如 "Pre-3" 搜 "3"）
    const qn = q.replace(/[^0-9]/g, "");
    if (qn) {
      for (let i = 0; i < labels.length; i++) {
        const ln = labels[i].replace(/[^0-9]/g, "");
        if (ln === qn) return i + 1;
      }
    }
    return -1;
  }

  // 主入口④：物理页码(1-based) → 标签
  function pageToLabel(labels, page) {
    if (!Array.isArray(labels)) return "";
    const i = (page || 1) - 1;
    return (i >= 0 && i < labels.length) ? labels[i] : "";
  }

  // 主入口⑤：导出 Markdown 清单
  function toMarkdown(labels, opts) {
    const title = (opts && opts.title) || "PDF 页码标签";
    const rows = ["| 物理页 | 标签 |", "| --- | --- |"];
    if (Array.isArray(labels)) {
      labels.forEach((lab, i) => rows.push("| " + (i + 1) + " | " + (lab || "") + " |"));
    }
    return "# " + title + "\n\n" + rows.join("\n") + "\n";
  }

  const Api = {
    parseRawPageLabels: parseRawPageLabels,
    buildLabels: buildLabels,
    labelToPage: labelToPage,
    pageToLabel: pageToLabel,
    toRoman: toRoman,
    toBijectiveAlpha: toBijectiveAlpha,
    toMarkdown: toMarkdown
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Api;
  else OS.PdfPageLabels = Api;
})(typeof window !== "undefined" ? window : globalThis);
