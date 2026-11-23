import fs from 'node:fs'
import path from 'node:path'

import type { DataOf, LoadedRegistry } from '@karinjs/template-react'
import karin, { logger, type ImageElement, type Message } from 'node-karin'
import { karinPathBase } from 'node-karin/root'

import { getAmagiClient, AmagiError } from '@/module/utils/amagiClient'
import { Config } from '@/module/utils/Config'
import { pushCoolingDown } from '@/module/utils/pushFailures'
import { Render } from '@/module/utils/Render'
import { Root } from '@/root'

import {
  acknowledgeComments,
  pendingComments,
  deliverPost,
  discover,
  emptyWatch,
  reconcile,
  scanPost,
  subscriptions,
  type FeedPost,
  type WatchedPost,
  type WatchState
} from './author-comment-watch'
import type { CommentReply, SubReply } from './comments'
import { originalForComment, type OriginalRoute } from './original-dynamic'
import { postExcerpt } from './post-excerpt'

const now = () => Math.floor(Date.now() / 1000)
const file = () => path.join(karinPathBase, Root.pluginName, 'data', 'author-comments.json')
let loaded: WatchState | undefined
let running = false
type CommentImage = { key: string; elements: ImageElement[] }
const retryImages = new Map<string, { image: CommentImage; expires: number }>()

function state() {
  if (!loaded) loaded = fs.existsSync(file()) ? (JSON.parse(fs.readFileSync(file(), 'utf8')) as WatchState) : emptyWatch()
  return loaded
}
function save() {
  const filename = file()
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename + '.tmp', JSON.stringify(state()), { mode: 0o600 })
  fs.renameSync(filename + '.tmp', filename)
}
function enabled() {
  return subscriptions(Config.bilibili.push.switch ? (Config.pushlist.bilibili ?? []) : [])
}
export function syncCommentSubscriptions() {
  if (reconcile(state(), enabled(), now())) save()
}

/** 保存这条动态实际使用的模板和入参，评论推送直接重用。 */
export function rememberOriginal<P extends OriginalRoute>(id: string, route: P, data: DataOf<LoadedRegistry[P]>) {
  const post = state().posts[id]
  if (post && !post.original) {
    post.original = { route, data }
    save()
  }
}

/** 从现有轮询结果提取本条动态自己的评论区；转发动态不读取 orig。 */
interface Dynamic {
  id_str: string
  type: string
  basic?: { comment_id_str?: string; comment_type?: number }
  orig?: { modules?: Parameters<typeof postExcerpt>[0] } | null
  modules: Parameters<typeof postExcerpt>[0] & {
    module_author: { mid?: string | number; pub_ts: number | string }
    module_stat?: { comment?: { count?: number } }
    module_dynamic?: { major?: { draw?: { items?: unknown[] } } }
  }
}
export function observeCommentPosts(items: { host_mid: number; Dynamic_Data: Dynamic }[]) {
  const active = enabled()
  const current = now()
  let changed = reconcile(state(), active, current)
  for (const { host_mid, Dynamic_Data: d } of items) {
    const uid = String(host_mid),
      targets = active.get(uid)
    if (!targets || d.type === 'DYNAMIC_TYPE_LIVE_RCMD' || String(d.modules.module_author.mid) !== uid) continue
    const count = d.modules.module_stat?.comment?.count
    const post = {
      uid,
      id: d.id_str,
      oid: d.basic?.comment_id_str ?? '',
      type: Number(d.basic?.comment_type),
      published: Number(d.modules.module_author.pub_ts),
      excerpt: postExcerpt(d.modules, d.orig?.modules),
      imageCount: d.modules.module_dynamic?.major?.draw?.items?.length ?? 0,
      count: typeof count === 'number' ? count : undefined
    }
    if (discover(state(), post, targets, current)) changed = true
  }
  if (changed) save()
}

