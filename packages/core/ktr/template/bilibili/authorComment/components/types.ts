import type { RichTextDocument } from '@kkk/richtext'

import type { CommentItem } from '../../components/types'

/** 监听动态时保存的公开上下文。旧监听记录可能只有动态链接。 */
export interface PostExcerpt {
  author: string
  text: RichTextDocument
  title?: string
  pictures: string[]
  pictureCount: number
  reserved?: { title: string; when: string; detail: string }
  quoted?: string
}

export interface AuthorCommentData {
  card: CommentItem
  post?: PostExcerpt
  published: number
  share_url: string
}
