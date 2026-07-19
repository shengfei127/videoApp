export function createPiankeBuildDefines(
  uniPlatform: string | undefined,
  mode: string,
  command: 'serve' | 'build',
  appVersion: string
): Record<string, string> {
  const normalizedVersion = appVersion.trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(normalizedVersion)) {
    throw new Error('Application version is invalid')
  }

  return {
    __PIANKE_UNI_PLATFORM__: JSON.stringify(uniPlatform ?? ''),
    __PIANKE_BUILD_MODE__: JSON.stringify(mode),
    __PIANKE_DEV_SERVER__: JSON.stringify(command === 'serve'),
    __PIANKE_APP_VERSION__: JSON.stringify(normalizedVersion)
  }
}
