# 安全说明（Security）

> dsh-ha-orchestrator 的安全边界、已落地的防护措施与建议。本文基于源码事实编写
> （`src/language.ts`、`src/config.ts`、`src/index.ts`、`src/orch-runner.ts`、`src/remote.ts`、
> `package.json`），未抽象描述，仅陈述代码实际执行的防护。

---

## 1. 信任边界与威胁模型

本插件运行在 DeepSeek Harness（DSH）宿主内，作为 static host **组合行（composition row）** 挂载。
它不修改 DSH 核心，也不拥有独立的文件系统权限：所有文件读写都经由宿主注入的 `fs` 服务、
`agents`/`sandboxPolicy`/`settings`/`llm`/`subagents`/`systemPrompt`/`commands` 等服务完成。

### 1.1 可被篡改的本地输入（低可信外部面）

| 输入面 | 文件/来源 | 可信度 | 说明 |
| --- | --- | --- | --- |
| 语言包 | 插件包内 `.language/zh.json`、`.language/en.json`（位于插件包根目录） | 本地文件，运行期从磁盘读取 | `readPluginFile` 优先 `node:fs` 读插件包真实路径，失败回退到 `fs` 服务；任何非字符串值视为畸形包 |
| 持久化配置 | `dsh-ha-orchestrator.config.json`（+ `dsh-ha-orchestrator.config.backup.json` 备份） | 本地文件，可被篡改 | 启动加载，亦可被 `stateImport`/`stateReload` 触发重读 |
| HA 运行态 | `dsh-ha-orchestrator.ha.json` | 本地文件，可被篡改 | 隔离/失败计数/游标/历史，启动时 `deserializeHaState` 解析并回灌内存 |
| Run 记录 | `dsh-ha-orchestrator.runs.jsonl` | 本地文件，可被篡改 | 每条 orchestrate 调用一行 JSON，`readRunsFromDisk` 逐行解析 |
| RPC 入参 | 配置页 Web UI（`ctx.remote.haOrchestrator.*`） | 宿主内，跨组件 | `stateSet`/`stateImport`/`orchSavePreset`/`agentsGenerate`/`haProbeNow` 均为未经类型约束的外部输入 |
| 工具入参 | `orchestrate` / `list-subagents` 由模型调用 | 低可信（模型可能被诱导） | `args.tasks`、`args.agent`、`args.supervisorAgent` 等直接来自工具调用负载 |

### 1.2 插件自身对宿主的介入面（可控，非不可信的输入）

- `agent/request` / `agent/request-error` / `agent/error` 事件监听器：在模板瀑布流最外层（`prepend: true`）
  对每个模型的 LLM 请求做拦截与模型切换。
- `systemPrompt` 段落注入：可向系统提示词注入一段上下文（有开关，默认只注入引导文本）。
- `commands` 注册 `/ha`、`/orchestrate` 两个命令。
- `Remote` RPC 服务 `haOrchestrator`。

以上操作均受配置开关与参数校验约束，详见下文。

### 1.3 重要结论

**插件不修改 DSH 核心（mount-only）。** 它不 `patch` 宿主，只通过 Cordis 的 `ctx.on`、
`ctx.tools.register`、`ctx.remote`、`ctx.emit` 等挂接点挂载能力；任何读写都经过宿主服务转发，
而非直接访问任意路径。这一设计把“插件能做什么”限制在宿主授予能力的范围内。

---

## 2. 已落地的防护

### 2.1 语言包严格 JSON（`src/language.ts`）

- `parseDictModule` 仅接受**严格 JSON 对象**：任何非字符串值（数字、布尔、嵌套对象、数组值）
  都会让整个语言包判为畸形返回 `null`。
- 语言包对象为空也判定为畸形。
- BOM（`\uFEFF`）在解析前被剥离，避免不同编辑器保存格式差异导致解析失败。
- 畸形包**回滚 zh**：`pickDict` 在目标语言加载失败时自动回退 `zh`，`zh` 再失败则降级为键名直显
  （`translate` 缺失键返回 key 本身，fail-loud 避免 UI 空白）。
- 语言包**仅作为字符串插值模板**：`translate` 只做 `{name}` 占位符替换，**没有 `new Function` /
  `eval` 类执行面**，恶意文案最多造成文案篡改，不会产生代码执行。

### 2.2 `sanitizeConfig` 输入校验（`src/config.ts`）

对 `stateSet`/`stateImport`/启动加载传入的任何配置做**类型钳制 + 字段白名单**：

