import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  ChartColumn,
  CloudOff,
  Home,
  ListClock,
  RefreshCw,
  Settings as Cog,
} from 'lucide-react'
import { AppProvider, useApp } from './app.tsx'
import { NowPage } from './routes/now.tsx'
import { TodayPage } from './routes/today.tsx'
import { StatsPage } from './routes/stats.tsx'
import { SettingsPage } from './routes/settings.tsx'

const NAV = [
  { to: '/', label: 'Now', icon: Home },
  { to: '/today', label: 'Today', icon: ListClock },
  { to: '/stats', label: 'Stats', icon: ChartColumn },
  { to: '/settings', label: 'Settings', icon: Cog },
] as const

function SyncBadge() {
  const { store } = useApp()
  if (store.sync === 'synced' || store.sync === 'loading') return null
  const offline = store.sync === 'offline'
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-ink-3"
      title={
        offline
          ? 'Offline: changes are saved on this device and sync later'
          : 'Syncing'
      }
    >
      {offline ? <CloudOff size={14} /> : <RefreshCw size={14} />}
      {offline ? 'Offline' : 'Syncing'}
    </span>
  )
}

function Layout() {
  const { store } = useApp()
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-10">
      <header className="flex items-center justify-between gap-3 py-4">
        <span className="text-lg font-semibold tracking-tight">Stretch</span>
        <SyncBadge />
      </header>
      <nav className="mb-5 grid grid-cols-4 gap-1 rounded-xl bg-card p-1 ring-1 ring-line">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm text-ink-2 hover:text-ink"
            activeProps={{
              className: 'bg-surface !text-ink font-medium shadow-sm',
            }}
            activeOptions={{ exact: true }}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      {store.error && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-card p-3 text-sm ring-1 ring-alarm"
        >
          <span>{store.error}</span>
          <button className="text-ink-2 underline" onClick={store.clearError}>
            Dismiss
          </button>
        </div>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}

const root = createRootRoute({
  component: () => (
    <AppProvider>
      <Layout />
    </AppProvider>
  ),
})

const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: NowPage }),
  createRoute({
    getParentRoute: () => root,
    path: '/today',
    component: TodayPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/stats',
    component: StatsPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/settings',
    component: SettingsPage,
  }),
]

export const router = createRouter({ routeTree: root.addChildren(routes) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
