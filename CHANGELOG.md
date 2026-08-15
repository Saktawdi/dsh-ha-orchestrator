# Changelog

All notable changes to this project are documented in this file.

## [0.11.0] - 2026-08-15

### Added
- Phase 4 随包 Skill 落地：经 `ctx.skills.register` 注册 `ha-orchestrator` 运行时技能（`source: 'bundled'`，模型/用户均可调用，随插件卸载）——双语 markdown 指引正文（使用方式 + 排障：/ha 命令、配置持久化、探测、常见问题），语言切换自动重建；`skills` 服务缺失的部署静默跳过；`/ha diag` 与 `diagnostics` RPC 增加 skills 服务探测。

## [0.10.0] - 2026-08-15

### Added
- Phase 3 对话内 Run 卡片（官方展示投影 + keyed toolview 槽位）：
  - 宿主侧：`orchestrate` 工具结果新增 `runId` 字段；`output.presentationMeta`（runId + 各子任务状态，随会话日志持久化、replay 可还原）、顶层 `presentCall`（pending 标题含模式）、`presentResult`（完成态标题含 runId）；
  - 客户端：经官方 `tool.call.toolview` 槽位注册 `key: 'orchestrate'` 的 RunCard——运行中实时显示子任务数（`subCalls`），完成后显示 runId 标题、状态徽章与输出摘要。

## [0.9.0] - 2026-08-15

### Added
- Phase 2 尾项 + Phase 3 错误体验补充：
  - **子智能体调用预算**：`budgetAgents`（0–128，默认 0 = 不限）对单次编排的全部子智能体调用（含重试/评审/合成）做硬限制，超限即中止并留痕；`poolRun` 新增 `isolate === false` 错误穿透契约（预算类错误不参与任务级隔离）；
  - **supervisor 多评审者**：`reviewers` 数组参数，并行评审（各自 agent、独立 run）后由 supervisor 综合，评审上下文进入最终合成；评审者名经未知名校验；
  - **pipeline 结构化中间产物（轻量）**：carry 增加 `--- 阶段 N: <任务> ---` 标记（`pipelineStageBlock` 纯函数）；
  - **`/ha diag` 命令 + `diagnostics` RPC**：服务可用性（tools/systemPrompt/subagents/llm/fs/timer/settings/agents/agentDefaultModel/sandboxPolicy/commands）、持久化状态、配置/HA 状态加载、语言回滚、注入状态——加载失败时可操作诊断。

## [0.8.0] - 2026-08-15

### Added
- 路线图 Phase 4（发布与生态）文档体系与社区基建落地：
  - 文档体系：`docs/architecture.md`（架构/数据流/服务契约）、`docs/configuration.md`（全部配置项参考）、`docs/security.md`（安全说明）、`docs/verification.md`（测试矩阵/门禁/发布流程）、`docs/compatibility.md`（兼容矩阵）；README/README.zh-CN 增加文档索引与兼容说明，修正过期的「HA 状态仅存内存」描述；
  - 社区基建：`CONTRIBUTING.md`（开发约定/门禁/提交规范）、Issue 模板（bug_report / feature_request / compatibility）；
  - 可访问性：`prefers-reduced-motion` 降级动画、`:focus-visible` 键盘焦点样式；
  - 发布产物验证：`npm pack` 实际产出 tgz（40 文件，~2.6MB）；gh CLI 未安装、npm 未登录，GitHub Release 与 npm publish 待环境就绪后按 `docs/verification.md` 执行。

## [0.7.0] - 2026-08-15

### Added
- 路线图 Phase 3（UI / 产品体验）后端支撑与首批 UI 项落地：
  - **一键导出/导入配置**：RPC `stateExport`（完整配置 JSON）与 `stateImport`（整体替换，缺失节回退默认，落盘/工具重建语义与 stateSet 一致）；设置页「系统」卡片新增导出（含复制）/导入（粘贴并应用）区域；
  - **诊断卡片**：设置页新增「诊断」折叠卡片——HA 熔断/冷却/探测开关概览、隔离清单（含 level 与剩余时间）、失败计数、游标、探测记录、最近运行（runId/mode/tasks/status），10s 轮询；
  - **空状态引导**：未配置备用模型时 HA 卡片显示引导文案（提示使用「推荐备份」）；
  - client TYPERT_REMOTE 描述符补齐（haStatus/haProbeNow/haSuggestBackups/orchRuns/orchListPresets/orchSavePreset/orchDeletePreset/stateExport/stateImport）。

