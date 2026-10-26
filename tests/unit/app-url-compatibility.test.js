import { describe, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'

// Reproduce the App service context rather than happy-dom's browser globals.
describe('App URL support without browser globals', () => {
  it('builds and parses OAuth URLs in a bare JavaScript engine', () => {
    const { outputFiles } = buildSync({
      stdin: {
        contents: `
          import 'core-js/actual/url';
          import 'core-js/actual/url-search-params';
          const url = new URL('https://openapi.baidu.com/oauth/2.0/authorize');
          url.searchParams.set('redirect_uri', 'https://localhost/pianke/oauth/baidu');
          url.searchParams.set('state', 'safe-state');
          const result = new URL(url.toString());
          globalThis.result = [result.origin, result.searchParams.get('redirect_uri'),
            new URLSearchParams('#state=safe-state'.slice(1)).get('state')];
        `,
        resolveDir: process.cwd()
      },
      bundle: true, write: false, target: 'es2015', format: 'iife'
    })
    const context = { URL: undefined, URLSearchParams: undefined }
    runInNewContext(outputFiles[0].text, context)
    expect(Array.from(context.result)).toEqual([
      'https://openapi.baidu.com', 'https://localhost/pianke/oauth/baidu', 'safe-state'
    ])
  })
})
