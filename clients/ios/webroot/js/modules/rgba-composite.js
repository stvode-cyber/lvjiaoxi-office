/* RGBA 叠加合成原语（T）
   零依赖、纯逻辑、Node 可直接 require。
   提供：
   - over(dr,dg,db,da, sr,sg,sb,sa, globalAlpha)：单像素 Porter-Duff "over" 算子
   - compositeRgba(dst, src, opts)：将 src 以 over 算子合成到 dst（支持偏移/全局透明度/局部尺寸）
   - flattenPageWithOverlays(page, overlays, opts)：将若干叠加层依次合成到页面底层之上
   - solidRgba(width, height, r,g,b,a)：生成单色 RGBA 缓冲
   所有缓冲为 RGBA 顺序、长度 4*N、元素 0..255。
*/
(function (root) {
  "use strict";

  // 单像素 over（Porter-Duff "over"），alpha 以 0..255 传入；globalAlpha 0..1。
  // 返回 [r,g,b,a]。预乘 alpha 混合。
  function over(dr, dg, db, da, sr, sg, sb, sa, globalAlpha) {
    const sA = (sa / 255) * (globalAlpha == null ? 1 : globalAlpha);
    const dA = da / 255;
    const outA = sA + dA * (1 - sA);
    if (outA <= 1e-6) return [dr, dg, db, 0];
    const r = (sr / 255 * sA + dr / 255 * dA * (1 - sA)) / outA;
    const g = (sg / 255 * sA + dg / 255 * dA * (1 - sA)) / outA;
    const b = (sb / 255 * sA + db / 255 * dA * (1 - sA)) / outA;
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(outA * 255)];
  }

  // 将 src 以 over 算子合成到 dst，返回新的 Uint8ClampedArray（与 dst 同尺寸）。
  // opts.dstWidth : dst 每行像素数（用于 offset 映射，必填）
  // opts.srcWidth : src 每行像素数（默认 = dstWidth，即全幅叠加）
  // opts.srcHeight: src 行数（默认由 src.length 推导）
  // opts.offset   : {x,y} src 左上相对 dst 左上偏移（默认 {0,0}）
  // opts.alpha    : 作用于 src 的全局透明度 0..1（默认 1）
  function compositeRgba(dst, src, opts) {
    opts = opts || {};
    const n = dst.length;
    const out = new Uint8ClampedArray(n);
    out.set(dst);
    const dstW = opts.dstWidth | 0;
    if (!dstW) return out;
    const srcW = (opts.srcWidth | 0) || dstW;
    const ox = (opts.offset && opts.offset.x) | 0;
    const oy = (opts.offset && opts.offset.y) | 0;
    const ga = (opts.alpha == null ? 1 : opts.alpha);
    const dstH = (n / 4 / dstW) | 0;
    const srcH = (opts.srcHeight | 0) || ((src.length / 4 / srcW) | 0);
    for (let sy = 0; sy < srcH; sy++) {
      const dy = sy + oy;
      if (dy < 0 || dy >= dstH) continue;
      for (let sx = 0; sx < srcW; sx++) {
        const dx = sx + ox;
        if (dx < 0 || dx >= dstW) continue;
        const di = 4 * (dy * dstW + dx);
        const si = 4 * (sy * srcW + sx);
        const da = dst[di + 3] / 255;
        const sa = (src[si + 3] / 255) * ga;
        const outA = sa + da * (1 - sa);
        if (outA <= 1e-6) continue; // src 全透明：保留 dst
        const dr = dst[di], dg = dst[di + 1], db = dst[di + 2];
        const sr = src[si], sg = src[si + 1], sb = src[si + 2];
        out[di] = (sr * sa + dr * da * (1 - sa)) / outA;
        out[di + 1] = (sg * sa + dg * da * (1 - sa)) / outA;
        out[di + 2] = (sb * sa + db * da * (1 - sa)) / outA;
        out[di + 3] = outA * 255;
      }
    }
    return out;
  }

  // 将若干叠加层依次合成到页面底层之上，返回新的 Uint8ClampedArray（与 page 同尺寸）。
  // page    : 底层 RGBA 缓冲
  // overlays: [{ rgba, x, y, alpha, width, height } ...]，按数组顺序从下往上叠加
  // opts.width: page 宽度（像素），必填
  function flattenPageWithOverlays(page, overlays, opts) {
    opts = opts || {};
    const width = opts.width | 0;
    let acc = new Uint8ClampedArray(page.length);
    acc.set(page);
    if (!width || !Array.isArray(overlays)) return acc;
    for (const ov of overlays) {
      if (!ov || !ov.rgba) continue;
      acc = compositeRgba(acc, ov.rgba, {
        dstWidth: width,
        srcWidth: ov.width,
        srcHeight: ov.height,
        offset: { x: ov.x || 0, y: ov.y || 0 },
        alpha: ov.alpha == null ? 1 : ov.alpha
      });
    }
    return acc;
  }

  // 生成单色 RGBA 缓冲（默认不透明）
  function solidRgba(width, height, r, g, b, a) {
    const buf = new Uint8ClampedArray(4 * width * height);
    const av = (a == null ? 255 : a);
    for (let i = 0; i < width * height; i++) {
      buf[4 * i] = r; buf[4 * i + 1] = g; buf[4 * i + 2] = b; buf[4 * i + 3] = av;
    }
    return buf;
  }

  const api = { over, compositeRgba, flattenPageWithOverlays, solidRgba };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.OS = root.OS || {}; root.OS.RgbaComposite = api; }
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
