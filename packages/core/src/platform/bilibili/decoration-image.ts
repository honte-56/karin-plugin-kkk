import axios from 'node-karin/axios'

// 装扮只是装饰：在生成 HTML 前限时取图，避免浏览器的 load 被可选背景阻塞。
export async function decorationImage(source: string): Promise<string | undefined> {
  try {
    const url = new URL(source.startsWith('//') ? 'https:' + source : source)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !/^i\d+\.hdslb\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith('/bfs/')
    )
      return
    url.protocol = 'https:'
    const res = await axios.get<ArrayBuffer>(url.href, {
      responseType: 'arraybuffer',
      signal: AbortSignal.timeout(2000),
      maxRedirects: 0,
      maxContentLength: 512 * 1024
    })
    const mime = String(res.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(mime) || !res.data.byteLength) return
    return `data:${mime};base64,${Buffer.from(res.data).toString('base64')}`
  } catch {
    return undefined
  }
}
