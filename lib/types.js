// ============================================================================
// ha-orchestrator 服务类型定义 —— index.ts 消费的 DSH 服务最小结构契约
// ----------------------------------------------------------------------------
// 设计取舍：不直接依赖 dsh-* 各包的服务类型（rc 阶段类型变动频繁），
// 而是定义本插件消费的最小结构接口，经 getService() 从 ctx 取用；
// 事件载荷（agent/request 等）与 Agent 类型则使用官方 dsh-agent 声明。
// ============================================================================
/**
 * 从 ctx 读取服务（等价 ctx.get(name)，带 try/catch 与空值归一）。
 * 服务未就绪/未注册时返回 null，与旧版调用点语义一致。
 */
export function getService(ctx, name) {
    try {
        const get = ctx.get;
        if (typeof get !== 'function')
            return null;
        const v = get.call(ctx, name);
        return (v ?? null);
    }
    catch (e) {
        return null;
    }
}
