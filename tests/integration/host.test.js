// ============================================================================
// 集成测试：以最小假 ctx 驱动真实插件（lib/index.js 构建产物）
// ----------------------------------------------------------------------------
// 覆盖（对应路线图 Phase 0「HA 持久化恢复与事件流集成测试 / 编排 execute 集成」）：
//   1. 装配：工具注册、上下文注入段落注册、事件监听注册、RPC 服务注册
//   2. 上下文注入求值：自定义文本 / 默认引导 / 关闭三种模式
//   3. HA 事件流：agent/request 直通 -> 失败计数 -> 隔离 -> agent/request 切换备用
//   4. 重试预算耗尽放行、agent/error 停止兜底（隔离 + 延迟 steer）
//   5. orchestrate 工具 execute：fanout / pipeline(carry) / supervisor
//   6. list-subagents execute、未知子智能体名报错
//   7. 配置持久化：stateSet 写盘 -> 新实例重启恢复（磁盘状态机还原）
//   8. agentsGenerate 智能新增子智能体（生成 -> stateSet 落库 -> 清单可见）
//   9. 语言跟随（settings/updated）、haReset、模型列表/默认选择
// 运行：node --test tests/integration/host.test.js
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ---------- 最小假 ctx（cordis 事件语义子集） ----------
class FakeCtx {
  constructor() {
    this._services = new Map()
    this._listeners = new Map() // name -> [{ fn }]
    this._effects = []
    this.registered = [] // tools.register 记录
    this.sections = [] // systemPrompt.section 记录
    this.subagentCalls = [] // subagents.start 记录
    this.steers = [] // agent.steer 记录
    this.savedSelections = []
    this.events = [] // ctx.emit 记录（类型化会话事件）
    this.commandDefs = [] // commands.register 记录
    this.tools = { register: (tool) => { this.registered.push(tool); return () => {} } }
    this.reflect = {
      provide: (name, value) => { this._services.set(name, value); return () => {} },
    }
  }

  get(name) { return this._services.get(name) }

  on(name, fn, prepend) {
    const list = this._listeners.get(name) || []
    if (prepend) list.unshift({ fn })
    else list.push({ fn })
    this._listeners.set(name, list)
    return () => {}
  }

  effect(fn) {
    this._effects.push(fn)
    return () => {}
  }

  // waterfall：与 cordis 一致，next 链末端为 initial()
  async waterfall(name, payload, initial) {
    const list = (this._listeners.get(name) || []).slice()
    let i = 0
    const next = async () => (i < list.length ? await list[i++].fn(payload, next) : await initial())
    return next()
  }

  async emit(name, payload) {
    this.events.push({ name, payload })
    for (const { fn } of this._listeners.get(name) || []) await fn(payload)
  }
}

// ---------- 内存 fs 服务（可跨实例共享，模拟磁盘） ----------
function makeFs() {
  const store = new Map()
  return {
    store,
    service: {
      async resolve(name, opts) {
        const dir = (opts && opts.cwd) || ''
        const path = dir + '/' + name
        return { path, displayPath: path }
      },
      async readText(target) {
        return store.has(target.path) ? store.get(target.path) : null
      },
      async writeText(target, text) {
        store.set(target.path, text)
      },
    },
  }
}

// ---------- 可注入假服务的环境 ----------
function makeEnv() {
  const fs = makeFs()
  const state = { locale: 'zh', probeMode: 'ok' }
  const subagentOutputs = new Map() // label -> 输出文本
  const subagentFailures = new Map() // label -> 剩余失败次数（>0 时 start 抛错）
  const ctx = new FakeCtx()
  const fakeAgent = {
    id: 'a1',
    session: { header: { cwd: 'C:/work' } },
    steer: (message) => { ctx.steers.push(message) },
    async runMaintenance(fn) { return fn(new AbortController().signal) },
  }
  const subagents = {
    list: () => ['provider-a'],
    async start(provider, request) {
      ctx.subagentCalls.push({ provider, request })
      // 并发观测：全局并发测试用
      ctx.activeSubagents = (ctx.activeSubagents || 0) + 1
      ctx.maxActiveSubagents = Math.max(ctx.maxActiveSubagents || 0, ctx.activeSubagents)
      try {
        const label = request.label
        const remaining = subagentFailures.get(label) || 0
        if (remaining > 0) {
          subagentFailures.set(label, remaining - 1)
          throw new Error('subagent upstream failure: ' + label)
        }
        const delay = state.subagentDelay || 0
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        const text = subagentOutputs.has(label)
          ? subagentOutputs.get(label)
          : 'OUT:' + label
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            output: [{ type: 'text', text }],
          }),
          async dispose() {},
        }
      } finally {
        ctx.activeSubagents -= 1
      }
    },
  }
  const services = {
    fs: fs.service,
    settings: { get: (ns) => (ns === 'locale' ? { preference: state.locale } : undefined) },
    timer: {
      // fire-and-forget 形态带真实延迟（封顶 100ms，unref 不阻塞退出）；
      // await 形态立即 resolve（backoff 用）
      timeout(fnOrMs, ms) {
        if (typeof fnOrMs === 'function') { setTimeout(fnOrMs, Math.min(ms || 0, 100)).unref(); return {} }
        return Promise.resolve()
      },
    },
    llm: {
      listProviders: () => [{ id: 'p0' }, { id: 'p1' }],
      listModels: async (p) => [{ id: 'm0', name: 'Model M0' }, { id: 'm1' }],
      // 探测用小成本流式调用：probeMode = 'fail' 时抛错（模拟未恢复）
      stream(options) {
        if (state.probeMode === 'fail') throw new Error('probe upstream error: 503')
        return (async function* () { yield { type: 'text', text: 'pong' } })()
      },
    },
    subagents,
    systemPrompt: { section: (opts) => { ctx.sections.push(opts); return () => {} } },
    agents: {
      list: () => [fakeAgent],
      currentInitiator: () => fakeAgent,
    },
    agentDefaultModel: {
      saveSelection: (sel) => { ctx.savedSelections.push(sel) },
      currentSelection: () => ({ provider: 'p0', model: 'm0' }),
    },
    launchEnvironment: { get: (k) => ({ value: 'C:/dsh-home' }) },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:/work' }) },
    commands: {
      register: (def) => { ctx.commandDefs.push(def); return () => {} },
    },
  }
  for (const [name, impl] of Object.entries(services)) ctx._services.set(name, impl)
  return { ctx, fs, state, subagents, subagentOutputs, subagentFailures, fakeAgent }
}

