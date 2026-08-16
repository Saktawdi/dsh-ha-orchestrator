// HA Orchestrator — static client plugin bundle.
//
// Hand-written browser bundle in the lazy-CJS format the client module loader
// (`window.__ModuleLoader__`) expects: it only REGISTERS the factory via
// `__ModuleLoader__.load`; the body runs at materialization. The host half
// (`lib/index.js`) publishes the `haOrchestrator` Typert Remote service; this
// bundle mounts its client contribution (`$mount`) and renders the UI.
//
// Static adaptation of the dynamic cordis client body (`client.js`):
//   - `React` global             -> `require('react')` (platform seed word)
//   - `styles.insert(css)`       -> inline `<style data-plugin="dsh-ha-orchestrator">`
//                                   (the loader claims it for this module id)
//   - `host.call(method, args)`  -> `ctx.remote.haOrchestrator.<method>(args)`
//                                   (mounted via TYPERT_REMOTE; wire params
//                                    mirror the host's source-mode signatures)
//
// 语言系统：文案统一走模块级 `t(key, params)`，字典来自 host `state.i18n.dict`
// （host 启动时按 DSH 语言选择加载 `.language/*.json`，失败回滚 zh）。每次
// stateGet/stateSet 刷新后把最新 i18n 快照写入模块级 `__i18n`，组件重渲染即换语言。
window.__ModuleLoader__.load({
  id: 'dsh-ha-orchestrator',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // ================= 样式（内联；loader 按 data-plugin 认领） =================
    const STYLES = `
.hao-page { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 20px; font-size: 13px; }
.hao-card { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, transparent); overflow: hidden; }
.hao-card-head { display: flex; align-items: baseline; gap: 8px; padding: 10px 14px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); }
.hao-card-title { font-weight: 600; font-size: 14px; color: var(--dsw-alias-label-primary, inherit); }
.hao-card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.8)); }
.hao-card-actions { display: inline-flex; align-items: center; gap: 4px; }
.hao-card-head-click { cursor: pointer; user-select: none; }
.hao-card-head-click:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.06)); }
.hao-chevron { display: inline-block; font-size: 10px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.8)); transition: transform .15s ease; }
.hao-chevron.open { transform: rotate(90deg); }
.hao-card-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.hao-row { display: flex; align-items: center; gap: 10px; min-height: 30px; }
.hao-row-label { flex: 0 0 170px; display: flex; flex-direction: column; gap: 2px; }
.hao-row-label > span:first-child { color: var(--dsw-alias-label-primary, inherit); }
.hao-row-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.8)); }
.hao-row-ctrl { flex: 1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hao-input { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); color: var(--dsw-alias-label-primary, inherit); border-radius: 6px; padding: 5px 8px; font-size: 13px; min-width: 60px; }
.hao-input:focus { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-static-deepseek-450, #4d6bfe)); }
.hao-mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.hao-btn { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); color: var(--dsw-alias-label-primary, inherit); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.hao-btn:hover { border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.5)); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08)); }
.hao-btn:disabled { opacity: .45; cursor: default; }
.hao-btn-primary { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.hao-btn-primary:hover { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, #4d6bfe)); border-color: transparent; }
.hao-btn-primary:disabled { background: var(--dsw-alias-button-primary-dimmed, var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18))); color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.85)); border-color: transparent; }
.hao-btn-danger { color: var(--dsw-alias-state-error-primary, #e5484d); }
.hao-btn-mini { padding: 1px 6px; font-size: 11px; }
.hao-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.hao-toggle input { accent-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.hao-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.hao-table th, .hao-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.hao-table th { color: var(--dsw-alias-label-secondary, rgba(127,127,127,.8)); font-weight: 500; }
.hao-badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.15)); color: var(--dsw-alias-label-secondary, rgba(127,127,127,.9)); }
.hao-badge-on { background: var(--dsw-alias-state-success-primary, #30a46c); color: #fff; }
.hao-badge-off { background: var(--dsw-alias-state-error-primary, #e5484d); color: #fff; }
.hao-pre { white-space: pre-wrap; word-break: break-all; max-height: 240px; overflow: auto; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); border-radius: 6px; padding: 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.hao-textarea { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); color: var(--dsw-alias-label-primary, inherit); border-radius: 6px; padding: 6px 8px; font-size: 12px; font-family: ui-monospace, Consolas, monospace; resize: vertical; width: 100%; box-sizing: border-box; }
.hao-textarea:focus { outline: 1px solid var(--dsw-alias-state-business-primary, var(--dsw-static-deepseek-450, #4d6bfe)); }
.hao-error { color: var(--dsw-alias-state-error-primary, #e5484d); font-size: 12px; }
.hao-err { color: var(--dsw-alias-state-error-primary, #e5484d); font-size: 12px; }
.hao-ok { color: var(--dsw-alias-state-success-primary, #30a46c); font-size: 12px; }
.hao-run { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.9)); padding: 2px 0; flex-wrap: wrap; }
.hao-run-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-error-primary, #e5484d); }
.hao-run-dot.on { background: var(--dsw-alias-state-success-primary, #30a46c); }
.hao-run-last { font-size: 11px; opacity: .8; }
.hao-run-card { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.hao-run-card-head { display: flex; align-items: center; gap: 8px; }
.hao-run-card-title { font-weight: 600; font-size: 13px; flex: 1; }
.hao-run-card-body { margin: 0; max-height: 180px; }
@media (prefers-reduced-motion: reduce) {
  .hao-chevron { transition: none; }
}
.hao-btn:focus-visible, .hao-input:focus-visible, .hao-textarea:focus-visible, .hao-card-head-click:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: 1px; }
.hao-card-head-click:focus-visible { outline-offset: -2px; }
.hao-section { margin-top: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.85)); }
.hao-empty-hint { padding: 6px 10px; border: 1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.4)); border-radius: 6px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.9)); }
.hao-agent { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.hao-agent-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hao-agent-name { font-weight: 600; font-size: 13px; }
.hao-agent-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.85)); }
.hao-agent-sp { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.7)); white-space: pre-wrap; word-break: break-all; max-height: 60px; overflow: auto; }
.hao-form { display: flex; flex-direction: column; gap: 8px; border: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.35)); border-radius: 8px; padding: 10px; }
.hao-form-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hao-form-label { flex: 0 0 90px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.85)); }
`
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin="dsh-ha-orchestrator"]')) {
      const style = document.createElement('style')
      style.setAttribute('data-plugin', 'dsh-ha-orchestrator')
      style.textContent = STYLES
      document.head.append(style)
    }

    // ================= 语言系统：模块级当前字典 + t() =================
    // host 在 state.i18n 里下发生效字典与语言状态；每次 state 刷新后同步到这里，
    // 组件（含设置页分区标签 thunk）经 t() 取词，重渲染即完成语言切换。
    // 首次同步前用最小兜底（仅分区标签），避免侧栏闪现原始键名。
    let __i18n = { active: 'zh', dict: { 'section.label': 'HA 与编排' }, mode: 'auto', dshLocale: null, rollback: false, rollbackReason: '', dicts: { zh: false, en: false } }
    function syncI18n(snap) {
      if (!snap || typeof snap !== 'object') return
      __i18n = {
        active: snap.active === 'en' ? 'en' : 'zh',
        dict: snap.dict && typeof snap.dict === 'object' ? snap.dict : {},
        mode: snap.mode === 'zh' || snap.mode === 'en' ? snap.mode : 'auto',
        dshLocale: snap.dshLocale === 'en' ? 'en' : snap.dshLocale === 'zh' ? 'zh' : null,
        rollback: !!snap.rollback,
        rollbackReason: snap.rollbackReason || '',
        dicts: snap.dicts && typeof snap.dicts === 'object' ? snap.dicts : { zh: false, en: false },
      }
    }
    function t(key, params) {
      const template = typeof __i18n.dict[key] === 'string' ? __i18n.dict[key] : key
      if (!params) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }
    function langLabel(id) {
      if (id === 'en') return t('sys.langEn')
      if (id === 'zh') return t('sys.langZh')
      return t('common.unknown')
    }

    // ================= Client Remote contribution =================
    // Mirrors the host half's HaOrchestratorRpc (TypertRemoteService "haOrchestrator").
    // The host resolves parameters by source signature (single `args` object per
    // call, wire key = parameter name); the client gateway requires strict codecs,
    // so every codec here is a pass-through parser — the host validates business
    // results before they cross the wire.
    const pass = { parse(value) { return value; } }
    const TYPERT_REMOTE = {
      package: 'dsh-ha-orchestrator',
      descriptors: [
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/stateGet',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'stateGet',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#State', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/stateReload',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'stateReload',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#State', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/stateSet',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'stateSet',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#StateSetArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#State', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/modelsList',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'modelsList',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#ModelsListArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#ModelInfo[]', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/agentsGenerate',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'agentsGenerate',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#AgentsGenerateArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#AgentsGenerateResult', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/haReset',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'haReset',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#State', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/haStatus',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'haStatus',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#HaStatus', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/haProbeNow',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'haProbeNow',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#ProbeArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#ProbeResult', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/haSuggestBackups',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'haSuggestBackups',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#Suggestions', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/orchRuns',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'orchRuns',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#OrchRuns', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/orchListPresets',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'orchListPresets',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#Presets', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/orchSavePreset',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'orchSavePreset',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#PresetArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#Presets', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/orchDeletePreset',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'orchDeletePreset',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#DeletePresetArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#Presets', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/stateExport',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'stateExport',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#Export', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/stateImport',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'stateImport',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#ImportArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#State', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/debugLogs',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'debugLogs',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#DebugLogs', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/debugClear',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'debugClear',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#DebugLogs', schema: pass },
        },
      ],
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      // Host-declared Typert services are not part of the shell's generated
      // Remote assembly: mount this package's contribution explicitly, then
      // gate every RPC call on the mount promise. The mounted namespace is
      // fetched with ctx.get('remote.haOrchestrator') — the same access repo
      // sibling plugins use for plugin-mounted namespaces.
      const remoteReady = ctx.remote.$mount(TYPERT_REMOTE)
      // Arity matters: the client gateway rejects a call whose argument count
      // does not match the descriptor (e.g. stateGet expects 0 args — passing
      // undefined still counts as one). Only forward an argument when defined.
      // The mounted method resolves with the RemoteResult envelope {ok, value,
      // error} — unwrap it so call sites get the business value directly.
      const call = (method, args) => remoteReady.then(() => {
        const ns = ctx.get('remote.haOrchestrator')
        const pending = args === undefined ? ns[method]() : ns[method](args)
        return pending.then((result) => {
          if (!result || result.ok === false) {
            const err = result && result.error
            throw new Error((err && err.message) ? String(err.message) : ('remote call failed: ' + method))
          }
          return result.value
        })
      })
      const rpc = {
        stateGet: () => call('stateGet'),
        stateReload: () => call('stateReload'),
        stateSet: (a) => call('stateSet', a),
        stateExport: () => call('stateExport'),
        stateImport: (a) => call('stateImport', a),
        modelsList: (a) => call('modelsList', a),
        agentsGenerate: (a) => call('agentsGenerate', a),
        haReset: () => call('haReset'),
        haStatus: () => call('haStatus'),
        haProbeNow: (a) => call('haProbeNow', a),
        haSuggestBackups: () => call('haSuggestBackups'),
        orchRuns: () => call('orchRuns'),
        orchListPresets: () => call('orchListPresets'),
        orchSavePreset: (a) => call('orchSavePreset', a),
        orchDeletePreset: (a) => call('orchDeletePreset', a),
        debugLogs: () => call('debugLogs'),
        debugClear: () => call('debugClear'),
      }

      // ================= 小组件 =================
      function Card(props) {
        const [collapsed, setCollapsed] = React.useState(!!props.defaultCollapsed)
        const collapsible = !!props.collapsible
        return React.createElement('div', { className: 'hao-card' },
          React.createElement('div', {
            className: 'hao-card-head' + (collapsible ? ' hao-card-head-click' : ''),
            onClick: collapsible ? () => setCollapsed(!collapsed) : undefined,
          },
            collapsible ? React.createElement('span', { className: 'hao-chevron' + (collapsed ? '' : ' open') }, '▸') : null,
            React.createElement('span', { className: 'hao-card-title' }, props.title),
            props.subtitle ? React.createElement('span', { className: 'hao-card-sub' }, props.subtitle) : null,
            React.createElement('span', { style: { flex: 1 } }),
            props.actions
              ? React.createElement('span', { className: 'hao-card-actions', onClick: (e) => e.stopPropagation() }, props.actions)
              : null,
          ),
          !collapsed ? React.createElement('div', { className: 'hao-card-body' }, props.children) : null,
        )
      }
      function Row(props) {
        return React.createElement('div', { className: 'hao-row' },
          React.createElement('div', { className: 'hao-row-label' },
            React.createElement('span', null, props.label),
            props.hint ? React.createElement('span', { className: 'hao-row-hint' }, props.hint) : null,
          ),
          React.createElement('div', { className: 'hao-row-ctrl' }, props.children),
        )
      }
      function Btn(props) {
        return React.createElement('button', {
          className: 'hao-btn' + (props.kind ? ' hao-btn-' + props.kind : '') + (props.mini ? ' hao-btn-mini' : ''),
          onClick: props.onClick,
          disabled: props.disabled,
          title: props.title,
        }, props.children)
      }
      function Toggle(props) {
        return React.createElement('label', { className: 'hao-toggle' },
          React.createElement('input', { type: 'checkbox', checked: !!props.value, onChange: (e) => props.onChange(e.target.checked) }),
          React.createElement('span', null, props.label || t('common.enable')),
        )
      }
      function TextInput(props) {
        return React.createElement('input', {
          className: 'hao-input' + (props.mono ? ' hao-mono' : ''),
          style: props.width ? { width: props.width } : undefined,
          value: props.value == null ? '' : String(props.value),
          placeholder: props.placeholder || '',
          onChange: (e) => props.onChange(e.target.value),
        })
      }
      function NumInput(props) {
        return React.createElement('input', {
          className: 'hao-input',
          type: 'number',
          style: { width: props.width || '90px' },
          value: props.value == null ? '' : String(props.value),
          onChange: (e) => props.onChange(e.target.value),
        })
      }

      // ================= 模型高可用卡片 =================
      function HaCard(props) {
        const cfg = props.cfg
        const backups = cfg.backups || []
        const set = (patch) => props.apply({ ha: { ...cfg, ...patch } })
        const setBackup = (i, patch) => {
          const next = backups.slice()
          next[i] = { ...next[i], ...patch }
          set({ backups: next })
        }
        const removeBackup = (i) => {
          const next = backups.slice()
          next.splice(i, 1)
          set({ backups: next })
        }
        const moveBackup = (i, dir) => {
          const j = i + dir
          if (j < 0 || j >= backups.length) return
          const next = backups.slice()
          const tm = next[i]
          next[i] = next[j]
          next[j] = tm
          set({ backups: next })
        }
        const providers = props.providers || []
        const [adding, setAdding] = React.useState(false)
        const [addProvider, setAddProvider] = React.useState('')
        const [addModels, setAddModels] = React.useState([])
        const [addModel, setAddModel] = React.useState('')
        const [addBusy, setAddBusy] = React.useState(false)
        const [suggestBusy, setSuggestBusy] = React.useState(false)
        const [suggestErr, setSuggestErr] = React.useState('')
        // 推荐备份：从已注册 provider x 模型目录挑选候选并追加（向导式引导）
        const doSuggest = () => {
          setSuggestBusy(true)
          setSuggestErr('')
          rpc.haSuggestBackups().then((cands) => {
            const list = cands || []
            if (list.length === 0) { setSuggestErr(t('ha.suggestNone')); return }
            const existing = backups.map((b) => b.provider + '/' + b.model)
            const fresh = list.filter((c) => existing.indexOf(c.provider + '/' + c.model) < 0).slice(0, 5)
            if (fresh.length === 0) { setSuggestErr(t('ha.suggestNone')); return }
            const next = backups.slice()
            for (const c of fresh) next.push({ label: '', provider: c.provider, model: c.model, reasoningEffort: '' })
            set({ backups: next })
          }).catch((e) => setSuggestErr(String((e && e.message) || e)))
            .finally(() => setSuggestBusy(false))
        }
        const loadModels = (provider) => {
          setAddBusy(true)
          rpc.modelsList({ provider }).then((ms) => {
            const list = ms || []
            setAddModels(list)
            setAddModel(list.length > 0 ? list[0].model : '')
          }).catch(() => { setAddModels([]); setAddModel('') })
            .finally(() => setAddBusy(false))
        }
        const openAdd = () => {
          setAdding(true)
          const first = providers.length > 0 ? providers[0].provider : ''
          setAddProvider(first)
          setAddModel('')
          setAddModels([])
          if (first) loadModels(first)
        }
        const confirmAdd = () => {
          if (!addProvider || !addModel) return
          set({ backups: backups.concat([{ label: '', provider: addProvider, model: addModel, reasoningEffort: '' }]) })
          setAdding(false)
        }
        return React.createElement(Card, {
          title: t('ha.title'),
          subtitle: t('ha.subtitle'),
          actions: React.createElement(Btn, { mini: true, title: t('ha.reload'), onClick: props.onReload }, '↻'),
        },
          React.createElement(Row, { label: t('common.enable') },
            React.createElement(Toggle, { value: cfg.enabled, onChange: (v) => set({ enabled: v }) }),
          ),
          React.createElement('div', { className: 'hao-section' }, t('ha.backupList')),
          backups.length === 0
            ? React.createElement('div', { className: 'hao-section hao-empty-hint' }, t('ha.emptyHint'))
            : null,
          backups.map((b, i) => React.createElement(Row, { key: 'b' + i, label: t('ha.backupN', { n: i + 1 }) },
            React.createElement(TextInput, { value: b.label, placeholder: t('ha.phLabel'), width: '90px', onChange: (v) => setBackup(i, { label: v }) }),
            React.createElement(TextInput, { value: b.provider, placeholder: t('ha.phProvider'), width: '120px', onChange: (v) => setBackup(i, { provider: v }) }),
            React.createElement(TextInput, { value: b.model, placeholder: t('ha.phModel'), width: '150px', onChange: (v) => setBackup(i, { model: v }) }),
            React.createElement(TextInput, { value: b.reasoningEffort, placeholder: t('ha.phEffort'), width: '90px', onChange: (v) => setBackup(i, { reasoningEffort: v }) }),
            React.createElement(Btn, { mini: true, onClick: () => moveBackup(i, -1) }, '↑'),
            React.createElement(Btn, { mini: true, onClick: () => moveBackup(i, 1) }, '↓'),
            React.createElement(Btn, { mini: true, kind: 'danger', onClick: () => removeBackup(i) }, t('common.delete')),
          )),
          React.createElement(Row, { label: '' },
            React.createElement(Btn, { onClick: openAdd }, t('ha.addFromConfig')),
            React.createElement(Btn, { disabled: suggestBusy, onClick: doSuggest }, suggestBusy ? t('common.loadingModelList') : t('ha.recommend')),
          ),
          suggestErr ? React.createElement(Row, { label: '' }, React.createElement('span', { className: 'hao-err' }, suggestErr)) : null,
          adding ? React.createElement(Row, { label: t('ha.pickBackup') },
            React.createElement('select', { className: 'hao-input', value: addProvider, onChange: (e) => { setAddProvider(e.target.value); loadModels(e.target.value) } },
              providers.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.provider + (p.name && p.name !== p.provider ? '（' + p.name + '）' : ''))),
            ),
            React.createElement('select', { className: 'hao-input', style: { flex: 1 }, value: addModel, disabled: addBusy, onChange: (e) => setAddModel(e.target.value) },
              React.createElement('option', { value: '' }, addBusy ? t('common.loadingModelList') : t('common.selectModel')),
              addModels.map((m) => React.createElement('option', { key: m.model, value: m.model }, m.name && m.name !== m.model ? m.name + '（' + m.model + '）' : m.model)),
            ),
            React.createElement(Btn, { kind: 'primary', disabled: !addProvider || !addModel || addBusy, onClick: confirmAdd }, t('common.add')),
            React.createElement(Btn, { onClick: () => setAdding(false) }, t('common.cancel')),
          ) : null,
          React.createElement(Card, { title: t('ha.advanced'), subtitle: t('ha.advancedHint'), collapsible: true, defaultCollapsed: true },
            React.createElement(Row, { label: t('ha.cooldown'), hint: t('ha.cooldownHint') },
              React.createElement(NumInput, { value: cfg.cooldownMs, onChange: (v) => set({ cooldownMs: Number(v) || 0 }) }),
            ),
            React.createElement(Row, { label: t('ha.threshold') },
              React.createElement(NumInput, { value: cfg.threshold, onChange: (v) => set({ threshold: Number(v) || 1 }) }),
            ),
            React.createElement(Row, { label: t('ha.burstWindow'), hint: t('ha.burstWindowHint') },
              React.createElement(NumInput, { value: cfg.burstWindowMs, onChange: (v) => set({ burstWindowMs: Number(v) || 0 }) }),
            ),
            React.createElement(Row, { label: t('ha.providerThreshold'), hint: t('ha.providerThresholdHint') },
              React.createElement(NumInput, { value: cfg.providerThreshold, onChange: (v) => set({ providerThreshold: Number(v) || 0 }) }),
            ),
            React.createElement(Row, { label: t('ha.probe'), hint: t('ha.probeHint') },
              React.createElement(Toggle, { value: cfg.probeEnabled, onChange: (v) => set({ probeEnabled: v }) }),
            ),
            React.createElement(Row, { label: t('ha.degrade'), hint: t('ha.degradeHint') },
              React.createElement(Toggle, { value: cfg.degradeContextWindow, onChange: (v) => set({ degradeContextWindow: v }) }),
            ),
            React.createElement(Row, { label: t('ha.codes'), hint: t('ha.codesHint') },
              React.createElement(TextInput, { value: (cfg.codes || []).join(', '), width: '100%', onChange: (v) => set({ codes: v.split(',').map((s) => s.trim()).filter(Boolean) }) }),
            ),
            React.createElement(Row, { label: t('ha.persist') },
              React.createElement(Toggle, { value: cfg.persistSelection, onChange: (v) => set({ persistSelection: v }) }),
            ),
            React.createElement(Row, { label: t('ha.steer') },
              React.createElement(Toggle, { value: cfg.steerOnStop, onChange: (v) => set({ steerOnStop: v }) }),
            ),
          ),
        )
      }

      // ================= 自定义子智能体管理 =================
      function AgentsCard(props) {
        const cfg = props.cfg
        const agents = cfg.agents || []
        const setAgents = (next) => props.apply({ orch: { ...cfg, agents: next } })
        const providers = props.providers || []
        const [editing, setEditing] = React.useState(null) // { index: -1 新增 | >=0 编辑, name, provider, model, description, systemPrompt }
        const [formModels, setFormModels] = React.useState([])
        const [formBusy, setFormBusy] = React.useState(false)
        const [formErr, setFormErr] = React.useState('')
        const [genOpen, setGenOpen] = React.useState(false)
        const [genReq, setGenReq] = React.useState('')
        const [genBusy, setGenBusy] = React.useState(false)
        const [genErr, setGenErr] = React.useState('')
        const loadFormModels = (provider) => {
          setFormBusy(true)
          setFormErr('')
          rpc.modelsList({ provider }).then((ms) => {
            setFormModels(ms || [])
          }).catch((e) => { setFormModels([]); setFormErr(String((e && e.message) || e)) })
            .finally(() => setFormBusy(false))
        }
        const openNew = () => {
          setEditing({ index: -1, name: '', provider: '', model: '', description: '', systemPrompt: '' })
          setFormModels([])
          setFormErr('')
        }
        const openEdit = (i, a) => {
          setEditing({ index: i, name: a.name || '', provider: a.provider || '', model: a.model || '', description: a.description || '', systemPrompt: a.systemPrompt || '' })
          setFormModels([])
          setFormErr('')
          if (a.provider) loadFormModels(a.provider)
        }
        const doGenerate = () => {
          setGenBusy(true)
          setGenErr('')
          rpc.agentsGenerate({ requirement: genReq }).then((res) => {
            const a = res && res.agent
            if (!a) { setGenErr(t('common.emptyGenerate')); return }
            setGenOpen(false)
            setGenReq('')
            setEditing({ index: -1, name: a.name || '', provider: a.provider || '', model: a.model || '', description: a.description || '', systemPrompt: a.systemPrompt || '' })
            setFormModels([])
            setFormErr('')
            if (a.provider) loadFormModels(a.provider)
          }).catch((e) => setGenErr(String((e && e.message) || e)))
            .finally(() => setGenBusy(false))
        }
        const save = () => {
          if (!editing) return
          const name = String(editing.name || '').trim()
          if (!name) { setFormErr(t('common.requiredName')); return }
          const next = agents.slice()
          const entry = { name, provider: String(editing.provider || ''), model: String(editing.model || ''), description: String(editing.description || ''), systemPrompt: String(editing.systemPrompt || '') }
          if (editing.index < 0) next.push(entry)
          else next[editing.index] = entry
          setAgents(next)
          setEditing(null)
        }
        const remove = (i) => {
          const next = agents.slice()
          next.splice(i, 1)
          setAgents(next)
          if (editing && editing.index === i) setEditing(null)
        }
        const move = (i, dir) => {
          const j = i + dir
          if (j < 0 || j >= agents.length) return
          const next = agents.slice()
          const tm = next[i]
          next[i] = next[j]
          next[j] = tm
          setAgents(next)
        }
        const form = editing
        const isNew = form && form.index < 0
        return React.createElement(Card, { title: t('agents.title') },
          agents.map((a, i) => React.createElement('div', { key: 'ag' + i, className: 'hao-agent' },
            React.createElement('div', { className: 'hao-agent-head' },
              React.createElement('span', { className: 'hao-agent-name' }, a.name || t('common.unnamed')),
              React.createElement('span', { className: 'hao-badge' }, (a.provider ? a.provider + '/' : '') + (a.model || t('common.defaultModel'))),
              React.createElement('span', { style: { flex: 1 } }),
              React.createElement(Btn, { mini: true, onClick: () => move(i, -1) }, '↑'),
              React.createElement(Btn, { mini: true, onClick: () => move(i, 1) }, '↓'),
              React.createElement(Btn, { mini: true, onClick: () => openEdit(i, a) }, t('common.edit')),
              React.createElement(Btn, { mini: true, kind: 'danger', onClick: () => remove(i) }, t('common.delete')),
            ),
            a.description ? React.createElement('div', { className: 'hao-agent-desc' }, a.description) : null,
            a.systemPrompt ? React.createElement('div', { className: 'hao-agent-sp' }, a.systemPrompt) : null,
          )),
          React.createElement(Row, { label: '' },
            React.createElement(Btn, { onClick: openNew }, t('agents.add')),
            React.createElement(Btn, { kind: 'primary', onClick: () => { setGenErr(''); setGenOpen(!genOpen) } }, t('agents.gen')),
          ),
          genOpen ? React.createElement('div', { className: 'hao-form' },
            React.createElement('div', { className: 'hao-form-row' },
              React.createElement('span', { className: 'hao-form-label' }, t('agents.req')),
              React.createElement('textarea', {
                className: 'hao-textarea',
                rows: 3,
                placeholder: t('agents.reqPh'),
                value: genReq,
                onChange: (e) => setGenReq(e.target.value),
              }),
            ),
            genErr ? React.createElement('div', { className: 'hao-error' }, genErr) : null,
            React.createElement('div', { className: 'hao-form-row' },
              React.createElement(Btn, { kind: 'primary', disabled: genBusy || !String(genReq || '').trim(), onClick: doGenerate }, genBusy ? t('common.generating') : t('common.generate')),
              React.createElement(Btn, { onClick: () => { setGenOpen(false); setGenReq(''); setGenErr('') } }, t('common.cancel')),
            ),
          ) : null,
          form ? React.createElement('div', { className: 'hao-form' },
            React.createElement('div', { className: 'hao-form-row' },
              React.createElement('span', { className: 'hao-form-label' }, t('agents.name')),
              React.createElement(TextInput, { value: form.name, placeholder: t('agents.namePh'), width: '160px', onChange: (v) => setEditing({ ...form, name: v }) }),
              React.createElement('span', { className: 'hao-form-label' }, t('agents.provider')),
              React.createElement('select', {
                className: 'hao-input',
                value: form.provider,
                onChange: (e) => { const p = e.target.value; setEditing({ ...form, provider: p, model: '' }); setFormModels([]); if (p) loadFormModels(p) },
              },
                React.createElement('option', { value: '' }, t('common.defaultInherit')),
                providers.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.provider + (p.name && p.name !== p.provider ? '（' + p.name + '）' : ''))),
              ),
              React.createElement('span', { className: 'hao-form-label' }, t('agents.model')),
              React.createElement('select', {
                className: 'hao-input',
                style: { flex: 1, minWidth: '140px' },
                value: form.model,
                disabled: formBusy,
                onChange: (e) => setEditing({ ...form, model: e.target.value }),
              },
                React.createElement('option', { value: '' }, formBusy ? t('common.loadingModels') : t('common.defaultInherit')),
                formModels.map((m) => React.createElement('option', { key: m.model, value: m.model }, m.name && m.name !== m.model ? m.name + '（' + m.model + '）' : m.model)),
              ),
            ),
            React.createElement('div', { className: 'hao-form-row' },
              React.createElement('span', { className: 'hao-form-label' }, t('agents.desc')),
              React.createElement(TextInput, { value: form.description, placeholder: t('agents.descPh'), width: '100%', onChange: (v) => setEditing({ ...form, description: v }) }),
            ),
            React.createElement('div', { className: 'hao-form-row' },
              React.createElement('span', { className: 'hao-form-label' }, t('agents.sp')),
              React.createElement('textarea', {
                className: 'hao-textarea',
                rows: 3,
                placeholder: t('agents.spPh'),
                value: form.systemPrompt,
                onChange: (e) => setEditing({ ...form, systemPrompt: e.target.value }),
              }),
            ),
            formErr ? React.createElement('div', { className: 'hao-error' }, formErr) : null,
            React.createElement('div', { className: 'hao-form-row' },
              React.createElement(Btn, { kind: 'primary', onClick: save }, isNew ? t('common.add') : t('common.save')),
              React.createElement(Btn, { onClick: () => setEditing(null) }, t('common.cancel')),
            ),
          ) : null,
        )
      }

      // ================= 编排卡片 =================
      function OrchCard(props) {
        const cfg = props.cfg
        const set = (patch) => props.apply({ orch: { ...cfg, ...patch } })
        return React.createElement(Card, { title: t('orch.title') },
          React.createElement(Row, { label: t('common.enable'), hint: t('orch.enabledHint') },
            React.createElement(Toggle, { value: cfg.enabled, onChange: (v) => set({ enabled: v }) }),
          ),
          React.createElement(Row, { label: t('orch.provider') },
            React.createElement('select', {
              className: 'hao-input',
              value: cfg.provider || '',
              onChange: (e) => set({ provider: e.target.value }),
            },
              React.createElement('option', { value: '' }, t('orch.autoFirst')),
              (props.providers || []).map((p) => React.createElement('option', { key: p, value: p }, p)),
            ),
          ),
          React.createElement(Row, { label: t('orch.concurrency') },
            React.createElement(NumInput, { value: cfg.concurrency, onChange: (v) => set({ concurrency: Number(v) || 1 }) }),
          ),
          React.createElement(Row, { label: t('orch.maxAgents') },
            React.createElement(NumInput, { value: cfg.maxAgents, onChange: (v) => set({ maxAgents: Number(v) || 1 }) }),
          ),
          React.createElement(Row, { label: t('orch.globalConcurrency'), hint: t('orch.globalConcurrencyHint') },
            React.createElement(NumInput, { value: cfg.globalConcurrency, onChange: (v) => set({ globalConcurrency: Number(v) || 0 }) }),
          ),
          React.createElement(Row, { label: t('orch.stageRetry'), hint: t('orch.stageRetryHint') },
            React.createElement(NumInput, { value: cfg.stageRetry, onChange: (v) => set({ stageRetry: Number(v) || 0 }) }),
          ),
          React.createElement('div', { className: 'hao-section' }, t('orch.usageHowto')),
        )
      }

      // ================= 开发调试卡片 =================
      function DebugCard(props) {
        const cfg = props.cfg || { enabled: false }
        const persist = props.persist
        const [logs, setLogs] = React.useState([])
        const [busy, setBusy] = React.useState(false)
        const refresh = () => {
          rpc.debugLogs().then((r) => setLogs((r && r.logs) || [])).catch(() => {})
        }
        React.useEffect(() => {
          refresh()
          if (!cfg.enabled) return
          const timer = ctx.get('timer')
          if (!timer) return
          const dispose = timer.interval(() => refresh(), 2000)
          return () => dispose()
        }, [cfg.enabled])
        const set = (patch) => props.apply({ debug: { ...cfg, ...patch } })
        const clear = () => {
          setBusy(true)
          rpc.debugClear().then((r) => setLogs((r && r.logs) || [])).catch(() => {}).finally(() => setBusy(false))
        }
        const fmt = (l) => {
          const tm = String(l.at).slice(11, 19)
          const extra = l.data && Object.keys(l.data).length > 0 ? ' ' + JSON.stringify(l.data) : ''
          return '[' + tm + '][' + l.level + '] ' + l.ev + ' ' + l.msg + extra
        }
        return React.createElement(Card, { title: t('debug.title'), subtitle: t('debug.subtitle'), collapsible: true, defaultCollapsed: true },
          React.createElement(Row, { label: t('debug.enabled'), hint: t('debug.enabledHint') },
            React.createElement(Toggle, { value: cfg.enabled, onChange: (v) => set({ enabled: v }) }),
          ),
          React.createElement(Row, { label: t('debug.persist') },
            React.createElement('span', { className: persist && persist.ok ? 'hao-ok' : 'hao-error' },
              persist && persist.ok
                ? t('debug.saved', { path: persist.path })
                : (persist && persist.error ? t('debug.writeFailed', { error: persist.error + (persist.diag ? ' ' + JSON.stringify(persist.diag) : '') }) : t('common.unknown')),
            ),
          ),
          React.createElement('div', { className: 'hao-section' }, t('debug.logsCount', { n: logs.length })),
          logs.length > 0
            ? React.createElement('div', { className: 'hao-pre' }, logs.slice().reverse().map((l, i) => React.createElement('div', { key: 'd' + i }, fmt(l))))
            : React.createElement('div', { className: 'hao-section' }, t('debug.noLogs')),
          React.createElement(Row, { label: '' },
            React.createElement(Btn, { onClick: refresh }, t('common.refresh')),
            React.createElement(Btn, { kind: 'danger', disabled: busy, onClick: clear }, t('common.clear')),
          ),
        )
      }

      // ================= 系统卡片（新增；默认折叠） =================
      // 插件语言切换放置于此：跟随系统（auto）/ 中文 / English。
      // host 启动时默认读取 DSH 语言选择并自动切换，失败自动回滚 zh（见 sys 状态行）。
      function SysCard(props) {
        const i18n = props.i18n || __i18n
        const mode = i18n.mode === 'zh' || i18n.mode === 'en' ? i18n.mode : 'auto'
        const dicts = i18n.dicts || { zh: false, en: false }
        const ctxStatus = props.ctxStatus || { registered: false, reason: '', order: 40, lastEval: null }
        const evalLabel = (m) => {
          if (m === 'default') return t('ctx.evalDefault')
          if (m === 'custom') return t('ctx.evalCustom')
          if (m === 'off') return t('ctx.evalOff')
          if (m === 'empty') return t('ctx.evalEmpty')
          return t('ctx.evalNone')
        }
        return React.createElement(Card, { title: t('sys.title'), subtitle: t('sys.subtitle'), collapsible: true, defaultCollapsed: true },
          React.createElement(Row, { label: t('sys.lang'), hint: t('sys.langHint') },
            React.createElement('select', {
              className: 'hao-input',
              value: mode,
              onChange: (e) => props.apply({ lang: { mode: e.target.value } }),
            },
              React.createElement('option', { value: 'auto' }, t('sys.langAuto')),
              React.createElement('option', { value: 'zh' }, t('sys.langZh')),
              React.createElement('option', { value: 'en' }, t('sys.langEn')),
            ),
          ),
          React.createElement(ContextInjectRow, { ctxCfg: props.ctxCfg, apply: props.apply }),
          React.createElement(Row, { label: t('ctx.status'), hint: t('ctx.statusHint') },
            React.createElement('span', { className: 'hao-badge ' + (ctxStatus.registered ? 'hao-badge-on' : 'hao-badge-off') },
              ctxStatus.registered
                ? t('ctx.statusOk', { order: String(ctxStatus.order == null ? '' : ctxStatus.order) })
                : t('ctx.statusFail', { reason: String(ctxStatus.reason || t('common.unknown')) }),
            ),
            ctxStatus.lastEval
              ? React.createElement('span', { className: 'hao-badge' },
                t('ctx.lastEval') + '：' + evalLabel(ctxStatus.lastEval.mode) + '（' + (Number(ctxStatus.lastEval.chars) || 0) + ' 字符）')
              : null,
          ),
          React.createElement(Row, { label: t('sys.effective') },
            React.createElement('span', { className: 'hao-badge hao-badge-on' }, langLabel(i18n.active)),
            i18n.rollback
              ? React.createElement('span', { className: 'hao-badge hao-badge-off' }, t('sys.rollbackEvent', { reason: i18n.rollbackReason }))
              : null,
          ),
          React.createElement(Row, { label: t('sys.dshLocale') },
            React.createElement('span', null, i18n.dshLocale ? langLabel(i18n.dshLocale) : t('sys.dshNone')),
          ),
          React.createElement(Row, { label: t('sys.rollback'), hint: t('sys.rollbackHint') },
            React.createElement('span', { className: i18n.rollback ? 'hao-error' : 'hao-ok' },
              i18n.rollback ? t('sys.rollbackEvent', { reason: i18n.rollbackReason }) : t('sys.rollbackNo'),
            ),
          ),
          React.createElement(Row, { label: t('sys.dictStatus') },
            React.createElement('span', { className: 'hao-badge ' + (dicts.zh ? 'hao-badge-on' : 'hao-badge-off') }, 'zh: ' + (dicts.zh ? t('sys.dictLoaded') : t('sys.dictFailed'))),
            React.createElement('span', { className: 'hao-badge ' + (dicts.en ? 'hao-badge-on' : 'hao-badge-off') }, 'en: ' + (dicts.en ? t('sys.dictLoaded') : t('sys.dictFailed'))),
          ),
          React.createElement('div', { className: 'hao-section' }, t('sys.startupNote')),
          React.createElement(Row, { label: t('debug.show'), hint: t('debug.showHint') },
            React.createElement(Toggle, {
              value: !!(props.debugCfg && props.debugCfg.showCard),
              onChange: (v) => props.apply({ debug: { ...(props.debugCfg || {}), showCard: v } }),
            }),
          ),
          React.createElement(ExportImportRow, null),
        )
      }

      // ================= 一键导出 / 导入配置（系统卡片内） =================
      function ExportImportRow() {
        const [exportJson, setExportJson] = React.useState('')
        const [importJson, setImportJson] = React.useState('')
        const [msg, setMsg] = React.useState('')
        const doExport = () => {
          rpc.stateExport().then((res) => {
            setExportJson((res && res.json) || '')
            setMsg(t('sys.exported'))
          }).catch((e) => setMsg(String((e && e.message) || e)))
        }
        const doCopy = () => {
          if (!exportJson) return
          try {
            if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(exportJson).then(() => setMsg(t('sys.copied'))).catch(() => {})
            }
          } catch (e) { /* ignore */ }
        }
        const doImport = () => {
          rpc.stateImport({ json: importJson }).then(() => {
            setImportJson('')
            setMsg(t('sys.imported'))
            // 触发整页刷新（stateSet 由调用方 props.apply 处理；此处直接重挂）
            if (window && window.location) window.location.reload()
          }).catch((e) => setMsg(String((e && e.message) || e)))
        }
        return React.createElement(React.Fragment, null,
          React.createElement(Row, { label: t('sys.export'), hint: t('sys.exportHint') },
            React.createElement(Btn, { onClick: doExport }, t('sys.exportBtn')),
            exportJson
              ? React.createElement(Btn, { onClick: doCopy }, t('sys.copy'))
              : null,
          ),
          exportJson
            ? React.createElement('div', { className: 'hao-section' },
              React.createElement('pre', { className: 'hao-pre', style: { maxHeight: '160px' } }, exportJson),
            )
            : null,
          React.createElement(Row, { label: t('sys.import'), hint: t('sys.importHint') },
            React.createElement('textarea', {
              className: 'hao-textarea',
              rows: 3,
              value: importJson,
              onChange: (e) => setImportJson(e.target.value),
              placeholder: '{ "ha": { ... } }',
            }),
            React.createElement(Btn, { kind: 'primary', disabled: !importJson.trim(), onClick: doImport }, t('sys.importBtn')),
          ),
          msg ? React.createElement('div', { className: 'hao-section ' + (msg.indexOf(t('sys.imported')) >= 0 || msg.indexOf(t('sys.exported')) >= 0 || msg.indexOf(t('sys.copied')) >= 0 ? 'hao-ok' : 'hao-error') }, msg) : null,
        )
      }

      // ================= 上下文注入（系统卡片内） =================
      // 总开关 + 自定义上下文（失焦自动保存，原文追加不翻译）
      function ContextInjectRow(props) {
        const ctxCfg = props.ctxCfg || { enabled: true, text: '' }
        const [draft, setDraft] = React.useState(String(ctxCfg.text || ''))
        React.useEffect(() => { setDraft(String(ctxCfg.text || '')) }, [ctxCfg.text])
        const saveDraft = () => {
          const v = draft.trim()
          if (v === String(ctxCfg.text || '')) return
          props.apply({ ctx: { ...ctxCfg, text: v } })
        }
        return React.createElement(React.Fragment, null,
          React.createElement(Row, { label: t('ctx.title'), hint: t('ctx.hint') },
            React.createElement(Toggle, {
              value: !!ctxCfg.enabled,
              onChange: (v) => props.apply({ ctx: { ...ctxCfg, enabled: v } }),
            }),
          ),
          React.createElement(Row, { label: t('ctx.custom'), hint: t('ctx.customHint') },
            React.createElement('textarea', {
              className: 'hao-textarea',
              rows: 2,
              value: draft,
              onChange: (e) => setDraft(e.target.value),
              onBlur: saveDraft,
            }),
          ),
        )
      }

      // ================= 诊断卡片（HA 运行态 + 最近 run） =================
      function DiagnosticsCard() {
        const [diag, setDiag] = React.useState(null)
        const refresh = () => {
          Promise.all([rpc.haStatus(), rpc.orchRuns()]).then(([hs, runs]) => {
            setDiag({ hs: hs || {}, runs: (runs && runs.runs) || [] })
          }).catch(() => {})
        }
        React.useEffect(() => {
          refresh()
          const timer = ctx.get('timer')
          if (!timer) return
          const dispose = timer.interval(() => refresh(), 10000)
          return () => dispose()
        }, [])
        if (!diag) {
          return React.createElement(Card, { title: t('diag.title'), subtitle: t('diag.subtitle'), collapsible: true, defaultCollapsed: true },
            React.createElement('div', { className: 'hao-section' }, t('common.loading')),
          )
        }
        const hs = diag.hs
        const quarantine = hs.quarantine || []
        const failures = hs.failures || []
        const cursors = hs.cursors || []
        const probes = (hs.probes && hs.probes.last) || []
        const runs = diag.runs
        return React.createElement(Card, { title: t('diag.title'), subtitle: t('diag.subtitle'), collapsible: true, defaultCollapsed: true },
          React.createElement(Row, { label: t('diag.ha') },
            React.createElement('span', { className: 'hao-badge ' + (hs.enabled ? 'hao-badge-on' : 'hao-badge-off') },
              hs.enabled ? t('ha.statusEnabled') : t('ha.statusDisabled')),
            React.createElement('span', { className: 'hao-badge' }, 'cooldown ' + (Math.round((hs.config && hs.config.cooldownMs) / 1000) || 0) + 's'),
            React.createElement('span', { className: 'hao-badge' }, 'threshold ' + ((hs.config && hs.config.threshold) || 1)),
            React.createElement('span', { className: 'hao-badge' }, 'probe ' + (hs.config && hs.config.probeEnabled ? 'on' : 'off')),
          ),
          React.createElement(Row, { label: t('ha.currentDefault') },
            React.createElement('span', null, hs.defaultSelection ? hs.defaultSelection.provider + ' / ' + hs.defaultSelection.model : t('common.unknown')),
          ),
          React.createElement('div', { className: 'hao-section' }, t('ha.quarantined', { n: quarantine.length })),
          quarantine.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, t('ha.phProvider')), React.createElement('th', null, t('ha.phModel')),
                React.createElement('th', null, 'level'), React.createElement('th', null, t('ha.thCode')), React.createElement('th', null, t('ha.thRemaining')),
              )),
              React.createElement('tbody', null, quarantine.map((q, i) => React.createElement('tr', { key: 'dq' + i },
                React.createElement('td', null, q.provider), React.createElement('td', null, q.model),
                React.createElement('td', null, q.level || 'model'), React.createElement('td', null, q.code || ''),
                React.createElement('td', null, Math.round(q.remainingMs / 1000) + 's'),
              ))),
            )
            : React.createElement('div', { className: 'hao-section' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('ha.recent')),
          hs.history && hs.history.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, t('ha.thTime')), React.createElement('th', null, t('ha.thFrom')), React.createElement('th', null, t('ha.thTo')), React.createElement('th', null, t('ha.thCode')),
              )),
              React.createElement('tbody', null, hs.history.slice(0, 8).map((h, i) => React.createElement('tr', { key: 'dh' + i },
                React.createElement('td', null, String(h.at).slice(11, 19)), React.createElement('td', null, h.from), React.createElement('td', null, h.to), React.createElement('td', null, h.code || ''),
              ))),
            )
            : React.createElement('div', { className: 'hao-section' }, t('common.noneYet')),
          React.createElement('div', { className: 'hao-section' }, t('diag.failures', { n: failures.length })),
          failures.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, t('ha.phProvider')), React.createElement('th', null, t('ha.phModel')), React.createElement('th', null, 'count'), React.createElement('th', null, t('ha.thRemaining')),
              )),
              React.createElement('tbody', null, failures.map((f, i) => React.createElement('tr', { key: 'df' + i },
                React.createElement('td', null, f.provider), React.createElement('td', null, f.model),
                React.createElement('td', null, 'x' + f.count), React.createElement('td', null, Math.round(f.remainingMs / 1000) + 's'),
              ))),
            )
            : React.createElement('div', { className: 'hao-section' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('diag.cursors', { n: cursors.length })),
          cursors.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, 'agent'), React.createElement('th', null, 'lastKey'), React.createElement('th', null, 'retries'),
              )),
              React.createElement('tbody', null, cursors.map((c, i) => React.createElement('tr', { key: 'dc' + i },
                React.createElement('td', null, c.agent), React.createElement('td', null, c.lastKey || '-'), React.createElement('td', null, String(c.retries || 0)),
              ))),
            )
            : React.createElement('div', { className: 'hao-section' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('diag.probes', { n: probes.length })),
          probes.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, 'key'), React.createElement('th', null, 'result'),
              )),
              React.createElement('tbody', null, probes.slice(0, 5).map((p, i) => React.createElement('tr', { key: 'dp' + i },
                React.createElement('td', null, p.key),
                React.createElement('td', null, React.createElement('span', { className: p.ok ? 'hao-ok' : 'hao-error' }, p.ok ? 'ok' : (p.reason || 'fail'))),
              ))),
            )
            : React.createElement('div', { className: 'hao-section' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('diag.runs', { n: runs.length })),
          runs.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, 'runId'), React.createElement('th', null, 'mode'), React.createElement('th', null, 'tasks'), React.createElement('th', null, 'status'),
              )),
              React.createElement('tbody', null, runs.slice(0, 8).map((r, i) => React.createElement('tr', { key: 'dr' + i },
                React.createElement('td', { className: 'hao-mono' }, r.runId),
                React.createElement('td', null, r.mode),
                React.createElement('td', null, String(r.runs ? r.runs.length : 0)),
                React.createElement('td', null,
                  React.createElement('span', { className: 'hao-badge ' + (r.runs && r.runs.some((x) => x.status === 'error') ? 'hao-badge-off' : 'hao-badge-on') },
                    r.aborted ? 'aborted' : (r.runs && r.runs.every((x) => x.status === 'completed') ? 'ok' : 'partial')),
                ),
              ))),
            )
            : React.createElement('div', { className: 'hao-section' }, t('diag.noRuns')),
          React.createElement(Row, { label: '' },
            React.createElement(Btn, { kind: 'danger', onClick: () => rpc.haReset().then(() => refresh()).catch(() => {}) }, t('ha.reset')),
          ),
        )
      }

      // ================= 页面 =================
      function HaPage(props) {
        const [state, setState] = React.useState(null)
        const [error, setError] = React.useState('')
        const noteI18n = (s) => { if (s && s.i18n) { syncI18n(s.i18n); if (props && props.onI18nChanged) props.onI18nChanged() } }
        const refresh = () => {
          rpc.stateGet().then((s) => { setState(s); setError(''); noteI18n(s) }).catch((e) => setError(String((e && e.message) || e)))
        }
        React.useEffect(() => {
          refresh()
          const timer = ctx.get('timer')
          if (!timer) return
          const dispose = timer.interval(() => refresh(), 5000)
          return () => dispose()
        }, [])
        const apply = (patch) => {
          rpc.stateSet({ patch }).then((s) => { setState(s); setError(''); noteI18n(s) }).catch((e) => setError(String((e && e.message) || e)))
        }
        // 重新加载：host 重新从磁盘读取持久化配置并应用（含语言跟随），再刷新整页
        const reload = () => {
          rpc.stateReload().then((s) => { setState(s); setError(''); noteI18n(s) }).catch((e) => setError(String((e && e.message) || e)))
        }
        if (!state) {
          return React.createElement('div', { className: 'hao-page' }, error || t('common.loading'))
        }
      return React.createElement('div', { className: 'hao-page' },
        error ? React.createElement('div', { className: 'hao-error' }, error) : null,
        React.createElement(HaCard, { cfg: state.config.ha, apply, setState, status: state, providers: state.llmProviders || [], onReload: reload }),
        React.createElement(OrchCard, { cfg: state.config.orch, apply, providers: state.subagents || [] }),
        React.createElement(AgentsCard, { cfg: state.config.orch, apply, providers: state.llmProviders || [] }),
        // 开发调试卡片默认隐藏：系统卡片内「显示开发调试卡片」开关打开后才渲染
        state.config.debug && state.config.debug.showCard
          ? React.createElement(DebugCard, { cfg: state.config.debug, apply, persist: state.persist })
          : null,
        React.createElement(SysCard, { i18n: state.i18n, debugCfg: state.config.debug, ctxCfg: state.config.ctx, ctxStatus: state.ctxInject, apply }),
        React.createElement(DiagnosticsCard, null),
      )
      }

      // ================= Run 卡片状态 =================
      function HaStatusCard() {
        const [state, setState] = React.useState(null)
        const refresh = () => { rpc.stateGet().then((s) => { setState(s); if (s && s.i18n) syncI18n(s.i18n) }).catch(() => {}) }
        React.useEffect(() => {
          refresh()
          const timer = ctx.get('timer')
          if (!timer) return
          const dispose = timer.interval(() => refresh(), 10000)
          return () => dispose()
        }, [])
        if (!state) return React.createElement('div', { className: 'hao-run' }, t('ha.runLoading'))
        const cfg = state.config && state.config.ha
        const last = state.history && state.history[0]
        return React.createElement('div', { className: 'hao-run' },
          React.createElement('span', { className: 'hao-run-dot ' + (cfg && cfg.enabled ? 'on' : 'off') }),
          React.createElement('span', null,
            (cfg && cfg.enabled ? t('ha.runEnabled') : t('ha.runDisabled'))
            + ' · ' + t('ha.runBackup', { n: ((cfg && cfg.backups) || []).length })
            + ' · ' + t('ha.runQuarantine', { n: (state.quarantine || []).length }),
          ),
          last ? React.createElement('span', { className: 'hao-run-last' }, t('ha.runLast', { from: last.from, to: last.to, code: last.code })) : null,
        )
      }

      // ================= 对话内 Run 卡片（orchestrate toolview） =================
      // 通过官方 tool.call.toolview 槽位按工具名注册：运行中显示实时子任务数
      // （block.subCalls），完成后显示 runId（来自 host presentResult 标题）与输出摘要。
      function RunCard(props) {
        const block = props.block
        if (!block) return null
        const running = block.kind === 'tool-call'
        const subCount = running && Array.isArray(block.subCalls) ? block.subCalls.length : 0
        const argsRaw = running ? (block.argsRaw || '') : (block.call && block.call.argsRaw) || ''
        let mode = ''
        try { const a = JSON.parse(argsRaw); if (a && a.mode) mode = String(a.mode) } catch (e) { /* ignore */ }
        const rv = !running && block.resultView ? block.resultView : null
        let title = 'orchestrate' + (mode ? ' (' + mode + ')' : '')
        if (rv && rv.title) title = rv.title
        const statusText = running
          ? t('orch.cardRunning', { n: subCount })
          : (block.isError ? t('orch.cardError') : t('orch.cardDone'))
        const content = (!running && rv && rv.content) ? rv.content : (!running ? block.content : null)
        const text = (content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        return React.createElement('div', { className: 'hao-run-card' },
          React.createElement('div', { className: 'hao-run-card-head' },
            React.createElement('span', { className: 'hao-run-card-title' }, title),
            React.createElement('span', {
              className: 'hao-badge ' + (running ? '' : (block.isError ? 'hao-badge-off' : 'hao-badge-on')),
            }, statusText),
          ),
          text ? React.createElement('pre', { className: 'hao-pre hao-run-card-body' }, text) : null,
        )
      }

      // ================= 注册 UI =================
      // 分区标签用 thunk（resolveSlotLabel 渲染时求值，跟随当前语言字典）；
      // 语言切换后重注册分区，让设置侧栏标签立即刷新（重注册 = 槽位变更 -> 侧栏重渲染）
      let sectionDispose = null
      function registerSection() {
        try { if (sectionDispose) sectionDispose() } catch (e) { /* ignore */ }
        sectionDispose = slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-ha-orchestrator', order: 12, label: () => t('section.label') },
          () => React.createElement(HaPage, { onI18nChanged }),
        ))
      }
      let lastSectionLang = ''
      function onI18nChanged() {
        if (lastSectionLang === __i18n.active) return
        lastSectionLang = __i18n.active
        registerSection()
      }
      registerSection()
      slots.inject('tool.view.cordis', () => slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        () => React.createElement(HaStatusCard),
      ))
      // 对话内 Run 卡片：orchestrate 调用的 keyed toolview（key 域开放，任意工具名）
      slots.inject('tool.call.toolview', () => slots.register(
        { name: 'tool.call.toolview', key: 'orchestrate' },
        (props) => React.createElement(RunCard, { block: props.block }),
      ))
    }

    // Cordis service injection for the plugin fiber. IMPORTANT: only services
    // that already exist before this plugin activates may be listed — the boot
    // assertEntriesActive() keeps a pending fiber (and fails the whole boot)
    // while any inject entry is missing. `remote.haOrchestrator` is mounted by
    // our own apply, so it must NOT be injected; the rpc helper reaches it via
    // ctx.get('remote.haOrchestrator') after the mount promise resolves.
    exports.inject = ['slots', 'remote']
    exports.apply = apply
    return module.exports
  },
})
