import { createApp } from 'vue'
import App from './ui/App.vue'
import { initSettings } from './ui/composables/useSettings'
import './ui/styles/base.css'

const host = document.querySelector<HTMLElement>('#app')
const mode = (host?.dataset.mode as 'full' | 'popup' | 'sidepanel') || 'full'

document.body.dataset.mode = mode
initSettings()

if (host) createApp(App, { mode }).mount(host)
