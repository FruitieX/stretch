import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, Device, Status } from './model.ts'
import { DOING, LABELS } from './model.ts'
import {
  plan as makePlan,
  snoozeFor,
  type Current,
  type Plan,
} from './planner.ts'
import { onIdle, onReturn, SLEEP_GAP } from './idle.ts'
import { clearNotification, notify } from './notify.ts'
import { chime } from './sound.ts'
import { deviceId } from './device.ts'
import { load, persist, type Store } from './store.ts'
import { MINUTE, dayKey, duration, isoLocal } from './time.ts'
import { backfill, type Row } from './backfill.ts'
import { diff, switchTo, toMarks, type Mark } from './edit.ts'

const TICK = 5000
const FIRED_KEY = 'stretch.fired'

export interface Returned {
  awayMinutes: number
  lunch: boolean
  awayEventId: string
  resumedEventId: string | null
  resumed: Activity | null
}

interface IdleDetectorLike extends EventTarget {
  userState: 'active' | 'idle' | null
  screenState: 'locked' | 'unlocked' | null
  start(options: { threshold: number; signal: AbortSignal }): Promise<void>
}
type IdleDetectorClass = {
  new (): IdleDetectorLike
  requestPermission(): Promise<'granted' | 'denied'>
}
const IdleDetector = (globalThis as { IdleDetector?: IdleDetectorClass })
  .IdleDetector

export const idleDetectionSupported = () => Boolean(IdleDetector)

