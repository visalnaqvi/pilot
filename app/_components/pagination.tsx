'use client'

export const DEFAULT_PAGE_SIZE = 10

function paginationMeta(totalItems: number, requestedPage: number, pageSize = DEFAULT_PAGE_SIZE) {
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize))
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages)
  const startIndex = (page - 1) * safePageSize

  return {
    page,
    pageSize: safePageSize,
    totalPages,
    startIndex,
    endIndex: Math.min(startIndex + safePageSize, totalItems),
  }
}

export function paginate<T>(items: T[], requestedPage: number, pageSize = DEFAULT_PAGE_SIZE) {
  const meta = paginationMeta(items.length, requestedPage, pageSize)
  return { ...meta, items: items.slice(meta.startIndex, meta.endIndex) }
}

type PaginationProps = {
  page: number
  pageSize?: number
  totalItems: number
  onPageChange: (page: number) => void
  itemLabel?: string
  className?: string
}

export function Pagination({
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  totalItems,
  onPageChange,
  itemLabel = 'items',
  className = '',
}: PaginationProps) {
  const result = paginationMeta(totalItems, page, pageSize)
  if (totalItems <= result.pageSize) return null

  const pages = Array.from({ length: result.totalPages }, (_, index) => index + 1)
    .filter((item) => item === 1 || item === result.totalPages || Math.abs(item - result.page) <= 1)

  return <nav aria-label={`${itemLabel} pagination`} className={`flex flex-col gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${className}`}>
    <p className="text-sm text-slate-500">
      Showing <span className="font-bold text-slate-700">{result.startIndex + 1}–{result.endIndex}</span> of <span className="font-bold text-slate-700">{totalItems}</span> {itemLabel}
    </p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={result.page === 1} onClick={() => onPageChange(result.page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
      {pages.map((item, index) => <span key={item} className="contents">
        {index > 0 && item - pages[index - 1] > 1 && <span aria-hidden="true" className="px-1 text-slate-400">…</span>}
        <button type="button" aria-current={item === result.page ? 'page' : undefined} aria-label={`Page ${item}`} onClick={() => onPageChange(item)} className={`h-9 min-w-9 rounded-lg px-2 text-sm font-bold ${item === result.page ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{item}</button>
      </span>)}
      <button type="button" disabled={result.page === result.totalPages} onClick={() => onPageChange(result.page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
    </div>
  </nav>
}
