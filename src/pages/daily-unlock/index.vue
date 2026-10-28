<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, Folder, Search, Trash2 } from '@/components/icons'
import VideoThumbnail from '@/components/VideoThumbnail.vue'

import { getUnlockedEpisodeCount, getNextCourseUnlockAt, snapshotCourseEpisodes } from '@/features/daily-unlock/dailyUnlockPolicy'
import { useDailyUnlockClock } from '@/features/daily-unlock/dailyUnlockClock'
import type { DailyUnlockCourse, VideoFolder, VideoItem } from '@/domain/video'
import { useAppStore } from '@/stores/appStore'

interface FolderChoice {
  folder: VideoFolder
  depth: number
}

type SelectionMode = 'folder' | 'videos'

const store = useAppStore()
const selectionMode = ref<SelectionMode>('folder')
const selectedFolderPath = ref('')
const selectedVideoIds = ref<Set<string>>(new Set())
const videoQuery = ref('')
const courseName = ref('')
const formError = ref('')
const folderPickerOpen = ref(false)
const orderPreviewOpen = ref(false)

const folderChoices = computed(() => flattenFolders(store.folderTree))
const selectedFolder = computed(() => findFolder(store.folderTree, selectedFolderPath.value))
const availableVideos = computed(() => {
  const query = videoQuery.value.trim().toLocaleLowerCase('zh-CN')
  const videos = store.mergedVideos
  return query
    ? videos.filter((video) => video.name.toLocaleLowerCase('zh-CN').includes(query))
    : videos
})
const selectedVideos = computed(() => {
  if (selectionMode.value === 'folder') {
    return selectedFolder.value ? collectVideos(selectedFolder.value) : []
  }
  const selected = selectedVideoIds.value
  return store.mergedVideos.filter((video) => selected.has(video.id))
})
const episodeSnapshots = computed(() => snapshotCourseEpisodes(selectedVideos.value))
const episodeVideos = computed(() =>
  episodeSnapshots.value.map((episode) =>
    store.mergedVideos.find((video) => video.id === episode.videoId) ?? {
      id: episode.videoId,
      sourceId: episode.videoId,
      sourceType: episode.sourceType,
      name: episode.name,
      path: episode.path ?? ''
    } as VideoItem
  )
)
const conflictCourse = computed(() => {
  const selectedIds = new Set(episodeSnapshots.value.map((episode) => episode.videoId))
  return store.dailyUnlockSettings.courses.find((course) =>
    course.episodes.some((episode) => selectedIds.has(episode.videoId))
  )
})

useDailyUnlockClock((now) => store.refreshDailyUnlockClock(now))

function setSelectionMode(mode: SelectionMode): void {
  selectionMode.value = mode
  formError.value = ''
}

function chooseFolder(folder: VideoFolder): void {
  if (!courseName.value.trim() || courseName.value === selectedFolder.value?.name.slice(0, 80)) {
    courseName.value = folder.name.slice(0, 80)
  }
  selectedFolderPath.value = folder.path
  folderPickerOpen.value = false
  formError.value = ''
}

function toggleVideo(videoId: string): void {
  const next = new Set(selectedVideoIds.value)
  if (next.has(videoId)) next.delete(videoId)
  else next.add(videoId)
  selectedVideoIds.value = next
  formError.value = ''
}

function showFormError(message: string): void {
  formError.value = message
  uni.showToast({ title: message, icon: 'none' })
}

function createCourse(): void {
  formError.value = ''
  if (!courseName.value.trim()) {
    showFormError('请先填写课程名称')
    return
  }
  if (!episodeSnapshots.value.length) {
    showFormError('请选择一个含视频的文件夹或至少一集视频')
    return
  }
  if (conflictCourse.value) {
    showFormError(`所选视频已属于课程「${conflictCourse.value.name}」，请先移除原课程`)
    return
  }

  const result = store.createDailyUnlockCourse({
    name: courseName.value,
    episodes: episodeSnapshots.value,
    ...(selectionMode.value === 'folder' && selectedFolder.value
      ? { sourceFolderPath: selectedFolder.value.path }
      : {})
  })
  if (!result.ok) {
    showFormError(result.reason === 'conflict'
      ? '所选视频已加入其他课程'
      : result.reason === 'invalid'
        ? '课程信息不完整，请检查后重试'
        : '课程保存失败，请稍后重试')
    return
  }

  courseName.value = ''
  selectedFolderPath.value = ''
  selectedVideoIds.value = new Set()
  uni.showToast({ title: '课程已创建', icon: 'none' })
}

