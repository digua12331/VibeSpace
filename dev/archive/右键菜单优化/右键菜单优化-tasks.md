# 右键菜单优化 · 任务清单

- [x] 步骤 1 · FilesView TreeRow 递归补传 onContextMenu → verify: 展开 `packages/web/src` 下任一子文件夹，对其中的文件**和**子文件夹分别右击，都能看到右键菜单
- [x] 步骤 2 · ProjectsColumn 菜单锚定项目行（左端对齐）→ verify: 在同一项目行的项目名、路径文本、右侧小图标、空白处四个位置分别右击，菜单 x/y 位置一致（菜单左端对齐行左端、覆盖在项目列表栏内，不再从行右缘向外伸出）
- [x] 步骤 3 · ProjectsColumn 菜单 "🌿 代码更改" 行尾加未提交数红点（staged + unstaged） → verify: (a) 当前仓库（有未提交改动）右键项目→徽章显示数字；(b) 切换到 clean 或非 git 目录→无徽章；(c) 修改一个已跟踪文件后关掉再开菜单→数字刷新；(d) 新建 untracked 文件→数字不变
- [x] 步骤 4 · 类型检查 → verify: 在 `packages/web/` 下 `./node_modules/.bin/tsc -b` 退出码 0，无错误（`pnpm --filter` 在本机未匹配包名，改用本地二进制直跑）
