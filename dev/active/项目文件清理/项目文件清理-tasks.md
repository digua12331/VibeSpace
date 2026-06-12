# 项目文件清理 · 任务清单

- [x] 删除 A 类垃圾文件（_tp.bat / dev/_run_test.py / docs/1.md + comments / output/示例功能 / 修复后端启动的 log·err） → verify: 文件不存在，grep 无残留引用，git status 显示预期删除
- [x] 删除 _design-explorations/ → verify: 目录不存在，git status 显示删除
- [x] dev/active 已完成任务目录批量移到 dev/archive（白名单 10 个保留） → verify: dev/active 只剩白名单 10 个目录，archive 43→129，移动 86 个，12 个重名加 -20260612-1530 后缀
- [x] 类型检查/构建确认无误伤 → verify: server tsc --noEmit 通过（exit 0），web build 通过（exit 0）
