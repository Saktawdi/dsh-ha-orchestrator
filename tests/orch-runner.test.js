import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  textBlocks,
  resolveAgentDef,
  findUnknownAgents,
  truncateTasks,
  resolveConcurrency,
  resolveMode,
  buildRunPrompt,
  buildSubagentRequest,
  normalizeRunResult,
  normalizeFinalRuns,
  poolRun,
  summarizeRuns,
  renderRunOutput,
  appendPipelineCarry,
  buildSupervisorPrompt,
} from '../lib/orch-runner.js'

// ---------------------------------------------------------------------------
// textBlocks
// ---------------------------------------------------------------------------
test('textBlocks: 返回 [{type:text,text}] 且字符串化入参', () => {
  assert.deepEqual(textBlocks('hi'), [{ type: 'text', text: 'hi' }])
  assert.deepEqual(textBlocks(123), [{ type: 'text', text: '123' }])
  assert.deepEqual(textBlocks(null), [{ type: 'text', text: 'null' }])
})

// ---------------------------------------------------------------------------
// resolveAgentDef
// ---------------------------------------------------------------------------
test('resolveAgentDef: 命中返回该对象', () => {
  const a = { name: 'alpha' }
  const b = { name: 'beta' }
  assert.equal(resolveAgentDef([a, b], 'beta'), b)
})
test('resolveAgentDef: 未命中返回 null', () => {
  assert.equal(resolveAgentDef([{ name: 'alpha' }], 'nope'), null)
  assert.equal(resolveAgentDef([], 'x'), null)
})
test('resolveAgentDef: 空 name 返回 null', () => {
  assert.equal(resolveAgentDef([{ name: 'alpha' }], ''), null)
  assert.equal(resolveAgentDef([{ name: 'alpha' }], null), null)
  assert.equal(resolveAgentDef([{ name: 'alpha' }], undefined), null)
  assert.equal(resolveAgentDef(null, 'x'), null)
})
test('resolveAgentDef: name 被 String 强转后比较', () => {
  const a = { name: '42' }
  assert.equal(resolveAgentDef([a], 42), a)
})
test('resolveAgentDef: 跳过 null 元素', () => {
  assert.equal(resolveAgentDef([null, { name: 'alpha' }], 'alpha').name, 'alpha')
  assert.equal(resolveAgentDef([null], 'alpha'), null)
})

// ---------------------------------------------------------------------------
// findUnknownAgents
// ---------------------------------------------------------------------------
test('findUnknownAgents: 收集 args.agent/task.agent/supervisorAgent 三种未知名', () => {
  const agents = [{ name: 'known' }]
  const args = { agent: 'dream', supervisorAgent: 'ghost' }
  const tasks = [{ agent: 'known' }, { agent: 'spooky' }]
  const { availableNames, unknown } = findUnknownAgents(args, tasks, agents)
  assert.deepEqual(availableNames, ['known'])
  assert.deepEqual(unknown, ['dream', 'spooky', 'ghost'])
})
test('findUnknownAgents: 全部命中时 unknown 为空', () => {
  const agents = [{ name: 'a' }]
  const { unknown } = findUnknownAgents({ agent: 'a' }, [{ agent: 'a' }], agents)
  assert.deepEqual(unknown, [])
})
test('findUnknownAgents: 重复按出现顺序保留', () => {
  const res = findUnknownAgents({ agent: 'dup', supervisorAgent: 'dup' }, [{ agent: 'dup' }, { agent: 'other' }], [])
  // 收集顺序：args.agent -> 每个 task.agent（按序）-> args.supervisorAgent
  assert.deepEqual(res.unknown, ['dup', 'dup', 'other', 'dup'])
  assert.deepEqual(res.availableNames, [])
})
test('findUnknownAgents: args/tasks 为 null 时安全', () => {
  assert.deepEqual(findUnknownAgents(null, null, [{ name: 'a' }]), {
    availableNames: ['a'],
    unknown: [],
  })
  assert.deepEqual(findUnknownAgents({ agent: 'zzz' }, null, []), {
    availableNames: [],
    unknown: ['zzz'],
  })
})

