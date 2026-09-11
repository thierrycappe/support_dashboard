import type { ComponentPropsWithRef, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export default function Button({
  children,
  className,
  disabled,
  loading = false,
  variant = 'primary',
  ...props
}: ComponentPropsWithRef<'button'> & {
  children: ReactNode
  loading?: boolean
  variant?: ButtonVariant
}) {
  return (
    <button
      {...props}
      className={['ui-button', `ui-button-${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  )
}
