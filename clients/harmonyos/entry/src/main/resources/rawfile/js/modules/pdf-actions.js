/*
 * 绿角犀 Office · PDF 动作/JavaScript 安全审计（OS.PdfActions）
 * 纯逻辑零依赖模块：从 PDF 原始字节解析文档级自动动作与全文档动作对象：
 *   - /OpenAction（打开文档自动执行：动作引用 / 内联动作 / 目标数组）
 *   - /AA 附加动作（Catalog / 页面 / 批注字典，事件 O/E/X/U/D/Po/PC/WP/WC/DS/DC…）
 *   - /A 动作引用（链接/页面/大纲条目）
 *   - /Names /JavaScript 文档级 JS 名称树
 *   - 动作类型：JavaScript / Launch / SubmitForm / ImportData / GoTo(R/E) / URI / Named /
 *     Hide / SetOCGState / Sound / Movie / ResetForm / Thread / Trans / GoTo
 *   - /JS 脚本片段解码：字面串（PDF 转义 + 八进制）/ 十六进制串；字节级 UTF-16BE → UTF-8 → Latin-1
 * 风险分级：高（JavaScript·Launch）/ 中（SubmitForm·ImportData）/ 低（URI·GoToR/E·Named…）/ info。
 * 纯解析、不执行任何动作、不修改文档；不依赖 pdf.js DOM，可在 node 单测。
 *
 * 暴露：
 *   parseActions(bytes)      主函数 → 完整结果（actions + 摘要）
 *   summarize(res)           派生摘要（与 res.summary 一致，便于测试）
 *   toMarkdown(res, opts)    审计报告 Markdown
 *   toHtml(res)              HTML 片段（含 data-page 跳页）
 */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

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
      else if (txt[i] === ">" && txt[i + 1] === ">") {
        depth--; i++;
        if (depth === 0) return txt.slice(startIdx, i + 1);
      }
    }
    return null;
  }

  /** 定位对象号 num 的字典，返回 { str, start }（start 为字典在全局 txt 中的起始）。 */
  function getObjDict(txt, num) {
    const m = new RegExp("(?<!\\d)" + num + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const lt = txt.indexOf("<<", m.index);
    if (lt < 0) return null;
    const str = sliceDict(txt, lt);
    if (!str) return null;
    return { str, start: lt };
  }

  /** PDF 名字中的常规字符（不含分隔符）。 */
  function isRegular(ch) {
    return /[A-Za-z0-9._:*+\-#!$&@?]/.test(ch);
  }

  /** 从 i 处读一个 PDF 对象值，返回 { value, next }。 */
  function parseValue(s, i) {
    const n = s.length;
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) return { value: "", next: i };
    const c = s[i];
    if (c === "<" && s[i + 1] === "<") {
      const sub = sliceDict(s, i);
      if (sub) return { value: sub, next: i + sub.length };
      return { value: "<<", next: i + 2 };
    }
    if (c === "<") {
      let j = i + 1;
      while (j < n && s[j] !== ">") j++;
      return { value: s.slice(i, Math.min(j + 1, n)), next: j + 1 };
    }
    if (c === "[") {
      let depth = 0, j = i;
      for (; j < n; j++) {
        if (s[j] === "[") depth++;
        else if (s[j] === "]") { depth--; if (depth === 0) { j++; break; } }
      }
      return { value: s.slice(i, j), next: j };
    }
    if (c === "(") {
      let depth = 0, j = i;
      for (; j < n; j++) {
        if (s[j] === "\\") { j++; continue; }
        if (s[j] === "(") depth++;
        else if (s[j] === ")") { depth--; if (depth === 0) { j++; break; } }
      }
      return { value: s.slice(i, Math.min(j + 1, n)), next: j + 1 };
    }
    if (c === "/") {
      let j = i + 1, v = "/";
      while (j < n && isRegular(s[j])) { v += s[j]; j++; }
      return { value: v, next: j };
    }
    if (/[+-]?\d/.test(c)) {
      const refM = /^(\d+)\s+(\d+)\s+R\b/.exec(s.slice(i, i + 48) || "");
      if (refM) return { value: refM[0], next: i + refM[0].length };
      let j = i, v = "";
      while (j < n && !/[\s/<\[\](){}>]/.test(s[j])) { v += s[j]; j++; }
      if (!v) { j = i + 1; v = c; }
      return { value: v, next: j };
    }
    let j = i, v = "";
    while (j < n && isRegular(s[j])) { v += s[j]; j++; }
    if (!v) { j = i + 1; v = c; }
    return { value: v, next: j };
  }

  /** 解析字典内层（去掉外层 << >>）的顶层键值对 → [{ key, value }]。 */
  function parseDictEntries(inner) {
    const out = [];
    let i = 0;
    const n = inner.length;
    while (i < n) {
      const c = inner[i];
      if (c === "<" && inner[i + 1] === "<") {
        const sub = sliceDict(inner, i);
        i += sub ? sub.length : 2;
        continue;
      }
      if (c === ">" && inner[i + 1] === ">") { i += 2; continue; }
      if (c === "[") {
        const r = parseValue(inner, i);
        i = Math.max(r.next, i + 1);
        continue;
      }
      if (c === "/") {
        let j = i + 1, key = "";
        while (j < n && isRegular(inner[j])) { key += inner[j]; j++; }
        if (!key) { i++; continue; }
        i = j;
        const r = parseValue(inner, i);
        out.push({ key, value: r.value });
        i = Math.max(r.next, i + 1);
        continue;
      }
      i++;
    }
    return out;
  }

  /** 取字典串的顶层 entries（自动剥外层 << >>）。 */
  function dictEntries(dictStr) {
    if (!dictStr) return [];
    const lt = dictStr.indexOf("<<");
    if (lt < 0) return [];
    const body = dictStr.slice(lt + 2, dictStr.lastIndexOf(">>"));
    return parseDictEntries(body);
  }

  function entryVal(entries, key) {
    for (const e of entries) if (e.key === key) return e.value;
    return null;
  }

  /** 把值解析为字典串：内联字典直接返回；间接引用则解析对象字典。 */
  function valueAsDict(txt, val) {
    if (!val) return null;
    if (val.indexOf("<<") === 0) return val;
    const rm = /^(\d+)\s+(\d+)\s+R/.exec(String(val).trim());
    if (rm) {
      const o = getObjDict(txt, +rm[1]);
      if (o) return o.str;
    }
    return null;
  }

  // —— 动作类型 → 风险分级（PDF 32000-1 Table 199/200）——
  const ACTION_KINDS = {
    JavaScript:  { label: "JavaScript", risk: "high",   desc: "执行嵌入的 JS 脚本（可读文件/发网络请求，自动运行时风险最高）" },
    Launch:      { label: "Launch",     risk: "high",   desc: "启动外部程序或打开文件（可被利用执行任意命令）" },
    SubmitForm:  { label: "SubmitForm", risk: "medium", desc: "把表单数据提交到外部 URL（数据外发）" },
    ImportData:  { label: "ImportData", risk: "medium", desc: "从外部 FDF 文件导入数据（跨文档读写）" },
    GoToR:       { label: "GoToR",      risk: "low",    desc: "跳转到另一个（远程）PDF 文件" },
    GoToE:       { label: "GoToE",      risk: "low",    desc: "跳转到内嵌 PDF" },
    GoTo:        { label: "GoTo",       risk: "info",   desc: "文档内跳转" },
    URI:         { label: "URI",        risk: "low",    desc: "打开 URL 链接" },
    Named:       { label: "Named",      risk: "low",    desc: "命名动作（如 NextPage/Print）" },
    Hide:        { label: "Hide",       risk: "info",   desc: "显示/隐藏批注或表单字段" },
    SetOCGState: { label: "SetOCGState",risk: "info",   desc: "切换可选内容组（图层）状态" },
    Sound:       { label: "Sound",      risk: "info",   desc: "播放声音" },
    Movie:       { label: "Movie",      risk: "info",   desc: "播放视频" },
    ResetForm:   { label: "ResetForm",  risk: "info",   desc: "重置表单" },
    Thread:      { label: "Thread",     risk: "info",   desc: "跳转到文章线索" },
    Trans:       { label: "Trans",      risk: "info",   desc: "页面过渡效果" }
  };

  // —— /AA 附加动作事件 → 可读名（PDF 32000-1 Table 197/198）——
  const AA_EVENTS = {
    O:  "打开（进入页面/字段）", E: "进入（获得焦点）", X: "退出（失去焦点）",
    U:  "鼠标抬起", D: "鼠标按下", Fo: "获得焦点", Bl: "失去焦点",
    K:  "按键", V: "值改变", C: "计算", F: "格式化", JS: "JavaScript 事件",
    Po: "页面打开", PC: "页面关闭", PV: "页面可见", PI: "页面不可见",
    WP: "文档打印后", WC: "文档关闭", WS: "文档保存后", DS: "文档发送后", DC: "文档保存/发送后关闭"
  };
  // 自动触发的事件（无需用户交互即执行）
  const AUTO_EVENTS = { O: 1, Po: 1, PC: 1, PV: 1, WP: 1, WC: 1, WS: 1, DS: 1, DC: 1 };

  const RISK_LABELS = {
    high:   { label: "高", color: "#d1242f", bg: "#fff5f5", border: "#d1242f" },
    medium: { label: "中", color: "#8a6d00", bg: "#fffbe8", border: "#d4a72c" },
    low:    { label: "低", color: "#555",   bg: "#f6f8fa", border: "#c9d1d9" },
    info:   { label: "提示", color: "#555", bg: "#f6f8fa", border: "#c9d1d9" }
  };

  /** 字面串 "(...)" 内容反转义（含八进制 \ooo）。 */
  function decodeLiteral(raw) {
    if (!raw || raw.length < 2) return "";
    let body = raw.slice(1, -1);
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "\\") {
        const d = body[++i];
        if (d === undefined) break;
        if (d === "n") out += "\n";
        else if (d === "r") out += "\r";
        else if (d === "t") out += "\t";
        else if (d === "b") out += "\b";
        else if (d === "f") out += "\f";
        else if (d >= "0" && d <= "7") {
          let oct = d;
          while (oct.length < 3 && body[i + 1] >= "0" && body[i + 1] <= "7") oct += body[++i];
          const code = parseInt(oct, 8);
          out += String.fromCharCode(code & 0xff);
        } else out += d;
      } else out += c;
    }
    return out;
  }

  /** 十六进制串 "<FEFF...>" → 字节串（每字节一个字符）。 */
  function decodeHex(raw) {
    const hex = String(raw).replace(/[<>]/g, "").replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      const code = parseInt(hex.substr(i, 2), 16);
      if (isNaN(code)) return null;
      out += String.fromCharCode(code);
    }
    return out;
  }

  /**
   * /JS 值解码：字面串 / 十六进制 / 间接引用（返回 null）。
   * 字节级：先转字节数组，FE FF 头走 UTF-16BE，否则尝试 UTF-8，失败回退 Latin-1。
   */
  function decodeJsValue(txt, val) {
    if (val == null) return null;
    let s = String(val).trim();
    let str = null;
    if (s.charAt(0) === "(") str = decodeLiteral(s);
    else if (s.charAt(0) === "<" && s.charAt(1) !== "<") str = decodeHex(s);
    else if (/^\d+\s+\d+\s+R$/.test(s)) return null; // 间接引用（不展开流内容）
    else str = s;
    if (str == null) return null;
    // 串 → 字节
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      // UTF-16BE
      let out = "";
      for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return cleanSnippet(out);
    }
    // UTF-8 优先（可解码且含多字节序列时更准），失败回退 Latin-1
    try {
      if (typeof TextDecoder !== "undefined") {
        const dec = new TextDecoder("utf-8", { fatal: true });
        return cleanSnippet(dec.decode(bytes));
      }
    } catch (e) { /* fallthrough */ }
    return cleanSnippet(str);
  }

  function cleanSnippet(s) {
    if (!s) return "";
    return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  /** 提取动作明细：按类型取目标（URL/文件/命名/脚本片段）。 */
  function extractDetail(txt, kind, entries) {
    if (kind === "JavaScript") {
      const js = entryVal(entries, "JS");
      const decoded = decodeJsValue(txt, js);
      return { snippet: decoded, detail: decoded ? null : "JS 内容为间接引用（未展开）" };
    }
    if (kind === "Launch") {
      const win = valueAsDict(txt, entryVal(entries, "Win"));
      let file = entryVal(entries, "F");
      let params = null;
      if (win) {
        const we = dictEntries(win);
        const wf = entryVal(we, "F");
        if (wf) file = wf;
        const wp = entryVal(we, "P");
        if (wp) params = decodeJsValue(txt, wp);
      }
      return { detail: "目标文件：" + (file ? decodeJsValue(txt, file) || file : "—") + (params ? "（参数 " + params + "）" : "") };
    }
    if (kind === "SubmitForm") {
      const url = entryVal(entries, "URL");
      return { detail: "提交地址：" + (url ? decodeJsValue(txt, url) || url : "—") };
    }
    if (kind === "ImportData") {
      const f = entryVal(entries, "F");
      return { detail: "导入文件：" + (f ? decodeJsValue(txt, f) || f : "—") };
    }
    if (kind === "URI") {
      const u = entryVal(entries, "URI");
      return { detail: "链接：" + (u ? decodeJsValue(txt, u) || u : "—") };
    }
    if (kind === "Named") {
      const nv = entryVal(entries, "N");
      return { detail: "命名：" + (nv ? String(nv).replace(/^\//, "") : "—") };
    }
    if (kind === "GoToR" || kind === "GoToE" || kind === "GoTo") {
      const d = entryVal(entries, "D");
      return { detail: d ? "目标 " + String(d).slice(0, 60) : null };
    }
    return {};
  }

  // —— 页面树遍历（页对象号 → 页码，用于 AA 来源标注）——
  function findRootDict(txt) {
    const refM = /\/Root\s+(\d+)\s+0\s+R/.exec(txt);
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) return { str: o.str, obj: +refM[1] }; }
    const inM = /\/Root\s*<<[\s\S]*?\/Type\s*\/Catalog[\s\S]*?>>/.exec(txt);
    if (inM) return { str: inM[0], obj: null };
    return null;
  }

  function findPagesNode(txt, rootDict) {
    if (!rootDict) return null;
    const refM = /\/Pages\s+(\d+)\s+0\s+R/.exec(rootDict);
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) return { str: o.str, obj: +refM[1] }; }
    const inM = /\/Pages\s*<<[\s\S]*?\/Kids\s*\[/.exec(rootDict);
    if (inM) {
      const lt = inM.index + inM[0].indexOf("<<");
      const str = sliceDict(rootDict, lt);
      if (str) return { str, obj: null };
    }
    return null;
  }

  function collectLeaves(txt, nodeDict, parentObj, out, counter) {
    const kidsM = /\/Kids\s*\[([\s\S]*?)\]/.exec(nodeDict);
    if (!kidsM) return;
    const refRe = /(\d+)\s+(\d+)\s+R/g;
    let rm;
    while ((rm = refRe.exec(kidsM[1]))) {
      const num = +rm[1];
      const o = getObjDict(txt, num);
      if (!o) continue;
      if (/\/Type\s*\/Pages\b/.test(o.str)) collectLeaves(txt, o.str, num, out, counter);
      else if (/\/Type\s*\/Page\b/.test(o.str)) out.push({ num: counter.n++, obj: num, dict: o.str });
    }
  }

  /** 主函数：解析 PDF 动作/JavaScript 安全审计。 */
  function parseActions(bytes) {
    const txt = bytesToString(bytes);
    const res = {
      hasCatalog: false,
      hasOpenAction: false,
      openActionIsDest: false,
      hasActions: false,
      actions: [],
      summary: {
        total: 0,
        byKind: {},
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
        autoRunCount: 0,
        jsCount: 0,
        launchCount: 0,
        verdict: "clean"
      }
    };

    const root = findRootDict(txt);
    const rootDict = root ? root.str : null;
    const rootObj = root ? root.obj : null;
    if (!rootDict) return res;
    res.hasCatalog = true;
    const rootEntries = dictEntries(rootDict);

    // 页对象号 → 页码
    const pageOfObj = new Map();
    const pagesNode = findPagesNode(txt, rootDict);
    if (pagesNode) {
      const leaves = [];
      collectLeaves(txt, pagesNode.str, pagesNode.obj, leaves, { n: 1 });
      for (const lf of leaves) pageOfObj.set(lf.obj, lf.num);
    }

    // 收集所有顶层对象字典
    const objDicts = [];
    const objRe = /(\d+)\s+0\s+obj\s*<</g;
    let m;
    const seenObj = new Set();
    while ((m = objRe.exec(txt))) {
      const num = +m[1];
      if (seenObj.has(num)) continue;
      seenObj.add(num);
      const lt = m.index + m[0].length - 2;
      const str = sliceDict(txt, lt);
      if (str) objDicts.push({ num, str });
    }

    // —— 引用来源登记：obj → [{ via, event, containerObj }] ——
    const viaMap = new Map();
    function addVia(targetNum, via, event, containerObj) {
      if (!viaMap.has(targetNum)) viaMap.set(targetNum, []);
      viaMap.get(targetNum).push({ via, event: event || null, containerObj: containerObj || null });
    }

    function labelFor(containerObj) {
      if (containerObj == null) return null;
      if (rootObj != null && containerObj === rootObj) return "Catalog";
      if (/\/Type\s*\/Page\b/.test(String(containerObj.str || ""))) return "Page";
      if (/\/Subtype\s*\/Link\b/.test(String(containerObj.str || ""))) return "Link";
      if (/\/Type\s*\/Annot\b/.test(String(containerObj.str || ""))) return "Annot";
      return "Obj";
    }

    // 动作记录：key = "o<obj>" 或 "i<序号>"
    const records = new Map();
    let inlineSeq = 0;

    function isKnownKind(sval) {
      const k = String(sval || "").replace(/^\//, "");
      return !!ACTION_KINDS[k] && k !== "Trans"; // Trans 仅在页面 /Trans 里常见，不单独登记
    }

    function buildRecord(kind, obj, containerObj, event, extraEntries) {
      const meta = ACTION_KINDS[kind] || { label: kind, risk: "info", desc: "动作" };
      const entries = extraEntries || null;
      const det = extractDetail(txt, kind, entries || []);
      const rec = {
        key: obj != null ? "o" + obj : "i" + (++inlineSeq),
        obj: obj != null ? obj : null,
        kind,
        kindLabel: meta.label,
        risk: meta.risk,
        desc: meta.desc,
        vias: [],
        events: [],
        pages: [],
        containerLabel: labelFor(containerObj),
        detail: det.detail || null,
        snippet: det.snippet || null
      };
      const exist = records.get(rec.key);
      if (exist) {
        // 合并：同对象多来源（如既是 OpenAction 又被 AA 引用）
        if (event && exist.events.indexOf(event) < 0) exist.events.push(event);
        if (exist.risk === "info" && meta.risk !== "info") { exist.risk = meta.risk; exist.desc = meta.desc; }
        if (det.detail && !exist.detail) exist.detail = det.detail;
        if (det.snippet && !exist.snippet) exist.snippet = det.snippet;
        return exist;
      }
      if (event) rec.events.push(event);
      // 内联动作（无对象号）挂在页面字典上时，直接归页
      if (rec.obj == null && rec.containerLabel === "Page" && containerObj && containerObj.num != null) {
        const pn = pageOfObj.get(containerObj.num);
        if (pn != null) rec.pages.push(pn);
      }
      records.set(rec.key, rec);
      return rec;
    }

    // pass 1：顶层动作对象（/S 为已知动作类型，或含 /JS 兜底）
    for (const od of objDicts) {
      const es = dictEntries(od.str);
      const sval = entryVal(es, "S");
      const kind = sval && String(sval).charAt(0) === "/" ? String(sval).slice(1) : null;
      if (kind && isKnownKind(kind)) {
        buildRecord(kind, od.num, null, null, es);
        continue;
      }
      if (!sval && entryVal(es, "JS") != null) {
        // 无 /S 但带 /JS：疑似 JavaScript 动作（部分生成器省略 /S）
        const r = buildRecord("JavaScript", od.num, null, null, es);
        r.detail = r.detail || "（无 /S，按 /JS 内容判定）";
      }
    }

    // pass 2：/OpenAction（Catalog）
    const openVal = entryVal(rootEntries, "OpenAction");
    if (openVal != null) {
      res.hasOpenAction = true;
      const s = String(openVal).trim();
      if (s.charAt(0) === "[") {
        res.openActionIsDest = true;
        buildRecord("GoTo", rootObj != null ? rootObj : null, rootObj != null ? { str: rootDict } : null, null)
          .vias.push("OpenAction（打开跳转到目标位置，非脚本）");
      } else if (s.indexOf("<<") === 0) {
        const es = dictEntries(s);
        const k = String(entryVal(es, "S") || "").replace(/^\//, "");
        const rec = buildRecord(isKnownKind(k) ? k : "Named", rootObj, null, null, es);
        if (rec.vias.indexOf("OpenAction（打开文档自动执行）") < 0) rec.vias.push("OpenAction（打开文档自动执行）");
      } else {
        const rm = /^(\d+)\s+\d+\s+R/.exec(s);
        if (rm) {
          const num = +rm[1];
          // 目标对象的动作记录（pass1 已建）；若 pass1 未识别（无 /S 或未知），补登记
          if (!records.has("o" + num)) {
            const o = getObjDict(txt, num);
            if (o) {
              const es = dictEntries(o.str);
              const k = String(entryVal(es, "S") || "").replace(/^\//, "");
              buildRecord(isKnownKind(k) ? k : "Named", num, null, null, es);
            }
          }
          addVia(num, "OpenAction（打开文档自动执行）");
        }
      }
    }

    // pass 3：/AA 附加动作 + /A 动作引用（全对象扫描，Catalog/页面/批注通吃）
    for (const od of objDicts) {
      const es = dictEntries(od.str);
      // /AA：字典（内联或引用）→ 事件 → 动作（引用或内联）
      const aaVal = entryVal(es, "AA");
      if (aaVal != null) {
        const aaDict = valueAsDict(txt, aaVal);
        if (aaDict) {
          for (const ev of dictEntries(aaDict)) {
            const v = String(ev.value).trim();
            if (/^\d+\s+\d+\s+R$/.test(v)) {
              const num = +v.split(/\s+/)[0];
              addVia(num, "AA 附加动作（/" + ev.key + "）", ev.key, od.num);
              if (!records.has("o" + num)) {
                const o = getObjDict(txt, num);
                if (o) {
                  const aes = dictEntries(o.str);
                  const k = String(entryVal(aes, "S") || "").replace(/^\//, "");
                  buildRecord(isKnownKind(k) ? k : "Named", num, null, null, aes);
                }
              }
            } else if (v.indexOf("<<") === 0) {
              const aes = dictEntries(v);
              const k = String(entryVal(aes, "S") || "").replace(/^\//, "");
              if (isKnownKind(k) || entryVal(aes, "JS") != null) {
                const rec = buildRecord(isKnownKind(k) ? k : "JavaScript", null, od, ev.key, aes);
                if (rec.vias.indexOf("AA 附加动作（/" + ev.key + "）") < 0) rec.vias.push("AA 附加动作（/" + ev.key + "）");
              }
            }
          }
        }
      }
      // /A：动作（引用或内联）
      const aVal = entryVal(es, "A");
      if (aVal != null) {
        const v = String(aVal).trim();
        if (/^\d+\s+\d+\s+R$/.test(v)) {
          const num = +v.split(/\s+/)[0];
          addVia(num, "A（动作引用）", null, od.num);
          if (!records.has("o" + num)) {
            const o = getObjDict(txt, num);
            if (o) {
              const aes = dictEntries(o.str);
              const k = String(entryVal(aes, "S") || "").replace(/^\//, "");
              buildRecord(isKnownKind(k) ? k : "Named", num, null, null, aes);
            }
          }
        } else if (v.indexOf("<<") === 0) {
          const aes = dictEntries(v);
          const k = String(entryVal(aes, "S") || "").replace(/^\//, "");
          if (isKnownKind(k)) {
            const rec = buildRecord(k, null, od, null, aes);
            if (rec.vias.indexOf("A（动作引用）") < 0) rec.vias.push("A（动作引用）");
          }
        }
      }
    }

    // pass 4：/Names /JavaScript 文档级 JS 名称树
    const namesVal = entryVal(rootEntries, "Names");
    if (namesVal != null) {
      const namesDict = valueAsDict(txt, namesVal);
      if (namesDict && /\/JavaScript\b/.test(namesDict)) {
        // 名称树结构：/Names << /JavaScript << /Names [(名) 动作引用 …] >> >>
        const jsSub = valueAsDict(txt, entryVal(dictEntries(namesDict), "JavaScript"));
        let attributed = false;
        if (jsSub) {
          const nm = /\/Names\s*\[([\s\S]*?)\]/.exec(jsSub);
          if (nm) {
            const refRe = /(\d+)\s+\d+\s+R/g;
            let rm;
            while ((rm = refRe.exec(nm[1]))) {
              const num = +rm[1];
              addVia(num, "Names/JavaScript 名称树（文档级 JS）");
              if (!records.has("o" + num)) {
                const o = getObjDict(txt, num);
                if (o) {
                  const es = dictEntries(o.str);
                  const k = String(entryVal(es, "S") || "").replace(/^\//, "");
                  buildRecord(isKnownKind(k) ? k : "JavaScript", num, null, null, es);
                }
              }
              attributed = true;
            }
          }
        }
        if (!attributed) {
          // 引用不可解析时兜底：登记文档级 JS 存在
          const rec = buildRecord("JavaScript", null, rootObj != null ? { str: rootDict } : null, null);
          if (rec.vias.indexOf("Names/JavaScript 名称树（文档级 JS）") < 0) rec.vias.push("Names/JavaScript 名称树（文档级 JS）");
        }
      }
    }

    // —— 汇总 via / 事件 / 页码 ——
    for (const [key, vias] of viaMap) {
      const rec = records.get("o" + key);
      if (!rec) continue;
      for (const v of vias) {
        if (rec.vias.indexOf(v.via) < 0) rec.vias.push(v.via);
        if (v.event && rec.events.indexOf(v.event) < 0) rec.events.push(v.event);
        if (v.containerObj != null) {
          const lab = labelFor(objDicts.find(d => d.num === v.containerObj));
          if (lab === "Page") {
            const pn = pageOfObj.get(v.containerObj);
            if (pn != null && rec.pages.indexOf(pn) < 0) rec.pages.push(pn);
          }
        }
      }
    }
    // OpenAction 直接登记的 via（addVia 只写 viaMap，上面已并入）
    // 补：记录了 OpenAction via 的对象，若为页面无则照常
    for (const rec of records.values()) {
      if (!rec.vias.length) rec.vias.push("独立动作对象（未被 OpenAction/AA/A 引用）");
      if (rec.containerLabel === "Page" && rec.obj != null) {
        const pn = pageOfObj.get(rec.obj);
        if (pn != null && rec.pages.indexOf(pn) < 0) rec.pages.push(pn);
      }
      rec.pages.sort((a, b) => a - b);
      rec.autoRun = rec.vias.some(v => v.indexOf("OpenAction") >= 0) ||
        rec.events.some(ev => !!AUTO_EVENTS[ev]);
    }

    const actions = Array.from(records.values());
    // 排序：风险高 → 低；同风险按对象号
    const riskOrder = { high: 0, medium: 1, low: 2, info: 3 };
    actions.sort((a, b) => {
      if (riskOrder[a.risk] !== riskOrder[b.risk]) return riskOrder[a.risk] - riskOrder[b.risk];
      return (a.obj || 0) - (b.obj || 0);
    });
    actions.forEach((a, i) => { a.index = i + 1; });
    res.actions = actions;
    res.hasActions = actions.length > 0;

    // —— 摘要 ——
    const byKind = {};
    let highCount = 0, mediumCount = 0, lowCount = 0, infoCount = 0;
    let autoRunCount = 0, jsCount = 0, launchCount = 0;
    for (const a of actions) {
      byKind[a.kind] = (byKind[a.kind] || 0) + 1;
      if (a.risk === "high") highCount++;
      else if (a.risk === "medium") mediumCount++;
      else if (a.risk === "low") lowCount++;
      else infoCount++;
      if (a.autoRun) autoRunCount++;
      if (a.kind === "JavaScript") jsCount++;
      if (a.kind === "Launch") launchCount++;
    }
    let verdict = "clean";
    if (highCount) verdict = "high";
    else if (mediumCount) verdict = "medium";
    else if (lowCount || infoCount) verdict = "low";
    res.summary = {
      total: actions.length,
      byKind,
      highCount, mediumCount, lowCount, infoCount,
      autoRunCount, jsCount, launchCount,
      verdict
    };
    return res;
  }

  function summarize(res) {
    if (!res) return { total: 0, verdict: "clean" };
    return {
      hasCatalog: res.hasCatalog,
      hasOpenAction: res.hasOpenAction,
      openActionIsDest: res.openActionIsDest,
      hasActions: res.hasActions,
      total: res.summary ? res.summary.total : 0,
      byKind: res.summary ? res.summary.byKind : {},
      highCount: res.summary ? res.summary.highCount : 0,
      mediumCount: res.summary ? res.summary.mediumCount : 0,
      lowCount: res.summary ? res.summary.lowCount : 0,
      infoCount: res.summary ? res.summary.infoCount : 0,
      autoRunCount: res.summary ? res.summary.autoRunCount : 0,
      jsCount: res.summary ? res.summary.jsCount : 0,
      launchCount: res.summary ? res.summary.launchCount : 0,
      verdict: res.summary ? res.summary.verdict : "clean"
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  const VERDICT_TEXT = {
    high: "高风险：发现自动执行脚本或外部程序启动动作，建议在可信环境外谨慎打开",
    medium: "中风险：存在数据外发/导入动作，注意表单提交目标",
    low: "低风险：仅包含普通跳转/链接动作",
    clean: "干净：未发现任何动作"
  };

  function fmtPages(pages) {
    if (!pages || !pages.length) return "—";
    const ps = pages.slice().sort((a, b) => a - b);
    if (ps.length <= 6) return "第 " + ps.join("、") + " 页";
    return "第 " + ps.slice(0, 5).join("、") + " 页等 " + ps.length + " 页";
  }

  function toMarkdown(res, opts) {
    opts = opts || {};
    const lines = ["# " + (opts.title || "PDF 动作/JavaScript 安全审计"), ""];
    if (!res.hasCatalog) {
      lines.push("（未发现文档目录 /Root，无法解析动作）");
      return lines.join("\n");
    }
    if (!res.hasActions) {
      lines.push("**结论**：" + VERDICT_TEXT.clean);
      lines.push("");
      lines.push("- /OpenAction：无");
      lines.push("- /AA 附加动作：无");
      lines.push("- 动作对象：无");
      return lines.join("\n");
    }
    const s = res.summary;
    lines.push("## 摘要");
    lines.push("- **动作总数**：" + s.total + " 个");
    lines.push("- **风险分布**：高 " + s.highCount + " · 中 " + s.mediumCount + " · 低 " + s.lowCount + " · 提示 " + s.infoCount);
    lines.push("- **自动执行（打开/页面事件触发）**：" + s.autoRunCount + " 个");
    lines.push("- **OpenAction**：" + (res.openActionIsDest ? "有（打开跳转目标，非脚本）" : (res.hasOpenAction ? "有" : "无")));
    lines.push("- **类型分布**：" + Object.keys(s.byKind).map(k => k + "×" + s.byKind[k]).join(" · "));
    lines.push("");
    lines.push("**结论**：" + VERDICT_TEXT[s.verdict]);
    if (s.highCount) {
      lines.push("");
      lines.push("> ⚠ **高风险动作 " + s.highCount + " 个**：包括" +
        (s.jsCount ? " JavaScript 脚本" + s.jsCount + " 个" : "") +
        (s.jsCount && s.launchCount ? "、" : "") +
        (s.launchCount ? "外部程序启动" + s.launchCount + " 个" : "") +
        "。请确认文档来源可信。");
    }
    lines.push("");
    lines.push("## 动作清单（按风险降序）");
    for (const a of res.actions) {
      lines.push("### " + a.index + ". [" + RISK_LABELS[a.risk].label + "风险] " + a.kindLabel +
        (a.obj != null ? "（对象 " + a.obj + "）" : "") + (a.autoRun ? " · 自动执行" : ""));
      lines.push("- **说明**：" + a.desc);
      lines.push("- **来源**：" + a.vias.join("；") +
        (a.events.length ? "（事件 /" + a.events.join(" /") + "）" : ""));
      if (a.pages.length) lines.push("- **所在页**：" + fmtPages(a.pages));
      if (a.detail) lines.push("- **目标**：" + a.detail);
      if (a.snippet) lines.push("- **JS 片段**：`" + a.snippet.replace(/`/g, "'") + "`");
      lines.push("");
    }
    return lines.join("\n");
  }

  function toHtml(res) {
    if (!res.hasCatalog) {
      return `<div style="color:#999;padding:6px 0">（未发现文档目录 /Root）</div>`;
    }
    if (!res.hasActions) {
      return `<div style="font-size:13px">` +
        `<div style="margin:6px 0;padding:6px 8px;border-left:3px solid #1a7f37;background:#f2fbf4;color:#1a7f37">✓ ${VERDICT_TEXT.clean}</div>` +
        `<div style="padding:4px 0;color:#555">/OpenAction：无 · /AA 附加动作：无 · 动作对象：无</div></div>`;
    }
    const s = res.summary;
    const v = RISK_LABELS[s.verdict === "clean" ? "info" : s.verdict] || RISK_LABELS.info;
    let html = `<div style="font-size:13px">`;
    html += `<div style="font-weight:600;margin:4px 0;color:#444">摘要</div>`;
    html += `<div style="padding:4px 0;color:#333">动作 <b>${s.total}</b> 个 · ` +
      `<span style="color:#d1242f">高 ${s.highCount}</span> · ` +
      `<span style="color:#8a6d00">中 ${s.mediumCount}</span> · 低 ${s.lowCount} · 提示 ${s.infoCount} · ` +
      `自动执行 <b>${s.autoRunCount}</b></div>`;
    html += `<div style="padding:4px 0;color:#555">类型：${Object.keys(s.byKind).map(k => escapeHtml(k) + "×" + s.byKind[k]).join(" · ")}</div>`;
    html += `<div style="margin:6px 0;padding:6px 8px;border-left:3px solid ${v.border};background:${v.bg};color:${v.color}">${s.verdict === "high" ? "⚠" : "✓"} ${VERDICT_TEXT[s.verdict]}</div>`;
    html += `<div style="font-weight:600;margin:8px 0 2px;color:#444">动作清单（按风险降序）</div>`;
    html += `<div style="border:1px solid #eee;border-radius:6px;overflow:hidden">`;
    res.actions.forEach((a, i) => {
      const rk = RISK_LABELS[a.risk];
      const bg = i % 2 ? "#fafafa" : "#fff";
      html += `<div style="padding:7px 9px;border-bottom:1px solid #eee;background:${bg}">` +
        `<div><b>${a.index}. <span style="color:${rk.color}">[${rk.label}风险]</span> ${escapeHtml(a.kindLabel)}</b> ` +
        `<span style="color:#888">${a.obj != null ? "· 对象 " + a.obj : ""}${a.autoRun ? " · <span style='color:#d1242f'>自动执行</span>" : ""}</span></div>` +
        `<div style="color:#555;margin-top:2px">${escapeHtml(a.desc)}</div>` +
        `<div style="color:#888;margin-top:2px">来源：${escapeHtml(a.vias.join("；"))}` +
        `${a.events.length ? "（事件 /" + escapeHtml(a.events.join(" /")) + "）" : ""}</div>` +
        (a.pages.length ? `<div style="color:#888;margin-top:2px">所在页：${a.pages.map(p => `<span data-page="${p}" style="color:#0969da;cursor:pointer;text-decoration:underline">第 ${p} 页</span>`).join("、")}</div>` : "") +
        (a.detail ? `<div style="color:#555;margin-top:2px">目标：${escapeHtml(a.detail)}</div>` : "") +
        (a.snippet ? `<div style="color:#444;margin-top:2px;font-family:monospace;background:#f6f8fa;padding:3px 6px;border-radius:4px;overflow:auto">${escapeHtml(a.snippet)}</div>` : "") +
        `</div>`;
    });
    html += `</div></div>`;
    return html;
  }

  const Api = {
    bytesToString, sliceDict, getObjDict, parseValue, parseDictEntries, dictEntries,
    entryVal, valueAsDict, decodeLiteral, decodeHex, decodeJsValue, extractDetail,
    findRootDict, findPagesNode, collectLeaves,
    parseActions, summarize, toMarkdown, toHtml,
    ACTION_KINDS, AA_EVENTS, AUTO_EVENTS, RISK_LABELS, VERDICT_TEXT
  };
  OS.PdfActions = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
