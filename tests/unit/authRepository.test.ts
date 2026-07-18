import { describe, expect, it } from 'vitest'

import type { BaiduAuthSession } from '@/domain/video'
import {
  AUTH_STORAGE_KEY,
  OAUTH_PENDING_MAX_AGE_MS,
  OAUTH_PENDING_STORAGE_KEY,
  AuthRepository
} from '@/features/auth/authRepository'
import { parseOAuthCallback } from '@/features/auth/oauth'
import { DIRECT_VIDEO_STORAGE_KEY } from '@/features/direct-links/directLinkService'
import { PROGRESS_STORAGE_KEY } from '@/features/playback/progressRepository'
import {
  createMemoryStorage,
  type KeyValueStorage
} from '@/infrastructure/storage'

const REDIRECT_URI = 'https://localhost/pianke/oauth/baidu'
const VALID_SESSION: BaiduAuthSession = {
  accessToken: 'private-access-token',
  expiresAt: 100_000,
  scope: ['basic', 'netdisk']
}

function preserveUnrelatedData(storage: KeyValueStorage): void {
  storage.write('pianke:catalog-cache:v1', { folders: ['keep'] })
  storage.write(DIRECT_VIDEO_STORAGE_KEY, [{ id: 'direct-1' }])
  storage.write(PROGRESS_STORAGE_KEY, [{ videoId: 'video-1' }])
}

function expectUnrelatedDataPreserved(storage: KeyValueStorage): void {
  expect(storage.read('pianke:catalog-cache:v1', null)).toEqual({
    folders: ['keep']
  })
  expect(storage.read(DIRECT_VIDEO_STORAGE_KEY, null)).toEqual([
    { id: 'direct-1' }
  ])
  expect(storage.read(PROGRESS_STORAGE_KEY, null)).toEqual([
    { videoId: 'video-1' }
  ])
}

function callbackUrl(parameters: Record<string, string>): string {
  const url = new URL(REDIRECT_URI)
  url.hash = new URLSearchParams(parameters).toString()
  return url.toString()
}

describe('AuthRepository sessions', () => {
  it('saves and returns a valid Baidu session', () => {
    const repository = new AuthRepository(createMemoryStorage())

    repository.saveSession(VALID_SESSION)

    expect(repository.getValidSession(99_999)).toEqual(VALID_SESSION)
  })

  it('removes only expired auth data', () => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)
    preserveUnrelatedData(storage)
    repository.saveSession(VALID_SESSION)

    expect(repository.getValidSession(100_000)).toBeNull()
    expect(storage.read(AUTH_STORAGE_KEY, null)).toBeNull()
    expectUnrelatedDataPreserved(storage)
  })

  it.each([
    null,
    { ...VALID_SESSION, accessToken: '' },
    { ...VALID_SESSION, accessToken: '   ' },
    { ...VALID_SESSION, expiresAt: Number.POSITIVE_INFINITY },
    { ...VALID_SESSION, scope: 'basic netdisk' },
    { ...VALID_SESSION, scope: ['basic'] },
    { ...VALID_SESSION, scope: ['netdisk'] },
    { ...VALID_SESSION, scope: ['basic', 'netdisk.read'] },
    { ...VALID_SESSION, scope: ['basic', 'netdisk', 42] }
  ])('rejects and removes a malformed persisted session', (stored) => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)
    preserveUnrelatedData(storage)
    storage.write(AUTH_STORAGE_KEY, stored)

    expect(repository.getValidSession(1000)).toBeNull()
    expect(storage.read(AUTH_STORAGE_KEY, null)).toBeNull()
    expectUnrelatedDataPreserved(storage)
  })

  it('disconnects by clearing only auth data', () => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)
    preserveUnrelatedData(storage)
    repository.saveSession(VALID_SESSION)
    repository.createPending('state-123', 1000)

    repository.clearSession()

    expect(storage.read(AUTH_STORAGE_KEY, null)).toBeNull()
    expect(storage.read(OAUTH_PENDING_STORAGE_KEY, null)).toEqual({
      state: 'state-123',
      createdAt: 1000
    })
    expectUnrelatedDataPreserved(storage)
  })
})

