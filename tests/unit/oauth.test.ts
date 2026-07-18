import { describe, expect, it, vi } from 'vitest'

import {
  OAuthCancellationError,
  buildAuthorizeUrl,
  parseOAuthCallback
} from '@/features/auth/oauth'
import {
  isRegisteredOAuthCallback,
  openOAuthWebview
} from '@/features/auth/oauthWebview'

const config = {
  appKey: 'public-key',
  redirectUri: 'https://localhost/pianke/oauth/baidu'
}

function callbackUrl(fragment: Record<string, string>): string {
  const url = new URL(config.redirectUri)
  url.hash = new URLSearchParams(fragment).toString()
  return url.toString()
}

describe('buildAuthorizeUrl', () => {
  it('builds the Baidu implicit-grant URL with the exact public parameters', () => {
    const url = new URL(buildAuthorizeUrl(config, 'state-123'))

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://openapi.baidu.com/oauth/2.0/authorize'
    )
    expect(Array.from(url.searchParams.entries())).toEqual([
      ['response_type', 'token'],
      ['client_id', 'public-key'],
      ['redirect_uri', config.redirectUri],
      ['scope', 'basic,netdisk'],
      ['display', 'mobile'],
      ['state', 'state-123']
    ])
  })

  it.each([
    [{ ...config, appKey: '' }, 'state-123'],
    [{ ...config, appKey: '   ' }, 'state-123'],
    [config, ''],
    [config, '   ']
  ])('rejects empty public configuration values', (invalidConfig, state) => {
    expect(() => buildAuthorizeUrl(invalidConfig, state)).toThrow(
      '百度网盘授权配置无效'
    )
  })
})

