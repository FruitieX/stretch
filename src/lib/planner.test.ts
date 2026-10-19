import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEVICE,
  DEFAULT_SETTINGS,
  type Activity,
  type ActivityEvent,
} from './model.ts'
import { nextPosture, plan, snoozeFor } from './planner.ts'
import { onIdle, onReturn } from './idle.ts'
import { daySummaries, sortEvents, spans, totals } from './timeline.ts'
import { MINUTE, isoLocal, short } from './time.ts'

// Tests run with TZ=Europe/Helsinki (see package.json).
const at = (clock: string, day = '2026-10-19') =>
  Date.parse(`${day}T${clock}:00+03:00`)
let n = 0
const ev = (
  clock: string,
  activity: Activity,
  source: ActivityEvent['source'] = 'manual',
  day?: string,
): ActivityEvent => ({
  id: `e${++n}`,
  at: isoLocal(at(clock, day)),
  activity,
  source,
  updatedAt: '2026-10-01T00:00:00Z',
})
const run = (
  now: string,
  events: ActivityEvent[],
  device = DEFAULT_DEVICE,
  status = {},
) => plan(at(now), sortEvents(events), DEFAULT_SETTINGS, device, status)

describe('timeline', () => {
  it('splits changes into spans and totals', () => {
    const events = sortEvents([
      ev('09:00', 'sit'),
      ev('09:45', 'stand'),
      ev('10:30', 'walk'),
    ])
    const list = spans(
      events,
      at('00:00'),
      at('23:59'),
      at('11:00'),
      DEFAULT_SETTINGS,
    )
    const t = totals(list)
    expect(t.sit).toBe(45)
    expect(t.stand).toBe(45)
    expect(t.walk).toBe(30)
    expect(list.at(-1)?.open).toBe(true)
  })

  it('caps a change left running overnight', () => {
    const events = sortEvents([
      ev('15:00', 'sit', 'manual', '2026-10-18'),
      ev('09:00', 'sit'),
    ])
    const [day] = daySummaries(
      events,
      at('00:00', '2026-10-18'),
      1,
      at('10:00'),
      DEFAULT_SETTINGS,
    )
    // 15:00 until an hour later (later than the 15:40 workday end).
    expect(day.totals.sit).toBe(60)
  })

  it('does not count time after "off"', () => {
    const events = sortEvents([ev('09:00', 'walk'), ev('09:30', 'off')])
    const t = totals(
      spans(events, at('00:00'), at('23:59'), at('12:00'), DEFAULT_SETTINGS),
    )
    expect(t.walk).toBe(30)
    expect(t.off).toBe(0)
  })
})

describe('rotation', () => {
  const all = ['sit', 'stand', 'walk'] as const
  it('moves from sitting to whichever target is furthest behind', () => {
    expect(nextPosture('sit', { stand: 120, walk: 60 }, 300, [...all])).toBe(
      'stand',
    )
    expect(nextPosture('sit', { stand: 20, walk: 60 }, 300, [...all])).toBe(
      'walk',
    )
  })
  it('goes stand → walk → sit', () => {
    expect(nextPosture('stand', { stand: 0, walk: 0 }, 300, [...all])).toBe(
      'walk',
    )
    expect(nextPosture('walk', { stand: 30, walk: 0 }, 300, [...all])).toBe(
      'sit',
    )
  })
  it('stands after walking when standing is far behind late in the day', () => {
    expect(nextPosture('walk', { stand: 90, walk: 0 }, 120, [...all])).toBe(
      'stand',
    )
  })
  it('skips missing equipment', () => {
    expect(
      nextPosture('sit', { stand: 120, walk: 60 }, 300, ['sit', 'walk']),
    ).toBe('walk')
    expect(
      nextPosture('stand', { stand: 0, walk: 60 }, 300, ['sit', 'stand']),
    ).toBe('sit')
    expect(nextPosture('sit', { stand: 120, walk: 60 }, 300, ['sit'])).toBe(
      'sit',
    )
  })
})

