<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import JsonTool from './pages/JsonTool.vue'
import EncodingTool from './pages/EncodingTool.vue'
import QrTool from './pages/QrTool.vue'
import Icon from './components/Icon.vue'
import { useSettings } from './composables/useSettings'
import { pageUrl } from '../shared/urls'
import { VIEWS } from '../shared/views'
import type { ViewMode } from '../shared/views'

const props = withDefaults(defineProps<{ mode?: 'full' | 'popup' | 'sidepanel' }>(), { mode: 'full' })

const { settings, resolved, cycleTheme, themeLabel } = useSettings()
const settingsOpen = ref(false)
const view = ref<ViewMode>('text')

type AppModule = 'json' | 'encoding' | 'qrcode'

const MODULE_LABEL: Record<AppModule, string> = {
  json: 'JSON 工具',
  encoding: '编码转换',
  qrcode: '二维码',
}
const MODULE_SHORT: Record<AppModule, string> = { json: 'JSON', encoding: '编码', qrcode: '二维码' }
// 紧凑模式的主切换按钮沿用最初的 title，避免既有冒烟脚本与用户肌肉记忆失效
const MODULE_TITLE: Record<AppModule, string> = {
  json: '切换到 JSON 工具',
  encoding: '切换到编码转换',
  qrcode: '切换到二维码工具',
}

function readInitialModule(): AppModule {
  if (typeof location === 'undefined') return 'json'
  const param = new URLSearchParams(location.search).get('module')
  return param === 'qrcode' ? 'qrcode' : param === 'encoding' ? 'encoding' : 'json'
}

const module = ref<AppModule>(readInitialModule())
const jsonTool = ref<InstanceType<typeof JsonTool> | null>(null)

const compact = computed(() => props.mode !== 'full')
/** 主切换按钮在 JSON ↔ 编码之间循环，二维码模块下点它回到 JSON */
const nextMain = computed<AppModule>(() => (module.value === 'encoding' ? 'json' : module.value === 'json' ? 'encoding' : 'json'))
const mainTitle = computed(() => MODULE_TITLE[nextMain.value])
const mainLabel = computed(() => (nextMain.value === 'encoding' ? '编码' : 'JSON'))
const qrTitle = computed(() => (module.value === 'qrcode' ? '返回 JSON 工具' : '切换到二维码工具'))

function setModule(next: AppModule) {
  module.value = next
  settingsOpen.value = false
}

function openJson(nextView: ViewMode) {
  view.value = nextView
  setModule('json')
}

function toggleModule() {
  setModule(nextMain.value)
}

function toggleQr() {
  setModule(module.value === 'qrcode' ? 'json' : 'qrcode')
}

// CodeMirror 在 display:none 期间尺寸为 0，恢复显示后需要重新测量
watch(module, (next) => {
  if (next === 'json') void nextTick(() => jsonTool.value?.refresh())
})

const themeIcon = computed(() => {
  if (settings.theme === 'system') return 'monitor'
  return resolved.value === 'dark' ? 'moon' : 'sun'
})

function openFull() {
  const query = module.value === 'json' ? '' : `?module=${module.value}`
  const url = pageUrl('index.html') + query
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url })
    window.close()
    return
  }
  window.open(url, '_blank')
}
</script>

