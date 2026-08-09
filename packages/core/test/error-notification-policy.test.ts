import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearBusinessFailureState,
  recordBusinessFailure,
  resetBusinessFailures
} from '../src/module/utils/ErrorHandler/notification-policy'

describe('连续失败通知策略', () => {
  beforeEach(() => clearBusinessFailureState())

  it('抖音推送前两次静默，第三次及以后每次通知', () => {
    const options = { businessName: '抖音推送任务', consecutiveFailureNotificationThreshold: 3 }

    expect(recordBusinessFailure(options)).toEqual({ count: 1, shouldNotify: false })
    expect(recordBusinessFailure(options)).toEqual({ count: 2, shouldNotify: false })
    expect(recordBusinessFailure(options)).toEqual({ count: 3, shouldNotify: true })
    expect(recordBusinessFailure(options)).toEqual({ count: 4, shouldNotify: true })
  })

  it('成功后清零并重新累计', () => {
    const options = { businessName: '抖音推送任务', consecutiveFailureNotificationThreshold: 3 }
    recordBusinessFailure(options)
    recordBusinessFailure(options)
    resetBusinessFailures(options)

    expect(recordBusinessFailure(options)).toEqual({ count: 1, shouldNotify: false })
  })

  it('未配置阈值的业务首次失败立即通知', () => {
    expect(recordBusinessFailure({ businessName: 'B站推送任务' })).toEqual({ count: 1, shouldNotify: true })
    expect(recordBusinessFailure({ businessName: '强制推送' })).toEqual({ count: 1, shouldNotify: true })
  })
})
