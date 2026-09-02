/*
 * 绿角犀 Office · PDF 加密与权限检测（OS.PdfEncrypt）
 * 纯逻辑零依赖模块：从 PDF 原始字节解析 trailer/root 引用的 /Encrypt 字典，
 * 用于「加密审计 / 安全评估 / 打开门槛判定」。覆盖：
 *   /Filter(→/Standard) /V /R /Length /P /O /U /EncryptMetadata /CFM /StmF /StrF
 * 解码 /P 权限位为可读清单（打印/修改/复制/批注/填表/提取无障碍/组装/高分辨率打印），
 * 判定算法族（RC4-40 / RC4 / AES-128 / AES-256）与加密强度。
 * 纯解析、不实际解密；打开是否需密码仅需标记（用户或所有者密码均可解锁），精确判定超出纯解析范围。
 *
 * 暴露：
 *   parseEncryption(bytes)   主函数 → { encrypted, detected, filter, version, revision, keyLength, algorithm, strength, encryptMetadata, cfm, stmF, strF, permissions, ownerHash, userHash, requiresPassword }
 *   decodePermissions(P)     单独解析权限整数 → { raw, unsigned, items, allowedCount, total }
 *   summarize(res)           派生摘要
 *   toMarkdown(res, opts)    加密检测 Markdown 报告
 *   toHtml(res)              HTML 片段（权限清单 + 元信息）
 */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  /** 把 bytes 转 latin1 风格字符串，便于正则扫描。 */
  function bytesToString(bytes) {
    if (!bytes) return "";
    let s = "";
    const n = bytes.length;
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i] & 0xff);
    return s;
  }

  /** 从 startIdx（指向 '<<'）开始，做 << >> 平衡切分，返回最外层字典串。 */
  function sliceDict(txt, startIdx) {
    let depth = 0, i = startIdx;
    for (; i < txt.length; i++) {
      if (txt[i] === "<" && txt[i + 1] === "<") { depth++; i++; }
      else if (txt[i] === ">" && txt[i + 1] === ">") { depth--; i++; if (depth === 0) return txt.slice(startIdx, i + 1); }
    }
    return null;
  }

  /** 权限位定义（PDF 规范，低序位）。 */
  const PERM_DEFS = [
    { bit: 3, mask: 1 << 3, key: "print", label: "打印" },
    { bit: 4, mask: 1 << 4, key: "modify", label: "修改内容" },
    { bit: 5, mask: 1 << 5, key: "copy", label: "复制/提取文本图形" },
    { bit: 6, mask: 1 << 6, key: "annot", label: "增改批注" },
    { bit: 9, mask: 1 << 9, key: "fillForm", label: "填写表单" },
    { bit: 10, mask: 1 << 10, key: "extractAccess", label: "提取无障碍文本" },
    { bit: 11, mask: 1 << 11, key: "assemble", label: "文档组装" },
    { bit: 12, mask: 1 << 12, key: "printHi", label: "高分辨率打印" }
  ];

  /** 单独解析权限整数（有符号 32 位 → 无符号），返回可读清单。 */
  function decodePermissions(P) {
    const raw = (P == null) ? null : P;
    const u = (P == null) ? 0 : (P >>> 0);
    const items = PERM_DEFS.map(d => ({
      bit: d.bit, mask: d.mask, key: d.key, label: d.label,
      allowed: (P != null) && ((u & d.mask) !== 0)
    }));
    return {
      raw, unsigned: u, items,
      allowedCount: items.filter(i => i.allowed).length,
      total: items.length
    };
  }

  /** 由修订号/版本/CFM 判定算法族与强度。 */
  function algorithmOf(R, V, CFM) {
    if (R == null) return { algo: "未知", strength: "未知" };
    if (R <= 2) return { algo: "RC4-40", strength: "弱" };
    if (R === 3) return { algo: "RC4", strength: "弱" };
    if (R === 4) {
      if (CFM === "AESV2") return { algo: "AES-128", strength: "中" };
      if (CFM === "AESV3") return { algo: "AES-256", strength: "强" };
      if (CFM === "V2") return { algo: "RC4", strength: "弱" };
      return { algo: "RC4/AES", strength: "弱" };
    }
    if (R >= 5) return { algo: "AES-256", strength: "强" };
    return { algo: "未知", strength: "未知" };
  }

  /** 主函数：解析 PDF 加密字典。 */
  function parseEncryption(bytes) {
    const txt = bytesToString(bytes);

    const encRef = /\/Encrypt\s+(\d+)\s+0\s+R/.exec(txt);
    if (!encRef) return { encrypted: false, reason: "trailer/root 未发现 /Encrypt 引用" };

    const encNum = +encRef[1];
    let dict = null;
    const objM = new RegExp(encNum + "\\s+0\\s+obj").exec(txt);
    if (objM) {
      const lt = txt.indexOf("<<", objM.index);
      if (lt >= 0) dict = sliceDict(txt, lt);
    }
    if (!dict) {
      const lt = txt.indexOf("<<", encRef.index);
      if (lt >= 0) dict = sliceDict(txt, lt);
    }
    if (!dict) return { encrypted: true, detected: false, reason: "发现 /Encrypt 引用但未能解析字典" };

    const filterM = /\/Filter\s*\/([A-Za-z]+)/.exec(dict);
    const filter = filterM ? filterM[1] : null;
    const vM = /\/V\s+(\d+)/.exec(dict); const V = vM ? +vM[1] : null;
    const rM = /\/R\s+(\d+)/.exec(dict); const R = rM ? +rM[1] : null;
    const lenM = /\/Length\s+(\d+)/.exec(dict); const Length = lenM ? +lenM[1] : null;
    const pM = /\/P\s+(-?\d+)/.exec(dict); const P = pM ? +pM[1] : null;
    const oM = /\/O\s*<([0-9A-Fa-f\s]{16,128})>/.exec(dict);
    const uM = /\/U\s*<([0-9A-Fa-f\s]{16,128})>/.exec(dict);
    const emM = /\/EncryptMetadata\s+(true|false)/.exec(dict);
    const cfmM = /\/CFM\s*\/([A-Za-z0-9]+)/.exec(dict);
    const stmFM = /\/StmF\s*\/([A-Za-z0-9]+)/.exec(dict);
    const strFM = /\/StrF\s*\/([A-Za-z0-9]+)/.exec(dict);

    const { algo, strength } = algorithmOf(R, V, cfmM ? cfmM[1] : null);

    const ownerHash = oM ? oM[1].replace(/\s/g, "").slice(0, 64) : null;
    const userHash = uM ? uM[1].replace(/\s/g, "").slice(0, 64) : null;

    return {
      encrypted: true,
      detected: true,
      filter,
      version: V,
      revision: R,
      keyLength: Length,
      algorithm: algo,
      strength,
      encryptMetadata: emM ? (emM[1] === "true") : null,
      cfm: cfmM ? cfmM[1] : null,
      stmF: stmFM ? stmFM[1] : null,
      strF: strFM ? strFM[1] : null,
      permissions: decodePermissions(P),
      ownerHash,
      userHash,
      requiresPassword: true
    };
  }

  /** 派生摘要。 */
  function summarize(res) {
    if (!res || !res.encrypted) return { encrypted: false };
    return {
      encrypted: true,
      algorithm: res.algorithm,
      strength: res.strength,
      keyLength: res.keyLength,
      revision: res.revision,
      allowedCount: res.permissions ? res.permissions.allowedCount : 0,
      totalPerms: res.permissions ? res.permissions.total : 0
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /** 生成 Markdown 报告。 */
  function toMarkdown(res, opts) {
    opts = opts || {};
    if (!res || !res.encrypted) return "# PDF 加密检测\n\n（未发现加密 / 无 /Encrypt）\n";
    const lines = ["# " + (opts.title || "PDF 加密检测"), ""];
    lines.push(`- 加密：**是**（算法 ${res.algorithm} · 强度 ${res.strength}）`);
    lines.push(`- 过滤器 /Filter：${res.filter || "—"} ｜ 版本 V=${res.version != null ? res.version : "—"} 修订 R=${res.revision != null ? res.revision : "—"} ｜ 密钥长度 ${res.keyLength != null ? res.keyLength + " bit" : "—"}`);
    if (res.cfm) lines.push(`- 加密方式 /CFM：${res.cfm} ｜ 流过滤 /StmF=${res.stmF || "—"} 串过滤 /StrF=${res.strF || "—"}`);
    lines.push(`- 元数据加密：<span>${res.encryptMetadata == null ? "—" : (res.encryptMetadata ? "是" : "否")}</span>`);
    lines.push(`- 打开门槛：需密码（用户或所有者密码均可解锁）`);
    lines.push("");
    lines.push("## 权限清单（/P）");
    if (res.permissions && res.permissions.items) {
      for (const p of res.permissions.items) {
        lines.push(`- [${p.allowed ? "✅" : "⛔"}] ${p.label}`);
      }
      lines.push(`- 允许项：${res.permissions.allowedCount}/${res.permissions.total}`);
    }
    if (res.ownerHash) lines.push("");
    if (res.ownerHash) lines.push(`- 所有者哈希 /O（预览）：${res.ownerHash.slice(0, 32)}…`);
    if (res.userHash) lines.push(`- 用户哈希 /U（预览）：${res.userHash.slice(0, 32)}…`);
    return lines.join("\n");
  }

  /** 生成 HTML 片段（权限清单 + 元信息）。 */
  function toHtml(res) {
    if (!res || !res.encrypted) return "<div class='enc-empty'>（未检测到加密）</div>";
    const meta =
      `<div style="padding:4px 8px;font-size:13px;color:#333">` +
      `算法 <b>${escapeHtml(res.algorithm)}</b>（强度 ${escapeHtml(res.strength)}）｜ 密钥 ${res.keyLength != null ? res.keyLength + "bit" : "—"} ｜ R=${res.revision != null ? res.revision : "—"}` +
      `｜ 元数据加密：${res.encryptMetadata == null ? "—" : (res.encryptMetadata ? "是" : "否")}` +
      `</div>`;
    const permRows = (res.permissions && res.permissions.items || []).map(p =>
      `<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #eee;font-size:13px">` +
      `<span>${escapeHtml(p.label)}</span>` +
      `<span style="color:${p.allowed ? "#15803d" : "#b91c1c"};font-weight:600">${p.allowed ? "✅ 允许" : "⛔ 禁止"}</span></div>`
    ).join("");
    return meta + `<div style="margin-top:6px;border:1px solid #eee;border-radius:6px">${permRows}</div>`;
  }

  const Api = {
    bytesToString, sliceDict, decodePermissions, algorithmOf,
    parseEncryption, summarize, toMarkdown, toHtml,
    _PERM_DEFS: PERM_DEFS
  };
  OS.PdfEncrypt = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
