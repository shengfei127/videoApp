import type { KeyValueStorage } from '@/infrastructure/storage'

export const LEARNING_GUIDE_KEY = 'pianke:learning-guide:v1'
export type LearningGuideStatus = 'active' | 'completed' | 'skipped'

export function readLearningGuideStatus(storage: KeyValueStorage): LearningGuideStatus {
  try {
    const value = storage.read<{ status?: unknown } | null>(LEARNING_GUIDE_KEY, null)
    return value?.status === 'completed' || value?.status === 'skipped' ? value.status : 'active'
  } catch { return 'active' }
}

function saveStatus(storage: KeyValueStorage, status: Exclude<LearningGuideStatus, 'active'>): boolean {
  try { storage.write(LEARNING_GUIDE_KEY, { status }); return true }
  catch { return false }
}

export function markLearningGuideCompleted(storage: KeyValueStorage): boolean {
  return saveStatus(storage, 'completed')
}

export function skipLearningGuide(storage: KeyValueStorage): boolean {
  return saveStatus(storage, 'skipped')
}
