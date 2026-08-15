// ha-core.ts -- DSH-agnostic pure HA (high-availability) state machine helpers.
// No ctx dependency. All mutable config (haCfg) and state are passed explicitly,
// and every time-sensitive op accepts an injectable `now` for deterministic tests.

/** 隔离条目：到期时间 + 触发错误码 + 熔断层级。 */
export interface QuarantineEntry {
  until: number
  code?: string
  /** 'model' = 模型级熔断；'provider' = provider 级熔断（通配键）。 */
  level?: 'model' | 'provider'
}

/** 失败计数条目：累计次数 + 计数过期时间 + 滑动窗口起点。 */
export interface FailureEntry {
  count: number
  until: number
  /** burstWindowMs 滑动窗口内的首次失败时间（0 = 未启用窗口）。 */
  windowStart?: number
}

/** per-agent 游标条目。 */
export interface PerAgentEntry {
  index?: number
  lastKey?: string
  retries?: number
  failCode?: string
  steeredTurn?: number
  /** CONTEXT_WINDOW_EXCEEDED 降级标记：下一次请求去掉 reasoningEffort。 */
  degradeReasoning?: boolean
}

/** 切换历史条目。 */
export interface HistoryEntry {
  at: string
  agent: string
  from: string
  to: string
  code: string
}

/** HA 运行时状态容器。 */
export interface HaState {
  quarantine: Map<string, QuarantineEntry>
  failures: Map<string, FailureEntry>
  perAgent: Map<string, PerAgentEntry>
  history: HistoryEntry[]
}

/** 纯函数消费的最小 HA 配置形状（由 Config.ha 传入）。 */
export interface HaCfgLike {
  cooldownMs: number
  threshold: number
  /** 失败计数滑动窗口（毫秒）；0 = 关闭（计数到冷却到期） */
  burstWindowMs?: number
  backups?: Array<{ provider?: string; model?: string; reasoningEffort?: string }>
}

/** 备用候选（findFallback 命中项）。 */
export interface FallbackCandidate {
  provider: string
  model: string
  reasoningEffort?: string
  key: string
  /** 下一个游标位置（已按轮换语义推进）。 */
  index: number
}

/**
 * Build the canonical quarantine/failure key for a provider+model pair.
 * Missing model defaults to the provider-wide wildcard '*'.
 */
export function keyOf(provider: string, model?: string | null): string {
  return String(provider) + '\u0000' + (model || '*')
}

/**
 * Split a key back into [provider, model] on the first '\u0000'.
 */
export function splitKey(k: string): [string, string] {
  const s = String(k)
  const i = s.indexOf('\u0000')
  return [s.slice(0, i), s.slice(i + 1)]
}

/**
 * When `codes` is empty/undefined, match anything; otherwise only an exact
 * member match passes.
 */
export function matchesCodes(codes: string[] | null | undefined, code: string): boolean {
  return !codes || codes.length === 0 || codes.indexOf(code) >= 0
}

/**
 * Drop expired quarantine and failure entries (`v.until < now`). Entries whose
 * `until` equals `now` are kept.
 */
export function clearExpired(state: HaState, now: number = Date.now()): void {
  for (const [k, v] of state.quarantine) if (v.until < now) state.quarantine.delete(k)
  for (const [k, v] of state.failures) if (v.until < now) state.failures.delete(k)
}

/**
 * Exact-key quarantine check (used when picking a backup; a wildcard
 * quarantine must not taint other models under the same provider).
 */
export function isExactQuarantined(state: HaState, provider: string, model: string, now: number = Date.now()): boolean {
  clearExpired(state, now)
  return state.quarantine.has(keyOf(provider, model))
}

/**
 * Request-level quarantine check: the exact key matches, or (when the model is
 * unknown) the provider wildcard key matches.
 */
export function isBlocked(state: HaState, provider: string, model?: string | null, now: number = Date.now()): boolean {
  clearExpired(state, now)
  return state.quarantine.has(keyOf(provider, model)) || state.quarantine.has(keyOf(provider, '*'))
}

/**
 * Read the per-agent cursor entry without writing back.
 */
export function entryFor(state: HaState, agentId: string): PerAgentEntry {
  return state.perAgent.get(agentId) || { index: 0 }
}

/**
 * Merge a patch into the per-agent entry and write it back to state.
 */
export function setEntry(state: HaState, agentId: string, patch: Partial<PerAgentEntry>): void {
  state.perAgent.set(agentId, { ...entryFor(state, agentId), ...patch })
}

/**
 * Record one failure for a key, then start/fresh its cooldown. Returns the new
 * running count for that key.
 *
 * 滑动窗口语义：配置 burstWindowMs > 0 时，窗口内的首次失败时间记入
 * `windowStart`；当 now - windowStart 超出窗口时计数重置为 1（旧失败不再
 * 计入），实现“短时间突发多次失败才触发阈值”的突发窗口。
 */
