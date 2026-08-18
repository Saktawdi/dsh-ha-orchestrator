// ============================================================================
// lib/config.js 单元测试 —— 纯 node:test（无 DSH 依赖）
// ----------------------------------------------------------------------------
// 覆盖：MIN_COOLDOWN_MS 常量、defaultConfig 结构、sanitizeConfig 的逐条校验规则、
// 未提交节沿用 base、以及入参不被修改。
// 运行：node --test tests/config.test.js
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_COOLDOWN_MS, defaultConfig, sanitizeConfig } from '../lib/config.js'

test('defaultConfig 导出 MIN_COOLDOWN_MS 常量', () => {
  assert.equal(MIN_COOLDOWN_MS, 1000)
})

test('defaultConfig 深层结构正确', () => {
  assert.equal(defaultConfig.ha.enabled, true)
  assert.deepEqual(defaultConfig.ha.backups, [])
  assert.equal(defaultConfig.ha.cooldownMs, 300000)
  assert.equal(defaultConfig.ha.threshold, 3)
  assert.deepEqual(defaultConfig.ha.codes, [])
  assert.equal(defaultConfig.ha.persistSelection, false)
  assert.equal(defaultConfig.ha.steerOnStop, true)

  assert.equal(defaultConfig.orch.enabled, true)
  assert.equal(defaultConfig.orch.provider, '')
  assert.equal(defaultConfig.orch.concurrency, 6)
  assert.equal(defaultConfig.orch.maxAgents, 16)
  // 截断上限与深度兜底默认值
  assert.equal(defaultConfig.orch.mergeBodyLimit, 8000)
  assert.equal(defaultConfig.orch.mergeTotalLimit, 48000)
  assert.equal(defaultConfig.orch.renderRunLimit, 8000)
  assert.equal(defaultConfig.orch.renderTotalLimit, 60000)
  assert.equal(defaultConfig.orch.maxDepth, 0)
  assert.ok(Array.isArray(defaultConfig.orch.agents))
  assert.equal(defaultConfig.orch.agents.length, 3)
  const reviewer = defaultConfig.orch.agents[0]
  assert.equal(reviewer.name, 'reviewer')
  assert.equal(reviewer.provider, '')
  assert.equal(reviewer.model, '')
  assert.ok(reviewer.description)
  assert.ok(reviewer.systemPrompt)
  // 内置调研预设：researcher / research-merger（供 GitHub 调研编排直接选用）
  assert.equal(defaultConfig.orch.agents[1].name, 'researcher')
  assert.ok(defaultConfig.orch.agents[1].description)
  assert.ok(defaultConfig.orch.agents[1].systemPrompt)
  assert.equal(defaultConfig.orch.agents[2].name, 'research-merger')
  assert.ok(defaultConfig.orch.agents[2].systemPrompt)

  assert.equal(defaultConfig.debug.enabled, false)
  assert.equal(defaultConfig.debug.showCard, false)

  assert.equal(defaultConfig.lang.mode, 'auto')

  assert.equal(defaultConfig.ctx.enabled, true)
  assert.equal(defaultConfig.ctx.text, '')
  assert.equal(defaultConfig.ctx.injectSubagents, false)
})

test('patch 为 null/undefined/非对象时返回空对象且不改变 base', () => {
  const base = JSON.parse(JSON.stringify(defaultConfig))
  assert.deepEqual(sanitizeConfig(null, base), {})
  assert.deepEqual(sanitizeConfig(undefined, base), {})
  assert.deepEqual(sanitizeConfig('x', base), {})
  assert.deepEqual(sanitizeConfig(42, base), {})
  // base 不受影响
  assert.deepEqual(base, defaultConfig)
})

test('空 patch 时各节等于 base（deepEqual 校验结构）', () => {
  const res = sanitizeConfig({}, defaultConfig)
  assert.deepEqual(res, {})
  // 空 patch 不产生任何节，故各节恒为空对象返回；此处验证返回为空对象
  assert.equal(Object.keys(res).length, 0)
})

test('空对象 patch 时，显式提交的各节沿用 base 结构', () => {
  const base = JSON.parse(JSON.stringify(defaultConfig))
  const res = sanitizeConfig({ ha: {}, orch: {}, debug: {}, lang: {}, ctx: {} }, base)
  assert.deepEqual(res.ha, base.ha)
  assert.deepEqual(res.orch, base.orch)
  assert.deepEqual(res.debug, base.debug)
  assert.deepEqual(res.lang, base.lang)
  assert.deepEqual(res.ctx, base.ctx)
})

