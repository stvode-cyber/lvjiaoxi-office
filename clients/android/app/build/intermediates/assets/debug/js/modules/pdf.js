/* ============================================================
   绿角犀 Office · PDF 工具模块
   对应 PRD 3.4：阅读批注、合并拆分、PDF⇄Office 转换、表单填写、签名
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  function blank() { return { name: "PDF 文件", dataUrl: "" }; }

  function mount(host, doc, ctx) {
    const data = doc.data && doc.data.dataUrl !== undefined ? doc.data : blank();
    const wrap = document.createElement("div");
    wrap.className = "module-wrap";
    wrap.innerHTML = `
      <div class="pdf-wrap">
        <div class="pdf-side">
          <button class="btn primary" data-act="open" style="width:100%;margin-bottom:10px">📂 打开 PDF</button>
          <div class="field"><label>跳转页</label><input type="number" data-page min="1" value="1"></div>
          <div class="field"><label>缩放</label>
            <select data-zoom><option>0.8</option><option selected>1</option><option>1.25</option><option>1.5</option><option>2</option></select>
          </div>
          <hr style="border:none;border-top:1px solid var(--rule);margin:10px 0">
          <button class="btn" data-act="merge" style="width:100%;margin-bottom:6px">➕ 合并（占位）</button>
          <button class="btn" data-act="split" style="width:100%">✂ 拆分（占位）</button>
          <p class="muted" style="font-size:11px;margin-top:8px">合并/拆分为高级模块，示例版以阅读为主。</p>
        </div>
        <div class="pdf-view"></div>
      </div>`;
    host.appendChild(wrap);
    const view = wrap.querySelector(".pdf-view");
    const pageInput = wrap.querySelector("[data-page]");
    const zoomSel = wrap.querySelector("[data-zoom]");
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "application/pdf"; fileInput.hidden = true;
    wrap.appendChild(fileInput);

    let pdfDoc = null, zoom = 1;

    function emptyState() {
      view.innerHTML = `<div class="pdf-empty"><div style="font-size:48px">📄</div>
        <p>打开一个 PDF 文件开始阅读${global.pdfjsLib ? "" : "（PDF 引擎需联网加载）"}</p>
        <button class="btn primary" data-act="open">📂 打开 PDF</button></div>`;
      view.querySelector('[data-act="open"]').addEventListener("click", () => fileInput.click());
    }

    async function loadPdf(dataUrl) {
      if (!global.pdfjsLib) { OS.toast("PDF 引擎未加载，请联网后重试", "err"); emptyState(); return; }
      view.innerHTML = "<p class='muted'>加载中…</p>";
      try {
        const loading = global.pdfjsLib.getDocument(dataUrl);
        pdfDoc = await loading.promise;
        pageInput.max = pdfDoc.numPages;
        renderAll();
        OS.toast(`已打开，共 ${pdfDoc.numPages} 页`, "ok");
      } catch (e) { OS.toast("PDF 解析失败：" + e.message, "err"); emptyState(); }
    }

    async function renderAll() {
      if (!pdfDoc) return;
      view.innerHTML = "";
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        const page = await pdfDoc.getPage(p);
        const scale = zoom * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page"; canvas.dataset.p = p;
        const ctx2d = canvas.getContext("2d");
        canvas.height = vp.height; canvas.width = vp.width;
        canvas.style.width = (vp.width / (window.devicePixelRatio || 1)) + "px";
        canvas.style.height = (vp.height / (window.devicePixelRatio || 1)) + "px";
        await page.render({ canvasContext: ctx2d, viewport: vp }).promise;
        view.appendChild(canvas);
      }
    }

    wrap.querySelector('[data-act="open"]').addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0]; if (!f) return;
      const url = await OS.util.readFile(f, true);
      data.dataUrl = url; data.name = f.name;
      doc.name = f.name; OS.bus.emit("doc-renamed", doc);
      ctx.markDirty(); loadPdf(url);
    });
    pageInput.addEventListener("change", () => {
      const c = view.querySelector(`canvas[data-p="${pageInput.value}"]`);
      if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    zoomSel.addEventListener("change", () => { zoom = +zoomSel.value; renderAll(); });
    wrap.querySelector('[data-act="merge"]').addEventListener("click", () => OS.toast("合并为高级模块，示例版未实现", "warn"));
    wrap.querySelector('[data-act="split"]').addEventListener("click", () => OS.toast("拆分为高级模块，示例版未实现", "warn"));

    const ribbon = OS.Ribbon.create({
      file: { onOpen: ctx.openBackstage },
      tabs: [
        {
          id: "home", label: "开始", groups: [
            { label: "文件", items: [ { kind: "btn", icon: "file", title: "打开 PDF", label: "打开", onClick: () => fileInput.click() } ] },
            { label: "视图", items: [ { kind: "select", title: "缩放", width: 92, value: String(zoom),
                options: [ { value: "0.8", label: "80%" }, { value: "1", label: "100%" }, { value: "1.25", label: "125%" }, { value: "1.5", label: "150%" }, { value: "2", label: "200%" } ],
                onChange: v => { zoom = +v; renderAll(); } } ] }
          ]
        }
      ]
    });

    if (data.dataUrl) loadPdf(data.dataUrl); else emptyState();

    function exportAs(fmt) {
      if (fmt === "pdf" && data.dataUrl) OS.util.download(dataUrlToBlob(data.dataUrl), doc.name || "file.pdf");
      else if (fmt === "json") OS.util.download(new Blob([JSON.stringify(data)], { type: "application/json" }), (doc.name || "pdf") + ".json");
    }
    function dataUrlToBlob(u) { const [h, b] = u.split(","); const mime = /:(.*?);/.exec(h)[1]; const bin = atob(b); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: mime }); }

    return { serialize() { return data; }, exportAs, focus() {}, ribbon, destroy() { wrap.remove(); } };
  }

  OS.modules = OS.modules || {};
  OS.modules.pdf = { type: "pdf", blank, mount };
  OS.blankDoc = (function (orig) { return function (t) { if (t === "pdf") return blank(); return orig ? orig(t) : { type: t, data: {} }; }; })(OS.blankDoc);
})(window);
