// ============================================================================
// ha-orchestrator 配置系统 —— 纯工具（无 DSH 依赖，可独立单测）
// ----------------------------------------------------------------------------
// 目标：把配置定义与校验逻辑从 lib/index.js 中抽取出来。
// 导出：
//   MIN_COOLDOWN_MS       冷却时间的最小值常量（毫秒）。
//   defaultConfig         默认完整配置对象（与 lib/index.js 中的 defaultConfig
//                         具有完全相同的深层结构）。
//   sanitizeConfig(patch, base)  对 patch 做校验与合并，返回全新对象；
//                         不修改传入的 patch 与 base。
// ============================================================================

/** 冷却时间最小值（毫秒）：cooldownMs 被钳制不低于该值。 */
export const MIN_COOLDOWN_MS = 1000

/**
 * 默认完整配置。结构与 lib/index.js 中的 defaultConfig 完全一致。
 */
export const defaultConfig = {
  ha: {
    enabled: true,
    // 默认不预设备用模型：保持中立，由用户按实际环境配置
    backups: [],
    cooldownMs: 300000,
    threshold: 1,
    codes: [],
    persistSelection: false,
    steerOnStop: true,
  },
  orch: {
    enabled: true,
    provider: '',
    concurrency: 3,
    maxAgents: 8,
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

/**
 * 对完整配置做校验合并。只保留出现在 patch 中的节，其余节保持 base 对应节原样；
 * 返回全新对象，不修改传入的 patch 与 base。
 * @param {object|null|undefined} patch 增量配置；非对象时返回空对象。
 * @param {object|null|undefined} base 基准配置（缺省回退到 defaultConfig）。
 * @returns {object} 校验合并后的全新配置对象。
 */
export function sanitizeConfig(patch, base) {
  const baseCfg = base || defaultConfig
  const next = {}
  if (patch && typeof patch === 'object') {
    if (patch.ha && typeof patch.ha === 'object') {
      const ha = { ...baseCfg.ha, ...patch.ha }
      ha.enabled = !!ha.enabled
      ha.cooldownMs = Math.max(MIN_COOLDOWN_MS, Number(ha.cooldownMs) || 0)
      ha.threshold = Math.max(1, Number(ha.threshold) || 1)
      ha.persistSelection = !!ha.persistSelection
      ha.steerOnStop = !!ha.steerOnStop
      ha.codes = Array.isArray(ha.codes) ? ha.codes.map(String).filter(Boolean) : []
      ha.backups = Array.isArray(ha.backups)
        ? ha.backups.filter((b) => b && typeof b === 'object')
          .map((b) => ({
            label: String(b.label || ''),
            provider: String(b.provider || ''),
            model: String(b.model || ''),
            reasoningEffort: b.reasoningEffort ? String(b.reasoningEffort) : '',
          })).filter((b) => b.provider && b.model)
        : []
      next.ha = ha
    }
    if (patch.orch && typeof patch.orch === 'object') {
      const orch = { ...baseCfg.orch, ...patch.orch }
      orch.enabled = !!orch.enabled
      orch.provider = String(orch.provider || '')
      orch.concurrency = Math.max(1, Math.min(32, Number(orch.concurrency) || 1))
      orch.maxAgents = Math.max(1, Math.min(64, Number(orch.maxAgents) || 1))
      orch.agents = Array.isArray(orch.agents)
        ? orch.agents.filter((a) => a && typeof a === 'object' && String(a.name || '').trim())
          .map((a) => ({
            name: String(a.name || '').trim(),
            provider: String(a.provider || ''),
            model: String(a.model || ''),
            description: String(a.description || ''),
            systemPrompt: String(a.systemPrompt || ''),
          }))
        : []
      next.orch = orch
    }
    if (patch.debug && typeof patch.debug === 'object') {
      const debug = { ...(baseCfg.debug || {}), ...patch.debug }
      debug.enabled = !!debug.enabled
      debug.showCard = !!debug.showCard
      next.debug = debug
    }
    if (patch.lang && typeof patch.lang === 'object') {
      const lang = { ...(baseCfg.lang || {}), ...patch.lang }
      lang.mode = lang.mode === 'zh' || lang.mode === 'en' ? lang.mode : 'auto'
      next.lang = lang
    }
    if (patch.ctx && typeof patch.ctx === 'object') {
      const ctxCfg = { ...(baseCfg.ctx || {}), ...patch.ctx }
      ctxCfg.enabled = !!ctxCfg.enabled
      ctxCfg.text = String(ctxCfg.text || '')
      next.ctx = ctxCfg
    }
  }
  return next
}
