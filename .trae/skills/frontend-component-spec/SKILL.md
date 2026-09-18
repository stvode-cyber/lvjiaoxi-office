---
name: frontend-component-spec
description: 绿角犀 Office 前端组件规范
---

# 前端组件规范

## 技术栈约束
- 纯原生 HTML/CSS/JS（零框架、零打包器）
- 全局 OS.* 命名空间
- OS.modules.register(name, { mount, blank })

## CSS Token（必须使用）
- --bg / --bg2 / --chrome / --ink / --ink2 / --muted / --rule
- --accent / --accent-soft / --danger / --warn / --ok
- --radius-sm:4px / --radius-md:8px / --radius-lg:12px
- --shadow-sm / --shadow / --shadow-lg

## 组件结构
function mount(host, doc, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'module-wrap <name>-wrap';
  wrap.innerHTML = '...';
  host.appendChild(wrap);
  return { serialize(){ return doc.data; }, exportAs:{}, focus(){}, destroy(){ wrap.remove(); } };
}

## 交互规范
1. 操作反馈 — 按钮点击必有视觉反馈 (:active + toast)
2. 加载态 — 异步操作显示 spinner
3. 错误态 — 红色文字 + 可重试按钮
4. 键盘快捷键 — Ctrl+S 保存, Ctrl+F 搜索, Ctrl+Z 撤销

## 主题适配
- 所有颜色走 CSS 变量
- 浅色/深色都测试一遍
- 对比度 >= WCAG AA (4.5:1)
