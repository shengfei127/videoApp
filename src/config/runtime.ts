export interface RuntimeConfig {
  baiduAppKey: string
  baiduAppFolder: string
  baiduRoot: string
  baiduRedirectUri: string
  useMocks: boolean
}

const DEFAULT_BAIDU_APP_FOLDER = '片刻'
const DEFAULT_BAIDU_REDIRECT_URI = 'https://localhost/pianke/oauth/baidu'
const SAFE_FOLDER_SEGMENT = /^[\p{L}\p{N} _-]{1,20}$/u

function isSafeFolderSegment(folder: string): boolean {
  return SAFE_FOLDER_SEGMENT.test(folder)
}

function isValidBaiduRedirectUri(redirectUri: string): boolean {
  if (redirectUri !== DEFAULT_BAIDU_REDIRECT_URI) {
    return false
  }

  try {
    const parsed = new URL(redirectUri)

    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'localhost' &&
      parsed.port === '' &&
      parsed.pathname === '/pianke/oauth/baidu' &&
      parsed.search === '' &&
      parsed.hash === ''
    )
  } catch {
    return false
  }
}

export function parseRuntimeConfig(
  env: Record<string, string | undefined>
): RuntimeConfig {
  const configuredFolder = (env.VITE_BAIDU_APP_FOLDER || '').trim()
  const baiduAppFolder = isSafeFolderSegment(configuredFolder)
    ? configuredFolder
    : DEFAULT_BAIDU_APP_FOLDER
  const configuredRedirectUri = (env.VITE_BAIDU_REDIRECT_URI || '').trim()

  return {
    baiduAppKey: (env.VITE_BAIDU_APP_KEY || '').trim(),
    baiduAppFolder,
    baiduRoot: `/apps/${baiduAppFolder}`,
    baiduRedirectUri: isValidBaiduRedirectUri(configuredRedirectUri)
      ? configuredRedirectUri
      : DEFAULT_BAIDU_REDIRECT_URI,
    useMocks: env.VITE_USE_MOCKS === 'true'
  }
}

export const runtimeConfig = parseRuntimeConfig(
  import.meta.env as Record<string, string | undefined>
)
