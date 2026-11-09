import { describe, expect, it } from 'vitest'
import {
  ENCODING_TOOLS,
  base64ToBytes,
  bytesToBase64,
  decodeBase64,
  decodeHtml,
  decodeJwt,
  decodeUnicode,
  decodeUrl,
  encodeBase64,
  encodeHtml,
  encodeUnicode,
  encodeUrl,
  runEncoding,
} from '../src/core/encoding'

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('Base64 / Base64URL', () => {
  it('ASCII 编码符合标准表', () => {
    expect(encodeBase64('Hello').text).toBe('SGVsbG8=')
    expect(encodeBase64('f').text).toBe('Zg==')
    expect(encodeBase64('fo').text).toBe('Zm8=')
    expect(encodeBase64('').text).toBe('')
  })

  it('中文按 UTF-8 多字节编码', () => {
    expect(encodeBase64('中文').text).toBe('5Lit5paH')
    expect(decodeBase64('5Lit5paH').text).toBe('中文')
  })

  it('emoji 等辅助平面字符可往返', () => {
    const encoded = encodeBase64('研发好朋友 🚀').text
    expect(bytesToBase64(utf8('研发好朋友 🚀'))).toBe(encoded)
    expect(decodeBase64(encoded).text).toBe('研发好朋友 🚀')
  })

  it('URL-safe 字母表与去填充', () => {
    const text = encodeBase64('主题??>>~~', { urlSafe: true, padding: false }).text
    expect(text).not.toMatch(/[+/=]/)
    expect(text).toMatch(/[-_]/)
    expect(decodeBase64(text).text).toBe('主题??>>~~')
    expect(decodeBase64(text).note).toContain('Base64URL')
  })

  it('折行编码仍可解码', () => {
    const text = encodeBase64('DevBuddy '.repeat(12), { wrap: 16 }).text
    expect(text).toContain('\n')
    expect(text.split('\n')[0]).toHaveLength(16)
    expect(decodeBase64(text).text).toBe('DevBuddy '.repeat(12))
  })

  it('data URI 前缀自动剥离', () => {
    const result = decodeBase64('data:text/plain;base64,5Lit5paH')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('中文')
    expect(result.note).toContain('data URI')
  })

  it('Latin-1 字符集与越界报错', () => {
    expect(encodeBase64('é', { charset: 'latin1' }).text).toBe('6Q==')
    const bad = encodeBase64('中文', { charset: 'latin1' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('超出 Latin-1')
  })

  it('非法字符与非法长度给出中文定位', () => {
    expect(decodeBase64('SGVs*bG8=').ok).toBe(false)
    expect(decodeBase64('SGVs*bG8=').error).toContain('不是合法的 Base64')
    expect(decodeBase64('A').error).toContain('长度不合法')
    expect(decodeBase64('SGVsbG8===').error).toContain('填充')
  })

  it('严格模式要求 4 的倍数长度', () => {
    expect(decodeBase64('SGVsbG8', { strict: true }).ok).toBe(false)
    expect(decodeBase64('SGVsbG8=', { strict: true }).ok).toBe(true)
  })

  it('非 UTF-8 字节降级为 Latin-1 并警告', () => {
    const result = decodeBase64('/w==')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('ÿ')
    expect(result.warning).toContain('不是有效的 UTF-8')
  })

  it('解码时移除 BOM', () => {
    const encoded = bytesToBase64(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('abc')]))
    const result = decodeBase64(encoded)
    expect(result.text).toBe('abc')
    expect(result.note).toContain('BOM')
  })

  it('底层字节接口正确', () => {
    expect([...(base64ToBytes('SGVsbG8=').bytes ?? [])]).toEqual([...utf8('Hello')])
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
  })

  it('多组随机文本往返一致', () => {
    const samples = ['a', 'ab', 'abc', 'abcd', '{"k":"值"}', '\n\t\r\0', '👨‍👩‍👧‍👦 家庭', 'x'.repeat(500)]
    for (const text of samples) {
      expect(decodeBase64(encodeBase64(text).text).text).toBe(text)
    }
  })
})

