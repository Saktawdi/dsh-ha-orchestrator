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
  /** 输出要求提示（追加到子任务 prompt 末尾，如“以 markdown 表格输出”）。 */
  outputHint?: string
  /** 结构化输出 JSON Schema（object 根）；provider 支持时子智能体返回匹配 JSON。 */
  outputSchema?: Record<string, unknown> | null
}

/** 自定义子智能体定义最小形状（provider/model/reasoningEffort/systemPrompt/tools 可选）。 */
export interface AgentDefLike {
  name: string
  provider?: string
  model?: string
  /** 模型推理强度；留空 = 使用 provider/model 默认值。 */
  reasoningEffort?: string
  /** 该子智能体每次请求的最大输出 token；0/未设置 = 使用编排级 maxTokens 或继承父级。 */
  maxTokens?: number
  systemPrompt?: string
  /** 工具裁剪（allow 白名单 / deny 黑名单）；调用方负责 provider 能力门控。 */
  tools?: { allow?: string[]; deny?: string[] }
  /** 该角色独立的模型回退链；执行器只消费这组候选，不修改原定义。 */
  fallbacks?: Array<{ provider?: string; model?: string; label?: string; reasoningEffort?: string }>
}

/** 子智能体回退候选的最小形状。 */
export interface SubagentFallbackTarget {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 子智能体运行请求（提供方 contract 最小形状）。 */
export interface SubagentRequestLike {
  label: string
  prompt: TextBlock[]
  parent?: unknown
  signal?: AbortSignal
  persona?: string
  agentOptions?: { provider?: string; model?: string; reasoningEffort?: string; maxTokens?: number }
  /** 按子智能体裁剪工具（allow 白名单 / deny 黑名单）。 */
  toolFilter?: { allow?: string[]; deny?: string[] }
  /** 结构化输出 JSON Schema（object 根）。 */
  outputSchema?: Record<string, unknown>
  /** 委托深度平台级硬上限。 */
  maxDepth?: number
}

/** 清洗工具裁剪名单：字符串化、去空白、去空项；allow/deny 任一非空才返回对象，否则 null。 */
export function cleanToolFilter(
  tools: { allow?: unknown; deny?: unknown } | null | undefined,
): { allow?: string[]; deny?: string[] } | null {
  if (!tools || typeof tools !== 'object') return null
  const clean = (list: unknown): string[] => (Array.isArray(list) ? list.map((x) => String(x || '').trim()).filter(Boolean) : [])
  const allow = clean(tools.allow)
  const deny = clean(tools.deny)
  if (!allow.length && !deny.length) return null
  const out: { allow?: string[]; deny?: string[] } = {}
  if (allow.length) out.allow = allow
  if (deny.length) out.deny = deny
  return out
}

/** 子智能体运行结果（提供方 result 最小形状）。 */
export interface SubagentResultLike {
  stopReason?: string
  output?: Array<{ type?: string; text?: string } | null>
  /** outputSchema 命中时平台返回的结构化 JSON。 */
  structured?: unknown
}

/** 统一 run 结构。 */
export interface RunResultLike {
  id: string
  label: string
  agent: string
  status: string
  output: string
  /** 子智能体实际执行的 HA lastKey（provider/model），用于卡片可观测。 */
  lastKey?: string
  /** 子智能体会话 id；用于从客户端会话记录回读 token 用量并跳转。 */
  agentId?: string
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

/**
 * 解析一个自定义子智能体的独立回退链。
 *
 * 这里返回完整的 provider/model/effort 候选，并去重/排除相同主候选：执行层
 * 可以复用同一套候选遍历机制处理 start 拒绝、result=error 与基础设施异常，
 * 而不会改写配置对象或把主 HA 的全局 backups 混进来。
 */
export function resolveSubagentFallbacks(agentDef: AgentDefLike | null | undefined): SubagentFallbackTarget[] {
  if (!agentDef || !Array.isArray(agentDef.fallbacks)) return []
  const seen = new Set<string>()
  const primaryProvider = String(agentDef.provider || '').trim()
  const primaryModel = String(agentDef.model || '').trim()
  const primaryEffort = String(agentDef.reasoningEffort || '').trim()
  if (primaryProvider && primaryModel) seen.add(primaryProvider + '\u0000' + primaryModel + '\u0000' + primaryEffort)
  const out: SubagentFallbackTarget[] = []
  for (const item of agentDef.fallbacks) {
    if (!item || typeof item !== 'object') continue
    const provider = String(item.provider || '').trim()
    const model = String(item.model || '').trim()
    if (!provider || !model) continue
    const reasoningEffort = String(item.reasoningEffort || '').trim()
    const key = provider + '\u0000' + model + '\u0000' + reasoningEffort
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) })
  }
  return out
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