// ---------- 工具函数 ----------
function findTool(ctx, name) {
  const tool = ctx.registered.find((t) => t && t.name === name)
  assert.ok(tool, '工具已注册: ' + name)
  return tool
}

function toolExec(ctx, name, args, agent = null) {
  const tool = findTool(ctx, name)
  const signal = new AbortController().signal
  const exec = { agent: agent || { id: 'a1' }, signal }
  return tool.execute(args, exec)
}

async function mountPlugin(ctx) {
  const plugin = await import('../../lib/index.js')
  const mod = plugin.default || plugin
  await mod.apply(ctx)
  return mod
}

// 使用共享 fs（跨实例模拟磁盘）的环境
function envWithSharedFs(sharedFs) {
  const env = makeEnv()
  env.ctx._services.set('fs', sharedFs.service)
  return env
}

// ---------- 用例 ----------

test('装配：工具/上下文注入/事件/RPC 服务全部注册', async () => {
  const { ctx } = makeEnv()
  const mod = await mountPlugin(ctx)

  assert.equal(mod.name, 'ha-orchestrator')
  assert.deepEqual(mod.inject, ['tools', 'systemPrompt'])

  // 工具
  assert.equal(ctx.registered.length, 2)
  assert.equal(ctx.registered[0].name, 'orchestrate')
  assert.equal(ctx.registered[1].name, 'list-subagents')

  // 上下文注入段落（order 40）
  assert.equal(ctx.sections.length, 1)
  assert.equal(ctx.sections[0].name, 'ha-orchestrator:context')
  assert.equal(ctx.sections[0].order, 40)

  // 事件监听
  for (const ev of ['agent/request', 'agent/request-error', 'agent/error']) {
    assert.ok(ctx._listeners.has(ev), '监听事件: ' + ev)
  }

  // RPC 服务（TypertRemoteService 注册到 ctx.reflect）
  const rpc = ctx.get('haOrchestrator')
  assert.ok(rpc, 'RPC 服务已注册')
  assert.equal(rpc.constructor.name, 'HaOrchestratorRpc')
  for (const m of ['stateGet', 'stateReload', 'stateSet', 'modelsList', 'agentsGenerate', 'haReset', 'debugLogs', 'debugClear']) {
    assert.equal(typeof rpc[m], 'function', 'RPC 方法: ' + m)
  }

  // 默认配置状态快照
  const snap = await rpc.stateGet()
  assert.equal(snap.config.ha.enabled, true)
  assert.deepEqual(snap.config.ha.backups, [])
  assert.equal(snap.config.orch.maxAgents, 8)
  assert.equal(snap.i18n.active, 'zh')
  assert.ok(snap.i18n.keys > 0)
})

test('上下文注入求值：自定义文本 / 默认引导 / 关闭', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const section = ctx.sections[0]
  const rpc = ctx.get('haOrchestrator')

  // 默认：无自定义文本、orch.enabled -> 自动编排引导
  const hint = section.text()
  assert.ok(hint.length > 0)
  assert.ok(hint.indexOf('ha-orchestrator') >= 0 || hint.indexOf('orchestrate') >= 0)

  // 自定义文本优先
  await rpc.stateSet({ patch: { ctx: { text: 'CUSTOM-TEXT-123' } } })
  assert.equal(section.text(), 'CUSTOM-TEXT-123')

  // 关闭 -> 空串
  await rpc.stateSet({ patch: { ctx: { enabled: false } } })
  assert.equal(section.text(), '')
})

test('HA 事件流：直通 -> 失败隔离 -> 请求切换备用', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // 配置备用模型（会清空隔离/失败计数）
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })

  // 1) 健康请求直通，记录 lastKey
  const seed = { provider: 'p0', model: 'm0' }
  const out1 = await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(seed))
  assert.deepEqual(out1, seed)

  // 2) 失败一次（threshold=1）-> 隔离 p0/m0 并返回 retry
  const action = await ctx.waterfall('agent/request-error', {
    turn: 1, step: 0, provider: 'p0', failure: { code: 'RATE_LIMIT' }, signal: new AbortController().signal, agent: fakeAgent,
  }, () => Promise.resolve(undefined))
  assert.deepEqual(action, { kind: 'retry' })

  // 3) 再次请求 -> 命中隔离 -> 切换到 p1/m1
  const out2 = await ctx.waterfall('agent/request', { turn: 2, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(seed))
  assert.equal(out2.provider, 'p1')
  assert.equal(out2.model, 'm1')

  // 4) 快照可见隔离与切换历史
  const snap = await rpc.stateGet()
  assert.equal(snap.quarantine.length, 1)
  assert.equal(snap.quarantine[0].provider, 'p0')
  assert.equal(snap.quarantine[0].model, 'm0')
  assert.ok(snap.quarantine[0].remainingMs > 0)
  assert.ok(snap.history.some((h) => h.from === 'p0/m0' && h.to === 'p1/m1'), '切换历史记录')
})

test('HA 事件流：重试预算耗尽后放行原模型', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })

  const signal = new AbortController().signal
  const emitError = () => ctx.waterfall('agent/request-error', {
    turn: 1, step: 0, provider: 'p0', failure: { code: 'SERVER' }, signal, agent: fakeAgent,
  }, () => Promise.resolve(undefined))

  // maxRetries = max(2, threshold 1 + backups 1) = 2
  assert.deepEqual(await emitError(), { kind: 'retry' })
  assert.deepEqual(await emitError(), { kind: 'retry' })
  // 预算耗尽 -> next()（返回 initial undefined，不再重试）
  assert.equal(await emitError(), undefined)
})

test('HA 停止兜底：agent/error 隔离失败模型并延迟 steer', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })

  // 先走一次请求建立 lastKey
  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))

  await ctx.emit('agent/error', { agent: fakeAgent, turn: 1, step: 0, error: { failure: { code: 'SERVER' } } })

  // 隔离 p0/m0
  const snap = await rpc.stateGet()
  assert.ok(snap.quarantine.some((q) => q.provider === 'p0' && q.model === 'm0'), '停止后隔离失败模型')

  // 延迟 steer（timer 延迟 ≤100ms）
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(ctx.steers.length, 1)
  assert.ok(ctx.steers[0].content[0].text.length > 0, 'steer 文本非空')
  assert.equal(ctx.steers[0].source.plugin, 'ha-orchestrator')
})

