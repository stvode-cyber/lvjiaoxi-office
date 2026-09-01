/* 绿角犀 Office · 桌面更新源解析测试
   验证 resolveUpdateProvider：
     - feed                         -> generic provider
     - 显式 githubRepo              -> github provider
     - releaseUrl / versionJsonUrl 含 github 地址 -> github provider
     - 非 GitHub 的 versionJsonUrl  -> generic provider（核心：启用应用内静默更新通道）
     - 无任何可用源                 -> null
   另验证 normalizeFeedUrl 尾部斜杠归一化。 */
const { resolveUpdateProvider, normalizeFeedUrl } = require("./electron/feed-config");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  ✗ " + name); } }

// 1 feed -> generic
let r = resolveUpdateProvider({ feed: "https://update.lvjiaoxi.cn" });
ok("feed -> generic provider", r && r.provider === "generic" && r.url === "https://update.lvjiaoxi.cn/");

// 2 显式 githubRepo -> github
r = resolveUpdateProvider({ githubRepo: "lvjx/office" });
ok("githubRepo -> github", r && r.provider === "github" && r.owner === "lvjx" && r.repo === "office");

// 3 releaseUrl 含 github -> github
r = resolveUpdateProvider({ releaseUrl: "https://github.com/lvjx/office/releases" });
ok("releaseUrl github -> github", r && r.provider === "github" && r.owner === "lvjx" && r.repo === "office");

// 4 versionJsonUrl 含 github -> github（推导）
r = resolveUpdateProvider({ versionJsonUrl: "https://github.com/lvjx/office/releases" });
ok("versionJsonUrl github -> github", r && r.provider === "github" && r.owner === "lvjx" && r.repo === "office");

// 5 非 GitHub 的 versionJsonUrl -> generic（核心：启用应用内静默更新，无需手动下载原件）
r = resolveUpdateProvider({ versionJsonUrl: "https://lujax.fun/releases" });
ok("versionJsonUrl 非 GitHub -> generic", r && r.provider === "generic" && r.url === "https://lujax.fun/releases/");

// 6 显式 feed 优先于 versionJsonUrl
r = resolveUpdateProvider({ feed: "https://update.lvjiaoxi.cn", versionJsonUrl: "https://lujax.fun/releases" });
ok("feed 优先于 versionJsonUrl", r && r.provider === "generic" && r.url === "https://update.lvjiaoxi.cn/");

// 7 无任何可用源 -> null
r = resolveUpdateProvider({});
ok("无源 -> null", r === null);

// 8 无效 githubRepo 且无其它源 -> null
r = resolveUpdateProvider({ githubRepo: "not-a-repo" });
ok("无效 githubRepo 且无其它 -> null", r === null);

// 9 normalizeFeedUrl 尾部斜杠归一化
ok("normalizeFeedUrl 补尾部 /", normalizeFeedUrl("https://lujax.fun/releases") === "https://lujax.fun/releases/");
ok("normalizeFeedUrl 多余 / 收一个", normalizeFeedUrl("https://lujax.fun/releases//") === "https://lujax.fun/releases/");

const summary = `FEED-CONFIG TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
console.log(summary);
process.exit(fail ? 1 : 0);
