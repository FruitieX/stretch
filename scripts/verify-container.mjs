// Runs the built image like the homelab does (read-only, no capabilities,
// non-root) and checks that activity survives a container restart.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const image = process.env.STRETCH_TEST_IMAGE ?? 'ghcr.io/fruitiex/stretch:main'
const suffix = randomUUID().slice(0, 8)
const volume = `stretch-check-${suffix}`
const names = []
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

function start(name) {
  names.push(name)
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '-p',
    '127.0.0.1::8080',
    '-v',
    `${volume}:/data`,
    '-e',
    'STRETCH_SQLITE_JOURNAL_MODE=DELETE',
    image,
  )
  const port = JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports[
    '8080/tcp'
  ][0].HostPort
  return `http://127.0.0.1:${port}`
}
async function ready(origin) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/api/ready`)).ok) return
    } catch {}
    await delay(200)
  }
  throw new Error('Container did not become ready')
}

try {
  let origin = start(`stretch-a-${suffix}`)
  await ready(origin)
  const page = await fetch(origin)
  assert.ok(page.ok)
  assert.match(await page.text(), /<title>Stretch<\/title>/)
  assert.ok((await fetch(`${origin}/sw.js`)).ok, 'service worker is served')
  const saved = await fetch(`${origin}/api/events/container-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ at: new Date().toISOString(), activity: 'stand' }),
  })
  assert.ok(saved.ok, await saved.text())
  docker('rm', '-f', names.pop())
  origin = start(`stretch-b-${suffix}`)
  await ready(origin)
  const state = await (
    await fetch(`${origin}/api/state?from=2000-01-01T00:00:00Z`)
  ).json()
  assert.equal(state.events[0].id, 'container-1')
  console.log('Container verification passed')
} finally {
  for (const name of names) docker('rm', '-f', name)
  docker('volume', 'rm', '-f', volume)
}
