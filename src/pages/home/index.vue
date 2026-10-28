<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { Play, Search } from '@/components/icons'

import BottomNav from '@/components/BottomNav.vue'
import LearningRecoveryNotice from '@/components/LearningRecoveryNotice.vue'
import FirstLearningGuide from '@/components/FirstLearningGuide.vue'
import VideoRow from '@/components/VideoRow.vue'
import VideoThumbnail from '@/components/VideoThumbnail.vue'
import type { VideoItem } from '@/domain/video'
import type { ContinueWatchingItem } from '@/stores/appStore'
import { useAppStore } from '@/stores/appStore'
import LearningLessonCard from '@/components/LearningLessonCard.vue'
import { buildLearningPlan, type LearningLesson } from '@/features/daily-unlock/learningPlan'
import { useDailyUnlockClock } from '@/features/daily-unlock/dailyUnlockClock'

const store = useAppStore()
useDailyUnlockClock((now) => store.refreshDailyUnlockClock(now))
const expandedCourses = ref<Set<string>>(new Set())
const guideVisible = ref(true)
const backlogLimits = ref<Record<string, number>>({})
function backlogLimit(id: string): number { return backlogLimits.value[id] ?? 20 }
function showMoreBacklog(id: string): void { backlogLimits.value = { ...backlogLimits.value, [id]: backlogLimit(id) + 20 } }
const undoLesson = ref<{ id: string; name: string }>()
let undoTimer: ReturnType<typeof setTimeout> | undefined
function dismissUndo(): void {
  if (undoTimer !== undefined) clearTimeout(undoTimer)
  undoTimer = undefined
  undoLesson.value = undefined
}
onUnmounted(dismissUndo)
const tomorrowOpen = ref(false)
const plan = computed(() => buildLearningPlan(store.dailyUnlockSettings, store.dailyUnlockNow, store.mergedVideos, store.learningHistory))
const todayLessons = computed(() => plan.value.today)
const continuingBacklog = computed(() => {
  const updatedAt = new Map(store.progressHistory.map((progress) => [progress.videoId, progress.updatedAt]))
  return plan.value.backlog.filter((lesson) => lesson.positionSeconds > 0 && lesson.video)
    .sort((a, b) => (updatedAt.get(b.id) ?? 0) - (updatedAt.get(a.id) ?? 0))[0]
})
const remainingBacklog = computed(() => plan.value.backlog.filter((lesson) => lesson.id !== continuingBacklog.value?.id))
const backlogGroups = computed(() => {
  const groups = new Map<string, { id: string; name: string; lessons: LearningLesson[] }>()
  for (const lesson of remainingBacklog.value) {
    if (!groups.has(lesson.courseId)) groups.set(lesson.courseId, { id: lesson.courseId, name: lesson.courseName, lessons: [] })
    groups.get(lesson.courseId)!.lessons.push(lesson)
  }
  return [...groups.values()]
})
function toggleBacklogCourse(id: string): void {
  const next = new Set(expandedCourses.value)
  if (next.has(id)) {
    next.delete(id)
    backlogLimits.value = { ...backlogLimits.value, [id]: 20 }
  }
  else next.add(id)
  expandedCourses.value = next
}
const todayComplete = computed(() => todayLessons.value.length > 0 && todayLessons.value.every((lesson) => lesson.completed))
const todaySummary = computed(() => {
  const pending = todayLessons.value.filter((lesson) => !lesson.completed)
  const known = pending.filter((lesson) => lesson.remainingSeconds !== undefined)
  const minutes = Math.ceil(known.reduce((total, lesson) => total + (lesson.remainingSeconds ?? 0), 0) / 60)
  return `${todayLessons.value.filter((lesson) => lesson.completed).length} / ${todayLessons.value.length} 节已学完${minutes ? ` · ${known.length < pending.length ? '已知' : '剩余'}约 ${minutes} 分钟` : ''}${known.length < pending.length ? ' · 部分时长待获取' : ''}`
})
const learningIds = computed(() => new Set([...plan.value.today, ...plan.value.backlog].map((lesson) => lesson.id)))
const todayEmptyText = computed(() => !store.dailyUnlockSettings.enabled
  ? '在设置中开启每日课程，安排每天的学习内容'
  : store.dailyUnlockSettings.courses.length === 0
    ? '还没有学习计划，去设置中添加每日课程'
    : store.dailyUnlockSettings.courses.every((course) => course.pausedAt !== undefined)
      ? '学习计划已暂停，可在设置中恢复；已开放内容仍可补学'
      : '今天没有新课程，可前往视频库复习已学内容')
