import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const SEA = 'baidu:1001'
const MOUNTAIN = 'baidu:700000000000000003'
const CITY = 'baidu:700000000000000001'
const LIVE = 'direct:00000000-0000-4000-8000-000000000001'

async function openManager(page: Page): Promise<void> {
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
}

async function createPlan(page: Page, start = 1): Promise<void> {
  await page.clock.install({ time: new Date(2026, 9, 28, 12) })
  await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByRole('switch', { name: '每日解锁课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
  await page.getByTestId('mode-videos').click()
  await page.getByTestId('course-name').locator('input').fill('旅行续学计划')
  for (const id of [SEA, MOUNTAIN, LIVE]) await page.locator(`[data-video-id="${id}"]`).click()
  await page.getByTestId('start-episode-number').locator('input').fill(String(start))
  await expect(page.getByTestId('schedule-preview')).toContainText(start === 2 ? '第10站·山间.mp4' : '第2站·海边.mp4')
  await page.getByTestId('create-course').click()
  await expect(page.getByTestId('course-card')).toHaveCount(1)
}

async function confirmModals(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as any).uni.showModal = (options: any) => options.success?.({ confirm: true, cancel: false })
  })
}

test('course tools start later, filter, relink records, and undo plan deletion', async ({ page }, testInfo) => {
  await createPlan(page, 2)
  await page.getByLabel('返回设置', { exact: true }).click()
  await page.locator('.bottom-nav').getByLabel('首页').click()
  await expect(page.locator('[data-home-section="today"]')).toContainText('旅行续学计划 · 第 2 集')
  await expect(page.locator(`[data-lesson-id="${SEA}"]`)).toHaveCount(0)
  await expect(page.locator('[data-backlog-course]')).toHaveCount(0)
  await page.locator(`[data-lesson-id="${MOUNTAIN}"]`).getByTestId('lesson-more').click()
  await page.getByLabel('标记学完：第10站·山间.mp4', { exact: true }).click()
  // Supply an actual-watch fixture independently of the learning marker.
  await page.evaluate(({ id }) => (window as any).uni.setStorageSync('pianke:progress:v1', JSON.stringify([
    { videoId: id, positionSeconds: 120, durationSeconds: 1382, updatedAt: Date.now() - 1000, completed: false }
  ])), { id: MOUNTAIN })
  await openManager(page)
  const card = page.getByTestId('course-card')
  await page.getByTestId('course-search').locator('input').fill('不存在')
  await expect(card).toHaveCount(0)
  await page.getByTestId('course-search').locator('input').fill('旅行')
  await expect(card).toHaveCount(1)
  await card.getByTestId('pause-course').click()
  await page.locator('[data-course-filter="learning"]').click()
  await expect(card).toHaveCount(0)
  await page.locator('[data-course-filter="paused"]').click()
  await expect(card).toHaveCount(1)
  await card.getByTestId('pause-course').click()
  await expect(page.getByTestId('resume-preview')).toBeVisible()
  await page.getByTestId('resume-confirm').click()
  await page.locator('[data-course-filter="all"]').click()
  await card.getByTestId('course-episodes-toggle').click()
  await card.locator(`[data-relink-episode="${MOUNTAIN}"]`).click()
  await page.getByTestId('relink-search').locator('input').fill('城市')
  await page.locator(`[data-relink-video="${CITY}"]`).click()
  await expect(card).toContainText('城市漫步.mp4')
  const state = await page.evaluate(() => ({
    courses: JSON.parse((window as any).uni.getStorageSync('pianke:daily-unlock:v1')),
    history: JSON.parse((window as any).uni.getStorageSync('pianke:progress:v1')),
    learned: JSON.parse((window as any).uni.getStorageSync('pianke:learning-status:v1'))
  }))
  expect(state.courses.courses[0].startEpisodeNumber).toBe(2)
  expect(state.courses.courses[0].episodes[1].videoId).toBe(CITY)
  expect(state.history[0]).toMatchObject({ videoId: CITY, positionSeconds: 120, durationSeconds: 1382 })
  expect(state.learned[0]).toMatchObject({ videoId: CITY, completed: true })
  await confirmModals(page)
  await card.getByTestId('course-more').click()
  await card.getByTestId('delete-course').click()
  await expect(card).toHaveCount(0)
  await expect(page.getByTestId('delete-course-undo')).toBeVisible()
  await page.getByTestId('delete-course-undo').locator('uni-button, button').filter({ hasText: '撤销' }).click()
  await expect(card).toHaveCount(1)
  const restored = await page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:daily-unlock:v1')))
  expect(restored).toEqual(state.courses)
  await page.screenshot({ path: testInfo.outputPath('course-tools.png'), fullPage: true })
})

