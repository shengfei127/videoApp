import { describe, expect, it } from 'vitest'

import { parseRuntimeConfig } from '@/config/runtime'

describe('parseRuntimeConfig', () => {
  it('normalizes the Baidu app folder into an allowed root', () => {
    expect(
      parseRuntimeConfig({
        VITE_BAIDU_APP_KEY: 'public-key',
        VITE_BAIDU_APP_FOLDER: '片刻',
        VITE_BAIDU_REDIRECT_URI: 'https://localhost/pianke/oauth/baidu',
        VITE_USE_MOCKS: 'false'
      }).baiduRoot
    ).toBe('/apps/片刻')
  })
})