// ---------------------------------------------------------------------------
// truncateTasks
// ---------------------------------------------------------------------------
test('truncateTasks: 截断并返回新数组', () => {
  const tasks = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const out = truncateTasks(tasks, 3)
  assert.deepEqual(out, [1, 2, 3])
  assert.notEqual(out, tasks)
})
test('truncateTasks: maxAgents 非法回退 8', () => {
  const tasks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(truncateTasks(tasks, null).length, 8)
  assert.equal(truncateTasks(tasks, 'abc').length, 8)
  assert.equal(truncateTasks(tasks, 0).length, 8)
  assert.equal(truncateTasks(tasks, -5).length, 1)
})
test('truncateTasks: 少于 limit 时保留全部', () => {
  assert.deepEqual(truncateTasks([1, 2], 8), [1, 2])
})

// ---------------------------------------------------------------------------
// resolveConcurrency
// ---------------------------------------------------------------------------
test('resolveConcurrency: 上限为 maxAgents', () => {
  assert.equal(resolveConcurrency(20, 5, 4), 4)
})
test('resolveConcurrency: 下限为 1（负数等极端值落到 1）', () => {
  assert.equal(resolveConcurrency(-3, -3, 8), 1)
  assert.equal(resolveConcurrency(-1, null, 8), 1)
})
test('resolveConcurrency: 参数优先级 argsConcurrency > cfgConcurrency > 3', () => {
  assert.equal(resolveConcurrency(5, 2, 8), 5)
  assert.equal(resolveConcurrency(null, 2, 8), 2)
  assert.equal(resolveConcurrency(null, null, 8), 3)
})
test('resolveConcurrency: 非法值回退', () => {
  assert.equal(resolveConcurrency('abc', 'xyz', 8), 3)
  assert.equal(resolveConcurrency(undefined, undefined, 8), 3)
})

// ---------------------------------------------------------------------------
// resolveMode
// ---------------------------------------------------------------------------
test('resolveMode: pipeline / supervisor 原样返回', () => {
  assert.equal(resolveMode('pipeline'), 'pipeline')
  assert.equal(resolveMode('supervisor'), 'supervisor')
})
test('resolveMode: 其它值回 fanout', () => {
  assert.equal(resolveMode('fanout'), 'fanout')
  assert.equal(resolveMode('weird'), 'fanout')
  assert.equal(resolveMode(undefined), 'fanout')
  assert.equal(resolveMode(null), 'fanout')
})

// ---------------------------------------------------------------------------
// buildRunPrompt
// ---------------------------------------------------------------------------
test('buildRunPrompt: 无 extra 直接返回 task.prompt', () => {
  assert.equal(buildRunPrompt({ prompt: 'do it' }, '', 'PREFIX'), 'do it')
  assert.equal(buildRunPrompt({ prompt: 'do it' }, null, 'PREFIX'), 'do it')
  assert.equal(buildRunPrompt({ prompt: 'do it' }, undefined, 'PREFIX'), 'do it')
})
test('buildRunPrompt: 有 extra 时拼接精确格式', () => {
  const out = buildRunPrompt({ prompt: 'the prompt' }, 'the extra', 'MERGED')
  assert.equal(out, 'MERGED\n\n' + 'the extra' + '\n\n---\n\n' + 'the prompt')
})

