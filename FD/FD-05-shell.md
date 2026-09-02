# FD-05-shell · 外壳与通用

## 说明
应用外壳与通用能力：开始页 / ribbon 工具栏 / 命令面板 / 主题切换 / AI 助手接入。

## 注释（细节 · 坑）
- 通用外壳承载所有模块入口；ribbon 新增按钮前须 `grep app/js/icons.js` 确认图标存在，不可臆造。
- AI 对话框接 MiniMax-M3 / 硅基流动等模型 API（base_url/model 从 config 读取）。
- 主题须匹配 IDE 主题（light/dark），文本色随主题走，避免硬编码。

## 目标（对应 G / VG）
- **G**：通用外壳与可用性。
- **VG**：全功能可交付、四端同源。

## 关联（↔报错 / ↔决策 / ↔动作）
- ↔A 模块总纲 `模块/05_外壳与通用_总纲.md`
- ↔Dc 图标不可臆造（新增 ribbon 按钮前 grep icons.js）
