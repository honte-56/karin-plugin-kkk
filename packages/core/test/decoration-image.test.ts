import { expect, it, vi } from 'vitest'
const get = vi.hoisted(() => vi.fn())
vi.mock('node-karin/axios', () => ({ default: { get } }))
import { decorationImage } from '../src/platform/bilibili/decoration-image'

it('从 B 站原图生成本地装扮，保留有限超时和体积限制', async () => {
  get.mockResolvedValueOnce({ headers: { 'content-type': 'image/png' }, data: Buffer.from('image') })
  expect(await decorationImage('http://i0.hdslb.com/bfs/garb/a.png')).toBe('data:image/png;base64,aW1hZ2U=')
  expect(get).toHaveBeenCalledWith(
    'https://i0.hdslb.com/bfs/garb/a.png',
    expect.objectContaining({ maxRedirects: 0, maxContentLength: 524288, signal: expect.any(AbortSignal) })
  )
})
it('装扮超时或返回错误页时省略；其他来源不发起请求', async () => {
  get
    .mockReset()
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ headers: { 'content-type': 'text/html' }, data: Buffer.from('error') })
  for (const src of ['//i0.hdslb.com/bfs/garb/a.png', 'https://i0.hdslb.com/bfs/garb/a.png', 'https://other.example/a', 'file:///tmp/a'])
    expect(await decorationImage(src)).toBeUndefined()
  expect(get).toHaveBeenCalledTimes(2)
})
