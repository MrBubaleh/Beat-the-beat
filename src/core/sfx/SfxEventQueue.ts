import type { SfxEvent, SfxId, SfxState } from './types';
import { clamp } from './types';

const rank = (id: SfxId): number =>
  id === 'gameOver' ? 100 : id === 'hit' ? 90 :
    ['nitroStart', 'nitroEnd', 'rocketLaunch', 'rocketEnd', 'mode'].includes(id) ? 70 :
      id === 'smash' || id === 'land' ? 50 : 10;

export class SfxEventQueue {
  private events: SfxEvent[] = [];
  private previous: SfxState | null = null;
  private run = 0;
  private sequence = 0;
  dropped = 0;
  constructor(private capacity = 128) {}

  setCapacity(value: number): void {
    this.capacity = Math.max(8, Math.floor(value));
    while (this.events.length > this.capacity) {
      let index = 0;
      for (let i = 1; i < this.events.length; i++) {
        if (rank(this.events[i].id) < rank(this.events[index].id)) index = i;
      }
      this.events.splice(index, 1);
      this.dropped++;
    }
  }

  emit(id: SfxId, state: SfxState, strength = 0.5, count = 1, pan?: number): void {
    const event: SfxEvent = {
      id, run: this.run, sequence: ++this.sequence, gameTime: state.gameTime,
      mode: state.mode, speed: state.speed, pan: clamp(pan ?? state.laneX / 12, -0.65, 0.65),
      strength: clamp(strength), surface: state.airState === 'trainRoof' ? 'metal' : 'ground', count: Math.max(1, Math.min(128, count)),
    };
    if (this.events.length >= this.capacity) {
      let index = 0;
      for (let i = 1; i < this.events.length; i++) {
        if (rank(this.events[i].id) < rank(this.events[index].id)) index = i;
      }
      this.dropped++;
      if (rank(event.id) <= rank(this.events[index].id)) return;
      this.events.splice(index, 1);
    }
    this.events.push(event);
  }

  observe(state: SfxState): void {
    const prev = this.previous;
    this.previous = { ...state };
    if (!prev) return;
    if (state.gameOver && !prev.gameOver) {
      this.emit('gameOver', state, 1);
      return;
    }
    if (state.gameOver) return;
    if (state.damageState === 'normal' && prev.damageState !== 'normal') {
      this.emit('fullRepair', state, 0.75);
    }
    if (state.airState === 'trainRoof' && prev.airState === 'landing') {
      const landing = [...this.events].reverse().find(e => e.id === 'land' && e.gameTime === state.gameTime);
      if (landing) landing.surface = 'metal';
    }
    if (prev.mode !== state.mode) this.emit('mode', state);
    if (state.lane !== prev.lane && state.mode === prev.mode) {
      this.emit('lane', state, 0.35, 1, Math.sign(state.lane - prev.lane) * 0.45);
    }
    if (state.nitroReady && !prev.nitroReady && !state.nitroActive) this.emit('nitroReady', state);
    if (state.nitroActive && !prev.nitroActive) this.emit('nitroStart', state, 0.7);
    if (!state.nitroActive && prev.nitroActive) this.emit('nitroEnd', state, 0.35);
    if (state.mode === 'rocket') {
      if (prev.mode !== 'rocket' || state.rocketPhase !== prev.rocketPhase) {
        if (state.rocketPhase === 'anticipation') this.emit('rocketPrepare', state, 0.65);
        if (state.rocketPhase === 'launch') this.emit('rocketLaunch', state, 0.85);
        if (state.rocketPhase === 'fall') this.emit('rocketEnd', state, 0.4);
      }
    }
    if (state.mode === prev.mode && state.mode !== 'rocket') {
      if (state.airState === 'airborne' && prev.airState !== 'airborne') this.emit('jump', state, 0.5);
      if ((state.airState === 'landing' || state.airState === 'trainRoof' || state.airState === 'grounded') &&
        (prev.airState === 'airborne' || prev.airState === 'trainExit')) {
        this.emit('land', state, state.mode === 'horse' ? 0.45 : 0.7);
      }
    }
    if (state.sliding && !prev.sliding) this.emit('slideStart', state, 0.4);
    if (!state.sliding && prev.sliding && state.mode === 'horse') this.emit('slideEnd', state, 0.25);
    if ([5, 10, 20].some(n => prev.combo < n && state.combo >= n)) this.emit('combo', state, 0.35);
  }

  drain(): SfxEvent[] {
    return this.events.splice(0);
  }

  reset(): void {
    this.events.length = 0;
    this.previous = null;
    this.run++;
    this.sequence = 0;
    this.dropped = 0;
  }
}
