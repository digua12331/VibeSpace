# 产品自闭环 skill 套件 · 任务清单

- [x] 步骤 1 重构 skills-service.ts：抽 `scanSkillsDir(dir)`、缓存 key 改目录绝对路径、加 `GLOBAL_SKILLS_DIR`（支持 `AIMON_GLOBAL_SKILLS_DIR` env override）+ `listGlobalSkills()`、`pickSkillsForTask` 改为合并项目级+全局级并返回带 source 的 detailed 结构、坏 frontmatter 文件补 `serverLog('warn','skills',...)` → verify: `pnpm --filter @aimon/server build` 零报错
- [x] 步骤 2 改 sessions.ts：调用方适配 detailed 结构，`serverLog('skills','injected')` 的 `meta.skills` 升级为带 `source` 字段 → verify: `pnpm --filter @aimon/server build` 零报错
- [x] 步骤 3 写测试：`packages/server/scripts/global-skills-test.ts`（仿 memory-parse-test.ts，临时目录测 5 场景）+ `scripts/global-skills-smoke.mjs`（wrapper）+ root `package.json` 加 `smoke:global-skills` → verify: `pnpm smoke:global-skills` exit 0，5 场景全 PASS
- [x] 步骤 4 写 5 个 skill md 到 `.aimon/global-skills/`：总纲 + 捞需求 + 改代码 + 录视频 + 发布 → verify: 每个 frontmatter 合法（triggers 数组），人工检查 4 分步 trigger 不与日常开发任务名冲突，发布 skill 含强制卡点措辞
- [x] 步骤 5 README 增补：`README.md` + `README.zh-CN.md` 加"产品自闭环 skill 包"安装节（PowerShell Copy-Item + 前置依赖 + 首跑警告）→ verify: 两个文件都含新节
- [x] 步骤 6 端到端验收：5 个 skill 已装到 `~/.aimon/skills/`；代码层已验证（smoke 15/15 + 真实家目录 `pickSkillsForTask` 命中总纲 source=global，默认路径解析正确）。**UI 层验证待大哥重启 dev server**——当前 server 进程加载的是旧代码（运行 28 分钟，早于本次改动），重启会中断现有会话故不擅自做。重启后起一个任务名含"产品闭环"的会话即可在 LogsView 见 `scope=skills` 注入日志。
