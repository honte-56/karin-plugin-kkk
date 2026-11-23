import { defineTemplate } from '@karinjs/template-react'

import { AuthorComment } from './components/AuthorComment'
import type { AuthorCommentData } from './components/types'

export default defineTemplate({
  name: '主播评论与原动态',
  description: '主播新发言、楼内预览及原动态',
  component: AuthorComment,
  validate: (data): data is AuthorCommentData => !!data && typeof data === 'object' && 'card' in data && 'share_url' in data
})
