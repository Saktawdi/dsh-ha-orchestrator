# Changelog

All notable changes to this project are documented in this file.

## [0.12.0] - 2026-08-17

产品化视觉升级（UI 全面重构 + 发布前收尾）。视觉对齐 DSH 原生主题（`dsw-alias` 变量 + 局部设计令牌，浅/深色自动适配），并完成路线图 Phase 6 遗留功能项。

### Added — 调研能力（本轮本地开发）
- **子智能体工具裁剪（toolFilter）全链路**：自定义子智能体新增可选 `tools: { allow?, deny? }` 配置，经 `buildSubagentRequest` 清洗后透传给 dsh-subagent 的 `SubagentStartRequest.toolFilter`；`runOne` 在 start 前经 `getProvider().capabilities` 做能力门控，provider 声明不支持时自动剥离并记 debug 日志（避免服务层拒绝导致整个子任务失败）。设置页 agents 表单新增白名单/黑名单编辑行（逗号/空格分隔）并展示宿主可用工具名（`stateGet` 新增 `hostTools`）。
- **结构化调研输出（outputSchema）**：`orchestrate` 的 tasks 条目新增 `outputHint`（输出要求提示，追加到子任务 prompt）与 `outputSchema`（object 根 JSON Schema）；provider 支持时子智能体返回匹配 JSON，并以 `[structured] {json}` 行内嵌到该 run 输出开头——merge 输入、结果渲染、runs.jsonl、md 工件全链路可见；能力门控同 toolFilter。
- **委托深度平台级兜底（maxDepth）**：新配置 `orch.maxDepth`（0=关闭；1=子智能体不能再委托），与既有嵌套编排拒绝形成双保险；能力门控同上。
- **内置调研预设子智能体**：`defaultConfig.orch.agents` 新增 `researcher`（调研执行者：官方源交叉验证、证据带 URL 与取数时间、禁止臆造）与 `research-merger`（汇总者：保留出处、冲突并列、不引入新事实）。
- **调研工件 markdown 落盘**：每个 orchestrate run 结束时生成 `dsh-ha-orchestrator.run-<runId>.md`（子任务完整输出不截断 + lastKey + summary），便于直接阅读/归档；已加入 `.gitignore`。
- **调研拆分引导**：`orch.hintSection` / `orch.toolAutoUse`（中英）追加「多对象调研按对象逐个拆 tasks、子任务要求带来源 URL 证据、合并保留全部出处」。

### Added — 失败重试零浪费（自动续跑 + 部分完成提示）
- **自动续跑（autoResume）**：`orchestrate` 未显式传 `resume` 时，自动查找同一会话最近 30 分钟内、同模式、同任务（id/label/prompt 签名一致且实际执行 agent 一致）且部分完成的 run；命中则复用其已完成子任务、只跑剩余部分，并写 `resumedFrom` 指向原 run。新配置 `orch.autoResume`（默认开启，设置页可关）。解决「4/6 已完成但整体失败，用户重试又把 6 个全量重做」的时间/token 浪费。
- **部分完成错误提示**：当 run 因异常中止但已有部分子任务完成时，抛出的错误信息末尾附带 `[orchestrate runId: ...]` 与 `resume: "runId"` 提示及已完成任务清单，模型重试时可直接显式复用；即使模型忽略，下一次调用也会被自动续跑兜底。
- **失败留痕任务定义修复**：失败 run 现在记录本次实际尝试的任务定义（resume 场景回退到原 run 完整任务定义），不再只读 `args.tasks`——修复 preset 执行失败时 `tasks` 为空、导致后续 resume/自动续跑无法匹配的问题。

### Added — 设置页视觉重构（`lib/client.js`）
- **概览横幅**：页面顶部一眼可读的仪表盘头——HA 启用状态、当前默认模型、备用模型数、编排状态与活动 run 数（复用 `stateGet` + `orchActive` 轻量轮询，无新 RPC）。
- **Run 历史可视化**：诊断卡「最近运行」从静态表格升级为可展开条目——每条 run 显示模式徽章（图标+文字）、runId、状态（完成/部分失败/已中止）、子任务数、耗时与时间；展开后显示子任务表（状态图标/label/agent/status/lastKey）与结果摘要。
- **设计系统**：局部设计令牌（间距/圆角/阴影/等宽字体）集中定义并覆盖设置页与对话内卡片；状态徽章升级为软底色 + 色点（颜色+文字双重编码，色盲友好）；表格斑马纹 + hover；统一空状态组件（图示 + 标题 + 引导动作）。
- **卡片头图标**：内联 SVG 图标集（feather 风格，`currentColor` 随主题变色），五卡片与对话内卡片均有专属图标；卡片头支持键盘展开（Enter/Space）。
- i18n 新增 27 个 key（中英同步），并修复 `sys.exported` 缺失导致的原始 key 露出。

