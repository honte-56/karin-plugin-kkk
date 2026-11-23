import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  dir: '',
  read: vi.fn(),
  render: vi.fn(),
  send: vi.fn(),
  cache: new Set<string>(),
  logger: new Proxy({}, { get: () => () => '' })
}))
vi.mock('@ikenxuan/amagi', () => ({
  DynamicType: {
    DRAW: 'DYNAMIC_TYPE_DRAW',
    AV: 'DYNAMIC_TYPE_AV',
    LIVE_RCMD: 'DYNAMIC_TYPE_LIVE_RCMD',
    WORD: 'DYNAMIC_TYPE_WORD',
    FORWARD: 'DYNAMIC_TYPE_FORWARD',
    ARTICLE: 'DYNAMIC_TYPE_ARTICLE'
  },
  MajorType: {}
}))
vi.mock('node-karin/root', () => ({
  get karinPathBase() {
    return m.dir
  }
}))
vi.mock('@/root', () => ({ Root: { pluginName: 'test' } }))
vi.mock('node-karin', () => ({
  logger: m.logger,
  segment: {},
  default: {
    getBot: () => ({ adapter: { name: 'OneBot' }, account: { selfId: 'bot' } }),
    getAllBotID: () => ['bot'],
    contactGroup: (peer: string) => ({ peer }),
    sendMsg: m.send
  }
}))
vi.mock('@/module/utils/logger', () => ({ logger: m.logger }))
vi.mock('@/module/utils/Config', () => ({
  Config: {
    amagi: { cookies: {} },
    bilibili: { push: { switch: true, parsedynamic: false } },
    pushlist: { bilibili: [{ host_mid: 123, group_id: ['a:bot', 'b:bot'], authorComments: true, switch: true }] }
  }
}))
vi.mock('@/module/utils/amagiClient', () => ({
  bilibiliFetcher: {},
  getAmagiClient: () => ({ bilibili: { request: { get: m.read } } }),
  AmagiError: Error
}))
vi.mock('@/module/utils/pushFailures', () => ({ pushCoolingDown: () => false }))
vi.mock('@/module/utils/Render', () => ({ Render: m.render }))
vi.mock('@/module/db', () => ({ bilibiliDB: { isDynamicPushed: async (id: string, _uid: number, g: string) => m.cache.has(id + g) } }))
vi.mock('@/module', () => ({
  Base: class {
    e = {}
    amagi = { bilibili: { fetcher: { fetchUserCard: async () => ({ data: { data: { card: {} } } }) } } }
  },
  baseHeaders: {},
  Count: String,
  Render: m.render,
  bilibiliDB: {
    shouldFilter: async () => false,
    isDynamicPushed: async (id: string, _uid: number, g: string) => m.cache.has(id + g),
    addDynamicCache: async (id: string, _uid: number, g: string) => m.cache.add(id + g)
  }
}))
vi.mock('@/module/utils/ContentDelivery', () => ({
  createContentIdentity: vi.fn(),
  mergeContentIdentities: vi.fn(),
  recordGroupContentDelivery: vi.fn()
}))
vi.mock('@/platform/bilibili', () => ({
  TimeFormatter: { toDateTime: () => '', now: () => '' },
  generateDecorationCard: vi.fn(),
  parseAdditionalCard: vi.fn()
}))

