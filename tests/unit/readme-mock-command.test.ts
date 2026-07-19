import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('README mock startup command', () => {
  it('uses a scoped cross-env invocation instead of persistent PowerShell assignments', () => {
    const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')

    expect(readme).toContain(
      'npx cross-env VITE_USE_MOCKS=true VITE_BAIDU_APP_KEY=mock-public-app-key npm run dev:h5 -- --host 127.0.0.1 --port 5173'
    )
    expect(readme).not.toContain('$env:VITE_USE_MOCKS')
    expect(readme).not.toContain('$env:VITE_BAIDU_APP_KEY')
  })
})
