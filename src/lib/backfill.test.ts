import { describe, expect, it } from 'vitest'
import type { Activity, ActivityEvent } from './model.ts'
import { backfill } from './backfill.ts'
import { isoLocal } from './time.ts'

const at = (clock: string) => Date.parse(`2026-10-19T${clock}:00+03:00`)
const ev = (id: string, clock: string, activity: Activity): ActivityEvent => ({
  id,
  at: isoLocal(at(clock)),
  activity,
  source: 'manual',
  updatedAt: '2026-10-01T00:00:00Z',
})

describe('backfill', () => {
  const current = ev('c', '10:52', 'sit')

  it('moves the current change back and adds earlier ones', () => {
    const result = backfill(
      [current],
      current,
      [
        { activity: 'sit', start: at('09:52') },
        { activity: 'stand', start: at('08:50') },
      ],
      at('10:53'),
    )
    expect(result).toEqual({
      update: { event: current, activity: 'sit', at: at('09:52') },
      add: [{ activity: 'stand', start: at('08:50') }],
      remove: [],
    })
  })

  it('replaces changes recorded inside the rewritten window', () => {
    const events = [ev('a', '08:00', 'walk'), ev('b', '09:30', 'eat'), current]
    const result = backfill(
      events,
      current,
      [{ activity: 'sit', start: at('09:00') }],
      at('11:00'),
    )
    expect(result).toMatchObject({ remove: ['b'] })
  })

  it('rejects out-of-order or future times', () => {
    expect(
      backfill(
        [current],
        current,
        [
          { activity: 'sit', start: at('09:00') },
          { activity: 'stand', start: at('09:30') },
        ],
        at('11:00'),
      ),
    ).toHaveProperty('error')
    expect(
      backfill(
        [current],
        current,
        [{ activity: 'sit', start: at('12:00') }],
        at('11:00'),
      ),
    ).toHaveProperty('error')
  })
})