// ---------------------------------------------------------------------------
// buildSubagentRequest
// ---------------------------------------------------------------------------
test('buildSubagentRequest: label 优先级 task.label > agentDef.name > task.id > task', () => {
  const r1 = buildSubagentRequest({ label: 'L', id: 'I', prompt: 'p' }, null, { name: 'N' }, 'M', 'P', 'S')
  assert.equal(r1.label, 'L')
  const r2 = buildSubagentRequest({ id: 'I', prompt: 'p' }, null, { name: 'N' }, 'M', 'P', 'S')
  assert.equal(r2.label, 'N')
  const r3 = buildSubagentRequest({ id: 'I', prompt: 'p' }, null, null, 'M', 'P', 'S')
  assert.equal(r3.label, 'I')
  const r4 = buildSubagentRequest({ prompt: 'p' }, null, null, 'M', 'P', 'S')
  assert.equal(r4.label, 'task')
})
test('buildSubagentRequest: persona 仅在有 systemPrompt 时设置', () => {
  const withPersona = buildSubagentRequest({ label: 'x', prompt: 'p' }, '', { name: 'N', systemPrompt: 'be good' }, 'M', 'P', 'S')
  assert.equal(withPersona.persona, 'be good')
  const noPersona = buildSubagentRequest({ label: 'x', prompt: 'p' }, '', { name: 'N' }, 'M', 'P', 'S')
  assert.equal('persona' in noPersona, false)
})
test('buildSubagentRequest: agentOptions 只写 truthy 字段', () => {
  const req = buildSubagentRequest({ label: 'x', prompt: 'p' }, '', { name: 'N', provider: 7, model: '' }, 'M', 'P', 'S')
  assert.deepEqual(req.agentOptions, { provider: '7' })
  const none = buildSubagentRequest({ label: 'x', prompt: 'p' }, '', { name: 'N', provider: '', model: null }, 'M', 'P', 'S')
  assert.equal('agentOptions' in none, false)
})
test('buildSubagentRequest: parent/signal 透传且 prompt 为 text block', () => {
  const parent = { id: 'p' }
  const signal = new AbortController().signal
  const req = buildSubagentRequest({ label: 'x', prompt: 'hello' }, '', null, 'M', parent, signal)
  assert.equal(req.parent, parent)
  assert.equal(req.signal, signal)
  assert.deepEqual(req.prompt, [{ type: 'text', text: 'hello' }])
})

// ---------------------------------------------------------------------------
// normalizeRunResult
// ---------------------------------------------------------------------------
test('normalizeRunResult: 文本块合并、忽略非文本', () => {
  const res = { output: [{ type: 'text', text: 'a' }, { type: 'tool_call' }, { type: 'text', text: 'b' }], stopReason: 'completed' }
  assert.deepEqual(normalizeRunResult({ id: '1' }, null, res), {
    id: '1', label: '', agent: '', status: 'completed', output: 'a\nb',
  })
})
test('normalizeRunResult: output 缺失回空', () => {
  const out = normalizeRunResult({ id: '1', label: 'L' }, null, {})
  assert.equal(out.output, '')
  assert.equal(out.status, 'completed')
})
test('normalizeRunResult: stopReason 缺失回 completed', () => {
  const out = normalizeRunResult({ id: '1' }, null, { output: [{ type: 'text', text: 'x' }] })
  assert.equal(out.status, 'completed')
})
test('normalizeRunResult: agent 名称、id/label 字符串化', () => {
  assert.deepEqual(normalizeRunResult({ id: 7 }, { name: 'bot' }, { output: [{ type: 'text', text: 'y' }], stopReason: 'done' }), {
    id: '7', label: '', agent: 'bot', status: 'done', output: 'y',
  })
})

// ---------------------------------------------------------------------------
// normalizeFinalRuns
// ---------------------------------------------------------------------------
test('normalizeFinalRuns: 字符串化与空字段回退', () => {
  const runs = [{ id: 1 }, { id: 2, label: 'L', agent: 'A', status: 'ok', output: 'o' }]
  assert.deepEqual(normalizeFinalRuns(runs), [
    { id: '1', label: '', agent: '', status: 'undefined', output: '' },
    { id: '2', label: 'L', agent: 'A', status: 'ok', output: 'o' },
  ])
})

// ---------------------------------------------------------------------------
// poolRun
// ---------------------------------------------------------------------------
test('poolRun: 结果保序且按并发上限执行', async () => {
  let current = 0
  let max = 0
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
  const results = await poolRun(items, 2, async (item, i) => {
    current += 1
    max = Math.max(max, current)
    await new Promise((r) => setTimeout(r, (5 - i) * 2))
    current -= 1
    return { id: item.id, done: true }
  })
  assert.deepEqual(results.map((r) => r.id), [1, 2, 3, 4, 5])
  assert.equal(max, 2)
})
test('poolRun: 单任务异常被捕获为 error，不中断其它任务', async () => {
  const items = [{ id: 1 }, { id: 2 }]
  const results = await poolRun(items, 4, async (item) => {
    if (item.id === 2) throw new Error('boom')
    return { id: item.id, ok: true }
  })
  assert.deepEqual(results[0], { id: 1, ok: true })
  assert.deepEqual(results[1], { id: '2', label: '', agent: '', status: 'error', output: 'boom' })
})
test('poolRun: limit 小于 1 时按 1 执行', async () => {
  let current = 0
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
  await poolRun(items, 0, async (item) => {
    current += 1
    await new Promise((r) => setTimeout(r, 2))
    current -= 1
    assert.ok(current >= 0)
    return item
  })
  assert.equal(current, 0)
})
test('poolRun: items 为空返回空数组', async () => {
  assert.deepEqual(await poolRun([], 3, async () => ({})), [])
})

