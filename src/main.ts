import { createPinia } from 'pinia'
import { createSSRApp } from 'vue'

import App from './App.vue'
import './styles/global.scss'

export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())

  return { app }
}
