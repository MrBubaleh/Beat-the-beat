import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '@audio/analysis';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 512;

function sine(frequency: number, amplitude: number, length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return out;
}

function sineAtBin(bin: number, amplitude: number): Float32Array {
  return sine((bin * SAMPLE_RATE) / FFT_SIZE, amplitude, FFT_SIZE);
}

describe('analysis', () => {
  it('computes RMS of a sine wave', () => {
    const result = computeAnalysis(sineAtBin(5, 1), FFT_SIZE, SAMPLE_RATE, null);
    expect(result.rms).toBeCloseTo(0.707, 2);
  });

  it('spectral centroid is near the sine frequency', () => {
    const result = computeAnalysis(sineAtBin(5, 1), FFT_SIZE, SAMPLE_RATE, null);
    const binFreq = (5 * SAMPLE_RATE) / FFT_SIZE;
    expect(result.spectralCentroid).toBeGreaterThan(binFreq - 10);
    expect(result.spectralCentroid).toBeLessThan(binFreq + 10);
  });

  it('flux is zero for identical consecutive blocks and positive for a change', () => {
    const a = sine(440, 1, FFT_SIZE);
    const b = sine(440, 1, FFT_SIZE);
    const first = computeAnalysis(a, FFT_SIZE, SAMPLE_RATE, null);
    expect(first.spectralFlux).toBe(0);

    const same = computeAnalysis(b, FFT_SIZE, SAMPLE_RATE, first.magnitudes);
    expect(same.spectralFlux).toBeLessThan(0.001);

    const changed = computeAnalysis(sine(880, 1, FFT_SIZE), FFT_SIZE, SAMPLE_RATE, first.magnitudes);
    expect(changed.spectralFlux).toBeGreaterThan(0.001);
  });
});