function markLearned(lesson: LearningLesson): void {
  const isBacklog = plan.value.backlog.some((item) => item.id === lesson.id)
  const saved = store.markVideoLearned(lesson.id, !lesson.completed)
  if (saved && isBacklog && !lesson.completed) {
    dismissUndo()
    undoLesson.value = { id: lesson.id, name: lesson.name }
    undoTimer = setTimeout(dismissUndo, 8000)
  }
  uni.showToast({ title: saved ? lesson.completed ? '已撤销学完' : '已标记学完' : '保存失败，请稍后重试', icon: 'none' })
}
function undoCompletion(): void {
  if (!undoLesson.value) return
  if (store.markVideoLearned(undoLesson.value.id, false)) dismissUndo()
  else uni.showToast({ title: '撤销失败，请稍后重试', icon: 'none' })
}

const resumeItems = computed<ContinueWatchingItem[]>(() => {
  const items = store.continueWatching
  return Array.isArray(items) ? items.filter((item) => !learningIds.value.has(item.video.id)).slice(0, 3) : []
})
const activeResumeIndex = ref(0)
const continueItem = computed<ContinueWatchingItem | undefined>(() =>
  resumeItems.value[activeResumeIndex.value] ?? resumeItems.value[0]
)
const recentVideos = computed<VideoItem[]>(() => {
  const items = store.recentVideos
  return Array.isArray(items) ? items.filter((video) => !learningIds.value.has(video.id) && !resumeItems.value.some((item) => item.video.id === video.id)).slice(0, 6) : []
})
const resumeTimestamp = computed(() =>
  formatTimestamp(continueItem.value?.progress.positionSeconds)
)
const resumeDuration = computed(() =>
  formatTimestamp(continueItem.value?.progress.durationSeconds)
)
const resumePercent = computed(() => progressPercent(continueItem.value))
const safeLastErrorText = computed(() => {
  switch (store.lastError?.code) {
    case 'authorization':
      return '百度网盘授权已过期，请重新连接'
    case 'sync-failed':
      return '百度网盘同步失败，请稍后重试'
    case 'initialization':
      return '本地视频资料暂时无法完整加载'
    default:
      return undefined
  }
})

function openSource(path: string): void {
  uni.navigateTo({ url: path })
}

function selectResume(index: number): void {
  if (index >= 0 && index < resumeItems.value.length) {
    activeResumeIndex.value = index
  }
}

function openPlayer(video: VideoItem): void {
  const id = typeof video?.id === 'string' ? video.id : ''
  if (!id) {
    return
  }

  uni.navigateTo({
    url: `/pages/player/index?id=${encodeURIComponent(id)}`
  })
}
function reviewLesson(video: VideoItem): void {
  if (video.id) uni.navigateTo({ url: `/pages/player/index?id=${encodeURIComponent(video.id)}&restart=1` })
}

function safeVideoName(video: VideoItem | undefined): string {
  const name = typeof video?.name === 'string' ? video.name.trim() : ''
  return name || '未命名视频'
}

function progressPercent(item: ContinueWatchingItem | undefined): number {
  const position = item?.progress.positionSeconds
  const duration = item?.progress.durationSeconds
  if (
    typeof position !== 'number' ||
    !Number.isFinite(position) ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0
  }

  return Math.min(100, Math.max(0, (position / duration) * 100))
}

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '00:00'
  }

  const seconds = Math.round(value)
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60

  return hours > 0
    ? `${hours}:${padTime(minutes)}:${padTime(remainder)}`
    : `${padTime(minutes)}:${padTime(remainder)}`
}

function padTime(value: number): string {
  return String(value).padStart(2, '0')
}
</script>

