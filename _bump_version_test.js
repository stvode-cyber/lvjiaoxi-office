/* 绿角犀 Office · 版本注入脚本回归测试（node 独立运行，非 jsdom 页面套件）
 * 运行：node _bump_version_test.js
 * 校验 scripts/bump-version.js 的纯函数与 run() 落盘行为。 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const v = require("./scripts/bump-version.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.error("  FAIL " + name); }
}

/* 1) 纯函数 */
ok("bumpSemver patch", v.bumpSemver("1.0.0", "patch") === "1.0.1");
ok("bumpSemver minor", v.bumpSemver("1.0.0", "minor") === "1.1.0");
ok("bumpSemver major", v.bumpSemver("1.0.0", "major") === "2.0.0");
ok("bumpSemver 重置低位", v.bumpSemver("1.2.3", "minor") === "1.3.0");
ok("readMeta 提取", v.readMeta('<meta name="x-app-version" content="1.0.0">') === "1.0.0");
ok("writeMeta 替换", v.writeMeta('<head>\n<meta name="x-app-version" content="1.0.0">\n</head>', "1.2.3").indexOf('content="1.2.3"') !== -1);
ok("readCacheConst", v.readCacheConst('const CACHE = "lvjiaoxi-office-v7";') === "lvjiaoxi-office-v7");
ok("bumpCacheConst +1", v.readCacheConst(v.bumpCacheConst('const CACHE = "lvjiaoxi-office-v7";')) === "lvjiaoxi-office-v8");

/* 1b) 跨端构建号与 iOS / HarmonyOS 纯函数 */
ok("versionCode iOS/Android 1.0.0", v.versionCode("1.0.0", 10000) === 10000);
ok("versionCode iOS/Android 1.2.3", v.versionCode("1.2.3", 10000) === 10203);
ok("versionCode Harmony 1.0.0", v.versionCode("1.0.0", 1000000) === 1000000);
ok("versionCode Harmony 1.2.3", v.versionCode("1.2.3", 1000000) === 1002003);
ok("versionCode 抗脏输入", v.versionCode("2.x", 10000) === 20000);
const ymlSrc = '        MARKETING_VERSION: 1.0.0\n        CURRENT_PROJECT_VERSION: 1\n';
const ymlNew = v.writeIOSProjectYml(ymlSrc, "2.0.0", 20000);
ok("writeIOSProjectYml marketing", /MARKETING_VERSION: 2\.0\.0/.test(ymlNew));
ok("writeIOSProjectYml build", /CURRENT_PROJECT_VERSION: 20000/.test(ymlNew));
const plistSrc = '    <key>CFBundleShortVersionString</key>\n    <string>1.0.0</string>\n    <key>CFBundleVersion</key>\n    <string>1</string>\n';
const plistNew = v.writeIOSPlist(plistSrc, "2.0.0", 20000);
const plistRead = v.readIOSPlist(plistNew);
ok("writeIOSPlist short", plistRead.short === "2.0.0");
ok("writeIOSPlist build", plistRead.build === 20000);
const hmSrc = '{\n  "app": {\n    "versionCode": 1000000,\n    "versionName": "1.0.0"\n  }\n}\n';
const hmNew = v.writeHarmonyAppJson(hmSrc, "2.0.0", 2000000);
const hmRead = v.readHarmonyAppJson(hmNew);
ok("writeHarmonyAppJson name", hmRead.versionName === "2.0.0");
ok("writeHarmonyAppJson code", hmRead.versionCode === 2000000);