function requestDeleteCourse(courseId: string, name: string): void {
  let settled = false
  uni.showModal({
    title: '删除每日课程',
    content: `删除「${name}」后，其中视频将恢复为可播放状态。`,
    confirmText: '删除课程',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) return
      settled = true
      if (!confirm) return
      const deleted = store.deleteDailyUnlockCourse(courseId)
      uni.showToast({
        title: deleted ? '课程已删除' : '删除失败，请稍后重试',
        icon: 'none'
      })
    }
  })
}

function goBack(): void {
  if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    uni.redirectTo({ url: '/pages/settings/index' })
  }
}

function courseProgress(course: DailyUnlockCourse): string {
  return `已开放 ${getUnlockedEpisodeCount(course, store.dailyUnlockNow)} / ${course.episodes.length} 集`
}

function courseProgressPercent(course: DailyUnlockCourse): string {
  const total = course.episodes.length
  if (!total) return '0%'
  const unlocked = getUnlockedEpisodeCount(course, store.dailyUnlockNow)
  return `${Math.round((unlocked / total) * 100)}%`
}

function courseNextUnlock(course: DailyUnlockCourse): string {
  const next = getNextCourseUnlockAt(course, store.dailyUnlockNow)
  return next === undefined ? '课程已全部解锁' : `下一集 ${formatLocalMidnight(next)} 开放`
}

