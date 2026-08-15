# ha-orchestrator 设计参考：从 DSH 优秀插件提取可复用的 UI / 产品设计

> 本文从 GitHub 调研中挑选几个 UI/产品设计做得较好的 DSH 插件，提取它们的设计思路，并映射到 ha-orchestrator 的后续迭代。
> 目的不是“抄”，而是把经过验证的交互模式、视觉语言和架构设计吸收进 ha-orchestrator 的产品化路线。

---

## 1. 参考插件与它们最值得学的地方

| 插件 | 最值得参考的设计 |
| --- | --- |
| **dsh-agent-teams** | 右上角常驻活动面板、角色头像/动作状态、任务依赖泳道、未读角标、会话内团队卡片、历史归档、快照优先 + 1s 轮询 |
| **dsh-subagent-max** | 可拖拽/缩放的实时子代理浮窗、逐 token 流式输出、Subagents 卡片网格、拖出面板、通知 toast |
| **dsh-subagent-monitor** | 侧栏入口 + 右上角卡片面板、子代理状态色 + 呼吸动画 + 耗时、孙代理树形缩进、一键返回主会话、刷新自动恢复 |
| **yet-another-subagent** | 子代理树标签页、工具调用卡片、实时进度（toolcall/token/activity）、Profile 设置编辑器 |
| **dsh-agent-team-gui** | Settings → Teams 全局持久 squad、对话输入框旁 squad 选择器 + 协作开关、每个成员独立 model/tool policy 卡片 |
| **dsh-gatedflow** | 人类审批“门”以卡片形式出现在对话流，模型无法绕过；失败后出现 retry 卡片 |
| **dsh_workflow** | run graph / 事件 / artifact / 状态持久化；命令式 `/workflow runs|show`；证据化交付 |
| **dsh-meta-orchestrator** | 模型“先写计划再执行”，计划作为可持久化记录，避免固定流水线；简单请求明确跳过 |
| **dsh-collaboration** | 专家名册、roundtable 一次性并行面板、team status 实时看板、模型对比并排输出 |

---

## 2. 可直接复用的 UI / UX 设计模式

### 2.1 常驻“活动面板”，而不是只埋在设置页

- **来源**：dsh-agent-teams 右上角 body-portal 浮层；dsh-subagent-monitor 右上角卡片面板；dsh-subagent-max 多浮窗。
- **要点**：
  - 关键运行状态要“永远可见、一眼可读”，而不是让用户进设置页看；
  - 折叠态是一个小胶囊/小浮标，展开后是完整面板；
  - 面板与当前会话绑定，切换会话自动收起，回到团队会话恢复；
  - 新活动出现时自动展开一次，但页面刚加载时不要抢占视线。

**映射到 ha-orchestrator**：
- 当前已有一个最小 `HaStatusCard`（lib/client.js 内，经 `tool.view.cordis` 插槽挂在工具区，单行显示启用/备份数/隔离数/最近切换并 10s 轮询 `stateGet`），本建议是对它“升级为可展开胶囊 + 加入 run 进度”，而不是从零新增一个面板；
- 升级后的形态：显示当前是否启用、是否有隔离模型、是否有 run 在跑；
- 点击展开后展示：熔断/冷却倒计时（隔离表已提供 `remainingMs` 倒计时字段，但尚未做成可展开胶囊）、最近切换历史、最近 orchestrate run 进度；
- 放在对话流右上角或输入框上方，不只在设置页。

### 2.2 快照优先 + 短轮询，状态以磁盘/服务端为真相

- **来源**：dsh-agent-teams 的活动面板通过 `/plugins/dsh-agent-teams/state` 1s 轮询；dsh-subagent-monitor 通过快照路由恢复。
- **要点**：
  - UI 不依赖事件流做唯一真相，而是“服务端快照 + 增量事件补齐”；
  - 刷新页面/重启服务后，面板能自动恢复到最近状态；
  - 对模型可能跳过“状态仪式”的情况，UI 如实展示磁盘真相。

