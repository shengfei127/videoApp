import type { PlaybackProgress } from '@/domain/video'
import type { KeyValueStorage } from '@/infrastructure/storage'

import { classifyProgress } from './progressPolicy'

export const PROGRESS_STORAGE_KEY = 'pianke:progress:v1'

export class ProgressRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  save(
    videoId: string,
    positionSeconds: number,
    durationSeconds: number,
    updatedAt: number
  ): PlaybackProgress {
    const previous = this.get(videoId)
    const roundedDuration = Number.isFinite(durationSeconds)
      ? Math.max(0, Math.round(durationSeconds))
      : 0
    const roundedPosition = Number.isFinite(positionSeconds)
      ? Math.round(positionSeconds)
      : 0
    const clampedPosition = Math.min(
      Math.max(roundedPosition, 0),
      roundedDuration
    )
    const classification = classifyProgress(clampedPosition, roundedDuration)
    const progress: PlaybackProgress = {
      videoId,
      positionSeconds: clampedPosition,
      durationSeconds: roundedDuration,
      updatedAt,
      completed: previous?.completed === true || classification.completed,
      ...(previous?.manualCompleted === true ? { manualCompleted: true } : {})
    }
    const remaining = this.readProgresses().filter(
      (stored) => stored.videoId !== videoId
    )

    this.storage.write(PROGRESS_STORAGE_KEY, [...remaining, progress])
    return progress
  }

  setCompleted(videoId: string, completed: boolean, updatedAt: number, durationSeconds = 0): PlaybackProgress {
    if (!videoId.trim() || !Number.isFinite(updatedAt)) throw new Error('学习记录无效')
    const previous = this.get(videoId)
    const duration = previous?.durationSeconds || (Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds)) : 0)
    const progress: PlaybackProgress = {
      videoId,
      positionSeconds: previous?.positionSeconds ?? 0,
      durationSeconds: duration,
      updatedAt,
      completed,
      manualCompleted: completed
    }
    this.storage.write(PROGRESS_STORAGE_KEY, [
      ...this.readProgresses().filter((stored) => stored.videoId !== videoId), progress
    ])
    return progress
  }

  get(videoId: string): PlaybackProgress | undefined {
    return this.readProgresses().find((progress) => progress.videoId === videoId)
  }

  listHistory(): PlaybackProgress[] {
    return [...this.readProgresses()].sort(
      (left, right) => right.updatedAt - left.updatedAt
    )
  }

  listResumable(): PlaybackProgress[] {
    return this.listHistory().filter((progress) =>
      !progress.completed && classifyProgress(progress.positionSeconds, progress.durationSeconds).resumable
    )
  }

  remove(videoId: string): void {
    this.storage.write(
      PROGRESS_STORAGE_KEY,
      this.readProgresses().filter((progress) => progress.videoId !== videoId)
    )
  }

  clear(): void {
    this.storage.remove(PROGRESS_STORAGE_KEY)
  }

  private readProgresses(): PlaybackProgress[] {
    const stored = this.storage.read<unknown>(PROGRESS_STORAGE_KEY, [])

    if (!Array.isArray(stored)) {
      return []
    }

    return stored.filter(isPlaybackProgress)
  }
}

function isPlaybackProgress(value: unknown): value is PlaybackProgress {
  if (!value || typeof value !== 'object') {
    return false
  }

  const progress = value as Record<string, unknown>
  return (
    typeof progress.videoId === 'string' &&
    typeof progress.positionSeconds === 'number' &&
    Number.isFinite(progress.positionSeconds) &&
    progress.positionSeconds >= 0 &&
    typeof progress.durationSeconds === 'number' &&
    Number.isFinite(progress.durationSeconds) &&
    (progress.durationSeconds > 0 || (progress.durationSeconds === 0 && typeof progress.manualCompleted === 'boolean')) &&
    progress.positionSeconds <= progress.durationSeconds &&
    typeof progress.updatedAt === 'number' &&
    Number.isFinite(progress.updatedAt) &&
    typeof progress.completed === 'boolean'
  )
}
