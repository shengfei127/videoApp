import type { KeyValueStorage } from '@/infrastructure/storage'

export const PLAYER_PREFERENCES_KEY = 'pianke:player-preferences:v1'
export const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

export function isPlaybackRate(value: unknown): value is PlaybackRate {
  return typeof value === 'number' && (PLAYBACK_RATES as readonly number[]).includes(value)
}

export function readPlaybackRate(storage: KeyValueStorage): PlaybackRate {
  try {
    const stored = storage.read<{ rate?: unknown } | null>(PLAYER_PREFERENCES_KEY, null)
    return isPlaybackRate(stored?.rate) ? stored.rate : 1
  } catch {
    return 1
  }
}

export function savePlaybackRate(storage: KeyValueStorage, rate: PlaybackRate): boolean {
  if (!isPlaybackRate(rate)) return false
  try {
    storage.write(PLAYER_PREFERENCES_KEY, { rate })
    return true
  } catch {
    return false
  }
}
