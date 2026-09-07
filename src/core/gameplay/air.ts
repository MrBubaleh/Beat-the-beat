export type AirState = 'grounded' | 'airborne' | 'landing' | 'trainRoof' | 'trainExit';

export interface AirConfig {
  flightTimeSeconds: number;
  landingTimeSeconds: number;
  height: number;
}

export interface AirPlayerFields {
  airState: AirState;
  airTime: number;
  spinAngle: number;
  trickCount: number;
}

export interface LandingResult {
  trickCount: number;
}

const SPIN_PER_TRICK = Math.PI * 2;

export function startAir(player: AirPlayerFields): void {
  player.airState = 'airborne';
  player.airTime = 0;
  player.spinAngle = 0;
  player.trickCount = 0;
}

export function airHeight(cfg: AirConfig, airTime: number): number {
  const t = clamp01(airTime / cfg.flightTimeSeconds);
  return 4 * cfg.height * t * (1 - t);
}

export function landingHeight(cfg: AirConfig, airTime: number): number {
  const k = clamp01(airTime / cfg.landingTimeSeconds);
  return cfg.height * 0.12 * (1 - k);
}

export function addTrick(player: AirPlayerFields): void {
  player.trickCount += 1;
  player.spinAngle += SPIN_PER_TRICK;
}

export function updateAir(
  player: AirPlayerFields,
  dt: number,
  cfg: AirConfig,
): LandingResult | null {
  if (
    player.airState === 'grounded' ||
    player.airState === 'trainRoof' ||
    player.airState === 'trainExit'
  ) return null;
  player.airTime += dt;
  if (player.airState === 'airborne' && player.airTime >= cfg.flightTimeSeconds) {
    player.airState = 'landing';
    player.airTime = 0;
    return { trickCount: player.trickCount };
  }
  if (player.airState === 'landing' && player.airTime >= cfg.landingTimeSeconds) {
    player.airState = 'grounded';
    player.airTime = 0;
    player.spinAngle = 0;
    player.trickCount = 0;
  }
  return null;
}

export function trickScoreMultiplier(
  trickCount: number,
  cfg: { trickSeriesStart: number; trickSeriesScoreMultiplier: number },
): number {
  if (trickCount < cfg.trickSeriesStart) return 1;
  return 1 + trickCount * cfg.trickSeriesScoreMultiplier;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
