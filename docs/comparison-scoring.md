# DSH 同类插件综合评分表（含 ha-orchestrator）

> 评分时间：2026-08（基于公开 GitHub / npm 仓库快照与 README/源码调研；本插件按 v0.2.2 / 2026-08-15 代码快照评分）
> 评分口径：1–5 分，5 = 同类最佳 / 接近生产级，1 = 雏形 / 严重缺失。
> 说明：这是“相对 DSH 插件生态”的横向评估，不是绝对质量认证；未逐项真机长期运行验证。
> 综合分 = 7 项算术平均（四舍五入到 0.1）。

---

## 评分维度

| 维度 | 考察内容 |
| --- | --- |
| 功能深度 | 在自身定位内的功能完整度、深度、场景覆盖 |
| HA / 容错 | 模型故障恢复、任务失败恢复、状态持久化、防失控 |
| UI / 可观测 | 设置页、实时面板、会话内卡片、状态可视化 |
| 工程化 | 代码组织、类型、模块化、生命周期、安全边界 |
| 测试 / CI | 自动化测试、离线验证、CI 覆盖 |
| 安装 / 分发 | npm / bundle / 一键安装 / 兼容管理 |
| 文档 / 生态 | README、docs、社区、发布流程 |

---

## 综合评分表

| 插件 | 功能深度 | HA/容错 | UI/可观测 | 工程化 | 测试/CI | 安装/分发 | 文档/生态 | 综合 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **ha-orchestrator（本插件）** | **3.5** | **4.0** | **3.0** | **3.0** | **3.0** | **2.5** | **3.0** | **3.1** |
| dsh-agent-teams | 4.5 | 2.5 | 4.5 | 4.0 | 4.0 | 4.5 | 4.5 | 4.1 |
| dsh_workflow | 4.5 | 3.5 | 3.5 | 4.5 | 5.0 | 4.0 | 4.0 | 4.1 |
| dsh-llm-fallbacks | 4.0 | 4.5 | 3.5 | 4.0 | 3.5 | 4.5 | 4.5 | 4.1 |
| dsh-meta-orchestrator | 4.0 | 3.0 | 3.0 | 4.0 | 4.0 | 4.5 | 4.5 | 3.9 |
| dsh-gatedflow | 4.0 | 4.0 | 3.5 | 4.5 | 4.0 | 3.5 | 4.0 | 3.9 |
| dsh-agent-team-gui | 4.0 | 3.0 | 4.0 | 4.0 | 3.0 | 4.0 | 4.0 | 3.7 |
| yet-another-subagent | 3.5 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.5 | 3.7 |
| the-real-agent-teams-for-dsh | 4.5 | 3.5 | 3.5 | 4.0 | 4.0 | 3.0 | 3.5 | 3.7 |
| dsh-llm-fallback | 3.5 | 4.0 | 4.0 | 3.5 | 2.5 | 4.0 | 4.0 | 3.6 |
| dsh-model-failover | 3.5 | 4.5 | 3.0 | 3.5 | 2.5 | 4.0 | 4.0 | 3.6 |
| allinluna | 4.5 | 3.5 | 3.5 | 3.5 | 2.5 | 3.5 | 3.5 | 3.5 |
| dsh-plugin-subagent-director | 3.5 | 3.0 | 3.5 | 3.5 | 3.5 | 4.0 | 3.5 | 3.5 |
| dsh-subagent-tools | 3.5 | 2.5 | 2.5 | 4.0 | 3.0 | 4.0 | 4.0 | 3.4 |
| dsh-subagent-max | 3.5 | 2.5 | 4.5 | 3.0 | 2.0 | 4.0 | 3.5 | 3.3 |
| dsh-deep-research | 4.0 | 3.0 | 2.5 | 3.5 | 2.5 | 3.5 | 3.5 | 3.2 |
| dsh-collaboration | 3.5 | 2.5 | 3.5 | 3.5 | 3.0 | 3.0 | 3.5 | 3.2 |
| dsh-captain | 3.5 | 3.0 | 3.5 | 3.5 | 2.5 | 3.0 | 3.0 | 3.1 |
| dsh-orchestrator | 3.5 | 2.5 | 3.0 | 3.0 | 2.0 | 3.5 | 3.0 | 2.9 |
| plugin-team-board | 2.5 | 2.5 | 2.5 | 3.5 | 3.0 | 3.5 | 3.0 | 2.9 |

