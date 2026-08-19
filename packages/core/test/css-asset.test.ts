import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { resolveCssAssetUrl } from '../../template/src/utils/cssAsset'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fontDir = path.resolve(testDir, '../../template/public/font')

describe('CSS 字体资源加载', () => {
  it('大字体使用文件 URL，避免重复内联到每张 HTML', () => {
    const fontPath = path.join(fontDir, 'noto-color-emoji', 'NotoColorEmoji.ttf')
    const assetUrl = resolveCssAssetUrl(fontPath)

    expect(assetUrl).toBeTruthy()
    expect(assetUrl).toMatch(/^file:\/\//)
    expect(fileURLToPath(assetUrl!)).toBe(fontPath)
  })

  it('普通小字体继续使用 data URL，保持 HTML 自包含', () => {
    const fontPath = path.join(fontDir, 'fansmedal-num', 'fansmedal-num.1.woff2')
    const assetUrl = resolveCssAssetUrl(fontPath)

    expect(assetUrl).toMatch(/^data:font\/woff2;base64,/)
  })

  it('模板正文使用彩色 Emoji 字体作为回退', () => {
    const mainCssPath = path.resolve(testDir, '../../template/src/styles/main.css')
    const defaultLayoutPath = path.resolve(testDir, '../../template/src/components/layouts/DefaultLayout.tsx')
    const mainCss = fs.readFileSync(mainCssPath, 'utf-8')
    const defaultLayout = fs.readFileSync(defaultLayoutPath, 'utf-8')

    expect(mainCss).toMatch(/--font-template:[^;]*'Noto Color Emoji'/)
    expect(mainCss).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-template\)/s)
    expect(defaultLayout).toContain('font-template')
  })
})
