// Official-style decorator runtime for plain JS packages.
// Mirrors the compiled `__esDecorate` / `__runInitializers` shape emitted by
// official DSH bundles such as @deepseek-ai/dsh-goal. Pure ESM: no DSH imports,
// standard library only, so this stays testable in isolation.

/** 装饰器 initializer 回调。 */
export type Initializer = (this: object, value?: unknown) => unknown

/**
 * Run the field/accessor initializers registered via `context.addInitializer`,
 * in registration order, with `this` = `thisArg`.
 *
 * @param thisArg  Instance to bind as `this` for each initializer.
 * @param initializers  Initializer callbacks (possibly empty).
 * @param value  Initializer input value. When provided, each initializer
 *   receives the previous value and its return becomes the next input / final
 *   result; otherwise initializers receive no argument and the result `value`
 *   is `undefined`.
 */
export function runInitializers(thisArg: object, initializers: Initializer[], value?: unknown): unknown {
  const useValue = arguments.length > 2
  for (let i = 0; i < initializers.length; i += 1) {
    value = useValue
      ? (initializers[i] as (this: object, v: unknown) => unknown).call(thisArg, value)
      : (initializers[i] as (this: object) => unknown).call(thisArg)
  }
  return useValue ? value : undefined
}

/** 装饰上下文（与官方 __esDecorate 的 context 形状一致）。 */
export interface DecorateContext {
  kind: string
  name: string | symbol
  static?: boolean
  private?: boolean
  access: Record<string, unknown>
  metadata?: unknown
  addInitializer?: (fn: Initializer) => void
}

/**
 * Apply a stack of decorators to a member, mirroring the official compiled
 * `__esDecorate` helper. Decorators run in reverse order; each sees a fresh
 * context whose `access` object is a shallow copy, and may return the new value.
 *
 * @param ctor  Class (or prototype is derived from it via static flag).
 * @param decorators  Decorators, applied last-to-first.
 * @param contextIn  Decoration context ({kind,name,static,private,access,metadata}).
 * @param initializers  Unused in this shape (official passes null).
 * @param extraInitializers  Collects `context.addInitializer` callbacks.
 */
export function esDecorate(
  ctor: Function | null,
  decorators: Function[],
  contextIn: DecorateContext,
  initializers: unknown,
  extraInitializers: Initializer[],
): void {
  function accept(fn: unknown): Initializer {
    if (fn !== undefined && typeof fn !== 'function') throw new TypeError('Function expected')
    return fn as Initializer
  }
  const kind = contextIn.kind
  const key = kind === 'getter' ? 'get' : kind === 'setter' ? 'set' : 'value'
  const target = ctor ? (contextIn.static ? ctor : (ctor as { prototype: object }).prototype) : null
  const descriptor = target ? Object.getOwnPropertyDescriptor(target, contextIn.name as string | symbol) : undefined
  const holder: Record<string, unknown> = { ...(descriptor || {}) }
  let done = false
  for (let i = decorators.length - 1; i >= 0; i -= 1) {
    const context: Record<string, unknown> = {}
    for (const p in contextIn) context[p] = p === 'access' ? {} : (contextIn as unknown as Record<string, unknown>)[p]
    for (const p in contextIn.access) (context.access as Record<string, unknown>)[p] = contextIn.access[p]
    ;(context as { addInitializer?: (fn: Initializer) => void }).addInitializer = function (fn: Initializer) {
      if (done) throw new TypeError('Cannot add initializers after decoration has completed')
      extraInitializers.push(accept(fn || null))
    }
    const result = decorators[i](holder[key], context)
    if (result !== undefined) holder[key] = result
  }
  if (target) Object.defineProperty(target, contextIn.name as string | symbol, holder as PropertyDescriptor)
  done = true
}

/**
 * Decorate a single prototype method that was previously marked with the
 * `@Remote(exportName)` decorator from @deepseek-ai/dsh-typert-protocol, wiring
 * its exported remote name and deferring any `addInitializer` callbacks into
 * `extraInitializers` (to be flushed later via `runInitializers`).
 *
 * @param RemoteDecorator  `Remote(exportName)` factory.
 * @param ctor  The `TypertRemoteService` subclass.
 * @param methodName  Prototype method key being decorated.
 * @param exportName  Remote export name passed to `Remote(...)`.
 * @param extraInitializers  Shared collector for all methods.
 */
export function decorateRemoteMethod(
  RemoteDecorator: (exportName: string) => Function,
  ctor: Function,
  methodName: string,
  exportName: string,
  extraInitializers: Initializer[],
): void {
  const metadata = typeof Symbol === 'function' && (Symbol as unknown as { metadata?: unknown }).metadata ? Object.create(null) : undefined
  esDecorate(ctor, [RemoteDecorator(exportName)], {
    kind: 'method',
    name: methodName,
    static: false,
    private: false,
    access: {
      has: (obj: object) => methodName in obj,
      get: (obj: Record<string, unknown>) => obj[methodName],
    },
    metadata,
  }, null, extraInitializers)
}
