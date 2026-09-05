import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const maxInlineAssetSize = 1024 * 1024

const getAssetMimeType = (assetPath: string): string => {
  const ext = path.extname(assetPath).toLowerCase()

  switch (ext) {
    case '.woff2':
      return 'font/woff2'
    case '.woff':
      return 'font/woff'
    case '.ttf':
      return 'font/ttf'
    case '.otf':
      return 'font/otf'
    case '.eot':
      return 'application/vnd.ms-fontobject'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

export const resolveCssAssetUrl = (assetPath: string): string | null => {
  if (!fs.existsSync(assetPath)) return null

  if (fs.statSync(assetPath).size > maxInlineAssetSize) {
    return pathToFileURL(assetPath).href
  }

  const mimeType = getAssetMimeType(assetPath)
  const fileBuffer = fs.readFileSync(assetPath)
  return `data:${mimeType};base64,${fileBuffer.toString('base64')}`
}
