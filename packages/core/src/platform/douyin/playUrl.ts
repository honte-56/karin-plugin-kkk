/**
 * 从消息中提取并校验抖音 CDN 播放直链。
 *
 * 旧实现用非锚定正则 test 整条消息、再把整条消息当 URL 交给下载器：只要消息里混入
 * `https://aweme.snssdk.com/aweme/v1/play` 子串（例如放在片段里），就能让 bot 从任意
 * URL 拉取内容。这里改为逐个解析候选 URL，严格校验主机与路径后再放行。
 * @param msg 消息文本
 * @returns 校验通过的规范 URL；不匹配返回 null
 */
export const parseDouyinPlayUrl = (msg: string): string | null => {
  for (const urlMatch of msg.matchAll(/https?:\/\/[^\s]+/gi)) {
    try {
      const parsed = new URL(urlMatch[0])
      if (
        ['https:', 'http:'].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        parsed.hostname === 'aweme.snssdk.com' &&
        /^\/aweme\/v1\/play\/?$/i.test(parsed.pathname)
      ) {
        return parsed.href
      }
    } catch {
      // 无法解析的候选 URL 直接跳过
    }
  }
  return null
}
