# dsh-ha-orchestrator 配置参考

本文档完全依据代码事实编写。默认值与钳制（sanitize/clamp）规则的**唯一事实来源**是
`src/config.ts`（`defaultConfig` 与 `sanitizeConfig`）；字段的作用说明参照
`src/index.ts` 中的配置消费点（HA 事件处理器 / orchestrate 执行 / 上下文注入 / RPC）。
配置项文案键来源：`.language/zh.json`。设置页布局来源：`lib/client.js`。

> 文中所有「默认值」来自 `defaultConfig`；所有「钳制规则」来自 `sanitizeConfig` 对
> 传入 patch 的规整逻辑。实际运行中，配置经 `stateSet`（增量合并，以当前运行态为基）
> 或 `stateImport`（整体替换，以默认配置为基）写入。

---

## 1. 配置存储

### 1.1 配置文件

| 文件 | 说明 |
| --- | --- |
| `dsh-ha-orchestrator.config.json` | 主配置持久化文件。`stateSet` / `stateImport` / 配方保存都会尝试整体写盘（`JSON.stringify(state.config, null, 2)`）；结果中的 `persist` 字段反映最近一次配置写入状态。 |
| `dsh-ha-orchestrator.config.backup.json` | 备份文件。写主文件前，若存在旧配置则先把旧内容备份到该文件；备份失败不影响主写。 |
| `dsh-ha-orchestrator.ha.json` | HA 运行态（隔离 / 失败计数 / 游标 / 历史）。防抖 500ms 写盘；重启后自动恢复。清空状态后也可能保留一个空状态文件。 |
| `dsh-ha-orchestrator.runs.jsonl` | 每次 orchestrate run 的记录，JSONL 追加写；磁盘保留最近 200 条、内存保留最近 50 条。 |
| `dsh-ha-orchestrator.run-<runId>.md` | 每次 run 的 Markdown 工件，包含完整子任务输出、实际模型 `lastKey` 和 summary；当前不自动修剪。 |

### 1.2 多目录降级

配置、HA 状态和 run 工件的目录查找顺序（读取与写入尽量使用同一顺序）：

1. **会话 workspace**：优先取当前 agent 会话的 `header.cwd`；拿不到则回退 `DSH_HOME` 环境变量值。
2. **沙箱 workspace-write 可写根**：取 `sandboxPolicy` 服务的 `workspaceRoot`（默认即 DSH web 进程 cwd，workspace-write 模式下必可写）。
写入时遍历前两个目录，**第一个解析并写入成功的目录即成为 `activeStorageDir`**；读取时优先从最近一次成功写入的目录读，避免目录顺序变化导致读到旧的默认配置。
如果前两个目录都不存在，配置和 HA 状态写入会失败并在诊断中显示原因；run JSONL 与 Markdown 工件还会尝试使用 fs 服务默认 cwd。

### 1.3 启动加载与重试

- 启动时先尝试 `loadPersistedConfig()`（优先读主文件，主文件缺失则读备份文件），随后 `deep-copy(defaultConfig)` 作为基。
- 若首次加载失败，进入**定时重试**：最多 30 次、每 2s 一次（`CONFIG_LOAD_MAX_RETRIES = 30`，`CONFIG_LOAD_RETRY_MS = 2000`）。
- **stateGet 懒加载兜底**：即使定时重试也未成功，设置页每次拉状态（`stateGet`）时会再补一次加载；
  加载成功后重建工具（orchestrate / list-subagents）并重新跟随语言。
- HA 运行态与配置在启动阶段按相同目录顺序尝试恢复；若宿主服务在插件启动后才出现，建议通过诊断确认
  `haStateLoaded` 与持久化状态，必要时重启插件/宿主后再验证旧隔离是否恢复。

### 1.4 设置页「系统」卡片一键导出 / 导入

