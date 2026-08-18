![HA Orchestrator —— 模型故障恢复与多智能体编排](docs/hero-banner.png)

<p align="center">
  <a href="https://github.com/Saktawdi/dsh-ha-orchestrator/releases"><img src="https://img.shields.io/badge/version-v0.12.2-4d6bfe?style=flat-square" alt="版本" height="20"></a>
  <a href="https://github.com/deepseek-ai/dsh"><img src="https://img.shields.io/badge/platform-DeepSeek%20Harness-4d6bfe?style=flat-square" alt="平台" height="20"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="许可证 MIT" height="20"></a>
  <a href="docs/verification.md"><img src="https://img.shields.io/badge/tests-219%20passing-2ea44f?style=flat-square" alt="测试" height="20"></a>
  <a href="docs/configuration.md"><img src="https://img.shields.io/badge/orchestration%20modes-5-6f42c1?style=flat-square" alt="编排模式" height="20"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin" height="20"></a>
</p>

# HA Orchestrator
HA Orchestrator 是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）的插件：

- 模型调用中途出错时，自动改用备用模型重试，任务继续跑下去。
- 提供一个 `orchestrate` 工具，模型遇到适合的任务会自己调用它，把工作拆给多个子智能体并行执行（`fanout`）、分阶段执行（`pipeline`），或进行评审/归约（`supervisor`、`map-reduce`、`router`）。

配置页里还能定义自己的子智能体（也可以一句话让 AI 生成）；界面和提示词文案支持中英文，跟随 DSH 语言。

[English](README.en.md)

> **扛住模型故障，并行推进复杂工作，把结果交付得更可靠。**
>
> HA Orchestrator 让 DSH 长任务在模型出错时继续运行，再把复杂工作拆成可观测、可恢复、可评审的并行子智能体流程。

| 🛡️ **模型故障不终止长任务** | ⚡ **复杂工作横向并行** | ✅ **结果可检查、可交付** |
| :-- | :-- | :-- |
| 备用轮换、冷却、Provider 熔断和恢复探测，避免单个模型故障拖垮任务。 | 五种编排模式覆盖并行调研、分阶段计划、路由、归约和监督评审。 | 预算、运行历史、resume、结构化输出和多评审者，让最终结果更可追踪。 |

**特别适合：** 深度调研、大型代码库阅读、批量审查、多方案对比和实现计划编排。

## 功能

### 模型失败自动回退

- 模型请求出错时，自动改用下一个备用模型重试，备用模型按顺序轮换。
- 出错的模型被暂时跳过（进入冷却），冷却结束后自动恢复使用。
- 支持突发窗口失败计数、Provider 级熔断、低成本恢复探测，以及可选的上下文超长降级。
- 每次故障有重试上限，用尽后停止重试，不会无限循环。
- 模型错误中断任务时，插件会把任务重新拉起一次，工作不丢失。

备用模型、冷却时间、失败阈值、错误码过滤都可以在 设置 →「HA 与编排」里调整。

### 编排工具（自动触发）

`orchestrate` 工具在所有会话中可用；工具说明和系统提示词里的引导会让模型在任务可并行、分阶段或需要评审时自己调用：

- `fanout` — 拆成子任务并行执行，再汇总结果。
- `pipeline` — 各阶段依次执行，上一阶段的输出作为下一阶段的输入。
- `supervisor` — 并行执行子任务后，由监督子智能体审查合并。
- `map-reduce` — 并行执行 map 任务，再由归约子智能体合并结果。
- `router` — 把候选任务交给一个路由子智能体，由它选择或安排后续工作。

工具还支持保存配方、按 runId 恢复中断任务、监督评审轮次、多评审者、单次子智能体调用预算、结构化输出 Schema，以及自定义子智能体的工具白名单/黑名单。子智能体默认不能再次发起嵌套编排。

如果某次没有自动编排，直接说"用编排"即可。

> 注意：如果当前会话使用 `minimal` / `minimal-v3` 这类 `complete: true` 人设预设，平台会按设计丢弃插件注入的系统提示词段落；此时自动触发仅靠 `orchestrate` 工具描述承载。插件已把“阅读大型项目”等触发条件写进工具描述，但若仍不触发，请直接说“用编排”。

不想让模型自动调用的话，可以在 设置 →「HA 与编排」→「系统」卡片里关掉**上下文注入**；之后在提示词里写"使用 dsh-ha-orchestrator 插件进行调用"即可手动触发。

子智能体默认**不会**获得这段上下文注入，避免子代理被引导再次发起编排形成层层外包；如需让子智能体也看到同一段上下文，可在「系统」卡片打开**同时注入子智能体**。

### 自定义子智能体

