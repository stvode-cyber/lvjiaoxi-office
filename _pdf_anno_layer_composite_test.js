/* 批注图层分组 + RGBA 叠加合成原语测试（T）
   验证：pdf-anno.js 的 layer/visible 模型扩展（add/stats/groupByLayer/setLayer/setVisible/
   exportToRaw/importFromRaw 闭环），以及 rgba-composite.js 的 over / compositeRgba /
   flattenPageWithOverlays / solidRgba 合成原语。
   纯逻辑、零依赖、Node 可直接跑。
*/
global.window = global;
global.OS = {};
require("./app/js/pdf-tool.js");
require("./app/js/modules/rgba-composite.js");
require("./app/js/modules/pdf-anno.js");
const A = OS.PdfAnno;
const RC = require("./app/js/modules/rgba-composite.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } }
const near = (a, b) => Math.abs(a - b) <= 1.5; // 颜色取整容差

(async () => {
  // ============ A) 批注图层分组 + 可见性（pdf-anno） ============
  const annos = [];
  const a1 = A.add(annos, { type: "note", x: 0.1, y: 0.1, text: "hi" });
  ok("add 默认 layer=default", a1.layer === "default");
  ok("add 默认 visible=true", a1.visible === true);

  const a2 = A.add(annos, { type: "highlight", x: 0, y: 0, w: 0.2, h: 0.2, layer: "审核", visible: false });
  ok("add 自定义 layer", a2.layer === "审核");
  ok("add visible=false", a2.visible === false);

  // stats
  const st = A.stats(annos);
  ok("stats.byLayer 含 default=1", st.byLayer.default === 1);
  ok("stats.byLayer 含 审核=1", st.byLayer["审核"] === 1);
  ok("stats.visibleCount=1", st.visibleCount === 1);

  // groupByLayer
  const groups = A.groupByLayer(annos);
  ok("groupByLayer 分组数=2", Object.keys(groups).length === 2);
  ok("groupByLayer default 组 1 条", groups.default.length === 1);

  // setLayer / setVisible
  const moved = A.setLayer(annos, a1.id, "终稿");
  ok("setLayer 改层", moved && moved.layer === "终稿");
  const vis = A.setVisible(annos, a2.id, true);
  ok("setVisible 置可见", vis && vis.visible === true);

  // exportToRaw 含 layer/visible
  const raw = A.exportToRaw(annos);
  ok("exportToRaw 含 layer 字段", raw.some(r => typeof r.layer === "string"));
  ok("exportToRaw 含 visible 字段", raw.some(r => typeof r.visible === "boolean"));

  // round-trip：importFromRaw 保留 layer/visible
  const imp = A.importFromRaw(raw);
  ok("import round-trip 数量一致", imp.annotations.length === annos.length);
  ok("import 保留 layer=终稿", imp.annotations.some(x => x.layer === "终稿"));
  ok("import 保留 visible 布尔", imp.annotations.every(x => typeof x.visible === "boolean"));

  // 显式验证 visible=false 分支被还原
  const imp2 = A.importFromRaw([{ type: "note", page: 1, x: 0.1, y: 0.1, w: 0, h: 0, text: "x", layer: "L", visible: false }]);
  ok("import 还原 visible=false", imp2.annotations[0].visible === false);

  // ============ B) RGBA 叠加合成原语（rgba-composite） ============
  // over：不透明源盖透明底 = 源色
  const r1 = RC.over(0, 0, 0, 0, 255, 0, 0, 255, 1);
  ok("over 不透明源盖透明底=源色", r1[0] === 255 && r1[1] === 0 && r1[2] === 0 && r1[3] === 255);
  // over：透明源盖不透明底 = 底
  const r2 = RC.over(0, 0, 0, 255, 255, 0, 0, 0, 1);
  ok("over 透明源盖不透明底=底", r2[0] === 0 && r2[1] === 0 && r2[2] === 0 && r2[3] === 255);

  // compositeRgba：全幅半透明混合
  const dst = RC.solidRgba(2, 2, 0, 0, 0, 255);   // 2x2 黑不透明
  const src = RC.solidRgba(2, 2, 255, 0, 0, 128); // 2x2 红半透明
  const out = RC.compositeRgba(dst, src, { dstWidth: 2, srcWidth: 2, alpha: 1 });
  ok("compositeRgba 同尺寸缓冲", out.length === dst.length);
  ok("compositeRgba 半透明混合 R≈128", near(out[0], 128));

  // compositeRgba：偏移叠加（小图盖大图，只影响目标区）
  const page = RC.solidRgba(4, 4, 0, 0, 0, 255);    // 4x4 黑
  const stamp = RC.solidRgba(2, 2, 0, 255, 0, 255); // 2x2 绿
  const out2 = RC.compositeRgba(page, stamp, { dstWidth: 4, srcWidth: 2, srcHeight: 2, offset: { x: 1, y: 1 }, alpha: 1 });
  ok("offset 合成 目标区变色", out2[4 * (1 * 4 + 1)] === 0 && out2[4 * (1 * 4 + 1) + 1] === 255);
  ok("offset 合成 非目标区不变", out2[0] === 0 && out2[1] === 0 && out2[3] === 255);

  // flattenPageWithOverlays：多叠加层依次合成，顶层（蓝半透）覆盖底层（红）
  const base = RC.solidRgba(2, 2, 255, 255, 255, 255); // 白
  const ov1 = RC.solidRgba(2, 2, 255, 0, 0, 255);      // 红（全幅）
  const ov2 = RC.solidRgba(2, 2, 0, 0, 255, 128);      // 蓝半透（顶层）
  const flat = RC.flattenPageWithOverlays(base, [{ rgba: ov1 }, { rgba: ov2, alpha: 1 }], { width: 2 });
  ok("flatten 多叠加层 顶层层色 B≈128", near(flat[2], 128));

  // solidRgba：单像素 + 指定 alpha
  const s = RC.solidRgba(1, 1, 10, 20, 30, 128);
  ok("solidRgba 单像素+alpha", s[0] === 10 && s[1] === 20 && s[2] === 30 && s[3] === 128);

  console.log("T 批注图层分组 + RGBA 叠加合成：" + (fail === 0 ? "通过 " + pass + " / " + (pass + fail) + "，全部通过 ✅" : "通过 " + pass + " / " + (pass + fail) + " ❌（" + fail + " 失败）"));
  process.exit(fail === 0 ? 0 : 1);
})();
