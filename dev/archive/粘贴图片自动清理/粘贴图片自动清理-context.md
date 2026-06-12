# 粘贴图片自动清理 · Context

## 关键文件

### 后端（packages/server/src）
- `routes/paste-image.ts:24` — 现有粘贴图片落地路由，定义 `REL_DIR = ".vibespace/pasted-images"`（清理函数复用这个常量）
- `log-bus.ts:185 pruneOldLogs` — **模板范本**：清理函数照抄这个模式（readdir + stat + mtime 比较 + per-file try/catch 容错 + 末尾起止配对日志）
- `log-bus.ts:84 serverLog` — 后端日志入口
- `db.ts:32 getProjectsJsonPath` / `db.ts:346 listProjects` — 用 listProjects 拿所有项目；存配置文件放 `data/` 目录（紧邻 projects.json）
- `index.ts:51 main` — 服务器启动入口，`await app.listen` 之后接入 `pruneOldPastedImages()` fire-and-forget；`148-173` 区块加 `registerAppSettingsRoutes`
- `routes/openspec.ts:9-40` — zod 在路由里的写法范例

**新建文件**：
- `packages/server/src/app-settings.ts` — 全局应用设置读写（getAppSettings / setAppSettings），`data/app-settings.json` 落盘
- `packages/server/src/paste-image-cleaner.ts` — `pruneOldPastedImages()` 实现
- `packages/server/src/routes/app-settings.ts` — GET/PUT REST

### 前端（packages/web/src）
- `api.ts:78 request` / `api.ts:108 jsonInit` — 客户端 HTTP 包装
- `types.ts` — 在末尾追加 `AppSettings` 类型
- `logs.ts:54 logAction` — mutation 起止配对日志
- `components/layout/Workbench.tsx:163-205` footer 区块 — 在"重置布局"按钮旁边插入 ⚙ 按钮
- `components/dialog/DialogHost.tsx` — 只支持 alert/confirm/prompt 三种，**不能复用**做自定义内容弹窗

**新建文件**：
- `packages/web/src/components/SettingsDialog.tsx` — 独立的设置 modal（自管 open state，命令式 API：`openSettings()` + 全局 mount）

## 决策记录

1. **配置存储用 JSON 文件而非 SQLite 表**
   - 选 `data/app-settings.json`：单条配置项、首次启动可缺省、跟 `data/projects.json` 同位置；走 atomic write（`.tmp` + rename）
   - 不选 SQLite 加表：要改 `db.ts` 三段同步 + 五处 SELECT（参见 ARCHITECTURE.md 3.2 节），成本远超本任务收益
   - 资深视角：单值配置项加 SQL 表是**过度设计**，简化到 JSON

2. **清理函数走 fire-and-forget，不阻塞 server 启动**
   - 照搬 `pruneOldLogs` 模式：错误 try/catch 进 warn，单文件失败不阻塞剩余
   - 启动时调一次，**不**做定时器/cron——VibeSpace 是开发工具，启动频次高，启动时清理够用

3. **不在用户修改保留天数时立即清理**
   - 用户刚改完保留天数 → 立即重扫删除 → 可能误删刚粘贴的图（mtime 刚好卡在阈值边缘）
   - 改成"下次启动生效"语义更安全；plan 的"不做手动立即清理按钮"也是同因——保护粘的图

4. **路径白名单：清理只 unlink `<project_path>/.vibespace/pasted-images/<file>`**
   - 校验 `path.resolve(absDir, name)` 后的绝对路径仍以 `path.resolve(absDir) + sep` 开头
   - 不让符号链接 / `..` / 异常文件名导致越界 unlink
   - 这是本任务**唯一**真删用户文件的代码，必须双保险

5. **保留天数 = 0 表示"不清理"，不表示"立刻清空"**
   - zod 范围 `int().min(0).max(365)`；业务里专门 if 早退
   - UI 下拉显示为"不清理"，跟数字脱钩

6. **设置弹窗组件命名 `SettingsDialog`，不叫 `PasteImageSettingsDialog`**
   - 预留扩展：未来加新全局设置直接往里塞 section，不用改组件名
   - 当前只放一个 section，但结构上按多 section 设计（标题 + 一段表单项）

7. **设置 modal 走独立全局 mount，不复用 DialogHost**
   - DialogHost 是 alert/confirm/prompt 模板化弹窗，没法塞自定义表单
   - SettingsDialog 自己导出 `openSettings()` 命令式 API + 全局单例 store（仿 DialogHost 的 listeners 模式），在 Workbench 顶层挂一次

## 依赖与约束

- **新建路由必须注册到 `index.ts:148-173`**（顺序无强要求，跟其他 register 同区块）
- **凡 mutation 必须 logAction 包起止配对**（CLAUDE.md「操作日志规则」硬性）；本任务的 mutation：
  - 前端 `updateAppSettings()` → `logAction('settings','update-paste-image-retention',...)`
  - 后端启动清理 → `serverLog('info','cleanup','paste-images-prune 开始'/'成功'/'失败')`
  - 后端 PUT /api/app-settings → `serverLog('info','settings','update 开始'/'成功'/'失败')`
- **UI 改动验收必须含浏览器可观察项**（CLAUDE.md 硬性）：plan 已列 A/B/C/D
- **交付前 AI 自派 vibespace-browser-tester**（manual.md 2026-05-06）：tasks 末步必含
- **TS 静态类型检查必须过**（CLAUDE.md 执行规则）：tasks 末步含 `pnpm --filter @aimon/server build` 和 `pnpm --filter @aimon/web build`
- **不动 db.ts**（无 schema 变更），不动 ws-hub.ts，不动现有 paste-image.ts 的写图路径
- **写盘 atomic**：`writeFile(tmp) + rename(tmp, real)` 避免半写状态
