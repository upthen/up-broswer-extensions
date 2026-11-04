import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

/** 构建完成后打印「该加载哪个目录」，避免误选项目根目录导致「清单文件缺失」 */
function printLoadPath(): Plugin {
  let outDir = 'dist'
  return {
    name: 'print-load-path',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir
    },
    closeBundle() {
      const abs = resolve(process.cwd(), outDir)
      console.log(
        `\n  \x1b[36m扩展目录（加载这个，不是项目根目录）\x1b[0m\n` +
          `  \x1b[1m${abs}\x1b[0m\n` +
          `  chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择上面的路径\n`,
      )
    },
  }
}

export default defineConfig({
  plugins: [vue(), printLoadPath()],
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
