![HA Orchestrator settings page](docs/settings.png)

# HA Orchestrator

[![Version](https://img.shields.io/badge/version-v0.2.0-4d6bfe?style=flat-square)](https://github.com/Saktawdi/ha-orchestrator/releases/tag/v0.2.0)
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

You can also turn off the auto-triggering: in Settings → "HA 与编排" → System card, turn off **context injection**. The model then only orchestrates when you ask for it, for example "use the ha-orchestrator plugin".

### Custom subagents

Define reusable subagents in the settings page: name, provider/model, description, and system prompt. Tasks pick them by name, and the model can look up the list at any time. The "AI Generate" button takes a one-sentence requirement and has the current model fill in the full definition.

### Languages

The settings UI and all prompt copy come in Chinese and English. The plugin follows your DSH language selection and falls back to Chinese if a language pack fails to load. You can also pin a language in the "System" card.

## Installation

Requirements: [DeepSeek Harness](https://github.com/deepseek-ai/dsh) with the web profile. No build step, no runtime dependencies.

### Method 1: manual install

1. Clone this repo into your DSH profile: `~/.dsh/profiles/web/node_modules/ha-orchestrator`
2. Add it to the composition file `~/.dsh/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: ha-orchestrator
         name: ha-orchestrator
   ```

3. Restart the DSH web process. The plugin loads at startup and survives restarts.

### Method 2: let your AI install it

1. In DSH, switch to **Creator Mode**.
2. Send the repo link to your agent: `https://github.com/Saktawdi/ha-orchestrator`
3. Ask it to install the plugin. Restart the DSH web process afterwards.

> **Version note:** [v0.1.0](https://github.com/Saktawdi/ha-orchestrator/releases/tag/v0.1.0) was the previous dynamic build, deployed per session via `cordis_define` and released only for feature preview. Starting with v0.2.0 the plugin is static and loads with DSH at startup.

## Usage

No special commands. The model decides when to orchestrate:

```
You:    Research these three open-source projects, compare licenses and community activity, and recommend one.
Model:  sees 3 independent subtasks → calls orchestrate (fanout) → parallel research → comparison → recommendation

You:    Do requirements analysis first, then a design doc, then an implementation plan.
Model:  calls orchestrate (pipeline) → each stage's output feeds the next

You:    Write a competitive analysis report and have a senior reviewer vet it.
Model:  calls orchestrate (supervisor) → parallel analysis → review and merge → report
```

### Settings

Settings → "HA 与编排":

| Card | What you can do |
| :-- | :-- |
| Model High Availability | On/off, backup list, cooldown, failure threshold, error-code filter, quarantined models and failover history |
| Subagent Orchestration | On/off, subagent provider, default concurrency, max subagents per run |
| Custom Subagents | Add, edit, reorder, delete; "AI Generate" creates one from a description |
| System | Plugin language (follow system / Chinese / English), the orchestration hint toggle, and the debug card toggle |

## Notes

- Config is saved to `ha-orchestrator.config.json` in the plugin directory (with a backup copy), restored on startup, and rewritten on every change.
- Quarantined models, counters, and failover history live in memory and reset on plugin update or process restart.

## License

MIT © [Saktawdi](https://github.com/Saktawdi)
