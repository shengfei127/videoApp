import { transform } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'

import {
  parseRuntimeConfig,
  readRuntimeBuildEnvironment
} from '@/config/runtime'
import { createPiankeBuildDefines } from '@/config/buildConstants'

describe('parseRuntimeConfig', () => {
  it('transforms H5 development build constants into browser literals', async () => {
    const define = createPiankeBuildDefines('h5', 'development')
    const transformed = await transform(
      `
        globalThis.__PIANKE_TRANSFORM_RESULT__ = {
          platform: typeof __PIANKE_UNI_PLATFORM__ !== 'undefined'
            ? __PIANKE_UNI_PLATFORM__
            : undefined,
          mode: typeof __PIANKE_BUILD_MODE__ !== 'undefined'
            ? __PIANKE_BUILD_MODE__
            : undefined
        }
      `,
      { define, format: 'esm' }
    )

    expect(define).toEqual({
      __PIANKE_UNI_PLATFORM__: JSON.stringify('h5'),
      __PIANKE_BUILD_MODE__: JSON.stringify('development')
    })
    Function(transformed.code)()
    expect(
      (globalThis as Record<string, unknown>).__PIANKE_TRANSFORM_RESULT__
    ).toEqual({ platform: 'h5', mode: 'development' })
    delete (globalThis as Record<string, unknown>).__PIANKE_TRANSFORM_RESULT__
    expect(transformed.code).not.toContain('__PIANKE_UNI_PLATFORM__')
    expect(transformed.code).not.toContain('__PIANKE_BUILD_MODE__')
    expect(transformed.code).not.toContain('typeof process')
  })

  it('reads browser compile constants without depending on a runtime process global', () => {
    const previousPlatform = process.env.UNI_PLATFORM
    const previousMode = process.env.NODE_ENV
    process.env.UNI_PLATFORM = 'app-plus'
    process.env.NODE_ENV = 'production'
    vi.stubGlobal('__PIANKE_UNI_PLATFORM__', 'h5')
    vi.stubGlobal('__PIANKE_BUILD_MODE__', 'development')

    try {
      expect(readRuntimeBuildEnvironment()).toEqual({
        uniPlatform: 'h5',
        nodeEnv: 'development'
      })
    } finally {
      restoreProcessEnvironment('UNI_PLATFORM', previousPlatform)
      restoreProcessEnvironment('NODE_ENV', previousMode)
    }
  })

  it('normalizes the Baidu app folder into an allowed root', () => {
    expect(
      parseRuntimeConfig({
        VITE_BAIDU_APP_KEY: 'public-key',
        VITE_BAIDU_APP_FOLDER: '片刻',
        VITE_BAIDU_REDIRECT_URI: 'https://localhost/pianke/oauth/baidu',
        VITE_USE_MOCKS: 'false'
      }).baiduRoot
    ).toBe('/apps/片刻')
    expect(
      parseRuntimeConfig({
        VITE_BAIDU_REDIRECT_URI: 'https://localhost/pianke/oauth/baidu'
      }).baiduRedirectUri
    ).toBe('https://localhost/pianke/oauth/baidu')
  })

  it('rejects control characters before normalizing a folder', () => {
    expect(
      parseRuntimeConfig({ VITE_BAIDU_APP_FOLDER: '\t片刻' }).baiduRoot
    ).toBe('/apps/片刻')
    expect(
      parseRuntimeConfig({ VITE_BAIDU_APP_FOLDER: '\t影片' }).baiduRoot
    ).toBe('/apps/片刻')
  })

  it('normalizes leading and trailing folder slashes', () => {
    expect(
      parseRuntimeConfig({ VITE_BAIDU_APP_FOLDER: '/片刻/' }).baiduRoot
    ).toBe('/apps/片刻')
  })

  it('falls back when the configured folder could escape the app root', () => {
    const config = parseRuntimeConfig({
      VITE_BAIDU_APP_FOLDER: '../other'
    })

    expect(config.baiduAppFolder).toBe('片刻')
    expect(config.baiduRoot).toBe('/apps/片刻')
  })

  it('falls back when the configured folder is not one safe segment', () => {
    expect(
      parseRuntimeConfig({ VITE_BAIDU_APP_FOLDER: '片刻/other' }).baiduRoot
    ).toBe('/apps/片刻')
    expect(
      parseRuntimeConfig({ VITE_BAIDU_APP_FOLDER: 'a'.repeat(21) }).baiduRoot
    ).toBe('/apps/片刻')
  })

  it.each([
    'http://localhost/pianke/oauth/baidu',
    'https://localhost/pianke/oauth/not-baidu',
    'https://localhost:8443/pianke/oauth/baidu',
    'https://localhost/pianke/oauth/baidu?source=test',
    'https://localhost/pianke/oauth/baidu#token',
    'https://example.com/pianke/oauth/baidu'
  ])('falls back from an unsafe callback URL: %s', (callback) => {
    expect(
      parseRuntimeConfig({ VITE_BAIDU_REDIRECT_URI: callback }).baiduRedirectUri
    ).toBe('https://localhost/pianke/oauth/baidu')
  })

  it('does not normalize whitespace around the callback URL', () => {
    expect(
      parseRuntimeConfig({
        VITE_BAIDU_REDIRECT_URI: ' https://localhost/pianke/oauth/baidu '
      }).baiduRedirectUri
    ).toBe('https://localhost/pianke/oauth/baidu')
  })

  it('enables explicit mocks only for an H5 development build', () => {
    expect(
      parseRuntimeConfig(
        { VITE_USE_MOCKS: 'true' },
        { uniPlatform: 'h5', nodeEnv: 'development' }
      ).useMocks
    ).toBe(true)
    expect(
      parseRuntimeConfig(
        { VITE_USE_MOCKS: 'false' },
        { uniPlatform: 'h5', nodeEnv: 'development' }
      ).useMocks
    ).toBe(false)
  })

  it.each([
    ['H5 production', { uniPlatform: 'h5', nodeEnv: 'production' }],
    ['App development', { uniPlatform: 'app-plus', nodeEnv: 'development' }],
    ['App production', { uniPlatform: 'app-plus', nodeEnv: 'production' }],
    ['missing platform', { nodeEnv: 'development' }],
    ['unknown platform', { uniPlatform: 'unknown', nodeEnv: 'development' }],
    ['missing mode', { uniPlatform: 'h5' }],
    ['test mode', { uniPlatform: 'h5', nodeEnv: 'test' }]
  ] as const)('keeps mocks disabled for %s', (_case, buildEnvironment) => {
    expect(
      parseRuntimeConfig(
        { VITE_USE_MOCKS: 'true' },
        buildEnvironment
      ).useMocks
    ).toBe(false)
  })
})

function restoreProcessEnvironment(
  key: 'UNI_PLATFORM' | 'NODE_ENV',
  value: string | undefined
): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
