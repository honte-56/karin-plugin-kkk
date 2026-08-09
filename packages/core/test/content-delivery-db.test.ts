import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ContentDeliveryDBBase } from '../src/module/db/content-delivery'

const dbPath = path.join(os.tmpdir(), `karin-plugin-kkk-delivery-${process.pid}-${Date.now()}.db`)
const db = new ContentDeliveryDBBase(dbPath)

describe('内容投递历史数据库', () => {
  beforeAll(async () => {
    await db.init()
  })

  afterAll(async () => {
    await db.close()
  })

  it('29 分钟内命中，达到 30 分钟边界后放行', async () => {
    const deliveredAt = new Date('2026-08-09T07:00:00.000Z')
    await db.record('QQ:group:1', ['douyin:work:1'], 'parse', deliveredAt)

    await expect(db.findRecent('QQ:group:1', ['douyin:work:1'], 30, new Date('2026-08-09T07:29:59.000Z'))).resolves.toMatchObject({
      source: 'parse'
    })
    await expect(db.findRecent('QQ:group:1', ['douyin:work:1'], 30, new Date('2026-08-09T07:30:00.000Z'))).resolves.toBeUndefined()
  })

  it('不同会话互不影响，并支持任一别名命中', async () => {
    const deliveredAt = new Date('2026-08-09T07:00:00.000Z')
    await db.record('QQ:group:1', ['bilibili:dynamic:1', 'bilibili:video:BV1:p1'], 'push', deliveredAt)

    await expect(db.findRecent('QQ:group:1', ['bilibili:video:BV1:p1'], 30, new Date('2026-08-09T07:10:00.000Z'))).resolves.toMatchObject({
      source: 'push'
    })
    await expect(db.findRecent('QQ:group:2', ['bilibili:video:BV1:p1'], 30, new Date('2026-08-09T07:10:00.000Z'))).resolves.toBeUndefined()
  })
})
