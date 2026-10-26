// The App service engine does not provide browser URL globals.
import 'core-js/actual/url'
import 'core-js/actual/url-search-params'

import { createPinia } from 'pinia'
import { createSSRApp } from 'vue'

import App from './App.vue'
import './styles/global.scss'

export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())

  return { app }
}
