<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { onHide, onLoad, onUnload } from '@dcloudio/uni-app'
import { ArrowLeft, Folder, Search } from '@/components/icons'
import VideoThumbnail from '@/components/VideoThumbnail.vue'

import { getUnlockedEpisodeCount, getNextCourseUnlockAt, getTodayCourseEpisodes, rescheduleDailyUnlockCourse, snapshotCourseEpisodes } from '@/features/daily-unlock/dailyUnlockPolicy'
import { markLearningGuideCompleted, readLearningGuideStatus } from '@/features/onboarding/learningGuide'
import { uniStorage } from '@/infrastructure/storage'
import { readCourseDraft, saveCourseDraft, clearCourseDraft, createDraftSaveQueue } from '@/features/daily-unlock/courseDraft'
import { useDailyUnlockClock } from '@/features/daily-unlock/dailyUnlockClock'
import type { DailyUnlockCourse, DailyUnlockEpisode, VideoFolder, VideoItem } from '@/domain/video'
import { useAppStore } from '@/stores/appStore'

interface FolderChoice {
  folder: VideoFolder
  depth: number
}

type SelectionMode = 'folder' | 'videos'

const store = useAppStore()
const learningGuideRequested = ref(false)
onLoad((query) => { learningGuideRequested.value = query?.learningGuide === '1' })
const VIDEO_BATCH = 50
const COURSE_BATCH = 20
const videoLimit = ref(VIDEO_BATCH)
const folderLimit = ref(VIDEO_BATCH)
const courseLimit = ref(COURSE_BATCH)
const relinkLimit = ref(VIDEO_BATCH)
const previewLimit = ref(VIDEO_BATCH)
const orderScrollTarget = ref('')
const expandedCourseId = ref('')
const courseEpisodeLimit = ref(VIDEO_BATCH)
const videosById = computed(() => new Map(store.mergedVideos.map((video) => [video.id, video])))
function toggleCourseEpisodes(id: string): void {
  expandedCourseId.value = expandedCourseId.value === id ? '' : id
  courseEpisodeLimit.value = VIDEO_BATCH
}

