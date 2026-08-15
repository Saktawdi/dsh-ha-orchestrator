// ============================================================================
// lib/remote.js 单元测试 —— 官方风格装饰器运行时（纯 node:test + assert/strict）
// ----------------------------------------------------------------------------
// 覆盖：decorateRemoteMethod 的 context/export/access 传递、metadata 存在性、
// addInitializer 的延迟执行语义（runInitializers）、描述符保持、完成后 addInitializer
// 抛错、以及多方法的 exportName 与 initializer 顺序。
// 运行：node --test tests/remote.test.js
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esDecorate, runInitializers, decorateRemoteMethod } from '../lib/remote.js'

// 同时提供两个独立装饰器工厂，模拟官方 `Remote(export)`：只会在 context 上
// 记录 exportName / 方法引用，并支持 registerInitializer 以便测试 addInitializer。
function makeRemoteFactory() {
  const records = []
  function Remote(exportName) {
    return function remoteMethodDecorator(fn, context) {
      records.push({ exportName, fn, context })
      return fn
    }
  }
  // 记录装饰期 addInitializer 注册函数的收集器
  let drain = null
  Remote.drain = () => {
    const list = drain
    drain = null
    return list
  }
  Remote.record = (fn) => { drain = drain || []; drain.push(fn) }
  return { Remote, records }
}

test('decorateRemoteMethod: exportName 传给 RemoteDecorator，context 为 method/name/static=false/private=false', () => {
  const { Remote, records } = makeRemoteFactory()
  class Svc {}
  Svc.prototype.stateGet = function stateGet() { return 'value' }
  const initializers = []
  decorateRemoteMethod(Remote, Svc, 'stateGet', 'stateGet', initializers)

  const rec = records[0]
  assert.ok(rec, 'RemoteDecorator 应被调用')
  assert.equal(rec.exportName, 'stateGet')
  const ctx = rec.context
  assert.equal(ctx.kind, 'method')
  assert.equal(ctx.name, 'stateGet')
  assert.equal(ctx.static, false)
  assert.equal(ctx.private, false)
  assert.equal(typeof ctx.addInitializer, 'function')
  // access.has / access.get 操作原型上的方法
  assert.equal(ctx.access.has(Svc.prototype), true)
  assert.equal(ctx.access.get(Svc.prototype), Svc.prototype.stateGet)
})

test('decorateRemoteMethod: Symbol.metadata 存在时 context.metadata 为对象，否则为 undefined', () => {
  const { Remote, records } = makeRemoteFactory()
  class Svc {}
  Svc.prototype.haReset = function haReset() {}
  const initializers = []
  decorateRemoteMethod(Remote, Svc, 'haReset', 'haReset', initializers)

  const ctx = records[0].context
  if (typeof Symbol === 'function' && Symbol.metadata) {
    assert.ok(ctx.metadata && typeof ctx.metadata === 'object', 'metadata 应存在且为对象')
    assert.notEqual(ctx.metadata, null)
  } else {
    assert.equal(ctx.metadata, undefined)
  }
})

test('runInitializers: addInitializer 函数延迟到调用后才执行，且 this 为实例', () => {
  const Remote2 = (exportName) => {
    return function (fn, context) {
      context.addInitializer(function () {
        this.__initialized = (this.__initialized || 0) + 1
        this.__export = exportName
      })
      return fn
    }
  }
  class Svc {}
  Svc.prototype.stateReload = function stateReload() {}
  const initializers = []
  decorateRemoteMethod(Remote2, Svc, 'stateReload', 'stateReload', initializers)

  assert.equal(initializers.length, 1, '应在装饰期注册 1 个 initializer')
  const instance = Object.create(Svc.prototype)
  instance.__export = undefined
  // 返回时尚未执行
  assert.equal(instance.__initialized, undefined)

  const returned = runInitializers(instance, initializers)
  assert.equal(instance.__initialized, 1, '调用 runInitializers 后 initializer 才执行')
  assert.equal(instance.__export, 'stateReload', 'this 为实例，赋值落在实例上')
  assert.equal(returned, undefined)
})

test('描述符保持：装饰后方法仍可正常调用且原引用不变', () => {
  const Remote2 = (exportName) => (fn, context) => context.addInitializer(() => {}) || fn
  class Svc {}
  const original = function stateSet() { return 'set-' + arguments[0] }
  Svc.prototype.stateSet = original
  const initializers = []
  decorateRemoteMethod(Remote2, Svc, 'stateSet', 'stateSet', initializers)
  runInitializers(Object.create(Svc.prototype), initializers)

  const instance = Object.create(Svc.prototype)
  assert.equal(instance.stateSet('a'), 'set-a', '方法可正常调用')
  assert.equal(Svc.prototype.stateSet, original, '原方法引用不变')
})

