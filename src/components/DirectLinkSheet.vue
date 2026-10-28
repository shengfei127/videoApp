<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Check, Link, Trash2, X } from '@/components/icons'

import type { DirectVideoRecord } from '@/domain/video'
import {
  canAcceptUnknownHttpsUrl,
  classifyDirectUrl,
  DirectLinkService
} from '@/features/direct-links/directLinkService'
import { uniStorage } from '@/infrastructure/storage'

export type DirectLinkProbe = (url: string) => Promise<string | undefined>

const props = defineProps<{
  open: boolean
  record?: DirectVideoRecord
  service?: DirectLinkService
  probe?: DirectLinkProbe
}>()

const emit = defineEmits<{
  close: []
  saved: [record: DirectVideoRecord]
  deleted: [id: string]
}>()

const defaultService = new DirectLinkService(uniStorage)
const url = ref('')
const name = ref('')
const errorMessage = ref('')
const forceUrl = ref<string | null>(null)
const loading = ref(false)
let operationGeneration = 0
let disposed = false

const isEditing = computed(() => Boolean(props.record))
const service = computed(() => props.service ?? defaultService)
const probe = computed(() => props.probe ?? probeDirectMedia)
const canForce = computed(
  () =>
    forceUrl.value !== null &&
    forceUrl.value === url.value.trim() &&
    classifyDirectUrl(forceUrl.value) === 'unknown'
)

watch(
  () => [props.open, props.record] as const,
  ([open, record]) => {
    invalidateOperation()
    if (!open) {
      errorMessage.value = ''
      forceUrl.value = null
      return
    }

    url.value = record?.url ?? ''
    name.value = record?.name ?? ''
    errorMessage.value = ''
    forceUrl.value = null
    loading.value = false
  },
  { immediate: true }
)

watch(
  () => [props.service, props.probe] as const,
  () => invalidateOperation()
)

watch(url, () => {
  invalidateOperation()
  errorMessage.value = ''
  forceUrl.value = null
})

onUnmounted(() => {
  disposed = true
  invalidateOperation()
})

async function submit(): Promise<void> {
  if (loading.value) {
    return
  }

  const submittedUrl = url.value.trim()
  const submittedName = name.value
  const submittedRecordId = props.record?.id
  const submittedService = service.value
  const submittedProbe = probe.value
  const kind = classifyDirectUrl(submittedUrl)
  const operation = beginOperation()
  errorMessage.value = ''
  forceUrl.value = null

  if (kind === 'invalid') {
    if (isCurrentOperation(operation)) {
      errorMessage.value = '请输入有效的 HTTPS 媒体链接'
      loading.value = false
    }
    return
  }

  try {
    if (kind === 'mp4' || kind === 'hls') {
      if (isCurrentOperation(operation)) {
        saveRecord(
          submittedService,
          submittedRecordId,
          submittedUrl,
          submittedName
        )
      }
      return
    }

    let contentType: string | undefined
    try {
      contentType = await submittedProbe(submittedUrl)
    } catch {
      contentType = undefined
    }

    if (!isCurrentOperation(operation)) {
      return
    }

    if (!canAcceptUnknownHttpsUrl(submittedUrl, contentType)) {
      errorMessage.value = '无法确认该链接是可播放的媒体链接'
      forceUrl.value = submittedUrl
      return
    }

    saveRecord(
      submittedService,
      submittedRecordId,
      submittedUrl,
      submittedName,
      contentType
    )
  } catch {
    if (isCurrentOperation(operation)) {
      errorMessage.value = '暂时无法保存媒体直链，请重试'
    }
  } finally {
    if (isCurrentOperation(operation)) {
      loading.value = false
    }
  }
}

