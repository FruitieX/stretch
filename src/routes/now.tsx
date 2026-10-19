import { useState } from 'react'
import { BellOff, Pause, Phone, Play, Undo2, X } from 'lucide-react'
import { useApp } from '../app.tsx'
import { ActivityIcon, Button, Card, Meter, color } from '../components/ui.tsx'
import { DayBar } from '../components/day-bar.tsx'
import { SetupBanner } from '../components/setup.tsx'
import {
  DOING,
  LABELS,
  isPosture,
  isStill,
  type Activity,
} from '../lib/model.ts'
import { MINUTE, clock, duration, short } from '../lib/time.ts'

const PICK: Activity[] = ['sit', 'stand', 'walk', 'eat', 'break']
const KEY_HINT: Partial<Record<Activity, string>> = {
  sit: '1',
  stand: '2',
  walk: '3',
  eat: '4',
  break: '5',
}

function Hero() {
  const { engine, store } = useApp()
  const { current, suggestion, quiet } = engine.plan
  if (!current) {
    const off = store.events.at(-1)?.activity === 'off'
    return (
      <Card>
        <p className="text-xl font-semibold">
          {off ? 'Done for today' : 'Ready when you are'}
        </p>
        <p className="mt-1 text-sm text-ink-2">
          Tap what you're doing to {off ? 'pick up again' : 'start your day'}.
          Stretch suggests when to switch.
        </p>
      </Card>
    )
  }
  const limit = isPosture(current.activity)
    ? store.settings.limits[current.activity]
    : current.activity === 'break'
      ? store.settings.moveBreak
      : 0
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div
          className="grid size-14 shrink-0 place-items-center rounded-2xl text-white"
          style={{ background: color(current.activity) }}
        >
          <ActivityIcon activity={current.activity} size={28} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-ink-2">
            {DOING[current.activity]} since {clock(current.since)}
          </p>
          <p className="text-3xl font-semibold tabular-nums tracking-tight">
            {duration(current.elapsed)}
          </p>
        </div>
      </div>
      {limit > 0 && (
        <div className="mt-4">
          <Meter
            value={current.elapsed}
            max={limit}
            accent={color(current.activity)}
          />
        </div>
      )}
      <p className="mt-3 text-sm text-ink-2">
        {quiet
          ? engine.plan.inCall
            ? 'In a call.'
            : 'No more suggestions today.'
          : suggestion && !suggestion.due
            ? `Next: ${nextLabel(suggestion.activity, suggestion.then)} around ${clock(suggestion.dueAt)} (in ${duration((suggestion.dueAt - engine.now) / MINUTE)}).`
            : current.activity === 'eat'
              ? 'Enjoy your meal. Suggestions resume when you pick what’s next.'
              : current.activity === 'away'
                ? 'Away. Welcome back whenever.'
                : null}
      </p>
    </Card>
  )
}

function nextLabel(activity: Activity, then?: Activity) {
  if (activity === 'break' && then)
    return `a short move break, then ${LABELS[then].toLowerCase()}`
  return LABELS[activity].toLowerCase()
}

function SuggestionCard() {
  const { engine } = useApp()
  const { suggestion, still, current, quiet } = engine.plan
  const alarm = still && still.level > 0
  if (!current || quiet || (!suggestion?.due && !alarm)) return null
  const target = suggestion?.activity ?? 'break'
  const accent = alarm && still.level >= 2 ? 'var(--alarm)' : color(target)
  const title = suggestion
    ? suggestion.activity === 'break' && suggestion.then
      ? `Move for a few minutes, then ${LABELS[suggestion.then].toLowerCase()}`
      : `Time to ${LABELS[suggestion.activity].toLowerCase()}?`
    : 'Time to move'
  return (
    <Card className="ring-2" style={{ ['--tw-ring-color' as string]: accent }}>
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-0.5 text-sm text-ink-2">
        {alarm && isStill(current.activity)
          ? `${DOING[current.activity]} for ${duration(current.elapsed)} without a change.`
          : suggestion?.reason}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          accent={color(target)}
          onClick={() => engine.choose(target)}
        >
          <ActivityIcon activity={target} size={16} />
          {target === 'break' ? 'Take a break' : `${LABELS[target]} now`}
        </Button>
        <Button onClick={engine.snooze} title="Shortcut: N">
          Not now
        </Button>
      </div>
    </Card>
  )
}

function ReturnedBanner() {
  const { engine } = useApp()
  const r = engine.returned
  if (!r) return null
  return (
    <Card className="flex items-start gap-3">
      <Undo2 size={18} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p>
          Welcome back. Away {duration(r.awayMinutes)}, counted as a break
          {r.resumed ? `; back to ${DOING[r.resumed].toLowerCase()}.` : '.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {r.lunch && (
            <Button onClick={engine.wasLunch}>
              <ActivityIcon activity="eat" size={16} /> That was lunch
            </Button>
          )}
          <span className="self-center text-xs text-ink-3">
            Doing something else? Pick it below.
          </span>
        </div>
      </div>
      <button
        className="text-ink-3 hover:text-ink"
        onClick={engine.dismissReturned}
        aria-label="Dismiss"
      >
        <X size={18} />
      </button>
    </Card>
  )
}

