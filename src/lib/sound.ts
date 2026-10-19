let ctx: AudioContext | null = null

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // No Web Audio; notifications still work.
  }
}

export const audioReady = () => ctx?.state === 'running'

/**
 * A soft two-note chime for suggestions; escalated alarms add notes,
 * volume and repeats.
 */
export function chime(level: number, volume: number) {
  if (!ctx || ctx.state !== 'running') return
  const notes = level <= 1 ? [660, 880] : [660, 880, 1175]
  const repeats = level >= 3 ? 2 : 1
  const gain = Math.min(
    1,
    volume * (level <= 1 ? 0.35 : level === 2 ? 0.6 : 0.9),
  )
  let t = ctx.currentTime + 0.02
  for (let r = 0; r < repeats; r++) {
    for (const freq of notes) {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(gain, t + 0.02)
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
      osc.connect(env).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 1)
      t += 0.22
    }
    t += 0.6
  }
}