function forceSave(): void {
  if (!canForce.value || loading.value || forceUrl.value === null) {
    return
  }

  const operation = beginOperation()
  const submittedService = service.value
  const submittedRecordId = props.record?.id
  const submittedName = name.value
  const submittedUrl = forceUrl.value
  errorMessage.value = ''
  try {
    const input = { url: submittedUrl, name: submittedName }
    const saved = submittedRecordId
      ? submittedService.updateUnverified(submittedRecordId, input)
      : submittedService.addUnverified(input)
    if (isCurrentOperation(operation)) {
      finishSave(saved)
    }
  } catch {
    if (isCurrentOperation(operation)) {
      errorMessage.value = '暂时无法保存媒体直链，请重试'
    }
  } finally {
    if (isCurrentOperation(operation)) {
      loading.value = false
    }
  }
}

function saveRecord(
  submittedService: DirectLinkService,
  submittedRecordId: string | undefined,
  submittedUrl: string,
  submittedName: string,
  contentType?: string
): void {
  const input = { url: submittedUrl, name: submittedName }
  const saved = submittedRecordId
    ? submittedService.update(submittedRecordId, input, contentType)
    : submittedService.add(input, contentType)
  finishSave(saved)
}

function finishSave(saved: DirectVideoRecord): void {
  emit('saved', saved)
  emit('close')
}

function requestDelete(): void {
  const record = props.record
  if (!record || loading.value) {
    return
  }

  const operation = ++operationGeneration
  const submittedService = service.value
  let settled = false

  uni.showModal({
    title: '删除媒体直链',
    content: '确认删除这条媒体直链？此操作不会删除网络上的文件。',
    confirmText: '删除',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled || !isCurrentOperation(operation)) {
        return
      }
      settled = true

      if (!confirm) {
        return
      }

      try {
        submittedService.remove(record.id)
        emit('deleted', record.id)
        emit('close')
      } catch {
        errorMessage.value = '暂时无法删除媒体直链，请重试'
      }
    }
  })
}

function close(): void {
  invalidateOperation()
  emit('close')
}

function beginOperation(): number {
  const operation = ++operationGeneration
  loading.value = true
  return operation
}

function invalidateOperation(): void {
  operationGeneration += 1
  loading.value = false
}

function isCurrentOperation(operation: number): boolean {
  return !disposed && operation === operationGeneration
}

function probeDirectMedia(candidateUrl: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: candidateUrl,
      method: 'HEAD',
      timeout: 8_000,
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error('媒体类型探测失败'))
          return
        }

        resolve(readContentType(response.header))
      },
      fail: () => reject(new Error('媒体类型探测失败'))
    })
  })
}

function readContentType(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return undefined
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type' && typeof value === 'string') {
      return value
    }
  }

  return undefined
}
</script>

<template>
  <view
    v-if="open"
    class="direct-link-sheet__backdrop"
    role="presentation"
    @click.self="close"
  >
    <view
      class="direct-link-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="isEditing ? '编辑媒体直链' : '导入媒体直链'"
    >
      <view class="direct-link-sheet__header">
        <view class="direct-link-sheet__heading">
          <Link :size="21" :stroke-width="1.9" aria-hidden="true" />
          <text>{{ isEditing ? '编辑媒体直链' : '导入媒体直链' }}</text>
        </view>
        <button
          type="button"
          class="direct-link-sheet__icon-button"
          aria-label="关闭导入面板"
          title="关闭"
          @click="close"
        >
          <X :size="21" aria-hidden="true" />
        </button>
      </view>

      <label class="direct-link-sheet__field">
        <text>HTTPS 视频地址</text>
        <input
          v-model="url"
          data-testid="direct-url"
          type="text"
          inputmode="url"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
          placeholder="https://.../video.mp4"
        />
      </label>

      <label class="direct-link-sheet__field">
        <text>显示名称（可选）</text>
        <input
          v-model="name"
          data-testid="direct-name"
          type="text"
          autocorrect="off"
          :disabled="loading"
          placeholder="未填写时使用文件名"
        />
      </label>

      <text
        v-if="errorMessage"
        class="direct-link-sheet__error"
        role="alert"
      >
        {{ errorMessage }}
      </text>

      <view class="direct-link-sheet__actions">
        <button
          v-if="record"
          type="button"
          data-testid="direct-delete"
          class="direct-link-sheet__button direct-link-sheet__button--danger"
          aria-label="删除当前媒体直链"
          :disabled="loading"
          @click="requestDelete"
        >
          <Trash2 :size="19" aria-hidden="true" />
          <text>删除</text>
        </button>
        <button
          v-if="canForce"
          type="button"
          data-testid="direct-force"
          class="direct-link-sheet__button direct-link-sheet__button--secondary"
          :disabled="loading"
          @click="forceSave"
        >
          <text>仍然尝试添加</text>
        </button>
        <button
          type="button"
          data-testid="direct-save"
          class="direct-link-sheet__button direct-link-sheet__button--primary"
          :disabled="loading"
          @click="submit"
        >
          <Check :size="19" aria-hidden="true" />
          <text>{{ loading ? '正在验证' : isEditing ? '保存' : '添加' }}</text>
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.direct-link-sheet__backdrop {
  position: fixed;
  z-index: 80;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(7, 27, 23, 0.58);
}

