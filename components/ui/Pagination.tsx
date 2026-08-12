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
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)

  return (
    <nav className="ui-pagination" aria-label="Pagination">
      {currentPage === 1 ? (
        <span className="ui-page-step" aria-disabled="true">Previous</span>
      ) : (
        <Link className="ui-page-step" href={hrefForPage(currentPage - 1) as Route} aria-label="Previous page">Previous</Link>
      )}
      <span className="ui-page-list">
        {pages.map((page) => (
          <Link
            key={page}
            className="ui-page-link"
            href={hrefForPage(page) as Route}
            aria-label={`Page ${page}`}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
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