export function bumpFailure(state: HaState, haCfg: HaCfgLike, k: string, now: number = Date.now()): number {
  clearExpired(state, now)
  const v = state.failures.get(k) || { count: 0, until: 0, windowStart: 0 }
  const windowMs = Number(haCfg.burstWindowMs) || 0
  if (windowMs > 0 && v.windowStart && now - v.windowStart > windowMs) {
    v.count = 0
    v.windowStart = now
  }
  if (!v.windowStart) v.windowStart = now
  v.count += 1
  v.until = now + haCfg.cooldownMs
  state.failures.set(k, v)
  return v.count
}

/**
 * Quarantine a key for the cooldown window and drop any pending failures for it.
 * @param level 熔断层级：'model'（默认）或 'provider'（通配键）。
 */
export function quarantineKey(
  state: HaState,
  haCfg: HaCfgLike,
  k: string,
  code?: string,
  now: number = Date.now(),
  level: 'model' | 'provider' = 'model',
): void {
  state.quarantine.set(k, { until: now + haCfg.cooldownMs, code, level })
  state.failures.delete(k)
}

/**
 * Append a switch history entry (trimmed to the newest 50 entries).
 */
export function recordHistory(state: HaState, agentId: string, fromKey: string, target: { provider: string; model: string }, code?: string, now: number = Date.now()): void {
  const parts = splitKey(fromKey)
  state.history.push({
    at: new Date(now).toISOString(),
    agent: String(agentId),
    from: parts[0] + (parts[1] === '*' ? '' : '/' + parts[1]),
    to: target.provider + '/' + target.model,
    code: code || '',
  })
  if (state.history.length > 50) state.history.splice(0, state.history.length - 50)
}

/**
 * Pure scan starting from the per-agent cursor index. Prefer the model at
 * `(entry.index + i) % n`, skipping entries that lack provider/model, are
 * unregistered (when a non-empty provider set is supplied), match `excludeKey`,
 * or are exact-quarantined. Does NOT advance the cursor.
 */
export function findFallback(
  state: HaState,
  haCfg: HaCfgLike,
  registeredProviders: Set<string> | string[] | null,
  agentId: string,
  excludeKey: string | null,
  now: number = Date.now(),
): FallbackCandidate | null {
  const list = haCfg.backups || []
  if (list.length === 0) return null
  const registered = registeredProviders
    ? (registeredProviders instanceof Set ? registeredProviders : new Set(registeredProviders))
    : new Set<string>()
  const entry = entryFor(state, agentId) || { index: 0 }
  const start = entry.index || 0
  const n = list.length
  for (let i = 0; i < n; i += 1) {
    const idx = (start + i) % n
    const b = list[idx]
    if (!b || !b.provider || !b.model) continue
    if (registered.size > 0 && !registered.has(String(b.provider))) continue
    const k = keyOf(b.provider, b.model)
    if (k === excludeKey) continue
    if (isExactQuarantined(state, b.provider, b.model, now)) continue
    // provider 级熔断：该 provider 的通配键被隔离时，其下所有模型都不可作为备用
    if (state.quarantine.has(keyOf(b.provider, '*'))) continue
    return {
      provider: String(b.provider),
      model: String(b.model),
      reasoningEffort: b.reasoningEffort || undefined,
      key: k,
      index: (idx + 1) % n,
    }
  }
  return null
}

/**
 * Pick a fallback AND advance the per-agent cursor to the next one. Returns the
 * result without the cursor index, or null when none is available.
 */
export function pickFallback(
  state: HaState,
  haCfg: HaCfgLike,
  registeredProviders: Set<string> | string[] | null,
  agentId: string,
  excludeKey: string | null,
  now: number = Date.now(),
): { provider: string; model: string; reasoningEffort?: string; key: string } | null {
  const found = findFallback(state, haCfg, registeredProviders, agentId, excludeKey, now)
  if (!found) return null
  setEntry(state, agentId, { index: found.index })
  return { provider: found.provider, model: found.model, reasoningEffort: found.reasoningEffort, key: found.key }
}

/**
 * Whether a usable fallback exists (does not advance the cursor).
 */
export function hasFallback(
  state: HaState,
  haCfg: HaCfgLike,
  registeredProviders: Set<string> | string[] | null,
  agentId: string,
  excludeKey: string | null,
  now: number = Date.now(),
): boolean {
  return findFallback(state, haCfg, registeredProviders, agentId, excludeKey, now) !== null
}

/**
 * Maximum retries budget: at least 2, or the threshold plus the backup count.
 */
export function maxRetriesFor(haCfg: HaCfgLike): number {
  return Math.max(2, Number(haCfg.threshold) + (haCfg.backups || []).length)
}

/**
 * Decide which key failed: reuse the exact key recorded for this agent when it
 * belongs to the failing provider, else fall back to that provider's wildcard.
 */
export function computeFailingKey(entry: PerAgentEntry | undefined, provider: string): string {
  if (entry && entry.lastKey && splitKey(entry.lastKey)[0] === provider) return entry.lastKey
  return keyOf(provider, '*')
}

