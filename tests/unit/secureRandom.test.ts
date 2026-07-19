import { describe, expect, it, vi } from 'vitest'

import {
  createSecureUuid,
  secureRandomBytes
} from '@/infrastructure/secureRandom'

describe('secure random helpers', () => {
  it('uses the platform randomUUID implementation when available', () => {
    const randomUUID = vi.fn(() => 'platform-secure-uuid')
    const getRandomValues = vi.fn()
    vi.stubGlobal('crypto', { randomUUID, getRandomValues })

    expect(createSecureUuid()).toBe('platform-secure-uuid')
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('creates an RFC4122 v4 UUID from 16 secure bytes when randomUUID is absent', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xff)
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(createSecureUuid()).toBe(
      'ffffffff-ffff-4fff-bfff-ffffffffffff'
    )
    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16)
  })

  it('falls back to secure bytes when randomUUID throws', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0)
      return bytes
    })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => {
        throw new Error('platform UUID unavailable')
      }),
      getRandomValues
    })

    expect(createSecureUuid()).toBe(
      '00000000-0000-4000-8000-000000000000'
    )
  })

  it('returns the requested number of cryptographically random bytes', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, index) => {
        bytes[index] = index
      })
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(Array.from(secureRandomBytes(32))).toEqual(
      Array.from({ length: 32 }, (_, index) => index)
    )
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(32)
  })

  it('fails closed when neither secure platform API is available', () => {
    const weakRandom = vi.spyOn(Math, 'random')
    vi.stubGlobal('crypto', {})

    expect(() => createSecureUuid()).toThrow('无法安全生成')
    expect(() => secureRandomBytes(32)).toThrow('无法安全生成')
    expect(weakRandom).not.toHaveBeenCalled()
  })
})
