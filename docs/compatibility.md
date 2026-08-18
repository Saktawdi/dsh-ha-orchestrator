# dsh-ha-orchestrator 兼容矩阵

> 状态：维护中（随每个 DSH rc / Node / 平台验证而更新）
> 适用版本：本文件描述 **v0.12.2 对应源码** 的兼容事实，基于代码而非承诺。

本文件记录 dsh-ha-orchestrator 与 DeepSeek Harness（dsh）、Node、平台及相邻插件的兼容边界。
目标读者：安装者（确认当前环境是否受支持）、维护者（升级/发布前核对）、插件作者（了解协作层级）。

---

## 1. 已验证环境快照

| 组件 | 已验证版本线 | 验证方式 |
| --- | --- | --- |
| DSH / dsh-* | **0.1.0-rc.6 peer 线**（本仓库不直接锁定 `@deepseek-ai/dsh` 核心包） | peerDependencies + 本地/CI 门禁 |
| Cordis | **4.0.1**（`@deepseek-ai/cordis`） | CI + 本机 |
| Node（engines） | **>=20.19** | `package.json` engines |
| Node（CI 验证） | **22**（GitHub Actions：Linux + Windows） | `typecheck / build / check / test / verify` 全链路 |
| 平台（CI） | Linux、Windows | GitHub Actions 双 job |
| 平台（本机） | **Windows + dsh web 热重载验证通过** | 真实 dsh 环境 `dsh plugin add "file:<repo>"` 后工具 / HA 事件 / 上下文注入可用 |

### 1.1 门禁链

发布前 `prepublishOnly = typecheck && build && check && test && verify`；CI 同款门禁
（`npm ci → typecheck → build → check → test → verify`）。任何新 DSH rc 验证都跑满这条链。

---

## 2. peerDependencies / devDependencies 表

### 2.1 peerDependencies（运行期，精确卡 rc 线）

| 包 | 声明范围 | 说明 |
| --- | --- | --- |
| `react` | `^18.2.0` | 客户端设置页 |
| `@deepseek-ai/cordis` | `^4.0.1` | `ctx.effect` 生命周期、`agent/*` 事件 |
| `@deepseek-ai/dsh-tools` | `^0.1.0-rc.6` | `defineTool` / `ctx.tools` |
| `@deepseek-ai/dsh-typert-protocol` | `^0.1.0-rc.6` | `TypertRemoteService` / `@Remote`（RPC） |
| `@deepseek-ai/dsh-client-runtime` | `^0.1.0-rc.6` | 客户端注入（`dsh.client.inject`） |
| `@deepseek-ai/dsh-api-remotes` | `^0.1.0-rc.6` | 客户端注入（`dsh.client.inject`） |
| `@deepseek-ai/dsh-agent` | `^0.1.0-rc.6` | `agent/*` 事件载荷、`Agent` 类型 |
| `@deepseek-ai/dsh-llm` | `^0.1.0-rc.6` | `LlmCallConfig`、探针 stream |

### 2.2 devDependencies（构建 / 测试期）

| 包 | 声明范围 | 说明 |
| --- | --- | --- |
| `typescript` | `^5.9.0` | `tsc` 构建（strict / NodeNext / declaration） |
| `@types/node` | `^22.0.0` | Node 类型 |
| `@deepseek-ai/dsh-agent` | `^0.1.0-rc.6` | 类型线（`dsh-agent` 事件载荷） |
| `@deepseek-ai/dsh-llm` | `^0.1.0-rc.6` | 类型线（`LlmCallConfig`） |

> **范围策略**：peer 声明 `^0.1.0-rc.6` 精确卡住 rc 版本线。由于 rc 阶段语义化版本约束弱，
> “^”在 rc 线内不自动跨越不兼容边界；升级到新 rc 时必须**主动 bump peer 并跑全门禁**，
> 不得依赖 npm 半自动解析覆盖兼容承诺。

---

## 3. 兼容策略

### 3.1 只用公开稳定接缝

插件只消费以下公开接缝（详见 `src/index.ts` 与 `src/types.ts`）：

- `ctx.tools`（`defineTool`，来自 `@deepseek-ai/dsh-tools`）
- `ctx.systemPrompt`（上下文注入段落；`inject = ['tools', 'systemPrompt']`）
- `ctx.subagents`（子智能体提供方：`list` / `start` / `result` / `dispose` / 真实 `AbortSignal`）
- `ctx.llm`（`listProviders` / `listModels` / 探针 `stream`）
- `agent/*` 事件（`agent/request`、`agent/request-error`、`agent/error`）
- 内部消费服务经 `getService()` 按名称取用（`fs`、`timer`、`agents`、`settings`、`sandboxPolicy`、`agentDefaultModel`、`commands`、`skills`、`typert`）

不做核心 patch；坚持 mount-only / bundle-only（`dsh.bundle.patch` + `cordis.patch.yml`）。

### 3.2 peer 精确卡 rc 线 + 升级主动 bump

