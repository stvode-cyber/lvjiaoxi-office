# FD-08-test · 测试与质量

## 说明
质量门禁：整链 `npm test` = `node scripts/run-tests.js && npm run sync:check`，**87 套件 0 失败**；CI 四 yml（tests/client-sync/release/release-desktop）。

## 注释（细节 · 坑）
- 运行器自动发现 `^_.*_test\.js$`，子进程隔离 + 超时；纯逻辑抽独立模块便于沙箱零依赖测。
- 偶发抖动：`_auth_backup_test` 并行资源争用（非阻断，隔离稳定），不归为失败。
- 缺完整 E2E：UI/Canvas 交互依赖目检（沙箱无运行环境）。
- 测试诚实纪律：失败诊断根因，禁 sleep 重试循环；门禁全绿才标记完成。

## 目标（对应 G / VG）
- **G**：质量门禁（可验证、可交付）。
- **VG**：全功能可交付、回查无阻断缺陷。

## 关联（↔报错 / ↔决策 / ↔动作）
- ↔A `npm test` 整链 87 套件 0 失败（含 `_pdf_merge_test` 12 断言）；模块总纲 `模块/08_测试与质量_总纲.md`
- ↔Dc 四端同源须 `sync:check` 门禁（改 web 须同步 iOS/HarmonyOS 才过关）
