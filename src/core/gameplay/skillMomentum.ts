import type { GameConfig } from '@core/config/schemas';
import type { PlayerMode } from '@core/modes/types';
import type { RocketPhase } from '@core/gameplay/rocket';
import type { DamageState } from '@core/gameplay/health';
import { applyNitroBoost } from './nitro';

export interface SkillMomentumPlayerView {
  mode: PlayerMode;
  speed: number;
  timeSinceLastHit: number;
  isAbilityActive: boolean;
  nitroCharge: number;
  horseMomentum: number;
  horseOverdriveRemaining: number;
  rocketPhase: RocketPhase;
  rocketFx: number;
  damageState: DamageState;
}

export interface SkillMomentumUpdateInput {
  veteranUnlocked: boolean;
  rawSpeedBeforeCap: number;
  speedMultiplier: number;
  nitroBoostActive: boolean;
}

export interface SkillMomentumState {
  momentum: number;
  speedEma: number;
  decaying: boolean;
}

export function createSkillMomentumState(): SkillMomentumState {
  return { momentum: 0, speedEma: 0, decaying: false };
}

function damageFactor(state: SkillMomentumPlayerView): number {
  if (state.damageState === 'damaged') return 0.85;
  if (state.damageState === 'critical') return 0.7;
  return 1;
}

function rocketSpeedBoost(
  phase: RocketPhase,
  rocketFx: number,
  cfg: GameConfig['rocket'],
): number {
  if (phase === 'none' || phase === 'anticipation') return 1;
  if (phase === 'fall') return 1 + (cfg.speedBoost - 1) * rocketFx;
  return cfg.speedBoost;
}

export function skillMomentumHardCap(
  mode: PlayerMode,
  cfg: GameConfig,
  momentum: number,
): number {
  const base = mode === 'rocket' ? cfg.rocket.maxSpeed : cfg.speeds.max;
  return base * (1 + momentum * cfg.skillMomentum.maxBonus);
}

export function skillMomentumAchievableCap(
  player: SkillMomentumPlayerView,
  cfg: GameConfig,
  rawSpeedBeforeCap: number,
  speedMultiplier: number,
  nitroBoostActive: boolean,
): number {
  const hardCap = player.mode === 'rocket' ? cfg.rocket.maxSpeed : cfg.speeds.max;
  let mult = Math.max(speedMultiplier, cfg.speeds.speedFloor);
  if (player.mode === 'car' && nitroBoostActive) {
    mult *= applyNitroBoost(player.nitroCharge, cfg.nitro.maxFill, cfg.nitro.boostMax);
  }
  if (player.mode === 'horse') {
    mult *= 1 + player.horseMomentum * cfg.horse.maxSpeedBoost;
    if (player.horseOverdriveRemaining > 0) {
      mult *= 1 + cfg.horse.overdriveSpeedBoost;
    }
  }
  if (player.mode === 'rocket') {
    mult *= rocketSpeedBoost(player.rocketPhase, player.rocketFx, cfg.rocket);
  }
  const estimated = rawSpeedBeforeCap * mult * damageFactor(player);
  return Math.min(hardCap, estimated);
}

export function skillMomentumThresholdSpeed(
  achievableCap: number,
  cfg: GameConfig,
): number {
  return achievableCap * cfg.skillMomentum.speedThresholdRatio;
}

export function updateSkillMomentum(
  state: SkillMomentumState,
  player: SkillMomentumPlayerView,
  cfg: GameConfig,
  dt: number,
  input: SkillMomentumUpdateInput,
): number {
  const tau = Math.max(cfg.skillMomentum.speedEmaSeconds, 0.01);
  const blend = 1 - Math.exp(-dt / tau);
  state.speedEma += (player.speed - state.speedEma) * blend;

  if (!cfg.skillMomentum.enabled || !input.veteranUnlocked) {
    state.momentum = 0;
    state.decaying = false;
    state.speedEma = player.speed;
    return 0;
  }

  if (state.decaying) {
    state.momentum = Math.max(
      0,
      state.momentum - dt / Math.max(cfg.skillMomentum.rampDownSeconds, 0.01),
    );
    if (state.momentum <= 0) state.decaying = false;
  }

  const achievable = skillMomentumAchievableCap(
    player,
    cfg,
    input.rawSpeedBeforeCap,
    input.speedMultiplier,
    input.nitroBoostActive,
  );
  const threshold = skillMomentumThresholdSpeed(achievable, cfg);
  const gateOpen =
    player.timeSinceLastHit >= cfg.skillMomentum.gateNoDamageSeconds &&
    state.speedEma >= threshold - 1e-4;

  if (gateOpen) {
    state.momentum = Math.min(
      1,
      state.momentum + dt / Math.max(cfg.skillMomentum.rampUpSeconds, 0.01),
    );
  }

  return state.momentum;
}

export function onSkillMomentumHit(state: SkillMomentumState): void {
  state.decaying = true;
}
