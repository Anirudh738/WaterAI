import clsx from 'clsx'
import { Activity, Bell, Bot, ChevronLeft, FileText, LayoutDashboard, Menu, Settings, Sparkles, Wifi, WifiOff, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { timeAgo } from '../lib/sensors'
import { useClock, useStore } from '../lib/store'
import { Button, StatusPill } from './ui'

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/live', label: 'Live Monitoring', icon: Activity },
  { to: '/assistant', label: 'AI Assistant', icon: Bot },
  { to: '/insights', label: 'AI Insights', icon: Sparkles },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Device Settings', icon: Settings },
]

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 shadow-[0_8px_20px_-10px_rgba(2,132,199,0.7)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
          <path d="M12 3c3.6 4.8 6 8 6 10.8a6 6 0 0 1-12 0C6 11 8.4 7.8 12 3z" fill="#ffffff" />
          <path d="M9.4 14.6c.3 1.5 1.4 2.5 2.9 2.7" stroke="#0284c7" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-extrabold tracking-tight text-slate-900">
            WaterIQ <span className="bg-gradient-to-r from-sky-600 to-teal-500 bg-clip-text text-transparent">AI</span>
          </p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">Smart water monitor</p>
        </div>
      )}
    </Link>
  )
}

export default function Layout() {
  const store = useStore()
  const { mode, screening, latest, alerts, error, retry, setMode, loading, health } = store
  const demoData = mode === 'demo' || health?.demo !== false
  const now = useClock(1000)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('wateriq:sidebar') === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setMobileOpen(false), [loc.pathname])
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('wateriq:sidebar', c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })
  }
  const openAlerts = alerts.filter((a) => a.state === 'open' && a.severity !== 'info').length
  const ageSec = latest ? Math.round((now - latest.ts) / 1000) : null
  const online = latest !== null && ageSec !== null && ageSec <= store.thresholds.staleAfterSec

  const nav = (compact: boolean) => (
    <nav className="mt-6 flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          title={compact ? label : undefined}
          className={({ isActive }) =>
            clsx(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
              isActive ? 'bg-gradient-to-r from-sky-500/15 to-sky-500/[0.03] text-sky-800 ring-1 ring-sky-500/25' : 'text-slate-600 hover:bg-sky-900/[0.045] hover:text-slate-800',
              compact && 'justify-center px-0',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-sky-500" />}
              <Icon className={clsx('h-[18px] w-[18px] shrink-0', isActive ? 'text-sky-700' : 'text-slate-500 group-hover:text-slate-700')} />
              {!compact && <span className="truncate">{label}</span>}
              {!compact && to === '/alerts' && openAlerts > 0 && <span className="num ml-auto rounded-full bg-rose-500/20 px-1.5 text-[10px] font-bold text-rose-700">{openAlerts}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className={clsx('water-ripples sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sky-900/[0.08] bg-white/95 px-3 py-5 backdrop-blur-xl transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        <div className={clsx('flex items-center', collapsed ? 'justify-center' : 'justify-between px-1')}>
          <Logo compact={collapsed} />
        </div>
        {nav(collapsed)}
        <div className="mt-auto space-y-3">
          {!collapsed && (
            <div className="rounded-xl bg-sky-900/[0.03] p-3 ring-1 ring-sky-900/[0.07]">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Device</p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-800">{store.device.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className={clsx('h-1.5 w-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-rose-500')} />
                {store.device.id} · {online ? 'online' : 'not reporting'}
              </p>
            </div>
          )}
          <button onClick={toggle} className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs text-slate-500 hover:bg-sky-900/[0.045] hover:text-slate-700" aria-label="Collapse sidebar">
            <ChevronLeft className={clsx('h-4 w-4 transition', collapsed && 'rotate-180')} />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileOpen(false)} />
          <aside className="fade-up absolute inset-y-0 left-0 w-72 border-r border-sky-900/[0.12] bg-white px-3 py-5">
            <div className="flex items-center justify-between px-1">
              <Logo />
              <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-600 hover:bg-sky-900/[0.045]" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-sky-900/[0.08] bg-white/85 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button className="rounded-lg p-2 text-slate-700 hover:bg-sky-900/[0.045] lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <Link to="/settings" title={demoData ? 'Simulated data — not from a real device' : 'Data from the backend data source'} className={clsx('flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-wider ring-1', demoData ? 'bg-amber-400/10 text-amber-700 ring-amber-400/30' : 'bg-emerald-400/10 text-emerald-700 ring-emerald-400/30')}>
              <span className={clsx('h-1.5 w-1.5 rounded-full', demoData ? 'bg-amber-500' : 'bg-emerald-500')} />
              {mode === 'demo' ? 'Demo mode' : demoData ? 'Backend · demo data' : 'Live device data'}
            </Link>
            <div className="ml-auto flex items-center gap-2 sm:gap-4">
              <div className="hidden items-center gap-1.5 text-xs text-slate-600 sm:flex">
                {online ? <Wifi className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5 text-rose-600" />}
                <span>{loading ? 'Loading…' : latest ? `Updated ${timeAgo(latest.ts, now)}` : 'No data'}</span>
              </div>
              {!loading && <StatusPill status={screening.status} size="md" />}
              <Link to="/alerts" className="relative rounded-lg p-2 text-slate-700 hover:bg-sky-900/[0.045]" aria-label="Alerts">
                <Bell className="h-[18px] w-[18px]" />
                {openAlerts > 0 && <span className="num absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{openAlerts > 99 ? '99+' : openAlerts}</span>}
              </Link>
            </div>
          </div>
        </header>

        {error && (
          <div className="no-print mx-4 mt-4 flex flex-col gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm sm:mx-6 sm:flex-row sm:items-center">
            <WifiOff className="h-5 w-5 shrink-0 text-rose-700" />
            <div className="flex-1">
              <p className="font-semibold text-rose-800">Backend data unavailable</p>
              <p className="text-rose-800/80">{error} No measurements are shown rather than showing guessed values.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={retry}>
                Retry
              </Button>
              <Button size="sm" onClick={() => setMode('demo')}>
                Switch to demo
              </Button>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
