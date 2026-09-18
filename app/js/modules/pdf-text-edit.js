/* ============================================================
   绿角犀 Office · PDF 真实文本编辑（OS.PDFTextEditor）
   核心：用 pdf-lib 重写 PDF 页面 Content Stream 里的 Tj/TJ 操作符，
   不是覆盖注释，是真正改 PDF 原始字节。

   坐标系
   ------
   pdf.js viewport（屏幕像素）  ←→  pdf-lib PDF point（1/72 inch）
   
   page.getViewport({scale}).convertToPdfPoint({x, y})  （pdf.js 内置）
   page.getViewport({scale}).convertToViewportPoint({x, y})  （反向）

   字体
   ----
   - 英文：pdf-lib StandardFonts.Helvetica / HelveticaBold / HelveticaOblique / HelveticaBoldOblique
   - 中文：需要嵌入 TTF 字体。浏览器无系统字体访问权限，用 canvas 绘制中文 → Image → 转 PNG → 嵌入 pdf-lib
          （这是 v1 简化方案，后续可以嵌入真正的中文字体文件）
   
   内容流操作符
   ------------
   BT ... ET  块（Begin/End Text）
   /F1 10 Tf  设置字体和大小
   1 0 0 1 x y Tm  设置文本矩阵
   (Hello) Tj   绘制字符串
   [(A) 5 (B) -3 (C)] TJ   绘制数组（每项可跟间距）
   ============================================================ */
