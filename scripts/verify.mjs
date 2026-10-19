// End-to-end check: starts the API with a temporary database and drives the
// built UI in Chromium. One page runs on a fake clock to exercise
// suggestions, notifications and sleep detection; two more act as separate
// devices to check live sync. Screenshots land in test-results/.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const TZ = 'Europe/Helsinki'
const socket = createServer()
await new Promise((r) => socket.listen(0, '127.0.0.1', r))
const port = socket.address().port
await new Promise((r) => socket.close(r))
const origin = `http://127.0.0.1:${port}`
const data = await mkdtemp(`${tmpdir()}/stretch-ui-`)
await mkdir('test-results', { recursive: true })
let logs = ''
const server = spawn(
  process.env.STRETCH_TEST_BINARY ?? 'backend/target/debug/stretch-api',
  [],
  {
    env: {
      ...process.env,
      STRETCH_BIND: `127.0.0.1:${port}`,
      STRETCH_DATA_DIR: data,
      STRETCH_STATIC_DIR: resolve('dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
server.stdout.on('data', (d) => (logs += d))
server.stderr.on('data', (d) => (logs += d))

async function eventually(fn) {
  let error
  for (let i = 0; i < 60; i++) {
    try {
      return await fn()
    } catch (e) {
      error = e
      await delay(150)
    }
  }
  throw error
}

/** Today's date at `clock` in the test time zone, as a Date. */
function todayAt(clock) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(),
  )
  const probe = new Date(`${day}T12:00:00Z`)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(probe)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(
    +parts.year,
    parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
  )
  const offset = Math.round((asUtc - probe) / 60000)
  const sign = offset >= 0 ? '+' : '-'
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const mm = String(Math.abs(offset) % 60).padStart(2, '0')
  return new Date(`${day}T${clock}:00${sign}${hh}:${mm}`)
}

// Records notifications instead of showing them.
const captureNotifications = () => {
  window.__notes = []
  const record = (title, options) => window.__notes.push({ title, ...options })
  ServiceWorkerRegistration.prototype.showNotification = async function (
    title,
    options,
  ) {
    record(title, options)
  }
  const Native = window.Notification
  window.Notification = class extends EventTarget {
    static permission = 'granted'
    static requestPermission = async () => 'granted'
    constructor(title, options) {
      super()
      record(title, options)
    }
    close() {}
  }
  void Native
}

let browser
try {
  await eventually(async () =>
    assert.ok((await fetch(`${origin}/api/ready`)).ok),
  )
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  })
  const context = (options = {}) =>
    browser.newContext({
      timezoneId: TZ,
      viewport: { width: 1100, height: 900 },
      ...options,
    })

  // --- A day on a fake clock -------------------------------------------------
  const desk = await context()
  const page = await desk.newPage()
  page.on('pageerror', (e) => console.error('page error:', e))
  page.on(
    'console',
    (m) => m.type() === 'error' && console.error('console:', m.text()),
  )
  await page.addInitScript(captureNotifications)
  await page.clock.install({ time: todayAt('09:00') })
  await page.goto(origin)
  await page.getByText('Ready when you are').waitFor()
  // Dismiss the permissions prompt for this check.
  await page.getByRole('button', { name: 'Later' }).click()

  await page.getByRole('button', { name: 'Sit', exact: true }).click()
  await page.getByText('Sitting since 09:00').waitFor()
  await page.getByText(/Next: stand around 09:45/).waitFor()

  // Sitting reaches its limit: suggestion card, tab title and a notification.
  await page.clock.runFor('46:00')
  await page.getByText('Time to stand?').first().waitFor()
  assert.match(await page.title(), /Time to stand/)
  const notes = await eventually(async () => {
    const n = await page.evaluate(() => window.__notes)
    assert.ok(n.length >= 1, 'a notification was shown')
    return n
  })
  assert.equal(notes[0].title, 'Time to stand?')
  assert.deepEqual(
    notes[0].actions.map((a) => a.action),
    ['accept', 'snooze'],
  )
  await page.screenshot({
    path: 'test-results/now-suggestion.png',
    fullPage: true,
  })

  // "Not now" snoozes for ten minutes.
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByText(/Next: stand around 09:56/).waitFor()
  await page.getByText('Time to stand?').waitFor({ state: 'detached' })

  // Keyboard: 2 = stand.
  await page.keyboard.press('2')
  await page.getByText('Standing since 09:46').waitFor()

  // The machine sleeps for 20 minutes: counted as away, standing resumes.
  await page.clock.fastForward('20:00')
  await page.getByText(/Welcome back\. Away 20 min/).waitFor()
  await page.getByText(/back to standing/).waitFor()
  await page.screenshot({
    path: 'test-results/now-returned.png',
    fullPage: true,
  })

  // The timeline shows the idle change and can be edited.
  await page.getByRole('link', { name: 'Today' }).click()
  await page.getByRole('button', { name: /Away.*idle.*20 min/ }).waitFor()
  await page.getByRole('button', { name: /^09:00\s*Sitting/ }).click()
  await page.getByRole('radio', { name: 'Walk' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: /^09:00\s*Walking/ }).waitFor()
  await page.screenshot({ path: 'test-results/today.png', fullPage: true })

  await page.getByRole('link', { name: 'Stats' }).click()
  await page.getByText('Time per day').waitFor()
  await page.getByText('Show table').click()
  await page.getByRole('cell', { name: 'Today' }).waitFor()
  await page.screenshot({ path: 'test-results/stats.png', fullPage: true })

  await page.getByRole('link', { name: 'Settings' }).click()
  const stand = page.getByLabel('Daily standing target')
  await stand.fill('90')
  await page.getByRole('button', { name: 'Save' }).click()
  await eventually(async () => {
    const res = await fetch(`${origin}/api/state?from=2000-01-01T00:00:00Z`)
    const state = await res.json()
    assert.equal(state.docs.settings.value.targets.stand, 90)
  })
  await page.screenshot({ path: 'test-results/settings.png', fullPage: true })
  await desk.close()

  // --- Entering the past -----------------------------------------------------
  // On a fresh fake day: "I've been sitting for an hour, standing before that".
  const past = await (await context()).newPage()
  await past.clock.install({
    time: new Date(todayAt('09:30').getTime() + 86400000),
  })
  await past.goto(origin)
  await past.getByRole('button', { name: 'Later' }).click()
  await past.getByRole('button', { name: 'Sit', exact: true }).click()
  await past.getByRole('button', { name: '1h ago' }).click()
  await past.getByText('Sitting since 08:30').waitFor()
  await past.getByRole('button', { name: 'Adjust' }).click()
  await past.getByRole('button', { name: /Before that/ }).click()
  await past.getByRole('button', { name: '1h before' }).click()
  await past.screenshot({ path: 'test-results/adjust.png', fullPage: true })
  await past.getByRole('button', { name: 'Save' }).click()
  await past.getByRole('link', { name: 'Today' }).click()
  await past
    .getByRole('button', { name: /^07:30\s*Standing.*1 h 00 min/ })
    .waitFor()
  await past.getByRole('button', { name: /^08:30\s*Sitting/ }).waitFor()

  // Timeline: click a block to edit it, drag across the bar to fill in time.
  const bar = past.getByRole('group', { name: /Today's timeline/ })
  const box = await bar.boundingBox()
  const [barStart, barEnd] = await bar.evaluate((el) => [
    Number(el.dataset.start),
    Number(el.dataset.end),
  ])
  const fakeNow = todayAt('09:30').getTime() + 86400000
  const x = (minutesAgo) =>
    box.x +
    ((fakeNow - minutesAgo * 60000 - barStart) / (barEnd - barStart)) *
      box.width
  const y = box.y + box.height / 2
  await past.mouse.click(x(90), y)
  await past.getByRole('radio', { name: 'Walk' }).click()
  await past.getByRole('button', { name: 'Save' }).click()
  await past
    .getByRole('button', { name: /^07:30\s*Walking.*1 h 00 min/ })
    .waitFor()
  await past.mouse.move(x(45), y)
  await past.mouse.down()
  await past.mouse.move(x(30), y, { steps: 6 })
  await past.mouse.up()
  await past.getByRole('radio', { name: 'Eat' }).click()
  await past.screenshot({
    path: 'test-results/timeline-edit.png',
    fullPage: true,
  })
  await past.getByRole('button', { name: 'Save' }).click()
  await past.getByRole('button', { name: /^08:45\s*Eating.*15 min/ }).waitFor()
  await past.getByRole('button', { name: /^09:00\s*Sitting/ }).waitFor()
  await past.context().close()

  // --- Two devices sync live ------------------------------------------------
  const laptop = await (await context()).newPage()
  const phone = await (
    await context({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
      isMobile: true,
    })
  ).newPage()
  for (const p of [laptop, phone]) {
    await p.goto(origin)
    await p.getByRole('button', { name: 'Walk', exact: true }).waitFor()
  }
  await laptop.getByRole('button', { name: 'Walk', exact: true }).click()
  await phone.getByText(/^Walking since/).waitFor({ timeout: 5000 })
  await phone.getByRole('button', { name: 'Eat', exact: true }).click()
  await laptop.getByText(/^Eating since/).waitFor({ timeout: 5000 })
  await phone.screenshot({
    path: 'test-results/now-phone-dark.png',
    fullPage: true,
  })
  const width = await phone.evaluate(() => document.documentElement.scrollWidth)
  assert.ok(width <= 390, `no horizontal scroll on phones (got ${width}px)`)

  console.log('UI verification passed')
} catch (e) {
  console.error(logs)
  let i = 0
  for (const c of browser?.contexts() ?? [])
    for (const p of c.pages())
      await p
        .screenshot({ path: `test-results/failure-${i++}.png`, fullPage: true })
        .catch(() => {})
  for (const c of browser?.contexts() ?? [])
    for (const p of c.pages())
      console.error(
        'outbox:',
        await p
          .evaluate(() => localStorage.getItem('stretch.outbox'))
          .catch(() => '?'),
      )
  throw e
} finally {
  await browser?.close()
  server.kill()
}