- **字段白名单**：每个配置节只拷贝白名单字段（`ha`、`orch`、`debug`、`lang`、`ctx`），
  传入对象里的未知字段被丢弃。
- **类型规整**：所有布尔用 `asBool` 钳制、字符串用 `String()/asString` 强制转义、
  数值用 `Number()` 后按边界 `Math.min/Math.max` 收窄：
  - `ha.cooldownMs` 下限 `MIN_COOLDOWN_MS`（1000ms）；
  - `ha.threshold` 下限 1、`burstWindowMs`/`providerThreshold` 下限 0；
  - `orch.concurrency` 钳制到 `[1, 32]`、`maxAgents` 到 `[1, 64]`、
    `stageRetry` 到 `[0, 5]`、`globalConcurrency` 到 `[0, 64]`；
  - `lang.mode` 仅接受 `'zh' | 'en'`，其余恒为 `'auto'`。
- **数组逐字段规整**：
  - `ha.backups` 仅保留 `provider` 与 `model` 均非空的条目，`reasoningEffort` 可选；
  - `orch.agents` 仅保留 `name` 非空的条目，其余字段全部字符串化；
  - `orch.presets` 仅保留 `name` 非空的对象，任务仅保留 `prompt` 非空条目；
  - `ha.codes` 逐项 `String()` 并过滤空串。
- `sanitizeConfig` 返回全新对象，**不修改传入的 patch 与 base**。

### 2.3 RPC 参数校验（`src/index.ts`，`HaOrchestratorRpc`）

- **`stateImport`**：入参 JSON 先经 `parseConfigJson` 严格 `JSON.parse`，非对象直接抛错
  `importInvalid`；`sanitizeConfig` 后再校验至少有一个合法配置节，否则拒绝导入。
- **`haProbeNow`**：`provider` 与 `model` 均**必填**（缺失即抛错），杜绝空键探测。
- **`orchSavePreset`**: `name` 与至少一个含 `prompt` 的 task 必填。
- **`stateSet`/`stateImport` 共用 `applyConfigNext`**：把清洗后的配置节应用到运行态，只允许
  白名单节写入 `state.config`，不会出现任意字段注入。
- **`modelsList`**：`provider` 为空时直接返回空数组。

### 2.4 持久化文件解析宽容降级

- **HA 状态**：`deserializeHaState` 对畸形条目跳过而非抛错；整个文件无法解析时
  `loadPersistedHaState` 返回失败并记录 `[ha] HA state file malformed, ignored`，**不使插件崩溃**。
- **Run 记录**：`readRunsFromDisk` 对 JSONL 逐行 `JSON.parse`，损坏行 `catch` 后跳过，仅保留
  合法且含 `runId` 的记录。
- **配置**：`parseConfigJson` 解析失败返回 `null`，启动走回退路径（默认配置 + 定时/懒加载重试）。

这些“宽容降级”把本地文件被篡改的负面影响限定为**该文件被忽略**，不会导致拒绝服务或状态污染。

### 2.5 JSON 边界安全（`debugLog`）

- `debugLog` 写入前对 `data` 做 `JSON.stringify`/`JSON.parse` 往返（序列化安全化），任何
  `undefined`/循环引用/非 JSON 值被降级为可序列化形式或字符串，保证 `debugLogs`/`debugClear`
  的 RPC 结果能通过网关的 JSON 边界校验，不产生协议拒绝。
- 调试日志默认关闭（`debug.enabled` 默认 `false`），仅内存环形缓冲（上限 `DEBUG_LOG_CAP=500`），
  非磁盘持久化。

### 2.6 探测调用最小成本（`probeOnce`）

- 冷却到期后的真实恢复探测（`ha/probe`）以 **`maxTokens: 1` + 固定 `'ping'` 文本**的最小成本调用
  验证模型可用，避免为一次健康检查产生大额 token 消耗。
- 探测失败后重试间隔钳制在 `[60s, 5min]`，`PROBE_RETRY_MIN_MS`/`MAX` 封顶，避免无限频繁调用。
- provider 降级通配键（`provider/*`）**不执行真实探测**，到期直接解除隔离（`expired`）。

### 2.7 subagent 请求仅传递白名单字段（`src/orch-runner.ts`）

`buildSubagentRequest` 构造发给子智能体提供方的 request，**只组装**：

- `label`、`prompt`（text block）、`parent`、`signal`；
- 仅当 `agentDef.systemPrompt` 存在时带 `persona`；
- 仅当 `agentDef.provider/model` 存在时带 `agentOptions`。