// ---------------------------------------------------------------------------
// summarizeRuns
// ---------------------------------------------------------------------------
test('summarizeRuns: 首行键、n、agent 标记与 status', () => {
  const t = (key, params) => key + ':' + params.n
  const runs = [
    { id: 'a', label: 'ONE', agent: 'bot', status: 'ok', output: 'hello' },
    { id: 'b', label: '', status: 'error', output: '' },
  ]
  const out = summarizeRuns(runs, t)
  const lines = out.split('\n')
  assert.equal(lines[0], 'orch.sumDone:2')
  assert.equal(lines[1], '- ONE [via bot] [ok]: hello')
  assert.equal(lines[2], '- b [error]')
})
test('summarizeRuns: body 截断与 totalLimit 截断', () => {
  const t = () => 'FIRSTLINE'
  const runs = [{ id: 'a', label: 'L', status: 'ok', output: 'x'.repeat(100) }]
  const short = summarizeRuns(runs, t, { bodyLimit: 10, totalLimit: 10000 })
  assert.ok(short.includes('x'.repeat(10)))
  assert.ok(!short.includes('x'.repeat(11)))
  const long = summarizeRuns(runs, t, { bodyLimit: 500, totalLimit: 25 })
  assert.equal(long.length, 25)
})

// ---------------------------------------------------------------------------
// renderRunOutput
// ---------------------------------------------------------------------------
test('renderRunOutput: 空 value', () => {
  assert.deepEqual(renderRunOutput(undefined), [{ type: 'text', text: '' }])
  assert.deepEqual(renderRunOutput(null), [{ type: 'text', text: '' }])
  assert.deepEqual(renderRunOutput({}), [{ type: 'text', text: '' }])
})
test('renderRunOutput: summary 与各 run 行格式', () => {
  const value = {
    summary: 'SUMMARY',
    runs: [
      { id: 'a', label: 'ONE', agent: 'bot', status: 'ok', output: 'out' },
      { id: 'b', label: '', status: 'error', output: '' },
    ],
  }
  const [block] = renderRunOutput(value)
  const lines = block.text.split('\n\n')
  assert.equal(lines[0], 'SUMMARY')
  assert.ok(lines[1].includes('[ONE via bot] ok\nout'))
  assert.ok(lines[2].includes('[b] error\n'))
})
test('renderRunOutput: runOutputLimit / totalLimit 截断', () => {
  const value = { summary: 'S', runs: [{ id: 'a', label: 'L', status: 'ok', output: 'z'.repeat(50) }] }
  const [short] = renderRunOutput(value, { runOutputLimit: 10, totalLimit: 10000 })
  assert.ok(short.text.includes('z'.repeat(10)))
  assert.ok(!short.text.includes('z'.repeat(11)))
  const [truncated] = renderRunOutput(value, { runOutputLimit: 500, totalLimit: 20 })
  assert.equal(truncated.text.length, 20)
})

// ---------------------------------------------------------------------------
// appendPipelineCarry
// ---------------------------------------------------------------------------
test('appendPipelineCarry: 三种情况', () => {
  assert.equal(appendPipelineCarry('', 'o'), 'o')
  assert.equal(appendPipelineCarry('', 'out'), 'out')
  assert.equal(appendPipelineCarry('carry', 'out'), 'carry\n\nout')
  // 有 carry 但 output 为空：仍保留 carry + 分隔符，符合 (carry ? carry + '\n\n' : '') + (output || '')
  assert.equal(appendPipelineCarry('carry', ''), 'carry\n\n')
  assert.equal(appendPipelineCarry('carry', null), 'carry\n\n')
})

// ---------------------------------------------------------------------------
// buildSupervisorPrompt
// ---------------------------------------------------------------------------
test('buildSupervisorPrompt: 精确拼接', () => {
  assert.equal(buildSupervisorPrompt('INSTR', 'MERGED', 'SEP'), 'INSTR\n\nSEP\n\nMERGED')
})