describe('plan', () => {
  it('is quiet before the first activity and after the workday', () => {
    expect(run('09:30', []).quiet).toBe(true)
    expect(run('16:00', [ev('15:00', 'sit')]).suggestion).toBeNull()
    // Yesterday's last activity is not current.
    expect(
      run('09:00', [ev('14:00', 'sit', 'manual', '2026-10-18')]).current,
    ).toBeNull()
  })

  it("counts another device's change from slightly in the future", () => {
    const p = run('10:00', [ev('09:00', 'sit'), ev('10:01', 'walk')])
    expect(p.current).toMatchObject({ activity: 'walk', elapsed: 0 })
    expect(
      run('10:00', [ev('09:00', 'sit'), ev('10:30', 'walk')]).current?.activity,
    ).toBe('sit')
  })

  it('suggests standing when sitting reaches its limit', () => {
    const before = run('09:30', [ev('09:00', 'sit')])
    expect(before.suggestion).toMatchObject({
      activity: 'stand',
      due: false,
      dueAt: at('09:45'),
    })
    const due = run('09:46', [ev('09:00', 'sit')])
    expect(due.suggestion).toMatchObject({ activity: 'stand', due: true })
    expect(due.suggestion?.reason).toBe('Sitting for 46 min.')
  })

  it('inserts a move break before sitting down after standing', () => {
    const p = run('10:00', [ev('09:00', 'stand')], {
      ...DEFAULT_DEVICE,
      walkingPad: false,
    })
    expect(p.suggestion).toMatchObject({ activity: 'break', then: 'sit' })
  })

  it('suggests a move break and back to sitting without equipment', () => {
    const sitOnly = {
      ...DEFAULT_DEVICE,
      standingDesk: false,
      walkingPad: false,
    }
    expect(
      run('09:50', [ev('09:00', 'sit')], sitOnly).suggestion,
    ).toMatchObject({
      activity: 'break',
      then: 'sit',
    })
    // After the break, the next posture follows the one before it.
    const after = run(
      '09:54',
      [ev('09:00', 'sit'), ev('09:50', 'break')],
      sitOnly,
    )
    expect(after.suggestion).toMatchObject({
      activity: 'sit',
      due: true,
      dueAt: at('09:53'),
    })
  })

  it('continues the rotation after a break', () => {
    const p = run('10:00', [ev('09:00', 'stand'), ev('09:50', 'break')])
    expect(p.suggestion?.activity).toBe('walk')
  })

  it('makes no suggestion while eating or away', () => {
    expect(
      run('11:30', [ev('09:00', 'sit'), ev('11:00', 'eat')]).suggestion,
    ).toBeNull()
    expect(
      run('11:30', [ev('09:00', 'sit'), ev('11:00', 'away', 'idle')])
        .suggestion,
    ).toBeNull()
  })

  it('escalates the stillness alarm', () => {
    const events = [ev('09:00', 'sit')]
    expect(run('09:59', events).still?.level).toBe(0)
    expect(run('10:00', events).still?.level).toBe(1)
    expect(run('10:02', events).still?.level).toBe(2)
    expect(run('10:05', events).still).toMatchObject({ level: 3, nextAt: null })
    expect(run('10:00', [ev('09:00', 'walk')]).still).toBeNull()
  })

  it('backs off with each "Not now" and caps the stillness snooze', () => {
    const events = [ev('09:00', 'sit')]
    const first = run('09:46', events)
    const s1 = snoozeFor(first, {}, at('09:46'))!
    expect(s1).toMatchObject({ declines: 1, until: at('09:56') })
    const snoozed = run('09:50', events, DEFAULT_DEVICE, { snooze: s1 })
    expect(snoozed.suggestion).toMatchObject({
      due: false,
      dueAt: at('09:56'),
      declines: 1,
    })
    const s2 = snoozeFor(run('09:56', events), { snooze: s1 }, at('09:56'))!
    expect(s2).toMatchObject({ declines: 2, until: at('10:11') })
    const alarm = run('10:12', events, DEFAULT_DEVICE, { snooze: s2 })
    expect(alarm.still?.level).toBeGreaterThan(0)
    const s3 = snoozeFor(alarm, { snooze: s2 }, at('10:12'))!
    expect(s3.until).toBe(at('10:22'))
  })

  it('ignores a snooze for an earlier activity', () => {
    const events = [ev('09:00', 'stand'), ev('09:30', 'sit')]
    const p = run('10:20', events, DEFAULT_DEVICE, {
      snooze: { eventId: events[0].id, until: at('11:00'), declines: 3 },
    })
    expect(p.suggestion?.due).toBe(true)
  })

  it('is quiet when paused for the day', () => {
    const p = run('10:00', [ev('09:00', 'sit')], DEFAULT_DEVICE, {
      pausedDay: '2026-10-19',
    })
    expect(p.quiet).toBe(true)
    expect(p.still).toBeNull()
  })

  it('previews a rotation to the end of the workday', () => {
    const p = run('09:00', [ev('09:00', 'sit')])
    const kinds = p.preview.map((b) => b.activity)
    expect(kinds.slice(0, 5)).toEqual(['sit', 'stand', 'walk', 'sit', 'stand'])
    expect(p.preview.at(-1)?.end).toBe(at('15:40'))
    for (let i = 1; i < p.preview.length; i++) {
      expect(p.preview[i].start).toBe(p.preview[i - 1].end)
    }
  })
})