**映射到 ha-orchestrator**：
- 复用现有 `stateGet` RPC 快照（lib/index.js 的 `HaOrchestratorRpc.stateGet` 已实现）即可，不必新增快照接口；
- `stateGet` 已分别在设置页（5s）与状态卡（10s）被轮询，无需再叠加 1–3s 高频轮询，轮询频率按“数据热度/数据量”分级即可（运行中的 run 用短间隔、长期不变的配置用长间隔）；
- 配置已由插件自身持久化（`ha-orchestrator.config.json` + `.backup.json`，多目录降级、30 次/2s 重试加载、`stateGet` 懒加载兜底）；缺的是 **HA/run 运行态**的持久化与增量事件——重启后隔离/冷却/历史不保留。

### 2.3 状态可视化：颜色、进度、未读/当前任务

- **来源**：dsh-agent-teams 的成员块（角色头像 + 状态 + 进度 + 未读角标 + 当前任务）、任务状态徽章；dsh-subagent-monitor 的色点 + 呼吸动画 + 秒表。
- **要点**：
  - 状态不要只靠文字，用“色点/徽章/进度条”降低扫读成本；
  - 每个子代理/子任务显示：当前在做什么、进度、是否失败/完成、是否有未读结果；
  - 动画要克制，并尊重 `prefers-reduced-motion`。

**映射到 ha-orchestrator**：
- HA 卡片：隔离表已实现（每个被隔离的 provider/model 显示错误码 + `remainingMs` 冷却倒计时）；但备用模型行的“健康/正在使用”态与“冷却中”倒计时尚未做成逐行徽章；
- orchestrate run：每个子任务显示 `pending / running / completed / failed` 和耗时（尚未实现）；
- 对话内工具卡片：`orchestrate` 调用后显示 run 进度条 + 子任务清单（尚未实现）。

### 2.4 任务依赖 / 阶段泳道

- **来源**：dsh-agent-teams 根据依赖深度计算 `depth`，把任务分成泳道/阶段，并用 `blocked / open / running / completed` 表达可视状态。
- **要点**：
  - 依赖关系可视化后，用户能立刻看出“卡在哪”；
  - 不需要完整甘特图，简单“阶段列 + 依赖标记”就足够。

**映射到 ha-orchestrator**：
- 如果后续给 orchestrate 增加依赖能力，可复用这套“按 depth 分阶段”的 UI；
- 即使只有 fanout/pipeline/supervisor，也可以在 run 卡片上展示“第 N 阶段 / 并行 N 路”。

### 2.5 角色头像 / 视觉身份

- **来源**：dsh-agent-teams 为队长/成员提供 DeepSeek 小鲸鱼职业插画，并按角色关键词匹配；动作小图随状态切换（working/thinking/reporting/sleeping…）。
- **要点**：
  - 给“智能体/子代理”一个轻量视觉身份，能让用户产生“这是一个团队”的认知；
  - 头像不是必须，但一旦做就要有统一风格、有兜底（首字母头像）；
  - 状态动作图要轻、要能表达“在忙/在想/在等”。

**映射到 ha-orchestrator**：
- 自定义子智能体列表可以增加“角色图标/首字母头像”；
- orchestrate 的子任务卡片可按 agent 显示小图标，但不引入过重资产；
- 如果不想做插画，用 DSH 官方 whale 资产或 CSS 首字母头像也足够。

### 2.6 会话内卡片，而不只是设置页表单

- **来源**：dsh-agent-teams 的 `AgentTeamsCard` 在对话流中展示团队摘要；dsh-subagent-max 的工具调用卡片；dsh-gatedflow 的审批卡片。
- **要点**：
  - 关键动作/状态应该出现在“用户正在看的对话流”里；
  - 卡片支持点击跳转（打开子代理会话、打开面板）、支持按钮（重新激活面板、审批/重试）；
  - 卡片数据可从持久化事件重建，历史会话也能显示。

