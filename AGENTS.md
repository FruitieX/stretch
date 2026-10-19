Use the locked Nix environment (`nix develop --command ...`). Read
docs/PLAN.md for the user's requirements and planner rules, run the checks in
README.md before committing, and use Conventional Commits.

The product must never feel bossy: the user's own status is the source of
truth, switching activity is one tap or key, suggestions ping once and back
off on "Not now", and only the stillness alarm escalates. Never add blocking
dialogs, streaks or guilt.

Activity is stored as a log of changes (each lasts until the next), so
devices merge by union. Saves are idempotent PUTs by client id replayed from
an offline outbox; never let an older `updatedAt` overwrite a newer one or
resurrect a tombstoned change. Shared `settings`/`status` documents are
last-writer-wins; equipment, alerts and sound are per-device localStorage.
Keep planner, timeline, idle and editing logic pure in `src/lib` with unit
tests; timeline edits go through `paint`/`editSpan` in `src/lib/edit.ts`.

SSE `changed` events must carry non-empty data (browsers drop empty ones),
and the homelab route needs `timeouts.request: 0s` for `/api/live`. The app
has no auth and must only be routed through the private gateway.
