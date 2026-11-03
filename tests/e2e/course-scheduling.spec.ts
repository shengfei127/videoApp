import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const EVIDENCE = process.env.PIANKE_SCHEDULE_EVIDENCE_DIR ?? join(tmpdir(), 'pianke-course-scheduling')
const SEA = 'baidu:1001'
const MOUNTAIN = 'baidu:700000000000000003'
const LIVE = 'direct:00000000-0000-4000-8000-000000000001'
const START_TIME = '2026-11-03T12:00:00+08:00'

test.use({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })

async function readPlans(page: Page) {
  return page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:daily-unlock:v1')))
}

async function reloadSavedCourse(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  // Mock bootstrapping intentionally resets in-memory plans. Rehydrate through
  // the production repository API to verify that the saved course survives.
  await page.evaluate(async () => {
    const modulePath = '/src/stores/appStore.ts'
    const { useAppStore } = await import(/* @vite-ignore */ modulePath)
    const store = useAppStore()
    await store.initialize()
    if (!store.reloadDailyUnlockSettings()) throw new Error('Saved course could not be reloaded')
  })
}

async function openManager(page: Page) {
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
}

async function returnHome(page: Page) {
  await page.getByLabel('返回设置', { exact: true }).click()
  await page.locator('.bottom-nav').getByLabel('首页').click()
}

async function prepareCourse(page: Page, name: string) {
  await page.clock.install({ time: new Date(START_TIME) })
  await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-home-section="today"]')).toBeVisible()
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByRole('switch', { name: '每日解锁课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
  await page.getByTestId('mode-videos').click()
  await page.getByTestId('course-name').locator('input').fill(name)
  for (const id of [SEA, MOUNTAIN, LIVE]) await page.locator(`[data-video-id="${id}"]`).click()
}

/** Exercise the visible uni date wheel and its confirm button, without changing component state. */
async function advanceDatePicker(page: Page, testId: string, days: number, expected: string) {
  const picker = page.getByTestId(testId)
  await picker.click()
  const popup = page.locator('.uni-picker-custom.uni-picker-toggle')
  await expect(popup).toBeVisible()
  const dayColumn = popup.locator('uni-picker-view-column').nth(2)
  await expect(dayColumn).toBeVisible()
  const selectedDay = () => dayColumn.evaluate((column) => {
    const indicator = column.querySelector('.uni-picker-view-indicator')!.getBoundingClientRect()
    const center = (indicator.top + indicator.bottom) / 2
    const options = Array.from(column.querySelectorAll('.uni-picker-item'))
    return options.sort((a, b) => {
      const aBounds = a.getBoundingClientRect()
      const bBounds = b.getBoundingClientRect()
      return Math.abs((aBounds.top + aBounds.bottom) / 2 - center) - Math.abs((bBounds.top + bBounds.bottom) / 2 - center)
    })[0]?.textContent
  })
  await expect.poll(selectedDay).toBe(`${String(Number(expected.slice(-2)) - days).padStart(2, '0')}日`)
  const bounds = await dayColumn.boundingBox()
  const row = await dayColumn.locator('.uni-picker-view-indicator').boundingBox()
  expect(bounds).not.toBeNull()
  expect(row).not.toBeNull()
  await dayColumn.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 + days * row!.height } })
  await expect.poll(selectedDay).toBe(`${expected.slice(-2)}日`)
  await popup.locator('.uni-picker-action-confirm').click()
  await expect(picker).toContainText(expected)
  await expect(popup).toHaveCount(0)
  await page.clock.runFor(400)
  await expect(page.locator('.uni-picker-container:visible')).toHaveCount(0)
}

async function advanceTo(page: Page, time: string) {
  const duration = Date.parse(time) - await page.evaluate(() => Date.now())
  expect(duration).toBeGreaterThan(0)
  await page.clock.fastForward(duration)
}

async function capture(page: Page, file: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE, file), fullPage: true })
}

