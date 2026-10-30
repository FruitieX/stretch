# Stretch plan

A personal app that keeps the workday from turning into hours of sitting
still. It tracks what the user is doing (sitting, standing at the desk,
walking on the walking pad, eating, taking a break), suggests when to switch,
and alerts with a sound and an OS notification when it is time to move.

## Requirements (from the user)

- **Suggestions, never commands.** The user's own status is the source of
  truth. Overriding the current activity must always be one tap (or one key).
  No streaks, guilt or blocking dialogs; the app must not be annoying.
- **Activities:** sit, stand (standing desk), walk (walking pad; the user can
  do all work on it), eat, break. Automatic `away` (idle) and `off` (done for
  the day) exist as well.
- **Workday** is usually 9:00–15:40. It is used for pacing only; the day
  starts with the first tap. **Lunch has no fixed time**: eating is a status,
  and a long idle around midday may be offered as lunch after the fact.
- **Alerts:** desktop notification plus sound. Posture suggestions ping once,
  softly. Only the stillness limit (too long sitting or standing without a
  change) escalates: a ping, a louder one after 2 min, louder again after 5.
- **Idle awareness:** Chrome/Edge use the Idle Detection API (idle or locked
  screen = away). Firefox/Safari fall back to sleep-gap detection (the
  once-a-minute timer jumps), activity while focused, and manual "I was away
  N min ago" buttons.
- A background tab (or installed PWA window) is the expected way to run it.
- Devices: mostly a work MacBook (Chrome or Firefox), hobby work on a Windows
  PC. The backend syncs state across devices and keeps history for stats.
- Deployed to the homelab on the private ingress, auto-deployed from `main`.

## Defaults (all configurable)

| Setting            | Default             |
| ------------------ | ------------------- |
| Workday            | 09:00–15:40         |
| Sit / stand / walk | ≤ 45 / 45 / 40 min  |
| Stillness alarm    | 60 min              |
| Escalation         | +2 min, +5 min      |
| Move break         | 3 min               |
| Daily targets      | stand 2 h, walk 1 h |
| Idle → away        | 5 min               |
| Lunch prompt after | 25 min idle         |

## Architecture

- **Frontend:** Vite, React 19, TypeScript, Tailwind 4, TanStack Router
  (code-based routes), lucide icons. Installable PWA with a service worker
  that caches the shell and handles notification action buttons.
- **Backend:** Rust, Axum, SQLite (`rusqlite`), one unprivileged Nix-built
  container serving the API and the static frontend (same shape as the
  owner's other self-hosted apps). No auth; only routed through the private gateway.
- **Data model:** an append-mostly log of **activity changes**
  (`id, at, activity, source`). Each change lasts until the next one, so
  concurrent devices merge by union and never conflict. Edits are idempotent
  PUTs by client id with last-writer-wins on `updatedAt`; deletes are
  tombstones. Shared `settings` and `status` (snooze, call mode, pause) are
  small JSON documents with the same rules.
- **Per-device settings** (available equipment, alerts on/off, sound volume)
  live in `localStorage`, because the MacBook has the desk and walking pad and
  the Windows PC may not.
- **Sync:** an offline outbox (persisted in `localStorage`) flushes to the
  API; `/api/live` (SSE) tells other devices to refetch immediately.
- **Planner** (`src/lib/planner.ts`, pure and unit-tested) derives the next
  suggestion from the current activity, how long it has lasted, today's
  totals against targets and the time left in the workday. There is no
  stored schedule; a faint "rest of day" preview is recomputed on every
  change.
- **Alerts:** only one tab per browser alerts (Web Locks); each device can
  turn alerts off. Sounds are synthesized with Web Audio.

## Switching

- A switch within a minute of the previous change corrects it: the change is
  relabelled (keeping its start), and switching straight back to the activity
  before it drops the brief change. No sub-minute blocks are recorded.

## Planner rules

- No suggestions before the first activity of the day, after the workday
  end, while eating, away, off, paused, or (silently) in call mode.
- Sit, stand and walk suggest a switch when they reach their limit; a break
  suggests the next posture after the move-break length.
- Rotation: sit → stand or walk (whichever is further behind its target),
  stand → walk, walk → sit (or stand if standing is far behind).
  Unavailable equipment is skipped. Going from standing back to sitting, or
  staying in the same posture, inserts a short move break first.
- "Not now" snoozes 10 min, then 15, 20… (declines back off, reset when the
  activity changes). The stillness alarm can be snoozed for at most 10 min.
- Idle while sitting, standing or on a break records `away` from when the
  idle began; coming back resumes the previous activity automatically, with
  an undoable banner (and "That was lunch" if it was long enough and around
  midday). Idle after the workday end records `off`.

## Progress

- [x] Brainstorm and plan
- [x] Backend: events, docs, SSE, CSV export, tests
- [x] Frontend: Now, Today (edit timeline), Stats, Settings
- [x] Alerts: notifications with actions, sound, escalation, idle detection
- [ ] CI, container, homelab deployment, feedback-hub registration
