import type { DamageState } from '@core/gameplay/health';
import type { PlayerMode } from '@core/modes/types';
import type { AirState } from '@core/gameplay/air';
import type { RocketPhase } from '@core/gameplay/rocket';

export const SFX_IDS = ['hit', 'canister', 'smash', 'coin', 'beat', 'nitroReady', 'nitroStart', 'nitroEnd', 'nitroDry', 'rocketPrepare', 'rocketLaunch', 'rocketEnd', 'jump', 'land', 'slideStart', 'slideEnd', 'lane', 'nearMiss', 'combo', 'mode', 'gameOver', 'hoof', 'fullRepair'] as const;
export type SfxId = typeof SFX_IDS[number];
export const SFX_BUSES = ['impact', 'ability', 'pickup', 'movement', 'foley'] as const;
export type SfxBus = typeof SFX_BUSES[number];
export type SfxRunPhase = 'running' | 'paused' | 'countdown' | 'gameOver' | 'finished' | 'idle' | 'replay';

export interface SfxState {
  gameTime: number;
  mode: PlayerMode;
  speed: number;
  lane: number;
  laneX: number;
  y: number;
  airState: AirState;
  nitroActive: boolean;
  nitroReady: boolean;
  sliding: boolean;
  rocketPhase: RocketPhase;
  combo: number;
  gameOver: boolean;
  damageState: DamageState;
}

export interface SfxEvent {
  id: SfxId;
  run: number;
  sequence: number;
  gameTime: number;
  mode: PlayerMode;
  speed: number;
  pan: number;
  strength: number;
  surface?: 'ground' | 'metal';
  count: number;
}

export interface SfxFrame {
  state: SfxState;
  phase: SfxRunPhase;
  tutorialScale: number;
}

export interface VoiceRequest {
  voiceId: number;
  event: SfxId;
  mode: PlayerMode;
  bus: SfxBus;
  gain: number;
  pitch: number;
  pan: number;
  strength: number;
  duration: number;
  surface?: 'ground' | 'metal';
  at: number;
}

export interface BedTarget {
  id: 'motor' | 'wind' | 'thrust' | 'slide';
  gain: number;
  hz: number;
  filterHz: number;
  pan: number;
  pulseHz: number;
  toneMix: number;
  load?: number;
}
export type SfxCommand =
  | { type: 'rocket'; phase: 'powered' | 'fall' | 'off'; offset: number }
  | { type: 'sample'; id: 'fullRepair' }
  | { type: 'start'; voice: VoiceRequest }
  | { type: 'stop'; voiceId: number }
  | { type: 'beds'; targets: BedTarget[] }
  | { type: 'duck'; gains: Record<SfxBus, number> }
  | { type: 'silence' };

export const clamp = (x: number, lo = 0, hi = 1): number =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;
