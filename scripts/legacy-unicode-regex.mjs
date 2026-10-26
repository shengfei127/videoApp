import { transformSync } from '@babel/core'
import unicodePropertyRegex from '@babel/plugin-transform-unicode-property-regex'

// Android's uni-app service engine can be older than its WebView. Expand
// Unicode property escapes before esbuild turns them into unsupported RegExp calls.
export function legacyUnicodeRegex() {
  return {
    name: 'pianke-legacy-unicode-regex',
    enforce: 'pre',
    transform(code, id) {
      const path = id.replaceAll('\\', '/')
      if (path.includes('/node_modules/') || !/\.[cm]?[jt]s$/.test(path) || !/\\[pP]\{/.test(code)) {
        return null
      }
      const result = transformSync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['typescript'] },
        plugins: [[unicodePropertyRegex, { useUnicodeFlag: false }]],
        sourceMaps: true
      })
      return { code: result.code, map: result.map }
    }
  }
}
