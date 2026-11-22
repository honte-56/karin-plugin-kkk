import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  dir: '', cookies: { douyin: 'fixture', bilibili: '', kuaishou: '', xiaohongshu: '' },
  check: vi.fn(), send: vi.fn()
}))
vi.mock('node-karin/root', () => ({ get karinPathBase() { return m.dir } }))
vi.mock('node-karin', () => ({ default: { sendMaster: m.send }, segment: { text: (text: string) => text }, logger: { info: vi.fn(), warn: vi.fn() } }))
vi.mock('../src/root', () => ({ Root: { pluginName: 'test' } }))
vi.mock('../src/module/utils/Config', () => ({ Config: { amagi: { cookies: m.cookies } } }))
vi.mock('../src/module/utils/bot', () => ({ getReachableMasterBots: async () => [{ master: 'owner', bot: { account: { selfId: 'bot' } } }] }))
vi.mock('../src/module/utils/amagiClient', () => ({ reloadAmagiConfig: vi.fn(), getAmagiClient: () => ({ douyin: { credentials: { checkLoginState: m.check } } }) }))
const load = () => import('../src/module/utils/accountHealth')
beforeEach(() => {
  vi.resetModules()
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kkk-health-'))
  m.cookies.douyin = 'fixture'
  m.check.mockReset()
  m.send.mockReset().mockResolvedValue({ messageId: 'ok' })
})
afterEach(() => fs.rmSync(m.dir, { recursive: true, force: true }))
it('过期通知在重启后去重，更换有效凭据恢复一次', async () => {
  m.check.mockResolvedValue({ state: 'expired' })
  await (await load()).checkAccount('douyin')
  vi.resetModules()
  const api = await load()
  await api.checkAccount('douyin', true)
  expect(m.send).toHaveBeenCalledTimes(1)
  m.cookies.douyin = 'replacement'
  m.check.mockResolvedValue({ state: 'login' })
  await api.checkAccount('douyin')
  await api.checkAccount('douyin', true)
  expect(m.send).toHaveBeenCalledTimes(2)
  expect(m.send.mock.lastCall?.[2][0]).toContain('恢复')
  expect(fs.readFileSync(path.join(m.dir,'test/data/account-health.json'),'utf8')).not.toContain('replacement')
})
it('通知失败可重试，删除凭据清除待发通知', async () => {
  const api = await load()
  m.send.mockRejectedValueOnce(new Error('offline'))
  m.check.mockResolvedValue({ state: 'expired' })
  await api.checkAccount('douyin')
  await api.checkAccount('douyin')
  expect(m.check).toHaveBeenCalledTimes(1)
  expect(m.send).toHaveBeenCalledTimes(2)
  m.cookies.douyin = ''
  await api.checkAccount('douyin')
  expect(JSON.parse(fs.readFileSync(path.join(m.dir,'test/data/account-health.json'),'utf8'))).toEqual({})
})
it('过时的检查结果不会覆盖新凭据，风控和游客初始状态不误报', async () => {
  const api = await load()
  let finish!: (v: {state: string}) => void
  m.check.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const first = api.checkAccount('douyin')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  m.cookies.douyin = 'new'
  m.check.mockResolvedValue({ state: 'guest' })
  await api.checkAccount('douyin')
  finish({ state: 'expired' })
  await first
  expect(m.send).not.toHaveBeenCalled()
  expect(api.indicatesExpired('bilibili', -352, 'bilibili.userDynamicList')).toBe(false)
  expect(api.indicatesExpired('xiaohongshu', 406, 'xiaohongshu.noteDetail')).toBe(false)
  expect(api.indicatesExpired('xiaohongshu', -100, 'xiaohongshu.noteDetail')).toBe(true)
  expect(api.indicatesExpired('kuaishou', 109, 'kuaishou.loginUserProfile')).toBe(true)
})
