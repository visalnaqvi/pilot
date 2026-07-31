export function WorkDataLoading({ label }: { label: string }) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="grid min-h-[min(32rem,calc(100dvh-15rem))] place-items-center"
    >
      <div role="status" className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60">
        <span
          aria-hidden="true"
          className="mx-auto block h-11 w-11 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600 motion-reduce:animate-none"
        />
        <p className="mt-5 text-xs font-black tracking-[0.18em] text-indigo-600">WORKSPACE</p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">Loading {label}…</h1>
        <p className="mt-2 text-sm text-slate-500">Fetching the latest data for you.</p>
      </div>
    </section>
  )
}
