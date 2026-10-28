import { expect, test, type Page } from '@playwright/test'

async function openManager(page: Page) {
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
}

async function preparePlayer(page: Page) {
  await page.route('**/rest/2.0/xpan/multimedia**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ errno: 0, list: [{
      fs_id: '1001', path: '/apps/片刻/旅行2/第2站·海边.mp4', dlink: 'https://d.pcs.baidu.com/file/sea.mp4'
    }] })
  }))
  await page.route('https://d.pcs.baidu.com/**', async () => { await new Promise<void>(() => {}) })
  await page.goto('/?scenario=library#/pages/library/index', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('播放视频：第2站·海边.mp4', { exact: true }).click()
  await expect(page.locator('video[data-testid="player-video"]')).toBeVisible()
}

async function failProgressWrites(page: Page) {
  await page.evaluate(() => {
    const runtime = window as any
    const original = runtime.uni.setStorageSync.bind(runtime.uni)
    runtime.restoreProgressWrites = () => { runtime.uni.setStorageSync = original }
    runtime.uni.setStorageSync = (key: string, value: unknown) => {
      if (['pianke:progress:v1', 'pianke:learning-status:v1'].includes(key)) throw new Error('quota exceeded')
      return original(key, value)
    }
  })
  await page.locator('video[data-testid="player-video"]').evaluate((element) => {
    Object.defineProperty(element, 'duration', { configurable: true, value: 600 })
    Object.defineProperty(element, 'currentTime', { configurable: true, value: 42 })
    element.dispatchEvent(new Event('loadedmetadata'))
    element.dispatchEvent(new Event('play'))
    element.dispatchEvent(new Event('timeupdate'))
  })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
})

test('failed return stays in the player until retry saves the pending position', async ({ page }, testInfo) => {
  await preparePlayer(page)
  await failProgressWrites(page)
  await page.getByTestId('player-back').click()
  await expect(page.getByTestId('player-exit-dialog')).toBeVisible()
  await expect(page).toHaveURL(/pages\/player\/index/)
  await page.getByTestId('player-exit-retry').click()
  await expect(page.getByTestId('player-exit-dialog')).toBeVisible()
  await expect(page).toHaveURL(/pages\/player\/index/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('player-exit-failed-320.png'), fullPage: true })
  await page.evaluate(() => (window as any).restoreProgressWrites())
  await page.getByTestId('player-exit-retry').click()
  await expect(page).toHaveURL(/pages\/library\/index/)
  const progress = await page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:progress:v1')))
  expect(progress.find((item: any) => item.videoId === 'baidu:1001').positionSeconds).toBe(42)
})

test('leave anyway returns despite a persistent storage failure', async ({ page }) => {
  await preparePlayer(page)
  await failProgressWrites(page)
  await page.getByTestId('player-back').click()
  await expect(page.getByTestId('player-exit-dialog')).toBeVisible()
  await page.getByTestId('player-exit-anyway').click()
  await expect(page).toHaveURL(/pages\/library\/index/)
})

test('a refreshed player without a previous page returns home', async ({ page }) => {
  await preparePlayer(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('player-back')).toBeVisible()
  await page.getByTestId('player-back').click()
  await expect(page).toHaveURL(/#\/(?:pages\/home\/index)?$/)
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect(page.locator('.bottom-nav').getByLabel('首页')).toHaveAttribute('aria-current', 'page')
})

for (const mode of ['videos', 'folder'] as const) {
  test(`moving lesson 50 down expands the ${mode} preview and keeps it visible`, async ({ page }, testInfo) => {
    await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.bottom-nav')).toBeVisible()
    await page.evaluate(async (selectionMode) => {
      const modulePath = '/src/stores/appStore.ts'
      const { useAppStore } = await import(/* @vite-ignore */ modulePath)
      const store = useAppStore()
      const original = store.baiduVideos[0]
      store.baiduVideos = Array.from({ length: 55 }, (_, index) => ({
        ...original, id: `baidu:${2000 + index}`, sourceId: String(2000 + index),
        name: `第${index + 1}课.mp4`, path: `/apps/片刻/课程/第${index + 1}课.mp4`
      }))
      ;(window as any).uni.setStorageSync('pianke:course-draft:v1', JSON.stringify({
        name: '跨页排序', selectionMode, sourceFolderPath: selectionMode === 'folder' ? '/apps/片刻/课程' : '',
        dailyEpisodeCount: 1, startEpisodeNumber: 1,
        episodes: store.baiduVideos.map((video: any) => ({ videoId: video.id, name: video.name, sourceType: 'baidu', path: video.path }))
      }))
    }, mode)
    await openManager(page)
    await page.getByTestId('restore-draft').click()
    const preview = page.getByTestId('episode-preview')
    if (mode === 'videos' && !await preview.isVisible()) await page.locator('.daily-selection-count').click()
    await expect(preview.locator('[data-move-down]')).toHaveCount(50)
    const moved = preview.locator('[data-move-down="baidu:2049"]')
    await moved.click()
    await expect(preview.locator('[data-move-down]').nth(50)).toHaveAttribute('data-move-down', 'baidu:2049')
    await expect(moved).toBeInViewport()
    if (mode === 'folder') {
      await expect.poll(() => moved.evaluate((element) => {
        const row = element.closest('.daily-episode-row')!.getBoundingClientRect()
        const container = element.closest('.daily-episode-preview')!.getBoundingClientRect()
        return row.top >= Math.max(0, container.top) - 1 && row.bottom <= Math.min(window.innerHeight, container.bottom) + 1
      })).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`course-${mode}-boundary-320.png`), fullPage: false })
  })
}
