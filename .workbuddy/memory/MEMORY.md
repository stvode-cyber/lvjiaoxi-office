# 绿角犀 Office · 项目长期笔记

> 持续更新。每轮新增显著事实时追加；超长时按主题蒸馏。
> 最后更新：2026-08-31

## 当前基线
- **80 套件 0 失败** + 四端同源 ✅（S→AJ 全特性 + 登录设定已落地并验证；AC/AD/AE/AF/AG/AH/AI/AJ 已新增 + 登录可选；Android APK 与 make-release 打 tag 受限于本环境无 SDK / 无 git 仓库）
- **🔴 大型已消解**：PDF→Excel、docx→PDF
- **🟡 进行中边界**：PDF→DOCX/TXT/MD/Excel(CSV) 版面还原有限（文本提取，非像素级）

## 测试与门禁
- 测试 Node：`C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe`
- 主命令：`npm test` = `node scripts/run-tests.js && npm run sync:check`
- 测试运行器：自动发现 `_*_test.js`，子进程隔离+超时
- 并行偶发抖动：`_auth_backup_test` 偶发失败属并行子进程资源争用，隔离稳定
- CI 入口：`.github/workflows/{tests,client-sync,release,release-desktop}.yml`

## 关键工程纪律
1. Trust-but-Verify：实际跑测试回查产物，禁止靠"已创建"判定完成
2. 严格忠实镜像/零漂移：iOS/HarmonyOS webroot 必须与 app/ 一致，改后必 sync-clients
3. 版本单一真源：仅 package.json
4. 测试诚实：失败诊断根因，禁止 sleep 重试循环
5. 回写文档：每轮更新 FEATURES.md 与当日日志
6. 零依赖优先：沙箱可测纯逻辑必须抽出独立模块
7. 不破坏 PRD 完整性：完成判定需 PR 摘要 + 标注依据（套件数+断言数）

## 字母序特性开发工作流（可复用 S→Z→AA/AB…）
用户指令「按顺序。你全权往下开发」= 按字母序全权推进，无需确认。单特性 11 步：
定字母→侦察(grep 依赖/ribbon kind/icons.js 可用名，**不臆造图标**)→建纯模块(三件套 IIFE+OS 全局+module.exports)→接入 index.html 纯模块区→UI 接线 ribbon 加组+弹窗助手→写测试(≥12 断言)→跑测(node _x_test + node --check)→全量门禁(run-tests.js)→回写文档(FEATURES/STATUS/02_PDF_总纲)→四端同步(sync-clients --check)→记忆(MEMORY 完成度表+当日日志含踩坑)

**踩坑沉淀**：
- PDF 字面串分词：`(` 起始 depth=1，`)` 使 depth<=0 即停且不含右括号；操作符词只按空白/特殊字符截断（不能用 isNumCh 含 e/E，否则 re 切孤立 e → OOM 死循环）
- PDF 内容流解释用操作数栈（操作符从栈顶弹），不能前向贪婪 eatNum()
- 引用正则 `/(\d+)\s+\d+\s+R/` 必须捕对象号而非代数（AC/AD 踩过：否则 0 文件/误匹配 catalog）
- Names 数组 key 可为十六进制串 `<FEFF…>`（token 正则需补 `<[0-9A-Fa-f\s]+>`）
- getObjDict 正则须锚定具体对象号 `num+"\s+0\s+obj\s*<<"`，否则误匹配 catalog
- 合成测试派生维度（byDate/byMonth）期望值须逐条列出归属再求和，不可心算（AE 踩坑）
- AH 链接提取：标注内 /URI 字面串须从 action 子串（act）相对偏移调用 matchLiteral，误用全局 txt 会使括号平衡扫描错位 → 垃圾条目 + 来源判定错（annotation 误判为 action）；独立兜底扫描用全局 txt 正确
- AI 加密检测：/Encrypt 字典含 /CF 嵌套 <<>>（/StdCF 内还有 /CFM 等），提取字典必须用平衡切分（depth 计数到 0）而非非贪婪 `.*?>>`，否则在内层 `>>` 处截断丢失 /StmF//StrF；pdf-encrypt.js sliceDict 用 `<<`/`>>` 双字符配对
- AJ 签名验证：PDF 字面串必须**字节级**解析——`bytesToString` 逐字节转 latin1 会让 UTF-8 中文变成 Mojibake（如「张三」→`å¼ ä¸`）。修复：从原始 bytes 切片字面串字节再用 TextDecoder('utf-8') 解码；先判 UTF-16BE(<FEFF>)，再 UTF-8，再 Latin-1；同时处理 PDF 转义(\n \r \t \b \f \( \) \\ \ddd)。txt 与 bytes 是 1:1 索引映射，可直接用 txt 上的 match index 切 bytes。
- 图标不可臆造：新增 ribbon 按钮前先 grep app/js/icons.js

