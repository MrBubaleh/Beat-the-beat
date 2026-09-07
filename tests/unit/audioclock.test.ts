import { describe, expect, it } from 'vitest';
import { AudioClock } from '@audio/AudioClock';

describe('AudioClock', () => {
  it('reports the raw time source currentTime', () => {
    let t = 100;
    const clock = new AudioClock({
      get currentTime(): number {
        return t;
      },
    });
    expect(clock.currentTime).toBe(100);
    t = 120;
    expect(clock.currentTime).toBe(120);
  });

  it('getTrackTime subtracts the latency offset', () => {
    let t = 10;
    const clock = new AudioClock(
      {
        get currentTime(): number {
          return t;
        },
      },
      0.04,
    );
    expect(clock.getTrackTime()).toBeCloseTo(9.96);
  });

  it('latencyOffset is configurable at runtime', () => {
    const clock = new AudioClock({ currentTime: 5 }, 0.1);
    expect(clock.getTrackTime()).toBeCloseTo(4.9);
    clock.latencyOffset = 0.25;
    expect(clock.getTrackTime()).toBeCloseTo(4.75);
  });

  it('restart() resets the track time baseline', () => {
    let t = 100;
    const clock = new AudioClock(
      {
        get currentTime(): number {
          return t;
        },
      },
      0.04,
    );
    expect(clock.getTrackTime()).toBeCloseTo(99.96);
    t = 140;
    expect(clock.getTrackTime()).toBeCloseTo(139.96);
    clock.restart();
    expect(clock.getTrackTime()).toBeCloseTo(-0.04);
    t = 150;
    expect(clock.getTrackTime()).toBeCloseTo(9.96);
  });
});
