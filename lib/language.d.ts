/** 语言字典：{ key: string }。 */
export type Dict = Record<string, string>;
/** 生效语言。 */
export type TargetLang = 'zh' | 'en';
/** 翻译函数（t(key, params)）。 */
export interface TFunc {
    (key: string, params?: Record<string, string | number>): string;
}
/**
 * 把语言包 JSON 文本解析成字典对象。
 * 仅接受严格 JSON 对象；任何非字符串值或空对象视为畸形包 -> null（触发回滚）。
 * @param text 语言包源文本。
 * @returns 解析失败返回 null。
 */
export declare function parseDictModule(text: string | null | undefined): Dict | null;
/**
 * 把配置模式解析为具体目标语言。
 * @param mode 'auto' | 'zh' | 'en'。
 * @param dshLocale DSH 当前语言（'zh' | 'en'），未知为 null。
 * @returns 目标语言。
 */
export declare function resolveTarget(mode: string, dshLocale: string | null | undefined): TargetLang;
/**
 * 挑选生效字典；目标语言缺失/非法时自动回滚到 zh。
 * @param dicts { zh?, en? }。
 * @param target 解析后的目标语言。
 * @returns 生效语言与回滚信息。
 */
export declare function pickDict(dicts: Partial<Record<TargetLang, Dict | null>> | null | undefined, target: TargetLang): {
    active: TargetLang;
    rollback: boolean;
    reason: string;
};
/**
 * 查字典并插值。缺失键返回 key 本身（fail loud，避免 UI 空白）。
 * @param dict 生效字典。
 * @param key 文案键。
 * @param params 插值参数。
 * @returns 渲染后的文案。
 */
export declare function translate(dict: Dict | null | undefined, key: string, params?: Record<string, string | number> | null): string;
/**
 * 便捷：生成绑定到指定字典的 t(key, params) 函数。
 * @param dict 生效字典。
 * @returns 翻译函数。
 */
export declare function makeT(dict: Dict | null | undefined): TFunc;