describe('parseOAuthCallback', () => {
  it('returns a Baidu session and converts expiry seconds to milliseconds', () => {
    const result = parseOAuthCallback(
      `${config.redirectUri}#access_token=token&expires_in=3600&scope=basic+netdisk&state=state-123`,
      config.redirectUri,
      'state-123',
      1000
    )

    expect(result).toEqual({
      accessToken: 'token',
      expiresAt: 3_601_000,
      scope: ['basic', 'netdisk']
    })
  })

  it('accepts comma-separated exact scope names', () => {
    const result = parseOAuthCallback(
      callbackUrl({
        access_token: 'token',
        expires_in: '60',
        scope: 'netdisk,basic,extra',
        state: 'state-123'
      }),
      config.redirectUri,
      'state-123',
      1000
    )

    expect(result.scope).toEqual(['netdisk', 'basic', 'extra'])
  })

  it('rejects a state mismatch with a safe user-facing message', () => {
    const url = callbackUrl({
      access_token: 'secret-token',
      expires_in: '3600',
      scope: 'basic netdisk',
      state: 'bad'
    })

    expect(() =>
      parseOAuthCallback(url, config.redirectUri, 'good', 1000)
    ).toThrow('授权校验失败')
  })

  it.each([
    'https://localhost.evil.example/pianke/oauth/baidu',
    'https://localhost/pianke/oauth/baidu/extra',
    'https://localhost/pianke/oauth/baidu-lookalike',
    'http://localhost/pianke/oauth/baidu'
  ])('rejects a callback with the wrong exact origin or path', (redirect) => {
    const url = new URL(redirect)
    url.hash = new URLSearchParams({
      access_token: 'secret-token',
      expires_in: '3600',
      scope: 'basic netdisk',
      state: 'state-123'
    }).toString()

    expect(() =>
      parseOAuthCallback(url.toString(), config.redirectUri, 'state-123', 1000)
    ).toThrow('授权回调地址无效')
  })

  it.each(['basic', 'basic netdisk.read', 'basic netdisk-extra']) (
    'requires the exact netdisk scope instead of a substring: %s',
    (scope) => {
      const url = callbackUrl({
        access_token: 'token',
        expires_in: '3600',
        scope,
        state: 'state-123'
      })

      expect(() =>
        parseOAuthCallback(url, config.redirectUri, 'state-123', 1000)
      ).toThrow('授权范围不足')
    }
  )

  it.each(['', '0', '-1', '1.5', 'Infinity', '1e3', '9007199254740991'])(
    'rejects invalid or overflowing expires_in values: %s',
    (expiresIn) => {
      const url = callbackUrl({
        access_token: 'token',
        expires_in: expiresIn,
        scope: 'basic netdisk',
        state: 'state-123'
      })

      expect(() =>
        parseOAuthCallback(url, config.redirectUri, 'state-123', 1000)
      ).toThrow('授权有效期无效')
    }
  )

  it('reports access_denied as a safe cancellation', () => {
    const url = callbackUrl({
      error: 'access_denied',
      error_description: 'do-not-expose-secret-token',
      state: 'state-123'
    })

    expect(() =>
      parseOAuthCallback(url, config.redirectUri, 'state-123', 1000)
    ).toThrowError(OAuthCancellationError)
    expect(() =>
      parseOAuthCallback(url, config.redirectUri, 'state-123', 1000)
    ).toThrow('已取消百度网盘授权')
  })

  it('redacts provider errors and callback secrets', () => {
    const url = callbackUrl({
      error: 'server_error',
      error_description: 'provider leaked access_token=secret-token',
      state: 'state-123'
    })

    let thrown: unknown
    try {
      parseOAuthCallback(url, config.redirectUri, 'state-123', 1000)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = String(thrown)
    expect(message).toContain('百度网盘授权失败')
    expect(message).not.toContain(url)
    expect(message).not.toContain('secret-token')
    expect(message).not.toContain('error_description')
    expect(message).not.toContain('provider leaked')
  })
})

describe('OAuth WebView adapter', () => {
  it.each([
    [`${config.redirectUri}#state=state-123`, true],
    [`${config.redirectUri}?code=ignored`, true],
    ['https://localhost.evil/pianke/oauth/baidu#state=x', false],
    [`${config.redirectUri}/extra#state=x`, false],
    [`${config.redirectUri}-lookalike#state=x`, false],
    ['not a url', false]
  ])('matches only the registered callback origin and path', (url, expected) => {
    expect(isRegisteredOAuthCallback(url, config.redirectUri)).toBe(expected)
  })

  it('keeps H5 disabled without navigating when mock mode is off', () => {
    const onCallback = vi.fn()
    const onCancel = vi.fn()

    const handle = openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback,
      onCancel
    })

    expect(handle.enabled).toBe(false)
    expect(onCallback).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
    handle.close()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('uses a synthetic token only when H5 mock mode is explicit', async () => {
    const onCallback = vi.fn((url: string) => {
      const session = parseOAuthCallback(
        url,
        config.redirectUri,
        'state-123',
        1000
      )

      expect(session).toMatchObject({
        accessToken: 'mock-baidu-access-token',
        scope: ['basic', 'netdisk']
      })
      expect(url).not.toContain('private-access-token')
    })

    const handle = openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      mockMode: true,
      onCallback
    })

    expect(handle.enabled).toBe(true)
    await vi.waitFor(() => expect(onCallback).toHaveBeenCalledOnce())
    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
  })

  it('creates one dedicated App WebView and intercepts only the redirect', async () => {
    const app = createPlusWebviewMock()
    const onCallback = vi.fn(() => Promise.resolve())
    vi.stubGlobal('plus', app.plus)

    const authorizeUrl = buildAuthorizeUrl(config, 'state-123')
    const handle = openOAuthWebview({
      authorizeUrl,
      redirectUri: config.redirectUri,
      onCallback
    })

    expect(handle.enabled).toBe(true)
    expect(app.existing.close).toHaveBeenCalledOnce()
    expect(app.create).toHaveBeenCalledWith(
      authorizeUrl,
      'pianke-baidu-oauth',
      {
        titleNView: {
          titleText: '连接百度网盘',
          autoBackButton: true
        }
      }
    )
    expect(app.overrideUrlLoading).toHaveBeenCalledWith(
      {
        mode: 'reject',
        match: '^https://localhost/pianke/oauth/baidu(?:[?#]|$)'
      },
      expect.any(Function)
    )
    expect(app.show).toHaveBeenCalledWith('slide-in-right')

    app.intercept!({
      url: `${config.redirectUri}-lookalike#state=state-123`
    })
    expect(onCallback).not.toHaveBeenCalled()

    const captured = callbackUrl({
      access_token: 'token',
      expires_in: '3600',
      scope: 'basic netdisk',
      state: 'state-123'
    })
    app.intercept!({ url: captured })
    app.intercept!({ url: captured })

    await vi.waitFor(() => expect(onCallback).toHaveBeenCalledOnce())
    expect(onCallback).toHaveBeenCalledWith(captured)
    await vi.waitFor(() => expect(app.webview.close).toHaveBeenCalledOnce())
  })

  it('closes and cancels once when the App WebView is closed by the user', () => {
    const app = createPlusWebviewMock()
    const onCancel = vi.fn()
    vi.stubGlobal('plus', app.plus)

    openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback: vi.fn(),
      onCancel
    })

    app.closeListener!()
    app.closeListener!()

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('closes after callback-handler failure without exposing the error', async () => {
    const app = createPlusWebviewMock()
    const onCallbackFailure = vi.fn()
    vi.stubGlobal('plus', app.plus)

    openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback: () => Promise.reject(new Error('private-access-token')),
      onCallbackFailure
    })

    app.intercept!({
      url: callbackUrl({
        access_token: 'token',
        expires_in: '3600',
        scope: 'basic netdisk',
        state: 'state-123'
      })
    })

    await vi.waitFor(() => expect(onCallbackFailure).toHaveBeenCalledOnce())
    expect(onCallbackFailure).toHaveBeenCalledWith()
    expect(app.webview.close).toHaveBeenCalledOnce()
  })
})

function createPlusWebviewMock() {
  let intercept: ((event: { url: string }) => void) | undefined
  let closeListener: (() => void) | undefined
  const existing = { close: vi.fn() }
  const overrideUrlLoading = vi.fn(
    (
      _options: Record<string, string>,
      callback: (event: { url: string }) => void
    ) => {
      intercept = callback
    }
  )
  const show = vi.fn()
  const close = vi.fn()
  const addEventListener = vi.fn(
    (event: string, callback: () => void) => {
      if (event === 'close') {
        closeListener = callback
      }
    }
  )
  const webview = { overrideUrlLoading, show, close, addEventListener }
  const create = vi.fn(() => webview)

  return {
    plus: {
      webview: {
        create,
        getWebviewById: vi.fn(() => existing)
      }
    },
    create,
    existing,
    webview,
    overrideUrlLoading,
    show,
    get intercept() {
      return intercept
    },
    get closeListener() {
      return closeListener
    }
  }
}