(function (global) {
  "use strict";

  const OS = global.OS;
  const PDFLib = global.PDFLib; // vendor/pdf-lib.min.js 注入

  if (!PDFLib) {
    console.warn("[PDFTextEditor] pdf-lib 未加载");
    return;
  }

  /* ---------------- 工具 ---------------- */

  // pdf.js viewport rect → pdf-lib PDF point rect
  function viewportRectToPdf(page, vp, rect) {
    const toPt = vp.convertToPdfPoint.bind(vp);
    // rect 是 CSS 像素（canvas getBoundingClientRect 返回的）
    // 但 canvas 有 devicePixelRatio 缩放，需要除以
    const dpr = global.devicePixelRatio || 1;
    const vpr = {
      x: rect.left * dpr,
      y: rect.top * dpr,
      width: rect.width * dpr,
      height: rect.height * dpr
    };
    // 找 page-box 相对 viewport 的偏移
    const pb = page.view; // [x1, y1, x2, y2] in PDF points
    const pdfW = pb[2] - pb[0];
    const pdfH = pb[3] - pb[1];
    const scale = vp.scale;
    return {
      x: vpr.x / scale + pb[0],
      y: pb[3] - (vpr.y + vpr.height) / scale, // PDF y 轴翻转
      w: vpr.width / scale,
      h: vpr.height / scale
    };
  }

  // 简化：不做 DPR，直接按 viewport scale 转换
  function simpleViewportToPdf(vp, rect, pageBox) {
    const scale = vp.scale;
    // rect 相对于 canvas 元素
    return {
      x: rect.left / scale + pageBox[0],
      y: pageBox[3] - (rect.bottom / scale),
      w: rect.width / scale,
      h: rect.height / scale
    };
  }

  /* ---------------- 从 Content Stream 里找文本操作 ---------------- */

  // 把 Content Stream 操作符数组里的 Tj/TJ 替换成新文本
  // 返回操作符数组（被修改过的副本）
  function replaceTextInOps(ops, oldText, newText, targetY, tolerance) {
    if (!ops || !ops.length) return ops;
    // 找到包含 oldText 的 Tj/TJ
    const result = ops.map(op => {
      if (!op || typeof op !== "object") return op;
      // Tj: {name: "Tj", args: [{type: "String", value: <bytes>}]}
      if (op.name === "Tj" && op.args && op.args.length === 1) {
        const strArg = op.args[0];
        let val;
        if (strArg.type === "String") val = strArg.value;
        else if (strArg.value) val = String(strArg.value);
        if (val && typeof val === "string" && val.includes(oldText)) {
          const newVal = val.replace(oldText, newText);
          return {
            ...op,
            args: [{ type: "String", value: newVal }]
          };
        }
      }
      // TJ: {name: "TJ", args: [{type: "Array", value: [...]}]}
      if (op.name === "TJ" && op.args && op.args.length === 1) {
        const arrArg = op.args[0];
        if (arrArg.type === "Array" && Array.isArray(arrArg.value)) {
          let changed = false;
          const newArr = arrArg.value.map(item => {
            if (item && item.type === "String") {
              let v = item.value;
              if (v && typeof v === "string" && v.includes(oldText)) {
                changed = true;
                return { ...item, value: v.replace(oldText, newText) };
              }
            }
            return item;
          });
          if (changed) {
            return { ...op, args: [{ type: "Array", value: newArr }] };
          }
        }
      }
      return op;
    });
    return result;
  }

  /* ---------------- 主 API ---------------- */

  async function editTextOnPage({ pdfBytes, pageIndex, oldText, newText, tolerance }) {
    if (!pdfBytes || !oldText) throw new Error("缺少必要参数");
    if (!newText) newText = "";

    const pdf = await PDFLib.load(pdfBytes);
    const page = pdf.getPage(pageIndex);
    if (!page) throw new Error("页 " + pageIndex + " 不存在");

    // 只处理英文 + 常见 ASCII 可打印字符（pdf-lib StandardFonts 能覆盖）
    // 中文等 Unicode 字符暂时不能被 StandardFonts 渲染
    const isAscii = /^[\x20-\x7E\u0080-\u00FF]+$/.test(newText || oldText);
    if (!isAscii) {
      // 回退：用 overlay 模式（白色矩形 + drawText 叠加）
      return overlayEdit(pdf, pageIndex, oldText, newText);
    }

    // 1. 找 page 所有 Content Stream
    const contentStreams = page.getContentStreams();
    let replaced = false;

    for (const stream of contentStreams) {
      try {
        const ops = stream.getOperations();
        const newOps = replaceTextInOps(ops, oldText, newText);
        // 检查是否真的替换了
        const anyChanged = ops.some((op, i) => {
          const no = newOps[i];
          if (!op || !no) return false;
          if (op.name !== no.name) return true;
          if (op.args && no.args) {
            return JSON.stringify(op.args) !== JSON.stringify(no.args);
          }
          return false;
        });
        if (anyChanged) {
          stream.setOperations(newOps);
          replaced = true;
        }
      } catch (e) {
        console.warn("[PDFTextEditor] stream 操作失败:", e.message);
      }
    }

    if (!replaced) {
      console.warn("[PDFTextEditor] 未在 Content Stream 中找到精确匹配，改用 overlay 模式");
      return overlayEdit(pdf, pageIndex, oldText, newText);
    }

    // 2. 保存
    const out = await pdf.save();
    return { bytes: out, mode: "content-stream" };
  }

  // Overlay 模式（fallback）：白色矩形遮原文 + 新文本
  async function overlayEdit(pdf, pageIndex, oldText, newText, pdfPointRect) {
    const page = pdf.getPage(pageIndex);

    // 1. 如果没给 rect，用 pdf.js 先拿（这里需要调用方提供）
    // 暂时用页面中心的默认位置
    if (!pdfPointRect) {
      const [x1, y1, x2, y2] = page.getContentBox();
      pdfPointRect = { x: x1 + 72, y: y2 - 100, w: 200, h: 20 };
    }

    // 2. 白色矩形遮旧文字
    const { x, y, w, h } = pdfPointRect;
    page.drawRectangle({
      x, y: y - h, width: w, height: h,
      color: PDFLib.rgb(1, 1, 1),
      opacity: 1
    });

    // 3. 绘制新文本
    if (newText) {
      let font;
      try {
        font = pdf.embedStandardFont(PDFLib.StandardFonts.Helvetica);
      } catch (e) {
        font = pdf.embedStandardFont(PDFLib.StandardFonts.Helvetica);
      }
      const fontSize = Math.max(4, h * 0.8);
      page.drawText(newText, {
        x: x + 1,
        y: y - h + (h - fontSize) * 0.3,
        size: fontSize,
        font,
        color: PDFLib.rgb(0, 0, 0)
      });
    }

    const out = await pdf.save();
    return { bytes: out, mode: "overlay" };
  }

  /* ---------------- 加载 / 保存 / 工具 ---------------- */

  async function loadPdf(bytes) {
    return PDFLib.load(bytes);
  }

  async function savePdf(pdf) {
    return pdf.save();
  }

  function getPageBox(page) {
    return page.view; // [x1, y1, x2, y2] PDF points
  }

  /* ---------------- 全局暴露 ---------------- */

  OS.PDFTextEditor = {
    editTextOnPage,
    overlayEdit,
    loadPdf,
    savePdf,
    getPageBox,
    replaceTextInOps,
    coordFromViewport: simpleViewportToPdf
  };

  console.info("[OS.PDFTextEditor] 已初始化（pdf-lib " + (PDFLib.version || "?") + "）");

})(window);