### Changed — 设置页交互
- **备用模型行重构**：从 4 列手填文本框升级为结构化行（序号徽章 + 标签 + provider/model 等宽徽章 + 操作按钮组），行内编辑态提供 provider/model 下拉联动（复用 `modelsList`，带请求序号防过期响应），避免手输非法值；空状态突出「推荐备份」主按钮。
- **编排卡片分组**：基本 / 并发与预算 / 高级三段式，参数补充 hint 说明。
- **子智能体条目**：首字母头像（按名字 hash 取色相）+ 名称 + 模型徽章 + 描述/提示词分层排版，操作按钮 hover 呈现；空状态引导。
- 诊断卡数字段等宽化、冷却剩余格式化（`1m30s`）、HA 状态徽章色系化。
- 调研场景截断上限放大并配置化：`summarizeRuns` body 2000→8000 / total 24000→48000、`renderRunOutput` 3000→8000 / total 30000→60000；新增配置 `orch.mergeBodyLimit / mergeTotalLimit / renderRunLimit / renderTotalLimit`（0=默认，设置页可编辑）。
- 默认并发上调：`orch.concurrency` 3→6、`orch.maxAgents` 8→16（调研类任务并行度瓶颈）。
- 设置页子智能体保存改为「展开原条目再覆盖表单字段」，保留表单未纳管字段（如 `tools`），不再编辑一次就静默丢配置。
- `/orchestrate show` 展示截断放开：run output 500→2000、summary 800→2000。

### Changed — 对话内体验
- **RunCard 升级**：模式图标 + 标题；进度条精修（品牌渐变 + 条纹动画，尊重 `prefers-reduced-motion`）+ 百分比数字；统计徽章带状态图标（✓/✗/时钟），仅在非零时显示错误/运行中徽章。
- **HA 状态卡 → 可展开胶囊**（设计参考 P0 #2）：折叠态单行（状态点 + 启用/备份数/隔离数 + 最近切换目标）；点击展开面板——当前默认模型、隔离冷却**倒计时**（本地 1s tick 递减快照 `remainingMs`，不额外发请求）、最近 3 次切换、活动 run 数与模式；键盘可操作。

### Fixed — 发布前收尾（路线图 Phase 6 遗留项，均配回归测试）
- `agent/error` 停止兜底现在尊重 `cfg.codes` 错误码过滤器：不在用户名单内的错误码不再触发隔离/steer（此前硬编码 MODEL_CODES，过滤失效）。
- `orchRuns()` RPC 合并磁盘历史（与 `/orchestrate runs` 命令共享 `mergedRunRecords()`）：重启后设置页 Run 历史仍可见。
- `haSuggestBackups` 只排除默认 provider+model 而非整个 provider，并过滤已隔离/熔断键：同 provider 其他模型进入推荐候选。
- `orchestrate` 入口新增 `cleanTasks` 防御性清洗（纯函数）：过滤非对象/缺 prompt 的畸形任务——分层防御第三层（平台 schema 第一层、sanitizeConfig 第二层）。

### 工程门禁
- 测试 193 → **204**（新增 cleanTasks 单测 4 例 + 集成 3 例：cfg.codes 尊重 / orchRuns 磁盘合并 / 畸形 tasks 分层防御；更新 haSuggestBackups 语义测试）。
- `npm run typecheck / build / check / verify` 全绿（verify 6/6）。
- README 版本徽章 v0.2.1 → v0.12.0（长期未同步），新增居中 Badge、产品宣传首屏与固定尺寸的设置/运行截图展示；移除旧设置截图，改用 `docs/hero-banner.png`、`docs/settings-gallery.png` 和 `docs/run-states-gallery.png`。

## [0.11.5] - 2026-08-16

### Added
- 对话内 orchestrate 卡片实时进度：新增 `orchActive` RPC 与运行中 run 视图，卡片轮询展示「进行中 / 已完成 / 异常 / 总数」、进度条与每个子任务状态。
- 子代理 lastKey 可观测：`orchestrate` 工具输出与 `presentationMeta` 增加可选 `lastKey` 字段，运行中与完成后卡片都能看到每个子代理实际执行的 HA lastKey（provider/model）。

