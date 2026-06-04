# 技能管理面板 · Plan

## 大哥摘要

这次给你加一个**技能管理面板**：浏览器左侧 ActivityBar 多一个 🧩 入口，点开就能看到 Claude / Codex / OpenCode 这三个 AI 各自装了哪些 skill（技能包，一组教 AI 怎么干活的说明文件夹）。
顶上有三个 tab（标签页）切 agent（AI 命令行工具，比如 Claude / Codex / OpenCode），下面分两栏：上面是"项目里有的"，下面是"电脑全局装的、可以一键塞进当前项目"。装完、卸完会自动刷新。
**只读和管理**这几个文件夹：`.claude/skills/`、`.codex/skills/`、`.opencode/skill[s]/`。**不会动**到你项目里别的代码、对话记录、`.aimon/skills/`（VibeSpace 内部按任务名匹配注入的另一种 skill，跟 AI CLI 自己用的那套是两回事）。
卸载、添加都会弹确认；后端会拦住任何想删到目录外的请求，所有操作同时写到浏览器 LogsView 和本地日志文件，可以回放。
这一期不做"在线搜技能 + 一键下载"的市场（marketplace，类似应用商店），等你点头要再做第二期。

## 目标

为 VibeSpace 增加一个浏览器可用的 SkillCatalogView（技能目录页面），让用户能按 Claude / Codex / OpenCode 查看项目技能和全局技能，并完成安装到项目、从项目卸载、从自定义路径添加这三类操作。

验收标准：

1. 在浏览器 SkillCatalogView 界面能看到各 agent tab 的 skill 列表，并能按 Claude / Codex / OpenCode 切换。
2. 每个 agent tab 都有空态：无 skill 目录或目录下无可用 skill 时显示“暂无”，页面不报错。
3. 全局 skill 可安装到当前项目；项目 skill 可卸载；从自定义路径添加时，源目录存在且包含 `SKILL.md` 才允许继续。
4. `skillName` 含 `..` 或路径分隔符时，后端拦截并返回 400，不会删除目标 skill 目录之外的文件。
5. 后端日志能在 `packages/server/data/logs/YYYY-MM-DD.log` 里 grep 到 `scope=skill-catalog` 的操作日志。
6. 新增的前端操作用 `logAction` 记录起止配对，失败分支至少人工触发一次 ERROR 日志；新增的后端 mutation（会改文件的接口）用 `serverLog` 记录起止配对。
7. `pnpm -C packages/server typecheck` 和 `pnpm -C packages/web typecheck` 通过；关键路径有最小测试或可复现的手工验证记录。
8. README 明确区分 `.aimon/skills`（VibeSpace 内部 hook 注入用）与 `.claude/.codex/.opencode/skills`（AI CLI 自身 skill 系统，直接被各 CLI 读取）。

## 非目标

1. 不做 marketplace（在线技能商店）/ 在线安装，也不做 GitHub 或 skills.sh 搜索下载。
2. 不做 skill 版本管理、升级、回滚。
3. 不做 skill 内容编辑器，本期只负责扫描、安装、卸载和从路径添加。

## 实施步骤

1. 后端新增 skill catalog 服务，负责扫描、解析、安装、卸载。
   verify: 用临时目录构造含 `SKILL.md` 的 skill，能扫描出 project/global 两组；缺 `SKILL.md` 的目录被跳过且不报错；server typecheck 通过。

2. 后端新增并注册 `/api/skill-catalog/*` 路由。
   - `GET /api/skill-catalog/scan` 返回 `{ project: [...], global: [...] }`，前端一次拿到全量数据后按 tab 分组渲染，减少两次串行请求，界面实现也更简单。
   - `POST /api/skill-catalog/add` 安装全局或指定源 skill 到当前项目。
   - `POST /api/skill-catalog/add-from-path` 从用户输入的本地目录安装，server 侧校验源目录存在且含 `SKILL.md`。
   - `POST /api/skill-catalog/remove` 卸载项目 skill；不用 DELETE 带 body，因为跨客户端兼容性差。
   - 删除单独 `/manifest` 端点；scan 响应里每个 skill 条目已含 `manifest` 字段，单独接口冗余。
   verify: 启动后端后 curl `scan` 能拿到 project/global；非法 agent 或非法路径返回 400；后端日志落盘包含 `scope=skill-catalog`。

3. 为后端写安全校验和操作日志。
   - remove 接口：server 侧做路径白名单校验，`skillName` 不能含 `..` 或路径分隔符，最终 path 必须 `startsWith` 目标 skill 目录。
   - add-from-path 接口：server 侧校验源目录存在且含 `SKILL.md`。
   - 所有会改文件的接口用 `serverLog` 记录开始、成功、失败，失败时带简短 `meta.error`。
   verify: 手工传入 `../x`、`a/b`、不存在源路径分别得到 400；日志文件可 grep 到成功和失败记录。

