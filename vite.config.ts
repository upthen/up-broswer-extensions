import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Json = Record<string, any>

/** 需要加 outDir 前缀的清单字段（值都是相对扩展根目录的文件路径） */
function prefixPath(manifest: Json, outDir: string): Json {
  const p = (v: string) => (v.startsWith('/') || v.startsWith('http') ? v : `${outDir}/${v}`)
  const mapValues = (obj: Json) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? p(v) : v]))

  const m: Json = JSON.parse(JSON.stringify(manifest))

  if (m.icons) m.icons = mapValues(m.icons)
  if (m.action) {
    if (typeof m.action.default_popup === 'string') m.action.default_popup = p(m.action.default_popup)
    if (m.action.default_icon) m.action.default_icon = mapValues(m.action.default_icon)
  }
  if (m.side_panel?.default_path) m.side_panel.default_path = p(m.side_panel.default_path)
  if (m.background?.service_worker) m.background.service_worker = p(m.background.service_worker)
  if (m.options_ui?.page) m.options_ui.page = p(m.options_ui.page)
  if (typeof m.options_page === 'string') m.options_page = p(m.options_page)
  if (m.devtools_page) m.devtools_page = p(m.devtools_page)
  for (const key of ['chrome_url_overrides']) {
    if (m[key]) m[key] = mapValues(m[key])
  }
  for (const cs of m.content_scripts ?? []) {
    cs.js = (cs.js ?? []).map(p)
    cs.css = (cs.css ?? []).map(p)
  }
  for (const war of m.web_accessible_resources ?? []) {
    war.resources = (war.resources ?? []).map(p)
  }
  return m
}

/**
 * 构建收尾：
 * 1. 在项目根目录生成「转发版」manifest.json，把入口指向 dist/，这样直接选根目录也能加载；
 * 2. 打印该加载哪个目录。
 */
function rootManifestAndTips(): Plugin {
  let outDir = 'dist'
  return {
    name: 'devbuddy-root-manifest',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir
    },
    closeBundle() {
      const absOut = resolve(process.cwd(), outDir)
      const built = JSON.parse(readFileSync(resolve(absOut, 'manifest.json'), 'utf8')) as Json
      const forwarded = prefixPath(built, outDir)
      writeFileSync(resolve(process.cwd(), 'manifest.json'), JSON.stringify(forwarded, null, 2) + '\n')

      console.log(
        `\n  \x1b[36m两个目录都能加载\x1b[0m\n` +
          `  推荐：\x1b[1m${absOut}\x1b[0m（产物目录，改动最少、加载最快）\n` +
          `  也可以：\x1b[1m${resolve(process.cwd())}\x1b[0m（根目录，清单已自动转发到 ${outDir}/）\n` +
          `  chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 任选其一\n`,
      )
    },
  }
}

export default defineConfig({
  plugins: [vue(), rootManifestAndTips()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        index: 'index.html',
        popup: 'popup.html',
        sidepanel: 'sidepanel.html',
        background: 'src/background/index.ts',
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
