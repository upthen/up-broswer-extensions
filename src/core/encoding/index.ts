/** B8 编码工具统一入口：元数据 + 分发，UI 只需调用 runEncoding */

import { bytesToBase64, decodeBase64, encodeBase64 } from './base64'
import { decodeUrl, encodeUrl } from './url'
import { decodeUnicode, encodeUnicode } from './unicode'
import { decodeHtml, encodeHtml } from './html'
import { decodeJwt } from './jwt'
import { failure, success } from './types'
import type { Direction, EncodeResult, EncodingOptions, EncodingToolId } from './types'

export interface EncodingToolMeta {
  id: EncodingToolId
  label: string
  short: string
  icon: string
  hint: string
  directions: Direction[]
  sample: () => string
}

const JWT_SAMPLE = (now = Date.now()): string => {
  const stamp = Math.floor(now / 1000)
  const segment = (value: unknown) =>
    bytesToBase64(new TextEncoder().encode(JSON.stringify(value)), true, false)
  const header = { alg: 'HS256', typ: 'JWT', kid: 'devbuddy-demo' }
  const payload = {
    iss: 'devbuddy.local',
    sub: 'user-10086',
    name: '研发好朋友',
    admin: true,
    scope: 'read write',
    iat: stamp - 3600,
    exp: stamp + 7 * 86400,
    jti: 'demo-3f9c1a',
  }
  const signature = bytesToBase64(new TextEncoder().encode('devbuddy-demo-signature'), true, false)
  return `${segment(header)}.${segment(payload)}.${signature}`
}

export const ENCODING_TOOLS: EncodingToolMeta[] = [
  {
    id: 'base64',
    label: 'Base64',
    short: '标准 / URL-safe',
    icon: 'brackets',
    hint: 'UTF-8 文本与 Base64 互转，支持 URL-safe 字母表、无填充、折行、data URI 与 Latin-1',
    directions: ['encode', 'decode'],
    sample: () => '研发好朋友 DevBuddy 🚀\n第二行：Hello, JSON!',
  },
  {
    id: 'url',
    label: 'URL 编码',
    short: '组件 / 完整 / 表单',
    icon: 'link',
    hint: '组件、完整 URL、表单、路径四种模式；支持严格 RFC 3986 与按行批量处理',
    directions: ['encode', 'decode'],
    sample: () => 'https://example.com/搜索?q=研发 好朋友&tag=a+b#片段',
  },
  {
    id: 'unicode',
    label: 'Unicode 转义',
    short: '\\uXXXX / \\u{…} / \\xNN',
    icon: 'code',
    hint: 'JS / JSON 风格转义互转，自动处理 emoji 代理对与 \\n \\t 等控制字符',
    directions: ['encode', 'decode'],
    sample: () => '研发好朋友 DevBuddy 🚀\n第二行 "引号" 与反斜杠 \\',
  },
  {
    id: 'html',
    label: 'HTML 实体',
    short: '命名 / 数字实体',
    icon: 'shield',
    hint: '转义 & < > " \'，解析命名实体与十进制/十六进制数字实体（含 emoji）',
    directions: ['encode', 'decode'],
    sample: () => '<div class="tip">研发 & "朋友" © 2026 → 🚀</div>',
  },
  {
    id: 'jwt',
    label: 'JWT 解码',
    short: 'Header / Payload / 声明',
    icon: 'key',
    hint: '拆解三段并展示声明与有效期；仅解码内容，不校验签名、不联网',
    directions: ['decode'],
    sample: () => JWT_SAMPLE(),
  },
]

export function toolMeta(id: EncodingToolId): EncodingToolMeta {
  return ENCODING_TOOLS.find((item) => item.id === id) ?? ENCODING_TOOLS[0]
}

/** 统一分发：所有失败都返回中文原因，成功时附带可展示的说明 */
export function runEncoding(
  id: EncodingToolId,
  direction: Direction,
  input: string,
  options: EncodingOptions = {},
): EncodeResult {
  switch (id) {
    case 'base64':
      return direction === 'encode' ? encodeBase64(input, options) : decodeBase64(input, options)
    case 'url':
      return direction === 'encode' ? encodeUrl(input, options) : decodeUrl(input, options)
    case 'unicode':
      return direction === 'encode' ? encodeUnicode(input, options) : decodeUnicode(input)
    case 'html':
      return direction === 'encode' ? encodeHtml(input, options) : decodeHtml(input)
    case 'jwt': {
      if (direction === 'encode') return failure('JWT 只支持解码（编码需要密钥签名，本工具不生成令牌）')
      const jwt = decodeJwt(input)
      return jwt.ok
        ? success(jwt.payloadText, `JWT 解析完成 · alg ${jwt.algorithm}`, jwt.warnings[0] ?? '')
        : failure(jwt.error)
    }
    default:
      return failure('未知的编码工具')
  }
}

export { decodeBase64, encodeBase64, decodeUrl, encodeUrl, decodeUnicode, encodeUnicode, decodeHtml, encodeHtml, decodeJwt }
export { bytesToBase64, base64ToBytes, bytesToText } from './base64'
export type { JwtResult, JwtClaim } from './jwt'
export type { EncodeResult, EncodingOptions, EncodingToolId, Direction } from './types'
