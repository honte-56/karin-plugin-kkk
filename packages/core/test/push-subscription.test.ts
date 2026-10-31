import { expect, test, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  profile: { user_info: { unique_id: 'creator', sec_uid: 'sec-creator', nickname: 'Creator' } },
  fetchGuestUserInfo: vi.fn(),
  setting: vi.fn()
}))
vi.mock('node-karin', () => ({ default: { command: (_pattern: RegExp, handler: unknown) => handler } }))
vi.mock('@/module/db', () => ({ bilibiliDB: {}, douyinDB: {} }))
vi.mock('@/module/utils/amagiClient', () => ({ bilibiliFetcher: {}, douyinFetcher: { fetchGuestUserInfo: runtime.fetchGuestUserInfo } }))
vi.mock('@/module/utils/Config', () => ({ Config: { douyin: { push: { switch: false } }, bilibili: { push: { switch: false } } } }))
vi.mock('@/module/utils/ErrorHandler', () => ({ wrapWithErrorHandler: (fn: unknown) => fn }))
vi.mock('@/module/utils/logger', () => ({ logger: { info: vi.fn() } }))
vi.mock('@/platform', () => ({
  DouYinpush: class {
    setting = runtime.setting
  },
  Bilibilipush: class {},
  getBilibiliID: vi.fn(),
  getDouyinID: vi.fn()
}))
import { setdyPush } from '../src/apps/push'

test('subscription passes the guest profile payload to the subscription service', async () => {
  runtime.fetchGuestUserInfo.mockResolvedValue({ success: true, data: runtime.profile })
  await (setdyPush as unknown as (e: { msg: string }) => Promise<unknown>)({ msg: '#设置抖音推送 creator' })
  expect(runtime.fetchGuestUserInfo).toHaveBeenCalledWith({ unique_id: 'creator' })
  expect(runtime.setting).toHaveBeenCalledWith(runtime.profile)
})
