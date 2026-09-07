import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@core/levelgen/prng';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('differs for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const valuesA = [a(), a(), a()];
    const valuesB = [b(), b(), b()];
    expect(valuesA).not.toEqual(valuesB);
  });

  it('always returns values in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 10_000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
