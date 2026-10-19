import { useRef, useState, type PointerEvent } from 'react'
import { useApp } from '../app.tsx'
import { ActivityIcon, Button, color } from './ui.tsx'
import { DOING, LABELS, type Activity } from '../lib/model.ts'
import {
  SNAP,
  snapTime,
  deleteSpan,
  edgeLimits,
  editSpan,
  moveEdge,
  paint,
  replaced,
  slideBlock,
  slideLimits,
  toMarks,
  type Mark as Change,
} from '../lib/edit.ts'
import { sortEvents, spans, time, type Span } from '../lib/timeline.ts'
import {
  HOUR,
  MINUTE,
  addDays,
  atClock,
  clock,
  duration,
  isoLocal,
  startOfDay,
} from '../lib/time.ts'

interface Mark {
  activity: Activity
  start: number
  end: number
  planned: boolean
  span?: Span
}

type Selection =
  { kind: 'span'; span: Span } | { kind: 'new'; from: number; to: number }

interface Resize {
  id: string
  at: number
  min: number
  max: number
}

const CHOICES: Activity[] = ['sit', 'stand', 'walk', 'eat', 'break']

/**
 * Today on one line: what happened (solid) and a possible rest of the day
 * (faded). Click a block to edit it, drag its edges to resize it, or drag
 * across the bar to fill in a time range.
 */
