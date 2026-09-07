import { describe, expect, it } from 'vitest';
import { SWIPE_THRESHOLD_PX, swipeToAction } from '@input/swipe';

describe('swipeToAction', () => {
  it('maps four directions like arrow keys', () => {
    expect(swipeToAction(-SWIPE_THRESHOLD_PX - 1, 0)).toBe('laneLeft');
    expect(swipeToAction(SWIPE_THRESHOLD_PX + 1, 0)).toBe('laneRight');
    expect(swipeToAction(0, -SWIPE_THRESHOLD_PX - 1)).toBe('nitro');
    expect(swipeToAction(0, SWIPE_THRESHOLD_PX + 1)).toBe('fastFall');
  });

  it('ignores short moves', () => {
    expect(swipeToAction(10, 8)).toBeNull();
  });

  it('uses the dominant axis', () => {
    expect(swipeToAction(-80, -20)).toBe('laneLeft');
    expect(swipeToAction(20, 90)).toBe('fastFall');
  });
});
