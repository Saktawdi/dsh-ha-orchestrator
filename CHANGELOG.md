# Changelog

All notable changes to this project are documented in this file.

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