// 任务签名：只取影响“任务是什么”的稳定字段（id/label/prompt），
// 供 run 恢复 / 自动续跑做同任务匹配；不含 agent（agent 由调用方按解析后的
// 实际执行角色单独比对，避免 raw agent 与 run 记录里已解析 agent 名不一致）。
export function taskSignature(task: { id?: string; label?: string; prompt?: string } | null | undefined): string {
  if (!task) return ''
  const id = String(task.id || '').trim()
  const label = String(task.label || '').trim()
  const prompt = String(task.prompt || '').trim()
  return JSON.stringify([id, label, prompt])
}

// 两个任务列表是否按顺序完全同任务（id/label/prompt 签名一致）。
export function sameTaskList(
  a: Array<{ id?: string; label?: string; prompt?: string } | null | undefined> | null | undefined,
  b: Array<{ id?: string; label?: string; prompt?: string } | null | undefined> | null | undefined,
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (taskSignature(a[i]) !== taskSignature(b[i])) return false
  }
  return true
}

// 入口防御性清洗：过滤非对象 / 缺 prompt（或全空白）的任务条目，字符串字段规整。
// 不依赖调用方 schema 校验——模型输出与历史配方都可能带畸形条目，缺 prompt 的
// 任务无法执行，宁可在入口丢弃也不要在中途炸掉整个编排。
export function cleanTasks(tasks: unknown): TaskLike[] {
  if (!Array.isArray(tasks)) return []
  const out: TaskLike[] = []
  for (const tk of tasks) {
    if (!tk || typeof tk !== 'object') continue
    const t = tk as Record<string, unknown>
    const prompt = typeof t.prompt === 'string' ? t.prompt : ''
    if (!prompt.trim()) continue
    const entry: TaskLike = { prompt }
    if (typeof t.id === 'string' && t.id) entry.id = t.id
    if (typeof t.label === 'string' && t.label) entry.label = t.label
    if (typeof t.agent === 'string' && t.agent) entry.agent = t.agent
    if (typeof t.outputHint === 'string' && t.outputHint) entry.outputHint = t.outputHint
    if (t.outputSchema && typeof t.outputSchema === 'object') entry.outputSchema = t.outputSchema as Record<string, unknown>
    out.push(entry)
  }
  return out
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

// 组装子智能体的运行 prompt：正文 = task.prompt（带 outputHint 时追加输出要求）；
// extra 为空直接返回正文，否则拼接 mergedPrefix + extra 段 + 正文。
export function buildRunPrompt(task: TaskLike, extra: string | null | undefined, mergedPrefix: string): string {
  const hint = task.outputHint ? String(task.outputHint).trim() : ''
  const body = hint ? task.prompt + '\n\n[输出要求] ' + hint : task.prompt
  if (!extra) return body
  return mergedPrefix + '\n\n' + extra + '\n\n---\n\n' + body
}

// 构建发给子智能体提供方的 request 对象。
export function buildSubagentRequest(
  task: TaskLike,
  extra: string | null | undefined,
  agentDef: AgentDefLike | null | undefined,
  mergedPrefix: string,
  parent: unknown,
  signal: AbortSignal | null | undefined,
  defaultMaxTokens = 0,
): SubagentRequestLike {
  const label = task.label || (agentDef && agentDef.name) || task.id || 'task'
  const prompt = textBlocks(buildRunPrompt(task, extra, mergedPrefix))
  const request: SubagentRequestLike = { label, prompt, parent }
  if (signal) request.signal = signal
  if (agentDef && agentDef.systemPrompt) request.persona = agentDef.systemPrompt
  const effort = agentDef && String(agentDef.reasoningEffort || '').trim()
  const agentMaxTokens = agentDef ? Math.max(0, Number(agentDef.maxTokens) || 0) : 0
  const maxTokens = agentMaxTokens > 0 ? agentMaxTokens : Math.max(0, Number(defaultMaxTokens) || 0)
  if (agentDef && (agentDef.provider || agentDef.model || effort) || maxTokens > 0) {
    const agentOptions: { provider?: string; model?: string; reasoningEffort?: string; maxTokens?: number } = {}
    if (agentDef && agentDef.provider) agentOptions.provider = String(agentDef.provider)
    if (agentDef && agentDef.model) agentOptions.model = String(agentDef.model)
    if (effort) agentOptions.reasoningEffort = effort
    if (maxTokens > 0) agentOptions.maxTokens = maxTokens
    request.agentOptions = agentOptions
  }
  // 工具裁剪透传：清洗后仍非空才带 toolFilter；provider 能力门控由调用方（index.ts runOne）负责。
  const toolFilter = agentDef ? cleanToolFilter(agentDef.tools) : null
  if (toolFilter) request.toolFilter = toolFilter
  // 结构化输出透传：仅 object 根的 schema 才带（平台 assertObjectJsonSchema 约束）；能力门控同样由调用方负责。
  const schema = task.outputSchema
  if (schema && typeof schema === 'object' && (schema as { type?: unknown }).type === 'object') {
    request.outputSchema = schema
  }
  return request
}

// 可视为“有可用输出”的终止状态：
// completed 正常完成；max-tokens 虽然截断，但已有输出应保留并纳入合并/复用，
// 不应被当作 error 丢弃（用户实际场景常见子代理输出达到 token 上限）。
export function isUsableRunStatus(status: unknown): boolean {
  const s = String(status || '')
  return s === 'completed' || s === 'max-tokens'
}

// 将提供方运行结果归一化为统一 run 结构。
// 结构化输出（outputSchema 命中）以 '[structured] {json}' 行内嵌到 output 开头：
// 下游 merge/渲染/runs.jsonl/工件全部自然携带，避免独立字段的 JSON 边界类型问题。
export function normalizeRunResult(task: TaskLike, agentDef: AgentDefLike | null | undefined, res: SubagentResultLike): RunResultLike {
  const text = (res.output || []).filter((b): b is { type: string; text: string } => !!(b && b.type === 'text')).map((b) => b.text).join('\n')
  const status = String(res.stopReason || 'completed')
  const structuredLine = res.structured !== undefined ? '[structured] ' + safeJsonStringify(res.structured) + '\n' : ''
  return {
    id: String(task.id || task.label || 'task'),
    label: String(task.label || ''),
    agent: agentDef ? String(agentDef.name) : '',
    status,
    output: structuredLine + (text || ''),
  }
}

// 归一化为最终输出结构（全字段字符串化、缺失回空；lastKey 可选，有值才带出）。
export function normalizeFinalRuns(runs: RunResultLike[]): RunResultLike[] {
  return runs.map((r) => {
    const out: RunResultLike = {
      id: String(r.id),
      label: String(r.label || ''),
      agent: String(r.agent || ''),
      status: String(r.status),
      output: String(r.output || ''),
    }
    if (r.lastKey) out.lastKey = String(r.lastKey)
    if (r.agentId) out.agentId = String(r.agentId)
    return out
  })
}

// 以并发上限 limit 执行 items，保持结果顺序；单任务异常被捕获为 error run，不中断其它任务。
// 泛型 R 为 worker 的返回类型；异常时落入统一的 error run 结构（调用方按需消费）。
// 可选 errorRun 允许调用方提供带上下文（如自定义 agent 名）的错误结果构造器。
export async function poolRun<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  errorRun?: (item: T, error: unknown, index: number) => R,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let fatalError: unknown = null
  async function slot(): Promise<void> {
    while (next < items.length) {
      if (fatalError) return
      const i = next
      next += 1
      const item = items[i]
      try {
        results[i] = await worker(item, i)
      } catch (e) {
        // 显式声明不隔离的错误（如预算耗尽）应中止整个执行；
        // 先停止领取新任务，等已在途任务落定后带 partialRuns 抛出，保留已完成结果。
        if (e && (e as { isolate?: boolean }).isolate === false) {
          fatalError = e
          return
        }
        results[i] = errorRun
          ? errorRun(item, e, i)
          : {
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
  if (fatalError) {
    const err = fatalError as Error & { partialRuns?: R[] }
    err.partialRuns = results.filter((r): r is R => r !== undefined)
    throw err
  }
  return results
}

// 汇总 runs 为纯文本摘要（结构化输出已内嵌在各 run 的 output 开头，merge 直接可见）。
export function summarizeRuns(runs: RunResultLike[], t: TFunc, opts: { bodyLimit?: number; totalLimit?: number } = {}): string {
  // 调研类任务的子任务报告普遍较长：body 2000 会把引用/证据截掉，merge 只能拿到残缺输入。
  const bodyLimit = opts.bodyLimit || 8000
  const totalLimit = opts.totalLimit || 48000
  const lines = [t('orch.sumDone', { n: runs.length })]
  for (const r of runs) {
    const head = (r.label || r.id) + (r.agent ? ' [via ' + r.agent + ']' : '') + ' [' + r.status + ']'
    const body = String(r.output || '').slice(0, bodyLimit)
    lines.push('- ' + head + (body ? ': ' + body : ''))
  }
  return lines.join('\n').slice(0, totalLimit)
}

// JSON 安全序列化：序列化失败回退 String()，避免异常炸掉 merge 输入拼装。
function safeJsonStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// 渲染工具输出为 text block 数组（容错部分 run 字段缺失；结构化 JSON 已内嵌在 output 开头）。
export function renderRunOutput(value: { summary?: string; runs?: Array<{ id?: string; label?: string; agent?: string; status?: string; output?: string }> } | null | undefined, opts: { runOutputLimit?: number; totalLimit?: number } = {}): TextBlock[] {
  const runOutputLimit = opts.runOutputLimit || 8000
  const totalLimit = opts.totalLimit || 60000
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
