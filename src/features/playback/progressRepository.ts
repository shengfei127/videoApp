import { recoverLearningTransaction, runLearningTransaction } from '@/infrastructure/learningTransaction'
import type { PlaybackProgress } from '@/domain/video'
import type { KeyValueStorage } from '@/infrastructure/storage'

import { classifyProgress } from './progressPolicy'
import { inspectLearningStorage, compactLearningStorage } from './storageAudit'

export const PROGRESS_STORAGE_KEY = 'pianke:progress:v1'
export const LEARNING_STORAGE_KEY = 'pianke:learning-status:v1'
interface LearningStatus { videoId: string; completed: boolean; updatedAt: number; durationSeconds: number }

export class ProgressRepository {
  private batchSequence = 0
  private batchUndo: { token: string; ids: Set<string>; before: unknown[]; after: unknown[]; playback: unknown[] } | null = null
  constructor(private readonly storage: KeyValueStorage) {}

  inspectStorage() { return inspectLearningStorage(this.storage) }
  compactStorage() { return compactLearningStorage(this.storage) }

  batchSetCompleted(videoIds: string[], updatedAt: number): string {
    this.recoverPendingWrites()
    if (!videoIds.length || videoIds.some((id) => !id.trim()) || !Number.isFinite(updatedAt)) throw new Error('学习记录无效')
    const ids = new Set(videoIds)
    const statuses = this.rawRecords(LEARNING_STORAGE_KEY)
    const playback = this.rawRecords(PROGRESS_STORAGE_KEY).filter((item) => hasVideoId(item, ids))
    const history = new Map(this.listLearningHistory().map((item) => [item.videoId, item]))
    const before = statuses.filter((item) => hasVideoId(item, ids))
    const after = [...ids].map((videoId) => ({ videoId, completed: true, updatedAt, durationSeconds: history.get(videoId)?.durationSeconds ?? 0 }))
    runLearningTransaction(this.storage, [LEARNING_STORAGE_KEY], () => {
      this.storage.write(LEARNING_STORAGE_KEY, [...statuses.filter((item) => !hasVideoId(item, ids)), ...after])
    })
    const token = `batch-${++this.batchSequence}`
    this.batchUndo = { token, ids, before, after, playback }
    return token
  }

  undoBatchCompleted(token: string): boolean {
    this.recoverPendingWrites()
    const snapshot = this.batchUndo
    if (!snapshot || snapshot.token !== token) return false
    const statuses = this.rawRecords(LEARNING_STORAGE_KEY)
    const current = statuses.filter((item) => hasVideoId(item, snapshot.ids))
    const playback = this.rawRecords(PROGRESS_STORAGE_KEY).filter((item) => hasVideoId(item, snapshot.ids))
    if (JSON.stringify(current) !== JSON.stringify(snapshot.after) || JSON.stringify(playback) !== JSON.stringify(snapshot.playback)) return false
    runLearningTransaction(this.storage, [LEARNING_STORAGE_KEY], () => {
      this.storage.write(LEARNING_STORAGE_KEY, [...statuses.filter((item) => !hasVideoId(item, snapshot.ids)), ...snapshot.before])
    })
    this.batchUndo = null
    return true
  }

  private rawRecords(key: string): unknown[] {
    const records = this.storage.read<unknown>(key, [])
    if (!Array.isArray(records)) throw new Error('学习记录格式异常')
    return records
  }

