/** 装饰器 initializer 回调。 */
export type Initializer = (this: object, value?: unknown) => unknown;
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
export declare function runInitializers(thisArg: object, initializers: Initializer[], value?: unknown): unknown;
/** 装饰上下文（与官方 __esDecorate 的 context 形状一致）。 */
export interface DecorateContext {
    kind: string;
    name: string | symbol;
    static?: boolean;
    private?: boolean;
    access: Record<string, unknown>;
    metadata?: unknown;
    addInitializer?: (fn: Initializer) => void;
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
export declare function esDecorate(ctor: Function | null, decorators: Function[], contextIn: DecorateContext, initializers: unknown, extraInitializers: Initializer[]): void;
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
export declare function decorateRemoteMethod(RemoteDecorator: (exportName: string) => Function, ctor: Function, methodName: string, exportName: string, extraInitializers: Initializer[]): void;
