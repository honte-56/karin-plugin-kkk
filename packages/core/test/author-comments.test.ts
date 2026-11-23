import { describe, expect, it, vi } from 'vitest'

import {
  deliverPost,
  discover,
  emptyWatch,
  reconcile,
  scanPost,
  type RootPage,
  type WatchedPost
} from '../src/platform/bilibili/author-comment-watch'
import type { CommentReply, SubReply } from '../src/platform/bilibili/comments'
vi.mock('../src/module/utils/Config', () => ({ Config: { bilibili: {} } }))
const start = 1795337760,
  uid = '672353429'
const row = (id: string, mid = uid, root = '0', children: SubReply[] = []) =>
  ({
    rpid_str: id,
    mid_str: mid,
    root_str: root,
    ctime: start + Number(id.slice(-2)),
    content: { message: '评论' + id },
    member: { mid, uname: mid },
    rcount: children.length,
    replies: children,
    up_action: { reply: children.some((c) => c.mid_str === uid) }
  }) as unknown as CommentReply
const child = (id: string) => row(id, uid, '100') as unknown as SubReply
const page = (...rows: CommentReply[]): RootPage => ({ rows, pinned: [], next: '', chronological: true })
function setup() {
  const state = emptyWatch()
  const targets = ['a:bot', 'b:bot']
  reconcile(state, new Map([[uid, targets]]), start)
  discover(state, { id: '1273454844042018873', oid: '1273454844042018873', uid, type: 17, published: start, count: 1 }, targets, start)
  const post = Object.values(state.posts)[0]
  const io = { roots: vi.fn(), replies: vi.fn() }
  const delivery = { allowed: () => true, render: vi.fn(async (_p, _id, card) => card), send: vi.fn(async (_target, _image) => true) }
  const save = vi.fn()
  return {
    state,
    post,
    io,
    delivery,
    save,
    tick: async (t: number) => {
      await scanPost(post, t, io, save)
      await deliverPost(post, delivery, save)
    }
  }
}
describe('主播评论和楼中楼', () => {
  it('只发现主评论，两个群共用同一张图', async () => {
    const { io, delivery, tick } = setup()
    io.roots.mockResolvedValue(page(row('100')))
    io.replies.mockResolvedValue({ rows: [], size: 20, count: 0 })
    await tick(start + 12)
    expect(delivery.render).toHaveBeenCalledTimes(1)
    expect(delivery.send).toHaveBeenCalledTimes(2)
    expect(delivery.send.mock.calls[0][1].replies).toEqual([])
  })
  it.each([uid, '13579'])('主评论作者 %s：即使在置顶与普通列表重复出现，也只渲染一张带主播回复的图', async (mid) => {
    const { io, delivery, tick } = setup()
    const root = row('100', mid, '0', [child('101'), row('102', '200', '100') as unknown as SubReply])
    root.rcount = 203
    io.roots.mockResolvedValue({ ...page(root), pinned: [root] })
    await tick(start + 240)
    expect(io.replies).not.toHaveBeenCalled()
    expect(delivery.render).toHaveBeenCalledTimes(1)
    expect(delivery.send.mock.calls[0][1]).toMatchObject({
      isUP: mid === uid,
      replies: [
        { isUP: true, commentId: '101' },
        { isUP: false, commentId: '102' }
      ],
      replylength: 203
    })
  })
  it('先发主评论，后发带主评论的回复；失败群重启后补发，已成功的群不重发', async () => {
    const { post, io, delivery, tick, save } = setup()
    io.roots.mockResolvedValueOnce(page(row('100')))
    await tick(start + 12)
    post.count = 2
    io.roots.mockResolvedValueOnce(page(row('100', uid, '0', [child('101')])))
    delivery.send.mockImplementationOnce(async () => true).mockImplementationOnce(async () => false)
    await tick(start + 312)
    expect(delivery.render).toHaveBeenCalledTimes(2)
    const restarted: WatchedPost = JSON.parse(JSON.stringify(post))
    delivery.send.mockClear()
    await deliverPost(restarted, delivery, save)
    await deliverPost(restarted, delivery, save)
    expect(delivery.send).toHaveBeenCalledTimes(1)
    expect(delivery.send.mock.calls[0]).toMatchObject(['b:bot', { isUP: true, replies: [{ isUP: true }] }])
  })
  it('普通粉丝、点赞不触发；评论数不变只在整点间隔兜底，超期移除', async () => {
    const { io, post, state, delivery, tick } = setup()
    const fan = row('100', '88')
    fan.up_action.like = true
    io.roots.mockResolvedValue(page(fan))
    await tick(start)
    await tick(start + 300)
    expect(io.roots).toHaveBeenCalledTimes(1)
    await tick(start + 3600)
    expect(io.roots).toHaveBeenCalledTimes(2)
    expect(io.replies).not.toHaveBeenCalled()
    expect(delivery.render).not.toHaveBeenCalled()
    expect(discover(state, { ...post, id: '999', published: start - 1 }, post.targets, start)).toBe(false)
    reconcile(state, new Map([[uid, post.targets]]), start + 86400)
    expect(state.posts).toEqual({})
  })
  it('从上次游标继续查，识别沉在粉丝楼里的回复；重复发现只按回执投递一次', async () => {
    const { post, io, delivery, tick } = setup()
    const fan = row('100', '88')
    fan.rcount = 43
    fan.up_action.reply = true
    io.roots.mockResolvedValueOnce({ ...page(row('400', '88')), next: 'page-2' }).mockResolvedValueOnce(page(fan))
    io.replies.mockResolvedValueOnce({ count: 43, size: 20, rows: [] }).mockResolvedValueOnce({ count: 43, size: 20, rows: [child('101')] })
    await tick(start)
    await tick(start + 60)
    await tick(start + 120)
    expect(io.roots.mock.calls[1][1]).toBe('page-2')
    expect(io.replies.mock.calls.map((args) => args[2])).toEqual([3, 2])
    expect(delivery.send.mock.calls[0][1]).toMatchObject({ uname: '88', replies: [{ uname: uid }] })
    expect(post.delivered['a:bot']).toEqual(['101'])
  })
})
