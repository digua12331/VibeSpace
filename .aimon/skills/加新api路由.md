---
triggers: [route, 路由, api, endpoint, 接口, fastify, 端点]
---

# 加新 API 路由（针对 packages/server/src/routes/）

## 文件位置

新 route 文件放 `packages/server/src/routes/<name>.ts`；导出一个 `registerXxxRoutes(app: FastifyInstance): Promise<void>` 函数；**在 `packages/server/src/index.ts` 注册**（两处都要：import 和 `await registerXxxRoutes(app)`）。

## 模板（最近落地的两个：jobs / subagent-runs）

参考 `routes/jobs.ts` 和 `routes/subagent-runs.ts` 的整体形态：

1. **`zod` 校验 body / params / query**：所有外部输入跑一次 `Schema.safeParse`，失败返 `400 { error: 'invalid_body', detail }`
2. **wire shape 单独定义**：不要把 server 内部类型直接 `JSON.stringify`；定义一个 `WireXxx` interface 和 `serialize(internal): WireXxx` 函数，控制返回字段
3. **404 早返**：找不到 session/project 时立刻 `reply.code(404).send({ error: 'not_found' })`
4. **mutation 路径必带操作日志**：`serverLog('info', '<scope>', '<action> 开始'/'成功 (Nms)'/'失败: …', { projectId, sessionId, meta })` 起止配对（CLAUDE.md 操作日志规则）
5. **catch + serverLog('error')**：失败分支必须有 ERROR 日志条目；用 `app.log.warn` **不**进 LogsView，要进 LogsView 必须 `serverLog`

## 命名约定

- **GET 列表**：`/api/<resource>` 或 `/api/projects/:id/<resource>`
- **GET 单条**：`/api/<resource>/:id`
- **POST 新建/触发**：`/api/<resource>` 或 `/api/<resource>/:id/<action>`
- **PATCH 改字段**：`/api/<resource>/:id/<field>` body `{ <field>: value, ...其他选项 }`
- **DELETE 删**：`/api/<resource>/:id`，可选项走 query string（如 `?gc=true`）—— **不要**给 DELETE 加 body，前端的 `request` helper 不带 content-type 时 fastify 会接受 GET-like body=空

## 路由名称对应的 scope

`serverLog` 第二个参数 `scope` 用小写单词（`project` / `session` / `docs` / `git` / `installer` / `server` / `subagent` / `skills` / `jobs` / `inbox`），跟 LogsView 现有过滤一致。新 scope 想清楚再加。

## 前端 api.ts 同步

后端加 endpoint 后，**必须**在 `packages/web/src/api.ts` 加对应的客户端函数 + 在 `types.ts` 加返回类型。前端组件直接 fetch 是反模式。

## 不适用

- 改现有路由的字段 / 加可选参数 → 直接动现有 route 文件
- 内嵌的 hook 接收（`/api/hooks/claude`）→ 那是 `routes/hooks.ts` 的事，不是新建路由文件
- WS 协议改动 → 是 ws-hub 的事，跟 HTTP route 不在同一个文件
