import type { Context } from '@deepseek-ai/cordis';
declare const name = "dsh-ha-orchestrator";
declare const inject: string[];
declare function apply(ctx: Context): Promise<void>;
export { apply, inject, name };
declare const _default: {
    apply: typeof apply;
    inject: string[];
    name: string;
};
export default _default;
