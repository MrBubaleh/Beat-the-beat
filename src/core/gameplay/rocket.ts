export type RocketPhase = 'none' | 'anticipation' | 'launch' | 'plateau' | 'cruise' | 'fall';

export type RocketPatternKind = 'line' | 'arc' | 'snake' | 'diagonal';

export const ROCKET_PATTERN_ORDER: readonly RocketPatternKind[] = [
  'line',
  'arc',
  'snake',
  'diagonal',
];

export interface RocketCoinSample {
  pattern: RocketPatternKind;
  lane: number;
  time: number;
}

export interface RocketDistanceConfig {
  launchSeconds: number;
  plateauSeconds: number;
  fuelSeconds: number;
  speedBoost: number;
  anticipationSeconds?: number;
  anticipationSpeedScale?: number;
}

export function rocketPlateauStartTime(cfg: {
  anticipationSeconds?: number;
  launchSeconds: number;
}): number {
  return (cfg.anticipationSeconds ?? 0) + cfg.launchSeconds;
}

export function rocketClimbSeconds(cfg: {
  anticipationSeconds: number;
  launchSeconds: number;
}): number {
  return cfg.anticipationSeconds + cfg.launchSeconds * 0.25;
}

export function stepLanePingPong(
  lane: number,
  dir: number,
  laneCount: number,
): { lane: number; dir: number } {
  let nextLane = lane + dir;
  let nextDir = dir;
  if (nextLane >= laneCount) {
    nextLane = laneCount - 2;
    nextDir = -1;
  } else if (nextLane < 0) {
    nextLane = 1;
    nextDir = 1;
  }
  return { lane: nextLane, dir: nextDir };
}

export function buildRocketLaneSequence(
  startLane: number,
  laneCount: number,
  segmentCount: number,
): number[] {
  const lanes = [startLane];
  let lane = startLane;
  let dir = 1;
  for (let i = 1; i < segmentCount; i++) {
    const next = stepLanePingPong(lane, dir, laneCount);
    lane = next.lane;
    dir = next.dir;
    lanes.push(lane);
  }
  return lanes;
}

export function rocketFlightDuration(cfg: RocketDistanceConfig): number {
  return cfg.launchSeconds + cfg.plateauSeconds + cfg.fuelSeconds;
}

export function rocketFallStartTime(
  cfg: RocketDistanceConfig & { anticipationSeconds?: number },
): number {
  return (
    (cfg.anticipationSeconds ?? 0) +
    cfg.launchSeconds +
    cfg.plateauSeconds +
    cfg.fuelSeconds
  );
}

export function rocketCoinEndTime(
  cfg: RocketDistanceConfig & {
    coinEndBufferSeconds: number;
    anticipationSeconds?: number;
  },
): number {
  const fallStart = rocketFallStartTime(cfg);
  const start = rocketCoinStartTime(cfg);
  const buffered = fallStart - cfg.coinEndBufferSeconds;
  return Math.min(fallStart, Math.max(start, buffered));
}

export function rocketCoinStartTime(
  cfg: RocketDistanceConfig & {
    anticipationSeconds?: number;
    coinSpacingSeconds?: number;
  },
): number {
  const climb = rocketClimbSeconds({
    anticipationSeconds: cfg.anticipationSeconds ?? 0,
    launchSeconds: cfg.launchSeconds,
  });
  const spacing = cfg.coinSpacingSeconds ?? 0.07;
  return climb + Math.min(spacing * 0.35, 0.08);
}

export function rocketLaunchFx(progress: number): number {
  return 0.35 + 0.65 * easeOutCubic(progress);
}

export function rocketSpeedMultiplierAtTime(
  time: number,
  cfg: RocketDistanceConfig,
): number {
  if (time <= cfg.launchSeconds) {
    const progress = clamp01(time / cfg.launchSeconds);
    return 1 + (cfg.speedBoost - 1) * rocketLaunchFx(progress);
  }
  return cfg.speedBoost;
}

function rocketLaunchDistance(
  baseSpeed: number,
  cfg: RocketDistanceConfig,
): number {
  const launch = cfg.launchSeconds;
  const steps = 24;
  const dt = launch / steps;
  let dist = 0;
  for (let i = 0; i < steps; i++) {
    const sampleTime = (i + 0.5) * dt;
    dist += baseSpeed * rocketSpeedMultiplierAtTime(sampleTime, cfg) * dt;
  }
  return dist;
}

