export interface RuntimeConfig {
  baiduAppKey: string
  baiduAppFolder: string
  baiduRoot: string
  baiduRedirectUri: string
  useMocks: boolean
}

export interface RuntimeBuildEnvironment {
  uniPlatform?: string
  nodeEnv?: string
  devServer?: boolean
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
  env: Record<string, string | undefined>,
  buildEnvironment: RuntimeBuildEnvironment = readRuntimeBuildEnvironment()
): RuntimeConfig {
  const baiduAppFolder = parseBaiduAppFolder(env.VITE_BAIDU_APP_FOLDER)

  return {
    baiduAppKey: (env.VITE_BAIDU_APP_KEY || '').trim(),
    baiduAppFolder,
    baiduRoot: `/apps/${baiduAppFolder}`,
    baiduRedirectUri: parseBaiduRedirectUri(env.VITE_BAIDU_REDIRECT_URI),
    useMocks:
      env.VITE_USE_MOCKS === 'true' &&
      isH5DevServer(buildEnvironment)
  }
}

export function isH5DevServer(
  environment: RuntimeBuildEnvironment
): boolean {
  return environment.uniPlatform === 'h5' && environment.devServer === true
}

export function readRuntimeBuildEnvironment(): RuntimeBuildEnvironment {
  return {
    uniPlatform:
      typeof __PIANKE_UNI_PLATFORM__ !== 'undefined'
        ? __PIANKE_UNI_PLATFORM__
        : undefined,
    nodeEnv:
      typeof __PIANKE_BUILD_MODE__ !== 'undefined'
        ? __PIANKE_BUILD_MODE__
        : undefined,
    devServer:
      typeof __PIANKE_DEV_SERVER__ !== 'undefined'
        ? __PIANKE_DEV_SERVER__
        : undefined
  }
}

export const runtimeConfig = parseRuntimeConfig(
  import.meta.env as Record<string, string | undefined>
)
