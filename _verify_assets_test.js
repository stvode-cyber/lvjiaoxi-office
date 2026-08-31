/* 绿角犀 Office · 发布资产完整性校验测试
   验证 scripts/verify-release-assets.js 的纯函数（detectPlatforms / verifyAll）。 */
const v = require("C:/Users/Administrator/Desktop/绿角犀办公软件/scripts/verify-release-assets.js");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  ✗ " + name); } }

// 自动识别平台
ok("detectPlatforms win", JSON.stringify(v.detectPlatforms(["绿角犀 Office Setup 1.0.0.exe", "latest.yml"])) === JSON.stringify(["win"]));
ok("detectPlatforms mac", JSON.stringify(v.detectPlatforms(["绿角犀 Office-1.0.0.dmg", "latest-mac.yml"])) === JSON.stringify(["mac"]));
ok("detectPlatforms 三平台", v.detectPlatforms(["latest.yml", "latest-mac.yml", "latest-linux.yml"]).length === 3);
ok("detectPlatforms 空", v.detectPlatforms(["x.zip"]).length === 0);

// 完整桌面资产 -> ok
let res = v.verifyAll(["绿角犀 Office Setup 1.0.0.exe", "绿角犀 Office 1.0.0.exe", "latest.yml", "绿角犀 Office Setup 1.0.0.exe.blockmap"], { platforms: ["win"] });
ok("win 资产齐全 ok", res.ok === true && res.missing.length === 0);

// 缺 latest.yml -> 缺失
res = v.verifyAll(["绿角犀 Office Setup 1.0.0.exe"], { platforms: ["win"] });
ok("win 缺 latest.yml 报缺失", res.ok === false && res.missing.indexOf("desktop/win") >= 0);

// mac 完整
res = v.verifyAll(["绿角犀 Office-1.0.0.dmg", "latest-mac.yml", "绿角犀 Office-1.0.0.dmg.blockmap"], { platforms: ["mac"] });
ok("mac 资产齐全 ok", res.ok === true);

// 移动端：android + ios 完整
res = v.verifyAll(["app.aab", "app.apk", "app.ipa"], { mobile: true });
ok("移动端 aab/apk/ipa 齐全 ok", res.ok === true && res.mobile.android.missing.length === 0 && res.mobile.ios.missing.length === 0);

// 移动端缺 ipa -> 缺失
res = v.verifyAll(["app.aab", "app.apk", "app.xcarchive.zip"], { mobile: true });
ok("移动端 缺 ipa 但 xcarchive 也算 ok", res.ok === true); // xcarchive.zip 满足 ios 模式

// 混合：win 齐全 + android 缺一 -> 仅移动端缺失
res = v.verifyAll(["绿角犀 Office Setup 1.0.0.exe", "绿角犀 Office 1.0.0.exe", "latest.yml", "x.blockmap", "only.apk"], { platforms: ["win"], mobile: true });
ok("win 齐全但 android 缺 aab -> 移动端报缺失", res.ok === false && res.missing.indexOf("mobile/android") >= 0);

// 未启用 mobile 时忽略移动端资产（win 仍因缺文件而缺失，但不应出现 mobile/* 缺失）
res = v.verifyAll(["x.aab"], { platforms: ["win"] });
ok("未启用 mobile 不报缺失", res.ok === false && res.missing.indexOf("mobile/android") < 0 && res.missing.indexOf("mobile/ios") < 0);

// —— 假阳性回归（2026-08-29）：dist 里有 exe 但没有 latest.yml 时，原实现按 latest*.yml
//    识别平台 → 一个平台都检不出 → 一项都不校验 → 误报 OK。改为「安装包也能标记平台」。
ok("detectPlatforms 仅 exe 也识别 win", JSON.stringify(v.detectPlatforms(["绿角犀 Office Setup 1.0.0.exe"])) === JSON.stringify(["win"]));
ok("detectPlatforms 仅 dmg 也识别 mac", JSON.stringify(v.detectPlatforms(["绿角犀 Office-1.0.0.dmg"])) === JSON.stringify(["mac"]));
ok("detectPlatforms 仅 AppImage 也识别 linux", JSON.stringify(v.detectPlatforms(["绿角犀 Office-1.0.0.AppImage"])) === JSON.stringify(["linux"]));
ok("detectPlatforms apk 不算桌面平台", v.detectPlatforms(["绿角犀Office-release.apk"]).length === 0);

// 自动识别（不传 platforms）下：有 exe 无 latest.yml -> 必须报缺失，不能因为「没检出平台」而通过
res = v.verifyAll(["绿角犀 Office Setup 1.0.0.exe", "绿角犀 Office 1.0.0.exe", "绿角犀 Office Setup 1.0.0.exe.blockmap"], {});
ok("假阳性回归：缺 latest.yml 自动识别下报缺失", res.ok === false && res.missing.indexOf("desktop/win") >= 0);
ok("假阳性回归：自动识别仍检出 win", res.detected.indexOf("win") >= 0);

// 自动识别下资产完整 -> ok
res = v.verifyAll(["绿角犀 Office Setup 1.0.0.exe", "绿角犀 Office 1.0.0.exe", "latest.yml", "x.blockmap"], {});
ok("自动识别资产齐全 ok", res.ok === true && res.detected.indexOf("win") >= 0);

// 一个平台产物都没有 -> detected 为空（由 CLI 层判定为不通过，纯函数保持向后兼容）
ok("无任何平台产物 detected 为空", v.verifyAll(["x.zip"], {}).detected.length === 0);

const summary = `VERIFY-ASSETS TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
console.log(summary);
process.exit(fail ? 1 : 0);