**映射到 ha-orchestrator**：
- 把 `orchestrate` 工具结果的渲染从当前“纯文本 summary + 子任务清单”（lib/index.js 的 `renderRunOutput` 只拼文本行）升级为真正的会话内 Run 卡片（结构化、可点击），而不是继续保持文本拼接；
- HA 切换发生时，在对话中追加一条“模型已从 A 切到 B”的可见记录（目前切换记录只写入 `state.history` 并由设置页表格展示，对话内不可见）；
- 失败后显示“重试 / 查看原因”按钮。

### 2.7 人类审批 / 门禁作为 UI 控件

- **来源**：dsh-gatedflow 的 `interrupt` 步骤把审批做成对话内卡片，模型没有 approve/reject 通道，只有人能点。
- **要点**：
  - 高风险操作（批量子代理、高成本 run、执行写操作）应支持“人工确认卡片”；
  - 审批状态要持久化，不能被模型绕过。

**映射到 ha-orchestrator**：
- 当 `orchestrate` 任务数/预估成本超过阈值时，可弹出“确认并行执行 N 个子代理？”卡片；
- HA 切换或持久化默认模型变更时，也可让用户确认或至少可回滚。

### 2.8 实时流式输出与多面板

- **来源**：dsh-subagent-max 的浮窗逐 token 流式展示；dsh-subagent-monitor 的实时秒表。
- **要点**：
  - 用户等待子代理时，能看到“它在读什么、调了什么工具、输出到什么程度”；
  - 多个子代理并行时，支持同时打开多个面板/标签。

**映射到 ha-orchestrator**：
- orchestrate fanout 时，给每个子任务一个可展开的实时日志块；
- 不做复杂多浮窗也可以，先用“树形列表 + 展开详情”达到同等可观察性。

### 2.9 配置 UI 也按“产品”来做

- **来源**：dsh-agent-team-gui 的 Settings → Teams、dsh-llm-fallback 的回退链设置页、yet-another-subagent 的 Profile 编辑器。
- **要点**：
  - provider/model 用下拉选择，而不是手填字符串；
  - 保存后即时生效或明确提示重启；
  - 空状态有引导，不做“空表单让人发呆”；
  - 配置冲突要提示（例如多窗口编辑、patch 覆盖）。

**映射到 ha-orchestrator**：
- provider/model 下拉已实现于“从配置添加”备用流程与“子智能体编辑表单”（lib/client.js 经 `modelsList` RPC 联动模型目录）；缺口在“已有备用模型行”仍是手填 `TextInput`（label/provider/model/reasoningEffort 四列文本框），以及缺少“推荐候选”与对非法 provider/model 的校验；
- 把已有备用模型行从手填文本框改为受控下拉/校验，避免手输非法 provider/model；
- 提供“一键添加当前模型为备用”“推荐候选”按钮；
- orchestrate 的自定义子智能体编辑保留（已支持 AI 生成子智能体 `agentsGenerate`），但接入官方 Settings 体系；
- 增加“导出/导入配置”。

### 2.10 可访问性与响应式

- **来源**：dsh-agent-teams 的 `prefers-reduced-motion`、窄屏 overlay；dsh-subagent-monitor 的移动端友好。
- **要点**：
  - 动画可关闭；颜色不能是唯一信息载体（配文字/图标）；
  - 宽屏并排、窄屏 overlay/抽屉；
  - 键盘可操作，按钮有 focus 态。

**映射到 ha-orchestrator**：
- 所有状态徽章同时带文字；
- Run 面板窄屏降级为折叠卡片；
- 设置表单可用 Tab 导航。

---

## 3. 架构 / 工程上的“优秀设计”参考

UI 好看只是一半，产品化插件还应该吸收这些工程设计：

