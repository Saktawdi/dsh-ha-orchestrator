import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  keyOf,
  splitKey,
  matchesCodes,
  clearExpired,
  isExactQuarantined,
  isBlocked,
  entryFor,
  setEntry,
  bumpFailure,
  quarantineKey,
  recordHistory,
  findFallback,
  pickFallback,
  hasFallback,
  maxRetriesFor,
  computeFailingKey,
  createHaState,
  countQuarantinedModels,
  serializeHaState,
  deserializeHaState,
} from '../lib/ha-core.js'

const mkCfg = (overrides = {}) => ({
  enabled: true,
  threshold: 2,
  cooldownMs: 60000,
  backups: [],
  ...overrides,
})

test('keyOf/splitKey round-trips and defaults', () => {
  assert.equal(keyOf('openai', 'gpt-4'), 'openai\u0000gpt-4')
  assert.equal(keyOf('openai'), 'openai\u0000*')
  assert.equal(keyOf('openai', undefined), 'openai\u0000*')
  assert.equal(keyOf('openai', null), 'openai\u0000*')
  // round-trip
  assert.deepEqual(splitKey(keyOf('anthropic', 'claude-3')), ['anthropic', 'claude-3'])
  assert.deepEqual(splitKey(keyOf('anthropic')), ['anthropic', '*'])
  // only the first NUL is the delimiter
  assert.deepEqual(splitKey('a\u0000b\u0000c'), ['a', 'b\u0000c'])
})

test('matchesCodes matches empty/missing/hit/miss', () => {
  assert.equal(matchesCodes([], 'X'), true)
  assert.equal(matchesCodes(undefined, 'X'), true)
  assert.equal(matchesCodes(null, 'X'), true)
  assert.equal(matchesCodes(['429', '500'], '429'), true)
  assert.equal(matchesCodes(['429', '500'], '502'), false)
})

test('clearExpired removes only `until < now`, keeps `until === now`', () => {
  const state = createHaState()
  state.quarantine.set('a', { until: 100 })
  state.quarantine.set('b', { until: 100 }) // equal -> kept
  state.quarantine.set('c', { until: 50 }) // expired
  state.failures.set('d', { until: 90 }) // expired
  state.failures.set('e', { until: 200 })
  clearExpired(state, 100)
  assert.deepEqual([...state.quarantine.keys()], ['a', 'b']) // until === now kept
  assert.deepEqual([...state.failures.keys()], ['e'])
})

test('isBlocked exact/wildcard/miss; isExactQuarantined not tainted by wildcard', () => {
  const now = 1000
  const state = createHaState()
  state.quarantine.set(keyOf('openai', 'gpt-4'), { until: now + 10, code: '429' })
  state.quarantine.set(keyOf('anthropic', '*'), { until: now + 10, code: '500' })

  assert.equal(isBlocked(state, 'openai', 'gpt-4', now), true) // exact hit
  assert.equal(isBlocked(state, 'anthropic', 'claude-3', now), true) // wildcard hit
  assert.equal(isBlocked(state, 'google', 'gemini', now), false) // clean provider

  // wildcard must NOT taint exact-check for other models under same provider
  assert.equal(isExactQuarantined(state, 'anthropic', 'claude-3', now), false)
  assert.equal(isExactQuarantined(state, 'openai', 'gpt-4', now), true)
})

test('isExactQuarantined ties only the exact key', () => {
  const state = createHaState()
  state.quarantine.set(keyOf('openai', 'gpt-4'), { until: 9999 })
  assert.equal(isExactQuarantined(state, 'openai', 'gpt-4', 5000), true)
  assert.equal(isExactQuarantined(state, 'openai', 'gpt-3', 5000), false)
  assert.equal(isExactQuarantined(state, 'other', 'gpt-4', 5000), false)
})

