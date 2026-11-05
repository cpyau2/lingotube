import type { ReactNode } from 'react'

export function Page({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 scroll-y">
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {right}
        </div>
        {children}
      </div>
    </div>
  )
}

export function SoonPanel({ icon, title, milestone, children }: { icon: string; title: string; milestone: string; children?: ReactNode }) {
  return (
    <div className="card p-5 flex flex-col items-center text-center gap-2" data-testid="soon-panel">
      <div className="text-4xl">{icon}</div>
      <div className="font-semibold text-lg">{title} <span className="soon">即將推出 · {milestone}</span></div>
      <p className="text-sm text-slate-400 max-w-md">{children}</p>
    </div>
  )
}
