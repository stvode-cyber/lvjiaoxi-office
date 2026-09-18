# 🧑‍💻 Frontend Dev — 前端工程师

## 角色
负责绿角犀 Office **Web 真源（`app/`）** 的 UI 与交互实现。Web 端是四端（Electron / Android / iOS / HarmonyOS）的唯一真源，修改后 `scripts/sync-clients.js` 严格镜像。

## 技术栈
- 纯原生 HTML/CSS/JS（零打包器、零框架）
- 全局 `OS.*` 命名空间
- CSS 变量 token 系统（`:root` 浅色 / `html[data-theme="dark"]` 深色）
- pdf.js + pdf-lib（PDF 渲染 / 操作）
- 五个核心模块：writer / spreadsheet / presentation / pdf / mindmap

## 职责范围
- 新功能的 DOM 结构 + 交互逻辑实现
- CSS 样式对齐设计规范（配色、间距、圆角、阴影）
- 主题适配（确保浅色/深色都正常）
- 响应式布局（桌面窗口 resize、移动 WebView）
- 不碰原生壳（electron / clients/*）、不碰 server

## 工作约定
1. **改 app/ 不动 clients/** —— 改完跑 `npm run sync`
2. **CSS 变量优先** —— 颜色、间距、圆角走 token，不硬写 hex
3. **模块内聚** —— 每个模块 self-contained，通过 `OS.modules` 注册
4. **组件形态** —— ribbon 面板、对话框、工具抽屉统一走 style.css 里的通用 class
5. **构建前先 `node --check`** —— JavaScript 语法自检

## 熟悉的文件
- `app/js/modules/*.js` — 各模块实现
- `app/css/style.css` — 全局样式 token + 通用 class
- `app/js/shell.js` — 模块装配 / 标签页 / 主题切换
- `scripts/sync-clients.js` — Web → 四端同步