/* 2) run() 在临时副本上落盘（结构：<root>/package.json + <root>/app/{index.html,version.json,sw.js}） */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lvjx-bump-"));
try {
  const appDir = path.join(root, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(appDir, "index.html"), '<!doctype html><html><head>\n<meta name="x-app-version" content="1.0.0">\n</head><body></body></html>');
  fs.writeFileSync(path.join(appDir, "version.json"), JSON.stringify({ version: "1.0.0", channel: "stable", notes: ["old"] }, null, 2));
  fs.writeFileSync(path.join(appDir, "sw.js"), 'const CACHE = "lvjiaoxi-office-v1";\n');

  const r = v.run({ root: root, type: "minor", notes: "新功能A|新功能B", dryRun: false });
  ok("run 返回新版本", r.newVer === "1.1.0");
  ok("run package.json 写入", JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version === "1.1.0");
  ok("run html meta 写入", v.readMeta(fs.readFileSync(path.join(appDir, "index.html"), "utf8")) === "1.1.0");
  ok("run version.json 保留字段+notes+日期", (function () {
    const j = JSON.parse(fs.readFileSync(path.join(appDir, "version.json"), "utf8"));
    return j.version === "1.1.0" && j.channel === "stable" &&
      Array.isArray(j.notes) && j.notes.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(j.publishedAt);
  })());
  ok("run sw CACHE 自增", v.readCacheConst(fs.readFileSync(path.join(appDir, "sw.js"), "utf8")) === "lvjiaoxi-office-v2");

  // dry-run 不落盘
  const before = fs.readFileSync(path.join(root, "package.json"), "utf8");
  v.run({ root: root, type: "major", dryRun: true });
  ok("dry-run 不写入", fs.readFileSync(path.join(root, "package.json"), "utf8") === before);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

/* 3) run() 跨端写入：临时副本含 iOS / HarmonyOS 工程文件 */
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "lvjx-bump-x-"));
try {
  const appDir = path.join(root2, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(root2, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(appDir, "index.html"), '<!doctype html><html><head>\n<meta name="x-app-version" content="1.0.0">\n</head><body></body></html>');
  fs.writeFileSync(path.join(appDir, "version.json"), JSON.stringify({ version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(appDir, "sw.js"), 'const CACHE = "lvjiaoxi-office-v1";\n');

  const iosYmlDir = path.join(root2, "clients", "ios");
  const iosPlistDir = path.join(iosYmlDir, "LvjiaoxiOffice");
  fs.mkdirSync(iosPlistDir, { recursive: true });
  fs.writeFileSync(path.join(iosYmlDir, "project.yml"), 'targets:\n  LvjiaoxiOffice:\n    settings:\n      base:\n        MARKETING_VERSION: 1.0.0\n        CURRENT_PROJECT_VERSION: 1\n');
  fs.writeFileSync(path.join(iosPlistDir, "Info.plist"),
    '    <key>CFBundleShortVersionString</key>\n    <string>1.0.0</string>\n    <key>CFBundleVersion</key>\n    <string>1</string>\n');

  const hmDir = path.join(root2, "clients", "harmonyos", "AppScope");
  fs.mkdirSync(hmDir, { recursive: true });
  fs.writeFileSync(path.join(hmDir, "app.json5"), '{\n  "app": {\n    "versionCode": 1000000,\n    "versionName": "1.0.0"\n  }\n}\n');

  const r2 = v.run({ root: root2, set: "1.2.3", dryRun: false });
  ok("跨端 run 新版本", r2.newVer === "1.2.3");
  ok("跨端 iOS 报告存在", !!r2.ios && r2.ios.buildNew === 10203);
  ok("跨端 Harmony 报告存在", !!r2.harmony && r2.harmony.codeNew === 1002003);

  const ymlAfter = fs.readFileSync(path.join(iosYmlDir, "project.yml"), "utf8");
  ok("跨端 iOS project.yml 写入", /MARKETING_VERSION: 1\.2\.3/.test(ymlAfter) && /CURRENT_PROJECT_VERSION: 10203/.test(ymlAfter));
  const plistAfter = v.readIOSPlist(fs.readFileSync(path.join(iosPlistDir, "Info.plist"), "utf8"));
  ok("跨端 iOS plist 写入", plistAfter.short === "1.2.3" && plistAfter.build === 10203);
  const hmAfter = v.readHarmonyAppJson(fs.readFileSync(path.join(hmDir, "app.json5"), "utf8"));
  ok("跨端 Harmony app.json5 写入", hmAfter.versionName === "1.2.3" && hmAfter.versionCode === 1002003);

  // 缺失原生工程时跳过，不报错
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "lvjx-bump-skip-"));
  try {
    const a3 = path.join(root3, "app");
    fs.mkdirSync(a3, { recursive: true });
    fs.writeFileSync(path.join(root3, "package.json"), JSON.stringify({ version: "1.0.0" }, null, 2));
    fs.writeFileSync(path.join(a3, "index.html"), '<meta name="x-app-version" content="1.0.0">');
    fs.writeFileSync(path.join(a3, "version.json"), JSON.stringify({ version: "1.0.0" }));
    fs.writeFileSync(path.join(a3, "sw.js"), 'const CACHE = "lvjiaoxi-office-v1";');
    const r3 = v.run({ root: root3, set: "3.0.0", dryRun: false });
    ok("缺原生工程时跳过 iOS/Harmony", r3.ios === null && r3.harmony === null && r3.newVer === "3.0.0");
  } finally {
    fs.rmSync(root3, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(root2, { recursive: true, force: true });
}

console.log("\n_bump_version_test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
