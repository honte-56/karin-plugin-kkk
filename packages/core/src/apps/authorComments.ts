import karin from 'node-karin'

import { runCommentWatch, syncCommentSubscriptions } from '@/platform/bilibili/author-comments'

syncCommentSubscriptions()
export const authorComments = karin.task('B站主播评论', '25 * * * * *', runCommentWatch, { type: 'skip', log: false })
