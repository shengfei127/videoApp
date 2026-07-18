import { beforeEach, vi } from 'vitest'

const storage = new Map<string, unknown>()

vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  navigateBack: vi.fn(),
  showToast: vi.fn(),
  showModal: vi.fn(),
  request: vi.fn()
})

beforeEach(() => {
  storage.clear()
  vi.clearAllMocks()
})
