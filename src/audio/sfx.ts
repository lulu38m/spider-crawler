/**
 * The spider's sounds, synthesized with Web Audio: no files to download, and the same code
 * plays them live, feeds the in-app recorder, and renders them offline for frame-perfect videos.
 */

export type SoundKind = 'step' | 'land' | 'jump' | 'rappel' | 'catch' | 'fall' | 'deliver' | 'finale';

export interface SoundEvent {
  kind: SoundKind;
  /** Stereo position, −1 (left) to 1 (right). */
  pan?: number;
  /** For catches: the how-manieth, which picks the note. */
  index?: number;
  /** Catches of figures sparkle, catches of flagged clauses sound darker. */
  accent?: 'figure' | 'flag';
  /** 0..1, for quieter versions (the landing page). */
  volume?: number;
}

// C major pentatonic: catches climb a little tune that never sounds wrong.
const SCALE = [0, 2, 4, 7, 9];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function note(index: number, base = 72): number {
  const octave = Math.floor(index / SCALE.length);
  return midiHz(base + 12 * Math.min(octave, 2) + SCALE[index % SCALE.length]);
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.8), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 2 ** 31 - 1;
    }
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** An exponential envelope from silence to `peak` and back. */
function env(g: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function panner(ctx: BaseAudioContext, out: AudioNode, pan = 0): AudioNode {
  if (!pan || !ctx.createStereoPanner) return out;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  return p;
}

function burst(ctx: BaseAudioContext, out: AudioNode, t: number, o: { dur: number; type: BiquadFilterType; f0: number; f1?: number; q: number; peak: number; attack?: number; offset?: number }): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = o.type;
  filter.Q.value = o.q;
  filter.frequency.setValueAtTime(o.f0, t);
  if (o.f1) filter.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = ctx.createGain();
  env(g.gain, t, o.peak, o.attack ?? 0.002, o.dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t, o.offset ?? 0, o.dur + 0.05);
}

function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: { type: OscillatorType; f0: number; f1?: number; dur: number; peak: number; attack?: number }): void {
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = ctx.createGain();
  env(g.gain, t, o.peak, o.attack ?? 0.004, o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + (o.attack ?? 0.004) + o.dur + 0.05);
}

/** Schedules one sound at time `t` on any audio context (live or offline). */
export function synth(ctx: BaseAudioContext, dest: AudioNode, t: number, e: SoundEvent): void {
  const v = e.volume ?? 1;
  const out = panner(ctx, dest, e.pan);
  // Small variations so repeated sounds don't feel mechanical.
  const jitter = (((e.index ?? 0) * 7919 + Math.floor(t * 1000)) % 100) / 100;
  switch (e.kind) {
    case 'step':
      // A fingertip tap on paper.
      burst(ctx, out, t, { dur: 0.02, type: 'bandpass', f0: 2400 + jitter * 1600, q: 0.9, peak: 0.3 * v, offset: jitter * 0.5 });
      break;
    case 'land':
      burst(ctx, out, t, { dur: 0.06, type: 'lowpass', f0: 1100, q: 0.7, peak: 0.22 * v });
      tone(ctx, out, t, { type: 'sine', f0: 140, f1: 60, dur: 0.12, peak: 0.18 * v });
      break;
    case 'jump':
      burst(ctx, out, t, { dur: 0.32, type: 'bandpass', f0: 500, f1: 2600, q: 1.1, peak: 0.32 * v, attack: 0.08 });
      break;
    case 'rappel':
      // Silk paying out: a thin zip that slows down.
      burst(ctx, out, t, { dur: 0.7, type: 'bandpass', f0: 4200, f1: 1300, q: 3, peak: 0.24 * v, attack: 0.03 });
      tone(ctx, out, t, { type: 'sine', f0: 1900, f1: 1200, dur: 0.6, peak: 0.03 * v, attack: 0.05 });
      break;
    case 'catch': {
      const i = e.index ?? 0;
      if (e.accent === 'flag') {
        // A low, wooden "bonk": something to look at.
        tone(ctx, out, t, { type: 'triangle', f0: note(i % 3, 52), dur: 0.35, peak: 0.16 * v });
        tone(ctx, out, t, { type: 'sine', f0: note(i % 3, 40), dur: 0.3, peak: 0.12 * v });
        break;
      }
      tone(ctx, out, t, { type: 'triangle', f0: note(i), dur: 0.55, peak: 0.17 * v });
      tone(ctx, out, t, { type: 'sine', f0: note(i) * 2, dur: 0.3, peak: 0.035 * v });
      if (e.accent === 'figure') tone(ctx, out, t + 0.07, { type: 'sine', f0: note(i + 5), dur: 0.35, peak: 0.05 * v });
      break;
    }
    case 'fall':
      // Pop, then a little slide down.
      tone(ctx, out, t, { type: 'sine', f0: 950, f1: 240, dur: 0.14, peak: 0.14 * v, attack: 0.002 });
      burst(ctx, out, t, { dur: 0.012, type: 'highpass', f0: 3000, q: 0.7, peak: 0.08 * v });
      break;
    case 'deliver':
      tone(ctx, out, t, { type: 'sine', f0: 1500 + jitter * 300, dur: 0.07, peak: 0.07 * v });
      break;
    case 'finale':
      // A rising arpeggio to the octave: done.
      [0, 2, 4, 5].forEach((step, k) => tone(ctx, out, t + k * 0.12, { type: 'triangle', f0: note(step), dur: 0.9, peak: 0.1 * v }));
      break;
  }
}