test('orchestrate fanout：并行执行并保序返回 runs', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'fanout',
    tasks: [{ id: 't1', prompt: 'P1' }, { id: 't2', prompt: 'P2' }, { id: 't3', prompt: 'P3' }],
  }, { id: 'a1' })

  assert.equal(res.runs.length, 3)
  assert.deepEqual(res.runs.map((r) => r.id), ['t1', 't2', 't3'])
  for (const r of res.runs) {
    assert.equal(r.status, 'completed')
    assert.ok(r.output.indexOf('OUT:t' + r.id.slice(1)) >= 0, '输出来自子智能体提供方: ' + r.id)
  }
  // 提供方收到 provider-a 与正确 label + 真实 AbortSignal
  assert.equal(ctx.subagentCalls[0].provider, 'provider-a')
  assert.equal(ctx.subagentCalls[0].request.label, 't1')
  assert.ok(ctx.subagentCalls[0].request.signal instanceof AbortSignal)
})

test('orchestrate pipeline：前段输出作为后段 carry', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  await toolExec(ctx, 'orchestrate', {
    mode: 'pipeline',
    tasks: [{ id: 'p1', prompt: 'first' }, { id: 'p2', prompt: 'second' }],
  }, { id: 'a1' })

  assert.equal(ctx.subagentCalls.length, 2)
  const secondPrompt = ctx.subagentCalls[1].request.prompt[0].text
  assert.ok(secondPrompt.indexOf('OUT:p1') >= 0, 'pipeline carry 携带前段输出')
})

test('orchestrate supervisor：并行任务 + 评审合成', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'supervisor',
    mergeInstructions: '请综合评审',
    tasks: [{ id: 's1', prompt: 'task-a' }, { id: 's2', prompt: 'task-b' }],
  }, { id: 'a1' })

  assert.equal(res.runs.length, 3, '任务 runs + 评审 run')
  assert.equal(res.runs[2].id, 'supervisor')
  assert.equal(ctx.subagentCalls.length, 3)
  const sup = ctx.subagentCalls[2].request
  assert.equal(sup.label, 'supervisor')
  assert.ok(sup.prompt[0].text.indexOf('请综合评审') >= 0, 'supervisor prompt 含合并说明')
  assert.ok(sup.prompt[0].text.indexOf('OUT:s1') >= 0, 'supervisor prompt 含子任务输出摘要')
})

test('orchestrate：未知子智能体名报错且不执行', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  await assert.rejects(
    toolExec(ctx, 'orchestrate', { mode: 'fanout', agent: 'ghost', tasks: [{ id: 't1', prompt: 'P' }] }, { id: 'a1' }),
    /ghost/,
  )
  assert.equal(ctx.subagentCalls.length, 0, '校验失败不启动子智能体')
})

test('list-subagents：返回配置中的自定义子智能体清单', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const res = await toolExec(ctx, 'list-subagents', {})
  assert.equal(res.agents.length, 1)
  assert.equal(res.agents[0].name, 'reviewer')
  assert.equal(typeof res.agents[0].description, 'string')
})

test('配置持久化：stateSet 写盘 -> 新实例启动恢复（磁盘状态机还原）', async () => {
  const fs = makeFs()

  // 第一个实例：修改配置并落盘
  const envA = envWithSharedFs(fs)
  await mountPlugin(envA.ctx)
  const rpcA = envA.ctx.get('haOrchestrator')
  await rpcA.stateSet({ patch: { orch: { maxAgents: 12, concurrency: 5 } } })

  // 磁盘上确实写入了配置文件
  const file = [...fs.store.keys()].find((k) => k.indexOf('ha-orchestrator.config.json') >= 0)
  assert.ok(file, '配置文件已写入: ' + [...fs.store.keys()].join(','))
  const written = JSON.parse(fs.store.get(file))
  assert.equal(written.orch.maxAgents, 12)
  assert.equal(written.orch.concurrency, 5)

  // 第二个实例（重启）：共享同一 fs store -> 自动恢复
  const envB = envWithSharedFs(fs)
  await mountPlugin(envB.ctx)
  const rpcB = envB.ctx.get('haOrchestrator')
  const snap = await rpcB.stateGet()
  assert.equal(snap.config.orch.maxAgents, 12, '重启后配置恢复')
  assert.equal(snap.config.orch.concurrency, 5)

  // 备份文件语义：第二次 stateSet 会把旧配置写为 backup
  await rpcB.stateSet({ patch: { orch: { maxAgents: 16 } } })
  const backup = [...fs.store.keys()].find((k) => k.indexOf('ha-orchestrator.config.backup.json') >= 0)
  assert.ok(backup, '旧配置已写为备份')
  assert.equal(JSON.parse(fs.store.get(backup)).orch.maxAgents, 12)
})

test('agentsGenerate：AI 生成子智能体 -> stateSet 落库 -> 清单可见', async () => {
  const { ctx, subagentOutputs } = makeEnv()
  // 生成任务返回 JSON（runOne 中 label 优先于 id，故 key 为 'generate'）
  subagentOutputs.set('generate', '{ "name": "writer", "provider": "p1", "model": "m1", "description": "写作专家", "systemPrompt": "你是写作专家" }')
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  const res = await rpc.agentsGenerate({ requirement: '需要一个写作专家' })
  assert.equal(res.agent.name, 'writer')
  assert.equal(res.agent.provider, 'p1')
  assert.equal(res.agent.model, 'm1')

  // 生成结果经 stateSet 落库（与 client 保存流程一致）
  const snap = await rpc.stateGet()
  await rpc.stateSet({ patch: { orch: { agents: snap.config.orch.agents.concat([res.agent]) } } })

  const listed = await toolExec(ctx, 'list-subagents', {})
  assert.ok(listed.agents.some((a) => a.name === 'writer'), '新子智能体已加入清单')
})

test('语言跟随：auto 模式跟随 DSH 语言变化（settings/updated）', async () => {
  const { ctx, state } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // 默认 zh
  assert.equal((await rpc.stateGet()).i18n.active, 'zh')

  // 切换到 en（模拟 DSH 语言设置变更）
  state.locale = 'en'
  await ctx.emit('settings/updated', 'locale')
  const snap = await rpc.stateGet()
  assert.equal(snap.i18n.active, 'en')
  assert.equal(snap.i18n.dshLocale, 'en')
})

