# 修复开发启动器依赖缺失 · Context

## 关键文件

- `start.bat`
  - 开发/稳定模式分流，当前开发模式走 `dev:alt`。
- `package.json`
  - `scripts.dev:alt` 通过 `cross-env` 注入开发端口和后端地址。
- `pnpm-lock.yaml`
  - 已声明 `cross-env@7.0.3 -> cross-spawn@7.0.6`，说明锁文件不是缺依赖。
- `node_modules/.pnpm/cross-env@7.0.3/node_modules`
  - 实际只有 `cross-env`，缺少 `cross-spawn` 链接，说明本地安装目录残缺。

## 决策记录

- 选“让 `start.bat` 直接设置环境变量，再调用底层 dev 命令”，不选“继续依赖 `dev:alt`”。
  - 原因：报错发生在 `cross-env` 这层；批处理本来就能在 Windows 上直接 `set` 环境变量，改动最小。
  - 资深工程师会不会觉得过度设计？不会。这是去掉单点脆弱依赖，不是加抽象。
- 不先改锁文件或新增 direct dependency（直接依赖）。
  - 原因：锁文件已正常，问题是本地链接残缺；加更多依赖只是在掩盖安装目录问题。
  - 资深工程师会不会觉得过度设计？如果为了一个 Windows 启动器问题去扩依赖，反而更像过度。
- 先修开发模式，不扩大到 stable 模式。
  - 原因：当前失败发生在 `dev:alt`，stable 走 `dev:all`，先做外科式改动。
  - 资深工程师会不会觉得过度设计？不会，边界清晰。

## 依赖与约束

- 约束：只能做外科式改动，不顺手重构启动体系。
- 约束：如果改了源码/脚本，至少跑一次对应命令验证行为。
- 依赖：`pnpm -r --parallel run dev` 仍是实际启动 server/web 的底层命令。
- 依赖：Windows `cmd` 环境变量传递规则，确保当前窗口内设置的变量能传给 `pnpm` 子进程。
