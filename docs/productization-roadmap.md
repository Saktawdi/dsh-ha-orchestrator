# ha-orchestrator 产品化开发 / 迭代路线图

> 版本：草案 v1.0
> 范围：基于 2026-08 GitHub / npm 生态调研，为 ha-orchestrator 从“个人可用插件”升级为“优秀产品化 DSH 插件”给出路线图。
> 当前基线：v0.10.0（2026-08-15）。静态 Cordis 插件；源码 TypeScript（`src/`），`lib/` 为 tsc 构建产物（含 `.d.ts`）；168 测试（123 单测 + 45 集成）+ verify 冒烟（6 组）+ GitHub Actions（Linux/Windows 全链路）；HA 持久化/两层熔断/探测恢复/类型化事件、run 持久化/事件/命令/配方/resume/调用预算、对话内 Run 卡片（官方展示投影 + keyed toolview）、诊断卡片/配置导出导入、docs 8 篇 + CONTRIBUTING + Issue 模板；`dsh plugin add "file:<repo>"` 可安装；npm 发布与 GitHub Release 待环境就绪（gh/npm 未认证）。

---

## 1. 调研结论：DSH 生态里“同类”很多，但组合生态位仍稀缺

通过 GitHub Topic、awesome 列表、npm 和关键词检索，当前 DSH 生态中与 ha-orchestrator 相关的插件可归为四类：

| 类别 | 代表插件 | 主要能力 | 成熟度信号 |
| --- | --- | --- | --- |
| 模型高可用 / 回退链 | `dsh-model-failover`、`@visol-456/dsh-llm-fallback`、`dsh-llm-fallbacks` | 熔断、冷却、备用链、探测恢复、设置 UI、事件 | 中高：有 npm、bundle、文档、部分有测试 |
| 子代理委派增强 | `dsh-subagent-tools`、`dsh-plugin-subagent-director`、`dsh-subagent-max`、`yet-another-subagent`、`dsh-plugin-product-subagents` | 单次/continuable 子代理，per-call model/provider/persona/toolFilter，实时面板 | 中高：多为 TS + 测试 + npm |
| 一次性/持久化编排 | `dsh_workflow`、`dsh-meta-orchestrator`、`dsh-deep-research`、`allinluna`、`dsh-orchestrator`、`oh-my-dsh`、`dsh-captain` | fanout/pipeline/supervisor、工作流持久化、resume、任务图、worker 网格 | 分化大：`dsh_workflow` 179 测试最工程化；`dsh-meta-orchestrator` 46 测试且不造运行时 |
| 多智能体团队协作 | `dsh-agent-teams`（292 stars）、`the-real-agent-teams-for-dsh`、`dsh-collaboration`、`dsh-agent-team-gui`、`plugin-team-board` | 持久成员、任务 DAG、邮箱、文件认领、审批、监控面板 | 高：多数 TS、测试、npm、Web UI、文档 |

### 1.1 对 ha-orchestrator 的关键判断

1. **纯 HA 方向已有竞品且更“专”**：
   - `dsh-model-failover` 提供两层熔断（model + platform）、冷却后真实探测恢复、事件；
   - `dsh-llm-fallbacks` 支持 root/subagent 角色链、`provider/*` 通配、冷却回切、设置页和诊断命令；
   - `@visol-456/dsh-llm-fallback` 提供 Web UI 配置和清晰的回退链语义。
   - ha-orchestrator 当前的“阈值 + 冷却 + 备用轮换（per-agent 游标）+ 重试预算 + steer 续跑 + 错误码过滤”有差异点（尤其 `agent/error` 后隔离 + 延迟 steer 恢复），但缺少探测恢复、平台级熔断、事件与 HA 运行态持久化。

