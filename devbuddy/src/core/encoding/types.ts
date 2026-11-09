/** B8 编码工具：统一的输入 / 输出与错误约定 */

export type EncodingToolId = 'base64' | 'url' | 'unicode' | 'html' | 'jwt'
export type Direction = 'encode' | 'decode'

/** 所有选项收敛成一个扁平字典，便于 UI 直接绑定 */
export type EncodingOptions = Record<string, string | boolean | number>

export interface EncodeResult {
  ok: boolean
  /** 转换后的文本；失败时为空串 */
  text: string
  /** 成功时的说明（字节数、替换次数等） */
  note: string
  /** 成功但需要注意的情况 */
  warning: string
  /** 失败时的中文原因 */
  error: string
}

export function success(text: string, note = '', warning = ''): EncodeResult {
  return { ok: true, text, note, warning, error: '' }
}

export function failure(error: string): EncodeResult {
  return { ok: false, text: '', note: '', warning: '', error }
}

export function strOpt(options: EncodingOptions, key: string, fallback: string): string {
  const value = options[key]
  return typeof value === 'string' ? value : fallback
}

export function boolOpt(options: EncodingOptions, key: string, fallback: boolean): boolean {
  const value = options[key]
  return typeof value === 'boolean' ? value : fallback
}

export function numOpt(options: EncodingOptions, key: string, fallback: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
