import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { motion } from 'motion/react'
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

/** Sets `--c` for the `.tint` / `.tint-strong` helpers. */
export const tone = (c: string) => ({ ['--c' as string]: c }) as CSSProperties

export const SPRING = { type: 'spring', stiffness: 520, damping: 32 } as const

export function ActivityIcon({
  activity,
  size = 20,
  strokeWidth = 2,
}: {
  activity: Activity
  size?: number
  strokeWidth?: number
}) {
  const Icon = ICONS[activity]
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden />
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
      className={`rounded-[1.75rem] bg-card p-5 shadow-soft ${className}`}
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
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  accent?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-[background,color,box-shadow,transform] active:scale-[0.96] disabled:opacity-45 disabled:active:scale-100'
  const styles: Record<Variant, string> = {
    primary: 'tint-strong text-white shadow-soft hover:shadow-lift',
    quiet: 'bg-sunken text-ink hover:brightness-[0.97]',
    ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  }
  return (
    <button
      type="button"
      className={`${base} ${styles[variant]} ${className}`}
      style={
        variant === 'primary'
          ? { ...tone(accent ?? 'var(--sit)'), ...style }
          : style
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
    <div className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
      <motion.div
        className="h-full rounded-full"
        style={{ background: accent }}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  )
}

/** A circular progress ring; `children` sit in the middle. */
export function Ring({
  value,
  max,
  accent,
  size = 112,
  stroke = 9,
  children,
}: {
  value: number
  max: number
  accent: string
  size?: number
  stroke?: number
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--sunken)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ type: 'spring', stiffness: 80, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
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
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2.5">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ink ${
          checked ? '' : 'bg-sunken'
        }`}
        style={checked ? { background: 'var(--sit)' } : undefined}
      >
        <motion.span
          className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow"
          initial={false}
          animate={{ x: checked ? 16 : 0 }}
          transition={SPRING}
        />
      </span>
    </label>
  )
}