- **导出（`stateExport`）**：返回完整配置的 JSON 文本（当前运行态 `state.config`）。
- **导入（`stateImport`）**：粘贴完整配置 JSON，**整体替换**——`sanitizeConfig(parsed, defaultConfig)`
  以默认配置为基，仅保留导入 JSON 中出现的节，**缺失节回退默认值**。校验失败
  （JSON 无任何有效配置节）会报错 `sys.importInvalid`。导入成功后再落盘，并在客户端触发整页刷新
  （`window.location.reload()`）。与 `stateSet` 相同的落盘 / 工具重建 / 语言跟随语义。
- 导出 / 导入均位于「系统」卡片内（见下方配置参考表的 `lang`、`ctx`、`debug.showCard`）。

---

## 2. 完整配置参考表

配置文件结构是这样一个顶层对象：

```json
{ "ha": {…}, "orch": {…}, "debug": {…}, "lang": {…}, "ctx": {…} }
```

### 2.1 `ha` — 模型高可用（HA）

设置页「模型高可用」卡片对应本节。消费点：主智能体的 `agent/request`、`agent/request-error`、`agent/error`
三个事件处理器（`src/index.ts`）；编排子智能体由 `AgentEntry.fallbacks` 独立处理。

| 字段 | 类型 | 默认值 | 钳制规则 | 作用 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | `!!value` | HA 总开关。关闭后所有事件处理器直接放行，不做回退；同时探测（`runProbe`）也会因 `!cfg.enabled` 而被禁止。 |
| `backups` | array | `[]` | 保留每项 `{label, provider, model, reasoningEffort}`；仅保留 `provider && model` 均非空的项 | 备用模型列表（按序轮换）。`agent/request` 处理器的前置条件是 `backups.length > 0`；故障后按序挑选备用模型。默认不预置任何备用模型（保持中立，由用户按环境配置）。 |
| `cooldownMs` | number | `300000` | `Math.max(1000, …)`（不低于 `MIN_COOLDOWN_MS`） | 隔离冷却时长（毫秒）。模型被隔离后，冷却到期才允许恢复（配合探测）。探测失败后的再探测间隔也不短于该值（封顶 5 分钟）。 |
| `threshold` | number | `1` | `Math.max(1, …)` | 失败阈值。`burstWindowMs` 窗口内失败计数达到该值才触发隔离并切备用；未达标则带退避重试原模型。 |
| `codes` | array\<string> | `[]` | 非空字符串数组（`String` 化并过滤空串） | 回退错误码白名单。`agent/request-error` 中，仅当失败 `code` 命中 `codes` 才会进入 HA 处理；留空 = 所有错误码都触发回退。 |
| `persistSelection` | boolean | `false` | `!!value` | 切换后是否把选中模型持久化为 DSH 默认模型（`agentDefaultModel.saveSelection`）。 |
| `steerOnStop` | boolean | `true` | `!!value` | 模型错误中断（`agent/error`）后是否延迟到 driver idle 再 `steer` 用文案引导继续任务（`ha.steerText`）。仅对 `MODEL_CODES` 内的错误生效。 |
| `burstWindowMs` | number | `60000` | `Math.max(0, …)` | 失败计数滑动窗口（毫秒）。窗口内多次失败才计入阈值，超出窗口计数重置；0 = 关闭（计数到冷却到期才过期）。 |
| `providerThreshold` | number | `2` | `Math.max(0, …)` | Provider 级熔断阈值。同一 provider 隔离的模型数达到该值后熔断整个 provider（`PROVIDER_CIRCUIT`）；0 = 关闭。 |
| `probeEnabled` | boolean | `true` | `!!value` | 冷却到期后是否用最小成本调用（`maxTokens=1`）真实探测模型恢复；成功解除隔离（circuit-closed），失败延长冷却并再次探测（间隔 `[60s, 5min]`）。 |
| `degradeContextWindow` | boolean | `false` | `!!value` | `CONTEXT_WINDOW_EXCEEDED` 时去掉 `reasoningEffort` 重试原模型（上下文超长降级）；关闭时 HA 不接管该错误，直接放行给平台压缩/重试，**不会切备用**。 |

### 2.2 `orch` — 子智能体编排