4. 前端新增 API 类型和调用函数。
   verify: web typecheck 通过；请求函数与后端返回的 `{ project, global }` 结构一致。

5. 前端新增 SkillCatalogView 并接入左侧入口。
   - 顶部显示 Claude / Codex / OpenCode tab。
   - 每个 tab 下显示项目技能、全局技能两组列表。
   - 空目录显示“暂无”空态。
   - 项目技能提供卸载按钮；全局技能提供安装到项目；自定义路径提供输入和提交。
   - 前端 mutation 用 `logAction('skill-catalog', action, ...)` 包装。
   verify: 浏览器里能看到各 agent tab 的 skill 列表和空态；添加/卸载后列表刷新；LogsView 能看到 `scope=skill-catalog` 的起止配对。

6. 更新 README / README.zh-CN。
   - 明确 `.aimon/skills` 是 VibeSpace 内部 hook 注入用。
   - 明确 `.claude/.codex/.opencode/skills` 是 AI CLI 自身 skill 系统，直接被各 CLI 读取。
   - 补上技能管理面板的入口和一期能力边界。
   verify: 两份 README 都包含这一区分说明，且没有暗示本期支持 marketplace 或版本管理。

7. 做最终验证。
   verify: 跑 server/web 类型检查；浏览器手工验证 tab、空态、添加、卸载、失败日志；在 `packages/server/data/logs/YYYY-MM-DD.log` grep `scope=skill-catalog`。

## 边界情况

1. skill 目录存在但 `SKILL.md` 缺失：scan 时跳过该目录，不报错。
2. `skillName` 含路径穿越字符（如 `..`、`/`、`\`）：server 拦截并返回 400。
3. add-from-path 源目录不存在：server 返回 400。
4. add-from-path 源目录存在但不含 `SKILL.md`：server 返回 400。
5. 两个 agent 同名 skill：前端按 `agent + name` 区分，不合并。
6. 项目或全局 skill 根目录不存在：scan 返回空数组，前端显示“暂无”。
7. 目标 skill 已存在：安装接口返回明确错误，不覆盖已有目录。
8. Windows 创建 symlink（符号链接，像快捷方式一样指向另一个目录）可能无权限：如果本期保留链接模式，要提示失败原因；默认路径优先用复制，减少用户可见失败。
9. skill 描述缺失：manifest 中 description 为空时前端显示简短占位，不影响列表渲染。

## 风险与注意

1. 最大风险是误删目录，所以 remove 必须做白名单和最终路径校验：`skillName` 禁止 `..` 与路径分隔符，解析后的最终 path 必须 `startsWith` 目标 skill 目录。
2. add-from-path 会读取用户输入的磁盘路径，必须只接受存在且包含 `SKILL.md` 的目录；不把任意文件夹复制进项目。
3. API 设计采用 `POST /api/skill-catalog/remove`，避免 DELETE 带 body 在不同客户端里行为不一致。
4. scan 和 global 合并为一个 `GET /api/skill-catalog/scan`，减少前端串行请求；这属于实现简化，用户看到的是页面加载更直接。
5. manifest 端点删除，因为 scan 已返回每个 skill 的 `manifest`，保留单独端点会增加维护面。
6. `.aimon/skills` 和 CLI skill 目录容易被混淆，README 和界面文案都要说明本面板管理的是 CLI 自身 skill，不是 VibeSpace 的任务注入规则。
7. 日志 scope 统一用 `skill-catalog`，便于在 LogsView 和日志文件里筛选。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：gemini CLI 未安装（spawn ENOENT）
> [Codex 评审] DELETE 带 body 跨客户端兼容差应改为 POST；remove 接口缺路径白名单校验，存在目录穿越风险；scan/global 合并可减少串行请求；manifest 端点冗余可删除。
> [Codex 综合主笔] 采纳所有安全校验建议和 API 简化决策（合并端点、删 manifest、DELETE 改 POST）；放弃 marketplace stub 相关内容留第二期；合并理由是减少前端复杂度且无用户感知差异。
> [Claude 白话化兜底] 重写大哥摘要为 5 行白话版，明确入口（左侧 🧩）+ 双栏布局 + "不会动"边界 + marketplace 留二期；给 tab / agent / marketplace / symlink 这几个第一次出现的术语加白话括注；其余实施细节、安全校验、决策记录保留 Codex 原稿不动。
