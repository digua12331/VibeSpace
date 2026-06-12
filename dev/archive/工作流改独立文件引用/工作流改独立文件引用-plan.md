# 工作流改独立文件引用 · Plan

## 大哥摘要

现在每个项目的说明文件 `CLAUDE.md` 里，都硬塞着 361 行的工作流正文，又长又重复（`.aimon/docs/` 里其实还另存了一份）。这次把工作流正文**搬进一个独立文件**，`CLAUDE.md` 只留项目专属的几条 + **一行引用**（`@` 开头，Claude Code 看到这行会自动把那个独立文件读进来，和直接写在 `CLAUDE.md` 里一模一样好使——这点我已查官方文档坐实）。

你能看到的变化：`CLAUDE.md` 从 361 行瘦成几十行的"目录页"，干净好读；工作流正文集中在一个独立文件里，以后改它、更新它都更安全。**功能行为不变**——AI 该遵守的规矩照样全读到。

附带好处：我们一小时前刚做的"一键更新工作流"会顺手变得**更安全**——以前是在 `CLAUDE.md` 里做"外科手术"精确抠出那段再替换（有切错风险），改成独立文件后就是"直接覆盖一个文件"，不可能误伤别的内容。那次做的"版本号、可更新徽章、刷新所有项目"按钮都保留，只是底层换了更稳的做法。

需要担心动到的：已经装过工作流的项目要做**一次性搬迁**（把 `CLAUDE.md` 里那 361 行删掉、落下独立文件、补上引用行）。搬迁只动工作流相关部分，你自己在 `CLAUDE.md` 里写的项目专属内容会原样保留。建议**先拿 VibeSpace 自己这个项目当小白鼠**验证没问题，再用"刷新所有项目"推给其余项目。

## 目标

把 Dev Docs 工作流的分发形态从"内联进 CLAUDE.md 的大段文本"改成"独立文件 + CLAUDE.md 一行 `@` 引用"，并把"更新"机制从"CLAUDE.md 内块替换"改成"整文件覆盖"。

可验证的验收标准：
1. **装配产物变形态**：对一个干净项目执行装配，结果 = ①落下独立文件（如 `.aimon/workflow/dev-docs.md`，含版本戳）②`CLAUDE.md` 里出现一行 `@.aimon/workflow/dev-docs.md`，而**不再**有 361 行内联正文。
2. **引用真生效**：在一个真 Claude Code 会话里，CLAUDE.md 只放引用行，验证 AI 能读到工作流规矩（人工：开会话问"当前工作流第一步是什么"，答得出 = 通过）。这是迁移全量前的金丝雀闸门。
3. **更新=整文件覆盖**：改母版版本号后，对已装项目执行更新，独立文件被整体覆盖成最新、CLAUDE.md 的引用行和项目专属内容逐字不变；断言脚本验证。
4. **旧项目可迁移**：对一个"还是 361 行内联老形态"的项目执行迁移，结果 = 内联块被干净移除（不误删相邻 Superpowers/Issues 等段）、落下独立文件、补上引用行；断言脚本验证三段式 CLAUDE.md 迁移后相邻段逐字保留。
5. **状态识别三态**：`workflow-status` 能区分「未装」「老内联形态(待迁移)」「新文件形态(已迁移，可能 outdated)」，前端徽章对应显示。
6. **类型检查通过**：`pnpm -F @aimon/server build` 与 `pnpm -F @aimon/web build` 均成功。
7. **浏览器可观察**：workflow 页签里，老形态项目显示"待迁移到独立文件"并能一键迁移；迁移后显示"已是独立文件形态"；LogsView 看到 `scope=project action=migrate-workflow` / `update-workflow` 起止配对。

## 非目标 (Non-Goals)

- **不动源头 4 份镜像的统一**（仓库自身 CLAUDE.md / AGENTS.md / `dev-docs-guidelines.ts` 常量 / 仓库外 `F:\VibeSpace\CLAUDE.md`）——本轮仍以 `DEV_DOCS_GUIDELINES` 常量为内容母版，把它**写出**到独立文件即可；把常量改成"读单一 .md 文件的 loader"留作后续任务。
- **不改 Superpowers / OpenSpec / harness 的分发形态**——本轮只迁 Dev Docs 工作流段。Superpowers 同样是内联段、同样可照此模式改，但不在本轮。
- **不删除上一任务做的版本/outdated/refresh-all 骨架**——复用并改造，不推倒。
- 不改任何产品功能、不动数据库表结构、不动项目业务代码。

## 实施步骤

1. **定独立文件落点 + 内容来源**：独立文件路径定为 `.aimon/workflow/dev-docs.md`（`.aimon/` 已是 harness 管理区、已纳入 git 跨设备；`workflow/` 子目录与 `runtime/`(gitignore) 区分开，本文件要进 git）。内容来源 = 现有 `DEV_DOCS_GUIDELINES` 常量（已是"剔除 VibeSpace 专属"的目标项目版），版本戳 `<!-- dev-docs-workflow:vN -->` 放文件首行。
   → verify: 常量能原样写出成一个独立 .md；server build 过。
2. **装配改写**：`appendDevDocsGuidelines` 改为"写独立文件 + 确保 CLAUDE.md 含引用行"（幂等：引用行已在则不重复加；独立文件总是写最新）。引用行形如 `@.aimon/workflow/dev-docs.md`，相对 CLAUDE.md 目录=项目根，项目内相对路径不触发授权弹窗。
   → verify: 干净项目装配后产物符合目标①②；server build 过。
