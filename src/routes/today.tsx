import { useState } from 'react'
import { Plus, Trash } from 'lucide-react'
import { useApp } from '../app.tsx'
import { ActivityIcon, Button, Card, color } from '../components/ui.tsx'
import { DayBar } from '../components/day-bar.tsx'
import {
  ACTIVITIES,
  DOING,
  LABELS,
  type Activity,
  type ActivityEvent,
} from '../lib/model.ts'
import { time } from '../lib/timeline.ts'
import {
  MINUTE,
  atClock,
  clock,
  duration,
  isoLocal,
  startOfDay,
} from '../lib/time.ts'

const SOURCE: Record<ActivityEvent['source'], string> = {
  manual: '',
  idle: 'idle',
  auto: 'auto',
}

function Editor({
  initial,
  initialAt,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: Activity
  initialAt: number
  onSave: (activity: Activity, at: number) => void
  onDelete?: () => void
  onCancel: () => void
}) {
  const [activity, setActivity] = useState(initial)
  const [at, setAt] = useState(clock(initialAt))
  const valid = /^\d{1,2}:\d{2}$/.test(at)
  return (
    <div className="flex flex-col gap-3 py-2">
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Activity"
      >
        {ACTIVITIES.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={activity === a}
            onClick={() => setActivity(a)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm ring-1 ${
              activity === a ? 'text-white ring-transparent' : 'ring-line'
            }`}
            style={activity === a ? { background: color(a) } : undefined}
          >
            <ActivityIcon activity={a} size={14} /> {LABELS[a]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          From
          <input
            type="time"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="rounded-lg bg-surface px-2 py-1.5 ring-1 ring-line"
          />
        </label>
        <span className="flex-1" />
        {onDelete && (
          <Button variant="ghost" onClick={onDelete} aria-label="Delete">
            <Trash size={16} />
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() => onSave(activity, atClock(initialAt, at))}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

export function TodayPage() {
  const { store, engine } = useApp()
  const [editing, setEditing] = useState<string | null>(null)
  const dayStart = startOfDay(engine.now)
  const events = store.events.filter((e) => time(e) >= dayStart).reverse()
  const minutes = new Map(
    engine.plan.today.map((s) => [s.eventId, (s.end - s.start) / MINUTE]),
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <DayBar />
      </Card>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Changes today</h2>
          {editing !== 'new' && (
            <Button variant="ghost" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add
            </Button>
          )}
        </div>
        {editing === 'new' && (
          <Editor
            initial="sit"
            initialAt={engine.now - 15 * MINUTE}
            onCancel={() => setEditing(null)}
            onSave={(a, at) => {
              store.record(a, at)
              setEditing(null)
            }}
          />
        )}
        {!events.length && editing !== 'new' && (
          <p className="py-6 text-center text-sm text-ink-3">
            Nothing yet today. Forgot to switch? Add what you were doing.
          </p>
        )}
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.id}>
              {editing === e.id ? (
                <Editor
                  initial={e.activity}
                  initialAt={time(e)}
                  onCancel={() => setEditing(null)}
                  onDelete={() => {
                    store.deleteEvent(e.id)
                    setEditing(null)
                  }}
                  onSave={(activity, at) => {
                    store.saveEvent({
                      ...e,
                      activity,
                      at: isoLocal(at),
                      source: 'manual',
                    })
                    setEditing(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-surface"
                  onClick={() => setEditing(e.id)}
                >
                  <span className="w-12 text-sm tabular-nums text-ink-2">
                    {clock(time(e))}
                  </span>
                  <span
                    className="grid size-7 place-items-center rounded-lg text-white"
                    style={{ background: color(e.activity) }}
                  >
                    <ActivityIcon activity={e.activity} size={15} />
                  </span>
                  <span className="flex-1 text-sm">
                    {DOING[e.activity]}
                    {SOURCE[e.source] && (
                      <span className="ml-2 text-xs text-ink-3">
                        {SOURCE[e.source]}
                      </span>
                    )}
                  </span>
                  <span className="text-sm tabular-nums text-ink-2">
                    {minutes.has(e.id) ? duration(minutes.get(e.id)!) : ''}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
