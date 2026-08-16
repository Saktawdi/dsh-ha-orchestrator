![HA Orchestrator settings page](docs/settings.png)

# HA Orchestrator

[![Version](https://img.shields.io/badge/version-v0.2.1-4d6bfe?style=flat-square)](https://github.com/Saktawdi/dsh-ha-orchestrator/releases/tag/v0.2.1)
[![Platform](https://img.shields.io/badge/platform-DeepSeek%20Harness-4d6bfe?style=flat-square)](https://github.com/deepseek-ai/dsh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

HA Orchestrator is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (dsh):

- When a model call fails mid-run, it retries on a backup model and the run continues.
- It adds an `orchestrate` tool that the model calls on its own when a task suits it, splitting work across subagents in parallel (`fanout`), in stages (`pipeline`), or with a review pass (`supervisor`).

The settings page also lets you define custom subagents (or generate one with AI), and the UI and prompt copy are available in Chinese and English, following your DSH language.

[简体中文](README.zh-CN.md)

## What it does

### Failover when a model fails

- When a model request errors, it is retried on the next backup model. Backups are tried in order.
- The failed model is temporarily skipped and cools down; it comes back on its own when the cooldown expires.
- Each failure episode has a retry budget. Once it is spent, the plugin stops retrying instead of looping forever.
- If a model error interrupts the run, the plugin restarts the task once so the work is not lost.

Backup models, cooldown, failure threshold, and error-code filter are configurable in Settings → "HA 与编排".

### Orchestration, triggered automatically

The `orchestrate` tool is available in every session. Its description and a hint in the system prompt tell the model to call it on its own when a task has parallel parts, runs in stages, or needs a review pass:

- `fanout` — split the task, run subtasks in parallel, merge the results.
- `pipeline` — run stages one after another; each stage's output feeds the next.
- `supervisor` — run subtasks in parallel, then let a supervising subagent review and merge them.

If a particular run does not orchestrate on its own, just say "use orchestration".

> Note: if the current session uses a `complete: true` persona preset such as `minimal` / `minimal-v3`, the platform intentionally drops plugin system-prompt sections; auto-triggering then relies on the `orchestrate` tool description alone. The plugin now includes "read a large project" in that description, but if it still does not trigger, just say "use orchestration".

You can also turn off the auto-triggering: in Settings → "HA 与编排" → System card, turn off **context injection**. The model then only orchestrates when you ask for it, for example "use the dsh-ha-orchestrator plugin".

### Custom subagents

Define reusable subagents in the settings page: name, provider/model, description, and system prompt. Tasks pick them by name, and the model can look up the list at any time. The "AI Generate" button takes a one-sentence requirement and has the current model fill in the full definition.

### Languages

The settings UI and all prompt copy come in Chinese and English. The plugin follows your DSH language selection and falls back to Chinese if a language pack fails to load. You can also pin a language in the "System" card.

## Installation

Requirements: [DeepSeek Harness](https://github.com/deepseek-ai/dsh) with the web profile. No build step, no runtime dependencies.

### Method 1: install from npm (recommended)

The package is published on npm as `dsh-ha-orchestrator`:

1. Run the one-command install:

   ```sh
   dsh plugin --profile web add dsh-ha-orchestrator
   ```

2. Because this package declares `dsh.bundle.patch`, `dsh plugin add` automatically adds **dsh-ha-orchestrator** to `dsh.profile.bundles` and applies `cordis.patch.yml`. No manual composition line is needed.
3. No restart needed: the bundle-patch layer is hot-reloaded (Cordis HMR), so the plugin activates in the running process. Refresh the browser page to load the settings UI. The plugin also loads at startup and survives restarts.

### Method 2: install from a local checkout (development)

For development or testing an unreleased version. Requires `pnpm` on PATH:

1. Run the one-command install:

   ```sh
   dsh plugin --profile web add "file:<absolute-path-to-this-repo>"
   ```

2. Because this package declares `dsh.bundle.patch`, `dsh plugin add` automatically adds **dsh-ha-orchestrator** to `dsh.profile.bundles` and applies `cordis.patch.yml`. No manual composition line is needed.
3. No restart needed: the bundle-patch layer is hot-reloaded (Cordis HMR), so the plugin activates in the running process. Refresh the browser page to load the settings UI. The plugin also loads at startup and survives restarts.

### Method 3: manual install (no pnpm)

1. Clone/copy this repo into your DSH profile: `~/.dsh/profiles/web/node_modules/dsh-ha-orchestrator`
2. Add it to the composition file `~/.dsh/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: dsh-ha-orchestrator
         name: dsh-ha-orchestrator
   ```

3. No restart needed: the profile patch layer is hot-reloaded (Cordis HMR), so the plugin activates in the running process. Refresh the browser page to load the settings UI. The plugin also loads at startup and survives restarts.

> **Version note:** [v0.1.0](https://github.com/Saktawdi/dsh-ha-orchestrator/releases/tag/v0.1.0) was the previous dynamic build, deployed per session via `cordis_define` and released only for feature preview. Starting with v0.2.0 the plugin is static and loads with DSH at startup. From the version that introduces the bundle patch, Method 1 (one-command install) is recommended.

## Usage

No special instructions are required for normal use — the model decides when to orchestrate:

```
You:    Research these three open-source projects, compare licenses and community activity, and recommend one.
Model:  sees 3 independent subtasks → calls orchestrate (fanout) → parallel research → comparison → recommendation

You:    Read this large project and summarize its architecture and current progress.
Model:  splits it into independent per-module/doc/code reading tasks → calls orchestrate (fanout) → parallel reads → consolidated architecture and progress

You:    Do requirements analysis first, then a design doc, then an implementation plan.
Model:  calls orchestrate (pipeline) → each stage's output feeds the next

You:    Write a competitive analysis report and have a senior reviewer vet it.
Model:  calls orchestrate (supervisor) → parallel analysis → review and merge → report
```

### Commands

The plugin also registers two optional slash commands for inspecting and managing runtime state:

| Command | Description |
| :-- | :-- |
| `/ha` | Show the current HA status (same as `/ha status`). |
| `/ha status` | Show quarantine, failure counts, rotation cursors, switch history, and probe log. |
| `/ha diag` | Show plugin diagnostics: service availability, persistence, language, and injection status. |
| `/ha reset` | Clear quarantine, failure counts, cursors, and history. |
| `/ha probe <provider> <model>` | Manually probe a model to verify recovery. |
| `/orchestrate` | List recent orchestrate runs (same as `/orchestrate runs`). |
| `/orchestrate runs` | List the 10 most recent orchestrate runs. |
| `/orchestrate show <runId>` | Show details of a specific orchestrate run. |
| `/orchestrate presets` | List configured orchestration presets. |

> These commands are registered through the DSH `commands` service. If a deployment does not provide that service, the plugin still works normally; only these slash commands are unavailable.

### Settings

Settings → "HA 与编排":

| Card | What you can do |
| :-- | :-- |
| Model High Availability | On/off, backup list (+ "Recommended backups"), and an "Advanced" section for cooldown, failure threshold, burst window, provider circuit threshold, probe recovery, context-overflow degrade, error-code filter, persist selection, and stop steering |
| Subagent Orchestration | On/off, subagent provider, default concurrency, max subagents per run, global concurrency cap, pipeline stage retry |
| Custom Subagents | Add, edit, reorder, delete; "AI Generate" creates one from a description |
| Diagnostics | HA runtime (current default, quarantine with level, failure counts, cursors, probes, failover history, reset) and recent orchestrate runs |
| System | Plugin language (follow system / Chinese / English), the orchestration hint toggle, the live injection status, one-click config export/import, and the debug card toggle |

## Documentation

- [Architecture](docs/architecture.md) — modules, data flows, service contract
- [Configuration](docs/configuration.md) — every config key with defaults and clamping rules
- [Security](docs/security.md) — trust boundary and applied hardening
- [Verification & release](docs/verification.md) — test matrix, gates, release steps
- [Compatibility](docs/compatibility.md) — verified DSH snapshots and peer strategy

## Notes

- Config is written to the first writable location among the current session workspace / `DSH_HOME`, the sandbox `workspace-write` writable root, and the fs default cwd (file `dsh-ha-orchestrator.config.json`, backup `dsh-ha-orchestrator.config.backup.json`), and looked up in the same order and restored on startup.
- HA runtime state (quarantine, failure counters, rotation cursors, switch history) is persisted to `dsh-ha-orchestrator.ha.json` (debounced) and restored on startup; orchestrate runs are recorded to `dsh-ha-orchestrator.runs.jsonl`.
- All `/ha` and `/orchestrate` slash commands are listed in the [Commands](#commands) section above.

## License

MIT © [Saktawdi](https://github.com/Saktawdi)
