import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Plugin } from 'vite'

const stylesheetPath = 'font/noto-color-emoji/font.css'

/** 保留外部样式表，让大字体相对于 CSS 从本地加载，不内联进每张 HTML。 */
export const emojiFontHead = (assetsDir: string): string => {
  const href = pathToFileURL(path.join(assetsDir, stylesheetPath)).href
  return `<link rel="stylesheet" href="${href}">`
}

export const emojiFontDevPlugin = (): Plugin => ({
  name: 'kkk-emoji-font',
  transformIndexHtml: () => [
    {
      tag: 'link',
      attrs: { rel: 'stylesheet', href: `/${stylesheetPath}` },
      injectTo: 'head'
    }
  ]
})
