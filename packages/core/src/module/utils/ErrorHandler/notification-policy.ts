import type { ErrorHandlerOptions } from './types'

const consecutiveFailures = new Map<string, number>()

export const recordBusinessFailure = (options: ErrorHandlerOptions): { count: number; shouldNotify: boolean } => {
  const threshold = options.consecutiveFailureNotificationThreshold
  if (!threshold || threshold <= 1) return { count: 1, shouldNotify: true }

  const count = (consecutiveFailures.get(options.businessName) ?? 0) + 1
  consecutiveFailures.set(options.businessName, count)
  return { count, shouldNotify: count >= threshold }
}

export const resetBusinessFailures = (options: ErrorHandlerOptions): void => {
  if (!options.consecutiveFailureNotificationThreshold) return
  consecutiveFailures.delete(options.businessName)
}

export const clearBusinessFailureState = (): void => {
  consecutiveFailures.clear()
}
