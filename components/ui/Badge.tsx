import type { HTMLAttributes, ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export default function Badge({
  children,
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span {...props} className={['ui-badge', `ui-badge-${tone}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  )
}
