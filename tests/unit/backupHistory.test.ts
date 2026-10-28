import { describe, expect, it } from 'vitest'
import { BACKUP_HISTORY_KEY, readBackupHistory, recordBackupOperation } from '@/features/backup/backupHistory'
import { createMemoryStorage } from '@/infrastructure/storage'

describe('backup operation history', () => {
  it('persists only validated operation timestamps and retains distinct copy/save/download facts', () => {
    const storage = createMemoryStorage()
    storage.write(BACKUP_HISTORY_KEY, { copiedAt: 100, savedAt: -1, downloadRequestedAt: 'bad', accessToken: 'not-kept' })
    expect(readBackupHistory(storage)).toEqual({ copiedAt: 100 })
    expect(recordBackupOperation(storage, 'savedAt', 200)).toBe(true)
    expect(recordBackupOperation(storage, 'downloadRequestedAt', 300)).toBe(true)
    expect(storage.read(BACKUP_HISTORY_KEY, null)).toEqual({ copiedAt: 100, savedAt: 200, downloadRequestedAt: 300 })
    expect(recordBackupOperation(storage, 'savedAt', NaN)).toBe(false)
  })
  it('does not claim persistence when storage fails', () => {
    const storage = createMemoryStorage()
    storage.write = () => { throw new Error('disk full') }
    expect(recordBackupOperation(storage, 'copiedAt', 100)).toBe(false)
    expect(readBackupHistory({ ...storage, read: () => { throw new Error('unreadable') } })).toEqual({})
  })
})
