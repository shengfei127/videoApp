import { recoverLearningTransaction, runLearningTransaction } from '@/infrastructure/learningTransaction'
import type { DailyUnlockSettings, PlaybackProgress } from '@/domain/video'
import { DAILY_UNLOCK_STORAGE_KEY, DailyUnlockRepository } from '@/features/daily-unlock/dailyUnlockRepository'
import { LEARNING_STORAGE_KEY, PROGRESS_STORAGE_KEY, ProgressRepository } from '@/features/playback/progressRepository'
import { createMemoryStorage, type KeyValueStorage } from '@/infrastructure/storage'

export const MAX_BACKUP_CHARACTERS = 8_000_000
const MAX_RECORDS = 50_000
const BACKUP_KEYS = [DAILY_UNLOCK_STORAGE_KEY, PROGRESS_STORAGE_KEY, LEARNING_STORAGE_KEY] as const

function utf8Size(text: string): number {
  let bytes = 0
  for (const character of text) {
    const code = character.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (bytes > MAX_BACKUP_CHARACTERS) return bytes
  }
  return bytes
}

export interface BackupLearningStatus {
  videoId: string
  completed: boolean
  updatedAt: number
  durationSeconds: number
}

export interface LearningBackup {
  format: 'pianke-learning-backup'
  version: 1
  exportedAt: number
  courses: DailyUnlockSettings
  playback: PlaybackProgress[]
  learning: BackupLearningStatus[]
}

function invalid(): never {
  throw new Error('备份内容无效或版本不受支持，请选择片刻导出的完整备份')
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid()
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value) && !value.includes('://')
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())
}

function seconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validateCourses(value: unknown): DailyUnlockSettings {
  if (!record(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.courses) || value.courses.length > 100) invalid()
  onlyKeys(value, ['enabled', 'courses'])
  for (const course of value.courses) {
    if (!record(course) || !Array.isArray(course.episodes) || !validId(course.id)) invalid()
    onlyKeys(course, ['id', 'name', 'createdAt', 'sourceFolderPath', 'episodes', 'dailyEpisodeCount', 'startEpisodeNumber', 'pausedAt', 'scheduleAnchorAt', 'scheduleAnchorUnlockedCount', 'scheduleAnchorTodayStart'])
    for (const episode of course.episodes) {
      if (!record(episode) || !validId(episode.videoId)) invalid()
      onlyKeys(episode, ['videoId', 'name', 'sourceType', 'path'])
    }
    if (course.startEpisodeNumber !== undefined && (!Number.isInteger(course.startEpisodeNumber) || Number(course.startEpisodeNumber) < 1 || Number(course.startEpisodeNumber) > course.episodes.length)) invalid()
  }
  const memory = createMemoryStorage()
  memory.write(DAILY_UNLOCK_STORAGE_KEY, value)
  const sanitized = new DailyUnlockRepository(memory).load()
  if (sanitized.courses.length !== value.courses.length) invalid()
  // The repository validates all episode IDs, paths, ranges, and course conflicts.
  // Never accept an importer that silently drops an unsupported course property.
  for (let index = 0; index < sanitized.courses.length; index += 1) {
    const original = value.courses[index] as Record<string, unknown>
    const normalized = sanitized.courses[index] as unknown as Record<string, unknown>
    if (Object.keys(original).some((key) => normalized[key] === undefined)) invalid()
  }
  return sanitized
}

