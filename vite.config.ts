import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'
import packageMetadata from './package.json'

import { createPiankeBuildDefines } from './src/config/buildConstants'

type UniPluginFactory = () => Plugin[]

// The published CJS build exposes the factory under a nested default in ESM configs.
const uni = (
  (uniModule as unknown as { default?: UniPluginFactory }).default ?? uniModule
) as unknown as UniPluginFactory

export default defineConfig(({ mode, command }) => ({
  plugins: [uni()],
  define: createPiankeBuildDefines(
    process.env.UNI_PLATFORM,
    mode,
    command,
    packageMetadata.version
  )
}))
