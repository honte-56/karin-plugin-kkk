import type { DataOf, LoadedRegistry } from '@karinjs/template-react'
import type { CommentItem } from '@template/template/bilibili/components/types'
import type { BilibiliDynamicData } from '@template/template/bilibili/dynamic/DYNAMIC_TYPE_DRAW/components/types'

import type { FeedPost } from './author-comment-watch'

export type OriginalRoute = Extract<keyof LoadedRegistry, `bilibili/dynamic/${string}`> &
  (
    | 'bilibili/dynamic/DYNAMIC_TYPE_DRAW'
    | 'bilibili/dynamic/DYNAMIC_TYPE_WORD'
    | 'bilibili/dynamic/DYNAMIC_TYPE_FORWARD'
    | 'bilibili/dynamic/DYNAMIC_TYPE_AV'
    | 'bilibili/dynamic/DYNAMIC_TYPE_ARTICLE'
  )
export type OriginalDynamic = { route: OriginalRoute; data: DataOf<LoadedRegistry[OriginalRoute]> }

/** 已推的旧动态只有摘要，沿用图文动态组件；未知统计保持空缺。 */
export function originalForComment(post: FeedPost, card: CommentItem): OriginalDynamic {
  if (post.original) return post.original
  const e = post.excerpt
  const author = card.isUP ? card : card.replies?.find((r) => r.isUP)
  const text = e?.text ?? { version: 1 as const, nodes: [] }
  const data: BilibiliDynamicData = {
    usernameMeta: { name: e?.author || author?.uname || '', vipStatus: author?.vipstatus ?? 0, nicknameColor: author?.unameColor ?? null },
    avatar_url: author?.avatar ?? '',
    frame: author?.frame,
    create_time: new Date(post.published * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16),
    dynamic_id: post.id,
    user_shortid: post.uid,
    share_url: 'https://t.bilibili.com/' + post.id,
    dynamicTYPE: '动态',
    render_time: '',
    dianzan: '—',
    pinglun: post.count ?? '—',
    share: '—',
    following_count: '—',
    fans: '—',
    total_favorited: '—',
    text: e?.quoted ? { ...text, nodes: [...text.nodes, { type: 'lineBreak' }, { type: 'text', text: e.quoted }] } : text,
    title: e?.title,
    imageLayout: 'auto',
    image_url: (e?.pictures ?? []).map((image_src) => ({ image_src })),
    additional: e?.reserved
      ? {
          type: 'ADDITIONAL_TYPE_RESERVE',
          reserve: { title: e.reserved.title, desc1: e.reserved.when, desc2: e.reserved.detail, buttonText: '预约' }
        }
      : undefined
  }
  return { route: 'bilibili/dynamic/DYNAMIC_TYPE_DRAW', data }
}
