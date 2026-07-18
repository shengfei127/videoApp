export interface RuntimeConfig {
  baiduAppKey: string
  baiduAppFolder: string
  baiduRoot: string
  baiduRedirectUri: string
  useMocks: boolean
}

const DEFAULT_BAIDU_FOLDER = '片刻'
const DEFAULT_BAIDU_REDIRECT_URI = 'https://localhost/pianke/oauth/baidu'
const SAFE_FOLDER_SEGMENT = /^[\p{L}\p{N} _-]{1,20}$/u
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/

function isSafeFolderSegment(folder: string): boolean {
  return SAFE_FOLDER_SEGMENT.test(folder)
}

function parseBaiduAppFolder(rawFolder: string | undefined): string {
  if (!rawFolder || CONTROL_CHARACTER.test(rawFolder)) {
    return DEFAULT_BAIDU_FOLDER
  }

  const folder = rawFolder.trim().replace(/^\/+|\/+$/g, '')

  return isSafeFolderSegment(folder) ? folder : DEFAULT_BAIDU_FOLDER
}

function parseBaiduRedirectUri(rawRedirectUri: string | undefined): string {
  return rawRedirectUri === DEFAULT_BAIDU_REDIRECT_URI
    ? rawRedirectUri
    : DEFAULT_BAIDU_REDIRECT_URI
}

export function parseRuntimeConfig(
  env: Record<string, string | undefined>
): RuntimeConfig {
  const baiduAppFolder = parseBaiduAppFolder(env.VITE_BAIDU_APP_FOLDER)

  return {
    baiduAppKey: (env.VITE_BAIDU_APP_KEY || '').trim(),
    baiduAppFolder,
    baiduRoot: `/apps/${baiduAppFolder}`,
    baiduRedirectUri: parseBaiduRedirectUri(env.VITE_BAIDU_REDIRECT_URI),
    useMocks: env.VITE_USE_MOCKS === 'true'
  }
}

export const runtimeConfig = parseRuntimeConfig(
  import.meta.env as Record<string, string | undefined>
)
