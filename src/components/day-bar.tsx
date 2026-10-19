import { useRef, useState, type PointerEvent } from 'react'
import { useApp } from '../app.tsx'
import { ActivityIcon, Button, color } from './ui.tsx'
import { DOING, LABELS, type Activity } from '../lib/model.ts'
import { deleteSpan, editSpan, paint } from '../lib/edit.ts'
import type { Span } from '../lib/timeline.ts'
import { HOUR, MINUTE, atClock, clock, duration } from '../lib/time.ts'

interface Mark {
  activity: Activity
  start: number
  end: number
  planned: boolean
  span?: Span
}

type Selection =
  { kind: 'span'; span: Span } | { kind: 'new'; from: number; to: number }

const SNAP = 5 * MINUTE
const CHOICES: Activity[] = ['sit', 'stand', 'walk', 'eat', 'break']

/**
 * Today on one line: what happened (solid) and a possible rest of the day
 * (faded). Click a block to edit it; drag across the bar to fill in a time
 * range.
 */
export function DayBar() {
  const { engine, store } = useApp()
  const { today, preview } = engine.plan
  const now = engine.now
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Mark | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [drag, setDrag] = useState<{
    x: number
    from: number
    to: number
    moved: boolean
  } | null>(null)

  const marks: Mark[] = [
    ...today.map((s) => ({
      activity: s.activity,
      start: s.start,
      end: s.end,
      planned: false,
      span: s,
    })),
    ...preview
      .filter((b) => b.end > now)
      .map((b) => ({
        activity: b.activity,
        start: Math.max(b.start, now),
        end: b.end,
        planned: true,
      })),
  ]
  // An hour before the workday leaves room to fill in an early start.
  const from = Math.min(
    atClock(now, store.settings.workdayStart) - HOUR,
    ...marks.map((m) => m.start),
  )
  const to = Math.max(
    atClock(now, store.settings.workdayEnd),
    now,
    ...marks.map((m) => m.end),
  )
  const span = Math.max(1, to - from)
  const pos = (t: number) => ((t - from) / span) * 100
  const hours: number[] = []
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) hours.push(t)

  /** The time under the pointer, snapped and never in the future. */
  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    const t = from + ((clientX - rect.left) / rect.width) * span
    return Math.min(now, Math.max(from, Math.round(t / SNAP) * SNAP))
  }

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const t = timeAt(e.clientX)
    track.current!.setPointerCapture(e.pointerId)
    setDrag({ x: e.clientX, from: t, to: t, moved: false })
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    const moved = drag.moved || Math.abs(e.clientX - drag.x) > 4
    setDrag({ ...drag, to: timeAt(e.clientX), moved })
  }
  const onUp = (e: PointerEvent) => {
    if (!drag) return
    setDrag(null)
    if (drag.moved) {
      const a = Math.min(drag.from, drag.to)
      const b = Math.max(drag.from, drag.to)
      if (b - a >= SNAP) setSelection({ kind: 'new', from: a, to: b })
      return
    }
    // A click: edit the block under the pointer, or start a new one.
    const t =
      from +
      ((e.clientX - track.current!.getBoundingClientRect().left) /
        track.current!.getBoundingClientRect().width) *
        span
    const hit = today.find((s) => s.start <= t && t < s.end)
    if (hit) return setSelection({ kind: 'span', span: hit })
    if (t > now) return
    const start = Math.min(drag.from, now - SNAP)
    const next = Math.min(
      now,
      ...today.filter((s) => s.start > start).map((s) => s.start),
    )
    setSelection({
      kind: 'new',
      from: start,
      to: Math.min(next, start + 30 * MINUTE),
    })
  }

  const range = drag?.moved
    ? { a: Math.min(drag.from, drag.to), b: Math.max(drag.from, drag.to) }
    : selection?.kind === 'new'
      ? { a: selection.from, b: selection.to }
      : selection?.kind === 'span'
        ? { a: selection.span.start, b: selection.span.end }
        : null

  return (
    <div>
      <div
        ref={track}
        data-start={from}
        data-end={to}
        role="group"
        aria-label="Today's timeline. Click a block to edit it, or drag to fill in a time range."
        className="relative h-9 cursor-crosshair touch-pan-y select-none rounded-md bg-surface"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        onMouseLeave={() => setHover(null)}
      >
        {marks.map((m, i) => (
          <button
            key={i}
            type="button"
            tabIndex={m.planned ? -1 : 0}
            aria-label={label(m)}
            title={m.planned ? label(m) : `${label(m)} · click to edit`}
            onMouseEnter={() => setHover(m)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && m.span) {
                e.preventDefault()
                setSelection({ kind: 'span', span: m.span })
              }
            }}
            className={`absolute inset-y-0 rounded-[4px] border-x border-[var(--card)] ${
              m.planned
                ? 'pointer-events-none'
                : 'cursor-pointer hover:brightness-110'
            }`}
            style={{
              left: `${pos(m.start)}%`,
              width: `${Math.max(0.4, pos(m.end) - pos(m.start))}%`,
              background: color(m.activity),
              opacity: m.planned ? 0.28 : 1,
            }}
          />
        ))}
        {range && (
          <div
            className="pointer-events-none absolute -inset-y-1 rounded-md ring-2 ring-ink"
            style={{
              left: `${pos(range.a)}%`,
              width: `${Math.max(0.4, pos(range.b) - pos(range.a))}%`,
            }}
            aria-hidden
          />
        )}
        <div
          className="pointer-events-none absolute -inset-y-1 w-0.5 rounded bg-ink"
          style={{ left: `${pos(now)}%` }}
          aria-hidden
        />
      </div>
      <div
        className="relative mt-1 h-4 text-[10px] tabular-nums text-ink-3"
        aria-hidden
      >
        {hours.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${pos(t)}%` }}
          >
            {new Date(t).getHours()}
          </span>
        ))}
      </div>
      {selection ? (
        <BlockEditor
          key={
            selection.kind === 'span'
              ? selection.span.eventId + selection.span.start
              : `${selection.from}-${selection.to}`
          }
          selection={selection}
          onClose={() => setSelection(null)}
        />
      ) : (
        <p className="mt-1 min-h-5 text-xs text-ink-2">
          {drag?.moved
            ? `${clock(Math.min(drag.from, drag.to))}–${clock(Math.max(drag.from, drag.to))}`
            : hover
              ? label(hover)
              : 'Click a block to edit it, or drag across the bar to fill in time.'}
        </p>
      )}
    </div>
  )
}

function BlockEditor({
  selection,
  onClose,
}: {
  selection: Selection
  onClose: () => void
}) {
  const { engine } = useApp()
  const now = engine.now
  const span = selection.kind === 'span' ? selection.span : null
  const [activity, setActivity] = useState<Activity>(span?.activity ?? 'sit')
  const [start, setStart] = useState(
    span?.start ?? (selection as { from: number }).from,
  )
  const initialEnd = span
    ? span.open
      ? now
      : span.end
    : (selection as { to: number }).to
  const [end, setEnd] = useState(initialEnd)
  const [untilNow, setUntilNow] = useState(
    span?.open ?? initialEnd >= now - MINUTE,
  )
  const stop = untilNow ? now : end
  const valid = start < stop && start <= now

  const save = () => {
    if (span) {
      const ref = {
        id: span.eventId,
        start: span.start,
        end: span.end,
        open: span.open,
      }
      engine.editTimeline((marks, t) =>
        editSpan(marks, ref, activity, start, untilNow ? t : end, t),
      )
    } else {
      engine.editTimeline((marks, t) =>
        paint(marks, start, untilNow ? t : end, activity, t),
      )
    }
    onClose()
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-surface p-3">
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Activity"
      >
        {CHOICES.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={activity === a}
            onClick={() => setActivity(a)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm ring-1 ${
              activity === a
                ? 'text-white ring-transparent'
                : 'bg-card ring-line'
            }`}
            style={activity === a ? { background: color(a) } : undefined}
          >
            <ActivityIcon activity={a} size={14} /> {LABELS[a]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="time"
          aria-label="From"
          value={clock(start)}
          onChange={(e) =>
            /^\d{1,2}:\d{2}$/.test(e.target.value) &&
            setStart(atClock(now, e.target.value))
          }
          className="rounded-lg bg-card px-2 py-1 ring-1 ring-line"
        />
        –
        {untilNow ? (
          <span className="px-1">now</span>
        ) : (
          <input
            type="time"
            aria-label="To"
            value={clock(end)}
            onChange={(e) =>
              /^\d{1,2}:\d{2}$/.test(e.target.value) &&
              setEnd(atClock(now, e.target.value))
            }
            className="rounded-lg bg-card px-2 py-1 ring-1 ring-line"
          />
        )}
        {!span?.open && (
          <label className="flex items-center gap-1.5 text-ink-2">
            <input
              type="checkbox"
              checked={untilNow}
              onChange={(e) => setUntilNow(e.target.checked)}
              className="accent-[var(--sit)]"
            />
            until now
          </label>
        )}
        <span className="ml-auto text-xs tabular-nums text-ink-3">
          {valid ? duration((stop - start) / MINUTE) : 'Check the times'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {span && (
          <Button
            variant="ghost"
            onClick={() => {
              const ref = {
                id: span.eventId,
                start: span.start,
                end: span.end,
                open: span.open,
              }
              engine.editTimeline((marks, t) => deleteSpan(marks, ref, t))
              onClose()
            }}
          >
            Delete
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}

function label(m: Mark) {
  const what = DOING[m.activity]
  return `${clock(m.start)}–${clock(m.end)} · ${m.planned ? `Maybe ${what.toLowerCase()}` : what} · ${duration((m.end - m.start) / MINUTE)}`
}
