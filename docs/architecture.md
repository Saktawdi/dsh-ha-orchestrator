# dsh-ha-orchestrator 架构文档

> 版本：v0.12.2（对齐当前 `src/` 代码快照）
> 范围：基于仓库实际代码（`src/index.ts`、`src/config.ts`、`src/ha-core.ts`、`src/orch-runner.ts`、
>       `src/language.ts`、`src/remote.ts`、`src/types.ts`、`package.json`、`cordis.patch.yml`）编写，
>      说明本插件的静态 Cordis 装配方式、模块职责、三条关键数据流、服务契约与设计原则。
> 配套路线图：`docs/local/productization-roadmap.md`（本地开发文档，不进仓库/发布包）。

---

## 1. 总体架构

`dsh-ha-orchestrator` 是一个 **静态 Cordis 插件**（composition row），经 `dsh.bundle.patch`
指向的 `cordis.patch.yml` 作为 profile 层挂载，随 DSH 进程启动自动加载。它遵循 **mount-only /
bundle-only** 原则：**不 patch DSH 核心文件**，只通过公开 `ctx` 服务与稳定事件接缝接入。

```text
dsh-ha-orchestrator/
├── package.json              # 包元数据 + dsh.bundle.patch + dsh.client.inject + peerDependencies
├── cordis.patch.yml          # bundle patch：一行 insert（row id = dsh-ha-orchestrator）
├── src/                      # TypeScript 源码（strict / NodeNext / declaration）
│   ├── index.ts              # 插件入口：装配 / HA 事件 / 编排工具 / 上下文注入 / RPC 服务
│   ├── config.ts             # 配置：schema / 默认值 / sanitizeConfig（纯工具）
│   ├── ha-core.ts            # HA 状态机纯函数（无 DSH 依赖）
│   ├── orch-runner.ts        # 编排纯逻辑（并发池 / pipeline carry / supervisor prompt / 汇总渲染）
│   ├── language.ts           # 语言包：解析 / 回滚 / 插值（纯工具）
│   ├── remote.ts             # Remote decorator 官方同形装配（纯 ESM，无 DSH 依赖）
│   └── types.ts              # 服务契约（ctx 消费的 DSH 服务最小结构）+ getService
├── lib/                      # tsc 构建产物（含 .d.ts 类型声明；纯 JS 七模块同形）
│   ├── index.js              # 构建后插件入口
│   ├── client.js             # 手写 lazy-CJS bundle（概览、设置卡片、诊断与对话卡片）
│   ├── config.js
│   ├── ha-core.js
│   ├── orch-runner.js
│   ├── language.js
│   └── remote.js
├── .language/                # 语言包 zh.json / en.json（严格 JSON，键集以 zh 为基准）
├── docs/                     # 文档体系
└── scripts/verify.mjs        # 离线冒烟（发布前门禁）
```

### 1.1 生命周期与装配

- `package.json` 声明 `main: lib/index.js`、`types: lib/index.d.ts`、`exports`（含 `./client`、
  `./cordis.patch.yml`），`type: module`（ESM），`engines.node >=20.19.0`。
- `dsh.bundle.patch: ./cordis.patch.yml` 声明 bundle 补丁；`cordis.patch.yml` 内容为一行
  `insert: id=dsh-ha-orchestrator, name=dsh-ha-orchestrator`，由 `dsh plugin add` 作为 profile 层插入
  （per row id “last write wins”）。
- `src/index.ts` 默认导出 `{ apply, inject, name }`：
  - `name = 'dsh-ha-orchestrator'`；
  - `inject = ['tools', 'systemPrompt']`——`ctx.effect` 保证 apply 时这两个依赖服务必然就绪，
    消除「服务尚未就绪导致注入静默跳过」的启动竞态；
  - `apply(ctx)` 完成全部装配，并依靠 **Cordis 行生命周期**：stop/unload 时自动 dispose 事件
    监听、工具注册、systemPrompt 段落与命令，没有残留的 “zombie” 注册。
- 其余服务（`fs` / `timer` / `llm` / `subagents` / `settings` / `agents` / `agentDefaultModel` /
  `sandboxPolicy` / `launchEnvironment` / `commands` / `skills` / `typert`）**不加入 inject**，经 `getService()`
  （`types.ts`）在每次使用时惰性取用，配合定时/懒加载重试兜底各类“晚就绪”部署。

### 1.2 源码 / 构建产物分离

