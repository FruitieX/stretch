import { describe, expect, it } from 'vitest'
import type { Activity } from './model.ts'
import {
  deleteSpan,
  diff,
  editSpan,
  moveEdge,
  paint,
  replaced,
  slideBlock,
  type Mark,
} from './edit.ts'

const at = (clock: string) => Date.parse(`2026-10-19T${clock}:00+03:00`)
const m = (id: string, clock: string, activity: Activity): Mark => ({
  id,
  at: at(clock),
  activity,
  source: 'manual',
})
/** Compact "HH:MM activity" view of a timeline. */
const view = (marks: Mark[]) =>
  marks.map((x) => `${new Date(x.at).toTimeString().slice(0, 5)} ${x.activity}`)

const now = at('11:00')

describe('paint', () => {
  it('fills an untracked morning before the first change', () => {
    const marks = [m('a', '10:00', 'sit')]
    expect(view(paint(marks, at('09:00'), at('10:00'), 'stand', now))).toEqual([
      '09:00 stand',
      '10:00 sit',
    ])
  })

  it('marks the time after a painted range as untracked when nothing followed', () => {
    const marks = [m('a', '10:00', 'sit')]
    expect(view(paint(marks, at('08:00'), at('09:00'), 'walk', now))).toEqual([
      '08:00 walk',
      '09:00 off',
      '10:00 sit',
    ])
  })

  it("doesn't carry yesterday's last activity into this morning", () => {
    const marks = [
      {
        id: 'y',
        at: at('15:00') - 86_400_000,
        activity: 'sit' as const,
        source: 'manual' as const,
      },
      m('a', '10:00', 'walk'),
    ]
    expect(
      view(paint(marks, at('08:00'), at('09:00'), 'stand', now)).slice(1),
    ).toEqual(['08:00 stand', '09:00 off', '10:00 walk'])
  })

  it('cuts into the middle of an activity and resumes it', () => {
    const marks = [m('a', '09:00', 'sit')]
    expect(view(paint(marks, at('09:30'), at('09:45'), 'walk', now))).toEqual([
      '09:00 sit',
      '09:30 walk',
      '09:45 sit',
    ])
  })

  it('replaces changes inside the range', () => {
    const marks = [
      m('a', '09:00', 'sit'),
      m('b', '09:20', 'stand'),
      m('c', '10:00', 'walk'),
    ]
    const after = paint(marks, at('09:10'), at('09:50'), 'eat', now)
    expect(view(after)).toEqual([
      '09:00 sit',
      '09:10 eat',
      '09:50 stand',
      '10:00 walk',
    ])
    expect(diff(marks, after).remove).toEqual(['b'])
  })

  it('painting up to now makes it the current activity', () => {
    const marks = [m('a', '09:00', 'stand'), m('b', '10:30', 'sit')]
    expect(view(paint(marks, at('10:00'), now, 'sit', now))).toEqual([
      '09:00 stand',
      '10:00 sit',
    ])
  })

  it('merges with a neighbour doing the same thing', () => {
    const marks = [m('a', '09:00', 'sit'), m('b', '10:00', 'stand')]
    const after = paint(marks, at('09:30'), at('10:00'), 'sit', now)
    expect(view(after)).toEqual(['09:00 sit', '10:00 stand'])
    expect(diff(marks, after)).toEqual({ add: [], update: [], remove: [] })
  })
})

describe('editSpan', () => {
  const marks = [
    m('a', '09:00', 'stand'),
    m('b', '10:00', 'sit'),
    m('c', '10:45', 'walk'),
  ]
  const span = { id: 'b', start: at('10:00'), end: at('10:45'), open: false }

  it('changes the activity and keeps the id', () => {
    const after = editSpan(marks, span, 'eat', span.start, span.end, now)
    expect(view(after)).toEqual(['09:00 stand', '10:00 eat', '10:45 walk'])
    expect(diff(marks, after)).toMatchObject({
      add: [],
      remove: [],
      update: [{ id: 'b' }],
    })
  })

  it('moving the start later lets the previous activity run longer', () => {
    const after = editSpan(marks, span, 'sit', at('10:15'), span.end, now)
    expect(view(after)).toEqual(['09:00 stand', '10:15 sit', '10:45 walk'])
  })

  it('moving the end earlier lets the next activity start earlier', () => {
    const after = editSpan(marks, span, 'sit', span.start, at('10:30'), now)
    expect(view(after)).toEqual(['09:00 stand', '10:00 sit', '10:30 walk'])
  })

  it('extending over a neighbour replaces it', () => {
    const after = editSpan(marks, span, 'sit', at('08:30'), span.end, now)
    expect(view(after)).toEqual(['08:30 sit', '10:45 walk'])
  })

  it('moves the start of the current activity', () => {
    const current = { id: 'c', start: at('10:45'), end: now, open: true }
    const after = editSpan(marks, current, 'walk', at('10:15'), now, now)
    expect(view(after)).toEqual(['09:00 stand', '10:00 sit', '10:15 walk'])
    expect(diff(marks, after)).toMatchObject({ update: [{ id: 'c' }] })
  })

  it('deleting a block lets the previous activity continue', () => {
    expect(view(deleteSpan(marks, span, now))).toEqual([
      '09:00 stand',
      '10:45 walk',
    ])
    const first = { id: 'a', start: at('09:00'), end: at('10:00'), open: false }
    expect(view(deleteSpan(marks, first, now))).toEqual([
      '10:00 sit',
      '10:45 walk',
    ])
  })
})