export async function requestIdleDetection(): Promise<boolean> {
  if (!IdleDetector) return false
  try {
    return (await IdleDetector.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Only one tab per browser plays alerts. */
function useAlertLeader(): boolean {
  const [leader, setLeader] = useState(() => !navigator.locks)
  useEffect(() => {
    if (!navigator.locks) return
    const abort = new AbortController()
    navigator.locks
      .request('stretch-alerts', { signal: abort.signal }, () => {
        setLeader(true)
        // Hold the lock until this tab closes.
        return new Promise<void>((resolve) =>
          abort.signal.addEventListener('abort', () => resolve()),
        )
      })
      .catch(() => {})
    return () => abort.abort()
  }, [])
  return leader
}

function alertFor(
  p: Plan,
): { key: string; level: number; title: string; body: string } | null {
  const { current, suggestion, still } = p
  if (!current) return null
  const doing = `${DOING[current.activity]} for ${duration(current.elapsed)}`
  const next = suggestion
    ? suggestion.activity === 'break' && suggestion.then
      ? `Move for a few minutes, then ${LABELS[suggestion.then].toLowerCase()}.`
      : `Time to ${LABELS[suggestion.activity].toLowerCase()}?`
    : 'Time to move.'
  if (still && still.level > 0) {
    return {
      key: `still:${current.eventId}:${still.dueAt}:${still.level}`,
      level: still.level,
      title: doing,
      body: next,
    }
  }
  if (suggestion?.due) {
    return {
      key: `suggest:${current.eventId}:${suggestion.dueAt}`,
      level: 1,
      title: next,
      body: suggestion.reason,
    }
  }
  return null
}

export function useEngine(store: Store, device: Device) {
  const [now, setNow] = useState(Date.now)
  const [returned, setReturned] = useState<Returned | null>(null)
  const me = useMemo(deviceId, [])
  const leader = useAlertLeader()
  const p = useMemo(
    () => makePlan(now, store.events, store.settings, device, store.status),
    [now, store.events, store.settings, device, store.status],
  )

  // Handlers read the latest values without re-subscribing.
  const latest = useRef({ p, store, device, status: store.status })
  latest.current = { p, store, device, status: store.status }

  const setStatus = useCallback((patch: Partial<Status>) => {
    const { store } = latest.current
    store.saveStatus({ ...store.status, ...patch })
  }, [])

  /** The user is here: this device becomes the one that tracks idle time. */
  const claim = useCallback(() => {
    const { status } = latest.current
    if (status.activeDevice !== me) setStatus({ activeDevice: me })
  }, [me, setStatus])

  /** Applies a timeline edit (see edit.ts) as saves and deletes. */
  const applyEdit = useCallback(
    (change: (marks: Mark[], now: number) => Mark[]) => {
      const { store } = latest.current
      const before = toMarks(store.events)
      const ops = diff(before, change(before, Date.now()))
      for (const id of ops.remove) store.deleteEvent(id)
      for (const m of ops.update) {
        const event = store.events.find((e) => e.id === m.id)
        if (event) {
          store.saveEvent({
            ...event,
            at: isoLocal(m.at),
            activity: m.activity,
            source: 'manual',
          })
        }
      }
      for (const m of ops.add) store.record(m.activity, m.at, m.source)
      setReturned(null)
      claim()
      return ops
    },
    [claim],
  )

  /** Switches activity now; a switch within a minute corrects the last one. */
  const choose = useCallback(
    (activity: Activity) => {
      const ops = applyEdit((marks, now) => switchTo(marks, activity, now))
      // "Not now" belonged to the activity that was just relabelled.
      const snoozed = latest.current.status.snooze?.eventId
      if (snoozed && ops.update.some((m) => m.id === snoozed)) {
        setStatus({ snooze: undefined })
      }
      void clearNotification()
    },
    [applyEdit, setStatus],
  )

  const snooze = useCallback(() => {
    const { p, status } = latest.current
    setStatus({ snooze: snoozeFor(p, status, Date.now()) })
    void clearNotification()
  }, [setStatus])

  /** Records `away` (or `off`) from `since`; returns the current activity as it now stands. */
  const goIdle = useCallback(
    (since: number): Current | null => {
      const { p, store, status } = latest.current
      if (status.activeDevice && status.activeDevice !== me) return null
      const change = onIdle(p.current, since, store.settings)
      if (!change || !p.current) return null
      const eventId = store.record(change.activity, change.at, change.source)
      return {
        eventId,
        activity: change.activity,
        source: change.source,
        previous: p.current.activity,
        since: change.at,
        elapsed: (Date.now() - change.at) / MINUTE,
      }
    },
    [me],
  )

  /** The user is back; `away` is the idle change if it was only just recorded. */
  const comeBack = useCallback(
    (away?: Current | null) => {
      const { p, store } = latest.current
      const current = away ?? p.current
      const result = onReturn(
        current,
        Date.now(),
        store.settings,
        p.totals.eat > 0,
      )
      if (!result || !current) return
      const resumedEventId = result.change
        ? store.record(
            result.change.activity,
            result.change.at,
            result.change.source,
          )
        : null
      if (result.change?.activity !== 'off') {
        setReturned({
          awayMinutes: result.awayMinutes,
          lunch: result.lunch,
          awayEventId: current.eventId,
          resumedEventId,
          resumed: result.change?.activity ?? null,
        })
      }
      claim()
    },
    [claim],
  )

  // Clock, plus sleep detection: a tick arriving far too late means the
  // machine slept, which counts as being away.
  useEffect(() => {
    let last = Date.now()
    const tick = () => {
      const t = Date.now()
      if (t - last > SLEEP_GAP) {
        const { store } = latest.current
        if (t - last >= store.settings.awayAfter * MINUTE) {
          const away = goIdle(last)
          if (away) comeBack(away)
        }
      }
      last = t
      setNow(t)
    }
    const timer = setInterval(tick, TICK)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [goIdle, comeBack])

  // Idle Detection API (Chromium): idle or a locked screen means away.
  useEffect(() => {
    if (!device.idleDetection || !IdleDetector) return
    const abort = new AbortController()
    const detector = new IdleDetector()
    const threshold = Math.max(1, store.settings.awayAfter) * MINUTE
    let idle = false
    detector.addEventListener('change', () => {
      const nowIdle =
        detector.userState === 'idle' || detector.screenState === 'locked'
      if (nowIdle === idle) return
      idle = nowIdle
      if (idle) {
        const locked =
          detector.screenState === 'locked' && detector.userState !== 'idle'
        goIdle(Date.now() - (locked ? 0 : threshold))
      } else {
        comeBack()
      }
    })
    detector.start({ threshold, signal: abort.signal }).catch(() => {})
    return () => abort.abort()
  }, [device.idleDetection, store.settings.awayAfter, goIdle, comeBack])

  // Interacting with the page also means the user is back.
  useEffect(() => {
    const onInput = () => {
      const { p } = latest.current
      if (p.current?.activity === 'away' && p.current.source === 'idle')
        comeBack()
    }
    window.addEventListener('pointerdown', onInput)
    window.addEventListener('keydown', onInput)
    return () => {
      window.removeEventListener('pointerdown', onInput)
      window.removeEventListener('keydown', onInput)
    }
  }, [comeBack])

  // Notification buttons (handled by the service worker) arrive here.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as {
        type?: string
        action?: string
        data?: { activity?: Activity }
      }
      if (msg?.type !== 'stretch-notification') return
      if (msg.action === 'accept' && msg.data?.activity)
        choose(msg.data.activity)
      else if (msg.action === 'snooze') snooze()
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () =>
      navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [choose, snooze])

  // Alerts: each one fires once per browser, from the leader tab.
  const alert = alertFor(p)
  useEffect(() => {
    if (!alert || !leader || !device.alerts || p.quiet || p.inCall) return
    const fired = load<string[]>(FIRED_KEY, [])
    if (fired.includes(alert.key)) return
    persist(FIRED_KEY, [...fired.slice(-49), alert.key])
    if (device.sound) chime(alert.level, device.volume)
    const target = p.suggestion
      ? p.suggestion.activity === 'break' && p.suggestion.then
        ? 'break'
        : p.suggestion.activity
      : 'break'
    void notify({
      title: alert.title,
      body: alert.body,
      sticky: alert.level >= 2,
      data: { activity: target },
      actions: [
        {
          action: 'accept',
          title: target === 'break' ? 'Take a break' : `${LABELS[target]} now`,
        },
        { action: 'snooze', title: 'Not now' },
      ],
    })
  }, [alert?.key, leader, device, p.quiet, p.inCall]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to alert about any more (switched, snoozed): drop the notification.
  const hasAlert = Boolean(alert)
  useEffect(() => {
    if (!hasAlert) void clearNotification()
  }, [hasAlert])

  // The tab title doubles as a reminder; escalated alarms blink.
  useEffect(() => {
    let title = 'Stretch'
    if (alert && !p.quiet) {
      const blink = alert.level >= 2 && Math.floor(now / TICK) % 2 === 0
      title = `${blink ? '⚠' : '●'} ${alert.level >= 2 ? alert.title : alert.title.replace(/\?$/, '')} · Stretch`
    } else if (p.current && !p.quiet) {
      title = `${DOING[p.current.activity]} ${Math.round(p.current.elapsed)}m · Stretch`
    }
    document.title = title
  }, [alert, now, p.current, p.quiet])

  return {
    now,
    plan: p,
    returned,
    dismissReturned: () => setReturned(null),
    choose,
    snooze,
    /** "That was lunch": the away time becomes eating. */
    wasLunch: () => {
      const r = latest.current
      const away = r.store.events.find((e) => e.id === returned?.awayEventId)
      if (away)
        r.store.saveEvent({ ...away, activity: 'eat', source: 'manual' })
      setReturned(null)
    },
    /** "I was away N minutes": records a break from then and resumes now. */
    wasAway: (minutes: number) => {
      const { p, store } = latest.current
      const resume = p.current?.activity ?? 'sit'
      store.record('break', Date.now() - minutes * MINUTE)
      store.record(
        resume === 'break' || resume === 'away' ? 'sit' : resume,
        Date.now() + 1,
      )
      claim()
    },
    /**
     * "Doing rows[0] since …, before that rows[1] since …" (newest first).
     * Returns an error message, or null once saved.
     */
    rewrite: (rows: Row[]): string | null => {
      const { p, store } = latest.current
      const event = store.events.find((e) => e.id === p.current?.eventId)
      if (!event) return 'Pick what you’re doing first.'
      const result = backfill(store.events, event, rows, Date.now())
      if ('error' in result) return result.error
      for (const id of result.remove) store.deleteEvent(id)
      for (const row of result.add) store.record(row.activity, row.start)
      store.saveEvent({
        ...event,
        activity: result.update.activity,
        at: isoLocal(result.update.at),
        source: 'manual',
      })
      setReturned(null)
      claim()
      return null
    },
    editTimeline: applyEdit,
    setCall: (minutes: number | null) =>
      setStatus({
        callUntil: minutes ? Date.now() + minutes * MINUTE : undefined,
      }),
    setPaused: (paused: boolean) =>
      setStatus({ pausedDay: paused ? dayKey(Date.now()) : undefined }),
  }
}

export type Engine = ReturnType<typeof useEngine>
