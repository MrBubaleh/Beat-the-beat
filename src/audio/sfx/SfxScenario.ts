import { SfxEventQueue } from '@core/sfx/SfxEventQueue';
import type { SfxFrame, SfxState, SfxId } from '@core/sfx/types';

export const SFX_DEMO_SECONDS = 24;
export class SfxScenario {
  private readonly queue = new SfxEventQueue();
  private last = -1;
  private current: SfxState | null = null;
  trigger(id: SfxId): void { if (this.current) this.queue.emit(id, this.current, 0.75); }
  step(time: number): { frame: SfxFrame; events: ReturnType<SfxEventQueue['drain']> } {
    const mode = time >= 14 && time < 20 ? 'rocket' : time >= 8 && time < 14 ? 'horse' : 'car';
    const jumping = mode === 'horse' && time >= 10 && time < 10.85;
    const state: SfxState = {
      gameTime: time, mode, speed: mode === 'rocket' ? 42 : 13 + Math.min(time % 8, 6) * 2.7,
      lane: Math.floor(time * 0.65) % 5, laneX: Math.sin(time * 1.5) * 2,
      y: jumping ? Math.sin((time - 10) / 0.85 * Math.PI) * 2 : mode === 'rocket' ? Math.max(0, Math.sin((time - 14) / 6 * Math.PI) * 8) : 0,
      airState: jumping ? 'airborne' : 'grounded',
      nitroReady: time >= 4.6 && time < 5,
      nitroActive: time >= 5 && time < 7.6,
      sliding: mode === 'horse' && time >= 11.5 && time < 12.3,
      rocketPhase: mode !== 'rocket' ? 'none' : time < 16.2 ? 'anticipation' : time < 19.2 ? 'launch' : time < 20.05 ? 'plateau' : time < 21.45 ? 'cruise' : 'fall',
      combo: time >= 6 ? 5 : 0, gameOver: time >= 21.2, damageState: 'normal',
    };
    this.current = state;
    this.queue.observe(state);
    const crossed = (t: number) => this.last < t && time >= t;
    for (const t of [1, 1.04, 1.08, 1.12, 1.8, 2, 2.04, 4.6]) if (crossed(t)) this.queue.emit('canister', state, 0.55);
    for (let t = 19.3; t < 21.45; t += 0.065) if (crossed(t)) this.queue.emit('coin', state, 0.5, 3);
    for (const t of [3.2, 20.4]) if (crossed(t)) this.queue.emit('hit', state, t < 4 ? 0.55 : 0.95);
    for (const t of [5.6, 5.64, 6.4, 12.7]) if (crossed(t)) this.queue.emit('smash', state, 0.7);
    for (const t of [2.5, 9.4, 13.4]) if (crossed(t)) this.queue.emit('nearMiss', state, 0.45, 1, 0.4);
    this.last = time;
    return {
      frame: { state, phase: time >= 22.5 ? 'finished' : state.gameOver ? 'gameOver' : 'running', tutorialScale: 1 },
      events: this.queue.drain(),
    };
  }
}
