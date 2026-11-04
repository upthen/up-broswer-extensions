import { reactive, ref, watch } from 'vue'
import { loadValue, saveValue } from '@/shared/storage'
import type { IndentOption } from '@/core/json'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemeMode
  indent: IndentOption
  fontSize: number
  wrap: boolean
  autoValidate: boolean
}

export const SETTINGS_KEY = 'devbuddy.settings'

const DEFAULTS: Settings = {
  theme: 'system',
  indent: 2,
  fontSize: 13,
  wrap: false,
  autoValidate: true,
}

const settings = reactive<Settings>({ ...DEFAULTS })
const resolved = ref<'light' | 'dark'>('light')
let initialized = false
let media: MediaQueryList | null = null

function applyTheme() {
  const prefersDark = media?.matches ?? false
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
  resolved.value = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = resolved.value
}

export function initSettings() {
  if (initialized) return
  initialized = true

  media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', applyTheme)
  applyTheme()

  void loadValue<Settings>(SETTINGS_KEY, DEFAULTS).then((stored) => {
    Object.assign(settings, { ...DEFAULTS, ...stored })
    applyTheme()
  })

  watch(
    settings,
    () => {
      applyTheme()
      void saveValue(SETTINGS_KEY, { ...settings })
    },
    { deep: true },
  )
}

export function useSettings() {
  initSettings()

  const cycleTheme = () => {
    const order: ThemeMode[] = ['system', 'light', 'dark']
    const index = order.indexOf(settings.theme)
    settings.theme = order[(index + 1) % order.length]
  }

  const themeLabel = () => {
    if (settings.theme === 'system') return `跟随系统（${resolved.value === 'dark' ? '暗色' : '亮色'}）`
    return settings.theme === 'dark' ? '暗色' : '亮色'
  }

  return { settings, resolved, cycleTheme, themeLabel }
}
