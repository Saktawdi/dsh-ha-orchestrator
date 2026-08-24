# 验证与发布

本文档描述 `dsh-ha-orchestrator` 插件的测试矩阵、门禁链路、CI 配置、本地开发与发布流程。
所有内容基于仓库当前代码事实（`package.json`、`.github/workflows/ci.yml`、`scripts/verify.mjs`、
`tests/` 与 `README.md`），运行方式与测试计数以实际代码为准。

## 目录

- [测试矩阵](#测试矩阵)
- [门禁链路](#门禁链路)
- [CI](#ci)
- [本地开发](#本地开发)
- [发布流程](#发布流程)
- [发布前后核对清单](#发布前后核对清单)

---

## 测试矩阵

测试基于 Node.js 内置测试运行器 `node:test`，由 `npm test` 驱动：

```
node --test "tests/*.test.js" "tests/integration/*.test.js"
```

测试运行在前一步 **`npm run build` 生成的 `lib/` 构建产物**上（各测试文件从
`../lib/*.js` 导入），而非直接跑 `src/` 的 TypeScript 源码。

### 单元测试（147 例）

| 文件 | 例数 | 覆盖对象（`lib/` 构建产物） | 主要覆盖点 |
| :-- | :-: | :-- | :-- |
| `tests/config.test.js` | 24 | `lib/config.js` | `MIN_COOLDOWN_MS` 常量、`defaultConfig` 深层结构、`sanitizeConfig` 逐条校验规则、工具裁剪/深度限制、`maxTokens` 钳制、未提交节沿用 base、入参不被修改 |
| `tests/ha-core.test.js` | 25 | `lib/ha-core.js` | `keyOf`/`splitKey` 往返、`matchesCodes`、`clearExpired` 过期清理、`isExactQuarantined`/`isBlocked` 隔离判定、`bumpFailure` 失败计数、`quarantineKey` 隔离写入、`findFallback`/`pickFallback` 备用游标与跳过、`maxRetriesFor` 重试预算、`computeFailingKey`、`burstWindowMs` 窗口、provider 级通配隔离、`serialize/deserializeHaState` 往返 |
| `tests/orch-runner.test.js` | 64 | `lib/orch-runner.js` | agent 查找与未知名、任务清洗/截断、并发与模式解析、prompt/request 构建、工具裁剪、结构化输出、`maxTokens` 透传、`isUsableRunStatus`、回退资格判定（`isFallbackEligibleError`）、结果归一化、`poolRun` 并发与异常、汇总/渲染截断、pipeline carry、supervisor prompt |
| `tests/language.test.js` | 24 | `lib/language.js` | `parseDictModule` 合法/非法/数组/BOM/空对象、`resolveTarget`、`pickDict` 回滚、`translate` 占位符、`makeT` 绑定字典 |
| `tests/remote.test.js` | 10 | `lib/remote.js` | `decorateRemoteMethod` 的 context/export/access 传递、`Symbol.metadata` 存在性、`runInitializers` 延迟执行语义、描述符保持、完成后 `addInitializer` 抛错、多方法 exportName 与 initializer 顺序 |

**单元测试合计 = 24 + 25 + 64 + 24 + 10 = 147 例。**

### 集成测试（80 例）

文件 `tests/integration/host.test.js`（80 例），以最小假 `ctx`（cordis 事件语义子集）
驱动真实插件 **`lib/index.js`** 构建产物。头部注释声明的覆盖范围（对应路线图
Phase 0「HA 持久化恢复与事件流集成测试 / 编排 execute 集成」）包括：

1. **装配** — 工具注册、上下文注入段落注册、事件监听注册、RPC 服务注册。
2. **上下文注入求值** — 自定义文本 / 默认引导 / 关闭三种模式。
3. **HA 事件流** — agent/request 直通 → 失败计数 → 隔离 → agent/request 切换备用。
4. **重试预算耗尽放行**、**agent/error 停止兜底**（隔离 + 延迟 steer）。
5. **orchestrate 工具 execute** — `fanout` / `pipeline`(carry) / `supervisor` / `map-reduce` / `router`。
6. **list-subagents execute**、未知子智能体名报错。
7. **配置持久化** — `stateSet` 写盘 → 新实例重启恢复（磁盘状态机还原）。
8. **agentsGenerate** 智能新增子智能体（生成 → `stateSet` 落库 → 清单可见）。
9. **语言跟随**（settings/updated）、`haReset`、模型列表/默认选择。
10. **Phase 1/2/3/4 扩展用例** — 类型化事件（failover / circuit-opened / circuit-closed）、
    不可重试错误、CONTEXT_WINDOW_EXCEEDED 降级、provider 级熔断、探测恢复与失败延长、
    `/ha` 命令（status/reset/probe）、HA 运行态持久化、`haSuggestBackups`、`haStatus`、
    run 记录（JSONL 落盘）、实时进度事件（run-start / task-status / run-end）、
    pipeline 阶段隔离与重试、fanout 合并、`/orchestrate` 命令与 presets、评审轮次、
    map-reduce、router、配方（保存/列出/执行/删除）、resume、全局并发、预算、
    多评审者、实时活动 run、`stateExport`/`stateImport`、用户主动 skill。
11. **当前 v0.12 调研能力** — 自定义子智能体工具裁剪、provider 能力门控、`outputHint` /
    object-root `outputSchema`、`maxDepth`、`maxTokens` 透传、内置调研 agent，以及 run 工件/并发写入的回归行为。
12. **resume 增强回归** — `/ha-orch-resume <runId>` 命令、`max-tokens` 视为可用输出（`isUsableRunStatus`）、
    自动续跑只锁定最新匹配 run、显式 resume 无 tasks 时回退历史任务定义、命令 `rawInput`/`agent`/`signal` 载荷。
13. **性能与轻量历史** — `orchRecent` RPC（按会话血缘在 host 侧过滤、剥离 prompt/output）、轻量 Run 内存热集与磁盘合并。
14. **稳健性复审回归** — reviewers 名单截断、回退链系统性熔断（同错误整链失败阈值）、`orchRecent` 缓存 TTL/`stateReload` 失效、`isFallbackEligibleError` 分类。

**全量合计 = 147 单测 + 80 集成 = 227 例。**

---

## 门禁链路

`prepublishOnly` 串起全部离线门禁：

```
npm run typecheck -> npm run build -> npm run check -> npm test -> npm run verify
```

| 门禁 | 命令 | 实际动作 |
| :-- | :-- | :-- |
| 类型检查 | `npm run typecheck` | `tsc -p tsconfig.json --noEmit`（不产出文件） |
| 构建 | `npm run build` | `tsc -p tsconfig.json`（`src/` → `lib/`） |
| 客户端语法 | `npm run check` | `node --check lib/client.js`（手写 client bundle 语法校验） |
| 测试 | `npm test` | 全部单元 + 集成测试（见[测试矩阵](#测试矩阵)） |
| 离线验证 | `npm run verify` | `node scripts/verify.mjs`（见下） |

`prepublishOnly` 定义（`package.json`）：

```
npm run typecheck && npm run build && npm run check && npm test && npm run verify
```

> 门禁顺序有依赖：`build` 先于 `check` 与 `test`，因为后两者作用在 `lib/` 构建产物上。
> 改动 `src/` 后必须重新 `build`，测试才能反映最新代码。

### `npm run verify`（6 组核查）

`scripts/verify.mjs` 按序执行 6 组检查，全部通过后输出 `[verify] 6 checks passed`：

1. **package.json 字段** — 包名/`main`/`types`/`files` 清单、`dsh.bundle.patch`、`exports`、
   `engines.node`、`publishConfig.access = public`、必需 scripts 与 devDependencies.typescript。
2. **cordis.patch.yml 最小解析** — 文件存在、含顶层 `- insert:`、首行 `id`/`name` 均为
   `dsh-ha-orchestrator`。
3. **语言包对等** — `.language/zh.json` 与 `.language/en.json` 均为合法 JSON 对象、值全为字符串、
   两组键排序后逐键对等。
4. **TypeScript 构建产物齐全** — `lib/` 含 `config/ha-core/orch-runner/language/remote/types/index`
   对应的 `.d.ts` 与手写 `lib/client.js`；`src/` 与 `lib/` 模块一一对应；`src/` 内不得有 `.js`。
5. **纯模块冒烟** — `config`/`ha-core`/`orch-runner`/`language`/`remote` 五个纯模块在无 DSH
   依赖环境下按期望行为工作（默认配置、钳位、失败自增、备用切换、模式解析、并发保序池、
   语言解析、装饰器运行时与 initializer）。
6. **npm pack dry-run** — `npm pack --dry-run --json` 列出打包文件，确认 `cordis.patch.yml`、
   `.language/{zh,en}.json`、`lib/*.js`、`lib/index.d.ts`、`src/*.ts`、`README.md`、
   `README.en.md`、`CHANGELOG.md` 均在内。

---

## CI

GitHub Actions 配置 `.github/workflows/ci.yml`，触发于 `push` 与 `pull_request`，任务
`verify`：

- **矩阵**：`ubuntu-latest` 与 `windows-latest` 双操作系统（`fail-fast: false`，一者失败不打断另一者）。
- **Node**：`actions/setup-node@v4` 固定 **Node 22**。
- **安装**：`npm ci`。
- **步骤**（与本地门禁一致）：
  1. `npm run typecheck`
  2. `npm run build`（src → lib）
  3. `npm run check`（client bundle 语法）
  4. `npm test`（单元 + 集成）
  5. `npm run verify`（离线验证）

CI 不执行 `npm publish`；发布动作由后述发布流程人工/带环境执行。

---

## 本地开发

- **类型检查与构建**：`npm run typecheck`（`--noEmit`）/ `npm run build`（tsc → `lib/`）。
- **监听模式**：`npm run dev` = `tsc -p tsconfig.json --watch`，改动 `src/` 后自动重build。
- **改动后复核**：修改 `src/` 后需先 `build`（或经 `dev` 监听）再 `check`/`test` ——
  测试与 client 语法门禁都读取 `lib/` **构建产物**，不直接跑源码。
- **单测/集成分开跑**：`node --test tests/*.test.js`
  （五个单测文件）与 `node --test tests/integration/host.test.js`（集成）。`npm test` 一次跑全量。
- **离线验证**：`npm run verify` 冒烟打包产物与文件清单，发布前最后一道关卡。

---

## 发布流程

发布前确保本机满足：`git` 已配置、`node >= 20.19.0`（`package.json` 的 `engines.node`）。

1. **全门禁自检** — 执行 `npm run prepublishOnly`
   （= typecheck → build → check → test → verify）。任一步失败即停下修复，不进入发布。
2. **验证打包产物** — 执行 `npm pack` 生成 `.tgz`，核对 `files` 清单实际内容。按
   `package.json#files`，发布包应包含：
   - `lib/`（构建产物 + `client.js` + 类型声明）
   - `src/`（TypeScript 源码）
   - `.language/`（zh/en 语言包）
   - `cordis.patch.yml`（bundle patch）
   - `docs/`
   - `README*`（`README.md`、`README.en.md`）
   - `CHANGELOG.md`
   - `LICENSE`
   - 由 npm 自动纳入的 `package.json`
   - `npm pack --dry-run` 已由 `verify` 预检以上关键文件。
3. **打 tag + GitHub Release** — 提交版本（改版号应同步更新 CHANGELOG），打 `v<version>`
   tag 并推送，创建 GitHub Release（仓库 `Saktawdi/dsh-ha-orchestrator`）并附上步骤 2 的 `.tgz`。
   > 当前仓库已完成 v0.12.0 的 GitHub Release（`gh release create` 附 `.tgz`）。
4. **npm publish** — 远端发布到 npm registry（`publishConfig.access = public`，公开可安装）。
   当前仓库已完成 `dsh-ha-orchestrator@0.12.0` 的 npm 发布。

---

## 发布前后核对清单

- [ ] `npm run prepublishOnly` 全绿（typecheck / build / check / test / verify 无一失败）。
- [ ] `npm test` 全量 227 例通过（147 单测 + 80 集成）。
- [ ] `npm run verify` 输出 `[verify] 6 checks passed`。
- [ ] `npm pack` 产物含 `lib/ src/ .language/ cordis.patch.yml docs/ README* CHANGELOG.md LICENSE`。
- [ ] 版本号与 CHANGELOG 一致，`git tag v<version>` 已推送。
- [ ] GitHub Release 已附 `.tgz`（需 `gh` CLI 就绪）。
- [ ] `npm publish` 成功（需 npm 登录，`access: public`）。
