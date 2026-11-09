// 生成扩展图标：渐变圆角方块 + 白色花括号
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/icons')
mkdirSync(outDir, { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b62f6"/>
      <stop offset="100%" stop-color="#7b5cf6"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#g)"/>
  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#shine)"/>
  <g fill="none" stroke="#ffffff" stroke-width="38" stroke-linecap="round" stroke-linejoin="round">
    <path d="M206 116h-26c-24 0-44 20-44 44v52c0 26-20 44-44 44 24 0 44 18 44 44v52c0 24 20 44 44 44h26"/>
    <path d="M306 116h26c24 0 44 20 44 44v52c0 26 20 44 44 44-24 0-44 18-44 44v52c0 24-20 44-44 44h-26"/>
  </g>
</svg>`

const sizes = [16, 32, 48, 128]
for (const size of sizes) {
  const png = await sharp(Buffer.from(svg)).resize(size, size, { fit: 'contain' }).png().toBuffer()
  writeFileSync(resolve(outDir, `icon${size}.png`), png)
  console.log(`icons/icon${size}.png  ${png.length} bytes`)
}
