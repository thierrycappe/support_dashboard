'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [scrollState, setScrollState] = useState({
    hasOverflow: false,
    canScrollBack: false,
    canScrollForward: false,
  })

  const updateScrollState = useCallback(() => {
    const navigation = navigationRef.current
    if (!navigation) return
    const maximumScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
    const hasOverflow = maximumScrollLeft > 1
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
    const navigation = navigationRef.current
    if (!navigation) return

    navigation.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollState)
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
    <div className="nav-rail" data-overflow={scrollState.hasOverflow ? 'true' : undefined}>
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
