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
    // 设计原则：所有颜色取 DSH 主题别名变量（dsw-alias，自动适配浅/深色），
    // 局部令牌（间距/圆角/字号）集中在 .hao-page 上；状态色同时用「色点 + 文字」
    // 双重编码，动画尊重 prefers-reduced-motion。
    const STYLES = `
/* ---- 局部设计令牌：设置页与对话内卡片（RunCard/胶囊）共用，
       后者渲染在 .hao-page 之外，故在所有根容器上重复定义 ---- */
.hao-page, .hao-run, .hao-run-card, .hao-capsule, .hao-capsule-panel, .hao-subagent-anchor {
  --hao-border: var(--dsw-alias-border-l1, rgba(127,127,127,.28));
  --hao-border-strong: var(--dsw-alias-border-l2, rgba(127,127,127,.45));
  --hao-bg: var(--dsw-alias-bg-layer-1, transparent);
  --hao-bg-inset: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.09));
  --hao-bg-hover: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.07));
  --hao-label: var(--dsw-alias-label-primary, inherit);
  --hao-label-2: var(--dsw-alias-label-secondary, rgba(127,127,127,.85));
  --hao-label-3: var(--dsw-alias-label-tertiary, rgba(127,127,127,.65));
  --hao-brand: var(--dsw-alias-state-business-primary, var(--dsw-static-deepseek-450, #4d6bfe));
  --hao-ok: var(--dsw-alias-state-success-primary, #30a46c);
  --hao-warn: var(--dsw-alias-state-warning-primary, #f5a524);
  --hao-err: var(--dsw-alias-state-error-primary, #e5484d);
  --hao-radius-s: 6px; --hao-radius-m: 8px; --hao-radius-l: 12px;
  --hao-gap-s: 6px; --hao-gap: 10px; --hao-gap-l: 14px;
  --hao-shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px -8px rgba(0,0,0,.08);
  --hao-mono: ui-monospace, SFMono-Regular, Consolas, Menlo, monospace;
}
.hao-page { display: flex; flex-direction: column; gap: var(--hao-gap-l); padding: 4px 2px 20px; font-size: 13px; color: var(--hao-label); }
/* ---- 卡片 ---- */
.hao-card { border: 1px solid var(--hao-border); border-radius: var(--hao-radius-l); background: var(--hao-bg); overflow: hidden; box-shadow: var(--hao-shadow); }
.hao-card-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--hao-border); }
.hao-card-head-click { cursor: pointer; user-select: none; transition: background .15s ease; }
.hao-card-head-click:hover { background: var(--hao-bg-hover); }
.hao-card-ico { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--hao-radius-m); flex: none; color: var(--hao-brand); background: color-mix(in srgb, var(--hao-brand) 12%, transparent); }
.hao-card-titlewrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.hao-card-title { font-weight: 650; font-size: 14px; color: var(--hao-label); letter-spacing: .1px; }
.hao-card-sub { font-size: 11px; color: var(--hao-label-2); margin-top: 1px; }
.hao-card-actions { display: inline-flex; align-items: center; gap: 6px; }
.hao-chevron { display: inline-flex; color: var(--hao-label-3); transition: transform .18s ease; flex: none; }
.hao-chevron.open { transform: rotate(90deg); }
.hao-card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: var(--hao-gap); }
/* ---- 行式表单 ---- */
.hao-row { display: flex; align-items: center; gap: var(--hao-gap-l); min-height: 32px; }
.hao-row-label { flex: 0 0 176px; display: flex; flex-direction: column; gap: 2px; }
.hao-row-label > span:first-child { color: var(--hao-label); font-weight: 500; }
.hao-row-hint { font-size: 11px; color: var(--hao-label-3); line-height: 1.4; }
.hao-row-ctrl { flex: 1; display: flex; align-items: center; gap: var(--hao-gap-s); flex-wrap: wrap; min-width: 0; }
.hao-section { margin-top: 2px; font-size: 11.5px; font-weight: 600; letter-spacing: .4px; text-transform: uppercase; color: var(--hao-label-3); }
.hao-section.hao-plain { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--hao-label-2); }
/* ---- 输入控件 ---- */
.hao-input { background: var(--hao-bg-inset); border: 1px solid var(--hao-border); color: var(--hao-label); border-radius: var(--hao-radius-s); padding: 5px 9px; font-size: 13px; min-width: 60px; transition: border-color .15s ease, box-shadow .15s ease; }
.hao-input:hover { border-color: var(--hao-border-strong); }
.hao-input:focus { outline: none; border-color: var(--hao-brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--hao-brand) 22%, transparent); }
.hao-mono { font-family: var(--hao-mono); font-size: 12px; }
/* ---- 按钮 ---- */
.hao-btn { display: inline-flex; align-items: center; gap: 5px; background: var(--hao-bg-inset); border: 1px solid var(--hao-border); color: var(--hao-label); border-radius: var(--hao-radius-s); padding: 4px 11px; font-size: 12px; cursor: pointer; transition: border-color .15s ease, background .15s ease, transform .06s ease; }
.hao-btn:hover { border-color: var(--hao-border-strong); background: var(--hao-bg-hover); }
.hao-btn:active { transform: translateY(1px); }
.hao-btn:disabled { opacity: .45; cursor: default; transform: none; }
.hao-btn-primary { background: var(--dsw-alias-button-primary-fill, var(--hao-brand)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.hao-btn-primary:hover { background: var(--dsw-alias-button-primary-hover, var(--hao-brand)); border-color: transparent; }
.hao-btn-primary:disabled { background: color-mix(in srgb, var(--hao-label-3) 18%, transparent); color: var(--hao-label-2); border-color: transparent; }
.hao-btn-danger { color: var(--hao-err); }
.hao-btn-danger:hover { border-color: var(--hao-err); background: color-mix(in srgb, var(--hao-err) 9%, transparent); }
.hao-btn-mini { padding: 2px 7px; font-size: 11px; }
/* ---- 开关 ---- */
.hao-toggle { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; }
.hao-toggle input { accent-color: var(--dsw-alias-brand-primary, var(--hao-brand)); width: 15px; height: 15px; cursor: pointer; }
/* ---- 徽章：软底色 + 色点（颜色非唯一信息载体） ---- */
.hao-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11px; background: var(--hao-bg-inset); color: var(--hao-label-2); border: 1px solid transparent; white-space: nowrap; }
.hao-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hao-label-3); flex: none; }
.hao-badge-on { background: color-mix(in srgb, var(--hao-ok) 13%, transparent); color: var(--hao-ok); }
.hao-badge-on .hao-dot { background: var(--hao-ok); }
.hao-badge-off { background: color-mix(in srgb, var(--hao-err) 12%, transparent); color: var(--hao-err); }
.hao-badge-off .hao-dot { background: var(--hao-err); }
.hao-badge-warn { background: color-mix(in srgb, var(--hao-warn) 15%, transparent); color: var(--hao-warn); }
.hao-badge-warn .hao-dot { background: var(--hao-warn); }
.hao-badge-info { background: color-mix(in srgb, var(--hao-brand) 12%, transparent); color: var(--hao-brand); }
.hao-badge-info .hao-dot { background: var(--hao-brand); }
.hao-badge-muted { background: transparent; border-color: var(--hao-border); }
/* ---- 表格 ---- */
.hao-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.hao-table th { text-align: left; padding: 6px 9px; color: var(--hao-label-3); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; border-bottom: 1px solid var(--hao-border-strong); }
.hao-table td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--hao-border); }
.hao-table tbody tr:last-child td { border-bottom: none; }
.hao-table tbody tr:nth-child(even) { background: color-mix(in srgb, var(--hao-label-3) 4%, transparent); }
.hao-table tbody tr { transition: background .12s ease; }
.hao-table tbody tr:hover { background: var(--hao-bg-hover); }
/* ---- 代码块 / 文本域 ---- */
.hao-pre { white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto; background: var(--hao-bg-inset); border: 1px solid var(--hao-border); border-radius: var(--hao-radius-m); padding: 10px 12px; font-size: 12px; font-family: var(--hao-mono); line-height: 1.55; }
.hao-textarea { background: var(--hao-bg-inset); border: 1px solid var(--hao-border); color: var(--hao-label); border-radius: var(--hao-radius-s); padding: 7px 9px; font-size: 12px; font-family: var(--hao-mono); resize: vertical; width: 100%; box-sizing: border-box; transition: border-color .15s ease, box-shadow .15s ease; }
.hao-textarea:hover { border-color: var(--hao-border-strong); }
.hao-textarea:focus { outline: none; border-color: var(--hao-brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--hao-brand) 22%, transparent); }
.hao-error { color: var(--hao-err); font-size: 12px; }
.hao-err { color: var(--hao-err); font-size: 12px; }
.hao-ok { color: var(--hao-ok); font-size: 12px; }
/* ---- 空状态 ---- */
.hao-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 14px 16px; border: 1px dashed var(--hao-border-strong); border-radius: var(--hao-radius-m); color: var(--hao-label-2); font-size: 12px; background: color-mix(in srgb, var(--hao-label-3) 3%, transparent); }
.hao-empty-title { display: flex; align-items: center; gap: 7px; color: var(--hao-label); font-weight: 600; font-size: 12.5px; }
.hao-empty-ico { color: var(--hao-label-3); display: inline-flex; }
.hao-empty-actions { display: flex; gap: 8px; flex-wrap: wrap; }
/* ---- 备份模型结构化行 ---- */
.hao-bk { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--hao-border); border-radius: var(--hao-radius-m); background: var(--hao-bg); transition: border-color .15s ease, background .15s ease; flex-wrap: wrap; }
.hao-bk:hover { border-color: var(--hao-border-strong); background: var(--hao-bg-hover); }
.hao-bk-idx { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 650; color: var(--hao-brand); background: color-mix(in srgb, var(--hao-brand) 11%, transparent); flex: none; }
.hao-bk-label { font-weight: 600; font-size: 12.5px; color: var(--hao-label); min-width: 0; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-bk-key { display: inline-flex; align-items: center; gap: 4px; font-family: var(--hao-mono); font-size: 11.5px; color: var(--hao-label-2); background: var(--hao-bg-inset); border-radius: var(--hao-radius-s); padding: 2px 8px; }
.hao-bk-ops { display: inline-flex; gap: 3px; margin-left: auto; opacity: .55; transition: opacity .15s ease; }
.hao-bk:hover .hao-bk-ops, .hao-bk:focus-within .hao-bk-ops { opacity: 1; }
.hao-bk-edit { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; padding-top: 8px; margin-top: 8px; border-top: 1px dashed var(--hao-border); }
/* ---- 概览横幅 ---- */
.hao-hero { display: flex; align-items: stretch; gap: 0; border: 1px solid var(--hao-border); border-radius: var(--hao-radius-l); background: var(--hao-bg); box-shadow: var(--hao-shadow); overflow: hidden; flex-wrap: wrap; }
.hao-hero-cell { flex: 1 1 150px; display: flex; flex-direction: column; gap: 3px; padding: 13px 16px; min-width: 140px; }
.hao-hero-cell + .hao-hero-cell { border-left: 1px solid var(--hao-border); }
.hao-hero-k { font-size: 11px; color: var(--hao-label-3); display: flex; align-items: center; gap: 5px; }
.hao-hero-v { font-size: 13px; color: var(--hao-label); font-weight: 600; display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
.hao-hero-v .hao-mono { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
/* ---- 子智能体条目 ---- */
.hao-agent { border: 1px solid var(--hao-border); border-radius: var(--hao-radius-m); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; transition: border-color .15s ease, background .15s ease; }
.hao-agent.is-editing { border-color: var(--hao-brand); background: color-mix(in srgb, var(--hao-brand) 5%, transparent); }
.hao-agent:hover { border-color: var(--hao-border-strong); background: color-mix(in srgb, var(--hao-label-3) 3%, transparent); }
.hao-agent-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.hao-avatar { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; font-size: 12px; font-weight: 700; color: #fff; background: hsl(var(--hao-h, 220) 62% 52%); flex: none; user-select: none; }
.hao-agent-name { font-weight: 650; font-size: 13px; }
.hao-agent-desc { font-size: 12px; color: var(--hao-label-2); line-height: 1.5; }
.hao-agent-sp { font-size: 11px; color: var(--hao-label-3); white-space: pre-wrap; word-break: break-word; max-height: 60px; overflow: auto; font-family: var(--hao-mono); background: var(--hao-bg-inset); border-radius: var(--hao-radius-s); padding: 6px 8px; }
.hao-agent-ops { display: inline-flex; gap: 3px; margin-left: auto; opacity: .55; transition: opacity .15s ease; }
.hao-agent:hover .hao-agent-ops, .hao-agent:focus-within .hao-agent-ops { opacity: 1; }
.hao-autocomplete { position: relative; flex: 1 1 240px; min-width: 220px; }
.hao-autocomplete .hao-input { width: 100%; }
.hao-autocomplete-menu { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0; max-height: 220px; overflow-y: auto; padding: 4px; border: 1px solid var(--hao-border-strong); border-radius: var(--hao-radius-s); background: var(--hao-bg); box-shadow: var(--hao-shadow); }
.hao-autocomplete-item { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 10px; padding: 7px 8px; border: 0; border-radius: var(--hao-radius-s); color: var(--hao-label); background: transparent; text-align: left; cursor: pointer; font: inherit; }
.hao-autocomplete-item:hover, .hao-autocomplete-item:focus-visible { background: var(--hao-bg-hover); outline: none; }
.hao-autocomplete-value { font-family: var(--hao-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-autocomplete-name { flex: none; color: var(--hao-label-3); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-autocomplete-empty { padding: 8px; color: var(--hao-label-3); font-size: 11px; }
/* ---- 表单 ---- */
.hao-form { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--hao-border); border-radius: var(--hao-radius-m); padding: 12px; background: color-mix(in srgb, var(--hao-label-3) 3%, transparent); }
.hao-form-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hao-form-label { flex: 0 0 90px; font-size: 12px; color: var(--hao-label-2); }
/* ---- Run 历史（诊断卡内，可展开条目） ---- */
.hao-runitem { border: 1px solid var(--hao-border); border-radius: var(--hao-radius-m); overflow: hidden; }
.hao-runitem + .hao-runitem { margin-top: 8px; }
.hao-runitem-head { display: flex; align-items: center; gap: 9px; padding: 8px 12px; cursor: pointer; user-select: none; transition: background .12s ease; flex-wrap: wrap; }
.hao-runitem-head:hover { background: var(--hao-bg-hover); }
.hao-runitem-body { padding: 4px 12px 10px; border-top: 1px dashed var(--hao-border); }
.hao-runitem-meta { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--hao-label-3); }
/* ---- 对话内 Run 卡片 ---- */
.hao-run { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--hao-label-2); padding: 2px 0; flex-wrap: wrap; }
.hao-run-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hao-err); flex: none; }
.hao-run-dot.on { background: var(--hao-ok); }
.hao-run-last { font-size: 11px; opacity: .8; }
.hao-run-card { border: 1px solid var(--hao-border); border-radius: var(--hao-radius-m); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; background: var(--hao-bg); }
.hao-run-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hao-run-card-title { font-weight: 650; font-size: 13px; flex: 1; display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.hao-run-card-body { margin: 0; max-height: 180px; }
.hao-orch-progress { height: 7px; border-radius: 999px; background: var(--hao-bg-inset); overflow: hidden; position: relative; }
.hao-orch-progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, color-mix(in srgb, var(--hao-brand) 72%, var(--hao-ok)), var(--hao-brand)); transition: width .3s ease; }
.hao-orch-progress-fill::after { content: ''; position: absolute; inset: 0; background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.16) 0 5px, transparent 5px 10px); animation: hao-slide .7s linear infinite; }
.hao-orch-stats { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hao-orch-tasks { display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow: auto; }
.hao-orch-task { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 6px; border-radius: var(--hao-radius-s); transition: background .12s ease; }
.hao-orch-task:hover { background: var(--hao-bg-hover); }
.hao-orch-task-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--hao-label-3); }
.hao-orch-task-dot.running { background: var(--hao-brand); animation: hao-pulse 1s ease-in-out infinite; }
.hao-orch-task-dot.done { background: var(--hao-ok); }
.hao-orch-task-dot.error { background: var(--hao-err); }
.hao-orch-task-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--hao-label); }
.hao-orch-task-agent { font-size: 11px; color: var(--hao-label-2); flex: none; }
.hao-orch-task-lastkey { font-size: 11px; color: var(--hao-label-3); flex: none; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-orch-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.hao-orch-table th, .hao-orch-table td { text-align: left; padding: 4px 7px; border-bottom: 1px solid var(--hao-border); }
.hao-orch-table th { color: var(--hao-label-3); font-weight: 600; }
/* ---- HA 状态胶囊（对话工具区，可展开） ---- */
.hao-capsule { border: 1px solid var(--hao-border); border-radius: 999px; background: var(--hao-bg); display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 10px; font-size: 12px; cursor: pointer; user-select: none; transition: border-color .15s ease, background .15s ease; }
.hao-capsule:hover { border-color: var(--hao-border-strong); background: var(--hao-bg-hover); }
.hao-capsule-panel { border: 1px solid var(--hao-border); border-radius: var(--hao-radius-l); background: var(--hao-bg); box-shadow: var(--hao-shadow); padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; max-width: 420px; }
.hao-capsule-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--hao-label-2); }
.hao-capsule-kv { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px dashed var(--hao-border); }
.hao-capsule-kv:last-child { border-bottom: none; }
/* ---- 页面内子代理悬浮入口与详情面板 ---- */
.hao-subagent-anchor { position: fixed; right: 20px; bottom: 84px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none; font-size: 12px; color: var(--hao-label); }
.hao-subagent-anchor > * { pointer-events: auto; }
.hao-subagent-fab { display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 13px 0 10px; border: 1px solid var(--hao-border-strong); border-radius: 999px; background: var(--hao-bg); color: var(--hao-label); box-shadow: 0 8px 24px rgba(0,0,0,.18); cursor: pointer; font: inherit; transition: border-color .15s ease, background .15s ease, transform .12s ease, box-shadow .15s ease; }
.hao-subagent-fab:hover { border-color: var(--hao-state); background: var(--hao-bg-hover); transform: translateY(-1px); box-shadow: 0 10px 28px rgba(0,0,0,.24); }
.hao-subagent-fab:active { transform: translateY(0); }
.hao-subagent-fab-running { --hao-state: var(--hao-warn); border-color: color-mix(in srgb, var(--hao-warn) 55%, var(--hao-border-strong)); }
.hao-subagent-fab-done { --hao-state: var(--hao-ok); border-color: color-mix(in srgb, var(--hao-ok) 55%, var(--hao-border-strong)); }
.hao-subagent-fab-error { --hao-state: var(--hao-err); border-color: color-mix(in srgb, var(--hao-err) 55%, var(--hao-border-strong)); }
.hao-subagent-fab-idle { --hao-state: var(--hao-label-3); }
.hao-subagent-fab-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hao-state); flex: none; }
.hao-subagent-fab-running .hao-subagent-fab-dot { animation: hao-pulse 1.2s ease-in-out infinite; }
.hao-subagent-fab-count { min-width: 20px; padding: 2px 6px; border-radius: 999px; background: color-mix(in srgb, var(--hao-state) 15%, transparent); color: var(--hao-state); font-size: 11px; font-family: var(--hao-mono); text-align: center; }
.hao-subagent-panel { width: 364px; max-width: min(364px, calc(100vw - 24px)); max-height: min(560px, calc(100dvh - 148px)); overflow: hidden; display: flex; flex-direction: column; gap: 9px; padding: 11px; border: 1px solid var(--hao-border-strong); border-radius: var(--hao-radius-l); background: var(--hao-bg); box-shadow: 0 16px 42px rgba(0,0,0,.28); }
.hao-subagent-panel-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.hao-subagent-panel-ico { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--hao-radius-m); flex: none; color: var(--hao-brand); background: color-mix(in srgb, var(--hao-brand) 13%, transparent); }
.hao-subagent-panel-heading { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.hao-subagent-panel-title { color: var(--hao-label); font-weight: 650; font-size: 13px; }
.hao-subagent-panel-sub { color: var(--hao-label-3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-subagent-panel-tools { display: inline-flex; align-items: center; gap: 3px; flex: none; }
.hao-subagent-tool { display: inline-flex; align-items: center; justify-content: center; width: 27px; height: 27px; padding: 0; border: 1px solid transparent; border-radius: var(--hao-radius-s); background: transparent; color: var(--hao-label-2); cursor: pointer; }
.hao-subagent-tool:hover { border-color: var(--hao-border); background: var(--hao-bg-hover); color: var(--hao-label); }
.hao-subagent-breadcrumbs { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 1px 2px 0; color: var(--hao-label-2); font-size: 11px; }
.hao-subagent-breadcrumb-back { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 1px solid var(--hao-border); border-radius: var(--hao-radius-s); background: transparent; color: var(--hao-label-2); cursor: pointer; flex: none; }
.hao-subagent-breadcrumb-back:hover { border-color: var(--hao-border-strong); background: var(--hao-bg-hover); color: var(--hao-label); }
.hao-subagent-breadcrumb-back:disabled { opacity: .35; cursor: default; }
.hao-subagent-breadcrumb { min-width: 0; max-width: 116px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 5px; border: 0; border-radius: var(--hao-radius-s); background: transparent; color: var(--hao-label-2); cursor: pointer; font: inherit; text-align: left; }
.hao-subagent-breadcrumb:hover { background: var(--hao-bg-hover); color: var(--hao-label); }
.hao-subagent-breadcrumb-current { min-width: 0; max-width: 142px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--hao-label); font-weight: 600; }
.hao-subagent-breadcrumb-sep { color: var(--hao-label-3); flex: none; }
.hao-subagent-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border: 1px solid var(--hao-border); border-radius: var(--hao-radius-m); background: color-mix(in srgb, var(--hao-label-3) 4%, transparent); }
.hao-subagent-summary-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hao-subagent-summary-title { color: var(--hao-label); font-weight: 600; }
.hao-subagent-summary-sub { color: var(--hao-label-3); font-size: 11px; }
.hao-subagent-panel-error { padding: 6px 8px; border-radius: var(--hao-radius-s); color: var(--hao-err); background: color-mix(in srgb, var(--hao-err) 10%, transparent); font-size: 11px; }
.hao-subagent-list { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 1px 2px 1px 0; }
.hao-subagent-row { --hao-item-state: var(--hao-label-3); display: flex; flex: 0 0 auto; flex-direction: column; gap: 0; width: 100%; box-sizing: border-box; padding: 8px 9px 7px 10px; border: 1px solid color-mix(in srgb, var(--hao-item-state) 28%, var(--hao-border)); border-left: 3px solid var(--hao-item-state); border-radius: var(--hao-radius-m); background: color-mix(in srgb, var(--hao-item-state) 7%, var(--hao-bg)); color: var(--hao-label); text-align: left; font: inherit; cursor: pointer; overflow: hidden; transition: border-color .14s ease, background .14s ease, transform .1s ease; }
.hao-subagent-row-running { --hao-item-state: var(--hao-warn); }
.hao-subagent-row-completed { --hao-item-state: var(--hao-ok); }
.hao-subagent-row-error { --hao-item-state: var(--hao-err); }
.hao-subagent-row-pending { --hao-item-state: var(--hao-label-3); }
.hao-subagent-row:hover { border-color: color-mix(in srgb, var(--hao-item-state) 58%, var(--hao-border-strong)); background: color-mix(in srgb, var(--hao-item-state) 12%, var(--hao-bg)); transform: translateY(-1px); }
.hao-subagent-row:active { transform: translateY(0); }
.hao-subagent-row-main { display: flex; flex: none; align-items: stretch; flex-direction: column; gap: 7px; width: 100%; min-width: 0; min-height: 0; height: auto; max-height: none; box-sizing: border-box; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; line-height: normal; cursor: pointer; appearance: none; -webkit-appearance: none; overflow: visible; }
.hao-subagent-row-main:focus-visible, .hao-subagent-children-bar:focus-visible { outline: 2px solid var(--hao-brand); outline-offset: 1px; }
.hao-subagent-row-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.hao-subagent-role-ico { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; border-radius: var(--hao-radius-s); flex: none; color: var(--hao-brand); background: color-mix(in srgb, var(--hao-brand) 11%, transparent); }
.hao-subagent-row-title { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.hao-subagent-row-label { color: var(--hao-label); font-weight: 650; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-subagent-row-agent { color: var(--hao-label-2); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-subagent-status { display: inline-flex; align-items: center; gap: 5px; flex: none; padding: 2px 6px; border-radius: 999px; font-size: 10px; white-space: nowrap; }
.hao-subagent-status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.hao-subagent-status-running { color: var(--hao-warn); background: color-mix(in srgb, var(--hao-warn) 13%, transparent); }
.hao-subagent-status-running .hao-subagent-status-dot { animation: hao-pulse 1.1s ease-in-out infinite; }
.hao-subagent-status-completed { color: var(--hao-ok); background: color-mix(in srgb, var(--hao-ok) 12%, transparent); }
.hao-subagent-status-error { color: var(--hao-err); background: color-mix(in srgb, var(--hao-err) 11%, transparent); }
.hao-subagent-status-pending { color: var(--hao-label-3); background: color-mix(in srgb, var(--hao-label-3) 9%, transparent); }
.hao-subagent-child-count { display: inline-flex; align-items: center; gap: 4px; flex: none; padding: 2px 6px; border: 1px solid color-mix(in srgb, var(--hao-brand) 24%, transparent); border-radius: 999px; color: var(--hao-brand); background: color-mix(in srgb, var(--hao-brand) 10%, transparent); font-size: 10px; white-space: nowrap; }
.hao-subagent-row:not(.hao-subagent-row-parent) .hao-subagent-child-count { border-color: transparent; color: var(--hao-label-3); background: color-mix(in srgb, var(--hao-label-3) 8%, transparent); }
.hao-subagent-row-desc { color: var(--hao-label-2); font-size: 11px; line-height: 1.4; display: -webkit-box; width: 100%; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.hao-subagent-row-meta { display: flex; flex: none; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 19px; box-sizing: border-box; padding-top: 5px; border-top: 1px solid color-mix(in srgb, var(--hao-item-state) 18%, transparent); color: var(--hao-label-3); font-size: 10px; line-height: 1.2; }
.hao-subagent-row-model, .hao-subagent-row-tokens { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.hao-subagent-row-model { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--hao-mono); }
.hao-subagent-row-tokens { flex: none; font-family: var(--hao-mono); }
.hao-subagent-row-actions { display: block; width: 100%; min-height: 0; margin: 6px 0 0; }
.hao-subagent-children-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 25px; box-sizing: border-box; padding: 5px 9px 5px 12px; border: 1px solid color-mix(in srgb, var(--hao-item-state) 32%, transparent); border-radius: var(--hao-radius-s); background: color-mix(in srgb, var(--hao-item-state) 10%, transparent); color: var(--hao-item-state); cursor: pointer; font: inherit; font-size: 10.5px; text-align: left; transition: background .14s ease, color .14s ease; }
.hao-subagent-children-bar > span { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hao-subagent-children-bar > svg { flex: none; }
.hao-subagent-children-bar:hover { background: color-mix(in srgb, var(--hao-item-state) 18%, transparent); color: var(--hao-label); }
.hao-subagent-empty { display: flex; align-items: center; gap: 8px; min-height: 72px; padding: 10px; border: 1px dashed var(--hao-border-strong); border-radius: var(--hao-radius-m); color: var(--hao-label-2); }
.hao-subagent-empty-ico { display: inline-flex; color: var(--hao-label-3); }
.hao-subagent-more { padding: 2px 3px 0; color: var(--hao-label-3); font-size: 11px; text-align: center; }
.hao-subagent-panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 2px; color: var(--hao-label-3); font-size: 10.5px; }
.hao-subagent-skeleton { height: 62px; border-radius: var(--hao-radius-m); background: linear-gradient(90deg, color-mix(in srgb, var(--hao-label-3) 6%, transparent), color-mix(in srgb, var(--hao-label-3) 13%, transparent), color-mix(in srgb, var(--hao-label-3) 6%, transparent)); background-size: 200% 100%; animation: hao-skeleton 1.2s ease-in-out infinite; }
@keyframes hao-skeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
/* ---- 动画与可访问性 ---- */
@keyframes hao-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes hao-slide { to { background-position: 14px 0; } }
@keyframes hao-spin { to { transform: rotate(360deg); } }
.hao-spin { animation: hao-spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .hao-chevron, .hao-btn, .hao-bk, .hao-agent, .hao-table tbody tr, .hao-orch-progress-fill, .hao-runitem-head, .hao-subagent-fab, .hao-subagent-row, .hao-subagent-children-bar { transition: none; }
  .hao-orch-task-dot.running, .hao-spin, .hao-subagent-fab-running .hao-subagent-fab-dot, .hao-subagent-status-running .hao-subagent-status-dot, .hao-subagent-skeleton { animation: none; }
  .hao-orch-progress-fill::after { animation: none; }
}
.hao-btn:focus-visible, .hao-input:focus-visible, .hao-textarea:focus-visible, .hao-card-head-click:focus-visible, .hao-capsule:focus-visible, .hao-runitem-head:focus-visible, .hao-subagent-fab:focus-visible, .hao-subagent-row:focus-visible, .hao-subagent-tool:focus-visible, .hao-subagent-children-bar:focus-visible { outline: 2px solid var(--hao-brand); outline-offset: 1px; }
.hao-card-head-click:focus-visible { outline-offset: -2px; }
@media (max-width: 640px) {
  .hao-subagent-anchor { right: 10px; bottom: 72px; }
  .hao-subagent-panel { width: calc(100vw - 20px); max-width: calc(100vw - 20px); max-height: calc(100dvh - 132px); }
  .hao-subagent-fab { min-height: 36px; padding-right: 11px; }
}
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
    let __i18n = { active: 'zh', dict: { 'section.label': 'HA 与编排', 'subagent.title': '子代理', 'subagent.running': '正在运行', 'subagent.recentDone': '最近已完成', 'subagent.idle': '没有正在运行的子代理' }, mode: 'auto', dshLocale: null, rollback: false, rollbackReason: '', dicts: { zh: false, en: false } }
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
          id: 'dsh-ha-orchestrator#haOrchestrator/orchRecent',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'orchRecent',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#OrchRecentArgs', schema: pass } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#OrchRecent', schema: pass },
        },
        {
          id: 'dsh-ha-orchestrator#haOrchestrator/orchActive',
          service: 'haOrchestrator',
          namespace: 'haOrchestrator',
          method: 'orchActive',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-ha-orchestrator#OrchActive', schema: pass },
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
        const fn = ns && ns[method]
        // Host 端方法未注册/名称漂移时给出含方法名的可诊断错误，而非裸 TypeError
        if (typeof fn !== 'function') {
          throw new Error('unknown rpc method: ' + method + (ns ? '' : ' (namespace remote.haOrchestrator missing)'))
        }
        const pending = args === undefined ? fn.call(ns) : fn.call(ns, args)
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
        orchRecent: (a) => call('orchRecent', a || {}),
        orchActive: () => call('orchActive'),
        orchListPresets: () => call('orchListPresets'),
        orchSavePreset: (a) => call('orchSavePreset', a),
        orchDeletePreset: (a) => call('orchDeletePreset', a),
        debugLogs: () => call('debugLogs'),
        debugClear: () => call('debugClear'),
      }

      // ================= 小组件 =================
      // ---- 图标集（feather 风格内联 SVG，stroke=currentColor，随主题变色） ----
      const ICONS = {
        shield: ['M12 3l7 3v5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3z'],
        flow: ['M12 3v4.5', 'M12 7.5L5.5 12', 'M12 7.5L18.5 12', 'M5.5 12v3.5', 'M18.5 12v3.5', 'M4 18.5h3', 'M17 18.5h3'],
        bot: ['M8.5 8.5h7a3 3 0 013 3v3.5a3 3 0 01-3 3h-7a3 3 0 01-3-3v-3.5a3 3 0 013-3z', 'M12 8.5V6', 'M12 3.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4', 'M9.7 12.2v1.3', 'M14.3 12.2v1.3'],
        pulse: ['M3 12h4l2.5-6 4 12 2.5-6h5'],
        sliders: ['M4 7h8', 'M17 7h3', 'M14.5 4.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4', 'M4 17h3', 'M12 17h8', 'M9.5 14.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4'],
        chevronR: ['M9 5l7 7-7 7'],
        chevronL: ['M15 5l-7 7 7 7'],
        check: ['M4.5 12.5l5 5 10-11'],
        x: ['M6 6l12 12', 'M18 6L6 18'],
        clock: ['M12 4a8 8 0 100 16 8 8 0 000-16', 'M12 8v4.5l3 2'],
        zap: ['M13 2L4.5 13.5H11L10 22l8.5-11.5H13z'],
        db: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
        up: ['M12 19V5', 'M5.5 11.5L12 5l6.5 6.5'],
        down: ['M12 5v14', 'M5.5 12.5L12 19l6.5-6.5'],
        trash: ['M4 7h16', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13', 'M10 11v5', 'M14 11v5'],
        edit: ['M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17l-1 4z', 'M13.5 8.5l3 3'],
        plus: ['M12 5v14', 'M5 12h14'],
        sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M18.6 15.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z'],
        refresh: ['M20 5v5h-5', 'M19.4 10a8 8 0 10.6 3'],
        fork: ['M12 3v5', 'M12 8l-6 5v4', 'M12 8l6 5v4'],
        pipeline: ['M3 9.5h4v5H3z', 'M10 9.5h4v5h-4z', 'M17 9.5h4v5h-4z', 'M7 12h3', 'M14 12h3'],
        eye: ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z', 'M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5'],
        layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
        globe: ['M12 4a8 8 0 100 16 8 8 0 000-16', 'M4 12h16', 'M12 4c2.5 2.3 3.8 5 3.8 8s-1.3 5.7-3.8 8c-2.5-2.3-3.8-5-3.8-8S9.5 6.3 12 4z'],
        download: ['M12 4v11', 'M7.5 11l4.5 4.5L16.5 11', 'M5 19.5h14'],
        upload: ['M12 15V4', 'M7.5 8L12 3.5 16.5 8', 'M5 19.5h14'],
        info: ['M12 4a8 8 0 100 16 8 8 0 000-16', 'M12 11v5', 'M12 8v.01'],
        run: ['M6 4.5l13 7.5-13 7.5z'],
      }
      function Icon(props) {
        const paths = ICONS[props.name] || ICONS.info
        const size = props.size || 14
        return React.createElement('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': true,
          className: props.spin ? 'hao-spin' : undefined,
        }, paths.map((d, i) => React.createElement('path', { key: i, d: d })))
      }
      // 编排模式 -> 图标名
      function modeIcon(mode) {
        if (mode === 'pipeline') return 'pipeline'
        if (mode === 'supervisor') return 'eye'
        if (mode === 'map-reduce') return 'layers'
        if (mode === 'router') return 'fork'
        return 'fork'
      }
      // ---- 徽章：软底色 + 色点（kind: on/off/warn/info/muted） ----
      function Badge(props) {
        return React.createElement('span', {
          className: 'hao-badge' + (props.kind ? ' hao-badge-' + props.kind : '') + (props.muted ? ' hao-badge-muted' : ''),
          title: props.title,
        }, props.dot === false ? null : React.createElement('span', { className: 'hao-dot' }), props.children)
      }
      // ---- 空状态：图示 + 标题 + 引导动作 ----
      function EmptyState(props) {
        return React.createElement('div', { className: 'hao-empty' },
          React.createElement('span', { className: 'hao-empty-title' },
            React.createElement('span', { className: 'hao-empty-ico' }, React.createElement(Icon, { name: props.icon || 'info', size: 15 })),
            props.title),
          props.desc ? React.createElement('div', { style: { lineHeight: 1.5 } }, props.desc) : null,
          props.actions ? React.createElement('div', { className: 'hao-empty-actions' }, props.actions) : null)
      }
      // ---- 首字母头像：按名字 hash 取色相，风格统一且有兜底 ----
      function Avatar(props) {
        const name = String(props.name || '?')
        let h = 0
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
        return React.createElement('span', { className: 'hao-avatar', style: { '--hao-h': String(h) } }, name.slice(0, 1).toUpperCase())
      }
      // ---- 时间格式化 ----
      function fmtDuration(ms) {
        const v = Math.max(0, Number(ms) || 0)
        if (v < 1000) return v + 'ms'
        if (v < 60000) return (v / 1000).toFixed(1) + 's'
        const m = Math.floor(v / 60000)
        const s = Math.round((v % 60000) / 1000)
        return m + 'm' + (s < 10 ? '0' : '') + s + 's'
      }
      function fmtCountdown(ms) {
        const v = Math.max(0, Math.round((Number(ms) || 0) / 1000))
        if (v < 60) return v + 's'
        return Math.floor(v / 60) + 'm' + String(v % 60).padStart(2, '0') + 's'
      }
      function fmtTime(iso) {
        const s = String(iso || '')
        return s.length >= 19 ? s.slice(5, 10).replace('-', '/') + ' ' + s.slice(11, 19) : s
      }

      function Card(props) {
        const [collapsed, setCollapsed] = React.useState(!!props.defaultCollapsed)
        const collapsible = !!props.collapsible
        return React.createElement('div', { className: 'hao-card' },
          React.createElement('div', {
            className: 'hao-card-head' + (collapsible ? ' hao-card-head-click' : ''),
            onClick: collapsible ? () => setCollapsed(!collapsed) : undefined,
            role: collapsible ? 'button' : undefined,
            tabIndex: collapsible ? 0 : undefined,
            onKeyDown: collapsible ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed) } } : undefined,
          },
            collapsible ? React.createElement('span', { className: 'hao-chevron' + (collapsed ? '' : ' open') }, React.createElement(Icon, { name: 'chevronR', size: 13 })) : null,
            props.icon ? React.createElement('span', { className: 'hao-card-ico' }, React.createElement(Icon, { name: props.icon, size: 15 })) : null,
            React.createElement('span', { className: 'hao-card-titlewrap' },
              React.createElement('span', { className: 'hao-card-title' }, props.title),
              props.subtitle ? React.createElement('span', { className: 'hao-card-sub' }, props.subtitle) : null,
            ),
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
          className: 'hao-btn' + (props.kind ? ' hao-btn-' + props.kind : '') + (props.mini ? ' hao-btn-mini' : '') + (props.iconbtn ? ' hao-iconbtn' : ''),
          onClick: props.onClick,
          disabled: props.disabled,
          title: props.title,
          'aria-label': props.title,
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
          onFocus: props.onFocus,
          onBlur: props.onBlur,
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
      // 备份模型行：展示态（序号 + 标签 + provider/model 徽章 + 操作）+ 行内编辑态
      // （label 输入 + provider/model 下拉联动 + effort 输入），避免手填非法值。
      function BackupRow(props) {
        const b = props.backup
        const providers = props.providers || []
        const [editing, setEditing] = React.useState(false)
        const [label, setLabel] = React.useState(String(b.label || ''))
        const [provider, setProvider] = React.useState(String(b.provider || ''))
        const [model, setModel] = React.useState(String(b.model || ''))
        const [effort, setEffort] = React.useState(String(b.reasoningEffort || ''))
        const [models, setModels] = React.useState([])
        const [busy, setBusy] = React.useState(false)
        // 同 HaCard.loadModels：请求序号防 provider 快速切换的过期响应
        const seq = React.useRef(0)
        React.useEffect(() => {
          if (!editing) return
          setLabel(String(b.label || ''))
          setProvider(String(b.provider || ''))
          setModel(String(b.model || ''))
          setEffort(String(b.reasoningEffort || ''))
          const p = String(b.provider || '')
          if (p) {
            const s = ++seq.current
            setBusy(true)
            rpc.modelsList({ provider: p }).then((ms) => {
              if (s !== seq.current) return
              setModels(ms || [])
            }).catch(() => { if (s === seq.current) setModels([]) })
              .finally(() => { if (s === seq.current) setBusy(false) })
          } else {
            setModels([])
          }
        }, [editing])
        const pickProvider = (p) => {
          setProvider(p); setModel(''); setModels([])
          if (!p) return
          const s = ++seq.current
          setBusy(true)
          rpc.modelsList({ provider: p }).then((ms) => {
            if (s !== seq.current) return
            setModels(ms || [])
            if ((ms || []).some((m) => m.model === b.model)) setModel(String(b.model || ''))
          }).catch(() => { if (s === seq.current) setModels([]) })
            .finally(() => { if (s === seq.current) setBusy(false) })
        }
        const save = () => props.onSave({ label: label.trim(), provider: provider.trim(), model: model.trim(), reasoningEffort: effort.trim() })
        return React.createElement('div', { className: 'hao-bk' },
          React.createElement('span', { className: 'hao-bk-idx' }, String(props.index + 1)),
          !editing ? React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'hao-bk-label', title: b.label || '' }, b.label || t('ha.unnamedBackup')),
            React.createElement('span', { className: 'hao-bk-key', title: b.provider + ' / ' + b.model },
              React.createElement(Icon, { name: 'db', size: 11 }), ' ', (b.provider || '?') + ' / ' + (b.model || '?')),
            b.reasoningEffort ? React.createElement(Badge, { kind: 'info' }, b.reasoningEffort) : null,
            React.createElement('span', { className: 'hao-bk-ops' },
              React.createElement(Btn, { mini: true, iconbtn: true, title: t('common.moveUp'), onClick: () => props.onMove(-1) }, React.createElement(Icon, { name: 'up', size: 12 })),
              React.createElement(Btn, { mini: true, iconbtn: true, title: t('common.moveDown'), onClick: () => props.onMove(1) }, React.createElement(Icon, { name: 'down', size: 12 })),
              React.createElement(Btn, { mini: true, iconbtn: true, title: t('common.edit'), onClick: () => setEditing(true) }, React.createElement(Icon, { name: 'edit', size: 12 })),
              React.createElement(Btn, { mini: true, iconbtn: true, kind: 'danger', title: t('common.delete'), onClick: props.onRemove }, React.createElement(Icon, { name: 'trash', size: 12 })),
            ),
          ) : React.createElement('div', { className: 'hao-bk-edit' },
            React.createElement(TextInput, { value: label, placeholder: t('ha.phLabel'), width: '110px', onChange: setLabel }),
            React.createElement('select', { className: 'hao-input', value: provider, onChange: (e) => pickProvider(e.target.value) },
              React.createElement('option', { value: '' }, t('ha.phProvider')),
              providers.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.provider + (p.name && p.name !== p.provider ? '（' + p.name + '）' : ''))),
            ),
            React.createElement('select', { className: 'hao-input', style: { flex: 1, minWidth: '140px' }, value: model, disabled: busy, onChange: (e) => setModel(e.target.value) },
              React.createElement('option', { value: '' }, busy ? t('common.loadingModelList') : t('ha.phModel')),
              models.map((m) => React.createElement('option', { key: m.model, value: m.model }, m.name && m.name !== m.model ? m.name + '（' + m.model + '）' : m.model)),
            ),
            React.createElement(TextInput, { value: effort, placeholder: t('ha.phEffort'), width: '90px', onChange: setEffort }),
            React.createElement(Btn, { kind: 'primary', mini: true, disabled: !provider || !model, onClick: () => { save(); setEditing(false) } }, t('common.save')),
            React.createElement(Btn, { mini: true, onClick: () => setEditing(false) }, t('common.cancel')),
          ),
        )
      }

      function HaCard(props) {
        const cfg = props.cfg
        const backups = cfg.backups || []
        // 只发送 patch 字段：host stateSet 基于最新 state 做节内合并，
        // 避免渲染帧快照（cfg）在快速连续操作时把其他字段回退成旧值
        const set = (patch) => props.apply({ ha: patch })
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
        // 请求序号：快速切换 provider 时丢弃过期响应，避免慢请求覆盖新选择
        const loadSeq = React.useRef(0)
        const loadModels = (provider) => {
          const seq = ++loadSeq.current
          setAddBusy(true)
          rpc.modelsList({ provider }).then((ms) => {
            if (seq !== loadSeq.current) return
            const list = ms || []
            setAddModels(list)
            setAddModel(list.length > 0 ? list[0].model : '')
          }).catch(() => {
            if (seq !== loadSeq.current) return
            setAddModels([]); setAddModel('')
          })
          .finally(() => { if (seq === loadSeq.current) setAddBusy(false) })
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
          icon: 'shield',
          title: t('ha.title'),
          subtitle: t('ha.subtitle'),
          actions: React.createElement(Btn, { mini: true, iconbtn: true, title: t('ha.reload'), onClick: props.onReload }, React.createElement(Icon, { name: 'refresh', size: 13 })),
        },
          React.createElement(Row, { label: t('common.enable') },
            React.createElement(Toggle, { value: cfg.enabled, onChange: (v) => set({ enabled: v }) }),
          ),
          React.createElement('div', { className: 'hao-section' }, t('ha.backupList')),
          backups.length === 0
            ? React.createElement(EmptyState, {
                icon: 'shield',
                title: t('ha.emptyTitle'),
                desc: t('ha.emptyHint'),
                actions: React.createElement(React.Fragment, null,
                  React.createElement(Btn, { kind: 'primary', disabled: suggestBusy, onClick: doSuggest }, suggestBusy ? t('common.loadingModelList') : t('ha.recommend')),
                  React.createElement(Btn, { onClick: openAdd }, t('ha.addFromConfig')),
                ),
              })
            : React.createElement(React.Fragment, null,
              backups.map((b, i) => React.createElement(BackupRow, {
                key: 'b' + i, backup: b, index: i, providers,
                onSave: (patch) => setBackup(i, patch),
                onRemove: () => removeBackup(i),
                onMove: (dir) => moveBackup(i, dir),
              })),
              React.createElement(Row, { label: '' },
                React.createElement(Btn, { onClick: openAdd }, t('ha.addFromConfig')),
                React.createElement(Btn, { disabled: suggestBusy, onClick: doSuggest }, suggestBusy ? t('common.loadingModelList') : t('ha.recommend')),
              ),
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
        // 同 HaCard：只发送变更字段（agents 整组），host 基于最新 orch 节合并
        const setAgents = (next) => props.apply({ orch: { agents: next } })
        const providers = props.providers || []
        const [editing, setEditing] = React.useState(null) // { index: -1 新增 | >=0 编辑；已有角色的表单在对应卡片内展开 }
        const [formModels, setFormModels] = React.useState([])
        const [formBusy, setFormBusy] = React.useState(false)
        const [formErr, setFormErr] = React.useState('')
        const [fallbackCatalog, setFallbackCatalog] = React.useState([])
        const [fallbackCatalogBusy, setFallbackCatalogBusy] = React.useState(false)
        const [fallbackSuggestOpen, setFallbackSuggestOpen] = React.useState(false)
        const [genOpen, setGenOpen] = React.useState(false)
        const [genReq, setGenReq] = React.useState('')
        const [genBusy, setGenBusy] = React.useState(false)
        const [genErr, setGenErr] = React.useState('')
        const CUSTOM_EFFORT = '__custom__'
        const EFFORT_MODES = ['', 'low', 'medium', 'high']
        const makeEffortState = (value) => {
          const effort = String(value || '').trim()
          if (EFFORT_MODES.indexOf(effort) >= 0) return { reasoningEffort: effort, effortMode: effort, effortCustom: '' }
          return { reasoningEffort: '', effortMode: CUSTOM_EFFORT, effortCustom: effort }
        }
        // 同 HaCard.loadModels：请求序号防 provider 快速切换的过期响应
        const formLoadSeq = React.useRef(0)
        const fallbackCatalogProviders = React.useRef('')
        const loadFormModels = (provider) => {
          const seq = ++formLoadSeq.current
          setFormBusy(true)
          setFormErr('')
          rpc.modelsList({ provider }).then((ms) => {
            if (seq !== formLoadSeq.current) return
            setFormModels(ms || [])
          }).catch((e) => {
            if (seq !== formLoadSeq.current) return
            setFormModels([]); setFormErr(String((e && e.message) || e))
          })
          .finally(() => { if (seq === formLoadSeq.current) setFormBusy(false) })
        }
        // 回退链快捷联想：按当前已注册 provider 读取模型目录，并在本地缓存当前 provider 集合。
        // 单个 provider 失败不影响其它 provider 的建议，也不阻止手工输入。
        const loadFallbackCatalog = () => {
          const entries = providers.filter((p) => p && p.provider).map((p) => ({ provider: String(p.provider), name: String(p.name || '') }))
          const key = entries.map((p) => p.provider).join('\u0000')
          if (!key) { setFallbackCatalog([]); return }
          if (fallbackCatalogProviders.current === key) return
          fallbackCatalogProviders.current = key
          setFallbackCatalogBusy(true)
          Promise.all(entries.map((p) => rpc.modelsList({ provider: p.provider }).then((models) => ({ ...p, models: models || [] })).catch(() => ({ ...p, models: [] }))))
            .then((groups) => {
              const seen = new Set()
              const choices = []
              for (const group of groups) {
                for (const m of group.models) {
                  const model = String((m && m.model) || '').trim()
                  if (!model) continue
                  const value = group.provider + '/' + model
                  if (seen.has(value)) continue
                  seen.add(value)
                  choices.push({ value, name: String((m && m.name) || model) })
                }
              }
              setFallbackCatalog(choices)
            })
            .finally(() => setFallbackCatalogBusy(false))
        }
        const openNew = () => {
          setEditing({ index: -1, name: '', provider: '', model: '', description: '', systemPrompt: '', toolsAllow: '', toolsDeny: '', fallbacksText: '', ...makeEffortState('') })
          setFormModels([])
          setFormErr('')
        }
        const openEdit = (i, a) => {
          const fallbacksText = (a.fallbacks || []).map((b) => {
            if (!b || !b.provider || !b.model) return ''
            return b.provider + '/' + b.model + (b.reasoningEffort ? '@' + b.reasoningEffort : '')
          }).filter(Boolean).join(', ')
          setEditing({ index: i, name: a.name || '', provider: a.provider || '', model: a.model || '', description: a.description || '', systemPrompt: a.systemPrompt || '', toolsAllow: ((a.tools && a.tools.allow) || []).join(', '), toolsDeny: ((a.tools && a.tools.deny) || []).join(', '), fallbacksText, ...makeEffortState(a.reasoningEffort) })
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
            setEditing({ index: -1, name: a.name || '', provider: a.provider || '', model: a.model || '', description: a.description || '', systemPrompt: a.systemPrompt || '', toolsAllow: '', toolsDeny: '', fallbacksText: '', ...makeEffortState(a.reasoningEffort) })
            setFormModels([])
            setFormErr('')
            if (a.provider) loadFormModels(a.provider)
          }).catch((e) => setGenErr(String((e && e.message) || e)))
            .finally(() => setGenBusy(false))
        }
        // 工具名单解析：逗号/空格/分号分隔，去空项
        const parseNameList = (s) => String(s || '').split(/[\s,，;；]+/).map((x) => x.trim()).filter(Boolean)
        const save = () => {
          if (!editing) return
          const name = String(editing.name || '').trim()
          if (!name) { setFormErr(t('common.requiredName')); return }
          const next = agents.slice()
          // 展开原条目再覆盖表单字段：保留表单未纳管的字段，避免编辑一次就静默丢配置。
          const entry = { ...((editing.index >= 0 && agents[editing.index]) || {}), name, provider: String(editing.provider || ''), model: String(editing.model || ''), description: String(editing.description || ''), systemPrompt: String(editing.systemPrompt || '') }
          const reasoningEffort = String(editing.effortMode === CUSTOM_EFFORT ? (editing.effortCustom || '') : (editing.effortMode || '')).trim()
          if (reasoningEffort) entry.reasoningEffort = reasoningEffort
          else delete entry.reasoningEffort
          // 工具裁剪：allow/deny 任一非空才落 tools 字段，空则删除（provider 不支持时 host 端自动剥离）
          const allow = parseNameList(editing.toolsAllow)
          const deny = parseNameList(editing.toolsDeny)
          if (allow.length || deny.length) {
            entry.tools = {}
            if (allow.length) entry.tools.allow = allow
            if (deny.length) entry.tools.deny = deny
          } else {
            delete entry.tools
          }
          // 角色级模型回退：使用与 HA 备用条目相同的 provider/model 结构，
          // 但独立存放在当前 AgentEntry，不混入全局 ha.backups。
          const fallbacks = String(editing.fallbacksText || '').split(/[\s,，;；]+/).map((token) => {
            const slash = token.indexOf('/')
            if (slash <= 0 || slash >= token.length - 1) return null
            const provider = token.slice(0, slash).trim()
            const route = token.slice(slash + 1).trim()
            const at = route.lastIndexOf('@')
            const model = (at > 0 ? route.slice(0, at) : route).trim()
            const reasoningEffort = (at > 0 ? route.slice(at + 1) : '').trim()
            return provider && model ? { label: '', provider, model, reasoningEffort } : null
          }).filter(Boolean)
          if (fallbacks.length) entry.fallbacks = fallbacks
          else delete entry.fallbacks
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
        const configuredFallbackChoices = []
        const configuredChoiceKeys = new Set()
        const addConfiguredChoice = (provider, model, name) => {
          const p = String(provider || '').trim()
          const m = String(model || '').trim()
          if (!p || !m) return
          const value = p + '/' + m
          if (configuredChoiceKeys.has(value)) return
          configuredChoiceKeys.add(value)
          configuredFallbackChoices.push({ value, name: name ? String(name) : m })
        }
        for (const a of agents) {
          if (!a) continue
          addConfiguredChoice(a.provider, a.model, a.name)
          for (const b of (a.fallbacks || [])) addConfiguredChoice(b && b.provider, b && b.model, a.name)
        }
        const fallbackChoiceMap = new Map()
        for (const choice of fallbackCatalog.concat(configuredFallbackChoices)) {
          if (choice && choice.value && !fallbackChoiceMap.has(choice.value)) fallbackChoiceMap.set(choice.value, choice)
        }
        const fallbackToken = form ? String(form.fallbacksText || '').split(/[\s,，;；]+/).pop() || '' : ''
        const fallbackQuery = fallbackToken.split('@')[0].toLowerCase()
        const fallbackSuggestions = [...fallbackChoiceMap.values()]
          .filter((choice) => !fallbackQuery || choice.value.toLowerCase().includes(fallbackQuery) || String(choice.name || '').toLowerCase().includes(fallbackQuery))
          .slice(0, 24)
        const selectFallbackChoice = (choice) => {
          if (!form || !choice) return
          const tokens = String(form.fallbacksText || '').split(/[\s,，;；]+/)
          const currentToken = tokens.pop() || ''
          const at = currentToken.lastIndexOf('@')
          const effort = at > 0 ? currentToken.slice(at + 1).trim() : ''
          const prefix = tokens.filter(Boolean)
          const value = choice.value + (effort ? '@' + effort : '')
          setEditing({ ...form, fallbacksText: prefix.length ? prefix.join(', ') + ', ' + value : value })
          setFallbackSuggestOpen(false)
        }
        const renderEditor = () => form ? React.createElement('div', { className: 'hao-form' },
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
            React.createElement('span', { className: 'hao-form-label' }, t('agents.effort')),
            React.createElement('select', {
              className: 'hao-input',
              value: form.effortMode || '',
              onChange: (e) => {
                const mode = e.target.value
                setEditing({ ...form, effortMode: mode, reasoningEffort: mode === CUSTOM_EFFORT ? '' : mode, effortCustom: mode === CUSTOM_EFFORT ? (form.effortCustom || '') : '' })
              },
            },
              React.createElement('option', { value: '' }, t('agents.effortDefault')),
              React.createElement('option', { value: 'low' }, 'low'),
              React.createElement('option', { value: 'medium' }, 'medium'),
              React.createElement('option', { value: 'high' }, 'high'),
              React.createElement('option', { value: CUSTOM_EFFORT }, t('agents.effortCustom')),
            ),
            form.effortMode === CUSTOM_EFFORT ? React.createElement(TextInput, { value: form.effortCustom || '', placeholder: t('agents.effortPh'), width: '140px', onChange: (v) => setEditing({ ...form, effortCustom: v }) }) : null,
          ),
          React.createElement('div', { className: 'hao-section' }, t('agents.effortHint')),
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
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, t('agents.toolsAllow')),
            React.createElement(TextInput, { value: form.toolsAllow || '', placeholder: t('agents.toolsPh'), width: '100%', onChange: (v) => setEditing({ ...form, toolsAllow: v }) }),
          ),
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, t('agents.toolsDeny')),
            React.createElement(TextInput, { value: form.toolsDeny || '', placeholder: t('agents.toolsPh'), width: '100%', onChange: (v) => setEditing({ ...form, toolsDeny: v }) }),
          ),
          React.createElement('div', { className: 'hao-section' }, t('agents.toolsHint') + ((props.hostTools || []).length > 0 ? t('agents.toolsHostList', { names: props.hostTools.join(', ') }) : '')),
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, t('agents.fallbacks')),
            React.createElement('div', { className: 'hao-autocomplete' },
              React.createElement(TextInput, {
                value: form.fallbacksText || '',
                placeholder: t('agents.fallbacksPh'),
                onFocus: () => { setFallbackSuggestOpen(true); loadFallbackCatalog() },
                onBlur: () => setTimeout(() => setFallbackSuggestOpen(false), 120),
                onChange: (v) => { setEditing({ ...form, fallbacksText: v }); setFallbackSuggestOpen(true); loadFallbackCatalog() },
              }),
              fallbackSuggestOpen ? React.createElement('div', { className: 'hao-autocomplete-menu' },
                fallbackCatalogBusy && fallbackSuggestions.length === 0
                  ? React.createElement('div', { className: 'hao-autocomplete-empty' }, t('agents.fallbacksLoading'))
                  : fallbackSuggestions.length === 0
                    ? React.createElement('div', { className: 'hao-autocomplete-empty' }, t('agents.fallbacksNoMatch'))
                    : fallbackSuggestions.map((choice) => React.createElement('button', {
                      key: choice.value,
                      type: 'button',
                      className: 'hao-autocomplete-item',
                      onMouseDown: (e) => { e.preventDefault(); selectFallbackChoice(choice) },
                    },
                      React.createElement('span', { className: 'hao-autocomplete-value' }, choice.value),
                      choice.name && choice.name !== choice.value.split('/').pop() ? React.createElement('span', { className: 'hao-autocomplete-name' }, choice.name) : null,
                    )),
              ) : null,
            ),
          ),
          React.createElement('div', { className: 'hao-section' }, t('agents.fallbacksHint')),
          formErr ? React.createElement('div', { className: 'hao-error' }, formErr) : null,
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement(Btn, { kind: 'primary', onClick: save }, isNew ? t('common.add') : t('common.save')),
            React.createElement(Btn, { onClick: () => setEditing(null) }, t('common.cancel')),
          ),
        ) : null
        return React.createElement(Card, { icon: 'bot', title: t('agents.title'), subtitle: t('agents.subtitle') },
          agents.length === 0
            ? React.createElement(EmptyState, { icon: 'bot', title: t('agents.emptyTitle'), desc: t('agents.emptyHint') })
            : null,
          agents.map((a, i) => React.createElement('div', { key: 'ag' + i, className: 'hao-agent' + (form && form.index === i ? ' is-editing' : '') },
            React.createElement('div', { className: 'hao-agent-head' },
              React.createElement(Avatar, { name: a.name || '?' }),
              React.createElement('span', { className: 'hao-agent-name' }, a.name || t('common.unnamed')),
               React.createElement('span', { className: 'hao-bk-key', title: (a.provider || '') + ' / ' + (a.model || '') },
                 React.createElement(Icon, { name: 'db', size: 11 }), ' ', (a.provider ? a.provider + '/' : '') + (a.model || t('common.defaultModel'))),
               a.reasoningEffort ? React.createElement(Badge, { kind: 'info' }, a.reasoningEffort) : null,
               (a.fallbacks || []).length > 0 ? React.createElement(Badge, { kind: 'info' }, t('agents.fallbackCount', { n: a.fallbacks.length })) : null,
              React.createElement('span', { className: 'hao-agent-ops' },
                React.createElement(Btn, { mini: true, iconbtn: true, title: t('common.moveUp'), onClick: () => move(i, -1) }, React.createElement(Icon, { name: 'up', size: 12 })),
                React.createElement(Btn, { mini: true, iconbtn: true, title: t('common.moveDown'), onClick: () => move(i, 1) }, React.createElement(Icon, { name: 'down', size: 12 })),
                React.createElement(Btn, { mini: true, iconbtn: true, title: t('common.edit'), onClick: () => openEdit(i, a) }, React.createElement(Icon, { name: 'edit', size: 12 })),
                React.createElement(Btn, { mini: true, iconbtn: true, kind: 'danger', title: t('common.delete'), onClick: () => remove(i) }, React.createElement(Icon, { name: 'trash', size: 12 })),
              ),
            ),
            a.description ? React.createElement('div', { className: 'hao-agent-desc' }, a.description) : null,
            a.systemPrompt ? React.createElement('div', { className: 'hao-agent-sp' }, a.systemPrompt) : null,
            form && form.index === i ? renderEditor() : null,
          )),
          React.createElement(Row, { label: '' },
            React.createElement(Btn, { onClick: openNew }, React.createElement(Icon, { name: 'plus', size: 12 }), ' ', t('agents.add')),
            React.createElement(Btn, { kind: 'primary', onClick: () => { setGenErr(''); setGenOpen(!genOpen) } }, React.createElement(Icon, { name: 'sparkle', size: 12 }), ' ', t('agents.gen')),
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
          form && form.index < 0 ? renderEditor() : null,
        )
      }

      // ================= 编排卡片 =================
      function OrchCard(props) {
        const cfg = props.cfg
        // 同 HaCard：只发送 patch 字段，host 基于最新 orch 节合并
        const set = (patch) => props.apply({ orch: patch })
        return React.createElement(Card, { icon: 'flow', title: t('orch.title'), subtitle: t('orch.subtitle') },
          React.createElement(Row, { label: t('common.enable'), hint: t('orch.enabledHint') },
            React.createElement(Toggle, { value: cfg.enabled, onChange: (v) => set({ enabled: v }) }),
          ),
          React.createElement('div', { className: 'hao-section' }, t('orch.groupBasic')),
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
          React.createElement('div', { className: 'hao-section' }, t('orch.groupLimits')),
          React.createElement(Row, { label: t('orch.concurrency'), hint: t('orch.concurrencyHint') },
            React.createElement(NumInput, { value: cfg.concurrency, onChange: (v) => set({ concurrency: Number(v) || 1 }) }),
          ),
          React.createElement(Row, { label: t('orch.maxAgents'), hint: t('orch.maxAgentsHint') },
            React.createElement(NumInput, { value: cfg.maxAgents, onChange: (v) => set({ maxAgents: Number(v) || 1 }) }),
          ),
          React.createElement(Row, { label: t('orch.globalConcurrency'), hint: t('orch.globalConcurrencyHint') },
            React.createElement(NumInput, { value: cfg.globalConcurrency, onChange: (v) => set({ globalConcurrency: Number(v) || 0 }) }),
          ),
          React.createElement(Row, { label: t('orch.stageRetry'), hint: t('orch.stageRetryHint') },
            React.createElement(NumInput, { value: cfg.stageRetry, onChange: (v) => set({ stageRetry: Number(v) || 0 }) }),
          ),
          React.createElement(Row, { label: t('orch.autoResume'), hint: t('orch.autoResumeHint') },
            React.createElement(Toggle, { value: cfg.autoResume !== false, onChange: (v) => set({ autoResume: v }) }),
          ),
          React.createElement(Card, { title: t('orch.advanced'), subtitle: t('orch.advancedHint'), collapsible: true, defaultCollapsed: true },
            React.createElement(Row, { label: t('orch.maxDepth'), hint: t('orch.maxDepthHint') },
              React.createElement(NumInput, { value: cfg.maxDepth, onChange: (v) => set({ maxDepth: Number(v) || 0 }) }),
            ),
            React.createElement(Row, { label: t('orch.mergeBodyLimit'), hint: t('orch.mergeLimitsHint') },
              React.createElement(NumInput, { value: cfg.mergeBodyLimit, onChange: (v) => set({ mergeBodyLimit: Number(v) || 0 }) }),
            ),
            React.createElement(Row, { label: t('orch.mergeTotalLimit'), hint: t('orch.mergeLimitsHint') },
              React.createElement(NumInput, { value: cfg.mergeTotalLimit, onChange: (v) => set({ mergeTotalLimit: Number(v) || 0 }) }),
            ),
            React.createElement(Row, { label: t('orch.renderRunLimit'), hint: t('orch.renderLimitsHint') },
              React.createElement(NumInput, { value: cfg.renderRunLimit, onChange: (v) => set({ renderRunLimit: Number(v) || 0 }) }),
            ),
            React.createElement(Row, { label: t('orch.renderTotalLimit'), hint: t('orch.renderLimitsHint') },
              React.createElement(NumInput, { value: cfg.renderTotalLimit, onChange: (v) => set({ renderTotalLimit: Number(v) || 0 }) }),
            ),
          ),
          React.createElement('div', { className: 'hao-section hao-plain' }, t('orch.usageHowto')),
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
        // 同 HaCard：只发送 patch 字段，host 基于最新 debug 节合并
        const set = (patch) => props.apply({ debug: patch })
        const clear = () => {
          setBusy(true)
          rpc.debugClear().then((r) => setLogs((r && r.logs) || [])).catch(() => {}).finally(() => setBusy(false))
        }
        const fmt = (l) => {
          const tm = String(l.at).slice(11, 19)
          const extra = l.data && Object.keys(l.data).length > 0 ? ' ' + JSON.stringify(l.data) : ''
          return '[' + tm + '][' + l.level + '] ' + l.ev + ' ' + l.msg + extra
        }
        return React.createElement(Card, { icon: 'info', title: t('debug.title'), subtitle: t('debug.subtitle'), collapsible: true, defaultCollapsed: true },
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
        return React.createElement(Card, { icon: 'sliders', title: t('sys.title'), subtitle: t('sys.subtitle'), collapsible: true, defaultCollapsed: true },
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
              onChange: (v) => props.apply({ debug: { showCard: v } }),
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
              navigator.clipboard.writeText(exportJson).then(() => setMsg(t('sys.copied'))).catch(() => setMsg(t('sys.copyFailed')))
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
        const ctxCfg = props.ctxCfg || { enabled: true, text: '', injectSubagents: false }
        const [draft, setDraft] = React.useState(String(ctxCfg.text || ''))
        React.useEffect(() => { setDraft(String(ctxCfg.text || '')) }, [ctxCfg.text])
        const saveDraft = () => {
          const v = draft.trim()
          if (v === String(ctxCfg.text || '')) return
          props.apply({ ctx: { text: v } })
        }
        return React.createElement(React.Fragment, null,
          React.createElement(Row, { label: t('ctx.title'), hint: t('ctx.hint') },
            React.createElement(Toggle, {
              value: !!ctxCfg.enabled,
              onChange: (v) => props.apply({ ctx: { enabled: v } }),
            }),
          ),
          React.createElement(Row, { label: t('ctx.injectSubagents'), hint: t('ctx.injectSubagentsHint') },
            React.createElement(Toggle, {
              value: !!ctxCfg.injectSubagents,
              onChange: (v) => props.apply({ ctx: { injectSubagents: v } }),
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

      // ================= Run 历史列表（可展开条目：模式/耗时/子任务表） =================
      function runStatusKind(r) {
        const sub = Array.isArray(r.runs) ? r.runs : []
        if (r.aborted) return 'off'
        if (sub.length > 0 && sub.every((x) => x.status === 'completed')) return 'on'
        if (sub.some((x) => x.status === 'error')) return 'warn'
        // max-tokens：有可用输出但截断，用 warning/部分完成表现，不再当作未知
        if (sub.length > 0 && sub.every((x) => x.status === 'completed' || x.status === 'max-tokens')) return 'warn'
        return sub.length > 0 ? 'warn' : 'info'
      }
      function RunHistoryList(props) {
        const runs = props.runs || []
        const limit = props.limit || 24
        const [openId, setOpenId] = React.useState('')
        const [copiedId, setCopiedId] = React.useState('')
        if (runs.length === 0) {
          return React.createElement('div', { className: 'hao-section hao-plain' }, t('diag.noRuns'))
        }
        const copyRunId = (e, runId) => {
          e.stopPropagation()
          e.preventDefault()
          try {
            if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(String(runId)).then(() => {
                setCopiedId(String(runId))
                setTimeout(() => { setCopiedId('') }, 1600)
              }).catch(() => { /* 忽略：按钮保持可重试 */ })
            }
          } catch (err) { /* ignore */ }
        }
        const statusLabel = (r) => {
          const sub = Array.isArray(r.runs) ? r.runs : []
          if (r.aborted) return t('diag.runAborted')
          if (sub.length > 0 && sub.every((x) => x.status === 'completed')) return t('diag.runOk')
          if (sub.some((x) => x.status === 'error')) return t('diag.runPartial')
          // max-tokens 视为有可用输出（截断但仍保留/合并），不再误判为未知/失败
          if (sub.length > 0 && sub.every((x) => x.status === 'completed' || x.status === 'max-tokens')) return t('diag.runTruncated')
          return t('common.unknown')
        }
        return React.createElement(React.Fragment, null,
          runs.slice(0, limit).map((r, i) => {
            const sub = Array.isArray(r.runs) ? r.runs : []
            const open = openId === r.runId
            const toggle = () => setOpenId(open ? '' : r.runId)
            return React.createElement('div', { key: r.runId || i, className: 'hao-runitem' },
              React.createElement('div', {
                className: 'hao-runitem-head',
                role: 'button', tabIndex: 0, 'aria-expanded': open,
                onClick: toggle,
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } },
              },
                React.createElement('span', { className: 'hao-chevron' + (open ? ' open' : '') }, React.createElement(Icon, { name: 'chevronR', size: 12 })),
                React.createElement(Badge, { kind: 'info' }, React.createElement(Icon, { name: modeIcon(r.mode), size: 11 }), ' ', r.mode || 'fanout'),
                React.createElement('span', { className: 'hao-mono', style: { fontSize: 11, opacity: .85 } }, r.runId),
                React.createElement('button', {
                  className: 'hao-btn hao-btn-mini',
                  type: 'button',
                  title: t('sys.copy') + ' ' + r.runId,
                  'aria-label': t('sys.copy') + ' ' + r.runId,
                  onClick: (e) => copyRunId(e, r.runId),
                  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() },
                }, copiedId === r.runId ? t('sys.copied') : t('sys.copy')),
                React.createElement(Badge, { kind: runStatusKind(r) }, statusLabel(r)),
                React.createElement('span', { className: 'hao-runitem-meta', style: { marginLeft: 'auto' } },
                  React.createElement('span', null, t('diag.runTasks', { n: sub.length })),
                  r.durationMs != null ? React.createElement('span', { className: 'hao-mono' }, fmtDuration(r.durationMs)) : null,
                  r.startedAt ? React.createElement('span', null, fmtTime(r.startedAt)) : null,
                ),
              ),
              open ? React.createElement('div', { className: 'hao-runitem-body' },
                sub.length > 0
                  ? React.createElement('table', { className: 'hao-orch-table' },
                      React.createElement('thead', null, React.createElement('tr', null,
                        React.createElement('th', null, ''), React.createElement('th', null, t('orch.taskLabel')),
                        React.createElement('th', null, t('orch.taskAgent')), React.createElement('th', null, t('orch.taskStatus')),
                        React.createElement('th', null, t('orch.taskLastKey')),
                      )),
                      React.createElement('tbody', null, sub.map((x, j) => React.createElement('tr', { key: x.id || j },
                        React.createElement('td', { style: { width: 18 } },
                          React.createElement(Icon, {
                            name: x.status === 'completed' ? 'check' : (x.status === 'error' ? 'x' : 'clock'),
                            size: 12,
                          })),
                        React.createElement('td', null, x.label || x.id || ''),
                        React.createElement('td', null, x.agent || ''),
                        React.createElement('td', null,
                          React.createElement(Badge, {
                            kind: x.status === 'completed' ? 'on' : (x.status === 'error' ? 'off' : 'info'),
                            dot: false,
                          }, x.status)),
                        React.createElement('td', { className: 'hao-mono' }, x.lastKey || '-'),
                      ))),
                    )
                  : React.createElement('div', { className: 'hao-section hao-plain' }, t('common.none')),
                r.summary ? React.createElement('pre', { className: 'hao-pre', style: { maxHeight: '120px', marginTop: '8px' } },
                  String(r.summary).slice(0, 2000)) : null,
              ) : null,
            )
          }),
        )
      }

      // ================= 诊断卡片（HA 运行态 + 最近 run） =================
      function DiagnosticsCard(props) {
        const [diag, setDiag] = React.useState(null)
        const refresh = () => {
          Promise.all([rpc.haStatus(), rpc.orchRecent({ limit: 24 })]).then(([hs, runs]) => {
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
          return React.createElement(Card, { icon: 'pulse', title: t('diag.title'), subtitle: t('diag.subtitle'), collapsible: true, defaultCollapsed: true },
            React.createElement('div', { className: 'hao-section hao-plain' }, t('common.loading')),
          )
        }
        const hs = diag.hs
        const quarantine = hs.quarantine || []
        const failures = hs.failures || []
        const cursors = hs.cursors || []
        const probes = (hs.probes && hs.probes.last) || []
        const runs = diag.runs
        return React.createElement(Card, { icon: 'pulse', title: t('diag.title'), subtitle: t('diag.subtitle'), collapsible: true, defaultCollapsed: true },
          React.createElement(Row, { label: t('diag.ha') },
            React.createElement(Badge, { kind: hs.enabled ? 'on' : 'off' }, hs.enabled ? t('ha.statusEnabled') : t('ha.statusDisabled')),
            React.createElement(Badge, { muted: true, dot: false }, 'cooldown ' + (Math.round((hs.config && hs.config.cooldownMs) / 1000) || 0) + 's'),
            React.createElement(Badge, { muted: true, dot: false }, 'threshold ' + ((hs.config && hs.config.threshold) || 1)),
            React.createElement(Badge, { muted: true, dot: false }, 'probe ' + (hs.config && hs.config.probeEnabled ? 'on' : 'off')),
          ),
          React.createElement(Row, { label: t('ha.currentDefault') },
            hs.defaultSelection
              ? React.createElement('span', { className: 'hao-bk-key' }, React.createElement(Icon, { name: 'db', size: 11 }), ' ', hs.defaultSelection.provider + ' / ' + hs.defaultSelection.model)
              : React.createElement('span', null, t('common.unknown')),
          ),
          React.createElement('div', { className: 'hao-section' }, t('ha.quarantined', { n: quarantine.length })),
          quarantine.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, t('ha.phProvider')), React.createElement('th', null, t('ha.phModel')),
                React.createElement('th', null, 'level'), React.createElement('th', null, t('ha.thCode')), React.createElement('th', null, t('ha.thRemaining')),
              )),
              React.createElement('tbody', null, quarantine.map((q, i) => React.createElement('tr', { key: 'dq' + i },
                React.createElement('td', null, q.provider), React.createElement('td', { className: 'hao-mono' }, q.model),
                React.createElement('td', null, q.level || 'model'), React.createElement('td', null, q.code || ''),
                React.createElement('td', null, fmtCountdown(q.remainingMs)),
              ))),
            )
            : React.createElement('div', { className: 'hao-section hao-plain' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('ha.recent')),
          hs.history && hs.history.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, t('ha.thTime')), React.createElement('th', null, t('ha.thFrom')), React.createElement('th', null, t('ha.thTo')), React.createElement('th', null, t('ha.thCode')),
              )),
              React.createElement('tbody', null, hs.history.slice(0, 8).map((h, i) => React.createElement('tr', { key: 'dh' + i },
                React.createElement('td', { className: 'hao-mono' }, String(h.at).slice(11, 19)),
                React.createElement('td', null, h.from),
                React.createElement('td', null, React.createElement(Icon, { name: 'zap', size: 10 }), ' ', h.to),
                React.createElement('td', null, h.code || ''),
              ))),
            )
            : React.createElement('div', { className: 'hao-section hao-plain' }, t('common.noneYet')),
          React.createElement('div', { className: 'hao-section' }, t('diag.failures', { n: failures.length })),
          failures.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, t('ha.phProvider')), React.createElement('th', null, t('ha.phModel')), React.createElement('th', null, 'count'), React.createElement('th', null, t('ha.thRemaining')),
              )),
              React.createElement('tbody', null, failures.map((f, i) => React.createElement('tr', { key: 'df' + i },
                React.createElement('td', null, f.provider), React.createElement('td', { className: 'hao-mono' }, f.model),
                React.createElement('td', null, 'x' + f.count), React.createElement('td', null, fmtCountdown(f.remainingMs)),
              ))),
            )
            : React.createElement('div', { className: 'hao-section hao-plain' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('diag.cursors', { n: cursors.length })),
          cursors.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, 'agent'), React.createElement('th', null, 'lastKey'), React.createElement('th', null, 'retries'),
              )),
              React.createElement('tbody', null, cursors.map((c, i) => React.createElement('tr', { key: 'dc' + i },
                React.createElement('td', null, c.agent), React.createElement('td', { className: 'hao-mono' }, c.lastKey || '-'), React.createElement('td', null, String(c.retries || 0)),
              ))),
            )
            : React.createElement('div', { className: 'hao-section hao-plain' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('diag.probes', { n: probes.length })),
          probes.length > 0
            ? React.createElement('table', { className: 'hao-table' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', null, 'key'), React.createElement('th', null, 'result'),
              )),
              React.createElement('tbody', null, probes.slice(0, 5).map((p, i) => React.createElement('tr', { key: 'dp' + i },
                React.createElement('td', { className: 'hao-mono' }, p.key),
                React.createElement('td', null, p.ok
                  ? React.createElement('span', { className: 'hao-ok' }, 'ok')
                  : React.createElement('span', { className: 'hao-error' }, p.reason || 'fail')),
              ))),
            )
            : React.createElement('div', { className: 'hao-section hao-plain' }, t('common.none')),
          React.createElement('div', { className: 'hao-section' }, t('diag.runs', { n: Math.min(runs.length, 24) })),
          React.createElement(RunHistoryList, { runs, limit: 24 }),
          React.createElement(Row, { label: '' },
            React.createElement(Btn, { kind: 'danger', onClick: () => rpc.haReset().then(() => refresh()).catch(() => {}) }, React.createElement(Icon, { name: 'refresh', size: 12 }), ' ', t('ha.reset')),
          ),
        )
      }

      // ================= 概览横幅（一眼可读的仪表盘头） =================
      // 数据复用 stateGet 快照；活动 run 数经 orchActive 轻量轮询（与诊断卡同源）。
      function OverviewBanner(props) {
        const state = props.state
        const [active, setActive] = React.useState(0)
        const disposedRef = React.useRef(false)
        React.useEffect(() => {
          disposedRef.current = false
          const tick = () => {
            rpc.orchActive().then((res) => {
              if (disposedRef.current) return
              setActive(((res && res.runs) || []).length)
            }).catch(() => { /* 保持上一帧 */ })
          }
          tick()
          const timer = ctx.get('timer')
          if (!timer) return
          const dispose = timer.interval(tick, 5000)
          return () => { disposedRef.current = true; dispose() }
        }, [])
        const ha = (state.config && state.config.ha) || {}
        const orch = (state.config && state.config.orch) || {}
        const quarantine = state.quarantine || []
        const sel = state.defaultSelection
        const backups = (ha.backups || []).filter((b) => b && b.provider && b.model)
        const cell = (key, icon, label, value) => React.createElement('div', { key: key, className: 'hao-hero-cell' },
          React.createElement('span', { className: 'hao-hero-k' }, React.createElement(Icon, { name: icon, size: 11 }), ' ', label),
          React.createElement('span', { className: 'hao-hero-v' }, value),
        )
        return React.createElement('div', { className: 'hao-hero' },
          cell('ha', 'shield', t('hero.ha'), React.createElement(React.Fragment, null,
            React.createElement(Badge, { kind: ha.enabled ? 'on' : 'off' }, ha.enabled ? t('ha.statusEnabled') : t('ha.statusDisabled')),
            quarantine.length > 0
              ? React.createElement(Badge, { kind: 'warn' }, t('hero.quarantined', { n: quarantine.length }))
              : React.createElement(Badge, { muted: true, dot: false }, t('hero.healthy')),
          )),
          cell('model', 'db', t('ha.currentDefault'),
            sel ? React.createElement('span', { className: 'hao-mono' }, sel.provider + ' / ' + sel.model) : t('common.unknown')),
          cell('backups', 'layers', t('hero.backups'),
            React.createElement(Badge, { kind: backups.length > 0 ? 'info' : 'off' }, t('hero.backupCount', { n: backups.length }))),
          cell('orch', 'flow', t('hero.orch'), React.createElement(React.Fragment, null,
            React.createElement(Badge, { kind: orch.enabled ? 'on' : 'off' }, orch.enabled ? t('ha.statusEnabled') : t('ha.statusDisabled')),
            active > 0
              ? React.createElement(Badge, { kind: 'info' }, t('hero.activeRuns', { n: active }))
              : React.createElement(Badge, { muted: true, dot: false }, t('hero.noActiveRuns')),
          )),
        )
      }

      // ================= 页面 =================
      function HaPage(props) {
        const [state, setState] = React.useState(null)
        const [error, setError] = React.useState('')
        // 卸载标记：飞行中的 RPC 返回后不再 setState（也避免更新模块级 i18n）
        const disposedRef = React.useRef(false)
        const noteI18n = (s) => { if (s && s.i18n) { syncI18n(s.i18n); if (props && props.onI18nChanged) props.onI18nChanged() } }
        const refresh = () => {
          rpc.stateGet().then((s) => {
            if (disposedRef.current) return
            setState(s); setError(''); noteI18n(s)
          }).catch((e) => { if (!disposedRef.current) setError(String((e && e.message) || e)) })
        }
        React.useEffect(() => {
          disposedRef.current = false
          refresh()
          const timer = ctx.get('timer')
          if (!timer) return
          const dispose = timer.interval(() => refresh(), 5000)
          return () => { disposedRef.current = true; dispose() }
        }, [])
        const apply = (patch) => {
          rpc.stateSet({ patch }).then((s) => {
            if (disposedRef.current) return
            setState(s); setError(''); noteI18n(s)
          }).catch((e) => { if (!disposedRef.current) setError(String((e && e.message) || e)) })
        }
        // 重新加载：host 重新从磁盘读取持久化配置并应用（含语言跟随），再刷新整页
        const reload = () => {
          rpc.stateReload().then((s) => {
            if (disposedRef.current) return
            setState(s); setError(''); noteI18n(s)
          }).catch((e) => { if (!disposedRef.current) setError(String((e && e.message) || e)) })
        }
        if (!state || !state.config) {
          // state 缺失或异常形状（无 config）：按加载中处理，等待下次轮询自愈
          return React.createElement('div', { className: 'hao-page' }, error || t('common.loading'))
        }
      return React.createElement('div', { className: 'hao-page' },
        error ? React.createElement('div', { className: 'hao-error' }, error) : null,
        React.createElement(OverviewBanner, { state }),
        React.createElement(HaCard, { cfg: state.config.ha, apply, setState, status: state, providers: state.llmProviders || [], onReload: reload }),
        React.createElement(OrchCard, { cfg: state.config.orch, apply, providers: state.subagents || [] }),
        React.createElement(AgentsCard, { cfg: state.config.orch, apply, providers: state.llmProviders || [], hostTools: state.hostTools || [] }),
        // 开发调试卡片默认隐藏：系统卡片内「显示开发调试卡片」开关打开后才渲染
        state.config.debug && state.config.debug.showCard
          ? React.createElement(DebugCard, { cfg: state.config.debug, apply, persist: state.persist })
          : null,
        React.createElement(SysCard, { i18n: state.i18n, debugCfg: state.config.debug, ctxCfg: state.config.ctx, ctxStatus: state.ctxInject, apply }),
        React.createElement(DiagnosticsCard, null),
      )
      }

      // ================= Run 卡片状态：HA 状态胶囊（可展开） =================
      // 折叠态单行（启用/备份数/隔离数），展开显示默认模型、隔离冷却倒计时
      // （本地 1s tick 递减快照 remainingMs）、最近切换与活动 run 概览。
      function HaStatusCard() {
        const [snap, setSnap] = React.useState(null) // { state, loadedAt }
        const [open, setOpen] = React.useState(false)
        const disposedRef = React.useRef(false)
        const refresh = () => {
          rpc.stateGet().then((s) => {
            if (disposedRef.current) return
            setSnap({ state: s, loadedAt: Date.now() })
            if (s && s.i18n) syncI18n(s.i18n)
          }).catch(() => {})
        }
        React.useEffect(() => {
          disposedRef.current = false
          refresh()
          const timer = ctx.get('timer')
          if (!timer) return
          const dispose = timer.interval(() => refresh(), 10000)
          return () => { disposedRef.current = true; dispose() }
        }, [])
        // 展开时本地 1s tick：倒计时随时间递减（不额外发请求）
        const [, setTick] = React.useState(0)
        React.useEffect(() => {
          if (!open) return
          const iv = setInterval(() => setTick((v) => v + 1), 1000)
          return () => clearInterval(iv)
        }, [open])
        // 展开时轻量轮询活动 run（2s）
        const [activeRuns, setActiveRuns] = React.useState([])
        React.useEffect(() => {
          if (!open) return
          let disposed = false
          const tick = () => {
            rpc.orchActive().then((res) => { if (!disposed) setActiveRuns((res && res.runs) || []) }).catch(() => {})
          }
          tick()
          const iv = setInterval(tick, 2000)
          return () => { disposed = true; clearInterval(iv) }
        }, [open])
        if (!snap) return React.createElement('div', { className: 'hao-run' }, t('ha.runLoading'))
        const state = snap.state
        const cfg = state.config && state.config.ha
        const quarantine = state.quarantine || []
        const last = state.history && state.history[0]
        const elapsed = Date.now() - snap.loadedAt
        const toggle = () => setOpen(!open)
        return React.createElement('div', { style: { display: 'inline-flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', maxWidth: '100%' } },
          React.createElement('div', {
            className: 'hao-capsule', role: 'button', tabIndex: 0, 'aria-expanded': open,
            onClick: toggle,
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } },
          },
            React.createElement('span', { className: 'hao-run-dot ' + (cfg && cfg.enabled ? 'on' : 'off') }),
            React.createElement('span', null,
              (cfg && cfg.enabled ? t('ha.runEnabled') : t('ha.runDisabled'))
              + ' · ' + t('ha.runBackup', { n: ((cfg && cfg.backups) || []).length })
              + ' · ' + t('ha.runQuarantine', { n: quarantine.length })),
            last ? React.createElement('span', { className: 'hao-run-last', title: t('ha.runLast', { from: last.from, to: last.to, code: last.code }) },
              React.createElement(Icon, { name: 'zap', size: 10 }), ' ', last.to) : null,
            React.createElement('span', { className: 'hao-chevron' + (open ? ' open' : '') }, React.createElement(Icon, { name: 'chevronR', size: 11 })),
          ),
          open ? React.createElement('div', { className: 'hao-capsule-panel' },
            React.createElement('div', { className: 'hao-capsule-kv' },
              React.createElement('span', null, t('ha.currentDefault')),
              React.createElement('span', { className: 'hao-mono' }, state.defaultSelection ? state.defaultSelection.provider + ' / ' + state.defaultSelection.model : t('common.unknown'))),
            React.createElement('div', { className: 'hao-capsule-kv' },
              React.createElement('span', null, t('hero.quarantined', { n: quarantine.length })),
              quarantine.length === 0 ? React.createElement('span', { className: 'hao-ok' }, t('hero.healthy')) : null),
            quarantine.slice(0, 5).map((q, i) => React.createElement('div', { key: 'q' + i, className: 'hao-capsule-kv' },
              React.createElement('span', { className: 'hao-mono', style: { fontSize: 11 } }, q.provider + ' / ' + q.model),
              React.createElement('span', { className: 'hao-runitem-meta' },
                q.code ? React.createElement(Badge, { kind: 'warn', dot: false }, q.code) : null,
                React.createElement(Icon, { name: 'clock', size: 11 }), ' ', fmtCountdown((q.remainingMs || 0) - elapsed)))),
            (state.history || []).slice(0, 3).map((h, i) => React.createElement('div', { key: 'h' + i, className: 'hao-capsule-kv' },
              React.createElement('span', { className: 'hao-mono', style: { fontSize: 11 } }, String(h.at || '').slice(11, 19)),
              React.createElement('span', null, h.from, ' ', React.createElement(Icon, { name: 'zap', size: 10 }), ' ', h.to))),
            React.createElement('div', { className: 'hao-capsule-kv' },
              React.createElement('span', null, t('hero.activeRunsLabel')),
              activeRuns.length > 0
                ? React.createElement(Badge, { kind: 'info' }, t('hero.activeRuns', { n: activeRuns.length }))
                : React.createElement('span', { style: { color: 'var(--hao-label-3)' } }, t('hero.noActiveRuns'))),
            activeRuns.slice(0, 3).map((r, i) => React.createElement('div', { key: 'ar' + i, className: 'hao-capsule-kv' },
              React.createElement('span', { className: 'hao-mono', style: { fontSize: 11 } }, r.runId || ''),
              React.createElement(Badge, { kind: 'info', dot: false }, r.mode || ''))),
          ) : null,
        )
      }

      // ================= 页面内子代理悬浮面板 =================
      function formatSubagentTokens(value) {
        const n = Math.max(0, Number(value) || 0)
        if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M'
        if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'K'
        return String(Math.round(n))
      }
      function subagentRoleIcon(name, label) {
        const s = String(name || label || '').toLowerCase()
        if (/(review|critic|audit|qa|评审|审核|质检)/.test(s)) return 'eye'
        if (/(research|search|scout|调研|搜索|研究)/.test(s)) return 'globe'
        if (/(supervisor|supervise|reduce|merge|汇总|监督|归约|合成)/.test(s)) return 'layers'
        if (/(router|route|路由)/.test(s)) return 'fork'
        if (/(pipeline|stage|流水|阶段)/.test(s)) return 'pipeline'
        if (/(test|verify|check|测试|验证)/.test(s)) return 'check'
        return 'bot'
      }
      function subagentStatusKind(status) {
        const s = String(status || '').toLowerCase()
        if (s === 'running' || s === 'in_progress' || s === 'in-progress') return 'running'
        if (s === 'completed' || s === 'complete' || s === 'done' || s === 'success' || s === 'ok') return 'completed'
        if (s === 'error' || s === 'failed' || s === 'cancelled' || s === 'aborted' || s === 'max-tokens') return 'error'
        return 'pending'
      }
      function subagentStatusLabel(status) {
        const kind = subagentStatusKind(status)
        if (kind === 'running') return t('subagent.statusRunning')
        if (kind === 'completed') return t('subagent.statusCompleted')
        if (kind === 'error') return t('subagent.statusError')
        return t('subagent.statusPending')
      }
      function subagentAgentDef(state, name) {
        const agents = state && state.config && state.config.orch && state.config.orch.agents
        if (!Array.isArray(agents) || !name) return null
        return agents.find((a) => a && String(a.name || '') === String(name)) || null
      }
      function subagentDefaultModel(state) {
        const sel = state && state.defaultSelection
        return sel && sel.provider && sel.model ? String(sel.provider) + '/' + String(sel.model) : ''
      }
      function subagentModel(state, agentDef, explicit) {
        if (explicit) return String(explicit)
        if (agentDef && agentDef.provider && agentDef.model) return String(agentDef.provider) + '/' + String(agentDef.model)
        return subagentDefaultModel(state) || t('common.unknown')
      }
      function subagentDescription(agentDef, label, agent) {
        if (agentDef && agentDef.description) return String(agentDef.description)
        if (agentDef && agentDef.systemPrompt) return String(agentDef.systemPrompt).replace(/\s+/g, ' ').trim().slice(0, 150)
        return String(label || agent || t('subagent.noRole'))
      }
      function subagentInlineCopy(zh, en) {
        return String(__i18n.active || '').toLowerCase().indexOf('en') === 0 ? en : zh
      }
      function readOverlaySessionSnapshot() {
        try {
          const sessions = ctx.get('sessions')
          const list = sessions && sessions.list
          return list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : null
        } catch (e) {
          return null
        }
      }
      function overlaySessionLineage(snapshot) {
        const current = snapshot && snapshot.current
        if (!current) return []
        const byId = snapshot && snapshot.byId
        const addressParent = snapshot && snapshot.currentAddress && snapshot.currentAddress.parentSessionId
        const ids = []
        const seen = new Set()
        let cursor = String(current)
        while (cursor && !seen.has(cursor)) {
          seen.add(cursor)
          ids.push(cursor)
          const summary = byId && byId[cursor]
          // 只有连续的 subagent lineage 才属于同一目录树；普通 fork 的
          // parentId 不能把面板目录带回更早的会话根。
          if (summary && summary.origin !== 'subagent' && (cursor !== String(current) || !addressParent)) break
          // currentAddress 是官方打开子代理时的即时地址，优先用于第一跳；
          // 后续层级从 list.byId 的 parentId 继续向上，直到真正的根会话。
          const parent = cursor === String(current) && addressParent
            ? String(addressParent)
            : String((summary && (summary.parentId || summary.parentSessionId)) || '')
          if (!parent || parent === cursor) break
          cursor = parent
        }
        return ids
      }
      function overlaySessionRoot(snapshot) {
        const lineage = overlaySessionLineage(snapshot)
        return lineage.length > 0 ? lineage[lineage.length - 1] : ''
      }
      function overlaySessionScopeFromSnapshot(snapshot) {
        // 进入任意深度的子代理会话后，运行记录仍按整条血缘过滤，
        // 这样面板不会因为当前会话变化而只剩一个叶子节点。
        return overlaySessionLineage(snapshot)
      }
      function overlaySessionMatches(run, sessionScope) {
        if (!Array.isArray(sessionScope) || sessionScope.length === 0) return false
        const owner = run && (run.sessionId || run.agent || run.parentSessionId)
        return !!owner && sessionScope.indexOf(String(owner)) >= 0
      }
      function subagentResultFor(activeRuns, runs, agentId) {
        const id = String(agentId || '')
        let activeTask = null
        ;(Array.isArray(activeRuns) ? activeRuns : []).some((run) => {
          const found = (Array.isArray(run && run.tasks) ? run.tasks : []).find((task) => String((task && task.agentId) || '') === id)
          if (found) { activeTask = found; return true }
          return false
        })
        let result = null
        let record = null
        ;(Array.isArray(runs) ? runs : []).some((run) => {
          const found = (Array.isArray(run && run.runs) ? run.runs : []).find((item) => String((item && item.agentId) || '') === id)
          if (found) { result = found; record = run; return true }
          return false
        })
        return { activeTask, result, record }
      }
      function readBoundSubagentSnapshot(id) {
        try {
          const sessions = ctx.get('sessions')
          const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(String(id || '')) : null
          const session = binding && binding.session
          const snapshot = session && typeof session.getSnapshot === 'function' ? session.getSnapshot() : null
          return { session, snapshot }
        } catch (e) {
          return { session: null, snapshot: null }
        }
      }
      function subagentSnapshotModel(snapshot) {
        const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : []
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          const node = nodes[i]
          if (!node || node.kind !== 'assistant') continue
          const provenance = node.provenance
          if (provenance && provenance.provider && provenance.model) return String(provenance.provider) + '/' + String(provenance.model)
          const request = node.requestConfig
          if (request && request.provider && request.model) return String(request.provider) + '/' + String(request.model)
        }
        return ''
      }
      function subagentSnapshotStatus(snapshot) {
        const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : []
        const last = nodes.length > 0 ? nodes[nodes.length - 1] : null
        if (last && (last.kind === 'turn-error' || last.kind === 'turn-max-tokens')) return 'error'
        return ''
      }
      function subagentCatalogChildCount(snapshot, id) {
        const catalogs = snapshot && snapshot.subagentsByParent
        const catalog = catalogs && catalogs[String(id || '')]
        if (!catalog || catalog.state !== 'ready') return null
        return (Array.isArray(catalog.entries) ? catalog.entries : []).filter((entry) => entry && entry.kind === 'child').length
      }
      function subagentChildCountLabel(item) {
        if (item.childCount !== null && item.childCount !== undefined) return t('subagent.count', { n: item.childCount })
        return t('subagent.count', { n: item.hasChildren ? '…' : 0 })
      }
      function subagentCatalogItems(snapshot, state, activeRuns, runs, parentId) {
        const rootId = overlaySessionRoot(snapshot)
        const currentId = String(parentId || rootId || '')
        const catalogs = snapshot && snapshot.subagentsByParent
        const catalog = currentId && catalogs && catalogs[currentId]
        if (!rootId || !currentId || !catalog) return { available: false, loading: false, items: [], rootId, parentId: currentId }
        const entries = Array.isArray(catalog.entries) ? catalog.entries : []
        const currentSessionId = String((snapshot && snapshot.current) || '')
        const items = entries.filter((entry) => entry && entry.kind === 'child').map((entry) => {
          const id = String(entry.id || '')
          const match = subagentResultFor(activeRuns, runs, id)
          const summary = snapshot.byId && snapshot.byId[id]
          const configuredAgent = String((match.result && match.result.agent) || (summary && summary.agentPreset) || '')
          const label = String(entry.label || (summary && summary.displayTitle) || id)
          const def = subagentAgentDef(state, configuredAgent) || subagentAgentDef(state, label)
          const agent = configuredAgent || (def && def.name) || t('subagent.noRole')
          const bound = readBoundSubagentSnapshot(id)
          const sessionStatus = subagentSnapshotStatus(bound.snapshot)
          const isRunning = entry.activity === 'running' || !!(summary && summary.running)
          // 状态优先级：
          // 1. 如果正在运行 -> running
          // 2. 如果任务/会话/快照明确报 error / max-tokens -> error
          // 3. 如果有明确的运行结果 status -> match.result.status
          // 4. 如果会话已标记 completed -> completed
          // 5. 否则如果未运行且无结果 -> 保持 pending / idle，绝不盲目假绿 completed
          let status = 'pending'
          if (isRunning) {
            status = 'running'
          } else if (sessionStatus === 'error' || (match.result && subagentStatusKind(match.result.status) === 'error') || (match.activeTask && subagentStatusKind(match.activeTask.status) === 'error')) {
            status = 'error'
          } else if (match.result && match.result.status) {
            status = match.result.status
          } else if (summary && summary.completed) {
            status = 'completed'
          } else if (entry.activity === 'inactive' && summary) {
            status = 'completed'
          }
          const model = subagentModel(state, def, subagentSnapshotModel(bound.snapshot) || (match.result && match.result.lastKey) || (match.activeTask && match.activeTask.lastKey))
          const summaryUsage = readSubagentSummaryTokens(snapshot, id)
          return {
            key: 'catalog:' + currentId + ':' + id,
            label,
            agent,
            description: subagentDescription(def, label, agent),
            model,
            tokensAgentId: id,
            summaryUsage,
            isCurrent: id === currentSessionId,
            agentId: id,
            address: { parentSessionId: currentId, childSessionId: id, mode: entry.mode === 'continuable' ? 'continuable' : 'one-shot' },
            depth: 0,
            hasChildren: !!entry.hasChildren,
            childCount: subagentCatalogChildCount(snapshot, id),
            status: String(status || 'pending'),
            runId: String((match.record && match.record.runId) || ''),
            startedAt: String((match.record && match.record.startedAt) || ''),
          }
        })
        return { available: true, loading: catalog.state !== 'ready', items, rootId, parentId: currentId }
      }
      function subagentItems(activeRuns, runs, state) {
        const active = Array.isArray(activeRuns) ? activeRuns : []
        if (active.length > 0) {
          const out = []
          active.forEach((run) => {
            ;(Array.isArray(run && run.tasks) ? run.tasks : []).forEach((task) => {
              const agent = String((task && task.agent) || '')
              const def = subagentAgentDef(state, agent)
              const label = String((task && (task.label || task.id)) || run.mode || t('subagent.title'))
              out.push({
                key: 'active:' + String(run.runId || '') + ':' + String((task && task.id) || label),
                label,
                agent: agent || (def && def.name) || t('subagent.noRole'),
                description: subagentDescription(def, label, agent),
                model: subagentModel(state, def, task && task.lastKey),
                tokensAgentId: String((task && task.agentId) || ''),
                agentId: String((task && task.agentId) || ''),
                status: String((task && task.status) || 'pending'),
                runId: String((run && run.runId) || ''),
                startedAt: String((run && run.startedAt) || ''),
              })
            })
          })
          return out
        }
        const latest = Array.isArray(runs) && runs.length > 0 ? runs[0] : null
        if (!latest) return []
        return (Array.isArray(latest.runs) ? latest.runs : []).map((result, index) => {
          const agent = String((result && result.agent) || '')
          const def = subagentAgentDef(state, agent)
          const label = String((result && (result.label || result.id)) || t('subagent.title'))
          const id = String((result && result.agentId) || '')
          return {
            key: 'history:' + String(latest.runId || '') + ':' + String((result && result.id) || index),
            label,
            agent: agent || (def && def.name) || t('subagent.noRole'),
            description: subagentDescription(def, label, agent),
            model: subagentModel(state, def, result && result.lastKey),
            tokensAgentId: id,
            summaryUsage: null,
            isCurrent: false,
            agentId: id,
            status: String((result && result.status) || 'completed'),
            runId: String(latest.runId || ''),
            startedAt: String(latest.startedAt || ''),
          }
        })
      }
      function readSubagentSummaryTokens(snapshot, id) {
        const summary = snapshot && snapshot.byId && snapshot.byId[String(id || '')]
        const usage = summary && summary.projectionValues && summary.projectionValues.tokenUsage
        if (!usage || typeof usage !== 'object') return null
        const total = (Number(usage.uncachedInputTokens) || 0) + (Number(usage.outputTokens) || 0) + (Number(usage.cacheReadTokens) || 0) + (Number(usage.cacheWriteTokens) || 0)
        return {
          input: (Number(usage.uncachedInputTokens) || 0) + (Number(usage.cacheReadTokens) || 0) + (Number(usage.cacheWriteTokens) || 0),
          output: Number(usage.outputTokens) || 0,
          total,
        }
      }
      function readSubagentUsage(session) {
        try {
          const snapshot = session && typeof session.getSnapshot === 'function' ? session.getSnapshot() : null
          const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : []
          let seen = false
          let input = 0
          let output = 0
          let cacheRead = 0
          let cacheWrite = 0
          nodes.forEach((node) => {
            const usage = node && node.kind === 'assistant' ? node.usage : null
            if (!usage || typeof usage !== 'object') return
            seen = true
            input += Math.max(0, Number(usage.inputTokens) || 0)
            output += Math.max(0, Number(usage.outputTokens) || 0)
            cacheRead += Math.max(0, Number(usage.cacheReadTokens) || 0)
            cacheWrite += Math.max(0, Number(usage.cacheWriteTokens) || 0)
          })
          if (!seen) return null
          return { input, output, total: input + output + cacheRead + cacheWrite }
        } catch (e) {
          return null
        }
      }
      function SubagentUsage(props) {
        const agentId = String(props.agentId || '')
        const isCurrent = !!props.isCurrent
        const initialUsage = props.summaryUsage || null
        const [value, setValue] = React.useState(() => initialUsage ? { usage: initialUsage } : (agentId ? null : { missing: true }))
        React.useEffect(() => {
          if (initialUsage) setValue({ usage: initialUsage })
        }, [initialUsage ? initialUsage.total : 0])
        // 只有当前正在阅览该子代理会话时，才挂载实时流式 session 订阅更新；列表其它行直接消费 summary 投影。
        React.useEffect(() => {
          if (!isCurrent || !agentId) return undefined
          let disposed = false
          try {
            const sessions = ctx.get('sessions')
            const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(agentId) : null
            const session = binding && binding.session
            if (!session) return undefined
            let pending = null
            let lastKey = ''
            const commit = () => {
              pending = null
              if (disposed) return
              const usage = readSubagentUsage(session)
              const key = usage ? [usage.input, usage.output, usage.total].join(':') : 'none'
              if (key === lastKey) return
              lastKey = key
              setValue({ usage })
            }
            const schedule = () => {
              if (disposed || pending !== null) return
              pending = setTimeout(commit, 800)
            }
            commit()
            const unsubscribe = typeof session.subscribe === 'function' ? session.subscribe(schedule) : null
            return () => {
              disposed = true
              if (pending !== null) clearTimeout(pending)
              if (typeof unsubscribe === 'function') unsubscribe()
            }
          } catch (e) {
            return undefined
          }
        }, [agentId, isCurrent])
        let text = t('subagent.syncing')
        if (!agentId || (value && value.missing)) text = t('subagent.notTracked')
        else if (value && value.usage) text = formatSubagentTokens(value.usage.total) + ' ' + t('subagent.tokens')
        else if (value) text = '0 ' + t('subagent.tokens')
        return React.createElement('span', { title: value && value.usage ? (value.usage.input + ' in / ' + value.usage.output + ' out') : '' }, text)
      }
      function openSubagentSession(agentId, address) {
        const id = String(agentId || '')
        if (!id) return false
        try {
          const sessions = ctx.get('sessions')
          if (!sessions) return false
          const route = address || (typeof sessions.subagentAddress === 'function' ? sessions.subagentAddress(id) : undefined)
          if (route && typeof sessions.openSubagent === 'function') {
            sessions.openSubagent(route)
            return true
          }
          if (typeof sessions.open === 'function') {
            sessions.open(id)
            return true
          }
        } catch (e) { /* 旧 runtime 没有该会话时保持面板可用 */ }
        return false
      }
      function SubagentRow(props) {
        const item = props.item
        const kind = subagentStatusKind(item.status)
        const childCount = item.childCount === null || item.childCount === undefined ? null : Number(item.childCount)
        const canDrill = !!item.hasChildren || (Number.isFinite(childCount) && childCount > 0)
        // A 条只在目录已加载且确认有两个以上直接下级时出现。
        // hasChildren 只是“可能有下级”的 hint，不能单独作为展示条件。
        const showChildrenEntry = Number.isFinite(childCount) && childCount > 1
        const openSession = () => openSubagentSession(item.agentId, item.address)
        return React.createElement('div', { className: 'hao-subagent-row hao-subagent-row-' + kind + (canDrill ? ' hao-subagent-row-parent' : ''), role: 'group', onClick: openSession },
          React.createElement('button', { type: 'button', className: 'hao-subagent-row-main', title: t('subagent.openSession'), onClick: (event) => { event.stopPropagation(); openSession() } },
            React.createElement('span', { className: 'hao-subagent-row-head' },
              React.createElement('span', { className: 'hao-subagent-role-ico' }, React.createElement(Icon, { name: subagentRoleIcon(item.agent, item.label), size: 14 })),
              React.createElement('span', { className: 'hao-subagent-row-title' },
                React.createElement('span', { className: 'hao-subagent-row-label' }, item.label),
                React.createElement('span', { className: 'hao-subagent-row-agent' }, item.agent),
              ),
              React.createElement('span', { className: 'hao-subagent-status hao-subagent-status-' + kind },
                React.createElement('span', { className: 'hao-subagent-status-dot' }), subagentStatusLabel(item.status)),
              React.createElement('span', { className: 'hao-subagent-child-count', title: subagentChildCountLabel(item) }, React.createElement(Icon, { name: 'layers', size: 10 }), subagentChildCountLabel(item)),
            ),
            React.createElement('span', { className: 'hao-subagent-row-desc' }, item.description),
            React.createElement('span', { className: 'hao-subagent-row-meta' },
              React.createElement('span', { className: 'hao-subagent-row-model', title: item.model }, React.createElement(Icon, { name: 'db', size: 11 }), item.model),
              React.createElement('span', { className: 'hao-subagent-row-tokens' }, React.createElement(Icon, { name: 'pulse', size: 11 }), React.createElement(SubagentUsage, { agentId: item.tokensAgentId, isCurrent: item.isCurrent, summaryUsage: item.summaryUsage, scopeKey: props.scopeKey })),
            ),
          ),
          showChildrenEntry ? React.createElement('div', { className: 'hao-subagent-row-actions' },
            React.createElement('button', { type: 'button', className: 'hao-subagent-children-bar', title: subagentInlineCopy('查看下级子代理', 'View child agents'), 'aria-label': subagentInlineCopy('查看下级子代理', 'View child agents'), onClick: (event) => { event.stopPropagation(); if (typeof props.onDrillDown === 'function') props.onDrillDown(item) } },
              React.createElement('span', null, React.createElement(Icon, { name: 'layers', size: 11 }), subagentChildCountLabel(item)),
              React.createElement(Icon, { name: 'chevronR', size: 11 })),
          ) : null,
        )
      }
      function SubagentOverlay() {
        const [open, setOpen] = React.useState(false)
        const [state, setState] = React.useState(null)
        const [activeRuns, setActiveRuns] = React.useState([])
        const [runs, setRuns] = React.useState(null)
        const [error, setError] = React.useState('')
        const disposedRef = React.useRef(false)
        const openRef = React.useRef(open)
        openRef.current = open
        // 完整 sessions 快照可能包含大量子会话目录；面板关闭时不持有它。
        const [sessionSnapshot, setSessionSnapshot] = React.useState(null)
        const [sessionScope, setSessionScope] = React.useState(() => overlaySessionScopeFromSnapshot(readOverlaySessionSnapshot()))
        const openedCatalogsRef = React.useRef(new Set())
        const [catalogParentId, setCatalogParentId] = React.useState('')
        const [catalogTrail, setCatalogTrail] = React.useState([])
        const catalogTrailRef = React.useRef([])
        const rootCatalogId = open ? overlaySessionRoot(sessionSnapshot) : ''
        const currentCatalogParentId = catalogParentId || rootCatalogId
        const sessionScopeKey = sessionScope.join('\u0000')
        const installInterval = (fn, ms) => {
          try {
            const timer = ctx.get('timer')
            if (timer && typeof timer.interval === 'function') {
              const dispose = timer.interval(fn, ms)
              return typeof dispose === 'function' ? dispose : () => {}
            }
          } catch (e) { /* fallback below */ }
          const handle = setInterval(fn, ms)
          return () => clearInterval(handle)
        }
        const refreshState = () => rpc.stateGet().then((next) => {
          if (disposedRef.current || !openRef.current) return
          if (next && next.i18n) syncI18n(next.i18n)
          setState(next || null)
          setError('')
        }).catch((e) => { if (!disposedRef.current) setError(String((e && e.message) || e)) })
        const refreshActive = () => rpc.orchActive().then((res) => {
          if (disposedRef.current) return
          setActiveRuns((res && Array.isArray(res.runs)) ? res.runs : [])
        }).catch((e) => { if (!disposedRef.current && !activeRuns) setError(String((e && e.message) || e)) })
        // 点击打开面板或收到事件时，全量获取 runs 记录，保证子代理失败/完成状态真实准确
        const refreshRuns = (scope) => (openRef.current ? rpc.orchRuns() : rpc.orchRecent({ limit: 24, sessionIds: Array.isArray(scope) ? scope : sessionScope })).then((res) => {
          if (disposedRef.current || !openRef.current) return
          setRuns((res && Array.isArray(res.runs)) ? res.runs : [])
        }).catch((e) => { if (!disposedRef.current && !runs) setError(String((e && e.message) || e)) })
        const refreshCatalogs = () => {
          try {
            if (!open) return
            const sessions = ctx.get('sessions')
            if (!sessions || typeof sessions.refreshSubagents !== 'function') return
            const ids = new Set([rootCatalogId])
            if (open && currentCatalogParentId && currentCatalogParentId !== rootCatalogId) ids.add(currentCatalogParentId)
            const catalogs = sessionSnapshot && sessionSnapshot.subagentsByParent
            const currentCatalog = catalogs && currentCatalogParentId && catalogs[currentCatalogParentId]
            const entries = currentCatalog && Array.isArray(currentCatalog.entries) ? currentCatalog.entries : []
            if (open) entries.forEach((entry) => {
              if (entry && entry.kind === 'child' && entry.hasChildren && entry.id) ids.add(String(entry.id))
            })
            ids.forEach((id) => { if (id) sessions.refreshSubagents(id).catch(() => {}) })
          } catch (e) { /* sessions service may be unavailable during host startup */ }
        }
        const refreshAll = () => { refreshState(); refreshActive(); refreshRuns(sessionScope); refreshCatalogs() }
        React.useEffect(() => {
          disposedRef.current = false
          refreshActive()
          // 悬浮胶囊 FAB 状态轮询：关闭时低频轻量拉取 active 视图，保证 FAB 胶囊实时显示 running(黄色)/done(绿色)/error(红色)
          const activeDispose = installInterval(refreshActive, open ? 1800 : 3000)
          return () => {
            disposedRef.current = true
            activeDispose()
          }
        }, [open])
        React.useEffect(() => {
          if (!open) {
            // 及时释放完整配置、历史和 sessions 目录快照，避免关闭面板后继续占用浏览器内存。
            setState(null)
            setRuns(null)
            setSessionSnapshot(null)
            setError('')
            return undefined
          }
          // 用户点击展开面板：立即全量拉取一次完整信息
          refreshState()
          refreshActive()
          refreshRuns(sessionScope)
          refreshCatalogs()
        }, [open, sessionScopeKey])
        React.useEffect(() => {
          let unsubscribe = null
          let debounceTimer = null
          const sync = () => {
            const snapshot = readOverlaySessionSnapshot()
            // 关闭时只提取很小的 lineage；打开时才把目录快照交给 React。
            if (open) setSessionSnapshot(snapshot)
            const next = overlaySessionScopeFromSnapshot(snapshot)
            setSessionScope((prev) => {
              if (prev.length === next.length && prev.every((id, index) => id === next[index])) return prev
              return next
            })
            // 事件驱动（类似 Kafka 消息机制）：捕获到会话/子代理消息通信时触发刷新
            if (open) {
              if (debounceTimer !== null) clearTimeout(debounceTimer)
              debounceTimer = setTimeout(() => {
                refreshActive()
                refreshRuns(next)
                refreshCatalogs()
              }, 400)
            }
          }
          const bind = () => {
            if (unsubscribe) return
            try {
              const sessions = ctx.get('sessions')
              const list = sessions && sessions.list
              if (list && typeof list.subscribe === 'function') unsubscribe = list.subscribe(sync)
            } catch (e) { /* sessions service may mount after this plugin */ }
          }
          sync()
          bind()
          const scopeDispose = installInterval(() => { sync(); bind() }, 2000)
          return () => {
            if (debounceTimer !== null) clearTimeout(debounceTimer)
            scopeDispose()
            if (typeof unsubscribe === 'function') unsubscribe()
          }
        }, [open])
        React.useEffect(() => {
          if (!rootCatalogId) return
          catalogTrailRef.current = []
          setCatalogParentId(rootCatalogId)
          setCatalogTrail([])
        }, [rootCatalogId])
        React.useEffect(() => {
          let sessions = null
          try { sessions = ctx.get('sessions') } catch (e) { sessions = null }
          const catalogs = sessionSnapshot && sessionSnapshot.subagentsByParent
          const desired = new Set()
          if (open && rootCatalogId) desired.add(rootCatalogId)
          if (open && currentCatalogParentId && currentCatalogParentId !== rootCatalogId) desired.add(currentCatalogParentId)
          const currentCatalog = catalogs && currentCatalogParentId && catalogs[currentCatalogParentId]
          const currentEntries = currentCatalog && Array.isArray(currentCatalog.entries) ? currentCatalog.entries : []
          if (open) {
            // 只为当前层的行预取下一层目录，用于显示子代理数量；不递归展开，更不把后代平铺到首页。
            currentEntries.forEach((entry) => {
              if (entry && entry.kind === 'child' && entry.hasChildren && entry.id) desired.add(String(entry.id))
            })
          }
          const opened = openedCatalogsRef.current
          opened.forEach((parentId) => {
            if (desired.has(parentId)) return
            try { if (sessions && typeof sessions.setSubagentCatalogOpen === 'function') sessions.setSubagentCatalogOpen(parentId, false) } catch (e) { /* ignore */ }
            opened.delete(parentId)
          })
          desired.forEach((parentId) => {
            if (opened.has(parentId)) return
            opened.add(parentId)
            try {
              if (sessions && typeof sessions.setSubagentCatalogOpen === 'function') sessions.setSubagentCatalogOpen(parentId, true)
              else if (sessions && typeof sessions.refreshSubagents === 'function') sessions.refreshSubagents(parentId).catch(() => {})
            } catch (e) { /* ignore */ }
          })
        }, [sessionSnapshot, rootCatalogId, currentCatalogParentId, open])
        React.useEffect(() => () => {
          let sessions = null
          try { sessions = ctx.get('sessions') } catch (e) { sessions = null }
          openedCatalogsRef.current.forEach((parentId) => {
            try { if (sessions && typeof sessions.setSubagentCatalogOpen === 'function') sessions.setSubagentCatalogOpen(parentId, false) } catch (e) { /* ignore */ }
          })
          openedCatalogsRef.current.clear()
        }, [])
        React.useEffect(() => {
          if (!open || typeof window === 'undefined') return undefined
          const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false) }
          window.addEventListener('keydown', closeOnEscape)
          return () => window.removeEventListener('keydown', closeOnEscape)
        }, [open])
        const rootSummary = sessionSnapshot && sessionSnapshot.byId && rootCatalogId ? sessionSnapshot.byId[rootCatalogId] : null
        const rootLabel = String((rootSummary && rootSummary.displayTitle) || t('subagent.title'))
        const currentLabel = catalogTrail.length > 0 ? String(catalogTrail[catalogTrail.length - 1].label || catalogParentId) : rootLabel
        const enterCatalog = (item) => {
          const rawChildCount = item && item.childCount
          const childCount = rawChildCount === null || rawChildCount === undefined ? null : Number(rawChildCount)
          const hasDirectory = !!item && (!!item.hasChildren || (Number.isFinite(childCount) && childCount > 1))
          if (!hasDirectory) return openSubagentSession(item && item.agentId, item && item.address)
          const next = catalogTrailRef.current.concat([{ id: String(item.agentId || ''), label: String(item.label || item.agentId || '') }])
          catalogTrailRef.current = next
          setCatalogTrail(next)
          setCatalogParentId(String(item.agentId || ''))
          return true
        }
        const goHome = () => {
          catalogTrailRef.current = []
          setCatalogTrail([])
          setCatalogParentId(rootCatalogId)
        }
        const goBack = () => {
          const trail = catalogTrailRef.current
          if (trail.length === 0) return
          const next = trail.slice(0, -1)
          catalogTrailRef.current = next
          setCatalogTrail(next)
          setCatalogParentId(next.length > 0 ? next[next.length - 1].id : rootCatalogId)
        }
        const goToTrail = (index) => {
          const trail = catalogTrailRef.current
          const entry = trail[index]
          if (!entry) return
          const next = trail.slice(0, index + 1)
          catalogTrailRef.current = next
          setCatalogTrail(next)
          setCatalogParentId(entry.id)
        }
        const breadcrumbNodes = [
          React.createElement('button', { key: 'root', type: 'button', className: catalogTrail.length > 0 ? 'hao-subagent-breadcrumb' : 'hao-subagent-breadcrumb-current', title: rootLabel, onClick: goHome }, rootLabel),
        ]
        catalogTrail.forEach((entry, index) => {
          breadcrumbNodes.push(React.createElement('span', { key: 'sep:' + index, className: 'hao-subagent-breadcrumb-sep' }, '/'))
          breadcrumbNodes.push(index === catalogTrail.length - 1
            ? React.createElement('span', { key: 'current:' + entry.id, className: 'hao-subagent-breadcrumb-current', title: entry.label }, entry.label)
            : React.createElement('button', { key: 'trail:' + entry.id, type: 'button', className: 'hao-subagent-breadcrumb', title: entry.label, onClick: () => goToTrail(index) }, entry.label))
        })
        const scopedActiveRuns = Array.isArray(activeRuns) ? activeRuns.filter((run) => overlaySessionMatches(run, sessionScope)) : []
        // orchRecent 已在 host 侧按 lineage 过滤；保留本地过滤兼容旧 host/异常载荷。
        const scopedRuns = open && Array.isArray(runs) ? runs.filter((run) => overlaySessionMatches(run, sessionScope)) : []
        const emptyCatalogView = { available: false, loading: false, items: [], rootId: '', parentId: '' }
        const catalogView = open
          ? subagentCatalogItems(sessionSnapshot, state, scopedActiveRuns, scopedRuns, currentCatalogParentId)
          : emptyCatalogView
        const isDrillPending = open && currentCatalogParentId !== rootCatalogId && !catalogView.available
        const hasCatalogSnapshot = open && !!(sessionSnapshot && sessionSnapshot.subagentsByParent && typeof sessionSnapshot.subagentsByParent === 'object')
        const catalogPending = open && !!rootCatalogId && hasCatalogSnapshot && !catalogView.available
        // 宿主已提供目录快照时，目录是唯一的数据源；等待目录期间不能
        // 回退到 run 记录，否则会把根会话和后代任务平铺到同一层。
        const items = open
          ? (catalogView.available ? catalogView.items : (hasCatalogSnapshot ? [] : subagentItems(scopedActiveRuns, scopedRuns, state)))
          : subagentItems(scopedActiveRuns, [], null)
        const catalogRunning = items.some((item) => subagentStatusKind(item.status) === 'running')
        const catalogError = items.some((item) => subagentStatusKind(item.status) === 'error')
        const tone = scopedActiveRuns.length > 0 || catalogRunning ? 'running' : (catalogError ? 'error' : (items.length > 0 ? 'done' : 'idle'))
        const statusText = tone === 'running' ? t('subagent.running') : (tone === 'error' ? t('subagent.statusError') : (tone === 'done' ? t('subagent.recentDone') : t('subagent.idle')))
        const count = items.length
        const latest = open && scopedRuns.length > 0 ? scopedRuns[0] : null
        const visible = open ? items.slice(0, 24) : []
        const more = open ? Math.max(0, items.length - visible.length) : 0
        return React.createElement('div', { className: 'hao-subagent-anchor' },
          open ? React.createElement('div', { className: 'hao-subagent-panel', role: 'dialog', 'aria-label': t('subagent.title') },
            React.createElement('div', { className: 'hao-subagent-panel-head' },
              React.createElement('span', { className: 'hao-subagent-panel-ico' }, React.createElement(Icon, { name: 'bot', size: 16 })),
              React.createElement('span', { className: 'hao-subagent-panel-heading' },
                React.createElement('span', { className: 'hao-subagent-panel-title' }, t('subagent.title')),
                React.createElement('span', { className: 'hao-subagent-panel-sub' }, statusText),
              ),
              React.createElement('span', { className: 'hao-subagent-panel-tools' },
                React.createElement('button', { type: 'button', className: 'hao-subagent-tool', title: t('subagent.refresh'), 'aria-label': t('subagent.refresh'), onClick: refreshAll }, React.createElement(Icon, { name: 'refresh', size: 13 })),
                React.createElement('button', { type: 'button', className: 'hao-subagent-tool', title: t('subagent.close'), 'aria-label': t('subagent.close'), onClick: () => setOpen(false) }, React.createElement(Icon, { name: 'x', size: 13 })),
              ),
            ),
            React.createElement('div', { className: 'hao-subagent-breadcrumbs' },
              React.createElement('button', { type: 'button', className: 'hao-subagent-breadcrumb-back', title: subagentInlineCopy('返回上级', 'Back'), 'aria-label': subagentInlineCopy('返回上级', 'Back'), disabled: catalogTrail.length === 0, onClick: goBack }, React.createElement(Icon, { name: 'chevronL', size: 12 })),
              breadcrumbNodes,
            ),
            React.createElement('div', { className: 'hao-subagent-summary' },
              React.createElement('span', { className: 'hao-subagent-summary-copy' },
                React.createElement('span', { className: 'hao-subagent-summary-title' }, currentLabel),
                React.createElement('span', { className: 'hao-subagent-summary-sub' }, t('subagent.count', { n: count })),
              ),
              React.createElement(Badge, { kind: tone === 'running' ? 'warn' : (tone === 'error' ? 'off' : (tone === 'done' ? 'on' : undefined)), muted: tone === 'idle' }, count),
            ),
            error ? React.createElement('div', { className: 'hao-subagent-panel-error' }, error) : null,
            runs === null || catalogPending || (catalogView.available && catalogView.loading && items.length === 0) || isDrillPending
              ? React.createElement('div', { className: 'hao-subagent-list' }, React.createElement('div', { className: 'hao-subagent-skeleton' }), React.createElement('div', { className: 'hao-subagent-skeleton' }))
              : visible.length > 0
                ? React.createElement('div', { className: 'hao-subagent-list' }, visible.map((item) => React.createElement(SubagentRow, { key: item.key, item, onDrillDown: enterCatalog, scopeKey: currentCatalogParentId + ':' + String((sessionSnapshot && sessionSnapshot.current) || '') })))
                : React.createElement('div', { className: 'hao-subagent-empty' }, React.createElement('span', { className: 'hao-subagent-empty-ico' }, React.createElement(Icon, { name: 'bot', size: 15 })), React.createElement('span', null, t('subagent.empty'))),
            more > 0 ? React.createElement('div', { className: 'hao-subagent-more' }, t('subagent.more', { n: more })) : null,
            React.createElement('div', { className: 'hao-subagent-panel-foot' },
              React.createElement('span', null, latest ? t('subagent.lastRun') + ' ' + fmtTime(latest.startedAt) : ''),
              latest && latest.runId ? React.createElement('span', { className: 'hao-mono', title: latest.runId }, String(latest.runId).slice(0, 18)) : null,
            ),
          ) : null,
          React.createElement('button', {
            type: 'button',
            className: 'hao-subagent-fab hao-subagent-fab-' + tone,
            'aria-expanded': open,
            'aria-label': t('subagent.title') + ': ' + statusText,
            onClick: () => setOpen(!open),
          },
            React.createElement('span', { className: 'hao-subagent-fab-dot' }),
            React.createElement(Icon, { name: 'bot', size: 15 }),
            React.createElement('span', null, t('subagent.title')),
            count > 0 ? React.createElement('span', { className: 'hao-subagent-fab-count' }, count) : null,
          ),
        )
      }

      // ================= 对话内 Run 卡片（orchestrate toolview） =================
      // 通过官方 tool.call.toolview 槽位按工具名注册：运行中轮询 host 的
      // orchActive 实时展示进度/异常/总数/每个子代理的 lastKey；完成后用
      // presentationMeta 回放各子任务状态与 lastKey。
      function RunCard(props) {
        const block = props.block || {}
        const [active, setActive] = React.useState(null)
        const running = block.kind === 'tool-call' || (block.callId && block.isError === undefined && !block.resultView && !block.meta && !block.content)
        const callId = running ? (block.callId || (block.call && block.call.callId) || '') : ''
        React.useEffect(() => {
          if (!running || !callId) return
          let disposed = false
          const tick = () => {
            rpc.orchActive().then((res) => {
              if (disposed) return
              const list = (res && res.runs) || []
              const found = list.find((r) => String(r.callId) === String(callId)) || null
              setActive(found)
            }).catch(() => { /* 轮询失败保持上一帧，不打断卡片 */ })
          }
          tick()
          let timer = null
          let interval = null
          try {
            const t = ctx.get('timer')
            if (t && typeof t.interval === 'function') timer = t.interval(tick, 1000)
          } catch (e) { /* ignore */ }
          if (!timer && typeof setInterval === 'function') interval = setInterval(tick, 1000)
          return () => {
            disposed = true
            if (timer) { try { timer() } catch (e) { /* ignore */ } }
            if (interval) clearInterval(interval)
          }
        }, [running, callId])
        if (!props.block) return null
        const subCount = running && Array.isArray(block.subCalls) ? block.subCalls.length : 0
        const argsRaw = running ? (block.argsRaw || '') : (block.call && block.call.argsRaw) || ''
        let mode = ''
        try { const a = JSON.parse(argsRaw); if (a && a.mode) mode = String(a.mode) } catch (e) { /* ignore */ }
        const rv = !running && block.resultView ? block.resultView : null
        let title = 'orchestrate' + (mode ? ' (' + mode + ')' : '')
        if (rv && rv.title) title = rv.title
        const tasks = (active && active.tasks) || []
        const done = tasks.filter((x) => x.status === 'completed').length
        const errors = tasks.filter((x) => x.status && x.status !== 'pending' && x.status !== 'running' && x.status !== 'completed').length
        const runningCount = tasks.filter((x) => x.status === 'running').length
        const total = tasks.length
        const statusText = running
          ? (active && total > 0
              ? t('orch.cardRunningProgress', { done: done, error: errors, running: runningCount, total: total })
              : t('orch.cardRunning', { n: subCount }))
          : (block.isError ? t('orch.cardError') : t('orch.cardDone'))
        const content = (!running && rv && rv.content) ? rv.content : (!running ? block.content : null)
        const text = (content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        const metaRuns = !running && block.meta && Array.isArray(block.meta.runs) ? block.meta.runs : []
        const children = [
          React.createElement('div', { className: 'hao-run-card-head' },
            React.createElement('span', { className: 'hao-run-card-title' },
              React.createElement(Icon, { name: modeIcon(mode), size: 14 }),
              React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title)),
            React.createElement(Badge, { kind: running ? 'info' : (block.isError ? 'off' : 'on') },
              running ? React.createElement(Icon, { name: 'clock', size: 11, spin: true }) : React.createElement(Icon, { name: block.isError ? 'x' : 'check', size: 11 }),
              ' ', statusText),
          ),
        ]
        if (running && active && total > 0) {
          const pct = total ? Math.min(100, Math.round((done + errors) / total * 100)) : 0
          children.push(React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('div', { className: 'hao-orch-progress', style: { flex: 1 } },
              React.createElement('div', { className: 'hao-orch-progress-fill', style: { width: pct + '%' } }),
            ),
            React.createElement('span', { className: 'hao-mono', style: { fontSize: 11, color: 'var(--hao-label-3)', flex: 'none' } }, pct + '%'),
          ))
          children.push(React.createElement('div', { className: 'hao-orch-stats' },
            React.createElement(Badge, { kind: 'on' }, React.createElement(Icon, { name: 'check', size: 10 }), ' ', t('orch.statDone', { n: done })),
            errors > 0 ? React.createElement(Badge, { kind: 'off' }, React.createElement(Icon, { name: 'x', size: 10 }), ' ', t('orch.statError', { n: errors })) : null,
            runningCount > 0 ? React.createElement(Badge, { kind: 'info' }, React.createElement(Icon, { name: 'clock', size: 10 }), ' ', t('orch.statRunning', { n: runningCount })) : null,
            React.createElement(Badge, { muted: true, dot: false }, t('orch.statTotal', { n: total })),
          ))
          children.push(React.createElement('div', { className: 'hao-orch-tasks' },
            tasks.map((task, idx) => React.createElement('div', { key: task.id || idx, className: 'hao-orch-task' },
              React.createElement('span', {
                className: 'hao-orch-task-dot ' + (task.status === 'error' ? 'error' : (task.status === 'running' ? 'running' : (task.status === 'pending' ? '' : 'done'))),
              }),
              React.createElement('span', { className: 'hao-orch-task-label' }, task.label || task.id),
              task.agent ? React.createElement('span', { className: 'hao-orch-task-agent' }, task.agent) : null,
              React.createElement('span', { className: 'hao-mono hao-orch-task-lastkey', title: task.lastKey || '' }, task.lastKey || '-'),
            )),
          ))
        }
        if (!running && metaRuns.length > 0) {
          children.push(React.createElement('table', { className: 'hao-orch-table' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', null, t('orch.taskLabel')),
              React.createElement('th', null, t('orch.taskAgent')),
              React.createElement('th', null, t('orch.taskStatus')),
              React.createElement('th', null, t('orch.taskLastKey')),
            )),
            React.createElement('tbody', null, metaRuns.map((r, i) => React.createElement('tr', { key: r.id || i },
              React.createElement('td', null, r.label || r.id),
              React.createElement('td', null, r.agent || ''),
              React.createElement('td', null, r.status),
              React.createElement('td', { className: 'hao-mono' }, r.lastKey || '-'),
            ))),
          ))
        }
        if (text) children.push(React.createElement('pre', { className: 'hao-pre hao-run-card-body' }, text))
        return React.createElement('div', { className: 'hao-run-card' }, ...children)
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
      // 页面级悬浮子代理面板：shell.overlay 是 list slot，和宿主 AppFrame 叠加，
      // 不占用设置页/对话页布局，也不会替换 root 单槽位。
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'dsh-ha-orchestrator-subagents', order: 32 },
        () => React.createElement(SubagentOverlay),
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
