// HA Orchestrator — static host plugin (composition row).
//
// Static adaptation of `host.js` (the dynamic cordis function body):
//   - `harness.defineTool`          -> `defineTool` from @deepseek-ai/dsh-tools
//   - `harness.registerTool(agent.ctx, t)` -> one `ctx.tools.register(t)` on the
//     plugin's own ctx (global visibility; per-agent workaround deleted)
//   - `harness.handle(name, fn)`    -> `HaOrchestratorRpc extends TypertRemoteService`
//     with @Remote methods (client calls `ctx.remote.haOrchestrator.<method>`)
//
// Cordis owns the row lifecycle: stop/unload disposes listeners, the tool
// registration, and the service — no stale "zombie" registrations survive an
// update, and the plugin loads automatically at process start (no redeploy).
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDictModule, resolveTarget, pickDict, makeT, translate } from './language.js'
import { defaultConfig, sanitizeConfig } from './config.js'
import {
  createHaState,
  keyOf as haKeyOf,
  splitKey as haSplitKey,
  matchesCodes as haMatchesCodes,
  clearExpired as haClearExpired,
  isExactQuarantined as haIsExactQuarantined,
  isBlocked as haIsBlocked,
  entryFor as haEntryFor,
  setEntry as haSetEntry,
  bumpFailure as haBumpFailure,
  quarantineKey as haQuarantineKey,
  recordHistory as haRecordHistory,
  findFallback as haFindFallback,
  pickFallback as haPickFallback,
  hasFallback as haHasFallback,
  maxRetriesFor as haMaxRetriesFor,
  computeFailingKey as haComputeFailingKey,
} from './ha-core.js'
import { buildSubagentRequest, buildSupervisorPrompt, appendPipelineCarry, findUnknownAgents, normalizeFinalRuns, normalizeRunResult, poolRun, renderRunOutput, resolveAgentDef as orchResolveAgentDef, resolveConcurrency, resolveMode, summarizeRuns, truncateTasks } from './orch-runner.js'
import { decorateRemoteMethod, runInitializers } from './remote.js'

const name = 'ha-orchestrator'
// tools：注册 orchestrate / list-subagents；systemPrompt：上下文注入段落。
// dsh-tools（tools 提供方）自身就 inject systemPrompt，因此 tools 可用时
// systemPrompt 必然已激活 —— 加入 inject 保证 apply 时服务必然存在，
// 消除「服务尚未就绪导致注入静默跳过」的启动竞态。
const inject = ['tools', 'systemPrompt']

// Remote 方法 marker 装配已官方化到 lib/remote.js（与官方 dsh-goal 编译产物同形）。