test('bumpFailure increments count, sets until=now+cooldown, clears stale', () => {
  const state = createHaState()
  const cfg = mkCfg({ cooldownMs: 60000 })
  const k = keyOf('openai', 'gpt-4')

  assert.equal(bumpFailure(state, cfg, k, 1000), 1)
  assert.equal(state.failures.get(k).count, 1)
  assert.equal(state.failures.get(k).until, 61000)

  assert.equal(bumpFailure(state, cfg, k, 1500), 2)
  assert.equal(state.failures.get(k).count, 2)
  assert.equal(state.failures.get(k).until, 61500)

  // advance past cooldown, stale counter gets cleared back to 1
  assert.equal(bumpFailure(state, cfg, k, 100000), 1)
  assert.equal(state.failures.get(k).count, 1)
  assert.equal(state.failures.get(k).until, 160000)
})

test('quarantineKey writes quarantine and drops failures for the key', () => {
  const state = createHaState()
  const cfg = mkCfg({ cooldownMs: 30000 })
  const k = keyOf('openai', 'gpt-4')
  bumpFailure(state, cfg, k, 1000)
  assert.equal(state.failures.get(k).count, 1)

  quarantineKey(state, cfg, k, '429', 5000)
  assert.deepEqual(state.quarantine.get(k), { until: 35000, code: '429', level: 'model' })
  assert.equal(state.failures.has(k), false)
})

test('recordHistory formats from/to, at ISO, and trims to 50', () => {
  const state = createHaState()
  const now = Date.UTC(2024, 0, 1, 12, 0, 0)

  // no model in fromKey -> no trailing slash part
  recordHistory(state, 7, keyOf('openai', '*'), { provider: 'anthropic', model: 'claude-3' }, '408', now)
  assert.deepEqual(state.history[0], {
    at: new Date(now).toISOString(),
    agent: '7',
    from: 'openai',
    to: 'anthropic/claude-3',
    code: '408',
  })

  // with model -> provider/model
  recordHistory(state, 8, keyOf('openai', 'gpt-4'), { provider: 'google', model: 'gemini' }, undefined, now)
  assert.equal(state.history[1].from, 'openai/gpt-4')
  assert.equal(state.history[1].to, 'google/gemini')
  assert.equal(state.history[1].code, '') // code defaults to ''

  // trimming
  for (let i = 0; i < 60; i += 1) {
    recordHistory(state, i, keyOf(`p${i % 3}`, `m${i}`), { provider: 'r', model: 'x' }, '', now + i)
  }
  assert.equal(state.history.length, 50)
  // newest is the last pushed one
  assert.equal(state.history[49].agent, '59')
  assert.equal(state.history[0].agent, '10') // oldest surviving
})

test('findFallback rotates from entry.index and does not advance the cursor', () => {
  const cfg = mkCfg({
    backups: [
      { provider: 'openai', model: 'gpt-4' },
      { provider: 'anthropic', model: 'claude-3' },
    ],
  })
  const state = createHaState()
  state.perAgent.set('a1', { index: 1 }) // start at anthropic

  const found = findFallback(state, cfg, [], 'a1', null, 1000)
  assert.equal(found.provider, 'anthropic')
  assert.equal(found.model, 'claude-3')
  assert.equal(found.key, 'anthropic\u0000claude-3')
  assert.equal(found.index, 0)
  // cursor unchanged
  assert.equal(state.perAgent.get('a1').index, 1)

  // missing index -> starts at 0
  const found2 = findFallback(state, cfg, [], 'newAgent', null, 1000)
  assert.equal(found2.provider, 'openai')
  assert.equal(state.perAgent.has('newAgent'), false)
})