test('cooldownMs：合法值保留', () => {
  const res = sanitizeConfig({ ha: { cooldownMs: 5000 } }, defaultConfig)
  assert.equal(res.ha.cooldownMs, 5000)
})

test('cooldownMs：0/负数/NaN/无效值被钳到 MIN_COOLDOWN_MS', () => {
  assert.equal(sanitizeConfig({ ha: { cooldownMs: 0 } }, defaultConfig).ha.cooldownMs, MIN_COOLDOWN_MS)
  assert.equal(sanitizeConfig({ ha: { cooldownMs: -5 } }, defaultConfig).ha.cooldownMs, MIN_COOLDOWN_MS)
  assert.equal(sanitizeConfig({ ha: { cooldownMs: NaN } }, defaultConfig).ha.cooldownMs, MIN_COOLDOWN_MS)
  assert.equal(sanitizeConfig({ ha: { cooldownMs: 'abc' } }, defaultConfig).ha.cooldownMs, MIN_COOLDOWN_MS)
  assert.equal(sanitizeConfig({ ha: { cooldownMs: null } }, defaultConfig).ha.cooldownMs, MIN_COOLDOWN_MS)
})

test('threshold：合法值保留、0/负数/NaN 钳到 1', () => {
  assert.equal(sanitizeConfig({ ha: { threshold: 3 } }, defaultConfig).ha.threshold, 3)
  assert.equal(sanitizeConfig({ ha: { threshold: 0 } }, defaultConfig).ha.threshold, 1)
  assert.equal(sanitizeConfig({ ha: { threshold: -2 } }, defaultConfig).ha.threshold, 1)
  assert.equal(sanitizeConfig({ ha: { threshold: NaN } }, defaultConfig).ha.threshold, 1)
  assert.equal(sanitizeConfig({ ha: { threshold: 'abc' } }, defaultConfig).ha.threshold, 1)
})

test('codes：数组元素字符串化并过滤空串；非数组清空', () => {
  // '' 被过滤；null -> 'null'（truthy）保留；数字/回退均字符串化
  const res = sanitizeConfig({ ha: { codes: [123, '', 'abc', null, 'x', 0] } }, defaultConfig)
  assert.deepEqual(res.ha.codes, ['123', 'abc', 'null', 'x', '0'])
  // 仅空字符串 '' 被过滤；'false'/'0' 等 truthy 字符串化值保留
  assert.deepEqual(
    sanitizeConfig({ ha: { codes: ['', '0', false] } }, defaultConfig).ha.codes,
    ['0', 'false'],
  )
  assert.deepEqual(sanitizeConfig({ ha: { codes: 'nope' } }, defaultConfig).ha.codes, [])
  assert.deepEqual(sanitizeConfig({ ha: { codes: {} } }, defaultConfig).ha.codes, [])
})

test('backups：只保留 provider 和 model 均非空的对象，label/reasoningEffort 默认空', () => {
  const patch = {
    ha: {
      backups: [
        { label: 'A', provider: 'p1', model: 'm1', reasoningEffort: 'high' },
        { label: 'B', provider: 'p2', model: 'm2' },
        { provider: 'p3', model: '', label: 'bad-model' },   // model 为空 -> 丢弃
        { provider: '', model: 'm4', label: 'bad-provider' }, // provider 为空 -> 丢弃
        null,
        'not-object',
        { provider: 'inline', model: 'non-string', label: 9, reasoningEffort: 0 },
      ],
    },
  }
  const res = sanitizeConfig(patch, defaultConfig)
  assert.deepEqual(res.ha.backups, [
    { label: 'A', provider: 'p1', model: 'm1', reasoningEffort: 'high' },
    { label: 'B', provider: 'p2', model: 'm2', reasoningEffort: '' },
    { label: '9', provider: 'inline', model: 'non-string', reasoningEffort: '' },
  ])
})

test('backups：非数组清空', () => {
  assert.deepEqual(sanitizeConfig({ ha: { backups: 'x' } }, defaultConfig).ha.backups, [])
})

