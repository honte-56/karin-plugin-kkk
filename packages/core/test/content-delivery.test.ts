import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  config: { app: { duplicateParseWindowMinutes: 30 } },
  db: {
    findRecent: vi.fn(),
    record: vi.fn(),
    cleanOlderThan: vi.fn()
  },
  getBot: vi.fn(() => ({ adapter: { name: 'QQ' } })),
  logger: { error: vi.fn() }
}))

vi.mock('node-karin', () => ({
  default: { getBot: runtime.getBot },
  logger: runtime.logger
}))

vi.mock('../src/module/db', () => ({
  contentDeliveryDB: runtime.db
}))

vi.mock('../src/module/utils/Config', () => ({
  Config: runtime.config
}))

import {
  createContentIdentity,
  createGroupDeliveryScope,
  createMessageDeliveryScope,
  formatDuplicateContentMessage,
  mergeContentIdentities,
  recordGroupContentDelivery,
  runWithContentDeliveryGuard,
  shouldSendDuplicateContentReminder
} from '../src/module/utils/ContentDelivery'

const event = {
  isGroup: true,
  contact: { peer: '123456' },
  userId: 'user-1',
  bot: { adapter: { name: 'QQ' } }
} as any

describe('内容投递守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.config.app.duplicateParseWindowMinutes = 30
    runtime.db.findRecent.mockResolvedValue(undefined)
    runtime.db.record.mockResolvedValue(undefined)
    runtime.db.cleanOlderThan.mockResolvedValue(0)
  })

  it('使用稳定内容 ID 归一不同平台链接形态', () => {
    expect(createContentIdentity('douyin', { aweme_id: '7123' }).keys).toEqual(['douyin:work:7123'])
    expect(createContentIdentity('douyin', { type: 'live_room_detail', sec_uid: 'live-user-1' }).keys).toEqual([
      'douyin:live-user:live-user-1'
    ])
    expect(createContentIdentity('douyin', { type: 'user_dynamic', sec_uid: 'live-user-1' }).keys).toEqual(['douyin:user:live-user-1'])
    expect(createContentIdentity('bilibili', { bvid: 'BV1abc123456', p: 2 }).keys).toEqual(['bilibili:video:BV1abc123456:p2'])
    expect(createContentIdentity('kuaishou', { photoId: 'ks-1' }).keys).toEqual(['kuaishou:work:ks-1'])
    expect(createContentIdentity('xiaohongshu', { note_id: 'note-1' }).keys).toEqual(['xiaohongshu:note:note-1'])
  })

  it('支持 B站动态 ID 与 BV 号别名共同登记', () => {
    const identity = mergeContentIdentities(
      createContentIdentity('bilibili', { dynamic_id: '9988' }),
      createContentIdentity('bilibili', { bvid: 'BV1abc123456' })
    )
    expect(identity.keys).toEqual(['bilibili:dynamic:9988', 'bilibili:video:BV1abc123456:p1'])
  })

  it('按会话生成作用域，推送和群聊消息使用同一作用域', () => {
    expect(createMessageDeliveryScope(event)).toBe('QQ:group:123456')
    expect(createGroupDeliveryScope('bot-1', '123456')).toBe('QQ:group:123456')
  })

  it('命中历史时不执行任务也不刷新记录', async () => {
    runtime.db.findRecent.mockResolvedValue({
      scope: 'QQ:group:123456',
      contentKey: 'douyin:work:7123',
      source: 'push',
      deliveredAt: new Date('2026-08-09T07:00:00.000Z').toISOString()
    })
    const task = vi.fn()

    const result = await runWithContentDeliveryGuard(event, createContentIdentity('douyin', { aweme_id: '7123' }), task)

    expect(result.status).toBe('duplicate')
    expect(task).not.toHaveBeenCalled()
    expect(runtime.db.record).not.toHaveBeenCalled()
  })

  it('成功后写入解析记录，失败时不写入', async () => {
    const identity = createContentIdentity('douyin', { aweme_id: '7123' })
    await expect(runWithContentDeliveryGuard(event, identity, async () => 'ok')).resolves.toMatchObject({
      status: 'completed',
      value: 'ok'
    })
    expect(runtime.db.record).toHaveBeenCalledWith('QQ:group:123456', identity.keys, 'parse')

    runtime.db.record.mockClear()
    await expect(
      runWithContentDeliveryGuard(event, createContentIdentity('douyin', { aweme_id: '7999' }), async () => {
        throw new Error('parse failed')
      })
    ).rejects.toThrow('parse failed')
    expect(runtime.db.record).not.toHaveBeenCalled()
  })

  it('历史记录故障不改变已经成功的解析结果', async () => {
    runtime.db.record.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      runWithContentDeliveryGuard(event, createContentIdentity('douyin', { aweme_id: 'record-failed' }), async () => 'ok')
    ).resolves.toMatchObject({ status: 'completed', value: 'ok' })
    expect(runtime.logger.error).toHaveBeenCalled()
  })

  it('查询历史故障时继续解析，并在成功后补写记录', async () => {
    runtime.db.findRecent.mockRejectedValueOnce(new Error('database unavailable'))
    const identity = createContentIdentity('douyin', { aweme_id: 'query-failed' })

    await expect(runWithContentDeliveryGuard(event, identity, async () => 'ok')).resolves.toMatchObject({
      status: 'completed',
      value: 'ok'
    })
    expect(runtime.db.record).toHaveBeenCalledWith('QQ:group:123456', identity.keys, 'parse')
  })

  it('成功推送按目标群和 push 来源写入历史', async () => {
    const identity = createContentIdentity('bilibili', { dynamic_id: '9988' })
    await recordGroupContentDelivery('bot-1', '123456', identity)

    expect(runtime.db.record).toHaveBeenCalledWith('QQ:group:123456', identity.keys, 'push')
  })

  it('并发解析同一内容时只允许一个任务执行', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const identity = createContentIdentity('douyin', { aweme_id: 'concurrent' })
    const first = runWithContentDeliveryGuard(event, identity, async () => {
      await blocked
      return 'first'
    })
    await vi.waitFor(() => expect(runtime.db.findRecent).toHaveBeenCalledTimes(1))
    const second = await runWithContentDeliveryGuard(event, identity, async () => 'second')

    expect(second.status).toBe('processing')
    release()
    await expect(first).resolves.toMatchObject({ status: 'completed', value: 'first' })
  })

  it('提醒文案区分解析和推送来源', () => {
    expect(
      formatDuplicateContentMessage({ scope: 'scope', contentKey: 'key', source: 'push', deliveredAt: '2026-08-09T07:00:00.000Z' })
    ).toBe('这条链接已经被推送过了哦～')
    expect(
      formatDuplicateContentMessage({ scope: 'scope', contentKey: 'key', source: 'parse', deliveredAt: '2026-08-09T07:00:00.000Z' })
    ).toBe('这条链接已经被解析过了哦～')
  })

  it('同一群聊同一内容十分钟内只提醒一次', () => {
    const firstAt = new Date('2026-08-09T07:00:00.000Z').getTime()
    const identity = createContentIdentity('douyin', { aweme_id: 'reminder-work-1' })
    const anotherIdentity = createContentIdentity('douyin', { aweme_id: 'reminder-work-2' })
    const anotherUser = { ...event, userId: 'another-user' }
    const anotherGroup = { ...event, contact: { peer: '654321' } }

    expect(shouldSendDuplicateContentReminder(event, identity, firstAt)).toBe(true)
    expect(shouldSendDuplicateContentReminder(anotherUser, identity, firstAt + 9 * 60_000 + 59_000)).toBe(false)
    expect(shouldSendDuplicateContentReminder(event, anotherIdentity, firstAt + 60_000)).toBe(true)
    expect(shouldSendDuplicateContentReminder(anotherGroup, identity, firstAt + 60_000)).toBe(true)
    expect(shouldSendDuplicateContentReminder(event, identity, firstAt + 10 * 60_000)).toBe(true)
  })
})
