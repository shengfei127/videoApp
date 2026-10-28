import type { KeyValueStorage } from './storage'

export const LEARNING_TRANSACTION_KEY = 'pianke:learning-transaction:v1'
export const LEARNING_DATA_KEYS = ['pianke:daily-unlock:v1', 'pianke:progress:v1', 'pianke:learning-status:v1'] as const
type LearningKey = (typeof LEARNING_DATA_KEYS)[number]
interface Journal { version: 1; originals: Array<{ key: LearningKey; value: unknown }> }

function readJournal(storage: KeyValueStorage): Journal | null {
  const value = storage.read<unknown>(LEARNING_TRANSACTION_KEY, null)
  if (value === null) return null
  const journal = value as Journal
  if (!journal || journal.version !== 1 || !Array.isArray(journal.originals) || !journal.originals.length ||
    journal.originals.length > LEARNING_DATA_KEYS.length || new Set(journal.originals.map((item) => item?.key)).size !== journal.originals.length ||
    journal.originals.some((item) => !item || !LEARNING_DATA_KEYS.includes(item.key) || !Object.prototype.hasOwnProperty.call(item, 'value'))) {
    throw new Error('学习数据恢复记录异常，请保留备份后重试')
  }
  return journal
}

/** A pending transaction always rolls back. Removing the journal is the commit point. */
export function recoverLearningTransaction(storage: KeyValueStorage): boolean {
  const journal = readJournal(storage)
  if (!journal) return false
  for (const item of journal.originals) {
    if (item.value === null) storage.remove(item.key)
    else storage.write(item.key, item.value)
  }
  storage.remove(LEARNING_TRANSACTION_KEY)
  return true
}

export function runLearningTransaction(storage: KeyValueStorage, keys: readonly LearningKey[], write: () => void): void {
  recoverLearningTransaction(storage)
  if (!keys.length || keys.some((key) => !LEARNING_DATA_KEYS.includes(key)) || new Set(keys).size !== keys.length) throw new Error('学习数据操作无效')
  const journal: Journal = { version: 1, originals: keys.map((key) => ({ key, value: storage.read(key, null) })) }
  // If quota prevents journaling, no existing data has been touched.
  storage.write(LEARNING_TRANSACTION_KEY, journal)
  let committing = false
  try {
    write()
    committing = true
    storage.remove(LEARNING_TRANSACTION_KEY)
  } catch {
    try {
      // Some adapters can complete remove() and then report an error.
      // All writes finished and the durable commit point is verifiably reached.
      if (committing && !readJournal(storage)) return
      recoverLearningTransaction(storage)
    }
    catch { throw new Error('保存未完成，学习数据仍需恢复；请保留备份，腾出存储空间后重试恢复') }
    throw new Error('保存失败，原学习数据已保留，请稍后重试')
  }
}
