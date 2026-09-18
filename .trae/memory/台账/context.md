# 项目上下文 · 已定规则（别再问）

> 本文件是 Agent 的"启动简报"。每次新对话开头先读这个，就不会犯重复错。
> 更新：每次做完阶段性工作后追加一条变更记录。

## 项目身份

- 品牌：绿角犀 Office（桌面端 + 后续看图分支）
- 形态：Electron + Svelte-ish 自定义框架（非官方 Svelte，是自己写的轻量响应式）
- 目标平台：Windows 优先内测，macOS/Linux 延后
- 默认主题：浅色；PDF 深色是局部切换，不影响全局

## 已实现核心模块

| 模块 | 状态 | 备注 |
|------|------|------|
| Writer 富文本 | ✅ 可用 | 基础编辑 + 导出 docx/html/md |
| Sheet 表格 | ✅ 可用 | AI 公式转换（SUM/AVG/MAX/MIN/IF/RANK） |
| Presentation 幻灯片 | ✅ 可用 | AI 大纲生成 + 导入当前文档 + 5 段式结构 |
| Mindmap 思维导图 | ✅ 可用 | XMind/MD/OPML 导入 + 递归布局 + 7 色循环 + Map 索引 O(1) + fitSig 缓存 ↓67% |
| PDF 工具箱 | ✅ 可用 | 深色主题局部作用域 + Uint8Array 绕过 Electron CSP |
| AI 面板（BYOK） | ✅ 可用 | OpenAI/Claude/DeepSeek/Gemini/自定义，密钥 localStorage |
| 历史版本快照 | ✅ 可用 | IndexedDB v3 + LCS Diff + 自动 30s/2s debounce |
| XMind/PPTX 导入 | ✅ 可用 | JSZip + 国际化 title + 30s timeout + null 防御 |

## 已定铁律（改之前想清楚）

1. **版本号四端强制同步**：源码常量 / UI 显示 / 安装包属性 / 更新通道，一字不差
2. **Git 走 HTTPS + PAT**：SSH 禁；PAT 存 `C:\Users\Administrator\.lvjiaoxi-git-credentials`
3. **BYOK 密钥仅 localStorage**：不上云不进仓库
4. **深色主题局部作用域**：PDF 用 `.pdf-toolbox-root`，别污染全局浅色 token
5. **Electron CI secrets 必须 if guard**：`if: env.CSC_LINK`，空则不注入
6. **路径一律相对**：源码禁 `C:\` 绝对路径，测试用 `__dirname`
7. **AI 面板嵌入工具栏**：GenOffice 模式，禁止外挂聊天框
8. **功能下线六步走**：UI 删 → JS 删 → CSS 清 → 事件解绑 → 路由移除 → grep 验证
9. **OS 跨模块调用先 ready**：`await OS.ready()` 再做事
10. **Koa 路由禁 koa-connect wrapper**：一律原生 Koa middleware
11. **Electron 里 pdf.js/Worker 加载用 Uint8Array**：别用 data:URL，CSP 会拦
12. **JSZip zip.file().async() 前必须 null 检查**：大文件/特殊格式下 zip.file() 可能返回 null
13. **Tasks.run.settle 必须更新 step 文字**：回调的 r.step 不保证走到最后一步
14. **每次打包后必须覆盖安装版 app.asar**：C:\Program Files\lvjiaoxi-office\resources\app.asar
15. **OOXML 大文件 timeout ≥ 30s**：原 10s 对 >10MB PPTX 不够

## 构建 / 运行

```bash
npm install          # 依赖安装
npm start            # Electron 开发模式（devtools 自动开）
npm test             # 单测套件（目标 110 项全绿）
npm run build        # electron-builder + release.yml
npm run audit        # 自定义技术债审计脚本（Node）
```


## 环境快照（换电脑必查）

| 项 | 值 |
|---|---|
| 项目路径 | D:\源码存档\绿角犀办公软件\ |
| Node.js | v24.20.0 |
| Electron | ^31.0.0 |
| 安装版 | C:\Program Files\lvjiaoxi-office\绿角犀 Office.exe |
| 安装版 app.asar | C:\Program Files\lvjiaoxi-office\resources\app.asar（打包后必须手动覆盖） |
| 安装版 CDP | http://127.0.0.1:9222/json （默认开，可直接 WebSocket 调） |
| dist 输出 | dist\绿角犀 Office 1.1.1.exe（便携）/ Setup 1.1.1.exe（NSIS） |
| 打包命令 | npm run dist:win |
| 测试命令 | npm test → 97 套件全绿 |
| 客户端同步 | npm run sync |
| Git | HTTPS + PAT，已推 GitHub |

## 换电脑 Checklist

1. git clone 或复制整个项目目录
2. npm install（首次 5-10 分钟）
3. npm test → 验证 97 套件全绿
4. npm start → dev 模式看 Electron 窗口是否正常
5. 跑安装版：npm run dist:win → 手动覆盖 C:\Program Files\lvjiaoxi-office\resources\app.asar（需管理员权限）
6. 360 安全软件误杀：main.js 已加 disableHardwareAcceleration()，不用再改
`## 已知限制

