import type { PlayerMode } from '@core/modes/types';
import type { DamageState } from '@core/gameplay/health';
import type { AirState } from '@core/gameplay/air';
import type { RocketPhase } from '@core/gameplay/rocket';

export type AirSource = 'none' | 'ramp' | 'horseJump' | 'trainRoof' | 'trainExit';

export interface PlayerState {
  gameTime: number;
  speed: number;
  mode: PlayerMode;
  lane: number;
  laneX: number;
  y: number;
  airState: AirState;
  airSource: AirSource;
  airTime: number;
  spinAngle: number;
  trickCount: number;
  isHit: boolean;
  damageState: DamageState;
  recoveryTimer: number;
  gameOver: boolean;
  distance: number;
  coins: number;
  combo: number;
  nearestObstacleDistance: number;
  activeObstacleCount: number;
  nitroCharge: number;
  isAbilityActive: boolean;
  horseMomentum: number;
  horseOverdriveRemaining: number;
  isSliding: boolean;
  horseBoostPulse: number;
  rocketH: -1 | 0 | 1;
  rocketV: -1 | 0 | 1;
  rocketFuel: number;
  rocketPhase: RocketPhase;
  rocketFx: number;
  rocketBoostPulse: number;
  timeSinceLastHit: number;
  stressEstimate: number;
  adrenaline: number;
  laneIdleSeconds: number;
  skillMomentum: number;
}
