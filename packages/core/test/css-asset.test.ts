import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { HtmlWrapper } from '@karinjs/template-react'
import { describe, expect, it } from 'vitest'

import { emojiFontDevPlugin, emojiFontHead } from '../ktr/utils/emojiFont'

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resourceDir = path.join(coreDir, 'resources')

describe('CSS 字体资源加载', () => {
  it('生产 HTML 引用本地样式表，大字体不重复内联到每张图片', () => {
    const wrapper = new HtmlWrapper({ assetsDir: resourceDir, headExtra: emojiFontHead(resourceDir) })
    const html = wrapper.wrapContent('<p>📅 🟢 👍🏽 👩‍💻</p>', { theme: { mode: 'light' } })
    const cssPath = path.join(resourceDir, 'font/noto-color-emoji/font.css')
    const cssUrl = pathToFileURL(cssPath)
    const fontPath = fileURLToPath(new URL('./NotoColorEmoji.ttf', cssUrl))

    expect(html).toContain(`<link rel="stylesheet" href="${cssUrl.href}">`)
    expect(html).not.toContain('data:font/ttf')
    expect(fs.readFileSync(cssPath, 'utf8')).toContain("url('./NotoColorEmoji.ttf')")
    expect(fs.statSync(fontPath).size).toBeGreaterThan(1024 * 1024)
  })

  it('包含空格和中文的部署目录仍生成有效的本地字体 URL', () => {
    const assetsDir = path.join(coreDir, '测试目录 with spaces', 'resources')
    const expected = pathToFileURL(path.join(assetsDir, 'font/noto-color-emoji/font.css')).href
    expect(emojiFontHead(assetsDir)).toBe(`<link rel="stylesheet" href="${expected}">`)
  })

  it('开发预览从静态资源目录加载同一份字体', async () => {
    const plugin = emojiFontDevPlugin()
    const hook = plugin.transformIndexHtml
    expect(typeof hook).toBe('function')
    if (typeof hook !== 'function') throw new Error('预期使用 HTML 转换函数')
    const tags = await hook('', {} as Parameters<typeof hook>[1])
    expect(tags).toEqual([{ tag: 'link', attrs: { rel: 'stylesheet', href: '/font/noto-color-emoji/font.css' }, injectTo: 'head' }])
  })

  it('普通小字体仍可通过框架内联', () => {
    const wrapper = new HtmlWrapper({})
    const css = wrapper.loadInlineCss(path.join(coreDir, 'ktr/font/fansmedal-num/font.css'))
    expect(css).toContain('data:font/woff2;base64,')
  })

  it('正文和等宽文本均保留彩色 emoji 后备字体', () => {
    const css = fs.readFileSync(path.join(coreDir, 'ktr/template/style.css'), 'utf8')
    const layout = fs.readFileSync(path.join(coreDir, 'ktr/template/components/DefaultLayout.tsx'), 'utf8')
    expect(css).toMatch(/--font-template:[^;]*'Noto Color Emoji'/)
    expect(css).toMatch(/--font-mono:[^;]*'Noto Color Emoji'/)
    expect(css).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-template\)/s)
    expect(layout).toContain('font-template')
  })
})