test('orch.concurrency 钳到 1-32', () => {
  assert.equal(sanitizeConfig({ orch: { concurrency: 5 } }, defaultConfig).orch.concurrency, 5)
  assert.equal(sanitizeConfig({ orch: { concurrency: 0 } }, defaultConfig).orch.concurrency, 1)
  assert.equal(sanitizeConfig({ orch: { concurrency: -3 } }, defaultConfig).orch.concurrency, 1)
  assert.equal(sanitizeConfig({ orch: { concurrency: 100 } }, defaultConfig).orch.concurrency, 32)
  assert.equal(sanitizeConfig({ orch: { concurrency: 'abc' } }, defaultConfig).orch.concurrency, 1)
})

test('orch.maxAgents 钳到 1-64', () => {
  assert.equal(sanitizeConfig({ orch: { maxAgents: 10 } }, defaultConfig).orch.maxAgents, 10)
  assert.equal(sanitizeConfig({ orch: { maxAgents: 0 } }, defaultConfig).orch.maxAgents, 1)
  assert.equal(sanitizeConfig({ orch: { maxAgents: -5 } }, defaultConfig).orch.maxAgents, 1)
  assert.equal(sanitizeConfig({ orch: { maxAgents: 200 } }, defaultConfig).orch.maxAgents, 64)
  assert.equal(sanitizeConfig({ orch: { maxAgents: 'zz' } }, defaultConfig).orch.maxAgents, 1)
})

test('orch.agents：name 为空被丢弃，字段被规整为字符串', () => {
  const patch = {
    orch: {
      agents: [
        { name: '  arch ', provider: 1, model: 2, description: 'd', systemPrompt: 'p' },
        { name: '   ', provider: 'p', model: 'm' },       // name 空白 -> 丢弃
        { name: '', provider: 'p', model: 'm' },           // name 空 -> 丢弃
        null,
        { provider: 'p', model: 'm' },                     // name 缺失 -> 丢弃
        { name: 'planner', model: 42 },
      ],
    },
  }
  const res = sanitizeConfig(patch, defaultConfig)
  assert.deepEqual(res.orch.agents, [
    {
      name: 'arch',
      provider: '1',
      model: '2',
      description: 'd',
      systemPrompt: 'p',
    },
    {
      name: 'planner',
      provider: '',
      model: '42',
      description: '',
      systemPrompt: '',
    },
  ])
})

test('orch.agents：主模型 reasoningEffort 独立规整，空值不落字段', () => {
  const res = sanitizeConfig({
    orch: {
      agents: [
        { name: 'thinker', provider: 'p1', model: 'm1', reasoningEffort: ' high ' },
        { name: 'default-effort', reasoningEffort: '   ' },
      ],
    },
  }, defaultConfig)
  assert.equal(res.orch.agents[0].reasoningEffort, 'high')
  assert.equal('reasoningEffort' in res.orch.agents[1], false)
})

test('orch.agents：tools 规整为去空白名单，空名单不落字段', () => {
  const patch = {
    orch: {
      agents: [
        { name: 'researcher', tools: { allow: [' read ', '', 'web_fetch'], deny: [] } },
        { name: 'plain', tools: {} },                      // 空 -> 无 tools 字段
        { name: 'junk', tools: { allow: 'not-array' } },   // 非数组 -> 无 tools 字段
        { name: 'denier', tools: { deny: [' write ', ''] } },
      ],
    },
  }
  const res = sanitizeConfig(patch, defaultConfig)
  assert.deepEqual(res.orch.agents[0].tools, { allow: ['read', 'web_fetch'] })
  assert.equal('tools' in res.orch.agents[0] === false, false)   // 有 tools 字段
  assert.equal('tools' in res.orch.agents[1], false)
  assert.equal('tools' in res.orch.agents[2], false)
  assert.deepEqual(res.orch.agents[3].tools, { deny: ['write'] })
})

test('orch.agents：每个子智能体的 fallbacks 独立规整，复用 backup 条目形状', () => {
  const res = sanitizeConfig({
    orch: {
      agents: [
        {
          name: 'researcher',
          provider: 'p0',
          model: 'm0',
          fallbacks: [
            { label: '备用一', provider: 'p1', model: 'm1', reasoningEffort: 'high' },
            { provider: 'p2', model: 'm2' },
            { provider: 'p3', model: '' },
            null,
          ],
        },
        { name: 'plain' },
        { name: 'disabled', fallbacks: 'not-array' },
      ],
    },
  }, defaultConfig)
  assert.deepEqual(res.orch.agents[0].fallbacks, [
    { label: '备用一', provider: 'p1', model: 'm1', reasoningEffort: 'high' },
    { label: '', provider: 'p2', model: 'm2', reasoningEffort: '' },
  ])
  assert.equal('fallbacks' in res.orch.agents[1], false)
  assert.deepEqual(res.orch.agents[2].fallbacks, [])
})

