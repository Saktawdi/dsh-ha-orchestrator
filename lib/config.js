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
export const MIN_COOLDOWN_MS = 1000;
/**
 * 默认完整配置。
 */
export const defaultConfig = {
    ha: {
        enabled: true,
        // 默认不预设备用模型：保持中立，由用户按实际环境配置
        backups: [],
        cooldownMs: 300000,
        threshold: 3,
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
        // 并发默认 6：调研类任务子任务多、单任务耗时长，3 并发明显偏慢（用户已手动调 8）
        concurrency: 6,
        maxAgents: 16,
        // pipeline 阶段失败默认不重试：失败阶段标记 error 并中止后续阶段（阶段隔离）
        stageRetry: 0,
        // 全局并发上限默认不限（0）；单 run 并发由 concurrency/maxAgents 控制
        globalConcurrency: 0,
        presets: [],
        // 截断上限与代码默认保持一致（orch-runner.ts 内的 fallback），可按模型上下文调整
        mergeBodyLimit: 8000,
        mergeTotalLimit: 48000,
        renderRunLimit: 8000,
        renderTotalLimit: 60000,
        // 委托深度兜底默认关闭（0）；开启 1 可从平台层禁止子智能体再委托
        maxDepth: 0,
        // 自动续跑：重试相同任务时复用最近一次部分完成 run 的已完成子任务（省钱省时）
        autoResume: true,
        // 子智能体输出 token 上限默认 0 = 继承父级，不擅自改模型行为；如上一步修复仍频繁
        // max-tokens，可显式配置为更大值（如 16000）或给单个子智能体设置 maxTokens 覆盖。
        maxTokens: 0,
        agents: [
            {
                name: 'reviewer',
                // provider/model 留空 = 继承 DSH 默认模型
                provider: '',
                model: '',
                description: '代码审查专家：检查代码质量、发现 bug 与安全隐患，输出结构化审查意见。',
                systemPrompt: '你是一名资深代码审查员。审查时给出：1) 问题清单（严重程度+位置+原因） 2) 修复建议 3) 总体评价。',
            },
            {
                name: 'researcher',
                provider: '',
                model: '',
                description: '调研执行者：并行调研 GitHub 仓库/npm 包/文档，产出带来源链接的结构化事实报告，适合编排拆分的多目标调研任务。',
                systemPrompt: '你是调研执行者。任务：就给定对象（仓库/包/主题）做尽职调查，只陈述可核实的事实。\n方法：优先查官方源（GitHub 仓库、README、release/commit、npm 页面），交叉验证后再下结论；每条关键结论都附来源 URL 与观测日期。\n输出格式：1) 一句话结论 2) 事实清单（带证据 URL）3) 数据指标（star/版本/最近发布等，注明取数时间）4) 不确定/未能核实项。禁止臆造数据；查不到就明说。',
            },
            {
                name: 'research-merger',
                provider: '',
                model: '',
                description: '调研汇总者：把多个调研子任务的报告合并为一份完整汇总，保留全部证据与出处，不引入新事实。',
                systemPrompt: '你是调研汇总者。输入是多份调研子报告。任务：按主题合并为一份结构化汇总。\n规则：保留每条事实的来源 URL；子报告间冲突时并列呈现并标注来源，不擅自裁决；不添加子报告中没有的新事实；结尾列出信息缺口。输出使用清晰的分节 markdown。',
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
        // 默认不注入子智能体：防止子代理也拿到“自动发起编排”的提示，形成层层外包
        injectSubagents: false,
    },
};
/** 把任意值规整为字符串。 */
function asString(v) {
    return String(v || '');
}
/** 把任意值规整为布尔。 */
function asBool(v) {
    return !!v;
}
/** 把任意值规整为去空白非空字符串数组。 */
function asNameList(v) {
    return Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
}
/** 规整工具裁剪配置：allow/deny 任一非空才保留，否则返回 undefined（字段不落盘）。 */
function asToolFilter(v) {
    if (!v || typeof v !== 'object')
        return undefined;
    const raw = v;
    const allow = asNameList(raw.allow);
    const deny = asNameList(raw.deny);
    if (!allow.length && !deny.length)
        return undefined;
    const out = {};
    if (allow.length)
        out.allow = allow;
    if (deny.length)
        out.deny = deny;
    return out;
}
/** 规整备用模型链：复用主 HA 的 provider/model/reasoningEffort 数据形状。 */
function asBackupList(v) {
    return Array.isArray(v)
        ? v.filter((b) => !!b && typeof b === 'object')
            .map((b) => ({
            label: asString(b.label),
            provider: asString(b.provider),
            model: asString(b.model),
            reasoningEffort: b.reasoningEffort ? asString(b.reasoningEffort) : '',
        })).filter((b) => b.provider && b.model)
        : [];
}
/**
 * 对完整配置做校验合并。只保留出现在 patch 中的节，其余节保持 base 对应节原样；
 * 返回全新对象，不修改传入的 patch 与 base。
 * @param patch 增量配置；非对象时返回空对象。
 * @param base 基准配置（缺省回退到 defaultConfig）。
 * @returns 校验合并后的全新配置对象（仅含 patch 中出现的节）。
 */
export function sanitizeConfig(patch, base) {
    const baseCfg = base || defaultConfig;
    const next = {};
    if (patch && typeof patch === 'object') {
        const raw = patch;
        if (raw.ha && typeof raw.ha === 'object') {
            const ha = { ...baseCfg.ha, ...raw.ha };
            ha.enabled = asBool(ha.enabled);
            ha.cooldownMs = Math.max(MIN_COOLDOWN_MS, Number(ha.cooldownMs) || 0);
            ha.threshold = Math.max(1, Number(ha.threshold) || 1);
            ha.persistSelection = asBool(ha.persistSelection);
            ha.steerOnStop = asBool(ha.steerOnStop);
            ha.burstWindowMs = Math.max(0, Number(ha.burstWindowMs) || 0);
            ha.providerThreshold = Math.max(0, Number(ha.providerThreshold) || 0);
            ha.probeEnabled = asBool(ha.probeEnabled);
            ha.degradeContextWindow = asBool(ha.degradeContextWindow);
            ha.codes = Array.isArray(ha.codes) ? ha.codes.map(String).filter(Boolean) : [];
            ha.backups = asBackupList(ha.backups);
            next.ha = ha;
        }
        if (raw.orch && typeof raw.orch === 'object') {
            const orch = { ...baseCfg.orch, ...raw.orch };
            orch.enabled = asBool(orch.enabled);
            orch.provider = asString(orch.provider);
            orch.concurrency = Math.max(1, Math.min(32, Number(orch.concurrency) || 1));
            orch.maxAgents = Math.max(1, Math.min(64, Number(orch.maxAgents) || 1));
            orch.stageRetry = Math.max(0, Math.min(5, Number(orch.stageRetry) || 0));
            orch.globalConcurrency = Math.max(0, Math.min(64, Number(orch.globalConcurrency) || 0));
            orch.mergeBodyLimit = Math.max(0, Math.min(100000, Number(orch.mergeBodyLimit) || 0));
            orch.mergeTotalLimit = Math.max(0, Math.min(400000, Number(orch.mergeTotalLimit) || 0));
            orch.renderRunLimit = Math.max(0, Math.min(100000, Number(orch.renderRunLimit) || 0));
            orch.renderTotalLimit = Math.max(0, Math.min(400000, Number(orch.renderTotalLimit) || 0));
            orch.maxDepth = Math.max(0, Math.min(8, Number(orch.maxDepth) || 0));
            orch.autoResume = asBool(orch.autoResume);
            orch.maxTokens = Math.max(0, Math.min(128000, Number(orch.maxTokens) || 0));
            orch.presets = Array.isArray(orch.presets)
                ? orch.presets.filter((p) => !!p && typeof p === 'object' && !!String(p.name || '').trim())
                    .map((p) => ({
                    name: String(p.name || '').trim(),
                    mode: String(p.mode || 'fanout'),
                    agent: String(p.agent || ''),
                    supervisorAgent: String(p.supervisorAgent || ''),
                    mergeInstructions: String(p.mergeInstructions || ''),
                    tasks: Array.isArray(p.tasks)
                        ? p.tasks.filter((t) => !!t && typeof t === 'object' && !!String(t.prompt || '').trim())
                            .map((t) => ({
                            id: String(t.id || ''),
                            label: String(t.label || ''),
                            agent: String(t.agent || ''),
                            prompt: String(t.prompt || ''),
                        }))
                        : [],
                }))
                : [];
            orch.agents = Array.isArray(orch.agents)
                ? orch.agents.filter((a) => !!a && typeof a === 'object' && String(a.name || '').trim())
                    .map((a) => {
                    const entry = {
                        name: String(a.name || '').trim(),
                        provider: asString(a.provider),
                        model: asString(a.model),
                        description: asString(a.description),
                        systemPrompt: asString(a.systemPrompt),
                    };
                    const reasoningEffort = String(a.reasoningEffort || '').trim();
                    if (reasoningEffort)
                        entry.reasoningEffort = reasoningEffort;
                    const maxTokens = Math.max(0, Number(a.maxTokens) || 0);
                    if (maxTokens > 0)
                        entry.maxTokens = maxTokens;
                    const tools = asToolFilter(a.tools);
                    if (tools)
                        entry.tools = tools;
                    // fallbacks 与 ha.backups 使用同一条目形状，但存放在 AgentEntry
                    // 内，保证每个编排角色可以拥有独立、可复用的回退链。
                    if (Object.prototype.hasOwnProperty.call(a, 'fallbacks')) {
                        entry.fallbacks = asBackupList(a.fallbacks);
                    }
                    return entry;
                })
                : [];
            next.orch = orch;
        }
        if (raw.debug && typeof raw.debug === 'object') {
            const debug = { ...(baseCfg.debug || {}), ...raw.debug };
            debug.enabled = asBool(debug.enabled);
            debug.showCard = asBool(debug.showCard);
            next.debug = debug;
        }
        if (raw.lang && typeof raw.lang === 'object') {
            const lang = { ...(baseCfg.lang || {}), ...raw.lang };
            lang.mode = lang.mode === 'zh' || lang.mode === 'en' ? lang.mode : 'auto';
            next.lang = lang;
        }
        if (raw.ctx && typeof raw.ctx === 'object') {
            const ctxCfg = { ...(baseCfg.ctx || {}), ...raw.ctx };
            ctxCfg.enabled = asBool(ctxCfg.enabled);
            ctxCfg.text = asString(ctxCfg.text);
            ctxCfg.injectSubagents = asBool(ctxCfg.injectSubagents);
            next.ctx = ctxCfg;
        }
    }
    return next;
}