describe('URL 编解码', () => {
  it('组件模式编码中文与空格', () => {
    expect(encodeUrl('研发 好朋友').text).toBe('%E7%A0%94%E5%8F%91%20%E5%A5%BD%E6%9C%8B%E5%8F%8B')
  })

  it('表单模式把空格转成 +', () => {
    expect(encodeUrl('a b+c', { mode: 'form' }).text).toBe('a+b%2Bc')
    expect(decodeUrl('a+b%2Bc', { plusAsSpace: true }).text).toBe('a b+c')
    expect(decodeUrl('a+b%2Bc').text).toBe('a+b+c')
  })

  it('完整 URL 模式保留协议与分隔符', () => {
    const result = encodeUrl('https://example.com/搜索?q=中文', { mode: 'url' })
    expect(result.text).toContain('https://example.com/')
    expect(result.text).toContain('%E6%90%9C%E7%B4%A2')
    expect(result.text).toContain('?q=')
  })

  it('路径模式保留 / 与查询分隔符', () => {
    const result = encodeUrl('/a b/中文?q=研发 好友&n=1', { mode: 'path' })
    expect(result.text.startsWith('/a%20b/')).toBe(true)
    expect(result.text).toContain('?q=')
    expect(result.text).toContain('&n=1')
    expect(result.text).toContain('%E7%A0%94%E5%8F%91%20')
  })

  it('严格模式补编码 RFC 3986 保留字符', () => {
    expect(encodeUrl("!'()*~").text).toBe("!'()*~")
    expect(encodeUrl("!'()*~", { strict: true }).text).toBe('%21%27%28%29%2A%7E')
  })

  it('解码中文与 emoji 混排', () => {
    expect(decodeUrl('%E4%B8%AD%E6%96%87').text).toBe('中文')
    expect(decodeUrl('hi%20%F0%9F%9A%80%20🚀').text).toBe('hi 🚀 🚀')
  })

  it('无效的 % 转义给出位置', () => {
    const result = decodeUrl('abc%ZZ')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('第 4 个字符')
    expect(decodeUrl('abc%').error).toContain('转义不完整')
  })

  it('非 UTF-8 字节给出明确错误', () => {
    expect(decodeUrl('%FF').ok).toBe(false)
    expect(decodeUrl('%FF').error).toContain('UTF-8')
  })

  it('按行批量处理并定位出错行', () => {
    const result = encodeUrl('a b\n中文\n', { eachLine: true })
    expect(result.text).toBe('a%20b\n%E4%B8%AD%E6%96%87\n')
    expect(result.note).toContain('3 行')
    expect(decodeUrl('a%20b\n%ZZ', { eachLine: true }).error).toContain('第 2 行')
  })

  it('四种模式均可往返', () => {
    const text = '研发 好朋友/路径?x=1&y=中文'
    for (const mode of ['component', 'url', 'form', 'path']) {
      const encoded = encodeUrl(text, { mode }).text
      expect(decodeUrl(encoded, { plusAsSpace: mode === 'form' }).text).toBe(text)
    }
  })
})

describe('Unicode 转义', () => {
  it('\\uXXXX 编码中文', () => {
    expect(encodeUnicode('中文').text).toBe('\\u4e2d\\u6587')
    expect(encodeUnicode('中', { uppercase: true }).text).toBe('\\u4E2D')
  })

  it('emoji 拆成代理对', () => {
    expect(encodeUnicode('🚀').text).toBe('\\ud83d\\ude80')
  })

  it('brace 与 hex 两种风格', () => {
    expect(encodeUnicode('🚀', { style: 'brace' }).text).toBe('\\u{1f680}')
    expect(encodeUnicode('Aé', { style: 'hex' }).text).toBe('\\x41\\xe9')
  })

  it('控制字符短转义', () => {
    expect(encodeUnicode('a\nb\t"c"\\', { escapeControls: true }).text).toBe('a\\nb\\t\\"c\\"\\\\')
    expect(encodeUnicode('a\nb', { escapeControls: false }).text).toBe('a\\u000ab')
  })

  it('关闭 nonAsciiOnly 会转义全部字符', () => {
    expect(encodeUnicode('ab', { nonAsciiOnly: false }).text).toBe('\\u0061\\u0062')
  })

  it('解码 \\uXXXX 并合并代理对', () => {
    expect(decodeUnicode('\\u4e2d\\u6587').text).toBe('中文')
    expect(decodeUnicode('\\ud83d\\ude80').text).toBe('🚀')
  })

  it('解码 brace / U8 / hex / 短转义', () => {
    expect(decodeUnicode('\\u{1f680}').text).toBe('🚀')
    expect(decodeUnicode('\\U0001F680').text).toBe('🚀')
    expect(decodeUnicode('\\x41\\xe9').text).toBe('Aé')
    expect(decodeUnicode('a\\nb\\t\\"c\\"\\\\').text).toBe('a\nb\t"c"\\')
  })

  it('未知转义序列原样保留', () => {
    expect(decodeUnicode('\\q \\uZZZZ').text).toBe('\\q \\uZZZZ')
  })

  it('超范围码点替换为 U+FFFD 并警告', () => {
    const result = decodeUnicode('\\u{110000}')
    expect(result.text).toBe('\ufffd')
    expect(result.warning).toContain('U+FFFD')
  })

  it('中文 / emoji / 换行往返一致', () => {
    const text = '研发好朋友 🚀\n第二行 "引号" 与反斜杠 \\'
    expect(decodeUnicode(encodeUnicode(text).text).text).toBe(text)
    expect(decodeUnicode(encodeUnicode(text, { style: 'brace' }).text).text).toBe(text)
  })
})