在配置页定义可复用的子智能体：名称、provider/模型、模型 `effort`、描述、系统提示词，以及可选的工具白名单/黑名单。每个角色还可以单独配置按顺序执行的 `fallbacks` 模型链，并为每个回退项写 `provider/model@effort`；启动失败或子智能体返回模型错误时，只切换该角色自己的回退链，不读取全局 HA 备用模型。任务按名称调用，模型随时可以查询清单；单个任务还可以指定输出要求或 object 根 JSON Schema（前提是 provider 支持）。「智能新增」按钮：一句话描述需求，由当前模型生成完整定义。

### 中英双语

配置界面和提示词文案支持中文、英文，自动跟随 DSH 语言设置；语言包加载失败时回退中文。也可以在「系统」卡片手动固定语言。

## 安装

需要：[DeepSeek Harness](https://github.com/deepseek-ai/dsh)（web profile）。发布包无需本地构建，运行时 peer 服务由 DSH 提供。

### 方法一：npm 一条命令安装（推荐）

本包已发布到 npm（包名 `dsh-ha-orchestrator`）：

1. 执行一条命令：

   ```sh
   dsh plugin --profile web add dsh-ha-orchestrator
   ```

2. 因为本包声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动把 **dsh-ha-orchestrator** 加进 `dsh.profile.bundles` 并应用 `cordis.patch.yml`，无需手写组合行。
3. 无需重启：bundle patch 层会被热加载（Cordis HMR），插件在运行中的进程里直接生效。刷新浏览器页面即可看到配置页。插件同样随进程启动自动加载，重启后依然生效。

### 方法二：本地仓库安装（开发用）

用于开发或测试未发布版本。需要 PATH 里有 pnpm：

1. 执行一条命令：

   ```sh
   dsh plugin --profile web add "file:<本仓库绝对路径>"
   ```

2. 因为本包声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动把 **dsh-ha-orchestrator** 加进 `dsh.profile.bundles` 并应用 `cordis.patch.yml`，无需手写组合行。
3. 无需重启：bundle patch 层会被热加载（Cordis HMR），插件在运行中的进程里直接生效。刷新浏览器页面即可看到配置页。插件同样随进程启动自动加载，重启后依然生效。

### 方法三：手动安装（无需 pnpm）

1. 把本仓库复制到 DSH profile 的 node_modules 下：`~/.dsh/profiles/web/node_modules/dsh-ha-orchestrator`
2. 在组合文件 `~/.dsh/profiles/web/cordis.patch.yml` 中加入：

   ```yaml
   - insert:
       - id: dsh-ha-orchestrator
         name: dsh-ha-orchestrator
   ```

3. 无需重启：profile 的 patch 层会被热加载（Cordis HMR），插件在运行中的进程里直接生效。刷新浏览器页面即可看到配置页。插件同样随进程启动自动加载，重启后依然生效。

> **版本说明：** [v0.1.0](https://github.com/Saktawdi/dsh-ha-orchestrator/releases/tag/v0.1.0) 是上一代动态版（经 `cordis_define` 按会话加载），仅作功能预览；从 v0.2.0 起为静态插件，随 DSH 启动自动加载。从引入 bundle patch 的版本起，推荐使用方法一（一条命令安装）安装。

## 用法

日常使用无需特殊指令，模型自己决定何时编排：

```
你:    帮我调研这三个开源项目，比较许可证和社区活跃度，给出选型建议。
模型:  识别出 3 个独立子任务 → 自动调用 orchestrate（fanout）→ 并行调研 → 汇总对比 → 给出建议

你:    阅读下这个大型项目，梳理整体架构和当前进度。
模型:  按模块/文档/代码拆成多个独立阅读子任务 → 自动调用 orchestrate（fanout）→ 并行阅读 → 汇总架构与进度

你:    先做需求分析，再写设计文档，最后写实现计划。
模型:  自动调用 orchestrate（pipeline）→ 每阶段输出自动成为下一阶段输入

你:    生成一份竞品分析报告，找个资深评审把关。
模型:  自动调用 orchestrate（supervisor）→ 并行分析 → 评审合并 → 输出报告
```

## 展示

<p align="center">
  <img src="docs/settings-gallery.png" alt="HA Orchestrator 设置展示：模型高可用、子智能体编排、自定义子智能体与编辑页" width="1000">
</p>

<p align="center">
  <img src="docs/run-states-gallery.png" alt="HA Orchestrator 已完成运行与预算耗尽异常状态" width="1000">
</p>

> 注：上述展示来源版本：v0.12.x

### 已注册命令

插件还会注册两个可选的斜杠命令，用于查看和管理运行状态/记录：

| 命令 | 说明 |
| :-- | :-- |
| `/ha` | 查看当前 HA 状态（等同 `/ha status`）。 |
| `/ha status` | 查看隔离、失败计数、轮换游标、切换历史与探测记录。 |
| `/ha diag` | 查看插件诊断：服务可用性、持久化、语言、注入状态。 |
| `/ha reset` | 清空隔离、失败计数、游标与历史。 |
| `/ha probe <provider> <model>` | 手动探测指定模型，验证恢复。 |
| `/orchestrate` | 列出最近编排运行（等同 `/orchestrate runs`）。 |
| `/orchestrate runs` | 列出最近 24 次编排运行（每条附一行结果摘要）。 |
| `/orchestrate show <runId>` | 查看某次编排运行的详情。 |
| `/orchestrate presets` | 列出已配置的编排配方。 |
| `/ha-orch-resume <runId>` | 按 runId 恢复未完成的编排运行：复用历史已完成子任务，只跑剩余部分。 |

> 这些命令通过 DSH 的 `commands` 服务注册。如果部署环境没有该服务，插件仍可正常使用，只是这些斜杠命令不可用。

如果宿主提供 `skills` 服务，插件还会注册一个可由用户主动调用的随包 `dsh-ha-orchestrator` skill，内容是使用与排障指南；它不会进入模型自动可调用的 skill 目录。

### 配置页

设置 →「HA 与编排」：

页面顶部有一张**概览横幅**，一眼可见 HA 启用状态、当前默认模型、备用模型数、编排状态与活动运行数。

| 卡片 | 作用 |
| :-- | :-- |
| 模型高可用 | 开关、备用模型列表（结构化行 + 行内编辑下拉；含「推荐备份」与空状态引导）、「高级设置」：冷却时间、失败阈值、突发窗口、Provider 熔断阈值、探测恢复、上下文超长降级、错误码过滤、持久化选择、停止后引导 |
| 子智能体编排 | 开关、子智能体提供方、默认并发数（6）、单次任务子智能体上限（16）、全局并发上限、流水线阶段重试、合并/渲染截断、委托深度上限、子智能体输出 token 上限（按「基本 / 并发与预算 / 高级」分组） |
| 自定义子智能体 | 增删改、排序（首字母头像 + 模型/effort 徽章）；内置 reviewer/researcher/research-merger；「智能新增」用 AI 生成；支持工具白名单/黑名单、每角色输出 token 上限与独立回退链 |
| 诊断 | HA 运行态（当前默认模型、隔离含层级与冷却倒计时、失败计数、游标、探测、切换历史、清除隔离与历史）与**可展开的最近运行**（模式徽章、耗时、子任务状态表、lastKey 与结果摘要；重启后仍可见历史） |
| 系统 | 插件语言（跟随系统 / 中文 / English）、编排引导开关、注入状态、一键导出/导入配置、调试卡片开关 |

对话过程中还有两处可见状态：

- **orchestrate 运行卡片**（对话流内）：实时进度条 + 百分比、子任务状态点、每个子代理实际使用的模型（lastKey）；完成后显示 runId 与输出摘要。
- **HA 状态胶囊**（工具区）：折叠为单行（启用 / 备份数 / 隔离数 / 最近切换），点击展开冷却倒计时、最近切换记录与活动运行。

## 文档

- [架构](docs/architecture.md) —— 模块职责、数据流、服务契约
- [配置参考](docs/configuration.md) —— 全部配置项与默认值/钳制规则
- [安全说明](docs/security.md) —— 信任边界与已落地防护
- [验证与发布](docs/verification.md) —— 测试矩阵、门禁、发布步骤
- [兼容矩阵](docs/compatibility.md) —— 已验证 DSH 快照与 peer 策略

## 注意事项

- 配置和 HA 状态按「会话 workspace / `DSH_HOME` → 沙箱 `workspace-write` 可写根」查找；没有候选目录时，配置写入会在诊断里报告失败。运行记录和 Markdown 工件在没有候选目录时还会尝试写入 fs 服务默认 cwd。
- HA 运行态（隔离、失败计数、轮换游标、切换历史）以 500ms 防抖持久化到 `dsh-ha-orchestrator.ha.json`，重启自动恢复；编排运行记录写入 `dsh-ha-orchestrator.runs.jsonl`（磁盘最多 200 条、内存最多 50 条），并额外生成 `dsh-ha-orchestrator.run-<runId>.md`，包含完整子任务输出。
- 运行记录和工件可能包含任务 prompt 与模型输出，请确保 workspace 只对可信用户/进程可读。
- `/ha` 与 `/orchestrate` 的所有斜杠命令见上方「已注册命令」。

## License

MIT © [Saktawdi](https://github.com/Saktawdi)