2. **纯编排方向已非常拥挤，且头部工程化远超 ha-orchestrator**：
   - `dsh_workflow` 是“可生成、可保存、可恢复”的 Workflow 层，带 run graph、effect cache、179 测试；
   - `dsh-meta-orchestrator` 让模型“先规划再执行”，只记录不执行，适配 DSH 原生能力；
   - `allinluna` 主打 top-level task、独立上下文、resume、verify-before-done；
   - `dsh-orchestrator` 做 worker 网格直接互发消息。
   - ha-orchestrator 若只靠 `orchestrate` 三种固定模式，很难在“编排”上正面竞争。

3. **团队协作方向已有高 star 产品**：
   - `dsh-agent-teams` 已经验证“持久团队 + 任务依赖 + 邮箱 + 活动面板”的需求；
   - `the-real-agent-teams-for-dsh` 更进一步做了 34 个工具、文件所有权、审批、完成守卫。
   - ha-orchestrator 不应盲目跟进“大而全团队”，而应做“轻量但可靠”的差异化。

4. **ha-orchestrator 真正的机会点是“HA + 编排 + 配置 UI”三合一**：
   - 竞品多数只做 HA **或** 只做编排；
   - ha-orchestrator 已同时具备：模型故障自动切换、`orchestrate` 三种模式、自定义子智能体（可 AI 生成）、双语设置页、自动触发上下文（systemPrompt 注入 + 自定义文本）、`list-subagents` 按需查询。
   - 产品化目标不是“在所有维度超过别人”，而是把这三个能力做成一个**开箱即用、可观察、可扩展、可发布**的 DSH 插件。

---

## 2. 产品定位与差异化策略

### 2.1 一句话定位

> **让 DSH 会话“扛得住模型故障，也拆得开复杂任务”：一个面向日常深度工作的轻量 HA + 编排插件。**

### 2.2 差异化锚点

| 锚点 | 当前状态（v0.2.2） | 目标状态 |
| --- | --- | --- |
| 模型高可用 + 任务续跑 | 有基础（阈值/冷却/轮换/重试预算/steer） | 做成“最可靠的 DSH 模型故障恢复层” |
| 轻量编排 | 三种模式 + `list-subagents` + 自定义子智能体 | 三种模式 + 可持久化 run + 实时进度 |
| 零配置开箱 | 需手动配置 backups（默认内置 reviewer 继承默认模型） | 内置向导/推荐配置 + 空状态引导 |
| 配置体验 | 自绘五卡片 UI + 上下文注入 | 官方 Settings 体系 + 中英双语 + 可访问性 |
| 工程可信度 | 129 测试（114 单测 + 15 集成）+ verify + CI（Linux/Windows） | 全绿 + e2e + 兼容矩阵 |

### 2.3 不做什么（边界）

- 不做完整持久化团队协作（与 `dsh-agent-teams` 正面竞争，除非后续单独做“Teams”产品线）。
- 不做独立 Workflow 引擎（不与 `dsh_workflow` 抢“可编程工作流平台”）。
- 不直接修改 DSH 核心文件（坚持 mount-only / bundle-only）。
- 不引入重型运行时（保持轻量、低心智负担）。

---

## 3. 差距分析（当前 → 产品化）

