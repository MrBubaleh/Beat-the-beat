import { easeInOutCubic } from './rocket';

export interface LevelIntroConfig {
  countdownSeconds: number;
  moveDelaySeconds: number;
  musicDelaySeconds: number;
  obstacleMinSeconds: number;
  obstacleMaxSeconds: number;
}

export const DEFAULT_LEVEL_INTRO: LevelIntroConfig = {
  countdownSeconds: 3,
  moveDelaySeconds: 0.5,
  musicDelaySeconds: 1.5,
  obstacleMinSeconds: 2,
  obstacleMaxSeconds: 4,
};

export function levelIntroTargetSpeed(
  base: number,
  rampPerSecond: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): number {
  return base + rampPerSecond * cfg.countdownSeconds;
}

export function levelIntroMoveDuration(cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO): number {
  return Math.max(0.001, cfg.countdownSeconds - cfg.moveDelaySeconds);
}

export function levelIntroSpeedAt(
  elapsed: number,
  targetSpeed: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): number {
  if (elapsed < cfg.moveDelaySeconds) return 0;
  const t = Math.min(
    1,
    (elapsed - cfg.moveDelaySeconds) / levelIntroMoveDuration(cfg),
  );
  return targetSpeed * t;
}

export function levelIntroDistanceAt(
  elapsed: number,
  targetSpeed: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): number {
  if (elapsed < cfg.moveDelaySeconds) return 0;
  const moveDuration = levelIntroMoveDuration(cfg);
  const t = Math.min(1, (elapsed - cfg.moveDelaySeconds) / moveDuration);
  return targetSpeed * moveDuration * t * t * 0.5;
}

export function levelIntroDistanceAtGo(
  targetSpeed: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): number {
  return levelIntroDistanceAt(cfg.countdownSeconds, targetSpeed, cfg);
}

export function levelIntroCameraBlend(
  elapsed: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): number {
  const t = Math.min(1, Math.max(0, elapsed / Math.max(cfg.countdownSeconds, 0.001)));
  return easeInOutCubic(t);
}

export function levelIntroEncounterSeconds(
  seed: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): number {
  const span = cfg.obstacleMaxSeconds - cfg.obstacleMinSeconds;
  const unit = ((seed >>> 0) % 1000) / 1000;
  return cfg.obstacleMinSeconds + span * unit;
}

export function levelIntroObstacleZ(
  targetSpeed: number,
  encounterSeconds: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): number {
  return levelIntroDistanceAtGo(targetSpeed, cfg) + targetSpeed * encounterSeconds;
}

export function levelIntroCountdownLabel(
  elapsed: number,
  cfg: LevelIntroConfig = DEFAULT_LEVEL_INTRO,
): string | null {
  if (elapsed < 1) return '3';
  if (elapsed < 2) return '2';
  if (elapsed < cfg.countdownSeconds) return '1';
  return 'GO!';
}
