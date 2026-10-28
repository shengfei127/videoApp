import type { KeyValueStorage } from '@/infrastructure/storage'
import { LEARNING_DATA_KEYS, recoverLearningTransaction, runLearningTransaction } from '@/infrastructure/learningTransaction'

export interface StorageAudit {
  playbackRecords: number
  learningRecords: number
  duplicateRecords: number
  bytes: number
}

export interface StorageCompaction extends StorageAudit {
  removedRecords: number
  savedBytes: number
}

// Keep the last occurrence: repositories resolve competing records in array order.
function isValidRecord(value: unknown, playback: boolean): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.videoId !== 'string' || typeof record.completed !== 'boolean' ||
    typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt) ||
    typeof record.durationSeconds !== 'number' || !Number.isFinite(record.durationSeconds) || record.durationSeconds < 0) return false
  if (!playback) return true
  return typeof record.positionSeconds === 'number' && Number.isFinite(record.positionSeconds) &&
    record.positionSeconds >= 0 && record.positionSeconds <= record.durationSeconds &&
    (record.durationSeconds > 0 || typeof record.manualCompleted === 'boolean') &&
    (record.manualCompleted === undefined || typeof record.manualCompleted === 'boolean')
}

function compact(value: unknown, playback: boolean): unknown {
  if (!Array.isArray(value)) return value
  const seen = new Set<string>()
  return value.slice().reverse().filter((record) => {
    // Preserve malformed entries rather than treating them as disposable records.
    if (!isValidRecord(record, playback)) return true
    const signature = JSON.stringify(record)
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  }).reverse()
}

function count(value: unknown): number { return Array.isArray(value) ? value.length : 0 }

function serializedBytes(value: unknown): number {
  if (value === null) return 0
  let bytes = 0
  for (const character of JSON.stringify(value)) {
    const code = character.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

export function inspectLearningStorage(storage: KeyValueStorage): StorageAudit {
  recoverLearningTransaction(storage)
  const values = LEARNING_DATA_KEYS.map((key) => storage.read<unknown>(key, null))
  const playback = values[1]
  const learning = values[2]
  return {
    playbackRecords: count(playback),
    learningRecords: count(learning),
    duplicateRecords: count(playback) - count(compact(playback, true)) + count(learning) - count(compact(learning, false)),
    bytes: values.reduce<number>((total, value) => total + serializedBytes(value), 0)
  }
}

export function compactLearningStorage(storage: KeyValueStorage): StorageCompaction {
  const before = inspectLearningStorage(storage)
  const changes = ([LEARNING_DATA_KEYS[1], LEARNING_DATA_KEYS[2]] as const).flatMap((key) => {
    const original = storage.read<unknown>(key, null)
    const value = compact(original, key === LEARNING_DATA_KEYS[1])
    return count(original) > count(value) ? [{ key, value }] : []
  })
  if (changes.length) {
    runLearningTransaction(storage, changes.map(({ key }) => key), () => {
      for (const { key, value } of changes) storage.write(key, value)
    })
  }
  const after = inspectLearningStorage(storage)
  return { ...after, removedRecords: before.duplicateRecords - after.duplicateRecords, savedBytes: before.bytes - after.bytes }
}