describe('moveEdge', () => {
  const marks = [
    m('a', '09:00', 'stand'),
    m('b', '10:00', 'sit'),
    m('c', '10:30', 'off'),
  ]
  const floor = at('00:00')

  it('moves the edge between two blocks', () => {
    expect(view(moveEdge(marks, 'b', at('09:40'), now, floor))).toEqual([
      '09:00 stand',
      '09:40 sit',
      '10:30 off',
    ])
  })

  it('stops five minutes short of the neighbouring edges', () => {
    expect(view(moveEdge(marks, 'b', at('08:00'), now, floor))[1]).toBe(
      '09:05 sit',
    )
    expect(view(moveEdge(marks, 'b', at('11:00'), now, floor))[1]).toBe(
      '10:25 sit',
    )
  })

  it('extends a block into untracked time and never into the future', () => {
    expect(view(moveEdge(marks, 'c', at('12:00'), now, floor))[2]).toBe(
      '11:00 off',
    )
    expect(view(moveEdge(marks, 'a', at('07:00'), now, floor))[0]).toBe(
      '07:00 stand',
    )
  })

  it('reports blocks a range edit would replace', () => {
    const after = paint(marks, at('09:30'), at('10:40'), 'walk', now)
    expect(replaced(marks, after, now).map((x) => x.id)).toEqual(['b'])
    // Trimming the current activity isn't replacing it.
    const current = [m('a', '09:00', 'walk'), m('b', '10:00', 'sit')]
    const trimmed = paint(current, at('09:00'), at('10:10'), 'walk', now)
    expect(view(trimmed)).toEqual(['09:00 walk', '10:10 sit'])
    expect(replaced(current, trimmed, now)).toEqual([])
  })
})

describe('slideBlock', () => {
  const marks = [
    m('a', '09:00', 'stand'),
    m('b', '09:30', 'eat'),
    m('c', '09:45', 'sit'),
    m('d', '10:30', 'walk'),
  ]
  const floor = at('00:00')
  const min = 60_000

  it('slides a block, keeping its length; neighbours shrink and grow', () => {
    expect(view(slideBlock(marks, 'b', 20 * min, now, floor))).toEqual([
      '09:00 stand',
      '09:50 eat',
      '10:05 sit',
      '10:30 walk',
    ])
  })

  it('stops before swallowing a neighbour', () => {
    expect(
      view(slideBlock(marks, 'b', -90 * min, now, floor)).slice(0, 2),
    ).toEqual(['09:00 stand', '09:05 eat'])
    expect(
      view(slideBlock(marks, 'b', 90 * min, now, floor)).slice(1, 3),
    ).toEqual(['10:10 eat', '10:25 sit'])
  })

  it('keeps at least five minutes of the current activity', () => {
    const two = [m('a', '09:00', 'walk'), m('b', '10:00', 'sit')]
    expect(view(slideBlock(two, 'a', 120 * min, now, floor))).toEqual([
      '09:55 walk',
      '10:55 sit',
    ])
  })

  it('slides the current activity by moving its start only', () => {
    expect(
      view(slideBlock(marks, 'd', -15 * min, now, floor)).slice(2),
    ).toEqual(['09:45 sit', '10:15 walk'])
    expect(view(slideBlock(marks, 'd', 90 * min, now, floor))[3]).toBe(
      '10:55 walk',
    )
  })

  it('leaves untracked time untracked', () => {
    const gap = [
      m('a', '09:00', 'sit'),
      m('b', '09:30', 'off'),
      m('c', '10:00', 'walk'),
    ]
    expect(view(slideBlock(gap, 'a', 10 * min, now, floor))).toEqual([
      '09:10 sit',
      '09:40 off',
      '10:00 walk',
    ])
  })
})