- `src/` 为 TypeScript strict 源码；`npm run build` 用 `tsc` 产出 `lib/`（含 `.d.ts`）。
- 除 `index.ts` 外，`config` / `ha-core` / `orch-runner` / `language` / `remote` 五个模块都是 **无 DSH
  依赖的纯模块**，可独立单测；`index.ts` 是唯一持 `ctx` 的装配层。
- `lib/client.js` 为**手写 lazy-CJS bundle**（非 tsc 产物）：概览横幅、HA/编排/子智能体/诊断/系统
  设置卡片与对话内 Run/HA 卡片，作为
  DSH 客户端插件通过 `dsh.client.inject`（`@deepseek-ai/dsh-client-runtime`、
  `@deepseek-ai/dsh-api-remotes`）加载。客户端经 `ctx.remote.haOrchestrator.<method>` 调 RPC。
- Remote 方法 marker：静态插件无法在运行时执行 `@Remote` 装饰器语法（TS 装饰器默认不在
  `lib/` 保留执行语义），因此 `remote.ts` 提供 `decorateRemoteMethod` / `runInitializers` /
  `esDecorate`，**与官方 `@deepseek-ai/dsh-goal` 编译产物同形的 `__esDecorate` 布局**，
  在 `lib/remote.js` 里以函数显式装配每个 Remote 方法。

---

## 2. 模块职责表

| 模块 | 职责 | DSH 依赖 |
| --- | --- | --- |
| `src/index.ts` | 插件装配唯一持 `ctx` 层：HA 事件流（agent/request / request-error / error）、错误分类、两层熔断、探测恢复、steer 续跑；编排工具 `orchestrate` / `list-subagents`；systemPrompt 上下文注入（order 40）；`ctx.haOrchestrator` RPC 服务（19 个方法）；`/ha` 与 `/orchestrate` 命令；语言跟随；配置/HA/run 持久化；`inject` 声明 | 全量（经 `getService`） |
| `src/config.ts` | 配置 schema（`Config` / `HaConfig` / `OrchConfig` 等）、`defaultConfig` 默认值、`sanitizeConfig(patch, base)` 校验合并（钳制数值/规整布尔/过滤结构），`MIN_COOLDOWN_MS` 常量 | 无 |
| `src/ha-core.ts` | HA 状态机纯函数：隔离/失败计数/滑动窗口/冷却/备用轮换游标/重试预算/精确与通配隔离判定/切换历史/序列化（`serializeHaState` / `deserializeHaState`）；所有时序操作接受可注入 `now` 便于测试 | 无（消费最小 `HaCfgLike`） |
| `src/orch-runner.ts` | 编排纯逻辑：`poolRun` 并发池（保序 + 单任务异常隔离）、`resolveConcurrency` / `resolveMode` / `truncateTasks`、`appendPipelineCarry`（pipeline 前段输出作下一段上下文）、`buildSupervisorPrompt`（supervisor/map-reduce/merge 合成）、`buildSubagentRequest` / `normalizeRunResult` / `normalizeFinalRuns`、`summarizeRuns` / `renderRunOutput`、`findUnknownAgents` / `resolveAgentDef` / `resolveSubagentFallbacks` | 无 |
| `src/language.ts` | 语言包：`parseDictModule`（严格 JSON 解析，失败回滚 zh）、`resolveTarget`（auto 跟随 DSH）、`pickDict`（回滚决策）、`translate`（`{name}` 占位符插值，缺失键直接返回 key）、`makeT` | 无 |
| `src/remote.ts` | Remote decorator 官方同形装配：`esDecorate` / `runInitializers` / `decorateRemoteMethod`，镜像官方编译 `__esDecorate` 形状 | 无（纯 ESM，标准库） |
| `src/types.ts` | `ctx` 上消费的 DSH 服务最小结构契约（`FsService` / `TimerService` / `LlmService` / `SubagentProvider` / `SystemPromptService` / `SettingsService` / `AgentsService` / `AgentDefaultModelService` / `SandboxPolicyService` / `LaunchEnvironmentService` / `CommandsService` / `TypertRegistryService`）+ `getService()`（`ctx.get` 的 try/catch 归一） | 仅 `@deepseek-ai/cordis` 的 `Context` type |

设计取舍（`types.ts`）：**不直接依赖 `dsh-*` 各包服务类型**（rc 阶段类型变动频繁），而是定义
最小结构接口经 `getService()` 从 `ctx` 取用；事件载荷（`agent/request` 等）与 `Agent` 类型则使用官方
`dsh-agent` 声明。

---

