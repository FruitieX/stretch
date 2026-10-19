import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BellOff,
  Check,
  Pause,
  Pencil,
  Phone,
  Play,
  Undo2,
  X,
} from 'lucide-react'
import { useApp } from '../app.tsx'
import {
  ActivityIcon,
  Button,
  Card,
  Ring,
  SPRING,
  color,
  tone,
} from '../components/ui.tsx'
import { DayBar } from '../components/day-bar.tsx'
import { AdjustPast, StartedEarlier } from '../components/adjust.tsx'
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
/** A little cheer right after switching. */
const CHEER: Partial<Record<Activity, string[]>> = {
  sit: ['Settle in.', 'Comfy.', 'Focus time.'],
  stand: ['Up you get!', 'Standing tall!', 'Nice, on your feet!'],
  walk: ['Off you go!', 'Step it up!', 'Walk it out!'],
  eat: ['Enjoy your meal!', 'Bon appétit!'],
  break: ['Stretch it out!', 'Shake it off!', 'Good call.'],
}

/** "32 min" / "1 h 05" with big numbers and small units. */
function BigDuration({ minutes }: { minutes: number }) {
  const m = Math.max(0, Math.floor(minutes))
  const unit = 'ml-0.5 mr-2 text-xl font-semibold text-ink-2'
  return (
    <p className="display text-6xl leading-none font-bold tabular-nums">
      {m >= 60 && (
        <>
          {Math.floor(m / 60)}
          <span className={unit}>h</span>
        </>
      )}
      {m >= 60 ? String(m % 60).padStart(2, '0') : m}
      <span className={unit}>min</span>
    </p>
  )
}

function Idle() {
  const { store } = useApp()
  const off = store.events.at(-1)?.activity === 'off'
  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-center gap-5">
        <div className="relative h-24 w-28 shrink-0" aria-hidden>
          {(['sit', 'stand', 'walk'] as const).map((a, i) => (
            <motion.span
              key={a}
              className="tint-strong absolute grid size-12 place-items-center rounded-2xl text-white shadow-soft"
              style={{ ...tone(color(a)), left: i * 30, top: i === 1 ? 0 : 36 }}
              animate={{ y: [0, -7, 0], rotate: [0, i === 1 ? 4 : -4, 0] }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                delay: i * 0.35,
                ease: 'easeInOut',
              }}
            >
              <ActivityIcon activity={a} size={22} strokeWidth={2.4} />
            </motion.span>
          ))}
        </div>
        <div>
          <h1 className="text-3xl font-bold">
            {off ? 'Done for today' : 'Ready when you are'}
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Tap what you're doing to {off ? 'pick up again' : 'start your day'}.
            Stretch suggests when to switch.
          </p>
        </div>
      </div>
    </Card>
  )
}

