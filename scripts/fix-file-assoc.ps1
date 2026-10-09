# 修复 Windows 文件关联（HKCU 优先于 HKLM，重装后 HKCU 可能被 WPS/Chrome 抢占）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/fix-file-assoc.ps1

$exe = "C:\Program Files\lvjiaoxi-office\绿角犀 Office.exe"
$extList = @(
    @{ Ext = "pdf";  ProgId = "绿角犀 PDF 文档" },
    @{ Ext = "docx"; ProgId = "绿角犀 Word 文档" },
    @{ Ext = "xlsx"; ProgId = "绿角犀表格文档" },
    @{ Ext = "pptx"; ProgId = "绿角犀演示文档" },
    @{ Ext = "ofd";  ProgId = "绿角犀 OFD 文档" },
    @{ Ext = "lvjx"; ProgId = "绿角犀存档文件" },
    @{ Ext = "txt";  ProgId = "绿角犀文本文档" },
    @{ Ext = "xmind"; ProgId = "绿角犀思维导图" }
)

foreach ($entry in $extList) {
    $ext = $entry.Ext
    $progId = $entry.ProgId
    $hkcuExt = "HKCU:\SOFTWARE\Classes\.$ext"
    $hkcuProg = "HKCU:\SOFTWARE\Classes\$progId"

    Write-Host "修复 .$ext -> $progId"

    # 1) HKCU 扩展名 → (Default) 指向我们的 ProgID
    if (-not (Test-Path $hkcuExt)) { New-Item -Path $hkcuExt -Force | Out-Null }
    Set-ItemProperty -Path $hkcuExt -Name "(default)" -Value $progId -Force

    # 2) OpenWithProgids 加进去（右键"打开方式"列表里出现）
    $owp = "$hkcuExt\OpenWithProgids"
    if (-not (Test-Path $owp)) { New-Item -Path $owp -Force | Out-Null }
    Set-ItemProperty -Path $owp -Name $progId -Value "" -Force

    # 3) HKCU ProgID 注册 open 命令（整条路径重建，确保子项完整）
    New-Item -Path $hkcuProg -Force | Out-Null
    Set-ItemProperty -Path $hkcuProg -Name "(default)" -Value "" -Force
    $shell = Join-Path $hkcuProg "shell"
    New-Item -Path $shell -Force | Out-Null
    Set-ItemProperty -Path $shell -Name "(default)" -Value "open" -Force
    $open = Join-Path $shell "open"
    New-Item -Path $open -Force | Out-Null
    Set-ItemProperty -Path $open -Name "(default)" -Value "Open with 绿角犀 Office" -Force
    $cmd = Join-Path $open "command"
    New-Item -Path $cmd -Force | Out-Null
    Set-ItemProperty -Path $cmd -Name "(default)" -Value "`"$exe`" `"%1`"" -Force
}

# 刷新 Explorer 让关联立即生效
rundll32.exe user32.dll,UpdatePerUserSystemParameters 2>$null

Write-Host ""
Write-Host "OK 文件关联修复完成：$($extList.Count) 个扩展名"
Write-Host "   请重启 Explorer 或注销/重登让资源管理器立即刷新"