.direct-link-sheet {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 760rpx;
  padding: 36rpx 32rpx max(34rpx, env(safe-area-inset-bottom));
  border: 1px solid $color-border;
  border-bottom: 0;
  border-radius: 24px 24px 0 0;
  background: $color-surface;
  box-shadow: $shadow-panel;
}

.direct-link-sheet::before {
  position: absolute;
  top: 12rpx;
  left: 50%;
  width: 64rpx;
  height: 6rpx;
  border-radius: 999px;
  background: $color-border;
  content: '';
  transform: translateX(-50%);
}

.direct-link-sheet__header,
.direct-link-sheet__heading,
.direct-link-sheet__actions,
.direct-link-sheet__button { display: flex; align-items: center; }

.direct-link-sheet__header {
  justify-content: space-between;
  margin: 8rpx 0 26rpx;
}

.direct-link-sheet__heading {
  min-width: 0;
  color: $color-text;
  font-size: 29rpx;
  font-weight: 680;
  line-height: 1.35;
}

.direct-link-sheet__heading text { margin-left: 12rpx; }

.direct-link-sheet__icon-button { box-sizing: border-box; min-width: 44px; min-height: 44px;
  display: flex;
  width: 68rpx;
  height: 68rpx;
  flex: 0 0 68rpx;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: 50%;
  color: $color-muted;
  background: transparent;
}

.direct-link-sheet__field {
  display: flex;
  flex-direction: column;
  margin-top: 22rpx;
  color: $color-text;
  font-size: 22rpx;
  font-weight: 600;
}

.direct-link-sheet__field input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 82rpx;
  margin-top: 9rpx;
  padding: 0 20rpx;
  border: 1px solid $color-border;
  border-radius: 14px;
  color: $color-text;
  font-size: 23rpx;
  font-weight: 400;
  background: $color-bg;
}

.direct-link-sheet__field input:focus {
  border-color: $color-primary;
  outline: 2px solid rgba($color-primary, 0.16);
}

.direct-link-sheet__error {
  display: block;
  margin-top: 16rpx;
  color: #a43b2c;
  font-size: 21rpx;
  line-height: 1.45;
}

.direct-link-sheet__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: 26rpx;
}

.direct-link-sheet__button {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  box-sizing: border-box;
  justify-content: center;
  min-width: 130rpx;
  min-height: max(44px, 76rpx);
  margin: 0 0 0 10rpx;
  padding: 12rpx 18rpx;
  border: 1px solid transparent;
  border-radius: 14px;
  font-size: 21rpx;
  font-weight: 620;
  line-height: 1.3;
}

.direct-link-sheet__button .app-icon + text { margin-left: 7rpx; }
.direct-link-sheet__button--primary { color: #fff; background: $color-primary; }
.direct-link-sheet__button--secondary { border-color: $color-primary; color: $color-primary; background: $color-primary-soft; }
.direct-link-sheet__button--danger { margin-right: auto; border-color: #e4b9b1; color: #a43b2c; background: #fff6f4; }
.direct-link-sheet__button:disabled { cursor: not-allowed; opacity: 0.56; }
</style>