test('orch 截断上限与 maxDepth：钳制与 0 透传', () => {
  const res = sanitizeConfig({ orch: { mergeBodyLimit: 999999, mergeTotalLimit: -5, renderRunLimit: 12000, renderTotalLimit: 0, maxDepth: 99 } }, defaultConfig)
  assert.equal(res.orch.mergeBodyLimit, 100000)
  assert.equal(res.orch.mergeTotalLimit, 0)
  assert.equal(res.orch.renderRunLimit, 12000)
  assert.equal(res.orch.renderTotalLimit, 0)
  assert.equal(res.orch.maxDepth, 8)
})

test('orch.agents：非数组清空', () => {
  assert.deepEqual(sanitizeConfig({ orch: { agents: 'x' } }, defaultConfig).orch.agents, [])
})

test('debug.enabled/showCard 布尔化', () => {
  assert.equal(sanitizeConfig({ debug: { enabled: 0, showCard: 'y' } }, defaultConfig).debug.enabled, false)
  assert.equal(sanitizeConfig({ debug: { enabled: 1, showCard: 'y' } }, defaultConfig).debug.showCard, true)
})

test('lang.mode 非法值回 auto，zh/en 保留', () => {
  assert.equal(sanitizeConfig({ lang: { mode: 'zh' } }, defaultConfig).lang.mode, 'zh')
  assert.equal(sanitizeConfig({ lang: { mode: 'en' } }, defaultConfig).lang.mode, 'en')
  assert.equal(sanitizeConfig({ lang: { mode: 'fr' } }, defaultConfig).lang.mode, 'auto')
  assert.equal(sanitizeConfig({ lang: { mode: '' } }, defaultConfig).lang.mode, 'auto')
  assert.equal(sanitizeConfig({ lang: { mode: null } }, defaultConfig).lang.mode, 'auto')
})

test('ctx.text 字符串化，enabled/injectSubagents 布尔化', () => {
  const res = sanitizeConfig({ ctx: { text: 'hello', enabled: 1, injectSubagents: 1 } }, defaultConfig)
  assert.equal(res.ctx.text, 'hello')
  assert.equal(res.ctx.enabled, true)
  assert.equal(res.ctx.injectSubagents, true)
  assert.equal(sanitizeConfig({ ctx: { text: 123, injectSubagents: 'y' } }, defaultConfig).ctx.text, '123')
  assert.equal(sanitizeConfig({ ctx: { injectSubagents: 0 } }, defaultConfig).ctx.injectSubagents, false)
})

test('只提交 patch.ha 时 orch/debug/lang/ctx 不进入结果、base 原样保持', () => {
  const base = JSON.parse(JSON.stringify(defaultConfig))
  const res = sanitizeConfig({ ha: { cooldownMs: 9000 } }, base)
  // 与 lib/index.js sanitizeConfig 逐条一致：返回的 next 只含出现在 patch 中的节
  assert.ok(res.ha, 'ha 节应出现在结果中')
  assert.equal(res.ha.cooldownMs, 9000)
  assert.equal('orch' in res, false)
  assert.equal('debug' in res, false)
  assert.equal('lang' in res, false)
  assert.equal('ctx' in res, false)
  // base 未被修改，orch/debug/lang/ctx 仍原样保持在 base 中
  assert.deepEqual(base.orch, defaultConfig.orch)
  assert.deepEqual(base.debug, defaultConfig.debug)
  assert.deepEqual(base.lang, defaultConfig.lang)
  assert.deepEqual(base.ctx, defaultConfig.ctx)
})

test('sanitizeConfig 不修改传入的 patch 和 base', () => {
  const base = JSON.parse(JSON.stringify(defaultConfig))
  const patch = {
    ha: { cooldownMs: 0, codes: [null, 'a', ''] },
    orch: { agents: [{ name: '', provider: 'p' }, { name: 'x', model: 5 }] },
  }
  const baseSnapshot = JSON.stringify(base)
  const patchSnapshot = JSON.stringify(patch)
  sanitizeConfig(patch, base)
  assert.equal(JSON.stringify(base), baseSnapshot)
  assert.equal(JSON.stringify(patch), patchSnapshot)
})
