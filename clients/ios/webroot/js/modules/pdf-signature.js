/*
 * 绿角犀 Office · PDF 数字签名验证（OS.PdfSignature）
 * 纯逻辑零依赖模块：从 PDF 原始字节扫描所有签名对象（/Type /Sig 签名值对象，
 * 或 /FT /Sig、/Subtype /Sig 签名域），提取签名元数据用于「签名审计 / 完整性评估」。
 * 覆盖：/Filter /SubFilter /Contents(原始 CMS/PKCS7 容器字节) /Name /Reason /Location
 *       /M(签名时间) /ContactInfo /Cert(证书引用) /Reference(->/DocMDP·/UR·/FieldMDP)
 * 由 /SubFilter 推断摘要算法提示（SHA1 / SHA256(CAdES) 等）。
 * 字面串按字节解析并兼容 UTF-16BE(<FEFF>)/UTF-8/Latin-1 解码（正确处理中文签名者名等）。
 * 纯解析、不验证签名真值（无密码学库，无法校验证书链 / 哈希）；仅做元数据提取与格式识别。
 *
 * 暴露：
 *   parseSignatures(bytes) 主函数 → { signed, count, signatures[], formats, hasCertRef, hasRawContainer }
 *   summarize(res)         派生摘要
 *   toMarkdown(res, opts)  签名验证 Markdown 报告
 *   toHtml(res)            HTML 片段
 */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  function bytesToString(bytes) {
    if (!bytes) return "";
    let s = "";
    const n = bytes.length;
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i] & 0xff);
    return s;
  }

  // 子过滤器 → 摘要算法提示（依据 PDF 规范常见组合）
  const SUBFILTER_DIGEST = {
    "adbe.pkcs7.detached": "SHA256（常见）/ SHA1（旧版）",
    "adbe.pkcs7.sha1": "SHA1",
    "ETSI.CAdES.detached": "SHA256（CAdES）",
    "adbe.x509.rsa.sha1": "SHA1"
  };

  // 把字面串/十六进制串的原始字节解码为可读字符串（兼容 UTF-16BE / UTF-8 / Latin-1）
  function decodeLiteralBytes(raw) {
    if (!raw || !raw.length) return "";
    // UTF-16BE（以 <FEFF> 开头）
    if (raw.length >= 2 && raw[0] === 0xFE && raw[1] === 0xFF) {
      let s = "";
      for (let i = 2; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
      return s;
    }
    // 处理 PDF 转义序列（\n \r \t \b \f \( \) \\ \ddd）
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (b === 0x5C) { // backslash
        const n = raw[i + 1];
        if (n === 0x6E) { out.push(10); i++; }       // \n
        else if (n === 0x72) { out.push(13); i++; }   // \r
        else if (n === 0x74) { out.push(9); i++; }    // \t
        else if (n === 0x62) { out.push(8); i++; }    // \b
        else if (n === 0x66) { out.push(12); i++; }   // \f
        else if (n === 0x28) { out.push(0x28); i++; } // \(
        else if (n === 0x29) { out.push(0x29); i++; } // \)
        else if (n === 0x5C) { out.push(0x5C); i++; } // \\
        else if (n >= 0x30 && n <= 0x37) {            // octal \ddd
          let val = n - 0x30, j = i + 2;
          if (raw[j] >= 0x30 && raw[j] <= 0x37) { val = val * 8 + (raw[j] - 0x30); j++; if (raw[j] >= 0x30 && raw[j] <= 0x37) { val = val * 8 + (raw[j] - 0x30); j++; } }
          out.push(val & 0xff); i = j - 1;
        } else { out.push(n); i++; }
      } else {
        out.push(b);
      }
    }
    // 字节优先按 UTF-8 解码（中文签名者名等）；失败回退 Latin-1
    const u8 = Uint8Array.from(out);
    try {
      const td = (typeof TextDecoder !== "undefined") ? new TextDecoder("utf-8", { fatal: false }) : null;
      if (td) return td.decode(u8);
    } catch (e) { /* fallthrough */ }
    let s = "";
    for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
    return s;
  }

  // 在 blockTxt（与 blockBytes 1:1 映射）上定位字面串/十六进制串字段，并从原始字节切片解码
  function makeLiteralFetcher(blockTxt, blockBytes) {
    return function (key) {
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
    };
  }

  function parseOne(blockBytes, idx) {
    const txt = bytesToString(blockBytes);
    const lit = makeLiteralFetcher(txt, blockBytes);
    const filterM = /\/Filter\s*\/([A-Za-z0-9.]+)/.exec(txt);
    const subM = /\/SubFilter\s*\/([A-Za-z0-9.]+)/.exec(txt);
    const subFilter = subM ? subM[1] : null;
    const contentsM = /\/Contents\s*<([0-9A-Fa-f\s]+)>/.exec(txt);
    const contentsHex = contentsM ? contentsM[1].replace(/\s/g, "") : null;
    const certM = /\/Cert\s*\[/.exec(txt);
    const refM = /\/Reference\s*\[([\s\S]*?)\]/.exec(txt);
    const refTypeM = refM ? /\/TransformMethod\s*\/([A-Za-z]+)/.exec(refM[1]) : null;
    return {
      index: idx,
      filter: filterM ? filterM[1] : null,
      subFilter,
      name: lit("/Name"),
      reason: lit("/Reason"),
      location: lit("/Location"),
      date: lit("/M"),
      contactInfo: lit("/ContactInfo"),
      hasContents: !!contentsHex,
      contentsBytes: contentsHex ? contentsHex.length / 2 : 0,
      hasCertRef: !!certM,
      referenceType: refTypeM ? refTypeM[1] : null,
      digestHint: subFilter ? (SUBFILTER_DIGEST[subFilter] || "未知") : "未知"
    };
  }

  function parseSignatures(bytes) {
    const txt = bytesToString(bytes); // 1:1 映射到 bytes 索引
    const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
    const signatures = [];
    let m, idx = 0;
    while ((m = objRe.exec(txt))) {
      const body = m[2];
      // 仅当对象显式是签名（值对象 /Type /Sig，或签名域 /FT /Sig / /Subtype /Sig）才计入
      if (!/\/Type\s*\/Sig/.test(body) && !/\/Subtype\s*\/Sig/.test(body) && !/\/FT\s*\/Sig/.test(body)) continue;
      const blockBytes = bytes.subarray(m.index, m.index + m[0].length);
      signatures.push(parseOne(blockBytes, idx++));
    }
    const formats = { pkcs7: false, cades: false, x509: false };
    for (const s of signatures) {
      if (s.subFilter === "ETSI.CAdES.detached") formats.cades = true;
      else if (s.subFilter === "adbe.x509.rsa.sha1") formats.x509 = true;
      else if (s.subFilter && s.subFilter.indexOf("pkcs7") >= 0) formats.pkcs7 = true;
    }
    return {
      signed: signatures.length > 0,
      count: signatures.length,
      signatures,
      formats,
      hasCertRef: signatures.some(s => s.hasCertRef),
      hasRawContainer: signatures.some(s => s.hasContents)
    };
  }

  function summarize(res) {
    if (!res || !res.signed) return { signed: false, count: 0 };
    return {
      signed: true,
      count: res.count,
      formats: res.formats,
      hasCertRef: res.hasCertRef,
      hasRawContainer: res.hasRawContainer
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function toMarkdown(res, opts) {
    opts = opts || {};
    if (!res || !res.signed) return "# PDF 数字签名验证\n\n（未检测到数字签名）\n";
    const lines = ["# " + (opts.title || "PDF 数字签名验证"), ""];
    lines.push(`- 签名总数：**${res.count}** ｜ 原始 CMS/PKCS7 容器：${res.hasRawContainer ? "已嵌入" : "缺失"} ｜ 证书引用：${res.hasCertRef ? "有" : "无"}`);
    lines.push(`- 格式：${[
      res.formats.pkcs7 ? "PKCS#7" : null,
      res.formats.cades ? "CAdES" : null,
      res.formats.x509 ? "X.509" : null
    ].filter(Boolean).join(" / ") || "—"}`);
    lines.push("");
    res.signatures.forEach((s, i) => {
      lines.push(`## 签名 ${i + 1}`);
      lines.push(`- 签名者 /Name：${s.name || "—"}`);
      lines.push(`- 原因 /Reason：${s.reason || "—"}`);
      lines.push(`- 地点 /Location：${s.location || "—"}`);
      lines.push(`- 时间 /M：${s.date || "—"}`);
      lines.push(`- 过滤器 /Filter：${s.filter || "—"} ｜ 子过滤器 /SubFilter：${s.subFilter || "—"}`);
      lines.push(`- 摘要算法提示：${s.digestHint}`);
      lines.push(`- 原始容器：${s.hasContents ? s.contentsBytes + " 字节" : "无"} ｜ 证书引用：${s.hasCertRef ? "有" : "无"} ｜ 引用类型：${s.referenceType || "—"}`);
      lines.push("");
    });
    lines.push("> 说明：本工具仅做元数据提取与格式识别，**不验证签名真实性**（无密码学校验，无法确认证书链/哈希有效性）。");
    return lines.join("\n");
  }

  function toHtml(res) {
    if (!res || !res.signed) return "<div class='sig-empty'>（未检测到数字签名）</div>";
    const rows = res.signatures.map((s, i) =>
      `<div style="border:1px solid #eee;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:13px">` +
      `<div style="font-weight:600;margin-bottom:4px">签名 ${i + 1}${s.name ? " · " + escapeHtml(s.name) : ""}</div>` +
      `<div style="color:#555">子过滤器：${escapeHtml(s.subFilter || "—")} ｜ 摘要：${escapeHtml(s.digestHint)}</div>` +
      `<div style="color:#555">原因：${escapeHtml(s.reason || "—")} ｜ 地点：${escapeHtml(s.location || "—")}</div>` +
      `<div style="color:#555">时间：${escapeHtml(s.date || "—")}</div>` +
      `<div style="color:${s.hasContents ? "#15803d" : "#b91c1c"}">原始容器：${s.hasContents ? s.contentsBytes + " 字节" : "缺失"} ｜ 证书引用：${s.hasCertRef ? "有" : "无"} ｜ 引用类型：${escapeHtml(s.referenceType || "—")}</div>` +
      `</div>`
    ).join("");
    return `<div style="color:#666;font-size:12px;margin-bottom:6px">共 ${res.count} 个签名（仅元数据提取，不验证真实性）</div>` + rows;
  }

  const Api = { bytesToString, decodeLiteralBytes, parseSignatures, summarize, toMarkdown, toHtml, _SUBFILTER_DIGEST: SUBFILTER_DIGEST };
  OS.PdfSignature = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