- 依赖的 `dsh-*` 包声明在同一个 rc 线（`^0.1.0-rc.6`），不混用其它版本线。
- 升级 DSH rc 时，同步 bump peerDependencies 并跑 CI 全门禁，验证通过才发布。
- 本文件的“已验证快照”= 该 rc 的唯一保证；未列出的 rc 视为未验证。

### 3.3 类型经本地 `types.ts` 服务契约隔离

见 `src/types.ts` 头部注释：**不直接依赖 `dsh-*` 各包的服务类型**（rc 阶段类型变动频繁），
而是定义本插件消费的最小结构接口（`FsService` / `TimerService` / `LlmService` / `CommandsService` /
`SubagentProvider` / `SystemPromptService` / `SettingsService` 等），经 `getService()` 从 `ctx` 取用。
事件载荷（`agent/*`）与 `Agent` 类型才用官方 `dsh-agent` 声明。

**收益**：rc 阶段 `dsh-*` 服务类型变动不会破坏本插件构建（`tsc` 不依赖它们）；
最小结构接口还能显著放宽本插件对 host 服务实际形状的容错（`typeof fn === 'function'` 守卫后降级）。

---

## 4. 与相邻插件协作

### 4.1 与 `llm-retry` 的协作层级（代码事实）

`src/index.ts` 中两个 HA 监听器均声明 `true`（`prepend: true`），位于事件瀑布流**最外层**，拥有最终决定权：

1. **最外层（本插件）**：`agent/request` 与 `agent/request-error` 由本插件先处理。
   - 阈值内抖动（可重试瞬时错误，`failureCount < threshold`）：**带退避重试原模型**（`{ kind: 'retry' }`），本插件自管，不交给下游。
   - 不可重试错误（`INVALID_CREDENTIAL`/`AUTH`/`UNAUTHORIZED`/`NO_ADAPTER`）直接隔离切换，不消耗阈值计数。
2. **预算耗尽 → `next()` 放行**：重试预算（`maxRetries`）耗尽时，`agent/request-error` 返回 `next()`，
   把控制权**放行给官方 `llm-retry`**（下游），由其接管既定重试策略。
3. **逃逸失败再熔断**：`agent/error`（模型错误真正中断 run）由本插件兜底——隔离失败模型 + 延迟 `steer` 续跑。

> 组合配置建议：让本插件处理“实时抖动”，`llm-retry` 处理“预算/超时”，二者不重叠烧重试预算。

### 4.2 与其他编排/团队插件（`dsh-agent-teams` 等）

- **工具名唯一**：`orchestrate` / `list-subagents` 与其它插件工具名不冲突；冲突时以命名空间区分，避免同时安装的工具被互相覆盖。
- **上下文注入可关闭**：Settings → “HA 与编排” → System → 关闭 **context injection** 后，本插件不注入 systemPrompt 段落（自动触发仅靠 `orchestrate` 工具描述），降低与 `dsh-agent-teams` 等提示词改写插件的干扰。
- **服务按键取用**：`ctx.subagents` / `ctx.llm` 等按名称 `getService()` 取，存在同名服务时按 Cordis 装配顺序解析，组合安装需按文档核对。

---

## 5. 可选服务与降级行为

| 服务 | 缺失时的行为 |
| --- | --- |
| `commands` | 插件仍可运行；仅 `/ha` 与 `/orchestrate` 命令不可用。 |
| `skills` | 插件仍可运行；不注册随包 skill。 |
| `typert` | 依赖 Remote marker 的回退路径；若宿主无法识别 marker，设置页 RPC 可能不可见。 |
| `fs` / `sandboxPolicy` / `agents` / `launchEnvironment` | 配置、HA 状态或 run 记录的持久化能力可能降级；设置页诊断会暴露服务与写入状态。 |
| provider capabilities | `toolFilter`、`outputSchema`、`maxDepth` 等不支持的字段会在子智能体启动前自动剥离。 |

插件只把 `tools` 与 `systemPrompt` 作为必需注入服务；其它服务均通过 `getService()` 惰性获取，并在适用处重试或降级。

---

## 6. 已知风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| DSH 仍为 rc 阶段，API 频繁变化 | 插件易碎、升级被破坏 | 只用公开稳定接缝；peer 精确卡 rc 线；兼容矩阵 + CI 快照（本文件即矩阵中心） |
| 新 rc 引入的服务类型变动 | `tsc` 构建失败 | 类型经 `src/types.ts` 最小结构契约隔离，不直连 `dsh-*` 服务类型，rc 类型变动不破坏构建 |
| 与 `dsh-agent-teams` 等同时安装 | 提示词 / 工具互相干扰 | 工具名唯一；`context injection` 提供开关；文档说明组合用法 |
| 自建持久化（JSON/Markdown 文件）与官方 seam 冲突 | 升级破坏或数据残留 | 优先 `storageDomain` / settings / session events 迁移；run Markdown 工件当前需手动清理 |
| 未经验证的 rc / Node / 平台 | 安装或运行失败 | 每次验证后同步更新本文件快照；未列出即未验证 |

---

*文档基于 v0.12.2 源码事实编写，随版本迭代与 DSH rc 验证持续更新。未列出的 DSH rc、Node 或平台均视为未验证。*