任何来自工具入参、本地配置的其它字段**不会透传**进子智能体请求对象，避免字段走私/注入面。

### 2.8 编排未知子智能体名报错

`findUnknownAgents` 收集 `args.agent` / `args.supervisorAgent` / 各 `task.agent` 中被引用但
`orch.agents` 里不存在的名称；存在未知名时 `orchestrate` 直接抛错（`orch.errUnknownAgent`），
**拒绝执行**可能指向未定义子智能体的编排，而不是静默回退到默认模型。

### 2.9 并发与成本护栏

- `orchestrate` 工具参数 `tasks` 数组在 schema 上仅允许各字段为字符串（`additionalProperties: false`）；
- `maxAgents`（默认 8）被用于 `truncateTasks` 截断任务数量，`concurrency` 钳制到 `[1, maxAgents]`；
- `orch.globalConcurrency`（跨 run 共享信号量 `acquireOrchSlot`）限制同时进行的编排数，防止
  多个 agent 同时把子智能体提供方打爆；上限 64。

---

## 3. 数据持久化位置与泄露面

插件持久化三类文件，均落在**会话 workspace 或沙箱 workspace-write 可写根**：

| 文件 | 内容 | 敏感度 |
| --- | --- | --- |
| `dsh-ha-orchestrator.config.json`（+ `.backup.json`） | 完整配置，含 backups/model 选型、自定义子智能体 `systemPrompt`、上下文注入 `ctx.text` | **中—高**：可能含用户编写的自定义系统提示词与编排配方文本 |
| `dsh-ha-orchestrator.ha.json` | 隔离键、失败计数、游标、历史 | 低—中：含 provider/model 名与错误码 |
| `dsh-ha-orchestrator.runs.jsonl` | 每次 orchestrate 的完整 run：tasks 的 `prompt`、各 run 的 `output`、`summary` | **高**：含发送给子智能体的原始任务与输出全文 |

### 泄露面说明

- 写入目标目录顺序：① 会话 workspace / DSH 数据目录（`agents` 会话 header 的 `cwd`，未取到则回退
  `launchEnvironment` 的 `DSH_HOME`）→ ② 沙箱 `workspace-write` 可写根（`sandboxPolicy.workspaceRoot`）。
  写入与读取用**同一目录顺序**，保证重启后能找到。
- **非任意路径写**：所有写入均经 `fs` 服务的 `resolve(name, { cwd })` + `writeText(target)`，
  插件不以拼接绝对路径的方式写任意位置；文件名为固定常量。
- **run 记录含子智能体输出全文**：`orchestrate` 的 `runs[].output` 是各子智能体的完整文本输出，
  `tasks[].prompt` 是调用者给的任务原文，二者都落盘到 JSONL。**任何想从任务内容/输出中隐藏的信息都会持久化**。
- HA 状态仅在**非全空**时才写盘（`persistHaState` 首行：全空不产生噪音文件），空状态不残留文件。

---

## 4. 最小权限

- **不 patch 核心**：`package.json` 无 bundle patch 行为（`dsh.bundle.patch` 指向 `cordis.patch.yml`，
  这是插件自身的装配声明，不是对 DSH 核心的修改）；插件作为组合行 mount-only。
- **上下文注入有开关**：`ctx.enabled` 默认 `true`，但注入内容默认**仅引导文本**
  （`t('orch.hintSection')`，含【dsh-ha-orchestrator 插件上下文】标记便于检索）；自定义文本
  `ctx.text` 默认空。关闭时 `text()` 返回空串，组装器丢弃该段落，模型不获得任何插件上下文。
- **子智能体默认不注入上下文**：`ctx.injectSubagents` 默认 `false`，避免子代理被自动编排引导反复“层层外包”；如确需让子智能体看到同一段上下文，可在设置页开启。`orchestrate` 还会在运行时拒绝子智能体发起的嵌套编排（依据 `session.header.origin` / `delegationDepth`），作为硬性防线。
- **事件监听全部经 `ctx.effect` 注册**：工具（`toolDisposes`）、systemPrompt 段落
  （`contextInjectDispose`）、`/ha` 命令、`/orchestrate` 命令均在 `ctx.on/effect` 生命周期内注册，
  **卸载即清理**，不留 `zombie` 注册（Cordis 管理组合行生命周期）。
- **工具注册在插件自身 ctx**：`orchestrate`/`list-subagents` 于插件自己的 ctx 全局可见；
  注册 disposer 在 `ctx.effect` 里统一回撤。
