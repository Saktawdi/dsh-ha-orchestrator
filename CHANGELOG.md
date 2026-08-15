# Changelog

All notable changes to this project are documented in this file.

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
