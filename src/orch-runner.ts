// orchid-runner 可复用编排执行纯逻辑。
// 无 DSH 依赖、无 ctx/console/process/fs、无模块级可变状态；所有函数为纯函数或纯异步函数。
// 语义严格对齐 index.ts（编排工具 buildOrchestrateTool / runOne / poolRun / summarize / render）。

/** 文本内容块（DSH content block 最小形状）。 */
export interface TextBlock {
  type: 'text'
  text: string
}

/** 任务定义最小形状（编排工具 tasks 条目）。 */
export interface TaskLike {
  id?: string
  label?: string
  agent?: string
  prompt: string
}

/** 自定义子智能体定义最小形状（provider/model/systemPrompt 可选）。 */
export interface AgentDefLike {
  name: string
  provider?: string
  model?: string
  systemPrompt?: string
}

/** 子智能体运行请求（提供方 contract 最小形状）。 */
export interface SubagentRequestLike {
  label: string
  prompt: TextBlock[]
  parent?: unknown
  signal?: AbortSignal
  persona?: string
  agentOptions?: { provider?: string; model?: string }
}

/** 子智能体运行结果（提供方 result 最小形状）。 */
export interface SubagentResultLike {
  stopReason?: string
  output?: Array<{ type?: string; text?: string } | null>
}

/** 统一 run 结构。 */
export interface RunResultLike {
  id: string
  label: string
  agent: string
  status: string
  output: string
}

/** 翻译函数（t(key, params)）。 */
export interface TFunc {
  (key: string, params?: Record<string, string | number>): string
}

/** 编排工具 args 最小形状（findUnknownAgents 消费）。 */
export interface OrchestrateArgsLike {
  agent?: string | null
  supervisorAgent?: string | null
  reviewers?: Array<string | null> | null
  tasks?: Array<{ agent?: string | null } | null> | null
}

// 将任意文本规范化为 text block 数组。
export function textBlocks(text: string): TextBlock[] {
  return [{ type: 'text', text: String(text) }]
}

// 按名称在 agents 数组中查找自定义子智能体定义。
// name 为空返回 null；找到（a && a.name === String(name)）返回该对象，否则 null。
export function resolveAgentDef(agents: AgentDefLike[] | null | undefined, name: string | null | undefined): AgentDefLike | null {
  if (!name) return null
  const found = (agents || []).find((a) => a && a.name === String(name))
  return found || null
}

// 收集 args/tasks 中引用了但 agents 里不存在的子智能体名称。
// 返回 { availableNames, unknown }；unknown 按出现顺序保留，不查重。args/tasks 可为 null。
export function findUnknownAgents(
  args: OrchestrateArgsLike | null | undefined,
  tasks: Array<{ agent?: string | null } | null> | null | undefined,
  agents: AgentDefLike[] | null | undefined,
): { availableNames: string[]; unknown: string[] } {
  const availableNames = (agents || []).map((a) => a.name)
  const unknown: string[] = []
  if (args && args.agent && !resolveAgentDef(agents, args.agent)) unknown.push(args.agent)
  if (tasks) {
    for (const tk of tasks) {
      if (tk && tk.agent && !resolveAgentDef(agents, tk.agent)) unknown.push(tk.agent)
    }
  }
  if (args && args.supervisorAgent && !resolveAgentDef(agents, args.supervisorAgent)) unknown.push(args.supervisorAgent)
  if (args && Array.isArray(args.reviewers)) {
    for (const rv of args.reviewers) {
      if (rv && !resolveAgentDef(agents, rv)) unknown.push(rv)
    }
  }
  return { availableNames, unknown }
}

// 按 maxAgents 截断 tasks（必须已是非空数组），返回新数组。
export function truncateTasks<T>(tasks: T[], maxAgents: number): T[] {
  const limit = Math.max(1, Number(maxAgents) || 8)
  return tasks.slice(0, limit)
}

// 解析并发数：下限 1，上限 maxAgents；argsConcurrency > cfgConcurrency > 默认 3。
export function resolveConcurrency(argsConcurrency: number | null | undefined, cfgConcurrency: number | null | undefined, maxAgents: number): number {
  const m = Math.max(1, Number(maxAgents) || 8)
  return Math.max(1, Math.min(Number(argsConcurrency) || Number(cfgConcurrency) || 3, m))
}

/** 编排模式。 */
export type OrchestrateMode = 'fanout' | 'pipeline' | 'supervisor' | 'map-reduce' | 'router'

// 归一化模式：仅已支持的模式原样返回，其余恒为 fanout。
export function resolveMode(mode: string | null | undefined): OrchestrateMode {
  if (mode === 'pipeline' || mode === 'supervisor' || mode === 'map-reduce' || mode === 'router') return mode
  return 'fanout'
}

// 组装子智能体的运行 prompt：extra 为空直接返回 task.prompt，否则拼接 mergedPrefix + extra 段 + task.prompt。
export function buildRunPrompt(task: TaskLike, extra: string | null | undefined, mergedPrefix: string): string {
  if (!extra) return task.prompt
  return mergedPrefix + '\n\n' + extra + '\n\n---\n\n' + task.prompt
}

