---
name: "ljx-release-full"
description: "绿角犀 Office 完整发版管线：版本对齐 → 自签证书 → NSIS 打包 → 冒烟验证 → GitHub Release。Invoke when 用户说'发版'/'打包'/'release'/'出安装包'/'升版本号'。"
---

# 绿角犀 Office · 完整发版 Skill

## 触发条件

- 用户说"发版" / "release" / "出安装包" / "升版本号" / "bump"
- 需要构建 Setup.exe 给用户测试
- 需要静默更新生效（GitHub Release 上传）

## 前置信息（读 `.credentials/version-key.md`）

| 项 | 值 |
|---|---|
| 版本单一真源 | `package.json` → version 字段 |
| bump 脚本 | `node scripts/bump-version.js patch` |
| 签名脚本 | `.\scripts\sign-setup.ps1`（免费自签，SmartScreen 会警告） |
| 产出 | 只有 NSIS 安装包（Setup.exe），**没有** Portable 绿色版 |
| CACHE 自增 | bump-version 自动 +1（v51→v52），触发 SW 重装 |

---

## 完整发版流程（5 步 · 每步编号消结）

### [1/5] 版本对齐

```powershell
# 修订号 +1（日常小修复）
node scripts/bump-version.js patch

# 或次版本 +1（新功能）
node scripts/bump-version.js minor

# 或直接指定
node scripts/bump-version.js --set 1.2.3
```

**自动同步 7 处**：
1. package.json version
2. app/index.html `<meta name="x-app-version" content="...">`
3. app/sw.js CACHE（+1 自增）
4. app/version.json（version + publishedAt）
5. clients/ios/project.yml
6. clients/ios/LvjiaoxiOffice/Info.plist
7. clients/harmonyos/AppScope/app.json5

**验证**：`Select-String -Path package.json -Pattern '"version"'` → 应该是新版本号

### [2/5] 完整测试

```powershell
node scripts/run-tests.js
# 必须 110/111 全绿（唯一允许失败的是 _cdp_test.js 环境依赖）
```

### [3/5] 构建

```powershell
npm.cmd run release
# 等价于：node scripts/bump-version.js patch && npm run dist:win
# 产出：dist/绿角犀Office-Setup.exe（NSIS 安装包）
```

### [4/5] 自签（可选）

```powershell
# 免费自签（不用密码）
.\scripts\sign-setup.ps1 -SetupPath "dist\绿角犀Office-Setup.exe"

# 有正式证书时
.\scripts\sign-setup.ps1 -SetupPath "dist\绿角犀Office-Setup.exe" -PfxPath ".credentials\certificates\lvjiaoxi-code-signing.pfx" -PfxPassword "****"
```

### [5/5] GitHub Release（可选）

```powershell
# ⚠️ 需要先装 gh CLI + auth login
# 装 gh（Windows）
winget install GitHub.cli

# 登录（交互式，浏览器授权 stvode-cyber）
gh auth login

# 发版（注意路径里有空格要加引号）
gh release create v1.1.26 "dist\绿角犀 Office Setup 1.1.26.exe" --title "v1.1.26" --notes "FE 316 FUNCS key / Excel 271 核心全清 / 发版 Skill 就位"
```

---

## 实跑验证

| 版本 | 日期 | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 | 备注 |
|------|------|--------|--------|--------|--------|--------|------|
| 1.1.26 | 2026-10-17 | ✅ 7处同步 | ✅ 110/111 | ✅ 181.34MB | ✅ 自签成功 | ⚠️ 跳过 | gh CLI 未装 |

---

## 铁律（必须遵守）

1. **不买 OV 证书**（¥1500/年）——用免费自签
2. **不发 Portable 绿色版**——只出 NSIS Setup.exe
3. **代码签名只在 CI 上做**——本地 build 不签名（证书不会入库）
4. **版本号单一真源**——只改 `package.json`，bump-version 自动注入
5. **bump-version 前先 commit**——防止版本号漂移

## 常见问题

| 问题 | 解决 |
|------|------|
| SmartScreen 警告 | 正常（自签），等 GitHub Downloads > 1000 自动信任 |
| .pfx 证书文件丢了 | `cert\lvjiaoxi-code-signing.pfx` 重新运行 sign-setup.ps1 生成 |
| Windows Defender 误报 | 免费自签 + 未知发布者 = Defender 会拦，加白名单 |
| npm.ps1 执行策略 | 用 `npm.cmd` 不用 `npm`（PowerShell 5 限制） |

---

> 版本：v1.0（2026-10-17，ledger#95）
> 关联：[.credentials/version-key.md](../../.credentials/version-key.md)
> 关联：[scripts/bump-version.js](../../scripts/bump-version.js)
> 关联：[scripts/sign-setup.ps1](../../scripts/sign-setup.ps1)
