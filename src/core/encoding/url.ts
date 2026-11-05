/** URL / 表单编解码：组件、完整 URL、查询表单、路径四种模式，支持按行批量 */

import { boolOpt, failure, strOpt, success } from './types'
import type { EncodeResult, EncodingOptions } from './types'

export type UrlMode = 'component' | 'url' | 'form' | 'path'

const UNRESERVED_EXTRA: Record<string, string> = {
  '!': '%21',
  "'": '%27',
  '(': '%28',
  ')': '%29',
  '*': '%2A',
  '~': '%7E',
}

function tighten(text: string): string {
  return text.replace(/[!'()*~]/g, (ch) => UNRESERVED_EXTRA[ch] ?? ch)
}

function encodeOne(line: string, mode: UrlMode, strict: boolean): string {
  switch (mode) {
    case 'url': {
      const out = encodeURI(line)
      return strict ? tighten(out) : out
    }
    case 'path': {
      // 保留 / 作为路径分隔符，逐段编码；查询串按 key=value 逐项编码，保留 & 与 =
      const hashAt = line.indexOf('#')
      const hash = hashAt >= 0 ? line.slice(hashAt) : ''
      const main = hashAt >= 0 ? line.slice(0, hashAt) : line
      const queryAt = main.indexOf('?')
      const path = queryAt >= 0 ? main.slice(0, queryAt) : main
      const query = queryAt >= 0 ? main.slice(queryAt + 1) : ''
      const esc = (value: string) => (strict ? tighten(encodeURIComponent(value)) : encodeURIComponent(value))
      const encodedPath = path.split('/').map(esc).join('/')
      const encodedQuery = query
        ? '?' + query.split('&').map((pair) => pair.split('=').map(esc).join('=')).join('&')
        : ''
      return encodedPath + encodedQuery + hash
    }
    case 'form': {
      const out = strict ? tighten(encodeURIComponent(line)) : encodeURIComponent(line)
      return out.replace(/%20/g, '+')
    }
    case 'component':
    default: {
      const out = encodeURIComponent(line)
      return strict ? tighten(out) : out
    }
  }
}

/**
 * 解码 percent-encoding。
 * 先逐段收集 %XX 字节再按 UTF-8 解码，避免 decodeURIComponent 遇到
 * 跨字节序列时给出无位置信息的 URIError。
 */
function decodeOne(line: string, plusAsSpace: boolean): { text: string | null; error: string } {
  let source = line
  if (plusAsSpace) source = source.replace(/\+/g, ' ')

  // 先校验所有 % 转义，再按 UTF-8 把「普通字符字节 + %XX 字节」连续解码，
  // 这样 %E4%B8%AD 这类跨字节序列和普通字符混排时也能正确处理。
  // 按 Unicode 码点遍历，避免把 emoji 的代理对拆成两个损坏的字节序列
  const chars = Array.from(source)
  const all: number[] = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '%') {
      const hex = (chars[i + 1] ?? '') + (chars[i + 2] ?? '')
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        return { text: null, error: `第 ${i + 1} 个字符处的 % 转义不完整（需要两位十六进制，如 %20）` }
      }
      all.push(parseInt(hex, 16))
      i += 2
    } else {
      for (const byte of new TextEncoder().encode(chars[i])) all.push(byte)
    }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(all)), error: '' }
  } catch {
    return { text: null, error: '转义后的字节不是有效的 UTF-8 文本（可能是二进制数据或非 UTF-8 编码）' }
  }
}

function eachLine(input: string, enabled: boolean, fn: (line: string) => { text: string; error: string }): EncodeResult {
  if (!enabled) {
    const result = fn(input)
    return result.error ? failure(result.error) : success(result.text)
  }
  const lines = input.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    const result = fn(line)
    if (result.error) return failure(`第 ${i + 1} 行：${result.error}`)
    out.push(result.text)
  }
  return success(out.join('\n'), `按行处理 ${lines.length} 行`)
}

export function encodeUrl(input: string, options: EncodingOptions = {}): EncodeResult {
  if (!input) return success('', '等待输入')
  const rawMode = strOpt(options, 'mode', 'component')
  const mode: UrlMode =
    rawMode === 'url' || rawMode === 'form' || rawMode === 'path' ? rawMode : 'component'
  const strict = boolOpt(options, 'strict', false)
  const perLine = boolOpt(options, 'eachLine', false)

  const result = eachLine(input, perLine, (line) => ({ text: encodeOne(line, mode, strict), error: '' }))
  if (!result.ok) return result
  const labels: Record<UrlMode, string> = {
    component: '组件编码',
    url: '完整 URL',
    form: '表单编码（空格 → +）',
    path: '路径编码（保留 /）',
  }
  const note = [labels[mode], strict ? '严格 RFC 3986' : '', result.note].filter(Boolean).join(' · ')
  return success(result.text, note, result.warning)
}

export function decodeUrl(input: string, options: EncodingOptions = {}): EncodeResult {
  if (!input) return success('', '等待输入')
  const plusAsSpace = boolOpt(options, 'plusAsSpace', false)
  const perLine = boolOpt(options, 'eachLine', false)

  const result = eachLine(input, perLine, (line) => {
    const decoded = decodeOne(line, plusAsSpace)
    return { text: decoded.text ?? '', error: decoded.error }
  })
  if (!result.ok) return result
  const note = [plusAsSpace ? '+ 视为空格' : '+ 保持原样', result.note].filter(Boolean).join(' · ')
  return success(result.text, note, result.warning)
}
