import { expect, test, type Locator, type Page } from '@playwright/test'

// Measure actual glyph boxes, including anonymous text inside uni-button.
async function centeredText(control: Locator) {
  await expect(control).toBeVisible()
  const geometry = await control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const boxes: DOMRect[] = []
    let node: Node | null
    while ((node = walker.nextNode())) {
      const value = node.textContent || ''
      const first = value.search(/\S/)
      if (first < 0) continue
      const range = document.createRange()
      range.setStart(node, first)
      range.setEnd(node, value.trimEnd().length)
      boxes.push(...Array.from(range.getClientRects()).filter(box => box.width && box.height))
    }
    const top = Math.min(...boxes.map(box => box.top))
    const bottom = Math.max(...boxes.map(box => box.bottom))
    return { text: element.textContent?.trim(), count: boxes.length, delta: (top + bottom - rect.top - rect.bottom) / 2 }
  })
  expect(geometry.count, geometry.text).toBeGreaterThan(0)
  expect(Math.abs(geometry.delta), JSON.stringify(geometry)).toBeLessThanOrEqual(2)
}

async function centeredAll(controls: Locator) {
  expect(await controls.count()).toBeGreaterThan(0)
  for (const control of await controls.all()) await centeredText(control)
}

async function settings(page: Page) {
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
}

for (const width of [320, 390]) {
  test(`learning controls align their rendered content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
    await settings(page)
    const toggle = page.getByTestId('daily-unlock-toggle')
    const edges: number[] = []
    for (let index = 0; index < 2; index++) {
      const enabled = await toggle.getAttribute('aria-checked') === 'true'
      const box = await toggle.boundingBox()
      const thumb = await toggle.locator('.daily-unlock-switch__thumb').boundingBox()
      expect(box).not.toBeNull()
      expect(thumb).not.toBeNull()
      expect(Math.abs(thumb!.y + thumb!.height / 2 - box!.y - box!.height / 2)).toBeLessThanOrEqual(1)
      edges.push(enabled ? box!.x + box!.width - thumb!.x - thumb!.width : thumb!.x - box!.x)
      expect(Math.abs(edges[index] - 4)).toBeLessThanOrEqual(1)
      await toggle.click()
      await page.waitForTimeout(180)
    }
    expect(Math.abs(edges[0] - edges[1])).toBeLessThanOrEqual(1)
    if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click()
    await page.waitForTimeout(180)
    await centeredText(page.getByTestId('daily-unlock-manage'))
    await page.screenshot({ path: `artifacts/alignment/settings-${width}.png`, fullPage: true })
    await page.getByTestId('daily-unlock-manage').click()
    await centeredText(page.getByTestId('mode-videos'))
    await centeredText(page.getByTestId('mode-folder'))
    await page.getByTestId('mode-videos').click()
    await page.getByTestId('course-name').locator('input').fill('文字对齐检查课程')
    await page.locator('[data-video-id="baidu:1001"]').click()
    await centeredText(page.getByTestId('create-course'))
    await page.getByTestId('create-course').click()
    await centeredAll(page.locator('.daily-filter'))
    await centeredText(page.getByTestId('new-course'))
    await centeredText(page.getByTestId('pause-course'))
    await page.screenshot({ path: `artifacts/alignment/course-${width}.png`, fullPage: true })
    await page.getByLabel('返回设置', { exact: true }).click()
    await page.locator('.bottom-nav').getByLabel('首页').click()
    await centeredAll(page.locator('.home-learning-link'))
    await centeredText(page.getByTestId('lesson-primary'))
    await centeredText(page.getByTestId('lesson-more'))
    await page.getByTestId('lesson-more').click()
    await centeredText(page.getByLabel('标记学完：第2站·海边.mp4', { exact: true }))
    await page.screenshot({ path: `artifacts/alignment/home-${width}.png`, fullPage: true })
    await page.locator('.bottom-nav').getByLabel('视频库').click()
    const search = page.getByTestId('library-search')
    const searchRect = await search.boundingBox()
    const inputRect = await search.locator('input').boundingBox()
    expect(Math.abs(searchRect!.y + searchRect!.height / 2 - inputRect!.y - inputRect!.height / 2)).toBeLessThanOrEqual(1)
    await page.evaluate(async () => {
      const modulePath = '/src/stores/appStore.ts'
      const { useAppStore } = await import(/* @vite-ignore */ modulePath)
      const store = useAppStore()
      store.baiduVideos = [{ ...store.baiduVideos[0], path: `/apps/片刻/${'用于验证多行按钮文字居中的很长很长的文件夹名称'.repeat(4)}/第1课.mp4` }]
    })
    await page.locator('.library-segment__button').filter({ hasText: '文件夹' }).click()
    await page.getByTestId('folder-row').first().click()
    await centeredAll(page.getByTestId('breadcrumb'))
    const last = page.getByTestId('breadcrumb').last()
    expect(await last.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(44)
    await page.screenshot({ path: `artifacts/alignment/library-${width}.png`, fullPage: true })
  })

  test(`guide and backup controls align at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/?scenario=first-run#/pages/home/index', { waitUntil: 'domcontentloaded' })
    await centeredText(page.getByTestId('learning-guide-start'))
    await centeredText(page.getByTestId('learning-guide-skip'))
    await page.screenshot({ path: `artifacts/alignment/guide-${width}.png`, fullPage: true })
    await page.getByTestId('learning-guide-start').click()
    await centeredText(page.getByTestId('library-learning-add'))
    await centeredText(page.getByTestId('library-learning-connect'))
    await page.getByTestId('library-learning-add').click()
    await centeredText(page.getByTestId('direct-save'))
    await page.screenshot({ path: `artifacts/alignment/direct-dialog-${width}.png`, fullPage: true })
    await page.goto('/?scenario=first-run#/pages/settings/index', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('settings-backup').click()
    for (const id of ['backup-export', 'backup-copy', 'backup-file', 'backup-inspect']) await centeredText(page.getByTestId(id))
    await page.screenshot({ path: `artifacts/alignment/backup-${width}.png`, fullPage: true })
  })
}
