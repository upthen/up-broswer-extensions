import { describe, expect, it } from 'vitest'
import {
  QR_CAPACITY,
  decodeQr,
  encodeQr,
  hexToRgb,
  matrixToRgba,
  normalizeColor,
  qrPath,
  qrSvg,
} from '../src/core/qrcode'

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length
const roundTrip = (text: string, level: 'L' | 'M' | 'Q' | 'H' = 'M', scale = 4) => {
  const result = encodeQr(text, { level })
  expect(result.ok).toBe(true)
  const image = matrixToRgba(result.code!, scale)
  return decodeQr(image.data, image.width, image.height)
}

describe('二维码生成', () => {
  it('纯文本生成标准矩阵并给出中文摘要', () => {
    const result = encodeQr('Hello, DevBuddy!')
    expect(result.ok).toBe(true)
    const code = result.code!
    expect(code.version).toBeGreaterThanOrEqual(1)
    expect(code.size).toBe(17 + code.version * 4)
    expect(code.total).toBe(code.size + 8)
    expect(code.modules).toHaveLength(code.size * code.size)
    expect(code.bytes).toBe(utf8Bytes('Hello, DevBuddy!'))
    expect(result.note).toContain(`${code.size}×${code.size} 模块`)
    expect(result.error).toBe('')
  })

  it('三个定位角符合 QR 规范（外框黑 / 内圈白 / 中心黑）', () => {
    const { modules, size } = encodeQr('定位角测试').code!
    const at = (row: number, col: number) => modules[row * size + col]
    for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(at(r0, c0)).toBe(true)
      expect(at(r0 + 1, c0 + 1)).toBe(false)
      expect(at(r0 + 3, c0 + 3)).toBe(true)
      expect(at(r0 + 6, c0 + 6)).toBe(true)
    }
  })

  it('中文与 emoji 按 UTF-8 写入，字节数正确', () => {
    const text = '研发好朋友 🚀'
    const code = encodeQr(text).code!
    expect(code.bytes).toBe(utf8Bytes(text))
    expect(code.bytes).toBeGreaterThan(text.length)
    expect(roundTrip(text).text).toBe(text)
  })

  it('相同内容 + 相同选项结果稳定，不同内容矩阵不同', () => {
    const a = encodeQr('stable').code!.modules.join('')
    const b = encodeQr('stable').code!.modules.join('')
    const c = encodeQr('stable!').code!.modules.join('')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('四档纠错等级都能生成，等级越高版本不降级', () => {
    const versions = (['L', 'M', 'Q', 'H'] as const).map((level) => {
      const result = encodeQr('纠错等级对比'.repeat(8), { level })
      expect(result.ok).toBe(true)
      expect(result.code!.level).toBe(level)
      return result.code!.version
    })
    expect(versions[3]).toBeGreaterThanOrEqual(versions[0])
    const mats = (['L', 'M', 'Q', 'H'] as const).map((level) =>
      encodeQr('纠错等级对比', { level }).code!.modules.join(''),
    )
    expect(new Set(mats).size).toBe(4)
  })

  it('指定版本生效，版本装不下时给中文提示', () => {
    const fixed = encodeQr('v5', { version: 5 })
    expect(fixed.ok).toBe(true)
    expect(fixed.code!.version).toBe(5)
    const tooSmall = encodeQr('x'.repeat(200), { version: 1 })
    expect(tooSmall.ok).toBe(false)
    expect(tooSmall.error).toContain('装不下')
  })

  it('非法版本与空内容给出中文错误，且不抛异常', () => {
    expect(encodeQr('').error).toBe('请输入要生成二维码的内容')
    expect(encodeQr('a', { version: 41 }).error).toContain('版本号不合法')
    expect(encodeQr('a', { version: -1 }).error).toContain('版本号不合法')
  })

  it('超过容量上限时提示具体字节数与可操作建议', () => {
    const text = 'A'.repeat(QR_CAPACITY.H + 1)
    const result = encodeQr(text, { level: 'H' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('内容过长')
    expect(result.error).toContain('降低纠错等级')
    expect(encodeQr('A'.repeat(QR_CAPACITY.H), { level: 'H' }).ok).toBe(true)
  })

  it('静区小于 4 模块时给出扫码风险警告', () => {
    expect(encodeQr('静区', { margin: 2 }).warning).toContain('静区小于 4')
    expect(encodeQr('静区', { margin: 4 }).warning).toBe('')
    expect(encodeQr('静区', { margin: 99 }).code!.margin).toBe(16)
  })
})

describe('SVG 与像素渲染', () => {
  it('SVG 含 viewBox / 背景矩形 / 合并后的路径，且可指定像素边长', () => {
    const code = encodeQr('svg').code!
    const svg = qrSvg(code, {}, 512)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain(`viewBox="0 0 ${code.total} ${code.total}"`)
    expect(svg).toContain('width="512" height="512"')
    expect(svg).toContain('<rect')
    expect(svg).toContain('<path d="M')
    expect(svg).toContain('shape-rendering="crispEdges"')
  })

  it('颜色只接受 #rgb / #rrggbb，非法值回落且不会注入 SVG', () => {
    expect(normalizeColor('#1af', '#ffffff')).toBe('#11aaff')
    expect(normalizeColor('#ABCDEF', '#ffffff')).toBe('#abcdef')
    expect(normalizeColor('url(javascript:alert(1))', '#ffffff')).toBe('#ffffff')
    expect(hexToRgb('#3b62f6')).toEqual([59, 98, 246])
    const svg = qrSvg(encodeQr('safe').code!, { dark: 'red;onload=alert(1)', light: '"><script>' })
    expect(svg).not.toContain('onload')
    expect(svg).not.toContain('<script>')
  })

  it('qrPath 合并同一行的连续深色模块', () => {
    const code = encodeQr('path').code!
    const path = qrPath(code)
    expect(path.startsWith('M')).toBe(true)
    expect(/h[2-9]\d*v1h-/.test(path)).toBe(true)
  })

  it('RGBA 矩阵尺寸正确，背景白、深色模块黑、alpha 全不透明', () => {
    const code = encodeQr('pixels').code!
    const image = matrixToRgba(code, 2)
    expect(image.width).toBe(code.total * 2)
    expect(image.height).toBe(code.total * 2)
    expect(image.data).toHaveLength(image.width * image.height * 4)
    expect(Array.from(image.data.slice(0, 4))).toEqual([255, 255, 255, 255])
    const darkX = (0 + code.margin) * 2
    const darkOffset = (darkX * image.width + darkX) * 4
    expect(Array.from(image.data.slice(darkOffset, darkOffset + 4))).toEqual([16, 24, 40, 255])
    expect(image.data.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true)
  })
})

describe('二维码解码', () => {
  it('生成的二维码可原样解码，中文 / emoji / 换行均不丢', () => {
    const samples = [
      'DevBuddy',
      '研发好朋友 DevBuddy 🚀',
      'https://example.com/搜索?q=研发 好朋友&tag=a+b#片段',
      '第一行\n第二行\t制表符',
      '1234567890'.repeat(6),
    ]
    for (const text of samples) {
      const decoded = roundTrip(text)
      expect(decoded.ok, text).toBe(true)
      expect(decoded.text).toBe(text)
      expect(decoded.version).toBeGreaterThanOrEqual(1)
      expect(decoded.bytes).toBeGreaterThan(0)
      expect(decoded.note).toContain('识别成功')
    }
  })

  it('四档纠错等级与不同缩放都能往返', () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      for (const scale of [2, 4, 6]) {
        expect(roundTrip('等级与缩放', level, scale).text).toBe('等级与缩放')
      }
    }
  })

  it('反色二维码（浅码深底）也能识别', () => {
    const code = encodeQr('反色二维码').code!
    const image = matrixToRgba(code, 4, { dark: '#f5f5f5', light: '#101010' })
    const decoded = decodeQr(image.data, image.width, image.height)
    expect(decoded.ok).toBe(true)
    expect(decoded.text).toBe('反色二维码')
  })

  it('纯白图 / 空数据 / 尺寸不匹配都给出中文错误', () => {
    const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255)
    const empty = decodeQr(blank, 64, 64)
    expect(empty.ok).toBe(false)
    expect(empty.text).toBe('')
    expect(empty.error).toContain('未识别到二维码')
    expect(decodeQr(new Uint8ClampedArray(0), 0, 0).error).toContain('图片数据不完整')
    expect(decodeQr(blank, 640, 640).error).toContain('图片数据不完整')
  })
})