  recoverPendingWrites(): boolean {
    return recoverLearningTransaction(this.storage)
  }

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
      completed: previous?.completed === true || classification.completed
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
    const status: LearningStatus = { videoId, completed, updatedAt, durationSeconds: duration }
    this.storage.write(LEARNING_STORAGE_KEY, [
      ...this.readLearningStatuses().filter((stored) => stored.videoId !== videoId), status
    ])
    return this.get(videoId)!
  }

  get(videoId: string): PlaybackProgress | undefined {
    return this.listLearningHistory().find((progress) => progress.videoId === videoId)
  }

  listHistory(): PlaybackProgress[] {
    const learning = new Map(this.listLearningHistory().map((progress) => [progress.videoId, progress]))
    return this.readProgresses()
      // Older manual-only records had no real playback position. Retain learning,
      // but don't present these synthetic entries as a watch event.
      .filter((progress) => !(progress.manualCompleted !== undefined && progress.positionSeconds === 0))
      .map((progress) => learning.get(progress.videoId) ?? progress)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  listLearningHistory(): PlaybackProgress[] {
    const result = new Map(this.readProgresses().map((progress) => [progress.videoId, { ...progress }]))
    for (const status of this.readLearningStatuses()) {
      const playback = result.get(status.videoId)
      if (!playback) {
        result.set(status.videoId, { videoId: status.videoId, positionSeconds: 0, durationSeconds: status.durationSeconds, updatedAt: 0, completed: status.completed, manualCompleted: status.completed })
      } else if (status.updatedAt >= playback.updatedAt && status.completed !== playback.completed) {
        // Learning edits never alter the timestamp used to order watched videos.
        result.set(status.videoId, { ...playback, completed: status.completed, manualCompleted: status.completed })
      }
    }
    return [...result.values()]
  }

  private readLearningStatuses(): LearningStatus[] {
    this.recoverPendingWrites()
    const stored = this.storage.read<unknown>(LEARNING_STORAGE_KEY, [])
    if (!Array.isArray(stored)) return []
    return stored.filter((value): value is LearningStatus => Boolean(value && typeof value === 'object' && typeof value.videoId === 'string' && typeof value.completed === 'boolean' && Number.isFinite(value.updatedAt) && Number.isFinite(value.durationSeconds) && value.durationSeconds >= 0))
  }

  listResumable(): PlaybackProgress[] {
    return this.listHistory().filter((progress) =>
      !progress.completed && classifyProgress(progress.positionSeconds, progress.durationSeconds).resumable
    )
  }

  remove(videoId: string): void {
    const learning = this.readLearningStatuses().filter((stored) => stored.videoId !== videoId)
    const playback = this.readProgresses().filter((progress) => progress.videoId !== videoId)
    runLearningTransaction(this.storage, [PROGRESS_STORAGE_KEY, LEARNING_STORAGE_KEY], () => {
      this.storage.write(LEARNING_STORAGE_KEY, learning)
      this.storage.write(PROGRESS_STORAGE_KEY, playback)
    })
  }

  relinkVideo(oldVideoId: string, newVideoId: string, commitCourse: () => void): void {
    if (!oldVideoId || !newVideoId || oldVideoId === newVideoId || this.get(newVideoId)) throw new Error('目标视频已有学习记录')
    const playback = this.readProgresses().map((item) => item.videoId === oldVideoId ? { ...item, videoId: newVideoId } : item)
    const learning = this.readLearningStatuses().map((item) => item.videoId === oldVideoId ? { ...item, videoId: newVideoId } : item)
    runLearningTransaction(this.storage, ['pianke:daily-unlock:v1', PROGRESS_STORAGE_KEY, LEARNING_STORAGE_KEY], () => {
      this.storage.write(PROGRESS_STORAGE_KEY, playback)
      this.storage.write(LEARNING_STORAGE_KEY, learning)
      commitCourse()
    })
  }

  clear(): void {
    // Clearing viewing history must not erase the independently tracked learning result.
    const statuses = new Map(this.readLearningStatuses().map((status) => [status.videoId, status]))
    for (const progress of this.listLearningHistory()) {
      statuses.set(progress.videoId, { videoId: progress.videoId, completed: progress.completed, updatedAt: statuses.get(progress.videoId)?.updatedAt ?? progress.updatedAt, durationSeconds: progress.durationSeconds })
    }
    runLearningTransaction(this.storage, [PROGRESS_STORAGE_KEY, LEARNING_STORAGE_KEY], () => {
      this.storage.write(LEARNING_STORAGE_KEY, [...statuses.values()])
      this.storage.remove(PROGRESS_STORAGE_KEY)
    })
  }

  private readProgresses(): PlaybackProgress[] {
    this.recoverPendingWrites()
    const stored = this.storage.read<unknown>(PROGRESS_STORAGE_KEY, [])

    if (!Array.isArray(stored)) {
      return []
    }

    return stored.filter(isPlaybackProgress)
  }
}

function hasVideoId(item: unknown, ids: Set<string>): boolean {
  return Boolean(item && typeof item === 'object' && 'videoId' in item && typeof item.videoId === 'string' && ids.has(item.videoId))
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
