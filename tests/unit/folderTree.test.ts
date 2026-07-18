import { describe, expect, it } from 'vitest'

import type { VideoItem } from '@/domain/video'
import { buildFolderTree } from '@/features/catalog/folderTree'

const ROOT = '/apps/片刻'

describe('buildFolderTree', () => {
  it('reconstructs nested Chinese folders and keeps files directly at the exact root', () => {
    const tree = buildFolderTree(ROOT, [
      baiduVideo('1', `${ROOT}/课程/入门/第一集.mp4`, '第一集.mp4'),
      baiduVideo('2', `${ROOT}/封面视频.mp4`, '封面视频.mp4')
    ])

    expect(tree).toMatchObject({ name: '片刻', path: ROOT })
    expect(tree.videos.map((video) => video.name)).toEqual(['封面视频.mp4'])
    expect(tree.folders[0]).toMatchObject({
      name: '课程',
      path: `${ROOT}/课程`,
      videos: []
    })
    expect(tree.folders[0]?.folders[0]).toMatchObject({
      name: '入门',
      path: `${ROOT}/课程/入门`
    })
    expect(tree.folders[0]?.folders[0]?.videos.map((video) => video.name)).toEqual([
      '第一集.mp4'
    ])
  })

  it('sorts every folder and video level with Chinese numeric collation', () => {
    const folders = ['课程10', '电影', '课程2', '动画']
    const names = ['第10集.mp4', '片尾.mp4', '第2集.mp4', '开场.mp4']
    const expectedFolders = [...folders].sort(compareChineseNumeric)
    const expectedNames = [...names].sort(compareChineseNumeric)
    const videos = [
      ...folders.map((folder, index) =>
        baiduVideo(String(index + 1), `${ROOT}/${folder}/视频.mp4`, '视频.mp4')
      ),
      ...names.map((name, index) =>
        baiduVideo(String(index + 20), `${ROOT}/合集/${name}`, name)
      )
    ]

    const tree = buildFolderTree(ROOT, videos)

    expect(tree.folders.map((folder) => folder.name)).toEqual(
      [...expectedFolders, '合集'].sort(compareChineseNumeric)
    )
    expect(
      tree.folders.find((folder) => folder.name === '合集')?.videos.map(
        (video) => video.name
      )
    ).toEqual(expectedNames)
  })

  it('keeps only the first Baidu video for each sourceId', () => {
    const first = baiduVideo('7', `${ROOT}/第一处.mp4`, '第一处.mp4')
    const duplicate = baiduVideo('7', `${ROOT}/第二处.mp4`, '第二处.mp4')
    const direct: VideoItem = {
      id: 'direct:same-source-id',
      sourceType: 'direct',
      sourceId: '7',
      name: '直链.mp4',
      path: 'https://media.example/direct.mp4'
    }

    const tree = buildFolderTree(ROOT, [first, duplicate, direct])

    expect(tree.videos).toEqual([first])
    expect(tree.folders).toEqual([])
  })

  it.each([
    '/apps/片刻2/sibling.mp4',
    '/apps/片刻-old/sibling.mp4',
    '/apps/片刻/../其他/traversal.mp4',
    '/apps/片刻/./dot.mp4',
    '/apps/片刻//double-slash.mp4',
    '/apps/片刻/folder\\backslash.mp4',
    '/apps/片刻/query.mp4?download=1',
    '/apps/片刻/fragment.mp4#preview',
    '/apps/片刻/%2e%2e/encoded-traversal.mp4',
    '/apps/片刻/folder%2Fother/encoded-separator.mp4',
    '/apps/片刻/malformed%2/path.mp4',
    '/apps/片刻/control\u0000.mp4',
    '/apps/片刻'
  ])('rejects an unsafe or out-of-bound path: %s', (path) => {
    const tree = buildFolderTree(ROOT, [baiduVideo('1', path, 'unsafe.mp4')])

    expect(tree.videos).toEqual([])
    expect(tree.folders).toEqual([])
  })

  it('does not attach folders that contain no accepted Baidu videos', () => {
    const invalidNested = baiduVideo(
      '1',
      `${ROOT}/空文件夹/子目录/escape.mp4#fragment`,
      'escape.mp4'
    )
    const directNested: VideoItem = {
      ...baiduVideo('2', `${ROOT}/直链目录/direct.mp4`, 'direct.mp4'),
      id: 'direct:2',
      sourceType: 'direct'
    }

    const tree = buildFolderTree(ROOT, [invalidNested, directNested])

    expect(tree.folders).toEqual([])
  })

  it('does not mutate the input array or video records', () => {
    const videos = [
      baiduVideo('10', `${ROOT}/课程10/第10集.mp4`, '第10集.mp4'),
      baiduVideo('2', `${ROOT}/课程2/第2集.mp4`, '第2集.mp4')
    ]
    const before = structuredClone(videos)

    buildFolderTree(ROOT, videos)

    expect(videos).toEqual(before)
  })

  it('keeps the exact root path and uses only its final segment as the root name', () => {
    const root = '/apps/中文 2'

    const tree = buildFolderTree(root, [
      baiduVideo('1', `${root}/video.mp4`, 'video.mp4')
    ])

    expect(tree).toMatchObject({ name: '中文 2', path: root })
  })
})

function baiduVideo(sourceId: string, path: string, name: string): VideoItem {
  return {
    id: `baidu:${sourceId}`,
    sourceType: 'baidu',
    sourceId,
    name,
    path
  }
}

function compareChineseNumeric(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true })
}
