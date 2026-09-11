/* =========================================================================
 * 绿角犀 Office · PDF 工具箱（v1.1.0 新增）
 * 为 PDF 查看器 mount 注入 ribbon tab「工具箱」，基于 window.PDFEngine
 * 暴露合并/拆分/压缩/水印/加密/OCR 等 15+ 高级操作。
 * ========================================================================= */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  /* ---------- 小工具 ---------- */

  function bytesToDataUrl(bytes, mime) {
    mime = mime || "application/pdf";
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return "data:" + mime + ";base64," + btoa(bin);
  }
  function dataUrlToBytes(url) {
    const m = (url || "").match(/^data:[^;]+;base64,(.*)$/);
    if (!m) return new Uint8Array(0);
    const bin = atob(m[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function dataUrlToBlob(url) {
    const m = (url || "").match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return null;
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }
  async function readFileAsBytes(file) {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  }
  function downloadBytes(bytes, name, mime) {
    OS.util.download(new Blob([bytes], { type: mime || "application/pdf" }), name);
  }
  function panelHtml(title, body) {
    return `
      <div class="ptb-panel">
        <div class="ptb-head">
          <span class="ptb-title">${OS.util.escapeHtml(title)}</span>
          <button class="ptb-close" title="关闭">✕</button>
        </div>
        <div class="ptb-body">${body}</div>
      </div>`;
  }

  /* ---------- 参数面板 ---------- */
  function openPanel(title, bodyHtml) {
    const ov = document.createElement("div");
    ov.className = "ptb-overlay";
    ov.innerHTML = panelHtml(title, bodyHtml);
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector(".ptb-close").onclick = close;
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    // Esc
    const esc = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } };
    document.addEventListener("keydown", esc);
    return ov;
  }

  /* ---------- 构建 ribbon tab ---------- */
  // ctx 由 pdf.js 的 mount 传入，其中包含：
  //   data: { dataUrl, annotations, name }
  //   doc: { name }
  //   dataUrlToBytes / openPdfBytes / ctx.markDirty / ctx.saveNow / ctx.openBackstage
  function buildTab(args) {
    const data = args.data;
    const doc = args.doc;
    const dataUrlToBytes = args.dataUrlToBytes;
    const openPdfBytes = args.openPdfBytes;
    const markDirty = args.markDirty;

    function ensureEngine() {
      if (!globalThis.PDFEngine) { OS.toast("PDFEngine 未加载（刷新页面后重试）", "err"); return null; }
      return globalThis.PDFEngine;
    }
    function ensureOpen() {
      if (!data.dataUrl) { OS.toast("请先打开一个 PDF", "warn"); return null; }
      return dataUrlToBytes(data.dataUrl);
    }

    return {
      id: "tools", label: "工具箱", groups: [

        /* ----- 合并 ----- */
        { label: "合并", items: [
          { kind: "btn", icon: "merge", title: "将当前文档 + 多选的 PDF 文件合并为一个", label: "合并文档", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const input = document.createElement("input");
              input.type = "file"; input.multiple = true; input.accept = "application/pdf";
              input.onchange = async () => {
                const files = Array.from(input.files || []);
                if (!files.length) return;
                OS.toast("合并 " + (files.length + 1) + " 个 PDF …");
                const parts = [cur];
                for (const f of files) parts.push(await readFileAsBytes(f));
                try {
                  const merged = await eng.mergePDFs(parts, (p) => OS.toast("合并中 " + Math.round(p * 100) + "%"));
                  await openPdfBytes(merged, (doc.name || "合并") + "_合并.pdf");
                  OS.toast("✅ 合并完成：" + (files.length + 1) + " 个 PDF", "ok");
                } catch (e) { OS.toast("合并失败：" + e.message, "err"); }
              };
              input.click();
            } }
        ] },

        /* ----- 拆分 ----- */
        { label: "拆分", items: [
          { kind: "btn", icon: "split", title: "按指定页码范围拆分（如 1-2, 3-5, 6-）", label: "按范围", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const count = await eng.pageCount(cur);
              const ov = openPanel("按范围拆分 PDF", `
                <p class="muted" style="font-size:12px;margin:0 0 8px">共 ${count} 页。格式：1-2,3-5,6-8,9-（最后一页可用 - 表示）</p>
                <input type="text" id="ptb-ranges" placeholder="如 1-2,3-5,6-" style="width:100%;padding:6px">
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn primary" id="ptb-split-do">拆分并下载</button>
                  <button class="btn" id="ptb-split-cancel">取消</button>
                </div>`);
              ov.querySelector("#ptb-split-cancel").onclick = () => ov.remove();
              ov.querySelector("#ptb-split-do").onclick = async () => {
                const raw = ov.querySelector("#ptb-ranges").value.trim();
                ov.remove();
                if (!raw) { OS.toast("请输入页码范围", "warn"); return; }
                try {
                  OS.toast("拆分中 …");
                  const outs = await eng.splitByCount(cur, { ranges: raw });
                  outs.forEach((out, i) => {
                    const name = (doc.name || "part") + "_" + (i + 1) + ".pdf";
                    downloadBytes(out, name);
                  });
                  OS.toast("✅ 已拆分 " + outs.length + " 个文件（已下载）", "ok");
                } catch (e) { OS.toast("拆分失败：" + e.message, "err"); }
              };
            } },
          { kind: "btn", icon: "file", title: "按目录大纲书签自动拆分（每个顶层书签一个文件）", label: "按大纲", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              try {
                OS.toast("按大纲拆分中 …");
                const outs = await eng.splitByOutline(cur);
                if (!outs.length) { OS.toast("该 PDF 无可拆分的大纲书签", "info"); return; }
                outs.forEach((out, i) => downloadBytes(out, (doc.name || "split") + "_" + (i + 1) + ".pdf"));
                OS.toast("✅ 按大纲拆分出 " + outs.length + " 个文件", "ok");
              } catch (e) { OS.toast("拆分失败：" + e.message, "err"); }
            } },
          { kind: "btn", icon: "trash", title: "检测并删除完全空白页（阈值可调）", label: "删空白页", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              try {
                OS.toast("检测空白页 …");
                const blank = await eng.detectBlankPages(cur);
                if (!blank.length) { OS.toast("未发现空白页", "info"); return; }
                const ov = openPanel("删除空白页", `
                  <p style="margin:0 0 10px">检测到 ${blank.length} 页空白页（页码：${blank.join(", ")}）</p>
                  <div style="display:flex;gap:8px">
                    <button class="btn primary" id="ptb-rm-blank">删除并打开结果</button>
                    <button class="btn" id="ptb-rm-blank-c">取消</button>
                  </div>`);
                ov.querySelector("#ptb-rm-blank-c").onclick = () => ov.remove();
                ov.querySelector("#ptb-rm-blank").onclick = async () => {
                  ov.remove();
                  OS.toast("删除空白页 …");
                  const result = await eng.removeBlankPages(cur);
                  await openPdfBytes(result, (doc.name || "doc") + "_删空白.pdf");
                  OS.toast("✅ 已删除 " + blank.length + " 页", "ok");
                };
              } catch (e) { OS.toast("操作失败：" + e.message, "err"); }
            } }
        ] },

        /* ----- 页面操作 ----- */
        { label: "页面操作", items: [
          { kind: "btn", icon: "rotate", title: "批量旋转指定页（90°/180°/270°）", label: "旋转页面", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("旋转页面", `
                <label>页码范围（留空=全部）</label>
                <input id="ptb-rot-range" placeholder="如 1,3-5" style="width:100%;padding:6px;margin-bottom:8px">
                <label>角度</label>
                <select id="ptb-rot-angle" style="width:100%;padding:6px">
                  <option value="90">90°（顺时针）</option>
                  <option value="180">180°</option>
                  <option value="270">270°（逆时针）</option>
                </select>
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn primary" id="ptb-rot-do">旋转</button>
                  <button class="btn" id="ptb-rot-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-rot-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-rot-do").onclick = async () => {
                const range = ov.querySelector("#ptb-rot-range").value.trim();
                const angle = +ov.querySelector("#ptb-rot-angle").value;
                ov.remove();
                try {
                  OS.toast("旋转中 …");
                  const result = await eng.rotatePages(cur, range || undefined, angle);
                  await openPdfBytes(result, (doc.name || "doc") + "_旋转.pdf");
                  OS.toast("✅ 旋转完成", "ok");
                } catch (e) { OS.toast("旋转失败：" + e.message, "err"); }
              };
            } },
          { kind: "btn", icon: "trash", title: "删除指定页码范围", label: "删除页面", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("删除页面", `
                <p class="muted" style="font-size:12px;margin:0 0 8px">格式：单页 5，范围 3-6，混合 1,3-5,7</p>
                <input id="ptb-del-range" placeholder="如 1,3-5,7" style="width:100%;padding:6px">
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn primary" id="ptb-del-do">删除并打开</button>
                  <button class="btn" id="ptb-del-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-del-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-del-do").onclick = async () => {
                const range = ov.querySelector("#ptb-del-range").value.trim(); ov.remove();
                if (!range) { OS.toast("请输入页码", "warn"); return; }
                try {
                  OS.toast("删除中 …");
                  const pages = eng.parsePageRanges(range, await eng.pageCount(cur));
                  const result = await eng.deletePages(cur, pages);
                  await openPdfBytes(result, (doc.name || "doc") + "_删页.pdf");
                  OS.toast("✅ 已删除 " + pages.length + " 页", "ok");
                } catch (e) { OS.toast("删除失败：" + e.message, "err"); }
              };
            } },
          { kind: "btn", icon: "move", title: "重排页面顺序（如 3,1,2 把第3页移到第1位）", label: "重排页面", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const count = await eng.pageCount(cur);
              const ov = openPanel("重排页面", `
                <p class="muted" style="font-size:12px;margin:0 0 8px">当前 ${count} 页。输入新顺序，如 3,1,2 表示第3页移到首位</p>
                <input id="ptb-reorder" placeholder="如 3,1,2,4,5" style="width:100%;padding:6px">
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn primary" id="ptb-reorder-do">重排</button>
                  <button class="btn" id="ptb-reorder-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-reorder-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-reorder-do").onclick = async () => {
                const raw = ov.querySelector("#ptb-reorder").value.trim(); ov.remove();
                try {
                  OS.toast("重排中 …");
                  const result = await eng.reorderPages(cur, raw);
                  await openPdfBytes(result, (doc.name || "doc") + "_重排.pdf");
                  OS.toast("✅ 重排完成", "ok");
                } catch (e) { OS.toast("重排失败：" + e.message, "err"); }
              };
            } }
        ] },

        /* ----- 水印 ----- */
        { label: "水印", items: [
          { kind: "btn", icon: "font-size", title: "添加文字水印（可设颜色/角度/透明度/字号）", label: "文字水印", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("添加文字水印", `
                <label>水印文字</label>
                <input id="ptb-wm-text" value="绿角犀 Office" style="width:100%;padding:6px;margin-bottom:8px">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                  <div><label>字号</label><input id="ptb-wm-size" type="number" value="48" style="width:100%;padding:4px"></div>
                  <div><label>颜色</label><input id="ptb-wm-color" type="color" value="#cccccc" style="width:100%"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
                  <div><label>角度</label><input id="ptb-wm-angle" type="number" value="30" style="width:100%;padding:4px"></div>
                  <div><label>透明度</label><input id="ptb-wm-opacity" type="number" min="0.1" max="1" step="0.1" value="0.3" style="width:100%;padding:4px"></div>
                </div>
                <label style="margin-top:8px;display:block">页码范围（留空=全部）</label>
                <input id="ptb-wm-range" placeholder="如 1-3,5" style="width:100%;padding:6px">
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn primary" id="ptb-wm-do">添加水印</button>
                  <button class="btn" id="ptb-wm-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-wm-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-wm-do").onclick = async () => {
                const opts = {
                  text: ov.querySelector("#ptb-wm-text").value || "绿角犀 Office",
                  fontSize: +ov.querySelector("#ptb-wm-size").value || 48,
                  color: ov.querySelector("#ptb-wm-color").value,
                  angleDeg: +ov.querySelector("#ptb-wm-angle").value || 30,
                  opacity: +ov.querySelector("#ptb-wm-opacity").value || 0.3,
                  pages: ov.querySelector("#ptb-wm-range").value.trim() || undefined
                };
                ov.remove();
                try {
                  OS.toast("添加水印 …");
                  const result = await eng.addTextWatermark(cur, opts);
                  await openPdfBytes(result, (doc.name || "doc") + "_水印.pdf");
                  OS.toast("✅ 水印已添加", "ok");
                } catch (e) { OS.toast("水印失败：" + e.message, "err"); }
              };
            } },
          { kind: "btn", icon: "page-setup", title: "批量添加页码（位置/格式可配置）", label: "添加页码", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("添加页码", `
                <label>位置</label>
                <select id="ptb-pn-pos" style="width:100%;padding:6px;margin-bottom:8px">
                  <option value="bottom-right">右下角</option>
                  <option value="bottom-center">底部居中</option>
                  <option value="bottom-left">左下角</option>
                  <option value="top-right">右上角</option>
                  <option value="top-center">顶部居中</option>
                  <option value="top-left">左上角</option>
                </select>
                <label>格式</label>
                <select id="ptb-pn-fmt" style="width:100%;padding:6px;margin-bottom:8px">
                  <option value="1">{current}/{total}</option>
                  <option value="2">第 {current} 页 / 共 {total} 页</option>
                  <option value="3">- {current} -</option>
                  <option value="4">Page {current} of {total}</option>
                </select>
                <div style="display:flex;gap:8px">
                  <button class="btn primary" id="ptb-pn-do">添加页码</button>
                  <button class="btn" id="ptb-pn-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-pn-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-pn-do").onclick = async () => {
                const pos = ov.querySelector("#ptb-pn-pos").value;
                const fmtIdx = +ov.querySelector("#ptb-pn-fmt").value;
                ov.remove();
                try {
                  OS.toast("添加页码 …");
                  const result = await eng.addPageNumbers(cur, { position: pos, formatIndex: fmtIdx });
                  await openPdfBytes(result, (doc.name || "doc") + "_页码.pdf");
                  OS.toast("✅ 页码已添加", "ok");
                } catch (e) { OS.toast("页码失败：" + e.message, "err"); }
              };
            } }
        ] },

        /* ----- 压缩 / 加密 ----- */
        { label: "压缩", items: [
          { kind: "btn", icon: "download", title: "重序列化压缩 PDF（清理冗余对象 / 压缩流）", label: "一键压缩", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const sizeKB = Math.round(cur.length / 1024);
              const ov = openPanel("压缩 PDF", `
                <p style="margin:0 0 10px">当前：${sizeKB} KB。压缩将重建 PDF 结构并尝试重压缩图像/流。</p>
                <div style="display:flex;gap:8px">
                  <button class="btn primary" id="ptb-comp-do">压缩并打开</button>
                  <button class="btn" id="ptb-comp-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-comp-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-comp-do").onclick = async () => {
                ov.remove();
                try {
                  OS.toast("压缩中 …");
                  const result = await eng.compressPDF(cur, {}, (p) => OS.toast("压缩 " + Math.round(p * 100) + "%"));
                  const newKB = Math.round(result.length / 1024);
                  OS.toast("✅ 压缩：" + sizeKB + " KB → " + newKB + " KB", "ok");
                  await openPdfBytes(result, (doc.name || "doc") + "_压缩.pdf");
                } catch (e) { OS.toast("压缩失败：" + e.message, "err"); }
              };
            } }
        ] },

        { label: "加密", items: [
          { kind: "btn", icon: "lock", title: "给 PDF 加密码（AES-256，可分别设打开密码 / 权限密码）", label: "加密 PDF", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("加密 PDF", `
                <p class="muted" style="font-size:12px;margin:0 0 8px">AES-256 加密。用户密码=打开密码；所有者密码=权限控制（打印/复制/编辑）</p>
                <label>打开密码（留空则不设）</label>
                <input id="ptb-enc-user" type="password" placeholder="用户打开密码" style="width:100%;padding:6px;margin-bottom:8px">
                <label>所有者密码（权限控制，可与用户密码相同）</label>
                <input id="ptb-enc-owner" type="password" placeholder="所有者密码" style="width:100%;padding:6px;margin-bottom:8px">
                <div style="display:flex;gap:8px">
                  <button class="btn primary" id="ptb-enc-do">加密并下载</button>
                  <button class="btn" id="ptb-enc-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-enc-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-enc-do").onclick = async () => {
                const userPwd = ov.querySelector("#ptb-enc-user").value;
                const ownerPwd = ov.querySelector("#ptb-enc-owner").value || userPwd;
                ov.remove();
                if (!ownerPwd) { OS.toast("请至少设一个密码", "warn"); return; }
                try {
                  OS.toast("加密中 …");
                  const result = await eng.encryptPDF(cur, { userPassword: userPwd || null, ownerPassword: ownerPwd });
                  downloadBytes(result, (doc.name || "doc") + "_加密.pdf");
                  OS.toast("✅ 加密完成（AES-256）", "ok");
                } catch (e) { OS.toast("加密失败：" + e.message, "err"); }
              };
            } },
          { kind: "btn", icon: "unlock", title: "去除 PDF 打开密码（需提供原密码）", label: "解密 PDF", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("解密 PDF", `
                <p class="muted" style="font-size:12px;margin:0 0 8px">需输入原打开密码</p>
                <input id="ptb-dec-pwd" type="password" placeholder="原密码" style="width:100%;padding:6px">
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn primary" id="ptb-dec-do">解密并打开</button>
                  <button class="btn" id="ptb-dec-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-dec-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-dec-do").onclick = async () => {
                const pwd = ov.querySelector("#ptb-dec-pwd").value; ov.remove();
                try {
                  OS.toast("解密中 …");
                  const result = await eng.decryptPDF(cur, pwd);
                  await openPdfBytes(result, (doc.name || "doc") + "_解密.pdf");
                  OS.toast("✅ 解密完成", "ok");
                } catch (e) { OS.toast("解密失败（密码错误？）：" + e.message, "err"); }
              };
            } }
        ] },

        /* ----- OCR / 转换 ----- */
        { label: "OCR 识别", items: [
          { kind: "btn", icon: "ai", title: "OCR 文字识别（Tesseract.js，首次需加载语言包）", label: "OCR 识别", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("OCR 文字识别", `
                <p class="muted" style="font-size:12px;margin:0 0 8px">需要联网加载 Tesseract 语言包（中文 chi_sim + 英文 eng），首次约 10MB</p>
                <label>页码范围（留空=全部）</label>
                <input id="ptb-ocr-range" placeholder="如 1-3,5" style="width:100%;padding:6px;margin-bottom:8px">
                <label>语言</label>
                <select id="ptb-ocr-lang" style="width:100%;padding:6px;margin-bottom:8px">
                  <option value="eng">English</option>
                  <option value="chi_sim">简体中文</option>
                  <option value="chi_sim+eng" selected>中文 + 英文</option>
                </select>
                <div style="display:flex;gap:8px">
                  <button class="btn primary" id="ptb-ocr-do">开始 OCR（生成可搜索 PDF）</button>
                  <button class="btn" id="ptb-ocr-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-ocr-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-ocr-do").onclick = async () => {
                const range = ov.querySelector("#ptb-ocr-range").value.trim();
                const lang = ov.querySelector("#ptb-ocr-lang").value; ov.remove();
                try {
                  OS.toast("OCR 加载引擎 …");
                  const result = await eng.makeSearchablePDF(cur, {
                    languages: lang,
                    pages: range || undefined,
                    onProgress: (p) => OS.toast("OCR " + Math.round(p * 100) + "%")
                  });
                  await openPdfBytes(result, (doc.name || "doc") + "_OCR.pdf");
                  OS.toast("✅ OCR 完成：已生成可搜索 PDF", "ok");
                } catch (e) { OS.toast("OCR 失败：" + e.message, "err"); }
              };
            } }
        ] },

        { label: "转换导出", items: [
          { kind: "btn", icon: "docx", title: "PDF → Word（基于 pdf-lib 重排版，版面还原有限）", label: "导出 Word", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              try {
                OS.toast("导出 Word …");
                const docx = await eng.exportToWord(cur);
                OS.util.download(new Blob([docx], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), (doc.name || "doc") + ".docx");
                OS.toast("✅ 已导出 .docx", "ok");
              } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
            } },
          { kind: "btn", icon: "xlsx", title: "PDF → Excel（检测表格结构）", label: "导出 Excel", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              try {
                OS.toast("导出 Excel …");
                const xlsx = await eng.exportToExcel(cur);
                OS.util.download(new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), (doc.name || "doc") + ".xlsx");
                OS.toast("✅ 已导出 .xlsx", "ok");
              } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
            } },
          { kind: "btn", icon: "image", title: "PDF → 图片（每页一张 PNG）", label: "导出图片", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              try {
                OS.toast("渲染为图片 …");
                const imgs = await eng.pdfToImages(cur);
                imgs.forEach((img, i) => OS.util.download(img, (doc.name || "page") + "_" + (i + 1) + ".png"));
                OS.toast("✅ 已导出 " + imgs.length + " 张 PNG", "ok");
              } catch (e) { OS.toast("导出失败：" + e.message, "err"); }
            } }
        ] },

        /* ----- 实用工具 ----- */
        { label: "实用", items: [
          { kind: "btn", icon: "page-setup", title: "给每页设置纯色/图片背景", label: "页面背景", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              const ov = openPanel("设置页面背景", `
                <label>背景颜色</label>
                <input id="ptb-bg-color" type="color" value="#ffffff" style="width:100%;margin-bottom:8px">
                <p class="muted" style="font-size:11px">设为纯白可减轻扫描件偏黄底</p>
                <div style="display:flex;gap:8px">
                  <button class="btn primary" id="ptb-bg-do">应用并打开</button>
                  <button class="btn" id="ptb-bg-c">取消</button>
                </div>`);
              ov.querySelector("#ptb-bg-c").onclick = () => ov.remove();
              ov.querySelector("#ptb-bg-do").onclick = async () => {
                const color = ov.querySelector("#ptb-bg-color").value; ov.remove();
                try {
                  OS.toast("设置背景 …");
                  const result = await eng.setPageBackground(cur, { type: "color", color });
                  await openPdfBytes(result, (doc.name || "doc") + "_背景.pdf");
                  OS.toast("✅ 已应用", "ok");
                } catch (e) { OS.toast("失败：" + e.message, "err"); }
              };
            } },
          { kind: "btn", icon: "check", title: "诊断 PDF 结构完整性（头/尾/xref/trailer/悬挂引用）", label: "结构诊断", onClick: async () => {
              const eng = ensureEngine(); if (!eng) return;
              const cur = ensureOpen(); if (!cur) return;
              try {
                OS.toast("诊断中 …");
                const res = await eng.diagnoseCorruption(cur);
                const md = "## PDF 结构诊断报告\n\n" +
                  "- 页面数: " + (await eng.pageCount(cur)) + "\n" +
                  "- 诊断结果: " + (res.ok ? "✅ 正常" : "⚠ 发现问题") + "\n" +
                  (res.details || "").split("\n").map(l => "- " + l).join("\n");
                OS.util.download(new Blob([md], { type: "text/markdown" }), (doc.name || "doc") + "_诊断报告.md");
                OS.toast("✅ 诊断完成，已下载报告", "ok");
              } catch (e) { OS.toast("诊断失败：" + e.message, "err"); }
            } },
          { kind: "btn", icon: "node-child", title: "PDF 文本语义对比（找出两版 PDF 的增/删/未变段落）", label: "文档对比", onClick: () => {
              // 复用现有 showDocDiff（在 anno tab 里已经有了）
              OS.toast("请切换到「批注」Tab → 「文档对比」", "info");
            } }
        ] }
      ]
    };
  }

  OS.PdfToolbox = { buildTab };
})(globalThis);
