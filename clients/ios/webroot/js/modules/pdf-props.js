/* ============================================================
   绿角犀 Office · PDF 文档属性解析（纯逻辑，零依赖）
   ------------------------------------------------------------
   从 PDF 原始字节/文本中扫描 Info 字典，提取标题/作者/主题/
   创建者/生产者/创建时间/修改时间等元数据。不依赖 pdf.js，
   适合 Node 下单元测试与「文档属性」面板复用。
   暴露：OS.PdfProps = { parseInfo, formatPdfDate }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  function toText(bytes) {
    if (typeof bytes === "string") return bytes;
    if (bytes instanceof Uint8Array || bytes instanceof Buffer) {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xff);
      return s;
    }
    if (bytes && bytes.buffer) return toText(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return "";
  }

  // 解析 PDF 字面串 (...) 与十六进制串 <...>
  function parsePdfString(raw) {
    if (raw == null) return "";
    raw = raw.trim();
    if (raw[0] === "(") {
      let out = "", depth = 1, i = 1;
      while (i < raw.length && depth > 0) {
        const c = raw[i];
        if (c === "\\") { // 转义：\n \r \t \( \) \\ \ddd
          const nx = raw[i + 1];
          if (nx === "n") out += "\n";
          else if (nx === "r") out += "\r";
          else if (nx === "t") out += "\t";
          else if (nx === "(") out += "(";
          else if (nx === ")") out += ")";
          else if (nx === "\\") out += "\\";
          else if (/[0-9]/.test(nx)) {
            let oct = raw.substr(i + 1, 3).match(/^[0-7]{1,3}/);
            if (oct) { out += String.fromCharCode(parseInt(oct[0], 8)); i += oct[0].length; }
          }
          i += 2;
        } else if (c === "(") { depth++; out += c; i++; }
        else if (c === ")") { depth--; if (depth === 0) break; out += c; i++; }
        else { out += c; i++; }
      }
      return out;
    }
    if (raw[0] === "<") {
      const hex = raw.slice(1).replace(/>.*$/, "").trim();
      let out = "";
      for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) || 0);
      return out;
    }
    return raw;
  }

  // 在字典文本中提取 /Key (value) 或 /Key <value>
  function dictValue(dictText, key) {
    const re = new RegExp("/" + key + "\\s+(\\(|<|/|[^\\s/<>]+)");
    const m = re.exec(dictText);
    if (!m) return undefined;
    if (m[1] === "/") { // /Name 形式
      const nm = new RegExp("/" + key + "\\s+/([^\\s/<>]+)").exec(dictText);
      return nm ? nm[1] : undefined;
    }
    if (m[1] === "(" || m[1] === "<") {
      // 取完整串（到匹配的右括号/右尖括号）
      const start = dictText.indexOf(m[1], m.index);
      if (m[1] === "(") {
        let depth = 0, i = start;
        for (; i < dictText.length; i++) {
          if (dictText[i] === "(") depth++;
          else if (dictText[i] === ")") { depth--; if (depth === 0) { i++; break; } }
        }
        return parsePdfString(dictText.slice(start, i));
      } else {
        const end = dictText.indexOf(">", start);
        return parsePdfString(dictText.slice(start, end + 1));
      }
    }
    return m[1];
  }

  // PDF 日期 D:YYYYMMDDHHmmSSOHH'mm' → 可读串
  function formatPdfDate(d) {
    if (!d) return "";
    const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(d);
    if (!m) return d;
    const pad = n => (n || "00");
    let s = "" + m[1];
    if (m[2]) s += "-" + m[2];
    if (m[3]) s += "-" + m[3];
    if (m[4]) s += " " + m[4];
    if (m[5]) s += ":" + m[5];
    return s;
  }

  const KEYS = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"];

  // 解析 PDF 字节/文本 → 元数据对象（仅含命中的键）
  function parseInfo(bytes) {
    const txt = toText(bytes);
    if (!txt) return {};
    // 收集所有 << ... >> 块，挑出含已知键的作为 Info
    const blocks = [];
    let i = 0;
    while ((i = txt.indexOf("<<", i)) !== -1) {
      let depth = 0, j = i;
      for (; j < txt.length; j++) {
        if (txt[j] === "<" && txt[j + 1] === "<") { depth++; j++; }
        else if (txt[j] === ">" && txt[j + 1] === ">") { depth--; j++; if (depth === 0) break; }
      }
      if (depth === 0 && j < txt.length) blocks.push(txt.slice(i, j + 1));
      i = j + 1;
    }
    let dict = null;
    for (const b of blocks) {
      if (KEYS.some(k => new RegExp("/" + k + "\\s").test(b))) { dict = b; break; }
    }
    if (!dict) return {};
    const out = {};
    KEYS.forEach(k => {
      const v = dictValue(dict, k);
      if (v != null && v !== "") out[k.toLowerCase()] = (k.indexOf("Date") !== -1) ? formatPdfDate(v) : v;
    });
    return out;
  }

  const Api = { parseInfo: parseInfo, formatPdfDate: formatPdfDate };
  OS.PdfProps = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