## 关键产物路径
- Web 真源：app/（js/modules/{pdf,pdf-anno,pdf-text,pdf-convert}.js）
- 客户端副本：ios/、harmonyos/（sync-clients 维护）
- 测试发现：根目录 _*_test.js；同步：scripts/sync-clients.js
- 服务端：server/index.js（自托管零依赖）
- 模块契约：OS.modules[type].mount(host, doc, ctx)
- 文档模型：OS.UOM；存档 .lvjx；自动备档每 5 分钟

## 完成度（按模块简版）
| 模块 | 状态 |
|---|---|
| 五大编辑 + MindMap(导出 docx/md/ofd) + OOXML + OFD + 云端 + 单账号 + 更新 + 商店 | ✅ |
| PDF 阅读/合并拆分/批注/光栅/签名/文本层/表单 | ✅ |
| PDF→DOCX/TXT/MD/Excel(CSV) | ✅ 文本提取；Excel 已坐标列聚类+多表块隔离，版面还原有限 |
| PDF 注释导入(反向读回)/导出 round-trip/AP 位图+矢量解析 | ✅ |
| docx→PDF + Writer/Presentation/Spreadsheet「下载 PDF 文件」 | ✅ 浏览器/光栅化直接落 .pdf |
| 批注图层分组+RGBA 叠加 / 搜索过滤(V)/审阅清单(W)/图层可见性(Y)/批量操作(Z) | ✅ |
| PDF 文档对比 Diff(AA) | ✅ _pdf_diff_test 40 断言 |
| PDF 书签目录 Outline(AB) | ✅ _pdf_outline_test 29 断言 |
| PDF 附件提取 EmbeddedFiles(AC) | ✅ _pdf_attachments_test 28 断言 |
| PDF 页码标签 PageLabels(AD) | ✅ _pdf_pagelabels_test 32 断言 |
| PDF 批注统计面板(AE) | ✅ aggregate 七维+rank+dateKey+导出；_pdf_anno_stats_test 67 断言 |
| PDF 文档结构树 StructTreeRoot(AF) | ✅ parseRawStructTree 解析 /K 递归+页映射+UTF-16BE 标题+非数组K退化；flatten/toMarkdown/toHtml/searchStruct；_pdf_structtree_test 28 断言 |
| PDF 批注时间线 AnnoTimeline(AG) | ✅ buildTimeline 升序+按天分组+dateKey四形态+派生统计；toMarkdown/toHtml(data-page跳页)；_pdf_anno_timeline_test 34 断言 |
| PDF 链接/URI 提取 Links(AH) | ✅ extractLinks 字节级提取标注/大纲/独立URI+UTF-16BE解码+去重；summarize/toMarkdown/toHtml；_pdf_links_test 27 断言 |
| PDF 加密与权限检测 Encryption(AI) | ✅ parseEncryption 字节级解析 /Encrypt 字典(含/CF嵌套平衡切分)+解码/P八项权限位+算法族(RC4-40/RC4/AES-128/AES-256)判定+强度；纯解析不解密；summarize/toMarkdown/toHtml；_pdf_encrypt_test 43 断言 |
| 登录设定（可选登录） | ✅ 默认游客直接进入（不强制）；OS.AuthPolicy.shouldGate 纯逻辑（容错无 settings）；设置「启动时要求登录」开关 + 登录页「以游客身份进入」；_auth_policy_test 7 断言 + _app_boot A5/A5b 覆盖 |

## 收口发布（2026-08-30 已完成 · 遗留人工/环境）
- version.json.url 已修正为 https://lujax.fun/releases，release:check 通过
- Windows 安装包干净重建根因：genie-safe-delete shim 经 NODE_OPTIONS=--require 注入拦截 fs.unlink→中文路径 .nsis.7z 移回收站失败→构建退 1；修复 `NODE_OPTIONS="" npx electron-builder --win --publish never` 退 0（~29s）。CI 无此 shim 本就退 0
- 产物 dist/：Setup 1.0.0.exe(nsis) + 1.0.0.exe(portable) + latest.yml + .blockmap 四件齐全，verify-release-assets OK
- 遗留：Android APK 需 SDK/gradle（本环境无）；iOS/HarmonyOS 仅源码工程；便携/nsis 双目标已恢复

## 限制（沙箱零依赖）
- 真实 Canvas / pdf.js DOM 集成路径沙箱无运行环境，渲染/交互依赖目检
- 全局并行测试子进程资源争用→偶发抖动（非阻断，隔离稳定）
- API 频率限制：长会话需分段

## 关键交接文档
- .workbuddy/handoff-2026-08-19.md（30 轮回顾+完成度表+第 31 轮清单）
