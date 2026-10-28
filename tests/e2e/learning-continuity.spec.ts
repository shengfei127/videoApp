import { expect, test, type Page } from '@playwright/test'

const SEA = 'baidu:1001'
const MOUNTAIN = 'baidu:700000000000000003'
const CITY = 'baidu:700000000000000001'
const LIVE = 'direct:00000000-0000-4000-8000-000000000001'

async function readPlans(page: Page) {
  return page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:daily-unlock:v1')))
}

async function openManager(page: Page) {
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
}

async function narrowCheck(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
})

test('library returns to the same folder, loaded batch, and scroll position after changing tabs', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?scenario=library#/pages/library/index', { waitUntil: 'domcontentloaded' })
  await expect(page.getByLabel('播放视频：第2站·海边.mp4', { exact: true })).toBeVisible()
  // Extend the existing mock catalog to exercise actual pagination, without network sources.
  await page.evaluate(async () => {
    const modulePath = '/src/stores/appStore.ts'
    const { useAppStore } = await import(/* @vite-ignore */ modulePath)
    const store = useAppStore()
    const original = store.baiduVideos[0]
    store.baiduVideos = Array.from({ length: 65 }, (_, index) => ({
      ...original, id: `baidu:${2000 + index}`, sourceId: String(2000 + index),
      name: `第${index + 1}课.mp4`, path: `/apps/片刻/课程/第一章/第${index + 1}课.mp4`
    }))
  })
  await page.locator('.library-segment__button').filter({ hasText: '文件夹' }).click()
  await page.getByTestId('folder-row').filter({ hasText: '课程' }).click()
  await page.getByTestId('folder-row').filter({ hasText: '第一章' }).click()
  await expect(page.locator('.video-row')).toHaveCount(50)
  await page.getByTestId('library-load-more').click()
  await expect(page.locator('.video-row')).toHaveCount(65)
  await page.evaluate(() => window.scrollTo(0, 700))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600)
  const before = await page.evaluate(() => window.scrollY)
  await page.locator('.bottom-nav').getByLabel('首页').click()
  expect(JSON.parse(await page.evaluate(() => (window as any).uni.getStorageSync('pianke.library-position.v1'))).scrollTop).toBe(before)
  await page.locator('.bottom-nav').getByLabel('视频库').click()
  await expect(page.locator('.library-segment__button').filter({ hasText: '文件夹' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('breadcrumb').last()).toContainText('第一章')
  await expect(page.locator('.video-row')).toHaveCount(65)
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(5)
  await narrowCheck(page)
  await page.screenshot({ path: testInfo.outputPath('library-restored-320.png'), fullPage: false })
  expect(errors).toEqual([])
})

test('course draft survives leaving, restores manual order, and can be discarded', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
  await openManager(page)
  await page.getByTestId('mode-videos').click()
  await page.getByTestId('course-name').locator('input').fill('出门前未完成的计划')
  for (const id of [SEA, MOUNTAIN, LIVE]) await page.locator(`[data-video-id="${id}"]`).click()
  await page.locator('.daily-selection-count').click()
  await page.locator(`[data-move-up="${MOUNTAIN}"]`).click()
  await expect(page.getByTestId('episode-preview').locator('.daily-episode-link-row').first()).toContainText('山间')
  await page.getByLabel('返回设置', { exact: true }).click()
  await page.getByTestId('daily-unlock-manage').click()
  await expect(page.getByTestId('draft-recovery')).toBeVisible()
  await narrowCheck(page)
  await page.screenshot({ path: testInfo.outputPath('draft-recovery-320.png'), fullPage: true })
  await page.getByTestId('restore-draft').click()
  await expect(page.getByTestId('course-name').locator('input')).toHaveValue('出门前未完成的计划')
  await expect(page.getByTestId('schedule-preview')).toContainText('山间')
  await page.getByTestId('create-course').click()
  expect((await readPlans(page)).courses[0].episodes.map((item: any) => item.videoId)).toEqual([MOUNTAIN, SEA, LIVE])
  await page.getByTestId('new-course').click()
  await page.getByTestId('course-name').locator('input').fill('不保留的草稿')
  await page.getByLabel('返回设置', { exact: true }).click()
  await page.getByTestId('daily-unlock-manage').click()
  await page.getByTestId('discard-draft').click()
  await expect(page.getByTestId('draft-recovery')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).uni.getStorageSync('pianke:course-draft:v1'))).toBeFalsy()
  expect((await readPlans(page)).courses).toHaveLength(1)
  expect(errors).toEqual([])
})

