export const ACTIVITIES = [
  'sit',
  'stand',
  'walk',
  'eat',
  'break',
  'away',
  'off',
] as const
export type Activity = (typeof ACTIVITIES)[number]
export type Posture = 'sit' | 'stand' | 'walk'
export const POSTURES: Posture[] = ['sit', 'stand', 'walk']
export type Source = 'manual' | 'idle' | 'auto'

/** A change of activity; it lasts until the next one. */
export interface ActivityEvent {
  id: string
  /** Local time with UTC offset (RFC 3339). */
  at: string
  activity: Activity
  source: Source
  updatedAt: string
}

/** Shared between devices (synced as the `settings` document). */
export interface Settings {
  /** "HH:MM" local time. */
  workdayStart: string
  workdayEnd: string
  /** Minutes before suggesting a switch away from each posture. */
  limits: Record<Posture, number>
  /** Minutes sitting or standing without a change before alarming. */
  stillLimit: number
  /** Minutes after the stillness alarm to escalate, e.g. [2, 5]. */
  escalation: number[]
  moveBreak: number
  /** Daily targets in minutes. */
  targets: { stand: number; walk: number }
  /** Minutes idle before recording `away`. */
  awayAfter: number
  /** Minutes away around midday before offering "That was lunch". */
  lunchPromptAfter: number
}

export const DEFAULT_SETTINGS: Settings = {
  workdayStart: '09:00',
  workdayEnd: '15:40',
  limits: { sit: 45, stand: 45, walk: 40 },
  stillLimit: 60,
  escalation: [2, 5],
  moveBreak: 3,
  targets: { stand: 120, walk: 60 },
  awayAfter: 5,
  lunchPromptAfter: 25,
}

/** Shared, short-lived state (synced as the `status` document). */
export interface Status {
  /** "Not now" applies to one activity change only. */
  snooze?: { eventId: string; until: number; declines: number }
  /** Sound and notifications are muted until this time. */
  callUntil?: number
  /** Local day ("YYYY-MM-DD") with suggestions paused. */
  pausedDay?: string
  /**
   * The device that last saw the user come back. Only it records idle time,
   * so a laptop left open does not mark the user away while they work on
   * another computer.
   */
  activeDevice?: string
}

/** Kept per browser, because equipment differs between desks. */
export interface Device {
  standingDesk: boolean
  walkingPad: boolean
  alerts: boolean
  sound: boolean
  volume: number
  idleDetection: boolean
  /** The one-time permissions prompt was answered or dismissed. */
  setupDone: boolean
}

export const DEFAULT_DEVICE: Device = {
  standingDesk: true,
  walkingPad: true,
  alerts: true,
  sound: true,
  volume: 0.7,
  idleDetection: false,
  setupDone: false,
}

export const LABELS: Record<Activity, string> = {
  sit: 'Sit',
  stand: 'Stand',
  walk: 'Walk',
  eat: 'Eat',
  break: 'Break',
  away: 'Away',
  off: 'Done',
}

export const DOING: Record<Activity, string> = {
  sit: 'Sitting',
  stand: 'Standing',
  walk: 'Walking',
  eat: 'Eating',
  break: 'On a break',
  away: 'Away',
  off: 'Done for today',
}

export const isPosture = (a: Activity): a is Posture =>
  a === 'sit' || a === 'stand' || a === 'walk'

/** Still postures count toward the stillness alarm. */
export const isStill = (a: Activity) => a === 'sit' || a === 'stand'

const MERGE_KEYS = ['limits', 'targets'] as const

export function mergeSettings(value: unknown): Settings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<keyof Settings, unknown>
  >
  const out = { ...DEFAULT_SETTINGS, ...(v as Partial<Settings>) }
  for (const key of MERGE_KEYS) {
    out[key] = {
      ...DEFAULT_SETTINGS[key],
      ...((v[key] as object) ?? {}),
    } as never
  }
  if (!Array.isArray(out.escalation))
    out.escalation = DEFAULT_SETTINGS.escalation
  return out
}