test('pickFallback advances the cursor; findFallback does not', () => {
  const cfg = mkCfg({
    backups: [
      { provider: 'openai', model: 'gpt-4' },
      { provider: 'anthropic', model: 'claude-3' },
      { provider: 'google', model: 'gemini' },
    ],
  })
  const state = createHaState()
  const picked = pickFallback(state, cfg, [], 'a1', null, 1000)
  assert.deepEqual(picked, { provider: 'openai', model: 'gpt-4', reasoningEffort: undefined, key: 'openai\u0000gpt-4' })
  assert.equal(state.perAgent.get('a1').index, 1)

  // next pick starts from advanced cursor
  const picked2 = pickFallback(state, cfg, [], 'a1', null, 1000)
  assert.equal(picked2.provider, 'anthropic')
  assert.equal(state.perAgent.get('a1').index, 2)

  // findFallback with a fresh agent keeps index at 0 (no write)
  const s2 = createHaState()
  findFallback(s2, cfg, [], 'b1', null, 1000)
  assert.equal(s2.perAgent.has('b1'), false)
})

test('findFallback skips excludeKey', () => {
  const cfg = mkCfg({ backups: [{ provider: 'openai', model: 'gpt-4' }] })
  const state = createHaState()
  const r = findFallback(state, cfg, [], 'a1', keyOf('openai', 'gpt-4'), 1000)
  assert.equal(r, null)
})

test('registeredProviders filters unregistered providers when non-empty', () => {
  const backups = [
    { provider: 'openai', model: 'gpt-4' },
    { provider: 'anthropic', model: 'claude-3' },
  ]
  const state = createHaState()

  // empty/undefined registered set -> no filtering
  const rEmpty = findFallback(state, mkCfg({ backups }), [], 'a1', null, 1000)
  assert.equal(rEmpty.provider, 'openai')

  // only anthropic registered -> openai skipped
  const rSet = findFallback(state, mkCfg({ backups }), new Set(['anthropic']), 'a1', null, 1000)
  assert.equal(rSet.provider, 'anthropic')

  // array form works too
  const rArr = findFallback(state, mkCfg({ backups }), ['anthropic'], 'a1', null, 1000)
  assert.equal(rArr.provider, 'anthropic')

  // all filtered out -> null
  const rNone = findFallback(state, mkCfg({ backups }), new Set(['google']), 'a1', null, 1000)
  assert.equal(rNone, null)
})

test('findFallback skips exact-quarantined backups', () => {
  const cfg = mkCfg({
    backups: [
      { provider: 'openai', model: 'gpt-4' },
      { provider: 'anthropic', model: 'claude-3' },
    ],
  })
  const state = createHaState()
  state.quarantine.set(keyOf('openai', 'gpt-4'), { until: 999999, code: '429' })
  const r = findFallback(state, cfg, [], 'a1', null, 1000)
  assert.equal(r.provider, 'anthropic') // openai exact-quarantined -> skipped
})

test('findFallback/pickFallback return null and keep cursor when all unavailable', () => {
  const cfg = mkCfg({ backups: [{ provider: 'openai', model: 'gpt-4' }] })
  const state = createHaState()
  state.perAgent.set('a1', { index: 5 })
  state.quarantine.set(keyOf('openai', 'gpt-4'), { until: 999999, code: '429' })

  assert.equal(findFallback(state, cfg, [], 'a1', null, 1000), null)
  assert.equal(state.perAgent.get('a1').index, 5)

  assert.equal(pickFallback(state, cfg, [], 'a1', null, 1000), null)
  assert.equal(state.perAgent.get('a1').index, 5)
})

test('maxRetriesFor = threshold + backups.length, min 2', () => {
  assert.equal(maxRetriesFor(mkCfg({ threshold: 2, backups: [{ provider: 'a', model: 'b' }] })), 3)
  assert.equal(maxRetriesFor(mkCfg({ threshold: 2, backups: [1, 2, 3] })), 5)
  // below floor -> 2
  assert.equal(maxRetriesFor(mkCfg({ threshold: -5, backups: [] })), 2)
  assert.equal(maxRetriesFor(mkCfg({ threshold: 1, backups: [] })), 2)
  // missing backups
  assert.equal(maxRetriesFor({ threshold: 0 }), 2)
})

