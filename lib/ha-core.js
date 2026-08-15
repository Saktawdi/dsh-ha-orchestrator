// ha-core.ts -- DSH-agnostic pure HA (high-availability) state machine helpers.
// No ctx dependency. All mutable config (haCfg) and state are passed explicitly,
// and every time-sensitive op accepts an injectable `now` for deterministic tests.
/**
 * Build the canonical quarantine/failure key for a provider+model pair.
 * Missing model defaults to the provider-wide wildcard '*'.
 */
export function keyOf(provider, model) {
    return String(provider) + '\u0000' + (model || '*');
}
/**
 * Split a key back into [provider, model] on the first '\u0000'.
 */
export function splitKey(k) {
    const s = String(k);
    const i = s.indexOf('\u0000');
    return [s.slice(0, i), s.slice(i + 1)];
}
/**
 * When `codes` is empty/undefined, match anything; otherwise only an exact
 * member match passes.
 */
export function matchesCodes(codes, code) {
    return !codes || codes.length === 0 || codes.indexOf(code) >= 0;
}
/**
 * Drop expired quarantine and failure entries (`v.until < now`). Entries whose
 * `until` equals `now` are kept.
 */
export function clearExpired(state, now = Date.now()) {
    for (const [k, v] of state.quarantine)
        if (v.until < now)
            state.quarantine.delete(k);
    for (const [k, v] of state.failures)
        if (v.until < now)
            state.failures.delete(k);
}
/**
 * Exact-key quarantine check (used when picking a backup; a wildcard
 * quarantine must not taint other models under the same provider).
 */
export function isExactQuarantined(state, provider, model, now = Date.now()) {
    clearExpired(state, now);
    return state.quarantine.has(keyOf(provider, model));
}
/**
 * Request-level quarantine check: the exact key matches, or (when the model is
 * unknown) the provider wildcard key matches.
 */
export function isBlocked(state, provider, model, now = Date.now()) {
    clearExpired(state, now);
    return state.quarantine.has(keyOf(provider, model)) || state.quarantine.has(keyOf(provider, '*'));
}
/**
 * Read the per-agent cursor entry without writing back.
 */
export function entryFor(state, agentId) {
    return state.perAgent.get(agentId) || { index: 0 };
}
/**
 * Merge a patch into the per-agent entry and write it back to state.
 */
export function setEntry(state, agentId, patch) {
    state.perAgent.set(agentId, { ...entryFor(state, agentId), ...patch });
}
/**
 * Record one failure for a key, then start/fresh its cooldown. Returns the new
 * running count for that key.
 */
export function bumpFailure(state, haCfg, k, now = Date.now()) {
    clearExpired(state, now);
    const v = state.failures.get(k) || { count: 0, until: 0 };
    v.count += 1;
    v.until = now + haCfg.cooldownMs;
    state.failures.set(k, v);
    return v.count;
}
/**
 * Quarantine a key for the cooldown window and drop any pending failures for it.
 */
export function quarantineKey(state, haCfg, k, code, now = Date.now()) {
    state.quarantine.set(k, { until: now + haCfg.cooldownMs, code });
    state.failures.delete(k);
}
/**
 * Append a switch history entry (trimmed to the newest 50 entries).
 */
export function recordHistory(state, agentId, fromKey, target, code, now = Date.now()) {
    const parts = splitKey(fromKey);
    state.history.push({
        at: new Date(now).toISOString(),
        agent: String(agentId),
        from: parts[0] + (parts[1] === '*' ? '' : '/' + parts[1]),
        to: target.provider + '/' + target.model,
        code: code || '',
    });
    if (state.history.length > 50)
        state.history.splice(0, state.history.length - 50);
}
/**
 * Pure scan starting from the per-agent cursor index. Prefer the model at
 * `(entry.index + i) % n`, skipping entries that lack provider/model, are
 * unregistered (when a non-empty provider set is supplied), match `excludeKey`,
 * or are exact-quarantined. Does NOT advance the cursor.
 */
export function findFallback(state, haCfg, registeredProviders, agentId, excludeKey, now = Date.now()) {
    const list = haCfg.backups || [];
    if (list.length === 0)
        return null;
    const registered = registeredProviders
        ? (registeredProviders instanceof Set ? registeredProviders : new Set(registeredProviders))
        : new Set();
    const entry = entryFor(state, agentId) || { index: 0 };
    const start = entry.index || 0;
    const n = list.length;
    for (let i = 0; i < n; i += 1) {
        const idx = (start + i) % n;
        const b = list[idx];
        if (!b || !b.provider || !b.model)
            continue;
        if (registered.size > 0 && !registered.has(String(b.provider)))
            continue;
        const k = keyOf(b.provider, b.model);
        if (k === excludeKey)
            continue;
        if (isExactQuarantined(state, b.provider, b.model, now))
            continue;
        return {
            provider: String(b.provider),
            model: String(b.model),
            reasoningEffort: b.reasoningEffort || undefined,
            key: k,
            index: (idx + 1) % n,
        };
    }
    return null;
}
/**
 * Pick a fallback AND advance the per-agent cursor to the next one. Returns the
 * result without the cursor index, or null when none is available.
 */
export function pickFallback(state, haCfg, registeredProviders, agentId, excludeKey, now = Date.now()) {
    const found = findFallback(state, haCfg, registeredProviders, agentId, excludeKey, now);
    if (!found)
        return null;
    setEntry(state, agentId, { index: found.index });
    return { provider: found.provider, model: found.model, reasoningEffort: found.reasoningEffort, key: found.key };
}
/**
 * Whether a usable fallback exists (does not advance the cursor).
 */
export function hasFallback(state, haCfg, registeredProviders, agentId, excludeKey, now = Date.now()) {
    return findFallback(state, haCfg, registeredProviders, agentId, excludeKey, now) !== null;
}
/**
 * Maximum retries budget: at least 2, or the threshold plus the backup count.
 */
export function maxRetriesFor(haCfg) {
    return Math.max(2, Number(haCfg.threshold) + (haCfg.backups || []).length);
}
/**
 * Decide which key failed: reuse the exact key recorded for this agent when it
 * belongs to the failing provider, else fall back to that provider's wildcard.
 */
export function computeFailingKey(entry, provider) {
    if (entry && entry.lastKey && splitKey(entry.lastKey)[0] === provider)
        return entry.lastKey;
    return keyOf(provider, '*');
}
/**
 * Fresh, empty HA state container.
 */
export function createHaState() {
    return { quarantine: new Map(), failures: new Map(), perAgent: new Map(), history: [] };
}
