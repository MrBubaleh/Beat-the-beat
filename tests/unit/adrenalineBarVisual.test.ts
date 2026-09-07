import { describe, expect, it } from 'vitest';
import { adrenalineBarVisualPercent } from '../../src/ui/adrenalineBarVisual';

describe('adrenalineBarVisualPercent', () => {
  it('maps full and empty linear endpoints', () => {
    expect(adrenalineBarVisualPercent(100)).toBe(100);
    expect(adrenalineBarVisualPercent(0)).toBe(0);
  });

  it('drops faster visually at high actual HP', () => {
    const dropFromTop = adrenalineBarVisualPercent(90) - adrenalineBarVisualPercent(100);
    const dropFromLow = adrenalineBarVisualPercent(15) - adrenalineBarVisualPercent(20);
    expect(Math.abs(dropFromTop)).toBeGreaterThan(Math.abs(dropFromLow));
    expect(adrenalineBarVisualPercent(50)).toBeLessThan(42);
  });

  it('does not freeze visually at very low actual HP', () => {
    expect(adrenalineBarVisualPercent(8)).toBeGreaterThan(3);
    const drop = adrenalineBarVisualPercent(10) - adrenalineBarVisualPercent(5);
    expect(Math.abs(drop)).toBeGreaterThan(0.8);
  });
});
