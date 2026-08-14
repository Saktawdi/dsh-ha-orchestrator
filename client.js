return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
.hao-page { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 20px; font-size: 13px; }
.hao-card { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, transparent); overflow: hidden; }
.hao-card-head { display: flex; align-items: baseline; gap: 8px; padding: 10px 14px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); }
.hao-card-title { font-weight: 600; font-size: 14px; color: var(--dsw-alias-label-primary, inherit); }
.hao-card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.8)); }
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
.hao-ok { color: var(--dsw-alias-state-success-primary, #30a46c); font-size: 12px; }
.hao-run { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.9)); padding: 2px 0; flex-wrap: wrap; }
.hao-run-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-error-primary, #e5484d); }
.hao-run-dot.on { background: var(--dsw-alias-state-success-primary, #30a46c); }
.hao-run-last { font-size: 11px; opacity: .8; }
.hao-section { margin-top: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.85)); }
.hao-agent { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.hao-agent-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hao-agent-name { font-weight: 600; font-size: 13px; }
.hao-agent-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.85)); }
.hao-agent-sp { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.7)); white-space: pre-wrap; word-break: break-all; max-height: 60px; overflow: auto; }
.hao-form { display: flex; flex-direction: column; gap: 8px; border: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.35)); border-radius: 8px; padding: 10px; }
.hao-form-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hao-form-label { flex: 0 0 90px; font-size: 12px; color: var(--dsw-alias-label-secondary, rgba(127,127,127,.85)); }
`)

    // ================= 小组件 =================
    function Card(props) {
      return React.createElement('div', { className: 'hao-card' },
        React.createElement('div', { className: 'hao-card-head' },
          React.createElement('span', { className: 'hao-card-title' }, props.title),
          props.subtitle ? React.createElement('span', { className: 'hao-card-sub' }, props.subtitle) : null,
        ),
        React.createElement('div', { className: 'hao-card-body' }, props.children),
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
      }, props.children)
    }
    function Toggle(props) {
      return React.createElement('label', { className: 'hao-toggle' },
        React.createElement('input', { type: 'checkbox', checked: !!props.value, onChange: (e) => props.onChange(e.target.checked) }),
        React.createElement('span', null, props.label || '启用'),
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
        const t = next[i]
        next[i] = next[j]
        next[j] = t
        set({ backups: next })
      }
      const status = props.status
      const providers = props.providers || []
      const [adding, setAdding] = React.useState(false)
      const [addProvider, setAddProvider] = React.useState('')
      const [addModels, setAddModels] = React.useState([])
      const [addModel, setAddModel] = React.useState('')
      const [addBusy, setAddBusy] = React.useState(false)
      const loadModels = (provider) => {
        setAddBusy(true)
        host.call('models.list', { provider }).then((ms) => {
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
      return React.createElement(Card, { title: '模型高可用', subtitle: '当前模型失败时自动回退到备用模型，保证长任务不中断' },
        React.createElement(Row, { label: '启用', hint: '监听 agent/request 与 agent/request-error' },
          React.createElement(Toggle, { value: cfg.enabled, onChange: (v) => set({ enabled: v }) }),
        ),
        React.createElement('div', { className: 'hao-section' }, '备用模型列表（按顺序轮换，隔离冷却后自动恢复）'),
        backups.map((b, i) => React.createElement(Row, { key: 'b' + i, label: '备用 ' + (i + 1) },
          React.createElement(TextInput, { value: b.label, placeholder: '标签', width: '90px', onChange: (v) => setBackup(i, { label: v }) }),
          React.createElement(TextInput, { value: b.provider, placeholder: 'provider', width: '120px', onChange: (v) => setBackup(i, { provider: v }) }),
          React.createElement(TextInput, { value: b.model, placeholder: 'model', width: '150px', onChange: (v) => setBackup(i, { model: v }) }),
          React.createElement(TextInput, { value: b.reasoningEffort, placeholder: 'effort(可选)', width: '90px', onChange: (v) => setBackup(i, { reasoningEffort: v }) }),
          React.createElement(Btn, { mini: true, onClick: () => moveBackup(i, -1) }, '↑'),
          React.createElement(Btn, { mini: true, onClick: () => moveBackup(i, 1) }, '↓'),
          React.createElement(Btn, { mini: true, kind: 'danger', onClick: () => removeBackup(i) }, '删除'),
        )),
        React.createElement(Row, { label: '' },
          React.createElement(Btn, { onClick: openAdd }, '+ 添加备用模型（从配置读取）'),
        ),
        adding ? React.createElement(Row, { label: '选择备用模型' },
          React.createElement('select', { className: 'hao-input', value: addProvider, onChange: (e) => { setAddProvider(e.target.value); loadModels(e.target.value) } },
            providers.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.provider + (p.name && p.name !== p.provider ? '（' + p.name + '）' : ''))),
          ),
          React.createElement('select', { className: 'hao-input', style: { flex: 1 }, value: addModel, disabled: addBusy, onChange: (e) => setAddModel(e.target.value) },
            React.createElement('option', { value: '' }, addBusy ? '加载模型列表…' : '选择模型…'),
            addModels.map((m) => React.createElement('option', { key: m.model, value: m.model }, m.name && m.name !== m.model ? m.name + '（' + m.model + '）' : m.model)),
          ),
          React.createElement(Btn, { kind: 'primary', disabled: !addProvider || !addModel || addBusy, onClick: confirmAdd }, '添加'),
          React.createElement(Btn, { onClick: () => setAdding(false) }, '取消'),
        ) : null,
        React.createElement(Row, { label: '隔离冷却(ms)', hint: '失败模型隔离时长，到期自动恢复' },
          React.createElement(NumInput, { value: cfg.cooldownMs, onChange: (v) => set({ cooldownMs: Number(v) || 0 }) }),
        ),
        React.createElement(Row, { label: '失败阈值', hint: '连续失败几次后隔离' },
          React.createElement(NumInput, { value: cfg.threshold, onChange: (v) => set({ threshold: Number(v) || 1 }) }),
        ),
        React.createElement(Row, { label: '回退错误码', hint: '逗号分隔；留空=全部错误码都回退' },
          React.createElement(TextInput, { value: (cfg.codes || []).join(', '), width: '100%', onChange: (v) => set({ codes: v.split(',').map((s) => s.trim()).filter(Boolean) }) }),
        ),
        React.createElement(Row, { label: '持久化选择', hint: '切换后保存为新默认模型' },
          React.createElement(Toggle, { value: cfg.persistSelection, onChange: (v) => set({ persistSelection: v }) }),
        ),
        React.createElement(Row, { label: '停止后引导', hint: '模型错误中断时自动 steer 继续' },
          React.createElement(Toggle, { value: cfg.steerOnStop, onChange: (v) => set({ steerOnStop: v }) }),
        ),
        React.createElement('div', { className: 'hao-section' }, '运行状态'),
        React.createElement(Row, { label: '当前默认模型' },
          React.createElement('span', null, status.defaultSelection ? status.defaultSelection.provider + ' / ' + status.defaultSelection.model : '未知'),
        ),
        React.createElement('div', { className: 'hao-section' }, '隔离中的模型（' + (status.quarantine || []).length + '）'),
        status.quarantine && status.quarantine.length > 0
          ? React.createElement('table', { className: 'hao-table' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', null, 'provider'), React.createElement('th', null, 'model'), React.createElement('th', null, '错误码'), React.createElement('th', null, '剩余冷却'),
            )),
            React.createElement('tbody', null, status.quarantine.map((q, i) => React.createElement('tr', { key: 'q' + i },
              React.createElement('td', null, q.provider), React.createElement('td', null, q.model), React.createElement('td', null, q.code || ''), React.createElement('td', null, Math.round(q.remainingMs / 1000) + 's'),
            ))),
          )
          : React.createElement('div', { className: 'hao-section' }, '（无）'),
        React.createElement('div', { className: 'hao-section' }, '最近故障切换'),
        status.history && status.history.length > 0
          ? React.createElement('table', { className: 'hao-table' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', null, '时间'), React.createElement('th', null, '从'), React.createElement('th', null, '到'), React.createElement('th', null, '原因'),
            )),
            React.createElement('tbody', null, status.history.slice(0, 8).map((h, i) => React.createElement('tr', { key: 'h' + i },
              React.createElement('td', null, String(h.at).slice(11, 19)), React.createElement('td', null, h.from), React.createElement('td', null, h.to), React.createElement('td', null, h.code || ''),
            ))),
          )
          : React.createElement('div', { className: 'hao-section' }, '（暂无）'),
        React.createElement(Row, { label: '' },
          React.createElement(Btn, { kind: 'danger', onClick: () => host.call('ha.reset').then((s) => props.setState(s)).catch(() => {}) }, '清除隔离与历史'),
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
        host.call('models.list', { provider }).then((ms) => {
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
        host.call('agents.generate', { requirement: genReq }).then((res) => {
          const a = res && res.agent
          if (!a) { setGenErr('生成结果为空，请重试'); return }
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
        if (!name) { setFormErr('名称必填'); return }
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
        const t = next[i]
        next[i] = next[j]
        next[j] = t
        setAgents(next)
      }
      const form = editing
      const isNew = form && form.index < 0
      return React.createElement(Card, { title: '自定义子智能体', subtitle: '名称 / 模型 / 描述（展示给模型看）/ 系统提示词；编排时用 tasks[].agent 按名称指定' },
        agents.map((a, i) => React.createElement('div', { key: 'ag' + i, className: 'hao-agent' },
          React.createElement('div', { className: 'hao-agent-head' },
            React.createElement('span', { className: 'hao-agent-name' }, a.name || '（未命名）'),
            React.createElement('span', { className: 'hao-badge' }, (a.provider ? a.provider + '/' : '') + (a.model || '默认模型')),
            React.createElement('span', { style: { flex: 1 } }),
            React.createElement(Btn, { mini: true, onClick: () => move(i, -1) }, '↑'),
            React.createElement(Btn, { mini: true, onClick: () => move(i, 1) }, '↓'),
            React.createElement(Btn, { mini: true, onClick: () => openEdit(i, a) }, '编辑'),
            React.createElement(Btn, { mini: true, kind: 'danger', onClick: () => remove(i) }, '删除'),
          ),
          a.description ? React.createElement('div', { className: 'hao-agent-desc' }, a.description) : null,
          a.systemPrompt ? React.createElement('div', { className: 'hao-agent-sp' }, a.systemPrompt) : null,
        )),
        React.createElement(Row, { label: '' },
          React.createElement(Btn, { onClick: openNew }, '+ 添加子智能体'),
          React.createElement(Btn, { kind: 'primary', onClick: () => { setGenErr(''); setGenOpen(!genOpen) } }, '智能新增'),
        ),
        genOpen ? React.createElement('div', { className: 'hao-form' },
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, '需求*'),
            React.createElement('textarea', {
              className: 'hao-textarea',
              rows: 3,
              placeholder: '描述你想要的新子智能体，如：资深前端设计师，擅长 React 组件评审与 UX 改进；或：数据分析师，负责统计口径与图表解读',
              value: genReq,
              onChange: (e) => setGenReq(e.target.value),
            }),
          ),
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, '用当前默认模型自动生成名称/模型/描述/系统提示词，生成后可修改再添加'),
          ),
          genErr ? React.createElement('div', { className: 'hao-error' }, genErr) : null,
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement(Btn, { kind: 'primary', disabled: genBusy || !String(genReq || '').trim(), onClick: doGenerate }, genBusy ? '生成中…' : '生成'),
            React.createElement(Btn, { onClick: () => { setGenOpen(false); setGenReq(''); setGenErr('') } }, '取消'),
          ),
        ) : null,
        form ? React.createElement('div', { className: 'hao-form' },
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, '名称*'),
            React.createElement(TextInput, { value: form.name, placeholder: '如 reviewer', width: '160px', onChange: (v) => setEditing({ ...form, name: v }) }),
            React.createElement('span', { className: 'hao-form-label' }, '模型 provider'),
            React.createElement('select', {
              className: 'hao-input',
              value: form.provider,
              onChange: (e) => { const p = e.target.value; setEditing({ ...form, provider: p, model: '' }); setFormModels([]); if (p) loadFormModels(p) },
            },
              React.createElement('option', { value: '' }, '（默认/继承）'),
              providers.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.provider + (p.name && p.name !== p.provider ? '（' + p.name + '）' : ''))),
            ),
            React.createElement('span', { className: 'hao-form-label' }, '模型'),
            React.createElement('select', {
              className: 'hao-input',
              style: { flex: 1, minWidth: '140px' },
              value: form.model,
              disabled: formBusy,
              onChange: (e) => setEditing({ ...form, model: e.target.value }),
            },
              React.createElement('option', { value: '' }, formBusy ? '加载模型…' : '（默认/继承）'),
              formModels.map((m) => React.createElement('option', { key: m.model, value: m.model }, m.name && m.name !== m.model ? m.name + '（' + m.model + '）' : m.model)),
            ),
          ),
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, '描述'),
            React.createElement(TextInput, { value: form.description, placeholder: '展示给模型的用途说明', width: '100%', onChange: (v) => setEditing({ ...form, description: v }) }),
          ),
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement('span', { className: 'hao-form-label' }, '系统提示词'),
            React.createElement('textarea', {
              className: 'hao-textarea',
              rows: 3,
              placeholder: '子智能体的系统提示词（persona），如：你是一名资深代码审查员……',
              value: form.systemPrompt,
              onChange: (e) => setEditing({ ...form, systemPrompt: e.target.value }),
            }),
          ),
          formErr ? React.createElement('div', { className: 'hao-error' }, formErr) : null,
          React.createElement('div', { className: 'hao-form-row' },
            React.createElement(Btn, { kind: 'primary', onClick: save }, isNew ? '添加' : '保存'),
            React.createElement(Btn, { onClick: () => setEditing(null) }, '取消'),
          ),
        ) : null,
      )
    }

    // ================= 编排卡片 =================
    function OrchCard(props) {
      const cfg = props.cfg
      const set = (patch) => props.apply({ orch: { ...cfg, ...patch } })
      return React.createElement(Card, { title: '子智能体编排' },
        React.createElement(Row, { label: '启用', hint: '启用后模型可获得 orchestrate 工具' },
          React.createElement(Toggle, { value: cfg.enabled, onChange: (v) => set({ enabled: v }) }),
        ),
        React.createElement(Row, { label: '子智能体提供方', hint: 'subagents 注册表' },
          React.createElement('select', {
            className: 'hao-input',
            value: cfg.provider || '',
            onChange: (e) => set({ provider: e.target.value }),
          },
            React.createElement('option', { value: '' }, '自动（第一个可用）'),
            (props.providers || []).map((p) => React.createElement('option', { key: p, value: p }, p)),
          ),
        ),
        React.createElement(Row, { label: '默认并发数' },
          React.createElement(NumInput, { value: cfg.concurrency, onChange: (v) => set({ concurrency: Number(v) || 1 }) }),
        ),
        React.createElement(Row, { label: '最大子智能体数', hint: '单次编排的任务上限' },
          React.createElement(NumInput, { value: cfg.maxAgents, onChange: (v) => set({ maxAgents: Number(v) || 1 }) }),
        ),
        React.createElement('div', { className: 'hao-pre' },
          'orchestrate 工具用法：\n' +
          '• fanout：把 tasks 并行分发给子智能体并汇总 —— 适合可拆分的独立子任务\n' +
          '• pipeline：顺序执行，前一任务输出作为下一任务上下文 —— 适合多阶段流水线\n' +
          '• supervisor：并行执行后由监督子智能体审查合成 —— 适合需要质量把关的交付物\n' +
          '• 每个 task 可用 agent 字段指定自定义子智能体（名称见下方列表），顶层 agent 可设默认，supervisorAgent 指定监督者\n' +
          '你只需在对话中让模型调用 orchestrate 工具并给出目标与任务拆分。',
        ),
      )
    }

    // ================= 页面 =================
    function HaPage() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const refresh = () => {
        host.call('state.get').then((s) => { setState(s); setError('') }).catch((e) => setError(String((e && e.message) || e)))
      }
      React.useEffect(() => {
        refresh()
        const timer = ctx.get('timer')
        if (!timer) return
        const dispose = timer.interval(() => refresh(), 5000)
        return () => dispose()
      }, [])
      const apply = (patch) => {
        host.call('state.set', { patch }).then((s) => { setState(s); setError('') }).catch((e) => setError(String((e && e.message) || e)))
      }
      if (!state) {
        return React.createElement('div', { className: 'hao-page' }, error || '加载中…')
      }
      return React.createElement('div', { className: 'hao-page' },
        error ? React.createElement('div', { className: 'hao-error' }, error) : null,
        React.createElement(HaCard, { cfg: state.config.ha, apply, setState, status: state, providers: state.llmProviders || [] }),
        React.createElement(OrchCard, { cfg: state.config.orch, apply, providers: state.subagents || [] }),
        React.createElement(AgentsCard, { cfg: state.config.orch, apply, providers: state.llmProviders || [] }),
      )
    }

    // ================= Run 卡片状态 =================
    function HaStatusCard() {
      const [state, setState] = React.useState(null)
      const refresh = () => { host.call('state.get').then(setState).catch(() => {}) }
      React.useEffect(() => {
        refresh()
        const timer = ctx.get('timer')
        if (!timer) return
        const dispose = timer.interval(() => refresh(), 10000)
        return () => dispose()
      }, [])
      if (!state) return React.createElement('div', { className: 'hao-run' }, 'HA Orchestrator 运行中…')
      const cfg = state.config && state.config.ha
      const last = state.history && state.history[0]
      return React.createElement('div', { className: 'hao-run' },
        React.createElement('span', { className: 'hao-run-dot ' + (cfg && cfg.enabled ? 'on' : 'off') }),
        React.createElement('span', null,
          (cfg && cfg.enabled ? '模型高可用已启用' : '模型高可用已停用')
          + ' · 备用 ' + ((cfg && cfg.backups || []).length) + ' 个 · 隔离 ' + (state.quarantine || []).length + ' 个',
        ),
        last ? React.createElement('span', { className: 'hao-run-last' }, '最近切换: ' + last.from + ' → ' + last.to + ' (' + last.code + ')') : null,
      )
    }

    // ================= 注册 UI =================
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'ha-orchestrator', order: 12, label: 'HA 与编排' },
      () => React.createElement(HaPage),
    ))
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement(HaStatusCard),
    ))
  },
}
