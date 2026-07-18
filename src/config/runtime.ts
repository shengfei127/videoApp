export interface RuntimeConfig {
  baiduAppKey: string
  baiduAppFolder: string
  baiduRoot: string
  baiduRedirectUri: string
  useMocks: boolean
}

export function parseRuntimeConfig(
  env: Record<string, string | undefined>
): RuntimeConfig {
  const configuredFolder = (env.VITE_BAIDU_APP_FOLDER || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  const baiduAppFolder = configuredFolder || '片刻'

  return {
    baiduAppKey: (env.VITE_BAIDU_APP_KEY || '').trim(),
    baiduAppFolder,
    baiduRoot: `/apps/${baiduAppFolder}`,
    baiduRedirectUri:
      env.VITE_BAIDU_REDIRECT_URI || 'https://localhost/pianke/oauth/baidu',
    useMocks: env.VITE_USE_MOCKS === 'true'
  }
}

export const runtimeConfig = parseRuntimeConfig(
  import.meta.env as Record<string, string | undefined>
)
