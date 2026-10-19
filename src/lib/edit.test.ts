import { describe, expect, it } from 'vitest'
import type { Activity } from './model.ts'
import { deleteSpan, diff, editSpan, paint, type Mark } from './edit.ts'

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
