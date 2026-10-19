export interface Alert {
  title: string
  body: string
  /** Buttons shown by browsers that support notification actions (Chrome). */
  actions?: { action: string; title: string }[]
  data?: unknown
  /** Keep it on screen until handled. */
  sticky?: boolean
}

const TAG = 'stretch'

export const notificationsSupported = () => typeof Notification === 'function'

export async function requestNotifications(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

async function registration() {
  try {
    return (await navigator.serviceWorker?.getRegistration()) ?? null
  } catch {
    return null
  }
}

/** Shows (or replaces) the single Stretch notification. */
export async function notify(alert: Alert) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const options = {
    body: alert.body,
    tag: TAG,
    icon: '/icon-192.png',
    renotify: true,
    // The app plays its own chime.
    silent: true,
    requireInteraction: alert.sticky ?? false,
    data: alert.data,
    actions: alert.actions,
  } as NotificationOptions
  const reg = await registration()
  if (reg) {
    await reg.showNotification(alert.title, options)
  } else {
    const n = new Notification(alert.title, {
      ...options,
      actions: undefined,
    } as NotificationOptions)
    n.onclick = () => {
      window.focus()
      n.close()
    }
  }
}

export async function clearNotification() {
  const reg = await registration()
  const list = (await reg?.getNotifications({ tag: TAG })) ?? []
  for (const n of list) n.close()
}