describe('AuthRepository pending OAuth state', () => {
  it('creates and consumes a valid pending state exactly once', () => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)

    expect(repository.createPending('state-123', 1000)).toEqual({
      state: 'state-123',
      createdAt: 1000
    })
    expect(repository.consumePending(1001)).toEqual({
      state: 'state-123',
      createdAt: 1000
    })
    expect(repository.consumePending(1001)).toBeNull()
    expect(storage.read(OAUTH_PENDING_STORAGE_KEY, null)).toBeNull()
  })

  it('accepts a pending state at the ten-minute boundary', () => {
    const repository = new AuthRepository(createMemoryStorage())
    repository.createPending('state-123', 1000)

    expect(
      repository.consumePending(1000 + OAUTH_PENDING_MAX_AGE_MS)
    ).toEqual({ state: 'state-123', createdAt: 1000 })
  })

  it.each([
    null,
    { state: '', createdAt: 1000 },
    { state: '   ', createdAt: 1000 },
    { state: 'state-123', createdAt: '1000' },
    { state: 'state-123', createdAt: Number.NaN },
    { state: 'state-123', createdAt: 1001 },
    { state: 'state-123', createdAt: 1000 - OAUTH_PENDING_MAX_AGE_MS - 1 }
  ])('rejects malformed, future-created, or expired pending state', (stored) => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)
    preserveUnrelatedData(storage)
    storage.write(OAUTH_PENDING_STORAGE_KEY, stored)

    expect(repository.consumePending(1000)).toBeNull()
    expect(storage.read(OAUTH_PENDING_STORAGE_KEY, null)).toBeNull()
    expectUnrelatedDataPreserved(storage)
  })

  it('rejects invalid pending state before persisting it', () => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)

    expect(() => repository.createPending('   ', 1000)).toThrow(
      '授权校验状态无效'
    )
    expect(() => repository.createPending('state-123', Number.NaN)).toThrow(
      '授权校验状态无效'
    )
    expect(storage.read(OAUTH_PENDING_STORAGE_KEY, null)).toBeNull()
  })

  it('clears only pending OAuth data', () => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)
    preserveUnrelatedData(storage)
    repository.saveSession(VALID_SESSION)
    repository.createPending('state-123', 1000)

    repository.clearPending()

    expect(storage.read(OAUTH_PENDING_STORAGE_KEY, null)).toBeNull()
    expect(repository.getValidSession(1000)).toEqual(VALID_SESSION)
    expectUnrelatedDataPreserved(storage)
  })

  it.each([
    callbackUrl({
      access_token: 'token',
      expires_in: '3600',
      scope: 'basic netdisk',
      state: 'mismatched'
    }),
    callbackUrl({
      error: 'server_error',
      state: 'state-123'
    })
  ])('does not leave pending state reusable after callback failure', (url) => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)
    preserveUnrelatedData(storage)
    repository.createPending('state-123', 1000)
    const pending = repository.consumePending(1001)

    expect(pending).not.toBeNull()
    expect(() =>
      parseOAuthCallback(url, REDIRECT_URI, pending!.state, 1001)
    ).toThrow()
    expect(repository.consumePending(1001)).toBeNull()
    expect(storage.read(OAUTH_PENDING_STORAGE_KEY, null)).toBeNull()
    expectUnrelatedDataPreserved(storage)
  })

  it('does not leave pending state reusable after callback success', () => {
    const storage = createMemoryStorage()
    const repository = new AuthRepository(storage)
    preserveUnrelatedData(storage)
    repository.createPending('state-123', 1000)
    const pending = repository.consumePending(1001)
    const session = parseOAuthCallback(
      callbackUrl({
        access_token: 'token',
        expires_in: '3600',
        scope: 'basic netdisk',
        state: 'state-123'
      }),
      REDIRECT_URI,
      pending!.state,
      1001
    )

    repository.saveSession(session)

    expect(repository.consumePending(1001)).toBeNull()
    expect(repository.getValidSession(1001)).toEqual(session)
    expectUnrelatedDataPreserved(storage)
  })
})