/**
 * Fresh, empty HA state container.
 */
export function createHaState(): HaState {
  return { quarantine: new Map(), failures: new Map(), perAgent: new Map(), history: [] }
}

/**
 * 统计某个 provider 下已隔离的模型数（不含 provider 通配键本身）。
 * 供 provider 级熔断阈值判断使用。
 */
export function countQuarantinedModels(state: HaState, provider: string, now: number = Date.now()): number {
  clearExpired(state, now)
  // 注意：不能用 keyOf(provider, '') 求前缀——空 model 会回退成通配符
  const prefix = String(provider) + '\u0000'
  let count = 0
  for (const k of state.quarantine.keys()) {
    if (!k.startsWith(prefix)) continue
    const model = k.slice(prefix.length)
    if (model && model !== '*') count += 1
  }
  return count
}

// ===================== HA 运行态序列化（持久化用） =====================

/** 磁盘上 HA 运行态文件的结构（version 1）。 */
export interface HaStateJson {
  version: 1
  quarantine: Array<[string, { until: number; code?: string; level?: 'model' | 'provider' }]>
  failures: Array<[string, { count: number; until: number; windowStart?: number }]>
  perAgent: Array<[string, PerAgentEntry]>
  history: HistoryEntry[]
}

/** 把 HA 运行态序列化为可持久化 JSON 对象。 */
export function serializeHaState(state: HaState): HaStateJson {
  return {
    version: 1,
    quarantine: [...state.quarantine.entries()].map(([k, v]) => [k, { until: v.until, code: v.code, level: v.level }]),
    failures: [...state.failures.entries()].map(([k, v]) => [k, { count: v.count, until: v.until, windowStart: v.windowStart }]),
    perAgent: [...state.perAgent.entries()].map(([k, v]) => [k, { ...v }]),
    history: state.history.slice(),
  }
}

/**
 * 从 JSON 文本还原 HA 运行态；畸形/非法输入返回 null（调用方忽略并全新开始）。
 * 还原后各条目的过期清理由调用方在首次使用前 clearExpired。
 */
export function deserializeHaState(text: string | null | undefined): HaState | null {
  if (text == null) return null
  let raw: unknown
  try {
    raw = JSON.parse(String(text))
  } catch (e) {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const out: HaState = createHaState()
  try {
    if (Array.isArray(obj.quarantine)) {
      for (const pair of obj.quarantine) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        const [k, v] = pair as [unknown, unknown]
        if (typeof k !== 'string' || !v || typeof v !== 'object') continue
        const e = v as Record<string, unknown>
        const until = Number(e.until)
        if (!Number.isFinite(until) || until < 0) continue
        const level = e.level === 'provider' ? 'provider' : e.level === 'model' ? 'model' : undefined
        out.quarantine.set(k, { until, code: typeof e.code === 'string' ? e.code : undefined, level })
      }
    }
    if (Array.isArray(obj.failures)) {
      for (const pair of obj.failures) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        const [k, v] = pair as [unknown, unknown]
        if (typeof k !== 'string' || !v || typeof v !== 'object') continue
        const e = v as Record<string, unknown>
        const count = Number(e.count)
        const until = Number(e.until)
        if (!Number.isFinite(count) || !Number.isFinite(until)) continue
        const entry: FailureEntry = { count, until }
        const ws = Number(e.windowStart)
        if (Number.isFinite(ws) && ws > 0) entry.windowStart = ws
        out.failures.set(k, entry)
      }
    }
    if (Array.isArray(obj.perAgent)) {
      for (const pair of obj.perAgent) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        const [k, v] = pair as [unknown, unknown]
        if (typeof k !== 'string' || !v || typeof v !== 'object') continue
        const e = v as Record<string, unknown>
        const entry: PerAgentEntry = {}
        if (typeof e.index === 'number') entry.index = e.index
        if (typeof e.lastKey === 'string') entry.lastKey = e.lastKey
        if (typeof e.retries === 'number') entry.retries = e.retries
        if (typeof e.failCode === 'string') entry.failCode = e.failCode
        if (typeof e.steeredTurn === 'number') entry.steeredTurn = e.steeredTurn
        if (e.degradeReasoning === true) entry.degradeReasoning = true
        out.perAgent.set(k, entry)
      }
    }
    if (Array.isArray(obj.history)) {
      for (const h of obj.history) {
        if (!h || typeof h !== 'object') continue
        const e = h as Record<string, unknown>
        if (typeof e.at !== 'string') continue
        out.history.push({
          at: e.at,
          agent: typeof e.agent === 'string' ? e.agent : '',
          from: typeof e.from === 'string' ? e.from : '',
          to: typeof e.to === 'string' ? e.to : '',
          code: typeof e.code === 'string' ? e.code : '',
        })
      }
      if (out.history.length > 50) out.history.splice(0, out.history.length - 50)
    }
  } catch (e) {
    return null
  }
  return out
}
