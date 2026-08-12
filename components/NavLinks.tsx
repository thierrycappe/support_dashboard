'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

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
  const navigationRef = useRef<HTMLElement>(null)
  const activeLinkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [pathname])

  function scrollNavigation(direction: -1 | 1) {
    navigationRef.current?.scrollBy({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      left: direction * 240,
    })
  }

  return (
    <div className="nav-rail">
      <button
        className="nav-scroll-control"
        type="button"
        aria-label="Scroll navigation left"
        onClick={() => scrollNavigation(-1)}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <nav ref={navigationRef} className="nav-list" aria-label="Main navigation">
        {destinations.map((destination) => {
          if (destination.adminOnly && !isAdmin) return null
          const isCurrent = destination.href === '/'
            ? pathname === '/'
            : pathname === destination.href || pathname.startsWith(`${destination.href}/`)
          return (
            <Link
              key={destination.href}
              ref={isCurrent ? activeLinkRef : undefined}
              className="nav-link"
              href={destination.href as Route}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {destination.label}
            </Link>
          )
        })}
      </nav>
      <button
        className="nav-scroll-control"
        type="button"
        aria-label="Scroll navigation right"
        onClick={() => scrollNavigation(1)}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  )
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true
}
