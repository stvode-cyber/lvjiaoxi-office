/* ============================================================
   绿角犀 Office · Spreadsheet 表格模块 + 自研公式引擎
   对应 PRD 3.2 / 关键技术设计「兼容 Excel 函数集的公式计算引擎」
   ============================================================ */
(function (global) {
  "use strict";
  // TODO: [坑-electron-contextIsolation-window] 预防: 第三方库引用用 window→globalThis→global 顺序，别假设 global === window
  const OS = global.OS;

  /* ---------------- 公式引擎 ---------------- */
  const FE = (function () {
    const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    function colToIdx(s) { let n = 0; for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64); return n; }
    function idxToCol(n) { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = COLS[r] + s; n = Math.floor((n - 1) / 26); } return s; }
    function parseRef(r) { const m = /^([A-Z]+)(\d+)$/.exec(r); if (!m) return null; return { col: colToIdx(m[1]), row: +m[2] }; }
    function parseRange(r) { const m = /^(?:([A-Z]+)(\d+))?:(?:([A-Z]+)(\d+))?$/.exec(r); if (!m) return null; return m; }
    function expandRange(a, b) {
      const refs = []; const c1 = colToIdx(a.col), c2 = colToIdx(b.col), r1 = a.row, r2 = b.row;
      const [mc, nc] = c1 <= c2 ? [c1, c2] : [c2, c1], [mr, nr] = r1 <= r2 ? [r1, r2] : [r2, r1];
      for (let c = mc; c <= nc; c++) for (let r = mr; r <= nr; r++) refs.push(idxToCol(c) + r);
      return refs;
    }
    const REF_RE = /^\$?([A-Z]+)\$?(\d+)$/;

    // ============ TVM 时间价值核心公式 ============
    /** FV 核心（FV / RATE 迭代共用）
     *  fv = -pv*(1+r)^n - pmt*((1+r)^n-1)/r * (type===1 ? 1+r : 1)
     */
    function _tvmFVcore(r, n, pmt, pv0, t) {
      const adj = t === 1 ? (1 + r) : 1;
      if (r === 0) return -pmt * n - pv0;
      const pow = Math.pow(1 + r, n);
      return -pv0 * pow - pmt * adj * (pow - 1) / r;
    }
    /** type 调整因子 — type=0(期末)=1, type=1(期初)=1+r */
    function _tvmAdj(t, r) { return t === 1 ? (1 + r) : 1; }

    const FUNCS = {
      SUM: (...a) => sum(numList(a)),
      AVERAGE: (...a) => { const l = numList(a); return l.length ? sum(l) / l.length : 0; },
      COUNT: (...a) => numList(a).length,
      COUNTA: (...a) => flat(a).filter(x => x !== "" && x != null).length,
      MAX: (...a) => { const l = numList(a); return l.length ? Math.max(...l) : 0; },
      MIN: (...a) => { const l = numList(a); return l.length ? Math.min(...l) : 0; },
      PRODUCT: (...a) => numList(a).reduce((p, x) => p * x, 1),
      ROUND: (a, b) => Math.round(a * Math.pow(10, b || 0)) / Math.pow(10, b || 0),
      ABS: a => Math.abs(a), SQRT: a => Math.sqrt(a), POWER: (a, b) => Math.pow(a, b),
      MOD: (a, b) => a - b * Math.floor(a / b), INT: a => Math.floor(a),
      CEILING: (a, b) => Math.ceil(a / (b || 1)) * (b || 1), FLOOR: (a, b) => Math.floor(a / (b || 1)) * (b || 1),
      IF: (c, t, f) => (c ? t : f),
      AND: (...a) => flat(a).every(Boolean), OR: (...a) => flat(a).some(Boolean), NOT: a => !a,
      CONCAT: (...a) => flat(a).map(x => x == null ? "" : String(x)).join(""),
      CONCATENATE: (...a) => flat(a).map(x => x == null ? "" : String(x)).join(""),
      LEFT: (s, n) => String(s).slice(0, n), RIGHT: (s, n) => String(s).slice(-n),
      MID: (s, a, b) => String(s).slice(a - 1, a - 1 + b), LEN: s => String(s).length,
      UPPER: s => String(s).toUpperCase(), LOWER: s => String(s).toLowerCase(), TRIM: s => String(s).trim().replace(/\s+/g, " "),
      VALUE: s => parseFloat(s), TEXT: (v, f) => formatNum(v, f),
      TODAY: () => { const d = new Date(); return Date.parse(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`); },
      NOW: () => Date.now(),
      DATE: (y, m, d) => Date.parse(`${y}/${m}/${d}`),
      YEAR: t => new Date(t).getFullYear(), MONTH: t => new Date(t).getMonth() + 1, DAY: t => new Date(t).getDate(),
      VLOOKUP: (key, range, idx, exact) => {
        const rows = range; for (const row of rows) { if (row[0] == key) return row[(idx || 1) - 1]; }
        if (exact) return "#N/A";
        let best = null; for (const row of rows) { if (row[0] <= key) best = row; } return best ? best[(idx || 1) - 1] : "#N/A";
      },
      INDEX: (range, r, c) => { const row = range[r - 1]; return row ? row[(c || 1) - 1] : "#REF!"; },
      MATCH: (key, range) => { const flatR = flat(range); const i = flatR.findIndex(x => x == key); return i < 0 ? "#N/A" : i + 1; },
      SUMIF: (range, crit, sumr) => {
        const rv = flat(range), sv = sumr ? flat(sumr) : rv; let t = 0;
        for (let i = 0; i < rv.length; i++) if (matchCrit(rv[i], crit)) t += +sv[i] || 0; return t;
      },
      COUNTIF: (range, crit) => {
        const rv = flat(range); let c = 0;
        for (const v of rv) if (matchCrit(v, crit)) c++; return c;
      },
      COUNTIFS: (...args) => {
        if (args.length < 2 || args.length % 2 !== 0) return "#VALUE!";
        const pairs = [];
        for (let i = 0; i < args.length; i += 2) pairs.push({ r: flat(args[i]), c: args[i + 1] });
        const len = pairs[0].r.length; let total = 0;
        for (const p of pairs) if (p.r.length !== len) return "#VALUE!";
        for (let i = 0; i < len; i++) { let ok = true; for (const p of pairs) if (!matchCrit(p.r[i], p.c)) { ok = false; break; } if (ok) total++; }
        return total;
      },
      SUMIFS: (sumr, ...args) => {
        if (args.length < 2 || args.length % 2 !== 0) return "#VALUE!";
        const sv = flat(sumr); const pairs = [];
        for (let i = 0; i < args.length; i += 2) pairs.push({ r: flat(args[i]), c: args[i + 1] });
        const len = sv.length; let total = 0;
        for (const p of pairs) if (p.r.length !== len) return "#VALUE!";
        for (let i = 0; i < len; i++) { let ok = true; for (const p of pairs) if (!matchCrit(p.r[i], p.c)) { ok = false; break; } if (ok) total += +sv[i] || 0; }
        return total;
      },
      AVERAGEIF: (range, crit, avgr) => {
        const rv = flat(range), sv = avgr ? flat(avgr) : rv; const vals = [];
        for (let i = 0; i < rv.length; i++) if (matchCrit(rv[i], crit)) { const n = parseFloat(sv[i]); if (!isNaN(n)) vals.push(n); }
        return vals.length ? sum(vals) / vals.length : 0;
      },
      AVERAGEIFS: (avgr, ...args) => {
        if (args.length < 2 || args.length % 2 !== 0) return "#VALUE!";
        const sv = flat(avgr); const pairs = [];
        for (let i = 0; i < args.length; i += 2) pairs.push({ r: flat(args[i]), c: args[i + 1] });
        const len = sv.length; const vals = [];
        for (const p of pairs) if (p.r.length !== len) return "#VALUE!";
        for (let i = 0; i < len; i++) { let ok = true; for (const p of pairs) if (!matchCrit(p.r[i], p.c)) { ok = false; break; } if (ok) { const n = parseFloat(sv[i]); if (!isNaN(n)) vals.push(n); } }
        return vals.length ? sum(vals) / vals.length : 0;
      },
      MAXIFS: (maxr, ...args) => {
        if (args.length < 2 || args.length % 2 !== 0) return "#VALUE!";
        const sv = flat(maxr); const pairs = [];
        for (let i = 0; i < args.length; i += 2) pairs.push({ r: flat(args[i]), c: args[i + 1] });
        const len = sv.length; const vals = [];
        for (const p of pairs) if (p.r.length !== len) return "#VALUE!";
        for (let i = 0; i < len; i++) { let ok = true; for (const p of pairs) if (!matchCrit(p.r[i], p.c)) { ok = false; break; } if (ok) { const n = parseFloat(sv[i]); if (!isNaN(n)) vals.push(n); } }
        return vals.length ? Math.max(...vals) : 0;
      },
      MINIFS: (minr, ...args) => {
        if (args.length < 2 || args.length % 2 !== 0) return "#VALUE!";
        const sv = flat(minr); const pairs = [];
        for (let i = 0; i < args.length; i += 2) pairs.push({ r: flat(args[i]), c: args[i + 1] });
        const len = sv.length; const vals = [];
        for (const p of pairs) if (p.r.length !== len) return "#VALUE!";
        for (let i = 0; i < len; i++) { let ok = true; for (const p of pairs) if (!matchCrit(p.r[i], p.c)) { ok = false; break; } if (ok) { const n = parseFloat(sv[i]); if (!isNaN(n)) vals.push(n); } }
        return vals.length ? Math.min(...vals) : 0;
      },
      IFERROR: (v, fallback) => { if (typeof v === "string" && v.startsWith("#")) return fallback; return v; },
      IFNA: (v, fallback) => { if (v === "#N/A") return fallback; return v; },
      IFS: (...args) => {
        if (args.length < 2 || args.length % 2 !== 0) return "#N/A";
        for (let i = 0; i < args.length; i += 2) if (args[i]) return args[i + 1];
        return "#N/A";
      },
      SWITCH: (expr, ...args) => {
        if (args.length < 1) return "#N/A";
        for (let i = 0; i + 1 < args.length; i += 2) if (args[i] == expr) return args[i + 1];
        if (args.length % 2 === 1) return args[args.length - 1];
        return "#N/A";
      },
      ROUNDUP: (a, b) => { const p = Math.pow(10, b || 0); const n = num(a); return n >= 0 ? Math.ceil(n * p) / p : -Math.ceil(-n * p) / p; },
      ROUNDDOWN: (a, b) => { const p = Math.pow(10, b || 0); const n = num(a); return n >= 0 ? Math.floor(n * p) / p : -Math.floor(-n * p) / p; },
      TRUNC: (a, b) => { const p = Math.pow(10, b || 0); const n = num(a); return (n >= 0 ? Math.floor(n * p) : -Math.floor(-n * p)) / p; },
      EVEN: a => { const n = Math.ceil(Math.abs(a)); const r = n % 2 === 0 ? n : n + 1; return a >= 0 ? r : -r; },
      ODD: a => { const n = Math.ceil(Math.abs(a)); const r = n % 2 === 1 ? n : n + 1; return a >= 0 ? r : -r; },
      RANK: (x, r, order) => { const arr = numList(r).sort((a, b) => order ? a - b : b - a); let rank = 1; for (let i = 0; i < arr.length; i++) { if ((order ? arr[i] < x : arr[i] > x)) rank++; else break; } return arr.length ? rank : "#N/A"; },
      "RANK.EQ": (x, r, order) => FUNCS.RANK(x, r, order),
      LARGE: (r, k) => { const arr = numList(r).sort((a, b) => b - a); return k < 1 || k > arr.length ? "#NUM!" : arr[k - 1]; },
      SMALL: (r, k) => { const arr = numList(r).sort((a, b) => a - b); return k < 1 || k > arr.length ? "#NUM!" : arr[k - 1]; },
      MEDIAN: (...a) => {
        const arr = numList(a).sort((x, y) => x - y);
        if (!arr.length) return "#NUM!";
        const m = Math.floor(arr.length / 2);
        return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
      },
      MODE: (...a) => {
        const arr = numList(a); if (!arr.length) return "#N/A";
        const freq = new Map(); let best = null, bestCount = 0;
        for (const v of arr) { const c = (freq.get(v) || 0) + 1; freq.set(v, c); if (c > bestCount) { bestCount = c; best = v; } }
        return best;
      },
      "MODE.SNGL": (...a) => FUNCS.MODE(...a),
      STDEV: (...a) => _sampleVarStd(a, true),
      "STDEV.S": (...a) => FUNCS.STDEV(...a),
      "STDEV.P": (...a) => _popVarStd(a, true),
      VAR: (...a) => _sampleVarStd(a, false),
      "VAR.S": (...a) => FUNCS.VAR(...a),
      "VAR.P": (...a) => _popVarStd(a, false),
      PERCENTILE: (a, k) => _percentile(numList(a).sort((x, y) => x - y), k),
      QUARTILE: (a, q) => {
        const s = numList(a).sort((x, y) => x - y);
        if (q === 0) return s.length ? s[0] : "#NUM!";
        if (q === 1) return _percentile(s, 0.25);
        if (q === 2) return _percentile(s, 0.5);
        if (q === 3) return _percentile(s, 0.75);
        if (q === 4) return s.length ? s[s.length - 1] : "#NUM!";
        return "#NUM!";
      },
      SUBSTITUTE: (txt, oldStr, newStr, n) => {
        const s = String(txt), o = String(oldStr), ne = newStr == null ? "" : String(newStr);
        if (o === "") return s;
        if (n == null) return s.split(o).join(ne);
        let i = 0, count = 0, out = "";
        while (i < s.length) {
          if (s.slice(i, i + o.length) === o) { count++; if (count === n) { out += ne; i += o.length; } else { out += s[i]; i++; } }
          else { out += s[i]; i++; }
        }
        return out;
      },
      REPT: (s, n) => { let r = ""; const t = String(s); for (let i = 0; i < +n; i++) r += t; return r; },
      FIND: (needle, hay, start) => {
        const idx = String(hay).indexOf(String(needle), ((start || 1) - 1));
        return idx < 0 ? "#VALUE!" : idx + 1;
      },
      SEARCH: (needle, hay, start) => {
        const idx = String(hay).toLowerCase().indexOf(String(needle).toLowerCase(), ((start || 1) - 1));
        return idx < 0 ? "#VALUE!" : idx + 1;
      },
      CLEAN: s => String(s).replace(/[\x00-\x1F\x7F]/g, ""),
      PROPER: s => String(s).replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
      EXACT: (a, b) => String(a) === String(b),
      ISNUMBER: v => typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(parseFloat(v))),
      ISTEXT: v => typeof v === "string" && !(typeof v === "string" && v.startsWith("#")),
      ISBLANK: v => v == null || v === "",
      ISERROR: v => typeof v === "string" && v.startsWith("#"),
      ISNA: v => v === "#N/A",
      ISLOGICAL: v => typeof v === "boolean",
      NA: () => "#N/A",
      RAND: () => Math.random(),
      RANDBETWEEN: (a, b) => { const lo = Math.ceil(+a), hi = Math.floor(+b); return lo > hi ? "#NUM!" : Math.floor(Math.random() * (hi - lo + 1)) + lo; },
      // ========== 新增 2026-09-19 ==========
      /** SUMPRODUCT — 数组乘积求和，电商/财务最常用的"数组公式替代品" */
      SUMPRODUCT: (...args) => {
        if (!args.length) return 0;
        // 第一个数组决定维度，所有数组必须同尺寸
        const base = flat(args[0]);
        let total = 0;
        for (let i = 0; i < base.length; i++) {
          let prod = 1;
          for (let j = 0; j < args.length; j++) {
            const arr = flat(args[j]);
            if (arr.length !== base.length) return "#VALUE!";
            const v = arr[i];
            // 空或布尔视为 0/1
            const n = (typeof v === "boolean") ? (v ? 1 : 0) : parseFloat(v);
            if (isNaN(n)) { prod = 0; break; }
            prod *= n;
          }
          total += prod;
        }
        return total;
      },
      /** HLOOKUP — 水平查找（VLOOKUP 的兄弟） */
      HLOOKUP: (key, range, rowIdx, exact) => {
        // range 是二维数组 [[col1,col2,...], [r1c1,r1c2,...], [r2c1,r2c2,...]]
        if (!Array.isArray(range) || !range.length) return "#N/A";
        const header = range[0];
        let col = -1;
        for (let c = 0; c < header.length; c++) { if (header[c] == key) { col = c; break; } }
        if (col === -1) {
          if (!exact) { let best = -Infinity; for (let c = 0; c < header.length; c++) if (+header[c] <= +key && +header[c] > best) { best = +header[c]; col = c; } }
          if (col === -1) return "#N/A";
        }
        if (rowIdx < 1 || rowIdx > range.length) return "#REF!";
        return range[rowIdx - 1][col];
      },
      /** COLUMN / ROW — 返回当前单元格坐标（动态公式必备）*/
      COLUMN: () => "#REF!",       // 需要运行时注入，见 evalNode 补丁
      ROW: () => "#REF!",          // 同上
      /** ROWS / COLUMNS — 返回范围的行数/列数 */
      ROWS: r => Array.isArray(r) ? (Array.isArray(r[0]) ? r.length : 1) : 0,
      COLUMNS: r => Array.isArray(r) && Array.isArray(r[0]) ? r[0].length : (Array.isArray(r) ? 1 : 0),
      /** COUNTBLANK — 统计空白单元格 */
      COUNTBLANK: r => flat(r).filter(x => x === "" || x == null).length,
      /** ISODD / ISEVEN — 奇偶判断 */
      ISODD: x => Math.abs(Math.floor(+x)) % 2 === 1,
      ISEVEN: x => Math.abs(Math.floor(+x)) % 2 === 0,
      /** DATEDIF / DATEIF — Excel 隐藏函数，计算两日期差 */
      DATEIF: (start, end, unit) => {
        const s = new Date(start), e = new Date(end);
        if (isNaN(s) || isNaN(e) || e < s) return "#NUM!";
        const U = String(unit || "D").toUpperCase();
        const diffMs = e - s;
        const days = diffMs / 86400000;
        switch (U) {
          case "D": return Math.floor(days);
          case "YD": { const y1 = s.getFullYear(), y2 = e.getFullYear(); return Math.floor((e - new Date(y2, s.getMonth(), s.getDate())) / 86400000); }
          case "MD": return e.getDate() - s.getDate();
          case "M": return Math.floor(days / 30.4375);
          case "YM": return Math.floor((e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth());
          case "Y": return e.getFullYear() - s.getFullYear();
          default: return "#VALUE!";
        }
      },
      DATEDIF: (s, e, u) => FUNCS.DATEIF(s, e, u),
      /** WEEKDAY / WEEKNUM — 星期几 / 第几周 */
      WEEKDAY: (d, firstDay) => {
        const date = new Date(d);
        const day = date.getDay(); // 0=Sun .. 6=Sat
        if (firstDay === 2) return day === 0 ? 7 : day;        // Mon=1
        if (firstDay === 3) return day === 0 ? 6 : (day === 1 ? 7 : day - 1); // Tue=1
        return day + 1; // 默认 Sun=1
      },
      WEEKNUM: (d, firstDay) => {
        const date = new Date(d);
        const startOfYear = new Date(date.getFullYear(), 0, 1);
        const dayDiff = (date - startOfYear) / 86400000;
        const offset = (startOfYear.getDay() - (firstDay === 2 ? 1 : 0) + 7) % 7;
        return Math.floor((dayDiff + offset) / 7) + 1;
      },
      /** HOUR / MINUTE / SECOND — 时间提取 */
      HOUR: t => { const d = new Date(t); return isNaN(d) ? "#VALUE!" : d.getHours(); },
      MINUTE: t => { const d = new Date(t); return isNaN(d) ? "#VALUE!" : d.getMinutes(); },
      SECOND: t => { const d = new Date(t); return isNaN(d) ? "#VALUE!" : d.getSeconds(); },
      /** FREQUENCY — 频率分布（直方图数据源）*/
      FREQUENCY: (data, bins) => {
        const d = numList(data).sort((a, b) => a - b);
        const b = numList(bins).sort((a, b) => a - b);
        const out = new Array(b.length + 1).fill(0);
        let bi = 0;
        for (const v of d) {
          while (bi < b.length && v > b[bi]) bi++;
          out[bi]++;
        }
        return out;
      },
      /** REPLACE — 按位置替换文本（不同于 SUBSTITUTE 按内容）*/
      REPLACE: (oldTxt, start, len, newTxt) => {
        const s = String(oldTxt);
        const from = Math.max(0, (+start || 1) - 1);
        const to = from + Math.max(0, +len || 0);
        return s.slice(0, from) + String(newTxt) + s.slice(to);
      },
      /** T — 文本直通，非文本返回空 */
      T: v => typeof v === "string" ? v : "",
      /** N — 转数字，文本/布尔返回 0 或 1 */
      N: v => typeof v === "boolean" ? (+v) : (typeof v === "number" ? v : 0),
      /** FACT — 阶乘 */
      FACT: n => { if (n < 0 || n > 170) return "#NUM!"; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
      /** PI / SINE / COS / TAN — 三角函数 */
      PI: () => Math.PI,
      SIN: a => Math.sin(+a),
      COS: a => Math.cos(+a),
      TAN: a => Math.tan(+a),
      DEGREES: r => (+r) * 180 / Math.PI,
      RADIANS: d => (+d) * Math.PI / 180,
      /** FILTER — 动态数组筛选：按条件筛选数组，返回二维数组；条件为数组逐行 AND，多条件逐条件 OR（同 Excel）*/
      FILTER: (array, include, ifEmpty) => {
        const rows = _toRows(array);
        const incArr = _toFlat(include);
        const out = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          let keep = false;
          // include 可以是二维数组，每行整体作为一个条件组；也可以是一维，逐行布尔
          if (Array.isArray(incArr[i])) {
            // 多条件 OR：任一为真即保留
            keep = incArr[i].some(Boolean);
          } else {
            keep = !!incArr[i];
          }
          if (keep) out.push(row);
        }
        if (!out.length) return ifEmpty !== undefined ? ifEmpty : new Error("CALC#!");
        return out;
      },
      /** SORT — 动态数组排序：多列多级升/降序；返回二维数组 */
      SORT: (array, sortIndex, sortOrder, byCol) => {
        let rows = _toRows(array);
        if (!rows.length) return rows;
        if (sortIndex === undefined || sortIndex === 0) sortIndex = 1;
        const si = sortIndex | 0; // 1-based
        const asc = !(sortOrder === false || sortOrder === 0 || sortOrder === -1);
        // 支持多级：sortIndex 可以是数组（[1, 2]），sortOrder 也可以是数组
        const indices = Array.isArray(sortIndex) ? sortIndex : [sortIndex];
        const orders = Array.isArray(sortOrder) ? sortOrder : [asc];
        const parsed = rows.map((row, orig) => ({ row, orig }));
        parsed.sort((a, b) => {
          for (let k = 0; k < indices.length; k++) {
            const col = indices[k] - 1;
            const orderAsc = !(orders[k] === false || orders[k] === 0 || orders[k] === -1);
            const av = a.row[col], bv = b.row[col];
            let cmp;
            if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
            else cmp = String(av) < String(bv) ? -1 : (String(av) > String(bv) ? 1 : 0);
            if (!orderAsc) cmp = -cmp;
            if (cmp !== 0) return cmp;
          }
          return a.orig - b.orig;
        });
        return parsed.map(x => x.row);
      },
      /** UNIQUE — 动态数组去重：返回二维数组；可选 byCol=True 按列去重 */
      UNIQUE: (array, byCol, exactlyOnce) => {
        if (byCol) {
          // 按列去重（每列视为一行）
          const rows = _toRows(array);
          const cols = rows[0] ? rows[0].length : 0;
          const resultCols = [];
          const seenSet = new Set();
          for (let c = 0; c < cols; c++) {
            const colVals = rows.map(r => r[c]).join("\u0001");
            if (!seenSet.has(colVals)) { seenSet.add(colVals); resultCols.push(colVals); }
          }
          // 把结果重新转置回二维
          return [resultCols.map(v => v.split("\u0001")[0])]; // 简化：只返回第一列
        }
        const rows = _toRows(array);
        const seen = new Set();
        const out = [];
        const counter = new Map();
        for (const row of rows) {
          const key = row.join("\u0001");
          if (!exactlyOnce) {
            if (!seen.has(key)) { seen.add(key); out.push(row); }
          } else {
            counter.set(key, (counter.get(key) || 0) + 1);
          }
        }
        if (exactlyOnce) {
          for (const row of rows) {
            const key = row.join("\u0001");
            if (counter.get(key) === 1) out.push(row);
          }
        }
        return out;
      },
      /** SORTBY — 按一列或多列排序（按值排序，返回原始行）*/
      SORTBY: (array, by, order, ...rest) => {
        const rows = _toRows(array);
        if (!rows.length) return rows;
        const parsed = rows.map((row, orig) => ({ row, orig }));
        // by: 可以是一个条件列数组，或多个（rest 继续给）
        let byList = [by, ...rest];
        // order 单值 → 全用；数组 → 逐列配
        let orders;
        if (Array.isArray(order)) orders = order;
        else orders = byList.map(() => !(order === false || order === 0));
        // 取各条件列（一维）
        const keyCols = byList.map(b => _toFlat(b));
        parsed.sort((a, b) => {
          for (let k = 0; k < keyCols.length; k++) {
            const col = keyCols[k];
            const av = col[a.orig], bv = col[b.orig];
            let cmp;
            if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
            else cmp = String(av) < String(bv) ? -1 : (String(av) > String(bv) ? 1 : 0);
            if (!orders[k]) cmp = -cmp;
            if (cmp !== 0) return cmp;
          }
          return 0;
        });
        return parsed.map(x => x.row);
      },
      /** TOCOL / TOROW — 把二维数组摊平成一列/一行 */
      TOCOL: (array, ignoreBlanks, byCol) => {
        const rows = _toRows(array); const out = [];
        if (!byCol) {
          for (const row of rows) for (const v of row) if (!ignoreBlanks || (v !== "" && v != null)) out.push([v]);
        } else {
          const cols = rows[0] ? rows[0].length : 0;
          for (let c = 0; c < cols; c++) for (const row of rows) if (!ignoreBlanks || (row[c] !== "" && row[c] != null)) out.push([row[c]]);
        }
        return out;
      },
      TOROW: (array, ignoreBlanks, byCol) => {
        const coled = FUNCS.TOCOL(array, ignoreBlanks, byCol).map(r => r[0]);
        return [coled];
      },
      /** VSTACK / HSTACK — 纵向/横向拼接多个数组 */
      VSTACK: (...args) => {
        const out = [];
        for (const a of args) {
          const rows = _toRows(a);
          if (rows.length === 1 && rows[0].length === 1) { out.push([rows[0][0]]); continue; }
          for (const row of rows) out.push(row.slice());
        }
        return out;
      },
      HSTACK: (...args) => {
        let maxRows = 0;
        const all = args.map(a => _toRows(a));
        for (const rows of all) if (rows.length > maxRows) maxRows = rows.length;
        const out = [];
        for (let r = 0; r < maxRows; r++) {
          const row = [];
          for (const rows of all) {
            if (!rows.length) continue;
            const targetRow = rows[r] || new Array(rows[0].length).fill("");
            row.push(...targetRow);
          }
          out.push(row);
        }
        return out;
      },
      /** XLOOKUP — VLOOKUP 进化版，双向查找 + 默认精确匹配 + 自定义返回列 */
      XLOOKUP: (lookup, lookupRange, returnRange, ifNotFound, matchMode) => {
        const lr = Array.isArray(lookupRange) ? flat(lookupRange) : [lookupRange];
        let idx = -1;
        const mode = matchMode | 0; // 0=精确, -1=精确或下一个更小, 1=精确或下一个更大, 2=通配符
        if (mode === 0 || mode === 2) {
          for (let i = 0; i < lr.length; i++) {
            if (mode === 2) { if (_wlMatch(String(lr[i] || ""), String(lookup || ""))) { idx = i; break; } }
            else if (lr[i] == lookup) { idx = i; break; }
          }
        } else {
          // 近似匹配：二分 + 回退
          const arr = lr.map((v, i) => ({ v: typeof v === "number" ? v : parseFloat(v) || 0, i }));
          arr.sort((a, b) => a.v - b.v);
          let lo = 0, hi = arr.length - 1;
          while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].v < lookup) lo = mid + 1; else hi = mid - 1; }
          idx = mode === 1 ? (lo < arr.length ? arr[lo].i : -1) : (hi >= 0 ? arr[hi].i : -1);
        }
        if (idx < 0) return ifNotFound == null ? "#N/A" : ifNotFound;
        const rr = Array.isArray(returnRange) ? flat(returnRange) : [returnRange];
        return rr[idx] !== undefined ? rr[idx] : (ifNotFound == null ? "#N/A" : ifNotFound);
      },
      /** AGGREGATE — 忽略错误/隐藏行的聚合（简化版，只处理数组错误）*/
      AGGREGATE: (func, opt, ...args) => {
        if (args.length < 1) return "#VALUE!";
        const skipErrors = (opt & 1) === 1;
        // 扁平化所有参数（支持范围 + 多参数）
        let flatAll = [];
        for (const a of args) {
          if (Array.isArray(a)) for (const row of a) flatAll = flatAll.concat(Array.isArray(row) ? row : [row]);
          else flatAll.push(a);
        }
        // 过滤错误
        const nums = skipErrors ? flatAll.filter(x => !FUNCS.ISERROR(x) && FUNCS.ISNUMBER(x)).map(num) : numList(flatAll);
        if (!nums.length && [1,2,3,4,5,6,7,8,9].includes(func)) return func === 1 ? "#NUM!" : 0;
        switch (+func) {
          case 1:  return nums.length ? sum(nums) / nums.length : "#NUM!";          // AVERAGE
          case 2:  return nums.length ? nums.length : "#NUM!";                      // COUNT
          case 3:  return flatAll.filter(x => x !== "" && x != null).length;        // COUNTA
          case 4:  return nums.length ? Math.max(...nums) : "#NUM!";                // MAX
          case 5:  return nums.length ? Math.min(...nums) : "#NUM!";                // MIN
          case 6:  return nums.reduce((p, x) => p * x, 1);                          // PRODUCT
          case 7:  { const m = sum(nums) / nums.length; return Math.sqrt(nums.reduce((s, x) => s + (x - m) ** 2, 0) / (nums.length - 1)); } // STDEV
          case 8:  { const m = sum(nums) / nums.length; return Math.sqrt(nums.reduce((s, x) => s + (x - m) ** 2, 0) / nums.length); }    // STDEV.P
          case 9:  return sum(nums);                                                // SUM
          default: return "#NAME?";
        }
      },
      // ========== Excel 365 新函数（2025 年最常用） ==========
      /** GROUPBY — 按字段分组 + 汇总（自动透视表替代）
       *  语法：GROUPBY(groupByArray, valuesArray, [function], [no_results])
       *  简化版：只支持 SUM / COUNT / AVERAGE / MAX / MIN / 自定义
       *  返回二维数组：第 1 列 = 分组键，第 2 列 = 汇总值
       */
      GROUPBY: (groupBy, values, fn, ifEmpty) => {
        const gRows = _toRows(groupBy);
        const vRows = _toRows(values);
        if (!gRows.length) return ifEmpty != null ? ifEmpty : "#CALC!";
        const func = fn || "SUM";
        const groups = new Map(); // key → [vals...]
        for (let i = 0; i < gRows.length; i++) {
          const key = String(gRows[i][0] ?? "");
          const valRow = vRows[i] || [0];
          const val = valRow.length === 1 ? valRow[0] : valRow;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(val);
        }
        const result = [];
        for (const [key, vals] of groups) {
          const nums = numList(vals);
          let agg;
          if (typeof func === "function") {
            try { agg = func(nums); } catch { agg = "#CALC!"; }
          } else {
            const F = String(func).toUpperCase();
            if (F === "SUM") agg = nums.reduce((a, b) => a + b, 0);
            else if (F === "COUNT") agg = nums.length;
            else if (F === "AVERAGE") agg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : ifEmpty != null ? ifEmpty : 0;
            else if (F === "MAX") agg = nums.length ? Math.max(...nums) : ifEmpty != null ? ifEmpty : "#NUM!";
            else if (F === "MIN") agg = nums.length ? Math.min(...nums) : ifEmpty != null ? ifEmpty : "#NUM!";
            else if (F === "PRODUCT") agg = nums.reduce((a, b) => a * b, 1);
            else agg = "#CALC!";
          }
          result.push([key, agg]);
        }
        return result;
      },
      /** LET — 在公式内定义局部变量
       *  语法：LET(name1, val1, name2, val2, ..., calc)
       *  简化版：不实现真正的变量作用域（需 evalNode 改造），
       *  改为把所有 name=val 对先算出来，再把 calc 里的名字替换成值
       */
      LET: () => "#CALC!", // 占位，真正的 LET 在 evalNode 语法级处理（带 scope）
      LAMBDA: () => "#CALC!", // 占位，真正的 LAMBDA 在 evalNode 语法级处理
      /** SEQUENCE — 生成序列
       *  语法：SEQUENCE(rows, [cols], [start], [step])
       *  返回 rows×cols 的二维数组
       */
      SEQUENCE: (rows, cols, start, step) => {
        const r = Math.max(1, +rows || 1);
        const c = Math.max(1, +cols || 1);
        const s = start != null ? +start : 1;
        const d = step != null ? +step : 1;
        const out = [];
        for (let i = 0; i < r; i++) {
          const row = [];
          for (let j = 0; j < c; j++) {
            row.push(s + (i * c + j) * d);
          }
          out.push(row);
        }
        return out;
      },
      /** TEXTSPLIT — 多分隔符同时拆分
       *  语法：TEXTSPLIT(text, colDelimiter, [rowDelimiter], [ignoreEmpty], [padWith])
       *  简化版：只支持 colDelimiter，返回一维数组
       */
      TEXTSPLIT: (text, colDelim, rowDelim, ignoreEmpty, padWith) => {
        const s = String(text == null ? "" : text);
        if (s === "") return [];
        const delims = Array.isArray(colDelim) ? colDelim.map(x => String(x)) : [String(colDelim)];
        // 用第一个分隔符 split 后，再把其余分隔符替换为空（简化处理）
        let result = [s];
        for (const d of delims) {
          result = result.flatMap(p => String(p).split(d));
        }
        if (ignoreEmpty !== false) result = result.filter(x => x !== "");
        return result;
      },
      /** TEXTBEFORE — 提取指定分隔符前的文本 */
      TEXTBEFORE: (text, delimiter, instanceNum, matchMode) => {
        const s = String(text == null ? "" : text);
        const d = String(delimiter == null ? "" : delimiter);
        if (d === "" || s === "") return "";
        let idx;
        if (matchMode === 1) { // 从右往左数
          const parts = s.split(d);
          const i = (instanceNum || 1) - 1;
          return parts.slice(0, parts.length - i).join(d);
        } else {
          idx = 0;
          for (let i = 0; i < (instanceNum || 1); i++) {
            idx = s.indexOf(d, idx);
            if (idx < 0) return "";
            idx += d.length;
          }
          return s.slice(0, idx - d.length);
        }
      },
      /** TEXTAFTER — 提取指定分隔符后的文本 */
      TEXTAFTER: (text, delimiter, instanceNum, matchMode) => {
        const s = String(text == null ? "" : text);
        const d = String(delimiter == null ? "" : delimiter);
        if (d === "" || s === "") return "";
        if (matchMode === 1) {
          const parts = s.split(d);
          const i = (instanceNum || 1) - 1;
          return parts.slice(i + 1).join(d);
        } else {
          let idx = 0;
          for (let i = 0; i < (instanceNum || 1); i++) {
            idx = s.indexOf(d, idx);
            if (idx < 0) return "";
            idx += d.length;
          }
          return s.slice(idx);
        }
      },
      /** CHOOSECOLS — 选数组的指定列，返回新数组 */
      CHOOSECOLS: (array, ...cols) => {
        const rows = _toRows(array);
        if (!rows.length) return [];
        return rows.map(row => cols.map(c => row[c - 1] !== undefined ? row[c - 1] : null));
      },
      /** CHOOSEROWS — 选数组的指定行，返回新数组 */
      CHOOSEROWS: (array, ...rows) => {
        const all = _toRows(array);
        return rows.map(r => all[r - 1] !== undefined ? all[r - 1] : null);
      },
      /** TAKE — 取数组前/后 N 行/列
       *  TAKE(array, rows, [cols])：rows 正数从前往后，负数从后往前
       */
      TAKE: (array, rows, cols) => {
        const all = _toRows(array);
        if (!all.length) return [];
        let r0, rN;
        if (rows > 0) { r0 = 0; rN = Math.min(rows, all.length); }
        else { r0 = Math.max(0, all.length + rows); rN = all.length - r0; }
        const sel = all.slice(r0, r0 + rN);
        if (cols == null) return sel;
        const C = all[0] ? all[0].length : 0;
        let c0, cN;
        if (cols > 0) { c0 = 0; cN = Math.min(cols, C); }
        else { c0 = Math.max(0, C + cols); cN = C - c0; }
        return sel.map(row => row.slice(c0, c0 + cN));
      },
      /** DROP — 删数组前/后 N 行/列 */
      DROP: (array, rows, cols) => {
        const all = _toRows(array);
        if (!all.length) return [];
        let r0, r1;
        if (rows > 0) { r0 = rows; r1 = all.length; }
        else if (rows < 0) { r0 = 0; r1 = all.length + rows; }
        else { r0 = 0; r1 = all.length; }
        const sel = all.slice(r0, r1);
        if (cols == null || !sel.length) return sel;
        const C = all[0].length;
        let c0, c1;
        if (cols > 0) { c0 = cols; c1 = C; }
        else if (cols < 0) { c0 = 0; c1 = C + cols; }
        else { c0 = 0; c1 = C; }
        return sel.map(row => row.slice(c0, c1));
      },
      /** ROUND / ROWS / COLUMNS 已有，COUNTA 已有 */
      /** UNIQUE / SORT / SORTBY 已有（动态数组） */
      /** === 高级数组函数占位：在 evalNode 里被特殊路径拦截 === */
      MAP: () => "#CALC!", BYROW: () => "#CALC!", BYCOL: () => "#CALC!",
      MAPROWS: () => "#CALC!", MAPCOLS: () => "#CALC!",
      REDUCE: () => "#CALC!", SCAN: () => "#CALC!", MAKEARRAY: () => "#CALC!",
      /** PIVOTBY — Excel 365 代码级透视表（比 GROUPBY 强）
       *  PIVOTBY(values, rows, cols, function, [row_labels], [col_labels])
       *  - values: 要汇总的数值区域（通常一列）
       *  - rows: 行分组键区域（一列）
       *  - cols: 列分组键区域（一列），可以省略 → 退化成 GROUPBY
       *  - function: 字符串 "SUM"/"COUNT"/"AVG"/"MIN"/"MAX"/"PRODUCT"，或 LAMBDA(values, expr)
       *  返回：二维数组，首行=所有 colKey（横向表头），首列=所有 rowKey（纵向表头），交叉=汇总值
       */
      PIVOTBY: function(values, rows, cols, fn, rowLabels, colLabels) {
        // Excel 签名：PIVOTBY(values, rows, cols, function) — 4 参数
        // 3 参数兼容：PIVOTBY(values, rows, function) — 省略 cols，退化成单列透视（= GROUPBY 加强版）
        const argLen = arguments.length;
        let colKeysArr = null;
        let aggArg;
        if (argLen >= 4) {
          // 4 参数：fn 在第 4 位
          colKeysArr = _toRows(cols);
          aggArg = fn;
        } else {
          // 3 参数：fn 在第 3 位（cols 省略）
          aggArg = cols;
        }
        const valsArr = _toRows(values);
        const rowKeysArr = _toRows(rows);

        // 汇总函数：字符串（SUM/COUNT/AVG...）或 LAMBDA 对象（带 __lambda 属性）
        const agg = (aggArg && aggArg.__lambda) ? aggArg : String(aggArg || "SUM").toUpperCase();

        // 双层 bucket：Map<rowKey, Map<colKey, [val...]>>
        const rowBucket = new Map();
        const allRowKeys = [], allColKeys = [];
        // 取行数（取 rows 和 values 中较长的）
        const R = Math.max(valsArr.length, rowKeysArr.length, colKeysArr ? colKeysArr.length : 0);
        for (let i = 0; i < R; i++) {
          const rowKey = String((rowKeysArr[i] && rowKeysArr[i][0]) ?? "");
          const valArr = valsArr[i] || [];
          if (!rowBucket.has(rowKey)) { rowBucket.set(rowKey, new Map()); allRowKeys.push(rowKey); }
          const inner = rowBucket.get(rowKey);
          let colKey = "(全部)";
          if (colKeysArr) {
            colKey = String((colKeysArr[i] && colKeysArr[i][0]) ?? "");
          }
          if (!inner.has(colKey)) inner.set(colKey, []);
          for (const v of valArr) {
            if (v !== "" && v !== null && v !== undefined && !isNaN(Number(v))) {
              inner.get(colKey).push(Number(v));
            }
          }
          if (colKeysArr && !allColKeys.includes(colKey)) allColKeys.push(colKey);
        }
        // 如果没有 col 分组，退化成单列透视表
        if (!colKeysArr) allColKeys.push("(全部)");

        // 排序表头（保持首次出现顺序）
        // 应用汇总
        function applyAgg(nums) {
          if (!nums.length) return 0; // 空 bucket 返回 0（Excel 行为）
          if (agg && agg.__lambda) {
            // LAMBDA：nums 作为参数调用
            try {
              const callScope = Object.assign({}, agg.closure || {});
              // LAMBDA 只有 1 个参数时传整个数组；多参数时传 nums[0]
              if (agg.params.length === 1) {
                callScope[agg.params[0]] = nums;
                return evalNode(agg.body, () => 0, callScope);
              } else {
                // 多参数时把 nums 展开（简化）
                for (let i = 0; i < agg.params.length && i < nums.length; i++)
                  callScope[agg.params[i]] = nums[i];
                return evalNode(agg.body, () => 0, callScope);
              }
            } catch(e) { return "#CALC!"; }
          }
          if (agg === "SUM") return nums.reduce((a,b)=>a+b, 0);
          if (agg === "COUNT") return nums.length;
          if (agg === "AVG") return nums.reduce((a,b)=>a+b,0)/nums.length;
          if (agg === "MIN") return Math.min(...nums);
          if (agg === "MAX") return Math.max(...nums);
          if (agg === "PRODUCT") return nums.reduce((a,b)=>a*b, 1);
          // 尝试：fn 是普通 function（FUNCS 里的）
          if (typeof agg === "function") { try { return agg(nums); } catch(e) { return "#VALUE!"; } }
          return "#CALC!";
        }

        // 组装返回二维数组
        // 如果没有 col 分组：单列透视表，返回 [rowKey, val] 两列（不加额外表头列）
        // 如果有 col 分组：[空, colKey1, colKey2, ...], [rowKey1, v11, v12, ...]
        const result = [];
        if (!colKeysArr) {
          // 单列透视：首列 rowKey，次列汇总值；不加表头行（Excel 行为）
          for (const rk of allRowKeys) {
            const inner = rowBucket.get(rk);
            const nums = inner.get("(全部)") || [];
            result.push([rk, applyAgg(nums)]);
          }
        } else {
          // 双层透视：首行=表头
          result.push([""].concat(allColKeys));
          for (const rk of allRowKeys) {
            const row = [rk];
            const inner = rowBucket.get(rk);
            for (const ck of allColKeys) {
              const nums = inner.get(ck) || [];
              row.push(applyAgg(nums));
            }
            result.push(row);
          }
        }
        return result;
      },
      /** PIVOTWIDE — PIVOTBY 别名 */
      PIVOTWIDE: function(values, rows, cols, fn) { return FUNCS.PIVOTBY(values, rows, cols, fn); },

      // ========== 高频基础函数（纯 FUNCS，无 evalNode 改动） ==========
      /** TRANSPOSE — 数组转置（行列互换） */
      TRANSPOSE: (array) => {
        const rows = _toRows(array);
        if (!rows.length) return [];
        const C = rows[0].length;
        const out = [];
        for (let c = 0; c < C; c++) {
          const row = [];
          for (const r of rows) row.push(r[c] !== undefined ? r[c] : null);
          out.push(row);
        }
        return out;
      },
      /** TEXTJOIN — 带分隔符拼接文本（支持忽略空值）
       *  TEXTJOIN(delimiter, ignoreEmpty, text1, [text2], ...)
       */
      TEXTJOIN: (delim, ignoreEmpty, ...texts) => {
        const d = String(delim == null ? "" : delim);
        const flatTexts = flat(texts).filter(x => !Array.isArray(x));
        if (ignoreEmpty) {
          return flatTexts.filter(x => x !== "" && x != null).map(x => String(x)).join(d);
        }
        return flatTexts.map(x => String(x == null ? "" : x)).join(d);
      },
      /** CHOOSE — 按索引选值
       *  CHOOSE(index, val1, val2, ...)  index=1 选 val1
       */
      CHOOSE: (idx, ...vals) => {
        const i = +idx;
        if (!Number.isInteger(i) || i < 1 || i > vals.length) return "#VALUE!";
        return vals[i - 1];
      },
      /** XOR — 异或（奇数个 TRUE → TRUE） */
      XOR: (...args) => {
        const flatAll = flat(args);
        let trueCount = 0;
        for (const x of flatAll) if (x) trueCount++;
        return trueCount % 2 === 1;
      },
      /** MROUND — 四舍五入到指定倍数（不同符号 #NUM!） */
      MROUND: (num, multiple) => {
        const n = +num, m = +multiple;
        if (m === 0) return 0;
        if ((n > 0 && m < 0) || (n < 0 && m > 0)) return "#NUM!";
        return Math.round(n / m) * m;
      },
      /** SUMSQ — 平方和 */
      SUMSQ: (...args) => {
        const nums = numList(args);
        return nums.reduce((s, x) => s + x * x, 0);
      },
      /** COMBIN — 组合数 C(n, k) = n!/(k!(n-k)!) */
      COMBIN: (n, k) => {
        n = +n; k = +k;
        if (n < 0 || k < 0 || k > n || !Number.isInteger(n) || !Number.isInteger(k)) return "#NUM!";
        if (k === 0 || k === n) return 1;
        // C(n,k) = C(n, n-k) 取小的算
        if (k > n - k) k = n - k;
        let r = 1;
        for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
        return Math.round(r);
      },
      /** PERMUT — 排列数 P(n, k) = n!/(n-k)! */
      PERMUT: (n, k) => {
        n = +n; k = +k;
        if (n < 0 || k < 0 || k > n || !Number.isInteger(n) || !Number.isInteger(k)) return "#NUM!";
        let r = 1;
        for (let i = 0; i < k; i++) r *= (n - i);
        return r;
      },
      /** CORREL — Pearson 相关系数
       *  CORREL(array1, array2)
       */
      CORREL: (a1, a2) => {
        const x = numList([a1]);
        const y = numList([a2]);
        const n = Math.min(x.length, y.length);
        if (n < 2) return "#N/A";
        const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
        const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
        let num = 0, dx2 = 0, dy2 = 0;
        for (let i = 0; i < n; i++) {
          const dx = x[i] - mx, dy = y[i] - my;
          num += dx * dy;
          dx2 += dx * dx;
          dy2 += dy * dy;
        }
        if (dx2 === 0 || dy2 === 0) return "#DIV/0!";
        return num / Math.sqrt(dx2 * dy2);
      },
      // ========== 2025-10 新增纯 FUNCS 批量补 ==========
      /** HYPERLINK — 返回显示文本（真正的超链接是 UI 层）
       *  HYPERLINK(link, [friendlyName])
       */
      HYPERLINK: (link, friendly) => friendly != null ? friendly : String(link == null ? "" : link),
      /** COUNTUNIQUE — 计算去重后的值个数（严格类型：1 和 TRUE 不同）
       *  COUNTUNIQUE(value1, [value2], ...)  支持单值 + 范围 + 多参数
       */
      COUNTUNIQUE: (...args) => {
        const seen = new Set();
        const flatAll = flat(args);
        for (const v of flatAll) {
          if (Array.isArray(v)) continue;
          // 用 typeof + String 双保险：Excel 里 1 !== TRUE，string 1 !== 数字 1
          const key = typeof v === "string" ? "S:" + v : typeof v === "number" ? "N:" + v : typeof v === "boolean" ? "B:" + v : "X:" + (v == null ? "" : String(v));
          seen.add(key);
        }
        return seen.size;
      },
      /** WRAPROWS — 把一维数组按指定列数折成二维（Excel 365）
       *  WRAPROWS(array, colCount, [pad])
       *  不足部分用 pad 填（默认 #N/A）
       */
      WRAPROWS: (array, colCount, pad) => {
        const arr = flat(array).filter(x => !Array.isArray(x));
        const c = +colCount;
        if (!c || c < 1) return "#VALUE!";
        const PAD = pad === undefined || pad === null ? "#N/A" : pad;
        const totalRows = Math.ceil(arr.length / c);
        const out = [];
        for (let r = 0; r < totalRows; r++) {
          const row = [];
          for (let i = 0; i < c; i++) {
            const idx = r * c + i;
            row.push(idx < arr.length ? arr[idx] : PAD);
          }
          out.push(row);
        }
        return out;
      },
      /** WRAPCOLS — 按指定行数折成二维后转置（Excel 365）
       *  WRAPCOLS(array, rowCount, [pad])
       */
      WRAPCOLS: (array, rowCount, pad) => {
        const r = +rowCount;
        if (!r || r < 1) return "#VALUE!";
        const rows = FUNCS.WRAPROWS(array, r, pad);
        return FUNCS.TRANSPOSE(rows);
      },
      /** ADDRESS — 返回单元格地址字符串
       *  ADDRESS(row, col, [absMode], [a1], [sheet])
       *  absMode: 1=绝对($A$1), 2=行绝对(A$1), 3=列绝对($A1), 4=相对(A1)
       */
      ADDRESS: (row, col, absMode, a1, sheet) => {
        const r = +row, c = +col;
        if (r < 1 || c < 1) return "#VALUE!";
        const mode = absMode == null ? 1 : +absMode;
        const colLetter = idxToCol(c);
        const rowStr = String(r);
        let addr;
        switch (mode) {
          case 1: addr = `$${colLetter}$${rowStr}`; break;
          case 2: addr = `${colLetter}$${rowStr}`; break;
          case 3: addr = `$${colLetter}${rowStr}`; break;
          case 4: addr = `${colLetter}${rowStr}`; break;
          default: addr = `${colLetter}${rowStr}`;
        }
        if (sheet != null && sheet !== "") {
          const sheetStr = String(sheet);
          // 有空格/特殊字符 → 单引号包裹 + 单引号双写转义
          const needsQuote = /[\s!@#$%^&*()+=\-[\]{};:'",<>/?\\|`~]/.test(sheetStr);
          const safeSheet = needsQuote ? `'${sheetStr.replace(/'/g, "''")}'` : sheetStr;
          addr = `${safeSheet}!${addr}`;
        }
        return addr;
      },
      // ========== 统计三件套：线性回归 ==========
      /** 线性回归辅助：返回 { n, mx, my, numΣ, dx2Σ, dy2Σ } 或 null
       *  供 SLOPE / INTERCEPT / FORECAST.LINEAR 共用
       */
      _linReg: (yArr, xArr) => {
        const y = numList([yArr]);
        const x = numList([xArr]);
        const n = Math.min(y.length, x.length);
        if (n < 2) return null;
        let sx = 0, sy = 0;
        for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
        const mx = sx / n, my = sy / n;
        let num = 0, dx2 = 0, dy2 = 0;
        for (let i = 0; i < n; i++) {
          const dx = x[i] - mx, dy = y[i] - my;
          num += dx * dy;
          dx2 += dx * dx;
          dy2 += dy * dy;
        }
        return { n, mx, my, num, dx2, dy2 };
      },
      /** SLOPE — 线性回归斜率
       *  SLOPE(known_y's, known_x's)  注意：y 在前！
       */
      SLOPE: (yArr, xArr) => {
        const r = FUNCS._linReg(yArr, xArr);
        if (!r) return "#N/A";
        if (r.dx2 === 0) return "#DIV/0!";
        return r.num / r.dx2;
      },
      /** INTERCEPT — 线性回归截距
       *  INTERCEPT(known_y's, known_x's)  y 在前！
       */
      INTERCEPT: (yArr, xArr) => {
        const r = FUNCS._linReg(yArr, xArr);
        if (!r) return "#N/A";
        if (r.dx2 === 0) return "#DIV/0!";
        const slope = r.num / r.dx2;
        return r.my - slope * r.mx;
      },
      /** FORECAST.LINEAR — 线性回归预测
       *  FORECAST.LINEAR(x, known_y's, known_x's)  x 在前！
       */
      "FORECAST.LINEAR": (xVal, yArr, xArr) => {
        const r = FUNCS._linReg(yArr, xArr);
        if (!r) return "#N/A";
        if (r.dx2 === 0) return "#DIV/0!";
        const slope = r.num / r.dx2;
        return slope * (+xVal) + (r.my - slope * r.mx);
      },
      FORECAST: (xVal, yArr, xArr) => FUNCS["FORECAST.LINEAR"](xVal, yArr, xArr), // 别名
      // ============ 统计分布类 ============
      /** NORM.DIST — 正态分布 (PDF/CDF)
       *  NORM.DIST(x, mean, sd, cumulative)
       */
      "NORM.DIST": (x, mean, sd, cumulative) => {
        if (sd <= 0) return "#NUM!";
        if (cumulative) return _normCdf(+x, +mean, +sd);
        // PDF: 1/(σ√(2π)) * e^(-(x-μ)²/(2σ²))
        const z = (+x - +mean) / +sd;
        return Math.exp(-0.5 * z * z) / (+sd * Math.sqrt(2 * Math.PI));
      },
      /** NORM.S.DIST — 标准正态分布 (NORM.DIST(x, 0, 1, cumulative)) */
      "NORM.S.DIST": (z, cumulative) => FUNCS["NORM.DIST"](z, 0, 1, cumulative),
      /** BINOM.DIST — 二项分布
       *  BINOM.DIST(k, n, p, cumulative)
       *  大 n(>170) 用 log-space 防阶乘溢出
       */
      "BINOM.DIST": (k, n, p, cumulative) => {
        k = Math.round(+k); n = Math.round(+n); p = +p;
        if (k < 0 || k > n) return 0;
        if (p < 0 || p > 1) return "#NUM!";
        // log-space: PMF = C(n,k) * p^k * (1-p)^(n-k)
        const logPmf = () => {
          const lc = _logFactorial(n) - _logFactorial(k) - _logFactorial(n - k);
          return Math.exp(lc + k * Math.log(p) + (n - k) * Math.log(1 - p));
        };
        if (!cumulative) return logPmf();
        // CDF: 累加 PMF(0..k)
        let sum = 0;
        for (let i = 0; i <= k; i++) {
          const lc = _logFactorial(n) - _logFactorial(i) - _logFactorial(n - i);
          sum += Math.exp(lc + i * Math.log(p) + (n - i) * Math.log(1 - p));
        }
        return sum;
      },
      /** POISSON.DIST — 泊松分布
       *  POISSON.DIST(x, mean, cumulative)
       */
      "POISSON.DIST": (x, mean, cumulative) => {
        x = Math.round(+x); mean = +mean;
        if (x < 0) return "#NUM!";
        if (mean <= 0) return 0;
        const logPmf = (i) => i * Math.log(mean) - mean - _logFactorial(i);
        if (!cumulative) return Math.exp(logPmf(x));
        let sum = 0;
        for (let i = 0; i <= x; i++) sum += Math.exp(logPmf(i));
        return sum;
      },
      /** EXPON.DIST — 指数分布
       *  EXPON.DIST(x, lambda, cumulative)
       *  PDF: λ * e^(-λx), CDF: 1 - e^(-λx)
       */
      "EXPON.DIST": (x, lambda, cumulative) => {
        x = +x; lambda = +lambda;
        if (x < 0 || lambda <= 0) return "#NUM!";
        if (cumulative) return 1 - Math.exp(-lambda * x);
        return lambda * Math.exp(-lambda * x);
      },
      /** NORM.INV — 正态分布反函数 (Acklam 有理近似)
       *  NORM.INV(probability, mean, sd)
       *  NORM.S.INV(p) = NORM.INV(p, 0, 1)
       */
      "NORM.INV": (p, mean, sd) => {
        p = +p; mean = +mean; sd = +sd;
        if (p <= 0 || p >= 1) return "#NUM!";
        if (sd <= 0) return "#NUM!";
        const z = _acklamInvNorm(p);
        return mean + sd * z;
      },
      "NORM.S.INV": (p) => FUNCS["NORM.INV"](p, 0, 1),
      /** WEIBULL.DIST — 韦伯分布
       *  WEIBULL.DIST(x, alpha, beta, cumulative)
       *  PDF: (α/β) (x/β)^(α-1) e^(-(x/β)^α)
       *  CDF: 1 - e^(-(x/β)^α)
       */
      "WEIBULL.DIST": (x, alpha, beta, cumulative) => {
        x = +x; alpha = +alpha; beta = +beta;
        if (x < 0 || alpha <= 0 || beta <= 0) return "#NUM!";
        const xx = x / beta;
        const powA = Math.pow(xx, alpha);
        if (cumulative) return 1 - Math.exp(-powA);
        return (alpha / beta) * Math.pow(xx, alpha - 1) * Math.exp(-powA);
      },
      // ============ 财务函数（续） ============
      /** NPER — 期数 */
      NPER: (rate, pmt, pv, fv, type) => {
        const r = +rate, p = +pmt, pv0 = +pv;
        const f = fv != null ? +fv : 0;
        const t = type != null ? +type : 0;
        const adj = t === 1 ? (1 + r) : 1;
        if (r === 0) return -(pv0 + f) / p;
        // 从 PV = -PMT*adj * (1-(1+r)^-n)/r  + FV*(1+r)^-n 解 n
        const num = pv0 + p * adj / r;
        const den = f + p * adj / r;
        if (den === 0) return "#DIV/0!";
        const ratio = num / den;  // ratio = (1+r)^-n
        if (ratio <= 0) return "#NUM!";
        return -Math.log(ratio) / Math.log(1 + r);
      },
      /** RATE — 利率（牛顿迭代）
       *  RATE(nper, pmt, pv, [fv=0], [type=0], [guess=0.1])
       *  用 FV(r) = -PV*(1+r)^n - PMT*((1+r)^n-1)/r*adj - target 做零点
       */
      RATE: (nper, pmt, pv, fv, type, guess) => {
        const n = +nper, p = +pmt, pv0 = +pv;
        const f = fv != null ? +fv : 0;
        const t = type != null ? +type : 0;
        let r = guess != null ? +guess : 0.1;
        for (let iter = 0; iter < 50; iter++) {
          const fvCalc = _tvmFVcore(r, n, p, pv0, t);
          const h = 1e-8;
          const fvP = _tvmFVcore(r + h, n, p, pv0, t);
          const dfv = (fvP - fvCalc) / h;
          if (Math.abs(dfv) < 1e-15) return "#NUM!";
          r -= (fvCalc - f) / dfv;
          if (r <= -1) return "#NUM!";
          if (Math.abs((fvCalc - f)) < 1e-10) return r;
        }
        return "#NUM!";
      },
      // ============ 财务函数 ============
      /** NPV — 净现值
       *  NPV(rate, value1, [value2], ...)
       *  ⚠️ 时间轴契约（Excel 官方）：第一个 value 是第 1 期末（不是第 0 期），
       *      初始投资应放在 NPV 外面：NPV(rate, CF1, CF2, ...) + CF0
       *  NPV = Σ CF_i / (1+rate)^i   for i = 1..n
       */
      NPV: (rate, ...values) => {
        const r = +rate;
        if (r === -1) return "#DIV/0!";
        const flat = [];
        for (const v of values) {
          if (Array.isArray(v)) for (const x of flat([v])) flat.push(x);
          else flat.push(v);
        }
        let npv = 0;
        for (let i = 0; i < flat.length; i++) {
          const cf = +flat[i];
          if (!isFinite(cf)) continue;
          npv += cf / Math.pow(1 + r, i + 1); // i+1 = 第 1 期起
        }
        return npv;
      },
      /** IRR — 内部收益率（牛顿迭代）
       *  IRR(values, [guess=0.1])
       *  时间轴契约：values[0] = 第 0 期（通常是负的初始投资），values[1] = 第 1 期...
       *  收敛条件 |Δrate| < 1e-7 或 20 次迭代
       */
      IRR: () => "#CALC!", // 走 evalNode 特殊路径
      /** PV — 现值
       *  PV(rate, nper, pmt, [fv=0], [type=0])
       *  type=0 → 期末支付（默认）；type=1 → 期初支付
       */
      PV: (rate, nper, pmt, fv, type) => {
        const r = +rate, n = +nper, p = +pmt;
        const f = fv != null ? +fv : 0;
        const adj = _tvmAdj(type != null ? +type : 0, r);
        if (r === 0) return (-p * n - f) * adj;
        const pow = Math.pow(1 + r, n);
        return (-p * (1 - 1 / pow) / r - f / pow) * adj;
      },
      /** FV — 终值 */
      FV: (rate, nper, pmt, pv, type) => {
        const pv0 = pv != null ? +pv : 0;
        return _tvmFVcore(+rate, +nper, +pmt, pv0, type != null ? +type : 0);
      },
      /** PMT — 年金（等额还款） */
      PMT: (rate, nper, pv, fv, type) => {
        const r = +rate, n = +nper, p = +pv;
        const f = fv != null ? +fv : 0;
        const adj = _tvmAdj(type != null ? +type : 0, r);
        if (r === 0) return -(p + f) / n;
        const pow = Math.pow(1 + r, n);
        return -(p * pow + f) * r / ((pow - 1) * adj);
      },
      // OFFSET / INDIRECT — 需要 getCell 动态范围解析，evalNode 特殊路径拦截
      OFFSET: () => "#CALC!",
      INDIRECT: () => "#CALC!",
      // ISFORMULA / FORMULATEXT — 需要原始 cell 数据（.f 字段），evalNode 特殊路径拦截
      ISFORMULA: () => "#CALC!",
      FORMULATEXT: () => "#CALC!",
    };

    // ============ 统计分布数学辅助 ============
    /** 误差函数 erf — Abramowitz & Stegun 7.1.26 近似 (精度 ~1e-7) */
    function _erf(x) {
      const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
      const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
      const sign = x < 0 ? -1 : 1;
      const ax = Math.abs(x);
      const t = 1.0 / (1.0 + p * ax);
      const y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-ax*ax);
      return sign * y;
    }
    /** 正态分布 CDF: 0.5*(1 + erf((x-μ)/(σ*√2))) */
    function _normCdf(x, mu, sd) {
      if (sd <= 0) return "#NUM!";
      const z = (x - mu) / sd;
      return 0.5 * (1 + _erf(z / Math.SQRT2));
    }
    /** Acklam 正态分布反 CDF (精度 ~1e-9) */
    function _acklamInvNorm(p) {
      // Coefficients for rational approximation
      const a = [-3.969683028665376e+01,  2.209460984245205e+02,
                 -2.759285104469687e+02,  1.383577518672690e+02,
                 -3.066479806614716e+01,  2.506628277459239e+00];
      const b = [-5.447609879822406e+01,  1.615858368580409e+02,
                 -1.556989798598866e+02,  6.680131188771972e+01,
                 -1.328068155288572e+01];
      const c = [-7.784894002430293e-03, -3.223964580411365e-01,
                 -2.400758277161838e+00, -2.549732539343734e+00,
                  4.374664141464968e+00,  2.938163982698783e+00];
      const d = [ 7.784695709041462e-03,  3.224671290700398e-01,
                  2.445134137141996e+00,  3.754408661907416e+00];
      const plow = 0.02425, phigh = 1 - plow;
      let q, r;
      if (p < plow) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
      } else if (p <= phigh) {
        q = p - 0.5; r = q * q;
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
               (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
      } else {
        q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
      }
    }
    /** 伽马函数 log — Lanczos 近似 (n≥0) */
    function _lgamma(x) {
      if (x <= 0) return Infinity;
      const g = 7;
      const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
                 771.32342877765313, -176.61502916214059, 12.507343278686905,
                 -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
      if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - _lgamma(1 - x);
      x -= 1;
      let a = p[0];
      const t = x + g + 0.5;
      for (let i = 1; i < p.length; i++) a += p[i] / (x + i);
      return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
    }
    /** 阶乘对数: lgamma(n+1) */
    function _logFactorial(n) { return _lgamma(n + 1); }

    function _percentile(sorted, k) {
      if (!sorted.length) return "#NUM!";
      if (k < 0 || k > 1) return "#NUM!";
      const pos = k * (sorted.length - 1);
      const lo = Math.floor(pos), hi = Math.ceil(pos), fr = pos - lo;
      return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * fr;
    }
    function _sampleVarStd(a, std) {
      const arr = numList(a); const n = arr.length;
      if (n < 2) return "#DIV/0!";
      const mean = sum(arr) / n;
      let v = 0; for (const x of arr) v += (x - mean) * (x - mean);
      v = v / (n - 1);
      return std ? Math.sqrt(v) : v;
    }
    function _popVarStd(a, std) {
      const arr = numList(a); const n = arr.length;
      if (n === 0) return "#DIV/0!";
      const mean = sum(arr) / n;
      let v = 0; for (const x of arr) v += (x - mean) * (x - mean);
      v = v / n;
      return std ? Math.sqrt(v) : v;
    }
    function matchCrit(v, c) {
      if (typeof c === "string") {
        // 通配符：等于号前缀 + * ? ~，仅在明确 = 开头或无比较符时启用
        let eq = /^=/.test(c);
        let crit = eq ? c.slice(1) : c;
        if (/^[<>]=?/.test(crit)) {
          const op = crit.match(/^[<>]=?/)[0]; const n = parseFloat(crit.slice(op.length));
          return ({ ">": num(v) > n, ">=": num(v) >= n, "<": num(v) < n, "<=": num(v) <= n })[op];
        }
        if (eq) { /* 明确等号：字面比较 + 通配符 */ }
        if (typeof v !== "string" && !eq && typeof crit === "string" && !isNaN(parseFloat(crit))) {
          return num(v) == parseFloat(crit);
        }
        const hasWC = /[*?~]/.test(crit);
        if (hasWC) {
          let re = "", i = 0;
          while (i < crit.length) {
            const ch = crit[i];
            if (ch === "~" && i + 1 < crit.length) { re += _reE(crit[i + 1]); i += 2; }
            else if (ch === "*") { re += ".*"; i++; }
            else if (ch === "?") { re += "."; i++; }
            else { re += _reE(ch); i++; }
          }
          return new RegExp("^" + re + "$", "i").test(String(v));
        }
        return String(v) == crit;
      }
      return v == c;
    }
    function _reE(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function numList(a) { return flat(a).map(x => typeof x === "number" ? x : parseFloat(x)).filter(x => !isNaN(x)); }
    function sum(a) { return a.reduce((s, x) => s + (isNaN(x) ? 0 : x), 0); }
    function flat(a) { return Array.isArray(a) ? a.reduce((acc, x) => acc.concat(flat(x)), []) : [a]; }
    function formatNum(v, f) { if (!f) return v; return String(v); }
    function _toRows(x) {
      if (!Array.isArray(x)) return [[x]];
      if (!x.length) return [];
      if (Array.isArray(x[0])) return x; // 已经是二维
      // 一维数组 → 单列
      return x.map(v => [v]);
    }
    function _toFlat(x) { if (!Array.isArray(x)) return [x]; return flat(x); }
    function _wlMatch(text, pattern) {
      // Excel 通配符：* 任意多字符，? 单字符，~ 转义
      let re = ""; let i = 0;
      while (i < pattern.length) {
        const c = pattern[i];
        if (c === "~" && i + 1 < pattern.length) { re += _escRe(pattern[i + 1]); i += 2; continue; }
        if (c === "*") { re += ".*"; i++; continue; }
        if (c === "?") { re += "."; i++; continue; }
        re += _escRe(c); i++;
      }
      return new RegExp("^" + re + "$").test(text);
    }
    function _escRe(c) { return /[.*+?^${}()|[\]\\]/.test(c) ? "\\" + c : c; }

    // 词法
    function tokenize(s) {
      const toks = []; let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === " " || c === "\t") { i++; continue; }
        if (c === "'") {
          // 带单引号的 sheet 名: 'My Sheet'!A1 或 'My Sheet'!A1:B2
          let j = i + 1; let sn = "";
          while (j < s.length && s[j] !== "'") { sn += s[j]; j++; }
          if (j < s.length && s[j] === "'" && s[j + 1] === "!") {
            // 'Sheet'! 后面必须跟 ref 或 range
            let k = j + 2;
            while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
            const refRe = /^[A-Za-z]+[0-9]+$/;
            let p = k; while (p < s.length && /[A-Za-z0-9_.]/.test(s[p])) p++;
            const w = s.slice(k, p);
            if (refRe.test(w)) {
              // 检查 range
              let q = p; while (q < s.length && (s[q] === " " || s[q] === "\t")) q++;
              if (s[q] === ":") {
                let r = q + 1; while (r < s.length && (s[r] === " " || s[r] === "\t")) r++;
                let t = r; while (t < s.length && /[A-Za-z0-9_.]/.test(s[t])) t++;
                const w2 = s.slice(r, t);
                if (refRe.test(w2)) {
                  toks.push({ t: "range", v: "'" + sn + "'!" + w.toUpperCase() + ":" + w2.toUpperCase() });
                  i = t; continue;
                }
              }
              toks.push({ t: "ref", v: "'" + sn + "'!" + w.toUpperCase() });
              i = p; continue;
            }
          }
          // 不是 sheet 引用，就当普通字符串单引号（理论上 Excel 里只用于 sheet 名，暂不处理）
          toks.push({ t: "str", v: sn }); i = j + 1; continue;
        }
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] || ""))) {
          let j = i + 1; while (j < s.length && /[0-9.]/.test(s[j])) j++;
          toks.push({ t: "num", v: parseFloat(s.slice(i, j)) }); i = j; continue;
        }
        if (/[A-Za-z_]/.test(c)) {
          let j = i + 1; while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
          const w = s.slice(i, j);
          const up = w.toUpperCase();
          if (s[j] === "(") { toks.push({ t: "func", v: up }); i = j; continue; }
          const refRe = /^[A-Za-z]+[0-9]+$/;
          // 先看是不是 SheetName!ref 形式（Sheet2!A1）
          if (s[j] === "!") {
            let k = j + 1; while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
            let p = k; while (p < s.length && /[A-Za-z0-9_.]/.test(s[p])) p++;
            const w2 = s.slice(k, p);
            if (refRe.test(w2)) {
              // Sheet2!A1 或 Sheet2!A1:B2
              let q = p; while (q < s.length && (s[q] === " " || s[q] === "\t")) q++;
              if (s[q] === ":") {
                let r = q + 1; while (r < s.length && (s[r] === " " || s[r] === "\t")) r++;
                let t = r; while (t < s.length && /[A-Za-z0-9_.]/.test(s[t])) t++;
                const w3 = s.slice(r, t);
                if (refRe.test(w3)) {
                  toks.push({ t: "range", v: up + "!" + w2.toUpperCase() + ":" + w3.toUpperCase() });
                  i = t; continue;
                }
              }
              toks.push({ t: "ref", v: up + "!" + w2.toUpperCase() });
              i = p; continue;
            }
          }
          if (refRe.test(w)) {
            let k = j; while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
            if (s[k] === ":") {
              let m = k + 1; while (m < s.length && (s[m] === " " || s[m] === "\t")) m++;
              let p = m; while (p < s.length && /[A-Za-z0-9_.]/.test(s[p])) p++;
              const w2 = s.slice(m, p);
              if (refRe.test(w2)) { toks.push({ t: "range", v: up + ":" + w2.toUpperCase() }); i = p; continue; }
            }
            toks.push({ t: "ref", v: up }); i = j; continue;
          }
          if (up === "TRUE" || up === "FALSE") toks.push({ t: "bool", v: up === "TRUE" });
          else toks.push({ t: "name", v: w });
          i = j; continue;
        }
        if (c === '"') { let j = i + 1; let str = ""; while (j < s.length && s[j] !== '"') { str += s[j]; j++; } toks.push({ t: "str", v: str }); i = j + 1; continue; }
        if ("+-*/^&=<>%".includes(c)) {
          // 处理 >= <= <> 
          if ((c === ">" || c === "<" || c === "=") && s[i + 1] === "=") { toks.push({ t: "op", v: c + "=" }); i += 2; continue; }
          if (c === "<" && s[i + 1] === ">") { toks.push({ t: "op", v: "<>" }); i += 2; continue; }
          toks.push({ t: "op", v: c }); i++; continue;
        }
        if ("(),:".includes(c)) { toks.push({ t: c, v: c }); i++; continue; }
        i++;
      }
      return toks;
    }

    // 递归下降解析为 RPN（调度场）
    function toRPN(toks) {
      const out = [], stack = [];
      const prec = { "u-": 5, "^": 4, "*": 3, "/": 3, "+": 2, "-": 2, "&": 1.5, "=": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "<>": 1 };
      const isOp = v => prec[v] != null;
      for (const tk of toks) {
        if (tk.t === "num" || tk.t === "str" || tk.t === "ref" || tk.t === "range" || tk.t === "bool" || tk.t === "name") out.push(tk);
        else if (tk.t === "func") stack.push(tk);
        else if (tk.t === "(") stack.push(tk);
        else if (tk.t === ",") { while (stack.length && stack[stack.length - 1].t !== "(") out.push(stack.pop()); }
        else if (tk.t === ")") {
          while (stack.length && stack[stack.length - 1].t !== "(") out.push(stack.pop());
          if (stack.length && stack[stack.length - 1].t === "(") stack.pop();
          if (stack.length && stack[stack.length - 1].t === "func") out.push(stack.pop());
        }
        else if (isOp(tk.v)) {
          let op = tk.v;
          if (op === "-" && (out.length === 0 || (stack.length && stack[stack.length - 1].t === "(") || (stack.length && isOp(stack[stack.length - 1].v)))) op = "u-";
          while (stack.length && isOp(stack[stack.length - 1].v) && prec[stack[stack.length - 1].v] >= prec[op]) out.push(stack.pop());
          stack.push({ t: "op", v: op });
        }
      }
      while (stack.length) out.push(stack.pop());
      return out;
    }

    // 求值（带网格回调）
    function evalRPN(rpn, getCell) {
      const st = [];
      for (const tk of rpn) {
        if (tk.t === "num") st.push(tk.v);
        else if (tk.t === "str") st.push(tk.v);
        else if (tk.t === "bool") st.push(tk.v);
        else if (tk.t === "ref") st.push(getCell(tk.v));
        else if (tk.t === "range") {
          const m = parseRange(tk.v);
          const a = m[1] ? { col: colToIdx(m[1]), row: +m[2] } : null;
          const b = m[3] ? { col: colToIdx(m[3]), row: +m[4] } : null;
          if (a && b) st.push(expandRange(a, b).map(getCell));
          else if (a) st.push(getCell(m[1] + m[2]));
          else st.push([]);
        }
        else if (tk.t === "name") st.push(0);
        else if (tk.t === "op") {
          if (tk.v === "u-") { const a = st.pop(); st.push(-a); continue; }
          const b = st.pop(), a = st.pop();
          st.push(applyOp(tk.v, a, b));
        }
        else if (tk.t === "func") {
          // 处理函数：参数已在栈上（由逗号分割），但 RPN 中函数出现在参数之后，
          // 这里改在前方处理：见下方 fallback
          st.push(0);
        }
      }
      return st[st.length - 1];
    }

    // 由于函数参数处理复杂，采用 AST 方式求值更稳健：
    function parse(toks) {
      let pos = 0;
      function peek() { return toks[pos]; }
      function next() { return toks[pos++]; }
      function parseExpr() { return parseCompare(); }
      function parseCompare() {
        let left = parseConcat();
        while (peek() && peek().t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().v)) {
          const op = next().v; const right = parseConcat(); left = { op, left, right };
        }
        return left;
      }
      function parseConcat() {
        let left = parseAdd();
        while (peek() && peek().t === "op" && peek().v === "&") { next(); const right = parseAdd(); left = { op: "&", left, right }; }
        return left;
      }
      function parseAdd() {
        let left = parseMul();
        while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-" || peek().v === "u-")) {
          const op = next().v; const right = parseMul(); left = { op, left, right };
        }
        return left;
      }
      function parseMul() {
        let left = parsePow();
        while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) { const op = next().v; const right = parsePow(); left = { op, left, right }; }
        return left;
      }
      function parsePow() {
        let left = parseUnary();
        while (peek() && peek().t === "op" && peek().v === "^") { next(); const right = parseUnary(); left = { op: "^", left, right }; }
        return left;
      }
      function parseUnary() {
        if (peek() && peek().t === "op" && peek().v === "-") { next(); return { op: "u-", arg: parseUnary() }; }
        return parsePrimary();
      }
      function parsePrimary() {
        const tk = next();
        if (!tk) return { v: 0 };
        if (tk.t === "num") return { v: tk.v };
        if (tk.t === "str") return { v: tk.v };
        if (tk.t === "bool") return { v: tk.v };
        if (tk.t === "ref") return { ref: tk.v };
        if (tk.t === "range") return { range: tk.v };
        if (tk.t === "name") return { name: tk.v };
        if (tk.t === "(") { const e = parseExpr(); next(); return e; }
        if (tk.t === "func") {
          next(); // consume (
          const args = [];
          if (peek() && peek().t !== ")") { args.push(parseExpr()); while (peek() && peek().t === ",") { next(); args.push(parseExpr()); } }
          if (peek() && peek().t === ")") next();
          return { func: tk.v, args };
        }
        return { v: 0 };
      }
      return parseExpr();
    }

    function applyOp(op, a, b) {
      switch (op) {
        case "+": return num(a) + num(b);
        case "-": return num(a) - num(b);
        case "*": return num(a) * num(b);
        case "/": return num(b) === 0 ? "#DIV/0!" : num(a) / num(b);
        case "^": return Math.pow(num(a), num(b));
        case "&": return str(a) + str(b);
        case "=": return a == b;
        case "<>": return a != b;
        case "<": return a < b; case ">": return a > b;
        case "<=": return a <= b; case ">=": return a >= b;
        case "u-": return -num(a);
      }
      return 0;
    }
    function num(x) { if (x === "" || x == null) return 0; if (typeof x === "number") return x; if (typeof x === "boolean") return x ? 1 : 0; const n = parseFloat(String(x).replace(/,/g, "")); return isNaN(n) ? 0 : n; }
    function str(x) { if (x == null) return ""; if (Array.isArray(x)) return x.map(str).join(""); return String(x); }

    function evalNode(node, getCell, scope) {
      scope = scope || {};
      if (node == null) return 0;
      if ("v" in node) return node.v;
      // LET 先处理：语法级，不是普通函数
      if (node && node.func === "LET") {
        const args = node.args;
        if (args.length < 3 || args.length % 2 !== 1) return "#CALC!";
        const newScope = Object.assign({}, scope);
        for (let i = 0; i < args.length - 1; i += 2) {
          // name 参数：{name:"xxx"} 直接取字面量，不要 evalNode（否则 scope 里找不到）
          const nameAst = args[i];
          // name 统一转大写（函数名 parse 后也全大写，否则 scope["DBL"] 找不到 "Dbl"）
          const rawName = nameAst.name ? nameAst.name : String(evalNode(nameAst, getCell, newScope));
          const name = rawName.toUpperCase();
          newScope[name] = evalNode(args[i + 1], getCell, newScope);
        }
        return evalNode(args[args.length - 1], getCell, newScope);
      }
      // LAMBDA：返回一个 lambda 对象（不是立即调用）
      if (node && node.func === "LAMBDA") {
        const args = node.args;
        if (args.length < 2) return "#CALC!";
        const params = [];
        for (let i = 0; i < args.length - 1; i++) {
          if (args[i].name) params.push(args[i].name);
          else return "#CALC!";
        }
        return { __lambda: true, params, body: args[args.length - 1], closure: scope };
      }
      if (node.ref) return getCell(node.ref);
      // name 节点：先查 scope（LET 变量名已大写 + LAMBDA 参数），再查名称解析器
      if (node.name) {
        const upper = node.name.toUpperCase();
        if (scope && (node.name in scope)) return scope[node.name];     // 优先原始大小写（LAMBDA 参数）
        if (scope && (upper in scope)) return scope[upper];             // 再查大写（LET 变量）
        const resolved = _nameResolver ? _nameResolver(node.name) : null;
        if (resolved) { node = { range: resolved }; /* fall through */ }
        else return "#NAME?";
      }
      if (node.range) {
        const m = parseRange(node.range);
        const a = m[1] ? { col: colToIdx(m[1]), row: +m[2] } : null;
        const b = m[3] ? { col: colToIdx(m[3]), row: +m[4] } : null;
        if (a && b) {
          const [mc, nc] = a.col <= b.col ? [a.col, b.col] : [b.col, a.col];
          const [mr, nr] = a.row <= b.row ? [a.row, b.row] : [b.row, a.row];
          const rows = [];
          for (let r = mr; r <= nr; r++) { const row = []; for (let c = mc; c <= nc; c++) row.push(getCell(idxToCol(c) + r)); rows.push(row); }
          return rows;
        }
        if (a) return [[getCell(m[1] + m[2])]];
        return [];
      }
      if (node.func) {
        // === OFFSET / INDIRECT — 动态范围，需要 getCell + baseRef 坐标 ===
        if (node.func === "OFFSET" || node.func === "INDIRECT") {
          return _evalOffsetIndirect(node.func, node.args, getCell, scope);
        }
        // === ISFORMULA / FORMULATEXT — 需要原始 cell 数据 ===
        if (node.func === "ISFORMULA" || node.func === "FORMULATEXT") {
          return _evalIsFormula(node.func, node.args, getCell, scope);
        }
        // === IRR — 必须特殊处理：第一个参数可能是数组/范围/独立数字 ===
        if (node.func === "IRR") {
          return _evalIRR(node.args, getCell, scope);
        }
        // === 高级数组函数：不 eval args，保留原始 AST 自己处理 ===
        if (["MAP", "BYROW", "BYCOL", "MAPROWS", "MAPCOLS", "REDUCE", "SCAN", "MAKEARRAY", "TOROW", "TOCOL"].includes(node.func)) {
          // 先用 evalNode 把 lambda AST 求值成 lambda 对象（args 里可能有 lambda 节点）
          // 但数组参数必须保留为数组（evalNode 会把 range 变成二维数组）
          // 简化：先 eval 所有 args，然后在 FUNCS 里处理
          // 但 TOCOL / TOROW 已经有简单版在 FUNCS 里了
          if (node.func === "MAP" || node.func === "BYROW" || node.func === "BYCOL" ||
              node.func === "MAPROWS" || node.func === "MAPCOLS" || node.func === "REDUCE" ||
              node.func === "SCAN" || node.func === "MAKEARRAY") {
            return _evalArrayFunc(node.func, node.args, getCell, scope);
          }
        }
        const fn = FUNCS[node.func];
        // 先算所有参数（带 scope）
        const args = node.args.map(a => evalNode(a, getCell, scope));
        if (fn) {
          try { return fn.apply(null, args); } catch (e) { return "#VALUE!"; }
        }
        // FUNCS 里没有 → 查 scope 里有没有 LAMBDA 对象
        if (scope && scope[node.func] && scope[node.func].__lambda) {
          const lam = scope[node.func];
          if (args.length !== lam.params.length) return "#CALC!";
          // 新 scope = closure + params→args 绑定
          const callScope = Object.assign({}, lam.closure || {});
          for (let i = 0; i < lam.params.length; i++) callScope[lam.params[i]] = args[i];
          return evalNode(lam.body, getCell, callScope);
        }
        // 最后查名称解析器有没有这个名字（但它是函数调用形式）
        return "#NAME?";
      }
      if (node.op) {
        if (node.op === "u-") return -num(evalNode(node.arg, getCell, scope));
        return applyOp(node.op, evalNode(node.left, getCell, scope), evalNode(node.right, getCell, scope));
      }
      return 0;
    }

    // ============ IRR — 现金流内部收益率 ============
    /** evalNode 拦截 IRR：支持独立参数和范围两种写法
     *  IRR(values, [guess=0.1])
     *  - values 可以是 range/array（evalNode 求值后是二维数组）或独立数字参数
     *  - guess 可选，默认 0.1
     */
    function _evalIRR(args, getCell, scope) {
      if (!args.length) return "#NUM!";
      // 收集所有 args，eval 后 flatten
      const cfs = [];
      let guess = 0.1;
      for (let i = 0; i < args.length; i++) {
        const val = evalNode(args[i], getCell, scope);
        if (Array.isArray(val)) {
          for (const x of flat([val])) if (isFinite(+x)) cfs.push(+x);
        } else if (typeof val === "number" && isFinite(val)) {
          // 最后一个独立数字可能是 guess（如果前面已经有 cfs）
          cfs.push(val);
        }
      }
      // 如果 args.length === 2 且 args[1] 是单数字（非数组/range）→ 当 guess
      if (args.length === 2) {
        const gVal = evalNode(args[1], getCell, scope);
        if (typeof gVal === "number" && isFinite(gVal) && !Array.isArray(gVal)) {
          guess = +gVal;
          // cfs 只来自 args[0]
          cfs.length = 0;
          const v0 = evalNode(args[0], getCell, scope);
          if (Array.isArray(v0)) for (const x of flat([v0])) if (isFinite(+x)) cfs.push(+x);
          else if (isFinite(+v0)) cfs.push(+v0);
        }
      }
      if (cfs.length < 2) return "#NUM!";
      // 牛顿迭代
      let r = guess;
      for (let iter = 0; iter < 50; iter++) {
        let f = 0, df = 0;
        for (let i = 0; i < cfs.length; i++) {
          const denom = Math.pow(1 + r, i);
          f += cfs[i] / denom;
          if (i > 0) df -= i * cfs[i] / Math.pow(1 + r, i + 1);
        }
        if (Math.abs(df) < 1e-15) return "#NUM!";
        const dr = f / df;
        r -= dr;
        if (Math.abs(dr) < 1e-7) return r;
        if (r <= -1) return "#NUM!";
      }
      return "#NUM!";
    }

    // ============ ISFORMULA / FORMULATEXT — 需要原始 cell 数据 ============
    /** 根据 ref 取 cell 对象，判断/返回公式
     *  - ref 单格 → 标量结果
     *  - range 范围 → 二维数组结果（和 Excel 动态数组一致）
     */
    function _evalIsFormula(name, args, getCell, scope) {
      if (!args.length) return "#REF!";
      const getRaw = FE._getCellRaw;
      if (!getRaw) return "#N/A"; // 没有原始 cell 访问器（可能是单测环境）
      const coords = _astNodeToCoords(args[0], getCell, scope);
      if (!coords) return "#REF!";
      // 单格 → 标量
      if (coords.r1 === coords.r2 && coords.c1 === coords.c2) {
        const ref = idxToCol(coords.c1) + coords.r1;
        const raw = getRaw(ref);
        if (name === "ISFORMULA") return !!(raw && raw.f && String(raw.f).startsWith("="));
        // FORMULATEXT
        if (raw && raw.f && String(raw.f).startsWith("=")) return raw.f;
        return "#N/A";
      }
      // 范围 → 二维数组
      const out = [];
      for (let r = coords.r1; r <= coords.r2; r++) {
        const row = [];
        for (let c = coords.c1; c <= coords.c2; c++) {
          const ref = idxToCol(c) + r;
          const raw = getRaw(ref);
          if (name === "ISFORMULA") row.push(!!(raw && raw.f && String(raw.f).startsWith("=")));
          else row.push((raw && raw.f && String(raw.f).startsWith("=")) ? raw.f : "#N/A");
        }
        out.push(row);
      }
      return out;
    }

    // ============ OFFSET / INDIRECT — 动态范围 ============
    /** 从 "Sheet2!A1" 或 "'My Sheet'!A1:B2" 里分离 sheet 名和 cell 部分
     *  返回 { sheet: "Sheet2", cellText: "A1:B2" } 或 { sheet: null, cellText }
     */
    function _splitSheetName(text) {
      if (!text) return { sheet: null, cellText: text };
      const s = text.trim();
      // 找最后一个 !（Excel 不允许 sheet 名含 !，简单可靠）
      const idx = s.lastIndexOf("!");
      if (idx < 0) return { sheet: null, cellText: s };
      let sheetName = s.substring(0, idx);
      const cellText = s.substring(idx + 1);
      // 去掉单引号
      if (sheetName.length >= 2 && sheetName.startsWith("'") && sheetName.endsWith("'"))
        sheetName = sheetName.substring(1, sheetName.length - 1);
      return { sheet: sheetName, cellText };
    }
    /** 把 AST 节点解析成坐标范围 { r1, c1, r2, c2, sheet? } 或 null
     *  - ref/range 字面量节点 → 直接取坐标
     *  - 其他 → evalNode 得字符串再 parseRange（支持 SheetName! 前缀）
     */
    function _astNodeToCoords(astNode, getCell, scope) {
      if (!astNode) return null;
      // 字面量 ref/range — 可能带 Sheet! 前缀
      if (astNode.ref) {
        const { sheet, cellText } = _splitSheetName(astNode.ref);
        const p = parseRef(cellText);
        if (!p) return null;
        const r = { r1: p.row, c1: p.col, r2: p.row, c2: p.col };
        if (sheet) r.sheet = sheet;
        return r;
      }
      if (astNode.range) {
        const { sheet, cellText } = _splitSheetName(astNode.range);
        const m = parseRange(cellText);
        if (!m) return null;
        const a = m[1] ? { col: colToIdx(m[1]), row: +m[2] } : null;
        const b = m[3] ? { col: colToIdx(m[3]), row: +m[4] } : null;
        if (!a) return null;
        const r = !b ? { r1: a.row, c1: a.col, r2: a.row, c2: a.col } : {
          r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col),
          r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col)
        };
        if (sheet) r.sheet = sheet;
        return r;
      }
      // 其他（INDIRECT 结果 / 表达式）→ eval 得字符串 → 再 parse（带 sheet 支持）
      let val;
      try { val = evalNode(astNode, getCell, scope); } catch { return null; }
      if (typeof val !== "string") return null;
      const { sheet, cellText } = _splitSheetName(val.trim());
      const text = cellText.toUpperCase();
      // 先尝试范围 A1:B2
      const m = parseRange(text);
      if (m) {
        const a = m[1] ? { col: colToIdx(m[1]), row: +m[2] } : null;
        const b = m[3] ? { col: colToIdx(m[3]), row: +m[4] } : null;
        if (!a) return null;
        const r = !b ? { r1: a.row, c1: a.col, r2: a.row, c2: a.col } : {
          r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col),
          r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col)
        };
        if (sheet) r.sheet = sheet;
        return r;
      }
      // 再尝试单格 A1
      const p = parseRef(text);
      if (p) {
        const r = { r1: p.row, c1: p.col, r2: p.row, c2: p.col };
        if (sheet) r.sheet = sheet;
        return r;
      }
      return null;
    }
    /** 用 getCell 把坐标范围读成二维数组（跨表时自动带 Sheet! 前缀） */
    function _coordsToArray(coords, getCell) {
      const out = [];
      const prefix = coords.sheet ? coords.sheet + "!" : "";
      for (let r = coords.r1; r <= coords.r2; r++) {
        const row = [];
        for (let c = coords.c1; c <= coords.c2; c++) row.push(getCell(prefix + idxToCol(c) + r));
        out.push(row);
      }
      return out;
    }
    /** OFFSET / INDIRECT 主函数 */
    function _evalOffsetIndirect(name, args, getCell, scope) {
      if (name === "INDIRECT") {
        if (!args.length) return "#REF!";
        const refTextNode = args[0];
        const coords = _astNodeToCoords(refTextNode, getCell, scope);
        if (!coords) return "#REF!";
        const arr = _coordsToArray(coords, getCell);
        // 如果全是 #REF!（跨表找不到 sheet 时），返回标量错误
        let allErr = true;
        for (const row of arr) for (const v of row) { if (v !== "#REF!") { allErr = false; break; } }
        return allErr ? "#REF!" : arr;
      }
      // OFFSET(baseRef, rowOff, colOff, [height], [width])
      if (args.length < 3) return "#CALC!";
      const baseCoords = _astNodeToCoords(args[0], getCell, scope);
      if (!baseCoords) return "#REF!";
      const rowOff = +evalNode(args[1], getCell, scope);
      const colOff = +evalNode(args[2], getCell, scope);
      // 默认用 baseRef 尺寸
      const baseH = baseCoords.r2 - baseCoords.r1 + 1;
      const baseW = baseCoords.c2 - baseCoords.c1 + 1;
      const height = args[3] != null ? +evalNode(args[3], getCell, scope) : baseH;
      const width  = args[4] != null ? +evalNode(args[4], getCell, scope) : baseW;
      if (height <= 0 || width <= 0) return "#REF!";
      const newCoords = {
        r1: baseCoords.r1 + rowOff,
        c1: baseCoords.c1 + colOff,
        r2: baseCoords.r1 + rowOff + height - 1,
        c2: baseCoords.c1 + colOff + width - 1
      };
      if (baseCoords.sheet) newCoords.sheet = baseCoords.sheet;
      if (newCoords.r1 < 1 || newCoords.c1 < 1) return "#REF!";
      return _coordsToArray(newCoords, getCell);
    }

    // ============ 高级数组函数：eval 原始 args AST + 调 LAMBDA ============
    function _evalArrayFunc(name, args, getCell, scope) {
      // === 先找 LAMBDA 在哪个 args 位置 ===
      let lambdaIdx = 1; // 默认 args[1] 是 lambda（MAP/BYROW/BYCOL/SEQUENCE/MAPROWS/MAPCOLS）
      if (name === "MAKEARRAY") lambdaIdx = 2; // MAKEARRAY(rows, cols, lambda)
      if (name === "REDUCE" || name === "SCAN") lambdaIdx = 2; // REDUCE/SCAN(array, init, lambda)

      let lam = null;
      if (args.length > lambdaIdx) {
        const evalFirst = evalNode(args[lambdaIdx], getCell, scope);
        if (evalFirst && evalFirst.__lambda) lam = evalFirst;
        else if (args[lambdaIdx].name && scope && scope[args[lambdaIdx].name] && scope[args[lambdaIdx].name].__lambda)
          lam = scope[args[lambdaIdx].name];
      }

      if (name === "MAKEARRAY") {
        const rows = +evalNode(args[0], getCell, scope) || 1;
        const cols = +evalNode(args[1], getCell, scope) || 1;
        if (!lam) return "#CALC!";
        const out = [];
        for (let r = 1; r <= rows; r++) {
          const row = [];
          for (let c = 1; c <= cols; c++) {
            const callScope = Object.assign({}, lam.closure || {});
            callScope[lam.params[0]] = r;
            callScope[lam.params[1]] = c;
            row.push(evalNode(lam.body, getCell, callScope));
          }
          out.push(row);
        }
        return out;
      }

      // 以下函数都需要先拿到 array 二维数组
      const arrayArg = evalNode(args[0], getCell, scope);
      const rowsArr = _toRows(arrayArg);
      if (!rowsArr.length) return [];

      if (name === "MAP") {
        if (!lam) return "#CALC!";
        return rowsArr.map(row => row.map(cell => {
          const callScope = Object.assign({}, lam.closure || {});
          callScope[lam.params[0]] = cell;
          return evalNode(lam.body, getCell, callScope);
        }));
      }

      if (name === "BYROW" || name === "MAPROWS") {
        if (!lam) return "#CALC!";
        return rowsArr.map(row => {
          const callScope = Object.assign({}, lam.closure || {});
          callScope[lam.params[0]] = row;
          return evalNode(lam.body, getCell, callScope);
        });
      }

      if (name === "BYCOL" || name === "MAPCOLS") {
        if (!lam) return "#CALC!";
        const C = rowsArr[0].length;
        const out = [];
        for (let c = 0; c < C; c++) {
          const col = rowsArr.map(row => row[c]);
          const callScope = Object.assign({}, lam.closure || {});
          callScope[lam.params[0]] = col;
          out.push(evalNode(lam.body, getCell, callScope));
        }
        return out;
      }

      if (name === "REDUCE") {
        const init = evalNode(args[1], getCell, scope);
        if (!lam) return "#CALC!";
        let acc = init;
        for (const row of rowsArr) {
          for (const cell of row) {
            const callScope = Object.assign({}, lam.closure || {});
            callScope[lam.params[0]] = acc;
            callScope[lam.params[1]] = cell;
            acc = evalNode(lam.body, getCell, callScope);
          }
        }
        return acc;
      }

      if (name === "SCAN") {
        const init = evalNode(args[1], getCell, scope);
        if (!lam) return "#CALC!";
        const out = [];
        let acc = init;
        for (const row of rowsArr) {
          const newRow = [];
          for (const cell of row) {
            const callScope = Object.assign({}, lam.closure || {});
            callScope[lam.params[0]] = acc;
            callScope[lam.params[1]] = cell;
            acc = evalNode(lam.body, getCell, callScope);
            newRow.push(acc);
          }
          out.push(newRow);
        }
        return out;
      }

      return "#CALC!";
    }

    // 对外：编译公式字符串 -> 返回 {error} 或可直接 eval
    function adjustFormula(formula, dRow, dCol) {
      if (typeof formula !== "string" || !formula.startsWith("=")) return formula;
      const body = formula.slice(1);
      let out = "=", i = 0;
      while (i < body.length) {
        const ch = body[i];
        if (ch === '"') { // 字符串字面量原样保留
          let j = i + 1; out += '"';
          while (j < body.length && body[j] !== '"') { out += body[j]; j++; }
          out += '"'; i = j + 1; continue;
        }
        const m = /^\$?([A-Za-z]+)(\$?)(\d+)/.exec(body.slice(i));
        if (m) {
          const prev = i === 0 ? "" : body[i - 1];
          if (!/[A-Za-z0-9_]/.test(prev)) { // 仅当处于引用起始（非标识符中间）才调整
            const colAbs = m[0][0] === "$";
            const colLetters = m[1];
            const rowAbs = m[2] === "$";
            const digits = m[3];
            let newCol = colLetters, newRow = digits;
            if (!colAbs) { const ci = colToIdx(colLetters) + dCol; if (ci >= 1) newCol = idxToCol(ci); }
            if (!rowAbs) { const ri = parseInt(digits, 10) + dRow; if (ri >= 1) newRow = String(ri); }
            out += (colAbs ? "$" : "") + newCol + (rowAbs ? "$" : "") + newRow;
            i += m[0].length; continue;
          }
        }
        out += ch; i++;
      }
      return out;
    }
    function compile(formula) {
      try {
        const toks = tokenize(formula.slice(1));
        const ast = parse(toks);
        return { ast, tokenize, toRPN, evalRPN }; // 兼容字段
      } catch (e) { return { error: "#ERROR!" }; }
    }
    function run(formula, getCell, currentRef, getRawCell) {
      const c = compile(formula);
      if (c.error) return c.error;
      FE._currentRef = currentRef;
      FE._getCellRaw = getRawCell || null;
      try { const r = evalNode(c.ast, getCell); if (r === Infinity) return "#DIV/0!"; return r; }
      catch (e) { return "#ERROR!"; }
      finally { FE._currentRef = null; FE._getCellRaw = null; }
    }
    // COLUMN / ROW 运行时解析（覆盖 FUNCS 里的默认实现）
    FUNCS.COLUMN = () => { const r = FE._currentRef ? parseRef(FE._currentRef) : null; return r ? r.col : "#REF!"; };
    FUNCS.ROW    = () => { const r = FE._currentRef ? parseRef(FE._currentRef) : null; return r ? r.row : "#REF!"; };

    // 提取公式里的所有单元格引用和区域引用（返回 { refs: Set<string>, ranges: string[] }）
    function extractRefs(formula) {
      const refs = new Set();
      const ranges = [];
      try {
        const toks = tokenize((formula.startsWith("=") ? formula.slice(1) : formula));
        for (const tk of toks) {
          if (tk.t === "ref") refs.add(tk.v);
          else if (tk.t === "range") {
            ranges.push(tk.v);
            const m = parseRange(tk.v);
            if (m && m[1] && m[3]) {
              const a = { col: colToIdx(m[1]), row: +m[2] };
              const b = { col: colToIdx(m[3]), row: +m[4] };
              const [mc, nc] = a.col <= b.col ? [a.col, b.col] : [b.col, a.col];
              const [mr, nr] = a.row <= b.row ? [a.row, b.row] : [b.row, a.row];
              for (let c = mc; c <= nc; c++) for (let r = mr; r <= nr; r++) refs.add(idxToCol(c) + r);
            }
          }
        }
      } catch (e) {}
      return { refs, ranges };
    }

    // 名称解析器：(name:string) => range string | null，由外部注入
    let _nameResolver = null;

    return { run, compile, adjustFormula, colToIdx, idxToCol, parseRef, expandRange, tokenize, extractRefs, setNameResolver: fn => (_nameResolver = fn) };
  })();
  OS.FormulaEngine = FE;

  /* ---------------- 模块 ---------------- */
  function blank() {
    return {
      activeSheet: 0,
      freeze: { row: 0, col: 0 },
      comments: [],
      sheets: [
        {
          name: "Sheet1",
          rows: 100, cols: 16,
          cells: {
            A1: { f: "示例：在 A1 输入 =SUM(B1:B3)" },
            B1: { v: 10 }, B2: { v: 20 }, B3: { v: 30 },
            A2: { f: "=ROUND(AVERAGE(B1:B3),2)" }
          },
          styles: {},
          charts: [],
          condFormats: [],
          filters: [],
          merge: [],
          validations: []
        }
      ]
    };
  }
  // 旧版单表文档 → 多工作表结构（兼容导入/历史文件）
  function normalizeDoc(doc) {
    const d = doc && doc.data ? doc.data : null;
    if (!d) return blank();
    // 兼容：字符串 merge → 对象 merge（老 parseXlsx 返回 ["A1:B2"]，新返回 [{range}]）
    const normMerge = arr => {
      if (!arr || !arr.length) return [];
      return arr.map(m => typeof m === "string" ? { range: m, type: "merge" } : m);
    };
    if (d.sheets && Array.isArray(d.sheets) && d.sheets.length) {
      if (typeof d.activeSheet !== "number" || d.activeSheet >= d.sheets.length) d.activeSheet = 0;
      if (!d.freeze) d.freeze = { row: 0, col: 0 };
      d.comments = d.comments || [];
      d.sheets.forEach((s, i) => {
        s.cells = s.cells || {}; s.styles = s.styles || {}; s.charts = s.charts || [];
        s.condFormats = s.condFormats || []; s.filters = s.filters || [];
        s.merge = normMerge(s.merge); s.validations = s.validations || [];
        if (!s.name) s.name = "Sheet" + (i + 1);
      });
      return d;
    }
    return {
      activeSheet: 0,
      freeze: { row: 0, col: 0 },
      comments: [],
      sheets: [{
        name: "Sheet1",
        rows: d.rows || 100, cols: d.cols || 16,
        cells: d.cells || {}, styles: d.styles || {}, charts: d.charts || [],
        condFormats: d.condFormats || [], filters: d.filters || [],
        merge: normMerge(d.merge), validations: d.validations || []
      }]
    };
  }

  function mount(host, doc, ctx) {
    const data = normalizeDoc(doc);
    const sh0 = data.sheets[data.activeSheet];
    const ROWS = sh0.rows || 100, COLS = sh0.cols || 16;

    // 名称解析器：把已定义的名称翻译成 range 字符串
    FE.setNameResolver(name => {
      const names = data.names || [];
      const hit = names.find(n => n.name.toLowerCase() === name.toLowerCase());
      return hit ? hit.ref : null;
    });
    let pdfRangeText = "", pdfSheetIndex = null; // PDF 导出范围（行区间/工作表）的暂存
    let pdfPreset = ""; // PDF 导出范围预设（all/current），由「PDF 导出范围」下拉设置

    const wrap = document.createElement("div");
    wrap.className = "module-wrap sheet-wrap";
    wrap.innerHTML = `
      <div class="sheet-toolbar">
        <input class="cell-ref" placeholder="A1">
        <input class="fx" placeholder="输入数值或公式，如 =SUM(A1:A3)">
      </div>
      <div class="sheet-body">
        <div class="sheet-main">
          <div class="sheet-scroll"><table class="sheet"></table></div>
          <div class="sheet-bottombar">
            <div class="sheet-tabs"><div class="sheet-tabs-list"></div><button class="sheet-add" title="新建工作表">＋</button><span class="st-sum"></span><span class="st-sel"></span><span class="st-info"></span></div>
            <div class="sheet-footer"></div>
          </div>
          <div class="sheet-charts" hidden></div>
        </div>
        <div class="sheet-cmt-panel hidden">
          <div class="cmt-panel-head">
            <span class="cmt-count"></span>
            <button id="cmt-close" title="关闭批注面板">✕</button>
          </div>
          <div class="cmt-panel-body">
            <div class="cmt-list"></div>
          </div>
        </div>
      </div>
      <button id="cmt-toggle" class="cmt-toggle off" title="批注面板">💬</button>`;
    host.appendChild(wrap);
    const table = wrap.querySelector("table.sheet");
    const refInput = wrap.querySelector(".cell-ref");
    const fx = wrap.querySelector(".fx");
    const scroll = wrap.querySelector(".sheet-scroll");
    const stSum = wrap.querySelector(".st-sum"), stSel = wrap.querySelector(".st-sel"), stInfo = wrap.querySelector(".st-info");

    let selected = "A1", anchor = "A1";
    var cfAppliedRefs = [];

    // 构建表头与单元格
    const DEFAULT_COL_WIDTH = 64;
    const DEFAULT_ROW_HEIGHT = 18;
    function buildGrid() {
      const cw = sh0.colWidths || [];
      const rh = sh0.customRowHeights || {};
      let html = "<tr><th class='corner'></th>";
      for (let c = 1; c <= COLS; c++) {
        const w = cw[c] || DEFAULT_COL_WIDTH;
        html += `<th class="colhead" data-col="${c}" style="width:${w}px;min-width:${w}px">${FE.idxToCol(c)}</th>`;
      }
      html += "</tr>";
      for (let r = 1; r <= ROWS; r++) {
        const rowH = rh[r] || DEFAULT_ROW_HEIGHT;
        html += `<tr style="height:${rowH}px"><th class="rowhead" data-row="${r}" style="height:${rowH}px">${r}</th>`;
        for (let c = 1; c <= COLS; c++) html += `<td data-ref="${FE.idxToCol(c)}${r}"></td>`;
        html += "</tr>";
      }
      table.innerHTML = html;
      applyMerges();
    }
    bindAliases();
    buildGrid();
    applyFreeze();
    renderSheetTabs();
    const sheetAddBtn = wrap.querySelector(".sheet-add");
    if (sheetAddBtn) sheetAddBtn.addEventListener("click", () => addSheet());

    // ===== 列宽 / 行高 拖拽调整 =====
    let resizeCleanup = null; // 必须在 IIFE 前声明，否则 TDZ
    (function initResize() {
      let dragging = null; // { type: 'col'|'row', idx, startPos, startSize }
      const MIN_SIZE = 20;
      const getPageXY = e => {
        if (e.touches && e.touches.length) return { x: e.touches[0].pageX, y: e.touches[0].pageY };
        return { x: e.pageX, y: e.pageY };
      };
      function onMouseDown(e) {
        const th = e.target.closest("th");
        if (!th) return;
        const colIdx = parseInt(th.dataset.col);
        const rowIdx = parseInt(th.dataset.row);
        if (!colIdx && !rowIdx) return;
        if (colIdx > 0) {
          const { x } = getPageXY(e);
          dragging = { type: "col", idx: colIdx, startPos: x, startSize: th.offsetWidth, th };
        } else if (rowIdx > 0) {
          const { y } = getPageXY(e);
          dragging = { type: "row", idx: rowIdx, startPos: y, startSize: th.offsetHeight, th };
        }
      }
      function onMouseMove(e) {
        if (!dragging) return;
        const { x, y } = getPageXY(e);
        if (dragging.type === "col") {
          const delta = x - dragging.startPos;
          const newW = Math.max(MIN_SIZE, dragging.startSize + delta);
          dragging.th.style.width = newW + "px";
          dragging.th.style.minWidth = newW + "px";
        } else {
          const delta = y - dragging.startPos;
          const newH = Math.max(MIN_SIZE, dragging.startSize + delta);
          dragging.th.style.height = newH + "px";
          // 同步整行
          const row = dragging.th.parentElement;
          if (row) row.style.height = newH + "px";
        }
      }
      function onMouseUp() {
        if (!dragging) return;
        if (dragging.type === "col") {
          const newW = dragging.th.offsetWidth;
          if (!sh0.colWidths) sh0.colWidths = [];
          sh0.colWidths[dragging.idx] = newW;
        } else {
          const newH = dragging.th.offsetHeight;
          if (!sh0.customRowHeights) sh0.customRowHeights = {};
          sh0.customRowHeights[dragging.idx] = newH;
        }
        dragging = null;
      }
      table.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      // 清理函数（供 destroy 用）
      resizeCleanup = () => {
        table.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
    })();

    // 求值缓存
    const cache = {};
    const spillMap = {}; // ref → { rows, cols }，记录动态数组源
    /** 跨表查找：ref 可能是 "Sheet2!A1" 或 "'My Sheet'!B2"
     *  - 不在 getCell 里报错（INDIRECT 需要区分 #REF! 和正常空值），
     *    返回 _crossSheetNotFound 标记让调用方决定
     */
    function _splitSheetRef(ref) {
      if (!ref || ref.indexOf("!") < 0) return { sheet: null, cellRef: ref };
      const idx = ref.lastIndexOf("!");
      let sheetName = ref.substring(0, idx);
      const cellRef = ref.substring(idx + 1);
      // 去掉单引号（Excel 给含空格/特殊字符的 sheet 名加的）
      if (sheetName.length >= 2 && sheetName.startsWith("'") && sheetName.endsWith("'"))
        sheetName = sheetName.substring(1, sheetName.length - 1);
      return { sheet: sheetName, cellRef };
    }
    function _findSheet(name) {
      if (!name || !data.sheets) return null;
      const n = name.trim().toLowerCase();
      return data.sheets.find(s => (s.name || "").toLowerCase() === n) || null;
    }
    function getCell(ref) {
      if (ref in cache) return cache[ref];
      // 跨表：带 "Sheet!A1" 前缀
      const split = _splitSheetRef(ref);
      let raw;
      if (split.sheet) {
        const sh = _findSheet(split.sheet);
        if (!sh) { cache[ref] = "#REF!"; return "#REF!"; }
        raw = (sh.cells && sh.cells[split.cellRef]) || {};
      } else {
        raw = (data.cells[ref]) || {};
      }
      let val;
      if (raw.f && raw.f.startsWith("=")) {
        try { val = FE.run(raw.f, getCell, ref); }
        catch { val = (raw.v !== undefined && raw.v !== "") ? (isNum(raw.v) ? Number(raw.v) : raw.v) : "#ERROR!"; }
      } else if (raw.v !== undefined && raw.v !== "") {
        val = isNum(raw.v) ? Number(raw.v) : raw.v;
      } else val = "";
      // 动态数组：val 是数组（一维或二维）→ spill 写入 cache 多个位置
      if (Array.isArray(val)) {
        let rows = val.length;
        if (!rows) { cache[ref] = ""; return ""; }
        let cols = Array.isArray(val[0]) ? val[0].length : 1;
        // 超出网格 → 显示 #SPILL!
        const pr = FE.parseRef(ref);
        if (!pr) { cache[ref] = ""; return ""; }
        if (pr.row + rows - 1 > ROWS || pr.col + cols - 1 > COLS) {
          cache[ref] = "#SPILL!"; spillMap[ref] = null; return "#SPILL!";
        }
        // 先把 spill 范围内可能被覆盖的其他带公式单元格记下来（不做处理，简化：假设没有重叠）
        if (!Array.isArray(val[0])) {
          // 一维 → 转成单列
          val = val.map(v => [v]); rows = val.length; cols = 1;
        }
        // 先写主值
        cache[ref] = val[0][0];
        // 再写 spill
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            if (i === 0 && j === 0) continue;
            const spillRef = FE.idxToCol(pr.col + j) + (pr.row + i);
            cache[spillRef] = val[i][j];
          }
        }
        spillMap[ref] = { rows, cols };
        return val[0][0];
      }
      // 旧 spill 残留：ref 之前是 spill 源，现在返回标量，要清旧 spill
      if (spillMap[ref]) {
        const pr = FE.parseRef(ref);
        const old = spillMap[ref];
        for (let i = 0; i < old.rows; i++) for (let j = 0; j < old.cols; j++) {
          if (i === 0 && j === 0) continue;
          const sr = FE.idxToCol(pr.col + j) + (pr.row + i);
          delete cache[sr];
        }
        delete spillMap[ref];
      }
      cache[ref] = val;
      return val;
    }
    function isNum(v) { return typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)) && /^[+-]?[\d.]+$/.test(v)); }

    function recompute() {
      // 1. 清 cache 和旧 spill 记录
      for (const k in cache) delete cache[k];
      // 2. 预算所有带公式的单元格，让动态数组先铺满 cache
      for (const ref in data.cells) {
        const raw = data.cells[ref];
        if (raw.f && raw.f.startsWith("=")) getCell(ref);
      }
      // 3. 统一写 DOM（此时 cache 已被预算全部填满）
      table.querySelectorAll("td[data-ref]").forEach(td => {
        if (td.getAttribute("contenteditable") === "true") return; // 跳过正在编辑的单元格
        const ref = td.dataset.ref;
        let v = getCell(ref);
        if (typeof v === "number" && !isFinite(v)) v = "#DIV/0!";
        if (v === undefined || v === null) v = "";
        if (v instanceof Date) v = v.toLocaleDateString();
        if (typeof v === "boolean") v = v ? "TRUE" : "FALSE";
        if (v instanceof Error) v = "#CALC!";
        td.textContent = String(v);
        td.title = (typeof v === "string" && v.startsWith("#")) ? "公式错误：" + v : "";
      });
      applyCondFormat();
      applyFilters();
      renderCharts();
    }

    function writeCell(ref, val) {
      if (val === "" || val == null) { delete data.cells[ref]; }
      else if (typeof val === "string" && val.startsWith("=")) data.cells[ref] = { f: val };
      else data.cells[ref] = { v: isNum(val) ? Number(val) : val };
      syncWriteToGroup(ref, data.cells[ref]); // 工作组同步
      delete cache[ref];
      recompute();
    }
    function commit(ref, val) {
      // 保护工作表检查
      if (data.protection && data.protection.enabled) {
        const locked = data.locked == null ? true : (data.locked[ref] !== false);
        if (locked) { OS.toast("工作表已保护，此单元格被锁定", "warn"); return false; }
      }
      snapshot(); writeCell(ref, val); ctx.markDirty(); return true;
    }

    // 选择：支持多单元格矩形选区（anchor 为起点，selected 为活动单元格）
    function fmtNum(x) {
      if (!isFinite(x)) return String(x);
      const r = Math.round(x * 1e6) / 1e6;
      return Number.isInteger(r) ? String(r) : r.toFixed(2);
    }
    function rangeRect() {
      const a = FE.parseRef(anchor), s = FE.parseRef(selected);
      if (!a || !s) return null;
      return {
        r1: Math.min(a.row, s.row), r2: Math.max(a.row, s.row),
        c1: Math.min(a.col, s.col), c2: Math.max(a.col, s.col)
      };
    }
    function paint() {
      table.querySelectorAll("td.selected, td.in-range").forEach(e => e.classList.remove("selected", "in-range"));
      table.querySelectorAll("th.head-selected").forEach(e => e.classList.remove("head-selected"));
      const rg = rangeRect(); if (!rg) return;
      const sR = FE.parseRef(selected), sC = sR ? sR.col : -1, sRR = sR ? sR.row : -1;
      // 行列表头高光
      if (sRR > 0) {
        const rowHead = table.querySelector(`th.rowhead[data-row="${sRR}"]`);
        if (rowHead) rowHead.classList.add("head-selected");
      }
      if (sC > 0) {
        const colHead = table.querySelector(`th.colhead[data-col="${sC}"]`);
        if (colHead) colHead.classList.add("head-selected");
      }
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const td = table.querySelector(`td[data-ref="${FE.idxToCol(c)}${r}"]`);
        if (!td) continue;
        if (c === sC && r === sRR) td.classList.add("selected");
        else td.classList.add("in-range");
      }
    }
    function updateStatus() {
      const rg = rangeRect(); if (!rg) return;
      const sR = FE.parseRef(selected), sC = sR ? sR.col : -1, sRR = sR ? sR.row : -1;
      let nums = [], n = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const v = getCell(FE.idxToCol(c) + r);
        if (typeof v === "number" && isFinite(v)) { nums.push(v); n++; }
        else if (typeof v === "string" && v !== "" && !v.startsWith("#") && !isNaN(Number(v))) { nums.push(Number(v)); n++; }
      }
      const sum = nums.reduce((x, y) => x + y, 0);
      const avg = n ? sum / n : 0;
      const single = rg.r1 === rg.r2 && rg.c1 === rg.c2;
      const rangeRef = single ? FE.idxToCol(sC) + sRR : FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2;
      stSum.textContent = `求和=${fmtNum(sum)}　平均=${fmtNum(avg)}`;
      stSel.textContent = `计数=${n}　选定=${rangeRef}`;
      stInfo.textContent = `共 ${Object.keys(data.cells).length} 个带值单元格`;
    }
    /* ============================================================
     * 数据验证 P2 交互：selectCell → list 弹下拉 / inputMessage 提示条
     * ============================================================ */
    let _dvSelect = null;     // 原生 select 下拉
    let _dvInputBar = null;   // inputMessage 提示条
    function _hideDVWidgets() {
      if (_dvSelect) { _dvSelect.remove(); _dvSelect = null; }
      if (_dvInputBar) { _dvInputBar.remove(); _dvInputBar = null; }
    }
    function _findDVForRef(ref) {
      const v = data.validations || [];
      const rg = FE.parseRef(ref); if (!rg) return null;
      for (const rule of v) {
        const rr = rangeRectFromStr(rule.range); if (!rr) continue;
        if (rg.row >= rr.r1 && rg.row <= rr.r2 && rg.col >= rr.c1 && rg.col <= rr.c2) return rule;
      }
      return null;
    }
    function _showDVDropdown(ref) {
      _hideDVWidgets();
      const rule = _findDVForRef(ref);
      if (!rule || rule.type !== "list" || rule.showDropDown === false) return;
      const items = rule.list || [];
      if (!items.length) return;
      const td = table.querySelector('td[data-ref="' + ref + '"]'); if (!td) return;
      const rect = td.getBoundingClientRect();
      const sel = document.createElement("select");
      sel.className = "dv-native-select";
      sel.setAttribute("size", Math.min(items.length, 8));
      sel.style.position = "fixed";
      sel.style.left = (rect.right - 4) + "px";
      sel.style.top = rect.top + "px";
      sel.style.minWidth = Math.max(rect.width, 80) + "px";
      sel.style.zIndex = 10000;
      sel.style.fontSize = "13px";
      sel.style.border = "1px solid var(--accent,#2563eb)";
      sel.style.borderRadius = "4px";
      sel.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
      const curVal = (data.cells[ref] && data.cells[ref].v != null) ? String(data.cells[ref].v) : "";
      for (const it of items) {
        const opt = document.createElement("option");
        opt.value = it; opt.textContent = it;
        if (it === curVal) opt.selected = true;
        sel.appendChild(opt);
      }
      _dvSelect = sel;
      document.body.appendChild(sel);
      sel.focus();
      const commit = () => {
        if (!sel.isConnected) return;
        const val = sel.value;
        _hideDVWidgets();
        snapshot(); writeCell(ref, val); recompute(); paint(); ctx.markDirty();
        const res = validateCell(ref, val);
        if (!res.ok) { const td2 = table.querySelector('td[data-ref="' + ref + '"]'); if (td2) { td2.classList.add("invalid-cell"); _showDVError(res.msg); } }
        const pr = FE.parseRef(ref); if (pr) { const nextRef = FE.idxToCol(pr.col) + (pr.row + 1); selectCell(nextRef); }
      };
      sel.addEventListener("change", commit);
      sel.addEventListener("blur", commit);
      sel.addEventListener("keydown", e => {
        if (e.key === "Escape") { _hideDVWidgets(); e.stopPropagation(); }
        else if (e.key === "Enter") { e.preventDefault(); commit(); }
      });
    }
    function _showDVInputMessage(ref) {
      _hideDVWidgets();
      const rule = _findDVForRef(ref);
      if (!rule) return;
      const im = rule.inputMessage;
      if (!im || !im.show || !im.message) return;
      const td = table.querySelector('td[data-ref="' + ref + '"]'); if (!td) return;
      const rect = td.getBoundingClientRect();
      const bar = document.createElement("div");
      bar.className = "dv-input-bar";
      bar.style.position = "fixed";
      bar.style.left = rect.left + "px";
      bar.style.top = (rect.top - 4) + "px";
      bar.style.transform = "translateY(-100%)";
      bar.style.background = "#fff7ed";
      bar.style.border = "1px solid #f59e0b";
      bar.style.borderRadius = "6px";
      bar.style.padding = "6px 12px";
      bar.style.fontSize = "12px";
      bar.style.color = "#92400e";
      bar.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
      bar.style.zIndex = 9999;
      bar.style.maxWidth = "320px";
      bar.style.whiteSpace = "normal";
      bar.style.pointerEvents = "none";
      const title = im.title ? '<b style="margin-right:6px">' + im.title + ':</b>' : '';
      bar.innerHTML = title + im.message;
      _dvInputBar = bar;
      document.body.appendChild(bar);
      setTimeout(() => { if (_dvInputBar === bar) { bar.style.opacity = "0"; bar.style.transition = "opacity .3s"; setTimeout(() => bar.remove(), 300); _dvInputBar = null; } }, 4000);
    }
    function _showDVError(msg) {
      OS.toast(msg, "warn");
    }

    function selectCell(ref) {
      anchor = ref; selected = ref;
      paint();
      refInput.value = ref;
      const raw = data.cells[ref];
      fx.value = raw ? (raw.f || raw.v) : "";
      updateStatus();
      // P2 数据验证交互：隐藏旧弹层，显示新的 dropdown / inputMessage
      _hideDVWidgets();
      _showDVInputMessage(ref);
      // list 类型：延迟 120ms（等 paint + 滚动完成）弹下拉
      setTimeout(() => _showDVDropdown(ref), 120);
    }
    function select(ref) { selectCell(ref); }
    selectCell("A1");

    /* ============================================================
     * 批注系统（Excel 风格：按单元格引用挂载，侧栏展示）
     * ============================================================ */
    const cmtPanel = wrap.querySelector(".sheet-cmt-panel");
    const cmtList = wrap.querySelector(".cmt-list");
    const cmtCount = wrap.querySelector(".cmt-count");
    const cmtToggle = wrap.querySelector("#cmt-toggle");
    const cmtClose = wrap.querySelector("#cmt-close");
    let panelOpen = false, activeCid = null, navIdx = 0;

    function genId() { return "cmt" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function commentsOf(ref, sheet) {
      const si = sheet != null ? sheet : data.activeSheet;
      return (data.comments || []).filter(c => c.ref === ref && (c.sheet == null || c.sheet === si));
    }
    function currentRef() { return selected; }

    function setPanelOpen(open) {
      panelOpen = open;
      cmtPanel.classList.toggle("hidden", !open);
      cmtToggle.classList.toggle("off", !open);
    }
    function togglePanel() { setPanelOpen(!panelOpen); }
    if (cmtToggle) cmtToggle.addEventListener("click", togglePanel);
    if (cmtClose) cmtClose.addEventListener("click", () => setPanelOpen(false));

    // 单元格徽章渲染：红色三角角标表示该格有批注
    function highlightBadges() {
      // 清掉旧徽章
      table.querySelectorAll(".cmt-badge").forEach(b => b.remove());
      const si = data.activeSheet;
      const refs = new Set();
      (data.comments || []).forEach(c => { if (c.sheet == null || c.sheet === si) refs.add(c.ref); });
      refs.forEach(ref => {
        const td = table.querySelector('td[data-ref="' + ref + '"]');
        if (!td) return;
        if (td.querySelector(".cmt-badge")) return;
        const badge = document.createElement("span");
        badge.className = "cmt-badge";
        badge.title = (commentsOf(ref).filter(c => !c.resolved).length || commentsOf(ref).length) + " 条批注";
        td.style.position = "relative";
        td.appendChild(badge);
      });
    }

    function addComment() {
      const ref = currentRef();
      const cid = genId();
      data.comments = data.comments || [];
      data.comments.push({
        id: cid, ref: ref, sheet: data.activeSheet,
        author: "我", createdAt: Date.now(), resolved: false,
        replies: []
      });
      activeCid = cid;
      setPanelOpen(true);
      renderComments();
      highlightBadges();
      const input = cmtList.querySelector('.cmt-card[data-cid="' + cid + '"] .cmt-input');
      if (input) input.focus();
      ctx.markDirty();
      OS.toast("已为 " + ref + " 添加批注", "ok");
    }

    function renderComments() {
      cmtList.innerHTML = "";
      const pending = (data.comments || []).filter(c => !c.resolved);
      const resolved = (data.comments || []).filter(c => c.resolved);
      cmtCount.textContent = data.comments && data.comments.length
        ? (pending.length ? pending.length + " 条待处理" : "全部已解决")
        : "";
      if (!data.comments || !data.comments.length) {
        cmtList.innerHTML = '<div class="cmt-empty">暂无批注。<br>选中一个单元格，在「审阅」选项卡点「新建批注」即可添加。</div>';
        return;
      }
      pending.concat(resolved).forEach(c => cmtList.appendChild(commentCard(c)));
    }

    function commentCard(c) {
      const card = document.createElement("div");
      card.className = "cmt-card" + (c.resolved ? " resolved" : "") + (c.id === activeCid ? " active" : "");
      card.dataset.cid = c.id;
      const firstText = c.replies && c.replies[0] ? c.replies[0].text : "";
      const repliesHtml = (c.replies || []).slice(1).map(r =>
        `<div class="cmt-reply"><div class="cmt-reply-head"><b>${OS.util.escapeHtml(r.author)}</b><span>${OS.util.fmtTime(r.createdAt)}</span></div><div class="cmt-reply-text">${OS.util.escapeHtml(r.text)}</div></div>`
      ).join("");
      card.innerHTML = `
        <div class="cmt-card-head">
          <span class="cmt-avatar">${OS.util.escapeHtml((c.author || "我").slice(0, 1))}</span>
          <span class="cmt-author">${OS.util.escapeHtml(c.author || "我")}</span>
          <span class="cmt-time">${OS.util.fmtTime(c.createdAt)}</span>
          ${c.resolved ? '<span class="cmt-badge-text">已解决</span>' : ''}
        </div>
        <div class="cmt-ref" title="跳到单元格">📌 ${OS.util.escapeHtml(c.ref || "")}</div>
        ${firstText ? `<div class="cmt-quote">${OS.util.escapeHtml(firstText)}</div>` : `<div class="cmt-quote cmt-empty-quote" title="批注正文">（空批注）</div>`}
        <div class="cmt-replies">${repliesHtml}</div>
        <div class="cmt-add">
          <input type="text" class="cmt-input" placeholder="回复…（第一次发就是批注正文）" />
          <button class="cmt-send" title="发送">${OS.icons ? OS.icons.svg("chevron-right", 16) : "➤"}</button>
        </div>
        <div class="cmt-actions">
          <button class="cmt-btn cmt-resolve">${c.resolved ? "重新打开" : "解决"}</button>
          <button class="cmt-btn cmt-del" title="删除">${OS.icons ? OS.icons.svg("trash", 14) : "🗑"}</button>
        </div>`;
      card.querySelector(".cmt-ref").onclick = () => focusInCell(c.id);
      card.querySelector(".cmt-resolve").onclick = () => toggleResolve(c.id);
      card.querySelector(".cmt-del").onclick = () => deleteComment(c.id);
      const input = card.querySelector(".cmt-input");
      const send = () => { const v = input.value.trim(); if (!v) return; addReply(c.id, v); };
      card.querySelector(".cmt-send").onclick = send;
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); send(); } });
      return card;
    }

    function addReply(cid, text) {
      const c = (data.comments || []).find(x => x.id === cid); if (!c) return;
      c.replies = c.replies || [];
      c.replies.push({ author: "我", text, createdAt: Date.now() });
      renderComments();
      highlightBadges();
      const input = cmtList.querySelector('.cmt-card[data-cid="' + cid + '"] .cmt-input');
      if (input) input.focus();
      ctx.markDirty();
    }

    function toggleResolve(cid) {
      const c = (data.comments || []).find(x => x.id === cid); if (!c) return;
      c.resolved = !c.resolved;
      renderComments();
      highlightBadges();
      ctx.markDirty();
    }

    function deleteComment(cid) {
      if (!confirm("删除这条批注？")) return;
      data.comments = (data.comments || []).filter(x => x.id !== cid);
      if (activeCid === cid) activeCid = null;
      renderComments();
      highlightBadges();
      ctx.markDirty();
    }

    function resolveAll() {
      let n = 0;
      (data.comments || []).forEach(c => { if (!c.resolved) { c.resolved = true; n++; } });
      if (n) { renderComments(); highlightBadges(); ctx.markDirty(); OS.toast("已解决 " + n + " 条批注", "ok"); }
      else OS.toast("没有待处理的批注", "warn");
    }

    function navComment(dir) {
      const pending = (data.comments || []).filter(c => !c.resolved);
      if (!pending.length) { OS.toast("没有待处理的批注", "warn"); return; }
      navIdx = (navIdx + dir + pending.length) % pending.length;
      focusInCell(pending[navIdx].id);
    }

    function focusInCell(cid) {
      const c = (data.comments || []).find(x => x.id === cid); if (!c) return;
      if (c.sheet != null && c.sheet !== data.activeSheet && data.sheets[c.sheet]) {
        switchSheet(c.sheet);
      }
      activeCid = cid;
      selectCell(c.ref);
      const td = table.querySelector('td[data-ref="' + c.ref + '"]');
      if (td && td.scrollIntoView) { try { td.scrollIntoView({ block: "center" }); } catch (e) {} }
      setPanelOpen(true);
      highlightCommentCard(cid);
    }

    function highlightCommentCard(cid) {
      cmtList.querySelectorAll(".cmt-card").forEach(el => el.classList.toggle("active", el.dataset.cid === cid));
      const card = cmtList.querySelector('.cmt-card[data-cid="' + cid + '"]');
      if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: "nearest" }); } catch (e) {} }
    }

    // 单元格徽章鼠标悬停显示批注气泡
    table.addEventListener("mouseover", e => {
      const badge = e.target.closest(".cmt-badge");
      if (!badge) return;
      const td = badge.parentElement;
      const ref = td ? td.dataset.ref : null;
      if (!ref) return;
      showCmtBubble(badge, ref);
    });
    table.addEventListener("mouseout", e => {
      const b = e.target.closest(".cmt-bubble");
      if (b && b.contains(e.relatedTarget)) return;
      hideCmtBubble();
    });
    let cmtBubble = null;
    function showCmtBubble(anchor, ref) {
      hideCmtBubble();
      const list = commentsOf(ref).filter(c => !c.resolved);
      if (!list.length) return;
      cmtBubble = document.createElement("div");
      cmtBubble.className = "cmt-bubble";
      cmtBubble.innerHTML = list.map(c => {
        const first = c.replies && c.replies[0] ? c.replies[0].text : "";
        const txt = first ? OS.util.escapeHtml(first) : "<span class='cmt-empty-quote'>（空批注）</span>";
        return `<div class="cmt-bubble-item"><b>${OS.util.escapeHtml(c.author || "我")}</b> <span class="cmt-time-sm">${OS.util.fmtTime(c.createdAt)}</span><div class="cmt-bubble-text">${txt}</div></div>`;
      }).join("<hr>");
      document.body.appendChild(cmtBubble);
      const r = anchor.getBoundingClientRect();
      cmtBubble.style.top = (r.top + window.scrollY - 4) + "px";
      cmtBubble.style.left = (r.left + window.scrollX + 12) + "px";
    }
    function hideCmtBubble() { if (cmtBubble) { cmtBubble.remove(); cmtBubble = null; } }

    // 切换工作表时重绘徽章
    const _origSwitchSheet = typeof switchSheet === "function" ? switchSheet : null;

    // 跳转到单元格并滚动可见（供全局搜索定位）
    function gotoCell(ref) {
      selectCell(ref);
      const td = table.querySelector('td[data-ref="' + ref + '"]');
      if (td && td.scrollIntoView) { try { td.scrollIntoView({ block: "center" }); } catch (e) {} }
    }
    // 全局文档搜索：扫描所有带值单元格
    function search(query) {
      const q = (query || "").trim(); const out = [];
      if (!q) return out;
      const ql = q.toLowerCase(); const c = data.cells || {};
      Object.keys(c).sort().forEach(ref => {
        const cell = c[ref]; if (!cell) return;
        const v = (cell.f != null ? cell.f : cell.v);
        const s = String(v == null ? "" : v);
        if (s.toLowerCase().indexOf(ql) === -1) return;
        out.push({ label: ref + " = " + s.slice(0, 40), previewHtml: OS.shell.snippet(s, q), goto: () => gotoCell(ref) });
      });
      return out;
    }
    // 程序化查找替换（外壳 Ctrl/Cmd+H 跨文档调用）：在单元格值与公式中替换，集成撤销快照
    function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function replaceAllText(query, replacement, opts) {
      const q = (query || "").trim();
      if (!q) return 0;
      const mc = opts && opts.matchCase;
      const rep = String(replacement == null ? "" : replacement).replace(/\$/g, "$$");
      snapshot();
      const c = data.cells || {};
      let count = 0;
      Object.keys(c).forEach(ref => {
        const cell = c[ref]; if (!cell) return;
        ["v", "f"].forEach(key => {
          const val = cell[key];
          if (typeof val !== "string") return;
          const re = new RegExp(escapeRegex(q), mc ? "g" : "gi");
          if (re.test(val)) {
            count += (val.match(re) || []).length;
            cell[key] = val.replace(re, rep);
          }
        });
      });
      if (count) { buildGrid(); recompute(); renderCharts(); renderSheetTabs(); updateStatus(); ctx.markDirty(); }
      return count;
    }
    // ============ 查找替换面板（Excel 专属） ============
    let findState = { query: "", matchCase: false, hits: [], idx: -1 };
    let findOverlay = null;
    function openFindPanel(mode) {
      if (findOverlay) { findOverlay.hidden = false; findOverlay.querySelector(".sf-find").focus(); runLocalFind(); return; }
      findOverlay = document.createElement("div");
      findOverlay.className = "sf-find-overlay";
      findOverlay.innerHTML = `
        <div class="sf-find-panel">
          <div class="sf-find-h">
            <span>${OS.icons.svg(mode === "replace" ? "replace" : "search", 14)} 查找${mode === "replace" ? "和替换" : ""}</span>
            <button class="icon-btn sf-find-close" title="关闭">✕</button>
          </div>
          <div class="sf-find-body">
            <input class="sf-find sf-input" placeholder="查找内容…" />
            ${mode === "replace" ? '<input class="sf-repl sf-input" placeholder="替换为（留空=删除）…" />' : ""}
            <label class="sf-case"><input type="checkbox" /> 区分大小写</label>
            <div class="sf-count"></div>
            <div class="sf-find-btns">
              <button class="btn" data-sf="prev">↑ 上一个</button>
              <button class="btn" data-sf="next">↓ 下一个</button>
              ${mode === "replace" ? '<button class="btn primary" data-sf="repl1">替换当前</button>' : ""}
              ${mode === "replace" ? '<button class="btn" data-sf="replall">替换全部</button>' : ""}
            </div>
          </div>
        </div>`;
      document.body.appendChild(findOverlay);
      const inp = findOverlay.querySelector(".sf-find");
      const repl = findOverlay.querySelector(".sf-repl");
      const caseChk = findOverlay.querySelector(".sf-case input");
      const countEl = findOverlay.querySelector(".sf-count");
      findOverlay.querySelector(".sf-find-close").onclick = () => { findOverlay.hidden = true; clearFind(); };
      inp.addEventListener("input", () => runLocalFind());
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape") { findOverlay.hidden = true; clearFind(); }
      });
      if (repl) repl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } });
      caseChk.addEventListener("change", () => runLocalFind());
      findOverlay.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => {
        const a = b.dataset.sf;
        if (a === "prev") gotoHit(-1);
        else if (a === "next") gotoHit(1);
        else if (a === "repl1") replaceOne();
        else if (a === "replall") replaceAllLocal();
      });
      if (mode === "replace" && repl) repl.focus(); else inp.focus();
    }
    function clearFind() {
      findState.hits = []; findState.idx = -1;
      if (findOverlay) findOverlay.querySelector(".sf-count").textContent = "";
    }
    function runLocalFind() {
      if (!findOverlay) return;
      const q = findOverlay.querySelector(".sf-find").value.trim();
      findState.matchCase = findOverlay.querySelector(".sf-case input").checked;
      findState.query = q;
      if (!q) { clearFind(); return; }
      // 复用 search() 但加区分大小写（search 默认不区分）
      const qc = findState.matchCase ? q : q.toLowerCase();
      const c = data.cells || {};
      const hits = [];
      Object.keys(c).sort().forEach(ref => {
        const cell = c[ref]; if (!cell) return;
        const v = (cell.f != null ? cell.f : cell.v);
        const s = String(v == null ? "" : v);
        const t = findState.matchCase ? s : s.toLowerCase();
        if (t.indexOf(qc) === -1) return;
        hits.push({ ref, text: s });
      });
      findState.hits = hits;
      findState.idx = hits.length ? 0 : -1;
      const countEl = findOverlay.querySelector(".sf-count");
      if (hits.length) { countEl.textContent = (findState.idx + 1) + " / " + hits.length; gotoHit(0); }
      else countEl.textContent = "无匹配";
    }
    function gotoHit(dir) {
      if (!findState.hits.length) return;
      findState.idx = (findState.idx + dir + findState.hits.length) % findState.hits.length;
      const h = findState.hits[findState.idx];
      selectCell(h.ref); // 选中
      const td = table.querySelector('td[data-ref="' + h.ref + '"]');
      if (td && td.scrollIntoView) { try { td.scrollIntoView({ block: "center" }); } catch (e) {} }
      findOverlay.querySelector(".sf-count").textContent = (findState.idx + 1) + " / " + findState.hits.length;
    }
    function replaceOne() {
      if (!findState.hits.length || findState.idx < 0) { OS.toast("没有可替换的内容", "warn"); return; }
      const h = findState.hits[findState.idx];
      const rep = findOverlay.querySelector(".sf-repl").value;
      snapshot();
      const cell = data.cells[h.ref];
      const q = findState.query;
      const re = new RegExp(escapeRegex(q), findState.matchCase ? "g" : "gi");
      if (cell.f != null) cell.f = cell.f.replace(re, rep);
      if (typeof cell.v === "string") cell.v = cell.v.replace(re, rep);
      buildGrid(); recompute(); renderCharts(); ctx.markDirty();
      // 从 hits 里移除已替换的（文本可能变了）
      findState.hits.splice(findState.idx, 1);
      const countEl = findOverlay.querySelector(".sf-count");
      if (!findState.hits.length) { countEl.textContent = "替换完成"; findState.idx = -1; }
      else { findState.idx = findState.idx % findState.hits.length; gotoHit(0); }
    }
    function replaceAllLocal() {
      const q = findState.query;
      const rep = findOverlay.querySelector(".sf-repl").value;
      const n = replaceAllText(q, rep, { matchCase: findState.matchCase });
      clearFind();
      OS.toast("已替换 " + n + " 处", n ? "ok" : "warn");
      if (findOverlay) findOverlay.querySelector(".sf-count").textContent = "替换了 " + n + " 处";
    }

    // 拖拽选区 + 单击选择 + Shift 扩展
    let dragging = false, dragMoved = false;
    table.addEventListener("mousedown", e => {
      const td = e.target.closest("td[data-ref]");
      if (!td || td.getAttribute("contenteditable") === "true") return;
      dragging = true; dragMoved = false;
      const ref = td.dataset.ref;
      if (!e.shiftKey) anchor = ref;
      selected = ref; paint(); updateStatus();
    });
    table.addEventListener("mousemove", e => {
      if (!dragging) return;
      const td = e.target.closest("td[data-ref]");
      if (!td) return;
      const ref = td.dataset.ref;
      if (ref !== selected) { dragMoved = true; selected = ref; paint(); updateStatus(); }
    });
    const _ssMouseUp = () => { dragging = false; };
    window.addEventListener("mouseup", _ssMouseUp);
    table.addEventListener("click", e => {
      const td = e.target.closest("td[data-ref]");
      if (!td || td.getAttribute("contenteditable") === "true") return;
      if (dragMoved) { dragMoved = false; return; } // 拖拽已设置选区
      const ref = td.dataset.ref;
      if (e.shiftKey) { selected = ref; paint(); updateStatus(); }
      else selectCell(ref);
    });

    // 双击编辑
    table.addEventListener("dblclick", e => {
      const td = e.target.closest("td[data-ref]"); if (!td) return;
      editCell(td);
    });
    function editCell(td) {
      const ref = td.dataset.ref;
      td.setAttribute("contenteditable", "true");
      td.classList.add("selected");
      td.focus();
      document.execCommand("selectAll", false, null);
    }
    // ===== Excel 兼容快捷键辅助函数 =====
    function findDataEdge(row, col, d) {
      const has = (r, c) => { const cell = data.cells[FE.idxToCol(c) + r]; return cell && (cell.v !== undefined && cell.v !== "" || cell.f); };
      let r = row, c = col;
      if (has(r, c)) { while (true) { const nr = r + d[0], nc = c + d[1]; if (nr < 1 || nr > ROWS || nc < 1 || nc > COLS || !has(nr, nc)) break; r = nr; c = nc; } }
      else { while (true) { const nr = r + d[0], nc = c + d[1]; if (nr < 1 || nr > ROWS || nc < 1 || nc > COLS) break; r = nr; c = nc; if (has(r, c)) { while (true) { const nr2 = r + d[0], nc2 = c + d[1]; if (nr2 < 1 || nr2 > ROWS || nc2 < 1 || nc2 > COLS || !has(nr2, nc2)) break; r = nr2; c = nc2; } break; } } }
      return { row: r, col: c };
    }
    function findDataMax() { let mR = 1, mC = 1; for (const ref in data.cells) { const p = FE.parseRef(ref); if (!p) continue; if (p.row > mR) mR = p.row; if (p.col > mC) mC = p.col; } return { row: mR, col: mC }; }
    function fillDown() { const rg = rangeRect(); if (!rg || rg.r1 === rg.r2) { OS.toast("请选择多行区域", "warn"); return; } snapshot(); let count = 0; for (let c = rg.c1; c <= rg.c2; c++) { const src = data.cells[FE.idxToCol(c) + rg.r1]; if (!src) continue; for (let r = rg.r1 + 1; r <= rg.r2; r++) { const ref = FE.idxToCol(c) + r; const dR = r - rg.r1; if (src.f) writeCell(ref, FE.adjustFormula(src.f, dR, 0)); else writeCell(ref, String(src.v === undefined ? "" : src.v)); count++; } } recompute(); applyFmt(); ctx.markDirty(); if (count) OS.toast("已向下填充 " + count + " 个单元格", "ok"); }
    function fillRangeWithCurrent() { const rg = rangeRect(); if (!rg) return; const src = data.cells[selected]; if (!src) return; const sp = FE.parseRef(selected); if (!sp) return; snapshot(); for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) { const ref = FE.idxToCol(c) + r; if (ref === selected) continue; const dR = r - sp.row, dC = c - sp.col; if (src.f) writeCell(ref, FE.adjustFormula(src.f, dR, dC)); else writeCell(ref, String(src.v === undefined ? "" : src.v)); } recompute(); applyFmt(); ctx.markDirty(); }
    function selectCol(col) { anchor = FE.idxToCol(col) + 1; selected = FE.idxToCol(col) + ROWS; paint(); updateStatus(); }
    function selectRow(row) { anchor = "A" + row; selected = FE.idxToCol(COLS) + row; paint(); updateStatus(); }

    // ===== P0 辅助：Alt+= SUM 选区求和 =====
    function sumSelection() {
      const rg = rangeRect();
      if (!rg) return;
      const tl = FE.idxToCol(rg.c1) + rg.r1;
      const br = FE.idxToCol(rg.c2) + rg.r2;
      const formula = "=SUM(" + tl + ":" + br + ")";
      // 写入 anchor 所在单元格，或选区下方一格（Excel 行为）
      const ap = FE.parseRef(anchor);
      let writeRef;
      // 优先：选区正下方、同 anchor 列的格子
      const belowRef = FE.idxToCol(ap.col) + (rg.r2 + 1);
      if (rg.r2 + 1 <= ROWS && !data.cells[belowRef]) writeRef = belowRef;
      else writeRef = anchor;
      snapshot();
      writeCell(writeRef, formula);
      recompute(); applyFmt();
      const td = table.querySelector(`td[data-ref="${writeRef}"]`);
      if (td) { td.classList.add("selected"); anchor = writeRef; selected = writeRef; paint(); }
      ctx.markDirty();
      OS.toast("已写入 " + formula + " → " + writeRef, "ok");
    }

    // ===== P0 辅助：Delete/Backspace 清除选区内容 =====
    function clearSelection() {
      const rg = rangeRect();
      if (!rg) return;
      let count = 0;
      snapshot();
      for (let r = rg.r1; r <= rg.r2; r++)
        for (let c = rg.c1; c <= rg.c2; c++) {
          const ref = FE.idxToCol(c) + r;
          if (data.cells[ref]) { delete data.cells[ref]; count++; }
        }
      recompute(); applyFmt(); ctx.markDirty();
      if (count) OS.toast("已清除 " + count + " 个单元格", "ok");
    }

    // ===== P0 辅助：Ctrl+Shift+End/Home 选区扩展 =====
    function expandSelectToCorner(direction) {
      const rg = rangeRect(); if (!rg) return;
      if (direction === "home") {
        // 从当前选区扩展到 A1 对角
        anchor = "A1";
        selected = FE.idxToCol(rg.c2) + rg.r2;
      } else {
        const max = findDataMax();
        anchor = FE.idxToCol(rg.c1) + rg.r1;
        selected = FE.idxToCol(max.col) + max.row;
      }
      paint(); updateStatus();
    }

    // ===== 批量样式：给整个选区（不是只 selected）设样式 =====
    function applyRangeStyle(patch) {
      const rg = rangeRect(); if (!rg) return;
      snapshot();
      for (let r = rg.r1; r <= rg.r2; r++)
        for (let c = rg.c1; c <= rg.c2; c++) {
          const ref = FE.idxToCol(c) + r;
          data.styles[ref] = Object.assign(data.styles[ref] || {}, patch);
        }
      applyFmt(); applyCondFormat(); ctx.markDirty();
    }

    // ===== Excel 7 个数字格式快捷键 =====
    function applyNumberFormat(fmtId) {
      const FMTS = {
        "general":    { code: "General",     label: "常规" },
        "currency":   { code: "$#,##0.00",  label: "货币" },
        "percent":    { code: "0%",          label: "百分比" },
        "scientific": { code: "0.00E+00",    label: "科学" },
        "date":       { code: "yyyy-mm-dd", label: "日期" },
        "time":       { code: "h:mm:ss",     label: "时间" },
        "comma":      { code: "#,##0.00",    label: "千分位" }
      };
      const f = FMTS[fmtId]; if (!f) return;
      applyRangeStyle({ numberFormat: f.code });
      OS.toast("数字格式：" + f.label, "ok");
    }

    // ===== 上一格复制值 / 复制公式 =====
    function copyFromAbove(onlyValue) {
      const ap = FE.parseRef(anchor);
      if (ap.row <= 1) { OS.toast("已是第一行", "info"); return; }
      const aboveRef = FE.idxToCol(ap.col) + (ap.row - 1);
      const above = data.cells[aboveRef];
      if (!above) { OS.toast("上一格为空", "info"); return; }
      snapshot();
      if (onlyValue) {
        const v = above.v != null ? above.v : (above.f != null ? FE.evalFormula(above.f, aboveRef) : null);
        writeCell(anchor, v == null ? "" : v);
      } else {
        if (above.f != null) writeCell(anchor, "=" + above.f);
        else writeCell(anchor, above.v != null ? above.v : "");
      }
      recompute(); applyFmt(); ctx.markDirty();
    }

    // ===== 向右填充（对应 Ctrl+D 向下填充） =====
    function fillRight() {
      const rg = rangeRect(); if (!rg || rg.c2 <= rg.c1) return;
      snapshot();
      const srcRef = FE.idxToCol(rg.c1) + anchorRow();
      const src = data.cells[srcRef];
      if (!src) { OS.toast("源单元格为空", "info"); return; }
      for (let c = rg.c1 + 1; c <= rg.c2; c++) {
        const ref = FE.idxToCol(c) + anchorRow();
        if (src.f) writeCell(ref, "=" + src.f);
        else writeCell(ref, src.v != null ? src.v : "");
      }
      recompute(); applyFmt(); ctx.markDirty();
      OS.toast("已向右填充 " + (rg.c2 - rg.c1) + " 格", "ok");
    }
    function anchorRow() { return FE.parseRef(anchor).row; }

    // ===== 边框快捷：Ctrl+Shift+& 外边框 / Ctrl+Shift+_ 去边框 =====
    function setOuterBorder(remove) {
      const rg = rangeRect(); if (!rg) return;
      snapshot();
      for (let r = rg.r1; r <= rg.r2; r++) {
        for (let c = rg.c1; c <= rg.c2; c++) {
          const ref = FE.idxToCol(c) + r;
          const s = data.styles[ref] || (data.styles[ref] = {});
          if (!s.border) s.border = {};
          if (remove) { s.border = {}; continue; }
          const isEdgeLeft = c === rg.c1, isEdgeRight = c === rg.c2;
          const isEdgeTop = r === rg.r1, isEdgeBottom = r === rg.r2;
          if (isEdgeLeft)   s.border.left   = { style: "thin", color: "#333" }; else delete s.border.left;
          if (isEdgeRight)  s.border.right  = { style: "thin", color: "#333" }; else delete s.border.right;
          if (isEdgeTop)    s.border.top    = { style: "thin", color: "#333" }; else delete s.border.top;
          if (isEdgeBottom) s.border.bottom = { style: "thin", color: "#333" }; else delete s.border.bottom;
        }
      }
      applyFmt(); applyCondFormat(); ctx.markDirty();
      OS.toast(remove ? "已清除选区边框" : "已添加外边框", "ok");
    }

    table.addEventListener("keydown", e => {
      const td = e.target.closest("td[data-ref]");
      if (!td) return;
      const ref = td.dataset.ref;
      const pr = FE.parseRef(ref);
      const editing = td.getAttribute("contenteditable") === "true";
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;

      // ===== 编辑模式下只拦截特定键 =====
      if (editing) {
        if (k === "Escape") { e.preventDefault(); td.removeAttribute("contenteditable"); recompute(); }
        else if (k === "Enter" && !ctrl && !e.altKey) { e.preventDefault(); commitCell(td); move(pr.row + (e.shiftKey ? -1 : 1), pr.col); }
        else if (k === "Enter" && e.altKey) {
          // Alt+Enter → 单元格内换行（插入 \n 而不是提交）
          e.preventDefault();
          td.textContent = td.textContent + "\n";
          // 光标移到末尾
          const sel = window.getSelection(), r = document.createRange();
          r.selectNodeContents(td); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
        }
        else if (k === "Tab") { e.preventDefault(); commitCell(td); move(pr.row, pr.col + (e.shiftKey ? -1 : 1)); }
        else if (ctrl && k === "Enter") { e.preventDefault(); commitCell(td); fillRangeWithCurrent(); }
        return;
      }

      // ===== 非编辑模式 =====
      // --- P0-1: Alt + = → SUM 选区求和 ---
      if (e.altKey && !ctrl && !e.shiftKey && k === "=") { e.preventDefault(); sumSelection(); }
      // --- P0-2: Ctrl + PageDown/PageUp → 切换 sheet ---
      else if (ctrl && k === "PageDown") { e.preventDefault(); const nxt = (data.activeSheet + 1) % data.sheets.length; switchSheet(nxt); }
      else if (ctrl && k === "PageUp") { e.preventDefault(); const nxt = (data.activeSheet - 1 + data.sheets.length) % data.sheets.length; switchSheet(nxt); }
      // --- P0-3: Delete/Backspace → 清除选区内容 ---
      else if (k === "Delete" || k === "Backspace") { e.preventDefault(); clearSelection(); }
      // --- P0-4: Ctrl+9/Ctrl+0 → 隐藏行/列（toast 占位） ---
      else if (ctrl && (k === "9" || k === "(")) { e.preventDefault(); OS.toast("隐藏行（Ctrl+9）— 后续完整实现", "info"); }
      else if (ctrl && (k === "0" || k === ")")) { e.preventDefault(); OS.toast("隐藏列（Ctrl+0）— 后续完整实现", "info"); }
      // --- P0-5: Ctrl+Shift+End/Home → 选区扩展到尾/头部 ---
      else if (ctrl && e.shiftKey && k === "End") { e.preventDefault(); expandSelectToCorner("end"); }
      else if (ctrl && e.shiftKey && k === "Home") { e.preventDefault(); expandSelectToCorner("home"); }

      // ====== Excel 完整快捷键批量补全（P1/P2） ======
      // --- Excel: 7 个数字格式（Ctrl+Shift+~/$/%/^/#/@/!） ---
      else if (ctrl && e.shiftKey && k === "~")  { e.preventDefault(); applyNumberFormat("general"); }
      else if (ctrl && e.shiftKey && k === "$")  { e.preventDefault(); applyNumberFormat("currency"); }
      else if (ctrl && e.shiftKey && k === "%")  { e.preventDefault(); applyNumberFormat("percent"); }
      else if (ctrl && e.shiftKey && k === "^")  { e.preventDefault(); applyNumberFormat("scientific"); }
      else if (ctrl && e.shiftKey && k === "#")  { e.preventDefault(); applyNumberFormat("date"); }
      else if (ctrl && e.shiftKey && k === "@")  { e.preventDefault(); applyNumberFormat("time"); }
      else if (ctrl && e.shiftKey && (k === "!" || k === "1")) { e.preventDefault(); applyNumberFormat("comma"); }
      // --- Excel: 边框 ---
      else if (ctrl && e.shiftKey && k === "&")  { e.preventDefault(); setOuterBorder(false); }
      else if (ctrl && e.shiftKey && k === "_")  { e.preventDefault(); setOuterBorder(true); }
      // --- Excel: 复制值 / 公式 ---
      else if (ctrl && e.shiftKey && k === '"')  { e.preventDefault(); copyFromAbove(true); }
      else if (ctrl && k === "'" || ctrl && k === "`") { e.preventDefault(); copyFromAbove(false); }
      // --- Excel: 重算 ---
      else if (k === "F9") { e.preventDefault(); recompute(); OS.toast("已重算工作表", "ok"); }
      else if (e.shiftKey && k === "F9") { e.preventDefault(); OS.toast("已重算活动 sheet（FE 自动重算）", "ok"); }
      // --- Excel: 转下一格（下一列）---
      else if (ctrl && (k === "r" || k === "R")) { e.preventDefault(); fillRight(); }
      // --- Excel: 转到 / 新建 sheet / 创建表 / 快速填充 / 超链接 / 快速分析（toast）---
      else if (ctrl && (k === "g" || k === "G")) { e.preventDefault(); OS.toast("Ctrl+G 转到 — 开发中", "info"); }
      else if (e.shiftKey && k === "F11") { e.preventDefault(); OS.toast("Shift+F11 新建工作表 — 开发中", "info"); }
      else if (ctrl && (k === "l" || k === "L")) { e.preventDefault(); OS.toast("Ctrl+L 创建表 — 开发中", "info"); }
      else if (ctrl && (k === "t" || k === "T")) { e.preventDefault(); OS.toast("Ctrl+T 创建表 — 开发中", "info"); }
      else if (ctrl && e.shiftKey && k === "L") { e.preventDefault(); OS.toast("Ctrl+Shift+L 切换筛选 — 开发中", "info"); }
      else if (ctrl && (k === "e" || k === "E")) { e.preventDefault(); OS.toast("Ctrl+E 快速填充 — 开发中", "info"); }
      else if (ctrl && (k === "q" || k === "Q")) { e.preventDefault(); OS.toast("Ctrl+Q 快速分析 — 开发中", "info"); }
      else if (ctrl && (k === "k" || k === "K")) { e.preventDefault(); OS.toast("Ctrl+K 超链接 — 开发中", "info"); }
      // --- Excel: 批注 / 重复 / 选择当前区域 ---
      else if (e.shiftKey && k === "F2") { e.preventDefault(); OS.toast("Shift+F2 插入批注 — 开发中", "info"); }
      else if (k === "F4") { e.preventDefault(); OS.toast("F4 重复上一操作 — 开发中", "info"); }
      else if (ctrl && e.shiftKey && k === "*") { e.preventDefault(); OS.toast("Ctrl+Shift+* 选择当前区域 — 开发中", "info"); }
      else if (k === "F8") { e.preventDefault(); OS.toast("F8 扩展选区模式 — 开发中", "info"); }
      else if (ctrl && e.shiftKey && k === "O") { e.preventDefault(); OS.toast("Ctrl+Shift+O 选有批注单元格 — 开发中", "info"); }
      // --- Excel: Ctrl+A 选全表 ---
      else if (ctrl && k === "a") { e.preventDefault(); selectCol(1); selectRow(ROWS); }

      // ===== 原有快捷键（修复 Ctrl+B/I/U/1 改为选区批量）=====
      else if (k === "F2") { e.preventDefault(); td.setAttribute("contenteditable", "true"); td.focus(); const s = window.getSelection(), r = document.createRange(); r.selectNodeContents(td); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
      else if (k === "Enter") { e.preventDefault(); commitCell(td); move(pr.row + (e.shiftKey ? -1 : 1), pr.col); }
      else if (k === "Tab") { e.preventDefault(); commitCell(td); move(pr.row, pr.col + (e.shiftKey ? -1 : 1)); }
      else if (k.startsWith("Arrow")) {
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
        if (ctrl && e.shiftKey) { const edge = findDataEdge(pr.row, pr.col, d); selected = FE.idxToCol(edge.col) + edge.row; paint(); updateStatus(); }
        else if (ctrl) { const edge = findDataEdge(pr.row, pr.col, d); commitCell(td); move(edge.row, edge.col); }
        else if (e.shiftKey) { const nr = Math.max(1, Math.min(ROWS, pr.row + d[0])), nc = Math.max(1, Math.min(COLS, pr.col + d[1])); selected = FE.idxToCol(nc) + nr; paint(); updateStatus(); }
        else { commitCell(td); move(pr.row + d[0], pr.col + d[1]); }
      }
      else if (k === "Home") { e.preventDefault(); if (ctrl) { commitCell(td); move(1, 1); } else { commitCell(td); move(pr.row, 1); } }
      else if (k === "End" && ctrl) { e.preventDefault(); const edge = findDataMax(); commitCell(td); move(edge.row, edge.col); }
      else if (k === "PageDown") { e.preventDefault(); commitCell(td); move(Math.min(ROWS, pr.row + 20), pr.col); }
      else if (k === "PageUp") { e.preventDefault(); commitCell(td); move(Math.max(1, pr.row - 20), pr.col); }
      else if (ctrl && k === " ") { e.preventDefault(); selectCol(pr.col); }
      else if (e.shiftKey && k === " ") { e.preventDefault(); selectRow(pr.row); }
      // --- 样式：走选区批量（Excel 语义）---
      else if (ctrl && (k === "b" || k === "B")) { e.preventDefault(); applyRangeStyle({ bold: !(data.styles[selected] && data.styles[selected].bold) }); }
      else if (ctrl && (k === "i" || k === "I")) { e.preventDefault(); applyRangeStyle({ italic: !(data.styles[selected] && data.styles[selected].italic) }); }
      else if (ctrl && (k === "u" || k === "U")) { e.preventDefault(); applyRangeStyle({ underline: !(data.styles[selected] && data.styles[selected].underline) }); }
      else if (ctrl && k === "5") { e.preventDefault(); applyRangeStyle({ strikethrough: !(data.styles[selected] && data.styles[selected].strikethrough) }); }
      else if (ctrl && k === "d") { e.preventDefault(); fillDown(); }
      else if (ctrl && k === "Enter") { e.preventDefault(); fillRangeWithCurrent(); }
      else if (ctrl && k === ";") { e.preventDefault(); commit(ref, new Date().toLocaleDateString()); recompute(); }
      else if (ctrl && e.shiftKey && (k === ";" || k === ":")) { e.preventDefault(); commit(ref, new Date().toLocaleTimeString()); recompute(); }
      else if (ctrl && k === "1") { e.preventDefault(); OS.toast("Ctrl+1 单元格格式面板 — 开发中", "info"); }
      else if (k === "Escape") { td.removeAttribute("contenteditable"); recompute(); }
      else if (k.length === 1 && !ctrl && !e.metaKey && !e.altKey) {
        if (td.getAttribute("contenteditable") !== "true") { td.setAttribute("contenteditable", "true"); td.textContent = ""; td.focus(); }
      }
    });
    function commitCell(td) {
      if (td.getAttribute("contenteditable") === "true") {
        const ref = td.dataset.ref;
        commit(ref, td.textContent.trim());
        td.removeAttribute("contenteditable");
        const cell = data.cells[ref];
        const val = cell ? (cell.v != null ? cell.v : cell.f) : "";
        const res = validateCell(ref, val);
        if (!res.ok) { td.classList.add("invalid-cell"); OS.toast(ref + "：" + res.msg, "warn"); }
        else td.classList.remove("invalid-cell");
      }
    }
    table.addEventListener("focusout", e => {
      const td = e.target.closest("td[data-ref]");
      if (td && td.getAttribute("contenteditable") === "true") commitCell(td);
    });
    function move(r, c) {
      r = Math.max(1, Math.min(ROWS, r)); c = Math.max(1, Math.min(COLS, c));
      const ref = FE.idxToCol(c) + r; select(ref);
      const td = table.querySelector(`td[data-ref="${ref}"]`); if (td) td.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    fx.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit(selected, fx.value.trim());
        const cell = data.cells[selected];
        const val = cell ? (cell.v != null ? cell.v : cell.f) : "";
        const res = validateCell(selected, val);
        if (!res.ok) OS.toast(selected + "：" + res.msg, "warn");
        select(selected);
      }
    });
    refInput.addEventListener("change", () => { if (FE.parseRef(refInput.value.toUpperCase())) select(refInput.value.toUpperCase()); });

    // 初始填充
    recompute();
    updateStatus();

    // 填充：将活动单元格（anchor）的内容/公式按相对引用填充到整个选区
    function fillSelection() {
      const a = FE.parseRef(anchor), s = FE.parseRef(selected);
      if (!a || !s) return;
      const rg = rangeRect();
      const anchorRef = FE.idxToCol(a.col) + a.row;
      const raw = data.cells[anchorRef];
      if (!raw) { OS.toast("请先在选区左上角单元格输入内容", "warn"); return; }
      const base = raw.f || (raw.v === undefined ? "" : raw.v);
      if (base === "") { OS.toast("活动单元格为空，无法填充", "warn"); return; }
      snapshot();
      let count = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const ref = FE.idxToCol(c) + r;
        if (ref === anchorRef) continue;
        const dR = r - a.row, dC = c - a.col;
        const content = (typeof base === "string" && base.startsWith("=")) ? FE.adjustFormula(base, dR, dC) : base;
        writeCell(ref, content);
        count++;
      }
      OS.toast(`已填充 ${count} 个单元格`, "ok");
    }

    /* ---------------- 排序与筛选 ---------------- */
    function numOf(x) { const n = parseFloat(String(x == null ? "" : x).replace(/,/g, "")); return isNaN(n) ? 0 : n; }
    function compareKey(a, b, asc) {
      let cmp;
      if (typeof a === "number" && typeof b === "number") cmp = a - b;
      else cmp = String(a == null ? "" : a).localeCompare(String(b == null ? "" : b), "zh");
      return asc ? cmp : -cmp;
    }
    // 选定区域内按某列物理重排（Excel 式：移动单元格内容，相对公式随行偏移）
    function sortRange(rangeStr, colLetter, ascending) {
      const rg = rangeRectFromStr(rangeStr); if (!rg) return false;
      snapshot();
      const keyCol = colLetter ? FE.colToIdx(colLetter) : rg.c1;
      const snap = [];
      for (let r = rg.r1; r <= rg.r2; r++) {
        const row = { __row: r };
        for (let c = rg.c1; c <= rg.c2; c++) { const ref = FE.idxToCol(c) + r; row[ref] = data.cells[ref] ? Object.assign({}, data.cells[ref]) : null; }
        const k = getCell(FE.idxToCol(keyCol) + r);
        row.__key = (typeof k === "number") ? k : String(k == null ? "" : k);
        snap.push(row);
      }
      snap.sort((x, y) => compareKey(x.__key, y.__key, ascending !== false));
      snap.forEach((row, k) => {
        const newRow = rg.r1 + k, dRow = newRow - row.__row;
        for (let c = rg.c1; c <= rg.c2; c++) {
          const col = FE.idxToCol(c), ref = col + newRow, cell = row[col + row.__row];
          if (!cell) { delete data.cells[ref]; continue; }
          if (cell.f && cell.f.startsWith("=")) data.cells[ref] = { f: FE.adjustFormula(cell.f, dRow, 0) };
          else data.cells[ref] = Object.assign({}, cell);
        }
      });
      recompute(); ctx.markDirty();
      return true;
    }
    function matchFilter(f, raw) {
      const s = String(raw == null ? "" : raw);
      switch (f.op) {
        case "contains": return s.indexOf(String(f.v)) >= 0;
        case "eq": return s === String(f.v);
        case "neq": return s !== String(f.v);
        case "gt": return numOf(s) > numOf(f.v);
        case "lt": return numOf(s) < numOf(f.v);
        case "blank": return s === "";
        case "nonblank": return s !== "";
      }
      return true;
    }
    // 返回应可见的行号数组；无筛选时返回 null
    function computeVisibleRows() {
      const filters = data.filters || [];
      if (!filters.length) return null;
      const touched = new Map();
      filters.forEach(f => {
        const rg = rangeRectFromStr(f.range); if (!rg) return;
        for (let r = rg.r1; r <= rg.r2; r++) {
          const raw = getCell(f.col + r);
          const ok = matchFilter(f, raw);
          let arr = touched.get(r); if (!arr) { arr = []; touched.set(r, arr); }
          arr.push(ok);
        }
      });
      const vis = [];
      touched.forEach((arr, r) => { if (arr.every(Boolean)) vis.push(r); });
      return vis;
    }
    function applyFilters() {
      table.querySelectorAll("tr").forEach(tr => tr.classList.remove("filtered-out"));
      const vis = computeVisibleRows();
      if (vis === null) { stInfo.textContent = `共 ${Object.keys(data.cells).length} 个带值单元格`; return; }
      const set = new Set(vis);
      for (let r = 1; r <= ROWS; r++) {
        if (!set.has(r)) { const th = table.querySelector(`th.rowhead[data-row="${r}"]`); if (th && th.parentElement) th.parentElement.classList.add("filtered-out"); }
      }
      const hidden = ROWS - set.size;
      stInfo.textContent = `筛选：显示 ${set.size} 行 / 隐藏 ${hidden} 行（共 ${Object.keys(data.cells).length} 个带值单元格）`;
    }
    function applyFilter(rule) {
      snapshot();
      data.filters = data.filters || [];
      data.filters = data.filters.filter(f => !(f.col === rule.col && f.range === rule.range));
      data.filters.push(rule);
      applyFilters(); ctx.markDirty();
      return true;
    }
    function clearFilters() { snapshot(); data.filters = []; applyFilters(); ctx.markDirty(); }

    /* ---------------- 高级筛选 ---------------- */
    // Excel 式高级筛选：条件区域 = 表头行 + 多行条件。同列多条件 AND；不同行 OR（空行忽略）
    // opts: { inPlace: bool, copyTo: {col,row} | null, uniqueOnly: bool, conditionsStr: "A10:C15" }
    function advancedFilter(listRangeStr, opts) {
      const lr = rangeRectFromStr(listRangeStr); if (!lr) return { ok: false, msg: "无效列表区域" };
      const cr = rangeRectFromStr(opts.conditionsStr); if (!cr) return { ok: false, msg: "无效条件区域" };
      // 1. 建立列表区表头 → 列索引映射
      const headerMap = new Map();
      for (let c = lr.c1; c <= lr.c2; c++) {
        const h = String(getCell(FE.idxToCol(c) + lr.r1) ?? "").trim().toLowerCase();
        if (h) headerMap.set(h, c);
      }
      // 2. 解析条件区域：跳过空行；每行内同列多条件 AND；行间 OR
      const headersRow = cr.r1;
      const colHeaders = []; // 条件区域每列对应的列表列索引（null=空条件列）
      for (let c = cr.c1; c <= cr.c2; c++) {
        const h = String(getCell(FE.idxToCol(c) + headersRow) ?? "").trim().toLowerCase();
        colHeaders.push(h ? headerMap.get(h) ?? null : null);
      }
      const condRows = []; // [{colIdx, op, val}[]]
      for (let r = headersRow + 1; r <= cr.r2; r++) {
        // 跳过整行空白
        let rowEmpty = true;
        const rowConds = [];
        for (let cc = 0; cc < colHeaders.length; cc++) {
          const colIdx = colHeaders[cc]; if (colIdx == null) continue;
          const raw = getCell(FE.idxToCol(cr.c1 + cc) + r);
          if (raw === "" || raw == null) continue;
          rowEmpty = false;
          const parsed = _parseCondCell(String(raw));
          rowConds.push({ listCol: colIdx, op: parsed.op, val: parsed.val });
        }
        if (!rowEmpty) condRows.push(rowConds);
      }
      if (!condRows.length) return { ok: false, msg: "条件区域没有有效条件行" };
      // 3. 逐行评估
      snapshot();
      const startRow = lr.r1 + 1;
      const outRows = []; // 匹配的原始行号
      for (let r = startRow; r <= lr.r2; r++) {
        // 列表行必须至少有一个非空单元格才参与筛选
        let rowHasVal = false;
        for (let c = lr.c1; c <= lr.c2; c++) { if (getCell(FE.idxToCol(c) + r) !== "") { rowHasVal = true; break; } }
        if (!rowHasVal) continue;
        let anyRowOK = false;
        for (const rowConds of condRows) {
          let allAnd = true;
          for (const cond of rowConds) {
            const cellVal = getCell(FE.idxToCol(cond.listCol) + r);
            if (!_evalCond(cellVal, cond.op, cond.val)) { allAnd = false; break; }
          }
          if (allAnd) { anyRowOK = true; break; }
        }
        if (anyRowOK) outRows.push(r);
      }
      if (opts.uniqueOnly) {
        const seen = new Set(); const dedup = [];
        for (const r of outRows) {
          const key = []; for (let c = lr.c1; c <= lr.c2; c++) key.push(String(getCell(FE.idxToCol(c) + r) ?? ""));
          const k = key.join("\u0001");
          if (!seen.has(k)) { seen.add(k); dedup.push(r); }
        }
        outRows.length = 0; outRows.push(...dedup);
      }
      if (opts.inPlace) {
        // 就地隐藏
        // 走现有 filters 机制的反向：用 clearFilters + 设置显式 filtered-out
        data.filters = data.filters || [];
        // 先清原有自动筛选的隐藏，再用 applyFilters 之外的机制——直接写 filtered-out
        table.querySelectorAll("tr").forEach(tr => tr.classList.remove("filtered-out"));
        const set = new Set(outRows);
        for (let r = 1; r <= ROWS; r++) {
          const rh = table.querySelector(`th.rowhead[data-row="${r}"]`);
          if (!rh) continue;
          if (r < lr.r1 || r > lr.r2) continue; // 只动列表区
          if (!set.has(r)) rh.parentElement.classList.add("filtered-out");
        }
        stInfo.textContent = `高级筛选：显示 ${outRows.length} 行 / 隐藏 ${(lr.r2 - startRow + 1) - outRows.length} 行`;
        ctx.markDirty();
        return { ok: true, kept: outRows.length, hidden: (lr.r2 - startRow + 1) - outRows.length, msg: `就地隐藏 ${(lr.r2 - startRow + 1) - outRows.length} 行，显示 ${outRows.length} 行` };
      } else if (opts.copyTo) {
        // 复制到新位置，从指定单元格开始写（含表头）
        const tgtR = opts.copyTo.row, tgtC = opts.copyTo.col;
        // 先清目标区域（假设最多写出 outRows.length + 1 行、同宽）
        for (let r = tgtR; r <= tgtR + outRows.length; r++) {
          for (let c = tgtC; c <= tgtC + (lr.c2 - lr.c1); c++) delete data.cells[FE.idxToCol(c) + r];
        }
        // 写表头
        for (let c = lr.c1; c <= lr.c2; c++) {
          const srcRef = FE.idxToCol(c) + lr.r1;
          const dstRef = FE.idxToCol(tgtC + (c - lr.c1)) + tgtR;
          const cell = data.cells[srcRef];
          if (cell) data.cells[dstRef] = Object.assign({}, cell);
          else { const v = getCell(srcRef); if (v !== "" && v != null) data.cells[dstRef] = { v }; }
        }
        // 写数据
        for (let i = 0; i < outRows.length; i++) {
          const srcRow = outRows[i], dstRow = tgtR + 1 + i, dRow = dstRow - srcRow;
          for (let c = lr.c1; c <= lr.c2; c++) {
            const srcRef = FE.idxToCol(c) + srcRow;
            const dstRef = FE.idxToCol(tgtC + (c - lr.c1)) + dstRow;
            const cell = data.cells[srcRef];
            if (!cell) { delete data.cells[dstRef]; continue; }
            if (cell.f && cell.f.startsWith("=")) data.cells[dstRef] = { f: FE.adjustFormula(cell.f, dRow, 0) };
            else data.cells[dstRef] = Object.assign({}, cell);
          }
        }
        recompute(); ctx.markDirty();
        return { ok: true, copied: outRows.length, msg: `已复制 ${outRows.length} 行到 ${FE.idxToCol(tgtC)}${tgtR}` };
      }
    }
    // 解析条件单元格：支持 ">=30", "<>wang", "北京", ">=2024-01-01"
    function _parseCondCell(s) {
      const m = /^(>=|<=|<>|!=|=|>|<)(.+)$/.exec(s.trim());
      if (m) {
        const v = m[2].trim(); const n = parseFloat(v);
        return { op: m[1], val: isNaN(n) || !/^[+-]?[\d.]+$/.test(v) ? v : n };
      }
      // 空单元格 → 等于空
      return { op: "=", val: s };
    }
    function _evalCond(cellVal, op, condVal) {
      const a = (cellVal === undefined || cellVal === null) ? "" : cellVal;
      // 数字比较两边都按数字
      const aN = typeof a === "number" ? a : parseFloat(a);
      const cN = typeof condVal === "number" ? condVal : parseFloat(condVal);
      const bothNum = !isNaN(aN) && !isNaN(cN) && /^[+-]?[\d.]+$/.test(String(condVal));
      const eq = bothNum ? aN === cN : String(a) === String(condVal);
      const lt = bothNum ? aN < cN : String(a) < String(condVal);
      const gt = bothNum ? aN > cN : String(a) > String(condVal);
      switch (op) {
        case "=": return eq;
        case "<": return lt;
        case ">": return gt;
        case "<=": return lt || eq;
        case ">=": return gt || eq;
        case "<>": case "!=": return !eq;
      }
      return true;
    }
    function openAdvancedFilterModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中要筛选的列表区域（含表头）", "warn"); return; }
      const m = openModal("高级筛选");
      const listRow = h(`<label class="cf-row"><span>列表区域（含表头）</span><input class="af-list" style="width:180px;" value="${FE.idxToCol(rg.c1) + rg.r1 + ':' + FE.idxToCol(rg.c2) + rg.r2}"></label>`);
      const condRow = h(`<label class="cf-row"><span>条件区域</span><input class="af-cond" style="width:180px;" placeholder="如 A10:C13"></label>`);
      const modeSel = h(`<label class="cf-row"><span>方式</span><select class="af-mode"><option value="copy">将筛选结果复制到其他位置</option><option value="inplace">在原有区域显示筛选结果</option></select></label>`);
      const copyTarget = h(`<label class="cf-row af-tgt"><span>复制到</span><input class="af-tgt" style="width:100px;" placeholder="如 E10"></label>`);
      const uniqueChk = h(`<label class="cf-row"><input type="checkbox" class="af-unique"><span>只保留唯一的记录</span></label>`);
      modeSel.querySelector(".af-mode").addEventListener("change", e => { copyTarget.style.display = e.target.value === "copy" ? "" : "none"; });
      m.body.appendChild(listRow); m.body.appendChild(condRow); m.body.appendChild(modeSel); m.body.appendChild(copyTarget); m.body.appendChild(uniqueChk);
      const hint = h(`<div style="margin-top:8px;color:#666;font-size:12px;">
        条件区域规则：<br>
        • 第一行写列表区已有的<strong>表头名</strong><br>
        • 同列多条件 = 满足任意一个（OR 同行内）<br>
        • 不同行的条件 = 同时满足所有（AND 跨行）<br>
        • 支持运算符 &gt;= &lt;= &lt;&gt; 及值如 <code>&gt;=30</code> <code>&lt;&gt;王</code>
      </div>`);
      m.body.appendChild(hint);
      m.ok.addEventListener("click", () => {
        const listStr = listRow.querySelector(".af-list").value.trim();
        const condStr = condRow.querySelector(".af-cond").value.trim();
        if (!listStr || !condStr) { OS.toast("请填写列表区域和条件区域", "warn"); return; }
        const mode = modeSel.querySelector(".af-mode").value;
        const unique = !!uniqueChk.querySelector(".af-unique").checked;
        let opts;
        if (mode === "copy") {
          const tgtStr = copyTarget.querySelector(".af-tgt").value.trim();
          if (!tgtStr) { OS.toast("请填写复制到的目标单元格", "warn"); return; }
          const pr = FE.parseRef(tgtStr);
          if (!pr) { OS.toast("目标单元格地址无效", "warn"); return; }
          opts = { inPlace: false, copyTo: { col: pr.col, row: pr.row }, uniqueOnly: unique, conditionsStr: condStr };
        } else {
          opts = { inPlace: true, uniqueOnly: unique, conditionsStr: condStr };
        }
        const res = advancedFilter(listStr, opts);
        if (res.ok) OS.toast(res.msg, "ok"); else OS.toast(res.msg, "err");
        m.close();
      });
    }

    /* ---------------- 数据透视表 ---------------- */
    // 纯函数：根据字段配置生成透视结果数据结构
    // rows: 行字段数组，cols: 列字段数组，values: [{field, func}]
    // 每个 cell: { rowKeys: [...], colKeys: [...], vals: { field: {sum,count,...} } }
    function computePivot(sourceRG, cfg) {
      const headers = [];
      for (let c = sourceRG.c1; c <= sourceRG.c2; c++) headers.push(String(getCell(FE.idxToCol(c) + sourceRG.r1) ?? "").trim() || FE.idxToCol(c));
      const colIdxByName = {}; headers.forEach((h, i) => colIdxByName[h] = sourceRG.c1 + i);
      const rowFields = cfg.rows || [];
      const colFields = cfg.cols || [];
      const valFields = cfg.values || []; // [{name, func}]
      const filters = cfg.filters || []; // [{name, values: Set}] 暂不支持切片器，保留接口
      const startRow = sourceRG.r1 + 1;
      // 构建分组 Key → 聚合桶
      const buckets = new Map(); // key="rowKeys\u0001colKeys" → { rows: Set<rowRow>, vals: Map<field, agg> }
      const rowKeyOrder = []; const rowKeySet = new Set();
      const colKeyOrder = []; const colKeySet = new Set();
      let totalRows = 0;
      for (let r = startRow; r <= sourceRG.r2; r++) {
        let hasVal = false;
        for (let c = sourceRG.c1; c <= sourceRG.c2; c++) { if (getCell(FE.idxToCol(c) + r) !== "") { hasVal = true; break; } }
        if (!hasVal) continue;
        totalRows++;
        // 行字段值
        const rowKeys = rowFields.map(n => { const v = getCell(FE.idxToCol(colIdxByName[n] || sourceRG.c1) + r); return v == null || v === "" ? "(空白)" : String(v); });
        const colKeys = colFields.map(n => { const v = getCell(FE.idxToCol(colIdxByName[n] || sourceRG.c1) + r); return v == null || v === "" ? "(空白)" : String(v); });
        const rowKey = rowKeys.join("\u0002"); if (!rowKeySet.has(rowKey)) { rowKeySet.add(rowKey); rowKeyOrder.push(rowKeys); }
        const colKey = colKeys.join("\u0002"); if (!colKeySet.has(colKey)) { colKeySet.add(colKey); colKeyOrder.push(colKeys); }
        const fullKey = rowKey + "\u0001" + colKey;
        let bucket = buckets.get(fullKey);
        if (!bucket) { bucket = { rowRow: r, vals: new Map() }; buckets.set(fullKey, bucket); }
        for (const vf of valFields) {
          let agg = bucket.vals.get(vf.name);
          if (!agg) agg = { sum: 0, count: 0, nonEmpty: 0, min: Infinity, max: -Infinity };
          const raw = getCell(FE.idxToCol(colIdxByName[vf.name] || sourceRG.c1) + r);
          if (raw !== "" && raw != null) {
            agg.nonEmpty++;
            const n = typeof raw === "number" ? raw : parseFloat(raw);
            if (!isNaN(n)) { agg.sum += n; agg.count++; if (n < agg.min) agg.min = n; if (n > agg.max) agg.max = n; }
          }
          bucket.vals.set(vf.name, agg);
        }
      }
      // 生成输出结构
      const outRows = []; // 行表头 + 数据行
      const outCols = []; // 列表头（不含行字段列）
      const rowHeaderCols = rowFields.length;
      // 列表头：每个 valField × 每个 colKey → 一列；如果没有 colFields，就每个 valField 一列
      if (colFields.length) {
        for (const colKey of colKeyOrder) {
          for (const vf of valFields) outCols.push({ colKeys: colKey, vf });
        }
      } else {
        for (const vf of valFields) outCols.push({ colKeys: [], vf });
      }
      // 行表头行（最上面一行）：如果 colFields > 1，需要两层表头
      const headerRows = [];
      if (colFields.length && colFields.length > 1) {
        headerRows.push([]); headerRows.push([]);
        // 顶层：colFields 第一个字段的值，带 rowspan=2 跨两层
        for (const colKey of colKeyOrder) {
          const cell = { text: colKey[0], rowSpan: 1, colSpan: valFields.length };
          headerRows[0].push(cell);
        }
        // 下层：每个 valField 名
        for (const colKey of colKeyOrder) {
          for (const vf of valFields) headerRows[1].push({ text: vf.name + " (" + vf.func + ")" });
        }
      } else if (colFields.length === 1) {
        headerRows.push([]);
        for (const colKey of colKeyOrder) {
          for (const vf of valFields) headerRows[0].push({ text: colKey[0] + ": " + vf.name + " (" + vf.func + ")" });
        }
      } else {
        headerRows.push([]);
        for (const vf of valFields) headerRows[0].push({ text: vf.name + " (" + vf.func + ")" });
      }
      // 数据行：每个 rowKeyOrder 项 → 一行
      const dataRows = [];
      for (const rowKeys of rowKeyOrder) {
        const cells = [];
        for (let i = 0; i < rowFields.length; i++) cells.push(rowKeys[i]);
        for (const colOut of outCols) {
          const fullKey = rowKeys.join("\u0002") + "\u0001" + colOut.colKeys.join("\u0002");
          const bucket = buckets.get(fullKey);
          if (!bucket) { cells.push(""); continue; }
          const agg = bucket.vals.get(colOut.vf.name);
          if (!agg) { cells.push(""); continue; }
          cells.push(_pivotAgg(agg, colOut.vf.func));
        }
        dataRows.push(cells);
      }
      // 总计行
      const grandTotal = [];
      for (let i = 0; i < rowFields.length; i++) grandTotal.push("总计");
      for (const colOut of outCols) {
        let agg = { sum: 0, count: 0, nonEmpty: 0, min: Infinity, max: -Infinity };
        for (const bucket of buckets.values()) {
          const b = bucket.vals.get(colOut.vf.name); if (!b) continue;
          agg.sum += b.sum; agg.count += b.count; agg.nonEmpty += b.nonEmpty;
          if (b.min < agg.min) agg.min = b.min;
          if (b.max > agg.max) agg.max = b.max;
        }
        grandTotal.push(_pivotAgg(agg, colOut.vf.func));
      }
      dataRows.push(grandTotal);
      return { rowFields, colFields, headerRows, rowHeaderCols, dataRows, totalRows, outCols };
    }
    function _pivotAgg(agg, func) {
      if (!agg) return "";
      switch (func) {
        case "SUM": return agg.count > 0 ? agg.sum : 0;
        case "COUNT": return agg.nonEmpty;
        case "COUNTA": return agg.nonEmpty;
        case "COUNTNUM": return agg.count;
        case "AVERAGE": return agg.count > 0 ? agg.sum / agg.count : "#DIV/0!";
        case "MAX": return agg.count > 0 ? agg.max : "";
        case "MIN": return agg.count > 0 ? agg.min : "";
        case "PRODUCT": return agg.count > 0 ? "" : 0; // 简化
      }
      return agg.nonEmpty;
    }
    // 将 pivotResult 写入工作表，从 startRef 开始（覆盖）
    function writePivotToSheet(pivotRes, startRef) {
      const sp = FE.parseRef(startRef); if (!sp) return { ok: false, msg: "无效起始位置" };
      snapshot();
      // 清目标区域
      let maxR = pivotRes.headerRows.length + pivotRes.dataRows.length + 2;
      let maxC = pivotRes.rowHeaderCols + pivotRes.outCols.length;
      for (let r = sp.row; r < sp.row + maxR; r++) {
        for (let c = sp.col; c < sp.col + maxC; c++) delete data.cells[FE.idxToCol(c) + r];
      }
      // 写表头
      for (let h = 0; h < pivotRes.headerRows.length; h++) {
        for (let c = 0; c < pivotRes.rowHeaderCols; c++) {
          const ref = FE.idxToCol(sp.col + c) + (sp.row + h);
          data.cells[ref] = { v: pivotRes.rowFields[c] || "" };
          if (!data.styles[ref]) data.styles[ref] = {};
          data.styles[ref].bold = true; data.styles[ref].bg = "#eef2f7";
        }
        for (let c = 0; c < pivotRes.headerRows[h].length; c++) {
          const ref = FE.idxToCol(sp.col + pivotRes.rowHeaderCols + c) + (sp.row + h);
          const cell = pivotRes.headerRows[h][c];
          data.cells[ref] = { v: cell.text };
          if (!data.styles[ref]) data.styles[ref] = {};
          data.styles[ref].bold = true; data.styles[ref].bg = "#eef2f7"; data.styles[ref].align = "center";
        }
      }
      // 写数据
      for (let r = 0; r < pivotRes.dataRows.length; r++) {
        const isLast = r === pivotRes.dataRows.length - 1;
        for (let c = 0; c < pivotRes.dataRows[r].length; c++) {
          const ref = FE.idxToCol(sp.col + c) + (sp.row + pivotRes.headerRows.length + r);
          const v = pivotRes.dataRows[r][c];
          if (v === "" || v == null) { delete data.cells[ref]; continue; }
          if (typeof v === "number") data.cells[ref] = { v };
          else data.cells[ref] = { v: String(v) };
          if (isLast) {
            if (!data.styles[ref]) data.styles[ref] = {};
            data.styles[ref].bold = true; data.styles[ref].bg = "#f6f8fa";
          }
        }
      }
      // 合并单元格：多行表头下，第一行同 colSpan 合并
      if (pivotRes.headerRows.length > 1) {
        // 第一层：headerRows[0] 的每个 cell 跨 valFields.length 列
        let c = 0;
        for (const cell of pivotRes.headerRows[0]) {
          if (cell.colSpan > 1) {
            const startCol = sp.col + pivotRes.rowHeaderCols + c;
            const endCol = startCol + cell.colSpan - 1;
            const startRef = FE.idxToCol(startCol) + sp.row;
            const endRef = FE.idxToCol(endCol) + sp.row;
            const mrg = startRef + ":" + endRef;
            data.merge = data.merge || [];
            if (!data.merge.some(m => m.range.toUpperCase() === mrg.toUpperCase())) {
              data.merge.push({ range: mrg.toUpperCase(), type: "merge" });
            }
          }
          c += cell.colSpan || 1;
        }
      }
      recompute(); applyMerges(); applyFmt(); ctx.markDirty();
      return { ok: true, rows: pivotRes.dataRows.length, cols: pivotRes.rowHeaderCols + pivotRes.outCols.length, msg: `已生成数据透视表（${pivotRes.dataRows.length - 1} 行数据 + 总计）` };
    }
    function openPivotModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中数据区域（含表头）", "warn"); return; }
      const headers = [];
      for (let c = rg.c1; c <= rg.c2; c++) headers.push(String(getCell(FE.idxToCol(c) + rg.r1) ?? "").trim() || FE.idxToCol(c));
      const m = openModal("数据透视表");
      m.body.style.minWidth = "540px";
      // 字段列表
      const fieldBox = h(`<div style="margin-bottom:8px;"><strong>字段列表</strong>：请在下方选择行/列/值字段。</div>`);
      // 三行选择器：行字段、列字段、值字段（支持多选，逗号分隔）
      const rowSel = h(`<label class="cf-row"><span>行字段</span><select class="pv-row" multiple size="3" style="width:180px;"></select><span class="pv-row-hint" style="color:#888;font-size:11px;">Ctrl 多选</span></label>`);
      const colSel = h(`<label class="cf-row"><span>列字段</span><select class="pv-col" multiple size="3" style="width:180px;"></select></label>`);
      const valSel = h(`<label class="cf-row"><span>值字段</span><select class="pv-val" multiple size="3" style="width:180px;"></select></label>`);
      for (const h of headers) {
        const o1 = document.createElement("option"); o1.value = h; o1.textContent = h;
        const o2 = document.createElement("option"); o2.value = h; o2.textContent = h;
        const o3 = document.createElement("option"); o3.value = h; o3.textContent = h;
        rowSel.querySelector(".pv-row").appendChild(o1);
        colSel.querySelector(".pv-col").appendChild(o2);
        valSel.querySelector(".pv-val").appendChild(o3);
      }
      // 汇总方式（默认 SUM，对 COUNT 自动切换）
      const funcSel = h(`<label class="cf-row"><span>默认汇总方式</span><select class="pv-func">
        <option value="SUM">求和 SUM</option>
        <option value="COUNT">计数 COUNTA（非空）</option>
        <option value="COUNTNUM">数值计数 COUNT</option>
        <option value="AVERAGE">平均值 AVERAGE</option>
        <option value="MAX">最大值 MAX</option>
        <option value="MIN">最小值 MIN</option>
      </select></label>`);
      const tgtRow = h(`<label class="cf-row"><span>起始单元格</span><input class="pv-tgt" style="width:100px;" value="${FE.idxToCol(rg.c2 + 2)}${Math.max(1, rg.r1)}"><span style="color:#888;font-size:11px;">（默认为数据区右侧两列）</span></label>`);
      m.body.appendChild(fieldBox);
      m.body.appendChild(rowSel); m.body.appendChild(colSel); m.body.appendChild(valSel);
      m.body.appendChild(funcSel); m.body.appendChild(tgtRow);
      const hint = h(`<div style="margin-top:8px;color:#666;font-size:12px;">
        数据区范围：<code>${FE.idxToCol(rg.c1) + rg.r1 + ':' + FE.idxToCol(rg.c2) + rg.r2}</code>，<strong>${headers.length}</strong> 列 × ${rg.r2 - rg.r1} 行数据。<br>
        汇总引擎：逐行扫描 → 按行/列字段分桶 → 对每个桶内的值字段聚合 → 生成带总计的二维表。
      </div>`);
      m.body.appendChild(hint);
      // 实时预览按钮（生成在后台，先不写表，只算预览）
      const previewBtn = document.createElement("button");
      previewBtn.textContent = "预览";
      previewBtn.className = "btn cf-btn";
      previewBtn.style.marginTop = "6px";
      const previewDiv = h(`<div class="pv-preview" style="margin-top:8px;padding:6px;background:#f6f8fa;border-radius:4px;font-size:11px;color:#555;max-height:120px;overflow:auto;"></div>`);
      previewBtn.addEventListener("click", () => {
        const rowFields = [...rowSel.querySelector(".pv-row").selectedOptions].map(o => o.value);
        const colFields = [...colSel.querySelector(".pv-col").selectedOptions].map(o => o.value);
        const valFields = [...valSel.querySelector(".pv-val").selectedOptions].map(o => ({ name: o.value, func: funcSel.querySelector(".pv-func").value }));
        if (!rowFields.length && !colFields.length && !valFields.length) { previewDiv.textContent = "请至少选一个字段"; return; }
        const res = computePivot(rg, { rows: rowFields, cols: colFields, values: valFields });
        let html = `${res.totalRows} 行原始数据 → ${res.dataRows.length - 1} 行 × ${res.rowHeaderCols + res.outCols.length} 列结果<br>`;
        html += `<code>行字段: [${rowFields.join(", ")}]</code> | <code>列字段: [${colFields.join(", ")}]</code> | <code>值字段: [${valFields.map(v => v.name + "(" + v.func + ")").join(", ")}]</code>`;
        previewDiv.innerHTML = html;
      });
      m.body.appendChild(previewBtn); m.body.appendChild(previewDiv);
      m.ok.addEventListener("click", () => {
        const rowFields = [...rowSel.querySelector(".pv-row").selectedOptions].map(o => o.value);
        const colFields = [...colSel.querySelector(".pv-col").selectedOptions].map(o => o.value);
        const valFields = [...valSel.querySelector(".pv-val").selectedOptions].map(o => ({ name: o.value, func: funcSel.querySelector(".pv-func").value }));
        if (!valFields.length) { OS.toast("请至少选一个值字段", "warn"); return; }
        const tgtStr = tgtRow.querySelector(".pv-tgt").value.trim();
        const res = computePivot(rg, { rows: rowFields, cols: colFields, values: valFields });
        const write = writePivotToSheet(res, tgtStr);
        if (write.ok) OS.toast(write.msg, "ok"); else OS.toast(write.msg, "err");
        m.close();
      });
    }
    // 挂菜单到「数据工具」group
    function _pivotDummy() {} // 占位，Ribbon 引用 openPivotModal 即可

    function openSortModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中要排序的区域", "warn"); return; }
      const m = openModal("自定义排序");
      const colOpts = []; for (let c = rg.c1; c <= rg.c2; c++) colOpts.push(FE.idxToCol(c));
      const colSel = h(`<label class="cf-row"><span>排序依据列</span><select class="sf-col">${colOpts.map(c => `<option value="${c}">${c}</option>`).join("")}</select></label>`);
      const orderSel = h(`<label class="cf-row"><span>顺序</span><select class="sf-order"><option value="asc">升序（小→大 / 拼音 A→Z）</option><option value="desc">降序（大→小 / Z→A）</option></select></label>`);
      m.body.appendChild(colSel); m.body.appendChild(orderSel);
      m.ok.addEventListener("click", () => {
        const col = colSel.querySelector(".sf-col").value;
        const asc = orderSel.querySelector(".sf-order").value === "asc";
        if (sortRange(FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2, col, asc)) OS.toast("已排序", "ok");
        m.close();
      });
    }
    function openFilterModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中要筛选的区域", "warn"); return; }
      const m = openModal("筛选");
      const colOpts = []; for (let c = rg.c1; c <= rg.c2; c++) colOpts.push(FE.idxToCol(c));
      const colSel = h(`<label class="cf-row"><span>列</span><select class="sf-col">${colOpts.map(c => `<option value="${c}">${c}</option>`).join("")}</select></label>`);
      const opSel = h(`<label class="cf-row"><span>条件</span><select class="sf-op"><option value="contains">包含</option><option value="eq">等于</option><option value="neq">不等于</option><option value="gt">大于</option><option value="lt">小于</option><option value="blank">空白</option><option value="nonblank">非空白</option></select></label>`);
      const valRow = h(`<label class="cf-row sf-vrow"><span>值</span><input class="sf-v"></label>`);
      opSel.querySelector(".sf-op").addEventListener("change", e => { valRow.hidden = (e.target.value === "blank" || e.target.value === "nonblank"); });
      m.body.appendChild(colSel); m.body.appendChild(opSel); m.body.appendChild(valRow);
      m.ok.addEventListener("click", () => {
        const rule = { range: FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2, col: colSel.querySelector(".sf-col").value, op: opSel.querySelector(".sf-op").value, v: valRow.querySelector(".sf-v").value };
        applyFilter(rule); OS.toast("已应用筛选", "ok"); m.close();
      });
    }

    /* ---------------- 删除重复值 ---------------- */
    // 扫描选区每行，用"选中列拼接的 key"查重，保留首次出现行，物理上移下方行 + adjustFormula 偏移
    function removeDuplicates(rangeStr, keyCols, hasHeader) {
      const rg = rangeRectFromStr(rangeStr); if (!rg) return { ok: false, msg: "无效区域" };
      snapshot();
      const startRow = hasHeader ? rg.r1 + 1 : rg.r1;
      const rows = [];
      for (let r = startRow; r <= rg.r2; r++) {
        const key = keyCols.map(c => String(getCell(FE.idxToCol(c) + r) ?? "")).join("\u0001");
        rows.push({ r, key });
      }
      const seen = new Set();
      const keepRows = []; // 保留的原始行号（按原顺序）
      const delCount = []; // 被删的原始行号
      for (const row of rows) {
        if (seen.has(row.key)) delCount.push(row.r);
        else { seen.add(row.key); keepRows.push(row.r); }
      }
      if (!delCount.length) { redoStack[redoStack.length - 1] && redo(); return { ok: true, removed: 0, msg: "未发现重复行" }; }
      // 物理重排：新行 r' 上内容来自 keepRows[r' - startRow]
      for (let i = 0; i < keepRows.length; i++) {
        const srcRow = keepRows[i];
        const dstRow = startRow + i;
        const dRow = dstRow - srcRow; // 正=下移，负=上移
        for (let c = rg.c1; c <= rg.c2; c++) {
          const col = FE.idxToCol(c);
          const srcRef = col + srcRow, dstRef = col + dstRow;
          const cell = data.cells[srcRef];
          if (!cell) { delete data.cells[dstRef]; continue; }
          if (cell.f && cell.f.startsWith("=")) data.cells[dstRef] = { f: FE.adjustFormula(cell.f, dRow, 0) };
          else data.cells[dstRef] = Object.assign({}, cell);
        }
      }
      // 清空尾部多余行
      for (let dstRow = startRow + keepRows.length; dstRow <= rg.r2; dstRow++) {
        for (let c = rg.c1; c <= rg.c2; c++) delete data.cells[FE.idxToCol(c) + dstRow];
      }
      recompute(); ctx.markDirty();
      return { ok: true, removed: delCount.length, kept: keepRows.length, msg: `删除 ${delCount.length} 行重复，保留 ${keepRows.length} 行` };
    }
    function openRemoveDupModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中区域", "warn"); return; }
      const m = openModal("删除重复值");
      const colBoxes = [];
      const colWrap = h(`<div class="cf-colboxes"></div>`);
      for (let c = rg.c1; c <= rg.c2; c++) {
        const letter = FE.idxToCol(c);
        const box = h(`<label class="cf-row"><input type="checkbox" checked><span>列 ${letter}${hasHeaderInRange(rg, c) ? "（首行: " + hasHeaderInRange(rg, c) + "）" : ""}</span></label>`);
        box.querySelector("input").dataset.col = c;
        colBoxes.push(box); colWrap.appendChild(box);
      }
      const headerRow = h(`<label class="cf-row"><input type="checkbox" class="cf-hdr" checked><span>我的表有标题行（首行不参与查重）</span></label>`);
      const colBoxesWrap = h(`<fieldset class="cf-fs"><legend>选择判断重复的列</legend></fieldset>`);
      colBoxesWrap.appendChild(colWrap);
      m.body.appendChild(headerRow);
      m.body.appendChild(colBoxesWrap);
      const info = h(`<div class="cf-info" style="margin-top:8px;color:#666;font-size:12px;">将扫描选中区域的每行，勾选的列拼成 key，key 相同保留首次出现行，其余删除。</div>`);
      m.body.appendChild(info);
      m.ok.addEventListener("click", () => {
        const keyCols = colBoxes.filter(b => b.querySelector("input").checked).map(b => parseInt(b.querySelector("input").dataset.col, 10));
        if (!keyCols.length) { OS.toast("请至少勾选一列", "warn"); return; }
        const hasHdr = !!headerRow.querySelector(".cf-hdr").checked;
        const rng = FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2;
        const res = removeDuplicates(rng, keyCols, hasHdr);
        if (res.ok) OS.toast(res.msg, "ok");
        else OS.toast(res.msg, "err");
        m.close();
      });
    }
    function hasHeaderInRange(rg, colIdx) {
      const firstRowVal = String(getCell(FE.idxToCol(colIdx) + rg.r1) ?? "").trim();
      if (!firstRowVal) return null;
      // 检查是否整列首行是文本、下方是数字 → 大概率有标题
      let numBelow = 0, nonNum = 0;
      for (let r = rg.r1 + 1; r <= Math.min(rg.r1 + 5, rg.r2); r++) {
        const v = getCell(FE.idxToCol(colIdx) + r);
        if (typeof v === "number") numBelow++; else nonNum++;
      }
      return (nonNum >= numBelow && isNaN(parseFloat(firstRowVal))) ? firstRowVal.slice(0, 10) : null;
    }

    /* ---------------- 数据分列 ---------------- */
    // 支持：分隔符模式（Tab/逗号/分号/空格/自定义） + 固定宽度模式（位置数组）
    // 从选区起点列开始向右写，右侧溢出时返回警告
    function textToColumns(rangeStr, opts) {
      const rg = rangeRectFromStr(rangeStr); if (!rg) return { ok: false, msg: "无效区域" };
      if (rg.c1 !== rg.c2) return { ok: false, msg: "数据分列只支持单列选区" };
      snapshot();
      const srcCol = rg.c1;
      const startRow = rg.r1, endRow = rg.r2;
      const maxCol = 16384; // Excel 列上限
      // 先拆所有行
      const columns = []; // columns[dstOffset][rowIdx] = value
      let maxSplit = 0;
      for (let r = startRow; r <= endRow; r++) {
        const v = getCell(FE.idxToCol(srcCol) + r);
        const text = String(v == null ? "" : v);
        let parts;
        if (opts.mode === "fixed") {
          // 固定宽度：opts.widths = [w1, w2, ...]，最后一段到末尾
          parts = []; let pos = 0;
          for (const w of opts.widths) { parts.push(text.slice(pos, pos + w)); pos += w; }
          parts.push(text.slice(pos));
        } else {
          // 分隔符模式
          let sep = opts.sep || "\t";
          if (sep === "\\t") sep = "\t";
          if (sep === "\\n") sep = "\n";
          if (sep === "multi") { // 多个连续空格 / Tab 合并
            parts = text.split(/[\t ]+/).filter((p, i, a) => i === 0 || p !== "");
            if (text.startsWith(" ") || text.startsWith("\t")) parts.unshift("");
          } else {
            parts = text.split(sep);
            if (opts.consecutive) parts = parts.filter((p, i, a) => i === 0 || p !== "" || !opts.consecutive);
          }
        }
        if (parts.length > maxSplit) maxSplit = parts.length;
        for (let i = 0; i < parts.length; i++) {
          if (!columns[i]) columns[i] = new Array(endRow - startRow + 1).fill("");
          columns[i][r - startRow] = parts[i];
        }
      }
      const availableCols = maxCol - srcCol;
      const overflow = maxSplit - availableCols;
      if (overflow > 0) {
        // 回滚 snapshot
        redoStack[redoStack.length - 1] && redo();
        return { ok: false, msg: `将拆成 ${maxSplit} 列，但右侧只剩 ${availableCols} 列空间，无法写入。请选更靠右的列再试。` };
      }
      // 从源列开始写入（覆盖源列）
      for (let i = 0; i < maxSplit; i++) {
        const dstCol = srcCol + i;
        const colLetter = FE.idxToCol(dstCol);
        for (let r = startRow; r <= endRow; r++) {
          const val = columns[i][r - startRow];
          if (val === "" || val == null) { delete data.cells[colLetter + r]; continue; }
          const n = parseFloat(val);
          data.cells[colLetter + r] = isNaN(n) || !/^[+-]?[\d.]+$/.test(val)
            ? { v: val } : { v: n };
        }
      }
      recompute(); ctx.markDirty();
      return { ok: true, cols: maxSplit, rows: endRow - startRow + 1, msg: `分列完成：拆成 ${maxSplit} 列，处理 ${endRow - startRow + 1} 行` };
    }
    function openTextToColsModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中单列区域", "warn"); return; }
      if (rg.c1 !== rg.c2) { OS.toast("请选中单列后再分列", "warn"); return; }
      const firstSample = String(getCell(FE.idxToCol(rg.c1) + rg.r1) ?? "");
      const m = openModal("数据分列");
      const modeSel = h(`<label class="cf-row"><span>分列方式</span><select class="cf-mode"><option value="delimit">分隔符</option><option value="fixed">固定宽度</option></select></label>`);
      const delimitBox = h(`<div class="cf-delimit">
        <label class="cf-row"><span>分隔符</span><select class="cf-sep">
          <option value="\\t">Tab（制表符）</option>
          <option value=",">逗号 ,</option>
          <option value=";">分号 ;</option>
          <option value=" ">空格</option>
          <option value="multi">多个空格/Tab 合并</option>
          <option value="|">竖线 |</option>
          <option value="自定义">自定义…</option>
        </select></label>
        <label class="cf-row"><span>自定义</span><input class="cf-custom" style="width:80px;" placeholder="如 /"></label>
        <label class="cf-row"><input type="checkbox" class="cf-cons" checked><span>连续分隔符视为一个</span></label>
      </div>`);
      const fixedBox = h(`<div class="cf-fixed" hidden>
        <p style="margin:4px 0 8px;color:#666;">输入每段字符宽度（从左到右累加），最后一段到行尾。<br>例：列宽 4 + 3 + 5 表示 [0,4) [4,7) [7,12) [12,end]</p>
        <label class="cf-row"><span>宽度（逗号分隔）</span><input class="cf-widths" style="width:180px;" placeholder="如 4,3,5"></label>
      </div>`);
      const preview = h(`<div class="cf-preview" style="margin-top:8px;padding:8px;background:#f6f8fa;border:1px solid #e2e8f0;border-radius:4px;font-size:12px;color:#333;"></div>`);
      m.body.appendChild(modeSel); m.body.appendChild(delimitBox); m.body.appendChild(fixedBox); m.body.appendChild(preview);
      const updatePreview = () => {
        const mode = modeSel.querySelector(".cf-mode").value;
        delimitBox.hidden = (mode !== "delimit"); fixedBox.hidden = (mode !== "fixed");
        if (mode === "delimit") {
          const sepSel = delimitBox.querySelector(".cf-sep").value;
          const custom = delimitBox.querySelector(".cf-custom").value;
          let sep = sepSel === "自定义" ? (custom || "") : sepSel;
          if (sep === "\\t") sep = "\t";
          const consecutive = !!delimitBox.querySelector(".cf-cons").checked;
          let parts;
          if (sep === "multi") parts = firstSample.split(/[\t ]+/).filter(Boolean);
          else { parts = firstSample.split(sep); if (consecutive) parts = parts.filter(Boolean); }
          preview.innerHTML = parts.map((p, i) => `<span style="border-right:1px dashed #c00;padding:0 4px;">列${i + 1}: <code>${_escHtml(p)}</code></span>`).join("") || "（空）";
        } else {
          const wsText = fixedBox.querySelector(".cf-widths").value;
          const ws = wsText.split(",").map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
          let pos = 0; const parts = [];
          for (const w of ws) { parts.push(firstSample.slice(pos, pos + w)); pos += w; }
          parts.push(firstSample.slice(pos));
          preview.innerHTML = parts.map((p, i) => `<span style="border-right:1px dashed #c00;padding:0 4px;">列${i + 1}: <code>${_escHtml(p)}</code></span>`).join("") || "（空）";
        }
      };
      modeSel.querySelector(".cf-mode").addEventListener("change", updatePreview);
      delimitBox.querySelectorAll("select,input").forEach(el => el.addEventListener("input", updatePreview));
      fixedBox.querySelectorAll("select,input").forEach(el => el.addEventListener("input", updatePreview));
      updatePreview();
      m.ok.addEventListener("click", () => {
        const mode = modeSel.querySelector(".cf-mode").value;
        let opts;
        if (mode === "delimit") {
          const sepSel = delimitBox.querySelector(".cf-sep").value;
          const custom = delimitBox.querySelector(".cf-custom").value;
          let sep = sepSel === "自定义" ? (custom || "") : sepSel;
          if (!sep && sepSel !== "multi") { OS.toast("请指定分隔符", "warn"); return; }
          opts = { mode: "delimit", sep, consecutive: !!delimitBox.querySelector(".cf-cons").checked };
        } else {
          const wsText = fixedBox.querySelector(".cf-widths").value;
          const widths = wsText.split(",").map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
          if (!widths.length) { OS.toast("请输入宽度", "warn"); return; }
          opts = { mode: "fixed", widths };
        }
        const res = textToColumns(FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c1) + rg.r2, opts);
        if (res.ok) OS.toast(res.msg, "ok"); else OS.toast(res.msg, "err");
        m.close();
      });
    }
    function _escHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

    /* ---------------- 条件格式（高亮 / 色阶 / 数据条 / 前10 / 重复值） ---------------- */
    function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
    function selRangeStr() { const rg = rangeRect(); if (!rg) return "A1"; return FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2; }
    function cfRaw(ref) { const v = getCell(ref); if (v == null || v === "") return null; if (typeof v === "number" || typeof v === "boolean") return v; return String(v); }
    function cfNumFromRaw(raw) { if (raw == null) return null; if (typeof raw === "number") return raw; const n = parseFloat(String(raw).replace(/,/g, "")); return isNaN(n) ? null : n; }
    function cfNum(ref) { return cfNumFromRaw(cfRaw(ref)); }
    function opLabel(o) { return { gt: "大于", lt: "小于", eq: "等于", ge: "大于等于", le: "小于等于", ne: "不等于", between: "介于", contains: "包含文本" }[o] || o; }
    function matchCell(rule, raw) {
      const n = cfNumFromRaw(raw);
      switch (rule.op) {
        case "gt": return n != null && n > Number(rule.v);
        case "lt": return n != null && n < Number(rule.v);
        case "eq": return String(raw) === String(rule.v);
        case "ge": return n != null && n >= Number(rule.v);
        case "le": return n != null && n <= Number(rule.v);
        case "ne": return String(raw) !== String(rule.v);
        case "between": return n != null && n >= Number(rule.v) && n <= Number(rule.v2);
        case "contains": return String(raw).indexOf(String(rule.v)) >= 0;
      }
      return false;
    }
    function hexToRgb(h) { h = (h || "#000000").replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); const n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
    function lerpColor(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); const r = Math.round(A.r + (B.r - A.r) * t), g = Math.round(A.g + (B.g - A.g) * t), bl = Math.round(A.b + (B.b - A.b) * t); return "rgb(" + r + ", " + g + ", " + bl + ")"; }
    function describeRule(r) {
      if (r.type === "cell") return "突出显示·" + opLabel(r.op) + " " + (r.v2 != null ? r.v + "~" + r.v2 : r.v);
      if (r.type === "scale") return "色阶(" + r.minColor + "→" + r.maxColor + ")";
      if (r.type === "bar") return "数据条(" + r.color + ")";
      if (r.type === "top") return (r.top ? "前" : "后") + r.n + (r.percent ? "%（最大/最小）" : "项");
      if (r.type === "dupes") return "重复值";
      return r.type;
    }
    // 单一数据源：计算所有规则作用后每个单元格的最终样式
    function computeCF() {
      const map = {};
      const push = (ref, style) => { const cur = map[ref] || (map[ref] = {}); if (style.bg != null) cur.bg = style.bg; if (style.color != null) cur.color = style.color; if (style.bar) cur.bar = style.bar; if (style.icon != null) cur.icon = style.icon; if (style.hideText) cur.hideText = style.hideText; };
      (data.condFormats || []).forEach(rule => {
        const rg = rangeRectFromStr(rule.range); if (!rg) return;
        const refs = [];
        for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) refs.push(FE.idxToCol(c) + r);
        if (rule.type === "scale") {
          const vs = refs.map(cfNum).filter(v => v != null); if (!vs.length) return;
          const mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
          refs.forEach(ref => { const v = cfNum(ref); if (v == null) return; const t = mx > mn ? (v - mn) / (mx - mn) : 0;
            if (rule.midColor) {
              // 三色阶：minColor → midColor → maxColor
              const midPct = rule.midPct != null ? rule.midPct : 0.5;
              const col = t <= midPct
                ? lerpColor(rule.minColor, rule.midColor, midPct > 0 ? t / midPct : 0)
                : lerpColor(rule.midColor, rule.maxColor, midPct < 1 ? (t - midPct) / (1 - midPct) : 1);
              push(ref, { bg: col });
            } else {
              push(ref, { bg: lerpColor(rule.minColor, rule.maxColor, t) });
            }
          });
        } else if (rule.type === "bar") {
          const vs = refs.map(cfNum).filter(v => v != null); if (!vs.length) return;
          const mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
          const hasNeg = mn < 0 && mx >= 0;
          refs.forEach(ref => {
            const v = cfNum(ref); if (v == null) return;
            let pct, negPct = 0, posPct = 0;
            if (hasNeg) {
              // 零点在 0，负条从 50% 向左，正条从 50% 向右
              const total = Math.abs(mn) + Math.abs(mx);
              negPct = mn < 0 ? (Math.abs(mn) / total) * 50 : 0;
              posPct = mx > 0 ? (mx / total) * 50 : 0;
              if (v < 0) pct = (Math.abs(v) / Math.abs(mn)) * negPct;
              else pct = (v / mx) * posPct;
            } else {
              pct = mx > mn ? ((v - mn) / (mx - mn)) * 100 : 0;
            }
            push(ref, { bar: { color: rule.color, negColor: rule.negColor || "#ff6363", pct, hasNeg, negPct, posPct, hideText: rule.hideText }, hideText: rule.hideText });
          });
        } else if (rule.type === "icon") {
          const icons = rule.icons || ["🟢", "🟡", "🔴"]; // 默认红绿灯
          const thresholds = rule.thresholds || [0.67, 0.33]; // Excel 默认百分比阈值（top 33% → green, middle 33% → yellow, bottom 33% → red）
          const percentBased = rule.percentThreshold !== false;
          const vs = refs.map(cfNum).filter(v => v != null); if (!vs.length) return;
          const mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
          refs.forEach(ref => {
            const v = cfNum(ref); if (v == null) return;
            let bucket;
            if (percentBased) {
              const rank = vs.filter(x => x != null && x > v).length / vs.length; // 排名比 v 大的比例
              // 或者用百分位：t = (v - mn) / (mx - mn)
              const t = mx > mn ? (v - mn) / (mx - mn) : 0;
              // 高值 → 高优先级（index 0）
              bucket = t >= thresholds[0] ? 0 : (t >= thresholds[1] ? 1 : 2);
            } else {
              // 数值阈值
              bucket = v >= thresholds[0] ? 0 : (v >= thresholds[1] ? 1 : 2);
            }
            push(ref, { icon: icons[bucket] || "" });
          });
        } else if (rule.type === "cell") {
          refs.forEach(ref => { const raw = cfRaw(ref); if (raw == null) return; if (matchCell(rule, raw)) push(ref, { bg: lerpColor(rule.bg, rule.bg, 0) }); });
        } else if (rule.type === "formula") {
          // 公式驱动：对每个 ref，FE.run(rule.formula, getCellForRow, ref) 结果 truthy 就高亮
          refs.forEach(ref => {
            let ok = false;
            try {
              const pr = FE.parseRef(ref);
              const baseCol = pr.col, baseRow = pr.row;
              // getCell 对公式里的相对引用按当前 ref 偏移
              const gcr = (absRef) => {
                const parsed = FE.parseRef(absRef);
                if (!parsed) return getCell(absRef);
                // 简化：公式里相对引用 A1 → 按 ref 偏移（FE.adjustFormula 做不到运行时偏移，自己来）
                const basePR = FE.parseRef(ref);
                const origPR = FE.parseRef(rule.range.split(":")[0] || "A1");
                const dRow = basePR.row - origPR.row, dCol = basePR.col - origPR.col;
                const newCol = parsed.col + dCol, newRow = parsed.row + dRow;
                return getCell(FE.idxToCol(newCol) + newRow);
              };
              const r = FE.run("=" + rule.formula.replace(/^=/, ""), gcr, ref);
              ok = !!r && r !== "#ERROR!" && r !== "#CALC!";
            } catch (e) { ok = false; }
            if (ok) push(ref, { bg: lerpColor(rule.bg, rule.bg, 0) });
          });
        } else if (rule.type === "top") {
          const items = refs.map(ref => ({ ref, v: cfNum(ref) })).filter(x => x.v != null).sort((a, b) => rule.top ? b.v - a.v : a.v - b.v);
          const k = rule.percent ? Math.max(1, Math.round(items.length * rule.n / 100)) : rule.n;
          for (let i = 0; i < Math.min(items.length, k); i++) push(items[i].ref, { bg: lerpColor(rule.bg, rule.bg, 0) });
        } else if (rule.type === "dupes") {
          const counts = {}; refs.forEach(ref => { const k = cfRaw(ref); if (k == null || k === "") return; const key = String(k); counts[key] = (counts[key] || 0) + 1; });
          refs.forEach(ref => { const k = cfRaw(ref); if (k == null || k === "") return; const isDup = counts[String(k)] > 1; if (rule.type === "dupes") { if (isDup) push(ref, { bg: lerpColor(rule.bg, rule.bg, 0) }); } else if (rule.type === "unique") { if (!isDup) push(ref, { bg: lerpColor(rule.bg, rule.bg, 0) }); } });
        }
      });
      return map;
    }
    function applyCondFormat() {
      const map = computeCF();
      cfAppliedRefs.forEach(ref => {
        const td = table.querySelector(`td[data-ref="${ref}"]`); if (!td) return;
        const s = data.styles[ref];
        td.style.backgroundColor = (s && s.bg) ? s.bg : "";
        td.style.color = (s && s.color) ? s.color : "";
        td.style.backgroundImage = ""; td.classList.remove("cf-bar", "cf-has-icon");
        td.style.background = ""; td.innerHTML = td.dataset._origInnerHTML || td.innerHTML;
        // 还原文本（之前 hideText 可能清过）
        const ref2 = ref;
        if (td.dataset._origText != null) { td.textContent = td.dataset._origText; delete td.dataset._origText; }
      });
      cfAppliedRefs = Object.keys(map);
      cfAppliedRefs.forEach(ref => {
        const td = table.querySelector(`td[data-ref="${ref}"]`); if (!td) return;
        const st = map[ref], s = data.styles[ref], mBg = s && s.bg, mColor = s && s.color;
        if (st.bg != null) td.style.backgroundColor = mBg ? mBg : st.bg; else if (mBg) td.style.backgroundColor = mBg;
        if (st.color != null) td.style.color = mColor ? mColor : st.color; else if (mColor) td.style.color = mColor;
        if (st.bar) {
          const b = st.bar;
          let bgImg;
          if (b.hasNeg) {
            // 双向渐变：负条从中间向左（negColor），正条从中间向右（color）
            const negStart = (50 - b.negPct).toFixed(1);
            const posEnd = (50 + b.posPct).toFixed(1);
            bgImg = `linear-gradient(90deg, transparent ${negStart}%, ${b.negColor} ${negStart}%, ${b.negColor} 50%, ${b.color} 50%, ${b.color} ${posEnd}%, transparent ${posEnd}%)`;
          } else {
            bgImg = `linear-gradient(90deg, ${b.color} ${b.pct.toFixed(1)}%, transparent ${b.pct.toFixed(1)}%)`;
          }
          td.style.backgroundImage = bgImg;
          td.classList.add("cf-bar");
          if (b.hideText) { if (td.dataset._origText == null) td.dataset._origText = td.textContent; td.textContent = ""; }
        }
        if (st.icon) {
          // 在文本前插一个 icon span
          td.classList.add("cf-has-icon");
          const iconSpan = `<span class="cf-icon" style="margin-right:3px;">${st.icon}</span>`;
          const origText = td.textContent || "";
          td.innerHTML = iconSpan + origText;
        }
      });
    }
    const CF_SWATCHES = ["#ffc7ce", "#ffeb9c", "#c6efce", "#fce4d6", "#ddebf7", "#e2efda"];
    function openModal(title) {
      const overlay = h(`<div class="cf-overlay"><div class="cf-modal"><div class="cf-modal-h"><span>${title}</span><button class="cf-x" type="button" title="关闭">×</button></div><div class="cf-modal-b"></div><div class="cf-modal-f"><button class="cf-cancel" type="button">取消</button><button class="cf-ok" type="button">确定</button></div></div></div>`);
      wrap.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector(".cf-x").addEventListener("click", close);
      overlay.querySelector(".cf-cancel").addEventListener("click", close);
      overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
      return { overlay, body: overlay.querySelector(".cf-modal-b"), ok: overlay.querySelector(".cf-ok"), close };
    }
    function colorRow(label, def) {
      const row = h(`<label class="cf-row"><span>${label}</span><input type="color" class="cf-color" value="${def}"></label>`);
      const sw = h(`<div class="cf-swatches"></div>`);
      CF_SWATCHES.forEach(c => { const b = h(`<button type="button" class="cf-sw" style="background:${c}" title="${c}"></button>`); b.addEventListener("click", () => { row.querySelector(".cf-color").value = c; }); sw.appendChild(b); });
      row.appendChild(sw);
      return row;
    }
    function saveRule(rule) {
      snapshot();
      data.condFormats = data.condFormats || [];
      const i = data.condFormats.findIndex(r => r.id === rule.id);
      if (i >= 0) data.condFormats[i] = rule; else data.condFormats.push(rule);
      ctx.markDirty(); recompute();
    }
    function openRuleModal(type, existing) {
      const titles = { cell: "突出显示单元格规则", dupes: "重复值", unique: "唯一值", bar: "数据条", scale: "色阶（双色）", scale3: "色阶（三色）", top: "项目选取（前10 / 后10）", icon: "图标集", formula: "公式确定要设置格式的单元格" };
      const m = openModal(titles[type] || "条件格式");
      const rule = existing || { id: "cf" + (data._cfSeq = (data._cfSeq || 0) + 1), type, range: selRangeStr() };
      const rb = h(`<label class="cf-row"><span>应用于范围</span><input class="cf-range" value="${rule.range}"></label>`);
      m.body.appendChild(rb);
      let opSel, v1, v2, c1, c2, c3, topN, topPct, topKind;
      if (type === "cell") {
        opSel = h(`<label class="cf-row"><span>条件</span><select class="cf-op"><option value="gt">大于</option><option value="lt">小于</option><option value="eq">等于</option><option value="between">介于</option><option value="contains">包含文本</option></select></label>`);
        v1 = h(`<label class="cf-row v1"><span>数值 / 文本</span><input class="cf-v" value="${rule.v != null ? rule.v : ""}"></label>`);
        v2 = h(`<label class="cf-row v2"${rule.op === "between" ? "" : " hidden"}><span>到</span><input class="cf-v2" value="${rule.v2 != null ? rule.v2 : ""}"></label>`);
        c1 = colorRow("填充色", rule.bg || "#ffc7ce");
        opSel.querySelector(".cf-op").value = rule.op || "gt";
        opSel.querySelector(".cf-op").addEventListener("change", e => { v2.hidden = e.target.value !== "between"; });
        m.body.appendChild(opSel); m.body.appendChild(v1); m.body.appendChild(v2); m.body.appendChild(c1);
      } else if (type === "dupes") {
        c1 = colorRow("填充色", rule.bg || "#ffc7ce"); m.body.appendChild(c1);
      } else if (type === "bar") {
        c1 = colorRow("条颜色（正）", rule.color || "#638ec6"); m.body.appendChild(c1);
        c2 = colorRow("条颜色（负）", rule.negColor || "#ff6363"); m.body.appendChild(c2);
        const hideTxt = h(`<label class="cf-row"><input type="checkbox" class="cf-hide-text"${rule.hideText ? " checked" : ""}><span>仅显示数据条，不显示值</span></label>`);
        m.body.appendChild(hideTxt);
      } else if (type === "scale") {
        c1 = colorRow("最小值色", rule.minColor || "#f8696b"); c2 = colorRow("最大值色", rule.maxColor || "#63be7b");
        m.body.appendChild(c1); m.body.appendChild(c2);
      } else if (type === "scale3") {
        c1 = colorRow("最小值色", rule.minColor || "#f8696b"); c2 = colorRow("中间值色", rule.midColor || "#ffffff"); c3 = colorRow("最大值色", rule.maxColor || "#63be7b");
        m.body.appendChild(c1); m.body.appendChild(c2); m.body.appendChild(c3);
      } else if (type === "top") {
        topN = h(`<label class="cf-row"><span>数量</span><input class="cf-topn" type="number" min="1" value="${rule.n || 10}"></label>`);
        topPct = h(`<label class="cf-row"><span>按百分比</span><input class="cf-toppct" type="checkbox"${rule.percent ? " checked" : ""}></label>`);
        topKind = h(`<label class="cf-row"><span>方向</span><select class="cf-topkind"><option value="top">最大的（前）</option><option value="bottom">最小的（后）</option></select></label>`);
        topKind.querySelector(".cf-topkind").value = rule.top ? "top" : "bottom";
        c1 = colorRow("填充色", rule.bg || "#ffc7ce");
        m.body.appendChild(topN); m.body.appendChild(topPct); m.body.appendChild(topKind); m.body.appendChild(c1);
      } else if (type === "icon") {
        const iconPreset = h(`<label class="cf-row"><span>图标样式</span><select class="cf-ipreset">
          <option value="traffic">交通灯（🟢🟡🔴）</option>
          <option value="trafficInv">交通灯（绿在上）</option>
          <option value="arrows">方向箭头（▲▶▼）</option>
          <option value="arrowsInv">箭头（▲◀▼）</option>
          <option value="stars">星级（⭐⭐☆）</option>
          <option value="checks">对叉（✅⚠️❌）</option>
        </select></label>`);
        const thresholdRow = h(`<label class="cf-row"><span>阈值模式</span><select class="cf-thmode"><option value="percent">百分比排名（默认）</option><option value="value">数值</option></select></label>`);
        const th1 = h(`<label class="cf-row"><span>高值阈值（%）</span><input class="cf-th1" type="number" value="${(rule.thresholds && rule.thresholds[0] * 100) || 67}"><span style="color:#888;">Excel 默认 ≥67% 视为高</span></label>`);
        const th2 = h(`<label class="cf-row"><span>低值阈值（%）</span><input class="cf-th2" type="number" value="${(rule.thresholds && rule.thresholds[1] * 100) || 33}"><span style="color:#888;">≤33% 视为低</span></label>`);
        const hint = h(`<div style="color:#666;font-size:12px;margin-top:4px;">说明：高值 → 第一个图标，中值 → 第二个，低值 → 第三个。阈值按百分比排名或数值判断。</div>`);
        m.body.appendChild(iconPreset); m.body.appendChild(thresholdRow); m.body.appendChild(th1); m.body.appendChild(th2); m.body.appendChild(hint);
      } else if (type === "formula") {
        const formulaRow = h(`<label class="cf-row"><span>公式（每行独立计算）</span><input class="cf-fmla" style="width:240px;" value="${rule.formula || ''}" placeholder="如 =MOD(ROW(),2)=0"></label>`);
        c1 = colorRow("填色", rule.bg || "#ffc7ce");
        const hint = h(`<div style="color:#666;font-size:12px;margin-top:4px;">
          • 公式对范围内<strong>每行</strong>独立计算，返回 TRUE 的行高亮<br>
          • 公式里用相对引用（如 <code>A1</code> <code>MOD(ROW(),2)=0</code> <code>B1>100</code>）会随每行自动偏移<br>
          • 例子：<br>
          &nbsp;&nbsp;<code>=MOD(ROW(),2)=0</code> — 隔行高亮<br>
          &nbsp;&nbsp;<code>=A1>B1</code> — A 列大于 B 列时高亮<br>
          &nbsp;&nbsp;<code>=ISBLANK(A1)</code> — 空白单元格高亮<br>
          &nbsp;&nbsp;<code>=COUNTIF($A:$A,A1)>1</code> — 重复值
        </div>`);
        m.body.appendChild(formulaRow); m.body.appendChild(c1); m.body.appendChild(hint);
      }
      m.ok.addEventListener("click", () => {
        rule.range = rb.querySelector(".cf-range").value.trim().toUpperCase();
        if (type === "cell") { rule.op = opSel.querySelector(".cf-op").value; rule.v = v1.querySelector(".cf-v").value; rule.v2 = rule.op === "between" ? v2.querySelector(".cf-v2").value : undefined; rule.bg = c1.querySelector(".cf-color").value; }
        else if (type === "dupes" || type === "unique") { rule.bg = c1.querySelector(".cf-color").value; }
        else if (type === "bar") { rule.color = c1.querySelector(".cf-color").value; rule.negColor = c2.querySelector(".cf-color").value; rule.hideText = hideTxt.querySelector(".cf-hide-text").checked; }
        else if (type === "scale") { rule.minColor = c1.querySelector(".cf-color").value; rule.maxColor = c2.querySelector(".cf-color").value; rule.midColor = undefined; }
        else if (type === "scale3") { rule.minColor = c1.querySelector(".cf-color").value; rule.midColor = c2.querySelector(".cf-color").value; rule.maxColor = c3.querySelector(".cf-color").value; rule.midPct = 0.5; }
        else if (type === "top") { rule.n = parseInt(topN.querySelector(".cf-topn").value, 10) || 10; rule.percent = topPct.querySelector(".cf-toppct").checked; rule.top = topKind.querySelector(".cf-topkind").value === "top"; rule.bg = c1.querySelector(".cf-color").value; }
        else if (type === "icon") {
          const preset = iconPreset.querySelector(".cf-ipreset").value;
          const iconMap = { traffic: ["🟢", "🟡", "🔴"], trafficInv: ["🔴", "🟡", "🟢"], arrows: ["▲", "▶", "▼"], arrowsInv: ["▲", "◀", "▼"], stars: ["⭐", "⭐", "☆"], checks: ["✅", "⚠️", "❌"] };
          rule.icons = iconMap[preset];
          const thMode = thresholdRow.querySelector(".cf-thmode").value;
          const th1v = parseFloat(th1.querySelector(".cf-th1").value) || 67;
          const th2v = parseFloat(th2.querySelector(".cf-th2").value) || 33;
          if (thMode === "percent") { rule.thresholds = [th1v / 100, th2v / 100]; rule.percentThreshold = true; }
          else { rule.thresholds = [th1v, th2v]; rule.percentThreshold = false; }
        }
        else if (type === "formula") { rule.formula = formulaRow.querySelector(".cf-fmla").value.trim().replace(/^=/, ""); rule.bg = c1.querySelector(".cf-color").value; }
        saveRule(rule); m.close();
      });
    }
    function openManager() {
      const m = openModal("条件格式规则管理器");
      const list = h(`<div class="cf-list"></div>`);
      m.body.appendChild(list);
      function render() {
        list.innerHTML = "";
        const rules = data.condFormats || [];
        if (!rules.length) { list.appendChild(h(`<div class="cf-empty">暂无规则。点击「开始 ▸ 条件格式」新建规则。</div>`)); }
        rules.forEach(r => {
          const row = h(`<div class="cf-rule"><span class="cf-rule-d">${describeRule(r)} · ${r.range}</span><button class="cf-del" type="button">删除</button></div>`);
          row.querySelector(".cf-del").addEventListener("click", () => { data.condFormats = (data.condFormats || []).filter(x => x.id !== r.id); ctx.markDirty(); recompute(); render(); });
          list.appendChild(row);
        });
      }
      render();
      m.ok.textContent = "关闭"; m.ok.addEventListener("click", () => m.close());
    }

    /* ---------------- 公式审核追踪 ---------------- */
    let _auditHighlights = []; // 当前活动的追踪高亮 refs，清除时用
    function clearAuditHighlights() {
      _auditHighlights.forEach(ref => {
        const td = table.querySelector(`td[data-ref="${ref}"]`);
        if (td) { td.style.boxShadow = ""; td.style.outline = ""; td.classList.remove("audit-ref", "audit-dep"); }
      });
      _auditHighlights = [];
      stInfo.textContent = `共 ${Object.keys(data.cells).length} 个带值单元格`;
    }
    function highlightRefs(refs, cls) {
      clearAuditHighlights();
      refs.forEach(ref => {
        const td = table.querySelector(`td[data-ref="${ref}"]`);
        if (!td) return;
        td.classList.add(cls);
        td.style.boxShadow = "inset 0 0 0 2px #3b82f6";
        _auditHighlights.push(ref);
      });
    }
    // 追踪引用单元格：当前活动单元格的公式里引用了谁
    function tracePrecedents() {
      const ref = selected;
      const raw = data.cells[ref];
      if (!raw || !raw.f || !raw.f.startsWith("=")) { OS.toast("活动单元格不是公式", "warn"); return; }
      const { refs } = FE.extractRefs(raw.f);
      if (!refs.size) { OS.toast("公式里没有单元格引用", "warn"); return; }
      highlightRefs([...refs], "audit-ref");
      stInfo.textContent = `追踪引用：${ref} → ${refs.size} 个单元格被引用（点「清除追踪」还原）`;
      OS.toast(`追踪到 ${refs.size} 个引用`, "ok");
    }
    // 追踪从属单元格：谁的公式里引用了当前活动单元格
    function traceDependents() {
      const ref = selected;
      // 遍历所有单元格的公式，看 extractRefs 里有没有 ref
      const dependents = [];
      for (const r in data.cells) {
        const cell = data.cells[r];
        if (!cell.f || !cell.f.startsWith("=")) continue;
        const { refs } = FE.extractRefs(cell.f);
        if (refs.has(ref)) dependents.push(r);
      }
      if (!dependents.length) { OS.toast("没有单元格的公式引用了 " + ref, "warn"); return; }
      highlightRefs(dependents, "audit-dep");
      stInfo.textContent = `追踪从属：${ref} 被 ${dependents.length} 个公式引用（点「清除追踪」还原）`;
      OS.toast(`${dependents.length} 个单元格引用了此单元格`, "ok");
    }
    function clearTraces() { clearAuditHighlights(); OS.toast("已清除追踪高亮", "ok"); }
    // 错误检查：扫所有带公式的单元格，返回错误列表
    function errorCheck() {
      const errors = [];
      for (const ref in data.cells) {
        const cell = data.cells[ref];
        if (!cell.f || !cell.f.startsWith("=")) continue;
        try {
          const v = getCell(ref);
          if (typeof v === "string" && v.startsWith("#")) errors.push({ ref, msg: v, formula: cell.f });
        } catch (e) { errors.push({ ref, msg: "#ERROR!", formula: cell.f }); }
      }
      if (!errors.length) { OS.toast("公式错误检查：全部正常 ✅", "ok"); return; }
      const m = openModal("公式错误检查（" + errors.length + " 处）");
      const list = h(`<div style="max-height:200px;overflow:auto;">${errors.map(e =>
        `<div style="padding:6px 8px;border-bottom:1px solid #eee;"><strong>${e.ref}</strong> → <code style="color:#c00;">${e.msg}</code><br><span style="color:#888;font-size:11px;">${e.formula}</span></div>`
      ).join("")}</div>`);
      m.body.appendChild(list);
      m.ok.textContent = "关闭"; m.ok.addEventListener("click", () => m.close());
    }
    // 分步求值器：把公式拉出来一步一步算中间节点
    function stepEvaluate() {
      const ref = selected;
      const raw = data.cells[ref];
      if (!raw || !raw.f || !raw.f.startsWith("=")) { OS.toast("活动单元格不是公式", "warn"); return; }
      const m = openModal("分步求值 — " + ref);
      m.body.style.minWidth = "440px";
      const formulaStr = raw.f;
      const result = h(`<div class="se-result" style="background:#f0f4ff;padding:8px;border-radius:4px;margin-bottom:8px;">
        <div style="color:#888;font-size:11px;">当前值</div>
        <div style="font-size:20px;font-weight:700;color:#1e40af;">${getCell(ref)}</div>
      </div>`);
      m.body.appendChild(result);
      const ast = FE.compile(formulaStr).ast;
      const steps = [];
      // 中序遍历 AST，每遇到子节点算一步
      function walk(node, depth) {
        if (!node) return;
        if (node.ref) { steps.push({ depth, label: "引用", text: node.ref, val: getCell(node.ref) }); return; }
        if (node.range) { steps.push({ depth, label: "区域", text: node.range, val: "[二维数组]" }); return; }
        if ("v" in node && !node.op && !node.func) { steps.push({ depth, label: "常量", text: String(node.v), val: node.v }); return; }
        if (node.op) {
          walk(node.left, depth + 1);
          walk(node.right, depth + 1);
          const opLabel = { "+": "+", "-": "-", "*": "×", "/": "÷", "^": "^", "&": "&", "=": "=", "<>": "≠", "<": "<", ">": ">", "<=": "≤", ">=": "≥", "u-": "取负" }[node.op] || node.op;
          try {
            const lr = FE.run("=" + _astToExpr(node.left), getCell, ref);
            const rr = FE.run("=" + _astToExpr(node.right), getCell, ref);
            const v = FE.run("=" + _astToExpr(node), getCell, ref);
            steps.push({ depth, label: "运算 " + opLabel, text: `${lr} ${opLabel} ${rr}`, val: v });
          } catch (e) {}
          return;
        }
        if (node.func) {
          node.args.forEach((a, i) => walk(a, depth + 1));
          try {
            const v = FE.run("=" + _astToExpr(node), getCell, ref);
            steps.push({ depth, label: "函数 " + node.func, text: node.func + "(...)", val: v });
          } catch (e) {}
        }
      }
      function _astToExpr(node) {
        if (!node) return "0";
        if ("v" in node && !node.op && !node.func && !node.ref && !node.range) return String(node.v);
        if (node.ref) return node.ref;
        if (node.range) return node.range;
        if (node.op === "u-") return "-(" + _astToExpr(node.arg) + ")";
        if (node.op) return "(" + _astToExpr(node.left) + " " + node.op + " " + _astToExpr(node.right) + ")";
        if (node.func) return node.func + "(" + (node.args || []).map(_astToExpr).join(",") + ")";
        return "0";
      }
      walk(ast, 0);
      const stepBox = h(`<div class="se-steps" style="max-height:260px;overflow:auto;border:1px solid #e2e8f0;border-radius:4px;"></div>`);
      if (!steps.length) {
        stepBox.appendChild(h(`<div style="padding:12px;color:#888;font-size:12px;">无法解析此公式。</div>`));
      } else {
        const header = h(`<div style="display:grid;grid-template-columns:40px 80px 1fr 100px;background:#f6f8fa;padding:6px 8px;font-weight:600;font-size:12px;border-bottom:1px solid #e2e8f0;"><span>#</span><span>类型</span><span>表达式</span><span>结果</span></div>`);
        stepBox.appendChild(header);
        steps.forEach((s, i) => {
          const row = h(`<div style="display:grid;grid-template-columns:40px 80px 1fr 100px;padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;gap:6px;"></div>`);
          row.style.paddingLeft = (s.depth * 14 + 8) + "px";
          row.innerHTML = `<span style="color:#888;">${i + 1}</span><span style="color:#6366f1;">${s.label}</span><code style="color:#333;">${s.text}</code><span style="color:${String(s.val).startsWith("#") ? "#c00" : "#1e40af"};">${s.val}</span>`;
          stepBox.appendChild(row);
        });
      }
      m.body.appendChild(stepBox);
      const hint = h(`<div style="margin-top:8px;color:#888;font-size:11px;">从叶子节点（引用/常量）开始，按运算顺序逐步算出每个中间结果。</div>`);
      m.body.appendChild(hint);
      m.ok.textContent = "关闭"; m.ok.addEventListener("click", () => m.close());
    }

    /* ---------------- 名称管理器 ---------------- */
    function openNameManager() {
      const m = openModal("名称管理器");
      m.body.style.minWidth = "560px";
      const list = h(`<div class="nm-list" style="max-height:240px;overflow:auto;border:1px solid #e2e8f0;border-radius:4px;"></div>`);
      function render() {
        const names = data.names || [];
        list.innerHTML = "";
        if (!names.length) {
          list.appendChild(h(`<div style="padding:16px;color:#888;font-size:12px;text-align:center;">暂无已定义名称。点下方「新建」添加。</div>`));
        } else {
          const header = h(`<div style="display:grid;grid-template-columns:140px 200px 1fr;background:#f6f8fa;padding:6px 8px;font-weight:600;font-size:12px;border-bottom:1px solid #e2e8f0;"><span>名称</span><span>引用位置</span><span>备注</span></div>`);
          list.appendChild(header);
          names.forEach(n => {
            const row = h(`<div style="display:grid;grid-template-columns:140px 200px 1fr;padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;gap:6px;"></div>`);
            row.innerHTML = `<span><strong>${n.name}</strong></span><code style="color:#333;">${n.ref}</code><span style="color:#888;">${n.comment || ""}</span>`;
            // 编辑按钮
            const editBtn = document.createElement("button");
            editBtn.textContent = "编辑"; editBtn.className = "btn cf-btn";
            editBtn.style.marginLeft = "8px"; editBtn.style.padding = "2px 6px";
            editBtn.addEventListener("click", () => openNameEdit(n));
            const delBtn = document.createElement("button");
            delBtn.textContent = "删"; delBtn.className = "btn cf-btn"; delBtn.style.padding = "2px 6px"; delBtn.style.background = "#fee"; delBtn.style.color = "#a00";
            delBtn.addEventListener("click", () => { data.names = (data.names || []).filter(x => x.name !== n.name); ctx.markDirty(); render(); });
            row.appendChild(editBtn); row.appendChild(delBtn);
            list.appendChild(row);
          });
        }
      }
      const btnBar = h(`<div style="margin-top:8px;display:flex;gap:8px;"></div>`);
      const newBtn = document.createElement("button"); newBtn.textContent = "新建…"; newBtn.className = "btn cf-btn";
      newBtn.addEventListener("click", () => openNameEdit(null, () => render()));
      const closeBtn = document.createElement("button"); closeBtn.textContent = "关闭"; closeBtn.className = "btn cf-btn"; closeBtn.addEventListener("click", () => m.close());
      btnBar.appendChild(newBtn); btnBar.appendChild(closeBtn);
      m.body.appendChild(list); m.body.appendChild(btnBar);
      render();
    }
    function openNameEdit(existing, cb) {
      const isNew = !existing;
      const m = openModal(isNew ? "新建名称" : "编辑名称");
      const nameRow = h(`<label class="cf-row"><span>名称</span><input class="nm-name" style="width:180px;" value="${existing ? existing.name : ""}" placeholder="如 总销量"></label>`);
      const refRow = h(`<label class="cf-row"><span>引用位置</span><input class="nm-ref" style="width:240px;" value="${existing ? existing.ref : selRangeStr()}" placeholder="如 Sheet1!$A$2:$C$10"></label>`);
      const commentRow = h(`<label class="cf-row"><span>备注</span><input class="nm-cmt" style="width:240px;" value="${existing ? existing.comment : ""}" placeholder="可选，描述这个名称的用途"></label>`);
      const scopeRow = h(`<label class="cf-row"><span>范围</span><select class="nm-scope"><option value="workbook">工作簿（跨工作表可用）</option></select></label>`);
      const hint = h(`<div style="margin-top:6px;color:#666;font-size:11px;">
        • 名称可以在公式里直接用，如 <code>=SUM(总销量)</code><br>
        • 名称不能以数字开头，不能和单元格引用重名（如 A1、$B$2）<br>
        • 引用位置建议用绝对引用（按 F4 切换 $ 符号）
      </div>`);
      m.body.appendChild(nameRow); m.body.appendChild(refRow); m.body.appendChild(commentRow); m.body.appendChild(scopeRow); m.body.appendChild(hint);
      m.ok.addEventListener("click", () => {
        const name = nameRow.querySelector(".nm-name").value.trim();
        const ref = refRow.querySelector(".nm-ref").value.trim().toUpperCase();
        if (!name) { OS.toast("请填写名称", "warn"); return; }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { OS.toast("名称只能以字母或下划线开头，含字母/数字/下划线", "warn"); return; }
        // 不能和已存在名称重名（编辑除外）
        if (isNew && (data.names || []).some(n => n.name.toLowerCase() === name.toLowerCase())) { OS.toast("名称已存在", "warn"); return; }
        // 不能是单元格引用
        if (/^[A-Za-z]+[0-9]+$/.test(name)) { OS.toast("名称不能是单元格引用格式（如 A1）", "warn"); return; }
        if (!ref) { OS.toast("请填写引用位置", "warn"); return; }
        data.names = data.names || [];
        if (existing) {
          const idx = data.names.findIndex(n => n.name === existing.name);
          data.names[idx] = { name, ref, comment: commentRow.querySelector(".nm-cmt").value.trim(), scope: "workbook" };
        } else {
          data.names.push({ name, ref, comment: commentRow.querySelector(".nm-cmt").value.trim(), scope: "workbook" });
        }
        ctx.markDirty();
        m.close(); if (cb) cb();
        OS.toast(isNew ? "已新建名称「" + name + "」" : "已更新名称「" + name + "」", "ok");
      });
    }

    /* ---------------- 模拟运算表（单/双变量） ---------------- */
    // 核心：遍历输入值组合 → 临时覆盖输入单元格 → getCell 重算公式 → 写回结果 → 恢复原值
    function runDataTable(spec) {
      const { tableRangeStr, formulaRef, inputRow, inputCol, isOneVar } = spec;
      const rg = rangeRectFromStr(tableRangeStr); if (!rg) return { ok: false, msg: "无效表格区域" };
      // 1. 备份输入单元格原始值（它们会被临时覆盖）
      const backups = {};
      const affectedCells = new Set(); // 被 TABLE 结果覆盖的单元格（用于 snapshot）
      // 2. 读行值（单/双变量通用）和列值（仅双变量）
      const rowVals = [];
      for (let r = rg.r1 + 1; r <= rg.r2; r++) {
        const ref = FE.idxToCol(rg.c1) + r;
        const v = getCell(ref);
        if (ref !== inputRow) rowVals.push(v); // 排除可能恰好等于输入单元格的情况
      }
      let colVals = [];
      if (!isOneVar) {
        for (let c = rg.c1 + 1; c <= rg.c2; c++) {
          const ref = FE.idxToCol(c) + rg.r1;
          const v = getCell(ref);
          if (ref !== inputCol) colVals.push(v);
        }
      }
      // 3. 收集所有可能被 TABLE 结果覆盖的单元格（grid 的 body）
      for (let r = rg.r1 + 1; r <= rg.r2; r++) {
        for (let c = rg.c1 + 1; c <= rg.c2; c++) {
          affectedCells.add(FE.idxToCol(c) + r);
        }
      }
      snapshot(); // 允许一键撤销
      // 4. 遍历计算
      let rowIdx = 0;
      for (let r = rg.r1 + 1; r <= rg.r2; r++) {
        const rowInput = rowVals[rowIdx++];
        // 覆盖行输入单元格
        if (backups[inputRow] === undefined) backups[inputRow] = data.cells[inputRow];
        _overwriteCell(inputRow, rowInput);
        if (isOneVar) {
          // 单变量：结果写在该行第 rg.c1+1 列
          const outRef = FE.idxToCol(rg.c1 + 1) + r;
          const result = _computeFormulaRef(formulaRef);
          _overwriteCell(outRef, result);
        } else {
          let colIdx = 0;
          for (let c = rg.c1 + 1; c <= rg.c2; c++) {
            const colInput = colVals[colIdx++];
            // 覆盖列输入单元格
            if (backups[inputCol] === undefined) backups[inputCol] = data.cells[inputCol];
            _overwriteCell(inputCol, colInput);
            const outRef = FE.idxToCol(c) + r;
            const result = _computeFormulaRef(formulaRef);
            _overwriteCell(outRef, result);
          }
          // 本行结束后，清除列输入单元格的覆盖（避免下一行循环时残留）
          _restoreCell(inputCol, backups[inputCol]);
          delete backups[inputCol];
        }
        // 本行结束后，清除行输入单元格覆盖
        _restoreCell(inputRow, backups[inputRow]);
        delete backups[inputRow];
      }
      // 5. 安全兜底：恢复所有还没恢复的备份（防止中途报错后残留覆盖）
      for (const ref in backups) _restoreCell(ref, backups[ref]);
      ctx.markDirty(); recompute();
      return { ok: true, rows: rowVals.length, cols: colVals.length, msg: `已生成模拟运算表（${rowVals.length} 行 × ${colVals.length || 1} 列）` };
    }
    // 临时覆盖单元格（写入 data.cells + 清 cache）
    function _overwriteCell(ref, val) {
      if (typeof val === "number" || val === "") {
        data.cells[ref] = { v: val };
      } else {
        data.cells[ref] = { v: val };
      }
      // 清 cache，让下次 getCell 读到新值
      delete cache[ref];
      for (const k in cache) delete cache[k]; // 保守：清空全 cache（recompute 会重建）
    }
    function _restoreCell(ref, orig) {
      if (orig === undefined || orig === null) delete data.cells[ref];
      else data.cells[ref] = orig;
      delete cache[ref];
    }
    // 计算 formulaRef 的当前值（用覆盖后的数据）
    function _computeFormulaRef(ref) {
      // 清 cache 确保读到最新覆盖值
      for (const k in cache) delete cache[k];
      return getCell(ref);
    }
    /* ---------------- 单变量求解（反向迭代） ---------------- */
    // 核心：牛顿迭代 x_{n+1} = x_n - f(x_n) / f'(x_n)，f(x)=formula(x)-target
    function goalSeek(formulaRef, inputRef, target, options = {}) {
      const maxIter = options.maxIter || 200;
      const tol = options.tol || 1e-6;
      const origCell = data.cells[inputRef]; // 备份原始
      function f(x) {
        _overwriteCell(inputRef, x);
        const v = _computeFormulaRef(formulaRef);
        if (typeof v !== "number") return NaN;
        return v - target;
      }
      function restore() { _restoreCell(inputRef, origCell); }
      let guess = typeof getCell(inputRef) === "number" ? getCell(inputRef) : 10;
      if (Math.abs(f(guess)) < tol) { restore(); return { ok: true, value: guess, iterations: 0, method: "初始值已满足" }; }
      let found = null;
      for (let i = 0; i < maxIter; i++) {
        const fx = f(guess);
        if (!isFinite(fx) || isNaN(fx)) break;
        if (Math.abs(fx) < tol) { found = guess; break; }
        const h = Math.max(1e-8, Math.abs(guess) * 1e-6);
        const fxdh = f(guess + h), fxmh = f(guess - h);
        const deriv = (fxdh - fxmh) / (2 * h);
        if (!isFinite(deriv) || Math.abs(deriv) < 1e-14) break;
        guess = guess - fx / deriv;
        if (!isFinite(guess) || Math.abs(guess) > 1e12) break;
      }
      if (found == null) {
        const endpoints = [];
        for (let e = -1e9; e <= 1e9; e = e === 0 ? 1 : (e > 0 ? e * 10 : e / 10)) {
          endpoints.push({ x: e, fx: f(e) });
        }
        for (let a = 0; a < endpoints.length - 1 && found == null; a++) {
          const b = a + 1;
          if (!isFinite(endpoints[a].fx) || !isFinite(endpoints[b].fx)) continue;
          if (endpoints[a].fx * endpoints[b].fx <= 0) {
            let lo = endpoints[a].x, hi = endpoints[b].x;
            for (let i = 0; i < 100; i++) {
              const mid = (lo + hi) / 2;
              const fm = f(mid);
              if (!isFinite(fm)) break;
              if (Math.abs(fm) < tol) { found = mid; break; }
              if (f(lo) * fm <= 0) hi = mid; else lo = mid;
            }
          }
        }
      }
      restore();
      if (found == null) return { ok: false, msg: "迭代 200 次未收敛，可能没有解或解远离初始值" };
      return { ok: true, value: found, iterations: maxIter, method: "牛顿+二分" };
    }
    function openGoalSeekModal() {
      const m = openModal("单变量求解");
      m.body.style.minWidth = "400px";
      const hint = h(`<div style="margin-bottom:8px;color:#666;font-size:12px;">反推：告诉公式应该等于什么值，帮你算出输入单元格需要填什么数。</div>`);
      const setRow = h(`<label class="cf-row"><span>目标单元格（含公式）</span><input class="gs-set" style="width:160px;" value="${selected}"></label>`);
      const targetRow = h(`<label class="cf-row"><span>目标值</span><input class="gs-val" style="width:160px;" type="number" value="0"></label>`);
      const byRow = h(`<label class="cf-row"><span>可变单元格</span><input class="gs-by" style="width:160px;" placeholder="如 $B$5"></label>`);
      const hint2 = h(`<div style="margin-top:6px;padding:8px;background:#f6f8fa;border-radius:4px;font-size:11px;color:#555;">例：目标单元格=利润公式格，目标值=你想要的利润，可变单元格=让 Excel 改哪个格（如单价）。</div>`);
      m.body.appendChild(hint); m.body.appendChild(setRow); m.body.appendChild(targetRow); m.body.appendChild(byRow); m.body.appendChild(hint2);
      m.ok.textContent = "求解…";
      m.ok.addEventListener("click", () => {
        const setCell = setRow.querySelector(".gs-set").value.trim().toUpperCase();
        const targetStr = targetRow.querySelector(".gs-val").value.trim();
        const byCell = byRow.querySelector(".gs-by").value.trim().toUpperCase();
        if (!setCell || !byCell) { OS.toast("请填写目标单元格和可变单元格", "warn"); return; }
        const target = parseFloat(targetStr);
        if (isNaN(target)) { OS.toast("目标值必须是数字", "warn"); return; }
        if (!FE.parseRef(setCell) || !FE.parseRef(byCell)) { OS.toast("单元格地址无效", "warn"); return; }
        m.ok.disabled = true; m.ok.textContent = "求解中…";
        setTimeout(() => {
          const res = goalSeek(setCell, byCell, target);
          m.ok.disabled = false; m.ok.textContent = "求解…";
          if (!res.ok) { OS.toast(res.msg, "err"); return; }
          const foundVal = typeof res.value === "number" ? (Number.isInteger(res.value) ? res.value : res.value.toFixed(4)) : res.value;
          const confirm = prompt(
            `单变量求解找到一个解：\n\n` +
            `• 可变单元格 ${byCell} = ${foundVal}\n` +
            `• 方法：${res.method}  迭代：${res.iterations}\n\n` +
            `输入 「y」 接受新值（Ctrl+Z 可撤销），回车取消。`,
            ""
          );
          if (confirm && confirm.toLowerCase() === "y") {
            snapshot();
            data.cells[byCell] = { v: typeof res.value === "number" ? parseFloat(res.value.toPrecision(12)) : res.value };
            delete cache[byCell];
            ctx.markDirty(); recompute();
            OS.toast(`已应用新值：${byCell} = ${foundVal} ✅`, "ok");
          } else {
            OS.toast("已取消（原始值未改）", "ok");
          }
          m.close();
        }, 50);
      });
    }

    /* ---------------- 快速填充 Flash Fill ---------------- */
    // 启发式规则（按优先级）：
    //  1. 固定模板：样例 = prefix + ref + suffix（把 ref 从样例里扣出来，看前后是否固定）
    //  2. 分隔符切分取某段：source 用常见分隔符 split，样例等于某段
    //  3. 两段拼接：split(",")[i] + 固定串 + split(",")[j]
    //  4. 提取数字
    //  5. 提取中文字符
    //  6. 截取前 N 位 / 后 N 位
    const FF_SEPARATORS = [",", "，", "-", "—", "_", " ", "/", "|", "·", "、"];
    function inferFlashFillPattern(refSamples, fillSamples) {
      if (refSamples.length < 2 || fillSamples.length < 2) return null;
      function findTemplate(ref, sample) {
        const r = String(ref == null ? "" : ref);
        const s = String(sample == null ? "" : sample);
        if (!r || !s) return null;
        // 规则 1：样例 = prefix + ref + suffix
        if (s.includes(r)) {
          const idx = s.indexOf(r);
          return { type: "prefix_suffix", prefix: s.slice(0, idx), suffix: s.slice(idx + r.length) };
        }
        // 规则 2 & 3：分隔符切分
        for (const sep of FF_SEPARATORS) {
          const parts = r.split(sep);
          if (parts.length < 2) continue;
          const i = parts.findIndex(p => p === s);
          if (i >= 0) return { type: "split_part", sep, index: i };
          // 规则 3a：样例 = part[i] + mid + part[j]
          for (let a = 0; a < parts.length; a++) {
            for (let b = 0; b < parts.length; b++) {
              if (a === b) continue;
              const pa = parts[a], pb = parts[b];
              if (pa && pb && s.startsWith(pa) && s.endsWith(pb) && s.length > pa.length + pb.length) {
                const mid = s.slice(pa.length, s.length - pb.length);
                return { type: "combine_two", sep, i: a, j: b, joiner: mid };
              }
              if (pa && pb && s === pa + pb) return { type: "combine_two", sep, i: a, j: b, joiner: "" };
            }
          }
        }
        // 规则 4：提取数字
        const nums = r.match(/\d+/g);
        if (nums) {
          const joined = nums.join("");
          if (s === joined) return { type: "extract_num" };
          if (s.includes(joined)) {
            const idx = s.indexOf(joined);
            return { type: "extract_num_wrap", prefix: s.slice(0, idx), suffix: s.slice(idx + joined.length) };
          }
          for (let k = 0; k < nums.length; k++) {
            if (s === nums[k]) return { type: "extract_num_index", index: k };
          }
        }
        // 规则 5：提取中文字符
        const cn = r.match(/[\u4e00-\u9fff]+/g);
        if (cn) {
          const joined = cn.join("");
          if (s === joined) return { type: "extract_cn" };
          for (let k = 0; k < cn.length; k++) {
            if (s === cn[k]) return { type: "extract_cn_index", index: k };
          }
        }
        // 规则 6：截取
        if (s === r.slice(0, s.length)) return { type: "take_left", n: s.length };
        if (s === r.slice(-s.length)) return { type: "take_right", n: s.length };
        return null;
      }
      const templates = refSamples.map((r, i) => findTemplate(r, fillSamples[i])).filter(Boolean);
      if (!templates.length) return null;
      const first = templates[0];
      const consistent = templates.every(t => {
        if (t.type !== first.type) return false;
        const keys = Object.keys(t).filter(k => k !== "type");
        return keys.every(k => t[k] === first[k]);
      });
      if (!consistent) return null;
      return first;
    }
    function applyFlashFillPattern(pattern, ref) {
      const r = String(ref == null ? "" : ref);
      switch (pattern.type) {
        case "prefix_suffix": return (pattern.prefix || "") + r + (pattern.suffix || "");
        case "split_part": { const parts = r.split(pattern.sep); return parts[Math.min(pattern.index, parts.length - 1)] || ""; }
        case "combine_two": { const parts = r.split(pattern.sep); return (parts[pattern.i] || "") + (pattern.joiner || "") + (parts[pattern.j] || ""); }
        case "extract_num": { const nums = r.match(/\d+/g); return nums ? nums.join("") : ""; }
        case "extract_num_wrap": { const nums = r.match(/\d+/g); const joined = nums ? nums.join("") : ""; return (pattern.prefix || "") + joined + (pattern.suffix || ""); }
        case "extract_num_index": { const nums = r.match(/\d+/g); return nums ? nums[pattern.index] || "" : ""; }
        case "extract_cn": { const cn = r.match(/[\u4e00-\u9fff]+/g); return cn ? cn.join("") : ""; }
        case "extract_cn_index": { const cn = r.match(/[\u4e00-\u9fff]+/g); return cn ? cn[pattern.index] || "" : ""; }
        case "take_left": return r.slice(0, pattern.n);
        case "take_right": return r.slice(-pattern.n);
      }
      return "";
    }
    function openFlashFillModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中样例区域", "warn"); return; }
      const m = openModal("快速填充 Flash Fill");
      m.body.style.minWidth = "480px";
      const hint = h(`<div style="margin-bottom:8px;color:#666;font-size:12px;">选两行<strong>样例</strong>（左边参考列 + 右边你想要的结果），自动推断填充模式，应用到后面的行。</div>`);
      const refColRow = h(`<label class="cf-row"><span>参考列（原始数据）</span><input class="ff-refcol" style="width:100px;" value="${FE.idxToCol(rg.c1)}"></label>`);
      const fillColRow = h(`<label class="cf-row"><span>结果列（要填充的列）</span><input class="ff-fillcol" style="width:100px;" value="${FE.idxToCol(rg.c2)}"></label>`);
      const startRowRow = h(`<label class="cf-row"><span>样例从第几行开始</span><input class="ff-start" style="width:100px;" type="number" value="${rg.r1 + 1}"></label>`);
      const hint2 = h(`<div style="margin-top:6px;padding:8px;background:#f6f8fa;border-radius:4px;font-size:11px;color:#555;">
        <strong>操作：</strong>在结果列手动填 <strong>至少 2 行样例</strong>（如 A10="张三,男,25" → B10="张三"，A11="李四,女,30" → B11="李四"），Flash Fill 自动推断后面所有行。
      </div>`);
      m.body.appendChild(hint); m.body.appendChild(refColRow); m.body.appendChild(fillColRow); m.body.appendChild(startRowRow); m.body.appendChild(hint2);
      const previewDiv = h(`<div class="ff-preview" style="margin-top:8px;padding:8px;background:#f0f4ff;border-radius:4px;font-size:11px;color:#333;max-height:200px;overflow:auto;"></div>`);
      const previewBtn = document.createElement("button"); previewBtn.textContent = "🔍 预览推断"; previewBtn.className = "btn cf-btn";
      previewBtn.style.marginTop = "6px";
      previewBtn.addEventListener("click", () => {
        const refCol = (refColRow.querySelector(".ff-refcol").value || FE.idxToCol(rg.c1)).trim().toUpperCase();
        const fillCol = (fillColRow.querySelector(".ff-fillcol").value || FE.idxToCol(rg.c2)).trim().toUpperCase();
        const startRow = parseInt(startRowRow.querySelector(".ff-start").value, 10) || rg.r1 + 1;
        const refSamples = [], fillSamples = [];
        for (let r = startRow; r <= rg.r2; r++) {
          const refV = getCell(refCol + r);
          const fillV = getCell(fillCol + r);
          if (fillV !== "" && fillV != null && String(fillV).trim()) { refSamples.push(refV); fillSamples.push(fillV); }
        }
        if (refSamples.length < 2) { previewDiv.innerHTML = `<strong style="color:#c00;">❌ 至少需要 2 行样例（结果列要有值）</strong>`; return; }
        const pattern = inferFlashFillPattern(refSamples, fillSamples);
        if (!pattern) { previewDiv.innerHTML = `<strong style="color:#c00;">❌ 无法从样例推断出统一变换模式</strong><br>试试给更规律的样例，或增加行数`; return; }
        let patternDesc = "";
        switch (pattern.type) {
          case "prefix_suffix": patternDesc = `前后缀："<code>${pattern.prefix}</code>" + 原值 + "<code>${pattern.suffix}</code>"`; break;
          case "split_part": patternDesc = `按 "<code>${pattern.sep}</code>" 切分，取第 ${pattern.index + 1} 段`; break;
          case "combine_two": patternDesc = `按 "<code>${pattern.sep}</code>" 切分 → 第 ${pattern.i + 1} 段 + "<code>${pattern.joiner}</code>" + 第 ${pattern.j + 1} 段`; break;
          case "extract_num": patternDesc = `提取所有数字`; break;
          case "extract_num_wrap": patternDesc = `数字包裹："<code>${pattern.prefix || ""}</code>数字<code>${pattern.suffix || ""}</code>"`; break;
          case "extract_num_index": patternDesc = `提取第 ${pattern.index + 1} 段数字`; break;
          case "extract_cn": patternDesc = `提取所有中文字符`; break;
          case "extract_cn_index": patternDesc = `提取第 ${pattern.index + 1} 段中文`; break;
          case "take_left": patternDesc = `截取前 ${pattern.n} 位`; break;
          case "take_right": patternDesc = `截取后 ${pattern.n} 位`; break;
        }
        let html = `<div style="color:#2563eb;">✅ 推断模式：<strong>${patternDesc}</strong></div><br>`;
        html += `<strong>样例匹配：</strong><br>`;
        refSamples.forEach((r, i) => { html += `  • <code>${r}</code> → <code style="color:#2fa86a;">${fillSamples[i]}</code><br>`; });
        html += `<br><strong>后续预测（最多 10 行）：</strong><br>`;
        let predCount = 0;
        for (let r = startRow + refSamples.length; r <= rg.r2 && predCount < 10; r++) {
          const refV = getCell(refCol + r);
          if (refV === "" || refV == null) continue;
          const predicted = applyFlashFillPattern(pattern, refV);
          const actualFill = getCell(fillCol + r);
          html += `  • <code>${refV}</code> → <code style="color:#2fa86a;">${predicted || "(空)"}</code>${actualFill ? ` <span style="color:#888;">(当前：${actualFill})</span>` : ""}<br>`;
          predCount++;
        }
        if (!predCount) html += `  <span style="color:#888;">后面没有数据可填充</span>`;
        previewBtn._lastPattern = pattern; previewBtn._lastRefCol = refCol; previewBtn._lastFillCol = fillCol;
        previewBtn._lastSampleEnd = startRow + refSamples.length - 1; previewBtn._lastRg = rg;
        previewDiv.innerHTML = html;
      });
      m.body.appendChild(previewBtn); m.body.appendChild(previewDiv);
      m.ok.textContent = "应用填充";
      m.ok.addEventListener("click", () => {
        const pattern = previewBtn._lastPattern;
        if (!pattern) { OS.toast("请先点预览推断", "warn"); return; }
        const { _lastRefCol: refCol, _lastFillCol: fillCol, _lastSampleEnd: sampleEnd, _lastRg: rg } = previewBtn;
        snapshot();
        let filled = 0;
        for (let r = sampleEnd + 1; r <= rg.r2; r++) {
          const refV = getCell(refCol + r);
          if (refV === "" || refV == null) continue;
          const predicted = applyFlashFillPattern(pattern, refV);
          if (predicted !== "") { data.cells[fillCol + r] = { v: predicted }; filled++; }
        }
        if (!filled) { OS.toast("没有可填充的行", "warn"); return; }
        ctx.markDirty(); recompute(); render();
        OS.toast(`Flash Fill 填充 ${filled} 行 ✅`, "ok");
        m.close();
      });
    }

    function openDataTableModal() {
      const rg = rangeRect();
      const m = openModal("模拟运算表");
      m.body.style.minWidth = "460px";
      const hint = h(`<div style="margin-bottom:8px;color:#666;font-size:12px;">
        模拟运算表 = 选一个公式（比如 <code>C10=利润 = B10*单价 - 固定成本</code>），让一个或两个输入单元格（如单价/销量）遍历不同值，Excel 自动算出每个组合的结果。
      </div>`);
      const tableRow = h(`<label class="cf-row"><span>表格区域（含输入值和结果单元格）</span><input class="dt-table" style="width:240px;" value="${rg ? FE.idxToCol(rg.c1) + rg.r1 + ':' + FE.idxToCol(rg.c2) + rg.r2 : ''}" placeholder="如 A10:C20"></label>`);
      const formulaRow = h(`<label class="cf-row"><span>公式引用（含要观察输出的单元格）</span><input class="dt-formula" style="width:200px;" value="${selected}" placeholder="如 C10"></label>`);
      const modeSel = h(`<label class="cf-row"><span>类型</span><select class="dt-mode"><option value="one">单变量（一个输入单元格）</option><option value="two">双变量（两个输入单元格）</option></select></label>`);
      const inputRow = h(`<label class="cf-row"><span>输入单元格（行/列都用这个）</span><input class="dt-input1" style="width:160px;" placeholder="如 $B$5"></label>`);
      const inputRow2 = h(`<label class="cf-row dt-input2"><span>输入单元格（列方向用）</span><input class="dt-input2-val" style="width:160px;" placeholder="双变量时必填，如 $B$6"></label>`);
      m.body.appendChild(hint); m.body.appendChild(tableRow); m.body.appendChild(formulaRow); m.body.appendChild(modeSel); m.body.appendChild(inputRow); m.body.appendChild(inputRow2);
      inputRow2.style.display = "none";
      modeSel.querySelector(".dt-mode").addEventListener("change", e => {
        inputRow2.style.display = e.target.value === "two" ? "" : "none";
      });
      const structureHint = h(`<div style="margin-top:6px;padding:8px;background:#f6f8fa;border-radius:4px;font-size:11px;color:#555;">
        <strong>结构规则（Excel 同款）：</strong><br>
        <strong>单变量</strong>：<br>
        • 表格区域首列（如 A11:A20）= 要测试的输入值<br>
        • 表格区域首行+1 列（如 B10）= 公式引用<br>
        • 结果自动写在右侧（B11:B20）<br>
        <strong>双变量</strong>：<br>
        • 首列（A11:A20）= 输入单元格1的测试值<br>
        • 首行（B10:D10）= 输入单元格2的测试值<br>
        • 左上角或表头（如 A10）= 公式引用<br>
        • 结果自动写在 B11:D20
      </div>`);
      m.body.appendChild(structureHint);
      m.ok.addEventListener("click", () => {
        const tableRangeStr = tableRow.querySelector(".dt-table").value.trim().toUpperCase();
        const formulaRef = formulaRow.querySelector(".dt-formula").value.trim().toUpperCase();
        const inputRowRef = inputRow.querySelector(".dt-input1").value.trim().toUpperCase();
        const mode = modeSel.querySelector(".dt-mode").value;
        if (!tableRangeStr || !formulaRef || !inputRowRef) { OS.toast("请填写表格区域、公式引用和输入单元格", "warn"); return; }
        const inputColRef = mode === "two" ? inputRow2.querySelector(".dt-input2-val").value.trim().toUpperCase() : null;
        if (mode === "two" && !inputColRef) { OS.toast("双变量模式需要填写两个输入单元格", "warn"); return; }
        if (!FE.parseRef(formulaRef)) { OS.toast("公式引用地址无效", "warn"); return; }
        if (!FE.parseRef(inputRowRef)) { OS.toast("输入单元格地址无效", "warn"); return; }
        const spec = {
          tableRangeStr, formulaRef,
          inputRow: inputRowRef,
          inputCol: inputColRef,
          isOneVar: mode === "one"
        };
        const res = runDataTable(spec);
        if (res.ok) OS.toast(res.msg, "ok"); else OS.toast(res.msg, "err");
        m.close();
      });
    }

    /* ---------------- 保护工作表 ---------------- */
    function openProtectSheet() {
      if (data.protection && data.protection.enabled) {
        // 已经保护了 → 先问密码再解除
        const input = prompt("工作表已保护。请输入密码以取消保护（留空则直接取消）：");
        if (input === null) return;
        if (data.protection.password && data.protection.password !== input) { OS.toast("密码不正确", "err"); return; }
        data.protection = Object.assign({}, data.protection, { enabled: false });
        ctx.markDirty(); OS.toast("已取消工作表保护 ✅", "ok");
        return;
      }
      const m = openModal("保护工作表");
      m.body.style.minWidth = "380px";
      const pwdRow = h(`<label class="cf-row"><span>密码（可留空）</span><input class="ps-pwd" type="password" style="width:160px;" placeholder="留空则不设密码"></label>`);
      const allowSelLocked = h(`<label class="cf-row"><input type="checkbox" class="ps-sel-locked" checked><span>允许选择锁定单元格</span></label>`);
      const allowSelUnlocked = h(`<label class="cf-row"><input type="checkbox" class="ps-sel-unlocked" checked><span>允许选择未锁定单元格</span></label>`);
      const allowFmt = h(`<label class="cf-row"><input type="checkbox" class="ps-fmt" checked><span>允许设置单元格格式</span></label>`);
      const allowRowsCols = h(`<label class="cf-row"><input type="checkbox" class="ps-rows-cols"><span>允许插入/删除行列</span></label>`);
      const hint = h(`<div style="margin-top:6px;color:#666;font-size:11px;">
        • 默认<strong>所有单元格被锁定</strong>（无法编辑）<br>
        • 保护前可以选中要允许编辑的单元格 → 右键 → 设置单元格格式 → 保护 → 取消勾选「锁定」<br>
        • 锁定单元格还可以「隐藏公式」，让公式栏不显示公式内容
      </div>`);
      m.body.appendChild(pwdRow); m.body.appendChild(allowSelLocked); m.body.appendChild(allowSelUnlocked); m.body.appendChild(allowFmt); m.body.appendChild(allowRowsCols); m.body.appendChild(hint);
      m.ok.addEventListener("click", () => {
        const pwd = pwdRow.querySelector(".ps-pwd").value;
        data.protection = {
          enabled: true,
          password: pwd || null,
          allowSelectLocked: allowSelLocked.querySelector(".ps-sel-locked").checked,
          allowSelectUnlocked: allowSelUnlocked.querySelector(".ps-sel-unlocked").checked,
          allowFormat: allowFmt.querySelector(".ps-fmt").checked,
          allowRowsCols: allowRowsCols.querySelector(".ps-rows-cols").checked
        };
        ctx.markDirty(); m.close();
        OS.toast("工作表已保护 🔒" + (pwd ? "（密码：" + "•".repeat(pwd.length) + "）" : ""), "ok");
      });
    }
    function openLockCell() {
      // 切换当前选区的锁定状态
      const rg = rangeRect(); if (!rg) return;
      if (!data.locked) data.locked = {};
      // 检查当前状态：如果选区里大部分是锁定的，就全部解锁；否则全部锁定
      let lockedCount = 0, totalCount = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const ref = FE.idxToCol(c) + r;
        totalCount++; if (data.locked[ref] !== false) lockedCount++;
      }
      const newVal = lockedCount > totalCount / 2 ? false : true;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const ref = FE.idxToCol(c) + r;
        if (newVal) delete data.locked[ref]; else data.locked[ref] = false;
      }
      ctx.markDirty();
      OS.toast(newVal ? "已锁定 " + totalCount + " 个单元格（工作表保护后不可编辑）" : "已解锁 " + totalCount + " 个单元格（工作表保护后可编辑）", "ok");
    }
    function openHideFormula() {
      const rg = rangeRect(); if (!rg) return;
      if (!data.hidden) data.hidden = {};
      const refs = [];
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) refs.push(FE.idxToCol(c) + r);
      // 切换
      const allHidden = refs.every(ref => data.hidden[ref]);
      refs.forEach(ref => { if (allHidden) delete data.hidden[ref]; else data.hidden[ref] = true; });
      ctx.markDirty();
      OS.toast(allHidden ? "已显示公式栏" : "工作表保护后公式栏将隐藏 " + refs.length + " 个单元格的公式", "ok");
    }

    // 功能区（标签页）
    const ribbon = OS.Ribbon.create({
      file: { onOpen: ctx.openBackstage },
      tabs: [
        {
          id: "home", label: "开始", groups: [
            {
              label: "字体", items: [
                { kind: "btn", glyph: "B", title: "加粗 (Ctrl+B)", onClick: () => setStyle({ bold: !(data.styles[selected] && data.styles[selected].bold) }) },
                { kind: "btn", glyph: "I", title: "斜体 (Ctrl+I)", onClick: () => setStyle({ italic: !(data.styles[selected] && data.styles[selected].italic) }) },
                { kind: "btn", glyph: "U", title: "下划线 (Ctrl+U)", onClick: () => setStyle({ underline: !(data.styles[selected] && data.styles[selected].underline) }) },
                { kind: "color", title: "字体颜色", onInput: v => setStyle({ color: v }) },
                { kind: "color", title: "填充色", label: "填充", onInput: v => setStyle({ bg: v }) }
              ]
            },
            {
              label: "对齐", items: [
                { kind: "btn", icon: "align-left", title: "左对齐", onClick: () => setStyle({ align: "left" }) },
                { kind: "btn", icon: "align-center", title: "居中", onClick: () => setStyle({ align: "center" }) },
                { kind: "btn", icon: "align-right", title: "右对齐", onClick: () => setStyle({ align: "right" }) }
              ]
            },
            {
              label: "合并", items: [
                { kind: "btn", icon: "merge", label: "合并", title: "合并选区（保留左上角值）", onClick: () => { if (!mergeSelection("merge")) OS.toast("请先选择多个单元格", "warn"); } },
                { kind: "btn", icon: "merge", label: "跨列居中", title: "跨列居中（合并并水平居中）", onClick: () => { if (!mergeSelection("center")) OS.toast("请先选择多个单元格", "warn"); } },
                { kind: "btn", icon: "merge", label: "取消合并", title: "取消当前选区的合并", onClick: () => { if (!unmerge(mergeRangeStr())) OS.toast("该区域未合并", "warn"); } }
              ]
            },
            {
              label: "数字", items: [
                { kind: "select", title: "数字格式", width: 92, value: "",
                  options: [ { value: "", label: "常规" }, { value: "int", label: "整数" }, { value: "2f", label: "保留2位" }, { value: "pct", label: "百分比" }, { value: "money", label: "货币" } ],
                  onChange: v => setStyle({ fmt: v }) }
              ]
            },
            {
              label: "条件格式", items: [
                {
                  kind: "split", icon: "format-cond", label: "条件格式", title: "条件格式规则",
                  menu: [
                    { label: "突出显示单元格规则…", onClick: () => openRuleModal("cell") },
                    { label: "重复值…", onClick: () => openRuleModal("dupes") },
                    { label: "唯一值…", onClick: () => openRuleModal("unique") },
                    { divider: true },
                    { label: "数据条（正/负双色）", onClick: () => openRuleModal("bar") },
                    { label: "色阶（双色）", onClick: () => openRuleModal("scale") },
                    { label: "色阶（三色）", onClick: () => openRuleModal("scale3") },
                    { divider: true },
                    { label: "图标集（交通灯/箭头/星级…）", onClick: () => openRuleModal("icon") },
                    { label: "项目选取（前10 / 后10）", onClick: () => openRuleModal("top") },
                    { divider: true },
                    { label: "公式确定要设置格式的单元格…", onClick: () => openRuleModal("formula") },
                    { divider: true },
                    { label: "管理规则…", onClick: () => openManager() }
                  ]
                }
              ]
            },
            {
              label: "编辑", items: [
                { kind: "btn", glyph: "⌫", title: "清除选区格式", onClick: clearFormat },
                { kind: "btn", icon: "undo", title: "撤销 (Ctrl+Z)", onClick: undo },
                { kind: "btn", icon: "redo", title: "重做 (Ctrl+Y)", onClick: redo },
                { kind: "btn", icon: "search", title: "查找 (Ctrl+F)", onClick: () => openFindPanel("find") },
                { kind: "btn", icon: "replace", title: "查找替换 (Ctrl+H)", onClick: () => openFindPanel("replace") }
              ]
            }
          ]
        },
        {
          id: "formulas", label: "公式", groups: [
            {
              label: "函数库", items: [
                { kind: "btn", glyph: "Σ", title: "自动求和", onClick: () => { fx.value = "=SUM(" + selected + ":" + selected + ")"; commit(selected, fx.value); } },
                { kind: "btn", icon: "fx", title: "平均值", onClick: () => { fx.value = "=AVERAGE(" + selected + ")"; commit(selected, fx.value); } },
                { kind: "btn", icon: "fx", title: "插入函数", onClick: () => { fx.focus(); fx.value = "="; } }
              ]
            },
            {
              label: "填充", items: [
                { kind: "btn", icon: "fill", title: "向下/向右填充：将活动单元格的公式（相对引用自动偏移）或数值填充到当前选区", onClick: () => fillSelection() }
              ]
            },
            {
              label: "定义名称", items: [
                { kind: "btn", icon: "tag", title: "用选区地址快速新建名称", label: "定义名称", onClick: () => openNameEdit(null) },
                { kind: "btn", icon: "list", title: "管理已定义的名称（新建/编辑/删除）", label: "名称管理器", onClick: openNameManager },
                { kind: "btn", icon: "tag", title: "根据所选内容批量创建名称（标题行列作为名称）", label: "批量创建…", onClick: () => {
                  const rg = rangeRect(); if (!rg) return;
                  const m = openModal("批量创建名称");
                  const hint = h(`<div style="margin-bottom:8px;color:#666;font-size:12px;">根据所选区域的<strong>首行</strong>或<strong>首列</strong>创建名称，后面的行/列各自作为引用区域。</div>`);
                  const chkRow = h(`<label class="cf-row"><input type="checkbox" class="bc-top" checked><span>最左列的值作为名称（每行创建一个名称，引用该行的剩余列）</span></label>`);
                  chkRow.querySelector(".bc-top").checked = true;
                  const chkCol = h(`<label class="cf-row"><input type="checkbox" class="bc-top2"><span>首行的值作为名称（每列创建一个名称，引用该列的剩余行）</span></label>`);
                  m.body.appendChild(hint); m.body.appendChild(chkRow); m.body.appendChild(chkCol);
                  m.ok.addEventListener("click", () => {
                    data.names = data.names || [];
                    const rowMode = chkRow.querySelector(".bc-top").checked;
                    const colMode = chkCol.querySelector(".bc-top2").checked;
                    let count = 0;
                    if (rowMode) {
                      for (let r = rg.r1 + 1; r <= rg.r2; r++) {
                        const label = String(getCell(FE.idxToCol(rg.c1) + r) ?? "").trim();
                        if (!label || /^[A-Za-z]+[0-9]+$/.test(label)) continue;
                        const ref = FE.idxToCol(rg.c1 + 1) + r + ":" + FE.idxToCol(rg.c2) + r;
                        if (!data.names.some(n => n.name.toLowerCase() === label.toLowerCase())) {
                          data.names.push({ name: label, ref: ref.toUpperCase(), comment: "批量创建", scope: "workbook" });
                          count++;
                        }
                      }
                    }
                    if (colMode) {
                      for (let c = rg.c1 + 1; c <= rg.c2; c++) {
                        const label = String(getCell(FE.idxToCol(c) + rg.r1) ?? "").trim();
                        if (!label || /^[A-Za-z]+[0-9]+$/.test(label)) continue;
                        const ref = FE.idxToCol(c) + (rg.r1 + 1) + ":" + FE.idxToCol(c) + rg.r2;
                        if (!data.names.some(n => n.name.toLowerCase() === label.toLowerCase())) {
                          data.names.push({ name: label, ref: ref.toUpperCase(), comment: "批量创建", scope: "workbook" });
                          count++;
                        }
                      }
                    }
                    ctx.markDirty(); m.close();
                    OS.toast("批量创建了 " + count + " 个名称 ✅", "ok");
                  });
                }}
              ]
            },
            {
              label: "公式审核", items: [
                { kind: "btn", icon: "arrow-right", title: "追踪引用单元格：活动单元格的公式引用了谁", label: "追踪引用", onClick: tracePrecedents },
                { kind: "btn", icon: "arrow-left", title: "追踪从属单元格：谁的公式引用了活动单元格", label: "追踪从属", onClick: traceDependents },
                { kind: "btn", icon: "clear", title: "清除所有追踪高亮", label: "清除追踪", onClick: clearTraces },
                { kind: "btn", icon: "debug", title: "分步求值：把活动单元格的公式拆成每一步中间结果", label: "分步求值", onClick: stepEvaluate },
                { kind: "btn", icon: "alert", title: "错误检查：扫全表带公式单元格，列出错误列表", label: "错误检查", onClick: errorCheck }
              ]
            }
          ]
        },
        {
          id: "view", label: "视图", groups: [
            {
              label: "冻结窗格", items: [
                { kind: "btn", icon: "freeze", label: "冻结首行", title: "冻结/取消冻结首行", onClick: () => toggleFreeze("row") },
                { kind: "btn", icon: "freeze", label: "冻结首列", title: "冻结/取消冻结首列", onClick: () => toggleFreeze("col") },
                { kind: "btn", icon: "freeze", label: "冻结窗格", title: "同时冻结首行与首列", onClick: () => toggleFreeze("both") },
                { kind: "btn", icon: "freeze", label: "取消冻结", title: "取消所有冻结", onClick: () => setFreeze(0, 0) }
              ]
            }
          ]
        },
        {
          id: "insert", label: "插入", groups: [
            {
              label: "图表", items: [
                { kind: "btn", icon: "bar-chart", label: "柱状", title: "选中数据区域生成柱状图", onClick: () => addChart("bar") },
                { kind: "btn", icon: "line-chart", label: "折线", title: "选中数据区域生成折线图", onClick: () => addChart("line") },
                { kind: "btn", icon: "pie-chart", label: "饼图", title: "选中数据区域生成饼图（取第一列数值）", onClick: () => addChart("pie") },
                { kind: "btn", icon: "scatter", label: "散点", title: "X/Y 两列数值生成散点图（第1列=X，第2列=Y）", onClick: () => addChart("scatter") },
                { kind: "btn", icon: "waterfall", label: "瀑布", title: "累计变化瀑布图（正负段颜色不同 + 总计柱）", onClick: () => addChart("waterfall") },
                { kind: "btn", icon: "combo", label: "组合", title: "柱 + 线叠加（第1系列柱，其余系列线）", onClick: () => addChart("combo") }
              ]
            }
          ]
        },
      {
        id: "data", label: "数据", groups: [
          {
            label: "排序和筛选", items: [
              { kind: "btn", icon: "sort-asc", title: "升序排序（按选区首列）", label: "升序", onClick: () => { const rg = rangeRect(); if (!rg) { OS.toast("请先选中区域", "warn"); return; } sortRange(FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2, FE.idxToCol(rg.c1), true); } },
              { kind: "btn", icon: "sort-desc", title: "降序排序（按选区首列）", label: "降序", onClick: () => { const rg = rangeRect(); if (!rg) { OS.toast("请先选中区域", "warn"); return; } sortRange(FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2, FE.idxToCol(rg.c1), false); } },
              { kind: "btn", icon: "sort-asc", title: "自定义排序（选择依据列与顺序）", label: "自定义", onClick: openSortModal },
              { kind: "btn", icon: "filter", title: "筛选：按条件隐藏不匹配的行", label: "筛选", onClick: openFilterModal },
              { kind: "btn", icon: "filter", title: "高级筛选：条件区域 AND/OR + 复制到新位置 + 提取唯一", label: "高级筛选", onClick: openAdvancedFilterModal },
              { kind: "btn", icon: "filter", title: "清除所有筛选", label: "清除", onClick: () => { clearFilters(); OS.toast("已清除筛选", "ok"); } }
            ]
          },
          {
            label: "数据工具", items: [
              { kind: "btn", icon: "validate", label: "数据验证", title: "设置下拉列表 / 数值区间验证", onClick: openValidationModal },
              { kind: "btn", icon: "validate", label: "清除验证", title: "清除当前选区的数据验证", onClick: () => { const r = mergeRangeStr(); if (removeValidation(r)) OS.toast("已清除验证", "ok"); else OS.toast("该区域无验证", "warn"); } },
              { kind: "btn", icon: "sort-asc", label: "删除重复值", title: "按选中列查重，保留首次出现行", onClick: openRemoveDupModal },
              { kind: "btn", icon: "filter", label: "数据分列", title: "按分隔符/固定宽度把一列拆成多列", onClick: openTextToColsModal },
              { kind: "btn", icon: "bar-chart", label: "数据透视表", title: "选数据区 → 行/列/值字段 → 动态汇总 → 带总计二维表", onClick: openPivotModal },
              { kind: "btn", icon: "table", label: "模拟运算表", title: "单/双变量假设分析：输入值遍历 → 自动算出每个组合的公式结果", onClick: openDataTableModal },
              { kind: "btn", icon: "target", label: "单变量求解", title: "反推：告诉公式应该等于什么值，算出输入单元格需要填什么数", onClick: openGoalSeekModal },
              { kind: "btn", icon: "filter", label: "快速填充", title: "给两行样例，自动推断变换模式（提取/切分/拼接/加前后缀），一键填充后面所有行", onClick: openFlashFillModal }
            ]
          }
        ]
      },
      {
        id: "review", label: "审阅", groups: [
          {
            label: "批注", items: [
              { kind: "btn", icon: "comment", title: "为当前选中单元格新建批注（Ctrl+Shift+M）", onClick: addComment },
              { kind: "btn", icon: "arrow-up", title: "上一条（待处理）", onClick: () => navComment(-1) },
              { kind: "btn", icon: "arrow-down", title: "下一条（待处理）", onClick: () => navComment(1) },
              { kind: "btn", icon: "search", title: "显示批注面板 / 隐藏批注面板", onClick: togglePanel },
              { kind: "btn", icon: "check", title: "解决所有批注", onClick: resolveAll }
            ]
          },
          {
            label: "保护", items: [
              { kind: "btn", icon: "lock", title: "保护工作表：锁定所有单元格，无法编辑（可设密码）", label: "保护工作表", onClick: openProtectSheet },
              { kind: "btn", icon: "unlock", title: "切换选区的锁定状态（默认所有单元格锁定）", label: "锁定/解锁单元格", onClick: openLockCell },
              { kind: "btn", icon: "eye-off", title: "切换选区的「隐藏公式」状态（工作表保护后生效）", label: "隐藏公式", onClick: openHideFormula }
            ]
          }
        ]
      },
      {
        id: "view", label: "视图", groups: [
          {
            label: "窗口", items: [
              { kind: "btn", icon: "lock", label: "冻结窗格", title: "冻结首行/首列/到当前位置，滚动时固定表头（Excel 核心功能）", onClick: openFreezeMenu },
              { kind: "btn", icon: "sort-asc", label: "分类汇总", title: "按某列分组 → 每组末尾插入小计行 + 总计行 + ±号分级折叠", onClick: openSubtotalModal }
            ]
          },
          {
            label: "工作组", items: [
              { kind: "btn", icon: "filter", label: "工作组提示", title: "Ctrl+点击工作表标签可把多个 sheet 加入/移出工作组。工作组内写入单元格会同步到所有成员。右键标签可设置颜色。", onClick: () => OS.toast("Ctrl+点击工作表标签切换工作组（已加入工作组的标签会高亮）。\n右键标签可设置彩色。\n工作组内写单元格 = 所有成员同步写 ✅", "ok") }
            ]
          }
        ]
      },
      {
        id: "export", label: "导出", groups: [
          {
            label: "打印", items: [
              { kind: "btn", icon: "print", title: "打印（Ctrl+P）：弹出系统打印对话框", label: "打印", onClick: () => exportAs("pdf") },
              { kind: "btn", icon: "page-break", title: "页面设置：纸张、方向、页边距", label: "页面设置", onClick: openPageSetup }
            ]
          },
          {
            label: "导出为", items: [
              { kind: "btn", icon: "save", title: "导出为 CSV（逗号分隔，UTF-8 BOM）", label: "CSV", onClick: () => exportAs("csv") },
              { kind: "btn", icon: "preview", title: "导出为 HTML 表格", label: "HTML", onClick: () => exportAs("html") },
              { kind: "btn", icon: "download", title: "直接生成并下载 PDF 文件（光栅化活动表，无需打印对话框）", label: "下载 PDF 文件", onClick: downloadPdfFile },
              { kind: "btn", icon: "save", title: "导出为 JSON（可重新导入）", label: "JSON", onClick: () => exportAs("json") }
            ]
          },
          {
            label: "PDF 导出范围", items: [
              { kind: "select", title: "范围预设（优先于下方手动设置）", value: "", options: [{ value: "", label: "自定义（用下方输入）" }, { value: "all", label: "全部工作表" }, { value: "current", label: "当前工作表" }], onChange: (v) => { pdfPreset = v || ""; } },
              { kind: "input", type: "text", placeholder: "行区间 如 5-20（留空=全部）", title: "仅导出指定行区间，例如 5-20 或单页 8（预设选「自定义」时生效）", value: "", onInput: (v) => { pdfRangeText = v || ""; } },
              ...(data.sheets && data.sheets.length > 1 ? [{ kind: "select", title: "选择工作表（导出 PDF 用，自定义预设时生效）", value: String(data.activeSheet || 0), options: data.sheets.map((s, i) => [String(i), s.name || ("Sheet" + (i + 1))]), onChange: (v) => { pdfSheetIndex = parseInt(v, 10) || 0; } }] : []),
              { kind: "btn", icon: "download", title: "按范围预设 / 行区间 / 工作表下载 PDF 文件", label: "按范围下载 PDF", onClick: () => {
                const opts = {};
                if (pdfPreset === "all") {
                  opts.sheets = data.sheets ? data.sheets.map((_, i) => i) : [0];
                } else if (pdfPreset === "current") {
                  opts.sheets = [data.activeSheet || 0];
                } else {
                  const rt = (pdfRangeText || "").trim();
                  const m = /^(\d+)\s*-\s*(\d+)$/.exec(rt);
                  if (m) { opts.startRow = parseInt(m[1], 10); opts.endRow = parseInt(m[2], 10); }
                  else if (/^\d+$/.test(rt)) { const n = parseInt(rt, 10); opts.startRow = n; opts.endRow = n; }
                  if (data.sheets && data.sheets.length > 1 && pdfSheetIndex != null) opts.sheetIndex = pdfSheetIndex;
                }
                downloadPdfFile(opts);
              } }
            ]
          }
        ]
      }
      ],
    });

    function setStyle(patch) {
      snapshot();
      data.styles[selected] = Object.assign(data.styles[selected] || {}, patch);
      applyFmt(); applyCondFormat(); ctx.markDirty();
    }
    function clearFormat() {
      const rg = rangeRect();
      if (!rg) return;
      snapshot();
      let count = 0;
      for (let r = rg.r1; r <= rg.r2; r++) {
        for (let c = rg.c1; c <= rg.c2; c++) {
          const ref = FE.idxToCol(c) + r;
          if (data.styles[ref]) { delete data.styles[ref]; count++; }
          const td = table.querySelector(`td[data-ref="${ref}"]`);
          if (td) td.removeAttribute("style");
        }
      }
      applyCondFormat(); ctx.markDirty();
      if (count > 0) OS.toast("已清除 " + count + " 个单元格的格式");
      else OS.toast("选区没有可清除的格式", "info");
    }
    function applyFmt() {
      const bCss = st => ({ hair: "1px solid", thin: "1px solid", medium: "2px solid", thick: "3px solid", dashed: "1px dashed", mediumDashed: "2px dashed", dotted: "1px dotted", double: "3px double", dashDot: "1px dashed", mediumDashDot: "2px dashed", dashDotDot: "1px dashed", slantDashDot: "1px dashed" }[st] || "1px solid");
      // 数字格式渲染（简单 JS toLocaleString 转换）
      function renderNumber(v, fmt) {
        if (v == null || v === "") return v;
        if (typeof v !== "number") return v;
        try {
          switch (fmt) {
            case "0%": return (v * 100).toFixed(0) + "%";
            case "$#,##0.00": return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            case "0.00E+00": return v.toExponential(2);
            case "#,##0.00": return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            case "yyyy-mm-dd": { const d = new Date(v); return d.toISOString().slice(0, 10); }
            case "h:mm:ss": { const d = new Date(v); return d.toTimeString().slice(0, 8); }
            case "General": case undefined: return v;
            default: return v;
          }
        } catch (e) { return v; }
      }
      for (const ref in data.styles) {
        const td = table.querySelector(`td[data-ref="${ref}"]`); if (!td) continue;
        const s = data.styles[ref];
        if (s.color) td.style.color = s.color;
        if (s.bg) td.style.background = s.bg;
        if (s.bold) td.style.fontWeight = "700"; else if (s.bold === false) td.style.fontWeight = "400";
        if (s.italic) td.style.fontStyle = "italic"; else if (s.italic === false) td.style.fontStyle = "normal";
        if (s.underline) td.style.textDecoration = "underline"; else if (s.underline === false) td.style.textDecoration = "none";
        if (s.strikethrough) td.style.textDecorationLine = "line-through"; else if (s.strikethrough === false) td.style.textDecorationLine = "";
        if (s.align) td.style.textAlign = s.align;
        if (s.border) {
          ["left", "right", "top", "bottom"].forEach(side => {
            const side2 = side.charAt(0).toUpperCase() + side.slice(1);
            const b = s.border[side];
            td.style["border" + side2] = b ? `${bCss(b.style)} ${b.color || "#333"}` : "";
          });
        }
        // 数字格式渲染（不覆盖原始值，只改变显示）
        if (s.numberFormat) {
          const cell = data.cells[ref];
          const rawVal = cell ? (cell.v != null ? cell.v : (typeof cell.f === "string" ? cell.f : "")) : "";
          if (typeof rawVal === "number" || (typeof rawVal === "string" && rawVal !== "" && !isNaN(Number(rawVal)))) {
            const rendered = renderNumber(typeof rawVal === "number" ? rawVal : Number(rawVal), s.numberFormat);
            if (rendered !== rawVal && rendered !== undefined) td.textContent = rendered;
          }
        }
      }
    }
    applyFmt();
    highlightBadges(); renderComments();

    /* ---------- 直接下载 PDF 文件（光栅化活动表 → PDF，零依赖，免去打印对话框） ---------- */
    const SHEET_ROW_H = 28, SHEET_COL_W = 92, SHEET_HEAD_W = 44, SHEET_HEAD_H = 28, SHEET_ROWS_PER_PAGE = 32;
    const SHEET_RASTER_CSS = [
      "*{box-sizing:border-box;margin:0;padding:0}",
      "html,body{font-family:-apple-system,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif;background:#fff}",
      ".ss-doc{background:#fff;color:#1a2332;font-size:12px;padding:14px}",
      ".ss-title{font-size:15px;font-weight:700;margin-bottom:8px;color:#22324a}",
      ".ss-table{border-collapse:collapse;width:100%}",
      ".ss-h,.ss-rh{background:#eef2f7;color:#33425b;font-weight:600;border:1px solid #cdd6e0;padding:3px 6px;text-align:center}",
      ".ss-rh{width:" + SHEET_HEAD_W + "px}",
      ".ss-td{border:1px solid #cdd6e0;padding:3px 6px;vertical-align:middle;word-break:break-word}"
    ].join("");
    // 扫描活动表已使用范围（最大有值行列）—— 委托纯模块 OS.SheetExport
    function sheetUsedRange() {
      return OS.SheetExport.sheetUsedRange(data.cells, FE.colToIdx);
    }
    function sheetCellStyle(ref) {
      const st = (data.styles && data.styles[ref]) || {};
      let s = "";
      if (st.bold) s += "font-weight:700;";
      if (st.italic) s += "font-style:italic;";
      if (st.align) s += "text-align:" + st.align + ";";
      if (st.color) s += "color:" + st.color + ";";
      if (st.bg) s += "background:" + st.bg + ";";
      return s;
    }
    function sheetCellText(ref) {
      let v;
      try { v = getCell(ref); } catch (e) { v = ""; }
      if (v == null) v = "";
      else if (v instanceof Date) v = v.toLocaleDateString();
      else if (typeof v === "boolean") v = v ? "TRUE" : "FALSE";
      else if (Array.isArray(v)) v = "";
      else if (typeof v === "number") v = isFinite(v) ? String(v) : "#DIV/0!";
      else v = String(v);
      return v;
    }
    // 构建单页（行区间）的纯 HTML 表字符串 —— 委托纯模块 OS.SheetExport
    function buildSheetPageHtml(range, startRow, endRow, title) {
      return OS.SheetExport.buildSheetPageHtml(range, startRow, endRow, title, sheetCellText, sheetCellStyle, FE.idxToCol, OS.util.escapeHtml);
    }
    function sheetRasterizeSvg(svgStr, w2, h2) {
      return new Promise((resolve) => {
        const img = new Image();
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = w2; c.height = h2;
          const cx = c.getContext("2d");
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, w2, h2);
          try { cx.drawImage(img, 0, 0, w2, h2); } catch (e) { /* 跨域图片可能绘制失败，保持白底 */ }
          let data;
          try { data = new Uint8Array(cx.getImageData(0, 0, w2, h2).data); }
          catch (e) { data = new Uint8Array(w2 * h2 * 4).fill(255); } // 画布被污染时降级为白页
          resolve({ data, w: w2, h: h2 });
        };
        img.onerror = () => resolve({ data: new Uint8Array(w2 * h2 * 4).fill(255), w: w2, h: h2 });
        img.src = url;
      });
    }
    async function downloadPdfFile(opts) {
      if (!OS.PdfTool || !OS.PdfTool.writeImagePdf) { OS.toast("PDF 引擎未就绪", "warn"); return; }
      opts = opts || {};
      // 决定要导出哪些工作表（0-based 索引数组）；范围预设走 opts.sheets，否则单表/手动选表
      let sheetIdxs = null;
      if (Array.isArray(opts.sheets)) sheetIdxs = opts.sheets;
      else if (opts.sheetIndex != null && data.sheets && data.sheets[opts.sheetIndex]) sheetIdxs = [opts.sheetIndex];
      const prevSheet = data.activeSheet;
      const scale = 2;
      try {
        const pages = [];
        const targets = (sheetIdxs && sheetIdxs.length)
          ? sheetIdxs
          : (data.sheets ? data.sheets.map((_, i) => i) : [0]);
        for (const si of targets) {
          if (data.sheets && data.sheets[si]) data.activeSheet = si;
          const built = OS.SheetExport.buildWorkbookPages(data, Object.assign({}, opts, {
            sheetIndex: (data.sheets && data.sheets[si]) ? si : null,
            colToIdx: FE.colToIdx, idxToCol: FE.idxToCol,
            cellText: sheetCellText, cellStyle: sheetCellStyle, escapeHtml: OS.util.escapeHtml
          }));
          for (const sh of built.sheets) {
            for (const pg of sh.pages) {
              const rows = pg.endRow - pg.startRow + 1;
              const W = SHEET_HEAD_W + sh.range.c * SHEET_COL_W;
              const H = SHEET_HEAD_H + rows * SHEET_ROW_H + 40;
              const svg = OS.SvgRaster.buildPageSvg(pg.html, W, H, scale, SHEET_RASTER_CSS);
              const r = await sheetRasterizeSvg(svg, W * scale, H * scale);
              pages.push({ width: r.w, height: r.h, data: r.data, mediaW: 842, mediaH: Math.round(842 * H / W) });
            }
          }
        }
        if (!pages.length) { OS.toast("所选范围没有可导出内容", "warn"); return; }
        const bytes = await OS.PdfTool.writeImagePdf(pages);
        OS.util.download(new Blob([bytes], { type: "application/pdf" }), (doc.name || "表格") + ".pdf");
        OS.toast("已生成 PDF 文件（" + pages.length + " 页）", "ok");
      } catch (e) {
        OS.toast("PDF 生成失败：" + (e && e.message || e), "warn");
      } finally {
        data.activeSheet = prevSheet; // 导出为一次性动作，结束后还原活动表
      }
    }

    function exportAs(fmt) {
      const title = doc.name || "表格";
      if (fmt === "csv") {
        let out = "";
        for (let r = 1; r <= ROWS; r++) {
          const row = [];
          for (let c = 1; c <= COLS; c++) { let v = getCell(FE.idxToCol(c) + r); if (v instanceof Date) v = ""; row.push('"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'); }
          out += row.join(",") + "\n";
        }
        OS.util.download(new Blob([out], { type: "text/csv" }), title + ".csv");
      } else if (fmt === "html") {
        const cf = computeCF();
        let html = "<table border=1 style='border-collapse:collapse'>";
        for (let r = 1; r <= ROWS; r++) { html += "<tr>"; for (let c = 1; c <= COLS; c++) {
          const ref = FE.idxToCol(c) + r, v = getCell(ref), s = data.styles[ref], st = cf[ref];
          const mBg = s && s.bg, mColor = s && s.color;
          let style = "";
          if (st && st.bg != null && !mBg) style += "background:" + st.bg + ";"; else if (mBg) style += "background:" + mBg + ";";
          const col = (st && st.color != null && !mColor) ? st.color : (mColor || "");
          if (col) style += "color:" + col + ";";
          let inner = escapeHtmlCell(v);
          if (st && st.bar) inner = "<div style='position:relative'><div style='position:absolute;left:0;top:0;bottom:0;width:" + st.bar.pct.toFixed(1) + "%;background:" + st.bar.color + ";opacity:.45'></div><span style='position:relative'>" + inner + "</span></div>";
          html += "<td" + (style ? " style='" + style + "'" : "") + ">" + inner + "</td>";
        } html += "</tr>"; }
        html += "</table>";
        const charts = data.charts || [];
        if (charts.length) {
          html += "<div class='exported-charts' style='margin-top:16px'>";
          charts.forEach(spec => {
            html += "<figure class='exported-chart' style='display:inline-block;margin:8px;vertical-align:top'>" +
              "<figcaption style='font:13px sans-serif;color:#33425b;margin-bottom:4px'>" + escapeHtmlCell(spec.title || "") + "</figcaption>" +
              buildChartSVG(spec) + "</figure>";
          });
          html += "</div>";
        }
        OS.util.download(new Blob([`<!DOCTYPE html><meta charset=UTF-8><title>${title}</title>` + html], { type: "text/html" }), title + ".html");
      } else if (fmt === "pdf") doPrint();
      else if (fmt === "json") OS.util.download(new Blob([JSON.stringify(data)], { type: "application/json" }), title + ".json");
      else if (fmt === "pdffile") downloadPdfFile();
    }

    /* ---------- 打印：应用页面设置 + window.print() ---------- */
    function doPrint() {
      const ps = data.pageSetup || { paperSize: "A4", orientation: "portrait", margins: { top: 15, bottom: 15, left: 15, right: 15 } };
      // 注入 @page CSS + 打印专用样式
      const styleId = "__lvjx-print-style__";
      let style = document.getElementById(styleId);
      if (!style) { style = document.createElement("style"); style.id = styleId; document.head.appendChild(style); }
      const orient = ps.orientation || "portrait";
      const paperMap = { A4: "210mm 297mm", A3: "297mm 420mm", Letter: "216mm 279mm", Legal: "216mm 356mm" };
      const size = paperMap[ps.paperSize] || "210mm 297mm";
      const m = ps.margins || {};
      const mt = (m.top || 15) + "mm", mb = (m.bottom || 15) + "mm";
      const ml = (m.left || 15) + "mm", mr = (m.right || 15) + "mm";
      style.textContent = `
        @page { size: ${orient === "landscape" ? size.split(" ").reverse().join(" ") : size} ${orient}; margin: ${mt} ${mr} ${mb} ${ml}; }
        @media print {
          body * { visibility: hidden; }
          table, table * { visibility: visible; }
          table { position: absolute; left: 0; top: 0; width: 100% !important; border-collapse: collapse; }
          th, td { border: 1px solid #999 !important; padding: 2px 4px !important; font-size: 11px !important; }
        }`;
      window.print();
      setTimeout(() => { if (style && style.parentNode) style.remove(); }, 1000);
    }

    /* ---------- 页面设置模态框 ---------- */
    function openPageSetup() {
      const cur = data.pageSetup || { paperSize: "A4", orientation: "portrait", margins: { top: 15, bottom: 15, left: 15, right: 15 } };
      const ov = document.createElement("div");
      ov.className = "pg-overlay";
      ov.innerHTML = `
        <div class="pg-modal" style="width:420px">
          <div class="pg-title">页面设置</div>
          <div class="pg-row">
            <label>纸张大小</label>
            <select id="ps-paper"><option value="A4">A4 (210×297mm)</option><option value="A3">A3 (297×420mm)</option><option value="Letter">Letter (8.5×11in)</option><option value="Legal">Legal (8.5×14in)</option></select>
          </div>
          <div class="pg-row">
            <label>方向</label>
            <select id="ps-orient"><option value="portrait">纵向</option><option value="landscape">横向</option></select>
          </div>
          <div class="pg-row" style="display:flex;gap:8px;flex-wrap:wrap">
            <div class="pg-field"><label>上边距 (mm)</label><input type="number" id="ps-mt" value="${cur.margins.top}" min="5" max="50"></div>
            <div class="pg-field"><label>下边距 (mm)</label><input type="number" id="ps-mb" value="${cur.margins.bottom}" min="5" max="50"></div>
            <div class="pg-field"><label>左边距 (mm)</label><input type="number" id="ps-ml" value="${cur.margins.left}" min="5" max="50"></div>
            <div class="pg-field"><label>右边距 (mm)</label><input type="number" id="ps-mr" value="${cur.margins.right}" min="5" max="50"></div>
          </div>
          <div class="pg-actions">
            <button class="pg-cancel">取消</button>
            <button class="pg-ok">确定</button>
          </div>
        </div>`;
      wrap.appendChild(ov);
      ov.querySelector("#ps-paper").value = cur.paperSize;
      ov.querySelector("#ps-orient").value = cur.orientation;
      const close = () => ov.remove();
      ov.querySelector(".pg-cancel").onclick = close;
      ov.querySelector(".pg-ok").onclick = () => {
        data.pageSetup = {
          paperSize: ov.querySelector("#ps-paper").value,
          orientation: ov.querySelector("#ps-orient").value,
          margins: {
            top: +ov.querySelector("#ps-mt").value || 15,
            bottom: +ov.querySelector("#ps-mb").value || 15,
            left: +ov.querySelector("#ps-ml").value || 15,
            right: +ov.querySelector("#ps-mr").value || 15
          }
        };
        close();
        OS.toast("页面设置已保存", "ok");
      };
      ov.addEventListener("click", e => { if (e.target === ov) close(); });
    }
    function escapeHtmlCell(v) { return OS.util.escapeHtml(v == null ? "" : v); }

    /* ---------------- 图表（选区数据 -> SVG） ---------------- */
    const CHART_COLORS = ["#2f6fed", "#e0533d", "#2fa86a", "#f0a020", "#8b5cf6", "#00a3a3", "#d6457f", "#5b8c00"];
    function chartTypeName(t) { return { bar: "柱状图", line: "折线图", pie: "饼图", scatter: "散点图", waterfall: "瀑布图", combo: "组合图（柱+线）" }[t] || "图表"; }

    function cellNum(ref) { const v = getCell(ref); if (typeof v === "number") return v; if (typeof v === "string" && v !== "" && !isNaN(Number(v))) return Number(v); return null; }
    function cellText(ref) { const v = getCell(ref); if (v == null || v === "") return ""; return typeof v === "number" ? String(v) : String(v); }
    function isNumCell(ref) { return cellNum(ref) !== null; }
    function isTextCell(ref) { return cellNum(ref) === null && cellText(ref) !== ""; }
    function colLooksText(c, r1, r2) { let t = 0, n = 0; for (let r = r1; r <= r2; r++) { const ref = FE.idxToCol(c) + r; if (isTextCell(ref)) t++; else if (isNumCell(ref)) n++; } return t >= n && t > 0; }

    // 从选区矩形提取分类与系列（自动识别首列文本作分类、首行文本作表头）
    function extractChartData(rg) {
      const { r1, r2, c1, c2 } = rg;
      let catCol = (c2 > c1 && colLooksText(c1, r1, r2)) ? c1 : null;
      const sC1 = catCol ? c1 + 1 : c1;
      let headerRow = null;
      if (r2 > r1) {
        let topText = 0, botNum = 0, total = c2 - sC1 + 1;
        for (let c = sC1; c <= c2; c++) { const col = FE.idxToCol(c); if (isTextCell(col + r1)) topText++; if (isNumCell(col + r2)) botNum++; }
        if (total > 0 && topText >= Math.ceil(total / 2) && botNum >= Math.ceil(total / 2)) headerRow = r1;
      }
      const dR1 = headerRow != null ? r1 + 1 : r1;
      const categories = [];
      for (let r = dR1; r <= r2; r++) categories.push(catCol != null ? (cellText(FE.idxToCol(catCol) + r) || ("行" + r)) : String(r - dR1 + 1));
      const series = [];
      for (let c = sC1; c <= c2; c++) {
        const col = FE.idxToCol(c);
        const name = headerRow != null ? (cellText(col + r1) || ("系列" + (c - sC1 + 1))) : ("系列" + (c - sC1 + 1));
        const values = [];
        for (let r = dR1; r <= r2; r++) values.push(cellNum(col + r) || 0);
        series.push({ name, values });
      }
      return { categories, series };
    }
    function rangeRectFromStr(s) {
      const parts = String(s).split(":");
      const a = FE.parseRef(parts[0]); if (!a) return null;
      const b = parts[1] ? FE.parseRef(parts[1]) : a;
      return { r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row), c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col) };
    }
    function niceMax(v) {
      if (v <= 0) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; let m;
      if (n <= 1) m = 1; else if (n <= 2) m = 2; else if (n <= 5) m = 5; else m = 10;
      return m * p;
    }
    function esc(s) { return OS.util.escapeHtml(String(s)); }

    function axesSVG(W, H, mL, mR, mT, mB, maxV, minV, cats) {
      const pw = W - mL - mR, ph = H - mT - mB;
      const total = (maxV - minV) || 1;
      const yOf = v => mT + ph * (maxV - v) / total;
      let g = "";
      const ticks = 4;
      for (let i = 0; i <= ticks; i++) {
        const v = minV + (maxV - minV) * i / ticks;
        const y = yOf(v);
        g += `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W - mR}" y2="${y.toFixed(1)}" stroke="var(--rule)" stroke-width="1"/>`;
        g += `<text x="${mL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtChartNum(v)}</text>`;
      }
      // 分类轴标签
      const n = cats.length; const step = pw / n;
      for (let i = 0; i < n; i++) {
        const x = mL + step * (i + 0.5);
        const label = cats[i].length > 8 ? cats[i].slice(0, 7) + "…" : cats[i];
        g += `<text x="${x.toFixed(1)}" y="${H - mB + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(label)}</text>`;
      }
      g += `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}" stroke="var(--rule)" stroke-width="1"/>`;
      g += `<line x1="${mL}" y1="${(H - mB).toFixed(1)}" x2="${W - mR}" y2="${(H - mB).toFixed(1)}" stroke="var(--rule)" stroke-width="1"/>`;
      return { g, yOf, step, pw, ph, mL, mR, mT, mB, W, H };
    }
    function fmtChartNum(v) {
      if (!isFinite(v)) return String(v);
      const a = Math.abs(v);
      if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + "k";
      if (Number.isInteger(v)) return String(v);
      return v.toFixed(1);
    }
    function legendSVG(series, x, y) {
      let g = ""; series.forEach((s, i) => {
        const cy = y + i * 18;
        g += `<rect x="${x}" y="${cy - 9}" width="11" height="11" rx="2" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`;
        g += `<text x="${x + 16}" y="${cy + 1}" font-size="11" fill="var(--ink)">${esc(s.name)}</text>`;
      });
      return g;
    }
    function buildChartSVG(spec) {
      const rg = rangeRectFromStr(spec.range); if (!rg) return "";
      const { categories, series } = extractChartData(rg);
      if (spec.type === "pie") return pieSVG(categories, series, spec);
      if (spec.type === "line") return lineSVG(categories, series, spec);
      if (spec.type === "scatter") return scatterSVG(series, spec);
      if (spec.type === "waterfall") return waterfallSVG(categories, series, spec);
      if (spec.type === "combo") return comboSVG(categories, series, spec);
      return barSVG(categories, series, spec);
    }
    function barSVG(cats, series, spec) {
      const W = 560, H = 320, mL = 46, mR = 16, mT = 16, mB = 46;
      let maxV = 0, minV = 0;
      series.forEach(s => s.values.forEach(v => { if (v > maxV) maxV = v; if (v < minV) minV = v; }));
      maxV = niceMax(maxV); if (minV < 0) minV = -niceMax(-minV);
      const { g, yOf, step } = axesSVG(W, H, mL, mR, mT, mB, maxV, minV, cats);
      const baseY = yOf(0);
      const nS = series.length, nC = cats.length;
      const groupW = step, innerW = groupW * 0.78, bw = innerW / nS;
      let bars = "";
      for (let i = 0; i < nC; i++) {
        const gx = mL + step * i + (groupW - innerW) / 2;
        for (let j = 0; j < nS; j++) {
          const v = series[j].values[i]; const y = yOf(v);
          const bx = gx + j * bw; const top = Math.min(y, baseY); const h = Math.abs(y - baseY);
          bars += `<rect class="chart-bar" x="${bx.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" rx="1.5" fill="${CHART_COLORS[j % CHART_COLORS.length]}"/>`;
        }
      }
      const lg = legendSVG(series, W - mR + 2 > W ? W - 4 : mL + 4, mT + 4);
      return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" class="chart-svg-el">${g}${bars}${lg}</svg>`;
    }
    function lineSVG(cats, series, spec) {
      const W = 560, H = 320, mL = 46, mR = 16, mT = 16, mB = 46;
      let maxV = 0, minV = 0;
      series.forEach(s => s.values.forEach(v => { if (v > maxV) maxV = v; if (v < minV) minV = v; }));
      maxV = niceMax(maxV); if (minV < 0) minV = -niceMax(-minV);
      const { g, yOf, step } = axesSVG(W, H, mL, mR, mT, mB, maxV, minV, cats);
      const nC = cats.length; const xOf = i => mL + step * (i + 0.5);
      let paths = "";
      series.forEach((s, j) => {
        const c = CHART_COLORS[j % CHART_COLORS.length];
        let d = "", pts = "";
        s.values.forEach((v, i) => {
          const x = xOf(i).toFixed(1), y = yOf(v).toFixed(1);
          d += (i === 0 ? "M " : "L ") + x + " " + y + " ";
          pts += `<circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`;
        });
        paths += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2"/>${pts}`;
      });
      const lg = legendSVG(series, mL + 4, mT + 4);
      return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" class="chart-svg-el">${g}${paths}${lg}</svg>`;
    }
    function pieSVG(cats, series, spec) {
      const W = 560, H = 320;
      const s = series[0] || { name: "系列1", values: [] };
      const positives = s.values.map((v, i) => ({ v: Math.max(0, v), label: cats[i] })).filter(x => x.v > 0);
      const total = positives.reduce((a, x) => a + x.v, 0);
      let body = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" class="chart-svg-el">`;
      if (total <= 0) {
        body += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="var(--muted)">该系列无可用数值</text></svg>`;
        return body;
      }
      const cx = 170, cy = H / 2, r = 110;
      let a0 = -Math.PI / 2;
      positives.forEach((x, i) => {
        const frac = x.v / total; const a1 = a0 + frac * Math.PI * 2;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        body += `<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${CHART_COLORS[i % CHART_COLORS.length]}" stroke="var(--bg)" stroke-width="1"/>`;
        a0 = a1;
      });
      // 图例
      let ly = 30;
      positives.forEach((x, i) => {
        const pct = (x.v / total * 100).toFixed(1);
        body += `<rect x="${310}" y="${ly - 10}" width="12" height="12" rx="2" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`;
        body += `<text x="${328}" y="${ly}" font-size="12" fill="var(--ink)">${esc(x.label)} · ${pct}%</text>`;
        ly += 24;
      });
      body += `<text x="310" y="${ly + 6}" font-size="11" fill="var(--muted)">${esc(s.name)}（合计 ${fmtChartNum(total)}）</text>`;
      body += `</svg>`;
      return body;
    }
    /* ---- 散点图：X/Y 两列数值 ---- */
    function scatterSVG(series, spec) {
      const W = 560, H = 320, mL = 46, mR = 16, mT = 16, mB = 46;
      const body = [`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" class="chart-svg-el">`];
      if (series.length < 1) { body.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="var(--muted)">请选中至少两列数值（X/Y）</text></svg>`); return body.join(""); }
      // 第一个系列 = X 值，第二个 = Y 值。如果只有一个系列，Y 用它，X 用索引
      const X = series[0].values;
      const Y = (series[1] || series[0]).values;
      let maxX = -Infinity, minX = Infinity, maxY = -Infinity, minY = Infinity;
      X.forEach(v => { if (v > maxX) maxX = v; if (v < minX) minX = v; });
      Y.forEach(v => { if (v > maxY) maxY = v; if (v < minY) minY = v; });
      if (maxX === minX) { maxX = minX + 1; }
      if (maxY === minY) { maxY = minY + 1; }
      const pw = W - mL - mR, ph = H - mT - mB;
      const xOf = v => mL + pw * (v - minX) / (maxX - minX);
      const yOf = v => mT + ph * (maxY - v) / (maxY - minY);
      // 网格 + X/Y 轴刻度
      for (let i = 0; i <= 4; i++) {
        const xv = minX + (maxX - minX) * i / 4;
        const yy = H - mB; const xx = xOf(xv);
        body.push(`<line x1="${xx.toFixed(1)}" y1="${mT}" x2="${xx.toFixed(1)}" y2="${yy}" stroke="var(--rule)" stroke-dasharray="2 3" stroke-width="1"/>`);
        body.push(`<text x="${xx.toFixed(1)}" y="${H - mB + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${fmtChartNum(xv)}</text>`);
      }
      for (let i = 0; i <= 4; i++) {
        const yv = minY + (maxY - minY) * i / 4;
        const yvY = yOf(yv);
        body.push(`<line x1="${mL}" y1="${yvY.toFixed(1)}" x2="${W - mR}" y2="${yvY.toFixed(1)}" stroke="var(--rule)" stroke-dasharray="2 3" stroke-width="1"/>`);
        body.push(`<text x="${mL - 6}" y="${(yvY + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtChartNum(yv)}</text>`);
      }
      body.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}" stroke="var(--rule)"/>`);
      body.push(`<line x1="${mL}" y1="${(H - mB).toFixed(1)}" x2="${W - mR}" y2="${(H - mB).toFixed(1)}" stroke="var(--rule)"/>`);
      // 散点
      const color = CHART_COLORS[0];
      for (let i = 0; i < Math.min(X.length, Y.length); i++) {
        const cx = xOf(X[i]).toFixed(1); const cy = yOf(Y[i]).toFixed(1);
        body.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="${color}" fill-opacity="0.7" stroke="${color}"/>`);
        body.push(`<text x="${cx}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${fmtChartNum(X[i])},${fmtChartNum(Y[i])}</text>`);
      }
      // 图例
      body.push(`<rect x="${W - 160}" y="${mT}" width="12" height="12" rx="2" fill="${color}"/>`);
      body.push(`<text x="${W - 142}" y="${mT + 10}" font-size="11" fill="var(--ink)">${esc(series[0].name)} vs ${esc(series[1] ? series[1].name : series[0].name)}</text>`);
      body.push(`</svg>`);
      return body.join("");
    }
    /* ---- 瀑布图：累计柱 ---- */
    function waterfallSVG(cats, series, spec) {
      const W = 560, H = 320, mL = 46, mR = 16, mT = 16, mB = 46;
      const body = [`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" class="chart-svg-el">`];
      const s = series[0] || { name: "变化", values: [] };
      // 计算累计
      const running = []; let acc = 0;
      const bars = []; // [{x0, x1, y0(底), y1(顶), isTotal, color}]
      const WCHANGE = "#2f6fed", WDECREASE = "#e0533d", WTOTAL = "#2fa86a";
      const values = s.values;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        running.push(acc);
        const top = acc + v;
        bars.push({ base: acc, top, v, isTotal: false, color: v >= 0 ? WCHANGE : WDECREASE });
        acc = top;
      }
      // 加总计（最后一根）
      bars.push({ base: 0, top: acc, v: acc, isTotal: true, color: WTOTAL });
      running.push(0); // 总计的底从0起
      cats.push("总计");
      // Y 轴范围
      let maxV = 0, minV = 0;
      bars.forEach(b => { if (b.top > maxV) maxV = b.top; if (b.base < minV) minV = b.base; if (b.top < minV) minV = b.top; });
      if (maxV === minV) maxV = minV + 1;
      minV = Math.min(minV, 0);
      const totalRng = maxV - minV || 1;
      const yOf = v => mT + (H - mT - mB) * (maxV - v) / totalRng;
      // Y 轴
      for (let i = 0; i <= 4; i++) {
        const v = minV + totalRng * i / 4; const y = yOf(v);
        body.push(`<line x1="${mL}" y1="${y.toFixed(1)}" x2="${W - mR}" y2="${y.toFixed(1)}" stroke="var(--rule)" stroke-width="1"/>`);
        body.push(`<text x="${mL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtChartNum(v)}</text>`);
      }
      // 零线
      const zeroY = yOf(0);
      body.push(`<line x1="${mL}" y1="${zeroY.toFixed(1)}" x2="${W - mR}" y2="${zeroY.toFixed(1)}" stroke="var(--rule)" stroke-dasharray="3 2"/>`);
      body.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}" stroke="var(--rule)"/>`);
      body.push(`<line x1="${mL}" y1="${(H - mB).toFixed(1)}" x2="${W - mR}" y2="${(H - mB).toFixed(1)}" stroke="var(--rule)"/>`);
      // 每段柱
      const pw = W - mL - mR, n = bars.length, bw = Math.min(40, pw / n * 0.7);
      for (let i = 0; i < n; i++) {
        const xC = mL + pw * (i + 0.5) / n;
        const x0 = xC - bw / 2, x1 = xC + bw / 2;
        const y0 = yOf(Math.min(bars[i].base, bars[i].top));
        const y1 = yOf(Math.max(bars[i].base, bars[i].top));
        body.push(`<rect x="${x0.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, y0 - y1).toFixed(1)}" fill="${bars[i].color}" stroke="var(--bg)" stroke-width="1"/>`);
        // 累计连线（非总计）
        if (i > 0 && !bars[i].isTotal && !bars[i - 1].isTotal) {
          const prevTop = yOf(bars[i - 1].top);
          const thisBase = yOf(bars[i].base);
          body.push(`<line x1="${(xC - bw).toFixed(1)}" y1="${prevTop.toFixed(1)}" x2="${xC.toFixed(1)}" y2="${thisBase.toFixed(1)}" stroke="var(--rule)" stroke-dasharray="2 2" stroke-width="1"/>`);
        }
        // 标签
        const label = bars[i].isTotal ? "总计" : (cats[i] || "");
        body.push(`<text x="${xC.toFixed(1)}" y="${H - mB + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(label.length > 8 ? label.slice(0, 7) + "…" : label)}</text>`);
        // 数值
        body.push(`<text x="${xC.toFixed(1)}" y="${(y1 - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink)">${fmtChartNum(bars[i].v)}</text>`);
      }
      // 图例
      let ly = mT + 4;
      [["增长", WCHANGE], ["减少", WDECREASE], ["总计", WTOTAL]].forEach(([name, col]) => {
        body.push(`<rect x="${W - 120}" y="${ly}" width="12" height="12" rx="2" fill="${col}"/>`);
        body.push(`<text x="${W - 102}" y="${ly + 10}" font-size="11" fill="var(--ink)">${name}</text>`);
        ly += 18;
      });
      body.push(`</svg>`);
      return body.join("");
    }
    /* ---- 组合图：柱 + 线叠加（第1系列柱，第2系列线） ---- */
    function comboSVG(cats, series, spec) {
      const W = 560, H = 320, mL = 46, mR = 16, mT = 16, mB = 46;
      const body = [`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" class="chart-svg-el">`];
      if (series.length < 2) { body.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="var(--muted)">组合图需要至少两个系列（一个柱 + 一个线）</text></svg>`); return body.join(""); }
      // 共用 Y 轴
      let maxV = 0, minV = 0;
      series.forEach(s => s.values.forEach(v => { if (v > maxV) maxV = v; if (v < minV) minV = v; }));
      if (maxV === minV) maxV = minV + 1;
      if (minV > 0) minV = 0;
      const { g, yOf, step } = axesSVG(W, H, mL, mR, mT, mB, maxV, minV, cats);
      body.push(g);
      const barSeries = series[0], lineSeries = series.slice(1);
      const bw = Math.min(34, step * 0.6 / Math.max(lineSeries.length, 1));
      // 第1系列画柱
      for (let i = 0; i < cats.length; i++) {
        const xC = mL + step * (i + 0.5);
        const v = barSeries.values[i];
        const y0 = yOf(0), y1 = yOf(v);
        body.push(`<rect x="${(xC - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(y0 - y1).toFixed(1)}" fill="${CHART_COLORS[0]}" fill-opacity="0.85" stroke="var(--bg)" stroke-width="1"/>`);
      }
      // 剩余系列画线
      lineSeries.forEach((s, idx) => {
        const color = CHART_COLORS[(idx + 1) % CHART_COLORS.length];
        let path = "";
        for (let i = 0; i < cats.length; i++) {
          const xC = mL + step * (i + 0.5);
          const yC = yOf(s.values[i]);
          path += (path ? " L " : "M ") + xC.toFixed(1) + " " + yC.toFixed(1);
        }
        body.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>`);
        for (let i = 0; i < cats.length; i++) {
          const xC = mL + step * (i + 0.5);
          const yC = yOf(s.values[i]);
          body.push(`<circle cx="${xC.toFixed(1)}" cy="${yC.toFixed(1)}" r="4" fill="${color}" stroke="var(--bg)" stroke-width="1.5"/>`);
        }
      });
      // 图例
      body.push(legendSVG(series, W - 140, mT + 2));
      body.push(`</svg>`);
      return body.join("");
    }
    function renderCharts() {
      const cont = wrap.querySelector(".sheet-charts"); if (!cont) return;
      const charts = data.charts || [];
      cont.innerHTML = "";
      if (!charts.length) { cont.hidden = true; return; }
      cont.hidden = false;
      charts.forEach(spec => {
        const card = document.createElement("div"); card.className = "chart-card";
        const head = document.createElement("div"); head.className = "chart-head";
        const title = document.createElement("span"); title.className = "chart-title"; title.textContent = spec.title || (chartTypeName(spec.type) + " · " + spec.range);
        const rm = document.createElement("button"); rm.className = "chart-close"; rm.type = "button"; rm.textContent = "×"; rm.title = "删除图表";
        rm.addEventListener("click", () => { data.charts = (data.charts || []).filter(c => c.id !== spec.id); ctx.markDirty(); renderCharts(); });
        head.appendChild(title); head.appendChild(rm);
        const holder = document.createElement("div"); holder.className = "chart-svg"; holder.innerHTML = buildChartSVG(spec);
        card.appendChild(head); card.appendChild(holder); cont.appendChild(card);
      });
    }
    function addChart(type) {
      const rg = rangeRect();
      if (!rg) { OS.toast("请先选中要绘图的数据区域", "warn"); return; }
      const { series } = extractChartData(rg);
      const anyNum = series.some(s => s.values.some(v => v !== 0));
      if (!anyNum) { OS.toast("选区中没有可绘制的数值", "warn"); return; }
      data.charts = data.charts || [];
      const seq = (data._chartSeq || 0) + 1; data._chartSeq = seq;
      const rangeStr = FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2;
      const id = "ch" + seq;
      data.charts.push({ id, type, range: rangeStr, title: chartTypeName(type) + " · " + rangeStr });
      ctx.markDirty(); renderCharts();
      OS.toast("已插入" + chartTypeName(type), "ok");
    }

    /* ---------- 选区 AI 浮层（复用共享工厂 ai-selbar.js） ---------- */
    function activeCellRange() {
      const td = table.querySelector('td[contenteditable="true"]');
      if (!td) return null;
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!td.contains(r.commonAncestorContainer)) return null;
      const text = r.toString();
      if (!text.trim()) return null;
      return { td, range: r };
    }
    const ssSelbar = OS.AI.createSelToolbar({
      container: wrap,
      features: { replace: true, insert: false, assistant: true },
      getSelection() {
        const a = activeCellRange();
        if (!a) return null;
        const ref = a.td.dataset.ref;
        return {
          text: a.range.toString(),
          rect: OS.AI.safeRect(a.range),
          replace(out) {
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(a.range.cloneRange());
            try { document.execCommand("delete", false, null); document.execCommand("insertText", false, out); } catch (e) {}
            commit(ref, a.td.textContent.trim());
          }
        };
      },
      onApplied() {}
    });

    /* ---------- AI 浮动工具面板（spreadsheet 专属：自然语言→公式） ---------- */
    (function initSheetAiTools() {
      const panel = document.createElement("div");
      panel.className = "sheet-ai-panel";
      panel.innerHTML = `
        <div class="sheet-ai-head">🤖 AI 公式
          <button class="sheet-ai-close" title="收起">▾</button>
        </div>
        <div class="sheet-ai-body">
          <input class="sheet-ai-input" placeholder="输入自然语言，如：求 A 列总和" />
          <div class="sheet-ai-suggests">
            <button class="sheet-ai-sug" title="=SUM(A1:A10)">求 A 列总和</button>
            <button class="sheet-ai-sug" title="=AVERAGE(A1:A10)">求平均值</button>
            <button class="sheet-ai-sug" title="=RANK(A1, A1:A10)">排名</button>
            <button class="sheet-ai-sug" title="=IF(条件, 真值, 假值)">条件判断</button>
          </div>
          <button class="sheet-ai-gen">✨ 生成公式</button>
        </div>
      `;
      panel.style.cssText = "position:absolute;top:8px;right:8px;z-index:20;background:var(--bg2,#fff);border:1px solid var(--rule,#ddd);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:13px;max-width:220px;";
      panel.querySelector(".sheet-ai-head").style.cssText = "padding:8px 12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--rule,#eee);";
      panel.querySelector(".sheet-ai-close").style.cssText = "background:none;border:none;cursor:pointer;font-size:14px;padding:0 4px;";
      panel.querySelector(".sheet-ai-body").style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px;";
      const input = panel.querySelector(".sheet-ai-input");
      input.style.cssText = "padding:6px 10px;border:1px solid var(--rule,#ddd);border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;";
      const sugDiv = panel.querySelector(".sheet-ai-suggests");
      sugDiv.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
      panel.querySelectorAll(".sheet-ai-sug").forEach(b => {
        b.style.cssText = "padding:3px 8px;border:1px solid var(--rule,#ddd);background:transparent;border-radius:12px;cursor:pointer;font-size:11px;color:var(--muted,#666);";
        b.onclick = () => { input.value = b.textContent; };
      });
      const genBtn = panel.querySelector(".sheet-ai-gen");
      genBtn.style.cssText = "padding:8px;background:var(--accent,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;";
      wrap.appendChild(panel);

      // 收起/展开（默认收起）
      let collapsed = true;
      panel.querySelector(".sheet-ai-body").style.display = "none";
      panel.querySelector(".sheet-ai-close").textContent = "▴";
      panel.querySelector(".sheet-ai-close").onclick = () => {
        collapsed = !collapsed;
        panel.querySelector(".sheet-ai-body").style.display = collapsed ? "none" : "flex";
        panel.querySelector(".sheet-ai-close").textContent = collapsed ? "▴" : "▾";
      };

      // 生成公式
      function doGen() {
        const desc = input.value.trim();
        if (!desc) { OS.toast("请输入描述", "warn"); return; }
        if (!OS.AI || !OS.AI.local || !OS.AI.local.toTableFormula) { OS.toast("AI 引擎未就绪", "err"); return; }
        const formula = OS.AI.local.toTableFormula(desc);
        // 写入当前选中单元格
        const curTd = table.querySelector('td[contenteditable="true"]');
        if (curTd) {
          curTd.textContent = formula;
          const ref = curTd.dataset.ref;
          commit(ref, formula);
          paint();
          OS.toast(`已生成公式：${formula}`, "ok");
        } else {
          OS.toast("请先选中一个单元格", "warn");
        }
      }
      genBtn.onclick = doGen;
      input.addEventListener("keydown", e => { if (e.key === "Enter") doGen(); });
    })();

    /* ---------------- 多工作表 + 冻结窗格 ---------------- */
    function bindAliases() {
      const sh = data.sheets[data.activeSheet];
      data.cells = sh.cells; data.styles = sh.styles; data.charts = sh.charts;
      data.condFormats = sh.condFormats; data.filters = sh.filters;
      data.merge = sh.merge; data.validations = sh.validations;
      data.rows = sh.rows || 100; data.cols = sh.cols || 16;
      data.color = sh.color || null;
    }

    /* ---------------- 冻结窗格 ---------------- */
    function applyFreeze() {
      const fr = (data.freeze && data.freeze.row) || 0;
      const fc = (data.freeze && data.freeze.col) || 0;
      table.querySelectorAll("tr.frozen-row").forEach(tr => tr.classList.remove("frozen-row"));
      table.querySelectorAll("td.frozen-col, td.frozen-corner").forEach(td => {
        td.classList.remove("frozen-col", "frozen-corner");
        td.style.top = ""; td.style.left = "";
      });
      if (fr > 0 || fc > 0) {
        const rowH = 26, colW = 96, rowHeadW = 44;
        const allTrs = table.querySelectorAll("tr");
        for (let i = 0; i <= fr && i < allTrs.length; i++) {
          allTrs[i].classList.add("frozen-row");
          const top = i * rowH;
          allTrs[i].querySelectorAll("th,td").forEach(el => { el.style.top = top + "px"; });
        }
        allTrs.forEach((tr, tri) => {
          const cells = tr.querySelectorAll("th,td");
          for (let j = 0; j <= fc && j < cells.length; j++) {
            const el = cells[j];
            const left = j === 0 ? 0 : rowHeadW + (j - 1) * colW;
            if (tri <= fr) {
              el.classList.add("frozen-corner");
              el.style.left = left + "px";
              el.style.top = (tri * rowH) + "px";
            } else {
              el.classList.add("frozen-col");
              el.style.left = left + "px";
            }
          }
        });
      }
    }
    function setFreeze(row, col) {
      snapshot();
      data.freeze = { row: Math.max(0, row | 0), col: Math.max(0, col | 0) };
      applyFreeze();
      ctx.markDirty();
      const status = (data.freeze.row === 0 && data.freeze.col === 0) ? "（已取消冻结）" : `（行=${data.freeze.row} 列=${data.freeze.col}）`;
      OS.toast("冻结窗格已设置 " + status, "ok");
    }
    function openFreezeMenu() {
      const pr = FE.parseRef(selected);
      const items = [
        "冻结首行（1 行数据 + 表头）",
        "冻结首列（1 列数据 + 行标头）",
        "冻结首行和首列",
        "冻结到当前单元格上方和左侧" + (pr ? `（${selected} → row=${pr.r - 1} col=${pr.c - 1}）` : ""),
        "取消冻结窗格"
      ];
      const choice = prompt("冻结窗格\n\n输入数字（1-5）：\n" + items.map((t, i) => (i + 1) + ". " + t).join("\n"), "1");
      const n = parseInt(choice, 10);
      if (n === 1) setFreeze(1, 0);
      else if (n === 2) setFreeze(0, 1);
      else if (n === 3) setFreeze(1, 1);
      else if (n === 4 && pr) setFreeze(pr.r - 1, pr.c - 1);
      else if (n === 5) setFreeze(0, 0);
    }

    /* ---------------- 分类汇总 + 分级折叠 ---------------- */
    function openSubtotalModal() {
      const m = openModal("分类汇总");
      m.body.style.minWidth = "460px";
      const hint = h(`<div style="margin-bottom:8px;color:#666;font-size:12px;">
        按某列分组 → 每组末尾插入小计行（SUM/COUNT/AVG）→ 自动加 ± 折叠。<br>
        <strong>重要</strong>：请先按分组列排序（数据 → 排序），相同值才会分到同一组！
      </div>`);
      const groupColRow = h(`<label class="cf-row"><span>分类字段（分组列）</span><input class="st-col" style="width:100px;" value="A"></label>`);
      const funcRow = h(`<label class="cf-row"><span>汇总方式</span><select class="st-func" style="width:120px;"><option value="SUM">求和 SUM</option><option value="COUNT">计数 COUNT</option><option value="AVG">平均值 AVERAGE</option><option value="MIN">最小值 MIN</option><option value="MAX">最大值 MAX</option></select></label>`);
      const sumColsRow = h(`<label class="cf-row"><span>选定汇总列（要算小计的列，逗号分隔）</span><input class="st-sumcols" style="width:180px;" value="B,C"></label>`);
      const headerRow = h(`<label class="cf-row"><input type="checkbox" class="st-header" checked> 首行有标题</label>`);
      m.body.appendChild(hint); m.body.appendChild(groupColRow); m.body.appendChild(funcRow); m.body.appendChild(sumColsRow); m.body.appendChild(headerRow);
      m.ok.addEventListener("click", () => {
        const groupCol = (groupColRow.querySelector(".st-col").value || "A").trim().toUpperCase();
        const func = funcRow.querySelector(".st-func").value;
        const sumCols = sumColsRow.querySelector(".st-sumcols").value.trim().toUpperCase().split(/[,，;\s]+/).filter(Boolean);
        const hasHeader = headerRow.querySelector(".st-header").checked;
        if (!FE.parseRef(groupCol + "1")) { OS.toast("分类列地址无效", "warn"); return; }
        if (!sumCols.length) { OS.toast("请至少选一个汇总列", "warn"); return; }
        const res = buildSubtotal(groupCol, func, sumCols, hasHeader);
        if (!res.ok) { OS.toast(res.msg, "err"); return; }
        OS.toast(`分类汇总完成：${res.groups} 组 + 总计行 ✅`, "ok");
        m.close();
      });
    }
    function buildSubtotal(groupCol, func, sumCols, hasHeader) {
      const startRow = hasHeader ? 2 : 1;
      const allData = [];
      for (let r = startRow; r <= ROWS; r++) {
        const cells = {}; let hasAny = false;
        for (let c = 1; c <= COLS; c++) {
          const ref = FE.idxToCol(c) + r;
          const v = data.cells[ref];
          if (v !== undefined && v !== null && v !== "") { cells[ref] = v; hasAny = true; }
        }
        if (hasAny) allData.push({ row: r, cells });
      }
      if (!allData.length) return { ok: false, msg: "没有数据可汇总" };
      const groups = []; let currentGroup = null;
      for (const row of allData) {
        const keyRef = groupCol + row.row;
        const raw = data.cells[keyRef];
        const keyVal = raw ? (raw.v !== undefined ? raw.v : (raw.f || "")) : "";
        const keyStr = String(keyVal ?? "");
        if (!currentGroup || currentGroup.key !== keyStr) {
          currentGroup = { key: keyStr, rows: [row.row] };
          groups.push(currentGroup);
        } else currentGroup.rows.push(row.row);
      }
      const newCells = {};
      if (hasHeader) {
        for (let c = 1; c <= COLS; c++) {
          const ref = FE.idxToCol(c) + "1";
          if (data.cells[ref]) newCells[ref] = data.cells[ref];
        }
      }
      let outRow = hasHeader ? 2 : 1;
      const subtotalRows = []; const groupIntervals = [];
      for (const g of groups) {
        const gStart = outRow;
        for (const r of g.rows) {
          for (let c = 1; c <= COLS; c++) {
            const oldRef = FE.idxToCol(c) + r;
            const v = data.cells[oldRef];
            if (v !== undefined) newCells[FE.idxToCol(c) + outRow] = v;
          }
          outRow++;
        }
        const subtotalRef = groupCol + outRow;
        newCells[subtotalRef] = { v: g.key + " 小计", style: { bold: true } };
        for (const sc of sumCols) {
          const colIdx = FE.colToIdx(sc); if (!colIdx) continue;
          const vals = [];
          for (const r of g.rows) {
            const v = data.cells[FE.idxToCol(colIdx) + r];
            const n = v && v.v !== undefined ? Number(v.v) : NaN;
            if (!isNaN(n)) vals.push(n);
          }
          let result = "";
          if (vals.length) {
            if (func === "SUM") result = vals.reduce((a, b) => a + b, 0);
            else if (func === "COUNT") result = vals.length;
            else if (func === "AVG") result = vals.reduce((a, b) => a + b, 0) / vals.length;
            else if (func === "MIN") result = Math.min(...vals);
            else if (func === "MAX") result = Math.max(...vals);
          }
          newCells[FE.idxToCol(colIdx) + outRow] = { v: result, style: { bold: true } };
        }
        subtotalRows.push(outRow);
        groupIntervals.push({ startRow: gStart, endRow: outRow - 1, groupKey: g.key });
        outRow++;
      }
      const totalRow = outRow;
      const totalRef = groupCol + outRow;
      newCells[totalRef] = { v: "总计", style: { bold: true, fontSize: 12 } };
      for (const sc of sumCols) {
        const colIdx = FE.colToIdx(sc); if (!colIdx) continue;
        const vals = [];
        for (const row of allData) {
          const v = data.cells[FE.idxToCol(colIdx) + row.row];
          const n = v && v.v !== undefined ? Number(v.v) : NaN;
          if (!isNaN(n)) vals.push(n);
        }
        let result = "";
        if (vals.length) {
          if (func === "SUM") result = vals.reduce((a, b) => a + b, 0);
          else if (func === "COUNT") result = vals.length;
          else if (func === "AVG") result = vals.reduce((a, b) => a + b, 0) / vals.length;
          else if (func === "MIN") result = Math.min(...vals);
          else if (func === "MAX") result = Math.max(...vals);
        }
        newCells[FE.idxToCol(colIdx) + outRow] = { v: result, style: { bold: true, fontSize: 12 } };
      }
      outRow++;
      snapshot();
      data.cells = newCells;
      data.subtotal = { func, groups: groupIntervals, subtotalRows, totalRow, collapsed: new Set() };
      renderSubtotalOutline();
      recompute(); render();
      return { ok: true, groups: groups.length };
    }
    function renderSubtotalOutline() {
      table.querySelectorAll("tr[data-outline-level] th.rowhead").forEach(th => {
        th.textContent = th.dataset.origNum || th.textContent; delete th.dataset.origNum;
      });
      if (!data.subtotal) return;
      const { groups, subtotalRows, totalRow, collapsed } = data.subtotal;
      groups.forEach((g, gi) => {
        for (let r = g.startRow; r <= g.endRow; r++) {
          const tr = table.querySelector(`tr[data-row="${r}"]`); if (!tr) continue;
          tr.dataset.outlineLevel = "1";
          const rh = tr.querySelector("th.rowhead");
          if (rh && !rh.dataset.origNum) rh.dataset.origNum = rh.textContent;
          const isCollapsed = collapsed.has(gi);
          rh.textContent = (isCollapsed ? "+" : "−") + " " + (rh.dataset.origNum || rh.textContent);
          tr.style.display = isCollapsed ? "none" : "";
        }
      });
      subtotalRows.forEach(r => {
        const tr = table.querySelector(`tr[data-row="${r}"]`); if (!tr) return;
        tr.dataset.outlineLevel = "2";
      });
      const totalTr = table.querySelector(`tr[data-row="${totalRow}"]`);
      if (totalTr) totalTr.dataset.outlineLevel = "3";
      table.querySelectorAll("th.rowhead").forEach(th => {
        th.style.cursor = "pointer";
        th.onclick = () => {
          const tr = th.closest("tr");
          const rowNum = parseInt(tr.dataset.row, 10);
          const gIdx = groups.findIndex(g => g.endRow >= rowNum && g.startRow <= rowNum);
          if (gIdx >= 0) {
            if (collapsed.has(gIdx)) collapsed.delete(gIdx); else collapsed.add(gIdx);
            renderSubtotalOutline();
          }
        };
      });
    }

    /* ---------------- 工作表分组 / 工作组 ---------------- */
    function setSheetColor(idx, color) {
      const sh = data.sheets[idx];
      snapshot(); sh.color = color || null; renderSheetTabs();
    }
    function toggleSheetGroup(idx) {
      if (!data.group) data.group = new Set([data.activeSheet]);
      if (data.group.has(idx)) { if (data.group.size > 1) data.group.delete(idx); }
      else data.group.add(idx);
      if (data.group.size <= 1) data.group = null;
      renderSheetTabs();
      const names = data.group ? [...data.group].map(i => data.sheets[i].name).join(" + ") : "已取消工作组";
      OS.toast("工作组：" + names, "ok");
    }
    function syncWriteToGroup(ref, value) {
      if (!data.group || !data.group.has(data.activeSheet)) return;
      data.group.forEach(gi => {
        if (gi === data.activeSheet) return;
        const sh = data.sheets[gi]; if (!sh.cells) sh.cells = {};
        sh.cells[ref] = value;
      });
    }

    const SHEET_COLORS = ["", "#e0533d", "#ed7d31", "#f2c94c", "#27ae60", "#2f6fed", "#8e44ad", "#e91e63"];
    function renderSheetTabs() {
      const list = wrap.querySelector(".sheet-tabs-list");
      if (!list) return;
      list.innerHTML = "";
      data.sheets.forEach((sh, i) => {
        const b = document.createElement("button");
        b.className = "sheet-tab" + (i === data.activeSheet ? " on" : "");
        b.setAttribute("data-sheet", i);
        // 工作组高亮
        if (data.group && data.group.has(i)) b.classList.add("in-group");
        // 彩色标签
        if (sh.color) b.style.borderBottom = `3px solid ${sh.color}`;
        const label = document.createElement("span");
        label.className = "sheet-tab-name"; label.textContent = sh.name;
        b.appendChild(label);
        const x = document.createElement("span");
        x.className = "sheet-tab-x"; x.textContent = "×";
        x.addEventListener("click", (e) => { e.stopPropagation(); if (window.confirm("删除工作表 “" + sh.name + "”？")) removeSheet(i); });
        b.appendChild(x);
        b.addEventListener("click", (e) => {
          if (e.ctrlKey || e.metaKey) { toggleSheetGroup(i); }
          else switchSheet(i);
        });
        b.addEventListener("dblclick", () => {
          const n = window.prompt("重命名工作表", sh.name); if (n != null && n.trim()) renameSheet(i, n.trim());
        });
        b.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const choice = prompt(`工作表 "${sh.name}" 菜单：\n\n1. 重命名\n2. 移动/复制\n3. 工作表标签颜色\n4. Ctrl+点击 = 切换工作组成员\n5. 删除\n\n输入数字：`, "3");
          const n = parseInt(choice, 10);
          if (n === 1) { const name = prompt("新名称：", sh.name); if (name) renameSheet(i, name); }
          else if (n === 3) {
            const c = prompt("标签颜色：\n输入颜色代码（如 red、#e0533d），或留空清除：", sh.color || "");
            if (c === null) return;
            setSheetColor(i, c.trim());
          } else if (n === 5) { if (confirm(`删除工作表 "${sh.name}"？`)) removeSheet(i); }
        });
        list.appendChild(b);
      });
    }
    function addSheet(name) {
      const n = data.sheets.length + 1;
      const sh = { name: name || ("Sheet" + n), rows: ROWS, cols: COLS, cells: {}, styles: {}, charts: [], condFormats: [], filters: [], merge: [], validations: [] };
      snapshot();
      data.sheets.push(sh);
      switchSheet(data.sheets.length - 1);
      return data.sheets.length - 1;
    }
    function switchSheet(idx) {
      if (idx < 0 || idx >= data.sheets.length) return;
      const old = data.sheets[data.activeSheet];
      old.cells = data.cells; old.styles = data.styles; old.charts = data.charts;
      old.condFormats = data.condFormats; old.filters = data.filters;
      old.merge = data.merge; old.validations = data.validations;
      // 工作组 / 标签颜色 / 冻结窗格 — 持久化到 sheet 自身
      old.group = data.group ? [...data.group] : null;
      old.freeze = data.freeze || null;
      old.tabColor = data.tabColor || null;
      data.activeSheet = idx;
      // 从新 sheet 恢复这些全局属性
      if (data.sheets[idx].group) { data.group = new Set(data.sheets[idx].group); }
      else data.group = null;
      data.freeze = data.sheets[idx].freeze || null;
      data.tabColor = data.sheets[idx].tabColor || null;
      bindAliases();
      buildGrid(); recompute(); renderCharts(); applyFreeze(); renderSheetTabs(); updateStatus();
      highlightBadges();
      ctx.markDirty();
    }
    function removeSheet(idx) {
      if (data.sheets.length <= 1) { if (OS.toast) OS.toast("至少保留一个工作表", "warn"); return false; }
      if (idx < 0 || idx >= data.sheets.length) return false;
      const old = data.sheets[data.activeSheet];
      old.cells = data.cells; old.styles = data.styles; old.charts = data.charts;
      old.condFormats = data.condFormats; old.filters = data.filters;
      old.merge = data.merge; old.validations = data.validations;
      old.group = data.group ? [...data.group] : null;
      old.freeze = data.freeze || null;
      old.tabColor = data.tabColor || null;
      snapshot();
      data.sheets.splice(idx, 1);
      // 工作组里如果有被删的 sheet，从所有成员的 group 里剔除
      data.sheets.forEach(sh => {
        if (sh.group) { sh.group = sh.group.filter(gi => gi !== idx); if (sh.group.length <= 1) sh.group = null; }
      });
      if (data.group) { data.group.delete(idx); if (data.group.size <= 1) data.group = null; }
      if (data.activeSheet >= data.sheets.length) data.activeSheet = data.sheets.length - 1;
      if (data.sheets[data.activeSheet].group) data.group = new Set(data.sheets[data.activeSheet].group);
      else data.group = null;
      bindAliases();
      buildGrid(); recompute(); renderCharts(); applyFreeze(); renderSheetTabs(); updateStatus();
      highlightBadges();
      ctx.markDirty();
      return true;
    }
    function renameSheet(idx, name) {
      if (data.sheets[idx]) { snapshot(); data.sheets[idx].name = name; renderSheetTabs(); ctx.markDirty(); }
    }
    function applyFreeze() {
      const f = data.freeze || { row: 0, col: 0 };
      table.querySelectorAll("td[data-ref], th.colhead, th.rowhead, th.corner").forEach(el => {
        el.style.position = ""; el.style.top = ""; el.style.left = ""; el.style.zIndex = ""; el.classList.remove("frozen");
      });
      const headerH = (function () { const h = table.querySelector("tr:first-child"); return h ? h.offsetHeight : 0; })();
      const rowheadW = (function () { const h = table.querySelector("th.rowhead"); return h ? h.offsetWidth : 0; })();
      if (f.row > 0) {
        let topPx = headerH;
        const rows = table.querySelectorAll("tr");
        for (let i = 1; i <= f.row && i < rows.length; i++) {
          const tr = rows[i];
          tr.querySelectorAll("td[data-ref]").forEach(td => { td.style.position = "sticky"; td.style.top = topPx + "px"; td.style.zIndex = "2"; td.classList.add("frozen"); });
          const rh = tr.querySelector("th.rowhead");
          if (rh) { rh.style.position = "sticky"; rh.style.top = topPx + "px"; rh.style.zIndex = "3"; rh.classList.add("frozen"); }
          topPx += tr.offsetHeight;
        }
      }
      if (f.col > 0) {
        let leftPx = rowheadW;
        table.querySelectorAll("td[data-ref]").forEach(td => {
          const pr = FE.parseRef(td.dataset.ref);
          if (pr && pr.col >= 1 && pr.col <= f.col) { td.style.position = "sticky"; td.style.left = leftPx + "px"; td.style.zIndex = "2"; td.classList.add("frozen"); }
        });
        table.querySelectorAll("th.colhead").forEach(th => { const c = +th.dataset.col; if (c >= 1 && c <= f.col) { th.style.position = "sticky"; th.style.left = leftPx + "px"; th.style.zIndex = "3"; th.classList.add("frozen"); } });
      }
      if (f.row > 0 && f.col > 0) {
        table.querySelectorAll("td[data-ref]").forEach(td => { if (td.style.top && td.style.left) td.style.zIndex = "4"; });
      }
    }
    function setFreeze(row, col) { snapshot(); data.freeze = { row: row | 0, col: col | 0 }; applyFreeze(); ctx.markDirty(); }
    function toggleFreeze(kind) {
      const f = data.freeze || { row: 0, col: 0 };
      if (kind === "row") setFreeze(f.row ? 0 : 1, f.col);
      else if (kind === "col") setFreeze(f.row, f.col ? 0 : 1);
      else setFreeze(f.row ? 0 : 1, f.col ? 0 : 1);
    }

    /* ---------------- 历史记录（撤销 / 重做） ---------------- */
    const undoStack = [], redoStack = [];
    function doSerialize() {
      const sh = data.sheets[data.activeSheet];
      sh.cells = data.cells; sh.styles = data.styles; sh.charts = data.charts;
      sh.condFormats = data.condFormats; sh.filters = data.filters;
      sh.merge = data.merge; sh.validations = data.validations;
      return data;
    }
    function snapshot() {
      try {
        undoStack.push(JSON.parse(JSON.stringify(doSerialize())));
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
      } catch (e) {}
    }
    function restore(snap) {
      data.activeSheet = snap.activeSheet || 0;
      data.freeze = snap.freeze || { row: 0, col: 0 };
      data.comments = snap.comments || [];
      data.sheets = JSON.parse(JSON.stringify(snap.sheets));
      bindAliases();
      buildGrid(); recompute(); renderCharts(); applyFreeze(); renderSheetTabs(); updateStatus();
      highlightBadges(); renderComments();
      ctx.markDirty();
    }
    function undo() {
      if (!undoStack.length) return false;
      redoStack.push(JSON.parse(JSON.stringify(doSerialize())));
      restore(undoStack.pop());
      return true;
    }
    function redo() {
      if (!redoStack.length) return false;
      undoStack.push(JSON.parse(JSON.stringify(doSerialize())));
      restore(redoStack.pop());
      return true;
    }
    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }

    /* ---------------- 合并单元格 ---------------- */
    function overlaps(a, b) {
      const ra = rangeRectFromStr(a), rb = rangeRectFromStr(b);
      if (!ra || !rb) return false;
      return !(ra.r2 < rb.r1 || rb.r2 < ra.r1 || ra.c2 < rb.c1 || rb.c2 < ra.c1);
    }
    function applyMerges() {
      table.querySelectorAll("td[data-ref]").forEach(td => {
        td.removeAttribute("colspan"); td.removeAttribute("rowspan");
        td.classList.remove("merged", "merged-center", "merged-hidden");
      });
      (data.merge || []).forEach(m => {
        const rg = rangeRectFromStr(m.range); if (!rg) return;
        const tl = table.querySelector(`td[data-ref="${FE.idxToCol(rg.c1)}${rg.r1}"]`);
        if (!tl) return;
        const cs = rg.c2 - rg.c1 + 1, rs = rg.r2 - rg.r1 + 1;
        if (cs > 1) tl.setAttribute("colspan", cs);
        if (rs > 1) tl.setAttribute("rowspan", rs);
        tl.classList.add("merged");
        if (m.type === "center") tl.classList.add("merged-center");
        for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
          if (r === rg.r1 && c === rg.c1) continue;
          const td = table.querySelector(`td[data-ref="${FE.idxToCol(c)}${r}"]`);
          if (td) td.classList.add("merged-hidden");
        }
      });
    }
    function mergeRangeStr() { const rg = rangeRect(); if (!rg) return "A1"; return FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2; }
    function mergeCells(rangeStr, type) {
      const rg = rangeRectFromStr(rangeStr); if (!rg) return false;
      snapshot();
      data.merge = (data.merge || []).filter(m => !overlaps(m.range, rangeStr));
      data.merge.push({ range: rangeStr.toUpperCase(), type: type || "merge" });
      applyMerges(); recompute(); ctx.markDirty();
      return true;
    }
    function unmerge(rangeStr) {
      const rg = rangeRectFromStr(rangeStr); if (!rg) return false;
      snapshot();
      const before = (data.merge || []).length;
      data.merge = (data.merge || []).filter(m => !overlaps(m.range, rangeStr));
      const changed = (data.merge || []).length !== before;
      if (changed) { applyMerges(); recompute(); ctx.markDirty(); }
      return changed;
    }
    function mergeSelection(type) { return mergeCells(mergeRangeStr(), type); }

    /* ---------------- 数据验证 ---------------- */
    function setValidation(rangeStr, cfg) {
      const rg = rangeRectFromStr(rangeStr); if (!rg) return false;
      snapshot();
      data.validations = data.validations || [];
      const i = data.validations.findIndex(v => v.range.toUpperCase() === rangeStr.toUpperCase());
      // 向后兼容：老 API type:"number" + min/max → 自动转成 decimal + between
      let rule = Object.assign({
        range: rangeStr.toUpperCase(), type: "list", allowBlank: true,
        operator: "between", formula1: null, formula2: null, showDropDown: true,
        errorAlert: { show: true, style: "stop", title: "", message: "" },
        inputMessage: { show: true, title: "", message: "" }
      }, cfg);
      if (rule.type === "number" && (rule.min != null || rule.max != null)) {
        rule.type = "decimal";
        rule.operator = "between";
        rule.formula1 = rule.min != null ? Number(rule.min) : null;
        rule.formula2 = rule.max != null ? Number(rule.max) : null;
        delete rule.min; delete rule.max;
      }
      if (i >= 0) data.validations[i] = rule; else data.validations.push(rule);
      ctx.markDirty();
      return true;
    }
    function removeValidation(rangeStr) {
      if (!data.validations || !data.validations.length) return false;
      snapshot();
      const before = data.validations.length;
      data.validations = data.validations.filter(v => v.range.toUpperCase() !== rangeStr.toUpperCase());
      const changed = data.validations.length !== before;
      if (changed) ctx.markDirty();
      return changed;
    }

    // OOXML type → 内部 type 映射
    const DV_TYPE_MAP = { whole: "whole", integer: "whole", decimal: "decimal", list: "list", date: "date", time: "time", textLength: "textLength", custom: "custom", formula: "custom" };
    const DV_OP_MAP = { between: "between", notBetween: "notBetween", equal: "equal", notEqual: "notEqual", greaterThan: "greaterThan", lessThan: "lessThan", greaterThanOrEqual: "greaterThanOrEqual", lessThanOrEqual: "lessThanOrEqual" };

    function _dvCheck(rule, rawVal) {
      const str = String(rawVal == null ? "" : rawVal);
      if (str === "") { if (rule.allowBlank === false) return { ok: false, msg: "不允许空白" }; return { ok: true }; }
      const t = rule.type;
      const op = rule.operator || "between";
      const f1 = rule.formula1;
      const f2 = rule.formula2;

      const fail = (msg) => ({ ok: false, msg: msg });
      const ok = () => ({ ok: true });

      if (t === "list") {
        const list = (rule.list || []).map(String);
        return list.indexOf(str) === -1 ? fail("必须是：" + list.join(" / ")) : ok();
      }

      if (t === "whole" || t === "decimal") {
        const num = Number(str);
        if (isNaN(num)) return fail(t === "whole" ? "必须是整数" : "必须是数字");
        if (t === "whole" && !Number.isInteger(num)) return fail("必须是整数");
        const a = Number(f1), b = Number(f2);
        switch (op) {
          case "between":     return num >= a && num <= b ? ok() : fail("必须在 " + a + " 到 " + b + " 之间");
          case "notBetween":  return num < a || num > b ? ok() : fail("不能在 " + a + " 到 " + b + " 之间");
          case "equal":       return num === a ? ok() : fail("必须等于 " + a);
          case "notEqual":    return num !== a ? ok() : fail("不能等于 " + a);
          case "greaterThan": return num > a ? ok() : fail("必须大于 " + a);
          case "lessThan":    return num < a ? ok() : fail("必须小于 " + a);
          case "greaterThanOrEqual": return num >= a ? ok() : fail("必须大于等于 " + a);
          case "lessThanOrEqual":    return num <= a ? ok() : fail("必须小于等于 " + a);
        }
      }

      if (t === "date" || t === "time") {
        const d = new Date(str); if (isNaN(d.getTime())) return fail(t === "date" ? "不是有效日期" : "不是有效时间");
        const a = new Date(f1), b = new Date(f2);
        const num = d.getTime(); const na = a.getTime(), nb = b.getTime();
        switch (op) {
          case "between":     return num >= na && num <= nb ? ok() : fail("必须在指定区间内");
          case "notBetween":  return num < na || num > nb ? ok() : fail("不能在指定区间内");
          case "equal":       return num === na ? ok() : fail("必须等于指定值");
          case "notEqual":    return num !== na ? ok() : fail("不能等于指定值");
          case "greaterThan": return num > na ? ok() : fail("必须晚于指定值");
          case "lessThan":    return num < na ? ok() : fail("必须早于指定值");
          case "greaterThanOrEqual": return num >= na ? ok() : fail("必须晚于或等于指定值");
          case "lessThanOrEqual":    return num <= na ? ok() : fail("必须早于或等于指定值");
        }
      }

      if (t === "textLength") {
        const len = str.length;
        const a = Number(f1), b = Number(f2);
        switch (op) {
          case "between":     return len >= a && len <= b ? ok() : fail("长度必须在 " + a + " 到 " + b + " 之间");
          case "notBetween":  return len < a || len > b ? ok() : fail("长度不能在 " + a + " 到 " + b + " 之间");
          case "equal":       return len === a ? ok() : fail("长度必须等于 " + a);
          case "notEqual":    return len !== a ? ok() : fail("长度不能等于 " + a);
          case "greaterThan": return len > a ? ok() : fail("长度必须大于 " + a);
          case "lessThan":    return len < a ? ok() : fail("长度必须小于 " + a);
          case "greaterThanOrEqual": return len >= a ? ok() : fail("长度必须大于等于 " + a);
          case "lessThanOrEqual":    return len <= a ? ok() : fail("长度必须小于等于 " + a);
        }
      }

      if (t === "custom") {
        try {
          const expr = String(f1 || "").trim();
          if (!expr) return ok();
          const result = FE.run("=" + expr, {});
          const pass = result !== false && result !== 0 && String(result).toLowerCase() !== "false";
          return pass ? ok() : fail("自定义公式未通过");
        } catch (e) { return ok(); }
      }

      return ok();
    }

    function validateCell(ref, value) {
      const v = data.validations || [];
      const rg = FE.parseRef(ref); if (!rg) return { ok: true };
      for (let i = 0; i < v.length; i++) {
        const rule = v[i];
        const rr = rangeRectFromStr(rule.range); if (!rr) continue;
        if (rg.row < rr.r1 || rg.row > rr.r2 || rg.col < rr.c1 || rg.col > rr.c2) continue;
        return _dvCheck(rule, value);
      }
      return { ok: true };
    }

    function openValidationModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中要验证的区域", "warn"); return; }
      const m = openModal("数据验证");
      m.el.style.width = "520px";

      const h = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; };

      // Tab 切换
      const tabBar = h(`<div class="dv-tabs"><button class="dv-tab active">设置</button><button class="dv-tab">输入信息</button><button class="dv-tab">出错警告</button></div>`);
      const tabContainers = {};

      // ============ Tab 1: 设置 ============
      const setTab = h(`
        <div class="dv-tab-panel">
          <label class="cf-row"><span>允许</span>
            <select class="dv-type">
              <option value="list">序列（下拉列表）</option>
              <option value="whole">整数</option>
              <option value="decimal">小数</option>
              <option value="date">日期</option>
              <option value="time">时间</option>
              <option value="textLength">文本长度</option>
              <option value="custom">自定义（公式）</option>
            </select>
          </label>
          <label class="cf-row dv-op" hidden><span>数据</span>
            <select class="dv-operator">
              <option value="between">介于</option>
              <option value="notBetween">未介于</option>
              <option value="equal">等于</option>
              <option value="notEqual">不等于</option>
              <option value="greaterThan">大于</option>
              <option value="lessThan">小于</option>
              <option value="greaterThanOrEqual">大于等于</option>
              <option value="lessThanOrEqual">小于等于</option>
            </select>
          </label>
          <label class="cf-row dv-list"><span>列表项</span><input class="dv-list-v" placeholder="用英文逗号分隔，如 优,良,中"></label>
          <label class="cf-row dv-f1" hidden><span>最小值 / 公式</span><input class="dv-f1-v" placeholder="between 填最小值，greaterThan 填阈值，custom 填公式如 A1>0"></label>
          <label class="cf-row dv-f2" hidden><span>最大值</span><input class="dv-f2-v" placeholder="仅 between / notBetween 需要" hidden></label>
          <label class="cf-row"><span>忽略空值</span><input type="checkbox" class="dv-blank" checked></label>
          <label class="cf-row dv-dd" hidden><span>提供下拉箭头</span><input type="checkbox" class="dv-dropdown" checked></label>
        </div>`);

      const typeSel = setTab.querySelector(".dv-type");
      const opRow = setTab.querySelector(".dv-op");
      const opSel = setTab.querySelector(".dv-operator");
      const listRow = setTab.querySelector(".dv-list");
      const f1Row = setTab.querySelector(".dv-f1");
      const f1Inp = setTab.querySelector(".dv-f1-v");
      const f2Row = setTab.querySelector(".dv-f2");
      const f2Inp = setTab.querySelector(".dv-f2-v");
      const blankCk = setTab.querySelector(".dv-blank");
      const ddCk = setTab.querySelector(".dv-dropdown");

      function refreshFields() {
        const t = typeSel.value;
        const needsOp = ["whole","decimal","date","time","textLength"].includes(t);
        const isList = t === "list";
        const isCustom = t === "custom";
        opRow.hidden = !needsOp;
        listRow.hidden = !isList;
        ddCk.closest(".cf-row").hidden = !isList;
        f1Row.hidden = isList;
        f2Row.hidden = isList || isCustom;
        f1Inp.placeholder = isCustom ? "输入公式，如 A1>100" : (t === "textLength" ? "最小长度" : "最小值");
        const op = opSel.value;
        const needsF2 = needsOp && (op === "between" || op === "notBetween");
        f2Row.hidden = !needsF2;
      }
      typeSel.addEventListener("change", refreshFields);
      opSel.addEventListener("change", refreshFields);

      // ============ Tab 2: 输入信息 ============
      const inputTab = h(`
        <div class="dv-tab-panel" hidden>
          <label class="cf-row"><span>选中单元格时显示提示</span><input type="checkbox" class="dv-input-show"></label>
          <label class="cf-row"><span>标题</span><input class="dv-input-title" maxlength="32"></label>
          <label class="cf-row"><span>提示信息</span><textarea class="dv-input-msg" rows="4" maxlength="255"></textarea></label>
        </div>`);
      const inputShow = inputTab.querySelector(".dv-input-show");
      const inputTitle = inputTab.querySelector(".dv-input-title");
      const inputMsg = inputTab.querySelector(".dv-input-msg");

      // ============ Tab 3: 出错警告 ============
      const errTab = h(`
        <div class="dv-tab-panel" hidden>
          <label class="cf-row"><span>输入无效数据时显示警告</span><input type="checkbox" class="dv-err-show" checked></label>
          <label class="cf-row"><span>样式</span>
            <select class="dv-err-style">
              <option value="stop">停止（禁止输入）</option>
              <option value="warning">警告</option>
              <option value="information">提示</option>
            </select>
          </label>
          <label class="cf-row"><span>标题</span><input class="dv-err-title" maxlength="32"></label>
          <label class="cf-row"><span>错误信息</span><textarea class="dv-err-msg" rows="4" maxlength="255"></textarea></label>
        </div>`);
      const errShow = errTab.querySelector(".dv-err-show");
      const errStyle = errTab.querySelector(".dv-err-style");
      const errTitle = errTab.querySelector(".dv-err-title");
      const errMsg = errTab.querySelector(".dv-err-msg");

      // Tab 切换逻辑
      const panels = [setTab, inputTab, errTab];
      tabBar.querySelectorAll(".dv-tab").forEach((btn, i) => {
        btn.addEventListener("click", () => {
          tabBar.querySelectorAll(".dv-tab").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          panels.forEach((p, j) => p.hidden = j !== i);
        });
      });

      m.body.appendChild(tabBar);
      m.body.appendChild(setTab);
      m.body.appendChild(inputTab);
      m.body.appendChild(errTab);

      m.ok.addEventListener("click", () => {
        const t = typeSel.value;
        const rule = { type: t, allowBlank: blankCk.checked, showDropDown: ddCk.checked };
        if (t === "list") {
          const items = listRow.querySelector(".dv-list-v").value.split(",").map(s => s.trim()).filter(Boolean);
          if (!items.length) { OS.toast("请填写列表项", "warn"); return; }
          rule.list = items;
          rule.formula1 = '"' + items.join(",") + '"'; // OOXML list 用逗号包裹双引号
        } else if (t === "custom") {
          rule.formula1 = f1Inp.value.trim();
        } else {
          rule.operator = opSel.value;
          rule.formula1 = f1Inp.value === "" ? null : (t === "whole" || t === "decimal" ? Number(f1Inp.value) : f1Inp.value);
          if (!f2Row.hidden && f2Inp.value !== "") {
            rule.formula2 = (t === "whole" || t === "decimal") ? Number(f2Inp.value) : f2Inp.value;
          }
        }
        rule.errorAlert = {
          show: errShow.checked,
          style: errStyle.value,
          title: errTitle.value.trim(),
          message: errMsg.value.trim()
        };
        rule.inputMessage = {
          show: inputShow.checked,
          title: inputTitle.value.trim(),
          message: inputMsg.value.trim()
        };
        setValidation(mergeRangeStr(), rule);
        OS.toast("已设置数据验证", "ok"); m.close();
      });
      refreshFields();
    }

    return {
      serialize: doSerialize,
      commit,
      exportAs,
      focus() {},
      ribbon,
      pdfFileAPI: { download: downloadPdfFile, buildSheetPageHtml, sheetUsedRange },
      selectCell,
      gotoCell,
      search,
      replaceAll: replaceAllText,
      openFindPanel,
      // 批注 API
      addComment,
      resolveAll,
      navComment,
      togglePanel,
      toggleCommentPanel: togglePanel,
      comments: () => (data.comments || []).slice(),
      // 多工作表 API
      sheets: () => data.sheets.map(s => ({ name: s.name, cells: s.cells, charts: s.charts })),
      activeSheet: () => data.activeSheet,
      sheetNames: () => data.sheets.map(s => s.name),
      addSheet(name) { return addSheet(name); },
      removeSheet(idx) { return removeSheet(idx); },
      renameSheet(idx, name) { renameSheet(idx, name); },
      switchSheet(idx) { switchSheet(idx); },
      // 冻结窗格 API
      freeze: () => data.freeze,
      setFreeze(row, col) { setFreeze(row, col); },
      applyFreeze,
      extendTo(ref) { selected = ref; paint(); updateStatus(); },
      fillSelection,
      status() { return { sum: stSum.textContent, sel: stSel.textContent, info: stInfo.textContent, anchor, active: selected }; },
      adjustFormula: (f, dr, dc) => FE.adjustFormula(f, dr, dc),
      addChart,
      renderCharts,
      charts: () => (data.charts || []).slice(),
      extractChartData: (rg) => extractChartData(rg),
      chartSVG: (id) => { const c = (data.charts || []).find(x => x.id === id); return c ? buildChartSVG(c) : ""; },
      addCondFormat(rule) { data.condFormats = data.condFormats || []; const i = data.condFormats.findIndex(r => r.id === rule.id); if (i >= 0) data.condFormats[i] = rule; else data.condFormats.push(rule); recompute(); },
      removeCondFormat(id) { data.condFormats = (data.condFormats || []).filter(r => r.id !== id); recompute(); },
      condFormats() { return (data.condFormats || []).slice(); },
      // 排序与筛选 API
      sortRange,
      applyFilter,
      clearFilters,
      filters() { return (data.filters || []).slice(); },
      visibleRows() { const v = computeVisibleRows(); return v ? v.slice() : null; },
      applyCondFormat,
      computeCF,
      cfStyleOf(ref) { return computeCF()[ref] || null; },
      openRuleModal, openManager,
      // 合并单元格 API
      mergeCells,
      unmerge,
      mergeSelection,
      applyMerges,
      merges: () => (data.merge || []).slice(),
      // 数据验证 API
      setValidation,
      removeValidation,
      validateCell,
      openValidationModal,
      validations: () => (data.validations || []).slice(),
      // 撤销 / 重做 API
      undo,
      redo,
      canUndo,
      canRedo,
      destroy() {
        window.removeEventListener("mouseup", _ssMouseUp);
        if (resizeCleanup) resizeCleanup();
        if (ssSelbar) ssSelbar.destroy();
        if (ribbon.el) ribbon.el.remove();
        wrap.remove();
      }
    };
  }

  OS.modules = OS.modules || {};
  OS.modules.spreadsheet = { type: "spreadsheet", blank, mount };
  OS.blankDoc = (function (orig) { return function (t) { if (t === "spreadsheet") return blank(); return orig ? orig(t) : { type: t, data: {} }; }; })(OS.blankDoc);
})(window);
