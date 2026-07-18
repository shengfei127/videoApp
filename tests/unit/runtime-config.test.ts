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
