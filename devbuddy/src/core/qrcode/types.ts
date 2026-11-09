/** 二维码模块：统一的输入 / 输出与错误约定（与 encoding 模块保持一致） */

export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrOptions {
  /** 纠错等级，默认 M */
  level?: QrErrorLevel
  /** 版本号 1–40，0 或省略表示自动选最小版本 */
  version?: number
  /** 静区宽度（模块数），默认 4（QR 规范要求 ≥4） */
  margin?: number
  /** 深色模块颜色，默认 #101828 */
  dark?: string
  /** 背景颜色，默认 #ffffff */
  light?: string
}

/** 生成结果：模块矩阵按行优先存放，true = 深色 */
export interface QrCode {
  modules: boolean[]
  /** 不含静区的边长（模块数） */
  size: number
  /** 版本号 1–40 */
  version: number
  level: QrErrorLevel
  /** 原始内容 */
  text: string
  /** 内容的 UTF-8 字节数 */
  bytes: number
  margin: number
  /** 含静区后的边长（模块数） */
  total: number
}

export interface QrEncodeResult {
  ok: boolean
  code: QrCode | null
  note: string
  warning: string
  error: string
}

export interface QrDecodeResult {
  ok: boolean
  text: string
  note: string
  warning: string
  error: string
  /** 识别到的二维码版本，失败为 0 */
  version: number
  /** 原始数据字节数 */
  bytes: number
  /** 数据段数量 */
  chunks: number
}

export interface QrLevelMeta {
  id: QrErrorLevel
  label: string
  rate: string
  hint: string
}

/** 纠错等级元数据：容错率来自 QR 规范，容量是版本 40 + Byte 模式的最大字节数 */
export const QR_LEVELS: QrLevelMeta[] = [
  { id: 'L', label: 'L · 低', rate: '约 7%', hint: '容量最大，适合屏幕显示' },
  { id: 'M', label: 'M · 中', rate: '约 15%', hint: '默认，容量与容错均衡' },
  { id: 'Q', label: 'Q · 较高', rate: '约 25%', hint: '适合需要加 Logo 的场景' },
  { id: 'H', label: 'H · 高', rate: '约 30%', hint: '最耐污损，容量最小' },
]

/** 版本 40 / Byte 模式 / 无 ECI 的容量上限（字节） */
export const QR_CAPACITY: Record<QrErrorLevel, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
}

export const QR_DEFAULTS = {
  level: 'M' as QrErrorLevel,
  version: 0,
  margin: 4,
  dark: '#101828',
  light: '#ffffff',
}

export function encodeFailure(error: string): QrEncodeResult {
  return { ok: false, code: null, note: '', warning: '', error }
}

export function decodeFailure(error: string): QrDecodeResult {
  return { ok: false, text: '', note: '', warning: '', error, version: 0, bytes: 0, chunks: 0 }
}
