/* ============================================================
 * 绿角犀 Office · PDF OCR（扫描件转文字）v1.1.6
 * ------------------------------------------------------------
 * 技术栈：tesseract.js 7.0.0（纯 JS + WASM，零原生依赖）
 * + LazyLib 懒加载（OS.LazyLib.load("Tesseract")）
 * + DOM canvas（Electron 渲染进程天然支持，复用 pdf.js 已渲 canvas）
 * + eng + chi_sim 语言包（65 MB，vendor/tesseract/lang-data/）
 *
 * 对外：OS.PDFOCR = { recognizePage, detectScan, getLangs, recognizeCurrentPage }
 * 调用：OS.PDFOCR.recognizeCurrentPage({ lang, onProgress })
 * ============================================================ */
(function () {
  "use strict";
  const OS = (window.OS = window.OS || {});

  // Worker 单例（初始化 ~1-2s，创建后复用）
  let _worker = null;
  let _workerLang = null;
  let _workerInit = null;

  // LazyLib 已在 util.js L244 注册 Tesseract → vendor/tesseract/tesseract.min.js
  // worker.min.js 默认 fetch("lang-data/xxx.traineddata") → 相对于自身 URL
  // 所以 lang-data/ 放在 vendor/tesseract/lang-data/ 下（同级）
  const LANGS_DIR = "vendor/tesseract/lang-data";

  async function _ensureLazyTesseract() {
    if (window.Tesseract) return window.Tesseract;
    if (!OS.LazyLib) throw new Error("LazyLib 未就绪");
    return await OS.LazyLib.load("Tesseract");
  }

  async function _ensureWorker(lang) {
    const T = await _ensureLazyTesseract();
    if (_worker && _workerLang === lang) return _worker;
    if (_worker) { try { await _worker.terminate(); } catch (_) {} _worker = null; }
    if (_workerInit) { try { await _workerInit; } catch (_) {} }

    const langs = lang || "eng+chi_sim";
    console.log("[PDF-OCR] 初始化 worker, lang=" + langs + ", dir=" + LANGS_DIR);
    _workerInit = T.createWorker(langs, 1, {
      langPath: LANGS_DIR,
      logger: (m) => {
        if (m.status === "recognizing text") {
          const pct = Math.round((m.progress || 0) * 100);
          if (typeof OS.toast === "function" && pct % 25 === 0) {
            //OS.toast("OCR 识别中… " + pct + "%", "info");
          }
        }
      }
    });
    _worker = await _workerInit;
    _workerLang = langs;
    _workerInit = null;
    return _worker;
  }

  // 从 DOM 拿 pdf.js 已渲好的 canvas（比重新 rasterize pdfDoc 快 N 倍）
  function _getRenderedCanvas(pageNum) {
    if (!pageNum) return null;
    return document.querySelector('.pdf-page[data-p="' + pageNum + '"]');
  }

  // 核心：识别指定页（pdf.js 已渲 canvas 或 page 对象）
  async function recognizePage(opts) {
    opts = opts || {};
    const lang = opts.lang || "eng+chi_sim";

    let canvas = opts.canvas;
    // 如果没直接给 canvas，看有没有 pageNum（DOM 里渲好的）
    if (!canvas && opts.pageNum) canvas = _getRenderedCanvas(opts.pageNum);
    // 如果还没有，看有没有 page 对象（pdf.js page 需重新 rasterize）
    if (!canvas && opts.page) {
      const page = opts.page;
      const scale = opts.scale || 2.5;
      const viewport = page.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    }
    if (!canvas) throw new Error("找不到可识别的 canvas（需 page / canvas / pageNum 之一）");

    console.log("[PDF-OCR] 开始 OCR, canvas=" + canvas.width + "x" + canvas.height + ", lang=" + lang);
    const worker = await _ensureWorker(lang);
    const { data } = await worker.recognize(canvas);

    console.log("[PDF-OCR] 完成, 文本=" + (data.text || "").length + "字, 置信=" + (data.confidence || "?"));
    return {
      text: (data.text || "").trim(),
      confidence: data.confidence,
      blocks: data.blocks || [],
      lines: (data.lines || []).map(l => ({ text: l.text, bbox: l.bbox }))
    };
  }

  // 便捷：OCR 当前可见页（需要外部告知当前 pageNum）
  // 约定：调用方把 currentPageNum 存到 window.__pdfCurrentPageNum
  async function recognizeCurrentPage(opts) {
    opts = opts || {};
    const p = opts.pageNum || window.__pdfCurrentPageNum;
    if (!p) throw new Error("未知当前页码");
    return recognizePage(Object.assign({}, opts, { pageNum: p }));
  }

  // 异步检测某页是否疑似扫描件（无文字层 spans）
  async function detectScan(page) {
    if (!page || !page.getTextContent) return false;
    try {
      const tc = await page.getTextContent();
      const spans = (tc.items || []).filter(it => it.str && it.str.trim());
      return spans.length < 2;
    } catch (_) { return false; }
  }

  function getLangs() { return ["eng", "chi_sim", "eng+chi_sim"]; }

  function destroy() {
    if (_worker) { try { _worker.terminate(); } catch (_) {} _worker = null; _workerLang = null; _workerInit = null; }
  }

  const api = { recognizePage, recognizeCurrentPage, detectScan, getLangs, destroy };
  OS.PDFOCR = api;
})();
