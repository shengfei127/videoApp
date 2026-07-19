import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('H5 document shell', () => {
  it('embeds a favicon so browser sessions do not request a missing icon', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

    expect(html).toMatch(
      /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="data:image\/svg\+xml,/u
    )
  })
})
