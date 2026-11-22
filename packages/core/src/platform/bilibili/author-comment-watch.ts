import type { CommentItem, SubCommentItem } from '@template/template/bilibili/components/types'

import type { bilibiliPushItem } from '@/types/config/pushlist'

import { buildCommentItem, buildSubCommentItem, type CommentReply, type SubReply } from './comments'

const HOUR = 3600
const DAY = 24 * HOUR
const PAGE_SIZE = 20
type Thread = {
  card: CommentItem
  children: Record<string, SubCommentItem>
  page: number
  high: number
  through: number
  checked: number
}
export interface FeedPost {
  id: string
  uid: string
  oid: string
  type: number
  published: number
  imageCount?: number
  count?: number
}
export interface WatchedPost extends FeedPost {
  targets: string[]
  next: number
  checked: number
  checkedCount?: number
  cursor: string
  peek?: number
  since: number
  threads: Record<string, Thread>
  delivered: Record<string, string[]>
  lastTurn: number
}
export interface WatchState {
  enabled: Record<string, number>
  posts: Record<string, WatchedPost>
  cooldown: number
}
export const emptyWatch = (): WatchState => ({ enabled: {}, posts: {}, cooldown: 0 })
const validId = (id: unknown) => typeof id === 'string' && /^[1-9]\d*$/.test(id)
export const subscriptions = (rows: bilibiliPushItem[]) =>
  new Map(rows.filter((r) => r.authorComments && r.switch !== false && r.group_id.length).map((r) => [String(r.host_mid), r.group_id]))

export function reconcile(state: WatchState, active: Map<string, string[]>, now: number) {
  let changed = false
  for (const uid of active.keys())
    if (!(uid in state.enabled)) {
      state.enabled[uid] = now
      changed = true
    }
  for (const uid of Object.keys(state.enabled))
    if (!active.has(uid)) {
      delete state.enabled[uid]
      changed = true
    }
  for (const [id, post] of Object.entries(state.posts)) {
    if (!active.has(post.uid) || now >= post.published + DAY) {
      delete state.posts[id]
      changed = true
    }
  }
  return changed
}

export function discover(state: WatchState, feed: FeedPost, targets: string[], now: number) {
  const start = state.enabled[feed.uid]
  if (
    start === undefined ||
    !validId(feed.id) ||
    !validId(feed.oid) ||
    !(feed.type > 0) ||
    !Number.isFinite(feed.published) ||
    feed.published < start ||
    now >= feed.published + DAY ||
    feed.published > now + 60
  )
    return false
  const post = state.posts[feed.id]
  if (post) {
    if (post.count === feed.count) return false
    post.count = feed.count
  } else {
    state.posts[feed.id] = {
      ...feed,
      targets: [...new Set(targets)],
      next: 0,
      checked: 0,
      cursor: '',
      since: 0,
      threads: {},
      delivered: {},
      lastTurn: 0
    }
  }
  return true
}

export interface RootPage {
  rows: CommentReply[]
  pinned: CommentReply[]
  next: string
  chronological: boolean
}
export interface ChildPage {
  rows: SubReply[]
  count: number
  size: number
}
type ScanIO = {
  roots: (p: FeedPost, cursor: string) => Promise<RootPage>
  replies: (p: FeedPost, root: string, page: number) => Promise<ChildPage>
}
function idOf(r: CommentReply | SubReply) {
  return validId(r.rpid_str) ? r.rpid_str : Number.isSafeInteger(r.rpid) && r.rpid > 0 ? String(r.rpid) : ''
}
const authored = (r: CommentReply | SubReply, uid: string) => String(r.mid_str || r.member?.mid || r.mid) === uid

function rememberChild(post: WatchedPost, root: string, thread: Thread, row: SubReply) {
  const id = idOf(row)
  if (!id || !row.member || !row.content || row.invisible || !authored(row, post.uid) || String(row.root_str || row.root) !== root) return
  thread.children[id] = { ...buildSubCommentItem(row, post.uid, []), isUP: true }
}

function rememberRoot(post: WatchedPost, row: CommentReply, pinned: boolean) {
  const id = idOf(row)
  if (!id || !row.member || !row.content || row.invisible) return
  const own = authored(row, post.uid)
  const preview = row.replies ?? []
  if (!own && !row.up_action?.reply && !preview.some((r) => authored(r, post.uid)) && !post.threads[id]) return
  const thread = (post.threads[id] ??= { card: {} as CommentItem, children: {}, page: 0, high: 0, through: 0, checked: 0 })
  thread.card = { ...buildCommentItem({ ...row, replies: [] }, post.uid, [], { id: 0, isTop: pinned }), isUP: own }
  for (const child of preview) rememberChild(post, id, thread, child)
  // 预览已经覆盖整楼，就无需再请求楼中楼接口。
  if (preview.length >= row.rcount) {
    thread.through = row.rcount
    thread.page = 0
  }
}

