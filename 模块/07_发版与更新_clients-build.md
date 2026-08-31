# 客户端三端构建清单（Android / iOS / HarmonyOS）

> 配套导航：[07_发版与更新_build.md](../07_发版与更新_build.md)
> 更新：2026-08-31（实测本环境 Android 可构建；iOS/HarmonyOS 需对应宿主环境）

## 1. Android（`clients/android`）

### 本环境实测状态（2026-08-31）
- ✅ `android-sdk` 真实存在：`C:/Users/Administrator/android-sdk`
- ✅ `local.properties`：`sdk.dir=C:/Users/Administrator/android-sdk`
- ✅ JDK17 可用：`C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot`（`JAVA_HOME` 已设）
- ✅ `platform-tools/adb` 存在
- ⚠️ **坑**：`gradle/wrapper/gradle-wrapper.jar` 损坏（仅 9 个类、缺 `IDownload`）→ `./gradlew` 报 `ClassNotFoundException` / `NoClassDefFoundError`
- ✅ **绕过法**：用本机已缓存的 gradle 8.11.1 分发直接构建（绕开损坏 wrapper）
  ```
  JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot' "C:/Users/Administrator/.gradle/wrapper/dists/gradle-8.11.1-all/2qik7nd48slq1ooc2496ixf4i/gradle-8.11.1/bin/gradle.bat" assembleDebug --no-daemon
  ```
  > 注：git 拉取的 `gradle-wrapper.jar` 二进制被截断，重建仓库后需 `gradle wrapper` 重新生成，或提交正确的 jar。

### 实测结果（2026-08-31）
- ✅ 用缓存 gradle 8.11.1 直跑 `assembleDebug`：**BUILD SUCCESSFUL（1m8s，33 tasks）**
- 产出：`app/build/outputs/apk/debug/app-debug.apk`（已校验为有效 APK，含 AndroidManifest + classes.dex）
- ⚠️ 前轮 summary 误判"无 SDK 阻塞"——实为沙箱视图假象，本环境 Android 真实可构建

### 构建命令
- debug：`gradle assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- release：`gradle assembleRelease`（需 `clients/android/keystore` 签名配置）
- AAB：`gradle bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`

## 2. iOS（`clients/ios`）

- 结构：`LvjiaoxiOffice/`(Xcode 工程) + `project.yml`(EAS 配置) + `webroot/`(与 `app/` 同源的纯 web)
- 需 **macOS + Xcode**（本环境 Windows 不可构建）
- Xcode 方式：`cd clients/ios/LvjiaoxiOffice && xcodebuild -workspace LvjiaoxiOffice.xcworkspace -scheme LvjiaoxiOffice -configuration Release`
- EAS 方式（推荐）：`cd clients/ios && eas build --platform ios`
- 注意：`webroot` 需先与 `app/` 同步（`npm run client:sync`）

## 3. HarmonyOS（`clients/harmonyos`）

- 结构：`AppScope/` + `entry/`(主模块) + `oh-package.json5`(ohpm 依赖) + `build-profile.json5`
- 需 **DevEco Studio + HarmonyOS SDK**（本环境未安装，不可构建）
- IDE 方式：DevEco 内 `File → Sync → Ohpm install` 后 `Build → Build HAP(s)/APP`
- CLI 方式：`cd clients/harmonyos && hvigorw assembleHap`
- 注意：`entry/src/main/resources/rawfile/` 需先与 `app/` 同步（`npm run client:sync`）

## 当前阻塞（决定下一步）
- Android：wrapper jar 损坏已用缓存 gradle 绕过；若换机/CI 需先修复 jar。
- iOS / HarmonyOS：本环境无 macOS / DevEco，需对应宿主环境执行上述命令。
- 三端共用前置：`webroot`/`rawfile` 必须与 `app/` 同源（已通过 `sync-clients` 验证 ios/harmonyos 同源 ✅）。
