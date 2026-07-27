'use client'

import { useMemo, useState } from 'react'

export type SearchPickerOption = { id: string; label: string; detail?: string }

export function SearchPicker({ value, options, onChange, placeholder, disabled = false, onCreate, createLabel = 'Add' }: { value: string; options: SearchPickerOption[]; onChange: (option: SearchPickerOption) => void; placeholder: string; disabled?: boolean; onCreate?: (query: string) => void; createLabel?: string }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.id === value)
  const matches = useMemo(() => options.filter((option) => `${option.label} ${option.detail || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8), [options, query])

  const createQuery = query.trim()

  return <div className="relative"><input value={open ? query : selected?.label || ''} onFocus={() => { if (!disabled) { setQuery(''); setOpen(true) } }} onBlur={() => { setQuery(''); setOpen(false) }} onChange={(event) => { setQuery(event.target.value); setOpen(true) }} type="search" placeholder={placeholder} disabled={disabled} className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:cursor-not-allowed disabled:bg-slate-100" />{open && <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">{matches.map((option) => <button key={option.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option); setQuery(''); setOpen(false) }} className="block w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-indigo-50"><span className="block font-semibold">{option.label}</span>{option.detail && <span className="mt-0.5 block text-xs text-slate-500">{option.detail}</span>}</button>)}{!matches.length && createQuery && onCreate ? <div className="p-3"><p className="text-sm text-slate-500">No existing match.</p><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onCreate(createQuery); setQuery(''); setOpen(false) }} className="mt-2 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-sm font-bold text-indigo-700 hover:bg-indigo-100">{createLabel} “{createQuery}”</button></div> : !matches.length && <p className="p-3 text-sm text-slate-500">No matching options.</p>}</div>}</div>
}
