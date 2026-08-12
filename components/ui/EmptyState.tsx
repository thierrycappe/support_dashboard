import type { HTMLAttributes, ReactNode } from 'react'

export default function EmptyState({
  action,
  className,
  description,
  title,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode
  description: ReactNode
  title: ReactNode
}) {
  return (
    <div {...props} className={['ui-empty-state', className].filter(Boolean).join(' ')}>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  )
}