test('haReset：清空隔离/失败/历史', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })

  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'QUOTA' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))

  const before = await rpc.stateGet()
  assert.equal(before.quarantine.length, 1)

  const after = await rpc.haReset()
  assert.equal(after.quarantine.length, 0)
  assert.equal(after.history.length, 0)
})

test('模型列表与默认选择：stateGet 附带 llmProviders / defaultSelection', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  const snap = await rpc.stateGet()
  assert.deepEqual(snap.llmProviders.map((p) => p.provider), ['p0', 'p1'])
  assert.deepEqual(snap.defaultSelection, { provider: 'p0', model: 'm0' })

  const models = await rpc.modelsList({ provider: 'p0' })
  assert.equal(models.length, 2)
  assert.equal(models[0].model, 'm0')
})

// ===================== Phase 1：HA 能力补强集成测试 =====================

test('Phase1 类型化事件：failover / circuit-opened 发出', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })

  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'RATE_LIMIT' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))
  await ctx.waterfall('agent/request', { turn: 2, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))

  const names = ctx.events.map((e) => e.name)
  assert.ok(names.indexOf('ha/circuit-opened') >= 0, '含 ha/circuit-opened: ' + names.join(','))
  assert.ok(names.indexOf('ha/failover') >= 0, '含 ha/failover: ' + names.join(','))
  const opened = ctx.events.find((e) => e.name === 'ha/circuit-opened')
  assert.equal(opened.payload.key, 'p0\u0000m0')
  assert.equal(opened.payload.level, 'model')
  const failover = ctx.events.find((e) => e.name === 'ha/failover')
  assert.equal(failover.payload.from, 'p0/m0')
  assert.equal(failover.payload.to, 'p1/m1')
  assert.equal(failover.payload.code, 'RATE_LIMIT')
})

test('Phase1 不可重试错误：直接隔离并切换，不消耗阈值计数', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })

  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  const action = await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'INVALID_CREDENTIAL' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))
  assert.deepEqual(action, { kind: 'retry' })

  const out = await ctx.waterfall('agent/request', { turn: 2, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  assert.equal(out.provider, 'p1', '不可重试错误后直接切备用')
  // 失败计数不累计（不消耗阈值）
  const status = await rpc.haStatus()
  assert.equal(status.failures.length, 0, '不可重试错误不写失败计数')
})

test('Phase1 CONTEXT_WINDOW_EXCEEDED 降级：去掉 reasoningEffort 重试原模型', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }], degradeContextWindow: true } } })

  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  const action = await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))
  assert.deepEqual(action, { kind: 'retry' })

  // 降级后的请求：去掉 reasoningEffort，仍走原模型
  const out = await ctx.waterfall('agent/request', { turn: 2, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0', reasoningEffort: 'high' }))
  assert.equal(out.provider, 'p0')
  assert.equal(out.model, 'm0')
  assert.equal(out.reasoningEffort, undefined, '降级请求去掉 reasoningEffort')
})

test('Phase1 provider 级熔断：模型阈值触发后整个 provider 不可用', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [
    { label: 'p0m9', provider: 'p0', model: 'm9' },
    { label: 'p1m1', provider: 'p1', model: 'm1' },
  ], providerThreshold: 1 } } })

  // p0/m0 失败 -> 模型级隔离 + provider 级熔断（threshold=1）
  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'SERVER' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))

  const status = await rpc.haStatus()
  const providerCircuit = status.quarantine.find((q) => q.model === '*' && q.provider === 'p0')
  assert.ok(providerCircuit, 'provider 通配键已隔离')
  assert.equal(providerCircuit.level, 'provider')
  assert.equal(providerCircuit.code, 'PROVIDER_CIRCUIT')

  // 请求 p0 的任何模型都被拦截，且备用跳过 p0 下的 m9，选 p1/m1
  const out = await ctx.waterfall('agent/request', { turn: 2, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  assert.equal(out.provider, 'p1')
  assert.equal(out.model, 'm1')
})

test('Phase1 探测恢复：冷却到期探测通过 -> 解除隔离（circuit-closed）', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }], cooldownMs: 1000, probeEnabled: true } } })

  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'QUOTA' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))
  assert.equal((await rpc.haStatus()).quarantine.length, 1)

  // 等冷却（1000ms）到期后自动探测
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const status = await rpc.haStatus()
  assert.equal(status.quarantine.length, 0, '探测通过后隔离解除')
  const closed = ctx.events.find((e) => e.name === 'ha/circuit-closed')
  assert.ok(closed, '发出 ha/circuit-closed')
  assert.equal(closed.payload.reason, 'probe')
  const probeEv = ctx.events.find((e) => e.name === 'ha/probe')
  assert.ok(probeEv && probeEv.payload.ok === true, '发出 ha/probe(ok)')
})

test('Phase1 探测失败：隔离延长并记录失败（probeLog）', async () => {
  const { ctx, fakeAgent, state } = makeEnv()
  state.probeMode = 'fail'
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })

  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'SERVER' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))

  // 手动探测两次均失败
  const r1 = await rpc.haProbeNow({ provider: 'p0', model: 'm0' })
  assert.equal(r1.ok, false)
  const r2 = await rpc.haProbeNow({ provider: 'p0', model: 'm0' })
  assert.equal(r2.ok, false)

  const status = await rpc.haStatus()
  assert.ok(status.quarantine.length >= 1, '探测失败后仍隔离')
  const fails = status.probes.last.filter((p) => !p.ok && p.key === 'p0\u0000m0')
  assert.ok(fails.length >= 2, 'probeLog 记录失败')
})

