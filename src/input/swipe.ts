import type { PlayerAction } from '@core/gameplay/actions';

export const SWIPE_THRESHOLD_PX = 48;

export function swipeToAction(
  dx: number,
  dy: number,
  threshold = SWIPE_THRESHOLD_PX,
): PlayerAction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < threshold && ay < threshold) return null;
  if (ax >= ay) return dx < 0 ? 'laneLeft' : 'laneRight';
  return dy < 0 ? 'nitro' : 'fastFall';
}

export function isUiGestureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, input, textarea, select, a, label, .menu-root, .end-run-root, .hud-pause, .hud-gameover, .hud-results',
    ),
  );
}
