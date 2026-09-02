# 绿角犀 Office · 项目长期笔记

> 持续更新。每轮新增显著事实时追加；超长时按主题蒸馏。
> 最后更新：2026-09-01

## 当前基线
- **87 套件 0 失败** + 四端同源 ✅（S→AN 全特性 + 登录 + Windows 安装包文件关联/默认打开 + 桌面端全自动更新已落地并验证 + **PDF 1.5+ 对象流(ObjStm)合并/拆分已实现**；Android APK 需 SDK/gradle 本环境无；git repo 已打 tag v1.0.0~v1.0.16，仅无 remote 未 push）
- **🔴 大型已消解**：PDF→Excel、docx→PDF
- **🟡 进行中边界**：PDF→DOCX/TXT/MD/Excel(CSV) 版面还原有限（文本提取，非像素级）

## 测试与门禁
- 主命令：`npm test` = `node scripts/run-tests.js && npm run sync:check`
- 运行器：自动发现 `_*_test.js`，子进程隔离+超时；CI：`.github/workflows/{tests,client-sync,release,release-desktop}.yml`
- 偶发抖动：`_auth_backup_test` 并行资源争用（非阻断，隔离稳定）

## 关键工程纪律
1. Trust-but-Verify：实跑测试回查产物，禁靠"已创建"判定
2. 严格忠实镜像：iOS/HarmonyOS webroot 必与 app/ 一致，改后 sync-clients
3. 版本单一真源：仅 package.json（bump-version.js 同步四端）
4. 测试诚实：失败诊断根因，禁 sleep 重试循环
5. 回写文档：每轮更新 STATUS/当日日志
6. 零依赖优先：沙箱可测纯逻辑抽独立模块

## 字母序特性开发工作流
「按顺序全权往下开发」= 按字母序推进无需确认。单特性 11 步：定字母→侦察(grep 依赖/icons.js，**不臆造图标**)→建纯模块(IIFE+OS 全局+module.exports)→接入 index.html→UI 接线 ribbon+弹窗→写测试(≥12 断言)→跑测(node _x_test + node --check)→全量门禁→回写文档→四端同步(sync-clients --check)→记忆

**踩坑沉淀**（PDF 字节级解析高频坑，跨特性复用）：
- 字面串分词：`(` 起 depth=1，`)` 使 depth<=0 即停；操作符词只按空白/特殊字符截断（isNumCh 含 e/E 会切孤立 e→OOM）
- 内容流解释用操作数栈（操作符从栈顶弹），不能前向贪婪 eatNum()
- 引用正则 `/(\d+)\s+\d+\s+R/` 捕对象号非代数；getObjDict 须锚定 `num+"\s+0\s+obj\s*<<"`
- Names key 可为 `<FEFF…>` 十六进制串；/Encrypt /CF 嵌套字典须平衡切分（depth 到 0），非贪婪 `.*?>>` 会在内层截断
- 合成测试派生维度(byDate/byMonth)期望值须逐条列归属再求和，禁心算
- AJ 签名：PDF 字面串**字节级**解析——bytes 切片再用 TextDecoder('utf-8')，先判 UTF-16BE 再 UTF-8 再 Latin-1；处理 PDF 转义；txt/bytes 1:1 索引
- AM：countTopLevelKeys 的 `/` 分支须 i++ 跳过自身（否则死循环挂死）；/Resources 子字典须平衡切分；图像计数须解析间接引用 `/Im1 8 0 R`
- AN 字体：/Flags 属 FontDescriptor 非字体字典；Type0 经 /DescendantFonts→CIDFont 下钻；Type3 无嵌入文件视为已嵌入；未嵌入风险须排除标准14字体；字体对象按号去重；资源缺时沿 /Parent 继承
- AL：lit() 的 blockBytes 须与 blockTxt 同起始 1:1 对齐（用 getObjDict o.start）；XMP 属性形式 `pdf:Title="..."` 须支持；UTF-16BE 字面串字节须包在 `(...)` 内
- 图标不可臆造：新增 ribbon 按钮前 grep app/js/icons.js
- **sliceDict 族末位 `>` 丢失（AP 轮修复，6 模块）**：pdf-actions/pdf-fonts/pdf-docinfo/pdf-encrypt/pdf-formfields/pdf-pageinfo 的平衡切分闭合 `>>` 处 `slice(startIdx,i)` 丢末位 `>`（AO 同族），单层字典靠 lastIndexOf 启发式侥幸、嵌套字典（/Names 三层）必失衡；统一 `slice(startIdx,i+1)`。pdf-pagelabels 的 extractBalanced（i++; break 后 slice）是另一套正确实现勿动
- **合成解析测试 PDF 必须带 `trailer << /Root N 0 R >>`**：findRootDict 锚 /Root regex，缺 trailer 全表挂
- **ObjStm 合成偏移表必须 `num off` 严格交错**（"2 0 3 38 4 84 "）：错一位 parseObjStm 把 offset 当对象号→幻影对象（AQ 轮实测）
- **OS.PdfTool.parsePdf 页面树 walk 无环保护**：/Kids 环→栈溢出；做页面树遍历的模块须自带 visited 安全走树（AQ=pdf-preflight 已内置，勿改为依赖 parsePdf.pages）
- **Edit 工具幻影写入（会话级现象，已两度实测）**：回执成功但磁盘未变——每次 Edit 后必须 grep/Read 回查；批量修改优先整文件 Write 原子重写
- AO 对象流(ObjStm)：parsePdf 须异步（FlateDecode 解压依赖 DecompressionStream）；extractStreamData 须剥 `endstream` 前 EOL（否则 deflate 报 Trailing junk）；extractFirstBalancedDict 遇 `>>` 须 `slice(open, i+1)` 含末位 `>`（否则 ObjStm 对象字典丢末位 `>`，合并真实 1.5+ PDF 输出畸形页面字典）；偏移表偏移相对 First 计量