export function DayBar() {
  const { engine, store } = useApp()
  const now = engine.now
  const dayStart = startOfDay(now)
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Mark | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [drag, setDrag] = useState<{
    x: number
    from: number
    to: number
    moved: boolean
  } | null>(null)
  const [resize, setResize] = useState<Resize | null>(null)
  const [slide, setSlide] = useState<{
    id: string
    span: Span
    x: number
    delta: number
    min: number
    max: number
    moved: boolean
  } | null>(null)

  // While resizing or sliding, show the timeline as it will be after
  // letting go.
  const moving = resize !== null || (slide?.moved ?? false)
  const preview = (marks: Change[]) =>
    resize
      ? moveEdge(marks, resize.id, resize.at, Date.now(), dayStart)
      : slide?.moved
        ? slideBlock(marks, slide.id, slide.delta, Date.now(), dayStart)
        : marks
  const today = moving
    ? spans(
        sortEvents(
          preview(toMarks(store.events)).map((m) => ({
            id: m.id ?? '',
            at: isoLocal(m.at),
            activity: m.activity,
            source: m.source,
            updatedAt: '',
          })),
        ),
        dayStart,
        addDays(dayStart, 1),
        now,
        store.settings,
      )
    : engine.plan.today

  // Block edges are activity changes; an edge between two untracked
  // stretches has no block to resize.
  const edges = store.events.filter((e, i) => {
    const t = time(e)
    if (t < dayStart || t > now) return false
    const prev = store.events[i - 1]
    const before = prev && time(prev) >= dayStart ? prev.activity : 'off'
    return e.activity !== 'off' || before !== 'off'
  })

  const marks: Mark[] = [
    ...today.map((s) => ({
      activity: s.activity,
      start: s.start,
      end: s.end,
      planned: false,
      span: s,
    })),
    ...(moving ? [] : engine.plan.preview)
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

  const rawTimeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    return from + ((clientX - rect.left) / rect.width) * span
  }
  /** The time under the pointer, snapped and never in the future. */
  const timeAt = (clientX: number) =>
    Math.min(now, Math.max(from, snapTime(rawTimeAt(clientX), edgeTimes())))
  /** Block edges to snap to (plus now), leaving out the ones being moved. */
  const edgeTimes = (...moving: number[]) =>
    [...edges.map(time), now].filter((t) => !moving.includes(t))

  // Dragging a block slides it; dragging across empty time fills in a
  // range; a click edits or adds a block.
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    track.current!.setPointerCapture(e.pointerId)
    const raw = rawTimeAt(e.clientX)
    const hit = today.find((s) => s.start <= raw && raw < s.end)
    const event = hit && store.events.find((x) => x.id === hit.eventId)
    const limits =
      event && time(event) === hit.start
        ? slideLimits(toMarks(store.events), hit.eventId, Date.now(), dayStart)
        : null
    if (hit && limits) {
      setSlide({
        id: hit.eventId,
        span: hit,
        x: e.clientX,
        delta: 0,
        moved: false,
        ...limits,
      })
      return
    }
    const t = timeAt(e.clientX)
    setDrag({ x: e.clientX, from: t, to: t, moved: false })
  }
  const onMove = (e: PointerEvent) => {
    if (slide) {
      const moved = slide.moved || Math.abs(e.clientX - slide.x) > 4
      const raw = rawTimeAt(e.clientX) - rawTimeAt(slide.x)
      // Snap whichever edge of the block lands closer to a snap point.
      const { start, end, open } = slide.span
      const others = edgeTimes(start, end)
      const byStart = snapTime(start + raw, others) - start
      const byEnd = open ? byStart : snapTime(end + raw, others) - end
      const delta =
        Math.abs(byEnd - raw) < Math.abs(byStart - raw) ? byEnd : byStart
      setSlide({
        ...slide,
        moved,
        delta: Math.min(slide.max, Math.max(slide.min, delta)),
      })
      return
    }
    if (!drag) return
    const moved = drag.moved || Math.abs(e.clientX - drag.x) > 4
    setDrag({ ...drag, to: timeAt(e.clientX), moved })
  }
  const onUp = (e: PointerEvent) => {
    if (slide) {
      const { id, delta, moved, span } = slide
      setSlide(null)
      if (!moved) return setSelection({ kind: 'span', span })
      if (delta !== 0) {
        engine.editTimeline((marks, t) =>
          slideBlock(marks, id, delta, t, dayStart),
        )
      }
      return
    }
    if (!drag) return
    setDrag(null)
    if (drag.moved) {
      const a = Math.min(drag.from, drag.to)
      const b = Math.max(drag.from, drag.to)
      if (b - a >= SNAP) setSelection({ kind: 'new', from: a, to: b })
      return
    }
    const t = rawTimeAt(e.clientX)
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

  // Dragging an edge moves that activity change; neighbours stop it.
  const startResize = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const limits = edgeLimits(toMarks(store.events), id, Date.now(), dayStart)
    const event = store.events.find((x) => x.id === id)
    if (!limits || !event || limits.min > limits.max) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelection(null)
    setResize({ id, at: time(event), ...limits })
  }
  const onResize = (e: PointerEvent) => {
    if (!resize) return
    const moving = store.events.find((x) => x.id === resize.id)
    const at = snapTime(
      rawTimeAt(e.clientX),
      edgeTimes(moving ? time(moving) : NaN),
    )
    setResize({
      ...resize,
      at: Math.min(resize.max, Math.max(resize.min, at)),
    })
  }
  const endResize = () => {
    if (!resize) return
    const { id, at } = resize
    setResize(null)
    engine.editTimeline((marks, t) => moveEdge(marks, id, at, t, dayStart))
  }
  const nudge = (id: string, by: number) => {
    const event = store.events.find((x) => x.id === id)
    if (!event) return
    engine.editTimeline((marks, t) =>
      moveEdge(marks, id, time(event) + by, t, dayStart),
    )
  }

  const range = moving
    ? null
    : drag?.moved
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
        aria-label="Today's timeline. Click a block to edit it, drag it to move it, drag its edges to resize it, or drag across empty time to fill it in."
        className="group/track relative h-9 cursor-crosshair touch-pan-y select-none rounded-md bg-surface"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          setDrag(null)
          setSlide(null)
        }}
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
                : slide?.moved
                  ? 'cursor-grabbing'
                  : 'cursor-grab hover:brightness-110'
            }`}
            style={{
              left: `${pos(m.start)}%`,
              width: `${Math.max(0.4, pos(m.end) - pos(m.start))}%`,
              background: color(m.activity),
              opacity: m.planned ? 0.28 : 1,
            }}
          />
        ))}
        {edges.map((e) => {
          const t = resize?.id === e.id ? resize.at : time(e)
          if (t < from) return null
          const active = resize?.id === e.id
          return (
            <div
              key={e.id}
              role="separator"
              aria-orientation="vertical"
              aria-label={`Switch at ${clock(t)}. Drag, or use the arrow keys, to move it.`}
              aria-valuetext={clock(t)}
              tabIndex={0}
              title={`${clock(t)} · drag to resize`}
              onPointerDown={(ev) => startResize(ev, e.id)}
              onPointerMove={onResize}
              onPointerUp={endResize}
              onPointerCancel={() => setResize(null)}
              onKeyDown={(ev) => {
                if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                  ev.preventDefault()
                  nudge(e.id, ev.key === 'ArrowLeft' ? -SNAP : SNAP)
                }
              }}
              className="group/edge absolute -inset-y-1 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
              style={{ left: `${pos(t)}%` }}
            >
              <span
                className={`mx-auto block h-full w-1 rounded bg-ink transition-opacity ${
                  active
                    ? 'opacity-90'
                    : 'opacity-0 group-hover/track:opacity-30 group-hover/edge:!opacity-80 group-focus-visible/edge:!opacity-90'
                }`}
              />
            </div>
          )
        })}
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
        <p className="mt-1 h-4 truncate text-xs leading-4 text-ink-2">
          {resize
            ? `Switch at ${clock(resize.at)}`
            : slide?.moved
              ? `${DOING[slide.span.activity]} ${clock(slide.span.start + slide.delta)}–${clock(slide.span.open ? now : slide.span.end + slide.delta)}`
              : drag?.moved
                ? `${clock(Math.min(drag.from, drag.to))}–${clock(Math.max(drag.from, drag.to))}`
                : hover
                  ? label(hover)
                  : 'Click to edit · drag to move · drag edges to resize · drag empty time to fill in'}
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
  const { engine, store } = useApp()
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

  const apply = (marks: Change[], t: number) =>
    span
      ? editSpan(
          marks,
          {
            id: span.eventId,
            start: span.start,
            end: span.end,
            open: span.open,
          },
          activity,
          start,
          untilNow ? t : end,
          t,
        )
      : paint(marks, start, untilNow ? t : end, activity, t)

  // Blocks can't overlap: whatever the new times fully cover is replaced,
  // so say so before saving.
  const before = toMarks(store.events)
  const lost = valid
    ? replaced(before, apply(before, now), now).map((m) => {
        const next = before.find((x) => x.at > m.at)
        return `${DOING[m.activity].toLowerCase()} ${clock(m.at)}–${clock(next ? next.at : now)}`
      })
    : []

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
      {lost.length > 0 && (
        <p className="text-xs text-alarm" role="status">
          Replaces {lost.join(', ')}.
        </p>
      )}
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
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() => {
            engine.editTimeline(apply)
            onClose()
          }}
        >
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
