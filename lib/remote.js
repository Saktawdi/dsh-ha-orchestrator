// Official-style decorator runtime for plain JS packages.
// Mirrors the compiled `__esDecorate` / `__runInitializers` shape emitted by
// official DSH bundles such as @deepseek-ai/dsh-goal. Pure ESM: no DSH imports,
// standard library only, so this stays testable in isolation.

/**
 * Run the field/accessor initializers registered via `context.addInitializer`,
 * in registration order, with `this` = `thisArg`.
 *
 * @param {object} thisArg  Instance to bind as `this` for each initializer.
 * @param {Function[]} initializers  Initializer callbacks (possibly empty).
 * @param {*} [value]  Initializer input value. When provided, each initializer
 *   receives the previous value and its return becomes the next input / final
 *   result; otherwise initializers receive no argument and the result `value`
 *   is `undefined`.
 */
export function runInitializers(thisArg, initializers, value) {
  const useValue = arguments.length > 2
  for (let i = 0; i < initializers.length; i += 1) {
    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg)
  }
  return useValue ? value : undefined
}

/**
 * Apply a stack of decorators to a member, mirroring the official compiled
 * `__esDecorate` helper. Decorators run in reverse order; each sees a fresh
 * context whose `access` object is a shallow copy, and may return the new value.
 *
 * @param {Function} ctor  Class (or prototype is derived from it via static flag).
 * @param {Function[]} decorators  Decorators, applied last-to-first.
 * @param {object} contextIn  Decoration context ({kind,name,static,private,access,metadata}).
 * @param {object} initializers  Unused in this shape (official passes null).
 * @param {Function[]} extraInitializers  Collects `context.addInitializer` callbacks.
 */
export function esDecorate(ctor, decorators, contextIn, initializers, extraInitializers) {
  function accept(fn) {
    if (fn !== undefined && typeof fn !== 'function') throw new TypeError('Function expected')
    return fn
  }
  const kind = contextIn.kind
  const key = kind === 'getter' ? 'get' : kind === 'setter' ? 'set' : 'value'
  const target = ctor ? (contextIn.static ? ctor : ctor.prototype) : null
  const descriptor = target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {}
  let done = false
  for (let i = decorators.length - 1; i >= 0; i -= 1) {
    const context = {}
    for (const p in contextIn) context[p] = p === 'access' ? {} : contextIn[p]
    for (const p in contextIn.access) context.access[p] = contextIn.access[p]
    context.addInitializer = function (fn) {
      if (done) throw new TypeError('Cannot add initializers after decoration has completed')
      extraInitializers.push(accept(fn || null))
    }
    const result = decorators[i](descriptor[key], context)
    if (result !== undefined) descriptor[key] = result
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor)
  done = true
}

/**
 * Decorate a single prototype method that was previously marked with the
 * `@Remote(exportName)` decorator from @deepseek-ai/dsh-typert-protocol, wiring
 * its exported remote name and deferring any `addInitializer` callbacks into
 * `extraInitializers` (to be flushed later via `runInitializers`).
 *
 * @param {Function} RemoteDecorator  `Remote(exportName)` factory.
 * @param {Function} ctor  The `TypertRemoteService` subclass.
 * @param {string} methodName  Prototype method key being decorated.
 * @param {string} exportName  Remote export name passed to `Remote(...)`.
 * @param {Function[]} extraInitializers  Shared collector for all methods.
 */
export function decorateRemoteMethod(RemoteDecorator, ctor, methodName, exportName, extraInitializers) {
  const metadata = typeof Symbol === 'function' && Symbol.metadata ? Object.create(null) : undefined
  esDecorate(ctor, [RemoteDecorator(exportName)], {
    kind: 'method',
    name: methodName,
    static: false,
    private: false,
    access: {
      has: (obj) => methodName in obj,
      get: (obj) => obj[methodName],
    },
    metadata,
  }, null, extraInitializers)
}