describe('idle', () => {
  const current = (
    activity: Activity,
    since: string,
    source: ActivityEvent['source'] = 'manual',
    previous: Activity | null = 'sit',
  ) => ({
    eventId: 'x',
    activity,
    source,
    previous,
    since: at(since),
    elapsed: 0,
  })

  it('records away from when idling began', () => {
    expect(
      onIdle(current('sit', '09:00'), at('10:00'), DEFAULT_SETTINGS),
    ).toEqual({
      activity: 'away',
      at: at('10:00'),
      source: 'idle',
    })
    expect(
      onIdle(current('walk', '09:00'), at('10:00'), DEFAULT_SETTINGS),
    ).toBeNull()
    // Idle since before the current change began: starts just after it.
    expect(
      onIdle(current('stand', '09:46'), at('09:45'), DEFAULT_SETTINGS)?.at,
    ).toBe(at('09:46') + 1000)
    expect(
      onIdle(current('sit', '15:00'), at('15:50'), DEFAULT_SETTINGS)?.activity,
    ).toBe('off')
  })

  it('resumes the previous activity on return and offers lunch around midday', () => {
    const r = onReturn(
      current('away', '11:10', 'idle', 'stand'),
      at('11:45'),
      DEFAULT_SETTINGS,
      false,
    )
    expect(r?.change).toEqual({
      activity: 'stand',
      at: at('11:45'),
      source: 'auto',
    })
    expect(r?.lunch).toBe(true)
    expect(r?.awayMinutes).toBe(35)
    const short = onReturn(
      current('away', '11:10', 'idle'),
      at('11:20'),
      DEFAULT_SETTINGS,
      false,
    )
    expect(short?.lunch).toBe(false)
    const eaten = onReturn(
      current('away', '11:10', 'idle'),
      at('11:45'),
      DEFAULT_SETTINGS,
      true,
    )
    expect(eaten?.lunch).toBe(false)
  })

  it('ends the day when returning after the workday end', () => {
    const r = onReturn(
      current('away', '15:20', 'idle'),
      at('17:00'),
      DEFAULT_SETTINGS,
      true,
    )
    expect(r?.change).toEqual({
      activity: 'off',
      at: at('15:40'),
      source: 'auto',
    })
  })

  it('leaves manual away alone', () => {
    expect(
      onReturn(
        current('away', '11:00', 'manual'),
        at('11:30'),
        DEFAULT_SETTINGS,
        false,
      ),
    ).toBeNull()
    expect(
      onReturn(current('sit', '11:00'), at('11:30'), DEFAULT_SETTINGS, false),
    ).toBeNull()
  })
})

it('formats local times with offsets', () => {
  expect(isoLocal(at('09:02'))).toBe('2026-10-19T09:02:00.000+03:00')
  expect(MINUTE).toBe(60000)
})

it('formats compact durations readably', () => {
  expect(short(45)).toBe('45m')
  expect(short(120)).toBe('2h')
  expect(short(286)).toBe('4h 46m')
  expect(short(62)).toBe('1h 2m')
})