function Picker() {
  const { engine } = useApp()
  const current = engine.plan.current?.activity
  const { available } = engine.plan
  return (
    <div
      className="grid grid-cols-5 gap-2"
      role="group"
      aria-label="What are you doing?"
    >
      {PICK.map((a) => {
        const active = current === a
        const missing = isPosture(a) && !available.includes(a)
        return (
          <button
            key={a}
            type="button"
            aria-pressed={active}
            onClick={() => !active && engine.choose(a)}
            title={`${LABELS[a]} (${KEY_HINT[a]})`}
            className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-sm ring-1 transition-colors ${
              active
                ? 'font-semibold text-white ring-transparent'
                : 'bg-card ring-line hover:bg-surface'
            } ${missing && !active ? 'opacity-50' : ''}`}
            style={active ? { background: color(a) } : undefined}
          >
            <span style={active ? undefined : { color: color(a) }}>
              <ActivityIcon activity={a} size={24} />
            </span>
            {LABELS[a]}
          </button>
        )
      })}
    </div>
  )
}

function QuickActions() {
  const { engine, store } = useApp()
  const [awayOpen, setAwayOpen] = useState(false)
  const { inCall, current } = engine.plan
  const paused = Boolean(store.status.pausedDay) && engine.plan.quiet && !inCall
  const callLeft = inCall
    ? ((store.status.callUntil ?? 0) - engine.now) / MINUTE
    : 0
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {inCall ? (
          <Button onClick={() => engine.setCall(null)} title="End the call">
            <BellOff size={16} /> In a call · {Math.ceil(callLeft)}m · End
          </Button>
        ) : (
          <Button
            onClick={() => engine.setCall(30)}
            title="Mute sound and notifications for 30 minutes"
          >
            <Phone size={16} /> In a call
          </Button>
        )}
        {inCall && (
          <Button
            onClick={() => engine.setCall(callLeft + 30)}
            title="30 more minutes"
          >
            +30m
          </Button>
        )}
        {current && current.activity !== 'away' && (
          <div className="relative">
            <Button
              onClick={() => setAwayOpen((v) => !v)}
              aria-expanded={awayOpen}
            >
              I was away…
            </Button>
            {awayOpen && (
              <div className="absolute left-0 z-10 mt-1 flex gap-1 rounded-xl bg-card p-1 shadow-lg ring-1 ring-line">
                {[5, 10, 15, 30].map((m) => (
                  <Button
                    key={m}
                    variant="ghost"
                    onClick={() => {
                      engine.wasAway(m)
                      setAwayOpen(false)
                    }}
                  >
                    {m}m
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {paused ? (
          <Button variant="ghost" onClick={() => engine.setPaused(false)}>
            <Play size={16} /> Resume
          </Button>
        ) : (
          current && (
            <Button
              variant="ghost"
              onClick={() => engine.setPaused(true)}
              title="No suggestions for the rest of today"
            >
              <Pause size={16} /> Pause
            </Button>
          )
        )}
        {current && (
          <Button
            variant="ghost"
            onClick={() => engine.choose('off')}
            title="Done for today"
          >
            <ActivityIcon activity="off" size={16} /> Done
          </Button>
        )}
      </div>
    </div>
  )
}

function Targets() {
  const { engine, store } = useApp()
  const { totals, available } = engine.plan
  const rows = (['stand', 'walk'] as const).filter((a) => available.includes(a))
  if (!rows.length) return null
  return (
    <div className="grid grid-cols-2 gap-3">
      {rows.map((a) => (
        <div key={a}>
          <div className="mb-1 flex justify-between gap-2 text-xs text-ink-2">
            <span>{DOING[a]}</span>
            <span className="tabular-nums">
              {short(totals[a])} / {short(store.settings.targets[a])}
            </span>
          </div>
          <Meter
            value={totals[a]}
            max={store.settings.targets[a]}
            accent={color(a)}
          />
        </div>
      ))}
    </div>
  )
}

export function NowPage() {
  const { store } = useApp()
  if (!store.ready) return <p className="text-sm text-ink-3">Loading…</p>
  return (
    <div className="flex flex-col gap-4">
      <SetupBanner />
      <ReturnedBanner />
      <SuggestionCard />
      <Hero />
      <Picker />
      <QuickActions />
      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">Today</h2>
        <DayBar />
        <Targets />
      </Card>
    </div>
  )
}