function formatLocalMidnight(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} 00:00`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function countFolderVideos(folder: VideoFolder): number {
  return folder.videos.length + folder.folders.reduce((total, child) => total + countFolderVideos(child), 0)
}

function flattenFolders(root: VideoFolder, depth = 0): FolderChoice[] {
  return [
    { folder: root, depth },
    ...root.folders.flatMap((child) => flattenFolders(child, depth + 1))
  ]
}

function collectVideos(folder: VideoFolder): VideoItem[] {
  return [
    ...folder.videos,
    ...folder.folders.flatMap((child) => collectVideos(child))
  ]
}

function findFolder(root: VideoFolder, path: string): VideoFolder | undefined {
  if (root.path === path) return root
  for (const child of root.folders) {
    const found = findFolder(child, path)
    if (found) return found
  }
  return undefined
}
</script>

<template>
  <view class="page-shell daily-unlock-page daily-unlock-page--premium">
    <header class="daily-header">
      <button type="button" class="daily-back" aria-label="返回设置" @click="goBack">
        <ArrowLeft :size="21" aria-hidden="true" />
      </button>
      <text class="daily-header__title" role="heading" aria-level="1">每日课程</text>
    </header>

    <view class="daily-unlock-notice" role="status">
      <view class="daily-unlock-notice__dot" aria-hidden="true" />
      <text>{{ store.dailyUnlockSettings.enabled ? '每日零点开放下一集' : '每日课程已关闭，开启后按自然日解锁' }}</text>

    </view>

    <main class="daily-content">
      <section class="daily-create" aria-label="创建每日课程">
        <label class="daily-field">
          <text class="daily-visually-hidden">课程名称</text>
          <input v-model="courseName" data-testid="course-name" maxlength="80" @input="formError = ''" placeholder="输入课程名称" />
        </label>

        <view class="daily-mode" role="group" aria-label="课程内容来源">
          <button type="button" data-testid="mode-folder" :aria-pressed="selectionMode === 'folder'" :class="{ 'daily-mode__button--active': selectionMode === 'folder' }" @click="setSelectionMode('folder')">按文件夹</button>
          <button type="button" data-testid="mode-videos" :aria-pressed="selectionMode === 'videos'" :class="{ 'daily-mode__button--active': selectionMode === 'videos' }" @click="setSelectionMode('videos')">手选视频</button>
        </view>

        <template v-if="selectionMode === 'folder'">
          <button v-if="selectedFolder" type="button" class="daily-folder-current" :aria-expanded="folderPickerOpen" @click="folderPickerOpen = !folderPickerOpen">{{ selectedFolder.name }} · {{ episodeSnapshots.length }} 集 <text>更换文件夹</text></button>
          <view v-if="folderChoices.length" v-show="!selectedFolder || folderPickerOpen" class="daily-folder-list" aria-label="选择文件夹">
            <button
              v-for="choice in folderChoices"
              :key="choice.folder.path"
              type="button"
              data-testid="folder-choice"
              :data-folder-path="choice.folder.path"
              :aria-pressed="choice.folder.path === selectedFolderPath"
              class="daily-folder-choice"
              :class="{ 'daily-folder-choice--active': choice.folder.path === selectedFolderPath }"
              :style="{ paddingLeft: `${18 + choice.depth * 18}rpx` }"
              @click="chooseFolder(choice.folder)"
            >
              <Folder :size="18" aria-hidden="true" />
              <text class="daily-folder-choice__name">{{ choice.folder.name }}</text>
              <text class="daily-folder-choice__count">{{ countFolderVideos(choice.folder) }} 集</text>
            </button>
          </view>
          <view v-else class="daily-empty">同步视频目录后可按文件夹创建课程</view>
          <view v-if="episodeVideos.length" class="daily-episode-preview" data-testid="episode-preview">
            <view v-for="(video, index) in episodeVideos" :key="video.id" class="daily-episode-row">
              <view class="daily-video-choice__thumbnail">
                <VideoThumbnail :src="video.thumbnailUrl" :name="video.name" />
              </view>
              <text class="daily-episode-row__name">{{ index + 1 }}. {{ video.name }}</text>
              <view class="daily-check daily-check--selected" aria-label="已加入课程">✓</view>
            </view>
          </view>
        </template>

        <template v-else>
          <label v-if="store.mergedVideos.length > 8" class="daily-search">
            <Search :size="18" aria-hidden="true" />
            <input v-model="videoQuery" data-testid="video-search" placeholder="搜索全部视频" aria-label="搜索课程视频" />
          </label>
          <view v-if="availableVideos.length" class="daily-video-list">
            <button
              v-for="video in availableVideos"
              :key="video.id"
              type="button"
              data-testid="select-video"
              :data-video-id="video.id"
              :aria-pressed="selectedVideoIds.has(video.id)"
              class="daily-video-choice"
              :class="{ 'daily-video-choice--active': selectedVideoIds.has(video.id) }"
              @click="toggleVideo(video.id)"
            >
              <view class="daily-video-choice__thumbnail">
                <VideoThumbnail :src="video.thumbnailUrl" :name="video.name" />
              </view>
              <view class="daily-video-choice__copy"><text class="daily-video-choice__name">{{ video.name }}</text><text class="daily-video-choice__duration">{{ video.durationSeconds ? Math.floor(video.durationSeconds / 60) + ':' + String(Math.floor(video.durationSeconds % 60)).padStart(2, '0') : (video.sourceType === 'baidu' ? '百度网盘' : '媒体直链') }}</text></view>
              <view class="daily-check" aria-hidden="true">{{ selectedVideoIds.has(video.id) ? '✓' : '' }}</view>
            </button>
          </view>
          <view v-else class="daily-empty">{{ videoQuery ? '没有匹配的视频' : '视频库为空，先添加视频来源' }}</view>
        </template>

        <view v-if="selectionMode === 'videos' && episodeSnapshots.length" v-show="orderPreviewOpen" class="daily-selection-order" data-testid="episode-preview">
          <text v-for="(episode, index) in episodeSnapshots" :key="episode.videoId">{{ index + 1 }}. {{ episode.name }}</text>
        </view>
        <view class="daily-selection-summary">
          <button type="button" class="daily-selection-count" :aria-expanded="orderPreviewOpen" @click="orderPreviewOpen = !orderPreviewOpen">已选 {{ episodeSnapshots.length }} 集</button>
        </view>
        <view v-if="conflictCourse" class="daily-form-error" role="alert">
          所选视频已属于课程「{{ conflictCourse.name }}」，请先移除原课程
        </view>
        <view v-else-if="formError" class="daily-form-error" role="alert">{{ formError }}</view>
        <button type="button" data-testid="create-course" class="daily-create-button" @click="createCourse">创建课程</button>
      </section>

      <section v-if="store.dailyUnlockSettings.courses.length" class="daily-course-section" aria-labelledby="daily-courses-title">
        <view class="daily-section-heading">
          <text id="daily-courses-title" role="heading" aria-level="2">已建课程</text>
          <text class="daily-section-note">{{ store.dailyUnlockSettings.courses.length }} 门</text>
        </view>
        <view v-if="store.dailyUnlockSettings.courses.length" class="daily-course-list">
          <article v-for="course in store.dailyUnlockSettings.courses" :key="course.id" data-testid="course-card" class="daily-course-card" :data-course-id="course.id">
            <view class="daily-course-card__top">
              <view class="daily-course-card__copy">
                <text class="daily-course-card__name">{{ course.name }}</text>
                <text class="daily-course-card__progress">{{ courseProgress(course) }}</text>
                <text class="daily-course-card__next">{{ courseNextUnlock(course) }}</text>
                <view class="daily-course-progress" role="progressbar" :aria-valuenow="getUnlockedEpisodeCount(course, store.dailyUnlockNow)" :aria-valuemax="course.episodes.length" :aria-label="courseProgress(course)">
                  <view class="daily-course-progress__value" :style="{ width: courseProgressPercent(course) }" />
                </view>
              </view>
              <button type="button" data-testid="delete-course" class="daily-delete-button" :aria-label="`删除课程：${course.name}`" @click="requestDeleteCourse(course.id, course.name)">
                <Trash2 :size="19" aria-hidden="true" />
              </button>
            </view>
            <view class="daily-course-card__episodes">
              <text v-for="(episode, index) in course.episodes" :key="episode.videoId" :class="{ 'daily-course-episode--locked': store.dailyUnlockSettings.enabled && index >= getUnlockedEpisodeCount(course, store.dailyUnlockNow) }">
                {{ index + 1 }}. {{ episode.name }}
              </text>
            </view>
          </article>
        </view>
        <view v-else class="daily-empty daily-empty--courses">还没有课程。可选文件夹或手动勾选视频创建。</view>
      </section>
    </main>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.daily-unlock-page {
  padding-top: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 14rpx);
  padding-bottom: calc(40rpx + env(safe-area-inset-bottom));
  font-size: 26rpx;
  line-height: 1.5;
}

.daily-header {
  display: flex;
  align-items: center;
  min-height: 72rpx;
}

.daily-back,
.daily-delete-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin: 0;
  border: 1px solid $color-border;
  color: $color-text;
  background: $color-surface;
}

.daily-back { width: 40rpx; height: 64rpx; padding: 0; margin-right: 28rpx; border: 0; background: transparent; }

.daily-header__title {
  color: $color-text;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.2;
}

.daily-unlock-notice {
  display: flex;
  min-height: 52rpx;
  align-items: center;
  margin: 5rpx 0 14rpx;
  color: $color-text;
  font-size: 20rpx;
}

.daily-unlock-notice__dot {
  width: 14rpx;
  height: 14rpx;
  flex: 0 0 auto;
  margin-right: 9rpx;
  border-radius: 50%;
  background: $color-progress;
}

.daily-unlock-notice__count {
  margin-left: auto;
  color: $color-muted;
  font-size: 18rpx;
}

.daily-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.daily-header__subtitle,
.daily-section-note {
  margin-top: 4rpx;
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.4;
}

.daily-content {
  display: flex;
  flex-direction: column;
  margin-top: 0;
}

.daily-create,
.daily-course-section {
  box-sizing: border-box;
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.daily-course-section {
  margin-top: 16rpx;
  padding: 16rpx;
  border-radius: 14px;
}

.daily-create > * + *,
.daily-course-section > * + * { margin-top: 12rpx; }

.daily-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  min-width: 0;
  font-size: 27rpx;
  font-weight: 650;
}

.daily-section-note {
  flex: 0 0 auto;
  margin: 0 0 0 12rpx;
  font-weight: 400;
  text-align: right;
}

.daily-field {
  display: flex;
  flex-direction: column;
  color: $color-text;
  font-size: 22rpx;
  font-weight: 600;
}

.daily-field input {
  box-sizing: border-box;
  width: 100%;
  height: 70rpx;
  min-height: 70rpx;
  margin-top: 0;
  padding: 0 18rpx;
  border: 1px solid $color-border;
  border-radius: 11px;
  color: $color-text;
  font-size: 23rpx;
  font-weight: 400;
  background: $color-bg;
}

.daily-field input:focus,
.daily-search:focus-within {
  border-color: $color-primary;
  outline: 2px solid rgba($color-primary, 0.14);
}

.daily-mode {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.daily-mode button {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 0;
  min-height: 60rpx;
  flex: 1;
  margin: 0 3rpx;
  padding: 0 12rpx;
  border: 0;
  border-radius: 999px;
  color: $color-text;
  font-size: 26rpx;
  line-height: 1.25;
  background: #efede5;
}

.daily-mode .daily-mode__button--active { color: #fff; font-weight: 650; background: $color-primary; box-shadow: none; }

.daily-folder-list,
.daily-video-list,
.daily-course-list {
  overflow: hidden;
  border: 1px solid $color-border;
  border-radius: 14px;
  background: rgba($color-surface, 0.74);
}

.daily-folder-list,
.daily-video-list {
  max-height: 360rpx;
  overflow-y: auto;
}

.daily-folder-choice,
.daily-video-choice {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 78rpx;
  margin: 0;
  padding: 12rpx 16rpx;
  border: 0;
  border-radius: 0;
  color: $color-text;
  font-size: 22rpx;
  line-height: 1.4;
  text-align: left;
  background: transparent;
}

.daily-folder-choice + .daily-folder-choice,
.daily-video-choice + .daily-video-choice {
  border-top: 1px solid $color-border;
}

.daily-folder-choice--active,
.daily-video-choice--active {
  color: $color-primary;
  background: $color-primary-soft;
}

.daily-folder-choice__name,
.daily-video-choice__name {
  display: -webkit-box;
  min-width: 0;
  flex: 1;
  margin: 0 12rpx;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.daily-video-choice__thumbnail {
  box-sizing: border-box;
  width: 120rpx;
  height: 72rpx;
  flex: 0 0 120rpx;
  overflow: hidden;
  margin-right: 2rpx;
  border-radius: 8px;
  background: $color-player;
}

.daily-video-choice__thumbnail :deep(.video-thumbnail) {
  height: 100%;
  padding-bottom: 0;
  border-radius: inherit;
}

.daily-folder-choice__count,
.daily-video-choice__source {
  flex: 0 0 auto;
  margin-left: 8rpx;
  color: $color-muted;
  font-size: 19rpx;
}

.daily-search {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: 76rpx;
  padding: 0 16rpx;
  border: 1px solid $color-border;
  border-radius: 14px;
  color: $color-muted;
  background: $color-bg;
}

.daily-search input {
  box-sizing: border-box;
  min-width: 0;
  height: 72rpx;
  flex: 1;
  margin-left: 12rpx;
  border: 0;
  outline: 0;
  color: $color-text;
  font-size: 22rpx;
  background: transparent;
}

.daily-check {
  box-sizing: border-box;
  display: flex;
  width: 34rpx;
  height: 34rpx;
  flex: 0 0 34rpx;
  align-items: center;
  justify-content: center;
  margin-left: 10rpx;
  border: 1px solid $color-border;
  border-radius: 50%;
  color: transparent;
  font-size: 22rpx;
  font-weight: 800;
  background: $color-surface;
}

.daily-video-choice--active .daily-check,
.daily-check--selected {
  border-color: $color-primary;
  color: #fff;
  background: $color-primary;
}

.daily-selection-summary {
  display: flex;
  justify-content: space-between;
  min-width: 0;
  color: $color-muted;
  font-size: 20rpx;
}

.daily-selection-summary text + text {
  margin-left: 12rpx;
  text-align: right;
}

.daily-episode-preview {
  display: flex;
  max-height: 340rpx;
  flex-direction: column;
  overflow-y: auto;
  border: 1px solid $color-border;
  border-radius: 11px;
  background: rgba($color-surface, 0.78);
}

.daily-episode-row {
  box-sizing: border-box;
  display: flex;
  min-height: 82rpx;
  align-items: center;
  padding: 7rpx 10rpx;
}

.daily-episode-row + .daily-episode-row { border-top: 1px solid $color-border; }
.daily-episode-row__name { min-width: 0; flex: 1; margin: 0 12rpx; overflow: hidden; color: $color-text; font-size: 20rpx; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.daily-episode-row .daily-check { margin-left: 4rpx; }

.daily-form-error {
  color: #a43b2c;
  font-size: 21rpx;
  line-height: 1.45;
}

.daily-create-button {
  min-height: 76rpx;
  margin: 2rpx 0 0;
  padding: 0 22rpx;
  border: 1px solid $color-primary;
  border-radius: 999px;
  color: #fff;
  font-size: 24rpx;
  font-weight: 650;
  line-height: 1.3;
  background: $color-primary;
  box-shadow: 0 6rpx 16rpx rgba(8, 120, 88, 0.14);
}

.daily-course-card {
  padding: 14rpx;
}

.daily-course-card + .daily-course-card {
  border-top: 1px solid $color-border;
}

.daily-course-card__top {
  display: flex;
  justify-content: space-between;
}

.daily-course-card__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.daily-course-card__name {
  overflow-wrap: anywhere;
  color: $color-text;
  font-size: 24rpx;
  font-weight: 650;
}

.daily-course-card__progress {
  margin-top: 7rpx;
  color: $color-primary;
  font-size: 21rpx;
  font-weight: 650;
}

.daily-course-card__next {
  margin-top: 5rpx;
  color: $color-muted;
  font-size: 19rpx;
}

.daily-course-progress {
  height: 7rpx;
  margin-top: 14rpx;
  overflow: hidden;
  border-radius: 999px;
  background: $color-border;
}

.daily-course-progress__value {
  height: 100%;
  border-radius: inherit;
  background: $color-primary;
}

.daily-delete-button {
  width: 62rpx;
  height: 62rpx;
  margin-left: 12rpx;
  border-color: #e4b9b1;
  border-radius: 50%;
  color: #a43b2c;
  background: #fff6f4;
}

.daily-course-card__episodes {
  display: flex;
  flex-direction: column;
  margin-top: 14rpx;
  padding-top: 12rpx;
  border-top: 1px solid $color-border;
  color: $color-text;
  font-size: 20rpx;
}

.daily-episode-preview__item + .daily-episode-preview__item,
.daily-course-card__episodes > text + text {
  margin-top: 7rpx;
}

.daily-episode-preview__item,
.daily-course-card__episodes > text {
  overflow-wrap: anywhere;
}

.daily-course-episode--locked {
  color: $color-muted;
}

.daily-empty {
  padding: 20rpx 16rpx;
  border: 1px dashed $color-border;
  border-radius: 12px;
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.45;
  text-align: center;
  background: rgba($color-bg, 0.74);
}

.daily-empty--courses {
  padding-top: 24rpx;
  padding-bottom: 24rpx;
}

@media (max-width: 360px) {
  .daily-create,
  .daily-course-section {
    padding: 16rpx;
  }

  .daily-section-heading {
    align-items: flex-start;
  }

  .daily-section-note {
    max-width: 58%;
    line-height: 1.35;
  }
}
.daily-video-choice__copy { display: flex; flex: 1; min-width: 0; flex-direction: column; margin: 0 16rpx; }
.daily-video-choice__name { margin: 0; font-size: 24rpx; font-weight: 600; }
.daily-video-choice__duration { color: $color-muted; font-size: 21rpx; }
.daily-video-list, .daily-episode-preview { border: 0; border-radius: 0; max-height: 480rpx; background: transparent; }
.daily-video-choice { padding: 10rpx 0; background: transparent; }
.daily-video-choice + .daily-video-choice { border: 0; }
.daily-video-choice__thumbnail { width: 142rpx; height: 90rpx; flex-basis: 142rpx; border-radius: 6px; }
.daily-check { width: 32rpx; height: 32rpx; flex-basis: 32rpx; border-color: #98a39d; }
.daily-course-card__copy { flex: 1; }
.daily-create-button { display: flex; align-items: center; justify-content: center; font-size: 30rpx; min-height: 92rpx; }
.daily-course-section { padding: 18rpx 0; }
.daily-course-list { border: 0; background: transparent; }
.daily-course-card { padding: 12rpx 0; }
.daily-selection-order { display: flex; flex-direction: column; color: $color-muted; font-size: 20rpx; }
.daily-selection-count { margin: 0; padding: 0; border: 0; color: $color-muted; font-size: 20rpx; background: transparent; }
.daily-folder-current { display: flex; justify-content: space-between; margin: 0; padding: 8rpx 0; border: 0; color: $color-muted; background: transparent; font-size: 22rpx; }
.daily-folder-current text { color: $color-primary; }
</style>
