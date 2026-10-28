import type { KeyValueStorage } from '@/infrastructure/storage'

export const LIBRARY_POSITION_KEY = 'pianke.library-position.v1'
export interface LibraryPosition {
  activeView: 'recent' | 'folders'
  folderPath: string
  searchQuery: string
  visibleLimit: number
  scrollTop: number
}

function normalize(value: Partial<LibraryPosition>): LibraryPosition {
  return {
    activeView: value.activeView === 'folders' ? 'folders' : 'recent',
    folderPath: typeof value.folderPath === 'string' && value.folderPath.startsWith('/') && !/[?#\u0000-\u001f]/u.test(value.folderPath) ? value.folderPath.slice(0, 4096) : '',
    // Search can receive pasted signed media links: never persist these.
    searchQuery: typeof value.searchQuery === 'string' && !/(?:https?:\/\/|(?:token|password|secret|authorization|api[_-]?key)\s*[=:])/i.test(value.searchQuery) ? value.searchQuery.slice(0, 500) : '',
    visibleLimit: typeof value.visibleLimit === 'number' && Number.isFinite(value.visibleLimit) ? Math.max(50, Math.min(100000, Math.floor(value.visibleLimit))) : 50,
    scrollTop: typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop) ? Math.max(0, Math.min(10000000, value.scrollTop)) : 0
  }
}

export function readLibraryPosition(storage: KeyValueStorage): LibraryPosition | null {
  try {
    const value = storage.read<unknown>(LIBRARY_POSITION_KEY, null)
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null
    return normalize(value)
  } catch { return null }
}

export function saveLibraryPosition(storage: KeyValueStorage, value: LibraryPosition): boolean {
  try {
    storage.write(LIBRARY_POSITION_KEY, { version: 1, ...normalize(value) })
    return true
  } catch {
    // Leave the snapshot eligible for retry without interrupting browsing.
    return false
  }
}

export function resolveLibraryFolder(path: string, root: string, paths: ReadonlySet<string>): string {
  let candidate = path
  while (candidate === root || candidate.startsWith(`${root}/`)) {
    if (paths.has(candidate)) return candidate
    candidate = candidate.slice(0, candidate.lastIndexOf('/'))
  }
  return root
}
