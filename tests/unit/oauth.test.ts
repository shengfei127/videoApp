import { describe, expect, it, vi } from 'vitest'

import {
  OAuthCancellationError,
  buildAuthorizeUrl,
  parseOAuthCallback
} from '@/features/auth/oauth'
import {
  OAUTH_PENDING_STORAGE_KEY,
  AuthRepository
} from '@/features/auth/authRepository'
import {
  isRegisteredOAuthCallback,
  openOAuthWebview
} from '@/features/auth/oauthWebview'
import { createMemoryStorage } from '@/infrastructure/storage'

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
    const clearPendingState = vi.fn()

    const handle = openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback,
      onCancel,
      clearPendingState
    })

    expect(handle.enabled).toBe(false)
    expect(onCallback).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
    handle.close()
    expect(onCancel).not.toHaveBeenCalled()
    expect(clearPendingState).not.toHaveBeenCalled()
  })

  it('uses a synthetic token only when H5 mock mode is explicit', async () => {
    const pending = createPendingContext()
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
      onCallback,
      clearPendingState: pending.clearPendingState
    })

    expect(handle.enabled).toBe(true)
    await vi.waitFor(() => expect(onCallback).toHaveBeenCalledOnce())
    expectPendingCleared(pending)
    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
  })

  it('creates one dedicated App WebView and intercepts only the redirect', async () => {
    const app = createPlusWebviewMock()
    const pending = createPendingContext()
    const onCallback = vi.fn(() => Promise.resolve())
    vi.stubGlobal('plus', app.plus)

    const authorizeUrl = buildAuthorizeUrl(config, 'state-123')
    const handle = openOAuthWebview({
      authorizeUrl,
      redirectUri: config.redirectUri,
      onCallback,
      clearPendingState: pending.clearPendingState
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
    expectPendingCleared(pending)
  })

  it('closes and cancels once when the App WebView is closed by the user', () => {
    const app = createPlusWebviewMock()
    const pending = createPendingContext()
    const onCancel = vi.fn()
    vi.stubGlobal('plus', app.plus)

    openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback: vi.fn(),
      onCancel,
      clearPendingState: pending.clearPendingState
    })

    app.closeListener!()
    app.closeListener!()

    expect(onCancel).toHaveBeenCalledOnce()
    expectPendingCleared(pending)
  })

  it('still closes explicitly when the cancellation handler throws', () => {
    const app = createPlusWebviewMock()
    const pending = createPendingContext()
    const onCancel = vi.fn(() => {
      throw new Error('private-access-token')
    })
    vi.stubGlobal('plus', app.plus)

    const handle = openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback: vi.fn(),
      onCancel,
      clearPendingState: pending.clearPendingState
    })

    expect(() => handle.close()).not.toThrow()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(app.webview.close).toHaveBeenCalledOnce()
    expectPendingCleared(pending)
  })

  it('replaces and closes a stale handle when its cancel handler throws', () => {
    const app = createPlusWebviewMock()
    const clearFirstPending = vi.fn()
    const clearSecondPending = vi.fn()
    vi.stubGlobal('plus', app.plus)

    openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-first'),
      redirectUri: config.redirectUri,
      onCallback: vi.fn(),
      onCancel: () => {
        throw new Error('private-access-token')
      },
      clearPendingState: clearFirstPending
    })

    expect(() =>
      openOAuthWebview({
        authorizeUrl: buildAuthorizeUrl(config, 'state-second'),
        redirectUri: config.redirectUri,
        onCallback: vi.fn(),
        clearPendingState: clearSecondPending
      })
    ).not.toThrow()
    expect(app.create).toHaveBeenCalledTimes(2)
    expect(app.webview.close).toHaveBeenCalledOnce()
    expect(clearFirstPending).toHaveBeenCalledOnce()

    app.closeListener!()
    expect(clearSecondPending).toHaveBeenCalledOnce()
  })

  it('contains cancellation-handler errors from the native close event', () => {
    const app = createPlusWebviewMock()
    const pending = createPendingContext()
    const onCancel = vi.fn(() => {
      throw new Error('private-access-token')
    })
    vi.stubGlobal('plus', app.plus)

    openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback: vi.fn(),
      onCancel,
      clearPendingState: pending.clearPendingState
    })

    expect(() => app.closeListener!()).not.toThrow()
    expect(onCancel).toHaveBeenCalledOnce()
    expectPendingCleared(pending)
  })

  it('closes after callback-handler failure without exposing the error', async () => {
    const app = createPlusWebviewMock()
    const pending = createPendingContext()
    const onCallbackFailure = vi.fn()
    vi.stubGlobal('plus', app.plus)

    openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback: () => Promise.reject(new Error('private-access-token')),
      onCallbackFailure,
      clearPendingState: pending.clearPendingState
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
    expectPendingCleared(pending)
  })

  it.each([
    [
      'access_denied cancellation',
      callbackUrl({ error: 'access_denied', state: 'state-123' })
    ],
    [
      'provider error',
      callbackUrl({ error: 'server_error', state: 'state-123' })
    ],
    [
      'parser failure',
      callbackUrl({
        access_token: 'token',
        expires_in: '3600',
        scope: 'basic netdisk',
        state: 'mismatched'
      })
    ]
  ])('clears real pending state before %s', async (_case, url) => {
    const app = createPlusWebviewMock()
    const pending = createPendingContext()
    const onCallbackFailure = vi.fn()
    vi.stubGlobal('plus', app.plus)

    openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, pending.state),
      redirectUri: config.redirectUri,
      onCallback: (capturedUrl) => {
        parseOAuthCallback(
          capturedUrl,
          config.redirectUri,
          pending.state,
          1001
        )
      },
      onCallbackFailure,
      clearPendingState: pending.clearPendingState
    })

    app.intercept!({ url })

    await vi.waitFor(() => expect(onCallbackFailure).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(app.webview.close).toHaveBeenCalledOnce())
    expectPendingCleared(pending)
  })

  it('clears real pending state when an H5 mock is cancelled', async () => {
    const pending = createPendingContext()
    const onCallback = vi.fn()
    const handle = openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, pending.state),
      redirectUri: config.redirectUri,
      mockMode: true,
      onCallback,
      clearPendingState: pending.clearPendingState
    })

    handle.close()

    expectPendingCleared(pending)
    await Promise.resolve()
    expect(onCallback).not.toHaveBeenCalled()
  })

  it('closes safely and reports failure when pending cleanup throws', () => {
    const app = createPlusWebviewMock()
    const clearPendingState = vi.fn(() => {
      throw new Error('private-access-token')
    })
    const onCallbackFailure = vi.fn(() => {
      throw new Error('another-private-value')
    })
    const onCancel = vi.fn()
    vi.stubGlobal('plus', app.plus)

    const handle = openOAuthWebview({
      authorizeUrl: buildAuthorizeUrl(config, 'state-123'),
      redirectUri: config.redirectUri,
      onCallback: vi.fn(),
      onCancel,
      onCallbackFailure,
      clearPendingState
    })

    expect(() => handle.close()).not.toThrow()
    expect(clearPendingState).toHaveBeenCalledOnce()
    expect(onCallbackFailure).toHaveBeenCalledOnce()
    expect(onCallbackFailure).toHaveBeenCalledWith()
    expect(onCancel).not.toHaveBeenCalled()
    expect(app.webview.close).toHaveBeenCalledOnce()
  })
})

function createPendingContext() {
  const state = 'state-123'
  const storage = createMemoryStorage()
  const repository = new AuthRepository(storage)
  repository.createPending(state, 1000)
  storage.write('unrelated', { preserved: true })

  return {
    state,
    storage,
    clearPendingState: vi.fn(() => repository.clearPending())
  }
}

function expectPendingCleared(
  context: ReturnType<typeof createPendingContext>
): void {
  expect(context.clearPendingState).toHaveBeenCalledOnce()
  expect(context.storage.read(OAUTH_PENDING_STORAGE_KEY, null)).toBeNull()
  expect(context.storage.read('unrelated', null)).toEqual({ preserved: true })
}

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
