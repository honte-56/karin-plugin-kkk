import { logger } from 'node-karin'

import { platformNames, sendOwnerText } from './accountHealth'
import { Config } from './Config'

type Platform = 'bilibili' | 'douyin'
type Incident = { failures: number; cleanRounds: number; notified: boolean; pending: boolean; resumeAt: number }
const incidents = new Map<Platform, Incident>()

export const pushCoolingDown = (platform: Platform) => (incidents.get(platform)?.resumeAt ?? 0) > Date.now()

export async function subscriptionFailed(platform: Platform, uid: string | number, error: unknown) {
  const failure = error as { kind?: string; code?: number; httpStatus?: number; name?: string } | null
  const cooldown = failure?.kind === 'risk' || [429, 412, -352, -412].includes(failure?.code ?? 0) || failure?.httpStatus === 429
  const state = incidents.get(platform) ?? { failures: 0, cleanRounds: 0, notified: false, pending: false, resumeAt: 0 }
  state.failures++
  state.cleanRounds = 0
  if (cooldown) state.resumeAt = Date.now() + 10 * 60_000
  incidents.set(platform, state)
  const reason = failure?.code ?? failure?.name ?? '未知错误'
  const detail = `${platformNames[platform]}推送：订阅 ${uid} 失败（${reason}）${cooldown ? '，平台轮询冷却 10 分钟' : ''}。`
  logger.warn(detail)
  if (!state.notified && !state.pending && Config.app.errorLogSendTo.some((target) => target === 'master' || target === 'allMasters')) {
    state.pending = true
    try {
      state.notified = await sendOwnerText(detail)
    } catch {
      logger.warn('[推送] 主人通知发送失败')
    } finally {
      state.pending = false
    }
  }
  return cooldown
}

export async function pushRoundSucceeded(platform: Platform) {
  const state = incidents.get(platform)
  if (!state || state.pending || ++state.cleanRounds < 3) return
  if (state.notified) {
    state.pending = true
    try {
      if (!(await sendOwnerText(`${platformNames[platform]}推送轮询已连续完成 3 轮，此前累计 ${state.failures} 次订阅错误。`))) return
    } catch {
      return
    } finally {
      state.pending = false
    }
  }
  incidents.delete(platform)
}