设置页「子智能体编排」卡片与「自定义子智能体」卡片对应本节。消费点：`orchestrate` / `list-subagents`
工具执行与上下文注入兜底文案（`src/index.ts`）。

| 字段 | 类型 | 默认值 | 钳制规则 | 作用 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | `!!value` | orchestrate 工具总开关。关闭后调用即抛错（`orch.errDisabled`）。同时关闭会影响上下文注入的兜底自动编排引导（见 `ctx`）。 |
| `provider` | string | `''` | `String` | 子智能体提供方。留空 = 自动取第一个可用提供方；设置后若已注册提供方列表中存在则用，否则回退第一个。 |
| `concurrency` | number | `6` | `Math.max(1, Math.min(32, …))` | 默认并发数（fanout / supervisor / map-reduce 并行池上限）。调用侧 `concurrency` 参数可覆盖；实际并发还受 `maxAgents` 封顶。 |
| `maxAgents` | number | `16` | `Math.max(1, Math.min(64, …))` | 最大子智能体数：tasks 超过该值会被截断（`truncateTasks`），也是并发上限的封顶值。 |
| `stageRetry` | number | `0` | `Math.max(0, Math.min(5, …))` | pipeline 单阶段失败重试次数。0 = 不重试，失败即标记该阶段 `error` 并中止后续阶段（阶段隔离）。 |
| `globalConcurrency` | number | `0` | `Math.max(0, Math.min(64, …))` | 全局并发上限（跨所有 orchestrate run 共享信号量）。0 = 不限，单 run 并发由 `concurrency`/`maxAgents` 控制；>0 时并发满则排队等待配额。 |
| `presets` | array\<[OrchPreset](#orchpreset-配方)> | `[]` | 按结构清洗：每项需 `name` 非空，`tasks` 每项需 `prompt` 非空 | 已保存的编排配方（一次成功 orchestrate 调用参数的可复用快照）。调用侧 `preset` 参数按 `name` 命中加载。 |
| `mergeBodyLimit` | number | `8000` | `0..100000` | merge/supervisor/reduce 汇总输入中，每个子任务正文的字符上限；0 使用代码默认值。 |
| `mergeTotalLimit` | number | `48000` | `0..400000` | merge/supervisor/reduce 汇总输入的总字符上限；0 使用代码默认值。 |
| `renderRunLimit` | number | `8000` | `0..100000` | 工具结果中每个子任务输出的渲染字符上限；0 使用代码默认值。 |
| `renderTotalLimit` | number | `60000` | `0..400000` | 工具结果整体渲染字符上限；0 使用代码默认值。 |
| `maxDepth` | number | `0` | `0..8` | 下发给支持该能力的 provider 的委托深度硬上限；0 关闭。插件仍会独立拒绝子智能体再次调用 `orchestrate`。 |
| `autoResume` | boolean | `true` | `!!value` | 自动续跑。未显式传 `resume` 时，自动查找同一会话最近 30 分钟内、同模式、同任务且部分完成的 run；命中则复用已完成子任务，只跑剩余部分。 | 
| `agents` | array\<[AgentEntry](#agententry-自定义子智能体)> | 内置 `reviewer`、`researcher`、`research-merger` | 需 `name` 非空；`String` 化各字段 | 自定义子智能体清单。`list-subagents` 返回其 name/provider/model/description；`orchestrate` 中 `task.agent` / 顶层 `agent` / `supervisorAgent` / `reviewers` 按 name 解析。 |

#### `OrchPreset`（配方）字段

| 字段 | 作用 |
| --- | --- |
| `name` | 配方唯一名称（`orchSavePreset` 时按 name 去重覆盖）。 |
| `mode` | 保存时的编排模式，默认 `fanout`。 |
| `agent` | 默认子智能体名称。 |
| `supervisorAgent` | 监督子智能体名称。 |
| `mergeInstructions` | 合并指令文案。 |
| `tasks` | `[{ id?, label?, agent?, prompt }]`，每项 `prompt` 必填。 |

> 配方持久化当前只保留任务的 `id`、`label`、`agent`、`prompt`；调用侧的 `outputHint` 与
> `outputSchema` 不会随 `orchSavePreset` / `sanitizeConfig` 写入配方。

#### `AgentEntry`（自定义子智能体）字段

| 字段 | 作用 |
| --- | --- |
| `name` | 唯一英文标识（`list-subagents` / `orchestrate` 中按名称指定）。 |
| `provider` | provider；留空 = 继承 DSH 默认模型。 |
| `model` | model；留空 = 继承 DSH 默认模型。 |
| `reasoningEffort` | 可选的模型推理强度（provider 定义的不透明字符串，如 `low` / `medium` / `high`）；留空 = 使用 provider/model 默认值。即使 provider/model 留空，也可以单独覆盖默认模型的 effort。 |
| `description` | 展示给模型的用途说明。 |
| `systemPrompt` | 子智能体的系统提示词（persona）。 |
| `tools.allow` | 可选工具白名单；非空时只允许这些宿主工具。provider 不支持工具裁剪时会在启动前剥离。 |
| `tools.deny` | 可选工具黑名单；provider 不支持工具裁剪时会在启动前剥离。 |
| `fallbacks` | 可选的独立模型回退链，按顺序保留 `{label, provider, model, reasoningEffort}`；每个回退项的 effort 独立于主模型。子智能体启动失败或返回 `stopReason=error` 时依次重启该角色。留空/省略表示不启用角色级回退，不读取全局 `ha.backups`。设置页文本格式为 `provider/model@effort`，省略 `@effort` 表示该回退模型使用默认 effort。 |

### 2.3 `debug` — 开发调试

设置页「开发调试」卡片对应本节（默认隐藏，见 `debug.showCard`）。

| 字段 | 类型 | 默认值 | 钳制规则 | 作用 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `false` | `!!value` | 调试模式。开启后把内部事件（`debugLog`）记录到内存环形缓冲（上限 500 条），并镜像到进程 console。 |
| `showCard` | boolean | `false` | `!!value` | 是否在设置页显示「开发调试」卡片（在系统卡片内开关打开）。默认隐藏。 |

### 2.4 `lang` — 插件语言

设置页「系统」卡片内的语言下拉对应本节。

| 字段 | 类型 | 默认值 | 钳制规则 | 作用 |
| --- | --- | --- | --- | --- |
| `mode` | `'auto' \| 'zh' \| 'en'` | `'auto'` | 仅 `zh` / `en` 合法，其余一律 `'auto'` | `auto` 跟随 DSH 当前语言（settings `locale` preference）自动切换；`zh` / `en` 手动固定。目标语言包缺失或解析失败自动回滚中文（zh）。 |

### 2.5 `ctx` — 上下文注入

设置页「系统」卡片内的上下文注入区对应本节。消费点：`systemPrompt` 服务注入段
`dsh-ha-orchestrator:context`（order 40）。

| 字段 | 类型 | 默认值 | 钳制规则 | 作用 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | `!!value` | 总开关。关闭后整段为空（组装器丢弃），模型不获得任何插件上下文。 |
| `text` | string | `''` | `String` | 自定义注入内容，**原文保留不翻译**。留空时若编排启用则回退注入默认自动编排引导（`orch.hintSection`），否则注入为空。 |
| `injectSubagents` | boolean | `false` | `!!value` | 是否也向子智能体注入同一段上下文。默认 `false`：子智能体不获得插件上下文，避免子代理被引导再次发起编排（层层外包）；开启后与主智能体行为一致。 |

---

## 3. orchestrate 工具参数参考

`orchestrate` 工具由插件注册（全局可见），参数 schema 见 `buildOrchestrateTool()`。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | string | 编排模式，枚举：`fanout`（并行分发并汇总）/ `pipeline`（顺序执行，前段输出作下段上下文）/ `supervisor`（并行执行后启动监督子智能体按 `mergeInstructions` 审查合成）/ `map-reduce`（并行拆分执行后统一归约）/ `router`（从候选任务路由选择一项执行）。未知值恒归一为 `fanout`。 |
| `tasks` | array | 任务列表，每项 `{ id?, label?, agent?, prompt, outputHint?, outputSchema? }`，`prompt` 必填。数量超过 `maxAgents` 时截断；`outputSchema` 仅接受 object 根 Schema。 |
| `agent` | string | 默认自定义子智能体名称（顶层默认，可用 `list-subagents` 查询）。 |
| `supervisorAgent` | string | supervisor 模式使用的监督子智能体名称。不为指定的 mode 指定时用 `defaultDef`。 |
| `mergeInstructions` | string | 合并/监督合成的指令文案。fanout / supervisor / map-reduce 使用；缺省回退 `orch.mergeDefault`（或预置值）。 |
| `concurrency` | number | 本次 run 并发覆盖；下限 1、上限 `maxAgents`，缺省取 `orch.concurrency`。 |
| `preset` | string | 已保存配方名；命中后从配方加载 mode/tasks/agent，调用参数可覆盖。找不到抛错。 |
| `resume` | string | 上次中断的 runId；恢复未完成子任务，已完成任务复用其结果（pipeline 从首个未完成阶段续跑）。run 已完成或旧记录缺数据时报错。 |
| `reviewRounds` | number | supervisor 模式评审轮次：**`Math.max(1, Math.min(3, Number()\|\|1))`，即 1..3**，默认 1。每轮以上一轮输出为上下文重新评审。 |
| `reviewers` | string[] | supervisor 模式并行评审的自定义子智能体名称数组；每个评审者独立 run，输出并入综合上下文后由 supervisor 合成。名称同样走未知名校验。 |
| `budgetAgents` | number | 本次编排的子智能体调用预算（含重试/评审/合成）：**`Math.max(0, Math.min(128, Number()\|\|0))`，0 = 不限**。超限抛 `orch.errBudget` 并中止（预算错误经 `isolate=false` 穿透任务级隔离）。 |

> `reviewRounds` 与 `budgetAgents` 的钳制是执行期的局部钳制（非配置项）：前者为 **1..3**
>（默认 1），后者为 **0..128**（默认 0 = 不限）；`concurrency` 则按 `1..maxAgents` 解析。

其他注意点（来自 `execute`）：

- `tasks` / `agent` / `supervisorAgent` / `reviewers` 引用了未在 `orch.agents` 中定义的名称会抛
  `orch.errUnknownAgent`（附带可用清单）。
- `outputHint` 会追加到对应子任务 prompt 末尾；`outputSchema` 在 provider 支持时透传为结构化输出，
  结果会以 `[structured] {json}` 行嵌入该 run 的 `output`。
- 每次调用生成 `runId`（结果值含 `runId`），结束（含中止/异常）后落盘一条 `RunRecord`；设置页「诊断」卡片与
  `/orchestrate runs|show <runId>|presets`、`/ha` 命令可观测。
- `globalConcurrency > 0` 时执行前要先获取共享并发配额。

---

## 4. 常用配置示例（JSON）

### 4.1 含 backups 的 HA 配置

启用 HA，配两个备用模型（不同 provider）、合理冷却与两层熔断阈值：

```json
{
  "ha": {
    "enabled": true,
    "backups": [
      { "label": "备用 GPT", "provider": "openai", "model": "gpt-4o", "reasoningEffort": "" },
      { "label": "本地", "provider": "ollama", "model": "qwen2.5:14b" }
    ],
    "cooldownMs": 300000,
    "threshold": 2,
    "burstWindowMs": 60000,
    "providerThreshold": 2,
    "probeEnabled": true,
    "degradeContextWindow": false,
    "persistSelection": false,
    "steerOnStop": true,
    "codes": []
  }
}
```

说明：`codes` 留空即对全部错误码回退；`cooldownMs = 300000`（≥1000 强制）；
`threshold ≥ 1`；`providerThreshold = 2` 表示同一 provider 隔离满 2 个模型即熔断整个 provider。

### 4.2 含自定义子智能体的 orch 配置

```json
{
  "orch": {
    "enabled": true,
    "provider": "",
    "concurrency": 4,
    "maxAgents": 12,
    "stageRetry": 1,
    "globalConcurrency": 0,
    "mergeBodyLimit": 8000,
    "mergeTotalLimit": 48000,
    "renderRunLimit": 8000,
    "renderTotalLimit": 60000,
    "maxDepth": 0,
    "autoResume": true,
    "presets": [
      {
        "name": "code-review",
        "mode": "supervisor",
        "agent": "reviewer",
        "supervisorAgent": "reviewer",
        "mergeInstructions": "审查所有子任务输出，合并为一份准确、完整、去重的最终结论；标注仍然缺失或不确定的部分。",
        "tasks": [
          { "id": "t1", "label": "审代码质量", "prompt": "检查 D:\\. 的代码质量与安全，输出结构化意见。" },
          { "id": "t2", "label": "审性能", "prompt": "评估该模块性能瓶颈与优化点。" }
        ]
      }
    ],
    "agents": [
      {
        "name": "reviewer",
        "provider": "",
        "model": "",
        "description": "代码审查专家：检查代码质量、发现 bug 与安全隐患，输出结构化审查意见。",
        "systemPrompt": "你是一名资深代码审查员。审查时给出：1) 问题清单（严重程度+位置+原因）2) 修复建议 3) 总体评价。"
      },
      {
        "name": "planner",
        "provider": "openai",
        "model": "gpt-4o",
        "reasoningEffort": "high",
        "description": "需求拆解与实现计划专家。",
        "systemPrompt": "你是资深技术主管：把目标拆解为可执行阶段，给出实现顺序与验收标准。",
        "fallbacks": [
          { "label": "本地备用", "provider": "ollama", "model": "qwen2.5:14b", "reasoningEffort": "low" }
        ]
      }
    ]
  }
}
```

说明：`concurrency`（1..32）、`maxAgents`（1..64）、`stageRetry`（0..5）、
`globalConcurrency`（0..64）、`maxDepth`（0..8）均在钳制范围内；`provider: ""` 表示自动选第一个可用提供方；
子智能体 `provider`/`model` 留空即继承 DSH 默认模型。
`reasoningEffort` 同样可以独立配置；设置页提供 `low` / `medium` / `high` 常用选项，也允许填写 provider-specific 值。

---

## 5. 快速核对表（默认值 + 钳制）

| 配置节 · 字段 | 默认值 | 钳制下限 | 钳制上限 |
| --- | --- | --- | --- |
| ha.enabled | true | — | — |
| ha.backups | [] | — | — |
| ha.cooldownMs | 300000 | 1000 | — |
| ha.threshold | 1 | 1 | — |
| ha.codes | [] | — | — |
| ha.persistSelection | false | — | — |
| ha.steerOnStop | true | — | — |
| ha.burstWindowMs | 60000 | 0 | — |
| ha.providerThreshold | 2 | 0 | — |
| ha.probeEnabled | true | — | — |
| ha.degradeContextWindow | false | — | — |
| orch.enabled | true | — | — |
| orch.provider | '' | — | — |
| orch.concurrency | 6 | 1 | 32 |
| orch.maxAgents | 16 | 1 | 64 |
| orch.stageRetry | 0 | 0 | 5 |
| orch.globalConcurrency | 0 | 0 | 64 |
| orch.mergeBodyLimit | 8000 | 0 | 100000 |
| orch.mergeTotalLimit | 48000 | 0 | 400000 |
| orch.renderRunLimit | 8000 | 0 | 100000 |
| orch.renderTotalLimit | 60000 | 0 | 400000 |
| orch.maxDepth | 0 | 0 | 8 |
| orch.autoResume | true | — | — |
| orch.presets | [] | — | — |
| orch.agents | [reviewer, researcher, research-merger] | 每项 name 必填 | — |
| debug.enabled | false | — | — |
| debug.showCard | false | — | — |
| lang.mode | 'auto' | 仅 zh/en，其余回 auto | — |
| ctx.enabled | true | — | — |
| ctx.text | '' | — | — |
| orchestrate.reviewRounds | 1 | 1 | 3 |