/** Minimum gap between two sounds of the same kind (seconds), so fast scenes don't turn into noise. */
const SPACING: Partial<Record<SoundKind, number>> = { step: 0.035, deliver: 0.06, fall: 0.15 };

/**
 * Plays sounds live, and keeps a timeline for offline rendering when asked to.
 * The audio context starts on the first click or key press (browsers require a gesture).
 */
export class SoundEngine {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private lastAt = new Map<SoundKind, number>();
  /** Set for frame-perfect captures: events are logged against this clock instead of played. */
  timelineClock: (() => number) | null = null;
  timeline: Array<{ t: number; e: SoundEvent }> = [];

  /** Call from a user gesture. */
  unlock(): void {
    if (this.timelineClock) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = makeMaster(this.ctx, this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(e: SoundEvent): void {
    if (!this.enabled) return;
    if (this.timelineClock) {
      const t = this.timelineClock();
      if (this.spaced(e.kind, t)) this.timeline.push({ t, e });
      return;
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const t = ctx.currentTime + 0.01;
    if (this.spaced(e.kind, t)) synth(ctx, this.master, t, e);
  }

  private spaced(kind: SoundKind, t: number): boolean {
    const gap = SPACING[kind];
    if (!gap) return true;
    const last = this.lastAt.get(kind) ?? -Infinity;
    if (t - last < gap) return false;
    this.lastAt.set(kind, t);
    return true;
  }

  /** An audio track for the recorder, or null if sound is off or unavailable. */
  recordTrack(): MediaStreamTrack | null {
    this.unlock();
    if (!this.enabled || !this.ctx || !this.master) return null;
    this.recordDest ??= this.ctx.createMediaStreamDestination();
    this.master.connect(this.recordDest);
    return this.recordDest.stream.getAudioTracks()[0] ?? null;
  }

  /** Renders the logged timeline to a WAV file (captures). */
  async renderTimeline(duration: number, sampleRate = 48000): Promise<Blob | null> {
    if (!this.timeline.length) return null;
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const master = makeMaster(ctx, ctx.destination);
    for (const { t, e } of this.timeline) if (t < duration) synth(ctx, master, t, e);
    return wav(await ctx.startRendering());
  }
}

/** Master volume, then a soft clipper so stacked sounds never crack (predictable, unlike a compressor's makeup gain). */
function makeMaster(ctx: BaseAudioContext, out: AudioNode): GainNode {
  const master = ctx.createGain();
  master.gain.value = 2.2;
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = (0.94 * Math.tanh(1.2 * x)) / Math.tanh(1.2);
  }
  clip.curve = curve;
  clip.oversample = '2x';
  master.connect(clip).connect(out);
  return master;
}

/** 16-bit PCM WAV. */
export function wav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  data.setUint32(4, 36 + frames * channels * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, channels, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * channels * 2, true);
  data.setUint16(32, channels * 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, frames * channels * 2, true);
  const chans = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}
