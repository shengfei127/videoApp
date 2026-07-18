export function createPiankeBuildDefines(
  uniPlatform: string | undefined,
  mode: string
): Record<string, string> {
  return {
    __PIANKE_UNI_PLATFORM__: JSON.stringify(uniPlatform ?? ''),
    __PIANKE_BUILD_MODE__: JSON.stringify(mode)
  }
}
