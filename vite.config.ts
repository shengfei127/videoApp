import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'

type UniPluginFactory = () => Plugin[]

// The published CJS build exposes the factory under a nested default in ESM configs.
const uni = (
  (uniModule as unknown as { default?: UniPluginFactory }).default ?? uniModule
) as unknown as UniPluginFactory

export default defineConfig({
  plugins: [uni()]
})
