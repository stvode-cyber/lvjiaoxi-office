/*
 * 绿角犀 Office · PDF 表单字段提取（OS.PdfFormFields）
 * 纯逻辑零依赖模块：从 PDF 原始字节解析 /AcroForm 字典 → /Fields（含 /Kids 递归），
 * 提取每个表单字段的名称 / 类型 / 当前值 / 默认值 / 选项 / 标志位(只读·必填…) / 所在页，
 * 用于「表单字段审计 / 数据填报核对 / 表单清单导出」。
 * 覆盖字段类型：文本框(/Tx) / 复选框·单选·按钮(/Btn) / 下拉·列表(/Ch) / 签名域(/Sig)。
 * 字面串按字节解析并兼容 UTF-16BE(<FEFF>)/UTF-8/Latin-1 解码（正确处理中文名/值）。
 * 纯解析、不修改文档；不依赖 pdf.js DOM，可在 node 单测。
 *
 * 关键约束：txt（bytesToString 生成的 latin1 串）与 bytes 是 1:1 索引映射。
 * 任意字段字典的「文本起始位置」与「字节切片起始」必须对齐，才能正确切片字面串字节。
 *
 * 暴露：
 *   parseFormFields(bytes)  主函数 → { hasForm, formCount, fields[], byType, hasSigField }
 *   summarize(res)          派生摘要
 *   toMarkdown(res, opts)   表单字段 Markdown 报告
 *   toHtml(res)             HTML 片段
 */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  let _txt = ""; // 当前解析的全局 txt（1:1 映射 bytes），供 extractField 解析 /Kids widget 用

  /** bytes → latin1 字符串，与 bytes 1:1 索引映射。 */
  function bytesToString(bytes) {
    if (!bytes) return "";
    let s = "";
    const n = bytes.length;
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i] & 0xff);
    return s;
  }

  /** 从 startIdx（指向 '<<'）开始做 << >> 平衡切分，返回最外层字典串。 */
  function sliceDict(txt, startIdx) {
    let depth = 0, i = startIdx;
    for (; i < txt.length; i++) {
      if (txt[i] === "<" && txt[i + 1] === "<") { depth++; i++; }
      else if (txt[i] === ">" && txt[i + 1] === ">") { depth--; i++; if (depth === 0) return txt.slice(startIdx, i + 1); }
    }
    return null;
  }

  /** 定位对象号 num 的字典，返回 { str, start }（start 为字典在全局 txt 中的字节起始，与 bytes 1:1）。
   *  用 (?<!\\d) 锚定对象号，避免数字前缀重叠误匹配（如 3 误命中 13、4 误命中 14）。 */
  function getObjDict(txt, num) {
    const m = new RegExp("(?<!\\d)" + num + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const lt = txt.indexOf("<<", m.index);
    if (lt < 0) return null;
    const str = sliceDict(txt, lt);
    if (!str) return null;
    return { str, start: lt };
  }

  function objDict(txt, num) { const o = getObjDict(txt, num); return o ? o.str : null; }

  /** 把字面串/十六进制串的原始字节解码为可读字符串（兼容 UTF-16BE / UTF-8 / Latin-1 + PDF 转义）。 */
  function decodeLiteralBytes(raw) {
    if (!raw || !raw.length) return "";
    if (raw.length >= 2 && raw[0] === 0xFE && raw[1] === 0xFF) {
      let s = "";
      for (let i = 2; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
      return s;
    }
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (b === 0x5C) {
        const n = raw[i + 1];
        if (n === 0x6E) { out.push(10); i++; }
        else if (n === 0x72) { out.push(13); i++; }
        else if (n === 0x74) { out.push(9); i++; }
        else if (n === 0x62) { out.push(8); i++; }
        else if (n === 0x66) { out.push(12); i++; }
        else if (n === 0x28) { out.push(0x28); i++; }
        else if (n === 0x29) { out.push(0x29); i++; }
        else if (n === 0x5C) { out.push(0x5C); i++; }
        else if (n >= 0x30 && n <= 0x37) {
          let val = n - 0x30, j = i + 2;
          if (raw[j] >= 0x30 && raw[j] <= 0x37) { val = val * 8 + (raw[j] - 0x30); j++; if (raw[j] >= 0x30 && raw[j] <= 0x37) { val = val * 8 + (raw[j] - 0x30); j++; } }
          out.push(val & 0xff); i = j - 1;
        } else { out.push(n); i++; }
      } else out.push(b);
    }
    const u8 = Uint8Array.from(out);
    try {
      const td = (typeof TextDecoder !== "undefined") ? new TextDecoder("utf-8", { fatal: false }) : null;
      if (td) return td.decode(u8);
    } catch (e) { /* fallthrough */ }
    let s = "";
    for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
    return s;
  }

  /** 在 blockTxt（与 blockBytes 1:1 对齐）内取 key 对应的字面串/十六进制串。 */
  function lit(blockTxt, blockBytes, key) {
    const re = new RegExp(key + "\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)");
    const m = re.exec(blockTxt);
    if (m) {
      const start = m.index + m[0].indexOf("(") + 1;
      const raw = blockBytes.subarray(start, start + m[1].length);
      return decodeLiteralBytes(raw);
    }
    const hx = new RegExp(key + "\\s*<([0-9A-Fa-f\\s]+)>").exec(blockTxt);
    if (hx) {
      const h = hx[1].replace(/\s/g, "");
      const arr = [];
      for (let i = 0; i + 1 < h.length; i += 2) arr.push(parseInt(h.substr(i, 2), 16));
      return decodeLiteralBytes(Uint8Array.from(arr));
    }
    return null;
  }

  /** 取名称（/Key /Name）。 */
  function name(blockTxt, key) {
    const m = new RegExp(key + "\\s*\\/([A-Za-z0-9._:#=-]+)").exec(blockTxt);
    return m ? m[1] : null;
  }

  /** 取 /V、/DV 等值的字符串或字符串数组。blockTxt/blockBytes 1:1 对齐。 */
  function valueOf(blockTxt, blockBytes, key) {
    const arrM = new RegExp(key + "\\s*\\[([\\s\\S]*?)\\]").exec(blockTxt);
    if (arrM) {
      const inner = arrM[1];
      const baseIdx = arrM.index + arrM[0].indexOf("[") + 1;
      const out = [];
      const reL = /\(((?:[^()\\]|\\.)*)\)/g; let mm;
      while ((mm = reL.exec(inner))) {
        const start = baseIdx + mm.index;
        const raw = blockBytes.subarray(start, start + mm[1].length);
        out.push(decodeLiteralBytes(raw));
      }
      const reN = /\/([A-Za-z0-9._:#=-]+)/g; let mn;
      while ((mn = reN.exec(inner))) out.push(mn[1]);
      return out.length ? out : null;
    }
    const l = lit(blockTxt, blockBytes, key);
    if (l !== null && l !== "") return l;
    const nm = name(blockTxt, key);
    if (nm !== null) return nm;
    return null;
  }

  /** 从 startIdx（指向 '['）开始做 [] 平衡切分，返回最外层数组串。 */
  function sliceArr(txt, startIdx) {
    let depth = 0, i = startIdx;
    for (; i < txt.length; i++) {
      if (txt[i] === "[") depth++;
      else if (txt[i] === "]") { depth--; if (depth === 0) return txt.slice(startIdx, i + 1); }
    }
    return null;
  }

  /** 解析 /Opt（/Ch 选项）：[ (a) (b) ] 或 [ [ (ex1) (lab1) ] [ (ex2) (lab2) ] ]。用 [] 平衡切分避免截断嵌套。 */
  function parseOptions(blockTxt) {
    const m = /\/Opt\s*\[/.exec(blockTxt);
    if (!m) return null;
    const bracketStart = m.index + m[0].indexOf("[");
    const arrStr = sliceArr(blockTxt, bracketStart);
    if (!arrStr) return null;
    const inner = arrStr.slice(1, -1);
    if (/\[\s*\(/.test(inner)) {
      const pairs = [];
      const rePair = /\[\s*\(((?:[^()\\]|\\.)*)\)\s*\(((?:[^()\\]|\\.)*)\)\s*\]/g; let pm;
      while ((pm = rePair.exec(inner))) pairs.push({ export: pm[1], label: pm[2] });
      if (pairs.length) return pairs;
    }
    const items = [];
    const reL = /\(((?:[^()\\]|\\.)*)\)/g; let mm;
    while ((mm = reL.exec(inner))) items.push({ label: mm[1] });
    return items.length ? items : null;
  }

  /** 扫描所有 /Type /Page 对象（排除 /Pages），按出现顺序返回对象号数组 → 页码映射。 */
  function collectPageObjNums(txt) {
    const nums = [];
    const re = /(\d+)\s+0\s+obj/g; let m;
    while ((m = re.exec(txt))) {
      const num = +m[1];
      if (nums.indexOf(num) >= 0) continue;
      const lt = txt.indexOf("<<", m.index);
      const dict = (lt >= 0) ? sliceDict(txt, lt) : null;
      if (dict && /\/Type\s*\/Page(?![s])/.test(dict)) nums.push(num);
    }
    return nums;
  }

  /** 标志位定义（按字段类型）。 */
  const FLAG_DEFS = {
    common: [
      { bit: 1, key: "readOnly", label: "只读" },
      { bit: 2, key: "required", label: "必填" },
      { bit: 3, key: "noExport", label: "不导出" }
    ],
    Btn: [
      { bit: 15, key: "noToggleOff", label: "单选不可取消" },
      { bit: 16, key: "radio", label: "单选按钮组" },
      { bit: 17, key: "pushbutton", label: "按钮" },
      { bit: 18, key: "radiosInUnison", label: "联合同步" }
    ],
    Tx: [
      { bit: 13, key: "multiline", label: "多行" },
      { bit: 14, key: "password", label: "密码框" },
      { bit: 21, key: "comb", label: "定长组合框" },
      { bit: 24, key: "richText", label: "富文本" }
    ],
    Ch: [
      { bit: 18, key: "combo", label: "下拉框" },
      { bit: 19, key: "edit", label: "可编辑" },
      { bit: 20, key: "sort", label: "排序" },
      { bit: 22, key: "multiSelect", label: "多选" },
      { bit: 23, key: "doNotSpellCheck", label: "不拼写检查" }
    ]
  };

  function flagItems(ft, Ff) {
    const u = (Ff == null) ? 0 : (Ff >>> 0);
    const defs = (FLAG_DEFS[ft] || []).concat(FLAG_DEFS.common);
    return defs.map(d => ({
      bit: d.bit, key: d.key, label: d.label,
      on: ((u & (1 << (d.bit - 1))) !== 0)
    }));
  }

  function typeLabel(ft, flags) {
    const f = {};
    (flags || []).forEach(i => { if (i.on) f[i.key] = true; });
    if (ft === "Btn") {
      if (f.pushbutton) return "按钮";
      if (f.radio) return "单选按钮";
      return "复选框";
    }
    if (ft === "Tx") return "文本框";
    if (ft === "Ch") return f.combo ? "下拉框" : "列表框";
    if (ft === "Sig") return "签名域";
    return "未知";
  }

  /** 提取单个 terminal 字段的元数据。dictStr 为字段字典串，dictStart 为其在全局 txt 的字节起始。 */
  function extractField(dictStr, dictStart, bytes, pages) {
    const ft = name(dictStr, "/FT");
    const isWidget = /\/Subtype\s*\/Widget/.test(dictStr);
    if (!ft && !isWidget) return null; // 分组节点由 walk 递归，不在此提取

    const dictBytes = bytes.subarray(dictStart, dictStart + dictStr.length);
    const fieldType = ft || (isWidget ? "Tx" : null);
    const FfM = /\/Ff\s+(-?\d+)/.exec(dictStr);
    const Ff = FfM ? +FfM[1] : null;
    const flags = fieldType ? flagItems(fieldType, Ff) : [];
    const value = valueOf(dictStr, dictBytes, "/V");
    const defVal = valueOf(dictStr, dictBytes, "/DV");
    const options = (fieldType === "Ch") ? parseOptions(dictStr) : null;

    // 所在页：自身 widget /P 或 /Kids widget /P（用全局 _txt 解析引用对象）
    let pageObj = null;
    const selfP = /\/P\s+(\d+)\s+0\s+R/.exec(dictStr);
    if (selfP) pageObj = +selfP[1];
    if (pageObj == null) {
      const kidsM = /\/Kids\s*\[([\s\S]*?)\]/.exec(dictStr);
      if (kidsM) {
        const refRe = /(\d+)\s+0\s+R/g; let km;
        while ((km = refRe.exec(kidsM[1]))) {
          const o = getObjDict(_txt, +km[1]);
          if (o) {
            const kd = o.str;
            const kp = /\/P\s+(\d+)\s+0\s+R/.exec(kd);
            if (kp) { pageObj = +kp[1]; break; }
          }
        }
      }
    }
    const page = (pageObj != null && pages.indexOf(pageObj) >= 0) ? (pages.indexOf(pageObj) + 1) : null;

    return {
      name: lit(dictStr, dictBytes, "/T") || name(dictStr, "/T") || "",
      altName: lit(dictStr, dictBytes, "/TU"),
      fieldType,
      typeLabel: typeLabel(fieldType, flags),
      flags,
      readOnly: flags.some(f => f.key === "readOnly" && f.on),
      required: flags.some(f => f.key === "required" && f.on),
      value,
      defaultValue: defVal,
      options,
      page,
      hasValue: value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)
    };
  }

  /** 递归展开 /Fields 与 /Kids（支持分组节点嵌套）。str/start 为字段字典串及其全局字节起始。 */
  function walk(str, start, out) {
    const isTerminal = /\/FT\s*\//.test(str) || /\/Subtype\s*\/Widget/.test(str);
    if (!isTerminal) {
      const kidsM = /\/Kids\s*\[([\s\S]*?)\]/.exec(str);
      if (kidsM) {
        const refRe = /(\d+)\s+0\s+R/g; let km;
        while ((km = refRe.exec(kidsM[1]))) {
          const o = getObjDict(_txt, +km[1]);
          if (o) walk(o.str, o.start, out);
        }
      }
      return;
    }
    const f = extractField(str, start, bytesGlobal, pagesGlobal);
    if (f) out.push(f);
  }

  let bytesGlobal = null, pagesGlobal = [];

  function parseFormFields(bytes) {
    _txt = bytesToString(bytes);
    const txt = _txt;
    bytesGlobal = bytes;
    pagesGlobal = collectPageObjNums(txt);

    const acroM = /\/AcroForm\s+(\d+)\s+0\s+R/.exec(txt);
    if (!acroM) return { hasForm: false, reason: "未发现 /AcroForm", formCount: 0, fields: [], byType: {}, hasSigField: false };

    const acro = getObjDict(txt, +acroM[1]);
    if (!acro) return { hasForm: true, detected: false, reason: "发现 /AcroForm 但未能解析字典", formCount: 0, fields: [], byType: {}, hasSigField: false };

    const fieldsM = /\/Fields\s*\[([\s\S]*?)\]/.exec(acro.str);
    if (!fieldsM) return { hasForm: true, detected: true, formCount: 0, fields: [], byType: {}, hasSigField: false };

    const fields = [];
    // 顶层引用型字段
    const refRe = /(\d+)\s+0\s+R/g; let m;
    while ((m = refRe.exec(fieldsM[1]))) {
      const o = getObjDict(txt, +m[1]);
      if (o) walk(o.str, o.start, fields);
    }
    // 顶层内联字段（<< ... >>），计算其在全局 txt 中的起始偏移
    const inlineRe = /<<([\s\S]*?)>>/g; let im;
    while ((im = inlineRe.exec(fieldsM[1]))) {
      const globalStart = acro.start + fieldsM.index + im.index;
      const inlineStr = "<<" + im[1] + ">>";
      walk(inlineStr, globalStart, fields);
    }

    const byType = {};
    let hasSigField = false;
    for (const f of fields) {
      byType[f.fieldType] = (byType[f.fieldType] || 0) + 1;
      if (f.fieldType === "Sig") hasSigField = true;
    }
    return { hasForm: true, detected: true, formCount: fields.length, fields, byType, hasSigField };
  }

  function summarize(res) {
    if (!res || !res.hasForm) return { hasForm: false, formCount: 0 };
    return {
      hasForm: true,
      formCount: res.formCount,
      byType: res.byType,
      hasSigField: res.hasSigField,
      readOnly: res.fields.filter(f => f.readOnly).length,
      required: res.fields.filter(f => f.required).length,
      filled: res.fields.filter(f => f.hasValue).length
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtVal(v) {
    if (v == null) return "—";
    if (Array.isArray(v)) return v.length ? v.join("、") : "—";
    return String(v);
  }

  function toMarkdown(res, opts) {
    opts = opts || {};
    if (!res || !res.hasForm) return "# PDF 表单字段提取\n\n（未发现表单 /AcroForm）\n";
    const lines = ["# " + (opts.title || "PDF 表单字段提取"), ""];
    lines.push(`- 字段总数：**${res.formCount}**` +
      (Object.keys(res.byType).length ? " ｜ 类型：" + Object.keys(res.byType).map(k => k + "×" + res.byType[k]).join("、") : "") +
      (res.hasSigField ? " ｜ 含签名域" : ""));
    const filled = res.fields.filter(f => f.hasValue).length;
    lines.push(`- 已填值：${filled}/${res.formCount} ｜ 必填：${res.fields.filter(f => f.required).length} ｜ 只读：${res.fields.filter(f => f.readOnly).length}`);
    lines.push("");
    res.fields.forEach((f, i) => {
      lines.push(`## 字段 ${i + 1} · ${f.name || "(未命名)"}`);
      lines.push(`- 类型：${f.typeLabel}${f.fieldType ? "（" + f.fieldType + "）" : ""}${f.page != null ? " ｜ 第 " + f.page + " 页" : ""}`);
      if (f.altName) lines.push(`- 提示 /TU：${f.altName}`);
      lines.push(`- 当前值：${fmtVal(f.value)}`);
      if (f.defaultValue != null) lines.push(`- 默认值：${fmtVal(f.defaultValue)}`);
      if (f.options && f.options.length) {
        const opts = f.options.map(o => o.export != null ? `${o.label}(=${o.export})` : o.label).join("、");
        lines.push(`- 选项：${opts}`);
      }
      const fl = f.flags.filter(x => x.on).map(x => x.label);
      if (fl.length) lines.push(`- 标志：${fl.join("、")}`);
      lines.push("");
    });
    return lines.join("\n");
  }

  function toHtml(res) {
    if (!res || !res.hasForm) return "<div class='ff-empty'>（未发现表单字段 /AcroForm）</div>";
    const rows = res.fields.map((f, i) =>
      `<div style="border:1px solid #eee;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:13px">` +
      `<div style="font-weight:600;margin-bottom:4px">字段 ${i + 1} · ${escapeHtml(f.name || "(未命名)")}` +
      `<span style="float:right;color:#888;font-weight:400">${escapeHtml(f.typeLabel)}</span></div>` +
      (f.page != null ? `<div style="color:#555">第 ${f.page} 页</div>` : `<div style="color:#999">页：—</div>`) +
      `<div style="color:#555">当前值：${escapeHtml(fmtVal(f.value))}</div>` +
      (f.options && f.options.length ? `<div style="color:#555">选项：${escapeHtml(f.options.map(o => o.export != null ? o.label + "(=" + o.export + ")" : o.label).join("、"))}</div>` : "") +
      (f.flags.some(x => x.on) ? `<div style="color:#555">标志：${escapeHtml(f.flags.filter(x => x.on).map(x => x.label).join("、"))}</div>` : "") +
      `</div>`
    ).join("");
    return `<div style="color:#666;font-size:12px;margin-bottom:6px">共 ${res.formCount} 个字段（已填 ${res.fields.filter(f => f.hasValue).length}）· 类型：${escapeHtml(Object.keys(res.byType).join("、") || "—")}</div>` + rows;
  }

  const Api = {
    bytesToString, sliceDict, getObjDict, objDict, decodeLiteralBytes, lit, name, valueOf,
    parseOptions, collectPageObjNums, flagItems, typeLabel, extractField,
    parseFormFields, summarize, toMarkdown, toHtml, _FLAG_DEFS: FLAG_DEFS
  };
  OS.PdfFormFields = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
