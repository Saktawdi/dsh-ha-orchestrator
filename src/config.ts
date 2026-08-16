// ============================================================================
// dsh-ha-orchestrator 配置系统 —— 纯工具（无 DSH 依赖，可独立单测）
// ----------------------------------------------------------------------------
// 目标：把配置定义与校验逻辑从 index.ts 中抽取出来。
// 导出：
//   MIN_COOLDOWN_MS       冷却时间的最小值常量（毫秒）。
//   defaultConfig         默认完整配置对象（与 index.ts 中的 defaultConfig
//                         具有完全相同的深层结构）。
//   sanitizeConfig(patch, base)  对 patch 做校验与合并，返回全新对象；
//                         不修改传入的 patch 与 base。
// ============================================================================

/** 冷却时间最小值（毫秒）：cooldownMs 被钳制不低于该值。 */
export const MIN_COOLDOWN_MS = 1000

/** 备用模型条目（label 仅用于 UI 展示）。 */
export interface BackupEntry {
  label: string
  provider: string
  model: string
  reasoningEffort?: string
}

/** 自定义子智能体定义。provider/model 留空 = 继承 DSH 默认模型。 */
export interface AgentEntry {
  name: string
  provider: string
  model: string
  description: string
  systemPrompt: string
}

/** HA（模型高可用）配置节。 */
export interface HaConfig {
  enabled: boolean
  backups: BackupEntry[]
  cooldownMs: number
  threshold: number
  codes: string[]
  persistSelection: boolean
  steerOnStop: boolean
  /** 失败计数滑动窗口（毫秒）；0 = 关闭（计数到冷却到期才过期）。 */
  burstWindowMs: number
  /** Provider 级熔断阈值：同一 provider 隔离的模型数达到该值后熔断整个 provider；0 = 关闭。 */
  providerThreshold: number
  /** 冷却到期后真实探测恢复（小成本调用验证模型可用）。 */
  probeEnabled: boolean
  /** CONTEXT_WINDOW_EXCEEDED 时降级重试（去掉 reasoningEffort）。 */
  degradeContextWindow: boolean
}

/** 编排预设/配方：把一次成功的 orchestrate 调用参数保存为可复用条目。 */
export interface OrchPreset {
  name: string
  mode: string
  agent: string
  supervisorAgent: string
  mergeInstructions: string
  tasks: Array<{ id?: string; label?: string; agent?: string; prompt: string }>
}

/** 编排配置节。 */
export interface OrchConfig {
  enabled: boolean
  provider: string
  concurrency: number
  maxAgents: number
  agents: AgentEntry[]
  /** pipeline 单阶段失败重试次数（0 = 不重试，直接隔离该阶段）。 */
  stageRetry: number
  /** 全局并发上限（跨 run 共享；0 = 不限）。 */
  globalConcurrency: number
  /** 已保存的编排配方。 */
  presets: OrchPreset[]
}

/** 调试配置节。 */
export interface DebugConfig {
  enabled: boolean
  showCard: boolean
}

/** 插件语言配置节。 */
export interface LangConfig {
  /** 'auto' 跟随 DSH 语言；'zh' / 'en' 手动固定 */
  mode: 'auto' | 'zh' | 'en'
}

/** 上下文注入配置节。 */
export interface CtxConfig {
  enabled: boolean
  text: string
}

/** 完整插件配置。 */
export interface Config {
  ha: HaConfig
  orch: OrchConfig
  debug: DebugConfig
  lang: LangConfig
  ctx: CtxConfig
}

/**
 * 默认完整配置。
 */
export const defaultConfig: Config = {
  ha: {
    enabled: true,
    // 默认不预设备用模型：保持中立，由用户按实际环境配置
    backups: [],
    cooldownMs: 300000,
    threshold: 1,
    codes: [],
    persistSelection: false,
    steerOnStop: true,
    // 突发窗口 60s：60s 内多次失败才计入阈值，避免偶发抖动触发熔断
    burstWindowMs: 60000,
    // 同一 provider 隔离 2 个模型后熔断整个 provider（0 = 关闭）
    providerThreshold: 2,
    // 冷却到期后用最小成本调用探测恢复
    probeEnabled: true,
    // 上下文超长降级默认关闭（可选）
    degradeContextWindow: false,
  },
  orch: {
    enabled: true,
    provider: '',
    concurrency: 3,
    maxAgents: 8,
    // pipeline 阶段失败默认不重试：失败阶段标记 error 并中止后续阶段（阶段隔离）
    stageRetry: 0,
    // 全局并发上限默认不限（0）；单 run 并发由 concurrency/maxAgents 控制
    globalConcurrency: 0,
    presets: [],
    agents: [
      {
        name: 'reviewer',
        // provider/model 留空 = 继承 DSH 默认模型
        provider: '',
        model: '',
        description: '代码审查专家：检查代码质量、发现 bug 与安全隐患，输出结构化审查意见。',
        systemPrompt: '你是一名资深代码审查员。审查时给出：1) 问题清单（严重程度+位置+原因）2) 修复建议 3) 总体评价。',
      },
    ],
  },
  debug: {
    enabled: false,
    // 配置页是否显示开发调试卡片（默认隐藏，系统卡片内开关打开）
    showCard: false,
  },
  lang: {
    // 插件语言：'auto' 跟随 DSH 语言；'zh' / 'en' 手动固定
    mode: 'auto',
  },
  ctx: {
    // 上下文注入：向系统提示词注入插件上下文（含自动编排引导 + 自定义文本）
    enabled: true,
    text: '',
  },
}