## 3. 关键数据流

### 3.1 HA 事件流（模型高可用）

主智能体的三个 `agent/*` 事件监听器构成 **瀑布流最终决定权**（均以 `prepend: true` 挂在最外层，即
`ctx.on(..., true)`）：

| 事件 | 触发 | 关键行为 |
| --- | --- | --- |
| `agent/request` | 主智能体每次模型调用前 | `next()` 拿真实配置 → 记录 `lastKey`、清/置 `retries`；`CONTEXT_WINDOW_EXCEEDED` 降级标记时去 `reasoningEffort` 重试；被隔离则 `pickFallback` 切换（推进游标 + 写历史 + `persistSelection` 时 `saveSelection` + `ha/failover`），无备用放行原模型 |
| `agent/request-error` | 模型请求失败 | 先判断 `signal.aborted`；`failure.code` 不匹配 `cfg.codes` 放行；随后进入错误分类策略（见下） |
| `agent/error` | 模型错误中断 | 先隔离失败模型（`lastKey`），延迟到 driver idle 后 `agent.steer()` 续跑（`agent/error` 里的延迟 steering）；`CONTEXT_WINDOW_EXCEEDED` 除外（不隔离、不 steer） |

**错误分类策略（`agent/request-error` 内）**：

1. **不可重试错误**（`NON_RETRYABLE_CODES`：`INVALID_CREDENTIAL` / `AUTH` / `UNAUTHORIZED` /
   `NO_ADAPTER`）：重试原模型无意义 → 直接隔离并切备用，**不消耗阈值计数**；
2. **`CONTEXT_WINDOW_EXCEEDED`**：属于上下文长度问题而非模型可用性问题，默认**不切备用**
   （把相同全文塞给备用模型只会再次触发压缩/超限），直接 `next()` 交给平台压缩等下游处理；
   仅当 `degradeContextWindow` 开启时标记 `degradeReasoning`，去 `reasoningEffort` 重试原模型
   （带退避），预算耗尽后同样放行；
3. **可重试错误**（不含 `CONTEXT_WINDOW_EXCEEDED`）：`bumpFailure`（按 `burstWindowMs` 滑动窗口）
   累计计数，`count < threshold` 时带退避重试原模型，不透支预算。

**两层熔断**：
- **模型级**：阈值到达 → `quarantineKey`（精确键，`level='model'`）+ `maybeOpenProviderCircuit`；
- **Provider 级**：同 provider 隔离模型数 ≥ `providerThreshold` → 熔断整个 provider
  （通配键 `provider\u0000*`，`level='provider'`），备用挑选时该 provider 下所有模型均不可用；
- 重试预算 `maxRetriesFor = max(2, threshold + backupCount)`，耗尽则 `next()` 放行给上层
  （如官方 `llm-retry`）。

**探测恢复**：冷却到期（`scheduleProbe`）后用小成本 `maxTokens=1` 调用验证隔离模型——
成功 → 解除隔离并发 `ha/circuit-closed`；失败 → 延长冷却并再次安排（间隔钳制在
`[60s, 5min]`）；provider 通配键不探测，到期即解除（`reason='expired'`）。手动探测走
`/ha probe` 或 RPC `haProbeNow`。

### 3.2 编排执行流（orchestrate 工具）

`orchestrate` 工具 `execute` 伪流程：

```text
newRunId -> acquireOrchSlot(全局并发信号量)
  -> preset 解析（args.preset 载入 mode/tasks/agent，调用参数可覆盖）
  -> truncateTasks(maxAgents) + resolveProvider + resolveMode + resolveConcurrency
  -> findUnknownAgents（引用不存在的子智能体 -> 报错）
  -> resume 恢复（可选：复用已完成 run，pipeline 从失败阶段续跑并继承 carry）
  -> 按 mode 分派：
       pipeline   : 顺序阶段 + appendPipelineCarry + stageRetry + 阶段隔离
       supervisor : poolRun 并行 -> buildSupervisorPrompt -> reviewRounds(1..3) 逐轮评审
       map-reduce : poolRun 并行 -> 归约任务（reduce）
       router     : 把候选任务列表交给一个路由子智能体选择/安排
       fanout     : poolRun 并行 (+ 可选 mergeInstructions 触发 merge 合成)
  -> normalizeFinalRuns（resume 时按原任务顺序合并）
   -> recordRun（内存 + JSONL + Markdown 工件） + emit 'orch/run-end'
  -> finally releaseOrchSlot
```

