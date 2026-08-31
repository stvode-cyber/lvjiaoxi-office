/* 绿角犀 Office · 应用市场上架素材回归测试（node 独立运行）
 * 运行：node _store_assets_test.js
 * 校验 Android / iOS 上架阻断项素材是否已生成、Manifest/Plist 是否已正确配置。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.error("  FAIL " + name); }
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

/* 1) Android 启动图标 */
const densities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
for (const d of densities) {
  ok(`Android mipmap-${d}/ic_launcher.png`, exists(`clients/android/app/src/main/res/mipmap-${d}/ic_launcher.png`));
  ok(`Android mipmap-${d}/ic_launcher_round.png`, exists(`clients/android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`));
  ok(`Android mipmap-${d}/ic_launcher_foreground.png`, exists(`clients/android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`));
  ok(`Android mipmap-${d}/ic_launcher_background.png`, exists(`clients/android/app/src/main/res/mipmap-${d}/ic_launcher_background.png`));
}
ok("Android mipmap-anydpi-v26/ic_launcher.xml", exists("clients/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"));
ok("Android mipmap-anydpi-v26/ic_launcher_round.xml", exists("clients/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml"));
ok("Android values/colors.xml", exists("clients/android/app/src/main/res/values/colors.xml"));
ok("Android colors.xml 含 ic_launcher_background", /name="ic_launcher_background"/.test(read("clients/android/app/src/main/res/values/colors.xml")));

/* 2) AndroidManifest 图标与 cleartext */
const manifest = read("clients/android/app/src/main/AndroidManifest.xml");
ok("AndroidManifest android:icon", /android:icon="@mipmap\/ic_launcher"/.test(manifest));
ok("AndroidManifest android:roundIcon", /android:roundIcon="@mipmap\/ic_launcher_round"/.test(manifest));
ok("AndroidManifest usesCleartextTraffic=false", /android:usesCleartextTraffic="false"/.test(manifest));

/* 3) network_security_config 全局明文已关闭 */
const nsc = read("clients/android/app/src/main/res/xml/network_security_config.xml");
ok("network_security_config cleartext=false", /<base-config[^>]*cleartextTrafficPermitted="false"/.test(nsc));

/* 4) iOS LaunchScreen / PrivacyInfo / 出口合规 */
ok("iOS LaunchScreen.storyboard", exists("clients/ios/LvjiaoxiOffice/LaunchScreen.storyboard"));
ok("iOS LaunchScreen.storyboard 引用 LaunchScreenIcon", /image="LaunchScreenIcon"/.test(read("clients/ios/LvjiaoxiOffice/LaunchScreen.storyboard")));
ok("iOS LaunchScreenIcon.png", exists("clients/ios/LvjiaoxiOffice/LaunchScreenIcon.png"));
ok("iOS PrivacyInfo.xcprivacy", exists("clients/ios/LvjiaoxiOffice/PrivacyInfo.xcprivacy"));
const plist = read("clients/ios/LvjiaoxiOffice/Info.plist");
ok("Info.plist ITSAppUsesNonExemptEncryption=false", /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist));
ok("Info.plist UILaunchStoryboardName=LaunchScreen", /<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/.test(plist));

console.log("\n_store_assets_test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