3. **更新改写**：`updateProjectDevDocs` 改为"覆盖独立文件"，删掉 CLAUDE.md 内块替换逻辑（`updateDevDocsGuidelines` 块边界那套）。保留版本戳读取/outdated 判定，但**改成读独立文件的戳**。
   → verify: 断言脚本——改版本号后更新，独立文件被覆盖成新版、CLAUDE.md 引用行+项目内容不变。
4. **迁移能力（老内联→新文件形态）**：新增 `migrateProjectDevDocs`——检测到 CLAUDE.md 含老内联锚点 `# Dev Docs 工作流` 正文块时：①用安全块边界移除内联块（复用上一任务验证过的"锚点→下一 `\n\n---\n\n#`"算法，保住相邻段）②落下独立文件 ③在原位置补引用行。`refresh-all` 扩展为"老形态先迁移、新形态查 outdated 再覆盖"。
   → verify: 断言脚本——三段式([项目内容]+[老内联Dev Docs]+[Superpowers])迁移后，项目内容/Superpowers 段逐字保留，Dev Docs 变成一行引用 + 独立文件存在。
5. **状态三态 + 路由**：`getDevDocsStatus` 返回 `form: 'none' | 'inline-legacy' | 'file'` + 版本字段；`WorkflowStatus.devDocs` 与前端 types 同步。`projects.ts` 加/改 `migrate` 动作，`routes/workflow.ts` 的 refresh-all 内部走"迁移+更新"，均 serverLog 起止配对。
   → verify: server+web build 过；构造三种形态项目，status 各自正确。
6. **前端形态显示 + 按钮**：`PermissionsDrawer.tsx` workflow 页签：老形态显示"待迁移到独立文件"+"迁移"按钮；新形态 outdated 显示"可更新"+"更新"按钮（沿用上轮 UI）；"刷新所有项目"文案改为"迁移/更新所有项目"。均 logAction 包。
   → verify: web build 过；【待大哥手动验收】浏览器三态显示正确、点迁移/更新后状态翻转、LogsView 起止配对。
7. **金丝雀实测**：先只对 VibeSpace 自己这个项目跑一次"迁移"，开一个真 Claude Code 会话验证引用进来的工作流照样被遵守（验收标准#2），确认后再谈全量。
   → verify: 真会话里 AI 能复述工作流关键规则。

## 边界情况

- **HTML 注释被注入剥离**：`@import` 进来的内容里 `<!-- 版本戳 -->` 会在注入 AI 上下文时被剥掉——不影响功能，因为版本检测是从**磁盘**读文件，不是从 AI 上下文读；反而省 AI 上下文。
- **引用行已存在但独立文件丢失**：装配/更新时若 CLAUDE.md 有引用行但磁盘无独立文件，应补写独立文件（自愈），不报错。
- **老内联块后面接了 Superpowers 段**：迁移移除内联块必须用"下一 `\n\n---\n\n#`"边界，严禁切到 EOF（上一任务已踩过、有断言覆盖）。
- **项目无 CLAUDE.md**：装配时创建，只含引用行（+ 可选项目占位）。
- **用户手改过内联块**：迁移会丢弃手改的工作流正文（按设计——正文是机器产物搬到独立文件）；引用行外的项目专属内容保留。
- **重复迁移**：已是文件形态的项目再点迁移 = 幂等 no-op（或转为"更新"）。

## 风险与注意

- **行为押在 `@import` 可靠性上**：官方文档明确"自动展开、每次会话、与内联同等强度、项目内相对路径不弹授权框"（已查证），但这是把全仓库铁律的载体从内联换成引用。用**步骤 7 金丝雀**兜底——VibeSpace 自身先迁、真会话验证后再全量，不一上来全改。
- **破坏性变更协议触发**：本任务会改 `WorkflowStatus` 共享导出类型（加 `form` 等字段，向后兼容加法）、改/删 `updateDevDocsGuidelines` 内部函数（非导出）、改装配/更新行为。动手时按协议 grep 全部引用点确认。不删除对外 HTTP 路由（`update` 复用、refresh-all 复用，至多加 `migrate`）。
- **会部分替换上一任务的实现**：上一任务的"CLAUDE.md 内块替换更新"被本任务的"整文件覆盖"取代；版本戳/outdated/refresh-all 概念与 UI 保留改造。这是有意的架构升级，非返工。
- **VibeSpace 自身 CLAUDE.md 含项目专属内容**：它不是纯通用工作流（混了 logAction/serverLog 具体名等）。迁移它时要确保只搬"通用 Dev Docs 工作流段"、保留项目专属补充段——这正是金丝雀要重点盯的。
- **memory 参考**：上一任务经验"装/卸整套配置要表达 partial、兼容旧项目半装状态"（auto.md 2026-05-01）→ 本轮三态识别正是落实；"改后端 API 必须全仓搜调用点"→ 改 status 形状/装配函数时执行。

## 多模型 Plan 会审

> 跳过：Codex CLI 未安装（上一任务已确认 companion 报 "Codex CLI is not installed"），按工作流回退 Claude 单独写 plan，未反复重试。本该交给 Codex 的风险点（@import 可靠性、迁移块边界、三态识别、与上一任务实现的替换关系）已由 Claude 自审 + 查证官方文档写入「边界情况」「风险与注意」。大哥若想要 Codex 二次把关，装好 `@openai/codex` 后说一声补一轮。
