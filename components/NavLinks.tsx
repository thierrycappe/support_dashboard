'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Badge from '@/components/ui/Badge'

const destinations = [
  { href: '/', label: 'Escalations', adminOnly: false },
  { href: '/apps', label: 'Applications', adminOnly: false },
  { href: '/deliveries', label: 'Deliveries', adminOnly: false },
  { href: '/teams', label: 'Teams', adminOnly: true },
  { href: '/access', label: 'Access', adminOnly: true },
] as const

export default function NavLinks({
  isAdmin,
  deadLetterCount = 0,
  pathname: pathnameOverride,
}: {
  isAdmin: boolean
  deadLetterCount?: number
  pathname?: string
}) {
  const currentPathname = usePathname()
  const pathname = pathnameOverride ?? currentPathname
  const railRef = useRef<HTMLDivElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const activeLinkRef = useRef<HTMLAnchorElement>(null)
  const [scrollState, setScrollState] = useState({
    hasOverflow: false,
    canScrollBack: false,
    canScrollForward: false,
  })

  const updateScrollState = useCallback(() => {
    const rail = railRef.current
    const navigation = navigationRef.current
    if (!rail || !navigation) return
    const hasOverflow = navigation.scrollWidth - rail.clientWidth > 1
    if (!hasOverflow && navigation.scrollLeft !== 0) navigation.scrollLeft = 0
    const maximumScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
    const nextState = {
      hasOverflow,
      canScrollBack: hasOverflow && navigation.scrollLeft > 1,
      canScrollForward: hasOverflow && navigation.scrollLeft < maximumScrollLeft - 1,
    }
    setScrollState((currentState) => (
      currentState.hasOverflow === nextState.hasOverflow
      && currentState.canScrollBack === nextState.canScrollBack
      && currentState.canScrollForward === nextState.canScrollForward
        ? currentState
        : nextState
    ))
  }, [])

  useEffect(() => {
    const rail = railRef.current
    const navigation = navigationRef.current
    if (!rail || !navigation) return

    navigation.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollState)
    resizeObserver?.observe(rail)
    resizeObserver?.observe(navigation)
    updateScrollState()

    return () => {
      navigation.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
      resizeObserver?.disconnect()
    }
  }, [updateScrollState])

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    })
    updateScrollState()
  }, [pathname, updateScrollState])

  function scrollNavigation(direction: -1 | 1) {
    navigationRef.current?.scrollBy({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      left: direction * 240,
    })
    updateScrollState()
  }

  return (
    <div ref={railRef} className="nav-rail" data-overflow={scrollState.hasOverflow ? 'true' : undefined}>
      {scrollState.hasOverflow ? (
        <button
          className="nav-scroll-control"
          type="button"
          aria-label="Scroll navigation left"
          disabled={!scrollState.canScrollBack}
          onClick={() => scrollNavigation(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
      ) : null}
      <nav ref={navigationRef} className="nav-list" aria-label="Main navigation">
        {destinations.map((destination) => {
          if (destination.adminOnly && !isAdmin) return null
          const isCurrent = destination.href === '/'
            ? pathname === '/'
            : pathname === destination.href || pathname.startsWith(`${destination.href}/`)
          return (
            <div className="nav-destination" key={destination.href}>
              <Link
              ref={isCurrent ? activeLinkRef : undefined}
              className="nav-link"
              href={destination.href as Route}
              aria-current={isCurrent ? 'page' : undefined}
              >
                {destination.label}
              </Link>
              {destination.href === '/deliveries' && deadLetterCount > 0 ? <Badge tone="danger">{deadLetterCount} {deadLetterCount === 1 ? 'dead letter' : 'dead letters'}</Badge> : null}
            </div>
          )
        })}
      </nav>
      {scrollState.hasOverflow ? (
        <button
          className="nav-scroll-control"
          type="button"
          aria-label="Scroll navigation right"
          disabled={!scrollState.canScrollForward}
          onClick={() => scrollNavigation(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
      ) : null}
    </div>
  )
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true
}
