import { describe, expect, it, vi } from 'vitest'

import { createMemoryStorage, uniStorage } from '@/infrastructure/storage'

describe('uniStorage', () => {
  it('returns the fallback for an absent key without logging', () => {
    const error = vi.spyOn(console, 'error')
    const warn = vi.spyOn(console, 'warn')

    expect(uniStorage.read('absent', { fallback: true })).toEqual({
      fallback: true
    })
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('returns the fallback for malformed JSON without changing unrelated keys', () => {
    const error = vi.spyOn(console, 'error')
    const warn = vi.spyOn(console, 'warn')

    uni.setStorageSync('bad-json', '{not-json')
    uni.setStorageSync('unrelated', JSON.stringify({ preserved: true }))

    expect(uniStorage.read('bad-json', { fallback: true })).toEqual({
      fallback: true
    })
    expect(uni.getStorageSync('unrelated')).toBe(
      JSON.stringify({ preserved: true })
    )
    expect(uni.getStorageSync('bad-json')).toBe('{not-json')
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('returns the fallback for an unexpected non-string stored value', () => {
    uni.setStorageSync('non-string', { unexpected: true })

    expect(uniStorage.read('non-string', ['fallback'])).toEqual(['fallback'])
    expect(uni.getStorageSync('non-string')).toEqual({ unexpected: true })
  })

  it('writes JSON and removes only the requested key', () => {
    uniStorage.write('first', { id: 1 })
    uniStorage.write('second', { id: 2 })

    uniStorage.remove('first')

    expect(uniStorage.read('first', null)).toBeNull()
    expect(uniStorage.read('second', null)).toEqual({ id: 2 })
  })
})

describe('createMemoryStorage', () => {
  it('creates isolated storage instances', () => {
    const first = createMemoryStorage()
    const second = createMemoryStorage()

    first.write('item', { id: 1 })

    expect(first.read('item', null)).toEqual({ id: 1 })
    expect(second.read('item', null)).toBeNull()
  })
})