describe('HTML 实体', () => {
  it('最小模式只转义 5 个必要字符', () => {
    expect(encodeHtml(`&<>"'`).text).toBe('&amp;&lt;&gt;&quot;&#39;')
    expect(encodeHtml('<div>中文</div>').text).toBe('&lt;div&gt;中文&lt;/div&gt;')
  })

  it('非 ASCII 模式输出数字实体', () => {
    expect(encodeHtml('中🚀', { mode: 'nonAscii' }).text).toBe('&#x4e2d;&#x1f680;')
    expect(encodeHtml('中', { mode: 'nonAscii', decimal: true }).text).toBe('&#20013;')
    expect(encodeHtml('中', { mode: 'nonAscii', uppercase: true }).text).toBe('&#x4E2D;')
  })

  it('全部模式连 ASCII 一起转', () => {
    expect(encodeHtml('AB', { mode: 'all', decimal: true }).text).toBe('&#65;&#66;')
  })

  it('解码命名实体', () => {
    expect(decodeHtml('&lt;div&gt;&amp;&quot;&apos;&nbsp;').text).toBe('<div>&"\' ')
    expect(decodeHtml('&copy; &reg; &trade; &hellip; &mdash;').text).toBe('© ® ™ … —')
  })

  it('解码十进制 / 十六进制数字实体与 emoji', () => {
    expect(decodeHtml('&#20013;&#x6587;').text).toBe('中文')
    expect(decodeHtml('&#x1F680;').text).toBe('🚀')
    expect(decodeHtml('&#128640').text).toBe('🚀')
  })

  it('Windows-1252 区段按 HTML5 规则映射', () => {
    expect(decodeHtml('&#x80;').text).toBe('€')
    expect(decodeHtml('&#x93;x&#x94;').text).toBe('“x”')
  })

  it('未知实体原样保留且不误拆单词', () => {
    expect(decodeHtml('&notanentity; &notit;').text).toBe('&notanentity; &notit;')
  })

  it('超范围数字实体替换为 U+FFFD', () => {
    const result = decodeHtml('&#x110000;')
    expect(result.text).toBe('\ufffd')
    expect(result.warning).toContain('U+FFFD')
  })

  it('编码后可完整还原', () => {
    const text = '<div class="tip">研发 & "朋友" © 2026 → 🚀</div>'
    expect(decodeHtml(encodeHtml(text).text).text).toBe(text)
    expect(decodeHtml(encodeHtml(text, { mode: 'nonAscii' }).text).text).toBe(text)
    expect(decodeHtml(encodeHtml(text, { mode: 'all' }).text).text).toBe(text)
  })
})