| 设计 | 参考来源 | 为什么值得学 |
| --- | --- | --- |
| 共享状态物化为 Cordis 服务键 | `plugin-team-board` 的 `ctx.teamBoard` | 避免模块级全局变量，跨插件/跨会话可消费，生命周期清晰 |
| 持久化走官方 storageDomain / settings / session events | `dsh-meta-orchestrator`、`dsh-llm-fallbacks` | 比自建 JSON 更抗升级，重启可恢复，事件可审计 |
| 注册即 effect，卸载自动清理 | `plugin-team-board`、`dsh-agent-teams` | 防止 hot-reload 后僵尸工具/监听器 |
| 纯逻辑与 DSH 解耦 | `dsh_workflow`、`dsh-gatedflow` | 核心状态机可单测，不依赖运行时 |
| 离线冒烟 + 真实装载验证 | `dsh-agent-teams` 的 verify、`dsh_workflow` 的 179 tests | 发布前有可信门禁 |
| bundle patch + npm 一键安装 | 多数成熟插件 | 降低安装门槛，进入官方生态 |
| 事件命名与类型声明 | `dsh-llm-fallbacks`、`dsh-agent-teams` | 可观测、可扩展、可被 UI 消费 |
| 兼容矩阵 + peerDependencies | `dsh-meta-orchestrator`、`dsh-subagent-tools` | DSH 是 rc 阶段，必须显式声明兼容范围 |
| 安全边界：allowlist / sanitize / 最小权限 | `dsh-agent-teams`、`dsh-plugin-product-subagents` | 多用户/局域网场景下可信 |
| 提供诊断命令 | `dsh-llm-fallbacks` 的 `/fallbacks` | 用户和 AI 都能快速排查状态 |

---

## 4. 现状审计基线（2026-08，v0.2.2）

已有一批手写实现，后续建议基于它们增量演进，而不是从零搭建：

- 手写 React client（lib/client.js，lazy-CJS bundle）：经 `settings.section` 插槽注入设置页，另经 `tool.view.cordis` 插槽挂顶部状态卡；
- 设置页五卡片：HA（启用/备用列表/冷却/阈值/故障码/persistSelection/steerOnStop + 隔离表/切换历史/重置）、编排（启用/provider/concurrency/maxAgents）、子智能体（增删改/排序/AI 生成）、调试（默认隐藏，环形日志 + 清空）、系统（语言 mode/上下文注入/字典与回滚状态/显示调试卡开关）；
- 已有 `stateGet` RPC 快照，设置页与状态卡分别以 5s / 10s 轮询拉取；调试日志 2s 轮询；
- 已有上下文注入：`systemPrompt.section('ha-orchestrator:context', order 40)`，支持自定义文本或默认自动编排引导，注入状态（注册与否/最近求值）经 `stateGet` 暴露并实时展示；
- 已有中英双语：`.language/*.json` 严格 JSON 语言包，`auto` 模式跟随 DSH 语言（监听 `settings/updated` 的 `locale` 命名空间），目标语言缺失自动回滚 zh；
- 配置已磁盘持久化（JSON + backup + 重试加载），**HA/run 运行态仍为内存**；
- 尚无 run 状态的持久化与增量事件，重启后编排/HA 运行态不保留；
- 尚无对话内 Run 卡片（`orchestrate` 结果仍是纯文本）；
- 尚无人类审批门禁（无法在对话内对高成本/高并发 orchestrate 做人工确认）。

---

## 5. 给 ha-orchestrator 的 UI 落地建议（优先级排序）

P0 基于现有手写 UI 栈快速落地，Phase 3 再迁移官方 primitives（避免提前引入官方组件层导致的返工，也与产品化路线图的顺序一致）。标注为 v0.2.2 的进度。

1. **P0：orchestrate 工具结果从纯文本升级为对话内 Run 卡片**
   - **进度**：未开始（v0.2.2 仍为纯文本输出）。
   - 显示 runId、模式、每个子任务状态、耗时、输出摘要；
   - 点击子任务展开详情，有失败原因；
   - 这是用户感知最直接的提升。
   - **可验收标准**：orchestrate 调用后，对话流内渲染出 Run 卡片而非纯文本；每个子任务显示运行中/完成/失败等模式化状态与耗时；失败子任务一次点击即可展开查看失败原因；卡片“显示模式”清晰（折叠显示概览、展开显示全量子任务与失败原因）。

