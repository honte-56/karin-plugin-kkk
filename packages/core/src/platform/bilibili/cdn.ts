import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

import type { AxiosRequestConfig, AxiosResponse } from 'node-karin/axios'

import type { downLoadFileOptions, fileInfo } from '@/module/utils/Base'

export type BilibiliStream =
  | string
  | { base_url?: string; baseUrl?: string; url?: string; backup_url?: string[] | null; backupUrl?: string[] | null }
  | undefined
  | null
type Dependencies = {
  request: (config: AxiosRequestConfig) => Promise<AxiosResponse>
  downloadFile: (url: string, options: downLoadFileOptions) => Promise<fileInfo>
  resolvePath: (options: downLoadFileOptions) => string
  logger: { warn: (message: string) => void }
}

export function streamUrls(stream: BilibiliStream) {
  const values =
    typeof stream === 'string'
      ? [stream]
      : [
          stream?.base_url,
          stream?.baseUrl,
          stream?.url,
          ...(Array.isArray(stream?.backup_url) ? stream.backup_url : []),
          ...(Array.isArray(stream?.backupUrl) ? stream.backupUrl : [])
        ]
  const urls = [
    ...new Set(
      values.filter((value): value is string => {
        try {
          return typeof value === 'string' && ['https:', 'http:'].includes(new URL(value).protocol)
        } catch {
          return false
        }
      })
    )
  ]
  const isPcdn = (url: string) => /(?:^|\.)(?:mcdn|pcdn)\.bilivideo\.(?:cn|com)$|(?:^|\.)szbdyd\.com$/i.test(new URL(url).hostname)
  if (urls[0] && isPcdn(urls[0])) {
    const rank = (url: string) => (isPcdn(url) ? 2 : /(?:^|\.)bilivideo\.(?:cn|com)$/i.test(new URL(url).hostname) ? 0 : 1)
    urls.sort((a, b) => rank(a) - rank(b))
  }
  return urls
}

export function createBilibiliCdnTools({ request, downloadFile, resolvePath, logger }: Dependencies) {
  // Per-track state expires with the parse operation; signed URLs are never persisted.
  const preferred = new WeakMap<object, string>()
  const remember = (stream: BilibiliStream, url: string) => {
    if (stream && typeof stream === 'object') preferred.set(stream, url)
  }
  const candidates = (stream: BilibiliStream) => {
    const urls = streamUrls(stream)
    const first = stream && typeof stream === 'object' && preferred.get(stream)
    return first ? [first, ...urls.filter((url) => url !== first)] : urls
  }
  const warning = (operation: string, url: string) =>
    logger.warn(`[karin-plugin-kkk] B站${operation}失败，尝试其他可用地址: ${new URL(url).host}`)
  const size = async (stream: BilibiliStream, headers: AxiosRequestConfig['headers']) => {
    let lastError
    for (const url of candidates(stream)) {
      for (const method of ['HEAD', 'GET']) {
        let response
        try {
          response = await request({
            url,
            method,
            headers: { ...headers, ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) },
            responseType: 'stream',
            timeout: 8000,
            maxRedirects: 5,
            validateStatus: () => true
          })
          if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
          const range = String(response.headers['content-range'] ?? '').match(/^bytes\s+\d+-\d+\/(\d+)$/i)
          const total = range ? Number(range[1]) : response.status === 200 ? Number(response.headers['content-length']) : NaN
          if (!Number.isSafeInteger(total) || total <= 0) throw new Error('响应未提供有效文件总大小')
          remember(stream, url)
          return total
        } catch (error) {
          lastError = error
        } finally {
          response?.data?.on?.('error', () => {})
          response?.data?.destroy?.()
        }
      }
      warning('大小探测', url)
    }
    throw new Error('B站所有下载地址均无法获取文件大小', { cause: lastError })
  }
  const download = async (stream: BilibiliStream, options: downLoadFileOptions) => {
    const urls = candidates(stream)
    const target = resolvePath(options)
    let lastError
    for (const url of urls) {
      // Never resume one CDN's partial response using a different CDN.
      const temporary = `${target}.cdn-${randomUUID()}`
      try {
        const result = await downloadFile(url, {
          ...options,
          filepath: temporary,
          maxRetries: urls.length > 1 ? 0 : 3
        })
        fs.renameSync(result.filepath, target)
        remember(stream, url)
        return { ...result, filepath: target }
      } catch (error) {
        if (['ENOSPC', 'EACCES', 'EROFS', 'ENOENT'].includes((error as NodeJS.ErrnoException)?.code ?? '')) throw error
        lastError = error
        warning('下载', url)
      } finally {
        try {
          fs.rmSync(temporary, { force: true })
        } catch {
          logger.warn('[karin-plugin-kkk] B站下载临时文件清理失败')
        }
      }
    }
    throw new Error(`B站视频/音频下载失败，已尝试 ${urls.length} 个地址`, { cause: lastError })
  }
  return { size, download }
}
