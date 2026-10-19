# Stretch

Keeps the workday from turning into hours of sitting still. Tell it what you
are doing (sit, stand at the desk, walk on the walking pad, eat, take a
break) with one tap or key; it suggests when to switch and nudges you with a
chime and a desktop notification. Suggestions are never commands: switching
is always one tap, "Not now" backs off, and nothing blocks you.

- **Now**: what you're doing and for how long, the next suggestion, today's
  timeline with a faint possible rest of the day, and standing/walking targets.
  "In a call" mutes alerts; "I was away…" logs a break you forgot to record.
- **Timeline** (on Now and Today): click a block to change its activity or
  times, drag a block edge to resize it (it stops short of the next edge), or
  drag across the bar to fill in a time range, e.g. "standing 08:00–09:00".
  Blocks never overlap; an edit that covers other blocks says what it
  replaces before saving. Right after switching, "Started earlier? 15m · 30m ·
  1h · 2h ago" backdates in one tap; **Adjust** rewrites the recent past as
  "sitting since …, before that standing since …".
- **Today**: every change today; tap one to fix its activity or time.
- **Stats**: time per activity per day (chart or table) and CSV export.
- **Settings**: workday, limits, targets and alarm timing (shared by all
  devices) plus per-device equipment, alerts, sound and idle detection.

Posture suggestions ping once. Only the stillness alarm (sitting or standing
too long without a change) escalates. Idle time and a locked screen count as
away in Chrome/Edge (Idle Detection API); every browser notices sleep. See
[docs/PLAN.md](docs/PLAN.md) for the requirements and planner rules.

## Development

Everything runs in the Nix dev shell (`nix develop --command …`):

```sh
npm ci
cargo run --manifest-path backend/Cargo.toml   # API on 127.0.0.1:3005, data in ./data
npm run dev                                    # UI on :3105, proxies /api
```

## Checks

```sh
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml
npm run format:check
npm run typecheck
npm test                 # planner, timeline and idle logic (TZ=Europe/Helsinki)
npm run build
cargo build --manifest-path backend/Cargo.toml && npm run test:ui
nix build .#container && docker load < result && node scripts/verify-container.mjs
```

`npm run test:ui` drives the built app in Chromium against a temporary
database (fake clock for suggestions, notifications and sleep; two devices
for live sync) and writes screenshots to `test-results/`.

## Deployment

CI builds and tests the Nix container on every push and publishes
`ghcr.io/fruitiex/stretch` from `main`, then dispatches `image-update` to
`FruitieX/homelab` (`apps/stretch`), which serves it at
https://stretch.fruitiex.org on the private gateway
only. The app has no authentication. Data is one SQLite file in `/data`;
`stretch-api --backup <dest>` writes a consistent copy.
