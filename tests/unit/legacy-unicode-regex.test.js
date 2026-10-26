import { describe, expect, it } from 'vitest'
import { legacyUnicodeRegex } from '../../scripts/legacy-unicode-regex.mjs'

describe('Android service-engine regex compatibility', () => {
  it('expands Unicode properties before esbuild while preserving directory validation', () => {
    const plugin = legacyUnicodeRegex()
    const result = plugin.transform('const folder: RegExp = /^[\\p{L}\\p{N} _-]{1,20}$/u', '/src/config/runtime.ts')
    expect(result.code).not.toContain('\\p{')
    const expression = result.code.replace('const folder: RegExp =', 'return').trim()
    const pattern = Function(expression)()
    for (const name of ['片刻', '课程 01', 'Café', '日本語', '𠀀', 'a'.repeat(20)]) {
      expect(pattern.test(name), name).toBe(true)
    }
    for (const name of ['', '../其他', 'a/b', 'a\\b', '课程?', '🙂', 'a'.repeat(21)]) {
      expect(pattern.test(name), name).toBe(false)
    }
  })

  it('does not alter unrelated code or dependencies', () => {
    const plugin = legacyUnicodeRegex()
    expect(plugin.transform('const x = 1', '/src/main.ts')).toBeNull()
    expect(plugin.transform('const r = /\\p{L}/u', '/node_modules/vendor/index.js')).toBeNull()
  })
})