test('Phase1 /ha 命令：注册与 status/reset/probe', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // 命令注册（懒注册走 timer 重试，等待就绪）
  await new Promise((resolve) => setTimeout(resolve, 250))
  const def = ctx.commandDefs.find((d) => d.name === 'ha')
  assert.ok(def, '/ha 命令已注册')
  assert.equal(typeof def.handler, 'function')

  // status
  const res = await def.handler({ input: 'status' })
  assert.equal(res.kind, 'success')
  assert.ok(res.text.indexOf('HA 状态') >= 0 || res.text.indexOf('HA status') >= 0)

  // 制造一次隔离后 status 可见
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })
  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'QUOTA' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))
  const statusText = await def.handler({ input: 'status' })
  assert.ok(statusText.text.indexOf('p0/m0') >= 0, 'status 显示隔离键')

  // reset
  const resetRes = await def.handler({ input: 'reset' })
  assert.equal(resetRes.kind, 'success')
  const after = await rpc.haStatus()
  assert.equal(after.quarantine.length, 0)

  // probe 用法错误
  const bad = await def.handler({ input: 'probe' })
  assert.equal(bad.kind, 'error')
})

test('Phase1 HA 运行态持久化：重启恢复隔离/游标/历史', async () => {
  const fs = makeFs()
  const envA = envWithSharedFs(fs)
  const { fakeAgent } = envA
  await mountPlugin(envA.ctx)
  const rpcA = envA.ctx.get('haOrchestrator')

  await rpcA.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }] } } })
  await envA.ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  await envA.ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'RATE_LIMIT' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))
  await envA.ctx.waterfall('agent/request', { turn: 2, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))

  // 等防抖写盘
  await new Promise((resolve) => setTimeout(resolve, 400))
  const haFile = [...fs.store.keys()].find((k) => k.indexOf('ha-orchestrator.ha.json') >= 0)
  assert.ok(haFile, 'HA 运行态文件已写入: ' + [...fs.store.keys()].join(','))
  const parsed = JSON.parse(fs.store.get(haFile))
  assert.equal(parsed.version, 1)
  assert.ok(parsed.quarantine.length >= 1)
  assert.ok(parsed.history.length >= 1)

  // 新实例（重启）恢复
  const envB = envWithSharedFs(fs)
  await mountPlugin(envB.ctx)
  const statusB = await envB.ctx.get('haOrchestrator').haStatus()
  assert.equal(statusB.quarantine.length, 1)
  assert.equal(statusB.quarantine[0].provider, 'p0')
  assert.equal(statusB.quarantine[0].model, 'm0')
  assert.ok(statusB.history.some((h) => h.to === 'p1/m1'), '切换历史恢复')
  assert.ok(statusB.cursors.some((c) => c.agent === 'a1' && c.lastKey === 'p1\u0000m1'), '游标恢复')
})

test('Phase1 haSuggestBackups：排除当前默认模型，给出候选', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  const cands = await rpc.haSuggestBackups()
  // 默认选择 p0/m0 -> 排除整个 p0，候选为 p1/m0、p1/m1
  assert.ok(cands.length >= 2, '有候选: ' + JSON.stringify(cands))
  assert.ok(cands.every((c) => c.provider === 'p1'), '排除默认 provider')
  assert.ok(cands.some((c) => c.model === 'm1'))
})

test('Phase1 haStatus：隔离层级 / 失败计数 / 游标 / 探测记录齐备', async () => {
  const { ctx, fakeAgent } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { ha: { backups: [{ label: 'b1', provider: 'p1', model: 'm1' }], threshold: 3, burstWindowMs: 60000 } } })

  await ctx.waterfall('agent/request', { turn: 1, step: 0, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve({ provider: 'p0', model: 'm0' }))
  // 阈值 3：两次失败只累计不隔离
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'SERVER' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))
  await ctx.waterfall('agent/request-error', { turn: 1, step: 0, provider: 'p0', failure: { code: 'SERVER' }, signal: new AbortController().signal, agent: fakeAgent }, () => Promise.resolve(undefined))

  const status = await rpc.haStatus()
  assert.equal(status.config.threshold, 3)
  assert.equal(status.config.burstWindowMs, 60000)
  assert.equal(status.failures.length, 1)
  assert.equal(status.failures[0].count, 2)
  assert.equal(status.quarantine.length, 0, '阈值内不隔离')
  assert.equal(status.cursors.length, 1)
  assert.equal(status.cursors[0].retries, 2)
  assert.ok(Array.isArray(status.probes.last))
})

// ===================== Phase 2：编排能力产品化集成测试 =====================

test('Phase2 run 记录：orchestrate 生成 runId 并落盘（JSONL）', async () => {
  const { ctx, fs } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'fanout',
    tasks: [{ id: 't1', prompt: 'P1' }, { id: 't2', prompt: 'P2' }],
  }, { id: 'a1' })

  // 内存记录
  const { runs } = await rpc.orchRuns()
  assert.equal(runs.length, 1)
  const rec = runs[0]
  assert.ok(/^r-/.test(rec.runId), 'runId 格式: ' + rec.runId)
  assert.equal(rec.mode, 'fanout')
  assert.equal(rec.agent, 'a1')
  assert.equal(rec.runs.length, 2)
  assert.equal(rec.aborted, false)
  assert.ok(rec.durationMs >= 0)
  assert.ok(rec.startedAt && rec.finishedAt)
  assert.equal(rec.summary, res.summary)

  // 磁盘 JSONL（等防抖无关——run 立即写盘）
  await new Promise((resolve) => setTimeout(resolve, 250))
  const file = [...fs.store.keys()].find((k) => k.indexOf('ha-orchestrator.runs.jsonl') >= 0)
  assert.ok(file, 'run 文件已写入')
  const lines = fs.store.get(file).trim().split(/\r?\n/)
  assert.equal(lines.length, 1)
  const parsed = JSON.parse(lines[0])
  assert.equal(parsed.runId, rec.runId)
  assert.equal(parsed.runs.length, 2)
})

test('Phase2 实时进度事件：run-start / task-status / run-end', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  await toolExec(ctx, 'orchestrate', {
    mode: 'fanout',
    tasks: [{ id: 'e1', prompt: 'P1' }, { id: 'e2', prompt: 'P2' }],
  }, { id: 'a1' })

  const names = ctx.events.map((e) => e.name)
  assert.ok(names.indexOf('orch/run-start') >= 0, '含 run-start: ' + names.join(','))
  assert.ok(names.indexOf('orch/task-status') >= 0, '含 task-status')
  assert.ok(names.indexOf('orch/run-end') >= 0, '含 run-end')

  const start = ctx.events.find((e) => e.name === 'orch/run-start')
  assert.ok(start.payload.runId)
  assert.equal(start.payload.mode, 'fanout')
  assert.equal(start.payload.tasks.length, 2)

  const statuses = ctx.events.filter((e) => e.name === 'orch/task-status')
  // 每个任务 running + completed
  const completed = statuses.filter((e) => e.payload.status === 'completed')
  assert.equal(completed.length, 2)
  assert.deepEqual(completed.map((e) => e.payload.label).sort(), ['e1', 'e2'])

  const end = ctx.events.find((e) => e.name === 'orch/run-end')
  assert.equal(end.payload.runId, start.payload.runId)
  assert.equal(end.payload.runs.length, 2)
  assert.equal(end.payload.aborted, false)
})

