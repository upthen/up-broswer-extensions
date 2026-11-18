import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/** 构建收尾：在根目录生成转发版 manifest.json，使 site-keys/ 与 site-keys/dist/ 都能被加载 */
function rootManifestAndTips(): Plugin {
  let outDir = 'dist'
  return {
    name: 'sitekeys-root-manifest',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir
    },
    closeBundle() {
      const absOut = resolve(process.cwd(), outDir)
      // 根目录 index.html 是转发页（给根目录加载用），全屏页构建输入另有其名 page.html，
      // 这里把它落回 dist/index.html，使两种加载方式下 chrome.runtime.getURL('index.html') 都可用。
      const pageHtml = resolve(absOut, 'page.html')
      if (existsSync(pageHtml)) {
        writeFileSync(resolve(absOut, 'index.html'), readFileSync(pageHtml, 'utf8'))
        rmSync(pageHtml)
      }
      // 加载 site-keys/ 根目录时，chrome.runtime.getURL('index.html') 指向根目录的 index.html。
      // 它必须是同一份应用页（资源路径补上 dist/ 前缀），绝不能用内联脚本做转发：
      // MV3 extension_pages 的 CSP 禁止内联脚本，转发会静默失败并卡在「正在打开…」。
      const builtIndexHtml = readFileSync(resolve(absOut, 'index.html'), 'utf8')
      writeFileSync(
        resolve(process.cwd(), 'index.html'),
        builtIndexHtml.replaceAll('./assets/', 'dist/assets/'),
      )
      const built = JSON.parse(readFileSync(resolve(absOut, 'manifest.json'), 'utf8')) as Json
      const forwarded = prefixPath(built, outDir)
      writeFileSync(resolve(process.cwd(), 'manifest.json'), JSON.stringify(forwarded, null, 2) + '\n')
      console.log(
        `\n  \x1b[36m两个目录都能加载\x1b[0m\n` +
          `  推荐：\x1b[1m${absOut}\x1b[0m\n` +
          `  也可以：\x1b[1m${resolve(process.cwd())}\x1b[0m（清单已转发到 ${outDir}/）\n`,
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
    // Chrome 114+ 原生支持 modulepreload；关掉 polyfill，避免产物里出现 fetch() 代码。
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        index: 'page.html',
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
