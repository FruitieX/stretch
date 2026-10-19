import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import {
  Armchair,
  CircleCheck,
  Coffee,
  DoorOpen,
  Footprints,
  PersonStanding,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import type { Activity } from '../lib/model.ts'

export const ICONS: Record<Activity, LucideIcon> = {
  sit: Armchair,
  stand: PersonStanding,
  walk: Footprints,
  eat: Utensils,
  break: Coffee,
  away: DoorOpen,
  off: CircleCheck,
}

/** CSS color for an activity; `off` has no color of its own. */
export const color = (a: Activity) => `var(--${a === 'off' ? 'away' : a})`

export function ActivityIcon({
  activity,
  size = 20,
}: {
  activity: Activity
  size?: number
}) {
  const Icon = ICONS[activity]
  return <Icon size={size} aria-hidden />
}

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <section
      className={`rounded-2xl bg-card p-4 ring-1 ring-line ${className}`}
      style={style}
    >
      {children}
    </section>
  )
}

type Variant = 'primary' | 'quiet' | 'ghost'

export function Button({
  variant = 'quiet',
  className = '',
  accent,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  accent?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50'
  const styles: Record<Variant, string> = {
    primary: 'text-white hover:brightness-110',
    quiet: 'bg-surface text-ink ring-1 ring-line hover:bg-line/50',
    ghost: 'text-ink-2 hover:text-ink hover:bg-surface',
  }
  return (
    <button
      type="button"
      className={`${base} ${styles[variant]} ${className}`}
      style={
        variant === 'primary'
          ? { background: accent ?? 'var(--sit)' }
          : undefined
      }
      {...props}
    />
  )
}

export function Meter({
  value,
  max,
  accent,
}: {
  value: number
  max: number
  accent: string
}) {
  const pct = Math.min(100, (value / Math.max(1, max)) * 100)
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: accent }}
      />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="mt-0.5 size-5 accent-[var(--sit)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