const root = (mid = '123') => ({
  rpid_str: '77',
  mid_str: mid,
  ctime: 1,
  member: { uname: 'UP' },
  content: { message: '留言' },
  rcount: 0,
  replies: []
})
const replyPage = (rows: unknown[]) => ({ success: true, data: { code: 0, data: { replies: rows, cursor: { is_end: true, mode: 2 } } } })
let seq = 10
const dirs: string[] = []
beforeEach(() => {
  vi.resetModules()
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-comment-'))
  dirs.push(m.dir)
  m.cache.clear()
  m.read.mockReset()
  m.render.mockReset().mockImplementation(async (_e, _route, data) => [data.authorComment ? 'combined' : 'plain'])
  m.send.mockReset().mockResolvedValue({ messageId: 'receipt' })
})
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
async function setup() {
  const { Bilibilipush } = await import('../src/platform/bilibili/push')
  const watch = await import('../src/platform/bilibili/author-comments')
  const id = String(++seq),
    now = Math.floor(Date.now() / 1000)
  const item = {
    host_mid: 123,
    dynamic_type: 'DYNAMIC_TYPE_DRAW',
    targets: [
      { groupId: 'a', botId: 'bot' },
      { groupId: 'b', botId: 'bot' }
    ],
    Dynamic_Data: {
      id_str: id,
      type: 'DYNAMIC_TYPE_DRAW',
      basic: { comment_id_str: id, comment_type: 11 },
      modules: {
        module_author: { mid: 123, pub_ts: now, pendant: {} },
        module_dynamic: { topic: null },
        module_stat: { like: { count: 1 }, comment: { count: 1 }, forward: { count: 0 } }
      }
    }
  }
  watch.observeCommentPosts([item])
  const push = new Bilibilipush()
  const dispatch = async () => push.getdata(await push.excludeAlreadyPushed({ [id]: { ...item, targets: [...item.targets] } } as never))
  return { watch, dispatch, id, item }
}
it('两个定时任务同时开始，共享首查；有留言只画合并图，失败群下轮单独补发', async () => {
  const { watch, dispatch, id, item } = await setup()
  let resolve!: (v: unknown) => void
  m.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  m.send.mockResolvedValueOnce({ messageId: 'ok' }).mockResolvedValueOnce({})
  const checking = watch.runCommentWatch(),
    sending = dispatch()
  await vi.waitFor(() => expect(m.read).toHaveBeenCalledTimes(1))
  resolve(replyPage([root()]))
  await Promise.all([checking, sending])
  expect(m.render).toHaveBeenCalledTimes(1)
  expect(m.send.mock.calls.map((c) => [c[1].peer, c[2]])).toEqual([
    ['a', ['combined']],
    ['b', ['combined']]
  ])
  await watch.runCommentWatch()
  expect(m.send).toHaveBeenCalledTimes(2)
  await dispatch()
  expect(m.send.mock.calls.slice(2).map((c) => [c[1].peer, c[2]])).toEqual([['b', ['combined']]])
  // 模拟评论回执已落盘、动态缓存尚未提交时的重启。
  m.cache.delete(id + 'a')
  vi.resetModules()
  const { Bilibilipush } = await import('../src/platform/bilibili/push')
  const p = new Bilibilipush()
  await p.getdata(await p.excludeAlreadyPushed({ [id]: { ...item, targets: [...item.targets] } } as never))
  expect(m.cache.has(id + 'a')).toBe(true)
  expect(m.send).toHaveBeenCalledTimes(3)
})
it.each(['empty', 'error', 'render-error'])('首次 %s 时发普通动态图，两群共用原图，查到的留言不会误记送达', async (mode) => {
  const { watch, dispatch } = await setup()
  if (mode === 'error') m.read.mockRejectedValueOnce(new Error('timeout'))
  else m.read.mockResolvedValue(replyPage(mode === 'empty' ? [] : [root()]))
  if (mode === 'render-error') m.render.mockRejectedValueOnce(new Error('image'))
  await dispatch()
  expect(m.send.mock.calls.map((c) => c[2])).toEqual([['plain'], ['plain']])
  expect(m.render.mock.calls.filter((c) => !c[2].authorComment)).toHaveLength(1)
  await watch.runCommentWatch()
  expect(m.send.mock.calls.slice(2).map((c) => c[2])).toEqual(mode === 'render-error' ? [['combined'], ['combined']] : [])
})

it('已发原动态后才有留言，仅新增一张带上文的评论图', async () => {
  const { dispatch, watch } = await setup()
  m.read.mockResolvedValueOnce(replyPage([]))
  await dispatch()
  vi.useFakeTimers()
  try {
    vi.setSystemTime(Date.now() + 3601_000)
    m.read.mockResolvedValue(replyPage([root()]))
    await watch.runCommentWatch()
    await watch.runCommentWatch()
    expect(m.send.mock.calls.map((c) => c[2])).toEqual([['plain'], ['plain'], ['combined'], ['combined']])
  } finally {
    vi.useRealTimers()
  }
})