test('computeFailingKey uses exact key on provider match, else wildcard', () => {
  const entryExact = { lastKey: keyOf('openai', 'gpt-4') }
  assert.equal(computeFailingKey(entryExact, 'openai'), 'openai\u0000gpt-4')

  // provider mismatch -> wildcard of given provider
  assert.equal(computeFailingKey({ lastKey: keyOf('openai', 'gpt-4') }, 'anthropic'), 'anthropic\u0000*')

  // no lastKey -> wildcard
  assert.equal(computeFailingKey({}, 'google'), 'google\u0000*')
  assert.equal(computeFailingKey(undefined, 'google'), 'google\u0000*')
})

test('entryFor/setEntry fallback and merge semantics', () => {
  const state = createHaState()
  assert.deepEqual(entryFor(state, 'missing'), { index: 0 })

  setEntry(state, 'a', { retries: 1 })
  assert.deepEqual(state.perAgent.get('a'), { index: 0, retries: 1 })

  setEntry(state, 'a', { failCode: 'x' })
  assert.deepEqual(state.perAgent.get('a'), { index: 0, retries: 1, failCode: 'x' })
})

test('createHaState initial structure', () => {
  const state = createHaState()
  assert.deepEqual([...state.quarantine], [])
  assert.deepEqual([...state.failures], [])
  assert.deepEqual([...state.perAgent], [])
  assert.deepEqual(state.history, [])
})

test('hasFallback only checks availability, no cursor change', () => {
  const cfg = mkCfg({ backups: [{ provider: 'openai', model: 'gpt-4' }] })
  const state = createHaState()
  assert.equal(hasFallback(state, cfg, [], 'a1', null, 1000), true)
  assert.equal(state.perAgent.has('a1'), false)

  state.quarantine.set(keyOf('openai', 'gpt-4'), { until: 999999, code: '500' })
  assert.equal(hasFallback(state, cfg, [], 'a1', null, 1000), false)
})

// ===================== Phase 1：滑动窗口 / 双层熔断 / 序列化 =====================

test('burstWindowMs: 窗口内计数，窗口滑动后重置', () => {
  const cfg = mkCfg({ burstWindowMs: 60000 })
  const state = createHaState()
  const k = keyOf('p0', 'm0')

  // 窗口内两次失败 -> 计数 2
  assert.equal(bumpFailure(state, cfg, k, 1000), 1)
  assert.equal(bumpFailure(state, cfg, k, 30000), 2)
  assert.equal(state.failures.get(k).count, 2)

  // 窗口滑出（now - windowStart > 60000）-> 重置为 1
  assert.equal(bumpFailure(state, cfg, k, 62000), 1)
  assert.equal(state.failures.get(k).count, 1)

  // burstWindowMs = 0（关闭）-> 计数持续累积直到冷却到期
  const cfg2 = mkCfg({ burstWindowMs: 0, cooldownMs: 300000 })
  const s2 = createHaState()
  assert.equal(bumpFailure(s2, cfg2, k, 1000), 1)
  assert.equal(bumpFailure(s2, cfg2, k, 70000), 2)
  assert.equal(s2.failures.get(k).count, 2)
})

test('quarantineKey: provider 级隔离写通配键并标注 level', () => {
  const state = createHaState()
  const cfg = mkCfg({ cooldownMs: 30000 })
  const k = keyOf('p0', '*')
  quarantineKey(state, cfg, k, 'PROVIDER_CIRCUIT', 5000, 'provider')
  assert.deepEqual(state.quarantine.get(k), { until: 35000, code: 'PROVIDER_CIRCUIT', level: 'provider' })
})

test('countQuarantinedModels: 只统计模型级隔离，不含通配键', () => {
  const state = createHaState()
  const cfg = mkCfg({ cooldownMs: 30000 })
  quarantineKey(state, cfg, keyOf('p0', 'm1'), '500', 1000)
  quarantineKey(state, cfg, keyOf('p0', 'm2'), '500', 1000)
  quarantineKey(state, cfg, keyOf('p0', '*'), 'PROVIDER_CIRCUIT', 1000, 'provider')
  quarantineKey(state, cfg, keyOf('p1', 'm9'), '500', 1000)
  assert.equal(countQuarantinedModels(state, 'p0', 2000), 2)
  assert.equal(countQuarantinedModels(state, 'p1', 2000), 1)
  assert.equal(countQuarantinedModels(state, 'p2', 2000), 0)
})