const selectionMode = ref<SelectionMode>('folder')
const selectedFolderPath = ref('')
const selectedVideoIds = ref<Set<string>>(new Set())
const videoQuery = ref('')
const courseName = ref('')
const creationOpen = ref(false)
const showCreation = computed(() => creationOpen.value || store.dailyUnlockSettings.courses.length === 0)
const dailyEpisodeCount = ref<number | string>(1)
const startEpisodeNumber = ref<number | string>(1)
const draftStatus = ref('')
function loadDraft() {
  try { return readCourseDraft(uniStorage) }
  catch { draftStatus.value = '草稿读取失败，请重新进入后重试'; return undefined }
}
const pendingDraft = ref(loadDraft())
const restoredEpisodes = ref<DailyUnlockEpisode[]>([])
const restoredSelection = ref(false)
const manualOrder = ref<string[]>([])
let suppressDraftSave = false
const courseQuery = ref('')
type CourseFilter = 'all' | 'learning' | 'paused' | 'completed'
const courseFilter = ref<CourseFilter>('all')
const courseFilters: Array<{ key: CourseFilter; label: string }> = [{ key: 'all', label: '全部' }, { key: 'learning', label: '学习中' }, { key: 'paused', label: '已暂停' }, { key: 'completed', label: '已学完' }]
const filteredCourses = computed(() => store.dailyUnlockSettings.courses.filter((course) =>
  course.name.toLocaleLowerCase('zh-CN').includes(courseQuery.value.trim().toLocaleLowerCase('zh-CN')) &&
  (courseFilter.value === 'all' || courseStatus(course) === courseFilter.value)
))
const visibleCourses = computed(() => filteredCourses.value.slice(0, courseLimit.value))
watch([courseQuery, courseFilter], () => { courseLimit.value = COURSE_BATCH })
const relinkTarget = ref<{ courseId: string; videoId: string; name: string }>()
const relinkQuery = ref('')
const relinkError = ref('')
const relinkVideos = computed(() => store.mergedVideos.filter((video) => video.id !== relinkTarget.value?.videoId && video.name.toLocaleLowerCase('zh-CN').includes(relinkQuery.value.trim().toLocaleLowerCase('zh-CN'))))
const visibleRelinkVideos = computed(() => relinkVideos.value.slice(0, relinkLimit.value))
watch([relinkQuery, relinkTarget], () => { relinkLimit.value = VIDEO_BATCH })
const deletedCourse = ref<DailyUnlockCourse>()
const restoreError = ref('')
let deleteTimer: ReturnType<typeof setTimeout> | undefined
function clearDeletedCourse(): void {
  if (deleteTimer !== undefined) clearTimeout(deleteTimer)
  deleteTimer = undefined
  deletedCourse.value = undefined
  restoreError.value = ''
}
onUnmounted(clearDeletedCourse)
const editingCourseId = ref('')
const moreCourseId = ref('')
const batchCourseId = ref('')
const batchStart = ref(1)
const batchEnd = ref(1)
const batchError = ref('')
const batchUndo = ref<{ token: string; count: number }>()
const batchUndoError = ref('')
let batchTimer: ReturnType<typeof setTimeout> | undefined
function clearBatchUndo(): void {
  if (batchTimer !== undefined) clearTimeout(batchTimer)
  batchTimer = undefined
  batchUndo.value = undefined
  batchUndoError.value = ''
}
onUnmounted(clearBatchUndo)
function beginBatch(course: DailyUnlockCourse): void {
  batchCourseId.value = course.id
  batchStart.value = course.startEpisodeNumber ?? 1
  batchEnd.value = batchStart.value
  batchError.value = ''
  moreCourseId.value = ''
}
function submitBatch(): void {
  const result = store.batchMarkCourseLearned(batchCourseId.value, Number(batchStart.value), Number(batchEnd.value))
  if (!result.ok) {
    batchError.value = result.reason === 'invalid' ? '请输入有效的起止集数，结束集数不能小于开始集数' : '保存失败，请稍后重试'
    return
  }
  clearDeletedCourse()
  clearBatchUndo()
  batchCourseId.value = ''
  batchUndo.value = { token: result.undoToken, count: result.count }
  batchTimer = setTimeout(clearBatchUndo, 8000)
}
function undoBatch(): void {
  if (!batchUndo.value) return
  if (!store.undoBatchLearned(batchUndo.value.token)) {
    batchUndoError.value = '撤销失败，记录可能已更新，请检查后重试'
    return
  }
  clearBatchUndo()
  uni.showToast({ title: '已撤销批量标记', icon: 'none' })
}
const resumeCourseId = ref('')
const resumeError = ref('')
const resumePreview = computed(() => {
  const course = store.dailyUnlockSettings.courses.find((item) => item.id === resumeCourseId.value)
  if (!course || course.pausedAt === undefined) return undefined
  const now = store.dailyUnlockNow
  const resumed = rescheduleDailyUnlockCourse(course, { paused: false }, now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  return {
    today: course.episodes.slice((course.startEpisodeNumber ?? 1) - 1, getUnlockedEpisodeCount(course, now)).filter((episode) => !completedIds.value.has(episode.videoId)),
    tomorrow: getTodayCourseEpisodes(resumed, tomorrow.getTime())
  }
})
function previewNames(episodes: Array<{ name: string }>): string {
  return episodes.length ? episodes.slice(0, 3).map((episode) => episode.name).join('、') + (episodes.length > 3 ? ` 等 ${episodes.length} 集` : '') : '暂无内容'
}
function confirmResume(): void {
  if (!resumePreview.value) return
  if (!store.updateDailyUnlockCourse(resumeCourseId.value, { paused: false })) {
    resumeError.value = '保存失败，请稍后重试'
    return
  }
  resumeCourseId.value = ''
  uni.showToast({ title: '已恢复学习计划', icon: 'none' })
}
const editName = ref('')
const editDailyCount = ref(1)
const editError = ref('')
const editSchedulePreview = computed(() => {
  const course = store.dailyUnlockSettings.courses.find(item => item.id === editingCourseId.value)
  if (!course || !validRate(editDailyCount.value)) return undefined
  const now = store.dailyUnlockNow
  const next = rescheduleDailyUnlockCourse(course, { dailyEpisodeCount: Number(editDailyCount.value) }, now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  return { today: getTodayCourseEpisodes(next, now), tomorrow: getTodayCourseEpisodes(next, tomorrow.getTime()), paused: next.pausedAt !== undefined }
})
const formError = ref('')
const folderPickerOpen = ref(false)
const orderPreviewOpen = ref(false)

const folderChoices = computed(() => flattenFolders(store.folderTree))
const visibleFolderChoices = computed(() => folderChoices.value.slice(0, folderLimit.value))
const selectedFolder = computed(() => findFolder(store.folderTree, selectedFolderPath.value))
const availableVideos = computed(() => {
  const query = videoQuery.value.trim().toLocaleLowerCase('zh-CN')
  const videos = store.mergedVideos
  return query
    ? videos.filter((video) => video.name.toLocaleLowerCase('zh-CN').includes(query))
    : videos
})
const visibleAvailableVideos = computed(() => availableVideos.value.slice(0, videoLimit.value))
watch(videoQuery, () => { videoLimit.value = VIDEO_BATCH })
watch([selectedFolderPath, selectionMode], () => { previewLimit.value = VIDEO_BATCH })
const selectedVideos = computed(() => {
  if (selectionMode.value === 'folder') {
    if (restoredSelection.value) {
      const restoredIds = new Set(restoredEpisodes.value.map(episode => episode.videoId))
      return store.mergedVideos.filter(video => restoredIds.has(video.id))
    }
    return selectedFolder.value ? collectVideos(selectedFolder.value) : []
  }
  const selected = selectedVideoIds.value
  return store.mergedVideos.filter((video) => selected.has(video.id))
})
const episodeSnapshots = computed(() => {
  const snapshots = snapshotCourseEpisodes(selectedVideos.value)
  for (const episode of restoredEpisodes.value) {
    if ((selectionMode.value === 'folder' || selectedVideoIds.value.has(episode.videoId)) && !snapshots.some(item => item.videoId === episode.videoId)) snapshots.push(episode)
  }
  if (!manualOrder.value.length) return snapshots
  const rank = new Map(manualOrder.value.map((id, index) => [id, index]))
  return snapshots.sort((a, b) => (rank.get(a.videoId) ?? Infinity) - (rank.get(b.videoId) ?? Infinity))
})
const missingDraftEpisodes = computed(() => episodeSnapshots.value.filter(episode => !videosById.value.has(episode.videoId)))
function removeMissingDraftEpisodes(videoId?: string): void {
  const removed = new Set(missingDraftEpisodes.value.filter(episode => !videoId || episode.videoId === videoId).map(episode => episode.videoId))
  restoredEpisodes.value = restoredEpisodes.value.filter(episode => !removed.has(episode.videoId))
  selectedVideoIds.value = new Set([...selectedVideoIds.value].filter(id => !removed.has(id)))
  manualOrder.value = manualOrder.value.filter(id => !removed.has(id))
  formError.value = ''
}
function moveEpisode(index: number, direction: number): void {
  const ids = episodeSnapshots.value.map(episode => episode.videoId)
  const target = index + direction
  if (target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  manualOrder.value = ids
  if (target >= previewLimit.value) {
    previewLimit.value = Math.min(ids.length, previewLimit.value + VIDEO_BATCH)
    void nextTick(() => {
      orderScrollTarget.value = `course-order-${target + 1}`
      uni.pageScrollTo?.({ selector: selectionMode.value === 'folder' ? '#course-order-preview' : `#course-order-${target + 1}`, duration: 180 })
    })
  }
}
function persistDraft(): boolean {
  if (suppressDraftSave || pendingDraft.value) return true
  try {
    if (!courseName.value && !episodeSnapshots.value.length && !selectedFolderPath.value && Number(dailyEpisodeCount.value) === 1 && Number(startEpisodeNumber.value) === 1) {
      clearCourseDraft(uniStorage)
      draftStatus.value = ''
      return true
    }
    saveCourseDraft(uniStorage, { name: courseName.value, selectionMode: selectionMode.value, sourceFolderPath: selectedFolderPath.value, episodes: episodeSnapshots.value, dailyEpisodeCount: dailyEpisodeCount.value, startEpisodeNumber: startEpisodeNumber.value })
    draftStatus.value = '草稿已自动保存，可返回后继续'
    return true
  } catch { draftStatus.value = '草稿保存失败，请重试；退出后可能无法恢复'; return false }
}
const draftSaveQueue = createDraftSaveQueue(persistDraft)
watch([courseName, selectionMode, selectedFolderPath, episodeSnapshots, dailyEpisodeCount, startEpisodeNumber], () => {
  if (suppressDraftSave || pendingDraft.value) return
  draftStatus.value = '草稿待保存…'
  draftSaveQueue.schedule()
}, { flush: 'sync' })
onHide(draftSaveQueue.flush)
onUnload(draftSaveQueue.flush)
onUnmounted(() => { draftSaveQueue.flush(); draftSaveQueue.cancel() })
function restoreDraft(): void {
  const draft = pendingDraft.value
  if (!draft) return
  courseName.value = draft.name
  selectionMode.value = draft.selectionMode
  selectedFolderPath.value = draft.sourceFolderPath
  restoredEpisodes.value = draft.episodes
  restoredSelection.value = true
  selectedVideoIds.value = new Set(draft.episodes.map(episode => episode.videoId))
  manualOrder.value = draft.episodes.map(episode => episode.videoId)
  dailyEpisodeCount.value = draft.dailyEpisodeCount
  startEpisodeNumber.value = draft.startEpisodeNumber
  creationOpen.value = true
  orderPreviewOpen.value = true
  pendingDraft.value = undefined
}
function discardDraft(): void {
  draftSaveQueue.cancel()
  try {
    clearCourseDraft(uniStorage)
    pendingDraft.value = undefined
    draftStatus.value = '已丢弃草稿'
  } catch { draftStatus.value = '草稿删除失败，请重试' }
}
const schedulePreview = computed(() => [0, 1, 2].flatMap((day) => {
  const start = Number(startEpisodeNumber.value) - 1 + day * Number(dailyEpisodeCount.value)
  const episodes = episodeSnapshots.value.slice(start, start + Number(dailyEpisodeCount.value))
  return episodes.length ? [{ label: ['今天', '明天', '后天'][day], names: episodes.map((episode) => episode.name).join('、') }] : []
}))
const completedIds = computed(() => new Set(store.learningHistory.filter((item) => item.completed).map((item) => item.videoId)))
const episodeVideos = computed(() =>
  episodeSnapshots.value.slice(0, previewLimit.value).map((episode) =>
    videosById.value.get(episode.videoId) ?? {
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
  if (mode !== selectionMode.value) { restoredSelection.value = false; restoredEpisodes.value = []; manualOrder.value = [] }
  selectionMode.value = mode
  formError.value = ''
}

function chooseFolder(folder: VideoFolder): void {
  restoredSelection.value = false
  restoredEpisodes.value = []
  manualOrder.value = []
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
  if (missingDraftEpisodes.value.length) {
    showFormError('部分视频来源不可用，请先同步视频库或重新选择课程内容')
    return
  }
  if (!courseName.value.trim()) {
    showFormError('请先填写课程名称')
    return
  }
  if (!validRate(dailyEpisodeCount.value)) {
    showFormError('每天学习集数需为 1 到 10 的整数')
    return
  }
  if (!episodeSnapshots.value.length) {
    showFormError('请选择一个含视频的文件夹或至少一集视频')
    return
  }
  if (!Number.isInteger(Number(startEpisodeNumber.value)) || Number(startEpisodeNumber.value) < 1 || Number(startEpisodeNumber.value) > episodeSnapshots.value.length) {
    showFormError(`起始集数需为 1 到 ${episodeSnapshots.value.length} 的整数`)
    return
  }
  if (conflictCourse.value) {
    showFormError(`所选视频已属于课程「${conflictCourse.value.name}」，请先移除原课程`)
    return
  }

  const enableDailyUnlock = learningGuideRequested.value && store.dailyUnlockSettings.courses.length === 0 && readLearningGuideStatus(uniStorage) === 'active'
  const result = store.createDailyUnlockCourse({
    name: courseName.value,
    dailyEpisodeCount: Number(dailyEpisodeCount.value),
    startEpisodeNumber: Number(startEpisodeNumber.value),
    episodes: episodeSnapshots.value,
    ...(selectionMode.value === 'folder' && selectedFolderPath.value
      ? { sourceFolderPath: selectedFolderPath.value }
      : {})
  }, { enableDailyUnlock })
  if (!result.ok) {
    showFormError(result.reason === 'conflict'
      ? '所选视频已加入其他课程'
      : result.reason === 'invalid'
        ? '课程信息不完整，请检查后重试'
        : '课程保存失败，请稍后重试')
    return
  }

  markLearningGuideCompleted(uniStorage)
  suppressDraftSave = true
  draftSaveQueue.cancel()
  try { clearCourseDraft(uniStorage); draftStatus.value = '' }
  catch { draftStatus.value = '课程已创建，但草稿清除失败，请重试'; pendingDraft.value = loadDraft() }
  restoredEpisodes.value = []
  restoredSelection.value = false
  manualOrder.value = []
  courseName.value = ''
  dailyEpisodeCount.value = 1
  startEpisodeNumber.value = 1
  selectedFolderPath.value = ''
  selectedVideoIds.value = new Set()
  creationOpen.value = false
  courseQuery.value = ''
  courseFilter.value = 'all'
  videoQuery.value = ''
  orderPreviewOpen.value = false
  folderPickerOpen.value = false
  void nextTick(() => { suppressDraftSave = false })
  uni.showToast({ title: '课程已创建', icon: 'none' })
}

function validRate(value: unknown): boolean {
  const rate = Number(value)
  return Number.isInteger(rate) && rate >= 1 && rate <= 10
}

function startEditing(course: DailyUnlockCourse): void {
  moreCourseId.value = ''
  editingCourseId.value = course.id
  editName.value = course.name
  editDailyCount.value = course.dailyEpisodeCount ?? 1
  editError.value = ''
}

function saveEditing(): void {
  if (!editName.value.trim() || !validRate(editDailyCount.value)) {
    editError.value = '请填写课程名称，每天学习集数需为 1 到 10 的整数'
    return
  }
  if (!store.updateDailyUnlockCourse(editingCourseId.value, { name: editName.value, dailyEpisodeCount: Number(editDailyCount.value) })) {
    editError.value = '保存失败，请稍后重试'
    return
  }
  editingCourseId.value = ''
  uni.showToast({ title: '课程已更新', icon: 'none' })
}

function togglePause(course: DailyUnlockCourse): void {
  if (course.pausedAt !== undefined) {
    store.refreshDailyUnlockClock(Date.now())
    resumeCourseId.value = course.id
    resumeError.value = ''
    return
  }
  const saved = store.updateDailyUnlockCourse(course.id, { paused: true })
  uni.showToast({ title: saved ? '已暂停，已开放内容仍可学习' : '保存失败，请稍后重试', icon: 'none' })
}

function learnedCount(course: DailyUnlockCourse): number {
  return course.episodes.slice((course.startEpisodeNumber ?? 1) - 1).filter((episode) => completedIds.value.has(episode.videoId)).length
}

function plannedCount(course: DailyUnlockCourse): number {
  return course.episodes.length - (course.startEpisodeNumber ?? 1) + 1
}

function courseStatus(course: DailyUnlockCourse): Exclude<CourseFilter, 'all'> {
  if (plannedCount(course) > 0 && learnedCount(course) === plannedCount(course)) return 'completed'
  return course.pausedAt === undefined ? 'learning' : 'paused'
}

function beginRelink(course: DailyUnlockCourse, videoId: string, name: string): void {
  relinkTarget.value = { courseId: course.id, videoId, name }
  relinkQuery.value = ''
  relinkError.value = ''
}

function replaceEpisode(videoId: string): void {
  const target = relinkTarget.value
  if (!target) return
  if (!store.relinkDailyUnlockEpisode(target.courseId, target.videoId, videoId)) {
    relinkError.value = '关联失败，请选择未加入课程且没有学习或播放记录的视频，或稍后重试'
    return
  }
  relinkTarget.value = undefined
  uni.showToast({ title: '已重新关联，学习记录与安排已保留', icon: 'none' })
}

function undoDeleteCourse(): void {
  if (!deletedCourse.value) return
  if (!store.restoreDailyUnlockCourse(deletedCourse.value)) {
    restoreError.value = '恢复失败，视频可能已加入其他课程，请检查后重试'
    return
  }
  clearDeletedCourse()
  courseQuery.value = ''
  courseFilter.value = 'all'
  uni.showToast({ title: '课程已恢复', icon: 'none' })
}

function openLibrary(): void {
  uni.navigateTo({ url: '/pages/library/index' })
}

function requestDeleteCourse(courseId: string, name: string): void {
  let settled = false
  uni.showModal({
    title: '删除每日课程',
    content: `仅删除「${name}」的学习计划，不删除视频、播放历史或学习记录。删除后 8 秒内可以撤销。`,
    confirmText: '删除课程',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) return
      settled = true
      if (!confirm) return
      const course = store.dailyUnlockSettings.courses.find((item) => item.id === courseId)
      const snapshot = course ? { ...course, episodes: course.episodes.map((episode) => ({ ...episode })) } : undefined
      const deleted = store.deleteDailyUnlockCourse(courseId)
      if (deleted && snapshot) {
        clearBatchUndo()
        moreCourseId.value = ''
        clearDeletedCourse()
        deletedCourse.value = snapshot
        deleteTimer = setTimeout(clearDeletedCourse, 8000)
      }
      uni.showToast({
        title: deleted ? '课程已删除' : '删除失败，请稍后重试',
        icon: 'none'
      })
    }
  })
}

function goBack(): void {
  draftSaveQueue.flush()
  if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) {
    uni.navigateBack({ animationType: 'slide-out-bottom' })
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
  if (course.pausedAt !== undefined) return '计划已暂停，已开放内容仍可学习'
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
      <text>{{ store.dailyUnlockSettings.enabled ? '每天零点按计划开放新内容' : '每日课程已关闭，开启后按自然日解锁' }}</text>

    </view>

    <main class="daily-content">
      <section v-if="store.dailyUnlockSettings.courses.length" class="daily-course-section" aria-labelledby="daily-courses-title">
        <view class="daily-section-heading">
          <text id="daily-courses-title" role="heading" aria-level="2">已建课程</text>
          <text class="daily-section-note">{{ store.dailyUnlockSettings.courses.length }} 门</text>
        </view>
        <label class="daily-search"><Search :size="18" aria-hidden="true" /><input v-model="courseQuery" data-testid="course-search" placeholder="搜索课程名称" aria-label="搜索课程名称" /></label>
        <view class="daily-course-filters" role="group" aria-label="课程状态筛选">
          <button v-for="filter in courseFilters" :key="filter.key" class="daily-filter" :class="{ 'daily-filter--active': courseFilter === filter.key }" :data-course-filter="filter.key" :aria-pressed="courseFilter === filter.key" @click="courseFilter = filter.key">{{ filter.label }}</button>
        </view>
        <view v-if="visibleCourses.length" class="daily-course-list">
          <article v-for="course in visibleCourses" :key="course.id" data-testid="course-card" class="daily-course-card" :data-course-id="course.id">
            <view class="daily-course-card__top">
              <view class="daily-course-card__copy">
                <text class="daily-course-card__name">{{ course.name }}</text>
                <text class="daily-course-card__progress">{{ courseProgress(course) }}</text>
                <text class="daily-course-card__progress">已学完 {{ learnedCount(course) }} / {{ plannedCount(course) }} 集 · 每天 {{ course.dailyEpisodeCount ?? 1 }} 集</text>
                <text v-if="(course.startEpisodeNumber ?? 1) > 1" class="daily-plan-hint">从第 {{ course.startEpisodeNumber }} 集开始；此前内容可复习，不计入本计划</text>
                <text class="daily-course-card__next">{{ courseNextUnlock(course) }}</text>
                <view class="daily-course-progress" role="progressbar" :aria-valuenow="getUnlockedEpisodeCount(course, store.dailyUnlockNow)" :aria-valuemax="course.episodes.length" :aria-label="courseProgress(course)">
                  <view class="daily-course-progress__value" :style="{ width: courseProgressPercent(course) }" />
                </view>
              </view>
            </view>
            <view class="daily-course-actions">
              <button class="daily-text-action" data-testid="pause-course" @click="togglePause(course)">{{ course.pausedAt === undefined ? '暂停计划' : '恢复计划' }}</button>
              <button class="daily-text-action" data-testid="course-more" :aria-expanded="moreCourseId === course.id" @click="moreCourseId = moreCourseId === course.id ? '' : course.id">更多操作</button>
            </view>
            <view v-if="moreCourseId === course.id" class="daily-course-actions daily-more" role="group" aria-label="课程更多操作">
              <button class="daily-text-action" data-testid="edit-course" @click="startEditing(course)">编辑计划</button>
              <button class="daily-text-action" data-testid="batch-course" @click="beginBatch(course)">批量标为已学</button>
              <button class="daily-text-action daily-danger" data-testid="delete-course" @click="requestDeleteCourse(course.id, course.name)">删除课程</button>
            </view>
            <view v-if="batchCourseId === course.id" class="daily-edit" data-testid="batch-panel">
              <text>批量标为已学 · 共 {{ course.episodes.length }} 集</text>
              <text class="daily-plan-hint">用于补记已掌握的内容。可包含尚未开放的集数，仅修改学习状态，不改变开放安排或播放进度；保存后 8 秒内可撤销。</text>
              <label class="daily-field"><text>从第几集</text><input v-model="batchStart" type="number" data-testid="batch-start" aria-label="批量开始集数" /></label>
              <label class="daily-field"><text>到第几集（含）</text><input v-model="batchEnd" type="number" data-testid="batch-end" aria-label="批量结束集数" /></label>
              <text v-if="batchError" class="daily-form-error" role="alert">{{ batchError }}</text>
              <view class="daily-course-actions"><button class="daily-text-action" data-testid="batch-submit" @click="submitBatch">确认标为已学</button><button class="daily-text-action" data-testid="batch-cancel" @click="batchCourseId = ''">取消</button></view>
            </view>
            <view v-if="resumeCourseId === course.id && resumePreview" class="daily-edit" data-testid="resume-preview">
              <text>恢复后的学习安排</text>
              <text>今天可学未完成：{{ resumePreview.today.length }} 集</text>
              <text class="daily-plan-hint">{{ previewNames(resumePreview.today) }}</text>
              <text>明天新开放：{{ resumePreview.tomorrow.length }} 集</text>
              <text class="daily-plan-hint">{{ previewNames(resumePreview.tomorrow) }}</text>
              <text class="daily-plan-hint">暂停期间不会补放新内容，明天起按每天 {{ course.dailyEpisodeCount ?? 1 }} 集继续。</text>
              <text v-if="resumeError" class="daily-form-error" role="alert">{{ resumeError }}</text>
              <view class="daily-course-actions"><button class="daily-text-action" data-testid="resume-confirm" @click="confirmResume">确认恢复</button><button class="daily-text-action" data-testid="resume-cancel" @click="resumeCourseId = ''">暂不恢复</button></view>
            </view>
            <view v-if="editingCourseId === course.id" class="daily-edit" data-testid="course-edit">
              <label class="daily-field"><text>课程名称</text><input v-model="editName" maxlength="80" data-testid="edit-course-name" /></label>
              <label class="daily-field"><text>每天学习集数（1–10）</text><input v-model="editDailyCount" type="number" data-testid="edit-course-count" /></label>
              <text class="daily-plan-hint">调整集数从明天生效，已开放内容和今天的安排保留。恢复暂停的计划后，明天继续开放新内容。</text>
              <view v-if="editSchedulePreview" class="daily-schedule-preview" aria-live="polite">
                <text data-testid="edit-today-preview">今天保持：{{ previewNames(editSchedulePreview.today) }}</text>
                <text data-testid="edit-tomorrow-preview">明天安排：{{ editSchedulePreview.paused ? '计划已暂停，暂不开放新内容' : previewNames(editSchedulePreview.tomorrow) }}</text>
              </view>
              <text v-if="editError" class="daily-form-error" role="alert">{{ editError }}</text>
              <view class="daily-course-actions"><button class="daily-text-action" @click="editingCourseId = ''">取消</button><button class="daily-text-action" data-testid="save-course" @click="saveEditing">保存修改</button></view>
            </view>
            <button class="daily-text-action" data-testid="course-episodes-toggle" :aria-expanded="expandedCourseId === course.id" @click="toggleCourseEpisodes(course.id)">{{ expandedCourseId === course.id ? '收起集数' : '查看集数 / 重新关联' }} · {{ course.episodes.length }} 集</button>
            <view v-if="expandedCourseId === course.id" class="daily-course-card__episodes">
              <view v-for="(episode, index) in course.episodes.slice(0, courseEpisodeLimit)" :key="episode.videoId" class="daily-episode-link-row">
                <text :class="{ 'daily-course-episode--locked': store.dailyUnlockSettings.enabled && index >= getUnlockedEpisodeCount(course, store.dailyUnlockNow) }">{{ index + 1 }}. {{ episode.name }}</text>
                <button class="daily-text-action" :data-relink-episode="episode.videoId" :aria-label="`重新关联：${episode.name}`" @click="beginRelink(course, episode.videoId, episode.name)">重新关联</button>
              </view>
            </view>
            <button v-if="expandedCourseId === course.id && course.episodes.length > courseEpisodeLimit" class="daily-text-action" data-testid="course-episodes-more" @click="courseEpisodeLimit += VIDEO_BATCH">加载更多集数（已显示 {{ courseEpisodeLimit }} / {{ course.episodes.length }}）</button>
            <view v-if="relinkTarget?.courseId === course.id" class="daily-relink" data-testid="episode-relink">
              <text>为「{{ relinkTarget.name }}」选择替代视频</text>
              <text class="daily-plan-hint">保留集数、开放安排和学习记录。请先在视频库添加可用来源；不会删除原视频。</text>
              <label class="daily-search"><Search :size="18" aria-hidden="true" /><input v-model="relinkQuery" data-testid="relink-search" placeholder="搜索替代视频" aria-label="搜索替代视频" /></label>
              <view class="daily-relink-options">
                <button v-for="video in visibleRelinkVideos" :key="video.id" class="daily-relink-option" :data-relink-video="video.id" @click="replaceEpisode(video.id)">{{ video.name }} · {{ video.sourceType === 'baidu' ? '百度网盘' : '媒体直链' }}</button>
              </view>
              <button v-if="relinkVideos.length > relinkLimit" class="daily-text-action" data-testid="relink-more" @click="relinkLimit += VIDEO_BATCH">加载更多视频</button>
              <text v-if="!relinkVideos.length" class="daily-plan-hint">没有可选视频，请到视频库添加或同步来源。</text>
              <text v-if="relinkError" class="daily-form-error" role="alert">{{ relinkError }}</text>
              <view class="daily-course-actions"><button class="daily-text-action" @click="relinkTarget = undefined">取消</button><button class="daily-text-action" @click="openLibrary">前往视频库</button></view>
            </view>
          </article>
        </view>
        <view v-else class="daily-empty daily-empty--courses">没有匹配的课程，试试其他名称或状态。</view>
        <button v-if="filteredCourses.length > courseLimit" class="daily-text-action" data-testid="courses-more" @click="courseLimit += COURSE_BATCH">加载更多课程（已显示 {{ courseLimit }} / {{ filteredCourses.length }}）</button>
      </section>

      <button v-if="store.dailyUnlockSettings.courses.length && !showCreation" type="button" class="daily-new-plan" data-testid="new-course" :aria-expanded="showCreation" aria-controls="daily-create-form" @click="creationOpen = true">新建计划</button>
      <view v-if="pendingDraft" class="daily-edit" data-testid="draft-recovery">
        <text>有未完成的课程草稿：{{ pendingDraft.name || '未命名课程' }} · {{ pendingDraft.episodes.length }} 集</text>
        <view class="daily-course-actions"><button class="daily-text-action" data-testid="restore-draft" @click="restoreDraft">恢复草稿</button><button class="daily-text-action" data-testid="discard-draft" @click="discardDraft">丢弃草稿</button></view>
      </view>
      <view v-if="draftStatus" class="daily-plan-hint" role="status" data-testid="draft-status">{{ draftStatus }}<button v-if="draftStatus.includes('保存失败')" class="daily-text-action" data-testid="retry-draft-save" @click="draftSaveQueue.flush">重试保存</button></view>
      <section v-if="showCreation && !pendingDraft" id="daily-create-form" class="daily-create" aria-label="创建每日课程">
        <view class="daily-section-heading">
          <text role="heading" aria-level="2">新建学习计划</text>
          <button v-if="store.dailyUnlockSettings.courses.length" type="button" class="daily-text-action" data-testid="cancel-create-course" @click="creationOpen = false">取消</button>
        </view>
        <label class="daily-field">
          <text class="daily-visually-hidden">课程名称</text>
          <input v-model="courseName" data-testid="course-name" maxlength="80" @input="formError = ''" placeholder="输入课程名称" />
        </label>

        <label class="daily-field daily-rate-field">
          <text>每天学习几集</text>
          <input v-model="dailyEpisodeCount" type="number" data-testid="daily-episode-count" aria-label="每天学习集数" />
        </label>
        <label class="daily-field daily-rate-field"><text>从第几集开始</text><input v-model="startEpisodeNumber" type="number" data-testid="start-episode-number" aria-label="起始集数" /></label>
        <text class="daily-plan-hint">今天从第 {{ startEpisodeNumber || 1 }} 集开始，每天开放 {{ dailyEpisodeCount || 1 }} 集；之前的内容可复习，不加入待补学，也不会自动标记学完。</text>

        <view class="daily-mode" role="group" aria-label="课程内容来源">
          <button type="button" data-testid="mode-folder" :aria-pressed="selectionMode === 'folder'" :class="{ 'daily-mode__button--active': selectionMode === 'folder' }" @click="setSelectionMode('folder')">按文件夹</button>
          <button type="button" data-testid="mode-videos" :aria-pressed="selectionMode === 'videos'" :class="{ 'daily-mode__button--active': selectionMode === 'videos' }" @click="setSelectionMode('videos')">手选视频</button>
        </view>

        <template v-if="selectionMode === 'folder'">
          <button v-if="selectedFolder" type="button" class="daily-folder-current" :aria-expanded="folderPickerOpen" @click="folderPickerOpen = !folderPickerOpen">{{ selectedFolder.name }} · {{ episodeSnapshots.length }} 集 <text>更换文件夹</text></button>
          <view v-if="folderChoices.length && (!selectedFolder || folderPickerOpen)" class="daily-folder-list" aria-label="选择文件夹">
            <button
              v-for="choice in visibleFolderChoices"
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
          <button v-if="(!selectedFolder || folderPickerOpen) && folderChoices.length > folderLimit" class="daily-text-action" data-testid="folders-more" @click="folderLimit += VIDEO_BATCH">加载更多文件夹</button>
          <view v-if="!folderChoices.length" class="daily-empty">同步视频目录后可按文件夹创建课程<button class="daily-text-action" @click="openLibrary">前往视频库</button></view>
          <scroll-view v-if="episodeVideos.length" id="course-order-preview" class="daily-episode-preview" data-testid="episode-preview" scroll-y :scroll-into-view="orderScrollTarget" :scroll-with-animation="true" :style="{ height: `${Math.min(episodeVideos.length * 130, 480)}rpx` }">
            <view v-for="(video, index) in episodeVideos" :key="video.id" :id="`course-order-${index + 1}`" class="daily-episode-row">
              <view class="daily-video-choice__thumbnail">
                <VideoThumbnail :src="video.thumbnailUrl" :name="video.name" />
              </view>
              <text class="daily-episode-row__name">{{ index + 1 }}. {{ video.name }}</text>
              <view class="daily-order-actions"><button class="daily-text-action" :data-move-up="video.id" :aria-label="`上移：${video.name}`" :disabled="index === 0" @click="moveEpisode(index, -1)">上移</button><button class="daily-text-action" :data-move-down="video.id" :aria-label="`下移：${video.name}`" :disabled="index === episodeSnapshots.length - 1" @click="moveEpisode(index, 1)">下移</button></view>
            </view>
          </scroll-view>
        </template>

        <template v-else>
          <label v-if="store.mergedVideos.length > 8" class="daily-search">
            <Search :size="18" aria-hidden="true" />
            <input v-model="videoQuery" data-testid="video-search" placeholder="搜索全部视频" aria-label="搜索课程视频" />
          </label>
          <view v-if="availableVideos.length" class="daily-video-list">
            <button
              v-for="video in visibleAvailableVideos"
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
          <view v-else class="daily-empty">{{ videoQuery ? '没有匹配的视频' : '视频库为空，先添加视频来源' }}<button v-if="!videoQuery" class="daily-text-action" @click="openLibrary">前往视频库</button></view>
          <button v-if="availableVideos.length > videoLimit" class="daily-text-action" data-testid="videos-more" @click="videoLimit += VIDEO_BATCH">加载更多视频（已显示 {{ videoLimit }} / {{ availableVideos.length }}）</button>
        </template>

        <view v-if="selectionMode === 'videos' && episodeSnapshots.length" v-show="orderPreviewOpen" class="daily-selection-order" data-testid="episode-preview">
          <view v-for="(episode, index) in episodeSnapshots.slice(0, previewLimit)" :key="episode.videoId" :id="`course-order-${index + 1}`" class="daily-episode-link-row"><text>{{ index + 1 }}. {{ episode.name }}</text><view class="daily-order-actions"><button class="daily-text-action" :data-move-up="episode.videoId" :aria-label="`上移：${episode.name}`" :disabled="index === 0" @click="moveEpisode(index, -1)">上移</button><button class="daily-text-action" :data-move-down="episode.videoId" :aria-label="`下移：${episode.name}`" :disabled="index === episodeSnapshots.length - 1" @click="moveEpisode(index, 1)">下移</button></view></view>
        </view>
        <button v-if="episodeSnapshots.length > previewLimit && (selectionMode === 'folder' || orderPreviewOpen)" class="daily-text-action" data-testid="preview-more" @click="previewLimit += VIDEO_BATCH">加载更多预览（已显示 {{ previewLimit }} / {{ episodeSnapshots.length }}）</button>
        <view class="daily-selection-summary">
          <button type="button" class="daily-selection-count" :aria-expanded="orderPreviewOpen" @click="orderPreviewOpen = !orderPreviewOpen">已选 {{ episodeSnapshots.length }} 集</button>
        </view>
        <view v-if="schedulePreview.length && validRate(dailyEpisodeCount)" class="daily-schedule-preview" data-testid="schedule-preview">
          <text class="daily-plan-hint">前三天学习安排</text>
          <text v-for="day in schedulePreview" :key="day.label">{{ day.label }}：{{ day.names }}</text>
        </view>
        <view v-if="missingDraftEpisodes.length" class="daily-plan-hint" data-testid="draft-missing-sources"><text>草稿中有 {{ missingDraftEpisodes.length }} 集来源暂不可用，已保留原顺序。可同步视频库，或仅从草稿移除，不会删除视频。</text><view v-for="episode in missingDraftEpisodes" :key="episode.videoId" class="daily-episode-link-row"><text>{{ episode.name }} · 来源不可用</text><button class="daily-text-action" data-testid="remove-missing-draft-episode" :data-video-id="episode.videoId" :aria-label="`从草稿移除：${episode.name}`" @click="removeMissingDraftEpisodes(episode.videoId)">从草稿移除</button></view><button class="daily-text-action" data-testid="remove-all-missing-draft-episodes" @click="removeMissingDraftEpisodes()">移除全部不可用集</button><button class="daily-text-action" @click="openLibrary">前往视频库</button></view>
        <view v-if="conflictCourse" class="daily-form-error" role="alert">
          所选视频已属于课程「{{ conflictCourse.name }}」，请先移除原课程
        </view>
        <view v-else-if="formError" class="daily-form-error" role="alert">{{ formError }}</view>
        <button type="button" data-testid="create-course" class="daily-create-button" @click="createCourse">创建课程</button>
      </section>


    </main>
    <view v-if="batchUndo" class="daily-delete-undo" role="status" data-testid="batch-course-undo">
      <view><text>已批量标记 {{ batchUndo.count }} 集 · 8 秒内可撤销</text><text v-if="batchUndoError" class="daily-form-error">{{ batchUndoError }}</text></view>
      <button class="daily-text-action" data-testid="batch-undo" @click="undoBatch">撤销</button>
    </view>
    <view v-if="deletedCourse" class="daily-delete-undo" role="status" data-testid="delete-course-undo">
      <view><text>已删除「{{ deletedCourse.name }}」的计划</text><text v-if="restoreError" class="daily-form-error">{{ restoreError }}</text></view>
      <button class="daily-text-action" @click="undoDeleteCourse">撤销</button>
    </view>
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
  display: flex;
  align-items: center;
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
  line-height: normal;
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
  display: flex;
  align-items: center;
  min-width: 0;
  height: 72rpx;
  flex: 1;
  margin-left: 12rpx;
  padding: 0;
  border: 0;
  outline: 0;
  color: $color-text;
  font-size: 22rpx;
  line-height: normal;
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
.daily-order-actions { display: flex; flex-shrink: 0; gap: 4rpx; }
.daily-order-actions .daily-text-action { margin: 0; text-align: center; }
.daily-order-actions button:disabled { opacity: .35; }
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
  padding: 0;
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
.daily-folder-current { display: flex; align-items: center; justify-content: space-between; margin: 0; padding: 8rpx 0; border: 0; color: $color-muted; background: transparent; font-size: 22rpx; line-height: 1.4; text-align: left; white-space: normal; }
.daily-folder-current text { color: $color-primary; }
.daily-new-plan { width: 100%; margin: 18rpx 0 0; padding: 20rpx; border: 1px solid $color-border; border-radius: 10px; color: $color-primary; background: $color-primary-soft; font-size: 26rpx; line-height: 1.5; }
.daily-rate-field { flex-direction: row; align-items: center; justify-content: space-between; }
.daily-rate-field input { width: 140rpx; text-align: center; }
.daily-plan-hint { color: $color-muted; font-size: 21rpx; line-height: 1.5; }
.daily-schedule-preview, .daily-edit { display: flex; flex-direction: column; padding: 18rpx; border-radius: 12px; background: $color-primary-soft; font-size: 22rpx; overflow-wrap: anywhere; }
.daily-schedule-preview > * + *, .daily-edit > * + * { margin-top: 12rpx; }
.daily-course-actions { display: flex; flex-wrap: wrap; margin-top: 12rpx; }
.daily-more { padding: 8rpx 12rpx; border-radius: 10px; background: $color-primary-soft; }
.daily-danger { color: #a43b2c !important; }
.daily-text-action { margin: 0 18rpx 0 0; padding: 12rpx 4rpx; border: 0; color: $color-primary; background: transparent; font-size: 23rpx; line-height: 1.4; }
.daily-course-filters { display: flex; flex-wrap: wrap; margin: 0 -5rpx; }
.daily-filter { margin: 5rpx; padding: 12rpx 20rpx; border: 1px solid $color-border; border-radius: 9px; background: transparent; color: $color-muted; font-size: 23rpx; line-height: 1.4; }
.daily-filter--active { background: $color-primary-soft; color: $color-primary; border-color: $color-primary; }
.daily-episode-link-row { display: flex; align-items: center; justify-content: space-between; padding: 6rpx 0; }
.daily-episode-link-row > text { min-width: 0; flex: 1; overflow-wrap: anywhere; margin-right: 12rpx; }
.daily-episode-link-row > button { flex-shrink: 0; margin: 0; }
.daily-relink { display: flex; flex-direction: column; padding: 16rpx; border-radius: 10px; background: $color-primary-soft; }
.daily-relink > * + * { margin-top: 12rpx; }
.daily-relink-options { max-height: 420rpx; overflow-y: auto; }
.daily-relink-option { display: flex; align-items: center; justify-content: flex-start; width: 100%; padding: 16rpx 8rpx; margin: 0; border: 0; border-bottom: 1px solid $color-border; border-radius: 0; background: transparent; color: $color-text; font-size: 23rpx; line-height: 1.5; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.daily-delete-undo { position: fixed; z-index: 30; left: 24rpx; right: 24rpx; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); display: flex; align-items: center; padding: 18rpx; border: 1px solid $color-border; border-radius: 10px; background: $color-primary-soft; box-shadow: $shadow-panel; font-size: 23rpx; }
.daily-delete-undo > view { display: flex; flex: 1; min-width: 0; flex-direction: column; margin-right: 14rpx; }
.daily-delete-undo > view > text:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.daily-delete-undo > button { flex-shrink: 0; margin: 0; }
.daily-text-action, .daily-filter, .daily-delete-button, .daily-back, .daily-mode button, .daily-selection-count { min-height: 44px; min-width: 44px; }
.daily-field input, .daily-search input { min-height: 44px; }
.daily-filter { white-space: normal; }
.daily-course-card__name, .daily-episode-link-row > text, .daily-relink-option { overflow-wrap: anywhere; }
.daily-episode-link-row { flex-wrap: wrap; }
.daily-episode-link-row > text { min-width: 0; flex: 1 1 180rpx; }
.daily-search { min-width: 0; }
.daily-search input { min-width: 0; }
.daily-text-action, .daily-filter, .daily-selection-count, .daily-new-plan { display: flex; align-items: center; justify-content: center; box-sizing: border-box; white-space: normal; text-align: center; }
.daily-selection-count { line-height: 1.4; }
.daily-create-button { min-height: max(44px, 92rpx); }
.daily-new-plan, .daily-video-choice, .daily-folder-choice, .daily-folder-current, .daily-relink-option { min-height: 44px; }
</style>
