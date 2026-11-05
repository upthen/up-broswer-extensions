/** JWT 三段解码（仅解析内容，明确不校验签名） */

import { base64ToBytes, decodeBase64UrlSegment } from './base64'

export interface JwtClaim {
  key: string
  label: string
  value: string
  hint: string
  tone: 'plain' | 'ok' | 'warn' | 'err'
}

export interface JwtResult {
  ok: boolean
  error: string
  status: 'active' | 'expired' | 'future' | 'unknown'
  statusText: string
  algorithm: string
  headerText: string
  payloadText: string
  signature: string
  signatureBytes: number
  claims: JwtClaim[]
  warnings: string[]
}

const CLAIM_LABELS: Record<string, string> = {
  iss: '签发者',
  sub: '主题（用户 ID）',
  aud: '受众',
  exp: '过期时间',
  nbf: '生效时间',
  iat: '签发时间',
  jti: '令牌 ID',
  azp: '授权方',
  scope: '权限范围',
  typ: '令牌类型',
  alg: '签名算法',
  kid: '密钥 ID',
}

const STANDARD_ORDER = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti', 'azp', 'scope']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return '无效时间戳'
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const utc = date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  return `${local}（本地） · ${utc}`
}

function relative(diffMs: number): string {
  const abs = Math.abs(diffMs)
  const units: [number, string, number, string][] = [
    [86400000, '天', 3600000, '小时'],
    [3600000, '小时', 60000, '分钟'],
    [60000, '分钟', 1000, '秒'],
    [1000, '秒', 0, ''],
  ]
  let text = ''
  for (const [unit, label, subUnit, subLabel] of units) {
    if (abs >= unit) {
      const n = Math.floor(abs / unit)
      const rest = subUnit ? Math.floor((abs % unit) / subUnit) : 0
      text = `${n} ${label}${rest && subLabel ? ` ${rest} ${subLabel}` : ''}`
      break
    }
  }
  if (!text) text = '不到 1 秒'
  return diffMs >= 0 ? `还有 ${text}` : `已过去 ${text}`
}

function asString(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(asString).join(', ')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function empty(error: string): JwtResult {
  return {
    ok: false,
    error,
    status: 'unknown',
    statusText: '',
    algorithm: '',
    headerText: '',
    payloadText: '',
    signature: '',
    signatureBytes: 0,
    claims: [],
    warnings: [],
  }
}

function parseSegment(segment: string, label: string): { value: Record<string, unknown> | null; error: string } {
  const text = decodeBase64UrlSegment(segment)
  if (text === null) return { value: null, error: `${label} 段不是有效的 Base64URL / UTF-8 文本` }
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { value: null, error: `${label} 段解析后不是 JSON 对象` }
    }
    return { value: value as Record<string, unknown>, error: '' }
  } catch {
    return { value: null, error: `${label} 段不是合法 JSON（${text.slice(0, 40)}…）` }
  }
}

/** 解析 JWT，返回可直接渲染的结构化结果；now 可注入以便单测时间相关逻辑 */
export function decodeJwt(input: string, now: number = Date.now()): JwtResult {
  let token = input.trim()
  if (/^Bearer\s+/i.test(token)) token = token.replace(/^Bearer\s+/i, '')
  token = token.replace(/\s+/g, '')
  if (!token) return empty('等待输入 JWT')

  const parts = token.split('.')
  if (parts.length > 3) return empty(`JWT 应为 3 段（用 . 分隔），当前有 ${parts.length} 段`)
  if (parts.length < 2) return empty('JWT 至少需要 header.payload 两段')
  const [head, body, sig = ''] = parts

  const header = parseSegment(head, 'Header')
  if (!header.value) return empty(header.error)
  const payload = parseSegment(body, 'Payload')
  if (!payload.value) return empty(payload.error)

  const algorithm = typeof header.value.alg === 'string' ? header.value.alg : '（未声明）'
  const sigBytes = sig ? (base64ToBytes(sig).bytes?.length ?? 0) : 0
  const warnings: string[] = [
    '只解码三段内容，不校验签名：验证签名需要密钥与服务端，本工具不会上传任何数据。请勿据此判断令牌是否可信。',
  ]
  if (algorithm.toLowerCase() === 'none') warnings.push('alg 为 none：该令牌未签名，任何人都可以伪造 payload。')
  if (!sig) warnings.push('签名段为空，这不是一个完整签名的 JWT。')

  const claims: JwtClaim[] = []
  const seen = new Set<string>()
  const addClaim = (key: string, value: unknown) => {
    if (seen.has(key)) return
    seen.add(key)
    const item: JwtClaim = {
      key,
      label: CLAIM_LABELS[key] ?? key,
      value: asString(value),
      hint: '',
      tone: 'plain',
    }
    if ((key === 'exp' || key === 'nbf' || key === 'iat') && typeof value === 'number') {
      const diff = value * 1000 - now
      item.value = formatTime(value)
      item.hint = relative(diff)
      if (key === 'exp') item.tone = diff < 0 ? 'err' : 'ok'
      if (key === 'nbf') item.tone = diff > 0 ? 'warn' : 'ok'
    }
    claims.push(item)
  }

  for (const key of STANDARD_ORDER) if (key in payload.value) addClaim(key, payload.value[key])
  for (const key of Object.keys(payload.value)) addClaim(key, payload.value[key])
  // 声明过多时截断，避免界面被撑爆
  const shownClaims = claims.slice(0, 24)

  const exp = typeof payload.value.exp === 'number' ? payload.value.exp * 1000 : null
  const nbf = typeof payload.value.nbf === 'number' ? payload.value.nbf * 1000 : null
  let status: JwtResult['status'] = 'unknown'
  let statusText = '无时间声明'
  if (exp !== null && now > exp) {
    status = 'expired'
    statusText = `已过期 ${relative(exp - now).replace('已过去 ', '')}`
  } else if (nbf !== null && now < nbf) {
    status = 'future'
    statusText = `尚未生效（${relative(nbf - now)}）`
  } else if (exp !== null || nbf !== null) {
    status = 'active'
    statusText = exp !== null ? `有效 · ${relative(exp - now)}` : '已在生效时间之后'
  }

  return {
    ok: true,
    error: '',
    status,
    statusText,
    algorithm,
    headerText: JSON.stringify(header.value, null, 2),
    payloadText: JSON.stringify(payload.value, null, 2),
    signature: sig,
    signatureBytes: sigBytes,
    claims: shownClaims,
    warnings,
  }
}
