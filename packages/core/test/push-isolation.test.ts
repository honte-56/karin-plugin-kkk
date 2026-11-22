import { expect, it, vi } from 'vitest'
import type { bilibiliPushItem } from '../src/types/config/pushlist'

const m = vi.hoisted(() => ({ read: vi.fn(), sent: vi.fn().mockResolvedValue(true), pushed: vi.fn(), log: new Proxy({}, {get: () => () => ''}) }))
vi.mock('node-karin', () => ({ common: { sleep: vi.fn() }, logger: m.log, default: {} }))
vi.mock('@/module', () => ({ Base: class { amagi = { bilibili: { fetcher: {fetchUserDynamicList: m.read} } } }, baseHeaders: {}, bilibiliDB: {isDynamicPushed: m.pushed} }))
vi.mock('@/module/utils/ContentDelivery', () => ({}))
vi.mock('@/module/utils/Config', () => ({Config: {amagi:{cookies:{bilibili:'fixture'}},app:{errorLogSendTo:['master']}}}))
vi.mock('@/module/utils/logger', () => ({logger:m.log}))
vi.mock('@/module/utils/accountHealth', () => ({platformNames:{bilibili:'B站'},sendOwnerText:m.sent}))
vi.mock('@/module/utils/amagiClient', () => ({bilibiliFetcher:{}}))
vi.mock('@/platform/bilibili', () => ({TimeFormatter:{toDateTime:() => ''}}))
import { Bilibilipush } from '../src/platform/bilibili/push'

it('本轮保留 A、B 风控后暂停轮询，恢复后走原来的投递去重',async () => {
  vi.useFakeTimers()
  try {
    const subscriptions: bilibiliPushItem[]=[1,2,3].map(host_mid=>({host_mid,group_id:['group:bot'],switch:true,remark:'test',pushTypes:['word']}))
    const item={id_str:'post-A',type:'DYNAMIC_TYPE_WORD',modules:{module_author:{name:'A',pub_ts:Date.now()/1000}}}
    m.read.mockResolvedValueOnce({data:{data:{items:[item]}}}).mockRejectedValueOnce(Object.assign(new Error(),{code:-352}))
    const task=new Bilibilipush()
    expect(Object.keys((await task.getDynamicList(subscriptions)).willbepushlist)).toEqual(['post-A'])
    expect((await task.getDynamicList(subscriptions)).willbepushlist).toEqual({})
    expect(m.read).toHaveBeenCalledTimes(2)
    expect(m.sent).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10*60_000)
    m.read.mockResolvedValue({data:{data:{items:[item]}}})
    m.pushed.mockResolvedValue(true)
    for(let i=0;i<3;i++) expect(await task.excludeAlreadyPushed((await task.getDynamicList(subscriptions)).willbepushlist)).toEqual({})
    expect(m.sent).toHaveBeenCalledTimes(2)
  } finally {vi.useRealTimers()}
})
