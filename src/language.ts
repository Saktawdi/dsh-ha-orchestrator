// ============================================================================
// ha-orchestrator 语言系统 —— 纯工具（无 DSH 依赖，可独立单测）
// ----------------------------------------------------------------------------
// 语言包约定（见 .language/zh.json）：
//   每个语言包是一个严格 JSON 文件，内容是 { "key": "string" } 对象。
// 职责：
//   parseDictModule(text)  把语言包 JSON 文本解析成 { key: string } 字典；
//                           解析失败返回 null（触发 zh 回滚）。
//   resolveTarget(mode, dshLocale)  把配置模式解析为具体目标语言
//                                   （'auto' -> 跟随 DSH 语言，未知回 zh）。
//   pickDict(dicts, target) 挑选生效字典并做 zh 回滚决策。
//   translate(dict, key, params) 查字典 + {name} 占位符插值；缺失返回 key 本身。
// ============================================================================

/** 语言字典：{ key: string }。 */
export type Dict = Record<string, string>

/** 生效语言。 */
export type TargetLang = 'zh' | 'en'

/** 翻译函数（t(key, params)）。 */
export interface TFunc {
  (key: string, params?: Record<string, string | number>): string
}

/**
 * 把语言包 JSON 文本解析成字典对象。
 * 仅接受严格 JSON 对象；任何非字符串值或空对象视为畸形包 -> null（触发回滚）。
 * @param text 语言包源文本。
 * @returns 解析失败返回 null。
 */
export function parseDictModule(text: string | null | undefined): Dict | null {
  if (text == null) return null
  const src = String(text).replace(/^\uFEFF/, '')
  let value: unknown
  try {
    value = JSON.parse(src)
  } catch (e) {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Dict = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    // 严格：语言包只允许字符串值；出现任何非字符串视为畸形包 -> null（触发回滚）
    if (typeof (value as Record<string, unknown>)[key] !== 'string') return null
    out[key] = (value as Record<string, string>)[key]
  }
  if (Object.keys(out).length === 0) return null
  return out
}

/**
 * 把配置模式解析为具体目标语言。
 * @param mode 'auto' | 'zh' | 'en'。
 * @param dshLocale DSH 当前语言（'zh' | 'en'），未知为 null。
 * @returns 目标语言。
 */
export function resolveTarget(mode: string, dshLocale: string | null | undefined): TargetLang {
  if (mode === 'en' || mode === 'zh') return mode
  return dshLocale === 'en' ? 'en' : 'zh'
}

/**
 * 挑选生效字典；目标语言缺失/非法时自动回滚到 zh。
 * @param dicts { zh?, en? }。
 * @param target 解析后的目标语言。
 * @returns 生效语言与回滚信息。
 */
export function pickDict(
  dicts: Partial<Record<TargetLang, Dict | null>> | null | undefined,
  target: TargetLang,
): { active: TargetLang; rollback: boolean; reason: string } {
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
 * @param dict 生效字典。
 * @param key 文案键。
 * @param params 插值参数。
 * @returns 渲染后的文案。
 */
export function translate(dict: Dict | null | undefined, key: string, params?: Record<string, string | number> | null): string {
  const template = dict && typeof dict === 'object' && typeof dict[key] === 'string' ? dict[key] : key
  if (!params) return template
  return String(template).replace(/\{(\w+)\}/g, (match, name: string) => (
    name in params ? String(params[name]) : match
  ))
}

/**
 * 便捷：生成绑定到指定字典的 t(key, params) 函数。
 * @param dict 生效字典。
 * @returns 翻译函数。
 */
export function makeT(dict: Dict | null | undefined): TFunc {
  return (key, params) => translate(dict, key, params)
}