test('Phase2 pipeline 阶段隔离：失败阶段标记 error，后续阶段不执行，调用不抛错', async () => {
  const { ctx, subagentFailures } = makeEnv()
  await mountPlugin(ctx)

  // p2 阶段永久失败
  subagentFailures.set('p2', 99)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'pipeline',
    tasks: [{ id: 'p1', prompt: 'first' }, { id: 'p2', prompt: 'second' }, { id: 'p3', prompt: 'third' }],
  }, { id: 'a1' })

  assert.equal(res.runs.length, 2, '失败阶段中止后续阶段')
  assert.equal(res.runs[0].status, 'completed')
  assert.equal(res.runs[1].status, 'error')
  assert.ok(res.runs[1].output.indexOf('subagent upstream failure: p2') >= 0, '保留失败原因')
  assert.ok(res.summary.length > 0, '汇总仍返回（不整体失败）')
  // p3 未启动
  assert.equal(ctx.subagentCalls.length, 2)
})

test('Phase2 pipeline 阶段重试：stageRetry=1 时失败一次后重试成功', async () => {
  const { ctx, subagentFailures } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { orch: { stageRetry: 1 } } })

  // q2 第一次失败，之后成功
  subagentFailures.set('q2', 1)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'pipeline',
    tasks: [{ id: 'q1', prompt: 'a' }, { id: 'q2', prompt: 'b' }, { id: 'q3', prompt: 'c' }],
  }, { id: 'a1' })

  assert.deepEqual(res.runs.map((r) => r.status), ['completed', 'completed', 'completed'])
  assert.equal(ctx.subagentCalls.length, 4, 'q2 重试一次（q1,q2,q2,q3）')
  assert.equal(ctx.subagentCalls[2].request.label, 'q2')
})

test('Phase2 fanout 合并：mergeInstructions 触发合成任务', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'fanout',
    mergeInstructions: '请总结',
    tasks: [{ id: 'm1', prompt: 'a' }, { id: 'm2', prompt: 'b' }],
  }, { id: 'a1' })

  assert.equal(res.runs.length, 3, '含 merge 合成 run')
  assert.equal(res.runs[2].id, 'merge')
  const mergeCall = ctx.subagentCalls[2].request
  assert.equal(mergeCall.label, 'merge')
  assert.ok(mergeCall.prompt[0].text.indexOf('请总结') >= 0, 'merge prompt 含合并说明')
})

test('Phase2 /orchestrate 命令：runs 列表与 show 详情', async () => {
  const { ctx, fs } = makeEnv()
  await mountPlugin(ctx)

  await toolExec(ctx, 'orchestrate', { mode: 'fanout', tasks: [{ id: 'c1', prompt: 'x' }] }, { id: 'a1' })
  await new Promise((resolve) => setTimeout(resolve, 300))

  const def = ctx.commandDefs.find((d) => d.name === 'orchestrate')
  assert.ok(def, '/orchestrate 命令已注册')

  // runs 列表
  const listRes = await def.handler({ input: 'runs' })
  assert.equal(listRes.kind, 'success')
  assert.ok(listRes.text.indexOf('r-') >= 0, '列表含 runId')

  // show 详情
  const runId = listRes.text.match(/r-[a-z0-9-]+/)[0]
  const showRes = await def.handler({ input: 'show ' + runId })
  assert.equal(showRes.kind, 'success')
  assert.ok(showRes.text.indexOf(runId) >= 0)
  assert.ok(showRes.text.indexOf('fanout') >= 0)

  // 未知 runId
  const missing = await def.handler({ input: 'show r-none' })
  assert.equal(missing.kind, 'error')
})

test('Phase2 失败留痕：未知 agent 报错也生成 run 记录', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  await assert.rejects(
    toolExec(ctx, 'orchestrate', { mode: 'fanout', agent: 'ghost', tasks: [{ id: 't1', prompt: 'P' }] }, { id: 'a1' }),
    /ghost/,
  )

  const { runs } = await rpc.orchRuns()
  assert.equal(runs.length, 1, '失败调用也留痕')
  assert.ok(runs[0].summary.indexOf('ghost') >= 0, 'summary 记录失败原因')
  assert.equal(runs[0].runs.length, 0)
})

// ===================== Phase 2 第二轮：预算/轮次/模式/配方/恢复 =====================

test('Phase2 supervisor 评审轮次：reviewRounds=2 两轮评审', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'supervisor',
    reviewRounds: 2,
    mergeInstructions: '请综合评审',
    tasks: [{ id: 'r1', prompt: 'a' }],
  }, { id: 'a1' })

  assert.equal(res.runs.length, 3, '1 任务 + 2 轮评审')
  assert.deepEqual(res.runs.map((r) => r.id), ['r1', 'supervisor', 'supervisor'])
  assert.deepEqual(res.runs.map((r) => r.label), ['', 'supervisor#1', 'supervisor#2'])
  // 第二轮 prompt 携带第一轮输出
  const round2Prompt = ctx.subagentCalls[2].request.prompt[0].text
  assert.ok(round2Prompt.indexOf('OUT:supervisor#1') >= 0, '第二轮以上一轮输出为上下文')
})

test('Phase2 map-reduce：并行执行 + 归约任务', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'map-reduce',
    mergeInstructions: '归纳为结论',
    tasks: [{ id: 'm1', prompt: 'x' }, { id: 'm2', prompt: 'y' }],
  }, { id: 'a1' })

  assert.equal(res.runs.length, 3)
  assert.equal(res.runs[2].id, 'reduce')
  assert.equal(ctx.subagentCalls[2].request.label, 'reduce')
  assert.ok(res.summary.indexOf('OUT:reduce') >= 0, '汇总来自归约任务')
})

