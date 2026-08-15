// HA Orchestrator — static host plugin (composition row).
//
// Static adaptation of `host.js` (the dynamic cordis function body):
//   - `harness.defineTool`          -> `defineTool` from @deepseek-ai/dsh-tools
//   - `harness.registerTool(agent.ctx, t)` -> one `ctx.tools.register(t)` on the
//     plugin's own ctx (global visibility; per-agent workaround deleted)
//   - `harness.handle(name, fn)`    -> `HaOrchestratorRpc extends TypertRemoteService`
//     with @Remote methods (client calls `ctx.remote.haOrchestrator.<method>`)
//
// Cordis owns the row lifecycle: stop/unload disposes listeners, the tool
// registration, and the service — no stale "zombie" registrations survive an
// update, and the plugin loads automatically at process start (no redeploy).
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDictModule, resolveTarget, pickDict, makeT, translate } from './language.js';
import { defaultConfig, sanitizeConfig } from './config.js';
import { createHaState, keyOf as haKeyOf, splitKey as haSplitKey, matchesCodes as haMatchesCodes, clearExpired as haClearExpired, isExactQuarantined as haIsExactQuarantined, isBlocked as haIsBlocked, entryFor as haEntryFor, setEntry as haSetEntry, bumpFailure as haBumpFailure, quarantineKey as haQuarantineKey, recordHistory as haRecordHistory, findFallback as haFindFallback, pickFallback as haPickFallback, hasFallback as haHasFallback, maxRetriesFor as haMaxRetriesFor, computeFailingKey as haComputeFailingKey, countQuarantinedModels as haCountQuarantinedModels, serializeHaState as haSerializeState, deserializeHaState as haDeserializeState, } from './ha-core.js';
import { buildSubagentRequest, buildSupervisorPrompt, appendPipelineCarry, pipelineStageBlock, findUnknownAgents, normalizeFinalRuns, normalizeRunResult, poolRun, renderRunOutput, resolveAgentDef as orchResolveAgentDef, resolveConcurrency, resolveMode, summarizeRuns, truncateTasks, } from './orch-runner.js';
import { decorateRemoteMethod, runInitializers } from './remote.js';
import { getService } from './types.js';
const name = 'ha-orchestrator';
// tools：注册 orchestrate / list-subagents；systemPrompt：上下文注入段落。
// dsh-tools（tools 提供方）自身就 inject systemPrompt，因此 tools 可用时
// systemPrompt 必然已激活 —— 加入 inject 保证 apply 时服务必然存在，
// 消除「服务尚未就绪导致注入静默跳过」的启动竞态。
const inject = ['tools', 'systemPrompt'];
async function apply(ctx) {
    // ================= 配置与状态 =================
    const state = {
        config: JSON.parse(JSON.stringify(defaultConfig)),
        ...createHaState(),
        debugLogs: [],
        probeLog: [],
        runs: [],
    };
    let providerCache = null;
    let providerCacheAt = 0;
    const BACKOFF_BASE_MS = 250;
    const BACKOFF_CAP_MS = 5000;
    const DEBUG_LOG_CAP = 500;
    // 错误分类：不可重试错误（鉴权/适配器缺失）不消耗阈值，直接隔离切换
    const NON_RETRYABLE_CODES = ['INVALID_CREDENTIAL', 'AUTH', 'UNAUTHORIZED', 'NO_ADAPTER'];
    const CONTEXT_WINDOW_CODE = 'CONTEXT_WINDOW_EXCEEDED';
    // HA 运行态持久化文件（隔离/失败计数/游标/历史），与配置文件同目录
    const HA_STATE_FILE = 'ha-orchestrator.ha.json';
    const HA_PERSIST_DEBOUNCE_MS = 500;
    const PROBE_LOG_CAP = 20;
    // 探测失败后的重试间隔：不短于冷却、封顶 5 分钟，避免无限增长
    const PROBE_RETRY_MIN_MS = 60 * 1000;
    const PROBE_RETRY_MAX_MS = 5 * 60 * 1000;
    // run 持久化：JSONL 追加写，内存保留最近 RUN_MEM_CAP 条，磁盘保留 RUN_FILE_CAP 条
    const RUNS_FILE = 'ha-orchestrator.runs.jsonl';
    const RUN_MEM_CAP = 50;
    const RUN_FILE_CAP = 200;
    // ================= 语言系统 =================
    // 语言包位于插件包根目录 `.language/`（zh.json / en.json），键集以 zh.json 为基准。
    // 启动时默认读取 DSH 当前语言选择（settings 命名空间 `locale` 的 preference），
    // 自动切换到目标语言包；目标语言包解析/加载失败时自动回滚到 zh。
    const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
    let langDicts = { zh: null, en: null };
    let langState = {
        active: 'zh', // 生效语言（'zh' | 'en'）
        target: 'zh', // 解析出的目标语言
        dshLocale: null, // DSH 当前语言选择（'zh' | 'en' | null=未设置/未知）
        rollback: false, // 是否发生过回滚
        rollbackReason: '', // 回滚原因（目标语言标识）
        loaded: false,
    };
    let t = (key, params) => translate(langDicts[langState.active], key, params);
    // 工具（orchestrate / list-subagents）是否已注册；语言变化后需要重建工具
    let orchestrateReady = false;
    // 随包 Skill 是否已注册；语言变化后需要重建（正文为当前语言）
    let skillRegistered = false;
    // 读取插件包内文件：优先 node:fs（插件包真实路径），失败回退 fs 服务
    async function readPluginFile(rel) {
        try {
            const p = join(pluginRoot, rel);
            if (existsSync(p))
                return readFileSync(p, 'utf8');
        }
        catch (e) { /* ignore */ }
        try {
            const fsService = getService(ctx, 'fs');
            if (fsService && typeof fsService.resolve === 'function' && typeof fsService.readText === 'function') {
                const target = await fsService.resolve(rel, { cwd: pluginRoot });
                if (target) {
                    const text = await fsService.readText(target);
                    if (text != null)
                        return String(text);
                }
            }
        }
        catch (e) { /* ignore */ }
        return null;
    }
    async function loadDictionaries() {
        const zh = parseDictModule(await readPluginFile('.language/zh.json'));
        const en = parseDictModule(await readPluginFile('.language/en.json'));
        langDicts = { zh, en };
        return langDicts;
    }
    // 读取 DSH 当前语言选择：settings 命名空间 `locale` 的 preference（'zh'|'en'）。
    // 该命名空间由内置 dsh-client-locale 插件注册；未注册/未设置时返回 null（默认 zh）。
    function dshLocaleNow() {
        try {
            const settings = getService(ctx, 'settings');
            if (settings && typeof settings.get === 'function') {
                const sec = settings.get('locale');
                const pref = sec && typeof sec === 'object' ? sec.preference : undefined;
                if (pref === 'zh' || pref === 'en')
                    return pref;
            }
        }
        catch (e) { /* ignore */ }
        return null;
    }
    // 应用语言：加载字典 -> 解析目标（auto 跟随 DSH）-> 失败回滚 zh。
    // 生效语言变化后重建 orchestrate 工具（description 内嵌当前语言文案）。
    async function applyLanguage() {
        await loadDictionaries();
        const langCfg = state.config.lang || {};
        const mode = langCfg.mode === 'en' || langCfg.mode === 'zh' ? langCfg.mode : 'auto';
        const dshLocale = dshLocaleNow();
        const target = resolveTarget(mode, dshLocale);
        const picked = pickDict(langDicts, target);
        langState = {
            active: picked.active,
            target,
            dshLocale,
            rollback: picked.rollback,
            rollbackReason: picked.reason,
            loaded: true,
        };
        t = makeT(langDicts[picked.active] || {});
        try {
            if (orchestrateReady)
                reinstallTools();
        }
        catch (e) {
            console.error('[ha] reinstall tools after language switch failed', e);
        }
        try {
            if (skillRegistered)
                reinstallSkill();
        }
        catch (e) {
            console.error('[ha] reinstall skill after language switch failed', e);
        }
        debugLog('info', 'lang.apply', '插件语言已应用', {
            mode,
            dshLocale,
            target,
            active: picked.active,
            rollback: picked.rollback,
            reason: picked.reason,
            dictZh: !!langDicts.zh,
            dictEn: !!langDicts.en,
        });
        return langState;
    }
    // auto 模式下 DSH 语言变化（settings/updated 或 RPC 时惰性）时重新跟随
    function maybeRefreshLanguage() {
        const mode = state.config.lang && state.config.lang.mode;
        if (mode !== undefined && mode !== 'auto')
            return Promise.resolve();
        const d = dshLocaleNow();
        if (d === langState.dshLocale && langState.loaded)
            return Promise.resolve();
        return applyLanguage();
    }
    // 对外快照：UI 用当前生效字典渲染（t()），并展示语言状态
    function i18nSnapshot() {
        const dict = langDicts[langState.active] || {};
        return {
            mode: state.config.lang ? state.config.lang.mode : 'auto',
            active: langState.active,
            target: langState.target,
            dshLocale: langState.dshLocale || null,
            rollback: !!langState.rollback,
            rollbackReason: langState.rollbackReason || '',
            dicts: { zh: !!langDicts.zh, en: !!langDicts.en },
            dict,
            keys: Object.keys(dict).length,
        };
    }
    // ================= 调试日志（埋点） =================
    // 仅当 config.debug.enabled 时记录到内存环形缓冲（上限 DEBUG_LOG_CAP），
    // 同时镜像到进程 console，方便宿主侧开发观察。UI 经 debug.logs RPC 读取。
    function debugEnabled() {
        const d = state.config && state.config.debug;
        return !!(d && d.enabled);
    }
    function debugLog(level, ev, msg, data) {
        if (!debugEnabled())
            return;
        // JSON 安全化：网关对 RPC 结果做 JSON 边界校验，条目里任何 undefined 值
        // 都会让 debugLogs/debugClear 结果被拒（"business result failed boundary validation"）。
        let safe = undefined;
        if (data !== undefined) {
            try {
                safe = JSON.parse(JSON.stringify(data));
            }
            catch (e) {
                safe = String(data);
            }
        }
        const entry = { at: new Date().toISOString(), level, ev, msg: String(msg) };
        if (safe !== undefined)
            entry.data = safe;
        state.debugLogs.push(entry);
        if (state.debugLogs.length > DEBUG_LOG_CAP)
            state.debugLogs.splice(0, state.debugLogs.length - DEBUG_LOG_CAP);
        console.log('[ha:debug]', level, ev, msg, data === undefined ? '' : JSON.stringify(safe));
    }
    // ================= HA 纯逻辑桥接（ha-core.ts） =================
    // 本地保留与既有调用点同名的薄包装：把闭包内的 state / 配置 / 时钟注入纯函数。
    function now() { return Date.now(); }
    function keyOf(provider, model) { return haKeyOf(provider, model); }
    function splitKey(k) { return haSplitKey(k); }
    function matchesCodes(codes, code) { return haMatchesCodes(codes, code); }
    function clearExpired() { haClearExpired(state, now()); }
    function isExactQuarantined(provider, model) { return haIsExactQuarantined(state, provider, model, now()); }
    function isBlocked(provider, model) { return haIsBlocked(state, provider, model, now()); }
    function entryFor(agentId) { return haEntryFor(state, agentId); }
    function setEntry(agentId, patch) {
        haSetEntry(state, agentId, patch);
        scheduleHaPersist();
    }
    function bumpFailure(k) {
        const count = haBumpFailure(state, state.config.ha, k, now());
        scheduleHaPersist();
        return count;
    }
    function quarantineKey(k, code, level = 'model') {
        haQuarantineKey(state, state.config.ha, k, code, now(), level);
        scheduleHaPersist();
    }
    function record(agentId, fromKey, target, code) {
        haRecordHistory(state, agentId, fromKey, target, code, now());
        scheduleHaPersist();
    }
    // ---- HA 运行态持久化（防抖写盘，重启恢复） ----
    // 隔离/失败计数/游标/历史是“可恢复状态”：进程重启后若丢失，会导致
    // 已熔断模型被立即重试（再次踩雷）。写入走与配置文件相同的存储目录逻辑。
    let haPersistPending = false;
    function scheduleHaPersist() {
        if (haPersistPending)
            return;
        haPersistPending = true;
        const timer = getService(ctx, 'timer');
        if (timer && typeof timer.timeout === 'function') {
            try {
                timer.timeout(() => { haPersistPending = false; void persistHaState(); }, HA_PERSIST_DEBOUNCE_MS);
                return;
            }
            catch (e) { /* 落到立即写 */ }
        }
        haPersistPending = false;
        void persistHaState();
    }
    async function persistHaState() {
        // 状态全空时不留文件（首次安装/重置后不产生噪音）
        if (state.quarantine.size === 0 && state.failures.size === 0 && state.perAgent.size === 0 && state.history.length === 0)
            return;
        const fsService = fsServiceNow();
        if (!fsService || typeof fsService.writeText !== 'function')
            return;
        const text = JSON.stringify(haSerializeState(state), null, 2);
        const dirs = activeStorageDir ? [activeStorageDir] : storageDirs();
        for (const dir of dirs) {
            const target = await resolveStorageTargetIn(dir, HA_STATE_FILE);
            if (!target)
                continue;
            try {
                await fsService.writeText(target, text);
                return;
            }
            catch (e) { /* 下一个目录 */ }
        }
    }
    async function loadPersistedHaState() {
        const text = await readStorageText(HA_STATE_FILE);
        if (text == null)
            return false;
        const restored = haDeserializeState(text);
        if (!restored) {
            console.warn('[ha] HA state file malformed, ignored: ' + HA_STATE_FILE);
            return false;
        }
        haClearExpired(restored, now());
        state.quarantine = restored.quarantine;
        state.failures = restored.failures;
        state.perAgent = restored.perAgent;
        state.history = restored.history;
        console.log('[ha] HA runtime state restored (' + state.quarantine.size + ' quarantines, ' + state.failures.size + ' failures, ' + state.history.length + ' history)');
        debugLog('info', 'ha.restored', 'HA 运行态已恢复', { quarantine: state.quarantine.size, failures: state.failures.size, history: state.history.length });
        emitHaEvent('ha/state-restored', { quarantine: state.quarantine.size, failures: state.failures.size, history: state.history.length });
        scheduleProbesForActive();
        return true;
    }
    let haStateLoaded = false;
    async function ensureHaStateLoaded() {
        if (haStateLoaded)
            return;
        haStateLoaded = true;
        try {
            await loadPersistedHaState();
        }
        catch (e) {
            console.error('[ha] load persisted HA state failed', e);
        }
    }
    // ---- run 持久化（JSONL，追加写 + 容量修剪） ----
    // 每次 orchestrate 调用生成 runId，结束（含中止/异常）后落盘一条记录；
    // 磁盘只保留最近 RUN_FILE_CAP 条，内存只保留最近 RUN_MEM_CAP 条。
    async function writeStorageText(name, text) {
        const dirs = activeStorageDir ? [activeStorageDir] : storageDirs();
        if (dirs.length === 0)
            return writeStorageTextIn('', name, text);
        for (const dir of dirs) {
            if (await writeStorageTextIn(dir, name, text))
                return true;
        }
        return false;
    }
    async function writeStorageTextIn(dir, name, text) {
        const fsService = fsServiceNow();
        const target = await resolveStorageTargetIn(dir, name);
        if (!target || !fsService || typeof fsService.writeText !== 'function')
            return false;
        try {
            await fsService.writeText(target, text);
            return true;
        }
        catch (e) {
            return false;
        }
    }
    function newRunId() {
        return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }
    function emitOrchEvent(name, payload) {
        try {
            ;
            ctx.emit(name, payload);
        }
        catch (e) { /* 监听器抛错不影响主流程 */ }
    }
    // 读取磁盘上的 run 记录列表（JSONL，最新在前）
    async function readRunsFromDisk() {
        try {
            const text = await readStorageText(RUNS_FILE);
            if (text == null)
                return [];
            const out = [];
            for (const line of String(text).split(/\r?\n/)) {
                if (!line.trim())
                    continue;
                try {
                    const rec = JSON.parse(line);
                    if (rec && rec.runId)
                        out.push(rec);
                }
                catch (e) { /* 跳过损坏行 */ }
            }
            return out.reverse();
        }
        catch (e) {
            return [];
        }
    }
    // 落盘一条 run 记录（读-追加-修剪-写）
    async function persistRun(rec) {
        try {
            const existing = await readRunsFromDisk();
            const all = existing.concat([rec]).slice(0, RUN_FILE_CAP);
            const text = all.map((r) => JSON.stringify(r)).join('\n') + '\n';
            await writeStorageText(RUNS_FILE, text);
        }
        catch (e) {
            console.error('[ha] persist run failed', e);
        }
    }
    // 记录 run 到内存 + 落盘（run 结束时调用）
    function recordRun(rec) {
        state.runs.unshift(rec);
        if (state.runs.length > RUN_MEM_CAP)
            state.runs.splice(RUN_MEM_CAP);
        void persistRun(rec);
    }
    // ---- 全局并发预算（跨 run 共享信号量） ----
    // orch.globalConcurrency > 0 时，所有 orchestrate 执行共享并发上限，
    // 防止多个 agent 同时发起编排把子智能体提供方打爆。
    let activeOrchSlots = 0;
    const orchWaiters = [];
    async function acquireOrchSlot() {
        const limit = Number(state.config.orch.globalConcurrency) || 0;
        if (limit <= 0)
            return;
        if (activeOrchSlots < limit) {
            activeOrchSlots += 1;
            return;
        }
        await new Promise((resolve) => { orchWaiters.push(resolve); });
        activeOrchSlots += 1;
    }
    function releaseOrchSlot() {
        if (activeOrchSlots > 0)
            activeOrchSlots -= 1;
        const next = orchWaiters.shift();
        if (next)
            next();
    }
    // ---- 类型化会话事件（可观测性） ----
    // ha/failover、ha/circuit-opened、ha/circuit-closed、ha/probe、ha/state-restored。
    // 事件名不在 cordis 核心 Events 声明内，经窄化签名发出；载荷为纯 JSON。
    function emitHaEvent(name, payload) {
        try {
            ;
            ctx.emit(name, payload);
        }
        catch (e) { /* 事件监听器抛错不影响主流程 */ }
    }
    // ---- 真实探测恢复 ----
    // 冷却到期后用小成本调用（maxTokens=1）验证隔离模型是否恢复：
    // 成功 -> 解除隔离（circuit-closed）；失败 -> 延长冷却并再次安排探测。
    // provider 通配键不直接探测：到期即解除（circuit-closed, reason=expired）。
    function scheduleProbe(key, delayMs) {
        const timer = getService(ctx, 'timer');
        const doProbe = () => { void runProbe(key); };
        if (timer && typeof timer.timeout === 'function') {
            try {
                timer.timeout(doProbe, Math.max(0, delayMs));
                return;
            }
            catch (e) { /* 落到立即执行 */ }
        }
        doProbe();
    }
    function scheduleProbesForActive() {
        if (!state.config.ha.probeEnabled)
            return;
        const tNow = now();
        for (const [k, v] of state.quarantine) {
            const delay = v.until - tNow;
            if (delay > 0)
                scheduleProbe(k, delay);
        }
    }
    // 新隔离产生时安排到期探测（调用点：隔离之后）
    function scheduleProbeFor(key) {
        if (!state.config.ha.probeEnabled)
            return;
        const entry = state.quarantine.get(key);
        if (!entry)
            return;
        const delay = entry.until - now();
        if (delay > 0)
            scheduleProbe(key, delay);
    }
    async function probeOnce(provider, model) {
        const llm = getService(ctx, 'llm');
        if (!llm || typeof llm.stream !== 'function')
            return { ok: false, reason: 'no-llm-service' };
        const signal = new AbortController().signal;
        const request = {
            provider,
            model,
            maxTokens: 1,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
            signal,
        };
        try {
            let iterate;
            if (typeof llm.prepareCall === 'function') {
                const prepared = await llm.prepareCall({ provider, model, maxTokens: 1 }, signal);
                iterate = typeof prepared.stream === 'function' ? prepared.stream(request) : llm.stream(request);
            }
            else {
                iterate = llm.stream(request);
            }
            for await (const _chunk of iterate)
                break;
            return { ok: true };
        }
        catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
        }
    }
    function recordProbe(key, ok, reason) {
        state.probeLog.unshift({ at: new Date().toISOString(), key, ok, reason });
        if (state.probeLog.length > PROBE_LOG_CAP)
            state.probeLog.splice(PROBE_LOG_CAP);
    }
    async function runProbe(key, force = false) {
        const entry = state.quarantine.get(key);
        const cfg = state.config.ha;
        if (!cfg.enabled || !cfg.probeEnabled)
            return { ok: false, reason: 'probe-disabled', key };
        const parts = splitKey(key);
        if (!entry)
            return { ok: false, reason: 'not-quarantined', key };
        // 已被重新隔离（更长的冷却）-> 顺延到新到期点；force（手动探测）跳过此检查
        if (!force && entry.until > now()) {
            scheduleProbe(key, entry.until - now());
            return { ok: false, reason: 'rescheduled', key };
        }
        const tNow = now();
        // provider 通配键：不探测，到期即解除
        if (parts[1] === '*') {
            state.quarantine.delete(key);
            scheduleHaPersist();
            emitHaEvent('ha/circuit-closed', { key, level: entry.level || 'provider', reason: 'expired' });
            recordProbe(key, true, 'expired');
            return { ok: true, reason: 'expired', key };
        }
        const res = await probeOnce(parts[0], parts[1]);
        recordProbe(key, res.ok, res.reason);
        emitHaEvent('ha/probe', { key, at: new Date().toISOString(), ok: res.ok, reason: res.reason || '' });
        debugLog('info', 'ha.probe', '探测结果', { key, ok: res.ok, reason: res.reason || '' });
        if (res.ok) {
            state.quarantine.delete(key);
            scheduleHaPersist();
            emitHaEvent('ha/circuit-closed', { key, level: entry.level || 'model', reason: 'probe' });
            console.log('[ha] probe ok, circuit closed ' + key);
            return { ok: true, key };
        }
        // 未恢复：延长冷却并再次探测（间隔 [60s, 5min]）
        const retryIn = Math.min(PROBE_RETRY_MAX_MS, Math.max(cfg.cooldownMs, PROBE_RETRY_MIN_MS));
        state.quarantine.set(key, { ...entry, until: tNow + retryIn });
        scheduleHaPersist();
        scheduleProbe(key, retryIn);
        console.log('[ha] probe failed, keep quarantine ' + key + ' (' + (res.reason || 'unknown') + '), retry in ' + retryIn + 'ms');
        return { ok: false, reason: res.reason, key };
    }
    // ---- 两层熔断：provider 级阈值 ----
    function maybeOpenProviderCircuit(provider) {
        const cfg = state.config.ha;
        const threshold = Number(cfg.providerThreshold) || 0;
        if (threshold <= 0)
            return;
        const providerKey = keyOf(provider, '*');
        if (state.quarantine.has(providerKey))
            return;
        const models = haCountQuarantinedModels(state, provider, now());
        if (models >= threshold) {
            quarantineKey(providerKey, 'PROVIDER_CIRCUIT', 'provider');
            scheduleProbeFor(providerKey);
            console.log('[ha] provider circuit opened ' + provider + ' (' + models + ' models quarantined)');
            emitHaEvent('ha/circuit-opened', { key: providerKey, level: 'provider', code: 'PROVIDER_CIRCUIT', cooldownMs: cfg.cooldownMs });
        }
    }
    function registeredProviders() {
        const tNow = now();
        if (providerCache && tNow - providerCacheAt < 30000)
            return providerCache;
        const llm = getService(ctx, 'llm');
        let set = null;
        try {
            if (llm) {
                set = new Set(llm.listProviders().map((p) => String((p && p.id) || p.provider || p.name || p)));
            }
        }
        catch (e) {
            set = null;
        }
        if (!set)
            set = new Set();
        providerCache = set;
        providerCacheAt = tNow;
        return set;
    }
    function findFallback(agentId, excludeKey) {
        return haFindFallback(state, state.config.ha, registeredProviders(), agentId, excludeKey, now());
    }
    function pickFallback(agentId, excludeKey) {
        return haPickFallback(state, state.config.ha, registeredProviders(), agentId, excludeKey, now());
    }
    function hasFallback(agentId, excludeKey) {
        return haHasFallback(state, state.config.ha, registeredProviders(), agentId, excludeKey, now());
    }
    // 失败重试退避：指数增长、封顶；沙箱无 setTimeout，走 timer 服务
    async function backoff(retries) {
        const timer = getService(ctx, 'timer');
        if (!timer || typeof timer.timeout !== 'function')
            return;
        const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, (retries || 1) - 1)));
        try {
            await timer.timeout(delay);
        }
        catch (e) { /* ignore */ }
    }
    function tryPersist(target) {
        const adm = getService(ctx, 'agentDefaultModel');
        if (!adm)
            return;
        try {
            adm.saveSelection({ provider: target.provider, model: target.model });
        }
        catch (e) {
            console.error('saveSelection failed', e);
        }
    }
    function currentDefaultSelection() {
        const adm = getService(ctx, 'agentDefaultModel');
        if (!adm)
            return null;
        try {
            return adm.currentSelection();
        }
        catch (e) {
            return null;
        }
    }
    // ================= 配置持久化（JSON 文件 + 备份） =================
    const CONFIG_FILE = 'ha-orchestrator.config.json';
    const CONFIG_BACKUP = 'ha-orchestrator.config.backup.json';
    // fs 服务每次用时再查：apply 阶段服务可能尚未就绪（组合行顺序/作用域），
    // 若在 apply 时一次性捕获进闭包，之后永远不会重新解析，持久化会静默失效。
    function fsServiceNow() {
        try {
            return getService(ctx, 'fs');
        }
        catch (e) {
            return null;
        }
    }
    // 会话 workspace：优先当前会话 cwd，拿不到回退 DSH 数据目录
    function storageDir() {
        try {
            const agents = getService(ctx, 'agents');
            if (agents && typeof agents.list === 'function') {
                const list = agents.list() || [];
                for (const a of list) {
                    const cwd = a && a.session && a.session.header && a.session.header.cwd;
                    if (cwd)
                        return String(cwd);
                }
            }
        }
        catch (e) { /* ignore */ }
        try {
            const env = getService(ctx, 'launchEnvironment');
            if (env && typeof env.get === 'function') {
                const hit = env.get('DSH_HOME');
                if (hit && hit.value)
                    return String(hit.value);
            }
        }
        catch (e) { /* ignore */ }
        return '';
    }
    // fs 沙箱的 workspace-write 可写根（默认 DSH web 进程 cwd）：
    // workspace-write 模式下沙箱必然放行该根目录内的写入，是持久化的兜底位置
    function sandboxWritableRoot() {
        try {
            const sp = getService(ctx, 'sandboxPolicy');
            if (sp && typeof sp.resolve === 'function') {
                const pol = sp.resolve();
                if (pol && pol.workspaceRoot)
                    return String(pol.workspaceRoot);
            }
        }
        catch (e) { /* ignore */ }
        return '';
    }
    // 候选存储目录（写入与读取用同一顺序，保证重启后能找到）：
    //   1) 会话 workspace / DSH 数据目录（原逻辑；部分部署下沙箱放行）
    //   2) 沙箱 workspace-write 可写根（默认 DSH web 进程 cwd，workspace-write 下必可写）
    function storageDirs() {
        const dirs = [];
        const s1 = storageDir();
        if (s1)
            dirs.push(s1);
        const s2 = sandboxWritableRoot();
        if (s2 && dirs.indexOf(s2) < 0)
            dirs.push(s2);
        return dirs;
    }
    async function resolveStorageTargetIn(dir, name) {
        const fsService = fsServiceNow();
        if (!fsService || typeof fsService.resolve !== 'function')
            return null;
        try {
            return await fsService.resolve(name, dir ? { cwd: dir } : undefined);
        }
        catch (e) {
            return null;
        }
    }
    async function readStorageTextIn(dir, name) {
        const fsService = fsServiceNow();
        const target = await resolveStorageTargetIn(dir, name);
        if (!target || !fsService || typeof fsService.readText !== 'function')
            return null;
        try {
            const text = await fsService.readText(target);
            return text == null ? null : String(text);
        }
        catch (e) {
            return null;
        }
    }
    async function readStorageText(name) {
        // 优先读最近一次成功写入的目录，避免启动/重载时因目录顺序变化而读到旧的默认配置。
        const dirs = [];
        if (activeStorageDir)
            dirs.push(activeStorageDir);
        for (const dir of storageDirs()) {
            if (dirs.indexOf(dir) < 0)
                dirs.push(dir);
        }
        if (dirs.length === 0)
            return readStorageTextIn('', name);
        for (const dir of dirs) {
            const text = await readStorageTextIn(dir, name);
            if (text != null)
                return text;
        }
        return null;
    }
    function parseConfigJson(text) {
        if (text == null)
            return null;
        try {
            const raw = JSON.parse(text);
            return raw && typeof raw === 'object' ? raw : null;
        }
        catch (e) {
            return null;
        }
    }
    async function loadPersistedConfig() {
        let raw = parseConfigJson(await readStorageText(CONFIG_FILE));
        if (!raw)
            raw = parseConfigJson(await readStorageText(CONFIG_BACKUP));
        if (!raw)
            return false;
        const next = sanitizeConfig(raw, defaultConfig);
        for (const key of Object.keys(next)) {
            state.config[key] = next[key];
        }
        configLoaded = true;
        console.log('[ha] config restored from JSON file');
        debugLog('info', 'config.restored', '配置从 JSON 文件恢复');
        return true;
    }
    // 启动时 fs / agents / sandboxPolicy / timer 等服务可能尚未就绪，loadPersistedConfig 首次
    // 可能静默失败，导致插件更新/HMR 后只看到默认配置。这里同时提供：
    //   1) 定时重试（沿用 systemPrompt 注入的重试策略）；
    //   2) stateGet 懒加载兜底——设置页每次拉状态时若还没成功加载过，会再尝试一次。
    let configLoaded = false;
    let configLoadPromise = null;
    let configLoadRetries = 0;
    const CONFIG_LOAD_MAX_RETRIES = 30;
    const CONFIG_LOAD_RETRY_MS = 2000;
    async function retryLoadPersistedConfig() {
        const ok = await loadPersistedConfig();
        if (ok) {
            console.log('[ha] config restored after retry');
            debugLog('info', 'config.restored.retry', '配置在服务就绪后恢复');
            try {
                reinstallTools();
            }
            catch (e) {
                console.error('[ha] reinstall tools after config retry failed', e);
            }
            await applyLanguage().catch((e) => console.error('[ha] apply language after config retry failed', e));
            await ensureHaStateLoaded().catch((e) => console.error('[ha] load HA state after retry failed', e));
            return;
        }
        scheduleConfigLoadRetry();
    }
    function scheduleConfigLoadRetry() {
        if (configLoadRetries >= CONFIG_LOAD_MAX_RETRIES)
            return;
        configLoadRetries += 1;
        const timer = getService(ctx, 'timer');
        if (!timer || typeof timer.timeout !== 'function')
            return;
        try {
            timer.timeout(() => { void retryLoadPersistedConfig(); }, CONFIG_LOAD_RETRY_MS);
        }
        catch (e) { /* ignore */ }
    }
    // 供 stateGet 调用：如果启动时没加载成功，则在这里补一次加载；成功后重建工具并跟随语言。
    function ensureConfigLoaded() {
        if (configLoaded)
            return Promise.resolve();
        if (!configLoadPromise) {
            configLoadPromise = loadPersistedConfig().then(async (ok) => {
                configLoadPromise = null;
                if (!ok)
                    return;
                try {
                    reinstallTools();
                }
                catch (e) {
                    console.error('[ha] reinstall tools after lazy config load failed', e);
                }
                await applyLanguage().catch((e) => console.error('[ha] apply language after lazy config load failed', e));
                await ensureHaStateLoaded().catch((e) => console.error('[ha] load HA state after lazy config load failed', e));
            }).catch((e) => {
                configLoadPromise = null;
                console.error('[ha] lazy config load failed', e);
            });
        }
        return configLoadPromise;
    }
    // 持久化状态：回显到 state.get / stateSet 响应，UI 展示，失败不再静默
    let activeStorageDir = '';
    let persistState = { ok: false, path: '', error: '' };
    // 失败时的诊断信息：fs 服务类型、writeText 是否存在、沙箱策略
    function persistDiag() {
        const out = {};
        try {
            const fs = fsServiceNow();
            out.fsType = fs === null ? 'null' : typeof fs;
            out.fsWriteText = !!(fs && typeof fs.writeText === 'function');
            out.fsResolve = !!(fs && typeof fs.resolve === 'function');
            const sp = getService(ctx, 'sandboxPolicy');
            out.sandboxPolicy = !!(sp && typeof sp.resolve === 'function');
            if (sp && typeof sp.resolve === 'function') {
                try {
                    const pol = sp.resolve();
                    out.policy = { mode: (pol && pol.mode) || '', workspaceRoot: (pol && pol.workspaceRoot) || '' };
                }
                catch (e) {
                    out.policyError = String((e && e.message) || e);
                }
            }
        }
        catch (e) {
            out.error = String((e && e.message) || e);
        }
        return out;
    }
    async function persistConfig() {
        const fsService = fsServiceNow();
        if (!fsService || typeof fsService.writeText !== 'function') {
            persistState = { ok: false, path: '', error: 'fs 服务不可用（无 writeText）', diag: persistDiag() };
            console.error('[ha] persist config failed: fs service unavailable', persistState.diag);
            return false;
        }
        const text = JSON.stringify(state.config, null, 2);
        const dirs = activeStorageDir ? [activeStorageDir] : storageDirs();
        let lastErr = 'no writable location';
        for (const dir of dirs) {
            const target = await resolveStorageTargetIn(dir, CONFIG_FILE);
            if (!target) {
                lastErr = 'resolve failed: ' + (dir || 'default cwd');
                continue;
            }
            try {
                const backupTarget = await resolveStorageTargetIn(dir, CONFIG_BACKUP);
                const prev = await readStorageTextIn(dir, CONFIG_FILE);
                if (prev != null && backupTarget) {
                    try {
                        await fsService.writeText(backupTarget, prev);
                    }
                    catch (e) { /* 备份失败不影响主写 */ }
                }
                await fsService.writeText(target, text);
                activeStorageDir = dir;
                persistState = { ok: true, path: String(target.displayPath || ''), error: '' };
                console.log('[ha] config persisted:', persistState.path);
                debugLog('info', 'config.persisted', '配置已写入磁盘', { file: persistState.path });
                return true;
            }
            catch (e) {
                lastErr = String((e && e.message) || e);
            }
        }
        persistState = { ok: false, path: '', error: lastErr, diag: persistDiag() };
        console.error('[ha] persist config failed:', lastErr, persistState.diag);
        debugLog('error', 'config.persist.failed', '配置写入失败', { error: lastErr });
        return false;
    }
    const loadedAtStart = await loadPersistedConfig();
    if (!loadedAtStart)
        scheduleConfigLoadRetry();
    // 语言系统：启动时默认读取 DSH 当前语言选择并切换到目标语言包，
    // 失败自动回滚 zh。必须在 orchestrate 工具构建之前执行，
    // 保证工具 description 从一开始就使用正确的语言文案。
    await applyLanguage();
    // HA 运行态恢复：隔离/失败计数/游标/历史（fs 不可用时随配置重试路径补载）
    await ensureHaStateLoaded();
    debugLog('info', 'plugin.ready', '静态插件已就绪（调试模式开启，开始记录事件）');
    // ================= 高可用：失败回退 =================
    // prepend: true 保证本插件监听器在瀑布流最外层，拥有最终决定权
    ctx.on('agent/request', async (payload, next) => {
        try {
            const cfg = state.config.ha;
            if (!cfg.enabled || !cfg.backups || cfg.backups.length === 0)
                return next();
            const config = await next();
            if (!config || !config.provider || !config.model)
                return config;
            const k = keyOf(config.provider, config.model);
            setEntry(payload.agent.id, { lastKey: k });
            // CONTEXT_WINDOW_EXCEEDED 降级：上一次请求因上下文超长失败且开启降级时，
            // 本请求去掉 reasoningEffort 重试（标记用后即清）
            const entry = entryFor(payload.agent.id);
            if (entry.degradeReasoning) {
                const stripped = {};
                for (const key of Object.keys(config))
                    if (key !== 'reasoningEffort')
                        stripped[key] = config[key];
                setEntry(payload.agent.id, { degradeReasoning: false });
                debugLog('info', 'ha.degrade', '上下文超长降级：去掉 reasoningEffort 重试', { agent: payload.agent.id, provider: config.provider, model: config.model });
                return stripped;
            }
            debugLog('debug', 'ha.request', '模型请求进入', { agent: payload.agent.id, provider: config.provider, model: config.model });
            if (!isBlocked(config.provider, config.model)) {
                // 仅在该模型无未过期失败累积（真正健康）时清零重试计数，避免阈值累积期被误清零
                if (!state.failures.has(k))
                    setEntry(payload.agent.id, { retries: 0 });
                return config;
            }
            debugLog('warn', 'ha.blocked', '模型被隔离，尝试挑选备用', { key: k });
            const target = pickFallback(payload.agent.id, k);
            if (!target) {
                debugLog('warn', 'ha.blocked', '无可用备用，放行原模型', { key: k });
                return config;
            }
            // 实际切换点：只有这里才推进游标并写历史，保证记录与实际使用一致
            record(payload.agent.id, k, target, entry.failCode || '');
            setEntry(payload.agent.id, { lastKey: target.key, failCode: '' });
            if (cfg.persistSelection)
                tryPersist(target);
            debugLog('info', 'ha.switch', '切换到备用模型', {
                agent: payload.agent.id,
                from: config.provider + '/' + config.model,
                to: target.provider + '/' + target.model,
                code: entry.failCode || '',
            });
            emitHaEvent('ha/failover', {
                agent: payload.agent.id,
                from: config.provider + '/' + config.model,
                to: target.provider + '/' + target.model,
                code: entry.failCode || '',
                at: new Date().toISOString(),
            });
            const rest = {};
            for (const key of Object.keys(config))
                if (key !== 'reasoningEffort')
                    rest[key] = config[key];
            const out = { ...rest, provider: target.provider, model: target.model };
            if (target.reasoningEffort)
                out.reasoningEffort = target.reasoningEffort;
            return out;
        }
        catch (e) {
            console.error('agent/request handler failed', e);
            return next();
        }
    }, true);
    ctx.on('agent/request-error', async (payload, next) => {
        try {
            const cfg = state.config.ha;
            if (!cfg.enabled || !cfg.backups || cfg.backups.length === 0)
                return next();
            const { agent, provider, failure, signal } = payload;
            if (signal.aborted)
                return next();
            const code = failure && failure.code ? String(failure.code) : 'UNKNOWN';
            if (!matchesCodes(cfg.codes, code))
                return next();
            const entry = entryFor(agent.id);
            debugLog('debug', 'ha.error', '模型请求失败', { agent: agent.id, provider, code });
            // 精确键优先（agent/request 已记录 lastKey），拿不到才降级 provider 通配键
            const failingKey = haComputeFailingKey(entry, provider);
            const maxRetries = haMaxRetriesFor(cfg);
            // ---- 错误分类策略 ----
            // 不可重试错误（鉴权/适配器缺失）：重试原模型无意义，直接隔离并切备用；
            // 不消耗阈值计数（阈值只针对可重试的瞬时故障）。
            if (NON_RETRYABLE_CODES.indexOf(code) >= 0) {
                if ((entry.retries || 0) >= maxRetries) {
                    debugLog('warn', 'ha.budget', '重试预算耗尽，放行（电路熔断）', { agent: agent.id, failingKey, retries: entry.retries || 0, maxRetries });
                    return next();
                }
                if (!hasFallback(agent.id, failingKey))
                    return next();
                quarantineKey(failingKey, code);
                scheduleProbeFor(failingKey);
                setEntry(agent.id, { retries: (entry.retries || 0) + 1, failCode: code });
                console.log('[ha] non-retryable failover ' + agent.id + ' ' + failingKey + ' (' + code + ')');
                emitHaEvent('ha/circuit-opened', { key: failingKey, level: 'model', code, cooldownMs: cfg.cooldownMs });
                maybeOpenProviderCircuit(provider);
                return { kind: 'retry' };
            }
            // ---- CONTEXT_WINDOW_EXCEEDED：可选降级（去 reasoningEffort 重试原模型） ----
            if (code === CONTEXT_WINDOW_CODE && cfg.degradeContextWindow) {
                if ((entry.retries || 0) >= maxRetries) {
                    debugLog('warn', 'ha.budget', '降级重试预算耗尽，放行', { agent: agent.id, failingKey, retries: entry.retries || 0, maxRetries });
                    return next();
                }
                setEntry(agent.id, { degradeReasoning: true, retries: (entry.retries || 0) + 1 });
                debugLog('info', 'ha.degrade.set', '上下文超长：标记降级重试', { agent: agent.id, failingKey, retry: (entry.retries || 0) + 1 });
                await backoff((entry.retries || 0) + 1);
                return { kind: 'retry' };
            }
            // ---- 可重试错误：阈值 + 滑动窗口 + 冷却 ----
            if ((entry.retries || 0) >= maxRetries) {
                debugLog('warn', 'ha.budget', '重试预算耗尽，放行（电路熔断）', { agent: agent.id, failingKey, retries: entry.retries || 0, maxRetries });
                return next();
            }
            const nextRetries = (entry.retries || 0) + 1;
            const count = bumpFailure(failingKey);
            if (count < cfg.threshold) {
                // 阈值内：不隔离、不切换，带退避重试原模型
                setEntry(agent.id, { retries: nextRetries });
                debugLog('info', 'ha.retry', '阈值内带退避重试原模型', { agent: agent.id, failingKey, count, threshold: cfg.threshold, retry: nextRetries });
                await backoff(nextRetries);
                return { kind: 'retry' };
            }
            if (!hasFallback(agent.id, failingKey)) {
                debugLog('warn', 'ha.quarantine', '达到阈值但无可用备用，放行（不隔离不重试）', { agent: agent.id, failingKey, code });
                return next();
            }
            quarantineKey(failingKey, code);
            scheduleProbeFor(failingKey);
            setEntry(agent.id, { retries: nextRetries, failCode: code });
            console.log('[ha] failover ' + agent.id + ' ' + failingKey + ' (quarantined, ' + code + ')');
            debugLog('warn', 'ha.quarantine', '隔离失败模型并重试备用', { agent: agent.id, key: failingKey, code, cooldownMs: cfg.cooldownMs, retry: nextRetries });
            emitHaEvent('ha/circuit-opened', { key: failingKey, level: 'model', code, cooldownMs: cfg.cooldownMs });
            // 模型级熔断后检查 provider 级阈值（两层熔断）
            maybeOpenProviderCircuit(provider);
            await backoff(nextRetries);
            return { kind: 'retry' };
        }
        catch (e) {
            console.error('agent/request-error handler failed', e);
            return next();
        }
    }, true);
    // 停止兜底：模型错误中断后，先隔离失败模型，再延迟到 driver idle 后 steer 继续
    ctx.on('agent/error', (payload) => {
        try {
            const cfg = state.config.ha;
            if (!cfg.enabled || !cfg.steerOnStop)
                return;
            const { agent, turn, error } = payload;
            const MODEL_CODES = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'QUOTA', 'CONTEXT_WINDOW_EXCEEDED', 'EMPTY_RESPONSE', 'NO_ADAPTER', 'INVALID_CREDENTIAL'];
            const code = error && error.failure
                ? String(error.failure.code || 'UNKNOWN')
                : (error && typeof error.code === 'string' ? String(error.code) : '');
            if (!code || MODEL_CODES.indexOf(code) < 0)
                return;
            const entry = entryFor(agent.id);
            const failingKey = entry.lastKey || '';
            // 关键：先隔离失败模型，保证下一次请求（无论手动还是自动唤醒）直接用备用模型
            if (failingKey) {
                quarantineKey(failingKey, code);
                scheduleProbeFor(failingKey);
            }
            if (entry.steeredTurn === turn)
                return;
            if (!hasFallback(agent.id, failingKey))
                return;
            setEntry(agent.id, { steeredTurn: turn, failCode: code });
            const text = t('ha.steerText');
            console.log('[ha] steer after stop ' + agent.id + ' (' + code + ')');
            debugLog('warn', 'ha.steer', '模型错误中断，延迟 steer 继续任务', { agent: agent.id, code, turn, failingKey });
            const timer = getService(ctx, 'timer');
            const doSteer = () => {
                try {
                    ;
                    agent.steer({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'ha-orchestrator' } });
                }
                catch (e) {
                    console.error('[ha] steer failed', e);
                }
            };
            // 延迟到 driver 回卷结束（idle）后再 steer，唤醒才能真正拉起新一轮
            if (timer)
                timer.timeout(doSteer, 300);
            else
                doSteer();
        }
        catch (e) {
            console.error('agent/error handler failed', e);
        }
    });
    // ================= 子智能体编排 =================
    function resolveProvider() {
        const subagents = getService(ctx, 'subagents');
        if (!subagents)
            throw new Error(t('orch.errNoService'));
        const names = subagents.list();
        const wanted = state.config.orch.provider;
        const provider = wanted && names.indexOf(wanted) >= 0 ? wanted : (names[0] || '');
        if (!provider)
            throw new Error(t('orch.errNoProvider'));
        return provider;
    }
    // 自定义子智能体：按名称查找启用项
    function resolveAgentDef(name) {
        return orchResolveAgentDef(state.config.orch.agents, name);
    }
    // 子智能体清单不再内嵌到工具描述/系统提示词：模型按需调用内置 list-subagents
    // 工具获取（名称/provider/模型/描述），避免每轮注入占用上下文。
    async function runOne(subagents, provider, task, extra, parent, signal, agentDef, runId = '') {
        if (!signal)
            throw new Error('runOne: 缺少取消信号（signal），子智能体提供方需要真实 AbortSignal');
        const runLabel = String(task.label || task.id || 'task');
        const agentName = agentDef ? String(agentDef.name) : '';
        debugLog('debug', 'orch.task.start', '子智能体任务开始', { label: runLabel, agent: agentName, provider });
        if (runId)
            emitOrchEvent('orch/task-status', { runId, taskId: String(task.id || ''), label: runLabel, status: 'running', at: new Date().toISOString() });
        const request = buildSubagentRequest(task, extra, agentDef, t('orch.mergedPrefix'), parent, signal);
        const run = await subagents.start(provider, request);
        try {
            const res = await run.result;
            const status = String(res.stopReason || 'completed');
            const text = (res.output || []).filter((b) => !!(b && b.type === 'text')).map((b) => b.text).join('\n');
            debugLog('debug', 'orch.task.end', '子智能体任务结束', { label: runLabel, agent: agentName, status, outputChars: text.length });
            if (runId)
                emitOrchEvent('orch/task-status', { runId, taskId: String(task.id || ''), label: runLabel, status, at: new Date().toISOString() });
            return normalizeRunResult(task, agentDef, res);
        }
        catch (e) {
            debugLog('error', 'orch.task.error', '子智能体任务失败', { label: runLabel, agent: agentName, message: String((e && e.message) || e) });
            if (runId)
                emitOrchEvent('orch/task-status', { runId, taskId: String(task.id || ''), label: runLabel, status: 'error', at: new Date().toISOString() });
            throw e;
        }
        finally {
            await run.dispose();
        }
    }
    // 汇总 runs 为纯文本（注入当前语言的 t，供 supervisor / fanout 使用）
    function summarize(runs) { return summarizeRuns(runs, t); }
    function buildOrchestrateTool() {
        const joinSep = langState.active === 'en' ? ' ' : '';
        const descParts = [
            t('orch.toolAutoUse'),
            t('orch.toolIntro'),
            t('orch.toolFanout'),
            t('orch.toolPipeline'),
            t('orch.toolSupervisor'),
            t('orch.toolMapReduce'),
            t('orch.toolRouter'),
            t('orch.toolYouAre'),
            t('orch.toolAgentField'),
            t('orch.toolDefault'),
        ];
        return defineTool({
            name: 'orchestrate',
            description: descParts.join(joinSep) + t('orch.rosterHint'),
            parameters: {
                mode: { type: 'string', enum: ['fanout', 'pipeline', 'supervisor', 'map-reduce', 'router'] },
                agent: { type: 'string', description: '默认自定义子智能体名称（可选；可用列表调用 list-subagents 查询）' },
                supervisorAgent: { type: 'string', description: 'supervisor 模式使用的监督子智能体名称（可选；可用列表调用 list-subagents 查询）' },
                preset: { type: 'string', description: '已保存的配方名称（可选；提供后从配方加载 mode/tasks/agent，调用参数可覆盖）' },
                resume: { type: 'string', description: '上次中断的 runId（可选；恢复未完成的子任务，已完成任务复用其结果）' },
                reviewRounds: { type: 'number', description: 'supervisor 模式评审轮次（可选，默认 1，上限 3）' },
                reviewers: { type: 'array', description: 'supervisor 模式并行评审的自定义子智能体名称数组（可选；评审后由 supervisor 综合）' },
                budgetAgents: { type: 'number', description: '本次编排的子智能体调用预算（可选，0 = 不限；含重试/评审/合成等全部调用）' },
                tasks: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            agent: { type: 'string', description: '自定义子智能体名称（可选；可用列表调用 list-subagents 查询）' },
                            prompt: { type: 'string', required: true },
                        },
                    },
                },
                mergeInstructions: { type: 'string' },
                concurrency: { type: 'number' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        summary: { type: 'string' },
                        runId: { type: 'string' },
                        runs: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    id: { type: 'string', required: true },
                                    label: { type: 'string', required: true },
                                    agent: { type: 'string' },
                                    status: { type: 'string', required: true },
                                    output: { type: 'string', required: true },
                                },
                            },
                        },
                    },
                },
                render(args, value) {
                    return renderRunOutput(value);
                },
                // 对话内 Run 卡片：结构化展示元数据（随会话日志持久化，replay 可还原）
                presentationMeta(args, value) {
                    return {
                        runId: String((value && value.runId) || ''),
                        runs: (value && value.runs ? value.runs : []).map((r) => ({ id: r.id, label: r.label, status: r.status })),
                    };
                },
            },
            // 顶层展示投影：pending 态标题 + 完成后标题（含 runId）
            presentCall(args) {
                return { card: 'generic', title: 'orchestrate (' + String(args.mode || 'fanout') + ')', kind: 'other' };
            },
            presentResult(args, result) {
                const meta = (result && result.meta);
                return { card: 'generic', title: 'orchestrate' + (meta && meta.runId ? ' · ' + meta.runId : '') };
            },
            async execute(args, exec) {
                const runId = newRunId();
                const startedAt = new Date().toISOString();
                const startedMs = Date.now();
                let slotHeld = false;
                try {
                    const cfg = state.config.orch;
                    if (!cfg.enabled)
                        throw new Error(t('orch.errDisabled'));
                    if (!exec.agent)
                        throw new Error(t('orch.errNoAgentCtx'));
                    const subagents = getService(ctx, 'subagents');
                    if (!subagents)
                        throw new Error(t('orch.errNoService'));
                    // ---- 全局并发预算 ----
                    await acquireOrchSlot();
                    slotHeld = true;
                    // ---- 配方（preset）解析：从配方加载 mode/tasks/agent，调用参数可覆盖 ----
                    let presetMode;
                    let presetAgent;
                    let presetSupervisorAgent;
                    let presetMergeInstructions;
                    let presetTasks;
                    if (args.preset) {
                        const preset = (cfg.presets || []).find((p) => p && p.name === String(args.preset));
                        if (!preset)
                            throw new Error(t('orch.errNoPreset', { name: String(args.preset) }));
                        presetMode = resolveMode(preset.mode);
                        presetAgent = preset.agent || undefined;
                        presetSupervisorAgent = preset.supervisorAgent || undefined;
                        presetMergeInstructions = preset.mergeInstructions || undefined;
                        presetTasks = Array.isArray(preset.tasks) ? preset.tasks.slice() : [];
                        debugLog('info', 'orch.preset', '使用配方执行', { name: String(args.preset), tasks: presetTasks.length });
                    }
                    const rawTasks = Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks.slice() : (presetTasks || []);
                    const maxAgents = Math.max(1, Number(cfg.maxAgents) || 8);
                    const tasks = truncateTasks(rawTasks, maxAgents);
                    const provider = resolveProvider();
                    const mode = args.mode ? resolveMode(args.mode) : (presetMode || 'fanout');
                    const concurrency = resolveConcurrency(args.concurrency, cfg.concurrency, maxAgents);
                    const parent = exec.agent;
                    const signal = exec.signal;
                    const defaultDef = resolveAgentDef(args.agent) || resolveAgentDef(presetAgent);
                    const mergeInstructions = String(args.mergeInstructions !== undefined && args.mergeInstructions !== null ? args.mergeInstructions : (presetMergeInstructions !== undefined ? presetMergeInstructions : ''));
                    const { availableNames, unknown } = findUnknownAgents({ agent: args.agent || presetAgent, supervisorAgent: args.supervisorAgent || presetSupervisorAgent, reviewers: args.reviewers, tasks }, tasks, state.config.orch.agents || []);
                    if (unknown.length > 0)
                        throw new Error(t('orch.errUnknownAgent', {
                            names: unknown.map((n) => '"' + n + '"').join(', '),
                            available: availableNames.join(', ') || t('common.none'),
                        }));
                    const defFor = (tk) => resolveAgentDef(tk && tk.agent) || defaultDef;
                    // ---- 子智能体调用预算（budgetAgents）：防失控硬限制 ----
                    // 每次 runOne 调用（含重试/评审/合成）计 1；预算耗尽立即抛错中止整个编排。
                    const budgetAgents = Math.max(0, Math.min(128, Number(args.budgetAgents) || 0));
                    let budgetUsed = 0;
                    const runWithBudget = (fn) => {
                        if (budgetAgents > 0 && budgetUsed >= budgetAgents) {
                            const err = new Error(t('orch.errBudget', { n: budgetAgents }));
                            // 预算错误不参与任务级隔离：直接中止整个编排
                            err.isolate = false;
                            throw err;
                        }
                        budgetUsed += 1;
                        return fn();
                    };
                    const worker = (task, i) => runWithBudget(() => runOne(subagents, provider, task, '', parent, signal, defFor(task), runId));
                    // ---- resume 恢复：复用已完成子任务，只跑未完成部分 ----
                    let resumedFrom = '';
                    let resumePrevRec = null;
                    let resumeCompleted = [];
                    let resumeCarry = '';
                    let runTasks = tasks;
                    if (args.resume) {
                        const prevRec = (await readRunsFromDisk()).find((r) => r.runId === String(args.resume)) || state.runs.find((r) => r.runId === String(args.resume));
                        if (!prevRec)
                            throw new Error(t('orch.errNoRun', { runId: String(args.resume) }));
                        resumedFrom = prevRec.runId;
                        resumePrevRec = prevRec;
                        resumeCompleted = prevRec.runs.filter((r) => r.status === 'completed');
                        const completed = new Set(resumeCompleted.map((r) => r.id));
                        if (mode === 'pipeline') {
                            // 流水线：从未完成阶段续跑，carry 拼接已完成输出
                            resumeCarry = resumeCompleted.map((r) => r.output || '').filter(Boolean).join('\n\n');
                            const pendingIdx = prevRec.tasks.findIndex((tk) => !completed.has(tk.id || tk.label));
                            runTasks = pendingIdx >= 0 ? prevRec.tasks.slice(pendingIdx).map((tk) => ({ id: tk.id, label: tk.label, prompt: tk.prompt })) : [];
                            // 兼容旧记录（tasks 无 prompt）：无法恢复则报错
                            if (runTasks.length > 0 && !runTasks.some((tk) => tk.prompt)) {
                                throw new Error(t('orch.errNoResumeData', { runId: String(args.resume) }));
                            }
                        }
                        else {
                            runTasks = tasks.filter((tk) => !completed.has(tk.id || tk.label || 'task'));
                        }
                        if (runTasks.length === 0)
                            throw new Error(t('orch.errRunDone', { runId: String(args.resume) }));
                        debugLog('info', 'orch.resume', '恢复 run', { from: resumedFrom, pending: runTasks.length });
                    }
                    if (runTasks.length === 0)
                        throw new Error(t('orch.errNoTasks'));
                    debugLog('info', 'orch.start', 'orchestrate 调用', { agent: String(exec.agent.id || ''), mode, tasks: runTasks.length, concurrency, provider, defaultAgent: args.agent || '' });
                    emitOrchEvent('orch/run-start', { runId, mode, agent: String(exec.agent.id || ''), resumedFrom: resumedFrom || undefined, tasks: runTasks.map((tk) => ({ id: tk.id || '', label: tk.label || '' })), at: startedAt });
                    let runs = [];
                    let summary = '';
                    if (mode === 'pipeline') {
                        // pipeline 阶段隔离：单阶段失败按 stageRetry 重试，仍失败则标记 error 并中止后续阶段
                        const stageRetry = Math.max(0, Math.min(5, Number(cfg.stageRetry) || 0));
                        let carry = resumeCarry;
                        let stageFailed = '';
                        for (let i = 0; i < runTasks.length; i += 1) {
                            if (signal.aborted)
                                break;
                            let r = null;
                            let attempt = 0;
                            while (true) {
                                try {
                                    r = await runWithBudget(() => runOne(subagents, provider, runTasks[i], carry, parent, signal, defFor(runTasks[i]), runId));
                                    break;
                                }
                                catch (e) {
                                    // 预算等不隔离错误直接中止（不进入阶段重试）
                                    if (e && e.isolate === false)
                                        throw e;
                                    attempt += 1;
                                    if (attempt > stageRetry) {
                                        stageFailed = String((e && e.message) || e);
                                        const stageDef = defFor(runTasks[i]);
                                        r = {
                                            id: String(runTasks[i].id || runTasks[i].label || 'task'),
                                            label: String(runTasks[i].label || ''),
                                            agent: (stageDef && stageDef.name) || '',
                                            status: 'error',
                                            output: stageFailed,
                                        };
                                        break;
                                    }
                                    debugLog('warn', 'orch.pipeline.retry', 'pipeline 阶段重试', { task: runTasks[i].id || runTasks[i].label, attempt });
                                }
                            }
                            const rFinal = r;
                            runs.push(rFinal);
                            if (rFinal.status === 'error')
                                break;
                            // 结构化中间产物（轻量）：阶段标记 + 任务标识 + 输出
                            carry = appendPipelineCarry(carry, pipelineStageBlock(i, rFinal.id, rFinal.output));
                        }
                        summary = stageFailed
                            ? t('orch.sumPipelineFailed', { out: carry || t('orch.sumNoOutput'), reason: stageFailed })
                            : t('orch.sumPipeline', { out: carry || t('orch.sumNoOutput') });
                    }
                    else if (mode === 'supervisor') {
                        runs = await poolRun(runTasks, concurrency, worker);
                        const merged = summarize(runs.concat(resumeCompleted));
                        const instruction = String(mergeInstructions || t('orch.mergeDefault'));
                        const supDef = resolveAgentDef(args.supervisorAgent) || resolveAgentDef(presetSupervisorAgent) || defaultDef;
                        const reviewers = Array.isArray(args.reviewers) ? args.reviewers.filter((n) => !!n).map((n) => String(n)) : [];
                        // 多评审者：并行评审（各自独立 agent），输出并入综合上下文
                        let reviewContext = merged;
                        if (reviewers.length > 0) {
                            const reviewTasks = reviewers.map((name, idx) => ({
                                id: 'reviewer-' + (idx + 1),
                                label: name,
                                agent: name,
                                prompt: buildSupervisorPrompt(instruction, merged, t('orch.outputSeparator')),
                            }));
                            const reviewerRuns = await poolRun(reviewTasks, Math.max(1, reviewers.length), (tk, i) => runWithBudget(() => runOne(subagents, provider, tk, '', parent, signal, defFor(tk), runId)));
                            runs = runs.concat(reviewerRuns);
                            reviewContext = appendPipelineCarry(merged, reviewerRuns.map((r) => pipelineStageBlock(0, r.label, r.output)).join('\n\n'));
                        }
                        // 评审轮次：每轮以上一轮输出为上下文重新评审（reviewRounds 1..3）
                        const reviewRounds = Math.max(1, Math.min(3, Number(args.reviewRounds) || 1));
                        let prevOut = '';
                        for (let round = 1; round <= reviewRounds; round += 1) {
                            const roundPrompt = buildSupervisorPrompt(instruction, round === 1 ? reviewContext : appendPipelineCarry(prevOut, reviewContext), t('orch.outputSeparator'));
                            const sup = await runWithBudget(() => runOne(subagents, provider, { id: 'supervisor', label: 'supervisor' + (reviewRounds > 1 ? '#' + round : ''), prompt: roundPrompt }, '', parent, signal, supDef, runId));
                            runs = runs.concat([sup]);
                            prevOut = sup.output || '';
                        }
                        summary = t('orch.sumSupervisor', { out: prevOut || t('orch.sumNoOutput') });
                    }
                    else if (mode === 'map-reduce') {
                        // map-reduce：并行拆分执行 + 归约任务（无监督者 agent，用默认 agent 归约）
                        runs = await poolRun(runTasks, concurrency, worker);
                        const merged = summarize(runs.concat(resumeCompleted));
                        const instruction = String(mergeInstructions || t('orch.mergeDefault'));
                        const reducePrompt = buildSupervisorPrompt(instruction, merged, t('orch.outputSeparator'));
                        const rr = await runWithBudget(() => runOne(subagents, provider, { id: 'reduce', label: 'reduce', prompt: reducePrompt }, '', parent, signal, defaultDef, runId));
                        runs = runs.concat([rr]);
                        summary = t('orch.sumMerged', { out: rr.output || t('orch.sumNoOutput') });
                    }
                    else if (mode === 'router') {
                        // router：从候选任务中路由选择最合适的一项执行（单次调用）
                        const instruction = String(mergeInstructions || t('orch.routerDefault'));
                        const list = runTasks.map((tk, i) => (i + 1) + '. [' + (tk.label || tk.id || 'task') + '] ' + tk.prompt).join('\n');
                        const rt = await runWithBudget(() => runOne(subagents, provider, { id: 'router', label: 'router', prompt: instruction + '\n\n' + list }, '', parent, signal, defaultDef, runId));
                        runs = [rt];
                        summary = t('orch.sumRouter', { out: rt.output || t('orch.sumNoOutput') });
                    }
                    else {
                        runs = await poolRun(runTasks, concurrency, worker);
                        // fanout 可选合并：mergeInstructions 存在时追加一次合成任务
                        if (mergeInstructions) {
                            const merged = summarize(runs.concat(resumeCompleted));
                            const instruction = String(mergeInstructions);
                            const mergePrompt = buildSupervisorPrompt(instruction, merged, t('orch.outputSeparator'));
                            const mr = await runWithBudget(() => runOne(subagents, provider, { id: 'merge', label: 'merge', prompt: mergePrompt }, '', parent, signal, defaultDef, runId));
                            runs = runs.concat([mr]);
                            summary = t('orch.sumMerged', { out: mr.output || t('orch.sumNoOutput') });
                        }
                        else {
                            summary = summarize(runs.concat(resumeCompleted));
                        }
                    }
                    // resume 语义：合并已完成（原记录）与新执行结果，按原任务顺序排列
                    let finalRuns = normalizeFinalRuns(runs);
                    let recordTasks = runTasks.map((tk) => ({ id: tk.id || '', label: tk.label || '', agent: (defFor(tk) || {}).name || '', prompt: tk.prompt || '' }));
                    if (resumePrevRec) {
                        const byId = new Map();
                        for (const r of resumeCompleted)
                            byId.set(r.id, r);
                        for (const r of finalRuns)
                            byId.set(r.id, r);
                        const ordered = [];
                        for (const tk of resumePrevRec.tasks) {
                            const run = byId.get(tk.id || tk.label || 'task');
                            if (run && !ordered.some((x) => x.id === run.id))
                                ordered.push(run);
                        }
                        for (const r of byId.values())
                            if (!ordered.some((x) => x.id === r.id))
                                ordered.push(r);
                        finalRuns = normalizeFinalRuns(ordered);
                        recordTasks = resumePrevRec.tasks;
                    }
                    debugLog('info', 'orch.done', 'orchestrate 完成', { mode, runs: finalRuns.length, aborted: signal.aborted });
                    const rec = {
                        runId,
                        mode,
                        agent: String(exec.agent.id || ''),
                        provider,
                        concurrency,
                        startedAt,
                        finishedAt: new Date().toISOString(),
                        durationMs: Date.now() - startedMs,
                        aborted: signal.aborted,
                        resumedFrom: resumedFrom || undefined,
                        tasks: recordTasks,
                        runs: finalRuns,
                        summary: String(summary || ''),
                    };
                    recordRun(rec);
                    emitOrchEvent('orch/run-end', {
                        runId,
                        mode,
                        summary: rec.summary,
                        runs: finalRuns.map((r) => ({ id: r.id, label: r.label, status: r.status })),
                        aborted: rec.aborted,
                        durationMs: rec.durationMs,
                        at: rec.finishedAt,
                    });
                    return { summary: rec.summary, runs: finalRuns, runId };
                }
                catch (e) {
                    debugLog('error', 'orch.error', 'orchestrate 执行失败', { message: String((e && e.message) || e) });
                    // 失败也留痕（run 记录 + 事件），保证可观测
                    const failedRec = {
                        runId,
                        mode: args.mode ? resolveMode(args.mode) : 'fanout',
                        agent: String((exec && exec.agent && exec.agent.id) || ''),
                        provider: '',
                        concurrency: 0,
                        startedAt,
                        finishedAt: new Date().toISOString(),
                        durationMs: Date.now() - startedMs,
                        aborted: !!(exec && exec.signal && exec.signal.aborted),
                        tasks: Array.isArray(args.tasks) ? args.tasks.map((tk) => ({ id: tk.id || '', label: tk.label || '', agent: tk.agent || '', prompt: tk.prompt || '' })) : [],
                        runs: [],
                        summary: String((e && e.message) || e),
                    };
                    recordRun(failedRec);
                    emitOrchEvent('orch/run-end', { runId, mode: failedRec.mode, summary: failedRec.summary, runs: [], aborted: failedRec.aborted, durationMs: failedRec.durationMs, at: failedRec.finishedAt, error: true });
                    throw e;
                }
                finally {
                    if (slotHeld)
                        releaseOrchSlot();
                }
            },
        });
    }
    // list-subagents：按需查询可用自定义子智能体清单（名称/provider/模型/描述）。
    // 清单不再每轮注入系统提示词，模型需要时调用本工具获取（上下文按需加载）。
    function buildListSubagentsTool() {
        return defineTool({
            name: 'list-subagents',
            description: t('orch.toolListSubagents'),
            parameters: {},
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        agents: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    name: { type: 'string', required: true },
                                    provider: { type: 'string' },
                                    model: { type: 'string' },
                                    description: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                render(args, value) {
                    const v = value || {};
                    const agents = v.agents || [];
                    if (!Array.isArray(agents) || agents.length === 0) {
                        return [{ type: 'text', text: t('common.none') }];
                    }
                    const lines = agents.map((a) => {
                        const model = (a.provider ? a.provider + '/' : '') + (a.model || t('common.defaultModel'));
                        return '- ' + a.name + ' (' + model + ')' + (a.description ? ': ' + a.description : '');
                    });
                    return [{ type: 'text', text: t('orch.rosterHead') + '\n' + lines.join('\n') }];
                },
            },
            async execute() {
                debugLog('debug', 'orch.list', 'list-subagents 调用', { count: (state.config.orch.agents || []).length });
                const agents = (state.config.orch.agents || [])
                    .filter((a) => a && a.name)
                    .map((a) => ({
                    name: String(a.name),
                    provider: String(a.provider || ''),
                    model: String(a.model || ''),
                    description: String(a.description || ''),
                }));
                return { agents };
            },
        });
    }
    // 静态注册：工具注册在插件自己的 ctx（全局可见，所有会话的 agent 都能调用）。
    // Cordis 管理行生命周期 —— 卸载/更新时自动 dispose，不会有残留注册（zombie）。
    // orchestrate：自动编排；list-subagents：按需查询可用自定义子智能体清单。
    let toolDisposes = [];
    function installTools() {
        for (const d of toolDisposes) {
            try {
                d();
            }
            catch (e) { /* ignore */ }
        }
        toolDisposes = [
            ctx.tools.register(buildOrchestrateTool()),
            ctx.tools.register(buildListSubagentsTool()),
        ];
        orchestrateReady = true;
    }
    installTools();
    ctx.effect(() => () => {
        for (const d of toolDisposes) {
            try {
                d();
            }
            catch (e) { /* ignore */ }
        }
    });
    // 配置页改了自定义子智能体列表 / 语言切换后重建工具（description 含最新清单与当前语言）
    function reinstallTools() {
        installTools();
    }
    // ================= 上下文注入（systemPrompt 段落） =================
    // 向系统提示词注入一段插件上下文。开关在系统卡片（config.ctx.enabled）：
    //   - 开启：注入内容 = 用户自定义上下文 config.ctx.text（原文，不翻译）；
    //     留空则回退注入默认的自动编排引导（orch.hintSection，编排启用时），
    //     让模型在适合并行拆解/多阶段/评审把关的任务上自动调用 orchestrate，
    //     无需用户显式说“使用 ha-orchestrator”。
    //   - 关闭：整段为空（组装器丢弃），模型不获得任何插件上下文。
    // text 为函数：每次组装时求值，跟随当前语言与最新配置。
    // 段落 order 取 40：紧随部署 persona（0）之后、plan-mode（50）与工具引导
    // （100–199）之前，保证自动编排引导处于提示词最醒目位置（原 500 沉底，
    // 模型几乎注意不到，是“从不自动触发编排”的主因之一）。
    // 默认引导文本自带【ha-orchestrator 插件上下文】标记，便于在轨迹里检索验证。
    // 注入状态（注册与否/最近一次求值）写入 injectionStatus，经 stateGet 暴露
    // 给设置页「系统」卡片实时展示，无需开启调试模式即可验证。
    // 注册失败不再静默：console 可见 + 定时重试（30 次，2s 间隔，兜底其它部署）。
    let contextInjectDispose = null;
    let contextInjectRetries = 0;
    const injectionStatus = { registered: false, order: 40, reason: '', lastEval: null };
    function injectionStatusSnapshot() {
        return {
            registered: !!injectionStatus.registered,
            order: injectionStatus.order,
            reason: String(injectionStatus.reason || ''),
            lastEval: injectionStatus.lastEval ? { ...injectionStatus.lastEval } : null,
        };
    }
    function installContextInjection() {
        try {
            if (contextInjectDispose) {
                contextInjectDispose();
                contextInjectDispose = null;
            }
        }
        catch (e) { /* ignore */ }
        const sp = getService(ctx, 'systemPrompt');
        if (!sp || typeof sp.section !== 'function') {
            injectionStatus.registered = false;
            injectionStatus.reason = 'systemPrompt 服务不可用';
            console.warn('[ha] context injection: systemPrompt service unavailable (attempt ' + (contextInjectRetries + 1) + '/30), retrying in 2s');
            debugLog('warn', 'ctx.inject.unavailable', 'systemPrompt 服务不可用，上下文注入未注册', { hasService: !!sp });
            scheduleContextInjectionRetry();
            return;
        }
        try {
            contextInjectDispose = sp.section({
                name: 'ha-orchestrator:context',
                order: 40,
                text: () => {
                    const ctxCfg = state.config && state.config.ctx;
                    if (!ctxCfg || !ctxCfg.enabled) {
                        injectionStatus.lastEval = { mode: 'off', chars: 0 };
                        debugLog('debug', 'ctx.inject.eval', '上下文注入求值：已关闭，不注入', { enabled: false });
                        return '';
                    }
                    const custom = String(ctxCfg.text || '').trim();
                    if (custom) {
                        injectionStatus.lastEval = { mode: 'custom', chars: custom.length };
                        debugLog('debug', 'ctx.inject.eval', '上下文注入求值：自定义内容', { enabled: true, mode: 'custom', chars: custom.length });
                        return custom;
                    }
                    const orch = state.config && state.config.orch;
                    if (orch && orch.enabled) {
                        const hint = t('orch.hintSection');
                        injectionStatus.lastEval = { mode: 'default', chars: hint.length };
                        debugLog('debug', 'ctx.inject.eval', '上下文注入求值：默认自动编排引导', { enabled: true, mode: 'fallback', language: langState.active });
                        return hint;
                    }
                    injectionStatus.lastEval = { mode: 'empty', chars: 0 };
                    debugLog('debug', 'ctx.inject.eval', '上下文注入求值：无可用内容', { enabled: true, mode: 'empty' });
                    return '';
                },
            });
            injectionStatus.registered = true;
            injectionStatus.reason = '';
            contextInjectRetries = 0;
            console.log('[ha] context injection registered: section "ha-orchestrator:context" (order 40)');
            debugLog('info', 'ctx.inject.install', '上下文注入段落已注册', { section: 'ha-orchestrator:context', order: 40 });
        }
        catch (e) {
            injectionStatus.registered = false;
            injectionStatus.reason = '注册失败：' + String((e && e.message) || e);
            console.error('[ha] install systemPrompt context injection failed', e);
            debugLog('error', 'ctx.inject.install.failed', '上下文注入段落注册失败', { error: String((e && e.message) || e) });
        }
    }
    function scheduleContextInjectionRetry() {
        if (contextInjectRetries >= 30) {
            console.error('[ha] context injection: giving up after 30 attempts (systemPrompt service never appeared)');
            return;
        }
        contextInjectRetries += 1;
        const timer = getService(ctx, 'timer');
        if (!timer || typeof timer.timeout !== 'function')
            return;
        try {
            timer.timeout(() => installContextInjection(), 2000);
        }
        catch (e) { /* ignore */ }
    }
    installContextInjection();
    ctx.effect(() => () => {
        try {
            if (contextInjectDispose)
                contextInjectDispose();
        }
        catch (e) { /* ignore */ }
    });
    // ================= /ha 命令（可观测性） =================
    // 查看 HA 状态 / 重置 / 手动探测。commands 服务懒注册（带重试），不加入
    // inject：部分部署可能没有该服务，插件不应因此加载失败。
    let haCommandDispose = null;
    let haCommandRetries = 0;
    const HA_COMMAND_MAX_RETRIES = 30;
    function installHaCommand() {
        try {
            if (haCommandDispose) {
                haCommandDispose();
                haCommandDispose = null;
            }
        }
        catch (e) { /* ignore */ }
        const commands = getService(ctx, 'commands');
        if (!commands || typeof commands.register !== 'function') {
            console.warn('[ha] /ha command: commands service unavailable (attempt ' + (haCommandRetries + 1) + '/30), retrying in 2s');
            scheduleHaCommandRetry();
            return;
        }
        try {
            haCommandDispose = commands.register({
                name: 'ha',
                description: t('ha.cmdDesc'),
                input: { hint: '[status|diag|reset|probe <provider> <model>]' },
                handler: (invocation) => handleHaCommand(invocation),
            });
            haCommandRetries = 0;
            console.log('[ha] /ha command registered');
        }
        catch (e) {
            console.error('[ha] register /ha command failed', e);
            scheduleHaCommandRetry();
        }
    }
    function scheduleHaCommandRetry() {
        if (haCommandRetries >= HA_COMMAND_MAX_RETRIES)
            return;
        haCommandRetries += 1;
        const timer = getService(ctx, 'timer');
        if (!timer || typeof timer.timeout !== 'function')
            return;
        try {
            timer.timeout(() => installHaCommand(), 2000);
        }
        catch (e) { /* ignore */ }
    }
    function haStatusText() {
        clearExpired();
        const lines = [];
        const cfg = state.config.ha;
        lines.push(t('ha.statusHead') + ' [' + (cfg.enabled ? t('ha.statusEnabled') : t('ha.statusDisabled')) + ']');
        lines.push(t('ha.statusQuarantine', { n: state.quarantine.size }));
        if (state.quarantine.size > 0) {
            for (const [k, v] of state.quarantine) {
                const parts = splitKey(k);
                const remaining = Math.max(0, Math.round((v.until - now()) / 1000)) + 's';
                lines.push('  - ' + parts[0] + '/' + parts[1] + ' [' + (v.level || 'model') + '] ' + (v.code || '') + ' ' + remaining);
            }
        }
        lines.push(t('ha.statusFailures', { n: state.failures.size }));
        if (state.failures.size > 0) {
            for (const [k, v] of state.failures) {
                const parts = splitKey(k);
                lines.push('  - ' + parts[0] + '/' + parts[1] + ' x' + v.count);
            }
        }
        lines.push(t('ha.statusCursors', { n: state.perAgent.size }));
        lines.push(t('ha.statusHistory', { n: state.history.length }));
        if (state.history.length > 0) {
            for (const h of state.history.slice(-5)) {
                lines.push('  - ' + h.at.slice(11, 19) + ' ' + h.agent + ': ' + h.from + ' -> ' + h.to + (h.code ? ' (' + h.code + ')' : ''));
            }
        }
        lines.push(t('ha.statusProbes', { n: state.probeLog.length }));
        if (state.probeLog.length > 0) {
            for (const p of state.probeLog.slice(0, 3)) {
                lines.push('  - ' + p.at.slice(11, 19) + ' ' + p.key + ' ' + (p.ok ? 'ok' : 'fail' + (p.reason ? ' (' + p.reason + ')' : '')));
            }
        }
        return lines.join('\n');
    }
    async function haDiagText() {
        const lines = [t('diag.title')];
        // 服务可用性
        const svc = (name, present) => {
            const v = getService(ctx, name);
            return '  - ' + name + ': ' + (v != null ? t('diag.available') : t('diag.missing'));
        };
        for (const name of ['tools', 'systemPrompt', 'subagents', 'llm', 'fs', 'timer', 'settings', 'agents', 'agentDefaultModel', 'sandboxPolicy', 'commands', 'skills']) {
            lines.push(svc(name, true));
        }
        // 配置与持久化
        lines.push(t('diag.persist') + ': ' + (persistState.ok ? persistState.path : t('diag.persistFail') + (persistState.error ? ' (' + persistState.error + ')' : '')));
        lines.push(t('diag.configLoaded') + ': ' + (configLoaded ? t('diag.yes') : t('diag.no')));
        lines.push(t('diag.haState') + ': ' + (haStateLoaded ? t('diag.yes') : t('diag.no')));
        lines.push(t('diag.lang') + ': ' + langState.active + (langState.rollback ? ' (' + t('sys.rollbackEvent', { reason: langState.rollbackReason }) + ')' : ''));
        lines.push(t('diag.injection') + ': ' + (injectionStatus.registered ? t('diag.yes') : t('diag.no') + (injectionStatus.reason ? ' (' + injectionStatus.reason + ')' : '')));
        return lines.join('\n');
    }
    async function handleHaCommand(invocation) {
        try {
            const rest = String((invocation && invocation.input) || '').trim();
            const parts = rest.split(/\s+/).filter(Boolean);
            const verb = (parts[0] || 'status').toLowerCase();
            if (verb === 'reset' || verb === 'clear') {
                state.quarantine.clear();
                state.failures.clear();
                state.perAgent.clear();
                state.history = [];
                state.probeLog = [];
                scheduleHaPersist();
                debugLog('info', 'ha.cmd.reset', '/ha reset 已执行');
                return { kind: 'success', text: t('ha.resetDone') };
            }
            if (verb === 'probe') {
                const provider = parts[1] || '';
                const model = parts[2] || '';
                if (!provider || !model)
                    return { kind: 'error', text: t('ha.probeUsage') };
                const res = await runProbe(keyOf(provider, model));
                return {
                    kind: 'success',
                    text: res.ok
                        ? t('ha.probeOk', { provider, model })
                        : t('ha.probeFail', { provider, model, reason: res.reason || '' }),
                };
            }
            if (verb === 'diag') {
                return { kind: 'success', text: await haDiagText() };
            }
            return { kind: 'success', text: haStatusText() };
        }
        catch (e) {
            return { kind: 'error', text: String((e && e.message) || e) };
        }
    }
    installHaCommand();
    ctx.effect(() => () => {
        try {
            if (haCommandDispose)
                haCommandDispose();
        }
        catch (e) { /* ignore */ }
    });
    // ================= 随包 Skill（使用/排障指引） =================
    // 经 ctx.skills.register 注册运行时技能（模型/用户均可调用，随插件卸载）。
    // skills 服务缺失（部分部署）时静默跳过，不影响插件其它能力。
    let skillDispose = null;
    function installHaSkill() {
        try {
            if (skillDispose) {
                skillDispose();
                skillDispose = null;
            }
        }
        catch (e) { /* ignore */ }
        const skills = getService(ctx, 'skills');
        if (!skills || typeof skills.register !== 'function') {
            console.warn('[ha] skill: skills service unavailable, skip');
            return;
        }
        try {
            skillDispose = skills.register({
                name: 'ha-orchestrator',
                source: 'bundled',
                description: t('skill.desc'),
                whenToUse: t('skill.whenToUse'),
                content: t('skill.body'),
            });
            skillRegistered = true;
            console.log('[ha] skill registered: ha-orchestrator');
        }
        catch (e) {
            console.error('[ha] register skill failed', e);
        }
    }
    // 语言变化后重建 skill（正文为当前语言 markdown）
    function reinstallSkill() {
        installHaSkill();
    }
    installHaSkill();
    ctx.effect(() => () => {
        try {
            if (skillDispose)
                skillDispose();
        }
        catch (e) { /* ignore */ }
    });
    // ================= /orchestrate 命令（run 可观测） =================
    // /orchestrate runs：最近 run 列表；/orchestrate show <runId>：run 详情。
    let orchCommandDispose = null;
    let orchCommandRetries = 0;
    const ORCH_COMMAND_MAX_RETRIES = 30;
    function installOrchCommand() {
        try {
            if (orchCommandDispose) {
                orchCommandDispose();
                orchCommandDispose = null;
            }
        }
        catch (e) { /* ignore */ }
        const commands = getService(ctx, 'commands');
        if (!commands || typeof commands.register !== 'function') {
            console.warn('[ha] /orchestrate command: commands service unavailable (attempt ' + (orchCommandRetries + 1) + '/30), retrying in 2s');
            scheduleOrchCommandRetry();
            return;
        }
        try {
            orchCommandDispose = commands.register({
                name: 'orchestrate',
                description: t('orch.cmdDesc'),
                input: { hint: '[runs|show <runId>|presets]' },
                handler: (invocation) => handleOrchCommand(invocation),
            });
            orchCommandRetries = 0;
            console.log('[ha] /orchestrate command registered');
        }
        catch (e) {
            console.error('[ha] register /orchestrate command failed', e);
            scheduleOrchCommandRetry();
        }
    }
    function scheduleOrchCommandRetry() {
        if (orchCommandRetries >= ORCH_COMMAND_MAX_RETRIES)
            return;
        orchCommandRetries += 1;
        const timer = getService(ctx, 'timer');
        if (!timer || typeof timer.timeout !== 'function')
            return;
        try {
            timer.timeout(() => installOrchCommand(), 2000);
        }
        catch (e) { /* ignore */ }
    }
    async function handleOrchCommand(invocation) {
        try {
            const parts = String((invocation && invocation.input) || '').trim().split(/\s+/).filter(Boolean);
            const verb = (parts[0] || 'runs').toLowerCase();
            const all = await readRunsFromDisk();
            if (verb === 'presets') {
                const presets = state.config.orch.presets || [];
                if (presets.length === 0)
                    return { kind: 'success', text: t('orch.presetNone') };
                const lines = [t('orch.presetsHead', { n: presets.length })];
                for (const p of presets) {
                    lines.push('- ' + p.name + ' [' + p.mode + '] tasks=' + (p.tasks || []).length + (p.agent ? ' agent=' + p.agent : ''));
                }
                return { kind: 'success', text: lines.join('\n') };
            }
            if (verb === 'show') {
                const runId = parts[1] || '';
                const rec = all.find((r) => r.runId === runId) || state.runs.find((r) => r.runId === runId);
                if (!rec)
                    return { kind: 'error', text: t('orch.runNotFound', { runId }) };
                const lines = [
                    t('orch.showHead') + ' ' + rec.runId,
                    'mode: ' + rec.mode + ' | agent: ' + rec.agent + ' | provider: ' + (rec.provider || '-'),
                    'tasks: ' + rec.tasks.length + ' | runs: ' + rec.runs.length + ' | duration: ' + (rec.durationMs != null ? rec.durationMs + 'ms' : '-') + (rec.aborted ? ' | aborted' : ''),
                ];
                for (const r of rec.runs) {
                    const head = '- [' + r.status + '] ' + (r.label || r.id) + (r.agent ? ' via ' + r.agent : '');
                    const body = String(r.output || '').slice(0, 500);
                    lines.push(head + (body ? '\n  ' + body : ''));
                }
                lines.push('---\n' + String(rec.summary || '').slice(0, 800));
                return { kind: 'success', text: lines.join('\n') };
            }
            // runs：最近 10 条
            if (all.length === 0)
                return { kind: 'success', text: t('orch.runNone') };
            const lines = [t('orch.runsHead', { n: Math.min(all.length, 10) })];
            for (const r of all.slice(0, 10)) {
                const ok = r.runs.every((x) => x.status !== 'error');
                lines.push('- ' + r.runId + ' [' + r.mode + (r.aborted ? ',aborted' : '') + '] ' + r.startedAt.slice(0, 19).replace('T', ' ') + ' ' + r.runs.length + ' tasks ' + (ok ? 'ok' : 'has-errors'));
            }
            return { kind: 'success', text: lines.join('\n') };
        }
        catch (e) {
            return { kind: 'error', text: String((e && e.message) || e) };
        }
    }
    installOrchCommand();
    ctx.effect(() => () => {
        try {
            if (orchCommandDispose)
                orchCommandDispose();
        }
        catch (e) { /* ignore */ }
    });
    ctx.on('settings/updated', (ns) => {
        if (ns !== 'locale')
            return;
        const mode = state.config.lang && state.config.lang.mode;
        if (mode === undefined || mode === 'auto') {
            maybeRefreshLanguage().catch((e) => console.error('[ha] follow DSH locale failed', e));
        }
    });
    // ================= 配置页 RPC（Remote 服务，client 经 ctx.remote.haOrchestrator 调用） =================
    // 把 sanitize 后的配置节应用到运行态（stateSet / stateImport 共用）
    async function applyConfigNext(next) {
        const agentsChanged = next.orch && next.orch.agents !== undefined;
        const langChanged = next.lang !== undefined;
        const backupsChanged = next.ha
            ? JSON.stringify(next.ha.backups) !== JSON.stringify((state.config.ha || {}).backups)
            : false;
        for (const key of Object.keys(next)) {
            state.config[key] = next[key];
        }
        if (backupsChanged) {
            state.quarantine.clear();
            state.failures.clear();
            state.perAgent.clear();
        }
        providerCache = null;
        await persistConfig();
        // 自定义子智能体清单变化 -> 重建工具（orchestrate / list-subagents 描述与查询提示随之更新）
        if (agentsChanged)
            reinstallTools();
        // 插件语言变化 -> 重新应用语言（失败自动回滚 zh），工具文案随之重建
        if (langChanged)
            await applyLanguage().catch((e) => console.error('[ha] apply language failed', e));
    }
    function buildState(extra) {
        clearExpired();
        const out = {
            config: state.config,
            quarantine: [],
            history: state.history.slice(-20).reverse(),
            persist: persistState,
            i18n: i18nSnapshot(),
            ctxInject: injectionStatusSnapshot(),
        };
        for (const [k, v] of state.quarantine) {
            const parts = splitKey(k);
            out.quarantine.push({ provider: parts[0], model: parts[1], code: v.code, remainingMs: Math.max(0, v.until - now()) });
        }
        if (extra)
            for (const key of Object.keys(extra))
                out[key] = extra[key];
        return out;
    }
    function llmProviderList() {
        let llmProviders = [];
        try {
            const llm = getService(ctx, 'llm');
            if (llm) {
                llmProviders = llm.listProviders().map((p) => ({
                    provider: String((p && p.id) || p.provider || p.name || p),
                    name: String((p && p.name) || p.id || p.provider || p),
                }));
            }
        }
        catch (e) {
            llmProviders = [];
        }
        return llmProviders;
    }
    function subagentList() {
        const subagents = getService(ctx, 'subagents');
        return subagents ? subagents.list() : [];
    }
    // ================= 智能新增子智能体（agents.generate） =================
    function parseAgentJson(text) {
        let body = String(text || '').trim();
        const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fence)
            body = fence[1].trim();
        const start = body.indexOf('{');
        const end = body.lastIndexOf('}');
        if (start >= 0 && end > start)
            body = body.slice(start, end + 1);
        try {
            return JSON.parse(body);
        }
        catch (e) {
            return null;
        }
    }
    function uniqueAgentName(name) {
        let base = String(name || '').trim();
        if (!base)
            base = 'generated';
        const existing = new Set((state.config.orch.agents || []).map((a) => a && a.name));
        if (!existing.has(base))
            return base;
        let i = 2;
        while (existing.has(base + ' ' + i))
            i += 1;
        return base + ' ' + i;
    }
    async function generateAgent(requirementRaw) {
        const requirement = requirementRaw && String(requirementRaw).trim() ? String(requirementRaw).trim() : '';
        if (!requirement)
            throw new Error(t('agents.errRequire'));
        const subagents = getService(ctx, 'subagents');
        if (!subagents)
            throw new Error(t('orch.errNoService'));
        const provider = resolveProvider();
        const agentsSvc = getService(ctx, 'agents');
        const parent = (agentsSvc && ((agentsSvc.currentInitiator ? agentsSvc.currentInitiator() : null) || agentsSvc.list()[0])) || null;
        if (!parent)
            throw new Error(t('agents.errNoAgent'));
        const sel = currentDefaultSelection();
        const modelHint = sel && sel.provider && sel.model
            ? t('agents.genModelHint', { model: sel.provider + '/' + sel.model })
            : '';
        let providers = [];
        try {
            const llm = getService(ctx, 'llm');
            if (llm)
                providers = llm.listProviders().map((p) => String((p && p.id) || p.provider || p.name || p));
        }
        catch (e) {
            providers = [];
        }
        const prompt = t('agents.genIntro') + requirement + t('agents.genSuffix') +
            '{ ' + t('agents.genFieldName') + ', ' +
            t('agents.genFieldProvider', { providers: providers.join(', ') || t('common.unknown') }) + ', ' +
            t('agents.genFieldModel') + ', ' +
            t('agents.genFieldDesc') + ', ' +
            t('agents.genFieldSp', { lang: t('agents.genLang') }) + ' }' + modelHint;
        const task = { id: 'gen-agent', label: 'generate', prompt };
        const def = sel && sel.provider && sel.model ? { name: '', provider: sel.provider, model: sel.model } : null;
        // RPC 路径没有工具运行时提供的 signal，而 subagent 提供方（in-process driver）
        // 无条件读取 request.signal.aborted，必须传真实 AbortSignal。
        // 借用 agent.runMaintenance 的维护信号：会话空闲时可用，agent 被取消时自动中断子智能体。
        let run;
        if (typeof parent.runMaintenance !== 'function') {
            throw new Error('运行时不支持 runMaintenance，无法生成子智能体');
        }
        try {
            run = await parent.runMaintenance((signal) => runOne(subagents, provider, task, '', parent, signal, def));
        }
        catch (e) {
            const busyMsg = String((e && e.message) || e);
            if (busyMsg.indexOf('already has active work') >= 0) {
                throw new Error(t('agents.errBusy'));
            }
            throw e;
        }
        if (!run.output || run.status === 'max-tokens' || run.status === 'error') {
            throw new Error(t('agents.errGenFailed', { status: run.status }));
        }
        const parsed = parseAgentJson(run.output);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error(t('agents.errParse', { out: String(run.output || '').slice(0, 300) }));
        }
        return {
            agent: {
                name: uniqueAgentName(String(parsed.name || '')),
                provider: String(parsed.provider || ''),
                model: String(parsed.model || ''),
                description: String(parsed.description || ''),
                systemPrompt: String(parsed.systemPrompt || ''),
            },
        };
    }
    // ---- Remote RPC 服务（client: ctx.remote.haOrchestrator.<method>） ----
    const remoteInitializers = [];
    class HaOrchestratorRpc extends TypertRemoteService {
        constructor() {
            super(ctx, 'haOrchestrator');
            runInitializers(this, remoteInitializers);
        }
        async stateGet() {
            // auto 模式下惰性跟随：settings 服务/`locale` 命名空间可能晚于本插件就绪
            await maybeRefreshLanguage().catch(() => { });
            // 启动时若因服务未就绪没读到配置，这里补一次加载；设置页轮询会自动带上 executor。
            await ensureConfigLoaded().catch(() => { });
            return buildState({
                subagents: subagentList(),
                llmProviders: llmProviderList(),
                defaultSelection: currentDefaultSelection(),
            });
        }
        // 重新加载：从磁盘重新读取持久化配置并应用（含语言跟随/工具重建），返回最新状态
        async stateReload() {
            try {
                await loadPersistedConfig();
            }
            catch (e) {
                console.error('[ha] stateReload loadPersistedConfig failed', e);
            }
            await applyLanguage().catch((e) => console.error('[ha] stateReload applyLanguage failed', e));
            debugLog('info', 'rpc.stateReload', '配置已从磁盘重新加载');
            return buildState({
                subagents: subagentList(),
                llmProviders: llmProviderList(),
                defaultSelection: currentDefaultSelection(),
            });
        }
        async stateSet(args) {
            const patch = args && args.patch;
            const next = sanitizeConfig(patch, state.config);
            await applyConfigNext(next);
            debugLog('info', 'rpc.stateSet', '配置已更新', {
                ha: patch && patch.ha ? Object.keys(patch.ha) : undefined,
                orch: patch && patch.orch ? Object.keys(patch.orch) : undefined,
                debug: patch && patch.debug ? patch.debug : undefined,
                lang: patch && patch.lang ? patch.lang : undefined,
                ctx: patch && patch.ctx ? patch.ctx : undefined,
            });
            if (patch && patch.ctx && typeof patch.ctx === 'object') {
                debugLog('info', 'ctx.inject.config', '上下文注入配置已更新', {
                    enabled: state.config.ctx.enabled,
                    textChars: String(state.config.ctx.text || '').length,
                });
            }
            return buildState({
                subagents: subagentList(),
                llmProviders: [],
                defaultSelection: currentDefaultSelection(),
            });
        }
        // 一键导出：完整配置 JSON 文本
        stateExport() {
            return { json: JSON.stringify(state.config, null, 2) };
        }
        // 一键导入：整体替换配置（缺失节回退默认），与 stateSet 相同的落盘/工具重建语义
        async stateImport(args) {
            const json = args && args.json ? String(args.json) : '';
            const parsed = parseConfigJson(json);
            if (!parsed)
                throw new Error(t('sys.importInvalid'));
            const next = sanitizeConfig(parsed, defaultConfig);
            if (Object.keys(next).length === 0)
                throw new Error(t('sys.importInvalid'));
            await applyConfigNext(next);
            debugLog('info', 'rpc.stateImport', '配置已整体导入', { jsonChars: json.length });
            return buildState({
                subagents: subagentList(),
                llmProviders: [],
                defaultSelection: currentDefaultSelection(),
            });
        }
        async modelsList(args) {
            const provider = args && args.provider ? String(args.provider) : '';
            if (!provider)
                return [];
            const llm = getService(ctx, 'llm');
            if (!llm)
                return [];
            try {
                const infos = await llm.listModels(provider);
                return (infos || []).map((m) => ({
                    provider: String(m.provider || provider),
                    model: String(m.id || m.model || m.name || m),
                    name: String(m.name || m.id || m.model || m),
                }));
            }
            catch (e) {
                return [];
            }
        }
        agentsGenerate(args) {
            debugLog('info', 'orch.generate', '智能生成子智能体', { requirement: String((args && args.requirement) || '').slice(0, 100) });
            return generateAgent(args && args.requirement);
        }
        haReset() {
            state.quarantine.clear();
            state.failures.clear();
            state.perAgent.clear();
            state.history = [];
            state.probeLog = [];
            scheduleHaPersist();
            debugLog('info', 'ha.reset', '清除隔离、失败计数与历史');
            return buildState({});
        }
        // HA 运行态详情：隔离（含层级）/失败计数/游标/历史/探测记录
        haStatus() {
            clearExpired();
            const out = {
                enabled: state.config.ha.enabled,
                config: {
                    backups: state.config.ha.backups,
                    cooldownMs: state.config.ha.cooldownMs,
                    threshold: state.config.ha.threshold,
                    burstWindowMs: state.config.ha.burstWindowMs,
                    providerThreshold: state.config.ha.providerThreshold,
                    probeEnabled: state.config.ha.probeEnabled,
                    degradeContextWindow: state.config.ha.degradeContextWindow,
                    codes: state.config.ha.codes,
                },
                quarantine: [],
                failures: [],
                cursors: [],
                history: state.history.slice(-20).reverse(),
                probes: { last: state.probeLog.slice(0, 20), pending: [] },
            };
            const tNow = now();
            for (const [k, v] of state.quarantine) {
                const parts = splitKey(k);
                out.quarantine.push({
                    provider: parts[0],
                    model: parts[1],
                    level: v.level || 'model',
                    code: v.code || '',
                    remainingMs: Math.max(0, v.until - tNow),
                });
                if (v.until > tNow)
                    out.probes.pending.push({ key: k, at: new Date(v.until).toISOString() });
            }
            for (const [k, v] of state.failures) {
                const parts = splitKey(k);
                out.failures.push({ provider: parts[0], model: parts[1], count: v.count, remainingMs: Math.max(0, v.until - tNow) });
            }
            for (const [agentId, e] of state.perAgent) {
                ;
                out.cursors.push({ agent: agentId, index: e.index || 0, lastKey: e.lastKey || '', retries: e.retries || 0, failCode: e.failCode || '', steeredTurn: e.steeredTurn || 0, degradeReasoning: !!e.degradeReasoning });
            }
            return out;
        }
        // 手动触发探测：隔离中的键 -> 成功后解除隔离；未隔离的键 -> 仅探测不改状态
        async haProbeNow(args) {
            const provider = args && args.provider ? String(args.provider) : '';
            const model = args && args.model ? String(args.model) : '';
            if (!provider || !model)
                throw new Error('haProbeNow: provider/model required');
            // force=true：手动探测无视冷却剩余时间，立即验证
            return runProbe(keyOf(provider, model), true);
        }
        // 推荐备份候选：从已注册 provider x 模型目录挑选（排除当前默认选择），供配置向导使用
        async haSuggestBackups() {
            const suggestions = [];
            const defaultSel = currentDefaultSelection();
            const llm = getService(ctx, 'llm');
            if (!llm)
                return suggestions;
            let providers = [];
            try {
                providers = llm.listProviders();
            }
            catch (e) {
                providers = [];
            }
            for (const p of providers) {
                const provider = String((p && p.id) || p.provider || p.name || p);
                if (!provider)
                    continue;
                if (defaultSel && defaultSel.provider === provider)
                    continue;
                let models = [];
                try {
                    models = await llm.listModels(provider);
                }
                catch (e) {
                    models = [];
                }
                for (const m of models) {
                    const model = String((m && m.id) || m.model || m.name || m);
                    if (!model)
                        continue;
                    const name = String((m && m.name) || model);
                    suggestions.push({ provider, model, name });
                    if (suggestions.length >= 20)
                        return suggestions;
                }
            }
            return suggestions;
        }
        // 最近 run 列表（内存，供 UI Run 面板轮询）
        orchRuns() {
            return { runs: state.runs.slice(0, RUN_MEM_CAP) };
        }
        // 加载/运行诊断：服务可用性、持久化、语言、注入状态（排障用）
        diagnostics() {
            const names = ['tools', 'systemPrompt', 'subagents', 'llm', 'fs', 'timer', 'settings', 'agents', 'agentDefaultModel', 'sandboxPolicy', 'commands', 'skills'];
            const services = {};
            for (const n of names) {
                const v = getService(ctx, n);
                services[n] = { present: v != null };
            }
            return {
                services,
                persist: persistState,
                configLoaded,
                haStateLoaded,
                language: { active: langState.active, rollback: langState.rollback, reason: langState.rollbackReason },
                injection: injectionStatusSnapshot(),
                probeEnabled: state.config.ha.probeEnabled,
            };
        }
        // ---- 配方（预设）管理 ----
        orchListPresets() {
            return { presets: (state.config.orch.presets || []).slice() };
        }
        async orchSavePreset(args) {
            const name = args && args.name ? String(args.name).trim() : '';
            if (!name)
                throw new Error(t('orch.errPresetName'));
            const tasks = Array.isArray(args.tasks) ? args.tasks.filter((tk) => tk && tk.prompt).map((tk) => ({ id: String(tk.id || ''), label: String(tk.label || ''), agent: String(tk.agent || ''), prompt: String(tk.prompt) })) : [];
            if (tasks.length === 0)
                throw new Error(t('orch.errNoTasks'));
            const entry = {
                name,
                mode: resolveMode(args.mode),
                agent: String((args && args.agent) || ''),
                supervisorAgent: String((args && args.supervisorAgent) || ''),
                mergeInstructions: String((args && args.mergeInstructions) || ''),
                tasks,
            };
            const presets = (state.config.orch.presets || []).filter((p) => p && p.name !== name);
            presets.push(entry);
            state.config.orch.presets = presets;
            await persistConfig();
            debugLog('info', 'orch.preset.save', '配方已保存', { name, mode: entry.mode, tasks: tasks.length });
            return { presets };
        }
        async orchDeletePreset(args) {
            const name = args && args.name ? String(args.name) : '';
            state.config.orch.presets = (state.config.orch.presets || []).filter((p) => p && p.name !== name);
            await persistConfig();
            return { presets: state.config.orch.presets.slice() };
        }
        debugLogs() {
            return { enabled: debugEnabled(), logs: state.debugLogs.slice() };
        }
        debugClear() {
            state.debugLogs = [];
            debugLog('info', 'debug.clear', '调试日志已清空');
            return { enabled: debugEnabled(), logs: [] };
        }
    }
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateGet', 'stateGet', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateReload', 'stateReload', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateSet', 'stateSet', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateExport', 'stateExport', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'stateImport', 'stateImport', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'modelsList', 'modelsList', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'agentsGenerate', 'agentsGenerate', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'haReset', 'haReset', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'haStatus', 'haStatus', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'haProbeNow', 'haProbeNow', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'haSuggestBackups', 'haSuggestBackups', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'orchRuns', 'orchRuns', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'diagnostics', 'diagnostics', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'orchListPresets', 'orchListPresets', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'orchSavePreset', 'orchSavePreset', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'orchDeletePreset', 'orchDeletePreset', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'debugLogs', 'debugLogs', remoteInitializers);
    decorateRemoteMethod(Remote, HaOrchestratorRpc, 'debugClear', 'debugClear', remoteInitializers);
    new HaOrchestratorRpc();
}
export { apply, inject, name };
export default { apply, inject, name };