<template>
  <div class="app" :class="`app--${mode}`">
    <header class="topbar">
      <div class="brand">
        <span class="logo"><Icon name="braces" :size="15" :stroke="2" /></span>
        <span class="brand__text">
          <span class="brand__name">研发好朋友</span>
          <span v-if="!compact" class="brand__sub">DevBuddy · {{ MODULE_LABEL[module] }}</span>
          <span v-else class="brand__sub">{{ MODULE_SHORT[module] }}</span>
        </span>
      </div>

      <nav v-if="mode === 'full'" class="tabs">
        <button
          v-for="item in VIEWS"
          :key="item.id"
          class="tab"
          :class="{ 'tab--active': module === 'json' && view === item.id }"
          :title="`切换到${item.label}`"
          @click="openJson(item.id)"
        >
          {{ item.label }}
        </button>
        <span class="tabsep" />
        <button
          class="tab tab--module"
          :class="{ 'tab--active': module === 'encoding' }"
          title="切换到编码转换（Base64 / URL / Unicode / HTML 实体 / JWT）"
          @click="setModule('encoding')"
        >
          编码转换
        </button>
        <button
          class="tab tab--module"
          :class="{ 'tab--active': module === 'qrcode' }"
          title="切换到二维码（生成 / 解码）"
          @click="setModule('qrcode')"
        >
          二维码
        </button>
      </nav>

      <span class="spacer" />

      <span v-if="!compact" class="offline">
        <Icon name="check" :size="12" :stroke="2.2" />
        纯本地 · 不联网
      </span>

      <button class="btn btn--icon btn--ghost" :title="`主题：${themeLabel()}`" @click="cycleTheme">
        <Icon :name="themeIcon" />
      </button>
      <button
        v-if="mode !== 'full'"
        class="btn btn--sm btn--ghost btn--module"
        :title="mainTitle"
        @click="toggleModule"
      >
        <Icon :name="nextMain === 'encoding' ? 'layers' : 'braces'" :size="13" />
        <span class="btn__label">{{ mainLabel }}</span>
      </button>
      <button
        v-if="mode !== 'full'"
        class="btn btn--icon btn--ghost btn--qr"
        :class="{ 'btn--qr-active': module === 'qrcode' }"
        :title="qrTitle"
        @click="toggleQr"
      >
        <Icon name="qr" :size="14" />
      </button>
      <button v-if="mode !== 'full'" class="btn btn--sm btn--ghost btn--openfull" title="在新标签页打开" @click="openFull">
        <Icon name="external" :size="13" />
        <span class="btn__label">全屏</span>
      </button>
      <button class="btn btn--icon btn--ghost" title="设置" @click="settingsOpen = !settingsOpen">
        <Icon name="sliders" />
      </button>
    </header>

    <div v-show="module === 'json'" class="app__module">
      <JsonTool ref="jsonTool" v-model:view="view" :compact="compact" :mode="mode" :active="module === 'json'" />
    </div>
    <div v-show="module === 'encoding'" class="app__module">
      <EncodingTool :compact="compact" :mode="mode" :active="module === 'encoding'" />
    </div>
    <div v-show="module === 'qrcode'" class="app__module">
      <QrTool :compact="compact" :mode="mode" :active="module === 'qrcode'" />
    </div>

    <transition name="fade">
      <div v-if="settingsOpen" class="mask" @click="settingsOpen = false">
        <div class="settings" @click.stop>
          <div class="settings__head">
            <span>偏好设置</span>
            <button class="btn btn--sm btn--ghost" @click="settingsOpen = false">✕</button>
          </div>

          <label class="row">
            <span class="row__label">主题</span>
            <select v-model="settings.theme" class="select">
              <option value="system">跟随系统</option>
              <option value="light">亮色</option>
              <option value="dark">暗色</option>
            </select>
          </label>

          <label class="row">
            <span class="row__label">编辑器字号</span>
            <input v-model.number="settings.fontSize" type="range" min="11" max="18" step="1" class="range" />
            <span class="row__value">{{ settings.fontSize }}px</span>
          </label>

          <label class="row">
            <span class="row__label">自动换行</span>
            <input v-model="settings.wrap" type="checkbox" class="check" />
          </label>

          <div class="sep" />

          <p class="tip">所有数据只存在本机浏览器（chrome.storage.local），扩展不发起任何网络请求，也不申请任何站点权限。</p>

          <div class="keys">
            <div><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> 格式化</div>
            <div><span class="kbd">Ctrl</span>+<span class="kbd">F</span> 查找 · <span class="kbd">Alt</span>+<span class="kbd">F</span> 常驻查找</div>
            <div><span class="kbd">F11</span> 全屏 · <span class="kbd">Esc</span> 退出</div>
            <div><span class="kbd">Alt</span>+<span class="kbd">Shift</span>+<span class="kbd">J</span> 打开全屏页</div>
            <div>二维码：<span class="kbd">Ctrl</span>+<span class="kbd">V</span> 粘贴截图解码</div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.app__module {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 12px 0 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(135deg, #3b62f6 0%, #7b5cf6 100%);
  color: #fff;
  box-shadow:
    0 1px 2px rgba(59, 98, 246, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  flex: none;
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  min-width: 0;
}

.brand__name {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--text);
}

.brand__sub {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  margin-left: 8px;
  background: var(--surface-3);
  border-radius: 9px;
}

.tab {
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 500;
  transition:
    background 0.15s,
    color 0.15s;
}

.tab:hover:not(:disabled) {
  color: var(--text);
}

.tab--active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
  font-weight: 600;
}

.tab:disabled {
  color: var(--text-3);
  opacity: 0.6;
  cursor: not-allowed;
}

.tab--module {
  font-weight: 600;
}

.btn--qr-active {
  color: var(--accent);
  background: var(--accent-soft);
}

.tabsep {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-2);
  flex: none;
}

/* 340px 侧边栏：顶栏放不下文字，两个次要按钮收成纯图标 */
@media (max-width: 400px) {
  .topbar {
    gap: 6px;
    padding: 0 8px;
  }

  .brand__sub {
    display: none;
  }

  .btn--module .btn__label,
  .btn--openfull .btn__label {
    display: none;
  }

  .btn--module,
  .btn--openfull {
    width: 30px;
    padding: 0;
    justify-content: center;
  }

  .btn--qr {
    width: 28px;
  }
}

.spacer {
  flex: 1 1 auto;
}

.offline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.18);
  z-index: 80;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  padding: 60px 12px 0;
}

.settings {
  width: 302px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
}

.settings__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 2px;
  font-size: 12px;
  color: var(--text-2);
}

.row__label {
  flex: 1;
}

.row__value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
  width: 34px;
  text-align: right;
}

.range {
  width: 108px;
  accent-color: var(--accent);
}

.check {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}

.sep {
  height: 1px;
  background: var(--border);
  margin: 8px 0;
}

.tip {
  margin: 0 0 8px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-3);
}

.keys {
  display: grid;
  gap: 4px;
  font-size: 11px;
  color: var(--text-3);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
