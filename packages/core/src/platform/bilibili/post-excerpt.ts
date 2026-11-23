import type { RichTextDocument } from '@kkk/richtext'

import { buildBilibiliDynamicRichText } from './dynamic-text'

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

type Text = { text?: string; rich_text_nodes?: Parameters<typeof buildBilibiliDynamicRichText>[1] }
interface ExcerptModules {
  module_author: { name?: string }
  module_dynamic?: {
    desc?: Text | null
    major?: {
      opus?: { title?: string | null; summary?: Text; pics?: { url?: string }[] } | null
      draw?: { items?: { src?: string }[] } | null
      archive?: { title?: string; cover?: string } | null
      article?: { title?: string; covers?: string[] } | null
    } | null
    additional?: { reserve?: { title?: string; desc1?: { text?: string }; desc2?: { text?: string } } | null } | null
  }
}
export function postExcerpt(modules: ExcerptModules, original?: ExcerptModules): PostExcerpt {
  const dynamic = modules.module_dynamic
  const major = dynamic?.major
  const summary = major?.opus?.summary ?? dynamic?.desc
  const pictures = (
    major?.opus?.pics?.map((p) => p.url) ??
    major?.draw?.items?.map((p) => p.src) ??
    major?.article?.covers ?? [major?.archive?.cover]
  ).filter((url): url is string => !!url)
  const reserve = dynamic?.additional?.reserve
  const quoted = original?.module_dynamic
  const quote = quoted?.major?.opus?.summary?.text || quoted?.desc?.text || quoted?.major?.archive?.title || quoted?.major?.article?.title
  return {
    author: modules.module_author.name ?? '',
    text: buildBilibiliDynamicRichText(summary?.text ?? '', summary?.rich_text_nodes ?? []),
    title: major?.opus?.title || major?.archive?.title || major?.article?.title,
    pictures: pictures.slice(0, 6),
    pictureCount: pictures.length,
    reserved: reserve?.title ? { title: reserve.title, when: reserve.desc1?.text ?? '', detail: reserve.desc2?.text ?? '' } : undefined,
    quoted: quote ? [original?.module_author.name, quote].filter(Boolean).join(' · ') : undefined
  }
}
