// ============================================================================
// ha-orchestrator 服务类型定义 —— index.ts 消费的 DSH 服务最小结构契约
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

/** llm 服务最小形状（listProviders / listModels）。 */
export interface LlmService {
  listProviders(): Array<{ id?: string; provider?: string; name?: string } | string>
  listModels(provider: string): Promise<Array<{ provider?: string; id?: string; model?: string; name?: string } | string>>
}

/** 子智能体运行请求（提供方 contract）。 */
export interface SubagentRequest {
  label: string
  prompt: Array<{ type: string; text: string }>
  parent?: unknown
  signal?: AbortSignal
  persona?: string
  agentOptions?: { provider?: string; model?: string }
}

/** 子智能体运行句柄。 */
export interface SubagentRun {
  result: Promise<{ stopReason?: string; output?: Array<{ type?: string; text?: string } | null> }>
  dispose(): Promise<unknown>
}

/** 子智能体提供方服务（dsh-subagent 最小形状）。 */
export interface SubagentProvider {
  list(): string[]
  start(provider: string, request: SubagentRequest): Promise<SubagentRun>
}

/** systemPrompt 服务（段落注册）。 */
export interface SystemPromptService {
  section(opts: { name: string; order: number; text: () => string }): () => void
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