## [0.6.0] - 2026-08-15

### Added
- 路线图 Phase 2 剩余项落地：
  - **全局并发预算**：`orch.globalConcurrency`（0–64，默认 0 = 不限）跨 run 共享信号量，多个编排并发时排队；
  - **supervisor 评审轮次**：`reviewRounds`（1–3）多轮评审，每轮以上一轮输出为上下文；评审 run 计入结果 runs；
  - **新编排模式**：`map-reduce`（并行执行 + 归约任务）、`router`（从候选任务中路由选择一项执行）；
  - **配方（预设）复用**：RPC `orchSavePreset`/`orchListPresets`/`orchDeletePreset` + 工具参数 `preset` 按名执行（调用参数可覆盖），`/orchestrate presets` 查看；
  - **runId 恢复**：工具参数 `resume <runId>`——已完成子任务复用其结果（fanout/supervisor 跳过、pipeline 从失败阶段续跑并继承 carry），结果 runs 按原任务顺序合并，记录带 `resumedFrom`；
  - run 记录补全任务定义（含 prompt），旧记录缺 prompt 时恢复给出明确报错；
  - 设置页新增「全局并发上限」「流水线阶段重试」配置项。

## [0.5.0] - 2026-08-15

### Added
- 路线图 Phase 2（编排能力产品化）核心项落地：
  - **run 持久化**：每次 `orchestrate` 调用生成 `runId`，任务定义/子任务输出/状态/耗时/中止标记落盘 `ha-orchestrator.runs.jsonl`（JSONL 追加写，磁盘保留最近 200 条、内存 50 条）；失败调用同样留痕；
  - **实时进度事件**：`orch/run-start`、`orch/task-status`（running/completed/error）、`orch/run-end`（含 summary/runs/aborted/durationMs）；
  - **`/orchestrate` 命令**：`/orchestrate runs` 最近运行列表、`/orchestrate show <runId>` 详情（每任务状态+输出+汇总）；RPC `orchRuns` 供 UI Run 面板轮询；
  - **pipeline 阶段失败隔离**：单阶段失败按 `orch.stageRetry`（0–5，默认 0）重试，仍失败则标记 `error` 保留原因、中止后续阶段，调用不再整体失败（汇总含失败说明）；
  - **fanout 可选合并**：`mergeInstructions` 存在时追加一次合成任务（`merge`），输出作为最终汇总；
  - 设置页新增「流水线阶段重试」配置项。

## [0.4.0] - 2026-08-15

### Added
- 路线图 Phase 1（HA 能力补强）全部落地：
  - **HA 运行态持久化**：隔离/失败计数/轮换游标/切换历史防抖写入 `ha-orchestrator.ha.json`（与配置同目录），重启自动恢复并继续冷却计时；
  - **两层熔断**：模型级（现有）+ provider 级（`providerThreshold`：同一 provider 隔离 N 个模型后熔断整个 provider，备用挑选跳过该 provider）；`burstWindowMs` 滑动窗口，窗口内多次失败才计入阈值；
  - **真实探测恢复**：冷却到期后以小成本调用（maxTokens=1）探测隔离模型，成功即解除隔离（`ha/circuit-closed`），失败延长冷却并重试（间隔 60s–5min）；provider 通配键到期即解除；
  - **错误分类**：不可重试错误（`INVALID_CREDENTIAL`/`AUTH`/`UNAUTHORIZED`/`NO_ADAPTER`）直接隔离切换、不消耗阈值计数；`CONTEXT_WINDOW_EXCEEDED` 可选降级（`degradeContextWindow`：去掉 reasoningEffort 重试原模型）；
  - **类型化会话事件**：`ha/failover`、`ha/circuit-opened`、`ha/circuit-closed`、`ha/probe`、`ha/state-restored`；
  - **`/ha` 命令**：`/ha status` / `/ha reset` / `/ha probe <provider> <model>`（commands 服务懒注册，缺失不阻塞插件）；
  - **新 RPC**：`haStatus`（隔离层级/失败计数/游标/探测记录）、`haProbeNow`（手动探测，无视冷却直接验证）、`haSuggestBackups`（推荐备份候选，供配置向导）；
  - 设置页 HA 卡片新增 4 项配置（滑动窗口/Provider 熔断阈值/探测恢复/上下文降级）+「推荐备份」按钮。

