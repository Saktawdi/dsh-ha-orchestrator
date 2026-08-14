![HA Orchestrator 配置页](docs/settings.png)

# HA Orchestrator

[![Version](https://img.shields.io/badge/version-v0.2.0-4d6bfe?style=flat-square)](https://github.com/Saktawdi/ha-orchestrator/releases/tag/v0.2.0)
[![Platform](https://img.shields.io/badge/platform-DeepSeek%20Harness-4d6bfe?style=flat-square)](https://github.com/deepseek-ai/dsh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

HA Orchestrator 是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）的插件：

- 模型调用中途出错时，自动改用备用模型重试，任务继续跑下去。
- 提供一个 `orchestrate` 工具，模型遇到适合的任务会自己调用它，把工作拆给多个子智能体并行执行（`fanout`）、分阶段执行（`pipeline`），或加一道评审（`supervisor`）。

配置页里还能定义自己的子智能体（也可以一句话让 AI 生成）；界面和提示词文案支持中英文，跟随 DSH 语言。

[English](README.md)

## 功能

### 模型失败自动回退

- 模型请求出错时，自动改用下一个备用模型重试，备用模型按顺序轮换。
- 出错的模型被暂时跳过（进入冷却），冷却结束后自动恢复使用。
- 每次故障有重试上限，用尽后停止重试，不会无限循环。
- 模型错误中断任务时，插件会把任务重新拉起一次，工作不丢失。

备用模型、冷却时间、失败阈值、错误码过滤都可以在 设置 →「HA 与编排」里调整。

### 编排工具（自动触发）

`orchestrate` 工具在所有会话中可用；工具说明和系统提示词里的引导会让模型在任务可并行、分阶段或需要评审时自己调用：

- `fanout` — 拆成子任务并行执行，再汇总结果。
- `pipeline` — 各阶段依次执行，上一阶段的输出作为下一阶段的输入。
- `supervisor` — 并行执行子任务后，由监督子智能体审查合并。

如果某次没有自动编排，直接说"用编排"即可。

不想让模型自动调用的话，可以在 设置 →「HA 与编排」→「系统」卡片里关掉**上下文注入**；之后在提示词里写"使用 ha-orchestrator 插件进行调用"即可手动触发。

### 自定义子智能体

在配置页定义可复用的子智能体：名称、provider/模型、描述、系统提示词，任务按名称调用，模型随时可以查询清单。「智能新增」按钮：一句话描述需求，由当前模型生成完整定义。

### 中英双语

配置界面和提示词文案支持中文、英文，自动跟随 DSH 语言设置；语言包加载失败时回退中文。也可以在「系统」卡片手动固定语言。

## 安装

需要：[DeepSeek Harness](https://github.com/deepseek-ai/dsh)（web profile）。无构建步骤，无运行时依赖。

### 方法一：手动安装

1. 把本仓库放到 DSH profile 的 node_modules 下：`~/.dsh/profiles/web/node_modules/ha-orchestrator`
2. 在组合文件 `~/.dsh/profiles/web/cordis.patch.yml` 中加入：

   ```yaml
   - insert:
       - id: ha-orchestrator
         name: ha-orchestrator
   ```

3. 重启 DSH web 进程。插件随进程启动自动加载，重启后依然生效。

### 方法二：让 AI 帮你装

1. 在 DSH 里切换到**创造模式**。
2. 把仓库链接发给你的 AI：`https://github.com/Saktawdi/ha-orchestrator`
3. 让它帮你安装插件；安装完成后重启 DSH web 进程生效。

> **版本说明：** [v0.1.0](https://github.com/Saktawdi/ha-orchestrator/releases/tag/v0.1.0) 是上一代动态版（经 `cordis_define` 按会话加载），仅作功能预览；从 v0.2.0 起为静态插件，随 DSH 启动自动加载，本 README 描述的是 v0.2.0 及之后的版本。

## 用法

无需特殊指令，模型自己决定何时编排：

```
你:    帮我调研这三个开源项目，比较许可证和社区活跃度，给出选型建议。
模型:  识别出 3 个独立子任务 → 自动调用 orchestrate（fanout）→ 并行调研 → 汇总对比 → 给出建议

你:    先做需求分析，再写设计文档，最后写实现计划。
模型:  自动调用 orchestrate（pipeline）→ 每阶段输出自动成为下一阶段输入

你:    生成一份竞品分析报告，找个资深评审把关。
模型:  自动调用 orchestrate（supervisor）→ 并行分析 → 评审合并 → 输出报告
```

### 配置页

设置 →「HA 与编排」：

| 卡片 | 作用 |
| :-- | :-- |
| 模型高可用 | 开关、备用模型列表、冷却时间、失败阈值、错误码过滤、隔离模型与切换历史 |
| 子智能体编排 | 开关、子智能体提供方、默认并发数、单次任务子智能体上限 |
| 自定义子智能体 | 增删改、排序；「智能新增」用 AI 生成 |
| 系统 | 插件语言（跟随系统 / 中文 / English）、编排引导开关、调试卡片开关 |

## 注意事项

- 配置保存在插件目录的 `ha-orchestrator.config.json`（另存一份备份），启动时恢复，改动时自动写回。
- 隔离中的模型、计数和切换历史保存在内存里，插件更新或进程重启后重置。

## License

MIT © [Saktawdi](https://github.com/Saktawdi)