<template>
  <view class="page-shell home-page">
    <view class="home-header">
      <view class="home-header__brand">
        <image class="home-brand-mark" src="/static/brand/pianke-logo.png" mode="aspectFit" alt="片刻 Logo" />
        <text class="home-header__title" role="heading" aria-level="1">片刻</text>
      </view>
      <view class="home-header__actions">
        <button type="button" class="home-header__icon-button" aria-label="搜索视频" @click="openSource('/pages/library/index')">
          <Search :size="23" :stroke-width="1.9" aria-hidden="true" />
        </button>
      </view>
    </view>

    <view v-if="safeLastErrorText" class="home-error-band" role="status" aria-live="polite">{{ safeLastErrorText }}</view>
    <LearningRecoveryNotice />

    <view class="home-section home-today" :class="{ 'home-today--after-resume': !store.dailyUnlockSettings.enabled && continueItem }" data-home-section="today" role="region" aria-labelledby="today-learning-title">
      <view class="home-section-heading">
        <text id="today-learning-title" class="section-title" role="heading" aria-level="2">今日学习</text>
        <button class="home-learning-link" @click="openSource('/pages/settings/index')">学习设置</button>
      </view>
      <text v-if="todayLessons.length" class="home-today__summary">{{ todaySummary }}</text>
      <view v-if="continuingBacklog" class="home-learning-extra" data-testid="continue-learning">
        <text class="home-today__summary">接着上次的内容继续学习</text>
        <LearningLessonCard :lesson="continuingBacklog" @play="openPlayer" @review="reviewLesson" @complete="markLearned" @library="openSource('/pages/library/index')" />
      </view>
      <view v-if="todayComplete" class="home-learning-done" role="status">
        <text>今日学习已完成</text><text>今天的安排已经学完，随时可以回来复习。</text>
      </view>
      <view v-if="todayLessons.length" class="home-today__list">
        <LearningLessonCard v-for="lesson in todayLessons" :key="lesson.id" :lesson="lesson" @play="openPlayer" @review="reviewLesson" @complete="markLearned" @library="openSource('/pages/library/index')" />
      </view>
      <view v-else>
        <FirstLearningGuide :has-videos="store.mergedVideos.length > 0" :has-courses="store.dailyUnlockSettings.courses.length > 0" @visibility-change="guideVisible = $event" />
        <view v-if="!guideVisible" class="home-empty-band" role="status">
        <text>{{ todayEmptyText }}</text>
        <button class="home-learning-action" @click="openSource('/pages/settings/index')">设置学习计划</button>
        </view>
      </view>
      <view v-if="undoLesson" class="home-learning-undo" role="status" data-testid="learning-undo">
        <text>已标记「{{ undoLesson.name }}」学完</text>
        <button class="home-learning-link" @click="undoCompletion">撤销</button>
      </view>
      <view v-if="remainingBacklog.length" class="home-learning-extra">
        <text class="home-backlog-title">待补学 · 还有 {{ remainingBacklog.length }} 节未完成</text>
        <text class="home-today__summary">按自己的节奏补学，不影响今天的课程</text>
        <view v-for="group in backlogGroups" :key="group.id" class="home-backlog-group">
          <button class="home-learning-disclosure" :data-backlog-course="group.id" :aria-expanded="expandedCourses.has(group.id)" @click="toggleBacklogCourse(group.id)">{{ group.name }} · 待补学 {{ group.lessons.length }} 节 <text>{{ expandedCourses.has(group.id) ? '收起' : '展开' }}</text></button>
          <view v-if="expandedCourses.has(group.id)" data-testid="backlog-lessons">
            <LearningLessonCard v-for="lesson in group.lessons.slice(0, backlogLimit(group.id))" :key="lesson.id" :lesson="lesson" @play="openPlayer" @review="reviewLesson" @complete="markLearned" @library="openSource('/pages/library/index')" />
            <button v-if="group.lessons.length > backlogLimit(group.id)" class="home-learning-link" :data-backlog-more="group.id" @click="showMoreBacklog(group.id)">继续显示 · 还有 {{ group.lessons.length - backlogLimit(group.id) }} 节</button>
          </view>
        </view>
      </view>
      <view v-if="store.dailyUnlockSettings.enabled && store.dailyUnlockSettings.courses.length" class="home-learning-extra">
        <button class="home-learning-disclosure" :aria-expanded="tomorrowOpen" @click="tomorrowOpen = !tomorrowOpen">查看明日安排 <text>{{ tomorrowOpen ? '收起' : '展开' }}</text></button>
        <view v-if="tomorrowOpen" data-testid="tomorrow-lessons">
          <view v-for="lesson in plan.tomorrow" :key="lesson.id" class="home-tomorrow-row"><text>{{ lesson.courseName }} · 第 {{ lesson.episodeNumber }} 集</text><text>{{ lesson.name }}</text></view>
          <text v-if="!plan.tomorrow.length" class="home-today__summary">明天暂无新课程安排，可复习或继续补学。</text>
        </view>
      </view>
    </view>

    <view v-if="continueItem" class="home-section home-resume-section" data-home-section="continue" role="region" aria-label="接着看">
      <button class="home-resume home-resume--hero" :aria-label="`继续播放：${safeVideoName(continueItem.video)}`" @click="openPlayer(continueItem.video)">
        <view class="home-resume__thumbnail">
          <VideoThumbnail :src="continueItem.video.thumbnailUrl" :name="safeVideoName(continueItem.video)" />
        </view>
        <view class="home-resume__content">
          <text class="home-resume__name">{{ safeVideoName(continueItem.video) }}</text>
          <text class="home-resume__eyebrow">接着看</text>
          <view class="home-resume__controls">
            <view class="home-resume__play" aria-hidden="true"><Play :size="19" fill="currentColor" /></view>
            <view class="home-resume__progress" role="progressbar" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(resumePercent)">
              <view class="home-resume__progress-value" :style="{ width: `${resumePercent}%` }" />
            </view>
            <text class="home-resume__timestamp">{{ resumeTimestamp }} / {{ resumeDuration }}</text>
          </view>
        </view>
      </button>
      <view v-if="resumeItems.length > 1" class="home-resume__dots" aria-label="继续播放列表">
        <button v-for="(item, index) in resumeItems" :key="item.video.id" type="button" class="home-resume__dot" :class="{ 'home-resume__dot--active': activeResumeIndex === index }" :aria-label="`播放${safeVideoName(item.video)}`" :aria-current="activeResumeIndex === index ? 'true' : undefined" @click="selectResume(index)" />
      </view>
    </view>

    <view v-if="recentVideos.length" class="home-section home-recent" data-home-section="recent" role="region" aria-labelledby="recent-videos-title">
      <view class="home-section-heading">
        <text id="recent-videos-title" class="section-title" role="heading" aria-level="2">最近看过</text>
        <button type="button" class="home-section-heading__more" aria-label="查看全部最近视频" @click="openSource('/pages/library/index')">›</button>
      </view>
      <view v-if="recentVideos.length" class="home-recent__list">
        <VideoRow v-for="video in recentVideos" :key="video.id" :video="video" display="history" @select="openPlayer" />
      </view>
    </view>
  </view>
  <BottomNav active="home" />
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.home-page {
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  padding-top: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 16rpx);
}

