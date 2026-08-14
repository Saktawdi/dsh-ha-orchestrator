return {
  async apply(ctx) {
    // ================= 配置与状态 =================
    const defaultConfig = {
      ha: {
        enabled: true,
        backups: [
          { label: 'GLM-5.2', provider: 'own', model: 'glm-5.2' },
        ],
        cooldownMs: 300000,
        threshold: 1,
        codes: [],
        persistSelection: false,
        steerOnStop: true,
      },
      orch: {
        enabled: true,
        provider: '',
        concurrency: 3,
        maxAgents: 8,
        agents: [
          {
            name: 'reviewer',
            provider: 'own',
            model: 'glm-5.2',
            description: '代码审查专家：检查代码质量、发现 bug 与安全隐患，输出结构化审查意见。',
            systemPrompt: '你是一名资深代码审查员。审查时给出：1) 问题清单（严重程度+位置+原因）2) 修复建议 3) 总体评价。',
          },
        ],
      },
    }
    const state = {
      config: JSON.parse(JSON.stringify(defaultConfig)),
      quarantine: new Map(),
      failures: new Map(),
      perAgent: new Map(),
      history: [],
    }
    let providerCache = null
    let providerCacheAt = 0

    // ================= 工具函数 =================
    function keyOf(provider, model) { return String(provider) + '\u0000' + (model || '*') }
    function splitKey(k) {
      const i = String(k).indexOf('\u0000')
      return [String(k).slice(0, i), String(k).slice(i + 1)]
    }
    function now() { return Date.now() }
    function matchesCodes(codes, code) {
      return !codes || codes.length === 0 || codes.indexOf(code) >= 0
    }
    function clearExpired() {
      const t = now()
      for (const [k, v] of state.quarantine) if (v.until <= t) state.quarantine.delete(k)
      for (const [k, v] of state.failures) if (v.until <= t) state.failures.delete(k)
    }
    function isQuarantined(k) { clearExpired(); return state.quarantine.has(k) }
    function bumpFailure(k) {
      clearExpired()
      const cfg = state.config.ha
      const v = state.failures.get(k) || { count: 0, until: 0 }
      v.count += 1
      v.until = now() + cfg.cooldownMs
      state.failures.set(k, v)
      return v.count
    }
    function quarantineKey(k, code) {
      const cfg = state.config.ha
      state.quarantine.set(k, { until: now() + cfg.cooldownMs, code })
      state.failures.delete(k)
    }
    function record(agentId, fromKey, target, code) {
      const parts = splitKey(fromKey)
      state.history.push({
        at: new Date().toISOString(),
        agent: String(agentId),
        from: parts[0] + (parts[1] === '*' ? '' : '/' + parts[1]),
        to: target.provider + '/' + target.model,
        code: code || '',
      })
      if (state.history.length > 50) state.history.splice(0, state.history.length - 50)
    }
    function inFlightKey(agent) {
      try {
        const h = agent.session.requestHeader()
        const c = h && h.config
        return c && c.provider && c.model
          ? { provider: c.provider, model: c.model, key: keyOf(c.provider, c.model) }
          : null
      } catch (e) { return null }
    }
    function registeredProviders() {
      const t = now()
      if (providerCache && t - providerCacheAt < 30000) return providerCache
      const llm = ctx.get('llm')
      let set = null
      try {
        if (llm) {
          set = new Set(llm.listProviders().map((p) => String(p && (p.id || p.provider || p.name) || p)))
        }
      } catch (e) { set = null }
      if (!set) set = new Set()
      providerCache = set
      providerCacheAt = t
      return set
    }
    function pickFallback(agentId, excludeKey) {
      const cfg = state.config.ha
      const list = cfg.backups || []
      if (list.length === 0) return null
      const registered = registeredProviders()
      const entry = state.perAgent.get(agentId) || { index: 0 }
      const n = list.length
      for (let i = 0; i < n; i += 1) {
        const idx = (entry.index + i) % n
        const b = list[idx]
        if (!b || !b.provider || !b.model) continue
        if (registered.size > 0 && !registered.has(String(b.provider))) continue
        const k = keyOf(b.provider, b.model)
        if (k === excludeKey) continue
        if (isQuarantined(k)) continue
        state.perAgent.set(agentId, { ...entry, index: (idx + 1) % n })
        return { provider: String(b.provider), model: String(b.model), reasoningEffort: b.reasoningEffort || undefined, key: k }
      }
      return null
    }
    function tryPersist(target) {
      const adm = ctx.get('agentDefaultModel')
      if (!adm) return
      try { adm.saveSelection({ provider: target.provider, model: target.model }) } catch (e) { console.error('saveSelection failed', e) }
    }
    function currentDefaultSelection() {
      const adm = ctx.get('agentDefaultModel')
      if (!adm) return null
      try { return adm.currentSelection() } catch (e) { return null }
    }

    // ================= 配置持久化（JSON 文件 + 备份） =================
    const CONFIG_FILE = 'ha-orchestrator.config.json'
    const CONFIG_BACKUP = 'ha-orchestrator.config.backup.json'
    const fsService = ctx.get('fs')

    // 插件目录：优先取当前会话 workspace（cwd），拿不到则回退 DSH 数据目录，再回退 fs 默认 cwd
    function storageDir() {
      try {
        const agents = ctx.get('agents')
        if (agents && typeof agents.list === 'function') {
          const list = agents.list() || []
          for (const a of list) {
            const cwd = a && a.session && a.session.header && a.session.header.cwd
            if (cwd) return String(cwd)
          }
        }
      } catch (e) { /* ignore */ }
      try {
        const env = ctx.get('launchEnvironment')
        if (env && typeof env.get === 'function') {
          const hit = env.get('DSH_HOME')
          if (hit && hit.value) return String(hit.value)
        }
      } catch (e) { /* ignore */ }
      return ''
    }
    async function resolveStorageTarget(name) {
      if (!fsService || typeof fsService.resolve !== 'function') return null
      const dir = storageDir()
      try { return await fsService.resolve(name, dir ? { cwd: dir } : undefined) } catch (e) { return null }
    }
    async function readStorageText(name) {
      const target = await resolveStorageTarget(name)
      if (!target || typeof fsService.readText !== 'function') return null
      try { return await fsService.readText(target) } catch (e) { return null }
    }
    function parseConfigJson(text) {
      if (text == null) return null
      try {
        const raw = JSON.parse(text)
        return raw && typeof raw === 'object' ? raw : null
      } catch (e) { return null }
    }
    // 对完整配置做校验合并（base 缺省为当前内存态；加载时传入 defaultConfig 兜底）
    function sanitizeConfig(patch, base) {
      const baseCfg = base || state.config
      const next = {}
      if (patch && typeof patch === 'object') {
        if (patch.ha && typeof patch.ha === 'object') {
          const ha = { ...baseCfg.ha, ...patch.ha }
          ha.enabled = !!ha.enabled
          ha.cooldownMs = Math.max(0, Number(ha.cooldownMs) || 0)
          ha.threshold = Math.max(1, Number(ha.threshold) || 1)
          ha.persistSelection = !!ha.persistSelection
          ha.steerOnStop = !!ha.steerOnStop
          ha.codes = Array.isArray(ha.codes) ? ha.codes.map(String).filter(Boolean) : []
          ha.backups = Array.isArray(ha.backups)
            ? ha.backups.filter((b) => b && typeof b === 'object')
              .map((b) => ({
                label: String(b.label || ''),
                provider: String(b.provider || ''),
                model: String(b.model || ''),
                reasoningEffort: b.reasoningEffort ? String(b.reasoningEffort) : '',
              })).filter((b) => b.provider && b.model)
            : []
          next.ha = ha
        }
        if (patch.orch && typeof patch.orch === 'object') {
          const orch = { ...baseCfg.orch, ...patch.orch }
          orch.enabled = !!orch.enabled
          orch.provider = String(orch.provider || '')
          orch.concurrency = Math.max(1, Math.min(32, Number(orch.concurrency) || 1))
          orch.maxAgents = Math.max(1, Math.min(64, Number(orch.maxAgents) || 1))
          orch.agents = Array.isArray(orch.agents)
            ? orch.agents.filter((a) => a && typeof a === 'object' && String(a.name || '').trim())
              .map((a) => ({
                name: String(a.name || '').trim(),
                provider: String(a.provider || ''),
                model: String(a.model || ''),
                description: String(a.description || ''),
                systemPrompt: String(a.systemPrompt || ''),
              }))
            : []
          next.orch = orch
        }
      }
      return next
    }
    async function loadPersistedConfig() {
      let raw = parseConfigJson(await readStorageText(CONFIG_FILE))
      if (!raw) raw = parseConfigJson(await readStorageText(CONFIG_BACKUP))
      if (!raw) return false
      const next = sanitizeConfig(raw, defaultConfig)
      for (const key of Object.keys(next)) state.config[key] = next[key]
      console.log('[ha] config restored from JSON file')
      return true
    }
    async function persistConfig() {
      if (!fsService || typeof fsService.writeText !== 'function') return false
      const target = await resolveStorageTarget(CONFIG_FILE)
      if (!target) return false
      const backupTarget = await resolveStorageTarget(CONFIG_BACKUP)
      try {
        const prev = await readStorageText(CONFIG_FILE)
        if (prev != null && backupTarget) {
          try { await fsService.writeText(backupTarget, prev) } catch (e) { /* 备份失败不影响主写 */ }
        }
        await fsService.writeText(target, JSON.stringify(state.config, null, 2))
        console.log('[ha] config persisted:', target.displayPath)
        return true
      } catch (e) {
        console.error('[ha] persist config failed', e)
        return false
      }
    }
    await loadPersistedConfig()

    // ================= 高可用：失败回退 =================
    // prepend: true 保证本插件监听器在瀑布流最外层，拥有最终决定权
    ctx.on('agent/request', async (payload, next) => {
      try {
        const cfg = state.config.ha
        if (!cfg.enabled || !cfg.backups || cfg.backups.length === 0) return next()
        const config = await next()
        if (!config || !config.provider || !config.model) return config
        const k = keyOf(config.provider, config.model)
        if (!isQuarantined(k)) return config
        const target = pickFallback(payload.agent.id, k)
        if (!target) return config
        const rest = {}
        for (const key of Object.keys(config)) if (key !== 'reasoningEffort') rest[key] = config[key]
        const out = { ...rest, provider: target.provider, model: target.model }
        if (target.reasoningEffort) out.reasoningEffort = target.reasoningEffort
        return out
      } catch (e) {
        console.error('agent/request handler failed', e)
        return next()
      }
    }, true)

    ctx.on('agent/request-error', async (payload, next) => {
      try {
        const cfg = state.config.ha
        if (!cfg.enabled || !cfg.backups || cfg.backups.length === 0) return next()
        const { agent, provider, failure, signal } = payload
        if (signal.aborted) return next()
        const code = failure && failure.code ? String(failure.code) : 'UNKNOWN'
        if (!matchesCodes(cfg.codes, code)) return next()
        const inFlight = inFlightKey(agent)
        const failingKey = inFlight && inFlight.provider === provider ? inFlight.key : keyOf(provider, '*')
        const count = bumpFailure(failingKey)
        if (count < cfg.threshold) return { kind: 'retry' }
        const target = pickFallback(agent.id, failingKey)
        if (!target) return next()
        quarantineKey(failingKey, code)
        record(agent.id, failingKey, target, code)
        if (cfg.persistSelection) tryPersist(target)
        console.log('[ha] failover ' + agent.id + ' ' + failingKey + ' -> ' + target.provider + '/' + target.model + ' (' + code + ')')
        return { kind: 'retry' }
      } catch (e) {
        console.error('agent/request-error handler failed', e)
        return next()
      }
    }, true)

    // 停止兜底：模型错误中断后，先隔离失败模型，再延迟到 driver idle 后 steer 继续
    ctx.on('agent/error', (payload) => {
      try {
        const cfg = state.config.ha
        if (!cfg.enabled || !cfg.steerOnStop) return
        const { agent, turn, error } = payload
        const MODEL_CODES = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'QUOTA', 'CONTEXT_WINDOW_EXCEEDED', 'EMPTY_RESPONSE', 'NO_ADAPTER', 'INVALID_CREDENTIAL']
        const code = error && error.failure
          ? String(error.failure.code || 'UNKNOWN')
          : (error && typeof error.code === 'string' ? error.code : '')
        if (!code || MODEL_CODES.indexOf(code) < 0) return
        const entry = state.perAgent.get(agent.id)
        const inFlight = inFlightKey(agent)
        const failingKey = inFlight ? inFlight.key : ''
        // 关键：先隔离失败模型，保证下一次请求（无论手动还是自动唤醒）直接用备用模型
        if (failingKey) quarantineKey(failingKey, code)
        if (entry && entry.steeredTurn === turn) return
        const target = pickFallback(agent.id, failingKey)
        if (!target) return
        state.perAgent.set(agent.id, { ...(entry || { index: 0 }), steeredTurn: turn })
        const parts = failingKey ? splitKey(failingKey) : ['unknown', '']
        const from = parts[0] + (parts[1] && parts[1] !== '*' ? '/' + parts[1] : '')
        const text = '[HA] 检测到模型调用失败（' + from + '），已自动切换备用模型 ' + target.provider + '/' + target.model + '，请继续完成当前任务。'
        record(agent.id, failingKey || keyOf('*', '*'), target, code)
        console.log('[ha] steer after stop ' + agent.id + ' -> ' + target.provider + '/' + target.model + ' (' + code + ')')
        const timer = ctx.get('timer')
        const doSteer = () => {
          try {
            agent.steer({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'ha-orchestrator' } })
          } catch (e) { console.error('[ha] steer failed', e) }
        }
        // 延迟到 driver 回卷结束（idle）后再 steer，唤醒才能真正拉起新一轮
        if (timer) timer.timeout(doSteer, 300)
        else doSteer()
      } catch (e) { console.error('agent/error handler failed', e) }
    })

    // ================= 子智能体编排 =================
    function resolveProvider() {
      const subagents = ctx.get('subagents')
      if (!subagents) throw new Error('orchestrate: 子智能体服务不可用')
      const names = subagents.list()
      const wanted = state.config.orch.provider
      const name = wanted && names.indexOf(wanted) >= 0 ? wanted : (names[0] || '')
      if (!name) throw new Error('orchestrate: 没有可用的子智能体提供方')
      return name
    }
    function textBlocks(text) { return [{ type: 'text', text: String(text) }] }
    // 自定义子智能体：按名称查找启用项
    function resolveAgentDef(name) {
      if (!name) return null
      const agents = state.config.orch.agents || []
      const found = agents.find((a) => a && a.name === String(name))
      return found || null
    }
    function agentRosterText() {
      const agents = (state.config.orch.agents || []).filter((a) => a && a.name)
      if (agents.length === 0) return ''
      const lines = ['可用自定义子智能体（tasks[].agent 或顶层 agent 按名称指定）：']
      for (const a of agents) {
        const model = (a.provider ? a.provider + '/' : '') + (a.model || '默认模型')
        lines.push('- ' + a.name + '（' + model + '）' + (a.description ? '：' + a.description : ''))
      }
      return '\n' + lines.join('\n')
    }
    async function runOne(subagents, provider, task, extra, parent, signal, agentDef) {
      if (!signal) throw new Error('runOne: 缺少取消信号（signal），子智能体提供方需要真实 AbortSignal')
      const prompt = (extra ? '（承接上一阶段输出）\n\n' + extra + '\n\n---\n\n' : '') + task.prompt
      const request = {
        label: task.label || (agentDef && agentDef.name) || task.id || 'task',
        prompt: textBlocks(prompt),
        parent,
        signal,
      }
      if (agentDef) {
        // 自定义子智能体的系统提示词 -> persona（shadow 部署 persona，需 provider 支持 persona 能力）
        if (agentDef.systemPrompt) request.persona = agentDef.systemPrompt
        // 自定义模型 -> agentOptions（覆盖父的 provider/model 路由）
        const ao = {}
        if (agentDef.provider) ao.provider = String(agentDef.provider)
        if (agentDef.model) ao.model = String(agentDef.model)
        if (Object.keys(ao).length > 0) request.agentOptions = ao
      }
      const run = await subagents.start(provider, request)
      try {
        const res = await run.result
        const text = (res.output || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        return {
          id: String(task.id || task.label || 'task'),
          label: String(task.label || ''),
          agent: agentDef ? String(agentDef.name) : '',
          status: String(res.stopReason || 'completed'),
          output: text || '',
        }
      } finally {
        await run.dispose()
      }
    }
    async function poolRun(items, limit, worker) {
      const results = new Array(items.length)
      let next = 0
      async function slot() {
        while (next < items.length) {
          const i = next
          next += 1
          const item = items[i]
          try { results[i] = await worker(item, i) } catch (e) { results[i] = { id: String(item.id || item.label || 'task'), label: String(item.label || ''), agent: '', status: 'error', output: String((e && e.message) || e) } }
        }
      }
      const n = Math.max(1, Math.min(limit, items.length))
      await Promise.all(Array.from({ length: n }, () => slot()))
      return results
    }
    function summarize(runs) {
      const lines = ['编排完成，共 ' + runs.length + ' 个子任务：']
      for (const r of runs) {
        const head = (r.label || r.id) + (r.agent ? ' [via ' + r.agent + ']' : '') + ' [' + r.status + ']'
        const body = String(r.output || '').slice(0, 2000)
        lines.push('- ' + head + (body ? ': ' + body : ''))
      }
      return lines.join('\n').slice(0, 24000)
    }
    function buildOrchestrateTool() {
      return harness.defineTool({
      name: 'orchestrate',
      description: '自定义编排多个子智能体。' +
        'fanout：把 tasks 并行分发给子智能体执行并汇总；' +
        'pipeline：按顺序执行，每个任务的输出作为下一个任务的输入上下文；' +
        'supervisor：先并行执行全部任务，再启动一个监督子智能体按 mergeInstructions 审查并合成最终结论。' +
        '你是编排者：自行负责把目标拆解为 tasks（每个 task 有清晰、自包含的 prompt）。' +
        '每个 task 可用 agent 字段指定自定义子智能体名称；顶层 agent 参数可设默认子智能体，supervisorAgent 可指定监督子智能体；' +
        '不指定时使用默认模型。' +
        agentRosterText(),
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fanout', 'pipeline', 'supervisor'] },
          agent: { type: 'string', description: '默认自定义子智能体名称（可选，见描述中的可用列表）' },
          supervisorAgent: { type: 'string', description: 'supervisor 模式使用的监督子智能体名称（可选）' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                agent: { type: 'string', description: '自定义子智能体名称（可选）' },
                prompt: { type: 'string' },
              },
              required: ['prompt'],
            },
          },
          mergeInstructions: { type: 'string' },
          concurrency: { type: 'number' },
        },
        required: ['tasks'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string' },
            runs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  label: { type: 'string', required: true },
                  agent: { type: 'string' },
                  status: { type: 'string', required: true },
                  output: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render(args, value) {
          const v = value || {}
          const runs = v.runs || []
          const lines = [v.summary || '']
          for (const r of runs) {
            lines.push('[' + (r.label || r.id) + (r.agent ? ' via ' + r.agent : '') + '] ' + r.status + '\n' + String(r.output || '').slice(0, 3000))
          }
          return [{ type: 'text', text: lines.join('\n\n').slice(0, 30000) }]
        },
      },
      async execute(args, exec) {
        const cfg = state.config.orch
        if (!cfg.enabled) throw new Error('orchestrate: 编排功能已在配置页中禁用')
        if (!exec.agent) throw new Error('orchestrate: 缺少调用者 Agent 上下文')
        const subagents = ctx.get('subagents')
        if (!subagents) throw new Error('orchestrate: 子智能体服务不可用')
        const tasks = Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks.slice() : []
        if (tasks.length === 0) throw new Error('orchestrate: 至少需要一个任务')
        const maxAgents = Math.max(1, Number(cfg.maxAgents) || 8)
        if (tasks.length > maxAgents) tasks.length = maxAgents
        const provider = resolveProvider()
        const mode = args.mode || 'fanout'
        const concurrency = Math.max(1, Math.min(Number(args.concurrency) || Number(cfg.concurrency) || 3, maxAgents))
        const parent = exec.agent
        const signal = exec.signal
        const defaultDef = resolveAgentDef(args.agent)
        const availableNames = (state.config.orch.agents || []).map((a) => a.name)
        const unknown = []
        if (args.agent && !defaultDef) unknown.push(args.agent)
        for (const t of tasks) if (t && t.agent && !resolveAgentDef(t.agent)) unknown.push(t.agent)
        if (args.supervisorAgent && !resolveAgentDef(args.supervisorAgent)) unknown.push(args.supervisorAgent)
        if (unknown.length > 0) throw new Error('orchestrate: 未知子智能体 ' + unknown.map((n) => '"' + n + '"').join(', ') + '（可用：' + (availableNames.join(', ') || '无') + '）')
        const defFor = (t) => resolveAgentDef(t && t.agent) || defaultDef
        const worker = (task, i) => runOne(subagents, provider, task, '', parent, signal, defFor(task))
        let runs = []
        let summary = ''
        if (mode === 'pipeline') {
          let carry = ''
          for (let i = 0; i < tasks.length; i += 1) {
            if (signal.aborted) break
            const r = await runOne(subagents, provider, tasks[i], carry, parent, signal, defFor(tasks[i]))
            runs.push(r)
            carry = (carry ? carry + '\n\n' : '') + (r.output || '')
          }
          summary = 'pipeline 完成，最终输出：' + (carry || '(无输出)')
        } else if (mode === 'supervisor') {
          runs = await poolRun(tasks, concurrency, worker)
          const merged = summarize(runs)
          const instruction = String(args.mergeInstructions || '审查所有子任务输出，合并为一份准确、完整、去重的最终结论；标注仍然缺失或不确定的部分。')
          const supDef = resolveAgentDef(args.supervisorAgent) || defaultDef
          const sup = await runOne(subagents, provider, { id: 'supervisor', label: 'supervisor', prompt: instruction + '\n\n--- 子任务输出 ---\n\n' + merged }, '', parent, signal, supDef)
          summary = 'supervisor 结论：' + (sup.output || '(无输出)')
        } else {
          runs = await poolRun(tasks, concurrency, worker)
          summary = summarize(runs)
        }
        const finalRuns = runs.map((r) => ({ id: String(r.id), label: String(r.label || ''), agent: String(r.agent || ''), status: String(r.status), output: String(r.output || '') }))
        return { summary: String(summary || ''), runs: finalRuns }
      },
      })
    }
    // 作用域注册：残留的旧版本全局注册了 orchestrate，无法从本会话注销；
    // 通过 agent.ctx 的 scoped 注册 shadow 全局同名工具（错误提示推荐的路径）
    let orchestrateTool = buildOrchestrateTool()
    const orchInstalled = new Set()
    const orchDisposers = new Map()
    function installOrchestrate(agent) {
      try {
        if (!agent || !agent.ctx || orchInstalled.has(agent.id)) return
        orchInstalled.add(agent.id)
        const dispose = harness.registerTool(agent.ctx, orchestrateTool)
        orchDisposers.set(agent.id, dispose)
      } catch (e) {
        console.error('[ha] per-agent orchestrate registration failed', e)
      }
    }
    // 配置页改了自定义子智能体列表后重建工具（description 含最新清单）
    function reinstallOrchestrate() {
      for (const agentId of Array.from(orchInstalled)) {
        const dispose = orchDisposers.get(agentId)
        if (dispose) { try { dispose() } catch (e) { /* ignore */ } orchDisposers.delete(agentId) }
        orchInstalled.delete(agentId)
      }
      orchestrateTool = buildOrchestrateTool()
      try {
        const agents = ctx.get('agents')
        if (agents) agents.list().forEach(installOrchestrate)
      } catch (e) { console.error('[ha] agents list failed on reinstall', e) }
    }
    try {
      const agents = ctx.get('agents')
      if (agents) agents.list().forEach(installOrchestrate)
    } catch (e) { console.error('[ha] agents list failed', e) }
    ctx.on('agent/created', (payload) => { installOrchestrate(payload && payload.agent) })
    ctx.on('agent/disposed', (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      const dispose = orchDisposers.get(agent.id)
      if (dispose) { try { dispose() } catch (e) { /* ignore */ } orchDisposers.delete(agent.id) }
      orchInstalled.delete(agent.id)
    })

    // ================= 配置页 RPC =================
    function buildState(extra) {
      clearExpired()
      const out = {
        config: state.config,
        quarantine: [],
        history: state.history.slice(-20).reverse(),
      }
      for (const [k, v] of state.quarantine) {
        const parts = splitKey(k)
        out.quarantine.push({ provider: parts[0], model: parts[1], code: v.code, remainingMs: Math.max(0, v.until - now()) })
      }
      if (extra) for (const key of Object.keys(extra)) out[key] = extra[key]
      return out
    }
    harness.handle('state.get', async () => {
      const subagents = ctx.get('subagents')
      let llmProviders = []
      try {
        const llm = ctx.get('llm')
        if (llm) llmProviders = llm.listProviders().map((p) => ({ provider: String(p.id || p.provider || p.name || p), name: String(p.name || p.id || p.provider || p) }))
      } catch (e) { llmProviders = [] }
      return buildState({
        subagents: subagents ? subagents.list() : [],
        llmProviders,
        defaultSelection: currentDefaultSelection(),
      })
    })
    harness.handle('state.set', async (args) => {
      const patch = args && args.patch
      const next = sanitizeConfig(patch)
      const agentsChanged = next.orch && next.orch.agents !== undefined
      for (const key of Object.keys(next)) state.config[key] = next[key]
      if (patch && patch.ha && patch.ha.backups) { state.quarantine.clear(); state.failures.clear(); state.perAgent.clear() }
      providerCache = null
      persistConfig()
      // 自定义子智能体清单变化 -> 重建 orchestrate 工具（description 含最新清单）
      if (agentsChanged) reinstallOrchestrate()
      return buildState({
        subagents: (ctx.get('subagents') || { list: () => [] }).list(),
        llmProviders: [],
        defaultSelection: currentDefaultSelection(),
      })
    })
    harness.handle('models.list', async (args) => {
      const provider = args && args.provider ? String(args.provider) : ''
      if (!provider) return []
      const llm = ctx.get('llm')
      if (!llm) return []
      try {
        const infos = await llm.listModels(provider)
        return (infos || []).map((m) => ({
          provider: String(m.provider || provider),
          model: String(m.id || m.model || m.name || m),
          name: String(m.name || m.id || m.model || m),
        }))
      } catch (e) { return [] }
    })
    // ================= 智能新增子智能体（agents.generate） =================
    function parseAgentJson(text) {
      let t = String(text || '').trim()
      const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fence) t = fence[1].trim()
      const start = t.indexOf('{')
      const end = t.lastIndexOf('}')
      if (start >= 0 && end > start) t = t.slice(start, end + 1)
      try { return JSON.parse(t) } catch (e) { return null }
    }
    function uniqueAgentName(name) {
      let base = String(name || '').trim()
      if (!base) base = 'generated'
      const existing = new Set((state.config.orch.agents || []).map((a) => a && a.name))
      if (!existing.has(base)) return base
      let i = 2
      while (existing.has(base + ' ' + i)) i += 1
      return base + ' ' + i
    }
    harness.handle('agents.generate', async (args) => {
      try {
        const requirement = args && args.requirement ? String(args.requirement).trim() : ''
        if (!requirement) throw new Error('需求描述不能为空')
        const subagents = ctx.get('subagents')
        if (!subagents) throw new Error('子智能体服务不可用')
        const provider = resolveProvider()
        const agentsSvc = ctx.get('agents')
        const parent = (agentsSvc && (agentsSvc.currentInitiator() || agentsSvc.list()[0])) || null
        if (!parent) throw new Error('没有可用的 Agent 上下文')
        const sel = currentDefaultSelection()
        const modelHint = sel && sel.provider && sel.model
          ? '，当前默认模型：' + sel.provider + '/' + sel.model
          : ''
        let providers = []
        try {
          const llm = ctx.get('llm')
          if (llm) providers = llm.listProviders().map((p) => String(p.id || p.provider || p.name || p))
        } catch (e) { providers = [] }
        const prompt = '你是一个子智能体配置生成器。用户需求：' + requirement +
          '。请生成一个子智能体定义，只输出一个 JSON 对象（不要 markdown 代码块、不要任何其他文字），字段：' +
          '{ "name": "英文标识，2-20 字符，如 reviewer、critic、planner", ' +
          '"provider": "可选，可留空表示继承默认；可用 provider：' + (providers.join(', ') || '未知') + '", ' +
          '"model": "可选，可留空表示继承默认", ' +
          '"description": "一句话中文描述，展示给编排模型看，说明该子智能体的职责", ' +
          '"systemPrompt": "该子智能体的系统提示词（中文，80 字以内，说明角色与输出要求）" }' + modelHint
        const task = { id: 'gen-agent', label: 'generate', prompt }
        const def = sel && sel.provider && sel.model ? { provider: sel.provider, model: sel.model } : null
        // RPC 路径没有工具运行时提供的 signal，而 subagent 提供方（in-process driver）
        // 无条件读取 request.signal.aborted，必须传真实 AbortSignal。
        // 沙箱内无法 new AbortController，借用 agent.runMaintenance 的维护信号：
        // 会话空闲时可用，agent 被取消时自动中断子智能体。
        let run
        if (typeof parent.runMaintenance !== 'function') {
          throw new Error('运行时不支持 runMaintenance，无法生成子智能体')
        }
        try {
          run = await parent.runMaintenance((signal) => runOne(subagents, provider, task, '', parent, signal, def))
        } catch (e) {
          const busyMsg = String((e && e.message) || e)
          if (busyMsg.indexOf('already has active work') >= 0) {
            throw new Error('当前会话正忙（智能体未空闲），请稍后再试')
          }
          throw e
        }
        if (!run.output || run.status === 'max-tokens' || run.status === 'error') {
          throw new Error('生成失败（' + run.status + '），请重试或缩短需求描述')
        }
        const parsed = parseAgentJson(run.output)
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('未能解析模型输出，请重试。原始输出：' + String(run.output || '').slice(0, 300))
        }
        return {
          agent: {
            name: uniqueAgentName(parsed.name),
            provider: String(parsed.provider || ''),
            model: String(parsed.model || ''),
            description: String(parsed.description || ''),
            systemPrompt: String(parsed.systemPrompt || ''),
          },
        }
      } catch (e) {
        throw new Error('agents.generate: ' + String((e && e.message) || e))
      }
    })
    harness.handle('ha.reset', async () => {
      state.quarantine.clear()
      state.failures.clear()
      state.perAgent.clear()
      state.history = []
      return buildState({})
    })
  },
}
