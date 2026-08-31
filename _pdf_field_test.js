/* 绿角犀 Office · PDF 表单字段 回归测试（纯逻辑，node 直跑）
   验证 OS.PdfAnno 的 textfield / checkbox 两类表单字段：落库、文字/checked 存储、
   JSON 往返、stats.byType、坏数据容错。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-anno.js");
  const Anno = global.OS.PdfAnno;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  ok("OS.PdfAnno 已挂载且含表单类型颜色", !!Anno && !!Anno.COLORS.textfield && !!Anno.COLORS.checkbox);

  // —— textfield 落库与文字存储 ——
  const arr = [];
  const tf = Anno.add(arr, { page: 1, type: "textfield", x: 0.1, y: 0.1, w: 0.3, h: 0.05, text: "张三" });
  ok("add textfield 返回对象且生成 id", tf && typeof tf.id === "string" && tf.id.length > 0);
  ok("add textfield 落库", arr.length === 1 && arr[0].type === "textfield");
  ok("textfield 存文字", tf.text === "张三");
  ok("textfield 默认颜色取 COLORS", tf.color === Anno.COLORS.textfield);
  ok("textfield 存归一化矩形", tf.x === 0.1 && tf.y === 0.1 && tf.w === 0.3 && tf.h === 0.05);

  // —— textfield 无 text 兜底为空串 ——
  const tf2 = Anno.add(arr, { page: 1, type: "textfield", x: 0.2, y: 0.2, w: 0.3, h: 0.05 });
  ok("textfield 缺 text 兜底空串", tf2.text === "");

  // —— checkbox 落库与 checked 存储 ——
  const cb = Anno.add(arr, { page: 2, type: "checkbox", x: 0.5, y: 0.5, w: 0.03, h: 0.03, checked: true });
  ok("add checkbox 落库", arr.length === 3 && cb.type === "checkbox");
  ok("checkbox 存 checked=true", cb.checked === true);
  ok("checkbox 默认颜色取 COLORS", cb.color === Anno.COLORS.checkbox);
  ok("checkbox 存见方归一化", cb.w === 0.03 && cb.h === 0.03);

  // —— checkbox checked 缺省为 false ——
  const cb2 = Anno.add(arr, { page: 2, type: "checkbox", x: 0.6, y: 0.6, w: 0.03, h: 0.03 });
  ok("checkbox 缺 checked 兜底 false", cb2.checked === false);

  // —— checkbox checked 脏数据容错（真值/字符串）——
  const cbBad = Anno.add(arr, { page: 3, type: "checkbox", x: 0, y: 0, w: 0.03, h: 0.03, checked: "yes" });
  ok("checkbox checked 脏值经 !! 收敛为 true", cbBad.checked === true);

  // —— update 表单字段 ——
  ok("update textfield 文字生效", Anno.update(arr, tf.id, { text: "李四" }).text === "李四");
  ok("update checkbox checked 生效", Anno.update(arr, cb.id, { checked: false }).checked === false);

  // —— getPage / stats ——
  ok("getPage page2 含 2 个 checkbox", Anno.getPage(arr, 2).length === 2);
  const st = Anno.stats(arr);
  ok("stats.total=5", st.total === 5);
  ok("stats.byType.textfield=2", st.byType.textfield === 2);
  ok("stats.byType.checkbox=3", st.byType.checkbox === 3);

  // —— 序列化往返（含文字与 checked）——
  const arr2 = [];
  Anno.add(arr2, { page: 1, type: "textfield", x: 0.1, y: 0.1, w: 0.3, h: 0.05, text: "签名人" });
  Anno.add(arr2, { page: 1, type: "checkbox", x: 0.5, y: 0.5, w: 0.03, h: 0.03, checked: true });
  const json = Anno.toJSON(arr2);
  const back = Anno.fromJSON(json);
  ok("fromJSON 往返长度保真", back.length === 2);
  ok("fromJSON textfield 文字保真", back[0].type === "textfield" && back[0].text === "签名人");
  ok("fromJSON checkbox checked 保真", back[1].type === "checkbox" && back[1].checked === true);
  ok("fromJSON(坏串) -> []", Anno.fromJSON("{bad").length === 0);

  // —— clearPage 清表单字段 ——
  const cleared = Anno.clearPage(arr, 3);
  ok("clearPage 清第3页 checkbox", cleared === 1 && Anno.getPage(arr, 3).length === 0);

  console.log("PDF-FIELD: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