- **RPC 服务随组合行卸载清理**：`TypertRemoteService` 由 Cordis 管理行生命周期。
- **LLM 选择持久化是受限能力**：`persistSelection` 默认关闭；仅当开启时才调用
  `agentDefaultModel.saveSelection({ provider, model })` 保存默认选型。

---

## 5. 建议与已知边界

### 5.1 供应链（npm 发布前）

- `prepublishOnly` 钩子完整执行 `typecheck → build → check → test → verify`，发布前应确保全绿。
- `peerDependencies` 声明了若干 `^` 范围依赖（`@deepseek-ai/dsh-tools`、`dsh-typert-protocol`、
  `dsh-client-runtime`、`dsh-api-remotes`、`dsh-agent`、`dsh-llm` 等均为 `^0.1.0-rc.X`）。
  **rc 版本范围在宿主升级后可能向前兼容性不稳**：发布前应针对宿主实际锁定的版本做一次回归，
  尤其关注 `dsh-tools` / `dsh-agent` / `dsh-llm` 这几个与工具注册、LLM 拦截、子智能体契约绑定的包。
- published `files` 清单包含整个 `src`、`lib`、`.language`、`cordis.patch.yml` 与 `docs`——
  发布产物会**携带完整源码**，若存在不想公开的实现逻辑需自行评估；同时请留意 `docs/security.md`
  随包发布后，攻击者可读到的正是本文所述边界，发布前请复核是否有过度披露的信息。
- `CHANGELOG.md`、`LICENSE`（MIT）随包发布，符号入库即可，无风险。

### 5.2 已知边界（当前实现未覆盖）

- **run 记录明文落盘**：`runs.jsonl` 以 UTF-8 明文保存任务 prompt 与子智能体输出全文，无加密。
  若部署环境的会话 workspace 可被不可信进程读取，属信息泄露面。
- **上下文注入文本来自配置**：`ctx.text` 经 `sanitizeConfig` 字符串化后按原文注入系统提示词；
  若该配置被篡改，注入内容可影响模型行为（属提示注入面，但需本地文件写权限才可篡改）。
- **模型错误码 / provider 名会写入日志与历史**：`agent/request-error`、`haStatus`、`/ha status`
  会记录 provider/model 名与错误码（如 `INVALID_CREDENTIAL`、`RATE_LIMIT`），但**不记录密钥/token 明文**。
- **本地文件可被篡改的场景下无完整性校验**：配置、HA 状态、run 文件均无签名/校验和；
  篡改者若具备 workspace 写权限，理论上可注入畸形数据。插件对此的防护是**宽容降级**（见 2.4），
  而非检测篡改。
- **`agentsGenerate` 依赖 `runMaintenance` / 维护信号完成取消**：RPC 路径没有工具运行时提供的
  `signal`，借用 `parent.runMaintenance` 维护信号；若运行时不支持会明确抛错，不会静默降级。

### 5.3 部署建议

1. 保持会话 workspace 与 DSH 数据目录**仅对可信进程可读写**，尤其因为 `runs.jsonl` 明文存全量 run 内容。
2. 若担心提示注入，可关闭上下文注入（`ctx.enabled = false`），模型将不获得插件引导文本。
3. 若无需在配置期间记录编排输出，可审慎清理 `dsh-ha-orchestrator.runs.jsonl`；内存/磁盘均有容量上限
   （`RUN_MEM_CAP=50`、`RUN_FILE_CAP=200`），超出后自动裁掉最旧记录。
4. 升级宿主或锁定新 peerDependencies 版本后，重新跑 `npm run verify` 与回归测试，确认工具注册、
   LLM 拦截、子智能体契约仍兼容。

---

## 附录：相关文件映射

| 主题 | 位置 |
| --- | --- |
| 语言包严格 JSON / 回滚 / 插值（无执行面） | `src/language.ts` |
| `sanitizeConfig` 类型钳制与字段白名单 | `src/config.ts` |
| 持久化路径降级 / RPC 边界 / 事件载荷 / 探测 / 上下文注入 / 工具注册 | `src/index.ts` |
| subagent 请求白名单字段、`findUnknownAgents`、并发护栏 | `src/orch-runner.ts` |
| Remote 装饰器运行时（无 DSH 依赖，纯 ESM） | `src/remote.ts` |
| files 清单 / `dsh.client.inject` / peerDependencies / 发布钩子 | `package.json` |
