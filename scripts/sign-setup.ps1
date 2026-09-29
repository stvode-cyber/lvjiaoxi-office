# 绿角犀 Office · Setup.exe 签名脚本（免费自签 or 正式证书）
# 用法：.\scripts\sign-setup.ps1
#       有正式证书时：.\scripts\sign-setup.ps1 -PfxPath cert\lvjiaoxi-code-signing.pfx -PfxPassword "你的密码"
#
# ⚠️ 免费自签 SmartScreen 不认（还是会警告），但 exe 显示"已签名"
#    正式 OV 证书零警告 ~¥1500/年
#    OSS 免费 OV：DigiCert/Sectigo 给活跃开源项目免费发，需要审核

param(
  [string]$SetupPath,
  [string]$PfxPath,
  [string]$PfxPassword
)
$ErrorActionPreference = "Stop"

# —— 1. 找 signtool ——
$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
if (-not (Test-Path $signtool)) {
  $signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
}
if (-not (Test-Path $signtool)) { Write-Host "❌ signtool.exe 未找到" -ForegroundColor Red; exit 1 }
Write-Host "✅ signtool: $signtool" -ForegroundColor Green

# —— 2. 默认 Setup.exe ——
if (-not $SetupPath) {
  $latest = Get-ChildItem "dist\*Setup*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) { $SetupPath = $latest.FullName }
  else { Write-Host "❌ dist\ 里没找到 Setup*.exe" -ForegroundColor Red; exit 1 }
}
Write-Host "✅ Setup: $SetupPath" -ForegroundColor Green

# —— 3. 准备证书 ——
$certDir = "cert"
if (-not (Test-Path $certDir)) { New-Item -ItemType Directory -Path $certDir | Out-Null }

if (-not $PfxPath -or -not $PfxPassword) {
  # 自动生成自签名
  $pfx = Join-Path $certDir "lvjiaoxi-self-signed.pfx"
  if (-not (Test-Path $pfx)) {
    Write-Host "🔑 生成自签名证书（占坑用，SmartScreen 不认）..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate -Type CodeSigningCert `
      -Subject "CN=lvjiaoxi, O=lvjiaoxi, C=CN" `
      -FriendlyName "Lvjiaoxi Code Signing" `
      -HashAlgorithm SHA256 -KeyAlgorithm RSA -KeyLength 2048 `
      -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(3)
    $pwd = ConvertTo-SecureString "Lvj1@x!2026" -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null
    Write-Host "✅ 自签证书: $pfx" -ForegroundColor Green
  } else {
    Write-Host "📦 复用自签证书: $pfx" -ForegroundColor Cyan
  }
  $PfxPath = $pfx
  $PfxPassword = "Lvj1@x!2026"
}

# —— 4. 签名 ——
Write-Host "🔏 签名中..." -ForegroundColor Cyan
& $signtool sign /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 `
  /f $PfxPath /p $PfxPassword $SetupPath
if ($LASTEXITCODE -ne 0) { Write-Host "❌ 签名失败" -ForegroundColor Red; exit 1 }

# —— 5. 验证 ——
$sig = Get-AuthenticodeSignature $SetupPath
Write-Host ""
Write-Host "📋 结果:" -ForegroundColor Cyan
Write-Host "  Status: $($sig.Status)" -ForegroundColor $(if ($sig.Status -eq "Valid") {"Green"} else {"Yellow"})
Write-Host "  Signer: $($sig.SignerCertificate.Subject)"
Write-Host ""
Write-Host "⚠️  自签证书 SmartScreen 仍会警告" -ForegroundColor Yellow
Write-Host "   正式 OV 证书零警告: https://www.digicert.com/code-signing/"
Write-Host "   OSS 免费 OV: https://www.digicert.com/ssl/free-code-signing"
