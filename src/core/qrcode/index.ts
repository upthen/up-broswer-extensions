/** 二维码模块统一入口：生成 / 渲染 / 解码 */
export * from './types'
export { encodeQr } from './generate'
export { decodeQr } from './decode'
export { normalizeColor, hexToRgb, qrPath, qrSvg, matrixToRgba } from './render'
export type { RgbaImage } from './render'

/** 载入示例时使用的文本，含中文与 emoji，用来展示 UTF-8 编码能力 */
export const QR_SAMPLE = '研发好朋友 DevBuddy 🚀\nhttps://example.com/devbuddy'

/** 导出 PNG 的边长选项 */
export const QR_SIZES = [256, 512, 1024, 2048] as const

export interface QrColorPreset {
  label: string
  dark: string
  light: string
}

export const QR_COLOR_PRESETS: QrColorPreset[] = [
  { label: '经典', dark: '#101828', light: '#ffffff' },
  { label: '品牌蓝', dark: '#3b62f6', light: '#ffffff' },
  { label: '松绿', dark: '#0f7b52', light: '#f4fbf7' },
  { label: '深紫', dark: '#7a3fd4', light: '#fbf8ff' },
]
