# 贡献指南（CONTRIBUTING）

欢迎为 **dsh-ha-orchestrator** 贡献代码、文档与反馈！本插件面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH），提供「模型高可用故障切换 + 子智能体编排」。我们希望协作是低摩擦的：这份指南用中文书写（技术术语保留英文），说明项目结构、开发环境、代码约定、提交门禁与发布流程。

> 遇到问题、有想法？请先阅读 [报告问题 / 提功能](#8-如何报告-bug--提-feature)。直接改动前，建议先提一个 Issue 或 PR 草稿对齐方向。

---

## 1. 项目简介与架构速览

dsh-ha-orchestrator 是一个 **静态 Cordis 插件**，随 DSH 进程启动自动加载，遵循 **mount-only / bundle-only** 原则（不 patch DSH 核心文件，只经公开 `ctx` 服务与稳定事件接缝接入）：

- **HA（High Availability）**：模型调用失败时按备用链切换、熔断、冷却、重试预算与失败续跑（steer）；
- **编排（Orchestration）**：提供 `orchestrate` 工具（fanout / pipeline / supervisor，以及 map-reduce / router），模型在适合时自动把任务拆给并行子智能体执行；
- **配置 UI**：中英双语设置页，可定义/用 AI 生成自定义子智能体、导出/导入配置。

完整架构、模块职责、三条数据流（HA 事件流 / 编排执行流 / 三套持久化）与服务契约，详见 [`docs/architecture.md`](docs/architecture.md)。

**目录结构速览**（源码视图）：

```text
dsh-ha-orchestrator/
├── package.json          # 元数据 + dsh.bundle.patch + dsh.client.inject + peerDependencies
├── cordis.patch.yml      # bundle patch：一行 insert（row id = dsh-ha-orchestrator）
├── src/                  # TypeScript strict 源码
│   ├── index.ts          # 插件入口（唯一持 ctx 的装配层）
│   ├── config.ts         # 配置 schema / sanitize（纯模块，无 DSH 依赖）
│   ├── ha-core.ts        # HA 状态机纯函数（无 DSH 依赖）
│   ├── orch-runner.ts    # 编排纯逻辑（无 DSH 依赖）
│   ├── language.ts       # 语言包解析 / 回滚 / 插值（纯模块）
│   ├── remote.ts         # Remote decorator 官方同形装配（纯 ESM）
│   └── types.ts          # 服务契约 + getService
├── lib/                  # tsc 构建产物（含 .d.ts，随提交）＋手写 client bundle
├── .language/            # 语言包 zh.json / en.json（严格 JSON）
├── tests/                # node:test 单测 + tests/integration/ 集成测试
├── scripts/verify.mjs    # 离线冒烟（发布前门禁）
└── docs/                 # 文档体系
```

---

## 2. 开发环境

- **Node.js ≥ 20.19**（`package.json` 的 `engines.node` 要求；CI 在 Node 22 上跑，本地请用 ≥20.19）。
- 无运行时第三方依赖（peerDependencies 指向 DSH rc 线，由宿主 DSH 提供）。
- 包管理器用 **npm**（与 CI / `prepublishOnly` 保持一致）。

安装与开发：

```sh
# 1. 安装依赖
npm install

# 2. 源码 -> 构建产物（默认产 lib/，含 .d.ts）
npm run build

# 3. 开发模式：监听 src/ 变化自动增量构建到 lib/
npm run dev

# 4.（可选）类型检查
npm run typecheck
```

> 安装到本机 DSH 实测：`dsh plugin --profile web add "file:<本仓库绝对路径>"`，插件经 bundle-patch 热加载，刷新浏览器页面即可加载设置 UI。详见 `README.md`。

---

## 3. 代码约定

- **`src/` 为 TypeScript strict**：开启 `strict` / `NodeNext` / `declaration`。改动需通过 `npm run typecheck`。
- **纯逻辑模块不含 DSH 依赖**：`config.ts` / `ha-core.ts` / `orch-runner.ts` / `language.ts` / `remote.ts` 是无 `ctx` 的纯模块，可独立单测。持 `ctx` 的接线只应出现在 `src/index.ts`；`types.ts` 只定义接口与 `getService()` 取用服务（rc 阶段类型易变，优先最小结构接口而非直接依赖 `dsh-*` 类型）。
- **行为改动必须配测试**：逻辑改动在 `tests/*.test.js`（node:test）补单测；涉及装配 / 事件流 / 编排执行 / 持久化的改动建议在 `tests/integration/host.test.js` 用最小假 ctx 驱动真实插件补集成测试。运行 `npm test`。
- **语言包 zh/en 键严格对等**：`.language/zh.json` 为基准，`en.json` 必须包含完全相同的键集（`language.ts` 用严格 JSON 解析，缺失键回滚到中文；请勿引入仅单边存在的键）。
- **构建产物 `lib/` 随提交**：`lib/` 是 tsc 构建产物（含 `.d.ts`）＋手写 `lib/client.js`（lazy-CJS bundle）。请运行 `npm run build` 后把更新后的 `lib/` 一并提交——发布与 CI 直接消费 `lib/`，仓库内不重建。
- **不 patch DSH 核心**：只用公开 `ctx.tools` / `ctx.systemPrompt` / `ctx.subagents` / `ctx.llm` / `agent/*` 事件等稳定接缝；坚持 mount-only / bundle-only。
- 提交只做一件事，保持 diff 小；改动描述聚焦「为什么」。

---

## 4. 提交门禁（Gate）

合并/提交前必须全绿：

```sh
npm run typecheck   # tsc --noEmit
npm run build       # src -> lib（并提交更新后的 lib/）
npm run check       # node --check lib/client.js（客户端 bundle 语法）
npm test            # 单测 + 集成测试
npm run verify      # scripts/verify.mjs 离线冒烟（包字段 / patch / 语言包 / 产物完整性 / 纯模块 / pack dry-run）
```

`npm run prepublishOnly` 会按 **typecheck → build → check → test → verify** 全链路执行，与 CI（`.github/workflows/ci.yml`，Linux + Windows / Node 22）门禁一致。**发布与 PR 都以此为准。**

> CI 提示：若改动涉及新增外部竞品/兼容矩阵，请同步更新 `docs/` 相应文档（发布相关见下一节）。

---

## 5. 提交信息风格

使用 [conventional commit](https://www.conventionalcommits.org/) 约定，**前缀 + 中文描述**：

```text
feat: 新增 map-reduce 编排模式
fix: 修正 provider 级熔断在通配键场景不触发的问题
docs: 补充兼容矩阵验证记录
chore: 升级 peerDependencies 至 rc.6 类型线
```

- 前缀仅用 **`feat:` / `fix:` / `docs:` / `chore:`**（必要时可加作用域，如 `feat(orch):`）。
- 描述用中文，简洁陈述「做了什么 / 为谁修了什么」；破坏性变更请以 `!` 标注（如 `feat!: …`）并在 PR 描述里写明升级影响。
- 体型较大或跨模块的改动，请拆成多个语义化提交，别把无关改动塞进一条。
- 有对应 Issue 时在 PR 或提交里引用（如 `Closes #12`）。

---

## 6. 测试

- **单测**：`tests/*.test.js`（`config` / `ha-core` / `orch-runner` / `language` / `remote` 纯逻辑，node:test）。
- **集成测试**：`tests/integration/host.test.js`——用最小假 ctx（cordis waterfall / emit / reflect 语义）驱动真实插件构建产物，覆盖装配、上下文注入求值、HA 事件流、编排三种模式 execute、配置持久化与重启恢复、语言跟随等。

新增 / 修改逻辑后：跑 `npm test`。若你新增了纯函数，请补对应 `tests/*.test.js`；若改了装配/事件/持久化，请补/更新 `tests/integration/host.test.js`。测试文件命名保持既有风格（`*.test.js`），且在 `package.json` 的 `test` 脚本 glob 范围内。

---

## 7. 如何报告 Bug ｜ 提 Feature

上报问题或功能请求时，**请使用 Issue 模板**（`git` 仓库 `.github/ISSUE_TEMPLATE/`）：

- **Bug report** —— 环境（DSH 版本 / Node / 平台）、复现步骤、期望与实际行为、日志/截图、是否热重载后仍复现。
- **Feature request** —— 要解决的问题、期望能力、对应路线图阶段（Phase 1 HA / Phase 2 编排 / Phase 3 UI / Phase 4 发布）、备选方案。
- **Compatibility** —— DSH 版本 / 安装方式 / Node 版本 / 平台、遇到的问题、相关插件名单。

模板能大大提高一次定位问题的概率，请尽量填全。

---

## 8. 发布流程

发布由维护者执行，贡献者无需关心细节。要点如下：

- 发布前先更新 `CHANGELOG.md`（遵循 Keep a Changelog 风格，含版本号与日期），并核对 `docs/` 文档（架构 / 配置 / 兼容矩阵）。
- 以 `pnpm verify` / `npm run verify`（同 prepublishOnly 全链路）作为发布前门禁。
- 打 `git tag`（`v<version>`）并创建 GitHub Release，附带 `npm pack` 产物（`.tgz`）。
- npm 发布侧：包名为 `dsh-ha-orchestrator`（public access），产物经 `files` 字段包含 `lib/`、`cordis.patch.yml`、`.language/`、`README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`docs/`、`LICENSE`。

**详细发布 / 校验步骤见 [`docs/verification.md`](docs/verification.md)**（含产物完整性、离线冒烟与发布前检查清单）。

---

## 9. 许可

本仓库以 [MIT](LICENSE) 许可发布。提交贡献即表示同意在 MIT 许可下发布你的改动。

感谢参与！如有疑问，欢迎在 Issue / PR 讨论区提出。
