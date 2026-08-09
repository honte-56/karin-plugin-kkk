import type { Message } from 'node-karin'
import karin, { logger } from 'node-karin'

import { contentDeliveryDB, type ContentDeliveryRecord, type ContentDeliverySource } from '../db'
import { Config } from './Config'

export type ContentPlatform = 'douyin' | 'bilibili' | 'kuaishou' | 'xiaohongshu'

export interface ContentIdentity {
  keys: string[]
}

export type ContentDeliveryResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'duplicate'; record: ContentDeliveryRecord }
  | { status: 'processing' }

const inFlight = new Set<string>()
const duplicateReminderSentAt = new Map<string, number>()
const duplicateReminderCooldownMs = 10 * 60_000
let lastCleanupAt = 0

const compact = (values: Array<string | undefined>): string[] => [...new Set(values.filter((value): value is string => Boolean(value)))]

export const createContentIdentity = (platform: ContentPlatform, data: Record<string, unknown>): ContentIdentity => {
  switch (platform) {
    case 'douyin': {
      const isLive = data.type === 'live_room_detail'
      return {
        keys: compact([
          typeof data.aweme_id === 'string' ? `douyin:work:${data.aweme_id}` : undefined,
          typeof data.room_id === 'string' ? `douyin:live:${data.room_id}` : undefined,
          typeof data.sec_uid === 'string' ? `douyin:${isLive ? 'live-user' : 'user'}:${data.sec_uid}` : undefined,
          typeof data.music_id === 'string' ? `douyin:music:${data.music_id}` : undefined,
          typeof data.video_id === 'string' ? `douyin:cdn:${data.video_id}` : undefined
        ])
      }
    }
    case 'bilibili': {
      const page = typeof data.p === 'number' ? data.p : 1
      const bvid = typeof data.bvid === 'string' ? data.bvid : typeof data.id === 'string' ? data.id : undefined
      return {
        keys: compact([
          typeof data.dynamic_id === 'string' ? `bilibili:dynamic:${data.dynamic_id}` : undefined,
          bvid ? `bilibili:video:${bvid}:p${page}` : undefined,
          typeof data.room_id === 'string' ? `bilibili:live:${data.room_id}` : undefined,
          typeof data.realid === 'string' ? `bilibili:bangumi:${data.realid}` : undefined
        ])
      }
    }
    case 'kuaishou':
      return { keys: compact([typeof data.photoId === 'string' ? `kuaishou:work:${data.photoId}` : undefined]) }
    case 'xiaohongshu':
      return { keys: compact([typeof data.note_id === 'string' ? `xiaohongshu:note:${data.note_id}` : undefined]) }
  }
}

export const mergeContentIdentities = (...identities: ContentIdentity[]): ContentIdentity => ({
  keys: compact(identities.flatMap((identity) => identity.keys))
})

const adapterName = (event: Message): string => event.bot?.adapter?.name || 'unknown'

export const createMessageDeliveryScope = (event: Message): string => {
  const peer = event.contact?.peer || event.userId || 'unknown'
  const scene = event.isGroup ? 'group' : 'private'
  return `${adapterName(event)}:${scene}:${peer}`
}

export const createGroupDeliveryScope = (botId: string, groupId: string): string => {
  const bot = karin.getBot(botId)
  return `${bot?.adapter?.name || 'unknown'}:group:${groupId}`
}

export const formatDuplicateContentMessage = (record: ContentDeliveryRecord): string =>
  `这条链接已经被${record.source === 'push' ? '推送' : '解析'}过了哦～`

export const shouldSendDuplicateContentReminder = (event: Message, identity: ContentIdentity, now = Date.now()): boolean => {
  for (const [key, sentAt] of duplicateReminderSentAt) {
    if (now - sentAt >= duplicateReminderCooldownMs) duplicateReminderSentAt.delete(key)
  }

  const reminderKey = `${createMessageDeliveryScope(event)}\u0000${[...identity.keys].sort().join('\u0000')}`
  if (duplicateReminderSentAt.has(reminderKey)) return false

  duplicateReminderSentAt.set(reminderKey, now)
  return true
}

const findRecentDelivery = async (
  scope: string,
  identity: ContentIdentity,
  windowMinutes: number
): Promise<ContentDeliveryRecord | undefined> => {
  try {
    return await contentDeliveryDB.findRecent(scope, identity.keys, windowMinutes)
  } catch (error) {
    logger.error('[内容投递历史] 查询失败，本次继续解析:', error)
    return undefined
  }
}

const recordContentDelivery = async (
  scope: string,
  identity: ContentIdentity,
  source: ContentDeliverySource,
  windowMinutes: number
): Promise<void> => {
  try {
    await contentDeliveryDB.record(scope, identity.keys, source)
  } catch (error) {
    logger.error('[内容投递历史] 写入失败，不影响本次内容投递:', error)
    return
  }

  try {
    await cleanupExpiredRecords(windowMinutes)
  } catch (error) {
    logger.error('[内容投递历史] 清理失败，不影响本次内容投递:', error)
  }
}

const cleanupExpiredRecords = async (windowMinutes: number): Promise<void> => {
  const now = Date.now()
  if (now - lastCleanupAt < 60 * 60_000) return
  lastCleanupAt = now
  await contentDeliveryDB.cleanOlderThan(Math.max(24, Math.ceil((windowMinutes * 2) / 60)))
}

export const runWithContentDeliveryGuard = async <T>(
  event: Message,
  identity: ContentIdentity,
  task: () => Promise<T>
): Promise<ContentDeliveryResult<T>> => {
  const windowMinutes = Config.app.duplicateParseWindowMinutes
  if (windowMinutes <= 0 || identity.keys.length === 0) {
    return { status: 'completed', value: await task() }
  }

  const scope = createMessageDeliveryScope(event)
  const lockKeys = identity.keys.map((key) => `${scope}\u0000${key}`)
  if (lockKeys.some((key) => inFlight.has(key))) return { status: 'processing' }

  const recent = await findRecentDelivery(scope, identity, windowMinutes)
  if (recent) return { status: 'duplicate', record: recent }
  if (lockKeys.some((key) => inFlight.has(key))) return { status: 'processing' }

  for (const key of lockKeys) inFlight.add(key)
  try {
    const value = await task()
    await recordContentDelivery(scope, identity, 'parse', windowMinutes)
    return { status: 'completed', value }
  } finally {
    for (const key of lockKeys) inFlight.delete(key)
  }
}

export const recordGroupContentDelivery = async (
  botId: string,
  groupId: string,
  identity: ContentIdentity,
  source: ContentDeliverySource = 'push'
): Promise<void> => {
  const windowMinutes = Config.app.duplicateParseWindowMinutes
  if (windowMinutes <= 0 || identity.keys.length === 0) return
  await recordContentDelivery(createGroupDeliveryScope(botId, groupId), identity, source, windowMinutes)
}
