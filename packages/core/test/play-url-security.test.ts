import { expect, test } from 'vitest'

import { parseDouyinPlayUrl } from '../src/platform/douyin/playUrl'

test('only extracts the actual platform playback URL', () => {
  expect(parseDouyinPlayUrl('下载 https://aweme.snssdk.com/aweme/v1/play/?video_id=123 后续文字')).toBe(
    'https://aweme.snssdk.com/aweme/v1/play/?video_id=123'
  )
  for (const url of [
    'http://127.0.0.1/#https://aweme.snssdk.com/aweme/v1/play',
    'https://aweme.snssdk.com.evil.test/aweme/v1/play',
    'https://aweme.snssdk.com@evil.test/aweme/v1/play',
    'https://aweme.snssdk.com:8888/aweme/v1/play',
    'https://aweme.snssdk.com/aweme/v1/playevil'
  ])
    expect(parseDouyinPlayUrl(url)).toBeNull()
})
