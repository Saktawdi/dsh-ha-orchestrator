// ============================================================================
// ha-orchestrator 语言系统 —— 纯工具（无 DSH 依赖，可独立单测）
// ----------------------------------------------------------------------------
// 语言包约定（见 .language/zh.ts 头部注释）：
//   每个语言包是一个 `.ts` 文件，形如 `export default { ... }`，内容是普通
//   对象字面量（字符串值），运行期无需 TS 编译器即可求值。
// 职责：
//   parseDictModule(text)  把语言包源文本解析成 { key: string } 字典；
//                           解析失败返回 null（触发 zh 回滚）。
//   resolveTarget(mode, dshLocale)  把配置模式解析为具体目标语言
//                                   （'auto' -> 跟随 DSH 语言，未知回 zh）。
//   pickDict(dicts, target) 挑选生效字典并做 zh 回滚决策。
//   translate(dict, key, params) 查字典 + {name} 占位符插值；缺失返回 key 本身。
// ============================================================================

/**
 * 找到第一个「不在注释/字符串内」的对象字面量起始 `{` 的位置。
 * @param {string} src 语言包源文本。
 * @returns {number} 起始下标，找不到返回 -1。
 */
function findObjectStart(src) {
  let inLine = false
  let inBlock = false
  let inStr = null
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === '\n') inLine = false; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 1; } continue }
    if (inStr !== null) { if (c === '\\') { i += 1; continue } if (c === inStr) inStr = null; continue }
    if (c === '/' && n === '/') { inLine = true; i += 1; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 1; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{') return i
  }
  return -1
}

/**
 * 从起始 `{` 提取配对的完整对象字面量文本（注释/字符串感知的括号配对）。
 * @param {string} src 语言包源文本。
 * @param {number} start 起始 `{` 的下标。
 * @returns {string|null} 字面量文本，未配对返回 null。
 */
function extractObjectLiteral(src, start) {
  let depth = 0
  let inLine = false
  let inBlock = false
  let inStr = null
  for (let i = start; i < src.length; i += 1) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === '\n') inLine = false; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 1; } continue }
    if (inStr !== null) { if (c === '\\') { i += 1; continue } if (c === inStr) inStr = null; continue }
    if (c === '/' && n === '/') { inLine = true; i += 1; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 1; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 把 `.ts` 语言包源文本解析成字典对象。
 * 仅接受 `export default { ... }` 形式的普通对象字面量：
 * 支持注释、尾逗号、单引号/双引号、不带引号的键；不支持类型标注/import/表达式。
 * @param {string|null|undefined} text 语言包源文本。
 * @returns {Record<string,string>|null} 解析失败返回 null。
 */
export function parseDictModule(text) {
  if (text == null) return null
  const src = String(text).replace(/^\uFEFF/, '')
  const start = findObjectStart(src)
  if (start < 0) return null
  const body = extractObjectLiteral(src, start)
  if (body === null) return null
  let value
  try {
    // eslint-disable-next-line no-new-func
    value = new Function('return (' + body + ');')()
  } catch (e) {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const key of Object.keys(value)) {
    // 严格：语言包只允许字符串值；出现任何非字符串视为畸形包 -> null（触发回滚）
    if (typeof value[key] !== 'string') return null
    out[key] = value[key]
  }
  if (Object.keys(out).length === 0) return null
  return out
}

/**
 * 把配置模式解析为具体目标语言。
 * @param {string} mode 'auto' | 'zh' | 'en'。
 * @param {string|null|undefined} dshLocale DSH 当前语言（'zh' | 'en'），未知为 null。
 * @returns {'zh'|'en'} 目标语言。
 */
export function resolveTarget(mode, dshLocale) {
  if (mode === 'en' || mode === 'zh') return mode
  return dshLocale === 'en' ? 'en' : 'zh'
}

/**
 * 挑选生效字典；目标语言缺失/非法时自动回滚到 zh。
 * @param {Record<string,Record<string,string>|null>|null|undefined} dicts { zh?, en? }。
 * @param {'zh'|'en'} target 解析后的目标语言。
 * @returns {{ active:'zh'|'en', rollback:boolean, reason:string }}
 */
export function pickDict(dicts, target) {
  const zh = dicts && typeof dicts === 'object' ? dicts.zh : null
  const en = dicts && typeof dicts === 'object' ? dicts.en : null
  if (target === 'en' && en && typeof en === 'object') {
    return { active: 'en', rollback: false, reason: '' }
  }
  if (target === 'en') {
    // en 目标加载失败 -> 回滚 zh（zh 再失败则降级为键名直显）
    return { active: 'zh', rollback: true, reason: 'en' }
  }
  if (zh && typeof zh === 'object') {
    return { active: 'zh', rollback: false, reason: '' }
  }
  return { active: 'zh', rollback: true, reason: 'zh' }
}

/**
 * 查字典并插值。缺失键返回 key 本身（fail loud，避免 UI 空白）。
 * @param {Record<string,string>|null|undefined} dict 生效字典。
 * @param {string} key 文案键。
 * @param {Record<string,string|number>|null|undefined} [params] 插值参数。
 * @returns {string}
 */
export function translate(dict, key, params) {
  const template = dict && typeof dict === 'object' && typeof dict[key] === 'string' ? dict[key] : key
  if (!params) return template
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (
    name in params ? String(params[name]) : match
  ))
}

/**
 * 便捷：生成绑定到指定字典的 t(key, params) 函数。
 * @param {Record<string,string>|null|undefined} dict 生效字典。
 * @returns {(key:string, params?:Record<string,string|number>)=>string}
 */
export function makeT(dict) {
  return (key, params) => translate(dict, key, params)
}