function validatePlayback(value: unknown): PlaybackProgress[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) invalid()
  const seen = new Set<string>()
  return value.map((item) => {
    if (!record(item) || !validId(item.videoId) || seen.has(item.videoId) || !seconds(item.positionSeconds) || !seconds(item.durationSeconds) || item.positionSeconds > item.durationSeconds || !timestamp(item.updatedAt) || typeof item.completed !== 'boolean' || (item.manualCompleted !== undefined && typeof item.manualCompleted !== 'boolean')) invalid()
    onlyKeys(item, ['videoId', 'positionSeconds', 'durationSeconds', 'updatedAt', 'completed', 'manualCompleted'])
    if (item.durationSeconds === 0 && typeof item.manualCompleted !== 'boolean') invalid()
    seen.add(item.videoId)
    return {
      videoId: item.videoId, positionSeconds: item.positionSeconds, durationSeconds: item.durationSeconds,
      updatedAt: item.updatedAt, completed: item.completed,
      ...(item.manualCompleted !== undefined ? { manualCompleted: item.manualCompleted as boolean } : {})
    }
  })
}

function validateLearning(value: unknown): BackupLearningStatus[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) invalid()
  const seen = new Set<string>()
  return value.map((item) => {
    if (!record(item) || !validId(item.videoId) || seen.has(item.videoId) || typeof item.completed !== 'boolean' || !timestamp(item.updatedAt) || !seconds(item.durationSeconds)) invalid()
    onlyKeys(item, ['videoId', 'completed', 'updatedAt', 'durationSeconds'])
    seen.add(item.videoId)
    return { videoId: item.videoId, completed: item.completed, updatedAt: item.updatedAt, durationSeconds: item.durationSeconds }
  })
}

function validateBackup(value: unknown): LearningBackup {
  if (!record(value) || value.format !== 'pianke-learning-backup' || value.version !== 1 || !timestamp(value.exportedAt)) invalid()
  onlyKeys(value, ['format', 'version', 'exportedAt', 'courses', 'playback', 'learning'])
  return { format: 'pianke-learning-backup', version: 1, exportedAt: value.exportedAt, courses: validateCourses(value.courses), playback: validatePlayback(value.playback), learning: validateLearning(value.learning) }
}

export function parseLearningBackup(text: string): LearningBackup {
  if (text.length > MAX_BACKUP_CHARACTERS || utf8Size(text) > MAX_BACKUP_CHARACTERS) throw new Error('备份过大，请选择小于 8 MB 的备份文件')
  let value: unknown
  try { value = JSON.parse(text.replace(/^\uFEFF/u, '')) } catch { return invalid() }
  return validateBackup(value)
}

export function exportLearningBackup(storage: KeyValueStorage, now = Date.now()): string {
  recoverLearningTransaction(storage)
  // Read only these three keys. Auth sessions, source URLs, and catalog caches are never exported.
  const backup = validateBackup({
    format: 'pianke-learning-backup', version: 1, exportedAt: now,
    courses: storage.read(DAILY_UNLOCK_STORAGE_KEY, { enabled: false, courses: [] }),
    playback: storage.read(PROGRESS_STORAGE_KEY, []),
    learning: storage.read(LEARNING_STORAGE_KEY, [])
  })
  const result = JSON.stringify(backup, null, 2)
  if (result.length > MAX_BACKUP_CHARACTERS || utf8Size(result) > MAX_BACKUP_CHARACTERS) throw new Error('学习数据超过备份容量，请先整理历史记录')
  return result
}

export function describeLearningBackup(backup: LearningBackup): { courses: number; playback: number; learned: number } {
  const memory = createMemoryStorage()
  memory.write(PROGRESS_STORAGE_KEY, backup.playback)
  memory.write(LEARNING_STORAGE_KEY, backup.learning)
  const repository = new ProgressRepository(memory)
  return { courses: backup.courses.courses.length, playback: repository.listHistory().length, learned: repository.listLearningHistory().filter((item) => item.completed).length }
}

export function restoreLearningBackup(storage: KeyValueStorage, backup: LearningBackup): void {
  const validated = validateBackup(backup)
  runLearningTransaction(storage, BACKUP_KEYS, () => {
    storage.write(DAILY_UNLOCK_STORAGE_KEY, validated.courses)
    storage.write(PROGRESS_STORAGE_KEY, validated.playback)
    storage.write(LEARNING_STORAGE_KEY, validated.learning)
  })
}
