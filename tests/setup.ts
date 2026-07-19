import { afterEach, beforeEach, vi } from 'vitest'

function createUniMock(storage: Map<string, unknown>) {
  return {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    navigateTo: vi.fn(),
    redirectTo: vi.fn(),
    navigateBack: vi.fn(),
    showToast: vi.fn(),
    showModal: vi.fn(),
    request: vi.fn()
  }
}

beforeEach(() => {
  const storage = new Map<string, unknown>()
  vi.stubGlobal('uni', createUniMock(storage))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