for (const width of [320, 390]) {
  test(`future course date survives editing and reload, then opens its first lesson at midnight (${width}px)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await prepareCourse(page, '周五开始的课程')
    await advanceDatePicker(page, 'course-start-date', 2, '2026-11-05')
    await expect(page.getByTestId('schedule-preview')).toContainText('后天：第2站·海边.mp4')
    await capture(page, `${testInfo.project.name}-${width}-start-date-preview.png`)
    await page.getByTestId('create-course').click()
    const card = page.getByTestId('course-card')
    await expect(card).toContainText('未开始')
    await expect(card).toContainText('已开放 0 / 3 集')
    await card.getByTestId('course-more').click()
    await card.getByTestId('edit-course').click()
    await advanceDatePicker(page, 'edit-course-start-date', 1, '2026-11-06')
    await card.getByTestId('save-course').click()
    expect((await readPlans(page)).courses[0].startAt).toBe(Date.parse('2026-11-06T00:00:00+08:00'))
    await reloadSavedCourse(page)
    await expect(card).toContainText('2026-11-06')
    await expect(card).toContainText('已开放 0 / 3 集')
    await page.locator('[data-course-filter="scheduled"]').click()
    await expect(card).toHaveCount(1)
    await returnHome(page)
    const today = page.locator('[data-home-section="today"]')
    await expect(today).toContainText('2026-11-06')
    await expect(today.locator('[data-lesson-id]')).toHaveCount(0)
    await expect(page.locator('[data-backlog-course]')).toHaveCount(0)
    await capture(page, `${testInfo.project.name}-${width}-home-before-start.png`)
    await advanceTo(page, '2026-11-05T23:59:58+08:00')
    await expect(today.locator('[data-lesson-id]')).toHaveCount(0)
    await page.locator('.home-learning-disclosure').filter({ hasText: '查看明日安排' }).click()
    await expect(page.getByTestId('tomorrow-lessons')).toContainText('第2站·海边.mp4')
    await page.clock.fastForward(3_000)
    await expect(today.locator(`[data-lesson-id="${SEA}"]`)).toContainText('开始学习')
    await expect(today).toContainText('周五开始的课程 · 第 1 集')
    await expect(page.locator('[data-backlog-course]')).toHaveCount(0)
    await capture(page, `${testInfo.project.name}-${width}-first-lesson-at-midnight.png`)
    expect(errors).toEqual([])
  })
}

test('a course paused before its start date opens only its first lesson when resumed after that date', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await prepareCourse(page, '暂停后再开始')
  await advanceDatePicker(page, 'course-start-date', 2, '2026-11-05')
  await page.getByTestId('create-course').click()
  const card = page.getByTestId('course-card')
  await card.getByTestId('pause-course').click()
  await expect(card).toContainText('计划已暂停')
  await reloadSavedCourse(page)
  await expect(card).toContainText('已暂停')
  await advanceTo(page, '2026-11-10T12:00:00+08:00')
  await expect(card).toContainText('已开放 0 / 3 集')
  await returnHome(page)
  await expect(page.locator('[data-home-section="today"]')).toContainText('已暂停')
  await expect(page.locator('[data-home-section="today"] [data-lesson-id]')).toHaveCount(0)
  await expect(page.locator('[data-backlog-course]')).toHaveCount(0)
  await openManager(page)
  await card.getByTestId('pause-course').click()
  const preview = page.getByTestId('resume-preview')
  await expect(preview).toContainText('今天可学未完成：1 集')
  await expect(preview).toContainText('明天新开放：1 集')
  await capture(page, `${testInfo.project.name}-320-before-start-resume.png`)
  await page.getByTestId('resume-confirm').click()
  await expect(card).toContainText('已开放 1 / 3 集')
  expect((await readPlans(page)).courses[0].startAt).toBe(Date.parse('2026-11-10T00:00:00+08:00'))
  await returnHome(page)
  await expect(page.locator(`[data-home-section="today"] [data-lesson-id="${SEA}"]`)).toBeVisible()
  await expect(page.locator('[data-backlog-course]')).toHaveCount(0)
  await advanceTo(page, '2026-11-11T00:00:01+08:00')
  await expect(page.locator(`[data-home-section="today"] [data-lesson-id="${MOUNTAIN}"]`)).toBeVisible()
  await expect(page.locator('[data-backlog-course]')).toContainText('待补学 1 节')
  await capture(page, `${testInfo.project.name}-320-resumed-next-day.png`)
  expect(errors).toEqual([])
})

test('pausing an active course preserves completed lessons and resumes without opening skipped days', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 800 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await prepareCourse(page, '保持原有进度')
  await page.getByTestId('create-course').click()
  await returnHome(page)
  const first = page.locator(`[data-lesson-id="${SEA}"]`)
  await first.getByTestId('lesson-more').click()
  await first.getByLabel('标记学完：第2站·海边.mp4', { exact: true }).click()
  await expect(page.locator('[data-home-section="today"]')).toContainText('今日学习已完成')
  const learnedBeforePause = await page.evaluate(() => (window as any).uni.getStorageSync('pianke:learning-status:v1'))
  await openManager(page)
  const card = page.getByTestId('course-card')
  await card.getByTestId('pause-course').click()
  await advanceTo(page, '2026-11-08T12:00:00+08:00')
  await expect(card).toContainText('已开放 1 / 3 集')
  await expect(card).toContainText('已学完 1 / 3 集')
  await card.getByTestId('pause-course').click()
  await expect(page.getByTestId('resume-preview')).toContainText('今天可学未完成：0 集')
  await expect(page.getByTestId('resume-preview')).toContainText('明天新开放：1 集')
  await page.getByTestId('resume-confirm').click()
  await expect(card).toContainText('已开放 1 / 3 集')
  await expect(card).toContainText('已学完 1 / 3 集')
  expect(await page.evaluate(() => (window as any).uni.getStorageSync('pianke:learning-status:v1'))).toEqual(learnedBeforePause)
  await capture(page, `${testInfo.project.name}-390-active-resumed.png`)
  await returnHome(page)
  await expect(page.locator('[data-home-section="today"] [data-lesson-id]')).toHaveCount(0)
  await advanceTo(page, '2026-11-09T00:00:01+08:00')
  await expect(page.locator(`[data-home-section="today"] [data-lesson-id="${MOUNTAIN}"]`)).toBeVisible()
  await expect(page.locator('[data-backlog-course]')).toHaveCount(0)
  expect(errors).toEqual([])
})
