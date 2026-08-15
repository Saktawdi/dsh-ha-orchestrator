/** 隔离条目：到期时间 + 触发错误码。 */
export interface QuarantineEntry {
    until: number;
    code?: string;
}
/** 失败计数条目：累计次数 + 计数过期时间。 */
export interface FailureEntry {
    count: number;
    until: number;
}
/** per-agent 游标条目。 */
export interface PerAgentEntry {
    index?: number;
    lastKey?: string;
    retries?: number;
    failCode?: string;
    steeredTurn?: number;
}
/** 切换历史条目。 */
export interface HistoryEntry {
    at: string;
    agent: string;
    from: string;
    to: string;
    code: string;
}
/** HA 运行时状态容器。 */
export interface HaState {
    quarantine: Map<string, QuarantineEntry>;
    failures: Map<string, FailureEntry>;
    perAgent: Map<string, PerAgentEntry>;
    history: HistoryEntry[];
}
/** 纯函数消费的最小 HA 配置形状（由 Config.ha 传入）。 */
export interface HaCfgLike {
    cooldownMs: number;
    threshold: number;
    backups?: Array<{
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    }>;
}
/** 备用候选（findFallback 命中项）。 */
export interface FallbackCandidate {
    provider: string;
    model: string;
    reasoningEffort?: string;
    key: string;
    /** 下一个游标位置（已按轮换语义推进）。 */
    index: number;
}
/**
 * Build the canonical quarantine/failure key for a provider+model pair.
 * Missing model defaults to the provider-wide wildcard '*'.
 */
export declare function keyOf(provider: string, model?: string | null): string;
/**
 * Split a key back into [provider, model] on the first '\u0000'.
 */
export declare function splitKey(k: string): [string, string];
/**
 * When `codes` is empty/undefined, match anything; otherwise only an exact
 * member match passes.
 */
export declare function matchesCodes(codes: string[] | null | undefined, code: string): boolean;
/**
 * Drop expired quarantine and failure entries (`v.until < now`). Entries whose
 * `until` equals `now` are kept.
 */
export declare function clearExpired(state: HaState, now?: number): void;
/**
 * Exact-key quarantine check (used when picking a backup; a wildcard
 * quarantine must not taint other models under the same provider).
 */
export declare function isExactQuarantined(state: HaState, provider: string, model: string, now?: number): boolean;
/**
 * Request-level quarantine check: the exact key matches, or (when the model is
 * unknown) the provider wildcard key matches.
 */
export declare function isBlocked(state: HaState, provider: string, model?: string | null, now?: number): boolean;
/**
 * Read the per-agent cursor entry without writing back.
 */
export declare function entryFor(state: HaState, agentId: string): PerAgentEntry;
/**
 * Merge a patch into the per-agent entry and write it back to state.
 */
export declare function setEntry(state: HaState, agentId: string, patch: Partial<PerAgentEntry>): void;
/**
 * Record one failure for a key, then start/fresh its cooldown. Returns the new
 * running count for that key.
 */
export declare function bumpFailure(state: HaState, haCfg: HaCfgLike, k: string, now?: number): number;
/**
 * Quarantine a key for the cooldown window and drop any pending failures for it.
 */
export declare function quarantineKey(state: HaState, haCfg: HaCfgLike, k: string, code?: string, now?: number): void;
/**
 * Append a switch history entry (trimmed to the newest 50 entries).
 */
export declare function recordHistory(state: HaState, agentId: string, fromKey: string, target: {
    provider: string;
    model: string;
}, code?: string, now?: number): void;
/**
 * Pure scan starting from the per-agent cursor index. Prefer the model at
 * `(entry.index + i) % n`, skipping entries that lack provider/model, are
 * unregistered (when a non-empty provider set is supplied), match `excludeKey`,
 * or are exact-quarantined. Does NOT advance the cursor.
 */
export declare function findFallback(state: HaState, haCfg: HaCfgLike, registeredProviders: Set<string> | string[] | null, agentId: string, excludeKey: string | null, now?: number): FallbackCandidate | null;
/**
 * Pick a fallback AND advance the per-agent cursor to the next one. Returns the
 * result without the cursor index, or null when none is available.
 */
export declare function pickFallback(state: HaState, haCfg: HaCfgLike, registeredProviders: Set<string> | string[] | null, agentId: string, excludeKey: string | null, now?: number): {
    provider: string;
    model: string;
    reasoningEffort?: string;
    key: string;
} | null;
/**
 * Whether a usable fallback exists (does not advance the cursor).
 */
export declare function hasFallback(state: HaState, haCfg: HaCfgLike, registeredProviders: Set<string> | string[] | null, agentId: string, excludeKey: string | null, now?: number): boolean;
/**
 * Maximum retries budget: at least 2, or the threshold plus the backup count.
 */
export declare function maxRetriesFor(haCfg: HaCfgLike): number;
/**
 * Decide which key failed: reuse the exact key recorded for this agent when it
 * belongs to the failing provider, else fall back to that provider's wildcard.
 */
export declare function computeFailingKey(entry: PerAgentEntry | undefined, provider: string): string;
/**
 * Fresh, empty HA state container.
 */
export declare function createHaState(): HaState;