// 构建发给子智能体提供方的 request 对象。
export function buildSubagentRequest(
  task: TaskLike,
  extra: string | null | undefined,
  agentDef: AgentDefLike | null | undefined,
  mergedPrefix: string,
  parent: unknown,
  signal: AbortSignal | null | undefined,
): SubagentRequestLike {
  const label = task.label || (agentDef && agentDef.name) || task.id || 'task'
  const prompt = textBlocks(buildRunPrompt(task, extra, mergedPrefix))
  const request: SubagentRequestLike = { label, prompt, parent }
  if (signal) request.signal = signal
  if (agentDef && agentDef.systemPrompt) request.persona = agentDef.systemPrompt
  if (agentDef && (agentDef.provider || agentDef.model)) {
    const agentOptions: { provider?: string; model?: string } = {}
    if (agentDef.provider) agentOptions.provider = String(agentDef.provider)
    if (agentDef.model) agentOptions.model = String(agentDef.model)
    request.agentOptions = agentOptions
  }
  return request
}

// 将提供方运行结果归一化为统一 run 结构。
export function normalizeRunResult(task: TaskLike, agentDef: AgentDefLike | null | undefined, res: SubagentResultLike): RunResultLike {
  const text = (res.output || []).filter((b): b is { type: string; text: string } => !!(b && b.type === 'text')).map((b) => b.text).join('\n')
  const status = String(res.stopReason || 'completed')
  return {
    id: String(task.id || task.label || 'task'),
    label: String(task.label || ''),
    agent: agentDef ? String(agentDef.name) : '',
    status,
    output: text || '',
  }
}

// 归一化为最终输出结构（全字段字符串化、缺失回空）。
export function normalizeFinalRuns(runs: RunResultLike[]): RunResultLike[] {
  return runs.map((r) => ({
    id: String(r.id),
    label: String(r.label || ''),
    agent: String(r.agent || ''),
    status: String(r.status),
    output: String(r.output || ''),
  }))
}

// 以并发上限 limit 执行 items，保持结果顺序；单任务异常被捕获为 error run，不中断其它任务。
// 泛型 R 为 worker 的返回类型；异常时落入统一的 error run 结构（调用方按需消费）。
export async function poolRun<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function slot(): Promise<void> {
    while (next < items.length) {
      const i = next
      next += 1
      const item = items[i]
      try {
        results[i] = await worker(item, i)
      } catch (e) {
        // 显式声明不隔离的错误（如预算耗尽）直接抛出，中止整个执行
        if (e && (e as { isolate?: boolean }).isolate === false) throw e
        results[i] = {
          id: String((item as Partial<TaskLike>).id || (item as Partial<TaskLike>).label || 'task'),
          label: String((item as Partial<TaskLike>).label || ''),
          agent: '',
          status: 'error',
          output: String((e && (e as Error).message) || e),
        } as unknown as R
      }
    }
  }
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, () => slot()))
  return results
}

// 汇总 runs 为纯文本摘要。
export function summarizeRuns(runs: RunResultLike[], t: TFunc, opts: { bodyLimit?: number; totalLimit?: number } = {}): string {
  const bodyLimit = opts.bodyLimit || 2000
  const totalLimit = opts.totalLimit || 24000
  const lines = [t('orch.sumDone', { n: runs.length })]
  for (const r of runs) {
    const head = (r.label || r.id) + (r.agent ? ' [via ' + r.agent + ']' : '') + ' [' + r.status + ']'
    const body = String(r.output || '').slice(0, bodyLimit)
    lines.push('- ' + head + (body ? ': ' + body : ''))
  }
  return lines.join('\n').slice(0, totalLimit)
}

// 渲染工具输出为 text block 数组（容错部分 run 字段缺失）。
export function renderRunOutput(value: { summary?: string; runs?: Array<{ id?: string; label?: string; agent?: string; status?: string; output?: string }> } | null | undefined, opts: { runOutputLimit?: number; totalLimit?: number } = {}): TextBlock[] {
  const runOutputLimit = opts.runOutputLimit || 3000
  const totalLimit = opts.totalLimit || 30000
  const v = value || {}
  const runs = v.runs || []
  const lines = [v.summary || '']
  for (const r of runs) {
    lines.push('[' + (r.label || r.id) + (r.agent ? ' via ' + r.agent : '') + '] ' + r.status + '\n' + String(r.output || '').slice(0, runOutputLimit))
  }
  return [{ type: 'text', text: lines.join('\n\n').slice(0, totalLimit) }]
}

// pipeline 模式下累计 carry：前一段输出作为下一段输入的上下文。
export function appendPipelineCarry(carry: string | null | undefined, output: string | null | undefined): string {
  return (carry ? carry + '\n\n' : '') + (output || '')
}

// pipeline 阶段块：带阶段序号与任务标识的结构化标记（轻量“结构化中间产物”）。
export function pipelineStageBlock(index: number, taskId: string, output: string | null | undefined): string {
  return '--- 阶段 ' + (index + 1) + ': ' + (taskId || 'task') + ' ---\n' + (output || '')
}

// 组装 supervisor prompt：合并说明 + 分隔符 + 汇总文本。
export function buildSupervisorPrompt(instruction: string, merged: string, outputSeparator: string): string {
  return instruction + '\n\n' + outputSeparator + '\n\n' + merged
}
