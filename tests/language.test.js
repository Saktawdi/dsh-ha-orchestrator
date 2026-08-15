import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseDictModule,
  resolveTarget,
  pickDict,
  translate,
  makeT,
} from '../lib/language.js'

// ---------------------------------------------------------------------------
// parseDictModule
// ---------------------------------------------------------------------------
test('parseDictModule: 合法 JSON 字符串对象返回字典', () => {
  const dict = parseDictModule('{"hello": "你好", "world": "世界"}')
  assert.deepEqual(dict, { hello: '你好', world: '世界' })
})

test('parseDictModule: 带 BOM 的合法文本可解析', () => {
  const dict = parseDictModule('\uFEFF{"a": "中"}')
  assert.deepEqual(dict, { a: '中' })
})

test('parseDictModule: 非法 JSON 返回 null', () => {
  assert.equal(parseDictModule('{not valid json'), null)
  assert.equal(parseDictModule('hello world'), null)
})

test('parseDictModule: 数组返回 null', () => {
  assert.equal(parseDictModule('[1, 2, 3]'), null)
})

test('parseDictModule: 空对象返回 null', () => {
  assert.equal(parseDictModule('{}'), null)
})

test('parseDictModule: 含非字符串值的对象返回 null', () => {
  assert.equal(parseDictModule('{"a": 123}'), null)
  assert.equal(parseDictModule('{"a": null}'), null)
  assert.equal(parseDictModule('{"a": {"b": 1}}'), null)
  assert.equal(parseDictModule('{"a": ["x"]}'), null)
})

test('parseDictModule: 输入 null/undefined 返回 null', () => {
  assert.equal(parseDictModule(null), null)
  assert.equal(parseDictModule(undefined), null)
})

// ---------------------------------------------------------------------------
// resolveTarget
// ---------------------------------------------------------------------------
test('resolveTarget: zh/en 固定模式直接返回', () => {
  assert.equal(resolveTarget('zh', 'en'), 'zh')
  assert.equal(resolveTarget('zh', 'zh'), 'zh')
  assert.equal(resolveTarget('zh', null), 'zh')
  assert.equal(resolveTarget('en', 'zh'), 'en')
  assert.equal(resolveTarget('en', 'en'), 'en')
  assert.equal(resolveTarget('en', null), 'en')
})

test('resolveTarget: auto + en 返回 en', () => {
  assert.equal(resolveTarget('auto', 'en'), 'en')
})

test('resolveTarget: auto + null 或未知值返回 zh', () => {
  assert.equal(resolveTarget('auto', null), 'zh')
  assert.equal(resolveTarget('auto', undefined), 'zh')
  assert.equal(resolveTarget('auto', 'fr'), 'zh')
  assert.equal(resolveTarget('auto', 'whatever'), 'zh')
})

// ---------------------------------------------------------------------------
// pickDict
// ---------------------------------------------------------------------------
test('pickDict: en 目标且 en 字典合法 -> active=en rollback=false', () => {
  const dicts = { zh: { a: '中' }, en: { a: 'en' } }
  assert.deepEqual(pickDict(dicts, 'en'), { active: 'en', rollback: false, reason: '' })
})

test('pickDict: en 目标但 en 缺失 -> active=zh rollback=true reason=en', () => {
  const dicts = { zh: { a: '中' } }
  assert.deepEqual(pickDict(dicts, 'en'), { active: 'zh', rollback: true, reason: 'en' })
})

test('pickDict: en 目标但 en 非法(null) -> 回滚 zh reason=en', () => {
  const dicts = { zh: { a: '中' }, en: null }
  assert.deepEqual(pickDict(dicts, 'en'), { active: 'zh', rollback: true, reason: 'en' })
})

test('pickDict: zh 目标且 zh 字典合法 -> active=zh', () => {
  const dicts = { zh: { a: '中' } }
  assert.deepEqual(pickDict(dicts, 'zh'), { active: 'zh', rollback: false, reason: '' })
})

test('pickDict: zh 目标但 zh 缺失 -> rollback=true reason=zh', () => {
  assert.deepEqual(pickDict({}, 'zh'), { active: 'zh', rollback: true, reason: 'zh' })
  assert.deepEqual(pickDict(null, 'zh'), { active: 'zh', rollback: true, reason: 'zh' })
  assert.deepEqual(pickDict(undefined, 'zh'), { active: 'zh', rollback: true, reason: 'zh' })
})

test('pickDict: 尽管理想上 zh 缺失不应回滚，但确定目标为 zh 且缺失是合法路径之外的状况', () => {
  const dicts = { en: { a: 'en' } }
  const r = pickDict(dicts, 'zh')
  assert.deepEqual(r, { active: 'zh', rollback: true, reason: 'zh' })
})

// ---------------------------------------------------------------------------
// translate
// ---------------------------------------------------------------------------
test('translate: 命中键返回原文', () => {
  const dict = { greeting: '你好' }
  assert.equal(translate(dict, 'greeting'), '你好')
})

test('translate: 缺失键返回 key 本身', () => {
  const dict = { greeting: '你好' }
  assert.equal(translate(dict, 'missing'), 'missing')
})

test('translate: {name} 占位符被替换', () => {
  const dict = { greet: '早上好，{name}！' }
  assert.equal(translate(dict, 'greet', { name: '小明' }), '早上好，小明！')
})

test('translate: 参数缺失时占位符保留', () => {
  const dict = { greet: '早上好，{name}！' }
  assert.equal(translate(dict, 'greet', {}), '早上好，{name}！')
  assert.equal(translate(dict, 'greet', { other: 'x' }), '早上好，{name}！')
})

test('translate: 数字参数被字符串化', () => {
  const dict = { count: '总计 {n} 个' }
  assert.equal(translate(dict, 'count', { n: 42 }), '总计 42 个')
})

test('translate: 无 params 时返回模板本身（不插值）', () => {
  const dict = { greet: '早上好，{name}！' }
  assert.equal(translate(dict, 'greet'), '早上好，{name}！')
})

// ---------------------------------------------------------------------------
// makeT
// ---------------------------------------------------------------------------
test('makeT: 生成的函数按绑定字典查词', () => {
  const dict = { hello: '你好', greet: '你好，{name}' }
  const t = makeT(dict)
  assert.equal(t('hello'), '你好')
  assert.equal(t('missing'), 'missing')
  assert.equal(t('greet', { name: '小张' }), '你好，小张')
})

test('makeT: 绑定字典为 null 时缺失键返回 key 本身', () => {
  const t = makeT(null)
  assert.equal(t('hello'), 'hello')
})