- **并发信号量**：`orch.globalConcurrency`（0 = 不限）跨 run 共享，`acquireOrchSlot` /
  `releaseOrchSlot` 配对，防止多个 agent 同时编排打爆子智能体提供方。
- **runOne**：按 `AgentEntry.fallbacks` 构造主模型 + 备用模型候选，逐个执行
  `buildSubagentRequest` → `subagents.start(provider, request)` → `run.result`
  → `normalizeRunResult`；启动拒绝、基础设施异常或 `stopReason=error` 会进入下一个角色级候选，
  所有候选共享同一个 `runOneAttempt` 生命周期实现。`fallbacks` 独立于主模型 `ha.backups`，
  因而每个自定义角色可以复用同一套候选执行机制但使用自己的回退链。主候选与每个回退候选
  通过 `agentOptions.reasoningEffort` 独立透传，未配置回退 effort 时会清除主候选的继承值。每次候选都支持
  `toolFilter`、`outputSchema`、`maxDepth` 能力门控；强制要求真实 `AbortSignal`，`run.dispose()` 在
  `finally` 回收。
- **poolRun**（`orch-runner.ts`）：以并发上限执行并保持结果顺序，单个任务异常被捕获为
  `status='error'` run，不中断其它任务。
- 每次调用（含失败/中止）都生成 `runId` 并 `recordRun`，保证失败也留痕可观测；结构化输出会以
  `[structured]` 行嵌入 run 正文，方便汇总、渲染和归档。

### 3.3 持久化

| 文件 | 内容 | 写入方式 | 容量 |
| --- | --- | --- | --- |
| `dsh-ha-orchestrator.config.json`（+ `.backup.json`） | 完整配置 | 写前把旧配置备份到 backup，再写主文件；`persistConfig` 记录 `activeStorageDir` + 诊断 | —— |
| `dsh-ha-orchestrator.ha.json` | HA 运行态：隔离/失败计数/游标/历史 | `scheduleHaPersist` 防抖 500ms；重置后也可能写入空状态 | 历史 50 条 |
| `dsh-ha-orchestrator.runs.jsonl` | 每次 orchestrate 一条 run 记录 | JSONL 读-追加-修剪-写 | 磁盘 200 条 / 完整内存热集 20 条；UI 使用无 prompt/output 的轻量历史缓存 |
| `dsh-ha-orchestrator.run-<runId>.md` | 单次 run 的完整 Markdown 工件 | 与 run 写入队列串行写入；当前不自动修剪 | 每个 run 一份 |

- **storageDirs 查找顺序**：
  1. 会话 workspace（从 `agents` 服务首个 agent 的 `session.header.cwd`）或 `launchEnvironment`
     `DSH_HOME`；
  2. 沙箱 `sandboxPolicy` 的 `workspace-write` 可写根（默认 DSH web 进程 cwd，workspace-write
     下必可写）。
  写入与读取用同一目录顺序（`readStorageText` 优先已成功写入的 `activeStorageDir`），保证重启后找到。
  配置和 HA 状态写入没有候选目录时会失败并通过诊断暴露；run JSONL/Markdown 写入还会尝试 fs 默认 cwd。
- **配置恢复**：启动时 `loadPersistedConfig`，失败走定时重试（30 次、2s）/`stateGet` 懒加载兜底
  （`ensureConfigLoaded`），成功后重装工具并跟随语言。
- **HA 状态恢复**：`loadPersistedHaState` → `deserializeHaState` → `clearExpired` → 恢复到
  内存，并 `scheduleProbesForActive` 重排到期探测。
- **run 恢复**：`/orchestrate show <runId>` 读最近记录；`resume <runId>` 从磁盘记录恢复未完成
  子任务。

---

## 4. 服务契约

### 4.1 ctx 上消费的服务（最小结构，见 `types.ts`）

