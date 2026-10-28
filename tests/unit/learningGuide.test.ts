import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '@/infrastructure/storage'
import { LEARNING_GUIDE_KEY, markLearningGuideCompleted, readLearningGuideStatus, skipLearningGuide } from '@/features/onboarding/learningGuide'

describe('learning guide persistence', () => {
  it('persists skip and completion across reads', () => {
    const storage = createMemoryStorage()
    expect(readLearningGuideStatus(storage)).toBe('active')
    expect(skipLearningGuide(storage)).toBe(true)
    expect(readLearningGuideStatus(storage)).toBe('skipped')
    expect(markLearningGuideCompleted(storage)).toBe(true)
    expect(readLearningGuideStatus(storage)).toBe('completed')
  })
  it('recovers malformed or unavailable state as active', () => {
    const storage = createMemoryStorage()
    storage.write(LEARNING_GUIDE_KEY, { status: 'unknown' })
    expect(readLearningGuideStatus(storage)).toBe('active')
    storage.read = () => { throw new Error('unavailable') }
    expect(readLearningGuideStatus(storage)).toBe('active')
  })
  it('does not report success when saving fails', () => {
    const storage = createMemoryStorage()
    storage.write = () => { throw new Error('full') }
    expect(skipLearningGuide(storage)).toBe(false)
    expect(markLearningGuideCompleted(storage)).toBe(false)
    expect(readLearningGuideStatus(storage)).toBe('active')
  })
})
