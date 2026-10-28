import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '@/infrastructure/storage'
import { readLibraryPosition, saveLibraryPosition, resolveLibraryFolder, LIBRARY_POSITION_KEY } from '@/features/catalog/libraryPosition'

describe('library position', () => {
  it('persists only navigation state and validates corrupt records', () => {
    const storage = createMemoryStorage()
    saveLibraryPosition(storage, { activeView: 'folders', folderPath: '/root/a', searchQuery: '课程', visibleLimit: 150, scrollTop: 888, token: 'secret', url: 'https://media.test/a' } as never)
    expect(storage.read(LIBRARY_POSITION_KEY, {})).toEqual({ version: 1, activeView: 'folders', folderPath: '/root/a', searchQuery: '课程', visibleLimit: 150, scrollTop: 888 })
    expect(readLibraryPosition(storage)).toMatchObject({ visibleLimit: 150, scrollTop: 888 })
    storage.write(LIBRARY_POSITION_KEY, { version: 1, activeView: 'oops', visibleLimit: -1, scrollTop: Infinity })
    expect(readLibraryPosition(storage)).toMatchObject({ activeView: 'recent', visibleLimit: 50, scrollTop: 0 })
  })
  it('survives broken storage and drops URLs from saved search text', () => {
    const storage = { read() { throw Error('blocked') }, write() { throw Error('quota') }, remove() {} }
    expect(readLibraryPosition(storage)).toBeNull()
    expect(() => saveLibraryPosition(storage, { activeView: 'recent', folderPath: '/root', searchQuery: '', visibleLimit: 50, scrollTop: 0 })).not.toThrow()
    const memory = createMemoryStorage()
    saveLibraryPosition(memory, { activeView: 'recent', folderPath: '/root', searchQuery: 'https://cdn.test/a?token=secret', visibleLimit: 50, scrollTop: 0 })
    expect(readLibraryPosition(memory)?.searchQuery).toBe('')
  })
  it('falls back to the nearest surviving ancestor or new root', () => {
    expect(resolveLibraryFolder('/root/a/deleted', '/root', new Set(['/root', '/root/a']))).toBe('/root/a')
    expect(resolveLibraryFolder('/old/a', '/new', new Set(['/new']))).toBe('/new')
  })
})