function Hero() {
  const { engine, store } = useApp()
  const [adjusting, setAdjusting] = useState(false)
  const { current, suggestion, quiet, still } = engine.plan
  const [cheer, setCheer] = useState<string | null>(null)
  const eventId = current?.eventId

  // Cheer briefly whenever a fresh switch happens.
  useEffect(() => {
    if (!current || current.elapsed > 1) return
    const options = CHEER[current.activity]
    if (!options) return
    setCheer(options[Math.floor(Math.random() * options.length)])
    const timer = setTimeout(() => setCheer(null), 4000)
    return () => clearTimeout(timer)
  }, [eventId, current?.activity]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return <Idle />
  const limit = isPosture(current.activity)
    ? store.settings.limits[current.activity]
    : current.activity === 'break'
      ? store.settings.moveBreak
      : 0
  const alarm = Boolean(still && still.level > 0)
  const accent = alarm ? 'var(--alarm)' : color(current.activity)
  const next = quiet
    ? engine.plan.inCall
      ? 'In a call.'
      : 'No more suggestions today.'
    : suggestion && !suggestion.due
      ? `Next: ${nextLabel(suggestion.activity, suggestion.then)} around ${clock(suggestion.dueAt)} (in ${duration((suggestion.dueAt - engine.now) / MINUTE)}).`
      : current.activity === 'eat'
        ? 'Enjoy your meal. Suggestions resume when you pick what’s next.'
        : current.activity === 'away'
          ? 'Away. Welcome back whenever.'
          : null

  return (
    <Card className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full opacity-60 blur-2xl transition-colors duration-700"
        style={{
          background: `color-mix(in oklab, ${accent} 30%, transparent)`,
        }}
        aria-hidden
      />
      <div className="relative flex items-center gap-5">
        <motion.div
          animate={alarm ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={
            alarm ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : {}
          }
        >
          <Ring
            value={limit ? current.elapsed : 1}
            max={limit || 1}
            accent={accent}
            size={116}
            stroke={9}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={current.activity}
                className="tint-strong grid size-[82px] place-items-center rounded-full text-white shadow-lift"
                style={tone(color(current.activity))}
                initial={{ scale: 0.4, rotate: -35, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                exit={{ scale: 0.4, rotate: 35, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 16 }}
              >
                <ActivityIcon
                  activity={current.activity}
                  size={38}
                  strokeWidth={2.2}
                />
              </motion.span>
            </AnimatePresence>
          </Ring>
        </motion.div>
        <div className="min-w-0 flex-1">
          <p
            className="pr-9 text-sm font-bold sm:pr-24"
            style={{
              color: `color-mix(in oklab, ${color(current.activity)} 75%, var(--ink))`,
            }}
          >
            {DOING[current.activity]} since {clock(current.since)}
          </p>
          <BigDuration minutes={current.elapsed} />
          <div className="mt-2 h-10">
            <AnimatePresence mode="wait" initial={false}>
              {cheer ? (
                <motion.p
                  key="cheer"
                  className="display text-lg font-bold"
                  style={{ color: color(current.activity) }}
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={SPRING}
                >
                  {cheer}
                </motion.p>
              ) : (
                <motion.p
                  key="next"
                  className="line-clamp-2 text-sm leading-5 text-ink-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {next}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
        {!adjusting && (
          <Button
            variant="ghost"
            className="absolute -top-1 -right-1 !px-3"
            onClick={() => setAdjusting(true)}
            title="Fix when this started, or add what you did before"
          >
            <Pencil size={15} />
            <span className="max-sm:sr-only">Adjust</span>
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {adjusting ? (
          <motion.div
            key="adjust"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative overflow-hidden"
          >
            <AdjustPast
              key={current.eventId}
              onClose={() => setAdjusting(false)}
            />
          </motion.div>
        ) : (
          current.elapsed < 5 && (
            <motion.div
              key="earlier"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="relative overflow-hidden"
            >
              <StartedEarlier />
            </motion.div>
          )
        )}
      </AnimatePresence>
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
  const show = current && !quiet && (suggestion?.due || alarm)
  const target = suggestion?.activity ?? 'break'
  const accent = alarm && still.level >= 2 ? 'var(--alarm)' : color(target)
  const title = suggestion
    ? suggestion.activity === 'break' && suggestion.then
      ? `Move for a few minutes, then ${LABELS[suggestion.then].toLowerCase()}`
      : `Time to ${LABELS[suggestion.activity].toLowerCase()}?`
    : 'Time to move'
  return (
    <AnimatePresence>
      {show && current && (
        <motion.section
          key="suggestion"
          className="tint-strong relative overflow-hidden rounded-[1.75rem] p-5 text-white shadow-lift"
          style={tone(accent)}
          initial={{ opacity: 0, y: -14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{
            opacity: 0,
            y: -10,
            scale: 0.96,
            transition: { duration: 0.18 },
          }}
          transition={{ type: 'spring', stiffness: 380, damping: 24 }}
        >
          <motion.span
            className="absolute top-4 right-4 grid size-16 place-items-center rounded-full bg-white/20"
            animate={{ y: [0, -6, 0], rotate: [0, -6, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          >
            <ActivityIcon activity={target} size={30} strokeWidth={2.3} />
          </motion.span>
          <h2 className="pr-20 text-2xl font-bold">{title}</h2>
          <p className="mt-1 pr-20 text-sm text-white/85">
            {alarm && isStill(current.activity)
              ? `${DOING[current.activity]} for ${duration(current.elapsed)} without a change.`
              : suggestion?.reason}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold shadow-soft transition-transform active:scale-95"
              style={{ color: `color-mix(in oklab, ${accent} 80%, black)` }}
              onClick={() => engine.choose(target)}
            >
              <ActivityIcon activity={target} size={16} strokeWidth={2.4} />
              {target === 'break' ? 'Take a break' : `${LABELS[target]} now`}
            </button>
            <button
              type="button"
              className="rounded-full bg-white/20 px-4 py-2 text-sm font-semibold transition-[background,transform] hover:bg-white/30 active:scale-95"
              onClick={engine.snooze}
              title="Shortcut: N"
            >
              Not now
            </button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}

function ReturnedBanner() {
  const { engine } = useApp()
  const r = engine.returned
  return (
    <AnimatePresence>
      {r && (
        <motion.div
          key="returned"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: -16 }}
          transition={SPRING}
        >
          <Card className="flex items-start gap-3 !py-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-ink-2">
              <Undo2 size={17} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                Welcome back. Away {duration(r.awayMinutes)}, counted as a break
                {r.resumed
                  ? `; back to ${DOING[r.resumed].toLowerCase()}.`
                  : '.'}
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
              className="rounded-full p-1 text-ink-3 hover:bg-sunken hover:text-ink"
              onClick={engine.dismissReturned}
              aria-label="Dismiss"
            >
              <X size={18} />
            </button>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Confetti-ish dots flying out of a tile when you get moving. */
function Burst({ accent }: { accent: string }) {
  const dots = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2)
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      {dots.map((angle, i) => (
        <motion.span
          key={i}
          className="absolute top-1/2 left-1/2 size-2 rounded-full"
          style={{ background: i % 3 === 0 ? 'var(--eat)' : accent }}
          initial={{ x: -4, y: -4, scale: 1, opacity: 1 }}
          animate={{
            x: Math.cos(angle) * 46 - 4,
            y: Math.sin(angle) * 46 - 4,
            scale: 0.3,
            opacity: 0,
          }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      ))}
    </span>
  )
}

function Picker() {
  const { engine } = useApp()
  const current = engine.plan.current
  const { available } = engine.plan
  const [burst, setBurst] = useState<{
    activity: Activity
    key: string
  } | null>(null)
  const seen = useRef(current?.eventId)
  // Celebrate getting moving: a fresh switch to standing, walking or a break.
  useEffect(() => {
    if (!current || current.eventId === seen.current) return
    seen.current = current.eventId
    if (
      current.elapsed < 1 &&
      ['stand', 'walk', 'break'].includes(current.activity)
    ) {
      setBurst({ activity: current.activity, key: current.eventId })
    }
  }, [current])

  return (
    <div
      className="grid grid-cols-5 gap-2 sm:gap-3"
      role="group"
      aria-label="What are you doing?"
    >
      {PICK.map((a) => {
        const active = current?.activity === a
        const missing = isPosture(a) && !available.includes(a)
        return (
          <motion.button
            key={a}
            type="button"
            aria-pressed={active}
            onClick={() => !active && engine.choose(a)}
            title={`${LABELS[a]} (${KEY_HINT[a]})`}
            whileTap={{ scale: 0.9 }}
            whileHover={{ y: -2 }}
            transition={SPRING}
            className={`tint relative flex flex-col items-center gap-2 rounded-3xl pt-4 pb-3 text-sm font-bold shadow-soft ${
              active ? 'text-white' : 'text-ink'
            } ${missing && !active ? 'opacity-45' : ''}`}
            style={tone(color(a))}
          >
            {active && (
              <motion.span
                layoutId="picker-active"
                className="tint-strong absolute inset-0 rounded-3xl shadow-lift"
                style={tone(color(a))}
                transition={SPRING}
              />
            )}
            <motion.span
              key={active ? 'on' : 'off'}
              className={`relative grid size-11 place-items-center rounded-full ${
                active ? 'bg-white/20' : 'bg-card'
              }`}
              style={active ? undefined : { color: color(a) }}
              initial={active ? { scale: 0.6, rotate: -20 } : false}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 14 }}
            >
              <ActivityIcon activity={a} size={22} strokeWidth={2.3} />
            </motion.span>
            <span className="relative">{LABELS[a]}</span>
            <span
              aria-hidden
              className={`absolute top-2 right-2.5 text-[10px] font-semibold ${
                active ? 'text-white/60' : 'text-ink-3'
              } max-sm:hidden`}
            >
              {KEY_HINT[a]}
            </span>
            {burst?.activity === a && (
              <Burst key={burst.key} accent={color(a)} />
            )}
          </motion.button>
        )
      })}
    </div>
  )
}

function QuickActions() {
  const { engine, store } = useApp()
  const [awayOpen, setAwayOpen] = useState(false)
  const awayRef = useRef<HTMLDivElement>(null)
  // Close the "I was away" menu on a click outside it or Escape.
  useEffect(() => {
    if (!awayOpen) return
    const onDown = (e: PointerEvent) => {
      if (!awayRef.current?.contains(e.target as Node)) setAwayOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAwayOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [awayOpen])
  const { inCall, current } = engine.plan
  const paused = Boolean(store.status.pausedDay) && engine.plan.quiet && !inCall
  const callLeft = inCall
    ? ((store.status.callUntil ?? 0) - engine.now) / MINUTE
    : 0
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {inCall ? (
          <Button
            variant="primary"
            accent="var(--ink-2)"
            onClick={() => engine.setCall(null)}
            title="End the call"
          >
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
          <div className="relative" ref={awayRef}>
            <Button
              onClick={() => setAwayOpen((v) => !v)}
              aria-expanded={awayOpen}
            >
              I was away…
            </Button>
            <AnimatePresence>
              {awayOpen && (
                <motion.div
                  className="absolute left-0 z-10 mt-2 flex origin-top-left gap-1 rounded-2xl bg-card p-1.5 shadow-lift"
                  initial={{ opacity: 0, scale: 0.9, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    scale: 0.9,
                    y: -4,
                    transition: { duration: 0.12 },
                  }}
                  transition={SPRING}
                >
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
                </motion.div>
              )}
            </AnimatePresence>
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
      {rows.map((a) => {
        const target = store.settings.targets[a]
        const done = totals[a] >= target && target > 0
        return (
          <div
            key={a}
            className="tint flex items-center gap-3 rounded-2xl p-3"
            style={tone(color(a))}
          >
            <Ring
              value={totals[a]}
              max={target}
              accent={color(a)}
              size={48}
              stroke={5}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {done ? (
                  <motion.span
                    key="done"
                    className="grid size-7 place-items-center rounded-full text-white"
                    style={{ background: color(a) }}
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 12 }}
                  >
                    <Check size={16} strokeWidth={3} />
                  </motion.span>
                ) : (
                  <motion.span key="icon" style={{ color: color(a) }}>
                    <ActivityIcon activity={a} size={18} strokeWidth={2.4} />
                  </motion.span>
                )}
              </AnimatePresence>
            </Ring>
            <div className="min-w-0 text-xs">
              <p className="font-bold text-ink">{DOING[a]}</p>
              <p className="text-ink-2 tabular-nums">
                {short(totals[a])} / {short(target)}
              </p>
            </div>
          </div>
        )
      })}
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
        <h2 className="text-xl font-bold">Today</h2>
        <DayBar />
        <Targets />
      </Card>
    </div>
  )
}
