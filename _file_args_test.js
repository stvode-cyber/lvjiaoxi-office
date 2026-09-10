// 绿角犀 Office · file-args 纯逻辑测试（文件关联参数解析）
const assert = require("assert");
const { extractFilePaths, isKnownExt, KNOWN_EXT } = require("./electron/file-args");

let n = 0;
function t(name, fn) { fn(); n++; console.log("  ✓ " + name); }

t("空 argv 返回空数组", () => {
  assert.deepStrictEqual(extractFilePaths([]), []);
  assert.deepStrictEqual(extractFilePaths(undefined), []);
});

t("跳过项目根 '.' ", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", "."]), []);
});

t("开发模式 electron . a.pdf 提取到 a.pdf", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", ".", "a.pdf"]), ["a.pdf"]);
});

t("打包后双击启动 argv[1] 为绝对路径 PDF", () => {
  assert.deepStrictEqual(extractFilePaths(["绿角犀.exe", "C:\\Users\\x\\报告.pdf"]), ["C:\\Users\\x\\报告.pdf"]);
});

t("多文件并列提取", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", "a.pdf", "b.docx"]), ["a.pdf", "b.docx"]);
});

t("过滤非文档参数（.exe / 端口等）", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", "a.pdf", "b.exe", "c.txt"]), ["a.pdf", "c.txt"]);
});

t("大小写不敏感提取", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", "A.PDF", "X.OFD"]), ["A.PDF", "X.OFD"]);
});

t("跳过 '--' 与 '-' 标记", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", "--", "a.pdf"]), ["a.pdf"]);
  assert.deepStrictEqual(extractFilePaths(["exe", "-", "a.ofd"]), ["a.ofd"]);
});

t("排除未知扩展名（.zip / .png）", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", "a.pdf", "b.zip", "c.png"]), ["a.pdf"]);
});

t("覆盖所有需关联的核心格式", () => {
  const exts = [".pdf", ".ofd", ".lvjx", ".docx", ".xlsx", ".pptx", ".csv", ".txt", ".md", ".html", ".htm", ".xmind"];
  for (const e of exts) {
    assert.ok(isKnownExt("file" + e), "应识别 " + e);
    assert.ok(isKnownExt("FILE" + e.toUpperCase()), "应大小写不敏感 " + e);
  }
});

t("KNOWN_EXT 数量与预期一致", () => {
  assert.strictEqual(KNOWN_EXT.length, 12);
});

t("混合：标记 + 已知 + 未知", () => {
  const r = extractFilePaths(["exe", ".", "--", "doc.docx", "x.zip", "y.md", "z.lvjx"]);
  assert.deepStrictEqual(r, ["doc.docx", "y.md", "z.lvjx"]);
});

t("非字符串元素被忽略", () => {
  assert.deepStrictEqual(extractFilePaths(["exe", 123, null, "a.pdf", undefined]), ["a.pdf"]);
});

console.log("\nfile-args 测试通过：" + n + " 项断言");
