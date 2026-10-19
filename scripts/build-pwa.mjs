// Writes dist/sw.js: caches the app shell for offline use and turns
// notification button clicks into messages for the open Stretch tab.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const files = []
async function walk(dir, prefix = '') {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (f.isDirectory()) await walk(`${dir}/${f.name}`, `${prefix}/${f.name}`)
    else if (f.name !== 'sw.js') files.push(`${prefix}/${f.name}`)
  }
}
await walk('dist')
const version = createHash('sha256')
for (const file of files) version.update(await readFile(`dist${file}`))

const sw = `const CACHE = 'stretch-${version.digest('hex').slice(0, 16)}'
const FILES = ${JSON.stringify(files)}
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))))
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('stretch-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
)
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api') || e.request.method !== 'GET') return
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')))
    return
  }
  e.respondWith(caches.match(e.request).then((c) => c || fetch(e.request)))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const message = { type: 'stretch-notification', action: e.action || 'open', data: e.notification.data }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list[0]
      if (!client) return self.clients.openWindow('/')
      client.postMessage(message)
      if (!e.action) return client.focus()
    }),
  )
})
`
await writeFile('dist/sw.js', sw)
