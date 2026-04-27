# Claude Code 配置分层（系统级 / 项目级）

> 这份文档是这个仓库的 **Claude Code 配置约定**。任何对 `settings.json` / `settings.local.json` 的改动按这里的规则归位；新项目想复用同样规则，把 `.claude/templates/` 拷过去当模板。

## 一、两层物理结构

| 层级 | 路径 | 是否共享 | 谁负责 |
|---|---|---|---|
| 系统级 | `~/.claude/CLAUDE.md` | 个人 / 本机 | 你自己 |
| 系统级 | `~/.claude/settings.json` | 个人 / 本机 | 你自己 |
| 项目级（共享）| `<project>/.claude/settings.json` | git 仓库 | 项目协作者共享 |
| 项目级（本机）| `<project>/.claude/settings.local.json` | 本机（gitignore）| 当前用户 |
| 项目级 | `<project>/CLAUDE.md` | git 仓库 | 项目工作流 |

加载顺序（高优先覆盖低）：local > project shared > user。

## 二、归位三问

每条 permission entry 在写之前，先依次问三个问题，答完就知道该放哪个文件：

### 1. 这条规则换个项目还会用到吗？

- **会** → `~/.claude/settings.json`（系统级）
  - 例：`Bash(git status)`、`Bash(pnpm:*)`、`Read`、`Edit`、`WebFetch(domain:github.com)`
- **不会**（只在某项目内有意义）→ 进项目级，看下一题

### 2. 项目级的话，要让协作者也有这条权限吗？

- **要**（团队共享，进 git）→ `<project>/.claude/settings.json`
  - 例：`Bash(pnpm --filter @aimon/server:*)`、`PowerShell(& "<absolute>/start.bat")`
- **不要**（只我本机能用）→ `<project>/.claude/settings.local.json`
  - 例：临时 PID 的 `taskkill`、个人本地路径的特殊 node 命令

### 3. 是否含具体 PID / 临时 `/tmp` 路径 / 一次性 JSON body？

- **是** → **直接不要写进任何配置**。这种 entry 永远不会再命中第二次，留下只是噪声。
- **否** → 按上面两条归位。

## 三、系统级红线（deny）

`~/.claude/settings.json` 的 `permissions.deny` 段当前包含以下条目，作用是**即使下面手滑 allow 了 `Bash(*)` 也能拦住**（deny 优先于 allow）：

```
Bash(rm -rf /)
Bash(rm -rf /*)
Bash(rm -rf ~)
Bash(rm -rf ~/*)
Bash(git push --force origin main)
Bash(git push --force origin master)
Bash(git push -f origin main)
Bash(git push -f origin master)
Bash(git push --force-with-lease origin main)
Bash(git push --force-with-lease origin master)
Bash(git config --global *)
Bash(curl * | sh)
Bash(curl * | bash)
Bash(wget * | sh)
Bash(wget * | bash)
```

新项目复用红线时，根据自己的主分支名调整（比如 `develop` / `trunk`）。

## 四、`_doc` 自描述字段

每个 `settings.json` 顶部约定写一个 `_doc` 字段，说明这个文件是哪一层、归我管啥、规则在哪：

```json
{
  "_doc": {
    "tier": "project-shared",
    "purpose": "...",
    "tier_rules": "见 docs/claude-config-tiers.md"
  },
  "permissions": { ... }
}
```

Claude Code 会忽略未识别的顶层键（`_aimon_hooks_version` 已经在用同样套路），所以 `_doc` 不影响功能。

## 五、复用到新项目的流程

1. 把 `<本仓库>/.claude/templates/` 整个目录复制到新项目根的 `.claude/templates/`（也可以只复制其中一个文件）。
2. 用 `settings.project.example.json` 作起点，复制为 `<新项目>/.claude/settings.json`：
   - 改 `_doc.purpose` 为新项目说明。
   - 把 `allow` 里 `<pkg>` / `<script>` 占位换成真实值。
3. 在新项目的 `.gitignore` 末尾加：
   ```
   .claude/*
   !.claude/settings.json
   !.claude/templates
   !.claude/templates/**
   ```
   注意是 `.claude/*` 不是 `.claude/`——后者是目录排除，会让 `!` 白名单失效。
4. 在新项目根 `CLAUDE.md` 顶部加一句：
   > Claude Code 权限分层规则参考 `<本仓库>/docs/claude-config-tiers.md`；新项目复用模板见本仓库 `.claude/templates/`。

## 六、本仓库现状速查

> 改动 settings 时回这张表看一眼，能省你一次"这条该往哪里放"的纠结。

| 文件 | 主要内容 |
|---|---|
| `~/.claude/CLAUDE.md` | 跨项目人格 + 归位三问速查 |
| `~/.claude/settings.json` | 工具族裸名 + 通用命令族 + hooks/plugins/env + deny 红线 |
| `<repo>/.claude/settings.json` | AIkanban 专属：`pnpm --filter @aimon/* :*`、`sync-to-stable.bat` / `start.bat` 启动脚本、`mcp__pencil`、`Skill(codex:setup)` |
| `<repo>/.claude/settings.local.json` | 个人临时 entry（清空，按需累积；含具体 PID / 临时路径的就别累积）|
| `<repo>/.claude/templates/` | 给新项目复用的模板（system / project 两份示例）|
| `<repo>/CLAUDE.md` | 三段式 dev-docs 工作流 + 本文档指针 |

## 七、清理记录

2026-04-27 一次性把以下东西从配置里清掉了：

- 系统级里 configNexus-1 项目的 `node --check src/main/ipc/...`、`xlwt` 相关、特定 Python 文件的 `py_compile` 等——属于别的项目残留。
- 项目级里 `F:\KB\AIkanban-main\...` 路径（项目实际在 `F:\VibeSpace\KB\AIkanban-main`，老路径全部失效）。
- 所有 `taskkill //PID <数字>` 含具体 PID 的条目。
- 所有 `curl ... -d '{...JSON...}'` 一次性请求体。
- 项目级裸 `Bash` `Read` `Edit` 等族——下面所有具体条目就一并清掉，留族名即可（族名移到了系统级）。

清理后两个 settings 文件加起来从约 270 行缩到约 100 行有效规则。