export function rocketDistanceAtTime(
  time: number,
  baseSpeed: number,
  cfg: RocketDistanceConfig,
): number {
  if (time <= 0) return 0;
  const anticipation = cfg.anticipationSeconds ?? 0;
  const anticipationScale = cfg.anticipationSpeedScale ?? 0.88;
  if (anticipation > 0 && time <= anticipation) {
    return baseSpeed * anticipationScale * time;
  }
  const anticipationDist =
    anticipation > 0 ? baseSpeed * anticipationScale * anticipation : 0;
  const flightTime = time - anticipation;
  if (flightTime <= 0) return anticipationDist;
  const launch = cfg.launchSeconds;
  if (flightTime < launch) {
    const steps = Math.max(1, Math.ceil(24 * (flightTime / launch)));
    const dt = flightTime / steps;
    let dist = 0;
    for (let i = 0; i < steps; i++) {
      const sampleTime = (i + 0.5) * dt;
      dist += baseSpeed * rocketSpeedMultiplierAtTime(sampleTime, cfg) * dt;
    }
    return anticipationDist + dist;
  }
  const launchDist = anticipationDist + rocketLaunchDistance(baseSpeed, cfg);
  return launchDist + baseSpeed * cfg.speedBoost * (flightTime - launch);
}

export function rocketCoinY(
  time: number,
  cfg: { anticipationSeconds: number; launchSeconds: number; peakHeight: number },
  startY = 0,
): number {
  return rocketPlayerYAtTime(time, startY, cfg);
}

export function buildRocketTrajectories(opts: {
  launchSeconds: number;
  plateauSeconds: number;
  fuelSeconds: number;
  anticipationSeconds?: number;
  coinEndBufferSeconds: number;
  coinSpacingSeconds: number;
  coinsPerLaneSegment: number;
  startLane: number;
  laneCount: number;
}): RocketCoinSample[] {
  const {
    launchSeconds,
    plateauSeconds,
    fuelSeconds,
    anticipationSeconds = 0,
    coinEndBufferSeconds,
    coinSpacingSeconds,
    coinsPerLaneSegment,
    startLane,
    laneCount,
  } = opts;
  const maxTime = rocketCoinEndTime({
    launchSeconds,
    plateauSeconds,
    fuelSeconds,
    speedBoost: 1,
    anticipationSeconds,
    coinEndBufferSeconds,
  });
  const fallStart = rocketFallStartTime({
    launchSeconds,
    plateauSeconds,
    fuelSeconds,
    speedBoost: 1,
    anticipationSeconds,
  });
  const samples: RocketCoinSample[] = [];
  let time = rocketCoinStartTime({
    launchSeconds,
    plateauSeconds,
    fuelSeconds,
    speedBoost: 1,
    anticipationSeconds,
    coinSpacingSeconds,
  });
  let lane = startLane;
  let dir = 1;
  let coinsOnLane = 0;
  let patternIndex = 0;

  while (time <= maxTime && time < fallStart) {
    samples.push({
      pattern: ROCKET_PATTERN_ORDER[patternIndex % ROCKET_PATTERN_ORDER.length],
      lane,
      time,
    });
    patternIndex += 1;
    coinsOnLane += 1;
    if (coinsOnLane >= coinsPerLaneSegment) {
      coinsOnLane = 0;
      const next = stepLanePingPong(lane, dir, laneCount);
      lane = next.lane;
      dir = next.dir;
    }
    time += coinSpacingSeconds;
  }

  return samples;
}

export function rocketCoinX(lane: number, positions: readonly number[]): number {
  return positions[lane];
}

export function countObstaclesAhead(
  obstacles: readonly { broken?: boolean; z: number; trainId?: number }[],
  leadZ: number,
): number {
  let count = 0;
  for (const obstacle of obstacles) {
    if (obstacle.broken || obstacle.trainId !== undefined) continue;
    if (obstacle.z < 0 || obstacle.z > leadZ) continue;
    count += 1;
  }
  return count;
}

export function easeOutBack(t: number, overshoot = 1.70158): number {
  const x = clamp01(t);
  const c1 = overshoot + 1;
  return 1 + c1 * (x - 1) ** 3 + overshoot * (x - 1) ** 2;
}

export function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

export function easeInQuart(t: number): number {
  const x = clamp01(t);
  return x * x * x * x;
}

export function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function rocketFallDurationSeconds(cfg: {
  peakHeight: number;
  fallGravity: number;
}): number {
  return Math.sqrt((2 * Math.max(0, cfg.peakHeight)) / Math.max(cfg.fallGravity, 0.001));
}

export function rocketTurboFadeOutMs(cfg: {
  peakHeight: number;
  fallGravity: number;
  padAfterLandingSeconds: number;
}): number {
  return Math.round((rocketFallDurationSeconds(cfg) + cfg.padAfterLandingSeconds) * 1000);
}

export function rocketPlayerYAtTime(
  time: number,
  startY: number,
  cfg: { anticipationSeconds: number; launchSeconds: number; peakHeight: number },
): number {
  const climbSeconds = rocketClimbSeconds(cfg);
  if (time <= 0) return startY;
  if (time >= climbSeconds) return cfg.peakHeight;
  return startY + (cfg.peakHeight - startY) * easeInOutCubic(time / climbSeconds);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
