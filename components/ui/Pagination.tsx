import Link from 'next/link'
import type { Route } from 'next'

export default function Pagination({
  currentPage,
  hrefForPage,
  totalPages,
}: {
  currentPage: number
  hrefForPage: (page: number) => string
  totalPages: number
}) {
  if (!Number.isInteger(currentPage) || !Number.isInteger(totalPages) || currentPage < 1 || totalPages < 1 || currentPage > totalPages) {
    throw new Error('Invalid pagination state')
  }
  const items = paginationItems(currentPage, totalPages)

  return (
    <nav className="ui-pagination" aria-label="Pagination">
      {currentPage === 1 ? (
        <span className="ui-page-step" aria-disabled="true">Previous</span>
      ) : (
        <Link className="ui-page-step" href={hrefForPage(currentPage - 1) as Route} aria-label="Previous page">Previous</Link>
      )}
      <span className="ui-page-list">
        {items.map((item) => item.kind === 'ellipsis' ? (
          <span key={item.key} className="ui-page-ellipsis" aria-hidden="true">…</span>
        ) : (
          <Link
            key={item.page}
            className="ui-page-link"
            href={hrefForPage(item.page) as Route}
            aria-label={`Page ${item.page}`}
            aria-current={item.page === currentPage ? 'page' : undefined}
          >
            {item.page}
          </Link>
        ))}
      </span>
      {currentPage === totalPages ? (
        <span className="ui-page-step" aria-disabled="true">Next</span>
      ) : (
        <Link className="ui-page-step" href={hrefForPage(currentPage + 1) as Route} aria-label="Next page">Next</Link>
      )}
    </nav>
  )
}

type PaginationItem = { kind: 'page'; page: number } | { kind: 'ellipsis'; key: string }

function paginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => ({ kind: 'page', page: index + 1 }))

  const visible = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  if (currentPage <= 3) [2, 3, 4].forEach((page) => visible.add(page))
  if (currentPage >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => visible.add(page))
  const pages = [...visible].filter((page) => page >= 1 && page <= totalPages).sort((left, right) => left - right)
  const items: PaginationItem[] = []
  for (const page of pages) {
    const previous = items.at(-1)
    if (previous?.kind === 'page' && page - previous.page > 1) {
      items.push({ kind: 'ellipsis', key: `ellipsis-${previous.page}-${page}` })
    }
    items.push({ kind: 'page', page })
  }
  return items
}
