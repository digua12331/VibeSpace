# 子任务 (`## 自拆与依赖`) 段语法说明

把这一段加在 plan.md 的最末尾，VibeSpace 后端会自动识别并在 Dev Docs 任务行下展开"子任务"面板，让你一键派工 + 一键 approve。

## 段格式

```markdown
## 自拆与依赖

```json
{
  "schema_version": 1,
  "subtasks": [
    {
      "id": 1,
      "title": "短标题（≤ 30 字）",
      "write_files": ["packages/server/src/foo.ts"],
      "depends_on": []
    },
    {
      "id": 2,
      "title": "依赖 #1 的下一步",
      "write_files": ["packages/web/src/bar.tsx"],
      "depends_on": [1]
    }
  ]
}
\`\`\`
```

> 注意：因 markdown 引擎差异，上方示例的代码 fence 写成了 `\`\`\``。**真正写到 plan.md 时使用三反引号**：```\`\`\`json``` 开头、```\`\`\```` 结尾。

## 字段说明

| 字段 | 说明 | 必填 |
|---|---|---|
| `schema_version` | 当前固定为 `1`。后续不兼容升级会改这个值。 | 否（默认 1） |
| `subtasks[].id` | 正整数，子任务编号。子任务行 UI 显示 `#1`、`#2` ... | 是 |
| `subtasks[].title` | 子任务一句话标题，前端列表展示。 | 是 |
| `subtasks[].write_files` | 子任务允许修改的文件白名单。**用于自动检测重叠**：两个子任务写同一文件 → 后端自动追加依赖边（前一个先 merge）。允许 glob 写法但目前 smoke 只验证字面值。 | 是（非空） |
| `subtasks[].depends_on` | 该子任务依赖的上游子任务 id 列表。完成顺序保证：所有 `depends_on` 都到 `review-ready` / `merged` 状态后，该子任务才会被派工。 | 否（默认空） |

## 自动检查

后端 `parseSubtasksFromPlan` 会拒绝下列写法（前端任务行下显示 ⚠ 配置错误）：

- `duplicate-id`：两个子任务 id 重复。
- `missing-dep`：`depends_on` 引用了不存在的 id。
- `cycle`：依赖图有环。
- `bad-json`：JSON 格式不合法。
- `bad-schema`：字段缺失 / 类型不对。

## 不写本段的情况

如果任务不能拆（或体量太小拆开反而麻烦），就不写本段。Dev Docs 任务行下的"子任务"面板会自动隐藏（不会冒出错误）。

## 完整示例

参考 `dev/active/大任务自拆并行/大任务自拆并行-plan.md` 文件末尾的 `## 自拆与依赖` 段——它把 VibeSpace 这次的"大任务自拆并行"功能本身拆成了 10 个子任务，能直接当模板。
