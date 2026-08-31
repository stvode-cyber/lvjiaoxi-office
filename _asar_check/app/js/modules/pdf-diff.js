/* ============================================================
   绿角犀 Office · PDF 文档对比（文本层 Diff，纯逻辑）
   - 基于 LCS（最长公共子序列）的行级 / 词级差异
   - 输出彩色 diff 操作序列 + 摘要统计（增/删/未变/占比）
   - 不依赖 pdf.js，可在 node 直跑单测
   ============================================================ */
(function (global) {
  "use strict";
  const OS = (global.OS = global.OS || {});

  // 按 opts 归一化单段文本（用于比较，不影响展示原文）
  function norm(s, opts) {
    s = String(s == null ? "" : s);
    if (opts && opts.ignoreWhitespace) s = s.replace(/\s+/g, " ").trim();
    if (opts && opts.ignoreCase) s = s.toLowerCase();
    return s;
  }

  // 通用 LCS 回溯：a/b 为「比较键」数组，origA/origB 为「展示原文」数组
  // eq(a,b) 判定相等；返回操作序列 [{type:'eq'|'del'|'add', aIdx, bIdx, aText, bText}]
  function lcsDiff(keysA, keysB, origA, origB, eq, opts) {
    const n = keysA.length, m = keysB.length;
    // dp[i][j] = LCS 长度
    const dp = [];
    for (let i = 0; i <= n; i++) {
      dp[i] = new Array(m + 1).fill(0);
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (eq(keysA[i], keysB[j], opts)) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (eq(keysA[i], keysB[j], opts)) {
        ops.push({ type: "eq", aIdx: i + 1, bIdx: j + 1, aText: origA[i], bText: origB[j] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: "del", aIdx: i + 1, bIdx: null, aText: origA[i], bText: null });
        i++;
      } else {
        ops.push({ type: "add", aIdx: null, bIdx: j + 1, aText: null, bText: origB[j] });
        j++;
      }
    }
    while (i < n) { ops.push({ type: "del", aIdx: i + 1, bIdx: null, aText: origA[i], bText: null }); i++; }
    while (j < m) { ops.push({ type: "add", aIdx: null, bIdx: j + 1, aText: null, bText: origB[j] }); j++; }
    return ops;
  }

  // 行级差异：aText/bText 可为字符串或字符串数组
  function toLines(x) {
    if (Array.isArray(x)) return x.slice();
    if (x == null || x === "") return []; // 空文档视为 0 行（而非 1 个空行）
    return String(x).split("\n");
  }

  function diffLines(aText, bText, opts) {
    const aArr = toLines(aText);
    const bArr = toLines(bText);
    const keysA = aArr.map(s => norm(s, opts));
    const keysB = bArr.map(s => norm(s, opts));
    return lcsDiff(keysA, keysB, aArr, bArr, (x, y) => x === y, opts);
  }

  // 词级差异：保留空白与标点作为独立 token，便于彩色对照
  function tokenizeWords(s) {
    // 切分为「连续非空白」与「连续空白」交替的 token
    const out = [];
    const re = /(\s+|[^\s]+)/g;
    let m;
    while ((m = re.exec(s)) !== null) out.push(m[0]);
    return out;
  }

  function diffWords(aText, bText, opts) {
    const aArr = tokenizeWords(String(aText == null ? "" : aText));
    const bArr = tokenizeWords(String(bText == null ? "" : bText));
    const keysA = aArr.map(s => norm(s, opts));
    const keysB = bArr.map(s => norm(s, opts));
    return lcsDiff(keysA, keysB, aArr, bArr, (x, y) => x === y, opts);
  }

  // 摘要统计
  function summarize(ops) {
    let added = 0, removed = 0, unchanged = 0;
    (Array.isArray(ops) ? ops : []).forEach(o => {
      if (o.type === "add") added++;
      else if (o.type === "del") removed++;
      else unchanged++;
    });
    const total = ops ? ops.length : 0;
    const pct = (x) => total ? Math.round((x / total) * 100) : 0;
    return {
      total, added, removed, unchanged,
      addedPct: pct(added), removedPct: pct(removed), unchangedPct: pct(unchanged)
    };
  }

  // 文档级便捷入口：行级 diff + 摘要
  function diffDocs(aText, bText, opts) {
    const diff = diffLines(aText, bText, opts);
    return { diff, summary: summarize(diff), linesA: toLines(aText).length, linesB: toLines(bText).length };
  }

  const api = {
    diffLines, diffWords, summarize, diffDocs,
    _norm: norm, _tokenizeWords: tokenizeWords, _lcsDiff: lcsDiff
  };
  OS.PdfDiff = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);
