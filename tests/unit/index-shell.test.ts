import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('H5 document shell', () => {
  it('references a bundled PNG favicon so browser sessions do not request a missing icon', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const link = html.match(/<link\s+rel="icon"\s+type="image\/png"\s+href="([^"]+)"/u)

    expect(link).not.toBeNull()
    expect(link![1]).toMatch(/^\/static\//u)
    const icon = readFileSync(resolve(process.cwd(), 'src', link![1].slice(1)))
    expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(icon.readUInt32BE(16)).toBe(32)
    expect(icon.readUInt32BE(20)).toBe(32)
  })
})
