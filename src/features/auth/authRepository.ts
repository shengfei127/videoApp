import type { BaiduAuthSession } from '@/domain/video'
import type { KeyValueStorage } from '@/infrastructure/storage'

export const AUTH_STORAGE_KEY = 'pianke:auth:v1'
export const OAUTH_PENDING_STORAGE_KEY = 'pianke:oauth-pending:v1'
export const OAUTH_PENDING_MAX_AGE_MS = 10 * 60 * 1000

export interface OAuthPendingRecord {
  state: string
  createdAt: number
}

export class AuthRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  saveSession(session: BaiduAuthSession): void {
    const validated = validateSession(session)

    if (!validated) {
      throw new Error('百度网盘授权会话无效')
    }

    this.storage.write(AUTH_STORAGE_KEY, validated)
  }

  getValidSession(now: number): BaiduAuthSession | null {
    const session = validateSession(
      this.storage.read<unknown>(AUTH_STORAGE_KEY, null)
    )

    if (!session || !Number.isFinite(now) || session.expiresAt <= now) {
      this.storage.remove(AUTH_STORAGE_KEY)
      return null
    }

    return session
  }

  clearSession(): void {
    this.storage.remove(AUTH_STORAGE_KEY)
  }

  createPending(state: string, createdAt: number): OAuthPendingRecord {
    const pending = validatePending({ state, createdAt })

    if (!pending) {
      throw new Error('授权校验状态无效')
    }

    this.storage.write(OAUTH_PENDING_STORAGE_KEY, pending)
    return pending
  }

  consumePending(now: number): OAuthPendingRecord | null {
    const stored = this.storage.read<unknown>(OAUTH_PENDING_STORAGE_KEY, null)

    this.storage.remove(OAUTH_PENDING_STORAGE_KEY)

    const pending = validatePending(stored)
    if (
      !pending ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      pending.createdAt > now ||
      now - pending.createdAt > OAUTH_PENDING_MAX_AGE_MS
    ) {
      return null
    }

    return pending
  }

  clearPending(): void {
    this.storage.remove(OAUTH_PENDING_STORAGE_KEY)
  }
}

function validateSession(value: unknown): BaiduAuthSession | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const session = value as Record<string, unknown>
  if (
    typeof session.accessToken !== 'string' ||
    !session.accessToken.trim() ||
    typeof session.expiresAt !== 'number' ||
    !Number.isFinite(session.expiresAt) ||
    !Array.isArray(session.scope) ||
    !session.scope.every((scope) => typeof scope === 'string') ||
    !session.scope.includes('basic') ||
    !session.scope.includes('netdisk')
  ) {
    return null
  }

  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    scope: [...session.scope]
  }
}

function validatePending(value: unknown): OAuthPendingRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const pending = value as Record<string, unknown>
  if (
    typeof pending.state !== 'string' ||
    !pending.state.trim() ||
    typeof pending.createdAt !== 'number' ||
    !Number.isSafeInteger(pending.createdAt) ||
    pending.createdAt < 0
  ) {
    return null
  }

  return {
    state: pending.state,
    createdAt: pending.createdAt
  }
}
