import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useApp } from '../app.tsx'
import { Button, Card } from './ui.tsx'
import { idleDetectionSupported, requestIdleDetection } from '../lib/engine.ts'
import { notificationsSupported, requestNotifications } from '../lib/notify.ts'
import { audioReady, chime, unlockAudio } from '../lib/sound.ts'

/** Asks once for what alerts need: notifications, sound and idle detection. */
export function SetupBanner() {
  const { device, setDevice } = useApp()
  const [permission, setPermission] = useState(() =>
    notificationsSupported() ? Notification.permission : 'denied',
  )
  const [sound, setSound] = useState(audioReady)
  useEffect(() => {
    const check = () => setSound(audioReady())
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [])

  if (!device.alerts) return null
  const needsNotifications = permission === 'default' && !device.setupDone
  const needsSound = device.sound && !sound
  const needsIdle =
    idleDetectionSupported() && !device.idleDetection && !device.setupDone
  if (!needsNotifications && !needsSound && !needsIdle) return null

  const enable = async () => {
    unlockAudio()
    if (needsIdle && (await requestIdleDetection()))
      setDevice({ idleDetection: true })
    setPermission(await requestNotifications())
    setDevice({ setupDone: true })
    setTimeout(() => {
      setSound(audioReady())
      if (device.sound) chime(1, device.volume)
    }, 100)
  }

  // Sound only needs a click on the page after each reload; keep that quiet.
  if (!needsNotifications && !needsIdle) {
    return (
      <p className="text-center text-xs text-ink-3">
        Click anywhere to allow sound for this session.
      </p>
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
