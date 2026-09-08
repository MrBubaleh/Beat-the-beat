import type { PlayerAction } from '@core/gameplay/actions';
import type { InputBuffer } from './InputBuffer';
import { isUiGestureTarget, swipeMove, swipeToAction } from './swipe';

/** Стрелки — основной вариант, WASD — тихий дубль с тем же смыслом. */
export function keyCodeToAction(code: string): PlayerAction | null {
  if (code === 'ArrowLeft' || code === 'KeyA') return 'laneLeft';
  if (code === 'ArrowRight' || code === 'KeyD') return 'laneRight';
  if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') return 'nitro';
  if (code === 'ArrowDown' || code === 'KeyS') return 'fastFall';
  return null;
}

export class InputAdapter {
  private readonly buffer: InputBuffer;
  private tracking = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;

  constructor(buffer: InputBuffer) {
    this.buffer = buffer;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    const action = keyCodeToAction(e.code);
    if (!action) return;
    e.preventDefault();
    if ((action === 'nitro' || action === 'fastFall') && e.repeat) return;
    this.buffer.push(action, performance.now());
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isUiGestureTarget(e.target)) return;
    this.tracking = true;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (!this.tracking || e.pointerId !== this.pointerId) return;
    if (e.cancelable) e.preventDefault();
    const step = swipeMove(
      { startX: this.startX, startY: this.startY },
      e.clientX,
      e.clientY,
    );
    if (!step.action) return;
    // Без отрыва пальца: якорь едет дальше вместе с пальцем.
    this.startX = step.state.startX;
    this.startY = step.state.startY;
    this.buffer.push(step.action, performance.now());
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (!this.tracking || e.pointerId !== this.pointerId) return;
    const action = swipeToAction(e.clientX - this.startX, e.clientY - this.startY);
    this.finishPointerGesture();
    if (action) this.buffer.push(action, performance.now());
  };

  private readonly handlePointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.finishPointerGesture();
  };

  private finishPointerGesture(): void {
    this.tracking = false;
    this.pointerId = null;
  }
}
