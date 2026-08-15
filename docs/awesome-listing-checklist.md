# 提高被 Awesome DSH 仓库收录几率的 Checklist

> 适用目标：
> - [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
> - [0xsline/awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
> - [whyihaveyou/dsh-suite](https://github.com/whyihaveyou/dsh-suite)
> - 以及 dsh-market / dshfind 等衍生目录

---

## 1. 硬性门槛（不满足几乎必被拒）

- [ ] `package.json` 声明 `dsh.bundle` manifest，且包含 `dsh.bundle.patch`：

  ```jsonc
  {
    "dsh": {
      "bundle": { "patch": "./cordis.patch.yml" }, // 必须
      "client": { "platform": "web" }              // 仅带前端 UI 时需要
    }
  }
  ```

  > ⚠️ 最常见的被拒原因：只声明了 `dsh.client`。这只能加载前端，不能通过 `dsh plugin add` 安装，不属于“可安装插件”。

- [ ] 仓库根目录有真实的 `cordis.patch.yml`：

  ```yaml
  - insert:
      - id: ha-orchestrator
        name: ha-orchestrator
  ```

- [ ] 有真实可运行的代码，不是占位仓库、空壳、纯 README。
- [ ] GitHub 仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic。
- [ ] 项目处于活跃维护状态（失效仓库会被定期清理）。
- [ ] 描述是“一句话说功能”，不夸大、不营销。

---

## 2. 提高通过率的推荐项

- [ ] 发布到 npm，并带**预构建 `lib/`**。
  - 预构建安装可以跳过 pnpm 的 `allowBuilds` 构建授权，安装体验更好。
  - awesome 维护者明确推荐：*prebuilt installs skip the allowBuilds build-approval step*。
- [ ] 官方 `@deepseek-ai/*` 包一律放 `peerDependencies`，不要放 `dependencies`。
- [ ] 在 README 中给出可验证的一键安装命令：

  ```sh
  dsh plugin --profile web add ha-orchestrator
  ```

- [ ] 提供 `dsh --profile web --dump-config` 验证步骤，证明 bundle 已进入合成树。
- [ ] 声明兼容矩阵：DSH 版本、Node 版本、平台、最后验证时间。
- [ ] 有自动化测试/CI（typecheck + test + build + offline verify）。
- [ ] README 中英双语，包含安装、使用、配置、截图、常见问题。
- [ ] 有 `LICENSE`、`CHANGELOG.md`、Issue 模板、CONTRIBUTING.md。
- [ ] 被收录后挂回链徽章（如 dsh-suite badge），形成正向曝光。

---

## 3. 针对不同 awesome 仓库的提交流程

### 3.1 awesome-dsh-plugin / awesome-dsh-plugin

- 直接开 PR，在 `README.md` 和 `README.zh.md` 的对应分类下各加一行：

  ```markdown
  - [owner/repo](https://github.com/owner/repo) - One-line description ending with a period.
  ```

  ```markdown
  - [owner/repo](https://github.com/owner/repo) — 一句话描述，以句号结尾。
  ```

- 推荐分类：`Workflow & Automation`（因为 orchestrate 是核心能力）；也可以在描述里同时点出 HA。
- 合并后网站自动重建，无需额外操作。

### 3.2 0xsline/awesome-deepseek-harness

- 先看对应分类，比如 `Agents & Orchestration` 或 `Models & Inference`。
- 直接 PR，要求：
  - 真实仓库链接；
  - 一句话功能描述；
  - 英文 README 和中文 README 同时更新；
  - 不添加每行徽章、截图、长介绍。
- 分类建议：`Agents & Orchestration`（若强调编排）或 `Models & Inference`（若强调 fallback）。

### 3.3 whyihaveyou/dsh-suite

- 先按[收录申请模板](https://github.com/whyihaveyou/dsh-suite/blob/main/.github/ISSUE_TEMPLATE/plugin-submission.md)开 issue。
- 需要提供：
  - npm 包名 / GitHub repo；
  - 中英双语一句话描述（各 ≤140 字符）；
  - 分类（建议 `orchestration`）；
  - 是否已实测、DSH 最低版本。
- 维护者核实后写入 `data/plugins.json`，`compat.status` 只能诚实填 `unknown` / `ok` / `broken` / `unmaintained`，没实测就留 `unknown`。
- 不要手改 README 表格，目录表由脚本生成。

---

## 4. ha-orchestrator 当前距离收录还差什么

| 检查项 | 当前状态 | 动作 |
| --- | --- | --- |
| `dsh.bundle.patch` | ❌ 没有 | 补 `cordis.patch.yml` + `package.json` 声明 |
| npm 发布 | ❌ 没有 | 发布到 npm，带预构建 `lib/` |
| GitHub `dsh-plugin` topic | ❌ 未确认 | 仓库 Settings → Topics 添加 |
| 自动化测试/CI | ❌ 没有 | 先补核心单测 + `scripts/verify.mjs` + GitHub Actions |
| 兼容矩阵 | ❌ 没有 | 在 README 声明 DSH/Node/平台/验证时间 |
| README 中英双语 | ✅ 已有 | 补充一键安装命令和验证步骤 |
| 真实代码 | ✅ 已有 | 继续维护，避免长期失活 |
| 一句话描述 | ⚠️ 可优化 | 写成“HA failover + orchestrate 子智能体编排 + 双语设置 UI 的 DSH 插件” |

---

## 5. 推荐执行顺序

1. 补 `dsh.bundle.patch` + `cordis.patch.yml`（这是被收录的第一门票）。
2. 发布 npm 包并验证 `dsh plugin --profile web add ha-orchestrator` 可安装。
3. 加 GitHub `dsh-plugin` topic。
4. 补基础测试/CI 和兼容矩阵，避免“看起来不维护”。
5. 优化 README 的一句话描述和一键安装说明。
6. 先向 `awesome-dsh-plugin/awesome-dsh-plugin` 提交 PR（门槛最低、曝光最大）。
7. 再向 `0xsline/awesome-deepseek-harness` 和 `whyihaveyou/dsh-suite` 提交。
8. 被收录后挂回链徽章，形成持续曝光。

---

## 6. 常见被拒原因（避开）

- 只声明 `dsh.client`，没有 `dsh.bundle`。
- 没有真实代码，或代码不可运行。
- 没有 `dsh-plugin` topic。
- 描述是“最强大 / 最好用 / 革命性”，不是功能说明。
- 仓库长期不更新、不回应 issue。
- 没有 npm 包，安装需要手工复制，维护者难以验证。
