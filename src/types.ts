// ============================================================================
// dsh-ha-orchestrator 服务类型定义 —— index.ts 消费的 DSH 服务最小结构契约
// ----------------------------------------------------------------------------
// 设计取舍：不直接依赖 dsh-* 各包的服务类型（rc 阶段类型变动频繁），
// 而是定义本插件消费的最小结构接口，经 getService() 从 ctx 取用；
// 事件载荷（agent/request 等）与 Agent 类型则使用官方 dsh-agent 声明。
// ============================================================================

import type { Context } from '@deepseek-ai/cordis'

/** node:fs 风格文件服务（dsh-fs 的 resolve/readText/writeText 契约）。 */
export interface FsService {
  resolve(name: string, opts?: { cwd?: string }): Promise<{ displayPath?: string } | null | undefined>
  readText(target: object): Promise<string | null | undefined>
  writeText(target: object, text: string): Promise<unknown>
}
/** timer 服务（cordis-plugin-timer：timeout(fn, ms) 与 timeout(ms) 双形态）。 */
export interface TimerService {
  timeout(callback: () => void, ms: number): unknown
  timeout(ms: number): Promise<unknown>
}

/** llm 服务最小形状（listProviders / listModels / 探测用的 stream）。 */
export interface LlmService {
  listProviders(): Array<{ id?: string; provider?: string; name?: string } | string>
  listModels(provider: string): Promise<Array<{ provider?: string; id?: string; model?: string; name?: string } | string>>
  /** 独立查询（探测恢复用小成本调用）。 */
  stream?(options: Record<string, unknown>): AsyncIterable<unknown>
  /** 预解析调用（可选；存在时探测优先走 prepareCall + preparedCall.stream）。 */
  prepareCall?(config: Record<string, unknown>, signal?: AbortSignal): Promise<{ stream(options: Record<string, unknown>): AsyncIterable<unknown> }>
}

/** 人类命令调用载荷（dsh-commands 最小形状）。 */
export interface CommandInvocationLike {
  /** 命令名后的原始输入文本。 */
  input?: string
}

/** 命令服务（dsh-commands 最小形状）。 */
export interface CommandsService {
  register(def: {
    name: string
    description: string
    input?: { hint?: string }
    handler: (invocation: CommandInvocationLike) => unknown
  }): () => void
}

/** 子智能体工具裁剪（dsh-subagent ToolRestriction 最小形状：allow 白名单 / deny 黑名单）。 */
export interface ToolFilterLike {
  allow?: string[]
  deny?: string[]
}

/** provider 能力声明（dsh-subagent SubagentCapabilities 最小形状）。 */
export interface SubagentCapabilitiesLike {
  toolFilter?: boolean
  outputSchema?: boolean
  depthLimit?: boolean
  persona?: boolean
}

/** 子智能体运行请求（提供方 contract）。 */
export interface SubagentRequest {
  label: string
  prompt: Array<{ type: string; text: string }>
  parent?: unknown
  signal?: AbortSignal
  persona?: string
  /** 子智能体模型选项；reasoningEffort 是 provider 定义的不透明 effort id。 */
  agentOptions?: { provider?: string; model?: string; reasoningEffort?: string }
  /** 按子智能体裁剪工具；provider 不支持（capabilities.toolFilter === false）时必须剥离，否则 start 被拒。 */
  toolFilter?: ToolFilterLike
  /** 子智能体结构化输出 JSON Schema（object 根）；provider 不支持时必须剥离。 */
  outputSchema?: Record<string, unknown>
  /** 委托深度平台级硬上限；provider 不支持时必须剥离。 */
  maxDepth?: number
}

/** 子智能体运行句柄。 */
export interface SubagentRun {
  /** 子智能体会话/Agent id（本地运行必有；远程运行由提供方给出）。 */
  id?: string
  /** 同进程子智能体 Agent（可选；远程运行不存在）。 */
  localAgent?: AgentLike | null
  result: Promise<{ stopReason?: string; output?: Array<{ type?: string; text?: string } | null>; structured?: unknown }>
  dispose(): Promise<unknown>
}

/** 子智能体提供方服务（dsh-subagent 最小形状）。 */
export interface SubagentProvider {
  list(): string[]
  start(provider: string, request: SubagentRequest): Promise<SubagentRun>
  /** 按 provider 名取注册项（存在时用于读取 capabilities 做 start 前能力门控）。 */
  getProvider?(name: string): { capabilities?: SubagentCapabilitiesLike } | null | undefined
}

/** systemPrompt 段落求值上下文（最小形状；真实 dsh-system-prompt 还带 agent/scope）。 */
export interface PromptAssembleContextLike {
  agent?: unknown
  scope?: unknown
}

/** systemPrompt 服务（段落注册）。 */
export interface SystemPromptService {
  section(opts: { name: string; order: number; text: string | ((context?: PromptAssembleContextLike) => string) }): () => void
}

/** settings 服务（命名空间读取）。 */
export interface SettingsService {
  get(ns: string): { preference?: string } | undefined
}

/** agent 最小形状（events 载荷中的官方 Agent 已含全部成员，此处仅供 getService 使用）。 */
export interface AgentLike {
  id: string
  session?: { header?: { cwd?: string } }
  steer(message: unknown): unknown
  runMaintenance<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** agents 服务（registry 最小形状）。 */
export interface AgentsService {
  list(): AgentLike[]
  currentInitiator?(): AgentLike | null
}

/** agentDefaultModel 服务（默认模型读取/持久化选择）。 */
export interface AgentDefaultModelService {
  saveSelection(sel: { provider: string; model: string }): unknown
  currentSelection(): { provider?: string; model?: string } | null
}

/** sandboxPolicy 服务（解析当前沙箱策略）。 */
export interface SandboxPolicyService {
  resolve(): { mode?: string; workspaceRoot?: string } | undefined
}

/** launchEnvironment 服务（环境变量读取）。 */
export interface LaunchEnvironmentService {
  get(name: string): { value?: string } | undefined
}

/** typert registry 服务（仅用到 host 侧 invocation 注册）。 */
export interface TypertRegistryService {
  register(contribution: unknown): unknown
}

/** tools 服务最小形状（dsh-tools ToolRuntime：schemas() 枚举可见工具名，供设置页提示）。 */
export interface ToolsServiceLike {
  schemas?(scope?: unknown): Array<{ name?: string } | null | undefined>
}

/**
 * 从 ctx 读取服务（等价 ctx.get(name)，带 try/catch 与空值归一）。
 * 服务未就绪/未注册时返回 null，与旧版调用点语义一致。
 */
export function getService<T>(ctx: Context, name: string): T | null {
  try {
    const get = (ctx as unknown as { get?: (n: string) => unknown }).get
    if (typeof get !== 'function') return null
    const v = get.call(ctx, name)
    return (v ?? null) as T | null
  } catch (e) {
    return null
  }
}