.home-header,
.home-header__brand,
.home-header__actions {
  display: flex;
  align-items: center;
}

.home-header {
  justify-content: space-between;
  padding: 6rpx 0 12rpx;
}

.home-header__brand { min-width: 0; }

.home-brand-mark {
  width: 52rpx;
  height: 52rpx;
  flex: 0 0 auto;
  margin-right: 10rpx;
  border-radius: 50%;
}

.home-header__title {
  color: $color-text;
  font-size: 42rpx;
  font-weight: 680;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.home-header__icon-button { min-width: 44px; min-height: 44px;
  position: relative;
  display: flex;
  width: 60rpx;
  height: 60rpx;
  align-items: center;
  justify-content: center;
  margin: 0 0 0 12rpx;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: $color-text;
  background: transparent;
}

.home-error-band {
  margin-top: 10rpx;
  padding: 18rpx 20rpx;
  border: 1px solid rgba($color-progress, 0.25);
  border-left: 5rpx solid $color-progress;
  border-radius: 9px;
  color: $color-text;
  font-size: 22rpx;
  line-height: 1.5;
  background: rgba($color-progress, 0.08);
}

.home-section { min-width: 0; }
.home-header { order: 0; }
.home-error-band { order: 1; }
.home-today { order: 2; }
.home-resume-section { order: 3; }
.home-today--after-resume { order: 4; }
.home-recent { order: 5; }
.home-today__summary { display: block; color: $color-muted; font-size: 22rpx; line-height: 1.5; margin-bottom: 14rpx; }
.home-learning-link, .home-learning-action { display: flex; align-items: center; justify-content: center; text-align: center; min-height: 44px; min-width: 44px; margin: 0; padding: 12rpx 16rpx; border: 0; border-radius: 8px; background: $color-primary-soft; color: $color-primary; font-size: 22rpx; line-height: 1.4; }
.home-learning-action { margin: 16rpx auto 0; width: fit-content; }
.home-learning-done { display: flex; flex-direction: column; padding: 20rpx; margin-bottom: 14rpx; border-radius: 12px; background: $color-primary-soft; color: $color-primary; font-size: 26rpx; font-weight: 650; }
.home-learning-done text + text { margin-top: 8rpx; font-size: 22rpx; font-weight: 400; }
.home-learning-undo { position: fixed; z-index: 30; left: 24rpx; right: 24rpx; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); display: flex; align-items: center; justify-content: space-between; padding: 18rpx; border: 1px solid $color-border; box-shadow: $shadow-panel; background: $color-primary-soft; color: $color-primary; border-radius: 10px; font-size: 22rpx; }
.home-learning-undo > text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 14rpx; }
.home-backlog-title { display: block; margin-bottom: 12rpx; color: $color-primary; font-size: 24rpx; }
.home-backlog-group + .home-backlog-group { border-top: 1px solid $color-border; }
.home-learning-extra { margin-top: 18rpx; }
.home-learning-disclosure { min-height: 44px; overflow-wrap: anywhere; width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 18rpx 0; margin: 0; background: transparent; color: $color-primary; border: 0; text-align: left; font-size: 24rpx; line-height: 1.5; }
.home-learning-disclosure > * { margin-left: 12rpx; }
.home-tomorrow-row > * + * { margin-top: 6rpx; }
.home-tomorrow-row { display: flex; flex-direction: column; padding: 16rpx; margin-bottom: 10rpx; border-radius: 8px; background: $color-primary-soft; color: $color-text; font-size: 22rpx; overflow-wrap: anywhere; }


