---
name: security-audit-guide
description: 绿角犀 Office 安全审计指南
---

# 安全审计指南

## 高风险（必须修）
1. PDF Launch action — /Type /Action /S /Launch 未拦截
2. PDF JavaScript — /S /JavaScript 未禁用
3. ZIP bomb — OOXML/OFD 解压比 >= 100:1 未检测
4. XSS via innerHTML — 批注 content 未转义
5. Electron nodeIntegration=true — 应 false + contextIsolation=true

## 中风险（应修）
6. Token 存 localStorage — 改 secure Cookie/sessionStorage
7. 路径遍历 — ../../etc/passwd 路径未过滤
8. CSP 缺失 — 远程资源加载无策略
9. webSecurity 关闭 — 保持 true

## 审计命令
npm audit --audit-level=high
Select-String -Path "app/**/*.js","electron/*.js" -Pattern "innerHTML|eval|contextIsolation"