test('Phase2 router：从候选任务中路由选择一项执行', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'router',
    tasks: [{ id: 'opt1', prompt: '方案 A' }, { id: 'opt2', prompt: '方案 B' }],
  }, { id: 'a1' })

  assert.equal(ctx.subagentCalls.length, 1, 'router 只执行一次')
  assert.equal(ctx.subagentCalls[0].request.label, 'router')
  assert.equal(res.runs.length, 1)
  const prompt = ctx.subagentCalls[0].request.prompt[0].text
  assert.ok(prompt.indexOf('方案 A') >= 0 && prompt.indexOf('方案 B') >= 0, '候选任务进入路由 prompt')
  assert.ok(res.summary.indexOf('OUT:router') >= 0)
})

test('Phase2 配方：保存/列出/执行/删除', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // 保存配方
  const saved = await rpc.orchSavePreset({
    name: 'audit',
    mode: 'pipeline',
    tasks: [{ id: 's1', prompt: 'step1' }, { id: 's2', prompt: 'step2' }],
    mergeInstructions: '',
  })
  assert.equal(saved.presets.length, 1)
  assert.equal(saved.presets[0].name, 'audit')

  // 按配方执行（不传 tasks）
  const res = await toolExec(ctx, 'orchestrate', { mode: 'pipeline', preset: 'audit' }, { id: 'a1' })
  assert.equal(res.runs.length, 2)
  assert.deepEqual(res.runs.map((r) => r.id), ['s1', 's2'])

  // 删除
  const after = await rpc.orchDeletePreset({ name: 'audit' })
  assert.equal(after.presets.length, 0)

  // 未知配方报错
  await assert.rejects(toolExec(ctx, 'orchestrate', { preset: 'nope', tasks: [{ id: 'x', prompt: 'p' }] }, { id: 'a1' }), /nope/)
})

test('Phase2 resume：中断的 pipeline 按 runId 恢复未完成阶段', async () => {
  const { ctx, subagentFailures } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // 第一次执行：stage2 永久失败 -> run 记录留痕
  subagentFailures.set('st2', 99)
  const first = await toolExec(ctx, 'orchestrate', {
    mode: 'pipeline',
    tasks: [{ id: 'st1', prompt: 'a' }, { id: 'st2', prompt: 'b' }, { id: 'st3', prompt: 'c' }],
  }, { id: 'a1' })
  assert.equal(first.runs[1].status, 'error')
  const { runs } = await rpc.orchRuns()
  const failedRunId = runs[0].runId

  // 修复后恢复：只跑未完成阶段，已完成 st1 复用
  subagentFailures.delete('st2')
  const resumed = await toolExec(ctx, 'orchestrate', { mode: 'pipeline', resume: failedRunId }, { id: 'a1' })
  assert.equal(resumed.runs.length, 3, '恢复后包含已完成 + 新完成阶段')
  assert.deepEqual(resumed.runs.map((r) => r.status), ['completed', 'completed', 'completed'])
  assert.ok(resumed.runs[0].output.indexOf('OUT:st1') >= 0, 'st1 输出来自原记录')
  // 恢复的 run 记录带 resumedFrom
  const resumedRuns = await rpc.orchRuns()
  assert.equal(resumedRuns.runs[0].resumedFrom, failedRunId)
  // 只重跑了 st2/st3（st1 复用；首次调用 = st1,st2 两条）
  const resumedLabels = ctx.subagentCalls.slice(2).map((c) => c.request.label)
  assert.deepEqual(resumedLabels, ['st2', 'st3'])
})

test('Phase2 全局并发：globalConcurrency=1 时跨 run 串行', async () => {
  const { ctx, state } = makeEnv()
  state.subagentDelay = 40
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.stateSet({ patch: { orch: { globalConcurrency: 1 } } })

  // 两个编排并行发起（每个 run 一个任务，观测跨 run 串行）
  const p1 = toolExec(ctx, 'orchestrate', { mode: 'fanout', tasks: [{ id: 'g1', prompt: 'a' }] }, { id: 'a1' })
  const p2 = toolExec(ctx, 'orchestrate', { mode: 'fanout', tasks: [{ id: 'g2', prompt: 'b' }] }, { id: 'a1' })
  await Promise.all([p1, p2])

  assert.equal(ctx.maxActiveSubagents, 1, '全局并发上限 1：跨 run 串行')
  assert.equal(ctx.subagentCalls.length, 2)
})

test('Phase2 /orchestrate presets：命令列出配方', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')
  await rpc.orchSavePreset({ name: 'audit', mode: 'fanout', tasks: [{ id: 'x', prompt: 'p' }] })
  await new Promise((resolve) => setTimeout(resolve, 300))

  const def = ctx.commandDefs.find((d) => d.name === 'orchestrate')
  const res = await def.handler({ input: 'presets' })
  assert.equal(res.kind, 'success')
  assert.ok(res.text.indexOf('audit') >= 0, '列表含配方名')
})

// ===================== Phase 3：UI 产品体验（后端支撑） =====================

test('Phase3 stateExport/stateImport：配置导出与整体导入', async () => {
  const { ctx, fs } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // 导出
  await rpc.stateSet({ patch: { orch: { maxAgents: 12 } } })
  const exp = await rpc.stateExport()
  const parsed = JSON.parse(exp.json)
  assert.equal(parsed.orch.maxAgents, 12)
  assert.equal(parsed.ha.enabled, true)
  assert.ok(exp.json.indexOf('"ha"') >= 0)

  // 导入整体替换（含 backups 与 maxAgents），缺失节回退默认
  const imported = await rpc.stateImport({
    json: JSON.stringify({
      ha: { enabled: true, backups: [{ label: 'b1', provider: 'p9', model: 'm9' }], cooldownMs: 5000 },
      orch: { maxAgents: 21 },
    }),
  })
  assert.equal(imported.config.ha.backups.length, 1)
  assert.equal(imported.config.orch.maxAgents, 21)
  // 缺失节回退默认：debug 未提供 -> 默认
  assert.equal(imported.config.debug.enabled, false)
  // 落盘：重启后仍生效
  const envB = envWithSharedFs(fs)
  await mountPlugin(envB.ctx)
  const snap = await envB.ctx.get('haOrchestrator').stateGet()
  assert.equal(snap.config.orch.maxAgents, 21, '导入的配置持久化')
  assert.equal(snap.config.ha.backups[0].provider, 'p9')

  // 非法 JSON 报错
  await assert.rejects(rpc.stateImport({ json: 'not-json{' }), /无效|Invalid|invalid/)
})

