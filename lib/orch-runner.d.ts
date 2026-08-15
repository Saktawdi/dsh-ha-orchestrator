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
}
/** 自定义子智能体定义最小形状（provider/model/systemPrompt 可选）。 */
export interface AgentDefLike {
    name: string;
    provider?: string;
    model?: string;
    systemPrompt?: string;
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
    };
}
/** 子智能体运行结果（提供方 result 最小形状）。 */
export interface SubagentResultLike {
    stopReason?: string;
    output?: Array<{
        type?: string;
        text?: string;
    } | null>;
}
/** 统一 run 结构。 */
export interface RunResultLike {
    id: string;
    label: string;
    agent: string;
    status: string;
    output: string;
}
/** 翻译函数（t(key, params)）。 */
export interface TFunc {
    (key: string, params?: Record<string, string | number>): string;
}
/** 编排工具 args 最小形状（findUnknownAgents 消费）。 */
export interface OrchestrateArgsLike {
    agent?: string | null;
    supervisorAgent?: string | null;
    tasks?: Array<{
        agent?: string | null;
    } | null> | null;
}
export declare function textBlocks(text: string): TextBlock[];
export declare function resolveAgentDef(agents: AgentDefLike[] | null | undefined, name: string | null | undefined): AgentDefLike | null;
export declare function findUnknownAgents(args: OrchestrateArgsLike | null | undefined, tasks: Array<{
    agent?: string | null;
} | null> | null | undefined, agents: AgentDefLike[] | null | undefined): {
    availableNames: string[];
    unknown: string[];
};
export declare function truncateTasks<T>(tasks: T[], maxAgents: number): T[];
export declare function resolveConcurrency(argsConcurrency: number | null | undefined, cfgConcurrency: number | null | undefined, maxAgents: number): number;
export declare function resolveMode(mode: string | null | undefined): 'fanout' | 'pipeline' | 'supervisor';
export declare function buildRunPrompt(task: TaskLike, extra: string | null | undefined, mergedPrefix: string): string;
export declare function buildSubagentRequest(task: TaskLike, extra: string | null | undefined, agentDef: AgentDefLike | null | undefined, mergedPrefix: string, parent: unknown, signal: AbortSignal | null | undefined): SubagentRequestLike;
export declare function normalizeRunResult(task: TaskLike, agentDef: AgentDefLike | null | undefined, res: SubagentResultLike): RunResultLike;
export declare function normalizeFinalRuns(runs: RunResultLike[]): RunResultLike[];
export declare function poolRun<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>;
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
export declare function buildSupervisorPrompt(instruction: string, merged: string, outputSeparator: string): string;
