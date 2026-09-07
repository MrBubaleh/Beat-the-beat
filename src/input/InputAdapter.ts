import type { PlayerAction } from '@core/gameplay/actions';
import type { InputBuffer } from './InputBuffer';
import { isUiGestureTarget, swipeToAction } from './swipe';

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
    const action: PlayerAction | null =
      e.code === 'ArrowLeft'
        ? 'laneLeft'
        : e.code === 'ArrowRight'
          ? 'laneRight'
          : e.code === 'Space' || e.code === 'ArrowUp'
            ? 'nitro'
            : e.code === 'ArrowDown'
              ? 'fastFall'
            : null;
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
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (!this.tracking || e.pointerId !== this.pointerId) return;
    this.tracking = false;
    this.pointerId = null;
    const action = swipeToAction(e.clientX - this.startX, e.clientY - this.startY);
    if (action) this.buffer.push(action, performance.now());
  };

  private readonly handlePointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.tracking = false;
    this.pointerId = null;
  };
}
