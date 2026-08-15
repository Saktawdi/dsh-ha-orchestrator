/** 冷却时间最小值（毫秒）：cooldownMs 被钳制不低于该值。 */
export declare const MIN_COOLDOWN_MS = 1000;
/** 备用模型条目（label 仅用于 UI 展示）。 */
export interface BackupEntry {
    label: string;
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** 自定义子智能体定义。provider/model 留空 = 继承 DSH 默认模型。 */
export interface AgentEntry {
    name: string;
    provider: string;
    model: string;
    description: string;
    systemPrompt: string;
}
/** HA（模型高可用）配置节。 */
export interface HaConfig {
    enabled: boolean;
    backups: BackupEntry[];
    cooldownMs: number;
    threshold: number;
    codes: string[];
    persistSelection: boolean;
    steerOnStop: boolean;
}
/** 编排配置节。 */
export interface OrchConfig {
    enabled: boolean;
    provider: string;
    concurrency: number;
    maxAgents: number;
    agents: AgentEntry[];
}
/** 调试配置节。 */
export interface DebugConfig {
    enabled: boolean;
    showCard: boolean;
}
/** 插件语言配置节。 */
export interface LangConfig {
    /** 'auto' 跟随 DSH 语言；'zh' / 'en' 手动固定 */
    mode: 'auto' | 'zh' | 'en';
}
/** 上下文注入配置节。 */
export interface CtxConfig {
    enabled: boolean;
    text: string;
}
/** 完整插件配置。 */
export interface Config {
    ha: HaConfig;
    orch: OrchConfig;
    debug: DebugConfig;
    lang: LangConfig;
    ctx: CtxConfig;
}
/**
 * 默认完整配置。
 */
export declare const defaultConfig: Config;
/**
 * 对完整配置做校验合并。只保留出现在 patch 中的节，其余节保持 base 对应节原样；
 * 返回全新对象，不修改传入的 patch 与 base。
 * @param patch 增量配置；非对象时返回空对象。
 * @param base 基准配置（缺省回退到 defaultConfig）。
 * @returns 校验合并后的全新配置对象（仅含 patch 中出现的节）。
 */
export declare function sanitizeConfig(patch: unknown, base?: Config | null): Partial<Config>;