---

## ha-orchestrator 单项点评（v0.2.2）

| 维度 | 得分 | 理由 |
| --- | --- | --- |
| 功能深度 | 3.5 | HA 回退 + orchestrate 三模式（fanout/pipeline/supervisor）+ 自定义子智能体 + 双语 UI + 上下文注入（自动编排引导 / 自定义文本）+ `list-subagents` 按需查询 + AI 生成子智能体（`agentsGenerate`）；仍无 run 持久化 / 任务依赖 / 团队协作 |
| HA / 容错 | 4.0 | 阈值、冷却、错误码过滤、per-agent 备用轮换游标、重试预算 + 指数退避、`agent/error` 后隔离 + 延迟 steer 续跑、`persistSelection` 落盘默认模型、隔离表 / 切换历史经 UI 可见、`haReset`；缺探测恢复、平台级熔断、HA 运行态持久化（重启丢失） |
| UI / 可观测 | 3.0 | 设置页五卡片（HA / 编排 / 子智能体 / 调试 / 系统）+ 顶部状态点（`tool.view.cordis` 插槽）+ 上下文注入状态徽章 + 调试控制台（RPC 拉取环形日志）；仍无对话内 Run 卡片、无诊断命令 |
| 工程化 | 3.0 | 纯 JS 七模块，其中五个（config / ha-core / orch-runner / language / remote）无 DSH 依赖、可独立单测，index / client 为装配胶水；Remote marker 装配与官方编译产物同形（lib/remote.js）；无 TypeScript、无共享服务键 |
| 测试 / CI | 3.0 | 114 个纯逻辑单测（config 20 / ha-core 19 / orch-runner 41 / language 24 / remote 10，node:test）+ `scripts/verify.mjs` 离线冒烟 + GitHub Actions（Linux/Windows，Node 22，check/test/verify）；DSH 事件流与真实 subagent 集成/e2e 仍无 |
| 安装 / 分发 | 2.5 | 已声明 `dsh.bundle.patch` + `cordis.patch.yml`，`dsh plugin add "file:<repo>"` 自动入 profile bundles；但未发布 npm，无兼容矩阵 |
| 文档 / 生态 | 3.0 | 中英 README + 3 篇调研文档（评分 / 设计参考 / 路线图）；尚无升级指南 / 安全说明 / 发布流程 |

---

## 主要竞品亮点备注

- **dsh-agent-teams**：UI/可观测和产品化最好，是 ha-orchestrator 在“面板/会话卡片”上最该学的对象；但 HA/容错弱。
- **dsh_workflow**：工程化和测试最强，是“编排持久化/恢复/治理”的标杆；但更重，不是轻量工具。
- **dsh-llm-fallbacks**：HA 方向最成熟，支持角色链、冷却回切、事件与诊断命令，是 ha-orchestrator 在 HA 上最直接的竞品。
- **dsh-meta-orchestrator**：产品设计聪明——只记录计划不造运行时，简单请求不编排，值得借鉴“轻量”的产品取舍。
- **dsh-gatedflow**：人类审批做成 UI 控件，模型不可绕过，是“可靠工作流”的重要设计参考。
- **dsh-subagent-max / dsh-subagent-monitor**：实时子代理可视化的优秀 UI 参考。

---

## 客观性说明

1. 评分主要依据各仓库 README、源码结构、测试声明、npm 发布状态等公开信息。
2. 部分插件没有公开测试数量或 CI 状态，按“未见证据 = 保守低分”处理，避免高估。
3. ha-orchestrator 的 HA 能力得分较高；工程化与测试维度已随 v0.2.2 补齐（纯模块 + 114 单测 + CI），当前主要短板是分发（未发 npm）与产品化（run 持久化、对话内卡片、团队协作），综合分反映“功能有亮点、产品化仍在路上”的现状。
4. 综合分是等权平均，未按业务场景加权；如果只看“轻量 HA + 编排”，ha-orchestrator 的相对价值会高于这个综合分。