### Fixed
- 修复 orchestrate 卡片“一直 Deep diving...”/无动态感的问题：运行中不再只依赖 `subCalls` 数量，改为轮询 host 实时 run 视图；即使子代理绿点已全部完成，卡片也会立即反映完成态。
- **修复配置页报错「typert gateway: haOrchestrator/stateGet: business result failed boundary validation」**：网关对 RPC 结果做 JSON 边界校验，结果树中任何 `undefined` 值都会被拒。根因是 `ctxInject.lastEval` 的 `subagent: isSub || undefined`（v0.11.4 引入）在子智能体路径下把 `subagent: undefined` 键带入快照，导致每次 `stateGet` 被网关拒绝、设置页无法加载。修复：① `lastEval` 三处赋值改为条件展开，`subagent` 键仅在为 true 时存在；② `buildState` 隔离条目 `code` 回退空串；③ run 记录 `resumedFrom` 改为条件键；④ `stateGet`/`haStatus`/`orchRuns`/`diagnostics` 返回统一经 `jsonSafe`（JSON 往返）过一道边界，外部服务数据（如 `agentDefaultModel.currentSelection`）或未来字段遗漏都不会再让设置页报错。新增回归测试断言三个配置页 RPC 结果树无 `undefined` 泄漏。

## [0.11.4] - 2026-08-16

### Added
- 上下文注入新增 `ctx.injectSubagents` 开关（默认 `false`）：子智能体默认不再获得插件上下文，避免子代理被自动编排引导反复“层层外包”；开启后子智能体与主智能体行为一致。
- `orchestrate` 增加硬性嵌套防护：子智能体（`session.header.origin === 'subagent'` 或 `delegationDepth > 0`）直接调用 `orchestrate` 会被拒绝，防止绕过 `maxAgents` / `budgetAgents` 等限制。

## [0.11.3] - 2026-08-16

### Changed
- README 安装方式调整（中英同步）：包已发布 npm，方法一改为 **npm 一条命令安装**（`dsh plugin --profile web add dsh-ha-orchestrator`）；原 `file:` 本地安装降为方法二（开发用）；原手动复制为方法三；**删除「让 AI 帮你装」方法**（不再需要把安装提示词发给 AI）。
- npm registry 发布 `dsh-ha-orchestrator@0.11.2`，README 随 0.11.3 同步更新。

## [0.11.2] - 2026-08-16

### Changed
- **包名规范化为 `dsh-ha-orchestrator`**（原 `ha-orchestrator`）：插件名、cordis patch row（id/name）、RPC id 前缀、skill 名、上下文注入 section（`dsh-ha-orchestrator:context`）、`data-plugin` 标识、设置 section id 全部同步；持久化文件名改为 `dsh-ha-orchestrator.config.json` / `.config.backup.json` / `.ha.json` / `.runs.jsonl`。
- **旧文件兼容读取**：启动时新文件名读不到会自动回退读取旧包名（`ha-orchestrator.*`）时代的配置文件/HA 运行态/run 记录，升级不丢配置；新写入一律使用新文件名。
- 安装路径与文档同步：`node_modules/dsh-ha-orchestrator`、`await import('dsh-ha-orchestrator')` 探测、GitHub 仓库地址不变。

### Fixed
- `CONTEXT_WINDOW_EXCEEDED` 不再作为 HA 切备用的触发条件：上下文超长属于上下文长度问题，把同一份全文塞给备用模型只会再次触发压缩/超限。现在未开启 `degradeContextWindow` 时直接放行给平台压缩处理；`agent/error` 停止兜底也不再对 `CONTEXT_WINDOW_EXCEEDED` 隔离/steer 切备用。

## [0.11.1] - 2026-08-15

### Changed
- 随包 Skill 改为“仅用户主动调用”：`modelInvocable: false`，不再自动进入模型/子代理的 skill 目录；保留 `userInvocable: true`，用户可手动调用 `ha-orchestrator` skill 快速使用插件，尤其适合上下文注入在特定 preset 下不生效的场景。`/ha` 与 `/orchestrate` 命令继续保留。
- 仓库文档组织：仅公开归档 6 个文档（architecture / configuration / security / verification / compatibility + settings.png）；内部开发文档（productization-roadmap / design-references / comparison-scoring / awesome-listing-checklist）移入 `docs/local/` 并加入 `.gitignore`，不进入仓库与发布包（`package.json files` 增加 `!docs/local`，verify 新增泄露检查）。
- README/README.zh-CN、docs/architecture.md、Issue 模板中的内部文档引用同步更新。

## [0.11.0] - 2026-08-15

### Added
- Phase 4 随包 Skill 落地：经 `ctx.skills.register` 注册 `ha-orchestrator` 运行时技能（`source: 'bundled'`，模型/用户均可调用，随插件卸载）——双语 markdown 指引正文（使用方式 + 排障：/ha 命令、配置持久化、探测、常见问题），语言切换自动重建；`skills` 服务缺失的部署静默跳过；`/ha diag` 与 `diagnostics` RPC 增加 skills 服务探测。

## [0.10.0] - 2026-08-15

