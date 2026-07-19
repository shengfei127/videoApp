import type {
  BaiduAuthSession,
  DirectVideoRecord,
  PlaybackProgress,
  VideoItem
} from '@/domain/video'

export const MOCK_SCENARIO_NAMES = [
  'first-run',
  'library',
  'resume',
  'baidu-error'
] as const

export type MockScenarioName = (typeof MOCK_SCENARIO_NAMES)[number]

export interface MockBootstrapData {
  scenario: MockScenarioName
  authSession: BaiduAuthSession | null
  baiduVideos: VideoItem[]
  baiduCacheSavedAt: number | null
  directRecords: DirectVideoRecord[]
  progressHistory: PlaybackProgress[]
  mockBaiduError: boolean
}

const MOCK_CACHE_SAVED_AT = 1_800_000_000_000

export function createMockFixture(
  scenario: MockScenarioName
): MockBootstrapData {
  if (scenario === 'first-run') {
    return {
      scenario,
      authSession: null,
      baiduVideos: [],
      baiduCacheSavedAt: null,
      directRecords: [],
      progressHistory: [],
      mockBaiduError: false
    }
  }

  return {
    scenario,
    authSession: createMockSession(),
    baiduVideos: createMockBaiduVideos(),
    baiduCacheSavedAt: MOCK_CACHE_SAVED_AT,
    directRecords: createMockDirectRecords(),
    progressHistory: scenario === 'library' ? [] : createMockProgress(),
    mockBaiduError: scenario === 'baidu-error'
  }
}

function createMockSession(): BaiduAuthSession {
  return {
    accessToken: 'mock-placeholder-token-not-a-real-credential',
    expiresAt: 4_102_444_800_000,
    scope: ['basic', 'netdisk']
  }
}

function createMockBaiduVideos(): VideoItem[] {
  return [
    {
      id: 'baidu:700000000000000001',
      sourceType: 'baidu',
      sourceId: '700000000000000001',
      name: '城市漫步.mp4',
      path: '/apps/片刻/城市漫步.mp4',
      sizeBytes: 734_003_200,
      durationSeconds: 1_248,
      thumbnailUrl:
        'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=960&q=80',
      modifiedAt: 1_799_999_100_000
    },
    {
      id: 'baidu:1001',
      sourceType: 'baidu',
      sourceId: '1001',
      name: '第2站·海边.mp4',
      path: '/apps/片刻/旅行2/第2站·海边.mp4',
      sizeBytes: 1_258_291_200,
      durationSeconds: 1_560,
      thumbnailUrl:
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=960&q=80',
      modifiedAt: 1_799_999_200_000
    },
    {
      id: 'baidu:700000000000000003',
      sourceType: 'baidu',
      sourceId: '700000000000000003',
      name: '第10站·山间.mp4',
      path: '/apps/片刻/旅行10/清晨/第10站·山间.mp4',
      sizeBytes: 943_718_400,
      durationSeconds: 1_382,
      thumbnailUrl:
        'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=960&q=80',
      modifiedAt: 1_799_999_300_000
    }
  ]
}

function createMockDirectRecords(): DirectVideoRecord[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: '示例直播流',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      mediaKind: 'hls',
      addedAt: 1_799_999_400_000
    }
  ]
}

function createMockProgress(): PlaybackProgress[] {
  return [
    {
      videoId: 'baidu:1001',
      positionSeconds: 386,
      durationSeconds: 1_560,
      updatedAt: 1_799_999_500_000,
      completed: false
    }
  ]
}
