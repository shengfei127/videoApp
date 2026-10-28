import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '@/infrastructure/storage'
import { PLAYER_PREFERENCES_KEY, readPlaybackRate, savePlaybackRate, type PlaybackRate } from '@/features/playback/playerPreferences'

describe('player preferences', () => {
  it('persists allowed rates and rejects corrupt or unsupported values', () => {
    const storage = createMemoryStorage()
    expect(readPlaybackRate(storage)).toBe(1)
    expect(savePlaybackRate(storage, 1.5)).toBe(true)
    expect(readPlaybackRate(storage)).toBe(1.5)
    expect(savePlaybackRate(storage, 99 as PlaybackRate)).toBe(false)
    expect(readPlaybackRate(storage)).toBe(1.5)
    for (const rate of [NaN, Infinity, -1, '1.5', 1.75]) {
      storage.write(PLAYER_PREFERENCES_KEY, { rate })
      expect(readPlaybackRate(storage)).toBe(1)
    }
  })

  it('defaults safely when storage is unavailable and reports write failures', () => {
    const storage = { read: () => { throw new Error('read') }, write: () => { throw new Error('write') }, remove: () => {} }
    expect(readPlaybackRate(storage)).toBe(1)
    expect(savePlaybackRate(storage, 2)).toBe(false)
  })
})