test('findFallback: provider 通配键隔离时跳过该 provider 全部模型', () => {
  const cfg = mkCfg({ backups: [
    { provider: 'p0', model: 'm1' },
    { provider: 'p1', model: 'm1' },
  ] })
  const state = createHaState()
  state.quarantine.set(keyOf('p0', '*'), { until: 999999, code: 'PROVIDER_CIRCUIT', level: 'provider' })
  const picked = findFallback(state, cfg, [], 'a1', null, 1000)
  assert.equal(picked.provider, 'p1')
  assert.equal(picked.model, 'm1')
})

test('serialize/deserializeHaState: 往返一致，畸形输入返回 null', () => {
  const cfg = mkCfg({ cooldownMs: 30000 })
  const state = createHaState()
  bumpFailure(state, cfg, keyOf('p0', 'm0'), 1000)
  quarantineKey(state, cfg, keyOf('p0', 'm1'), '429', 2000)
  quarantineKey(state, cfg, keyOf('p0', '*'), 'PROVIDER_CIRCUIT', 2000, 'provider')
  setEntry(state, 'a1', { index: 1, lastKey: keyOf('p0', 'm1'), retries: 2, failCode: '429', steeredTurn: 3, degradeReasoning: true })
  recordHistory(state, 'a1', keyOf('p0', 'm0'), { provider: 'p1', model: 'm1' }, '429', 3000)

  const json = serializeHaState(state)
  const restored = deserializeHaState(JSON.stringify(json))
  assert.ok(restored, 'deserialize ok')
  assert.equal(restored.quarantine.size, 2)
  assert.equal(restored.quarantine.get(keyOf('p0', 'm1')).code, '429')
  assert.equal(restored.quarantine.get(keyOf('p0', 'm1')).level, 'model')
  assert.equal(restored.quarantine.get(keyOf('p0', '*')).level, 'provider')
  assert.equal(restored.failures.get(keyOf('p0', 'm0')).count, 1)
  assert.deepEqual(restored.perAgent.get('a1'), { index: 1, lastKey: keyOf('p0', 'm1'), retries: 2, failCode: '429', steeredTurn: 3, degradeReasoning: true })
  assert.equal(restored.history.length, 1)

  // 畸形输入
  assert.equal(deserializeHaState(null), null)
  assert.equal(deserializeHaState('not json'), null)
  assert.equal(deserializeHaState('[]'), null)
  // 畸形节被宽容跳过，返回空状态（部分损坏仍能还原有效部分）
  const lenient = deserializeHaState('{"quarantine": "x"}')
  assert.ok(lenient && lenient.quarantine.size === 0, '畸形节被忽略，返回空状态')
  // 空对象 -> 空状态
  const empty = deserializeHaState('{}')
  assert.ok(empty)
  assert.equal(empty.quarantine.size, 0)
  // 非法条目被跳过
  const partial = deserializeHaState('{"quarantine": [["k1", {"until": "bad"}]], "failures": [["k2", {"count": 1, "until": 100}]]}')
  assert.ok(partial)
  assert.equal(partial.quarantine.size, 0)
  assert.equal(partial.failures.size, 1)
})

test('deserializeHaState: 还原后过期条目可被 clearExpired 清理', () => {
  const state = deserializeHaState(JSON.stringify({
    version: 1,
    quarantine: [['p0\u0000m0', { until: 1000, code: '429' }]],
    failures: [['p0\u0000m1', { count: 2, until: 999 }]],
    perAgent: [],
    history: [],
  }))
  clearExpired(state, 5000)
  assert.equal(state.quarantine.size, 0)
  assert.equal(state.failures.size, 0)
})
