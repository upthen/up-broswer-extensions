const ESCAPE_MAP: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

/**
 * 添加转义：把整段文本（通常是 JSON）转成可嵌进字符串字面量的形式。
 * 返回内容不含首尾引号。
 */
export function escapeJsonText(text: string): string {
  let out = ''
  for (const ch of text) {
    const mapped = ESCAPE_MAP[ch]
    if (mapped) {
      out += mapped
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0')
      continue
    }
    out += ch
  }
  return out
}

export type UnescapeResult = { ok: true; value: string } | { ok: false; message: string }

/** 移除转义：把 \n \t \" \\ \uXXXX 等还原成真实字符 */
export function unescapeJsonText(text: string): UnescapeResult {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const n = text[i + 1]
    if (n === undefined) {
      return { ok: false, message: '文本以反斜杠结尾，转义不完整' }
    }
    switch (n) {
      case '"':
      case "'":
      case '\\':
      case '/':
        out += n
        i += 1
        break
      case 'b':
        out += '\b'
        i += 1
        break
      case 'f':
        out += '\f'
        i += 1
        break
      case 'n':
        out += '\n'
        i += 1
        break
      case 'r':
        out += '\r'
        i += 1
        break
      case 't':
        out += '\t'
        i += 1
        break
      case 'u': {
        const hex = text.slice(i + 2, i + 6)
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          return { ok: false, message: `\\u 后面必须是 4 位十六进制数字，这里是「\\u${hex}」` }
        }
        out += String.fromCharCode(parseInt(hex, 16))
        i += 5
        break
      }
      case 'x': {
        const hex = text.slice(i + 2, i + 4)
        if (hex.length < 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
          return { ok: false, message: `\\x 后面必须是 2 位十六进制数字，这里是「\\x${hex}」` }
        }
        out += String.fromCharCode(parseInt(hex, 16))
        i += 3
        break
      }
      default:
        return { ok: false, message: `无法识别的转义字符「\\${n}」` }
    }
  }
  return { ok: true, value: out }
}