// ===================== Phase 2 第三轮：预算/多评审者/阶段标记/诊断 =====================

test('Phase2 budgetAgents：调用预算耗尽即中止', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // 3 个任务但预算只有 2
  await assert.rejects(
    toolExec(ctx, 'orchestrate', { mode: 'fanout', budgetAgents: 2, tasks: [{ id: 'b1', prompt: 'a' }, { id: 'b2', prompt: 'b' }, { id: 'b3', prompt: 'c' }] }, { id: 'a1' }),
    /预算|budget/i,
  )
  assert.equal(ctx.subagentCalls.length, 2, '预算内最多 2 次调用')

  // 失败留痕
  const { runs } = await rpc.orchRuns()
  assert.ok(runs[0].summary.indexOf('预算') >= 0 || runs[0].summary.indexOf('budget') >= 0, '失败原因记录在 summary')

  // 预算充足时不拦截
  const ok = await toolExec(ctx, 'orchestrate', { mode: 'fanout', budgetAgents: 5, tasks: [{ id: 'b4', prompt: 'd' }] }, { id: 'a1' })
  assert.equal(ok.runs.length, 1)
})

test('Phase2 supervisor 多评审者：reviewers 并行评审 + 综合', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'supervisor',
    mergeInstructions: '请评审',
    reviewers: ['reviewer'], // 内置 reviewer 子智能体
    tasks: [{ id: 'm1', prompt: 'x' }],
  }, { id: 'a1' })

  // 1 任务 + 1 评审者 + 1 综合 = 3 runs
  assert.equal(res.runs.length, 3)
  const ids = res.runs.map((r) => r.id)
  assert.deepEqual(ids, ['m1', 'reviewer-1', 'supervisor'])
  assert.equal(res.runs[1].agent, 'reviewer', '评审者使用指定 agent')

  // 评审者 prompt 含合并摘要；综合 prompt 含评审输出
  const reviewerPrompt = ctx.subagentCalls[1].request.prompt[0].text
  assert.ok(reviewerPrompt.indexOf('请评审') >= 0)
  assert.ok(reviewerPrompt.indexOf('OUT:m1') >= 0, '评审上下文含任务输出摘要')
  const supPrompt = ctx.subagentCalls[2].request.prompt[0].text
  assert.ok(supPrompt.indexOf('OUT:reviewer') >= 0, '综合上下文含评审输出')
})

test('Phase2 pipeline 结构化中间产物：carry 带阶段标记', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)

  await toolExec(ctx, 'orchestrate', {
    mode: 'pipeline',
    tasks: [{ id: 'c1', prompt: 'first' }, { id: 'c2', prompt: 'second' }],
  }, { id: 'a1' })

  const secondPrompt = ctx.subagentCalls[1].request.prompt[0].text
  assert.ok(secondPrompt.indexOf('--- 阶段 1: c1 ---') >= 0, 'carry 含阶段标记')
  assert.ok(secondPrompt.indexOf('OUT:c1') >= 0, 'carry 含前段输出')
})

test('Phase2 /ha diag：服务可用性与持久化诊断', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  // diagnostics RPC：结构化服务可用性
  const diag = await rpc.diagnostics()
  assert.equal(diag.services.subagents.present, true)
  assert.equal(diag.services.llm.present, true)
  assert.equal(diag.services.commands.present, true)
  // 全新环境（无持久化文件）：configLoaded=false 是正确语义（未从磁盘恢复过）
  assert.equal(diag.configLoaded, false)
  assert.equal(diag.haStateLoaded, true)
  assert.equal(diag.language.active, 'zh')
  assert.equal(typeof diag.injection.registered, 'boolean')

  // /ha diag 命令输出
  await new Promise((resolve) => setTimeout(resolve, 300))
  const def = ctx.commandDefs.find((d) => d.name === 'ha')
  const res = await def.handler({ input: 'diag' })
  assert.equal(res.kind, 'success')
  assert.ok(res.text.indexOf('subagents') >= 0, 'diag 列出服务名')
  assert.ok(res.text.indexOf('可用') >= 0 || res.text.indexOf('available') >= 0, 'diag 标注可用性')
})

// ===================== Phase 3：对话内 Run 卡片（宿主侧展示投影） =====================

test('Phase3 Run 卡片：orchestrate 结果含 runId 且展示投影齐备', async () => {
  const { ctx } = makeEnv()
  await mountPlugin(ctx)
  const rpc = ctx.get('haOrchestrator')

  const res = await toolExec(ctx, 'orchestrate', {
    mode: 'fanout',
    tasks: [{ id: 'rc1', prompt: 'a' }, { id: 'rc2', prompt: 'b' }],
  }, { id: 'a1' })

  // 结果值含 runId，与 run 记录一致
  assert.ok(/^r-/.test(res.runId), '结果含 runId')
  const { runs } = await rpc.orchRuns()
  assert.equal(res.runId, runs[0].runId, 'runId 与记录一致')

  // 工具定义带展示投影
  const tool = findTool(ctx, 'orchestrate')
  assert.equal(typeof tool.presentCall, 'function')
  assert.equal(typeof tool.presentResult, 'function')
  assert.equal(typeof tool.output.presentationMeta, 'function')

  // presentCall：pending 标题含模式
  const callView = tool.presentCall({ mode: 'supervisor', tasks: [{ id: 'x', prompt: 'p' }] })
  assert.equal(callView.card, 'generic')
  assert.ok(callView.title.indexOf('supervisor') >= 0)

  // presentationMeta：结构化 run 元数据
  const meta = tool.output.presentationMeta({}, { summary: 's', runId: 'r-abc', runs: [{ id: 'rc1', label: 'rc1', status: 'completed', output: 'o' }, { id: 'rc2', label: 'rc2', status: 'error', output: 'e' }] })
  assert.equal(meta.runId, 'r-abc')
  assert.equal(meta.runs.length, 2)
  assert.equal(meta.runs[1].status, 'error')

  // presentResult：标题含 runId（来自 meta）
  const resultView = tool.presentResult({}, { content: [], isError: false, meta })
  assert.equal(resultView.card, 'generic')
  assert.ok(resultView.title.indexOf('r-abc') >= 0, '完成态标题含 runId')
})