test('rate preview keeps today stable and cancel leaves the saved plan untouched', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date(2026, 9, 28, 12) })
  await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
  await openManager(page)
  await page.getByTestId('mode-videos').click()
  await page.getByTestId('course-name').locator('input').fill('每天多学一点')
  for (const id of [SEA, MOUNTAIN, LIVE]) await page.locator(`[data-video-id="${id}"]`).click()
  await page.getByTestId('create-course').click()
  const before = await readPlans(page)
  await page.getByTestId('course-more').click()
  await page.getByTestId('edit-course').click()
  await page.getByTestId('edit-course-count').locator('input').fill('2')
  await expect(page.getByTestId('edit-today-preview')).toContainText('海边')
  await expect(page.getByTestId('edit-tomorrow-preview')).toContainText('山间')
  await expect(page.getByTestId('edit-tomorrow-preview')).toContainText('示例直播流')
  await narrowCheck(page)
  await page.evaluate(() => (window as any).uni.hideToast())
  await page.clock.runFor(500)
  await page.screenshot({ path: testInfo.outputPath('rate-preview-320.png'), fullPage: true })
  await page.getByTestId('course-edit').getByText('取消', { exact: true }).click()
  expect(await readPlans(page)).toEqual(before)
  await page.getByTestId('course-more').click()
  await page.getByTestId('edit-course').click()
  await page.getByTestId('edit-course-count').locator('input').fill('2')
  await page.getByTestId('save-course').click()
  expect((await readPlans(page)).courses[0].dailyEpisodeCount).toBe(2)
  await expect(page.getByTestId('course-card')).toContainText('已开放 1 / 3 集')
})

test('ended offers the next eligible lesson only on explicit click and never suggests locked content', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/rest/2.0/xpan/multimedia**', (route) => {
    const mountain = decodeURIComponent(route.request().url()).includes('700000000000000003')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ errno: 0, list: [mountain
      ? { fs_id: '700000000000000003', path: '/apps/片刻/旅行10/清晨/第10站·山间.mp4', dlink: 'https://d.pcs.baidu.com/file/mountain.mp4' }
      : { fs_id: '1001', path: '/apps/片刻/旅行2/第2站·海边.mp4', dlink: 'https://d.pcs.baidu.com/file/sea.mp4' }
    ] }) })
  })
  await page.route('https://d.pcs.baidu.com/**', async () => { await new Promise<void>(() => {}) })
  await page.goto('/?scenario=library#/pages/library/index', { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ sea, mountain, city, live }) => {
    const uni = (window as any).uni
    uni.setStorageSync('pianke:daily-unlock:v1', JSON.stringify({ enabled: true, courses: [{
      id: 'continuity-course', name: '继续学习测试', createdAt: Date.now(), dailyEpisodeCount: 4,
      episodes: [
        { videoId: sea, name: '第2站·海边.mp4', sourceType: 'baidu', path: '/apps/片刻/旅行2/第2站·海边.mp4' },
        { videoId: 'baidu:999', name: '已移除的来源', sourceType: 'baidu', path: '/apps/片刻/已移除.mp4' },
        { videoId: city, name: '城市漫步.mp4', sourceType: 'baidu', path: '/apps/片刻/城市漫步.mp4' },
        { videoId: mountain, name: '第10站·山间.mp4', sourceType: 'baidu', path: '/apps/片刻/旅行10/清晨/第10站·山间.mp4' },
        { videoId: live, name: '示例直播流', sourceType: 'direct' }
      ]
    }] }))
  }, { sea: SEA, mountain: MOUNTAIN, city: CITY, live: LIVE })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(async (city) => {
    const modulePath = '/src/stores/appStore.ts'
    const { useAppStore } = await import(/* @vite-ignore */ modulePath)
    const store = useAppStore()
    await store.initialize()
    store.reloadDailyUnlockSettings()
    store.markVideoLearned(city, true)
  }, CITY)
  await page.getByLabel('播放视频：第2站·海边.mp4', { exact: true }).click()
  const video = page.locator('video[data-testid="player-video"]')
  await expect(video).toBeVisible()
  await video.evaluate((element) => element.dispatchEvent(new Event('ended')))
  await expect(page.getByTestId('player-next-title')).toContainText('山间')
  expect(await video.getAttribute('src')).toContain('sea.mp4')
  await narrowCheck(page)
  await page.screenshot({ path: testInfo.outputPath('next-lesson-320.png'), fullPage: true })
  await page.getByTestId('player-next-episode').click()
  await expect.poll(() => decodeURIComponent(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id') ?? '')).toBe(MOUNTAIN)
  await expect(video).toHaveAttribute('src', /mountain\.mp4/)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.player-header__title')).toContainText('山间')
  await expect(video).toHaveAttribute('src', /mountain\.mp4/)
  await page.screenshot({ path: 'artifacts/round7/next-lesson-reloaded-320.png', fullPage: true })
  await video.evaluate((element) => element.dispatchEvent(new Event('ended')))
  await expect(page.getByTestId('player-next-episode')).toHaveCount(0)
  await expect(page.getByTestId('player-return-learning')).toBeVisible()
  expect(errors).toEqual([])
})