.section-title {
  margin: 28rpx 0 14rpx;
  color: $color-text;
  font-size: 25rpx;
  font-weight: 650;
}

.home-resume {
  position: relative;
  display: block;
  box-sizing: border-box;
  height: 330rpx;
  width: calc(100% + 44rpx);
  margin-left: -22rpx;
  margin-top: 0;
  margin-bottom: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  color: #fff;
  text-align: left;
  background: $color-player;
  box-shadow: 0 8rpx 20rpx rgba(22, 47, 37, 0.12);
}

.home-resume__thumbnail {
  position: absolute;
  inset: 0;
  width: 100%;
  overflow: hidden;
}

.home-resume__thumbnail :deep(.video-thumbnail) {
  height: 100%;
  padding-bottom: 0;
  border-radius: 0;
}

.home-resume__thumbnail :deep(.video-thumbnail)::after {
  position: absolute;
  inset: 28% 0 0;
  background: linear-gradient(180deg, rgba(3, 18, 15, 0) 0%, rgba(3, 18, 15, 0.76) 100%);
  content: '';
}

.home-resume__content {
  position: absolute;
  right: 18rpx;
  bottom: 28rpx;
  left: 30rpx;
  display: flex;
  flex-direction: column;
}

.home-resume__eyebrow {
  color: rgba(255, 255, 255, 0.8);
  font-size: 18rpx;
  line-height: 1.2;
}

.home-resume__name {
  display: -webkit-box;
  margin-top: 4rpx;
  overflow: hidden;
  color: #fff;
  font-size: 42rpx;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.home-resume__controls { display: flex; align-items: center; margin-top: 9rpx; }

.home-resume__play {
  display: flex;
  width: 46rpx;
  height: 46rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: $color-primary;
  background: #fff;
}

.home-resume__progress {
  height: 5rpx;
  min-width: 0;
  flex: 1;
  margin: 0 12rpx;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
}

.home-resume__progress-value { height: 100%; border-radius: inherit; background: #fff; }

.home-resume__timestamp {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.92);
  font-size: 18rpx;
  line-height: 1.2;
}

.home-resume__dots { display: flex; justify-content: center; padding: 10rpx 0 0; }

.home-resume__dot {
  width: 13rpx;
  height: 13rpx;
  margin: 0 5rpx;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #c4c8bd;
}

.home-resume__dot--active { background: $color-primary; }

.home-section-heading { display: flex; align-items: center; justify-content: space-between; }
.home-section-heading .section-title { margin-top: 23rpx; margin-bottom: 10rpx; }

.home-section-heading__more {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  width: 44rpx;
  height: 48rpx;
  margin: 14rpx 0 8rpx;
  padding: 0;
  border: 0;
  color: $color-text;
  font-size: 36rpx;
  line-height: 1;
  background: transparent;
}

.home-resume:focus-visible,
.home-header__icon-button:focus-visible,
.home-section-heading__more:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 2px;
}

.home-recent__list { padding: 0 0 4rpx; }
.home-recent__list :deep(.video-row + .video-row) { border-top: 0; }
.home-recent__list :deep(.video-row) { grid-template-columns: 170rpx minmax(0, 1fr); min-height: 118rpx; padding: 10rpx 0; }
.home-recent__list :deep(.video-row__thumbnail) { width: 170rpx; border-radius: 6px; }
.home-recent__list :deep(.video-row__content) { margin-left: 16rpx; }
.home-recent__list :deep(.video-row__name) { font-size: 28rpx; -webkit-line-clamp: 1; }
.home-recent__list :deep(.video-row__metadata) { margin-top: 4rpx; font-size: 22rpx; }

.home-empty-band {
  padding: 28rpx 20rpx;
  border: 1px dashed $color-border;
  border-radius: 11px;
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.5;
  text-align: center;
  background: rgba($color-surface, 0.54);
}

@media (max-width: 420px) {
  .home-resume__timestamp { font-size: 17rpx; }
}
</style>
