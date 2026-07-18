export interface KeyValueStorage {
  read<T>(key: string, fallback: T): T
  write<T>(key: string, value: T): void
  remove(key: string): void
}

function parseStoredValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export const uniStorage: KeyValueStorage = {
  read: <T>(key: string, fallback: T): T =>
    parseStoredValue(uni.getStorageSync(key), fallback),
  write: <T>(key: string, value: T): void => {
    uni.setStorageSync(key, JSON.stringify(value))
  },
  remove: (key: string): void => {
    uni.removeStorageSync(key)
  }
}

export function createMemoryStorage(): KeyValueStorage {
  const data = new Map<string, string>()

  return {
    read: <T>(key: string, fallback: T): T =>
      parseStoredValue(data.get(key), fallback),
    write: <T>(key: string, value: T): void => {
      data.set(key, JSON.stringify(value))
    },
    remove: (key: string): void => {
      data.delete(key)
    }
  }
}
