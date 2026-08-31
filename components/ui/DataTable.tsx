import type { ReactNode } from 'react'

export interface DataTableColumn<Row> {
  key: keyof Row & string
  header: string
  render?: (row: Row) => ReactNode
}

export default function DataTable<Row>({
  caption,
  columns,
  emptyState,
  getRowKey,
  loading = false,
  rows,
}: {
  caption: string
  columns: ReadonlyArray<DataTableColumn<Row>>
  emptyState: ReactNode
  getRowKey: (row: Row) => string
  loading?: boolean
  rows: ReadonlyArray<Row>
}) {
  return (
    <div className="ui-table-region" role="region" aria-label={caption} tabIndex={0}>
      <table className="ui-data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="ui-table-status" role="status">Loading {caption.toLocaleLowerCase('en')}</div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyState}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.header}>
                  {column.render ? column.render(row) : String(row[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
