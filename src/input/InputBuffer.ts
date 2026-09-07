import type { PlayerAction } from '@core/gameplay/actions';

export interface TimedAction {
  action: PlayerAction;
  time: number;
}

export class InputBuffer {
  private queue: TimedAction[] = [];

  constructor(private readonly windowMs: number) {}

  push(action: PlayerAction, time: number): void {
    this.queue.push({ action, time });
  }

  consume(now: number, windowMs: number = this.windowMs): PlayerAction[] {
    const cutoff = now - windowMs;
    const ready: PlayerAction[] = [];
    const kept: TimedAction[] = [];
    for (const entry of this.queue) {
      if (entry.time < cutoff) continue;
      if (entry.time <= now) ready.push(entry.action);
      else kept.push(entry);
    }
    this.queue = kept;
    return ready;
  }

  clear(): void {
    this.queue = [];
  }

  get size(): number {
    return this.queue.length;
  }
}