async function readPage<T>(endpoint: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const res = await getAmagiClient().bilibili.request.get<{ code: number; data: T }>(
    'https://api.bilibili.com/x/v2/reply/' + endpoint + '?' + query,
    { timeout: 8000, amagi: { cookie: false } }
  )
  if (!res.success) throw new AmagiError(res)
  if (res.data?.code !== 0 || !res.data.data) throw Object.assign(new Error('评论分页响应无效'), { code: res.data?.code })
  return res.data.data
}
export const commentPages = {
  async roots(p: FeedPost, cursor: string) {
    const data = await readPage<{
      replies?: CommentReply[]
      top?: { upper?: CommentReply }
      top_replies?: CommentReply[]
      cursor: { is_end: boolean; mode: number; pagination_reply?: { next_offset?: string } }
    }>('main', { type: p.type, oid: p.oid, mode: 2, pagination_str: JSON.stringify({ offset: cursor }) })
    if (!data.cursor) throw new Error('评论列表缺少游标')
    return {
      rows: data.replies ?? [],
      pinned: [...(data.top_replies ?? []), ...(data.top?.upper ? [data.top.upper] : [])],
      next: data.cursor.is_end ? '' : (data.cursor.pagination_reply?.next_offset ?? ''),
      chronological: data.cursor.mode === 2
    }
  },
  async replies(p: FeedPost, root: string, pn: number) {
    const data = await readPage<{ replies?: SubReply[]; page: { count: number; size: number } }>('reply', {
      type: p.type,
      oid: p.oid,
      root,
      pn,
      ps: 20
    })
    if (!Number.isInteger(data.page?.count) || !(data.page?.size > 0)) throw new Error('楼中楼缺少分页信息')
    return { rows: data.replies ?? [], count: data.page.count, size: data.page.size }
  }
}
// 即时首查与 :25 定时任务共用请求、冷却及每分钟两个动态的预算。
const scans = new Map<string, Promise<void>>()
let budgetMinute = -1
let checkedThisMinute = 0
function checkDue(post: WatchedPost): Promise<void> {
  const existing = scans.get(post.id)
  if (existing) return existing
  const time = now()
  const minute = Math.floor(time / 60)
  if (minute !== budgetMinute) {
    budgetMinute = minute
    checkedThisMinute = 0
  }
  if (
    post.next > time ||
    time >= post.published + 86400 ||
    state().cooldown > time ||
    pushCoolingDown('bilibili') ||
    checkedThisMinute >= 2
  )
    return Promise.resolve()
  checkedThisMinute++
  post.lastTurn = time
  const scan = scanPost(post, time, commentPages, save)
    .catch((error) => {
      const e = error as { kind?: string; code?: number; httpStatus?: number }
      if (e.kind === 'risk' || [-352, -412, 403, 412, 429].includes(e.code ?? 0) || [403, 412, 429].includes(e.httpStatus ?? 0))
        state().cooldown = now() + 600
      post.next = e.code === 12061 ? post.published + 86400 : now() + 300
      save()
      logger.warn(`[主播评论] 动态 ${post.id} 检查失败（${e.code ?? e.kind ?? '网络错误'}），保留进度`)
    })
    .finally(() => scans.delete(post.id))
  scans.set(post.id, scan)
  return scan
}

export async function firstCommentForDynamic(id: string) {
  const post = state().posts[id]
  if (!post || now() >= post.published + 86400 || !enabled().has(post.uid)) return
  if (!post.checked || scans.has(id)) await checkDue(post)
  return (target: string) => {
    const receipt = post.firstReceipts?.[target]
    if (receipt) return { receipt }
    if (!post.targets.includes(target) || !enabled().get(post.uid)?.includes(target)) return
    const entry = pendingComments(post, target).next().value
    if (!entry) return
    return {
      ...entry,
      acknowledge: (receipt: string) => {
        post.firstReceipts ??= {}
        post.firstReceipts[target] = receipt
        acknowledgeComments(post, target, entry.ids, save)
      }
    }
  }
}

export async function runCommentWatch() {
  if (running) return
  running = true
  try {
    syncCommentSubscriptions()
    const store = state()
    for (const [key, cached] of retryImages) if (cached.expires <= now()) retryImages.delete(key)
    // 限制为每分钟最多两个动态，每个动态至多三次分页请求。
    const posts = Object.values(store.posts).sort((a, b) => a.lastTurn - b.lastTurn)
    for (const post of posts) {
      if (now() >= post.published + 86400) continue
      await checkDue(post)
      const ready = new Set<string>()
      for (const target of post.targets) {
        if (pendingComments(post, target).next().done) continue
        const [group, bot] = target.split(':')
        if (!karin.getAllBotID().includes(bot) || !enabled().get(post.uid)?.includes(target)) continue
        // 新动态仍在首次发送或等待失败群重试时，由动态任务拥有该群的发送权。
        const { bilibiliDB } = await import('@/module/db')
        if (await bilibiliDB.isDynamicPushed(post.id, Number(post.uid), group)) ready.add(target)
      }
      const allowed = (target: string) =>
        ready.has(target) &&
        now() < post.published + 86400 &&
        (enabled().get(post.uid)?.includes(target) ?? false) &&
        karin.getAllBotID().includes(target.split(':')[1])
      await deliverPost<CommentImage>(
        post,
        {
          allowed,
          render: async (p, root, card, target, signature) => {
            const key = p.id + ':' + root + ':' + signature
            const cached = retryImages.get(key)
            if (cached) return cached.image
            const botId = target.split(':')[1]
            const url = `https://t.bilibili.com/${p.id}#reply${root}`
            const original = originalForComment(p, card)
            const image = await Render(
              { bot: karin.getBot(botId), selfId: botId } as Message,
              original.route,
              {
                ...original.data,
                authorComment: card,
                render_time: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }),
                share_url: url
              },
              { singlePage: true }
            )
            if (image.length !== 1) throw new Error('评论图未生成')
            return { key, elements: image }
          },
          send: async (target, image) => {
            const [group, bot] = target.split(':')
            const result = await karin.sendMsg(bot, karin.contactGroup(group), image.elements, { retryCount: 0 }).catch(() => undefined)
            if (result?.messageId) {
              logger.info(`[主播评论] 动态 ${post.id} 评论图已送达`)
              return true
            }
            if (retryImages.size >= 4 && !retryImages.has(image.key)) retryImages.delete(retryImages.keys().next().value!)
            retryImages.set(image.key, { image, expires: now() + 600 })
            logger.warn(`[主播评论] 动态 ${post.id} 评论图未取得回执，保留待发记录`)
            return false
          }
        },
        save
      ).catch(() => logger.warn(`[主播评论] 动态 ${post.id} 图片投递未完成，下轮重试`))
    }
  } finally {
    running = false
  }
}
