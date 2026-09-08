import { describe, expect, it } from 'vitest';
import { SWIPE_THRESHOLD_PX, swipeMove, swipeToAction } from '@input/swipe';

describe('swipeToAction', () => {
  it('maps four directions like arrow keys', () => {
    expect(swipeToAction(-SWIPE_THRESHOLD_PX - 1, 0)).toBe('laneLeft');
    expect(swipeToAction(SWIPE_THRESHOLD_PX + 1, 0)).toBe('laneRight');
    expect(swipeToAction(0, -SWIPE_THRESHOLD_PX - 1)).toBe('nitro');
    expect(swipeToAction(0, SWIPE_THRESHOLD_PX + 1)).toBe('fastFall');
  });

  it('ignores short moves', () => {
    expect(swipeToAction(10, 8)).toBeNull();
    expect(SWIPE_THRESHOLD_PX).toBe(36);
  });

  it('uses the dominant axis', () => {
    expect(swipeToAction(-80, -20)).toBe('laneLeft');
    expect(swipeToAction(20, 90)).toBe('fastFall');
  });
});

describe('swipeMove', () => {
  it('chains segments without lifting the finger', () => {
    let state = { startX: 0, startY: 0 };
    const first = swipeMove(state, 40, 0);
    expect(first.action).toBe('laneRight');
    state = first.state;
    // Второй отрезок от нового якоря — вторая полоса без отрыва.
    const second = swipeMove(state, 80, 5);
    expect(second.action).toBe('laneRight');
    // Смена направления mid-touch — другое действие.
    const third = swipeMove(second.state, 85, -40);
    expect(third.action).toBe('nitro');
  });

  it('ignores wiggles and keeps the anchor', () => {
    const state = { startX: 0, startY: 0 };
    const step = swipeMove(state, 10, 8);
    expect(step.action).toBeNull();
    expect(step.state).toEqual(state);
  });
});
