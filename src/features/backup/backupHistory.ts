import type { KeyValueStorage } from '@/infrastructure/storage'

export const BACKUP_HISTORY_KEY = 'pianke:backup-history:v1'
export type BackupOperation = 'copiedAt' | 'savedAt' | 'downloadRequestedAt'
export type BackupHistory = Partial<Record<BackupOperation, number>>
const OPERATIONS: BackupOperation[] = ['copiedAt', 'savedAt', 'downloadRequestedAt']

export function readBackupHistory(storage: KeyValueStorage): BackupHistory {
  try {
    const value = storage.read<unknown>(BACKUP_HISTORY_KEY, null)
    if (!value || typeof value !== 'object') return {}
    const history: BackupHistory = {}
    for (const key of OPERATIONS) {
      const time = (value as Record<string, unknown>)[key]
      if (typeof time === 'number' && Number.isSafeInteger(time) && time >= 0 && Number.isFinite(new Date(time).getTime())) history[key] = time
    }
    return history
  } catch { return {} }
}

export function recordBackupOperation(storage: KeyValueStorage, operation: BackupOperation, now = Date.now()): boolean {
  if (!OPERATIONS.includes(operation) || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) return false
  try {
    storage.write(BACKUP_HISTORY_KEY, { ...readBackupHistory(storage), [operation]: now })
    return true
  } catch { return false }
}
