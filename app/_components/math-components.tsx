'use client'

import katex from 'katex'
import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'

type MathSegment = { value: string; display: boolean } | { value: string; display?: never }

const mathLiveMacros = {
  '\\imaginaryI': '\\mathrm{i}',
  '\\imaginaryJ': '\\mathrm{j}',
  '\\exponentialE': '\\mathrm{e}',
  '\\differentialD': '\\mathrm{d}',
  '\\capitalDifferentialD': '\\mathrm{D}',
  '\\doubleStruckCapitalN': '\\mathbb{N}',
  '\\doubleStruckCapitalP': '\\mathbb{P}',
  '\\doubleStruckCapitalQ': '\\mathbb{Q}',
  '\\doubleStruckCapitalR': '\\mathbb{R}',
  '\\doubleStruckCapitalZ': '\\mathbb{Z}',
}

function parseMathText(value: string): MathSegment[] {
  const segments: MathSegment[] = []
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let cursor = 0

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ value: value.slice(cursor, index) })
    segments.push({ value: match[1] ?? match[2], display: Boolean(match[1]) })
    cursor = index + match[0].length
  }

  if (cursor < value.length || segments.length === 0) segments.push({ value: value.slice(cursor) })
  return segments
}

function Formula({ latex, display }: { latex: string; display: boolean }) {
  let html: string | null = null
  try {
    html = katex.renderToString(latex, { displayMode: display, throwOnError: true, trust: false, macros: mathLiveMacros })
  } catch {
    html = null
  }
  return html ? <span className={display ? 'my-2 block overflow-x-auto' : 'inline-block align-middle'} dangerouslySetInnerHTML={{ __html: html }} /> : <span>{display ? `$$${latex}$$` : `$${latex}$`}</span>
}

export function MathText({ children, className }: { children: string; className?: string }) {
  return <span className={`whitespace-pre-wrap ${className ?? ''}`}>{parseMathText(children).map((segment, index) => 'display' in segment ? <Formula key={index} latex={segment.value} display={segment.display === true} /> : <span key={index}>{segment.value}</span>)}</span>
}

type EquationInserterProps = {
  targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function EquationInserter({ targetRef, value, onChange, disabled = false }: EquationInserterProps) {
  const [open, setOpen] = useState(false)
  const [display, setDisplay] = useState(false)
  const [latex, setLatex] = useState('')
  const latexRef = useRef(latex)
  const fieldHost = useRef<HTMLDivElement>(null)

  useEffect(() => { latexRef.current = latex }, [latex])

  useEffect(() => {
    if (!open || !fieldHost.current) return
    let disposed = false
    let field: HTMLElement | undefined

    void import('mathlive').then(({ MathfieldElement }) => {
      if (disposed || !fieldHost.current) return
      const mathField = new MathfieldElement()
      mathField.className = 'block min-h-14 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xl'
      mathField.mathVirtualKeyboardPolicy = 'manual'
      mathField.value = latexRef.current
      mathField.addEventListener('input', () => setLatex(mathField.getValue('latex-expanded')))
      fieldHost.current.replaceChildren(mathField)
      field = mathField
      mathField.focus()
      window.mathVirtualKeyboard?.show()
    })

    return () => {
      disposed = true
      field?.remove()
      window.mathVirtualKeyboard?.hide()
    }
  }, [open])

  function insert() {
    const target = targetRef.current
    if (!target || !latex.trim()) return
    const start = target.selectionStart ?? value.length
    const end = target.selectionEnd ?? value.length
    const equation = display ? `$$${latex}$$` : `$${latex}$`
    const next = `${value.slice(0, start)}${equation}${value.slice(end)}`
    const caret = start + equation.length
    onChange(next)
    setOpen(false)
    requestAnimationFrame(() => {
      target.focus()
      target.setSelectionRange(caret, caret)
    })
  }

  return <><button type="button" disabled={disabled} onClick={() => setOpen(true)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 disabled:opacity-50">Insert equation</button>{open && <div role="dialog" aria-modal="true" aria-label="Equation builder" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black">Equation builder</h3><p className="mt-1 text-sm text-slate-600">Use the math keypad or type LaTeX.</p></div><button type="button" onClick={() => setOpen(false)} className="text-sm font-bold text-slate-600">Close</button></div><div ref={fieldHost} className="mt-5" /><label className="mt-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={display} onChange={(event) => setDisplay(event.target.checked)} /> Show on its own line</label><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-700">Cancel</button><button type="button" disabled={!latex.trim()} onClick={insert} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Insert equation</button></div></div></div>}</>
}

type MathTextEditorProps = {
  value: string
  onChange: (value: string) => void
  showEquationTools?: boolean
  multiline?: boolean
  disabled?: boolean
  required?: boolean
  placeholder?: string
  inputClassName?: string
  previewClassName?: string
}

export function MathTextEditor({ value, onChange, showEquationTools = true, multiline = false, disabled = false, required = false, placeholder, inputClassName, previewClassName }: MathTextEditorProps) {
  const targetRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const common = { disabled, required, value, placeholder, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), className: inputClassName }

  return <div className="min-w-0 flex-1"><div className="flex items-start gap-2">{multiline ? <textarea ref={targetRef as RefObject<HTMLTextAreaElement>} {...common} /> : <input ref={targetRef as RefObject<HTMLInputElement>} {...common} />}{showEquationTools && <EquationInserter targetRef={targetRef} value={value} onChange={onChange} disabled={disabled} />}</div><div className={`mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ${previewClassName ?? ''}`}><span className="mr-2 text-xs font-bold uppercase tracking-wide text-slate-400">Preview</span><MathText>{value || 'Your text and equations will appear here.'}</MathText></div></div>
}
