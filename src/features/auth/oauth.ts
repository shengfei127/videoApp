import type { BaiduAuthSession } from '@/domain/video'

const BAIDU_AUTHORIZE_URL = 'https://openapi.baidu.com/oauth/2.0/authorize'

export interface BaiduOAuthConfig {
  appKey: string
  redirectUri: string
}

export class OAuthCancellationError extends Error {
  constructor() {
    super('已取消百度网盘授权')
    this.name = 'OAuthCancellationError'
  }
}

export function createOAuthState(): string {
  const secureCrypto = globalThis.crypto

  if (typeof secureCrypto?.randomUUID === 'function') {
    try {
      const state = secureCrypto.randomUUID()
      if (state.trim()) {
        return state
      }
    } catch {
      // Continue to the other cryptographically secure platform API.
    }
  }

  if (typeof secureCrypto?.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(32)
      secureCrypto.getRandomValues(bytes)
      return Array.from(bytes, (value) =>
        value.toString(16).padStart(2, '0')
      ).join('')
    } catch {
      // Fail closed below. Weak random fallbacks are not acceptable for OAuth.
    }
  }

  throw new Error('当前环境无法安全创建授权校验状态')
}

export function buildAuthorizeUrl(
  config: BaiduOAuthConfig,
  state: string
): string {
  const appKey = config.appKey.trim()

  if (!appKey || !state.trim()) {
    throw new Error('百度网盘授权配置无效')
  }

  const url = new URL(BAIDU_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'token')
  url.searchParams.set('client_id', appKey)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', 'basic,netdisk')
  url.searchParams.set('display', 'mobile')
  url.searchParams.set('state', state)
  return url.toString()
}

export function parseOAuthCallback(
  callbackUrl: string,
  registeredRedirectUri: string,
  expectedState: string,
  now: number
): BaiduAuthSession {
  const callback = parseUrl(callbackUrl)
  const registeredRedirect = parseUrl(registeredRedirectUri)

  if (
    callback.origin !== registeredRedirect.origin ||
    callback.pathname !== registeredRedirect.pathname
  ) {
    throw new Error('授权回调地址无效')
  }

  const parameters = new URLSearchParams(callback.hash.slice(1))

  if (!expectedState.trim() || parameters.get('state') !== expectedState) {
    throw new Error('授权校验失败')
  }

  const providerError = parameters.get('error')
  if (providerError === 'access_denied') {
    throw new OAuthCancellationError()
  }
  if (providerError) {
    throw new Error('百度网盘授权失败，请重试')
  }

  const accessToken = parameters.get('access_token')
  if (!accessToken?.trim()) {
    throw new Error('授权结果无效')
  }

  const scopes = parseScopes(parameters.get('scope'))
  if (!scopes.includes('basic') || !scopes.includes('netdisk')) {
    throw new Error('授权范围不足，请重新连接百度网盘')
  }

  const expiresAt = parseExpiresAt(parameters.get('expires_in'), now)

  return {
    accessToken,
    expiresAt,
    scope: scopes
  }
}

function parseUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error('授权回调地址无效')
  }
}

function parseScopes(value: string | null): string[] {
  if (!value) {
    return []
  }

  return Array.from(
    new Set(
      value
        .split(/[\s,]+/u)
        .map((scope) => scope.trim())
        .filter(Boolean)
    )
  )
}

function parseExpiresAt(value: string | null, now: number): number {
  if (!value || !/^\d+$/u.test(value) || !Number.isSafeInteger(now)) {
    throw new Error('授权有效期无效')
  }

  const expiresInSeconds = Number(value)
  const expiresAt = now + expiresInSeconds * 1000

  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    !Number.isSafeInteger(expiresAt)
  ) {
    throw new Error('授权有效期无效')
  }

  return expiresAt
}