describe('JWT 解码', () => {
  const sample = ENCODING_TOOLS.find((t) => t.id === 'jwt')!.sample()
  const NOW = 1_800_000_000_000

  it('示例令牌结构完整', () => {
    const jwt = decodeJwt(sample)
    expect(jwt.ok).toBe(true)
    expect(jwt.algorithm).toBe('HS256')
    expect(jwt.headerText).toContain('"typ": "JWT"')
    expect(jwt.payloadText).toContain('研发好朋友')
    expect(jwt.signature.length).toBeGreaterThan(0)
    expect(jwt.signatureBytes).toBeGreaterThan(0)
  })

  it('标准声明带中文标签与时间提示', () => {
    const jwt = decodeJwt(sample)
    const exp = jwt.claims.find((c) => c.key === 'exp')
    expect(exp?.label).toBe('过期时间')
    expect(exp?.hint).toContain('还有')
    expect(jwt.claims.find((c) => c.key === 'sub')?.label).toContain('用户 ID')
    expect(jwt.claims.some((c) => c.key === 'name')).toBe(true)
  })

  it('明确声明不校验签名', () => {
    expect(decodeJwt(sample).warnings.join(' ')).toContain('不校验签名')
  })

  it('Bearer 前缀与空白可容错', () => {
    expect(decodeJwt(`Bearer  ${sample}`).ok).toBe(true)
    expect(decodeJwt(sample.replace(/(.{20})/, '$1\n')).ok).toBe(true)
  })

  it('过期与未生效状态判定', () => {
    const segment = (value: unknown) => bytesToBase64(utf8(JSON.stringify(value)), true, false)
    const header = segment({ alg: 'HS256', typ: 'JWT' })
    const sig = segment('sig')
    const expired = decodeJwt(`${header}.${segment({ exp: 1, iat: 0 })}.${sig}`, NOW)
    expect(expired.status).toBe('expired')
    expect(expired.statusText).toContain('已过期')
    expect(expired.claims.find((c) => c.key === 'exp')?.tone).toBe('err')

    const future = decodeJwt(`${header}.${segment({ nbf: NOW / 1000 + 3600 })}.${sig}`, NOW)
    expect(future.status).toBe('future')
    expect(future.claims.find((c) => c.key === 'nbf')?.tone).toBe('warn')

    const active = decodeJwt(`${header}.${segment({ exp: NOW / 1000 + 3600 })}.${sig}`, NOW)
    expect(active.status).toBe('active')
    expect(decodeJwt(`${header}.${segment({ sub: 'x' })}.${sig}`, NOW).status).toBe('unknown')
  })

  it('alg none 与空签名给出额外警告', () => {
    const segment = (value: unknown) => bytesToBase64(utf8(JSON.stringify(value)), true, false)
    const token = `${segment({ alg: 'none', typ: 'JWT' })}.${segment({ sub: 'x' })}.`
    const jwt = decodeJwt(token)
    expect(jwt.ok).toBe(true)
    expect(jwt.warnings.some((w) => w.includes('none'))).toBe(true)
    expect(jwt.warnings.some((w) => w.includes('签名段为空'))).toBe(true)
  })

  it('段数、Base64、JSON 错误都有中文提示', () => {
    expect(decodeJwt('abc').error).toContain('两段')
    expect(decodeJwt('a.b.c.d').error).toContain('3 段')
    expect(decodeJwt('!!!.eyJhIjoxfQ.sig').error).toContain('Header')
    expect(decodeJwt(`${bytesToBase64(utf8('{"alg":"HS256"}'), true, false)}.notjson.sig`).error).toContain('Payload')
  })

  it('对象以外的 payload 被拒绝', () => {
    const segment = (value: unknown) => bytesToBase64(utf8(JSON.stringify(value)), true, false)
    const bad = decodeJwt(`${segment({ alg: 'HS256' })}.${segment([1, 2])}.sig`)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('不是 JSON 对象')
  })
})

describe('统一入口与元数据', () => {
  it('五个工具元数据完整', () => {
    expect(ENCODING_TOOLS.map((t) => t.id)).toEqual(['base64', 'url', 'unicode', 'html', 'jwt'])
    for (const tool of ENCODING_TOOLS) {
      expect(tool.label).toBeTruthy()
      expect(tool.hint).toBeTruthy()
      expect(tool.sample()).toBeTruthy()
      expect(tool.directions.length).toBeGreaterThan(0)
    }
    expect(ENCODING_TOOLS.find((t) => t.id === 'jwt')!.directions).toEqual(['decode'])
  })

  it('runEncoding 正确分发', () => {
    expect(runEncoding('base64', 'encode', '中文').text).toBe('5Lit5paH')
    expect(runEncoding('url', 'encode', '中').text).toBe('%E4%B8%AD')
    expect(runEncoding('unicode', 'decode', '\\u4e2d').text).toBe('中')
    expect(runEncoding('html', 'encode', '<').text).toBe('&lt;')
    expect(runEncoding('jwt', 'decode', ENCODING_TOOLS[4].sample()).ok).toBe(true)
  })

  it('JWT 不支持编码且给出原因', () => {
    const result = runEncoding('jwt', 'encode', 'x')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('只支持解码')
  })

  it('失败结果结构统一', () => {
    const result = runEncoding('base64', 'decode', '###')
    expect(result.ok).toBe(false)
    expect(result.text).toBe('')
    expect(result.error.length).toBeGreaterThan(0)
  })
})
