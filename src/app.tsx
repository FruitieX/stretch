import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { useStore, type Store } from './lib/store.ts'
import { useDevice } from './lib/device.ts'
import { useEngine, type Engine } from './lib/engine.ts'
import type { Activity, Device } from './lib/model.ts'
import { unlockAudio } from './lib/sound.ts'

interface App {
  store: Store
  engine: Engine
  device: Device
  setDevice: (patch: Partial<Device>) => void
}

const Ctx = createContext<App | null>(null)

export function useApp(): App {
  const app = useContext(Ctx)
  if (!app) throw new Error('useApp outside AppProvider')
  return app
}

const KEYS: Record<string, Activity> = {
  '1': 'sit',
  s: 'sit',
  '2': 'stand',
  t: 'stand',
  '3': 'walk',
  w: 'walk',
  '4': 'eat',
  e: 'eat',
  '5': 'break',
  b: 'break',
}

export function AppProvider({ children }: { children: ReactNode }) {
  const store = useStore()
  const [device, setDevice] = useDevice()
  const engine = useEngine(store, device)

  // Any interaction unlocks audio so later chimes can play in the background.
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)
    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  // Keyboard shortcuts: 1–5 or s/t/w/e/b switch activity, n = not now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, [contenteditable]')) return
      const key = e.key.toLowerCase()
      const activity = KEYS[key]
      if (activity) {
        e.preventDefault()
        if (engine.plan.current?.activity !== activity) engine.choose(activity)
      } else if (key === 'n' && engine.plan.suggestion?.due) {
        e.preventDefault()
        engine.snooze()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine])

  // The ambient glow follows what you're doing.
  const mood = engine.plan.current?.activity ?? 'sit'
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--mood',
      `var(--${mood === 'off' ? 'away' : mood})`,
    )
  }, [mood])

  return (
    <Ctx.Provider value={{ store, engine, device, setDevice }}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </Ctx.Provider>
  )
}
