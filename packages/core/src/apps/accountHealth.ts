import karin, { logger } from 'node-karin'

import { checkAccount, checkChangedAccounts, platformNames, type Platform } from '@/module/utils/accountHealth'
import { registerAmagiReloadListener } from '@/module/utils/amagiClient'

const checkChanged = () => checkChangedAccounts().catch(() => logger.warn('[账号探活] 检查未完成，将在下轮重试'))
registerAmagiReloadListener(checkChanged)
void checkChanged()

// 每个平台错开一分钟；五分钟任务只补发通知、检查变更的凭据。
export const health = karin.task('kkk-账号探活', '11-14 */6 * * *', async () => {
  const platform = (Object.keys(platformNames) as Platform[])[new Date().getMinutes() - 11]
  if (platform && platform !== 'xiaohongshu') await checkAccount(platform, true)
}, { log: false, type: 'skip' })
export const retry = karin.task('kkk-账号通知重试', '*/5 * * * *', checkChanged, { log: false, type: 'skip' })