- iOS / Android 构建失败不在内测范畴
- 应用内 VPS 更新源 lujax.fun 当前环境不可达，内测手动下载
- 旧版「绿角犀看图」已卸载，桌面快捷方式指向幽灵，需用户手动清理

## 变更日志（追加模式）

- [2026-09-18] **v1.1.1 全链路发布 + 换电脑交接**：5 处修复（tasks.js settle step / shell.js 进度分配 / pdf.js Uint8Array / import-ooxml.js timeout+null / main.js GPU 禁用）；4 坑 +2 决策追加台账；CHANGELOG/version.json 四端同步；iOS/HarmonyOS 客户端 7 文件漂移清零；97/97 测试全绿；安装版 app.asar 已覆盖；Git tag v1.1.1 已推 GitHub。**新 AI 接手第一件事：读本文件 + issues.md + decisions.md + 跑 npm test**。
- [2026-09-17] 4 坑入台账：tasks-settle-step / electron-csp-dataurl / pptx-zipfile-null / installer-asar-not-updated。2 决策入台账：Electron 禁用硬件加速 / OOXML timeout 30s + null 防御。

- [2026-09-15] P0 级 OOXML 导入链修复：import-ooxml.js JSZip/XLSX 改为 `_pickLib()` window 优先 + globalThis 兜底；根因为 Electron `contextIsolation:true + nodeIntegration:false` 下 `global ≠ window`；修复 .xls 静默失败 / .pptx 图片缺失 / .xmind 卡死；index.html accept 补 .xls/.xmind/.opml/.json；shell.js importFileObj 加格式预检查 + error toast；96/96 绿
- [2026-09-15] 台账周报自动生成脚本 `scripts/ledger-weekly.js` 落地：从 issues/decisions/context + npm test 实跑全链路自动聚合，支持 `--file / --weeks / --no-save` 三参数
- [2026-09-15] 台账系统初始化：decisions/issues/context/index 四文件落地
- [2026-09-15] Mindmap 新增 XMind/MD/OPML 导入，mkNode 默认色 bug 已修
- [2026-09-15] 历史版本快照 + LCS Diff 上线
- [2026-09-15] 台账系统联调：OS.ready() Promise 机制落地（auth.js + store.js）；6 处源码注入预防 TODO 注释；8 坑扫描 5 已修复 2 旧预防注释已就位 1 新注入
- [2026-09-15] 8 红单全修 → 96/96 绿（7 个 PDF escapeHtml + 1 个 shell _on 作用域）
- [2026-09-15] 台账自动化脚本 `scripts/ledger-precheck.js` 落地：改前扫坑 + 输出 TODO 建议 + exit 1 阻断 CI；issues.md 新增 2 条坑（含快速排查清单）

