# Changelog

All notable changes to this project are documented in this file.

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