// patch 中任意配置节的最小结构（值未经校验）
type RawSection = Record<string, unknown>
type RawConfig = Record<string, unknown>

/** 把任意值规整为字符串。 */
function asString(v: unknown): string {
  return String(v || '')
}

/** 把任意值规整为布尔。 */
function asBool(v: unknown): boolean {
  return !!v
}

/**
 * 对完整配置做校验合并。只保留出现在 patch 中的节，其余节保持 base 对应节原样；
 * 返回全新对象，不修改传入的 patch 与 base。
 * @param patch 增量配置；非对象时返回空对象。
 * @param base 基准配置（缺省回退到 defaultConfig）。
 * @returns 校验合并后的全新配置对象（仅含 patch 中出现的节）。
 */
export function sanitizeConfig(patch: unknown, base?: Config | null): Partial<Config> {
  const baseCfg: Config = base || defaultConfig
  const next: Partial<Config> = {}
  if (patch && typeof patch === 'object') {
    const raw = patch as RawConfig
    if (raw.ha && typeof raw.ha === 'object') {
      const ha = { ...baseCfg.ha, ...(raw.ha as RawSection) }
      ha.enabled = asBool(ha.enabled)
      ha.cooldownMs = Math.max(MIN_COOLDOWN_MS, Number(ha.cooldownMs) || 0)
      ha.threshold = Math.max(1, Number(ha.threshold) || 1)
      ha.persistSelection = asBool(ha.persistSelection)
      ha.steerOnStop = asBool(ha.steerOnStop)
      ha.burstWindowMs = Math.max(0, Number(ha.burstWindowMs) || 0)
      ha.providerThreshold = Math.max(0, Number(ha.providerThreshold) || 0)
      ha.probeEnabled = asBool(ha.probeEnabled)
      ha.degradeContextWindow = asBool(ha.degradeContextWindow)
      ha.codes = Array.isArray(ha.codes) ? ha.codes.map(String).filter(Boolean) : []
      ha.backups = Array.isArray(ha.backups)
        ? ha.backups.filter((b: BackupEntry | RawSection) => !!b && typeof b === 'object')
          .map((b: BackupEntry | RawSection) => ({
            label: asString(b.label),
            provider: asString(b.provider),
            model: asString(b.model),
            reasoningEffort: b.reasoningEffort ? asString(b.reasoningEffort) : '',
          })).filter((b) => b.provider && b.model)
        : []
      next.ha = ha as HaConfig
    }
    if (raw.orch && typeof raw.orch === 'object') {
      const orch = { ...baseCfg.orch, ...(raw.orch as RawSection) }
      orch.enabled = asBool(orch.enabled)
      orch.provider = asString(orch.provider)
      orch.concurrency = Math.max(1, Math.min(32, Number(orch.concurrency) || 1))
      orch.maxAgents = Math.max(1, Math.min(64, Number(orch.maxAgents) || 1))
      orch.stageRetry = Math.max(0, Math.min(5, Number(orch.stageRetry) || 0))
      orch.globalConcurrency = Math.max(0, Math.min(64, Number(orch.globalConcurrency) || 0))
      orch.presets = Array.isArray(orch.presets)
        ? (orch.presets as unknown as RawSection[]).filter((p): p is RawSection => !!p && typeof p === 'object' && !!String(p.name || '').trim())
          .map((p: RawSection) => ({
            name: String(p.name || '').trim(),
            mode: String(p.mode || 'fanout'),
            agent: String(p.agent || ''),
            supervisorAgent: String(p.supervisorAgent || ''),
            mergeInstructions: String(p.mergeInstructions || ''),
            tasks: Array.isArray(p.tasks)
              ? (p.tasks as unknown as RawSection[]).filter((t): t is RawSection => !!t && typeof t === 'object' && !!String(t.prompt || '').trim())
                .map((t: RawSection) => ({
                  id: String(t.id || ''),
                  label: String(t.label || ''),
                  agent: String(t.agent || ''),
                  prompt: String(t.prompt || ''),
                }))
              : [],
          }))
        : []
      orch.agents = Array.isArray(orch.agents)
        ? orch.agents.filter((a: AgentEntry | RawSection) => !!a && typeof a === 'object' && String(a.name || '').trim())
          .map((a: AgentEntry | RawSection) => ({
            name: String(a.name || '').trim(),
            provider: asString(a.provider),
            model: asString(a.model),
            description: asString(a.description),
            systemPrompt: asString(a.systemPrompt),
          }))
        : []
      next.orch = orch as OrchConfig
    }
    if (raw.debug && typeof raw.debug === 'object') {
      const debug = { ...(baseCfg.debug || {}), ...(raw.debug as RawSection) }
      debug.enabled = asBool(debug.enabled)
      debug.showCard = asBool(debug.showCard)
      next.debug = debug as DebugConfig
    }
    if (raw.lang && typeof raw.lang === 'object') {
      const lang = { ...(baseCfg.lang || {}), ...(raw.lang as RawSection) }
      lang.mode = lang.mode === 'zh' || lang.mode === 'en' ? lang.mode : 'auto'
      next.lang = lang as LangConfig
    }
    if (raw.ctx && typeof raw.ctx === 'object') {
      const ctxCfg = { ...(baseCfg.ctx || {}), ...(raw.ctx as RawSection) }
      ctxCfg.enabled = asBool(ctxCfg.enabled)
      ctxCfg.text = asString(ctxCfg.text)
      next.ctx = ctxCfg as CtxConfig
    }
  }
  return next
}