// 每次最多一页主评论、两页楼中楼。偏移量随状态落盘，下轮继续。
export async function scanPost(post: WatchedPost, now: number, io: ScanIO, checkpoint: () => void) {
  if (now >= post.published + DAY || now < post.next) return
  const interval = now - post.published < 2 * HOUR ? 300 : 1800
  const hourly = now - post.checked >= HOUR
  const scanning = Boolean(post.cursor)
  const needsMain = !post.checked || scanning || hourly || post.count === undefined || post.count !== post.checkedCount
  const deep = Object.values(post.threads).some((t) => t.page > 0 || t.card.replylength > t.through)
  if (!needsMain && !deep) {
    post.next = Math.min(now + interval, post.checked + HOUR)
    checkpoint()
    return
  }
  const previewHits = new Set<string>()
  if (needsMain) {
    // 持续有新评论时仍按原频率看首页，长线程的旧分页游标继续保存。
    const sinceHead = now - (post.peek ?? post.checked)
    const peek = scanning && (sinceHead >= HOUR || (post.count !== post.checkedCount && sinceHead >= interval))
    const page = await io.roots(post, peek ? '' : post.cursor)
    if (peek) post.peek = now
    const visible = new Set<string>()
    for (const [rows, pinned] of [
      [page.rows, false],
      [page.pinned, true]
    ] as const) {
      for (const row of rows) {
        const id = idOf(row)
        const before = Object.keys(post.threads[id]?.children ?? {}).length
        rememberRoot(post, row, pinned)
        visible.add(id)
        if (Object.keys(post.threads[id]?.children ?? {}).length > before) previewHits.add(id)
      }
    }
    for (const [id, t] of Object.entries(post.threads)) {
      // 已知的作者楼沉出首页后也要复查；不展开刚刚已经拿到作者回复的预览。
      if (
        !t.page &&
        !previewHits.has(id) &&
        (t.card.replylength > t.through ||
          (!scanning && !visible.has(id) && now - t.checked >= interval) ||
          (hourly && t.card.replylength > 0 && now - t.checked >= HOUR))
      ) {
        t.page = Math.max(1, Math.ceil(t.card.replylength / PAGE_SIZE))
        t.high = t.card.replylength
      }
    }
    const overlap = page.chronological && page.rows.some((r) => Number(r.ctime) < post.since)
    const next = page.next && page.next !== post.cursor && !overlap && page.rows.length ? page.next : ''
    if (!scanning) {
      post.checkedCount = post.count
      // 只用一次检查开始的时间作边界。翻页期间发布的评论留给下一轮。
      post.checked = now
      post.peek = now
    }
    if (!peek) {
      post.cursor = next
      if (!next) post.since = post.checked - 60
    }
    checkpoint()
  }
  const candidates = Object.entries(post.threads)
    .filter(([id, t]) => !previewHits.has(id) && (t.page || t.card.replylength > t.through))
    .sort(([, a], [, b]) => a.checked - b.checked)
  for (const [root, t] of candidates.slice(0, 2)) {
    const pn = t.page || Math.max(1, Math.ceil(t.card.replylength / PAGE_SIZE))
    if (!t.page) t.high = t.card.replylength
    const page = await io.replies(post, root, pn)
    for (const row of page.rows) rememberChild(post, root, t, row)
    t.card.replylength = page.count
    const last = Math.max(1, Math.ceil(page.count / page.size))
    if (last > Math.max(1, Math.ceil(t.high / page.size))) {
      t.high = page.count
      t.page = last
    } else if (pn > last) {
      t.high = page.count
      t.page = last
    } else if (pn > Math.max(1, Math.ceil(t.through / page.size))) t.page = pn - 1
    else {
      t.page = 0
      t.through = Math.min(t.high, page.count)
    }
    t.checked = now
    checkpoint()
  }
  const more = post.cursor || candidates.length > 2 || Object.values(post.threads).some((t) => t.page)
  post.next = now + (more ? 60 : interval)
  checkpoint()
}

export type DeliveryIO<Image> = {
  allowed: (target: string) => boolean
  render: (p: FeedPost, root: string, card: CommentItem, target: string) => Promise<Image>
  send: (target: string, image: Image) => Promise<boolean>
}
// 待发集合由已发现的发言减去每个群自己的回执得到。主评论作为上下文可重复出现。
export async function deliverPost<Image>(post: WatchedPost, io: DeliveryIO<Image>, checkpoint: () => void) {
  for (const [root, t] of Object.entries(post.threads)) {
    const rendered = new Map<string, Image>()
    for (const target of post.targets) {
      const sent = post.delivered[target] ?? []
      const children = Object.entries(t.children)
        .filter(([id]) => !sent.includes(id))
        .sort(([, a], [, b]) => a.ctime - b.ctime)
      const ids = children.map(([id]) => id)
      if (t.card.isUP && !sent.includes(root)) ids.unshift(root)
      if (!ids.length || !io.allowed(target)) continue
      const signature = children.map(([id]) => id).join(',')
      let image = rendered.get(signature)
      if (!image) {
        image = await io.render(post, root, { ...t.card, replies: children.map(([, c]) => c) }, target)
        rendered.set(signature, image)
      }
      if (io.allowed(target) && (await io.send(target, image))) {
        post.delivered[target] = [...sent, ...ids]
        checkpoint()
      }
    }
  }
}
