import { describe, expect, it } from 'vitest';
import audioRaw from '../../configs/audio.default.json';
import type { AudioConfig } from '@core/config/schemas';
import type { RawFeatures } from '@core/state/MusicState';
import { MusicStateBuilder } from '@core/state/MusicStateBuilder';

const config = audioRaw as AudioConfig;

function features(t: number, overrides: Partial<RawFeatures> = {}): RawFeatures {
  return {
    t,
    rms: 0.1,
    spectralCentroid: 800,
    spectralFlux: 0.05,
    ...overrides,
  };
}

describe('MusicStateBuilder', () => {
  it('maps loudness onto a relative range so a quiet→loud section stands out', () => {
    const builder = new MusicStateBuilder(config);
    for (let i = 0; i < 120; i++) builder.push(features(i / 60, { rms: 0.08 }));
    expect(builder.state.energy.value).toBeCloseTo(0.5, 1);

    for (let i = 120; i < 260; i++) builder.push(features(i / 60, { rms: 0.8 }));
    expect(builder.state.energy.value).toBeGreaterThan(0.85);

    for (let i = 260; i < 360; i++) builder.push(features(i / 60, { rms: 0.08 }));
    expect(builder.state.energy.value).toBeLessThan(0.5);
  });

  it('beat fires on a flux spike above the adaptive threshold and debounces', () => {
    const builder = new MusicStateBuilder(config);
    for (let i = 0; i < 60; i++) builder.push(features(i / 60));

    builder.push(features(1.0, { spectralFlux: 0.9 }));
    expect(builder.state.beat.value).toBe(true);

    builder.push(features(1.0167, { spectralFlux: 0.95 }));
    expect(builder.state.beat.value).toBe(false);

    for (let i = 0; i < 30; i++) builder.push(features(1.0167 + (i + 1) / 60, { spectralFlux: 0.05 }));
    builder.push(features(1.5167, { spectralFlux: 0.9 }));
    expect(builder.state.beat.value).toBe(true);
  });

  it('silence enters after minFrames and respects the exit hysteresis + debounce', () => {
    const builder = new MusicStateBuilder(config);
    for (let i = 0; i < 30; i++) builder.push(features(i / 60, { rms: 0.005 }));
    expect(builder.state.silence.value).toBe(true);

    builder.push(features(0.5, { rms: 0.05 }));
    expect(builder.state.silence.value).toBe(false);

    for (let i = 0; i < 10; i++) builder.push(features(0.5 + (i + 1) / 60, { rms: 0.005 }));
    expect(builder.state.silence.value).toBe(false);

    for (let i = 0; i < 35; i++) builder.push(features(0.5 + 10 / 60 + (i + 1) / 60, { rms: 0.005 }));
    expect(builder.state.silence.value).toBe(true);
  });

  it('brightness normalizes the centroid within the session min/max', () => {
    const builder = new MusicStateBuilder(config);
    for (let i = 0; i < 40; i++) builder.push(features(i / 60, { spectralCentroid: 1000 }));
    expect(builder.state.brightness.value).toBeCloseTo(0.5, 2);

    for (let i = 0; i < 60; i++) builder.push(features(20 / 60 + i / 60, { spectralCentroid: 2000 }));
    expect(builder.state.brightness.value).toBeGreaterThan(0.9);
  });
});
