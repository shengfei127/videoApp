const MAX_RANDOM_BYTES = 65_536
const SECURE_RANDOM_ERROR = '当前环境无法安全生成随机值'

export function tryPlatformRandomUuid(): string | null {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID !== 'function') {
    return null
  }

  try {
    const uuid = randomUUID.call(globalThis.crypto)
    return uuid.trim() ? uuid : null
  } catch {
    return null
  }
}

export function secureRandomBytes(length: number): Uint8Array {
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > MAX_RANDOM_BYTES
  ) {
    throw new Error(SECURE_RANDOM_ERROR)
  }

  const getRandomValues = globalThis.crypto?.getRandomValues
  if (typeof getRandomValues !== 'function') {
    throw new Error(SECURE_RANDOM_ERROR)
  }

  try {
    const bytes = new Uint8Array(length)
    getRandomValues.call(globalThis.crypto, bytes)
    return bytes
  } catch {
    throw new Error(SECURE_RANDOM_ERROR)
  }
}

export function createSecureUuid(): string {
  const platformUuid = tryPlatformRandomUuid()
  if (platformUuid) {
    return platformUuid
  }

  const bytes = secureRandomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')
}