2. **P0：HA 状态胶囊 / 面板**
   - **进度**：部分完成——已有单行状态条（`tool.view.cordis` 插槽，显示启用/备份数/隔离数/最近切换，10s 轮询）；可展开面板（冷却倒计时、完整切换历史）尚未实现。
   - 对话右上角或输入框上方显示“HA 启用 / 隔离 N 个 / 最近切换”；
   - 点击展开冷却倒计时和切换历史。
   - **可验收标准**：折叠态单行显示 HA 启用状态 + 隔离模型数 + 最近一次切换；点击一次即可展开为完整面板；展开态显示当前冷却倒计时与最近几次切换历史（from/to/时间）；冷却中的模型有可见倒计时。

3. **P1：设置页迁移到官方 UI 基建**
   - **进度**：部分完成——新增备用模型（“从配置添加”）与子智能体编辑表单已用 provider/model 下拉（`modelsList` RPC 联动）；已有备用模型行仍为手填文本框；无推荐候选/空状态引导；仍是自绘样式。
   - provider/model 下拉联动；
   - 空状态引导 + 推荐备用模型；
   - 中英双语走官方 locale。
   - **可验收标准**：新增备用模型强制通过 provider/model 下拉选择（不允许自由手填非目录值）；已有备用模型行不再依赖手填文本框，改为可校验/可下拉；输入非法 provider/model 会被拒绝并给出明确提示；设置页提供“推荐候选”按钮，可直接把当前模型加入备用列表。

4. **P1：orchestrate Run 历史页**
   - **进度**：未开始。
   - 列出历史 run，点击查看任务/输出/成本；
   - 可重新执行。
   - **可验收标准**：可列出至少最近 N 个历史 run（runId/模式/时间/结果）；点击任一历史 run 能查看其子任务与输出；对已完成 run 可一键重新执行再次触发 orchestrate。

5. **P2：轻量角色头像/状态图标**
   - 自定义子智能体使用首字母头像或 DSH whale 资产；
   - 子任务状态用图标 + 颜色 + 文字三重编码。

6. **P2：人工确认门禁**
   - 高并发/高成本 orchestrate 前可弹审批卡片；
   - HA 切换时可展示“已切换，可回滚”。

---

## 6. 一句话总结

> ha-orchestrator 不需要复制一个完整的 AgentTeams 面板，但应该吸收它的“常驻可观测面板、会话内卡片、状态可视化、快照优先、配置即产品”这套设计语言，把 HA 和编排从“设置页里的配置项”变成“对话过程中看得见、点得动、可恢复的体验”。

---

## 7. 参考源码 / 文档

- [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)：ActivityPanel / AgentTeamsCard / activity-model
- [dsh-subagent-max](https://github.com/aaravarr/dsh-subagent-max)：多浮窗实时查看器
- [dsh-subagent-monitor](https://github.com/Mombrane/dsh-subagent-monitor)：侧栏 + 右上角面板
- [yet-another-subagent](https://github.com/HuanLinOTO/dsh-plugin-yet-another-subagent)：子代理树与 Profile UI
- [dsh-agent-team-gui](https://github.com/toolclub/dsh-agent-team-gui)：Settings Teams 与 squad 选择器
- [dsh-gatedflow](https://github.com/TtTRz/dsh-gatedflow)：人类审批卡片
- [dsh_workflow](https://github.com/icetomoyo/dsh_workflow)：run graph / 持久化 / 命令
- [dsh-meta-orchestrator](https://github.com/jiruidai/dsh-meta-orchestrator)：计划记录型编排
- [dsh-llm-fallbacks](https://github.com/dsh-external/dsh-llm-fallbacks)：诊断命令与设置 UI