async function apply(ctx) {
  // ================= 配置与状态 =================
  const state = {
    config: JSON.parse(JSON.stringify(defaultConfig)),
    ...createHaState(),
    debugLogs: [],
  }
  let providerCache = null
  let providerCacheAt = 0
  const BACKOFF_BASE_MS = 250
  const BACKOFF_CAP_MS = 5000
  const DEBUG_LOG_CAP = 500

  // ================= 语言系统 =================
  // 语言包位于插件包根目录 `.language/`（zh.json / en.json），键集以 zh.json 为基准。
  // 启动时默认读取 DSH 当前语言选择（settings 命名空间 `locale` 的 preference），
  // 自动切换到目标语言包；目标语言包解析/加载失败时自动回滚到 zh。
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
  let langDicts = { zh: null, en: null }
  let langState = {
    active: 'zh',        // 生效语言（'zh' | 'en'）
    target: 'zh',        // 解析出的目标语言
    dshLocale: null,     // DSH 当前语言选择（'zh' | 'en' | null=未设置/未知）
    rollback: false,     // 是否发生过回滚
    rollbackReason: '',  // 回滚原因（目标语言标识）
    loaded: false,
  }
  let t = (key, params) => translate(langDicts[langState.active], key, params)
  // 工具（orchestrate / list-subagents）是否已注册；语言变化后需要重建工具
  let orchestrateReady = false
  // 读取插件包内文件：优先 node:fs（插件包真实路径），失败回退 fs 服务
  async function readPluginFile(rel) {
    try {
      const p = join(pluginRoot, rel)
      if (existsSync(p)) return readFileSync(p, 'utf8')
    } catch (e) { /* ignore */ }
    try {
      const fsService = ctx.get('fs')
      if (fsService && typeof fsService.resolve === 'function' && typeof fsService.readText === 'function') {
        const target = await fsService.resolve(rel, { cwd: pluginRoot })
        if (target) {
          const text = await fsService.readText(target)
          if (text != null) return String(text)
        }
      }
    } catch (e) { /* ignore */ }
    return null
  }
  async function loadDictionaries() {
    const zh = parseDictModule(await readPluginFile('.language/zh.json'))
    const en = parseDictModule(await readPluginFile('.language/en.json'))
    langDicts = { zh, en }
    return langDicts
  }
  // 读取 DSH 当前语言选择：settings 命名空间 `locale` 的 preference（'zh'|'en'）。
  // 该命名空间由内置 dsh-client-locale 插件注册；未注册/未设置时返回 null（默认 zh）。
  function dshLocaleNow() {
    try {
      const settings = ctx.get('settings')
      if (settings && typeof settings.get === 'function') {
        const sec = settings.get('locale')
        const pref = sec && typeof sec === 'object' ? sec.preference : undefined
        if (pref === 'zh' || pref === 'en') return pref
      }
    } catch (e) { /* ignore */ }
    return null
  }
  // 应用语言：加载字典 -> 解析目标（auto 跟随 DSH）-> 失败回滚 zh。
  // 生效语言变化后重建 orchestrate 工具（description 内嵌当前语言文案）。
  async function applyLanguage() {
    await loadDictionaries()
    const langCfg = state.config.lang || {}
    const mode = langCfg.mode === 'en' || langCfg.mode === 'zh' ? langCfg.mode : 'auto'
    const dshLocale = dshLocaleNow()
    const target = resolveTarget(mode, dshLocale)
    const picked = pickDict(langDicts, target)
    langState = {
      active: picked.active,
      target,
      dshLocale,
      rollback: picked.rollback,
      rollbackReason: picked.reason,
      loaded: true,
    }
    t = makeT(langDicts[picked.active] || {})
    try {
      if (orchestrateReady) reinstallTools()
    } catch (e) { console.error('[ha] reinstall tools after language switch failed', e) }
    debugLog('info', 'lang.apply', '插件语言已应用', {
      mode,
      dshLocale,
      target,
      active: picked.active,
      rollback: picked.rollback,
      reason: picked.reason,
      dictZh: !!langDicts.zh,
      dictEn: !!langDicts.en,
    })
    return langState
  }
  // auto 模式下 DSH 语言变化（settings/updated 或 RPC 时惰性）时重新跟随
  function maybeRefreshLanguage() {
    const mode = state.config.lang && state.config.lang.mode
    if (mode !== undefined && mode !== 'auto') return Promise.resolve()
    const d = dshLocaleNow()
    if (d === langState.dshLocale && langState.loaded) return Promise.resolve()
    return applyLanguage()
  }
  // 对外快照：UI 用当前生效字典渲染（t()），并展示语言状态
  function i18nSnapshot() {
    const dict = langDicts[langState.active] || {}
    return {
      mode: state.config.lang ? state.config.lang.mode : 'auto',
      active: langState.active,
      target: langState.target,
      dshLocale: langState.dshLocale || null,
      rollback: !!langState.rollback,
      rollbackReason: langState.rollbackReason || '',
      dicts: { zh: !!langDicts.zh, en: !!langDicts.en },
      dict,
      keys: Object.keys(dict).length,
    }
  }

  // ================= 调试日志（埋点） =================
  // 仅当 config.debug.enabled 时记录到内存环形缓冲（上限 DEBUG_LOG_CAP），
  // 同时镜像到进程 console，方便宿主侧开发观察。UI 经 debug.logs RPC 读取。
  function debugEnabled() {
    const d = state.config && state.config.debug
    return !!(d && d.enabled)
  }
  function debugLog(level, ev, msg, data) {
    if (!debugEnabled()) return
    // JSON 安全化：网关对 RPC 结果做 JSON 边界校验，条目里任何 undefined 值
    // 都会让 debugLogs/debugClear 结果被拒（"business result failed boundary validation"）。
    let safe = undefined
    if (data !== undefined) {
      try { safe = JSON.parse(JSON.stringify(data)) } catch (e) { safe = String(data) }
    }
    const entry = { at: new Date().toISOString(), level, ev, msg: String(msg) }
    if (safe !== undefined) entry.data = safe
    state.debugLogs.push(entry)
    if (state.debugLogs.length > DEBUG_LOG_CAP) state.debugLogs.splice(0, state.debugLogs.length - DEBUG_LOG_CAP)
    console.log('[ha:debug]', level, ev, msg, data === undefined ? '' : JSON.stringify(safe))
  }

  // ================= HA 纯逻辑桥接（lib/ha-core.js） =================
  // 本地保留与既有调用点同名的薄包装：把闭包内的 state / 配置 / 时钟注入纯函数。
  function now() { return Date.now() }
  function keyOf(provider, model) { return haKeyOf(provider, model) }
  function splitKey(k) { return haSplitKey(k) }
  function matchesCodes(codes, code) { return haMatchesCodes(codes, code) }
  function clearExpired() { haClearExpired(state, now()) }
  function isExactQuarantined(provider, model) { return haIsExactQuarantined(state, provider, model, now()) }
  function isBlocked(provider, model) { return haIsBlocked(state, provider, model, now()) }
  function entryFor(agentId) { return haEntryFor(state, agentId) }
  function setEntry(agentId, patch) { haSetEntry(state, agentId, patch) }
  function bumpFailure(k) { return haBumpFailure(state, state.config.ha, k, now()) }
  function quarantineKey(k, code) { haQuarantineKey(state, state.config.ha, k, code, now()) }
  function record(agentId, fromKey, target, code) { haRecordHistory(state, agentId, fromKey, target, code, now()) }
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
  function findFallback(agentId, excludeKey) { return haFindFallback(state, state.config.ha, registeredProviders(), agentId, excludeKey, now()) }
  function pickFallback(agentId, excludeKey) { return haPickFallback(state, state.config.ha, registeredProviders(), agentId, excludeKey, now()) }
  function hasFallback(agentId, excludeKey) { return haHasFallback(state, state.config.ha, registeredProviders(), agentId, excludeKey, now()) }
  // 失败重试退避：指数增长、封顶；沙箱无 setTimeout，走 timer 服务
  async function backoff(retries) {
    const timer = ctx.get('timer')
    if (!timer || typeof timer.timeout !== 'function') return
    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, (retries || 1) - 1)))
    try { await timer.timeout(delay) } catch (e) { /* ignore */ }
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
  // fs 服务每次用时再查：apply 阶段服务可能尚未就绪（组合行顺序/作用域），
  // 若在 apply 时一次性捕获进闭包，之后永远不会重新解析，持久化会静默失效。
  function fsServiceNow() {
    try { return ctx.get('fs') } catch (e) { return null }
  }

  // 会话 workspace：优先当前会话 cwd，拿不到回退 DSH 数据目录
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
  // fs 沙箱的 workspace-write 可写根（默认 DSH web 进程 cwd）：
  // workspace-write 模式下沙箱必然放行该根目录内的写入，是持久化的兜底位置
  function sandboxWritableRoot() {
    try {
      const sp = ctx.get('sandboxPolicy')
      if (sp && typeof sp.resolve === 'function') {
        const pol = sp.resolve()
        if (pol && pol.workspaceRoot) return String(pol.workspaceRoot)
      }
    } catch (e) { /* ignore */ }
    return ''
  }
  // 候选存储目录（写入与读取用同一顺序，保证重启后能找到）：
  //   1) 会话 workspace / DSH 数据目录（原逻辑；部分部署下沙箱放行）
  //   2) 沙箱 workspace-write 可写根（默认 DSH web 进程 cwd，workspace-write 下必可写）
  //   3) fs 后端默认 cwd（与 2 通常相同，兜底）
  function storageDirs() {
    const dirs = []
    const s1 = storageDir()
    if (s1) dirs.push(s1)
    const s2 = sandboxWritableRoot()
    if (s2 && dirs.indexOf(s2) < 0) dirs.push(s2)
    return dirs
  }
  async function resolveStorageTargetIn(dir, name) {
    const fsService = fsServiceNow()
    if (!fsService || typeof fsService.resolve !== 'function') return null
    try { return await fsService.resolve(name, dir ? { cwd: dir } : undefined) } catch (e) { return null }
  }
  async function readStorageTextIn(dir, name) {
    const fsService = fsServiceNow()
    const target = await resolveStorageTargetIn(dir, name)
    if (!target || !fsService || typeof fsService.readText !== 'function') return null
    try { return await fsService.readText(target) } catch (e) { return null }
  }
  async function readStorageText(name) {
    // 优先读最近一次成功写入的目录，避免启动/重载时因目录顺序变化而读到旧的默认配置。
    const dirs = []
    if (activeStorageDir) dirs.push(activeStorageDir)
    for (const dir of storageDirs()) {
      if (dirs.indexOf(dir) < 0) dirs.push(dir)
    }
    if (dirs.length === 0) return readStorageTextIn('', name)
    for (const dir of dirs) {
      const text = await readStorageTextIn(dir, name)
      if (text != null) return text
    }
    return null
  }
  function parseConfigJson(text) {
    if (text == null) return null
    try {
      const raw = JSON.parse(text)
      return raw && typeof raw === 'object' ? raw : null
    } catch (e) { return null }
  }
  async function loadPersistedConfig() {
    let raw = parseConfigJson(await readStorageText(CONFIG_FILE))
    if (!raw) raw = parseConfigJson(await readStorageText(CONFIG_BACKUP))
    if (!raw) return false
    const next = sanitizeConfig(raw, defaultConfig)
    for (const key of Object.keys(next)) state.config[key] = next[key]
    configLoaded = true
    console.log('[ha] config restored from JSON file')
    debugLog('info', 'config.restored', '配置从 JSON 文件恢复')
    return true
  }
  // 启动时 fs / agents / sandboxPolicy / timer 等服务可能尚未就绪，loadPersistedConfig 首次
  // 可能静默失败，导致插件更新/HMR 后只看到默认配置。这里同时提供：
  //   1) 定时重试（沿用 systemPrompt 注入的重试策略）；
  //   2) stateGet 懒加载兜底——设置页每次拉状态时若还没成功加载过，会再尝试一次。
  let configLoaded = false
  let configLoadPromise = null
  let configLoadRetries = 0
  const CONFIG_LOAD_MAX_RETRIES = 30
  const CONFIG_LOAD_RETRY_MS = 2000
  async function retryLoadPersistedConfig() {
    const ok = await loadPersistedConfig()
    if (ok) {
      console.log('[ha] config restored after retry')
      debugLog('info', 'config.restored.retry', '配置在服务就绪后恢复')
      try { reinstallTools() } catch (e) { console.error('[ha] reinstall tools after config retry failed', e) }
      await applyLanguage().catch((e) => console.error('[ha] apply language after config retry failed', e))
      return
    }
    scheduleConfigLoadRetry()
  }
  function scheduleConfigLoadRetry() {
    if (configLoadRetries >= CONFIG_LOAD_MAX_RETRIES) return
    configLoadRetries += 1
    const timer = ctx.get('timer')
    if (!timer || typeof timer.timeout !== 'function') return
    try { timer.timeout(() => retryLoadPersistedConfig(), CONFIG_LOAD_RETRY_MS) } catch (e) { /* ignore */ }
  }
  // 供 stateGet 调用：如果启动时没加载成功，则在这里补一次加载；成功后重建工具并跟随语言。
  function ensureConfigLoaded() {
    if (configLoaded) return Promise.resolve()
    if (!configLoadPromise) {
      configLoadPromise = loadPersistedConfig()
        .then((ok) => {
          configLoadPromise = null
          if (!ok) return false
          try { reinstallTools() } catch (e) { console.error('[ha] reinstall tools after lazy config load failed', e) }
          return applyLanguage().catch((e) => console.error('[ha] apply language after lazy config load failed', e))
        })
        .catch((e) => {
          configLoadPromise = null
          console.error('[ha] lazy config load failed', e)
        })
    }
    return configLoadPromise
  }
  // 持久化状态：回显到 state.get / stateSet 响应，UI 展示，失败不再静默
  let activeStorageDir = ''
  let persistState = { ok: false, path: '', error: '' }
  // 失败时的诊断信息：fs 服务类型、writeText 是否存在、沙箱策略
  function persistDiag() {
    const out = {}
    try {
      const fs = fsServiceNow()
      out.fsType = fs === null ? 'null' : typeof fs
      out.fsWriteText = !!(fs && typeof fs.writeText === 'function')
      out.fsResolve = !!(fs && typeof fs.resolve === 'function')
      const sp = ctx.get('sandboxPolicy')
      out.sandboxPolicy = !!(sp && typeof sp.resolve === 'function')
      if (sp && typeof sp.resolve === 'function') {
        try {
          const pol = sp.resolve()
          out.policy = { mode: pol && pol.mode || '', workspaceRoot: pol && pol.workspaceRoot || '' }
        } catch (e) { out.policyError = String((e && e.message) || e) }
      }
    } catch (e) { out.error = String((e && e.message) || e) }
    return out
  }
  async function persistConfig() {
    const fsService = fsServiceNow()
    if (!fsService || typeof fsService.writeText !== 'function') {
      persistState = { ok: false, path: '', error: 'fs 服务不可用（无 writeText）', diag: persistDiag() }
      console.error('[ha] persist config failed: fs service unavailable', persistState.diag)
      return false
    }
    const text = JSON.stringify(state.config, null, 2)
    const dirs = activeStorageDir ? [activeStorageDir] : storageDirs()
    let lastErr = 'no writable location'
    for (const dir of dirs) {
      const target = await resolveStorageTargetIn(dir, CONFIG_FILE)
      if (!target) { lastErr = 'resolve failed: ' + (dir || 'default cwd'); continue }
      try {
        const backupTarget = await resolveStorageTargetIn(dir, CONFIG_BACKUP)
        const prev = await readStorageTextIn(dir, CONFIG_FILE)
        if (prev != null && backupTarget) {
          try { await fsService.writeText(backupTarget, prev) } catch (e) { /* 备份失败不影响主写 */ }
        }
        await fsService.writeText(target, text)
        activeStorageDir = dir
        persistState = { ok: true, path: String(target.displayPath || ''), error: '' }
        console.log('[ha] config persisted:', persistState.path)
        debugLog('info', 'config.persisted', '配置已写入磁盘', { file: persistState.path })
        return true
      } catch (e) {
        lastErr = String((e && e.message) || e)
      }
    }
    persistState = { ok: false, path: '', error: lastErr, diag: persistDiag() }
    console.error('[ha] persist config failed:', lastErr, persistState.diag)
    debugLog('error', 'config.persist.failed', '配置写入失败', { error: lastErr })
    return false
  }
  const loadedAtStart = await loadPersistedConfig()
  if (!loadedAtStart) scheduleConfigLoadRetry()
  // 语言系统：启动时默认读取 DSH 当前语言选择并切换到目标语言包，
  // 失败自动回滚 zh。必须在 orchestrate 工具构建之前执行，
  // 保证工具 description 从一开始就使用正确的语言文案。
  await applyLanguage()
  debugLog('info', 'plugin.ready', '静态插件已就绪（调试模式开启，开始记录事件）')

  // ================= 高可用：失败回退 =================
  // prepend: true 保证本插件监听器在瀑布流最外层，拥有最终决定权
  ctx.on('agent/request', async (payload, next) => {
    try {
      const cfg = state.config.ha
      if (!cfg.enabled || !cfg.backups || cfg.backups.length === 0) return next()
      const config = await next()
      if (!config || !config.provider || !config.model) return config
      const k = keyOf(config.provider, config.model)
      setEntry(payload.agent.id, { lastKey: k })
      debugLog('debug', 'ha.request', '模型请求进入', { agent: payload.agent.id, provider: config.provider, model: config.model })
      if (!isBlocked(config.provider, config.model)) {
        // 仅在该模型无未过期失败累积（真正健康）时清零重试计数，避免阈值累积期被误清零
        if (!state.failures.has(k)) setEntry(payload.agent.id, { retries: 0 })
        return config
      }
      debugLog('warn', 'ha.blocked', '模型被隔离，尝试挑选备用', { key: k })
      const target = pickFallback(payload.agent.id, k)
      if (!target) {
        debugLog('warn', 'ha.blocked', '无可用备用，放行原模型', { key: k })
        return config
      }
      // 实际切换点：只有这里才推进游标并写历史，保证记录与实际使用一致
      const entry = entryFor(payload.agent.id)
      record(payload.agent.id, k, target, entry.failCode || '')
      setEntry(payload.agent.id, { lastKey: target.key, failCode: '' })
      if (cfg.persistSelection) tryPersist(target)
      debugLog('info', 'ha.switch', '切换到备用模型', {
        agent: payload.agent.id,
        from: config.provider + '/' + config.model,
        to: target.provider + '/' + target.model,
        code: entry.failCode || '',
      })
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
      const entry = entryFor(agent.id)
      debugLog('debug', 'ha.error', '模型请求失败', { agent: agent.id, provider, code })
      // 精确键优先（agent/request 已记录 lastKey），拿不到才降级 provider 通配键
      const failingKey = haComputeFailingKey(entry, provider)
      const maxRetries = haMaxRetriesFor(cfg)
      if ((entry.retries || 0) >= maxRetries) {
        debugLog('warn', 'ha.budget', '重试预算耗尽，放行（电路熔断）', { agent: agent.id, failingKey, retries: entry.retries || 0, maxRetries })
        return next()
      }
      const nextRetries = (entry.retries || 0) + 1
      const count = bumpFailure(failingKey)
      if (count < cfg.threshold) {
        // 阈值内：不隔离、不切换，带退避重试原模型
        setEntry(agent.id, { retries: nextRetries })
        debugLog('info', 'ha.retry', '阈值内带退避重试原模型', { agent: agent.id, failingKey, count, threshold: cfg.threshold, retry: nextRetries })
        await backoff(nextRetries)
        return { kind: 'retry' }
      }
      if (!hasFallback(agent.id, failingKey)) {
        debugLog('warn', 'ha.quarantine', '达到阈值但无可用备用，放行（不隔离不重试）', { agent: agent.id, failingKey, code })
        return next()
      }
      quarantineKey(failingKey, code)
      setEntry(agent.id, { retries: nextRetries, failCode: code })
      console.log('[ha] failover ' + agent.id + ' ' + failingKey + ' (quarantined, ' + code + ')')
      debugLog('warn', 'ha.quarantine', '隔离失败模型并重试备用', { agent: agent.id, key: failingKey, code, cooldownMs: cfg.cooldownMs, retry: nextRetries })
      await backoff(nextRetries)
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
      const entry = entryFor(agent.id)
      const failingKey = entry.lastKey || ''
      // 关键：先隔离失败模型，保证下一次请求（无论手动还是自动唤醒）直接用备用模型
      if (failingKey) quarantineKey(failingKey, code)
      if (entry.steeredTurn === turn) return
      if (!hasFallback(agent.id, failingKey)) return
      setEntry(agent.id, { steeredTurn: turn, failCode: code })
      const text = t('ha.steerText')
      console.log('[ha] steer after stop ' + agent.id + ' (' + code + ')')
      debugLog('warn', 'ha.steer', '模型错误中断，延迟 steer 继续任务', { agent: agent.id, code, turn, failingKey })
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
    if (!subagents) throw new Error(t('orch.errNoService'))
    const names = subagents.list()
    const wanted = state.config.orch.provider
    const name = wanted && names.indexOf(wanted) >= 0 ? wanted : (names[0] || '')
    if (!name) throw new Error(t('orch.errNoProvider'))
    return name
  }
  // 自定义子智能体：按名称查找启用项
  function resolveAgentDef(name) {
    return orchResolveAgentDef(state.config.orch.agents, name)
  }
  // 子智能体清单不再内嵌到工具描述/系统提示词：模型按需调用内置 list-subagents
  // 工具获取（名称/provider/模型/描述），避免每轮注入占用上下文。
  async function runOne(subagents, provider, task, extra, parent, signal, agentDef) {
    if (!signal) throw new Error('runOne: 缺少取消信号（signal），子智能体提供方需要真实 AbortSignal')
    const runLabel = String(task.label || task.id || 'task')
    const agentName = agentDef ? String(agentDef.name) : ''
    debugLog('debug', 'orch.task.start', '子智能体任务开始', { label: runLabel, agent: agentName, provider })
    const request = buildSubagentRequest(task, extra, agentDef, t('orch.mergedPrefix'), parent, signal)
    const run = await subagents.start(provider, request)
    try {
      const res = await run.result
      const status = String(res.stopReason || 'completed')
      const text = (res.output || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
      debugLog('debug', 'orch.task.end', '子智能体任务结束', { label: runLabel, agent: agentName, status, outputChars: text.length })
      return normalizeRunResult(task, agentDef, res)
    } catch (e) {
      debugLog('error', 'orch.task.error', '子智能体任务失败', { label: runLabel, agent: agentName, message: String((e && e.message) || e) })
      throw e
    } finally {
      await run.dispose()
    }
  }
  // 汇总 runs 为纯文本（注入当前语言的 t，供 supervisor / fanout 使用）
  function summarize(runs) { return summarizeRuns(runs, t) }
  function buildOrchestrateTool() {
    const joinSep = langState.active === 'en' ? ' ' : ''
    const descParts = [
      t('orch.toolAutoUse'),
      t('orch.toolIntro'),
      t('orch.toolFanout'),
      t('orch.toolPipeline'),
      t('orch.toolSupervisor'),
      t('orch.toolYouAre'),
      t('orch.toolAgentField'),
      t('orch.toolDefault'),
    ]
    return defineTool({
      name: 'orchestrate',
      description: descParts.join(joinSep) + t('orch.rosterHint'),
      parameters: {
        mode: { type: 'string', enum: ['fanout', 'pipeline', 'supervisor'] },
        agent: { type: 'string', description: '默认自定义子智能体名称（可选；可用列表调用 list-subagents 查询）' },
        supervisorAgent: { type: 'string', description: 'supervisor 模式使用的监督子智能体名称（可选；可用列表调用 list-subagents 查询）' },
        tasks: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              agent: { type: 'string', description: '自定义子智能体名称（可选；可用列表调用 list-subagents 查询）' },
              prompt: { type: 'string', required: true },
            },
          },
        },
        mergeInstructions: { type: 'string' },
        concurrency: { type: 'number' },
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
          return renderRunOutput(value)
        },
      },
      async execute(args, exec) {
        try {
          const cfg = state.config.orch
          if (!cfg.enabled) throw new Error(t('orch.errDisabled'))
          if (!exec.agent) throw new Error(t('orch.errNoAgentCtx'))
          const subagents = ctx.get('subagents')
          if (!subagents) throw new Error(t('orch.errNoService'))
          const rawTasks = Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks.slice() : []
          if (rawTasks.length === 0) throw new Error(t('orch.errNoTasks'))
          const maxAgents = Math.max(1, Number(cfg.maxAgents) || 8)
          const tasks = truncateTasks(rawTasks, maxAgents)
          const provider = resolveProvider()
          const mode = resolveMode(args.mode)
          const concurrency = resolveConcurrency(args.concurrency, cfg.concurrency, maxAgents)
          const parent = exec.agent
          const signal = exec.signal
          const defaultDef = resolveAgentDef(args.agent)
          const { availableNames, unknown } = findUnknownAgents(args, tasks, state.config.orch.agents || [])
          if (unknown.length > 0) throw new Error(t('orch.errUnknownAgent', {
            names: unknown.map((n) => '"' + n + '"').join(', '),
            available: availableNames.join(', ') || t('common.none'),
          }))
          const defFor = (tk) => resolveAgentDef(tk && tk.agent) || defaultDef
          const worker = (task, i) => runOne(subagents, provider, task, '', parent, signal, defFor(task))
          debugLog('info', 'orch.start', 'orchestrate 调用', { agent: String(exec.agent.id || ''), mode, tasks: tasks.length, concurrency, provider, defaultAgent: args.agent || '' })
          let runs = []
          let summary = ''
          if (mode === 'pipeline') {
            let carry = ''
            for (let i = 0; i < tasks.length; i += 1) {
              if (signal.aborted) break
              const r = await runOne(subagents, provider, tasks[i], carry, parent, signal, defFor(tasks[i]))
              runs.push(r)
              carry = appendPipelineCarry(carry, r.output || '')
            }
            summary = t('orch.sumPipeline', { out: carry || t('orch.sumNoOutput') })
          } else if (mode === 'supervisor') {
            runs = await poolRun(tasks, concurrency, worker)
            const merged = summarize(runs)
            const instruction = String(args.mergeInstructions || t('orch.mergeDefault'))
            const supDef = resolveAgentDef(args.supervisorAgent) || defaultDef
            const supPrompt = buildSupervisorPrompt(instruction, merged, t('orch.outputSeparator'))
            const sup = await runOne(subagents, provider, { id: 'supervisor', label: 'supervisor', prompt: supPrompt }, '', parent, signal, supDef)
            summary = t('orch.sumSupervisor', { out: sup.output || t('orch.sumNoOutput') })
          } else {
            runs = await poolRun(tasks, concurrency, worker)
            summary = summarize(runs)
          }
          const finalRuns = normalizeFinalRuns(runs)
          debugLog('info', 'orch.done', 'orchestrate 完成', { mode, runs: finalRuns.length, aborted: signal.aborted })
          return { summary: String(summary || ''), runs: finalRuns }
        } catch (e) {
          debugLog('error', 'orch.error', 'orchestrate 执行失败', { message: String((e && e.message) || e) })
          throw e
        }
      },
    })
  }

  // list-subagents：按需查询可用自定义子智能体清单（名称/provider/模型/描述）。
  // 清单不再每轮注入系统提示词，模型需要时调用本工具获取（上下文按需加载）。
  function buildListSubagentsTool() {
    return defineTool({
      name: 'list-subagents',
      description: t('orch.toolListSubagents'),
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            agents: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        render(args, value) {
          const v = value || {}
          const agents = v.agents || []
          if (!Array.isArray(agents) || agents.length === 0) {
            return [{ type: 'text', text: t('common.none') }]
          }
          const lines = agents.map((a) => {
            const model = (a.provider ? a.provider + '/' : '') + (a.model || t('common.defaultModel'))
            return '- ' + a.name + ' (' + model + ')' + (a.description ? ': ' + a.description : '')
          })
          return [{ type: 'text', text: t('orch.rosterHead') + '\n' + lines.join('\n') }]
        },
      },
      async execute() {
        debugLog('debug', 'orch.list', 'list-subagents 调用', { count: (state.config.orch.agents || []).length })
        const agents = (state.config.orch.agents || [])
          .filter((a) => a && a.name)
          .map((a) => ({
            name: String(a.name),
            provider: String(a.provider || ''),
            model: String(a.model || ''),
            description: String(a.description || ''),
          }))
        return { agents }
      },
    })
  }

  // 静态注册：工具注册在插件自己的 ctx（全局可见，所有会话的 agent 都能调用）。
  // Cordis 管理行生命周期 —— 卸载/更新时自动 dispose，不会有残留注册（zombie）。
  // orchestrate：自动编排；list-subagents：按需查询可用自定义子智能体清单。
  let toolDisposes = []
  function installTools() {
    for (const d of toolDisposes) { try { d() } catch (e) { /* ignore */ } }
    toolDisposes = [
      ctx.tools.register(buildOrchestrateTool()),
      ctx.tools.register(buildListSubagentsTool()),
    ]
    orchestrateReady = true
  }
  installTools()
  ctx.effect(() => () => {
    for (const d of toolDisposes) { try { d() } catch (e) { /* ignore */ } }
  })
  // 配置页改了自定义子智能体列表 / 语言切换后重建工具（description 含最新清单与当前语言）
  function reinstallTools() {
    installTools()
  }

  // ================= 上下文注入（systemPrompt 段落） =================
  // 向系统提示词注入一段插件上下文。开关在系统卡片（config.ctx.enabled）：
  //   - 开启：注入内容 = 用户自定义上下文 config.ctx.text（原文，不翻译）；
  //     留空则回退注入默认的自动编排引导（orch.hintSection，编排启用时），
  //     让模型在适合并行拆解/多阶段/评审把关的任务上自动调用 orchestrate，
  //     无需用户显式说“使用 ha-orchestrator”。
  //   - 关闭：整段为空（组装器丢弃），模型不获得任何插件上下文。
  // text 为函数：每次组装时求值，跟随当前语言与最新配置。
  // 段落 order 取 40：紧随部署 persona（0）之后、plan-mode（50）与工具引导
  // （100–199）之前，保证自动编排引导处于提示词最醒目位置（原 500 沉底，
  // 模型几乎注意不到，是“从不自动触发编排”的主因之一）。
  // 默认引导文本自带【ha-orchestrator 插件上下文】标记，便于在轨迹里检索验证。
  // 注入状态（注册与否/最近一次求值）写入 injectionStatus，经 stateGet 暴露
  // 给设置页「系统」卡片实时展示，无需开启调试模式即可验证。
  // 注册失败不再静默：console 可见 + 定时重试（30 次，2s 间隔，兜底其它部署）。
  let contextInjectDispose = null
  let contextInjectRetries = 0
  const injectionStatus = { registered: false, order: 40, reason: '', lastEval: null }
  function injectionStatusSnapshot() {
    return {
      registered: !!injectionStatus.registered,
      order: injectionStatus.order,
      reason: String(injectionStatus.reason || ''),
      lastEval: injectionStatus.lastEval ? { ...injectionStatus.lastEval } : null,
    }
  }
  function installContextInjection() {
    try { if (contextInjectDispose) { contextInjectDispose(); contextInjectDispose = null } } catch (e) { /* ignore */ }
    const sp = ctx.get('systemPrompt')
    if (!sp || typeof sp.section !== 'function') {
      injectionStatus.registered = false
      injectionStatus.reason = 'systemPrompt 服务不可用'
      console.warn('[ha] context injection: systemPrompt service unavailable (attempt ' + (contextInjectRetries + 1) + '/30), retrying in 2s')
      debugLog('warn', 'ctx.inject.unavailable', 'systemPrompt 服务不可用，上下文注入未注册', { hasService: !!sp })
      scheduleContextInjectionRetry()
      return
    }
    try {
      contextInjectDispose = sp.section({
        name: 'ha-orchestrator:context',
        order: 40,
        text: () => {
          const ctxCfg = state.config && state.config.ctx
          if (!ctxCfg || !ctxCfg.enabled) {
            injectionStatus.lastEval = { mode: 'off', chars: 0 }
            debugLog('debug', 'ctx.inject.eval', '上下文注入求值：已关闭，不注入', { enabled: false })
            return ''
          }
          const custom = String(ctxCfg.text || '').trim()
          if (custom) {
            injectionStatus.lastEval = { mode: 'custom', chars: custom.length }
            debugLog('debug', 'ctx.inject.eval', '上下文注入求值：自定义内容', { enabled: true, mode: 'custom', chars: custom.length })
            return custom
          }
          const orch = state.config && state.config.orch
          if (orch && orch.enabled) {
            const hint = t('orch.hintSection')
            injectionStatus.lastEval = { mode: 'default', chars: hint.length }
            debugLog('debug', 'ctx.inject.eval', '上下文注入求值：默认自动编排引导', { enabled: true, mode: 'fallback', language: langState.active })
            return hint
          }
          injectionStatus.lastEval = { mode: 'empty', chars: 0 }
          debugLog('debug', 'ctx.inject.eval', '上下文注入求值：无可用内容', { enabled: true, mode: 'empty' })
          return ''
        },
      })
      injectionStatus.registered = true
      injectionStatus.reason = ''
      contextInjectRetries = 0
      console.log('[ha] context injection registered: section "ha-orchestrator:context" (order 40)')
      debugLog('info', 'ctx.inject.install', '上下文注入段落已注册', { section: 'ha-orchestrator:context', order: 40 })
    } catch (e) {
      injectionStatus.registered = false
      injectionStatus.reason = '注册失败：' + String((e && e.message) || e)
      console.error('[ha] install systemPrompt context injection failed', e)
      debugLog('error', 'ctx.inject.install.failed', '上下文注入段落注册失败', { error: String((e && e.message) || e) })
    }
  }
  function scheduleContextInjectionRetry() {
    if (contextInjectRetries >= 30) {
      console.error('[ha] context injection: giving up after 30 attempts (systemPrompt service never appeared)')
      return
    }
    contextInjectRetries += 1
    const timer = ctx.get('timer')
    if (!timer || typeof timer.timeout !== 'function') return
    try { timer.timeout(() => installContextInjection(), 2000) } catch (e) { /* ignore */ }
  }
  installContextInjection()
  ctx.effect(() => () => {
    try { if (contextInjectDispose) contextInjectDispose() } catch (e) { /* ignore */ }
  })

  // ================= 语言系统：运行期跟随 DSH =================
  // 启动切换已在工具注册前完成（见 loadPersistedConfig 之后）；
  // auto 模式下 DSH 语言在运行期变化（用户改 DSH 语言）时自动跟随
  ctx.on('settings/updated', (ns) => {
    if (ns !== 'locale') return
    const mode = state.config.lang && state.config.lang.mode
    if (mode === undefined || mode === 'auto') {
      maybeRefreshLanguage().catch((e) => console.error('[ha] follow DSH locale failed', e))
    }
  })

  // ================= 配置页 RPC（Remote 服务，client 经 ctx.remote.haOrchestrator 调用） =================
  function buildState(extra) {
    clearExpired()
    const out = {
      config: state.config,
      quarantine: [],
      history: state.history.slice(-20).reverse(),
      persist: persistState,
      i18n: i18nSnapshot(),
      ctxInject: injectionStatusSnapshot(),
    }
    for (const [k, v] of state.quarantine) {
      const parts = splitKey(k)
      out.quarantine.push({ provider: parts[0], model: parts[1], code: v.code, remainingMs: Math.max(0, v.until - now()) })
    }
    if (extra) for (const key of Object.keys(extra)) out[key] = extra[key]
    return out
  }
  function llmProviderList() {
    let llmProviders = []
    try {
      const llm = ctx.get('llm')
      if (llm) llmProviders = llm.listProviders().map((p) => ({ provider: String(p.id || p.provider || p.name || p), name: String(p.name || p.id || p.provider || p) }))
    } catch (e) { llmProviders = [] }
    return llmProviders
  }
  function subagentList() {
    const subagents = ctx.get('subagents')
    return subagents ? subagents.list() : []
  }
  // ================= 智能新增子智能体（agents.generate） =================
  function parseAgentJson(text) {
    let body = String(text || '').trim()
    const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) body = fence[1].trim()
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) body = body.slice(start, end + 1)
    try { return JSON.parse(body) } catch (e) { return null }
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
  async function generateAgent(requirementRaw) {
    const requirement = requirementRaw && String(requirementRaw).trim() ? String(requirementRaw).trim() : ''
    if (!requirement) throw new Error(t('agents.errRequire'))
    const subagents = ctx.get('subagents')
    if (!subagents) throw new Error(t('orch.errNoService'))
    const provider = resolveProvider()
    const agentsSvc = ctx.get('agents')
    const parent = (agentsSvc && (agentsSvc.currentInitiator() || agentsSvc.list()[0])) || null
    if (!parent) throw new Error(t('agents.errNoAgent'))
    const sel = currentDefaultSelection()
    const modelHint = sel && sel.provider && sel.model
      ? t('agents.genModelHint', { model: sel.provider + '/' + sel.model })
      : ''
    let providers = []
    try {
      const llm = ctx.get('llm')
      if (llm) providers = llm.listProviders().map((p) => String(p.id || p.provider || p.name || p))
    } catch (e) { providers = [] }
    const prompt = t('agents.genIntro') + requirement + t('agents.genSuffix') +
      '{ ' + t('agents.genFieldName') + ', ' +
      t('agents.genFieldProvider', { providers: providers.join(', ') || t('common.unknown') }) + ', ' +
      t('agents.genFieldModel') + ', ' +
      t('agents.genFieldDesc') + ', ' +
      t('agents.genFieldSp', { lang: t('agents.genLang') }) + ' }' + modelHint
    const task = { id: 'gen-agent', label: 'generate', prompt }
    const def = sel && sel.provider && sel.model ? { provider: sel.provider, model: sel.model } : null
    // RPC 路径没有工具运行时提供的 signal，而 subagent 提供方（in-process driver）
    // 无条件读取 request.signal.aborted，必须传真实 AbortSignal。
    // 借用 agent.runMaintenance 的维护信号：会话空闲时可用，agent 被取消时自动中断子智能体。
    let run
    if (typeof parent.runMaintenance !== 'function') {
      throw new Error('运行时不支持 runMaintenance，无法生成子智能体')
    }
    try {
      run = await parent.runMaintenance((signal) => runOne(subagents, provider, task, '', parent, signal, def))
    } catch (e) {
      const busyMsg = String((e && e.message) || e)
      if (busyMsg.indexOf('already has active work') >= 0) {
        throw new Error(t('agents.errBusy'))
      }
      throw e
    }
    if (!run.output || run.status === 'max-tokens' || run.status === 'error') {
      throw new Error(t('agents.errGenFailed', { status: run.status }))
    }
    const parsed = parseAgentJson(run.output)
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(t('agents.errParse', { out: String(run.output || '').slice(0, 300) }))
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
  }

  // ---- Remote RPC 服务（client: ctx.remote.haOrchestrator.<method>） ----
  const remoteInitializers = []
  const HaOrchestratorRpc = class HaOrchestratorRpc extends TypertRemoteService {
    constructor() {
      super(ctx, 'haOrchestrator')
      runInitializers(this, remoteInitializers)
    }
    async stateGet() {
      // auto 模式下惰性跟随：settings 服务/`locale` 命名空间可能晚于本插件就绪
      await maybeRefreshLanguage().catch(() => {})
      // 启动时若因服务未就绪没读到配置，这里补一次加载；设置页轮询会自动带上 executor。
      await ensureConfigLoaded().catch(() => {})
      return buildState({
        subagents: subagentList(),
        llmProviders: llmProviderList(),
        defaultSelection: currentDefaultSelection(),
      })
    }
    // 重新加载：从磁盘重新读取持久化配置并应用（含语言跟随/工具重建），返回最新状态
    async stateReload() {
      try {
        await loadPersistedConfig()
      } catch (e) {
        console.error('[ha] stateReload loadPersistedConfig failed', e)
      }
      await applyLanguage().catch((e) => console.error('[ha] stateReload applyLanguage failed', e))
      debugLog('info', 'rpc.stateReload', '配置已从磁盘重新加载')
      return buildState({
        subagents: subagentList(),
        llmProviders: llmProviderList(),
        defaultSelection: currentDefaultSelection(),
      })
    }
    async stateSet(args) {
      const patch = args && args.patch
      const next = sanitizeConfig(patch, state.config)
      const agentsChanged = next.orch && next.orch.agents !== undefined
      const langChanged = next.lang !== undefined
      const backupsChanged =
        next.ha
          ? JSON.stringify(next.ha.backups) !== JSON.stringify((state.config.ha || {}).backups)
          : false
      for (const key of Object.keys(next)) state.config[key] = next[key]
      if (backupsChanged) { state.quarantine.clear(); state.failures.clear(); state.perAgent.clear() }
      providerCache = null
      await persistConfig()
      // 自定义子智能体清单变化 -> 重建工具（orchestrate / list-subagents 描述与查询提示随之更新）
      if (agentsChanged) reinstallTools()
      // 插件语言变化 -> 重新应用语言（失败自动回滚 zh），工具文案随之重建
      if (langChanged) await applyLanguage().catch((e) => console.error('[ha] apply language failed', e))
      debugLog('info', 'rpc.stateSet', '配置已更新', {
        ha: patch && patch.ha ? Object.keys(patch.ha) : undefined,
        orch: patch && patch.orch ? Object.keys(patch.orch) : undefined,
        debug: patch && patch.debug ? patch.debug : undefined,
        lang: patch && patch.lang ? patch.lang : undefined,
        ctx: patch && patch.ctx ? patch.ctx : undefined,
      })
      if (patch && patch.ctx && typeof patch.ctx === 'object') {
        debugLog('info', 'ctx.inject.config', '上下文注入配置已更新', {
          enabled: state.config.ctx.enabled,
          textChars: String(state.config.ctx.text || '').length,
        })
      }
      return buildState({
        subagents: subagentList(),
        llmProviders: [],
        defaultSelection: currentDefaultSelection(),
      })
    }
    async modelsList(args) {
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
    }
    agentsGenerate(args) {
      debugLog('info', 'orch.generate', '智能生成子智能体', { requirement: String((args && args.requirement) || '').slice(0, 100) })
      return generateAgent(args && args.requirement)
    }
    haReset() {
      state.quarantine.clear()
      state.failures.clear()
      state.perAgent.clear()
      state.history = []
      debugLog('info', 'ha.reset', '清除隔离、失败计数与历史')
      return buildState({})
    }
    debugLogs() {
      return { enabled: debugEnabled(), logs: state.debugLogs.slice() }
    }
    debugClear() {
      state.debugLogs = []
      debugLog('info', 'debug.clear', '调试日志已清空')
      return { enabled: debugEnabled(), logs: [] }
    }
  }
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateGet', 'stateGet', remoteInitializers)
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateReload', 'stateReload', remoteInitializers)
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateSet', 'stateSet', remoteInitializers)
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'modelsList', 'modelsList', remoteInitializers)
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'agentsGenerate', 'agentsGenerate', remoteInitializers)
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'haReset', 'haReset', remoteInitializers)
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'debugLogs', 'debugLogs', remoteInitializers)
  decorateRemoteMethod(Remote, HaOrchestratorRpc, 'debugClear', 'debugClear', remoteInitializers)
  new HaOrchestratorRpc()
}

export { apply, inject, name }
export default { apply, inject, name }
