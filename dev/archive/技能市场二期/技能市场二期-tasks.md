# 技能市场二期 · 任务清单

- [x] 步骤 1：放弃改 skill-catalog-service.ts，二期自己写 12 行 scanLibraryDir 复用 parseSkillManifest（context D1 已更新） → verify: 决策记录留痕
- [x] 步骤 2：写 `packages/server/src/skill-market-service.ts`（搜索 + cache + 下载 + 路径配置 + 库扫描 + 安全校验三件套：repoUrl regex / 大小上限 / dereference cpSync） → verify: server typecheck 通过
- [x] 步骤 3：写 `packages/server/src/routes/skill-market.ts`（5 个端点 + zod + serverLog 起止配对 + 单并发锁 + git 缺失 503） → verify: server typecheck 通过
- [x] 步骤 4：在 `packages/server/src/index.ts` 注册新路由 → verify: server 重启不报错
- [x] 步骤 5：在 `packages/web/src/types.ts` 加 market 类型 + `api.ts` 加 5 个客户端函数 → verify: web typecheck 通过
- [x] 步骤 6：改 `packages/web/src/components/sidebar/SkillsView.tsx` —— mode 切换、本地库 section、市场搜索视图、⚙ 库路径按钮、内联抽 MarketResultRow + LibrarySection 子组件 → verify: web typecheck 通过
- [x] 步骤 7：双语 README 同步（Highlights 一期那条扩展 + Architecture 加 skill-market 行 + 默认配置位置） → verify: 两份 README 都含市场说明
- [ ] 步骤 8：浏览器手工实操验收（待主理人触发） → verify: 按 context 验收回放路径走一遍 + 失败分支至少触发一次 + 落盘日志 grep 命中
- [x] 步骤 9（验收期 UX 跟进）：本地库按"短横线前缀"自动收成折叠组，组级"全部装到本项目 / 全部卸载"按钮，单行加 🗑（从本地库删）；后端补 `POST /api/skill-market/library/delete`（路径越狱防御 + serverLog 起止配对） → verify: server typecheck 通过、web typecheck 通过；浏览器里 gstack 一族折叠成一行；点"全部卸载"后整组消失
- [x] 步骤 10（验收期 UX 跟进 v2）：分组+折叠+批量按钮推广到三栏（项目技能 / 全局技能 / 本地库），不仅本地库；项目栏组级"全部卸载（项目）"，全局栏组级"全部装到本项目"；提取 `groupByPrefix<T>` 通用 helper，复用到 SkillSection 和 LibrarySection → verify: web typecheck 通过；浏览器全局技能栏 gstack 也折叠成一行
