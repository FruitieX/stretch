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

export const SOUND_STYLES = ['chime', 'glass', 'marimba'] as const
export type SoundStyle = (typeof SOUND_STYLES)[number]

export const SOUND_LABELS: Record<SoundStyle, string> = {
  chime: 'Chime',
  glass: 'Glass',
  marimba: 'Marimba',
}

interface Voice {
  /** Overtones as [frequency ratio, relative level, decay seconds]. */
  partials: [number, number, number][]
  attack: number
  /** Low-pass cutoff as a multiple of the note frequency. */
  brightness: number
  /** Slightly detuned double for shimmer, in cents (0 = none). */
  shimmer: number
  /** Gap between notes in seconds. */
  step: number
}

/**
 * Each style is a small additive synth modelled on a struck instrument:
 * a soft bell, a glassy bar or a wooden marimba bar.
 */
const VOICES: Record<SoundStyle, Voice> = {
  chime: {
    partials: [
      [1, 1, 2.2],
      [2, 0.28, 1.2],
      [3.01, 0.08, 0.6],
    ],
    attack: 0.008,
    brightness: 6,
    shimmer: 4,
    step: 0.2,
  },
  glass: {
    partials: [
      [1, 1, 1.8],
      [2.756, 0.42, 0.9],
      [5.404, 0.18, 0.45],
      [8.933, 0.06, 0.25],
    ],
    attack: 0.004,
    brightness: 12,
    shimmer: 0,
    step: 0.17,
  },
  marimba: {
    partials: [
      [1, 1, 0.75],
      [3.93, 0.3, 0.18],
      [9.2, 0.06, 0.07],
    ],
    attack: 0.003,
    brightness: 9,
    shimmer: 0,
    step: 0.15,
  },
}

const note = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12)
// Major pentatonic notes around C6, so any combination sounds friendly.
const G5 = note(10)
const C6 = note(15)
const E6 = note(19)
const G6 = note(22)

/** Each alert level is a short phrase; later levels are longer and louder. */
const PHRASES: Record<1 | 2 | 3, { notes: number[]; level: number }> = {
  1: { notes: [G5, C6], level: 0.45 },
  2: { notes: [G5, C6, E6], level: 0.7 },
  3: { notes: [C6, E6, G6, 0, C6, E6, G6], level: 1 },
}

/** A short synthetic room so notes ring instead of stopping dead. */
function room(audio: BaseAudioContext): ConvolverNode {
  const seconds = 1.4
  const length = Math.floor(audio.sampleRate * seconds)
  const impulse = audio.createBuffer(2, length, audio.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3
    }
  }
  const convolver = audio.createConvolver()
  convolver.buffer = impulse
  return convolver
}

function strike(
  audio: BaseAudioContext,
  out: AudioNode,
  voice: Voice,
  freq: number,
  at: number,
  level: number,
  pan: number,
) {
  const filter = audio.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = Math.min(18000, freq * voice.brightness)
  const panner = audio.createStereoPanner()
  panner.pan.value = pan
  filter.connect(panner).connect(out)
  const detunes = voice.shimmer ? [-voice.shimmer, voice.shimmer] : [0]
  for (const [ratio, amp, decay] of voice.partials) {
    for (const cents of detunes) {
      const osc = audio.createOscillator()
      const env = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq * ratio
      osc.detune.value = cents
      const peak = (level * amp) / detunes.length
      env.gain.setValueAtTime(0, at)
      env.gain.linearRampToValueAtTime(peak, at + voice.attack)
      env.gain.exponentialRampToValueAtTime(0.0001, at + voice.attack + decay)
      osc.connect(env).connect(filter)
      osc.start(at)
      osc.stop(at + voice.attack + decay + 0.05)
    }
  }
}

/**
 * Plays alert `level` (1 = gentle suggestion, 2–3 = escalating stillness
 * alarm) in `style` on any audio context. Returns when it ends, in seconds
 * from `at`.
 */
export function play(
  audio: BaseAudioContext,
  style: SoundStyle,
  level: number,
  volume: number,
  at = audio.currentTime + 0.02,
): number {
  const voice = VOICES[style] ?? VOICES.chime
  const phrase = PHRASES[Math.min(3, Math.max(1, level)) as 1 | 2 | 3]
  const master = audio.createGain()
  master.gain.value = Math.min(1, Math.max(0, volume)) * phrase.level * 0.8
  const limiter = audio.createDynamicsCompressor()
  limiter.threshold.value = -10
  limiter.ratio.value = 8
  master.connect(limiter).connect(audio.destination)
  const wet = audio.createGain()
  wet.gain.value = 0.22
  wet.connect(room(audio)).connect(master)
  const dry = audio.createGain()
  dry.connect(master)
  dry.connect(wet)

  let t = at
  phrase.notes.forEach((freq, i) => {
    if (freq) {
      // Notes drift gently across the stereo field.
      const pan = (i % 3) * 0.25 - 0.25
      strike(audio, dry, voice, freq, t, 1, pan)
    }
    t += freq ? voice.step : voice.step * 2
  })
  const longest = Math.max(...voice.partials.map((p) => p[2]))
  return t - at + longest + 1.4
}

/** Plays an alert chime if audio has been unlocked. */
export function chime(
  level: number,
  volume: number,
  style: SoundStyle = 'chime',
) {
  if (!ctx || ctx.state !== 'running') return
  play(ctx, style, level, volume)
}
