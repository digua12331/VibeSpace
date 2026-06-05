# 工作流改独立文件引用 · 任务清单

- [x] 1. 装配改写：workflow-service 加文件/引用常量 + `writeDevDocsFile` + `ensureImportBlock`，`appendDevDocsGuidelines` 改为"写独立文件 + 确保引用块"（去内联、去 ISSUES retrofit；顺手清掉孤儿 `insertSectionBeforeSeparator`）→ verify: server build 过 ✓
- [x] 2. 三态状态：`getDevDocsStatus` 返回 `form: none|inline-legacy|file` + 版本字段（file 读独立文件戳）；`WorkflowStatus.devDocs` + `types.ts` 镜像加 `form` → verify: 断言脚本三态识别正确；server+web build 过 ✓
- [x] 3. 迁移/更新核心：`findInlineBlockRange` + `cutRegionWithLeadingSep` + `updateProjectDevDocs`（legacy→替换成引用块+写文件；file→覆盖文件+自愈引用）；删上轮 `updateDevDocsGuidelines`/`parseInstalledDevDocsVersion` → verify: 断言脚本 A(迁移相邻段逐字保留+变引用行+独立文件含戳)、B(file更新覆盖文件不动引用与内容) 全 PASS ✓
- [x] 4. 卸载兼容两形态 + refresh-all 分派：`removeDevDocsGuidelines` 删引用块或内联块 + 删独立文件；`refreshAllOutdatedDevDocs` 按 form 迁移/更新/跳过 → verify: 断言脚本 C(file卸载)、D(legacy卸载)、E(批量分派) 全 PASS ✓
- [x] 5. 路由+前端三态UI：`projects.ts` update 路由 meta 带 form/action；`api.ts` 加 form/action 类型；`PermissionsDrawer.tsx` 按 form 显示"待迁移/可更新/已是独立文件形态"+对应按钮（迁移/更新），刷新卡片文案改"迁移/更新所有项目" → verify: web build 过 ✓；【待大哥手动验收】浏览器三态显示+按钮翻转+LogsView 起止配对
- [~] 6. 金丝雀：**安全发现——不对 VibeSpace 自身跑自动迁移**。剥离版母版缺 VibeSpace 专属硬规则（如「代码学习指引」CLAUDE.md:288），自动迁移会吞掉，已记 dev/issues.md。普通目标项目安全（断言已证）。→ 金丝雀交大哥：在一个**普通目标项目**点"迁移到独立文件"，开真会话问"工作流第一步是什么"，答得出=引用生效
- [x] 7. 收尾核对白名单 + 双端 build → verify: 见 handoff 末尾 diff；server+web build 均过 ✓
