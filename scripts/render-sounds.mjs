// Renders every alert sound (style × level) to WAV in test-results/sounds/
// with the app's own sound code, and prints peak and loudness for each, so
// sounds can be compared by ear and checked for clipping.
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const server = await createServer({
  server: { port: 0, strictPort: false },
  logLevel: 'error',
})
await server.listen()
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox'],
})

function wav(channels, rate) {
  const frames = channels[0].length
  const data = Buffer.alloc(44 + frames * channels.length * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + frames * channels.length * 2, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(channels.length, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * channels.length * 2, 28)
  data.writeUInt16LE(channels.length * 2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(frames * channels.length * 2, 40)
  let o = 44
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[i])) * 32767), o)
      o += 2
    }
  }
  return data
}

try {
  const page = await browser.newPage()
  // Any same-origin page works for importing the module; skip the app itself.
  await page.goto(`${origin}/icon.svg`)
  const renders = await page.evaluate(async () => {
    const { play, SOUND_STYLES } = await import('/src/lib/sound.ts')
    const rate = 44100
    const out = []
    for (const style of SOUND_STYLES) {
      for (const level of [1, 2, 3]) {
        const probe = new OfflineAudioContext(2, rate, rate)
        const seconds = play(probe, style, level, 0.7, 0)
        const audio = new OfflineAudioContext(
          2,
          Math.ceil(seconds * rate),
          rate,
        )
        play(audio, style, level, 0.7, 0.02)
        const buffer = await audio.startRendering()
        const channels = [0, 1].map((c) => Array.from(buffer.getChannelData(c)))
        out.push({ style, level, rate, channels })
      }
    }
    return out
  })
  await mkdir('test-results/sounds', { recursive: true })
  for (const { style, level, rate, channels } of renders) {
    let peak = 0
    let sum = 0
    let count = 0
    for (const ch of channels) {
      for (const v of ch) {
        peak = Math.max(peak, Math.abs(v))
        sum += v * v
        count++
      }
    }
    const rms = Math.sqrt(sum / count)
    const file = `test-results/sounds/${style}-${level}.wav`
    await writeFile(file, wav(channels, rate))
    console.log(
      `${file}  ${(channels[0].length / rate).toFixed(1)}s  peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS  rms ${(20 * Math.log10(rms)).toFixed(1)} dBFS`,
    )
  }
} finally {
  await browser.close()
  await server.close()
}
