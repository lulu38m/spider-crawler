import { describe, expect, it } from 'vitest';
import { SoundEngine, wav } from '../src/audio/sfx';

describe('sound', () => {
  it('logs sounds on the video clock in capture mode, and thins out fast footsteps', () => {
    const engine = new SoundEngine();
    let t = 0;
    engine.timelineClock = () => t;
    for (let i = 0; i < 10; i++) {
      engine.play({ kind: 'step' });
      t += 0.01; // 100 steps a second: far too many to hear one by one
    }
    engine.play({ kind: 'catch', index: 0 });
    const steps = engine.timeline.filter((x) => x.e.kind === 'step');
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.length).toBeLessThan(10);
    expect(engine.timeline.at(-1)).toMatchObject({ e: { kind: 'catch' } });
  });

  it('stays silent when sound is off', () => {
    const engine = new SoundEngine();
    engine.enabled = false;
    engine.timelineClock = () => 0;
    engine.play({ kind: 'land' });
    expect(engine.timeline).toEqual([]);
  });

  it('writes valid 16-bit stereo WAV', async () => {
    const left = new Float32Array([0, 0.5, -0.5, 1.5]);
    const right = new Float32Array([0, -1, 1, 0]);
    const buffer = { numberOfChannels: 2, length: 4, sampleRate: 48000, getChannelData: (c: number) => (c ? right : left) } as unknown as AudioBuffer;
    const view = new DataView(await wav(buffer).arrayBuffer());
    const text = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(view.getInt16(44 + 4 * 1, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(view.getInt16(44 + 4 * 1 + 2, true)).toBe(-0x8000);
    expect(view.getInt16(44 + 4 * 3, true)).toBe(0x7fff); // clipped
  });
});