### Added
- Phase 3 对话内 Run 卡片（官方展示投影 + keyed toolview 槽位）：
  - 宿主侧：`orchestrate` 工具结果新增 `runId` 字段；`output.presentationMeta`（runId + 各子任务状态，随会话日志持久化、replay 可还原）、顶层 `presentCall`（pending 标题含模式）、`presentResult`（完成态标题含 runId）；
  - 客户端：经官方 `tool.call.toolview` 槽位注册 `key: 'orchestrate'` 的 RunCard——运行中实时显示子任务数（`subCalls`），完成后显示 runId 标题、状态徽章与输出摘要。

## [0.9.0] - 2026-08-15

### Added
- Phase 2 尾项 + Phase 3 错误体验补充：
  - **子智能体调用预算**：`budgetAgents`（0–128，默认 0 = 不限）对单次编排的全部子智能体调用（含重试/评审/合成）做硬限制，超限即中止并留痕；`poolRun` 新增 `isolate === false` 错误穿透契约（预算类错误不参与任务级隔离）；
  - **supervisor 多评审者**：`reviewers` 数组参数，并行评审（各自 agent、独立 run）后由 supervisor 综合，评审上下文进入最终合成；评审者名经未知名校验；
  - **pipeline 结构化中间产物（轻量）**：carry 增加 `--- 阶段 N: <任务> ---` 标记（`pipelineStageBlock` 纯函数）；
  - **`/ha diag` 命令 + `diagnostics` RPC**：服务可用性（tools/systemPrompt/subagents/llm/fs/timer/settings/agents/agentDefaultModel/sandboxPolicy/commands）、持久化状态、配置/HA 状态加载、语言回滚、注入状态——加载失败时可操作诊断。

## [0.8.0] - 2026-08-15

### Added
- 路线图 Phase 4（发布与生态）文档体系与社区基建落地：
  - 文档体系：`docs/architecture.md`（架构/数据流/服务契约）、`docs/configuration.md`（全部配置项参考）、`docs/security.md`（安全说明）、`docs/verification.md`（测试矩阵/门禁/发布流程）、`docs/compatibility.md`（兼容矩阵）；README/README.zh-CN 增加文档索引与兼容说明，修正过期的「HA 状态仅存内存」描述；
  - 社区基建：`CONTRIBUTING.md`（开发约定/门禁/提交规范）、Issue 模板（bug_report / feature_request / compatibility）；
  - 可访问性：`prefers-reduced-motion` 降级动画、`:focus-visible` 键盘焦点样式；
  - 发布产物验证：`npm pack` 实际产出 tgz（40 文件，~2.6MB）；gh CLI 未安装、npm 未登录，GitHub Release 与 npm publish 待环境就绪后按 `docs/verification.md` 执行。

## [0.7.0] - 2026-08-15

### Added
- 路线图 Phase 3（UI / 产品体验）后端支撑与首批 UI 项落地：
  - **一键导出/导入配置**：RPC `stateExport`（完整配置 JSON）与 `stateImport`（整体替换，缺失节回退默认，落盘/工具重建语义与 stateSet 一致）；设置页「系统」卡片新增导出（含复制）/导入（粘贴并应用）区域；
  - **诊断卡片**：设置页新增「诊断」折叠卡片——HA 熔断/冷却/探测开关概览、隔离清单（含 level 与剩余时间）、失败计数、游标、探测记录、最近运行（runId/mode/tasks/status），10s 轮询；
  - **空状态引导**：未配置备用模型时 HA 卡片显示引导文案（提示使用「推荐备份」）；
  - client TYPERT_REMOTE 描述符补齐（haStatus/haProbeNow/haSuggestBackups/orchRuns/orchListPresets/orchSavePreset/orchDeletePreset/stateExport/stateImport）。

## [0.6.0] - 2026-08-15

### Added
- 路线图 Phase 2 剩余项落地：
  - **全局并发预算**：`orch.globalConcurrency`（0–64，默认 0 = 不限）跨 run 共享信号量，多个编排并发时排队；
  - **supervisor 评审轮次**：`reviewRounds`（1–3）多轮评审，每轮以上一轮输出为上下文；评审 run 计入结果 runs；
  - **新编排模式**：`map-reduce`（并行执行 + 归约任务）、`router`（从候选任务中路由选择一项执行）；
  - **配方（预设）复用**：RPC `orchSavePreset`/`orchListPresets`/`orchDeletePreset` + 工具参数 `preset` 按名执行（调用参数可覆盖），`/orchestrate presets` 查看；
  - **runId 恢复**：工具参数 `resume <runId>`——已完成子任务复用其结果（fanout/supervisor 跳过、pipeline 从失败阶段续跑并继承 carry），结果 runs 按原任务顺序合并，记录带 `resumedFrom`；
  - run 记录补全任务定义（含 prompt），旧记录缺 prompt 时恢复给出明确报错；
  - 设置页新增「全局并发上限」「流水线阶段重试」配置项。

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
