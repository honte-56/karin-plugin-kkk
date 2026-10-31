import React from 'react'

import { cn } from '../../utils/cn'
import type { PosterContext } from '../types/ctx'

/**
 * 默认布局组件属性接口
 */
interface DefaultLayoutProps {
  /** 子组件 */
  children: React.ReactNode
  /** ktr 注入的运行时上下文（scale/theme + kkk 扩展字段） */
  ctx: PosterContext
  /** 额外的CSS类名 */
  className?: string
  /** 自定义样式 */
  style?: React.CSSProperties
}

/**
 * 默认布局组件
 * @param props 组件属性
 * @returns JSX元素
 */
export const DefaultLayout: React.FC<DefaultLayoutProps> = ({ children, className = '', style = {} }) => {
  return (
    <div
      className={cn(
        // 圆角与裁剪从旧引擎外壳（#container 规则）迁移到模板根元素：观感不变，单个模板可用 className 覆盖。
        // relative 同样从旧引擎外壳（transform 语义）迁来：根元素是绝对定位包含块，
        // 模板里 inset-0 的氛围层锚定在卡片矩形上并被圆角裁剪，而不是锚到视口逃逸出去。
        'relative w-360 shrink-0 overflow-hidden rounded-[5rem] bg-background bg-clip-padding text-foreground font-template',
        className
      )}
      style={{
        // renderScale 缩放由 ktr 外壳统一施加（#container 上的 zoom，SSR 与开发面板沙盒一致），
        // 模板根元素不要再加 zoom/transform，否则会叠加成 scale²。
        // 旧引擎 transform 顺带的层叠上下文也由外壳 #container 的 isolation: isolate 补回，
        // 模板里 -z-10 的氛围层不会逃逸到 <html> 层叠上下文被卡片背景盖住。
        width: '1440px',
        minWidth: '1440px',
        maxWidth: '1440px',
        ...style
      }}
    >
      {children}
      <div className="h-24" />
    </div>
  )
}
