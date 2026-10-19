import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Activity,
  ActivityEvent,
  Settings,
  Source,
  Status,
} from './model.ts'
import { mergeSettings } from './model.ts'
import { sortEvents } from './timeline.ts'
import { addDays, isoLocal, startOfDay } from './time.ts'

interface Doc<T> {
  value: T
  updatedAt: string
}
export interface Snapshot {
  events: ActivityEvent[]
  docs: { settings?: Doc<Partial<Settings>>; status?: Doc<Status> }
}
type DocKey = keyof Snapshot['docs']

type Op =
  | { kind: 'event'; id: string; body: Omit<ActivityEvent, 'id'> }
  | { kind: 'delete'; id: string }
  | { kind: 'doc'; key: DocKey; body: Doc<object> }

const SNAPSHOT_KEY = 'stretch.snapshot'
const OUTBOX_KEY = 'stretch.outbox'

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
export function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable (private mode); the server stays authoritative.
  }
}

/** Applies queued changes on top of a server snapshot. */
function applyOps(snapshot: Snapshot, ops: Op[]): Snapshot {
  let events = snapshot.events
  const docs = { ...snapshot.docs }
  for (const op of ops) {
    if (op.kind === 'event') {
      events = [
        ...events.filter((e) => e.id !== op.id),
        { id: op.id, ...op.body },
      ]
    } else if (op.kind === 'delete') {
      events = events.filter((e) => e.id !== op.id)
    } else if (!docs[op.key] || docs[op.key]!.updatedAt <= op.body.updatedAt) {
      docs[op.key] = op.body as never
    }
  }
  return { events: sortEvents(events), docs }
}

class Rejected extends Error {}

async function send(op: Op): Promise<void> {
  const path =
    op.kind === 'doc'
      ? `/api/docs/${op.key}`
      : `/api/events/${encodeURIComponent(op.id)}`
  const remove = op.kind === 'delete'
  const res = await fetch(path, {
    method: remove ? 'DELETE' : 'PUT',
    headers: remove ? {} : { 'Content-Type': 'application/json' },
    body: remove ? undefined : JSON.stringify(op.body),
  })
  if (res.ok) return
  const message = await res
    .json()
    .then((d) => d.message as string)
    .catch(() => res.statusText)
  // 4xx means the server rejected this change for good; drop it rather than
  // blocking every later save behind it.
  if (res.status >= 400 && res.status < 500)
    throw new Rejected(message || 'The server rejected a change.')
  throw new Error(message)
}

export type SyncStatus = 'loading' | 'synced' | 'pending' | 'offline'

export const newId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export function useStore() {
  const [server, setServer] = useState<Snapshot | null>(() =>
    load<Snapshot | null>(SNAPSHOT_KEY, null),
  )
  const [outbox, setOutbox] = useState<Op[]>(() => load(OUTBOX_KEY, []))
  const [online, setOnline] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const flushing = useRef(false)
  const outboxRef = useRef(outbox)
  outboxRef.current = outbox

  const refresh = useCallback(async () => {
    try {
      // From the start of yesterday: today's timeline plus overnight context.
      const from = encodeURIComponent(
        isoLocal(addDays(startOfDay(Date.now()), -1)),
      )
      const res = await fetch(`/api/state?from=${from}`)
      if (!res.ok) throw new Error(res.statusText)
      const data = (await res.json()) as Snapshot
      setServer(data)
      persist(SNAPSHOT_KEY, data)
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    try {
      // Changes queued while this flush was refreshing would otherwise wait
      // for the retry timer, so keep going until the outbox is empty.
      do {
        while (outboxRef.current.length) {
          const op = outboxRef.current[0]
          try {
            await send(op)
          } catch (e) {
            if (!(e instanceof Rejected)) {
              setOnline(false)
              return
            }
            setError(e.message)
          }
          const rest = outboxRef.current.filter((o) => o !== op)
          outboxRef.current = rest
          setOutbox(rest)
          persist(OUTBOX_KEY, rest)
        }
        setOnline(true)
        await refresh()
      } while (outboxRef.current.length)
    } finally {
      flushing.current = false
    }
  }, [refresh])

  const enqueue = useCallback(
    (op: Op) => {
      const next = [...outboxRef.current, op]
      outboxRef.current = next
      setOutbox(next)
      persist(OUTBOX_KEY, next)
      void flush()
    },
    [flush],
  )

  useEffect(() => {
    void refresh().then(flush)
    const retry = () => void flush().then(refresh)
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => {
      if (outboxRef.current.length) void flush()
    }, 15000)
    // Other devices' changes arrive as "changed" pings; refetch shortly after.
    let pending: ReturnType<typeof setTimeout> | undefined
    const live =
      typeof EventSource === 'function' ? new EventSource('/api/live') : null
    live?.addEventListener('changed', () => {
      clearTimeout(pending)
      pending = setTimeout(retry, 250)
    })
    live?.addEventListener('open', () => setOnline(true))
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
      clearTimeout(pending)
      live?.close()
    }
  }, [refresh, flush])

  const view = useMemo(
    () => (server ? applyOps(server, outbox) : null),
    [server, outbox],
  )
  const settings = useMemo(
    () => mergeSettings(view?.docs.settings?.value),
    [view],
  )
  const status: Status = view?.docs.status?.value ?? {}
  const sync: SyncStatus = !online
    ? 'offline'
    : !server
      ? 'loading'
      : outbox.length
        ? 'pending'
        : 'synced'

  const saveEvent = useCallback(
    (event: Omit<ActivityEvent, 'updatedAt'>) =>
      enqueue({
        kind: 'event',
        id: event.id,
        body: {
          at: event.at,
          activity: event.activity,
          source: event.source,
          updatedAt: new Date().toISOString(),
        },
      }),
    [enqueue],
  )

  return {
    ready: view !== null,
    events: view?.events ?? [],
    settings,
    status,
    sync,
    error,
    clearError: () => setError(null),
    /** Records a change of activity, now or at an earlier time. */
    record: (
      activity: Activity,
      at = Date.now(),
      source: Source = 'manual',
    ) => {
      const id = newId()
      saveEvent({ id, at: isoLocal(at), activity, source })
      return id
    },
    saveEvent,
    deleteEvent: (id: string) => enqueue({ kind: 'delete', id }),
    saveSettings: (value: Settings) =>
      enqueue({
        kind: 'doc',
        key: 'settings',
        body: { value, updatedAt: new Date().toISOString() },
      }),
    saveStatus: (value: Status) =>
      enqueue({
        kind: 'doc',
        key: 'status',
        body: { value, updatedAt: new Date().toISOString() },
      }),
  }
}

export type Store = ReturnType<typeof useStore>
