import type { HTMLAttributes, ReactNode } from 'react'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

export default function InlineNotice({
  children,
  className,
  title,
  tone = 'info',
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  children: ReactNode
  title: ReactNode
  tone?: NoticeTone
}) {
  return (
    <div
      {...props}
      className={['ui-notice', `ui-notice-${tone}`, className].filter(Boolean).join(' ')}
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
    >
      <strong className="ui-notice-title">{title}</strong>
      <div className="ui-notice-copy">{children}</div>
    </div>
  )
}
