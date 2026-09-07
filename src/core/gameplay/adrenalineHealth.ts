import type { AdrenalineConfig } from '@core/config/schemas';
import type { DamageState } from './health';
import type { HealthFields, HealthTimer } from './health';
import type { PlayerMode } from '@core/modes/types';

export interface AdrenalineFields {
  adrenaline: number;
  laneIdleSeconds: number;
}

export function adrenalineCoinGainMultiplier(
  mode: PlayerMode,
  cfg: AdrenalineConfig,
  opts?: { airborneCar?: boolean; adrenalinePercent?: number },
): number {
  let mult: number;
  if (mode === 'car' && opts?.airborneCar) {
    mult = cfg.gainCoinRocketMultiplier;
  } else {
    switch (mode) {
      case 'rocket':
        mult = cfg.gainCoinRocketMultiplier;
        break;
      case 'horse':
        mult = cfg.gainCoinHorseMultiplier;
        break;
      case 'car':
      default:
        mult = cfg.gainCoinCarMultiplier;
        break;
    }
  }
  if (
    mode === 'rocket' &&
    opts?.adrenalinePercent !== undefined &&
    opts.adrenalinePercent < cfg.criticalThresholdPercent
  ) {
    mult *= 1.22;
  }
  return mult;
}

export function syncDamageStateFromAdrenaline(
  adrenaline: number,
  cfg: AdrenalineConfig,
): DamageState {
  const percent = (adrenaline / Math.max(cfg.max, 1e-6)) * 100;
  if (percent >= cfg.damagedThresholdPercent) return 'normal';
  if (percent >= cfg.criticalThresholdPercent) return 'damaged';
  return 'critical';
}

export function resetAdrenaline(
  state: AdrenalineFields & HealthFields,
  iframe: HealthTimer,
  cfg: AdrenalineConfig,
): void {
  state.adrenaline = cfg.start;
  state.laneIdleSeconds = 0;
  state.isHit = false;
  state.damageState = 'normal';
  state.recoveryTimer = 0;
  state.timeSinceLastHit = 0;
  iframe.timer = 0;
}

export function updateAdrenaline(
  state: AdrenalineFields & HealthFields,
  dt: number,
  iframe: HealthTimer,
  cfg: AdrenalineConfig,
  opts: {
    rocketMode: boolean;
    laneChanged: boolean;
    runSeconds: number;
    nitroActive?: boolean;
    nitroClearSeconds?: number;
    damagedStress?: number;
  },
): void {
  const drainPaused = iframe.timer > 0;
  if (state.isHit) {
    iframe.timer -= dt;
    if (iframe.timer <= 0) state.isHit = false;
  }
  state.timeSinceLastHit += dt;
  if (state.isHit) state.timeSinceLastHit = 0;

  if (opts.laneChanged) {
    state.laneIdleSeconds = 0;
  } else {
    state.laneIdleSeconds += dt;
  }

  if (!drainPaused) {
    let drain = cfg.passiveDrainPerSecond;
    if (cfg.drainRampSeconds > 0) {
      const rampT = Math.min(1, Math.max(0, opts.runSeconds / cfg.drainRampSeconds));
      drain *= cfg.drainStartScale + (1 - cfg.drainStartScale) * rampT;
    }
    if (state.laneIdleSeconds >= cfg.idleLaneSeconds) {
      drain *= cfg.idleLaneDrainBonus;
    }
    if (opts.rocketMode) {
      drain *= cfg.rocketDrainMultiplier;
    }
    state.adrenaline = Math.max(0, state.adrenaline - drain * dt);
  }

  state.damageState = syncDamageStateFromAdrenaline(state.adrenaline, cfg);

  if (
    opts.nitroActive &&
    state.damageState !== 'normal' &&
    iframe.timer <= 0
  ) {
    const clearSeconds = Math.max(opts.nitroClearSeconds ?? 1.5, 0.001);
    const woundStress =
      state.damageState === 'critical'
        ? 1
        : opts.damagedStress ?? 0.58;
    const target =
      state.damageState === 'critical'
        ? cfg.max * (cfg.criticalThresholdPercent / 100)
        : cfg.max * (cfg.damagedThresholdPercent / 100);
    const gap = target - state.adrenaline;
    if (gap > 0) {
      const regen = (gap / clearSeconds) * woundStress * dt;
      state.adrenaline = Math.min(cfg.max, state.adrenaline + regen);
      state.damageState = syncDamageStateFromAdrenaline(state.adrenaline, cfg);
    }
  }
}

export function gainAdrenaline(
  state: AdrenalineFields & HealthFields,
  amount: number,
  cfg: AdrenalineConfig,
): void {
  if (amount <= 0) return;
  state.adrenaline = Math.min(cfg.max, state.adrenaline + amount);
  state.damageState = syncDamageStateFromAdrenaline(state.adrenaline, cfg);
}

export function applyAdrenalineCollision(
  state: AdrenalineFields & HealthFields,
  cfg: AdrenalineConfig,
  iframe: HealthTimer,
  hitCfg: { iframeSeconds: number },
): 'gameOver' | 'hit' {
  let damageRatio = cfg.collisionDamage / 100;
  if (state.adrenaline <= cfg.collisionLowHpThreshold) {
    damageRatio *= cfg.collisionLowHpMultiplier;
  }
  const damage = state.adrenaline * damageRatio;
  state.adrenaline = Math.max(0, state.adrenaline - damage);
  state.damageState = syncDamageStateFromAdrenaline(state.adrenaline, cfg);
  state.isHit = true;
  iframe.timer = hitCfg.iframeSeconds;
  state.timeSinceLastHit = 0;
  if (state.adrenaline <= 0) {
    state.adrenaline = 0;
    state.damageState = 'critical';
    return 'gameOver';
  }
  return 'hit';
}
