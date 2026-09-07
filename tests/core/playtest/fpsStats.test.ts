import { describe, expect, it } from 'vitest';
import { FpsTracker } from '@core/playtest/fpsStats';

describe('FpsTracker', () => {
  it('aggregates avg, min and p10', () => {
    const tracker = new FpsTracker();
    for (const fps of [30, 40, 50, 60, 58, 55, 52]) {
      tracker.sample(fps);
    }
    const stats = tracker.finish();
    expect(stats.samples).toBe(7);
    expect(stats.min).toBe(30);
    expect(stats.avg).toBeGreaterThan(45);
    expect(stats.p10).toBeLessThanOrEqual(stats.avg);
  });
});