| 服务键 | 接口 | 用途 |
| --- | --- | --- |
| `fs` | `FsService`（resolve / readText / writeText） | 读插件包文件、配置/HA/run 持久化读写、`storageDirs` 解析 |
| `timer` | `TimerService`（timeout 双形态） | HA 防抖、退避、探测调度、延迟 steer、配置重试、上下文注入/命令重试 |
| `llm` | `LlmService`（listProviders / listModels / stream? / prepareCall?） | 探测恢复、provider 注册表缓存、模型目录、推荐备份 |
| `subagents` | `SubagentProvider`（list / start） | 编排执行与子智能体生成 |
| `systemPrompt` | `SystemPromptService`（section） | 上下文注入段落注册（order 40） |
| `settings` | `SettingsService`（get） | 读取 DSH 语言偏好（`locale.preference`） |
| `agents` | `AgentsService`（list / currentInitiator?） | 会话 workspace cwd、`agentsGenerate` 的 parent agent |
| `agentDefaultModel` | `AgentDefaultModelService`（saveSelection / currentSelection） | `persistSelection` 持久化切换、模型提示 |
| `sandboxPolicy` | `SandboxPolicyService`（resolve） | 持久化兜底目录解析 |
| `launchEnvironment` | `LaunchEnvironmentService`（get） | `DSH_HOME` 读取 |
| `commands` | `CommandsService`（register） | `/ha` 与 `/orchestrate` 命令（懒注册 + 重试，不加入 inject） |
| `skills` | 运行时 `register` | 注册仅用户主动调用的 `dsh-ha-orchestrator` skill（不可用时跳过） |
| `typert` | `TypertRegistryService`（register） | 注册 host 侧 Remote 描述符，避免多实例协议包导致 RPC 端点不可见 |

### 4.2 暴露面

- **服务键**：`ctx.haOrchestrator`——`HaOrchestratorRpc extends TypertRemoteService`
  （`super(ctx, 'haOrchestrator')`），客户端经 `ctx.remote.haOrchestrator.<method>` 调用；
  19 个 Remote 方法经 `remote.ts` 装配成 marker：`stateGet` `stateReload` `stateSet`
  `stateExport` `stateImport` `modelsList` `agentsGenerate` `haReset` `haStatus` `haProbeNow`
  `haSuggestBackups` `orchRuns` `orchActive` `diagnostics` `orchListPresets` `orchSavePreset`
  `orchDeletePreset` `debugLogs` `debugClear`。
- **ctx.tools 注册**：`orchestrate`（auto 编排工具，参数含 mode/agent/supervisorAgent/preset/
  resume/reviewRounds/reviewers/budgetAgents/tasks/mergeInstructions/concurrency，输出 `{summary, runs, runId}`）与
  `list-subagents`（按需查询可用自定义子智能体清单，避免每轮注入占上下文）。
- **systemPrompt section**：`dsh-ha-orchestrator:context`，`order: 40`（紧随部署 persona 0 之后、
  plan-mode 50 与工具引导 100–199 之前，保证自动编排引导醒目）；关闭时为整段丢弃。
- **命令**：`/ha`（status / reset / probe `<provider> <model>`）与 `/orchestrate`
  （runs / show `<runId>` / presets）。
- **会话事件**：HA 侧 `ha/failover` `ha/circuit-opened` `ha/circuit-closed` `ha/probe`
  `ha/state-restored`；编排侧 `orch/run-start` `orch/task-status`（running/completed/error）
  `orch/run-end`。事件名不在 cordis 核心 Events 声明内，经窄化签名发出，载荷为纯 JSON。

---

## 5. 设计原则

1. **纯逻辑与 DSH 解耦**：`config` / `ha-core` / `orch-runner` / `language` / `remote` 全为
   无 `ctx` 纯模块，时序函数接受可注入 `now`，可独立单测；`index.ts` 是唯一装配层。
2. **共享状态物化为服务**：HA 运行态/配置/run 作为闭包内 `state`，对外物化为
   `ctx.haOrchestrator` 服务键（内部 + 开发者统一消费），不只是藏在闭包。
3. **注册即 effect**：所有工具、systemPrompt 段落、命令、事件监听都走 `ctx.effect` 生命周期，
   卸载/更新自动 dispose，无 zombie 注册；工具语言/子智能体变化后 `reinstallTools` 重建。
4. **持久化走官方 seam**：读写走 `fs` / `timer` 服务与 `launchEnvironment` / `sandboxPolicy`
    解析的目录（配置文件 JSON + 备份、HA 运行态 JSON 防抖落盘、run JSONL + Markdown 工件），依赖服务就绪问题
    用定时重试 + 懒加载兜底，而非自建原生文件访问（沙箱无进程级 fs/定时器）；Markdown 工件当前不自动修剪。
5. **不做核心 patch**：只用公开 `ctx.tools` / `ctx.systemPrompt` / `ctx.subagents` / `ctx.llm` /
   `agent/*` 事件等稳定接缝，坚持 mount-only / bundle-only。

---

*文档基于 `src/` 实测代码整理；产品方向与路线图见 `docs/local/productization-roadmap.md`（本地开发文档）。*
