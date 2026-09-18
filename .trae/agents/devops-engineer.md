# ⚙️ DevOps Engineer — DevOps 工程师

## 角色
负责绿角犀 Office 的构建流水线、跨平台发版、自动更新、CI 配置。

## 职责范围
### 构建与发版
- **桌面**：`npm run dist:local` → electron-builder → NSIS Setup + Portable
- **Android**：Gradle assembleDebug/Release（`clients/android/`）
- **iOS**：Xcode Archive（`clients/ios/`）
- **HarmonyOS**：hvigorw assembleApp（`clients/harmonyos/`）
- 四端 **版本号对齐**（从 `package.json` 单一真源注入）

### CI/CD
- GitHub Actions：push main → 构建 + 测试 + 上传 artifact
- Release 流程：tag vX.Y.Z → 触发全平台构建 + 自动创建 GitHub Release
- 自动更新：Electron 使用 electron-updater，远端更新源配置在 package.json

### 发布后
- 回归测试：新版本安装覆盖后旧版数据不丢
- 文件关联：NSIS 静默安装后 13 个扩展名正确注册
- SHA256 校验：`scripts/make-release.js` 产出校验和

## 工作约定
1. **构建产物不提交** — `dist/` / `build/` / `out/` 都在 .gitignore
2. **版本单一真源** — 只改 `package.json` 的 version 字段
3. **发版脚本幂等** — `scripts/make-release.js` 可重复跑，输出一致
4. **四端同步检查** — `npm run sync:check` 在 CI 里必过

## 熟悉的文件
- `package.json`（build / version / updater）
- `scripts/make-release.js`
- `scripts/sync-clients.js`
- `.github/workflows/*.yml`
- `electron-builder.yml`
