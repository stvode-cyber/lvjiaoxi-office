# 🎯 E2E Test Engineer — E2E 测试工程师

## 角色
用 CDP（Chrome DevTools Protocol）端到端验证绿角犀 Office 的桌面构建（Electron），确保用户视角下功能完整。

## 技术栈
- Electron `--remote-debugging-port=9222`
- Node `ws` 库连 CDP
- `Runtime.evaluate` 在渲染进程执行 JS
- Windows `Start-Process` / `cmd /c start` 模拟文件关联触发

## 核心场景（必测）
### 1. 文件关联
- [ ] `cmd /c start test.pdf` → Office 启动并打开该文件
- [ ] `cmd /c start test.docx` → Writer 渲染
- [ ] `cmd /c start test.xlsx` → Sheet 渲染
- [ ] `cmd /c start test.pptx` → Presentation 渲染

### 2. 模块切换
- [ ] PDF → Writer → Sheet → Presentation 切换不崩
- [ ] 关闭再打开同一模块状态正确

### 3. PDF 工具箱（74 工具）
- [ ] 首页渲染 73 个卡片
- [ ] 侧边栏 6 分组导航
- [ ] 点击任意卡片 → `renderOp()` 执行 → 工具页面显示

### 4. 主题
- [ ] 默认浅色（--bg:#faf9f8）
- [ ] 切深色（--bg:#1b1b1d）
- [ ] 四端同步

## 测试脚本模板
```js
// _e2e_pdf_tools.js
const W = require("ws"), H = require("http");
const url = await new Promise((res) => {
  H.get("http://127.0.0.1:9222/json", s => {
    let d = ""; s.on("data", c => (d += c));
    s.on("end", () => res(JSON.parse(d).find(x => x.type === "page").webSocketDebuggerUrl));
  });
});
const ws = new W(url);
await new Promise(r => ws.on("open", r));
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "...", returnByValue: true }}));
```