## 关键产物路径
- Web 真源：app/（js/modules/{pdf,pdf-anno,pdf-text,pdf-convert}.js）；客户端副本：ios/、harmonyos/（sync-clients）
- 测试：根目录 `_*_test.js`；同步：scripts/sync-clients.js；服务端：server/index.js（零依赖）
- 模块契约：OS.modules[type].mount(host, doc, ctx)；文档模型 OS.UOM；存档 .lvjx

## 完成度（简版）
| 模块 | 状态 |
|---|---|
| 五大编辑 + MindMap + OOXML + OFD + 云端 + 单账号 + 商店 | ✅ |
| PDF 全特性（阅读/批注/光栅/签名/文本层/表单/导出 + AA~AN 解析族 + 1.5+ ObjStm 合并/拆分） | ✅ 单测共 87 套件 0 失败（含 _pdf_merge_test 12 断言） |
| docx→PDF + Writer/Presentation/Spreadsheet「下载 PDF 文件」 | ✅ |
| 批注图层分组/搜索过滤(V)/审阅清单(W)/图层可见性(Y)/批量(Z)/导入导出 round-trip/AP 解析 | ✅ |
| 登录设定（可选登录，游客直进） | ✅ _auth_policy_test 7 断言 |
| Windows 安装包·文件关联/默认打开（注册表） | ✅ _file_args_test 12 断言 |
| 桌面端更新机制 | ✅ **全自动更新模式**（v1.0.15）：启动检查+autoDownload 后台下载+autoInstallOnAppQuit 退出自动装+前端「立即重启」可选；feed-config 返回 generic provider；装 electron-updater ^6.8.9；_feed_config_test 10 断言 |

## 收口发布（遗留人工/环境）
- version.json.url = https://lujax.fun/releases；release:check 通过
- 构建根因：genie-safe-delete shim 拦截 fs.unlink（中文路径 .nsis.7z 移回收站失败→退 1）；`NODE_OPTIONS="" npx electron-builder --win --publish never` 退 0（~30s），nsis+portable 双目标 + latest.yml + .blockmap
- **遗留（P0 功能生效前提）**：须把 dist/ 的 `Setup 1.0.16.exe` + `latest.yml` + `.blockmap` 托管到 https://lujax.fun/releases，旧客户端才会真正拉 latest.yml 走应用内自动更新
- **沙箱网络限制（2026-09-02 实测·铁定）**：沙箱出口走 **HTTP 代理（via: 1.1 google）**，仅代理型 HTTP(S) 可用（github API=200）；**VPS `8.149.245.252` 全端口在 IP 层被防火墙丢弃**——SSH(22/2222/2200/2022)与 HTTPS(443)均 `Connection timed out`（2026-09-02 实测：`lujax.fun` 经 DNS 解析即 `8.149.245.252`，故其 443 也死）。故 SSH/rsync **及**任何指向该 VPS 的发布/上传在沙箱内**物理不可行**（非 IP 白名单问题，是裸 TCP 出口不存在）。私钥 `~/.ssh/id_ed25519_rcprod` 在沙箱但用不上；发布须在有直连 VPS 出口的机器跑 `bash scripts/publish-latest.sh`（自动设 host/user/key 并 SSH find 定位 releases 目录）。下一步若想让我代发：须提供 S3 凭证(`LVJX_FEED_S3_BUCKET`+AWS key，走 HTTPS 代理或许可达，且目标须为代理可达的第三方主机) 或用户侧机器授权。git push 同理：仅当 remote 为代理可达的第三方主机（github/gitee 等）时，我方可在沙箱经代理推送；VPS 上的 git 仍不可达。
- 构建通道坑（2026-09-02）：用 **PowerShell 后台包装**起 electron-builder 会被回收成僵尸（进程亡、TaskOutput 仍 running、无产物）；改用 **Bash 后台通道**更稳。`win-unpacked` 缓存后二次构建显著更快
- 遗留：Android APK 需 SDK/gradle（本环境无）；iOS/HarmonyOS 仅源码工程
- git 无 remote：v1.0.0~v1.0.15 仅本地 tag，配 remote 后 `git push --tags`

## 限制（沙箱零依赖）
- 真实 Canvas / pdf.js DOM 集成路径沙箱无运行环境，渲染/交互依赖目检
- 全局并行测试子进程资源争用→偶发抖动（非阻断）

## 关键交接文档
- .workbuddy/handoff-2026-08-19.md
