import { useEffect, useState } from 'react'
import { Bell, VolumeX } from 'lucide-react'
import { useApp } from '../app.tsx'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Card, SPRING } from './ui.tsx'
import { idleDetectionSupported, requestIdleDetection } from '../lib/engine.ts'
import { notificationsSupported, requestNotifications } from '../lib/notify.ts'
import { audioReady, chime, unlockAudio } from '../lib/sound.ts'

/** Asks once for what alerts need: notifications, sound and idle detection. */
export function SetupBanner() {
  const { device, setDevice } = useApp()
  const [permission, setPermission] = useState(() =>
    notificationsSupported() ? Notification.permission : 'denied',
  )

  if (!device.alerts) return null
  const needsNotifications = permission === 'default' && !device.setupDone
  const needsIdle =
    idleDetectionSupported() && !device.idleDetection && !device.setupDone
  // Sound alone only needs a click after each reload; the header's
  // SoundBanner floats over the page for that, so nothing shifts.
  if (!needsNotifications && !needsIdle) return null

  const enable = async () => {
    unlockAudio()
    if (needsIdle && (await requestIdleDetection()))
      setDevice({ idleDetection: true })
    setPermission(await requestNotifications())
    setDevice({ setupDone: true })
    setTimeout(
      () => device.sound && chime(1, device.volume, device.soundStyle),
      100,
    )
  }

  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <p className="flex min-w-0 flex-1 items-start gap-3 text-sm">
        <Bell
          size={20}
          className="shrink-0"
          style={{ color: 'var(--sit)' }}
          aria-hidden
        />
        <span>
          Allow notifications{needsIdle ? ' and idle detection' : ''} so Stretch
          can nudge you from a background tab
          {needsIdle ? ' and notice when you step away' : ''}.
        </span>
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setDevice({ setupDone: true })}>
          Later
        </Button>
        <Button variant="primary" onClick={() => void enable()}>
          Enable
        </Button>
      </div>
    </Card>
  )
}

/**
 * Browsers only play sound after a click on the page, once per reload. A
 * floating banner explains that; it overlays the page (no layout shift) and
 * slides away on the first click.
 */
export function SoundBanner() {
  const { device } = useApp()
  const [ready, setReady] = useState(audioReady)
  useEffect(() => {
    if (ready) return
    const timer = setInterval(() => setReady(audioReady()), 500)
    return () => clearInterval(timer)
  }, [ready])
  const show = device.alerts && device.sound && !ready
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          key="sound"
          onClick={() => {
            unlockAudio()
            setTimeout(() => setReady(audioReady()), 100)
          }}
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-left text-sm text-card shadow-lift"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={SPRING}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-card/15">
            <VolumeX size={16} aria-hidden />
          </span>
          <span>
            <span className="block font-bold">Sound is off</span>
            <span className="block opacity-75">
              Browsers only allow sound after a click on the page. Click
              anywhere to turn it on for this session.
            </span>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