test('player remembers speed, clamps ten-second jumps, and returns to learning after ending', async ({ page }) => {
  await page.route('**/rest/2.0/xpan/multimedia**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ errno: 0, list: [{ fs_id: '1001', path: '/apps/片刻/旅行2/第2站·海边.mp4', dlink: 'https://d.pcs.baidu.com/file/learning-tools.mp4' }] }) })
  })
  await page.route('https://d.pcs.baidu.com/**', async () => { await new Promise<void>(() => {}) })
  await page.goto('/?scenario=library#/pages/library/index', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('播放视频：第2站·海边.mp4', { exact: true }).click()
  const video = page.locator('video[data-testid="player-video"]')
  await expect(video).toBeVisible()
  await video.evaluate((element) => {
    Object.defineProperty(element, 'duration', { configurable: true, value: 100 })
    element.dispatchEvent(new Event('loadedmetadata'))
  })
  await page.getByLabel('后退 10 秒', { exact: true }).click()
  expect(await video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(0)
  await video.evaluate((element) => { (element as HTMLVideoElement).currentTime = 95; element.dispatchEvent(new Event('timeupdate')) })
  await page.getByLabel('前进 10 秒', { exact: true }).click()
  expect(await video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(100)
  await page.getByTestId('player-rate-menu').click()
  await page.getByTestId('player-rate').filter({ hasText: /^1\.5x$/ }).click()
  expect(await page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:player-preferences:v1')).rate)).toBe(1.5)
  await video.evaluate((element) => element.dispatchEvent(new Event('ended')))
  await expect(page.getByTestId('player-return-learning')).toBeVisible()
  await page.getByTestId('player-return-learning').click()
  await expect(page.locator('[data-home-section="today"]')).toBeVisible()
  await expect(page.locator('.bottom-nav').getByLabel('首页')).toHaveAttribute('aria-current', 'page')
  await page.locator('.bottom-nav').getByLabel('视频库').click()
  await page.getByLabel('播放视频：第2站·海边.mp4', { exact: true }).click()
  await expect(page.getByTestId('player-rate-menu')).toHaveText('1.5x')
})

test('backup exports no credentials and restores a deleted plan without changing sources', async ({ page }) => {
  await createPlan(page)
  await page.getByLabel('返回设置', { exact: true }).click()
  await page.locator('.bottom-nav').getByLabel('首页').click()
  await page.locator(`[data-lesson-id="${SEA}"]`).getByTestId('lesson-more').click()
  await page.getByLabel('标记学完：第2站·海边.mp4', { exact: true }).click()
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '备份' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('backup-export').click()
  const download = await downloadPromise
  const backupPath = await download.path()
  expect(backupPath).toBeTruthy()
  const json = await readFile(backupPath!, 'utf8')
  expect(json).not.toContain('mock-placeholder-token')
  expect(json).not.toContain('accessToken')
  expect(json).not.toContain('https://test-streams')
  expect(json).toContain('旅行续学计划')
  const originalPlan = await page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:daily-unlock:v1')))
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
  await confirmModals(page)
  await page.getByTestId('course-more').click()
  await page.getByTestId('delete-course').click()
  await expect(page.getByTestId('course-card')).toHaveCount(0)
  await page.getByLabel('返回设置', { exact: true }).click()
  await page.locator('.settings-menu-row').filter({ hasText: '备份' }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByTestId('backup-file').click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: 'learning-backup.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await expect(page.getByTestId('backup-preview')).toContainText('1 门课程')
  await page.getByTestId('backup-restore').click()
  await expect(page.locator('.backup-panel')).toContainText('学习数据已恢复')
  const restoredPlan = await page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:daily-unlock:v1')))
  expect(restoredPlan).toEqual(originalPlan)
  await page.locator('.settings-menu-row').filter({ hasText: '百度网盘' }).click()
  await expect(page.getByTestId('settings-disconnect')).toBeVisible()
  await page.locator('.bottom-nav').getByLabel('首页').click()
  await expect(page.locator('[data-home-section="today"]')).toContainText('今日学习已完成')
  await page.locator('.bottom-nav').getByLabel('视频库').click()
  await expect(page.locator('.video-row').filter({ hasText: '示例直播流' })).toBeVisible()
})