### Fixed
- `countQuarantinedModels` 前缀计算不再误用 `keyOf(provider, '')`（空 model 会回退通配符，导致 provider 级熔断永远不触发）。

## [0.3.0] - 2026-08-15

### Added
- TypeScript 工程化（路线图 Phase 0 完成）：
  - 源码迁移至 `src/`（`index.ts` + 5 个纯逻辑模块 + `types.ts` 服务契约），`lib/` 为 tsc 构建产物（含 `.d.ts` 类型声明）；
  - `tsconfig.json`（strict / NodeNext / declaration），`npm run typecheck` / `npm run build` 入门禁；
  - `package.json` 产品化字段：`engines.node`（>=20.19）、`publishConfig.access: public`、`types` 入口、peerDependencies 校准（补 `dsh-agent` / `dsh-llm` rc.6 类型线）；
- 集成测试（`tests/integration/host.test.js`，15 例）：以最小假 ctx 驱动真实插件，覆盖装配、上下文注入求值、HA 事件流（直通/隔离/切换/预算耗尽/停止兜底）、orchestrate 三种模式 execute、配置持久化与重启恢复、agentsGenerate、语言跟随、haReset、模型列表；
- CI 门禁升级：`npm ci` → typecheck → build → check → test → verify（Linux + Windows）；`prepublishOnly` 同款全链路。

### Fixed
- `lib/` 由构建产物与手写 `client.js` 并存，`src/` 不再包含 `.js`（verify 有产物完整性检查）。

## [0.2.2] - 2026-08-15

### Fixed
- Default config no longer hard-codes a non-existent provider/model as the HA backup or default reviewer. Backups now default to empty and the built-in reviewer inherits the DSH default model.
- Language packs are now strict JSON (`.language/*.json`) parsed with `JSON.parse`; removed the `new Function`-based `.ts` evaluator to avoid arbitrary code execution from tampered language files.
- Persisted config (including custom subagents) is no longer silently lost after plugin update/HMR: startup now retries loading when `fs`/`agents`/sandbox services are not ready yet, and reads prefer the last successfully used storage directory.

## [0.2.1] - 2026-08-15

### Fixed
- Context injection now places the auto-orchestration hint at a prominent position (`order 40` instead of `order 500`), so the model actually sees it in standard sessions.
- Injected text now includes a visible `【ha-orchestrator 插件上下文】` marker, making it verifiable in trajectories.
- Context injection registration is no longer silent: it logs to the console and retries if `systemPrompt` is not ready.
- The settings page now shows live injection status (registered / last evaluated content).

### Changed
- Strengthened both the system-prompt hint and the `orchestrate` tool description:
  - “Read / understand a large project or codebase” is now an explicit auto-orchestration trigger.
  - The model is told to call `orchestrate` in the first turn instead of browsing sequentially with `read`/`glob`.
  - The model may roughly split tasks by module/directory/doc/code area even before knowing the project.
  - `orchestrate` is described as the unified orchestration entry point, preferred over one-by-one `subagent`/`subagent_fork` dispatch.
- README examples now include large-project reading.

## [0.2.0] - 2026-08-15

### Changed
- Static plugin rewrite: loads automatically with DSH at startup; no per-session redeploy needed.
- Tools (`orchestrate`, `list-subagents`) are registered globally.
- Added bilingual language packs and settings UI.

## [0.1.0] - 2026-08-14

### Added
- Initial dynamic plugin preview: model failover and subagent orchestration.
