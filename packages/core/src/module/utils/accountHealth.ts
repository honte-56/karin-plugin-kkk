import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { logger } from 'node-karin'
import { karinPathBase } from 'node-karin/root'

import { Root } from '../../root'
import { Config } from './Config'

export const platformNames = { bilibili: 'B站', douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书' } as const
export type Platform = keyof typeof platformNames
type Status = 'login' | 'expired' | 'guest' | 'unknown'
interface RecordState {
  key: string
  status: Status
  checked: number
  lastKnown?: Status
  alerted: boolean
  pending?: 'expired' | 'guest' | 'recovered'
}

const platforms = Object.keys(platformNames) as Platform[]
const fingerprint = (cookie: string) => cookie ? createHash('sha256').update(cookie).digest('hex') : ''
const currentKey = (p: Platform) => fingerprint(Config.amagi.cookies[p])
const file = () => path.join(karinPathBase, Root.pluginName, 'data', 'account-health.json')
let records: Partial<Record<Platform, RecordState>> | undefined
const state = () => {
  if (!records) records = fs.existsSync(file()) ? JSON.parse(fs.readFileSync(file(), 'utf8')) : {}
  return records!
}
const save = () => {
  const name = file()
  fs.mkdirSync(path.dirname(name), { recursive: true })
  fs.writeFileSync(name + '.tmp', JSON.stringify(state()), { mode: 0o600 })
  fs.renameSync(name + '.tmp', name)
}
const running = new Map<Platform, { key: string; result: Promise<Status> }>()
const sending = new Set<Platform>()

export async function sendOwnerText(text: string) {
  const { getReachableMasterBots } = await import('./bot')
  const { default: karin, segment } = await import('node-karin')
  const [target] = await getReachableMasterBots()
  if (!target) return false
  const result = await karin.sendMaster(target.bot.account.selfId, target.master, [segment.text(text)])
  return Boolean(result)
}

async function deliver(p: Platform) {
  const entry = state()[p]
  if (!entry?.pending || sending.has(p) || currentKey(p) !== entry.key) return
  sending.add(p)
  const kind = entry.pending
  const name = platformNames[p]
  try {
    const message = kind === 'recovered' ? `${name}账号登录已恢复。` :
      `${name}账号${kind === 'guest' ? '已退回游客态' : '登录已失效'}，请私聊发送 #${name}登录 重新扫码。`
    if (!await sendOwnerText(message)) return
    const latest = state()[p]
    if (!latest) return
    latest.alerted = kind !== 'recovered'
    if (latest.pending === kind) delete latest.pending
    if (latest.alerted && latest.lastKnown === 'login') latest.pending = 'recovered'
    save()
  } catch {
    logger.warn(`[账号探活] ${name}通知发送失败，稍后重试`)
  } finally {
    sending.delete(p)
  }
}

function record(p: Platform, key: string, status: Status) {
  if (!key || currentKey(p) !== key) return
  const previous = state()[p]
  const entry: RecordState = previous?.key === key ? previous : { key, status, checked: 0, alerted: previous?.alerted ?? false }
  if (status === 'expired' || (status === 'guest' && entry.lastKnown === 'login')) {
    if (!entry.alerted) entry.pending = status
    else delete entry.pending
  } else if (status === 'login') {
    if (entry.alerted) entry.pending = 'recovered'
    else delete entry.pending
  }
  entry.status = status
  if (status !== 'unknown') entry.lastKnown = status
  entry.checked = Date.now()
  state()[p] = entry
  save()
  logger.info(`[账号探活] ${platformNames[p]} ${status}`)
}

export function indicatesExpired(p: Platform, code: unknown, endpoint: string) {
  const n = Number(code)
  return (p === 'bilibili' && n === -101) || (p === 'xiaohongshu' && n === -100) ||
    (p === 'kuaishou' && n === 109 && endpoint === 'kuaishou.loginUserProfile')
}

export async function observeExpired(p: Platform, cookie: string) {
  const key = fingerprint(cookie)
  if (!key || key !== currentKey(p)) return
  running.delete(p)
  if (state()[p]?.key !== key || state()[p]?.status !== 'expired') record(p, key, 'expired')
  await deliver(p)
}

async function probe(p: Platform, cookie: string): Promise<Status> {
  if (p === 'xiaohongshu') return 'unknown'
  const { getAmagiClient, reloadAmagiConfig } = await import('./amagiClient')
  reloadAmagiConfig()
  const client = getAmagiClient()
  if (p === 'douyin') {
    const { state } = await client.douyin.credentials.checkLoginState(cookie, { force: true, requestConfig: { headers: { 'User-Agent': Config.amagi['User-Agent'] }, proxy: Config.amagi.proxy?.switch ? Config.amagi.proxy : false } })
    return state === 'unusable' ? 'unknown' : state
  }
  if (p === 'bilibili') {
    const r = await client.bilibili.fetcher.fetchLoginStatus()
    if (!r.success) return indicatesExpired(p, r.error.platform?.code, r.meta.endpoint) ? 'expired' : 'unknown'
    return r.data.data?.isLogin === true ? 'login' : r.data.data?.isLogin === false ? 'expired' : 'unknown'
  }
  const r = await client.kuaishou.fetcher.fetchLoginUserProfile({})
  if (!r.success) return indicatesExpired(p, r.error.platform?.code, r.meta.endpoint) ? 'expired' : 'unknown'
  return Number(r.data?.result) === 1 ? 'login' : 'unknown'
}

export async function checkAccount(p: Platform, force = false): Promise<Status> {
  const cookie = Config.amagi.cookies[p]
  const key = fingerprint(cookie)
  if (!key) {
    running.delete(p)
    if (state()[p]) { delete state()[p]; save() }
    return 'unknown'
  }
  const active = running.get(p)
  if (active?.key === key) return active.result
  const entry = state()[p]
  if (!force && entry?.key === key && (p === 'xiaohongshu' || entry.status !== 'unknown' || Date.now() - entry.checked < 30 * 60_000)) { await deliver(p); return entry.status }
  const job = async (): Promise<Status> => {
    let status: Status = 'unknown'
    try { status = await probe(p, cookie) } catch { /* 网络错误不能证明登录失效 */ }
    if (running.get(p)?.result !== result || currentKey(p) !== key) return 'unknown'
    record(p, key, status)
    await deliver(p)
    return status
  }
  const result: Promise<Status> = Promise.resolve().then(job)
  running.set(p, { key, result })
  try { return await result } finally { if (running.get(p)?.result === result) running.delete(p) }
}

export async function checkChangedAccounts() {
  for (const p of platforms) await checkAccount(p)
}

export async function loginReceipt(p: Platform) {
  const labels = { login: '已登录', guest: '当前为游客', expired: '登录已失效', unknown: '暂时无法确认' }
  const status = await checkAccount(p)
  return `凭据已保存。账号状态：${labels[status]}` +
    (p === 'bilibili' ? (Config.amagi.cookies.bilibiliRefreshToken ? '；支持续期。' : '；无续期令牌，下次需扫码。') : '。')
}
