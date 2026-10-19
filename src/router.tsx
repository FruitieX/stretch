import {
  Link,
  Outlet,
  useRouterState,
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
import { motion } from 'motion/react'
import { AppProvider, useApp } from './app.tsx'
import { ActivityIcon, SPRING, color, tone } from './components/ui.tsx'
import { SoundBanner } from './components/setup.tsx'
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

function Logo() {
  const { engine } = useApp()
  const activity = engine.plan.current?.activity ?? 'sit'
  return (
    <span className="flex items-center gap-2">
      <motion.span
        key={activity}
        className="tint-strong grid size-8 place-items-center rounded-xl text-white shadow-soft"
        style={tone(color(activity))}
        initial={{ rotate: -20, scale: 0.6 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 14 }}
      >
        <ActivityIcon activity={activity} size={17} strokeWidth={2.4} />
      </motion.span>
      <span className="display text-2xl font-bold tracking-tight">stretch</span>
    </span>
  )
}

function Layout() {
  const { store } = useApp()
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-12">
      <header className="flex items-center justify-between gap-3 pt-5 pb-4">
        <Logo />
        <SyncBadge />
      </header>
      <nav className="mb-6 grid grid-cols-4 gap-1 rounded-full bg-card p-1.5 shadow-soft">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = path === to
          return (
            <Link
              key={to}
              to={to}
              className={`relative flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition-colors ${
                active ? 'text-card' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-full bg-ink"
                  transition={SPRING}
                />
              )}
              <span className="relative flex items-center gap-1.5 [&>svg]:shrink-0">
                <Icon size={16} aria-hidden />
                <span className="hidden min-[380px]:inline">{label}</span>
              </span>
            </Link>
          )
        })}
      </nav>
      {store.error && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-2xl bg-card p-3 text-sm shadow-soft ring-2 ring-alarm"
        >
          <span>{store.error}</span>
          <button className="text-ink-2 underline" onClick={store.clearError}>
            Dismiss
          </button>
        </div>
      )}
      <SoundBanner />
      <main className="flex-1">
        <motion.div
          key={path}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <Outlet />
        </motion.div>
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
