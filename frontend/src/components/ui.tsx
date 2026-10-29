import clsx from 'clsx'
import { AlertTriangle, CircleCheck, CircleHelp, Inbox, ShieldAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { STATUS_META } from '../lib/sensors'
import type { Status } from '../lib/types'

export function Card({ children, className, title, icon: Icon, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; icon?: LucideIcon; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={clsx('glass rounded-2xl p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-900">
              {Icon && <Icon className="h-4 w-4 text-sky-700" />}
              {title}
            </h3>
            {subtitle && <p className="mt-1 text-xs text-slate-600">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

const STATUS_ICON: Record<Status, LucideIcon> = { safe: CircleCheck, warning: AlertTriangle, unsafe: ShieldAlert, unknown: CircleHelp }

export function StatusPill({ status, className, size = 'sm' }: { status: Status; className?: string; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status]
  const Icon = STATUS_ICON[status]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full font-semibold ring-1', m.bg, m.text, m.ring, size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs', className)}>
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {m.label}
    </span>
  )
}

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'cyan' | 'amber' | 'rose' | 'emerald' | 'violet'; className?: string }) {
  const tones = {
    slate: 'bg-slate-400/10 text-slate-700 ring-slate-400/20',
    cyan: 'bg-sky-400/10 text-sky-700 ring-sky-400/25',
    amber: 'bg-amber-400/10 text-amber-700 ring-amber-400/25',
    rose: 'bg-rose-500/10 text-rose-700 ring-rose-400/30',
    emerald: 'bg-emerald-400/10 text-emerald-700 ring-emerald-400/25',
    violet: 'bg-violet-400/10 text-violet-700 ring-violet-400/25',
  }
  return <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1', tones[tone], className)}>{children}</span>
}

export function Button({ children, onClick, variant = 'primary', className, disabled, type = 'button', icon: Icon, size = 'md' }: { children?: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'subtle'; className?: string; disabled?: boolean; type?: 'button' | 'submit'; icon?: LucideIcon; size?: 'sm' | 'md' }) {
  const v = {
    primary: 'bg-gradient-to-b from-sky-500 to-sky-600 text-white hover:brightness-110 shadow-[0_6px_18px_-8px_rgba(2,132,199,0.55)]',
    ghost: 'text-slate-700 hover:bg-sky-900/[0.045] ring-1 ring-sky-900/[0.12] hover:ring-sky-900/[0.2]',
    subtle: 'bg-sky-900/[0.045] text-slate-800 hover:bg-sky-900/[0.07]',
    danger: 'bg-rose-500/90 text-white hover:bg-rose-500',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={clsx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-40', size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', v[variant], className)}>
      {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('inline-flex rounded-xl bg-sky-50 p-1 ring-1 ring-sky-900/[0.12]', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-lg px-3 py-1.5 text-xs font-semibold transition', value === o.value ? 'bg-sky-400/15 text-sky-800 ring-1 ring-sky-400/30' : 'text-slate-600 hover:text-slate-800')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

export function EmptyState({ title, body, icon: Icon = Inbox, action }: { title: string; body?: string; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-900/[0.12] px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-sky-900/[0.045] p-3">
        <Icon className="h-5 w-5 text-slate-600" />
      </div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs text-slate-600">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="num mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
