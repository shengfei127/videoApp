import { describe, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'

describe('daily course sorting in the Android service engine', () => {
  it.each([undefined, {}])('loads and sorts episode numbers when Intl.Collator is unavailable (%s)', (intl) => {
    const { outputFiles } = buildSync({
      stdin: {
        contents: `
          import { sortCourseEpisodes } from './src/features/daily-unlock/dailyUnlockPolicy';
          const names = ['第10集.mp4', '第2集.mp4', '第1集.mp4',
            '第9007199254740993集.mp4', '第9007199254740992集.mp4'];
          globalThis.result = sortCourseEpisodes(names.map((name, index) => ({
            id: String(index), name, path: '/课程/' + name
          }))).map(video => video.name);
        `,
        resolveDir: process.cwd()
      },
      bundle: true, write: false, target: 'es2015', format: 'iife'
    })
    const context = { Intl: intl }
    runInNewContext(outputFiles[0].text, context)
    expect(Array.from(context.result)).toEqual([
      '第1集.mp4', '第2集.mp4', '第10集.mp4',
      '第9007199254740992集.mp4', '第9007199254740993集.mp4'
    ])
  })
})
