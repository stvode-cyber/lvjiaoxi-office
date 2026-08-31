/* ============================================================
   绿角犀 Office · PDF content stream 解析（纯逻辑，矢量外观提取）
   ------------------------------------------------------------
   将 PDF content stream（含批注 /AP Form XObject 外观的绘制命令）
   解析为归一化矢量场景：路径段（move/line/curve/rect/close）+
   填充/描边色 + 线宽 + 当前变换矩阵(CTM) 跟踪。
   零依赖、Node 可测，不依赖 pdf.js / Canvas。

   与 Q 的位图 AP 解析互补：Q 解码 /AP 内嵌的位图图像（Image XObject），
   本模块解释 Form XObject 内容流中的矢量绘制命令，用于还原矢量图章/签名。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // —— 颜色转换 ——
  function grayToRgb(v) { const c = Math.max(0, Math.min(255, Math.round(v * 255))); return [c, c, c]; }
  function cmykToRgb(c, m, y, k) {
    return [
      Math.max(0, Math.min(255, Math.round(255 * (1 - c) * (1 - k)))),
      Math.max(0, Math.min(255, Math.round(255 * (1 - m) * (1 - k)))),
      Math.max(0, Math.min(255, Math.round(255 * (1 - y) * (1 - k))))
    ];
  }

  // —— 仿射矩阵：x' = a*x + c*y + e ; y' = b*x + d*y + f ——
  function ident() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  // 先 B 后 A：返回 A·B（device = A × (B × p)）
  function mul(A, B) {
    return {
      a: A.a * B.a + A.c * B.b,
      b: A.b * B.a + A.d * B.b,
      c: A.a * B.c + A.c * B.d,
      d: A.b * B.c + A.d * B.d,
      e: A.a * B.e + A.c * B.f + A.e,
      f: A.b * B.e + A.d * B.f + A.f
    };
  }
  function applyM(M, x, y) { return [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]; }

  // —— 分词 ——
  // token: { t:'num'|'name'|'str'|'op', v }
  function tokenizeContent(s) {
    const tokens = [];
    let i = 0; const n = s.length;
    const isWs = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\0" || ch === "\f";
    const isSpecial = (ch) => ch === "/" || ch === "(" || ch === "<" || ch === ">" || ch === "[" || ch === "]";
    const isNumCh = (cc) => (cc >= "0" && cc <= "9") || cc === "." || cc === "-" || cc === "+" || cc === "e" || cc === "E";
    while (i < n) {
      const ch = s[i];
      if (isWs(ch)) { i++; continue; }
      // 字面字符串 ( ... )，处理转义与嵌套括号；遇到使 depth 归零的 ) 即结束（不计外层括号）
      if (ch === "(") {
        let depth = 1, j = i + 1, out = "";
        for (; j < n; j++) {
          const c = s[j];
          if (c === "\\") { out += (j + 1 < n) ? s[j + 1] : ""; j++; continue; }
          if (c === "(") { depth++; out += c; continue; }
          if (c === ")") { depth--; if (depth <= 0) { j++; break; } out += c; continue; }
          out += c;
        }
        i = j; tokens.push({ t: "str", v: out }); continue;
      }
      // 十六进制字符串 <...>
      if (ch === "<") {
        if (s[i + 1] === "<") { i += 2; tokens.push({ t: "op", v: "<<" }); continue; }
        let j = i + 1, out = "";
        while (j < n && s[j] !== ">") { out += s[j]; j++; }
        i = j + 1; tokens.push({ t: "str", v: out.replace(/\s+/g, "") }); continue;
      }
      if (ch === ">") { i++; tokens.push({ t: "op", v: ">>" }); continue; }
      // 名字 /name
      if (ch === "/") {
        let j = i + 1, out = "";
        while (j < n && !isWs(s[j]) && !isSpecial(s[j])) { out += s[j]; j++; }
        i = j; tokens.push({ t: "name", v: out }); continue;
      }
      if (ch === "[" || ch === "]") { i++; tokens.push({ t: "op", v: ch }); continue; }
      // 数字（可含 . - + e/E）
      if ((ch >= "0" && ch <= "9") || ch === "-" || ch === "+" || ch === ".") {
        let j = i, out = "";
        while (j < n && isNumCh(s[j])) { out += s[j]; j++; }
        i = j; tokens.push({ t: "num", v: parseFloat(out) }); continue;
      }
      // 操作符词（仅按空白/特殊字符截断，字母 e/E 属合法操作符字符如 re/Tj）
      let j = i, out = "";
      while (j < n && !isWs(s[j]) && !isSpecial(s[j])) { out += s[j]; j++; }
      i = j; tokens.push({ t: "op", v: out }); continue;
    }
    return tokens;
  }

  // —— 内容流解析 ——
  // 返回 { ops, bbox }：ops 为绘制操作序列；bbox 为路径几何包围盒（变换后空间）
  // op 形状：
  //   { op:'fill',      path:[seg...], fill:[r,g,b], winding:'nonzero'|'evenodd' }
  //   { op:'stroke',    path:[seg...], stroke:[r,g,b], lineWidth }
  //   { op:'fillstroke',path:[seg...], fill, stroke, lineWidth }
  //   { op:'xobject',   name }      // Do 引用的图像/表单（非矢量几何）
  //   { op:'text' }                // BT/ET 文本（本模块不还原字形几何，仅占位）
  // seg 形状：{m:[x,y]} {l:[x,y]} {c:[x1,y1,x2,y2,x,y]} {v:[x2,y2,x,y]} {y:[x1,y1,x,y]} {rect:[x,y,w,h]} {close:true}
  // —— 内容流解析（操作数栈模型）——
  // PDF content stream 是「操作数在前、操作符在后」的逆波兰风格：数字/名字/字符串
  // 依次入操作数栈，遇到操作符从栈顶弹出其所需操作数。该模型天然保持操作数与
  // 操作符的位置关系（避免前向贪婪吞掉后续操作符的操作数）。
  // 返回 { ops, bbox }：ops 为绘制操作序列；bbox 为路径几何包围盒（变换后空间）
  // op 形状：
  //   { op:'fill',      path:[seg...], fill:[r,g,b], winding:'nonzero'|'evenodd' }
  //   { op:'stroke',    path:[seg...], stroke:[r,g,b], lineWidth }
  //   { op:'fillstroke',path:[seg...], fill, stroke, lineWidth }
  //   { op:'xobject',   name }      // Do 引用的图像/表单（非矢量几何）
  //   { op:'text' }                // BT/ET 文本（本模块不还原字形几何，仅占位）
  // seg 形状：{m:[x,y]} {l:[x,y]} {c:[x1,y1,x2,y2,x,y]} {v:[x2,y2,x,y]} {y:[x1,y1,x,y]} {rect:[x,y,w,h]} {close:true}
  function parseContentStream(stream, opts) {
    opts = opts || {};
    const tokens = (typeof stream === "string") ? tokenizeContent(stream) : stream;
    const ops = [];
    let ctm = ident();
    const stateStack = [];
    let fill = [0, 0, 0], stroke = [0, 0, 0], lineWidth = 1;
    let fillSpace = "DeviceGray", strokeSpace = "DeviceGray";
    let path = [];
    let winding = "nonzero";
    let bbox = null;
    const stack = []; // 操作数栈：数字/名字/字符串入栈，操作符从栈顶取

    function expand(p) {
      const d = applyM(ctm, p[0], p[1]);
      if (bbox == null) bbox = { x0: d[0], y0: d[1], x1: d[0], y1: d[1] };
      else {
        if (d[0] < bbox.x0) bbox.x0 = d[0];
        if (d[0] > bbox.x1) bbox.x1 = d[0];
        if (d[1] < bbox.y0) bbox.y0 = d[1];
        if (d[1] > bbox.y1) bbox.y1 = d[1];
      }
      return d;
    }
    function emitPaint(kind) {
      const seg = path.slice();
      if (kind === "fill") ops.push({ op: "fill", path: seg, fill: fill.slice(), winding: winding });
      else if (kind === "stroke") ops.push({ op: "stroke", path: seg, stroke: stroke.slice(), lineWidth: lineWidth });
      else if (kind === "fillstroke") ops.push({ op: "fillstroke", path: seg, fill: fill.slice(), stroke: stroke.slice(), lineWidth: lineWidth });
      path = [];
    }
    function popNum() { const v = stack.pop(); return (typeof v === "number") ? v : 0; }
    function popName() { const v = stack.pop(); return (typeof v === "string") ? v : ""; }
    function popColor1() { return grayToRgb(popNum()); }
    function popColor3() { const b = popNum(), g = popNum(), r = popNum(); return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]; }
    function popColor4() { const k = popNum(), y = popNum(), m = popNum(), c = popNum(); return cmykToRgb(c, m, y, k); }
    function popWhileOperand() { while (stack.length && (typeof stack[stack.length - 1] === "number" || typeof stack[stack.length - 1] === "string")) stack.pop(); }

    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.t !== "op") { stack.push(tk.v); continue; }
      const op = tk.v;
      if (op === "q") { stateStack.push({ ctm: ctm, fill: fill.slice(), stroke: stroke.slice(), lineWidth: lineWidth, fillSpace: fillSpace, strokeSpace: strokeSpace }); continue; }
      if (op === "Q") { const s = stateStack.pop(); if (s) { ctm = s.ctm; fill = s.fill; stroke = s.stroke; lineWidth = s.lineWidth; fillSpace = s.fillSpace; strokeSpace = s.strokeSpace; } continue; }
      if (op === "cm") { const f = popNum(), e = popNum(), d = popNum(), c = popNum(), b = popNum(), a = popNum(); ctm = mul(ctm, { a: a, b: b, c: c, d: d, e: e, f: f }); continue; }
      if (op === "w") { lineWidth = popNum(); continue; }
      if (op === "J" || op === "j" || op === "M" || op === "ri" || op === "i" || op === "Tr" || op === "FL" || op === "CA" || op === "ca") { popNum(); continue; }
      if (op === "gs") { popName(); continue; }
      if (op === "d") { popWhileOperand(); continue; } // dash：弹出数组 + phase 全部数字操作数
      if (op === "cs") { fillSpace = popName(); continue; }
      if (op === "CS") { strokeSpace = popName(); continue; }
      if (op === "g") { fill = grayToRgb(popNum()); continue; }
      if (op === "G") { stroke = grayToRgb(popNum()); continue; }
      if (op === "rg") { fill = popColor3(); continue; }
      if (op === "RG") { stroke = popColor3(); continue; }
      if (op === "k") { fill = popColor4(); continue; }
      if (op === "K") { stroke = popColor4(); continue; }
      if (op === "sc" || op === "scn") {
        if (fillSpace === "DeviceRGB") fill = popColor3();
        else if (fillSpace === "DeviceCMYK") fill = popColor4();
        else if (fillSpace === "DeviceGray") fill = popColor1();
        else popWhileOperand(); // Pattern/分离：弹掉颜色名
        continue;
      }
      if (op === "SC" || op === "SCN") {
        if (strokeSpace === "DeviceRGB") stroke = popColor3();
        else if (strokeSpace === "DeviceCMYK") stroke = popColor4();
        else if (strokeSpace === "DeviceGray") stroke = popColor1();
        else popWhileOperand();
        continue;
      }
      if (op === "m") { const y = popNum(), x = popNum(); const p = expand([x, y]); path.push({ m: [p[0], p[1]] }); continue; }
      if (op === "l") { const y = popNum(), x = popNum(); const p = expand([x, y]); path.push({ l: [p[0], p[1]] }); continue; }
      if (op === "c") { const y = popNum(), x = popNum(), y2 = popNum(), x2 = popNum(), y1 = popNum(), x1 = popNum(); expand([x1, y1]); expand([x2, y2]); expand([x, y]); path.push({ c: [x1, y1, x2, y2, x, y] }); continue; }
      if (op === "v") { const y = popNum(), x = popNum(), y2 = popNum(), x2 = popNum(); expand([x2, y2]); expand([x, y]); path.push({ v: [x2, y2, x, y] }); continue; }
      if (op === "y") { const y1 = popNum(), x1 = popNum(), y = popNum(), x = popNum(); expand([x1, y1]); expand([x, y]); path.push({ y: [x1, y1, x, y] }); continue; }
      if (op === "re") {
        const h = popNum(), w = popNum(), y = popNum(), x = popNum();
        const p0 = expand([x, y]), p1 = expand([x + w, y]), p2 = expand([x + w, y + h]), p3 = expand([x, y + h]);
        const xs = [p0[0], p1[0], p2[0], p3[0]], ys = [p0[1], p1[1], p2[1], p3[1]];
        const x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
        path.push({ rect: [x0, y0, Math.max(xs[2] - x0, 0), Math.max(ys[2] - y0, 0)] });
        continue;
      }
      if (op === "h") { path.push({ close: true }); continue; }
      if (op === "n") { path = []; continue; }
      if (op === "S") { emitPaint("stroke"); continue; }
      if (op === "s") { path.push({ close: true }); emitPaint("stroke"); continue; }
      if (op === "f" || op === "F") { winding = "nonzero"; emitPaint("fill"); continue; }
      if (op === "f*") { winding = "evenodd"; emitPaint("fill"); continue; }
      if (op === "B") { emitPaint("fillstroke"); continue; }
      if (op === "B*") { winding = "evenodd"; emitPaint("fillstroke"); continue; }
      if (op === "b") { path.push({ close: true }); emitPaint("fillstroke"); continue; }
      if (op === "b*") { path.push({ close: true }); winding = "evenodd"; emitPaint("fillstroke"); continue; }
      if (op === "Do") { const name = popName(); ops.push({ op: "xobject", name: name }); continue; }
      if (op === "BT") { continue; }
      if (op === "ET") { continue; }
      if (op === "Tj") { stack.pop(); ops.push({ op: "text" }); continue; }
      if (op === "TJ") { popWhileOperand(); ops.push({ op: "text" }); continue; }
      if (op === "'" || op === '"') { if (op === '"') { popNum(); popNum(); } stack.pop(); ops.push({ op: "text" }); continue; }
      // 其它未识别操作符：容错跳过
      continue;
    }
    return { ops: ops, bbox: bbox };
  }

  // —— 由注释字典提取 AP 矢量外观（Form XObject 内容流中的路径绘制）——
  // 与 extractApImage 互补：位图 → 返回 image dataUrl；矢量 → 返回 ops。
  // 仅有 Do 图像（无路径几何）时返回 null，交由 extractApImage 处理。
  function extractApVector(annotDictStr, getObject) {
    if (typeof annotDictStr !== "string") return null;
    const apM = /AP\s*<<([\s\S]*?)>>/.exec(annotDictStr);
    if (!apM) return null;
    const apInner = apM[1];
    const nref = /N\s+(\d+)\s+\d+\s+R/.exec(apInner) || /D\s+(\d+)\s+\d+\s+R/.exec(apInner) || /R\s+(\d+)\s+\d+\s+R/.exec(apInner);
    if (!nref) return null;
    const obj = getObject(parseInt(nref[1], 10));
    if (!obj || !/\/Subtype\s*\/Form\b/.test(obj.dict)) return null;
    const bboxM = /BBox\s*\[([^\]]+)\]/.exec(obj.dict);
    let formBBox = null;
    if (bboxM) {
      const nn = bboxM[1].trim().split(/\s+/).map(Number).filter(isFinite);
      if (nn.length >= 4) formBBox = { x: nn[0], y: nn[1], w: nn[2] - nn[0], h: nn[3] - nn[1] };
    }
    const scene = parseContentStream(obj.streamStr || "");
    if (!scene.ops.length || !scene.ops.some(o => o.op === "fill" || o.op === "stroke" || o.op === "fillstroke")) return null;
    return { ops: scene.ops, bbox: scene.bbox, formBBox: formBBox };
  }

  const api = { tokenizeContent, parseContentStream, extractApVector, _grayToRgb: grayToRgb, _cmykToRgb: cmykToRgb, _mul: mul, _applyM: applyM };
  OS.PdfContent = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);
