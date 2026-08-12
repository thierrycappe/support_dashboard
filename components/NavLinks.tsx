'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'

const destinations = [
  { href: '/', label: 'Escalations', adminOnly: false },
  { href: '/apps', label: 'Applications', adminOnly: false },
  { href: '/deliveries', label: 'Deliveries', adminOnly: false },
  { href: '/teams', label: 'Teams', adminOnly: true },
  { href: '/users', label: 'Access', adminOnly: true },
] as const

export default function NavLinks({
  isAdmin,
  pathname: pathnameOverride,
}: {
  isAdmin: boolean
  pathname?: string
}) {
  const currentPathname = usePathname()
  const pathname = pathnameOverride ?? currentPathname

  return (
    <nav className="nav-list" aria-label="Main navigation">
      {destinations.map((destination) => {
        if (destination.adminOnly && !isAdmin) return null
        const isCurrent = destination.href === '/'
          ? pathname === '/'
          : pathname === destination.href || pathname.startsWith(`${destination.href}/`)
        return (
          <Link
            key={destination.href}
            className="nav-link"
            href={destination.href as Route}
            aria-current={isCurrent ? 'page' : undefined}
          >
            {destination.label}
          </Link>
        )
      })}
    </nav>
  )
}
