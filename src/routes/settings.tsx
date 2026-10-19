import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../app.tsx'
import { Button, Card, Toggle } from '../components/ui.tsx'
import { DEFAULT_SETTINGS, type Settings } from '../lib/model.ts'
import { idleDetectionSupported, requestIdleDetection } from '../lib/engine.ts'
import {
  notificationsSupported,
  notify,
  requestNotifications,
} from '../lib/notify.ts'
import { chime, unlockAudio } from '../lib/sound.ts'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const input =
  'w-24 rounded-lg bg-surface px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line'

function Minutes({
  value,
  onChange,
  min = 1,
  max = 600,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-ink-2">
      <input
        type="number"
        className={input}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v))
            onChange(Math.min(max, Math.max(min, Math.round(v))))
        }}
      />
      min
    </span>
  )
}

function SharedSettings() {
  const { store } = useApp()
  const [draft, setDraft] = useState<Settings>(store.settings)
  const saved = JSON.stringify(store.settings)
  const dirty = JSON.stringify(draft) !== saved
  // Pick up changes made on another device while nothing is being edited.
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(saved))
  }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Settings>) =>
    setDraft((d) => ({ ...d, ...patch }))

  return (
    <Card>
      <h2 className="text-sm font-medium">Schedule</h2>
      <p className="mb-2 text-xs text-ink-3">Shared by all your devices.</p>
      <div className="divide-y divide-line">
        <Field
          label="Workday"
          hint="Used for pacing; the day starts with your first tap."
        >
          <span className="flex items-center gap-1.5">
            <input
              type="time"
              className={input}
              value={draft.workdayStart}
              onChange={(e) => set({ workdayStart: e.target.value })}
            />
            –
            <input
              type="time"
              className={input}
              value={draft.workdayEnd}
              onChange={(e) => set({ workdayEnd: e.target.value })}
            />
          </span>
        </Field>
        {(['sit', 'stand', 'walk'] as const).map((p) => (
          <Field
            key={p}
            label={`Suggest a switch after ${p === 'sit' ? 'sitting' : p === 'stand' ? 'standing' : 'walking'}`}
          >
            <Minutes
              value={draft.limits[p]}
              onChange={(v) => set({ limits: { ...draft.limits, [p]: v } })}
            />
          </Field>
        ))}
        <Field
          label="Stillness alarm"
          hint="Sitting or standing without a change; this one escalates."
        >
          <Minutes
            value={draft.stillLimit}
            onChange={(v) => set({ stillLimit: v })}
          />
        </Field>
        <Field
          label="Escalate after"
          hint="Minutes after the alarm, comma-separated."
        >
          <input
            className={input}
            defaultValue={draft.escalation.join(', ')}
            key={draft.escalation.join(',')}
            onBlur={(e) => {
              const steps = e.target.value
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0)
                .sort((a, b) => a - b)
              set({ escalation: steps.slice(0, 4) })
            }}
          />
        </Field>
        <Field label="Move break">
          <Minutes
            value={draft.moveBreak}
            onChange={(v) => set({ moveBreak: v })}
            max={30}
          />
        </Field>
        <Field label="Daily standing target">
          <Minutes
            value={draft.targets.stand}
            min={0}
            onChange={(v) => set({ targets: { ...draft.targets, stand: v } })}
          />
        </Field>
        <Field label="Daily walking target">
          <Minutes
            value={draft.targets.walk}
            min={0}
            onChange={(v) => set({ targets: { ...draft.targets, walk: v } })}
          />
        </Field>
        <Field
          label="Count as away after"
          hint="Idle or screen locked; walking is never interrupted."
        >
          <Minutes
            value={draft.awayAfter}
            onChange={(v) => set({ awayAfter: v })}
            max={60}
          />
        </Field>
        <Field
          label="Offer “That was lunch” after"
          hint="Away this long around midday."
        >
          <Minutes
            value={draft.lunchPromptAfter}
            onChange={(v) => set({ lunchPromptAfter: v })}
            max={120}
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_SETTINGS)}>
          Defaults
        </Button>
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={() => setDraft(JSON.parse(saved))}
        >
          Revert
        </Button>
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={() => store.saveSettings(draft)}
        >
          Save
        </Button>
      </div>
    </Card>
  )
}

function DeviceSettings() {
  const { device, setDevice } = useApp()
  const [permission, setPermission] = useState(() =>
    notificationsSupported() ? Notification.permission : 'unsupported',
  )
  return (
    <Card>
      <h2 className="text-sm font-medium">This device</h2>
      <p className="mb-2 text-xs text-ink-3">Saved in this browser only.</p>
      <div className="divide-y divide-line">
        <Toggle
          label="Standing desk here"
          checked={device.standingDesk}
          onChange={(v) => setDevice({ standingDesk: v })}
        />
        <Toggle
          label="Walking pad here"
          checked={device.walkingPad}
          onChange={(v) => setDevice({ walkingPad: v })}
        />
        <Toggle
          label="Alerts on this device"
          hint="Turn off on devices you only check now and then."
          checked={device.alerts}
          onChange={(v) => setDevice({ alerts: v })}
        />
        <Field
          label="Notifications"
          hint={
            permission === 'granted'
              ? 'Allowed.'
              : permission === 'denied'
                ? 'Blocked; allow them in the browser’s site settings.'
                : permission === 'unsupported'
                  ? 'Not supported in this browser.'
                  : 'Not allowed yet.'
          }
        >
          {permission === 'default' ? (
            <Button
              onClick={async () => setPermission(await requestNotifications())}
            >
              Allow
            </Button>
          ) : (
            <Button
              disabled={permission !== 'granted'}
              onClick={() =>
                void notify({
                  title: 'Time to stand?',
                  body: 'This is what a suggestion looks like.',
                  actions: [{ action: 'open', title: 'OK' }],
                })
              }
            >
              Test
            </Button>
          )}
        </Field>
        <Toggle
          label="Sound"
          checked={device.sound}
          onChange={(v) => setDevice({ sound: v })}
        />
        <Field label="Volume">
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={device.volume}
              onChange={(e) => setDevice({ volume: Number(e.target.value) })}
              className="w-28 accent-[var(--sit)]"
            />
            <Button
              onClick={() => {
                unlockAudio()
                setTimeout(() => chime(1, device.volume), 50)
              }}
            >
              Soft
            </Button>
            <Button
              onClick={() => {
                unlockAudio()
                setTimeout(() => chime(3, device.volume), 50)
              }}
            >
              Loud
            </Button>
          </span>
        </Field>
        <Toggle
          label="Idle detection"
          hint={
            idleDetectionSupported()
              ? 'Count idle time and a locked screen as away.'
              : 'Not supported in this browser; sleep and the “I was away” buttons still work.'
          }
          checked={device.idleDetection}
          onChange={async (v) => {
            if (!v) return setDevice({ idleDetection: false })
            if (await requestIdleDetection()) setDevice({ idleDetection: true })
          }}
        />
      </div>
    </Card>
  )
}

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <SharedSettings />
      <DeviceSettings />
      <Card>
        <h2 className="text-sm font-medium">Shortcuts</h2>
        <p className="mt-1 text-sm text-ink-2">
          <kbd>1</kbd>–<kbd>5</kbd> (or <kbd>S</kbd> <kbd>T</kbd> <kbd>W</kbd>{' '}
          <kbd>E</kbd> <kbd>B</kbd>) switch to sit, stand, walk, eat or break.{' '}
          <kbd>N</kbd> is “Not now”.
        </p>
      </Card>
    </div>
  )
}
