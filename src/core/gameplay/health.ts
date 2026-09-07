export type DamageState = 'normal' | 'damaged' | 'critical';

export interface HealthFields {
  isHit: boolean;
  damageState: DamageState;
  recoveryTimer: number;
  timeSinceLastHit: number;
}

export interface HealthConfig {
  iframeSeconds: number;
  recoverySeconds: number;
}

export interface HealthRecoveryOpts {
  nitroActive?: boolean;
  nitroClearSeconds?: number;
  damagedStress?: number;
}

export type HitResult = 'gameOver' | 'hit';

export interface HealthTimer {
  timer: number;
}

export function updateHealth(
  state: HealthFields,
  dt: number,
  iframe: HealthTimer,
  cfg: HealthConfig,
  recoveryOpts?: HealthRecoveryOpts,
): void {
  if (state.isHit) {
    iframe.timer -= dt;
    if (iframe.timer <= 0) state.isHit = false;
  }

  state.timeSinceLastHit += dt;
  if (state.isHit) state.timeSinceLastHit = 0;

  if (state.recoveryTimer > 0) {
    let decay = dt;
    if (
      recoveryOpts?.nitroActive &&
      state.damageState !== 'normal'
    ) {
      const clearSeconds = Math.max(recoveryOpts.nitroClearSeconds ?? 1.5, 0.001);
      const woundStress =
        state.damageState === 'critical'
          ? 1
          : recoveryOpts.damagedStress ?? 0.58;
      const targetStepSeconds = clearSeconds / Math.max(woundStress, 0.1);
      const boost = cfg.recoverySeconds / targetStepSeconds;
      decay = dt * boost;
    }
    state.recoveryTimer -= decay;
    if (state.recoveryTimer <= 0) {
      if (state.damageState === 'critical') {
        state.damageState = 'damaged';
        state.recoveryTimer = cfg.recoverySeconds;
      } else if (state.damageState === 'damaged') {
        state.damageState = 'normal';
        state.recoveryTimer = 0;
      }
    }
  }
}

export function registerHit(
  state: HealthFields,
  cfg: HealthConfig,
  iframe: HealthTimer,
): HitResult {
  if (state.damageState === 'critical') return 'gameOver';
  state.isHit = true;
  iframe.timer = cfg.iframeSeconds;
  state.timeSinceLastHit = 0;
  if (state.damageState === 'normal') state.damageState = 'damaged';
  else if (state.damageState === 'damaged') state.damageState = 'critical';
  state.recoveryTimer = cfg.recoverySeconds;
  return 'hit';
}

export function beginHit(state: HealthFields, cfg: HealthConfig, iframe: HealthTimer): void {
  state.isHit = true;
  iframe.timer = cfg.iframeSeconds;
  state.timeSinceLastHit = 0;
}

export function resetHealth(state: HealthFields, iframe: HealthTimer): void {
  state.isHit = false;
  state.damageState = 'normal';
  state.recoveryTimer = 0;
  state.timeSinceLastHit = 0;
  iframe.timer = 0;
}
