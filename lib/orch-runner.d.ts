/** 文本内容块（DSH content block 最小形状）。 */
export interface TextBlock {
    type: 'text';
    text: string;
}
/** 任务定义最小形状（编排工具 tasks 条目）。 */
export interface TaskLike {
    id?: string;
    label?: string;
    agent?: string;
    prompt: string;
    /** 输出要求提示（追加到子任务 prompt 末尾，如“以 markdown 表格输出”）。 */
    outputHint?: string;
    /** 结构化输出 JSON Schema（object 根）；provider 支持时子智能体返回匹配 JSON。 */
    outputSchema?: Record<string, unknown> | null;
}
/** 自定义子智能体定义最小形状（provider/model/reasoningEffort/systemPrompt/tools 可选）。 */
export interface AgentDefLike {
    name: string;
    provider?: string;
    model?: string;
    /** 模型推理强度；留空 = 使用 provider/model 默认值。 */
    reasoningEffort?: string;
    systemPrompt?: string;
    /** 工具裁剪（allow 白名单 / deny 黑名单）；调用方负责 provider 能力门控。 */
    tools?: {
        allow?: string[];
        deny?: string[];
    };
    /** 该角色独立的模型回退链；执行器只消费这组候选，不修改原定义。 */
    fallbacks?: Array<{
        provider?: string;
        model?: string;
        label?: string;
        reasoningEffort?: string;
    }>;
}
/** 子智能体回退候选的最小形状。 */
export interface SubagentFallbackTarget {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** 子智能体运行请求（提供方 contract 最小形状）。 */
export interface SubagentRequestLike {
    label: string;
    prompt: TextBlock[];
    parent?: unknown;
    signal?: AbortSignal;
    persona?: string;
    agentOptions?: {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    };
    /** 按子智能体裁剪工具（allow 白名单 / deny 黑名单）。 */
    toolFilter?: {
        allow?: string[];
        deny?: string[];
    };
    /** 结构化输出 JSON Schema（object 根）。 */
    outputSchema?: Record<string, unknown>;
    /** 委托深度平台级硬上限。 */
    maxDepth?: number;
}
/** 清洗工具裁剪名单：字符串化、去空白、去空项；allow/deny 任一非空才返回对象，否则 null。 */
export declare function cleanToolFilter(tools: {
    allow?: unknown;
    deny?: unknown;
} | null | undefined): {
    allow?: string[];
    deny?: string[];
} | null;
/** 子智能体运行结果（提供方 result 最小形状）。 */
export interface SubagentResultLike {
    stopReason?: string;
    output?: Array<{
        type?: string;
        text?: string;
    } | null>;
    /** outputSchema 命中时平台返回的结构化 JSON。 */
    structured?: unknown;
}
/** 统一 run 结构。 */
export interface RunResultLike {
    id: string;
    label: string;
    agent: string;
    status: string;
    output: string;
    /** 子智能体实际执行的 HA lastKey（provider/model），用于卡片可观测。 */
    lastKey?: string;
    /** 子智能体会话 id；用于从客户端会话记录回读 token 用量并跳转。 */
    agentId?: string;
}
/** 翻译函数（t(key, params)）。 */
export interface TFunc {
    (key: string, params?: Record<string, string | number>): string;
}
/** 编排工具 args 最小形状（findUnknownAgents 消费）。 */
export interface OrchestrateArgsLike {
    agent?: string | null;
    supervisorAgent?: string | null;
    reviewers?: Array<string | null> | null;
    tasks?: Array<{
        agent?: string | null;
    } | null> | null;
}
export declare function textBlocks(text: string): TextBlock[];
export declare function resolveAgentDef(agents: AgentDefLike[] | null | undefined, name: string | null | undefined): AgentDefLike | null;
/**
 * 解析一个自定义子智能体的独立回退链。
 *
 * 这里返回完整的 provider/model/effort 候选，并去重/排除相同主候选：执行层
 * 可以复用同一套候选遍历机制处理 start 拒绝、result=error 与基础设施异常，
 * 而不会改写配置对象或把主 HA 的全局 backups 混进来。
 */
export declare function resolveSubagentFallbacks(agentDef: AgentDefLike | null | undefined): SubagentFallbackTarget[];
export declare function findUnknownAgents(args: OrchestrateArgsLike | null | undefined, tasks: Array<{
    agent?: string | null;
} | null> | null | undefined, agents: AgentDefLike[] | null | undefined): {
    availableNames: string[];
    unknown: string[];
};
export declare function truncateTasks<T>(tasks: T[], maxAgents: number): T[];
export declare function taskSignature(task: {
    id?: string;
    label?: string;
    prompt?: string;
} | null | undefined): string;
export declare function sameTaskList(a: Array<{
    id?: string;
    label?: string;
    prompt?: string;
} | null | undefined> | null | undefined, b: Array<{
    id?: string;
    label?: string;
    prompt?: string;
} | null | undefined> | null | undefined): boolean;
export declare function cleanTasks(tasks: unknown): TaskLike[];
export declare function resolveConcurrency(argsConcurrency: number | null | undefined, cfgConcurrency: number | null | undefined, maxAgents: number): number;
/** 编排模式。 */
export type OrchestrateMode = 'fanout' | 'pipeline' | 'supervisor' | 'map-reduce' | 'router';
export declare function resolveMode(mode: string | null | undefined): OrchestrateMode;
export declare function buildRunPrompt(task: TaskLike, extra: string | null | undefined, mergedPrefix: string): string;
export declare function buildSubagentRequest(task: TaskLike, extra: string | null | undefined, agentDef: AgentDefLike | null | undefined, mergedPrefix: string, parent: unknown, signal: AbortSignal | null | undefined): SubagentRequestLike;
export declare function normalizeRunResult(task: TaskLike, agentDef: AgentDefLike | null | undefined, res: SubagentResultLike): RunResultLike;
export declare function normalizeFinalRuns(runs: RunResultLike[]): RunResultLike[];
export declare function poolRun<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>, errorRun?: (item: T, error: unknown, index: number) => R): Promise<R[]>;
export declare function summarizeRuns(runs: RunResultLike[], t: TFunc, opts?: {
    bodyLimit?: number;
    totalLimit?: number;
}): string;
export declare function renderRunOutput(value: {
    summary?: string;
    runs?: Array<{
        id?: string;
        label?: string;
        agent?: string;
        status?: string;
        output?: string;
    }>;
} | null | undefined, opts?: {
    runOutputLimit?: number;
    totalLimit?: number;
}): TextBlock[];
export declare function appendPipelineCarry(carry: string | null | undefined, output: string | null | undefined): string;
export declare function pipelineStageBlock(index: number, taskId: string, output: string | null | undefined): string;
export declare function buildSupervisorPrompt(instruction: string, merged: string, outputSeparator: string): string;