| 维度 | 现状（v0.2.2） | 产品化目标 | 主要差距 |
| --- | --- | --- | --- |
| 安装 | `dsh plugin --profile web add "file:<repo>"` 已可用（`dsh.bundle.patch` + `cordis.patch.yml`） | `dsh plugin add ha-orchestrator`（npm 包名）一键安装 | 缺 npm 发布与兼容矩阵验证记录 |
| 技术栈 | TypeScript 七模块（src/，strict）+ tsc 构建（lib/ + .d.ts） | TypeScript 模块化、官方 client 基建 | client 仍手写 JS，待 Phase 3 迁移官方 UI 基建；服务键已物化（ctx.haOrchestrator） |
| 测试 | 129（114 单测 + 15 集成：假 ctx 驱动真实插件的 HA 事件流 / 编排 execute / 配置持久化恢复） | 核心逻辑单测 + 离线冒烟 + e2e | 真实 dsh 环境的 live e2e 待补（部署验证） |
| CI | GitHub Actions：Linux + Windows（typecheck / build / check / test / verify，Node 22） | typecheck / test / build / verify 全绿 | 无兼容矩阵 job |
| 状态持久化 | 配置 JSON（`ha-orchestrator.config.json` + `.backup.json`）+ HA 运行态（`ha-orchestrator.ha.json`，防抖写盘 + 重启恢复） | HA 熔断/冷却/历史可持久化 + run 持久化 | run 运行态进程重启丢失（Phase 2） |
| 可观测性 | debug 日志（内存环形 500 条）+ 设置页状态卡 + 注入状态徽章 + 类型化会话事件（ha/*）+ `/ha status` 命令 | 会话事件、`/ha` 命令、活动面板、状态快照 | 缺 Run 面板与实时进度（Phase 2/3） |
| 配置 | 自有 JSON 文件 + 自绘五卡片 UI | DSH settings/storageDomain + 官方 Settings 卡片 | 存储/UI 都需迁移 |
| 兼容性 | 已有 peerDependencies（caret 范围），无兼容矩阵 | 校准 peerDependencies、记录已验证 DSH 快照 | 缺验证记录与兼容策略 |
| 文档 | README 双语 + docs 3 篇（评分/设计参考/路线图） | README + docs + 升级指南 + 安全说明 | 缺维护文档 |
| 安全 | 有 sanitize；语言包为严格 JSON（0.2.2 移除 `new Function` 执行面） | 输入校验、路径安全、最小权限、安全模型文档 | 需审计与文档化 |
| 社区 | 个人仓库 + GitHub Actions + CHANGELOG | release、changelog、issue 模板、contribution guide | 缺发布流程 |

---

## 4. 目标架构（建议）

```text
ha-orchestrator/
├── package.json              # dsh.bundle.patch + dsh.client.inject + peerDependencies（已落地）
├── cordis.patch.yml          # bundle patch：一行挂载（已落地）
├── .language/                # 语言包（zh.json / en.json），严格 JSON（已落地）
├── lib/                      # 当前实现：纯 JS 七模块
│   ├── index.js              # 插件入口、inject=['tools','systemPrompt']、HA 事件、编排工具、
│   │                         #   上下文注入（order 40）、Remote RPC（8 个方法）
│   ├── client.js             # 手写 React 设置页（五卡片）+ 状态卡（lazy-CJS bundle）
│   ├── config.js             # Config schema、默认值、sanitizeConfig（无 DSH 依赖）
│   ├── ha-core.js            # HA 状态机纯函数：隔离/冷却/轮换游标/重试预算（无 DSH 依赖）
│   ├── orch-runner.js        # 编排纯逻辑：并发池/pipeline carry/supervisor prompt/汇总渲染（无 DSH 依赖）
│   ├── language.js           # 语言包解析/回滚/插值（无 DSH 依赖）
│   └── remote.js             # Remote decorator 官方同形装配（无 DSH 依赖）
├── src/                      # TypeScript 源码（已落地，替代 lib/*.js 为构建产物）
│   ├── index.ts              # 插件入口、inject、生命周期
│   ├── config.ts             # Config schema、默认值、sanitize、持久化
│   ├── ha/                   # 高可用：熔断/冷却/轮换/探测/steer
│   │   ├── circuit.ts
│   │   ├── failover.ts
│   │   ├── state.ts
│   │   └── events.ts
│   ├── orch/                 # 编排：orchestrate 工具、任务运行器
│   │   ├── tool.ts
│   │   ├── runner.ts
│   │   ├── run-store.ts      # run 持久化（storageDomain / JSONL）
│   │   └── progress.ts
│   ├── i18n/                 # 语言包 + t()
│   ├── client/               # React + 官方 UI primitives
│   │   ├── index.tsx
│   │   ├── SettingsCards.tsx
│   │   ├── RunPanel.tsx
│   │   └── status-card.tsx
│   └── shared/               # 纯逻辑，不依赖 DSH
├── tests/                    # node:test 单测（114 例，已落地；TS 迁移后接 vitest/tsc 亦可）
├── scripts/
│   └── verify.mjs            # 离线冒烟（已落地）
├── docs/
│   ├── comparison-scoring.md         # 竞品评分（已落地）
│   ├── design-references.md          # UI/产品设计参考（已落地）
│   ├── productization-roadmap.md     # 本路线图（已落地）
│   ├── architecture.md               # 已落地（v0.8.0）
│   ├── configuration.md              # 已落地（v0.8.0）
│   ├── security.md                   # 已落地（v0.8.0）
│   ├── verification.md               # 已落地（v0.8.0）
│   └── compatibility.md              # 已落地（v0.8.0）
└── README.md / README.zh-CN.md
```

设计原则：

1. **纯逻辑与 DSH 解耦**：`ha/`、`orch/run-store` 的核心状态机写成不依赖 `ctx` 的纯模块，方便单测（当前 `config` / `ha-core` / `orch-runner` / `language` / `remote` 已满足）。
2. **共享状态物化为服务**：提供 `ctx.haOrchestrator` 服务键（内部 + 开发者消费），不要只藏在闭包。
3. **注册即 effect**：所有工具、事件、UI 注册都走 `ctx.effect` 生命周期，卸载即清理（当前已按此实现）。
4. **持久化走 DSH 官方 seam**：优先 `storageDomain` / settings / session events，而不是自建 JSON 文件（当前配置为自建 JSON + backup，需迁移）。
5. **不做核心 patch**：只用公开 `ctx.tools`、`ctx.systemPrompt`、`ctx.subagents`、`ctx.llm`、`agent/*` 事件等稳定接缝。

---

## 5. 分阶段路线图

### Phase 0：工程化地基（1–2 周，已完成 100%）

目标：让仓库从“能跑”变成“能维护、能发布”。

- [x] 迁移到 TypeScript + 模块化目录（源码 `src/`，构建产物 `lib/`，strict / NodeNext / declaration）。
- [x] 引入 `tsc` 构建（`npm run build`），提交 `lib/` 构建产物 + `.d.ts` 类型声明。
- [x] `package.json` 基础产品化字段已落地：`files`（含 `.language` / `cordis.patch.yml` / `docs` / `src`）、`scripts`（test / typecheck / build / check / verify / prepublishOnly）、`repository`、`keywords`、`dsh.bundle.patch`、`dsh.client.inject`、`exports`（含 `types` 入口）。
- [x] `engines.node`（>=20.19）、`publishConfig.access: public`、peerDependencies 校准（rc.6 版本线 + 补 `dsh-agent` / `dsh-llm` 类型线）。
- [x] `cordis.patch.yml` 已落地，`dsh plugin add "file:<repo>"` 会自动加入 profile bundles（已与官方 dsh CLI 源码核对 reconcile 行为）。
- [x] 核心逻辑单测已落地（`node:test`，共 114 例）：
  - config：默认值/sanitize 钳制与规整（`tests/config.test.js`，20 例）；
  - HA 状态机纯函数：阈值/冷却/通配与精确隔离/重试预算/轮换游标（`tests/ha-core.test.js`，19 例）；
  - 编排纯逻辑：并发池保序/异常隔离、pipeline carry、supervisor prompt、maxAgents 截断、并发解析、请求构造与汇总渲染（`tests/orch-runner.test.js`，41 例）；
  - i18n：语言解析、回滚、占位符（`tests/language.test.js`，24 例）；
  - Remote decorator 运行时：标准 context/initializer/元数据语义（`tests/remote.test.js`，10 例）。
- [x] HA 持久化恢复与事件流集成测试：`tests/integration/host.test.js`（15 例）——最小假 ctx（cordis waterfall/emit/reflect 语义）驱动真实插件构建产物，覆盖装配、上下文注入求值、HA 事件流（直通/隔离/切换/预算耗尽/停止兜底 steer）、orchestrate 三种模式 execute（含 pipeline carry、supervisor 合成）、配置写盘与「重启恢复」（共享内存 fs 模拟磁盘）、agentsGenerate、语言跟随、haReset、模型列表。
- [x] 真实 subagent 的 execute 集成：以契约级假提供方（list/start/result/dispose + 真实 AbortSignal 校验）覆盖 runOne 全链路；真实 dsh 环境的 e2e 留待部署验证（执行 `dsh plugin add "file:<repo>"` 后工具/事件/注入可用即视为通过，本机已热重载验证）。
- [x] `scripts/verify.mjs` 离线冒烟（6 组：包字段 / patch / 语言包 / TS 构建产物完整性 / 纯模块冒烟 / npm pack dry-run）+ GitHub Actions（Linux/Windows，Node 22，`npm ci → typecheck → build → check → test → verify`），`prepublishOnly` 同款门禁。
- [x] `pnpm typecheck` / `pnpm build`（npm 脚本等价物）已补入同一门禁。
- 已知问题修复（v0.2.1 / v0.2.2 已全部落地，见 CHANGELOG）。

### Phase 1：HA 能力补强（建议 2–3 周，已完成 100%）

目标：在“模型故障恢复”这个锚点上做到生态最可靠。

- [x] **持久化 HA 状态**：隔离、失败计数、冷却、当前轮换游标、切换历史防抖写入 `ha-orchestrator.ha.json`（与配置文件同目录、同降级顺序），启动/重试/懒加载路径均恢复并继续冷却计时（v0.4.0）。
- [x] **熔断升级**：
  - 支持“模型级 + Provider 级”两层熔断：`providerThreshold` 个模型被隔离后熔断整个 provider（通配键），备用挑选跳过被熔断 provider（`findFallback` 检查通配键）；
  - 支持 `burstWindowMs` 滑动窗口：窗口内首次失败记入 `windowStart`，滑出窗口计数重置；
  - 冷却到期后**真实探测恢复**（小成本 `maxTokens=1` 调用）：成功解除隔离（`ha/circuit-closed`），失败延长冷却并重试（60s–5min）；provider 通配键到期即解除；`/ha probe` 与 RPC `haProbeNow` 支持手动探测。
- [x] **错误分类策略**：
  - 不可重试错误（`INVALID_CREDENTIAL`/`AUTH`/`UNAUTHORIZED`/`NO_ADAPTER`）直接隔离切换、不消耗阈值计数；
  - `CONTEXT_WINDOW_EXCEEDED` 提供可选降级（`degradeContextWindow`：去掉 reasoningEffort 重试原模型）。
- [x] **切换可观测**：
  - 类型化会话事件：`ha/failover`、`ha/circuit-opened`、`ha/circuit-closed`、`ha/probe`、`ha/state-restored`；
  - `/ha status` 命令（status / reset / probe）+ RPC `haStatus`（隔离层级/失败计数/游标/探测记录）。
- [x] **配置向导**：
  - RPC `haSuggestBackups` 从已注册 provider×模型目录自动挑选候选（排除当前默认选择）；
  - 设置页「推荐备份」按钮一键追加（空状态引导文案）；“从配置添加”手动下拉保留。
- [ ] **与 `llm-retry` 协作**：
  - 层级已明确并实现：本插件监听器 `prepend: true` 位于瀑布流最外层——阈值内抖动由本插件带退避重试；预算耗尽 `next()` 放行给官方 `llm-retry`；逃逸失败再进熔断/回退。
  - 待补：README/文档中写出该层级说明与组合配置建议（随 Phase 4 文档体系落地）。

### Phase 2：编排能力产品化（建议 3–4 周，已完成约 90%）

目标：保留“轻量”，但让 run 可观察、可恢复、可复用。

- [x] **run 持久化**：
  - 每次 `orchestrate` 调用生成 `runId`，任务定义（含 prompt）、每个子代理输出、状态、耗时、中止标记写入 `ha-orchestrator.runs.jsonl`（JSONL 追加写，磁盘保留 200 条、内存 50 条）；失败调用同样留痕（v0.5.0）；
  - `/orchestrate runs`、`/orchestrate show <runId>` 已落地（v0.5.0）。
- [x] **实时进度**：
  - 类型化会话事件 `orch/run-start` / `orch/task-status`（running/completed/error）/ `orch/run-end`（v0.5.0）；
  - RPC `orchRuns` 暴露最近 run（内存）；设置页轻量 Run 面板待 Phase 3 UI 落地。
- [x] **任务级失败隔离**：
  - `fanout` / `supervisor` 已通过 `poolRun` 对每个子任务逐个 `try/catch` 并标记 `status='error'` 保留失败原因，默认不整体失败（已落地并有单测覆盖）；
  - `pipeline` 单阶段失败策略已补齐：`orch.stageRetry`（0–5，默认 0）重试预算 + 单阶段降级（失败标记 error、中止后续阶段、调用不整体失败、汇总含失败说明）（v0.5.0）。
- [x] **并发与预算**：
  - 全局并发/单 run 并发分开：`orch.globalConcurrency`（0–64，默认 0=不限）跨 run 共享信号量，多个编排并发时排队（v0.6.0）；
  - 子智能体调用预算：`budgetAgents`（0–128）硬限制，超限即中止并留痕（v0.9.0）；token 级预算待子代理 token 上报能力（低优先级）。
- [x] **模式增强**：
  - `fanout` 支持可选合并提示词（`mergeInstructions` 触发合成任务）（v0.5.0）；
  - `map-reduce` / `router` 作为可选 pattern 已落地（v0.6.0）；
  - `supervisor` 支持评审轮次 `reviewRounds`（1–3）与**多评审者** `reviewers` 数组（并行评审 + 综合）（v0.6.0 / v0.9.0）；
  - `pipeline` 结构化中间产物（轻量）：carry 带 `--- 阶段 N: <任务> ---` 标记（`pipelineStageBlock`）（v0.9.0）。
- [x] **复用**：
  - 配方/预设已落地：RPC `orchSavePreset` / `orchListPresets` / `orchDeletePreset` + 工具参数 `preset` 按名执行（调用参数可覆盖）+ `/orchestrate presets`（v0.6.0）。
- [x] **取消与恢复**：
  - 取消语义已基本闭环：`runOne` 强制要求真实 `AbortSignal`（缺失直接拒绝）、`poolRun` 透传、`pipeline` 循环检查 `signal.aborted`、`run.dispose()` 在 finally 回收；
  - 中断后按 runId 恢复未完成子任务已落地（`resume <runId>`：fanout/supervisor 跳过已完成、pipeline 从失败阶段续跑并继承 carry，结果按原任务顺序合并，记录带 `resumedFrom`；旧记录缺 prompt 时明确报错）（v0.6.0）。

### Phase 3：UI / 产品体验（建议 2–3 周，核心项已落地，收尾中）
目标：从“能配置”变成“好用、好看、可信”。

- [ ] **迁移客户端到官方基建**（slots 已官方化，剩余低风险渐进项）：
  - client 已经官方 `ctx.slots` 注册：`settings.section`（设置分区）、`tool.view.cordis`（状态卡）、`tool.call.toolview`（对话内 Run 卡片 key='orchestrate'）（v0.10.0）；`$mount` + TYPERT_REMOTE 描述符为官方装配模式；
  - 剩余：`dsh-client-ui-primitives` 组件替换手写 `createElement` 小组件、官方 locale 命名空间替代 `stateGet` 字典同步——无浏览器验证手段下暂缓的渐进项。
- [x] **设置页重构（首批）**：
  - 新增「诊断」折叠卡片：熔断/冷却/探测概览、隔离清单（含 level/剩余时间）、失败计数、游标、探测记录、最近 run，10s 轮询（v0.7.0）；
  - “一键导出/导入配置”已落地：`stateExport`/`stateImport` RPC + 系统卡片导出（复制）/导入（粘贴并应用）区域（v0.7.0）；
  - 卡片化风格与 DSH 原生对齐（CSS 变量 + 折叠）已部分完成；原生 settings 体系迁移待官方基建项。
- [x] **Run 面板**：
  - 对话流中显示 `orchestrate` 调用卡片：官方展示投影（`presentationMeta`/`presentCall`/`presentResult`）+ `tool.call.toolview` keyed 槽位注册 RunCard——运行中实时子任务数、完成后 runId 标题 + 状态徽章 + 输出摘要（v0.10.0）；
  - 设置页「诊断」卡片已展示最近 run 列表（runId/mode/status）（v0.7.0）。
- [x] **可访问性与响应式**：`prefers-reduced-motion` 降级动画、`:focus-visible` 键盘焦点样式已落地（v0.8.0）；CSS 变量 + 弹性布局已基本响应式。
- [x] **错误体验**：
  - 安装后无 backups 时，UI 给清晰引导（HA 卡片空状态文案 + 「推荐备份」按钮）（v0.7.0）；
  - 插件加载失败时的可操作诊断：`/ha diag` 命令 + `diagnostics` RPC（服务可用性/持久化/加载状态/语言回滚/注入状态）（v0.9.0）。

### Phase 4：发布与生态（建议 2–3 周，文档体系与社区基建已完成，发布动作待环境就绪）

目标：成为一个“可被发现、可升级、可信任”的公开插件。

- [ ] **npm 发布**：
  - 包名 `ha-orchestrator`；`publishConfig.access: public` 已配置；Trusted Publishing 待 npm 账号启用；
  - `npm pack` 产物已验证（40 文件，含 `lib/`、`cordis.patch.yml`、`.language/`、`src/`、文档；`prepublishOnly` 门禁已配置）；
  - 实际 `npm publish` 待 npm 登录（当前本机未认证，需 `npm adduser` 或 CI 发布 token）。
- [x] **兼容矩阵**：
  - `docs/compatibility.md` 已落地：已验证 DSH rc.6 快照、Node >=20.19、Linux/Windows CI、peerDependencies 表与兼容策略（v0.8.0）。
- [x] **文档体系**：
  - README 双语（安装/快速开始/配置/文档索引）+ docs 8 篇（architecture / configuration / security / verification / compatibility / roadmap / comparison / design-references）；
  - 提供“让 AI 安装”的一段式 prompt（README 已有，持续维护）；
  - 升级指南/FAQ 待补（低优先级）。
- [x] **发布流程**：
  - CHANGELOG 已维护至 v0.8.0；`npm run verify` 作为发布前门禁（prepublishOnly 全链路）；
  - GitHub Release 附 `.tgz`：流程已写入 `docs/verification.md`，执行需 gh CLI（本机未安装）或 GitHub Web 上传。
- [x] **社区反馈**：
  - Issue 模板（bug / feature / compatibility）已落地（v0.8.0）；
  - `CONTRIBUTING.md` 已落地（v0.8.0）；
  - 提交 awesome-dsh-plugin / dsh-suite 目录待 npm 发布后执行。
- [x] **可选 Skill**：
  - 随包提供 `ha-orchestrator` 使用/排障 Skill 已落地：`ctx.skills.register` 运行时注册（source=bundled，双语 markdown 正文，语言切换自动重建，skills 缺失部署静默跳过）（v0.11.0）。

---

## 6. 产品化成功指标（建议）

| 指标 | 当前（v0.3.0） | 6 个月目标 |
| --- | --- | --- |
| 安装方式 | `dsh plugin add "file:<repo>"` 可用 | `dsh plugin add ha-orchestrator` 一键安装 |
| npm 下载 / GitHub stars | 未发布 npm，stars 低 | 持续增长，有外部用户 issue/PR |
| 测试数 | 129 断言（114 单测 + 15 集成）+ 离线冒烟 | ≥ 80 个核心逻辑断言 + 集成/e2e |
| CI | Linux + Windows 全绿（typecheck/build/check/test/verify） | 加兼容矩阵 job |
| 崩溃/阻塞类 issue | 未知 | 有兼容矩阵与回归测试兜底 |
| 用户可观测性 | debug 日志 + 设置页状态卡 | `/ha status`、会话事件、Run 面板 |
| 文档 | README + docs 3 篇 | 5+ 篇结构化文档 |
| 版本兼容 | 无声明 | 每个 DSH rc 有验证记录 |

---

## 7. 风险与决策记录

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| DSH 仍是 rc 阶段，API 频繁变化 | 插件易碎 | 只用公开稳定接缝；peerDependencies 精确；兼容矩阵 + CI 快照 |
| “编排”赛道拥挤，差异化难 | 被替代 | 主打“HA + 编排 + UI”组合，不硬拼 workflow 引擎 |
| 维护精力有限 | 迭代停滞 | 优先自动化测试与发布流程，减少手工回归 |
| 自建持久化与官方 seam 冲突 | 升级破坏 | 尽早迁移到 `storageDomain` / settings / session events |
| 与 `dsh-agent-teams` 等同时安装 | 提示词/工具互相干扰 | 工具名保持唯一；上下文注入提供开关；文档说明组合用法 |

---

## 8. 推荐立即执行的三件事

1. **补 npm 发布准备**：`publishConfig.access`、`engines` 已落地；兼容矩阵验证记录 + 首次 GitHub Release（附 `.tgz`）待补（Phase 4）——安装/分发仍是评分最低的维度，也是“产品化”的第一张门票。
2. **HA 运行态持久化 + 类型化事件（Phase 1）**：✅ 已落地（v0.4.0）——隔离/失败计数/冷却/轮换游标落盘、重启可恢复、探测恢复、`/ha status`、`ha/failover` 等事件。
3. **补 run 持久化与对话内 Run 卡片（Phase 2/3）**：`orchestrate` 生成 `runId` 并落盘子任务状态/输出，把纯文本结果升级为可观察、可恢复的会话内卡片——这是用户感知最直接的提升（下一步）。

---

> 注：本调研为 2026-08 快照，文中外部竞品的 stars/测试数等数字会随时间漂移，落地前请按对应 commit/tag 复核。

## 9. 参考生态（调研来源精选）

- [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- [0xsline/awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
- [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)
- [icetomoyo/dsh_workflow](https://github.com/icetomoyo/dsh_workflow)
- [jiruidai/dsh-meta-orchestrator](https://github.com/jiruidai/dsh-meta-orchestrator)
- [omdsh-dev/dsh-deep-research](https://github.com/omdsh-dev/dsh-deep-research)
- [zenx0x/allinluna](https://github.com/zenx0x/allinluna)
- [Letter2025/dsh-model-failover](https://github.com/Letter2025/dsh-model-failover)
- [Visol-456/dsh-llm-fallback](https://github.com/Visol-456/dsh-llm-fallback)
- [dsh-external/dsh-llm-fallbacks](https://github.com/dsh-external/dsh-llm-fallbacks)
- [toolclub/dsh-agent-team-gui](https://github.com/toolclub/dsh-agent-team-gui)
- [Socialist-Sister/dsh-collaboration](https://github.com/Socialist-Sister/dsh-collaboration)
- [HuanLinOTO/dsh-plugin-yet-another-subagent](https://github.com/HuanLinOTO/dsh-plugin-yet-another-subagent)
- [SGFIfu/the-real-agent-teams-for-dsh](https://github.com/SGFIfu/the-real-agent-teams-for-dsh)
- [whyihaveyou/dsh-suite](https://github.com/whyihaveyou/dsh-suite)

---

*文档由 GitHub 生态调研 + 本地源码分析整理，后续随 ha-orchestrator 迭代持续更新。*
