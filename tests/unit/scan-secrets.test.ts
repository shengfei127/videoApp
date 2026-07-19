import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const scannerPath = resolve(process.cwd(), 'scripts/scan-secrets.mjs')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('credential scanner', () => {
  it('reports a clean result when source and build output contain no credentials', () => {
    const root = createFixture({
      'src/config.ts': "export const appKey = 'public-app-key'\n",
      'dist/app.js': 'console.log("safe build")\n'
    })

    const result = runScanner(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No forbidden credential patterns found.')
  })

  it.each([
    ['Baidu Secret/Sign environment variable', 'src/config.ts', 'VITE_BAIDU_SECRET=bad'],
    ['OAuth client secret assignment', 'src/oauth.ts', 'client_secret: bad'],
    ['SecretKey configuration', 'src/provider.ts', 'SecretKey = unsafe-value'],
    ['SignKey configuration', 'dist/provider.js', 'SignKey: "unsafe-value"'],
    [
      'real-looking access token in a built URL',
      'dist/app.js',
      'https://example.test/file?access_token=1234567890abcdefghij'
    ],
    [
      'real-looking access token in an OAuth fragment',
      'dist/oauth-callback.js',
      'https://localhost/pianke/oauth/baidu#access_token=1234567890abcdefghij'
    ],
    [
      'real-looking access token in URLSearchParams text',
      'src/query.ts',
      "new URLSearchParams('access_token=1234567890abcdefghij')"
    ],
    [
      'real-looking serialized access token',
      'dist/session.js',
      '{"access_token":"1234567890abcdefghij"}'
    ],
    ...accessTokenLiteralFixtures
  ])('fails for a %s', (_description, file, contents) => {
    const root = createFixture({ [file]: contents })

    const result = runScanner(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Forbidden credential patterns found:')
    expect(result.stderr).toContain(file)
  })

  it('ignores symbolic and known mock access-token values', () => {
    const root = createFixture({
      'src/index.ts': 'export const appKey = "public-key"',
      'src/mock.ts':
        "const access_token = BAIDU_ACCESS_TOKEN_FROM_STORAGE\nconst fixture = { access_token: MOCK_ACCESS_TOKEN_PLACEHOLDER, access_token: 'mock-abcdefghijklmnopqrstuvwxyz', accessToken: \"sentinel-abcdefghijklmnopqrstuvwxyz\", nextAccessToken: `placeholder-abcdefghijklmnopqrstuvwxyz` }",
      'scripts/scan-secrets.mjs': 'const example = "VITE_BAIDU_SECRET=example"',
      'dist/media.bin': Buffer.from([0, 255, 254, 253, 0])
    })

    const result = runScanner(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No forbidden credential patterns found.')
  })

  it('fails closed when a candidate source file cannot be read', () => {
    const root = createFixture({
      'src/blocked.ts': 'const secret = "DO_NOT_PRINT_SCANNER_CONTENT"',
      'scanner-read-failure.cjs': `
        const fs = require('node:fs')
        const originalReadFileSync = fs.readFileSync
        fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
          if (String(filePath).endsWith('blocked.ts')) {
            throw new Error('synthetic scanner read failure')
          }
          return originalReadFileSync.call(this, filePath, ...args)
        }
      `
    })

    const result = runScanner(root, {
      preload: resolve(root, 'scanner-read-failure.cjs')
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Could not scan candidate file: src/blocked.ts')
    expect(result.stderr).not.toContain('DO_NOT_PRINT_SCANNER_CONTENT')
    expect(result.stdout).not.toContain('No forbidden credential patterns found.')
  })
})

const accessTokenLiteralFixtures: Array<[string, string, string]> = [
  ['snake_case single-quoted object literal', 'src/snake-single.ts', "const session = { access_token: '1234567890abcdefghij' }"],
  ['snake_case double-quoted object literal', 'src/snake-double.ts', 'const session = { access_token: "1234567890abcdefghij" }'],
  ['snake_case backtick object literal', 'src/snake-backtick.ts', 'const session = { access_token: `1234567890abcdefghij` }'],
  ['snake_case single-quoted assignment', 'src/snake-assignment-single.ts', "const access_token = '1234567890abcdefghij'"],
  ['snake_case double-quoted assignment', 'src/snake-assignment-double.ts', 'const access_token = "1234567890abcdefghij"'],
  ['snake_case backtick assignment', 'src/snake-assignment-backtick.ts', 'const access_token = `1234567890abcdefghij`'],
  ['camelCase single-quoted object literal', 'src/camel-single.ts', "const session = { accessToken: '1234567890abcdefghij' }"],
  ['camelCase double-quoted object literal', 'src/camel-double.ts', 'const session = { accessToken: "1234567890abcdefghij" }'],
  ['camelCase backtick object literal', 'src/camel-backtick.ts', 'const session = { accessToken: `1234567890abcdefghij` }'],
  ['camelCase single-quoted assignment', 'src/camel-assignment-single.ts', "const accessToken = '1234567890abcdefghij'"],
  ['camelCase double-quoted assignment', 'src/camel-assignment-double.ts', 'const accessToken = "1234567890abcdefghij"'],
  ['camelCase backtick assignment', 'src/camel-assignment-backtick.ts', 'const accessToken = `1234567890abcdefghij`'],
  ['prefixed snake_case assignment', 'src/prefixed-snake.ts', 'const BAIDU_ACCESS_TOKEN = "1234567890abcdefghij"']
]

function createFixture(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(resolve(tmpdir(), 'pianke-secret-scan-'))
  temporaryRoots.push(root)

  for (const [relativePath, contents] of Object.entries(files)) {
    const target = resolve(root, relativePath)
    mkdirSync(resolve(target, '..'), { recursive: true })
    if (typeof contents === 'string') {
      writeFileSync(target, contents, 'utf8')
    } else {
      writeFileSync(target, contents)
    }
  }

  return root
}

function runScanner(root: string, options: { preload?: string } = {}) {
  const nodeArguments = options.preload
    ? ['--require', options.preload, scannerPath]
    : [scannerPath]

  return spawnSync(process.execPath, nodeArguments, {
    cwd: root,
    encoding: 'utf8'
  })
}
