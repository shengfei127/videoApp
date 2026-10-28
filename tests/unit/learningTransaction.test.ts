import { describe, expect, it } from 'vitest'
import { createMemoryStorage, type KeyValueStorage } from '@/infrastructure/storage'
import { LEARNING_TRANSACTION_KEY, recoverLearningTransaction, runLearningTransaction } from '@/infrastructure/learningTransaction'

const COURSE = 'pianke:daily-unlock:v1'
const PROGRESS = 'pianke:progress:v1'

describe('durable learning transaction', () => {
  it('recovers a process interrupted after its first write before exposing partial data', () => {
    const storage = createMemoryStorage()
    storage.write('auth', { keep: true })
    storage.write(LEARNING_TRANSACTION_KEY, { version: 1, originals: [{ key: COURSE, value: { original: true } }, { key: PROGRESS, value: null }] })
    storage.write(COURSE, { partial: true })
    storage.write(PROGRESS, ['new'])
    expect(recoverLearningTransaction(storage)).toBe(true)
    expect(storage.read(COURSE, null)).toEqual({ original: true })
    expect(storage.read(PROGRESS, null)).toBeNull()
    expect(storage.read(LEARNING_TRANSACTION_KEY, null)).toBeNull()
    expect(storage.read('auth', null)).toEqual({ keep: true })
    expect(recoverLearningTransaction(storage)).toBe(false)
  })

  it('does not touch data if quota prevents journal creation', () => {
    const memory = createMemoryStorage()
    memory.write(COURSE, ['old'])
    let written = false
    const storage: KeyValueStorage = { ...memory, write(key, value) {
      if (key === LEARNING_TRANSACTION_KEY) throw new Error('quota')
      written = true
      memory.write(key, value)
    } }
    expect(() => runLearningTransaction(storage, [COURSE], () => storage.write(COURSE, ['new']))).toThrow('quota')
    expect(written).toBe(false)
    expect(memory.read(COURSE, [])).toEqual(['old'])
  })

  it('retains its journal on rollback failure and safely retries after storage recovers', () => {
    const memory = createMemoryStorage()
    memory.write(COURSE, ['old'])
    let unavailable = false
    const storage: KeyValueStorage = { ...memory, write(key, value) {
      if (unavailable) throw new Error('disk unavailable')
      memory.write(key, value)
    } }
    expect(() => runLearningTransaction(storage, [COURSE, PROGRESS], () => {
      storage.write(COURSE, ['new'])
      unavailable = true
      throw new Error('killed connection')
    })).toThrow('学习数据仍需恢复')
    expect(memory.read(LEARNING_TRANSACTION_KEY, null)).not.toBeNull()
    expect(() => recoverLearningTransaction(storage)).toThrow()
    unavailable = false
    expect(recoverLearningTransaction(storage)).toBe(true)
    expect(memory.read(COURSE, [])).toEqual(['old'])
    expect(memory.read(PROGRESS, null)).toBeNull()
  })

  it('recognizes a verified commit when removing the journal completes before throwing', () => {
    const memory = createMemoryStorage()
    memory.write(COURSE, ['old'])
    let fail = true
    const storage: KeyValueStorage = { ...memory, remove(key) {
      memory.remove(key)
      if (key === LEARNING_TRANSACTION_KEY && fail) { fail = false; throw new Error('late error') }
    } }
    expect(() => runLearningTransaction(storage, [COURSE], () => storage.write(COURSE, ['new']))).not.toThrow()
    expect(memory.read(COURSE, [])).toEqual(['new'])
  })

  it('rejects an injected journal referencing unrelated credentials without writing them', () => {
    const memory = createMemoryStorage()
    memory.write('auth', { keep: true })
    memory.write(LEARNING_TRANSACTION_KEY, { version: 1, originals: [{ key: 'auth', value: null }] })
    expect(() => recoverLearningTransaction(memory)).toThrow('恢复记录异常')
    expect(memory.read('auth', null)).toEqual({ keep: true })
  })
})
