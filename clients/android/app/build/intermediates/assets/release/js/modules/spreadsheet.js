/* ============================================================
   绿角犀 Office · Spreadsheet 表格模块 + 自研公式引擎
   对应 PRD 3.2 / 关键技术设计「兼容 Excel 函数集的公式计算引擎」
   ============================================================ */
(function (global) {
  "use strict";
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
      }
    };
    function matchCrit(v, c) { if (typeof c === "string" && /^[<>]=?/.test(c)) { const op = c.match(/^[<>]=?/)[0]; const n = parseFloat(c.slice(op.length)); return ({ ">": v > n, ">=": v >= n, "<": v < n, "<=": v <= n })[op]; } return v == c; }
    function numList(a) { return flat(a).map(x => typeof x === "number" ? x : parseFloat(x)).filter(x => !isNaN(x)); }
    function sum(a) { return a.reduce((s, x) => s + (isNaN(x) ? 0 : x), 0); }
    function flat(a) { return Array.isArray(a) ? a.reduce((acc, x) => acc.concat(flat(x)), []) : [a]; }
    function formatNum(v, f) { if (!f) return v; return String(v); }

    // 词法
    function tokenize(s) {
      const toks = []; let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === " " || c === "\t") { i++; continue; }
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
        if (tk.t === "name") return { v: 0 };
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

    function evalNode(node, getCell) {
      if (node == null) return 0;
      if ("v" in node) return node.v;
      if (node.ref) return getCell(node.ref);
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
        const fn = FUNCS[node.func];
        if (!fn) return "#NAME?";
        const args = node.args.map(a => evalNode(a, getCell));
        try { return fn.apply(null, args); } catch (e) { return "#VALUE!"; }
      }
      if (node.op) {
        if (node.op === "u-") return -num(evalNode(node.arg, getCell));
        return applyOp(node.op, evalNode(node.left, getCell), evalNode(node.right, getCell));
      }
      return 0;
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
    function run(formula, getCell) {
      const c = compile(formula);
      if (c.error) return c.error;
      try { const r = evalNode(c.ast, getCell); if (r === Infinity) return "#DIV/0!"; return r; }
      catch (e) { return "#ERROR!"; }
    }

    return { run, compile, adjustFormula, colToIdx, idxToCol, parseRef, expandRange, tokenize };
  })();
  OS.FormulaEngine = FE;

  /* ---------------- 模块 ---------------- */
  function blank() {
    return {
      activeSheet: 0,
      freeze: { row: 0, col: 0 },
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
    if (d.sheets && Array.isArray(d.sheets) && d.sheets.length) {
      if (typeof d.activeSheet !== "number" || d.activeSheet >= d.sheets.length) d.activeSheet = 0;
      if (!d.freeze) d.freeze = { row: 0, col: 0 };
      d.sheets.forEach((s, i) => {
        s.cells = s.cells || {}; s.styles = s.styles || {}; s.charts = s.charts || [];
        s.condFormats = s.condFormats || []; s.filters = s.filters || [];
        s.merge = s.merge || []; s.validations = s.validations || [];
        if (!s.name) s.name = "Sheet" + (i + 1);
      });
      return d;
    }
    return {
      activeSheet: 0,
      freeze: { row: 0, col: 0 },
      sheets: [{
        name: "Sheet1",
        rows: d.rows || 100, cols: d.cols || 16,
        cells: d.cells || {}, styles: d.styles || {}, charts: d.charts || [],
        condFormats: d.condFormats || [], filters: d.filters || [],
        merge: d.merge || [], validations: d.validations || []
      }]
    };
  }

  function mount(host, doc, ctx) {
    const data = normalizeDoc(doc);
    const sh0 = data.sheets[data.activeSheet];
    const ROWS = sh0.rows || 100, COLS = sh0.cols || 16;

    const wrap = document.createElement("div");
    wrap.className = "sheet-wrap";
    wrap.innerHTML = `
      <div class="sheet-toolbar">
        <input class="cell-ref" placeholder="A1">
        <input class="fx" placeholder="输入数值或公式，如 =SUM(A1:A3)">
      </div>
      <div class="sheet-scroll"><table class="sheet"></table></div>
      <div class="sheet-statusbar"><span class="st-sum"></span><span class="st-sel"></span><span class="st-info"></span></div>
      <div class="sheet-tabs"><div class="sheet-tabs-list"></div><button class="sheet-add" title="新建工作表">＋</button></div>
      <div class="sheet-charts" hidden></div>`;
    host.appendChild(wrap);
    const table = wrap.querySelector("table.sheet");
    const refInput = wrap.querySelector(".cell-ref");
    const fx = wrap.querySelector(".fx");
    const scroll = wrap.querySelector(".sheet-scroll");
    const stSum = wrap.querySelector(".st-sum"), stSel = wrap.querySelector(".st-sel"), stInfo = wrap.querySelector(".st-info");

    let selected = "A1", anchor = "A1";
    var cfAppliedRefs = [];

    // 构建表头与单元格
    function buildGrid() {
      let html = "<tr><th class='corner'></th>";
      for (let c = 1; c <= COLS; c++) html += `<th class="colhead" data-col="${c}">${FE.idxToCol(c)}</th>`;
      html += "</tr>";
      for (let r = 1; r <= ROWS; r++) {
        html += `<tr><th class="rowhead" data-row="${r}">${r}</th>`;
        for (let c = 1; c <= COLS; c++) html += `<td data-ref="${FE.idxToCol(c)}${r}"></td>`;
        html += "</tr>";
      }
      table.innerHTML = html;
      applyMerges();
    }
    buildGrid();
    bindAliases();
    applyFreeze();
    renderSheetTabs();
    const sheetAddBtn = wrap.querySelector(".sheet-add");
    if (sheetAddBtn) sheetAddBtn.addEventListener("click", () => addSheet());

    // 求值缓存
    const cache = {};
    function getCell(ref) {
      if (ref in cache) return cache[ref];
      const raw = (data.cells[ref]) || {};
      let val;
      if (raw.f && raw.f.startsWith("=")) {
        try { val = FE.run(raw.f, getCell); } catch { val = "#ERROR!"; }
      } else if (raw.v !== undefined && raw.v !== "") {
        val = isNum(raw.v) ? Number(raw.v) : raw.v;
      } else val = "";
      cache[ref] = val;
      return val;
    }
    function isNum(v) { return typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)) && /^[+-]?[\d.]+$/.test(v)); }

    function recompute() {
      for (const k in cache) delete cache[k];
      // 重新填值（带循环保护）
      table.querySelectorAll("td[data-ref]").forEach(td => {
        if (td.getAttribute("contenteditable") === "true") return; // 跳过正在编辑的单元格
        const ref = td.dataset.ref;
        let v = getCell(ref);
        if (typeof v === "number" && !isFinite(v)) v = "#DIV/0!";
        if (v === undefined || v === null) v = "";
        if (v instanceof Date) v = v.toLocaleDateString();
        if (typeof v === "boolean") v = v ? "TRUE" : "FALSE";
        if (Array.isArray(v)) v = "";
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
      delete cache[ref];
      recompute();
    }
    function commit(ref, val) { snapshot(); writeCell(ref, val); ctx.markDirty(); }

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
      const rg = rangeRect(); if (!rg) return;
      const sR = FE.parseRef(selected), sC = sR ? sR.col : -1, sRR = sR ? sR.row : -1;
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
    function selectCell(ref) {
      anchor = ref; selected = ref;
      paint();
      refInput.value = ref;
      const raw = data.cells[ref];
      fx.value = raw ? (raw.f || raw.v) : "";
      updateStatus();
    }
    function select(ref) { selectCell(ref); }
    selectCell("A1");

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
    window.addEventListener("mouseup", () => { dragging = false; });
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
    table.addEventListener("keydown", e => {
      const td = e.target.closest("td[data-ref]");
      if (!td) return;
      const ref = td.dataset.ref;
      const pr = FE.parseRef(ref);
      if (e.key === "Enter") { e.preventDefault(); commitCell(td); move(pr.row + 1, pr.col); }
      else if (e.key === "Tab") { e.preventDefault(); commitCell(td); move(pr.row, pr.col + (e.shiftKey ? -1 : 1)); }
      else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        if (e.shiftKey) {
          const nr = Math.max(1, Math.min(ROWS, pr.row + d[0])), nc = Math.max(1, Math.min(COLS, pr.col + d[1]));
          selected = FE.idxToCol(nc) + nr; paint(); updateStatus();
        } else {
          commitCell(td); move(pr.row + d[0], pr.col + d[1]);
        }
      }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        if (td.getAttribute("contenteditable") !== "true") { td.setAttribute("contenteditable", "true"); td.textContent = ""; td.focus(); }
      }
      else if (e.key === "Escape") { td.removeAttribute("contenteditable"); recompute(); }
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

    /* ---------------- 条件格式（高亮 / 色阶 / 数据条 / 前10 / 重复值） ---------------- */
    function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
    function selRangeStr() { const rg = rangeRect(); if (!rg) return "A1"; return FE.idxToCol(rg.c1) + rg.r1 + ":" + FE.idxToCol(rg.c2) + rg.r2; }
    function cfRaw(ref) { const v = getCell(ref); if (v == null || v === "") return null; if (typeof v === "number" || typeof v === "boolean") return v; return String(v); }
    function cfNumFromRaw(raw) { if (raw == null) return null; if (typeof raw === "number") return raw; const n = parseFloat(String(raw).replace(/,/g, "")); return isNaN(n) ? null : n; }
    function cfNum(ref) { return cfNumFromRaw(cfRaw(ref)); }
    function opLabel(o) { return { gt: "大于", lt: "小于", eq: "等于", between: "介于", contains: "包含文本" }[o] || o; }
    function matchCell(rule, raw) {
      const n = cfNumFromRaw(raw);
      switch (rule.op) {
        case "gt": return n != null && n > Number(rule.v);
        case "lt": return n != null && n < Number(rule.v);
        case "eq": return String(raw) === String(rule.v);
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
      const push = (ref, style) => { const cur = map[ref] || (map[ref] = {}); if (style.bg != null) cur.bg = style.bg; if (style.color != null) cur.color = style.color; if (style.bar) cur.bar = style.bar; };
      (data.condFormats || []).forEach(rule => {
        const rg = rangeRectFromStr(rule.range); if (!rg) return;
        const refs = [];
        for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) refs.push(FE.idxToCol(c) + r);
        if (rule.type === "scale") {
          const vs = refs.map(cfNum).filter(v => v != null); if (!vs.length) return;
          const mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
          refs.forEach(ref => { const v = cfNum(ref); if (v == null) return; const t = mx > mn ? (v - mn) / (mx - mn) : 0; push(ref, { bg: lerpColor(rule.minColor, rule.maxColor, t) }); });
        } else if (rule.type === "bar") {
          const vs = refs.map(cfNum).filter(v => v != null); if (!vs.length) return;
          const mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
          refs.forEach(ref => { const v = cfNum(ref); if (v == null) return; const pct = mx > mn ? ((v - mn) / (mx - mn)) * 100 : 0; push(ref, { bar: { color: rule.color, pct: Math.max(0, Math.min(100, pct)) } }); });
        } else if (rule.type === "cell") {
          refs.forEach(ref => { const raw = cfRaw(ref); if (raw == null) return; if (matchCell(rule, raw)) push(ref, { bg: lerpColor(rule.bg, rule.bg, 0) }); });
        } else if (rule.type === "top") {
          const items = refs.map(ref => ({ ref, v: cfNum(ref) })).filter(x => x.v != null).sort((a, b) => rule.top ? b.v - a.v : a.v - b.v);
          const k = rule.percent ? Math.max(1, Math.round(items.length * rule.n / 100)) : rule.n;
          for (let i = 0; i < Math.min(items.length, k); i++) push(items[i].ref, { bg: lerpColor(rule.bg, rule.bg, 0) });
        } else if (rule.type === "dupes") {
          const counts = {}; refs.forEach(ref => { const k = cfRaw(ref); if (k == null || k === "") return; const key = String(k); counts[key] = (counts[key] || 0) + 1; });
          refs.forEach(ref => { const k = cfRaw(ref); if (k == null || k === "") return; if (counts[String(k)] > 1) push(ref, { bg: lerpColor(rule.bg, rule.bg, 0) }); });
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
        td.style.backgroundImage = ""; td.classList.remove("cf-bar");
      });
      cfAppliedRefs = Object.keys(map);
      cfAppliedRefs.forEach(ref => {
        const td = table.querySelector(`td[data-ref="${ref}"]`); if (!td) return;
        const st = map[ref], s = data.styles[ref], mBg = s && s.bg, mColor = s && s.color;
        if (st.bg != null) td.style.backgroundColor = mBg ? mBg : st.bg; else if (mBg) td.style.backgroundColor = mBg;
        if (st.color != null) td.style.color = mColor ? mColor : st.color; else if (mColor) td.style.color = mColor;
        if (st.bar) { td.style.backgroundImage = `linear-gradient(90deg, ${st.bar.color} ${st.bar.pct.toFixed(1)}%, transparent ${st.bar.pct.toFixed(1)}%)`; td.classList.add("cf-bar"); }
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
      const titles = { cell: "突出显示单元格规则", dupes: "重复值", bar: "数据条", scale: "色阶（双色）", top: "项目选取（前10 / 后10）" };
      const m = openModal(titles[type] || "条件格式");
      const rule = existing || { id: "cf" + (data._cfSeq = (data._cfSeq || 0) + 1), type, range: selRangeStr() };
      const rb = h(`<label class="cf-row"><span>应用于范围</span><input class="cf-range" value="${rule.range}"></label>`);
      m.body.appendChild(rb);
      let opSel, v1, v2, c1, c2, topN, topPct, topKind;
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
        c1 = colorRow("条颜色", rule.color || "#638ec6"); m.body.appendChild(c1);
      } else if (type === "scale") {
        c1 = colorRow("最小值色", rule.minColor || "#f8696b"); c2 = colorRow("最大值色", rule.maxColor || "#63be7b");
        m.body.appendChild(c1); m.body.appendChild(c2);
      } else if (type === "top") {
        topN = h(`<label class="cf-row"><span>数量</span><input class="cf-topn" type="number" min="1" value="${rule.n || 10}"></label>`);
        topPct = h(`<label class="cf-row"><span>按百分比</span><input class="cf-toppct" type="checkbox"${rule.percent ? " checked" : ""}></label>`);
        topKind = h(`<label class="cf-row"><span>方向</span><select class="cf-topkind"><option value="top">最大的（前）</option><option value="bottom">最小的（后）</option></select></label>`);
        topKind.querySelector(".cf-topkind").value = rule.top ? "top" : "bottom";
        c1 = colorRow("填充色", rule.bg || "#ffc7ce");
        m.body.appendChild(topN); m.body.appendChild(topPct); m.body.appendChild(topKind); m.body.appendChild(c1);
      }
      m.ok.addEventListener("click", () => {
        rule.range = rb.querySelector(".cf-range").value.trim().toUpperCase();
        if (type === "cell") { rule.op = opSel.querySelector(".cf-op").value; rule.v = v1.querySelector(".cf-v").value; rule.v2 = rule.op === "between" ? v2.querySelector(".cf-v2").value : undefined; rule.bg = c1.querySelector(".cf-color").value; }
        else if (type === "dupes") { rule.bg = c1.querySelector(".cf-color").value; }
        else if (type === "bar") { rule.color = c1.querySelector(".cf-color").value; }
        else if (type === "scale") { rule.minColor = c1.querySelector(".cf-color").value; rule.maxColor = c2.querySelector(".cf-color").value; }
        else if (type === "top") { rule.n = parseInt(topN.querySelector(".cf-topn").value, 10) || 10; rule.percent = topPct.querySelector(".cf-toppct").checked; rule.top = topKind.querySelector(".cf-topkind").value === "top"; rule.bg = c1.querySelector(".cf-color").value; }
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

    // 功能区（标签页）
    const ribbon = OS.Ribbon.create({
      file: { onOpen: ctx.openBackstage },
      tabs: [
        {
          id: "home", label: "开始", groups: [
            {
              label: "字体", items: [
                { kind: "btn", glyph: "B", title: "加粗", onClick: () => setStyle({ bold: !(data.styles[selected] && data.styles[selected].bold) }) },
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
                    { label: "数据条", onClick: () => openRuleModal("bar") },
                    { label: "色阶（双色）", onClick: () => openRuleModal("scale") },
                    { label: "项目选取（前10 / 后10）", onClick: () => openRuleModal("top") },
                    { divider: true },
                    { label: "管理规则…", onClick: () => openManager() }
                  ]
                }
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
                { kind: "btn", icon: "bar-chart", title: "选中数据区域生成柱状图", onClick: () => addChart("bar") },
                { kind: "btn", icon: "line-chart", title: "选中数据区域生成折线图", onClick: () => addChart("line") },
                { kind: "btn", icon: "pie-chart", title: "选中数据区域生成饼图（取第一列数值）", onClick: () => addChart("pie") }
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
              { kind: "btn", icon: "filter", title: "清除所有筛选", label: "清除", onClick: () => { clearFilters(); OS.toast("已清除筛选", "ok"); } }
            ]
          },
          {
            label: "数据工具", items: [
              { kind: "btn", icon: "validate", label: "数据验证", title: "设置下拉列表 / 数值区间验证", onClick: openValidationModal },
              { kind: "btn", icon: "validate", label: "清除验证", title: "清除当前选区的数据验证", onClick: () => { const r = mergeRangeStr(); if (removeValidation(r)) OS.toast("已清除验证", "ok"); else OS.toast("该区域无验证", "warn"); } }
            ]
          }
        ]
      }
      ],
    });

    function setStyle(patch) {
      data.styles[selected] = Object.assign(data.styles[selected] || {}, patch);
      applyFmt(); applyCondFormat(); ctx.markDirty();
    }
    function applyFmt() {
      for (const ref in data.styles) {
        const td = table.querySelector(`td[data-ref="${ref}"]`); if (!td) continue;
        const s = data.styles[ref];
        if (s.color) td.style.color = s.color;
        if (s.bg) td.style.background = s.bg;
        if (s.bold) td.style.fontWeight = "700";
        if (s.align) td.style.textAlign = s.align;
      }
    }
    applyFmt();

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
      } else if (fmt === "pdf") window.print();
      else if (fmt === "json") OS.util.download(new Blob([JSON.stringify(data)], { type: "application/json" }), title + ".json");
    }
    function escapeHtmlCell(v) { return OS.util.escapeHtml(v == null ? "" : v); }

    /* ---------------- 图表（选区数据 -> SVG） ---------------- */
    const CHART_COLORS = ["#2f6fed", "#e0533d", "#2fa86a", "#f0a020", "#8b5cf6", "#00a3a3", "#d6457f", "#5b8c00"];
    function chartTypeName(t) { return { bar: "柱状图", line: "折线图", pie: "饼图" }[t] || "图表"; }

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

    /* ---------------- 多工作表 + 冻结窗格 ---------------- */
    function bindAliases() {
      const sh = data.sheets[data.activeSheet];
      data.cells = sh.cells; data.styles = sh.styles; data.charts = sh.charts;
      data.condFormats = sh.condFormats; data.filters = sh.filters;
      data.merge = sh.merge; data.validations = sh.validations;
      data.rows = sh.rows || 100; data.cols = sh.cols || 16;
    }
    function renderSheetTabs() {
      const list = wrap.querySelector(".sheet-tabs-list");
      if (!list) return;
      list.innerHTML = "";
      data.sheets.forEach((sh, i) => {
        const b = document.createElement("button");
        b.className = "sheet-tab" + (i === data.activeSheet ? " on" : "");
        b.setAttribute("data-sheet", i);
        const label = document.createElement("span");
        label.className = "sheet-tab-name"; label.textContent = sh.name;
        b.appendChild(label);
        const x = document.createElement("span");
        x.className = "sheet-tab-x"; x.textContent = "×";
        x.addEventListener("click", (e) => { e.stopPropagation(); if (window.confirm("删除工作表 “" + sh.name + "”？")) removeSheet(i); });
        b.appendChild(x);
        b.addEventListener("click", () => switchSheet(i));
        b.addEventListener("dblclick", () => { const n = window.prompt("重命名工作表", sh.name); if (n != null && n.trim()) renameSheet(i, n.trim()); });
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
      data.activeSheet = idx;
      bindAliases();
      buildGrid(); recompute(); renderCharts(); applyFreeze(); renderSheetTabs(); updateStatus();
      ctx.markDirty();
    }
    function removeSheet(idx) {
      if (data.sheets.length <= 1) { if (OS.toast) OS.toast("至少保留一个工作表", "warn"); return false; }
      if (idx < 0 || idx >= data.sheets.length) return false;
      const old = data.sheets[data.activeSheet];
      old.cells = data.cells; old.styles = data.styles; old.charts = data.charts;
      old.condFormats = data.condFormats; old.filters = data.filters;
      old.merge = data.merge; old.validations = data.validations;
      snapshot();
      data.sheets.splice(idx, 1);
      if (data.activeSheet >= data.sheets.length) data.activeSheet = data.sheets.length - 1;
      bindAliases();
      buildGrid(); recompute(); renderCharts(); applyFreeze(); renderSheetTabs(); updateStatus();
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
      data.sheets = JSON.parse(JSON.stringify(snap.sheets));
      bindAliases();
      buildGrid(); recompute(); renderCharts(); applyFreeze(); renderSheetTabs(); updateStatus();
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
      const rule = Object.assign({ range: rangeStr.toUpperCase() }, cfg);
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
    function validateCell(ref, value) {
      const v = data.validations || [];
      const rg = FE.parseRef(ref); if (!rg) return { ok: true };
      for (let i = 0; i < v.length; i++) {
        const rule = v[i]; const rr = rangeRectFromStr(rule.range); if (!rr) continue;
        if (rg.row < rr.r1 || rg.row > rr.r2 || rg.col < rr.c1 || rg.col > rr.c2) continue;
        const str = String(value == null ? "" : value);
        if (str === "") { if (rule.allowBlank === false) return { ok: false, msg: "不允许空白" }; return { ok: true }; }
        if (rule.type === "list") {
          const list = (rule.list || []).map(String);
          if (list.indexOf(str) === -1) return { ok: false, msg: "必须是：" + list.join(" / ") };
        } else if (rule.type === "number") {
          const num = Number(str);
          if (isNaN(num)) return { ok: false, msg: "必须是数字" };
          if (rule.min != null && num < Number(rule.min)) return { ok: false, msg: "不能小于 " + rule.min };
          if (rule.max != null && num > Number(rule.max)) return { ok: false, msg: "不能大于 " + rule.max };
        }
        return { ok: true };
      }
      return { ok: true };
    }
    function openValidationModal() {
      const rg = rangeRect(); if (!rg) { OS.toast("请先选中要验证的区域", "warn"); return; }
      const m = openModal("数据验证");
      const typeSel = h(`<label class="cf-row"><span>允许</span><select class="dv-type"><option value="list">序列（下拉列表）</option><option value="number">整数 / 数值区间</option></select></label>`);
      const listRow = h(`<label class="cf-row dv-list"><span>列表项</span><input class="dv-list-v" placeholder="用逗号分隔，如 优,良,中"></label>`);
      const minRow = h(`<label class="cf-row dv-min" hidden><span>最小值</span><input class="dv-min-v" type="number"></label>`);
      const maxRow = h(`<label class="cf-row dv-max" hidden><span>最大值</span><input class="dv-max-v" type="number"></label>`);
      const blankRow = h(`<label class="cf-row"><span>允许空白</span><input type="checkbox" class="dv-blank" checked></label>`);
      typeSel.querySelector(".dv-type").addEventListener("change", e => {
        const isList = e.target.value === "list";
        listRow.hidden = !isList; minRow.hidden = isList; maxRow.hidden = isList;
      });
      m.body.appendChild(typeSel); m.body.appendChild(listRow); m.body.appendChild(minRow); m.body.appendChild(maxRow); m.body.appendChild(blankRow);
      m.ok.addEventListener("click", () => {
        const type = typeSel.querySelector(".dv-type").value;
        const range = mergeRangeStr();
        if (type === "list") {
          const list = listRow.querySelector(".dv-list-v").value.split(",").map(s => s.trim()).filter(Boolean);
          setValidation(range, { type: "list", list: list, allowBlank: blankRow.querySelector(".dv-blank").checked });
        } else {
          setValidation(range, {
            type: "number",
            min: minRow.querySelector(".dv-min-v").value === "" ? null : Number(minRow.querySelector(".dv-min-v").value),
            max: maxRow.querySelector(".dv-max-v").value === "" ? null : Number(maxRow.querySelector(".dv-max-v").value),
            allowBlank: blankRow.querySelector(".dv-blank").checked
          });
        }
        OS.toast("已设置数据验证", "ok"); m.close();
      });
    }

    return {
      serialize: doSerialize,
      commit,
      exportAs,
      focus() {},
      ribbon,
      selectCell,
      gotoCell,
      search,
      replaceAll: replaceAllText,
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
      destroy() { if (ssSelbar) ssSelbar.destroy(); if (ribbon.el) ribbon.el.remove(); wrap.remove(); }
    };
  }

  OS.modules = OS.modules || {};
  OS.modules.spreadsheet = { type: "spreadsheet", blank, mount };
  OS.blankDoc = (function (orig) { return function (t) { if (t === "spreadsheet") return blank(); return orig ? orig(t) : { type: t, data: {} }; }; })(OS.blankDoc);
})(window);
