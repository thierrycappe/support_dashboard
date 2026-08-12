import type { HTMLAttributes, ReactNode } from 'react'

export default function FieldError({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) {
  return (
    <p {...props} className={['field-error', className].filter(Boolean).join(' ')}>
      {children}
    </p>
  )
}
