import { chromium } from '@playwright/test'
import { h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as icons from 'lucide-vue-next'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'

// Render the existing Lucide artwork as bundled PNGs because App views do not
// render the inline SVG elements produced by lucide-vue-next reliably.
const names = [...readFileSync('src/components/icons.ts', 'utf8')
  .matchAll(/export const (\w+) = icon/g)].map((match) => match[1])
const windowsChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const executablePath = process.env.CHROME_PATH ||
  (existsSync(windowsChrome) ? windowsChrome : undefined)
mkdirSync('src/static/icons', { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 72, height: 72 }, deviceScaleFactor: 1
  })
  for (const name of names) {
    const svg = await renderToString(h(icons[name], {
      size: 72, color: '#30463d', strokeWidth: 1.8
    }))
    await page.setContent('<style>body{margin:0;background:transparent}</style>' + svg)
    await page.screenshot({
      path: `src/static/icons/${name}.png`, omitBackground: true
    })
  }
  console.log(`Rendered ${names.length} icons`)
} finally {
  await browser.close()
}
