import { describe, expect, it, vi } from 'vitest'

vi.mock('node-karin', () => ({ logger: { debug: vi.fn(), warn: vi.fn() }, segment: {} }))

import { buildBilibiliForwardContent } from '../src/platform/bilibili/dynamic-text'

describe('B站转发正文', () => {
  it('没有转发文案时仍然生成可渲染的空正文', () => {
    const result = buildBilibiliForwardContent({ desc: null, topic: null })
    expect(result.text.nodes).toEqual([])
    expect(result.imgList).toEqual([])
  })

  it('只有话题、没有正文对象时保留话题', () => {
    const result = buildBilibiliForwardContent({ desc: null, topic: { id: 42, name: '今日话题', jump_url: '' } })
    expect(result.text.nodes).toEqual([{ type: 'topic', text: '今日话题' }])
    expect(result.imgList).toEqual([])
  })

  it('空字符串正文可以正常渲染', () => {
    const result = buildBilibiliForwardContent({ desc: { text: '', rich_text_nodes: [] }, topic: null })
    expect(result.text.nodes).toEqual([])
  })

  it('保留提及、图片节点和所有附图，重复处理不修改原始正文', () => {
    const md = {
      desc: {
        text: '@作者 查看图片',
        rich_text_nodes: [
          { type: 'RICH_TEXT_NODE_TYPE_AT', orig_text: '@作者', text: '@作者', rid: '123' },
          {
            type: 'RICH_TEXT_NODE_TYPE_VIEW_PICTURE',
            orig_text: '查看图片',
            text: '查看图片',
            pics: [{ src: 'https://example.com/1.png' }, { src: 'https://example.com/2.png' }]
          }
        ]
      },
      topic: { id: 42, name: '今日话题', jump_url: '' }
    }
    const original = structuredClone(md)
    const result = buildBilibiliForwardContent(md)
    expect(result.text.nodes).toEqual(
      expect.arrayContaining([
        { type: 'topic', text: '今日话题' },
        expect.objectContaining({ type: 'at', text: '@作者' }),
        expect.objectContaining({ type: 'viewPicture', text: '查看图片' })
      ])
    )
    expect(result.imgList).toEqual(['https://example.com/1.png', 'https://example.com/2.png'])
    expect(buildBilibiliForwardContent(md)).toEqual(result)
    expect(md).toEqual(original)
  })

  it('没有话题时保留普通转发文案', () => {
    const result = buildBilibiliForwardContent({ desc: { text: '转发动态', rich_text_nodes: [] }, topic: null })
    expect(result.text.nodes).toEqual([{ type: 'text', text: '转发动态' }])
  })
})
