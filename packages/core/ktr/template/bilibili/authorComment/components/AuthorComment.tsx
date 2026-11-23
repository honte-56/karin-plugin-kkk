import { renderRichTextToReact } from '@kkk/richtext'
import { CalendarDays, MessageCircle, Pin, ThumbsUp } from 'lucide-react'
import React from 'react'

import { generateQRCode } from '../../../../utils/QRcode'
import type { PosterProps } from '../../../types/ctx'
import type { SubCommentItem } from '../../components/types'
import type { AuthorCommentData, PostExcerpt } from './types'

const stamp = (seconds: number) => {
  const date = new Date(seconds * 1000)
  if (!Number.isFinite(date.getTime())) return ''
  return date
    .toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    .replace('/', '月')
    .replace(' ', '日 ')
}
const count = (n: number) => (n < 10000 ? String(n) : (n / 10000).toFixed(1).replace(/\.0$/, '') + '万')
const rich = (msg: SubCommentItem['message']) => renderRichTextToReact(msg, { mention: { className: 'ac-mention' } })
const src = (url?: string) => (url?.startsWith('//') ? 'https:' + url : url)

function Speaker({ row }: { row: SubCommentItem }) {
  return (
    <div className="ac-speaker">
      <span className="ac-avatar">
        {row.avatar && <img className="ac-face" src={src(row.avatar)} referrerPolicy="no-referrer" alt="" />}
        {row.frame && <img className="ac-frame" src={src(row.frame)} referrerPolicy="no-referrer" alt="" />}
      </span>
      <strong className={row.isUP ? 'ac-upname' : ''}>{row.uname}</strong>
      {row.isUP && <span className="ac-up">UP</span>}
    </div>
  )
}
function Message({ row, focus, pinned }: { row: SubCommentItem; focus: boolean; pinned?: boolean }) {
  return (
    <div className={focus ? 'ac-message ac-focus' : 'ac-message ac-parent'}>
      <div className="ac-byline">
        <Speaker row={row} />
        <time>{stamp(row.ctime)}</time>
      </div>
      <div className="ac-content">{rich(row.message)}</div>
      {row.pictures?.length > 0 && (
        <div className="ac-comment-media">
          {row.pictures.map((url, i) => (
            <img key={i} src={src(url)} referrerPolicy="no-referrer" alt="评论配图" />
          ))}
        </div>
      )}
      {(pinned || row.like > 0) && (
        <div className="ac-meta">
          {pinned && (
            <span className="ac-pin">
              <Pin />
              置顶
            </span>
          )}
          {row.like > 0 && (
            <span>
              <ThumbsUp />
              {count(row.like)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
function PreviewLine({ row }: { row: SubCommentItem }) {
  return (
    <div className="ac-line">
      <b className={row.isUP ? 'ac-upname' : ''}>
        {row.uname}
        {row.isUP && <small> UP</small>}
      </b>
      <span className="ac-colon">：</span>
      {rich(row.message)}
    </div>
  )
}
function Original({ post, published }: { post?: PostExcerpt; published: number }) {
  if (!post) return null
  return (
    <section className="ac-card ac-original">
      <div className="ac-bar">
        <span>原动态</span>
        <time>{stamp(published)}</time>
      </div>
      <div className="ac-excerpt">
        {post.title && <strong>{post.title}</strong>}
        {rich(post.text)}
      </div>
      {post.pictures.length > 0 && (
        <div className={'ac-gallery ac-gallery-' + Math.min(post.pictures.length, 3)}>
          {post.pictures.map((url, i) => (
            <div key={i}>
              <img src={src(url)} referrerPolicy="no-referrer" alt="动态配图" />
              {i === 5 && post.pictureCount > 6 && <span>+{post.pictureCount - 6}</span>}
            </div>
          ))}
        </div>
      )}
      {post.quoted && <div className="ac-quote">{post.quoted}</div>}
      {post.reserved && (
        <div className="ac-reserve">
          <CalendarDays />
          <div>
            <strong>{post.reserved.title.replace(/^直播预约[：:][\s]*/, '')}</strong>
            <div>{[post.reserved.when, post.reserved.detail].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      )}
    </section>
  )
}
export function AuthorComment({ data, ctx }: PosterProps<AuthorCommentData>) {
  const { card, post } = data
  const replies = card.replies ?? []
  const parents = new Set(replies.map((r) => r.parentId).filter(Boolean))
  const preview = card.previewReplies ?? []
  const inReplyTo = preview.filter((r) => r.commentId && parents.has(r.commentId))
  const remaining = preview.filter((r) => !inReplyTo.includes(r))
  return (
    <main className={'ac-poster' + (ctx.theme?.mode === 'dark' ? ' ac-dark' : '')}>
      <section className="ac-card ac-thread">
        <header className="ac-bar ac-event">
          <span>
            <i />
            {replies.length ? '主播回复' : '主播评论'}
          </span>
          <img src="/image/bilibili/bilibili.png" alt="哔哩哔哩" />
        </header>
        <Message row={card} focus={!replies.length} pinned={card.isTop} />
        {inReplyTo.length > 0 && (
          <div className="ac-preview">
            {inReplyTo.map((r, i) => (
              <PreviewLine key={i} row={r} />
            ))}
          </div>
        )}
        {replies.map((r, i) => (
          <Message key={r.commentId ?? i} row={r} focus />
        ))}
        {(remaining.length > 0 || card.replylength > 0) && (
          <div className="ac-preview">
            {remaining.length > 0 && (
              <>
                <h3>楼内预览</h3>
                {remaining.map((r, i) => (
                  <PreviewLine row={r} key={r.commentId ?? i} />
                ))}
              </>
            )}
            {card.replylength > 0 && (
              <div className="ac-total">
                <MessageCircle />共 <b>{count(card.replylength)}</b> 条回复
              </div>
            )}
          </div>
        )}
      </section>
      <Original post={post} published={data.published} />
      <footer className="ac-footer">
        <div>
          <strong>{post?.author || (card.isUP ? card.uname : replies[0]?.uname)}</strong>
          <span>长按识别二维码，查看原动态</span>
        </div>
        <img src={generateQRCode(data.share_url)} alt="原动态二维码" />
      </footer>
    </main>
  )
}
