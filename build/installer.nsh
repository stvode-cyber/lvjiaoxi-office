; ============================================================
; 绿角犀 Office · 自定义 NSIS 安装脚本
; 目的：实现"自动铺盖 / 修复"安装模式
;   - 若检测到已安装同 appId 的旧版本，先静默卸载旧版，再继续安装
;   - 效果：双击安装包即可覆盖/修复，无需用户手动卸载，也不弹 Repair 框
; ============================================================
!include "LogicLib.nsh"

!macro preInit
  ; 解析卸载注册表键（优先用 electron-builder 注入的键名，回退到 appId）
  !ifdef UNINSTALL_REGISTRY_KEY
    !define APP_UNINST_KEY "${UNINSTALL_REGISTRY_KEY}"
  !else
    !define APP_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
  !endif

  ; 用户级 (HKCU) 与机器级 (HKLM) 都查一遍，兼容 perMachine 配置
  ReadRegStr $R0 HKCU "${APP_UNINST_KEY}" "UninstallString"
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "${APP_UNINST_KEY}" "UninstallString"
  ${EndIf}

  ; 找到旧版卸载程序 -> 静默卸载（/S），随后主流程按全新安装继续
  ${If} $R0 != ""
    ExecWait '$R0 /S'
  ${EndIf}
!macroend
