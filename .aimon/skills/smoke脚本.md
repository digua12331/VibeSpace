---
triggers: [smoke, 冒烟, 端到端验收, 端到端, scripts]
---

# Smoke 脚本约定（针对 scripts/ 下的端到端验收）

## 文件位置 + 命名

- 文件：`scripts/<feature>-smoke.mjs`
- npm script：`package.json#smoke:<feature>`，对应一行 `"smoke:xxx": "node scripts/xxx-smoke.mjs"`

## 端口避让

不要用 8787（dev / stable 默认占）：

- `5474` — persistence-check 已用
- `5476` — worktree-smoke 已用
- 新 smoke 用 `5478` / `5480` ... 偶数递增

env 注入：
```js
const PORT = process.env.AIMON_PORT || "5478";
```

## 必带的环境变量

```js
env: {
  ...process.env,
  AIMON_PORT: PORT,
  AIMON_SKIP_HOOK_INSTALL: "1",  // 不要覆盖宿主 ~/.claude/settings.json
  FORCE_COLOR: "0",
},
```

## 主流程模板（仿 worktree-smoke / persistence-check）

```js
let cleanupTmp = null;
let server = null;
try {
  server = startServer("srv");
  await waitHealth();

  const baseTmp = mkdtempSync(join(tmpdir(), "aimon-<feature>-"));
  cleanupTmp = baseTmp;

  // 1) setup project（需要 git repo 就 git init + commit）
  const proj = await jsonFetch("POST", "/api/projects", { name, path: projDir });

  // 2) 触发被测路径，每步都 assert 状态
  const sess = await jsonFetch("POST", "/api/sessions", { ... });
  if (sess.status !== 201) throw new Error(...);

  // 3) cleanup
  await jsonFetch("DELETE", `/api/projects/${proj.body.id}`);
  await killGracefully(server);
  if (cleanupTmp) rmSync(cleanupTmp, { recursive: true, force: true });

  console.log("=== <FEATURE> SMOKE OK ===");
  process.exit(0);
} catch (err) {
  console.error("[xxx] FAIL:", err.stack ?? err);
  if (server) await killGracefully(server).catch(() => {});
  if (cleanupTmp) rmSync(cleanupTmp, { recursive: true, force: true }, () => {});
  process.exit(1);
}
```

## 启动 / 关停 server

`startServer` / `killGracefully` 函数从 `scripts/persistence-check.mjs` 抄过来即可——它们不在 lib 里没法 import，每个 smoke 都贴一份是约定。

## agent 选择

PTY 启动 session 时 **不要写死** `agent: 'claude'`——很多机器没装 claude，smoke 会失败。用 `agent: 'shell'` 一定可用。如果非要测 claude 行为，加一段 try/catch 跳过：

```js
try { await jsonFetch("POST", "/api/sessions", { agent: "claude", ... }); }
catch (e) { console.log("[smoke] claude not in PATH, skipping ai-specific tests"); }
```

## 断言风格

- 状态码不对 → `throw new Error("step failed: " + JSON.stringify(...))`
- 文件存在/不存在 → `existsSync(path)` 检查 + 抛
- 主仓污染 → `git status --porcelain` 应为空
- 异步操作（worktree-remove / job 完成）→ `sleep(400)` 等一拍再 assert，不要靠 setImmediate

## 验证清单

- `pnpm smoke:<feature>` 退出码 0
- 不留临时文件 / 临时目录
- 不污染用户的 ~/.claude/settings.json
- 不需要外部 CLI（claude / codex）就能跑通主路径

## 不适用

- 单元测试 → 没必要走 smoke 这种重型路径，写 `.test.ts` 用 vitest 跑（项目目前**没有** vitest 集成，添加属于另一个任务）
- 浏览器 UI 验收 → smoke 测不到 React render；那种验收靠浏览器手动 + Dev Docs 任务的浏览器可观察项