test('装饰完成后调用保存的 context.addInitializer 抛 TypeError', () => {
  let savedAdd = null
  const Remote2 = (exportName) => (fn, context) => {
    savedAdd = context.addInitializer
    return fn
  }
  class Svc {}
  Svc.prototype.modelsList = function modelsList() {}
  const initializers = []
  decorateRemoteMethod(Remote2, Svc, 'modelsList', 'modelsList', initializers)

  assert.throws(() => savedAdd(() => {}), TypeError, '完成后 addInitializer 应抛 TypeError')
})

test('多方法：不同 exportName + 实例 initializer 保持注册顺序', () => {
  // 用两个不同 export name 装饰两个方法
  const exports = []
  const Remote2 = (exportName) => (fn, context) => {
    context.addInitializer(function () {
      this.__order = (this.__order || []).slice()
      this.__order.push(exportName)
    })
    return fn
  }
  class Svc {}
  Svc.prototype.debugLogs = function debugLogs() {}
  Svc.prototype.debugClear = function debugClear() {}
  const initializers = []
  decorateRemoteMethod(Remote2, Svc, 'debugLogs', 'debugLogs', initializers)
  decorateRemoteMethod(Remote2, Svc, 'debugClear', 'debugClear', initializers)

  assert.equal(initializers.length, 2, '应为 2 个方法各注册 1 个 initializer')
  const instance = Object.create(Svc.prototype)
  runInitializers(instance, initializers)
  // 注册顺序 = 调用 decorateRemoteMethod 的顺序：先 debugLogs 后 debugClear
  assert.deepEqual(instance.__order, ['debugLogs', 'debugClear'])
})

// ---- 低层 esDecorate / runInitializers 行为（保证与官方编译产物同形） ----
test('esDecorate: 装饰器按倒序应用，返回非 undefined 替换描述符值', () => {
  class Svc {}
  Svc.prototype.m = function m() { return 'orig' }
  const order = []
  const ctxs = []
  const decA = (fn, context) => { order.push('A'); ctxs.push(context); return fn }
  const decB = (fn, context) => { order.push('B'); ctxs.push(context); return function () { return 'b-wrapped' } }
  const initializers = []
  esDecorate(Svc, [decA, decB], {
    kind: 'method', name: 'm', static: false, private: false,
    access: { has: () => true, get: () => Svc.prototype.m },
    metadata: typeof Symbol === 'function' && Symbol.metadata ? Object.create(null) : undefined,
  }, null, initializers)
  // 倒序：B 先应用，A 后应用
  assert.deepEqual(order, ['B', 'A'])
  assert.equal(ctxs[0].name, 'm')
  assert.equal(new Svc().m(), 'b-wrapped', '保留最后应用装饰器的返回')
})

test('esDecorate: addInitializer 进入 extraInitializers，runInitializers 后执行且顺序不变', () => {
  class Svc {}
  Svc.prototype.p = function p() {}
  const order = []
  const initializers = []
  esDecorate(Svc, [(fn, context) => {
    context.addInitializer(function () { order.push('first') })
    return fn
  }, (fn, context) => {
    context.addInitializer(function () { order.push('second') })
    return fn
  }], {
    kind: 'method', name: 'p', static: false, private: false,
    access: { has: () => true, get: () => Svc.prototype.p },
    metadata: undefined,
  }, null, initializers)

  assert.equal(initializers.length, 2)
  assert.deepEqual(order, [], '装饰期：initializer 尚未执行')
  runInitializers(Object.create(Svc.prototype), initializers)
  // 装饰器倒序执行（数组中后者先跑），因此 addInitializer 的注册顺序为
  // 'second' 先注册、'first' 后注册，执行顺序 = 注册顺序。
  assert.deepEqual(order, ['second', 'first'])
})

test('runInitializers: 传 value 时每个 initializer 接收上一步返回并按序传递', () => {
  const initializers = [
    (v) => v + 1,
    (v) => v * 10,
  ]
  const result = runInitializers(null, initializers, 5)
  assert.equal(result, 60, '((5+1)*10)')
})

test('runInitializers: 无 value 时 initializer 无参调用，返回 undefined', () => {
  const called = []
  const initializers = [
    function () { called.push(this) },
    function () { called.push('x') },
  ]
  const instance = { tag: 'inst' }
  const result = runInitializers(instance, initializers)
  assert.equal(result, undefined)
  assert.equal(called.length, 2)
  assert.equal(called[0], instance)
})
