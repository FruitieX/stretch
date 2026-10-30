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
  const context = async (options = {}) => {
    const ctx = await browser.newContext({
      timezoneId: TZ,
      viewport: { width: 1100, height: 900 },
      ...options,
    })
    // Fake clocks freeze animation frames; skip animations in tests.
    await ctx.addInitScript(() => localStorage.setItem('stretch.noMotion', '1'))
    return ctx
  }

  // --- A day on a fake clock -------------------------------------------------
  const desk = await context()
  const page = await desk.newPage()
  // Dependency bumps must not introduce runtime errors on the main page.
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(`page error: ${e}`))
  page.on(
    'console',
    (m) => m.type() === 'error' && pageErrors.push(`console: ${m.text()}`),
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
  // Switching within a minute corrects the last switch instead of adding one.
  await past.getByRole('button', { name: 'Stand', exact: true }).click()
  await past.getByText('Standing since 09:30').waitFor()
  await past.getByRole('button', { name: 'Sit', exact: true }).click()
  await past.getByText('Sitting since 09:30').waitFor()
  const tomorrow = todayAt('00:00').getTime() + 86400000
  await eventually(async () => {
    const from = encodeURIComponent(new Date(tomorrow).toISOString())
    const state = await (await fetch(`${origin}/api/state?from=${from}`)).json()
    const changes = state.events.filter((e) => Date.parse(e.at) >= tomorrow)
    assert.deepEqual(
      changes.map((e) => e.activity),
      ['sit'],
    )
  })
  // Quick "started earlier" chips are for brief slips; Adjust backfills more.
  await past.getByRole('button', { name: '10m ago' }).click()
  await past.getByText('Sitting since 09:20').waitFor()
  await past.getByRole('button', { name: 'Adjust' }).click()
  await past.getByRole('button', { name: '1h ago' }).click()
  await past.getByRole('button', { name: 'Save' }).click()
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
  const fakeNow = todayAt('09:30').getTime() + 86400000
  // The bar rescales as blocks move, so measure it before each gesture.
  let box, barStart, barEnd, y
  const measure = async () => {
    box = await bar.boundingBox()
    ;[barStart, barEnd] = await bar.evaluate((el) => [
      Number(el.dataset.start),
      Number(el.dataset.end),
    ])
    y = box.y + box.height / 2
  }
  const x = (minutesAgo) =>
    box.x +
    ((fakeNow - minutesAgo * 60000 - barStart) / (barEnd - barStart)) *
      box.width
  await measure()
  await past.mouse.click(x(90), y)
  await past.getByRole('radio', { name: 'Walk' }).click()
  await past.getByRole('button', { name: 'Save' }).click()
  await past
    .getByRole('button', { name: /^07:30\s*Walking.*1 h 00 min/ })
    .waitFor()
  const dragFrom = async (start, minutesAgo) => {
    await measure()
    start = typeof start === 'function' ? await start() : x(start)
    await past.mouse.move(start, y)
    await past.mouse.down()
    await past.mouse.move(x(minutesAgo), y, { steps: 8 })
    await past.mouse.up()
  }
  const row = (pattern) => past.getByRole('button', { name: pattern }).waitFor()

  // Dragging a block slides it, keeping its length.
  await dragFrom(90, 75)
  await row(/^07:45\s*Walking.*1 h 00 min/)
  await row(/^08:45\s*Sitting/)

  // Dragging an edge resizes; the neighbour grows to fit.
  const edge = async (clock) =>
    await past
      .getByRole('separator', { name: new RegExp(`Switch at ${clock}`) })
      .boundingBox()
  await dragFrom(async () => {
    const e1 = await edge('08:45')
    return e1.x + e1.width / 2
  }, 60)
  await row(/^07:45\s*Walking.*45 min/)
  await row(/^08:30\s*Sitting/)

  // Sliding stops before swallowing the current activity (at least 5 min).
  await dragFrom(80, -90)
  await row(/^08:40\s*Walking.*45 min/)
  await row(/^09:25\s*Sitting/)

  // Dragging across empty time fills it in.
  await dragFrom(85, 65)
  await past.getByRole('radio', { name: 'Eat' }).click()
  await past.screenshot({
    path: 'test-results/timeline-edit.png',
    fullPage: true,
  })
  await past.getByRole('button', { name: 'Save' }).click()
  await row(/^08:05\s*Eating.*20 min/)

  // Overlaps are impossible; an edit that covers other blocks says so first.
  await measure()
  await past.mouse.click(x(75), y)
  await past.getByLabel('To', { exact: true }).fill('09:27')
  await past.getByText(/Replaces walking 08:40–09:25\.$/).waitFor()
  await past.screenshot({
    path: 'test-results/timeline-overlap.png',
    fullPage: true,
  })
  await past.getByRole('button', { name: 'Cancel' }).click()
  await past.context().close()

  // --- Lining blocks up, layout stability, menus ---------------------------
  const align = await (await context()).newPage()
  const alignNow = todayAt('10:30').getTime() + 2 * 86400000
  await align.clock.install({ time: new Date(alignNow) })
  await align.goto(origin)
  await align.getByRole('button', { name: 'Later' }).click()
  await align.getByRole('button', { name: 'Sit', exact: true }).click()
  await align.getByText('Sitting since 10:30').waitFor()

  // "I was away…" closes on a click outside it and on Escape.
  await align.getByRole('button', { name: 'I was away…' }).click()
  await align.getByRole('button', { name: '15m', exact: true }).waitFor()
  await align
    .getByText('Ready when you are')
    .or(align.locator('header'))
    .first()
    .click()
  await align
    .getByRole('button', { name: '15m', exact: true })
    .waitFor({ state: 'detached' })
  await align.getByRole('button', { name: 'I was away…' }).click()
  await align.keyboard.press('Escape')
  await align
    .getByRole('button', { name: '15m', exact: true })
    .waitFor({ state: 'detached' })

  const alignBar = align.getByRole('group', { name: /Today's timeline/ })
  const ax = async (clock) => {
    const box = await alignBar.boundingBox()
    const [start, end] = await alignBar.evaluate((el) => [
      Number(el.dataset.start),
      Number(el.dataset.end),
    ])
    const t = todayAt(clock).getTime() + 2 * 86400000
    return {
      x: box.x + ((t - start) / (end - start)) * box.width,
      y: box.y + box.height / 2,
    }
  }
  // Fill 09:00–09:30 as standing, leaving an untracked gap before 10:30.
  let p1 = await ax('09:00')
  let p2 = await ax('09:30')
  await align.mouse.move(p1.x, p1.y)
  await align.mouse.down()
  await align.mouse.move(p2.x, p2.y, { steps: 6 })
  await align.mouse.up()
  await align.getByRole('radio', { name: 'Stand' }).click()
  await align.getByRole('button', { name: 'Save' }).click()
  await align.getByRole('separator', { name: /Switch at 09:30/ }).waitFor()

  // The hint under the bar keeps its height while hovering blocks.
  const hint = align.getByText(/Click to edit · drag to move/)
  const idle = (await hint.boundingBox()).height
  p1 = await ax('09:15')
  await align.mouse.move(p1.x, p1.y)
  const hovered = await align.getByText(/09:00–09:30 · Standing/).boundingBox()
  assert.equal(hovered.height, idle, 'hint line keeps its height on hover')

  // Dragging the block's end past the next block closes the gap exactly.
  const gapEdge = await align
    .getByRole('separator', { name: /Switch at 09:30/ })
    .boundingBox()
  p2 = await ax('10:50')
  await align.mouse.move(gapEdge.x + gapEdge.width / 2, p2.y)
  await align.mouse.down()
  await align.mouse.move(p2.x, p2.y, { steps: 8 })
  await align.mouse.up()
  await align.getByRole('link', { name: 'Today' }).click()
  await align
    .getByRole('button', { name: /^09:00\s*Standing.*1 h 30 min/ })
    .waitFor()
  assert.equal(await align.getByText('Stopped tracking').count(), 0)
  await align.context().close()

  // --- Ending the current activity earlier ----------------------------------
  const late = await (await context()).newPage()
  const lateDay = 3 * 86400000
  await late.clock.install({
    time: new Date(todayAt('11:00').getTime() + lateDay),
  })
  await late.goto(origin)
  await late.getByRole('button', { name: 'Later' }).click()
  await late.getByRole('button', { name: 'Sit', exact: true }).click()
  await late.getByRole('button', { name: 'Adjust' }).click()
  await late.getByRole('button', { name: '1h ago' }).click()
  await late.getByRole('button', { name: 'Save' }).click()
  await late.getByText('Sitting since 10:00').waitFor()
  const lateBar = late.getByRole('group', { name: /Today's timeline/ })
  const lb = await lateBar.boundingBox()
  const [ls, le] = await lateBar.evaluate((el) => [
    Number(el.dataset.start),
    Number(el.dataset.end),
  ])
  const t1030 = todayAt('10:30').getTime() + lateDay
  await late.mouse.click(
    lb.x + ((t1030 - ls) / (le - ls)) * lb.width,
    lb.y + lb.height / 2,
  )
  await late.getByLabel('until now').uncheck()
  await late.getByLabel('To', { exact: true }).fill('10:40')
  await late
    .getByRole('radiogroup', { name: 'Then until now' })
    .getByRole('radio', { name: 'Stand' })
    .click()
  await late.screenshot({
    path: 'test-results/end-current.png',
    fullPage: true,
  })
  await late.getByRole('button', { name: 'Save' }).click()
  await late.getByText('Standing since 10:40').waitFor()
  await late.getByRole('link', { name: 'Today' }).click()
  await late.getByRole('button', { name: /^10:00\s*Sitting.*40 min/ }).waitFor()
  await late.getByRole('button', { name: /^10:40\s*Standing/ }).waitFor()
  await late.context().close()

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
  for (const [name, heading] of [
    ['Stats', 'Time per day'],
    ['Settings', 'Schedule'],
  ]) {
    await phone.getByRole('link', { name }).click()
    await phone.getByRole('heading', { name: heading }).waitFor()
    await phone.screenshot({
      path: `test-results/${name.toLowerCase()}-phone-dark.png`,
      fullPage: true,
    })
    const w = await phone.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(w <= 390, `no horizontal scroll on ${name} (got ${w}px)`)
  }

  assert.deepEqual(pageErrors, [], 'no errors on the main page')
  console.log('UI verification passed')
} catch (e) {
  console.error(logs)
  let i = 0
  for (const c of browser?.contexts() ?? [])
    for (const p of c.pages())
      await p
        .screenshot({ path: `test-results/failure-${i++}.png`, fullPage: true })
        .catch(() => {})
  for (const c of browser?.contexts() ?? []) {
    for (const p of c.pages()) {
      const text = await p
        .evaluate(() => document.body.innerText.slice(0, 700))
        .catch(() => '?')
      const outbox = await p
        .evaluate(() => localStorage.getItem('stretch.outbox'))
        .catch(() => '?')
      console.error('text:', text, '\noutbox:', outbox)
    }
  }
  throw e
} finally {
  await browser?.close()
  server.kill()
}
