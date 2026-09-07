import type { GameConfig } from '@core/config/schemas';
import type { ObstacleEntity } from '@core/levelgen/types';
import type { PlayerMode } from '@core/modes/types';

export type CameraPresentationConfig = GameConfig['camera'];

export type DodgeFxEvent = {
  x: number;
  y: number;
  z: number;
  threatSide: -1 | 1;
};

export type TurnMomentumState = {
  lastLane: number | null;
  lastSign: number;
  lastTurnAge: number;
  comboCount: number;
  momentum: number;
};

export type DodgeImpulse = {
  threatSide: -1 | 1;
  age: number;
};

export type DodgePresentationState = {
  impulses: DodgeImpulse[];
};

export type PresentationOffset = {
  x: number;
  y: number;
  z: number;
};

export type PresentationScale = {
  effect: number;
  pullback: number;
};

const MOMENTUM_PER_EXTRA_TURN = 0.55;
const MOMENTUM_EPSILON = 0.001;

export function createTurnMomentumState(): TurnMomentumState {
  return {
    lastLane: null,
    lastSign: 0,
    lastTurnAge: 0,
    comboCount: 0,
    momentum: 0,
  };
}

export function resetTurnMomentum(state: TurnMomentumState): void {
  state.lastLane = null;
  state.lastSign = 0;
  state.lastTurnAge = 0;
  state.comboCount = 0;
  state.momentum = 0;
}

export function createDodgePresentationState(): DodgePresentationState {
  return { impulses: [] };
}

export function resetDodgePresentation(state: DodgePresentationState): void {
  state.impulses.length = 0;
}

export function isDodgeTrackableObstacle(obstacle: ObstacleEntity): boolean {
  return !obstacle.broken && obstacle.kind !== 'micro' && obstacle.trainId === undefined;
}

export function updateDodgeLaneEscape(
  player: { lane: number },
  obstacles: readonly ObstacleEntity[],
  opts: {
    sharedLaneIds: Set<number>;
    escapedIds: Set<number>;
    hitIds: Set<number>;
    nearMissZ: number;
  },
): void {
  for (const obstacle of obstacles) {
    if (!isDodgeTrackableObstacle(obstacle)) continue;
    if (opts.hitIds.has(obstacle.id)) continue;
    if (opts.escapedIds.has(obstacle.id)) continue;
    if (player.lane === obstacle.lane && obstacle.z > opts.nearMissZ) {
      opts.sharedLaneIds.add(obstacle.id);
    }
    if (opts.sharedLaneIds.has(obstacle.id) && player.lane !== obstacle.lane) {
      opts.escapedIds.add(obstacle.id);
    }
  }
}

export function collectDodgeEvents(
  player: { lane: number; laneX: number; speed: number },
  obstacles: readonly ObstacleEntity[],
  opts: {
    tracked: Set<number>;
    hitIds: Set<number>;
    escapedIds: Set<number>;
    nearMissZ: number;
    minSpeed: number;
  },
): DodgeFxEvent[] {
  const events: DodgeFxEvent[] = [];
  if (player.speed < opts.minSpeed) return events;
  for (const obstacle of obstacles) {
    if (opts.tracked.has(obstacle.id)) continue;
    if (!isDodgeTrackableObstacle(obstacle)) continue;
    if (!opts.escapedIds.has(obstacle.id)) continue;
    const laneDelta = obstacle.lane - player.lane;
    if (laneDelta === 0) continue;
    if (obstacle.z > opts.nearMissZ) continue;
    if (opts.hitIds.has(obstacle.id)) continue;
    opts.tracked.add(obstacle.id);
    events.push({
      x: player.laneX,
      y: 0.75,
      z: obstacle.z,
      threatSide: laneDelta > 0 ? 1 : -1,
    });
  }
  return events;
}

export function updateTurnMomentum(
  state: TurnMomentumState,
  lane: number,
  dt: number,
  cfg: CameraPresentationConfig,
): number {
  if (state.lastLane === null) {
    state.lastLane = lane;
    return state.momentum;
  }
  const delta = lane - state.lastLane;
  if (delta !== 0) {
    const sign = delta > 0 ? 1 : -1;
    const chained =
      sign === state.lastSign &&
      state.lastTurnAge <= cfg.turnComboWindowSeconds &&
      state.comboCount > 0;
    if (chained) {
      state.comboCount += 1;
      state.momentum = Math.min(
        1,
        (state.comboCount - 1) * MOMENTUM_PER_EXTRA_TURN,
      );
    } else {
      state.comboCount = 1;
    }
    state.lastSign = sign;
    state.lastTurnAge = 0;
    state.lastLane = lane;
  } else {
    state.lastTurnAge += dt;
  }
  const holding =
    state.comboCount >= 2 && state.lastTurnAge <= cfg.turnComboWindowSeconds;
  if (!holding) {
    const tau = Math.max(1e-6, cfg.turnMomentumDecaySeconds / 3);
    state.momentum *= Math.exp(-dt / tau);
    if (state.momentum < MOMENTUM_EPSILON) state.momentum = 0;
    if (state.lastTurnAge > cfg.turnComboWindowSeconds) state.comboCount = 0;
  }
  return state.momentum;
}

export function pushDodgeImpulses(
  state: DodgePresentationState,
  events: readonly DodgeFxEvent[],
): void {
  for (const event of events) {
    state.impulses.push({ threatSide: event.threatSide, age: 0 });
  }
}

export function sampleDodgeOffset(
  state: DodgePresentationState,
  dt: number,
  cfg: CameraPresentationConfig,
  effectScale: number,
): PresentationOffset {
  const duration = cfg.dodgeInSeconds + cfg.dodgeHoldSeconds + cfg.dodgeOutSeconds;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = state.impulses.length - 1; i >= 0; i--) {
    const impulse = state.impulses[i];
    impulse.age += dt;
    if (impulse.age >= duration) {
      state.impulses.splice(i, 1);
      continue;
    }
    const envelope = dodgeEnvelope(
      impulse.age,
      cfg.dodgeInSeconds,
      cfg.dodgeHoldSeconds,
      cfg.dodgeOutSeconds,
    );
    x += -impulse.threatSide * cfg.dodgeLateralX * effectScale * envelope;
    y += -cfg.dodgeDipY * effectScale * envelope;
    z += cfg.dodgePullbackZ * effectScale * envelope;
  }
  return { x, y, z };
}

export function resolvePresentationScale(
  mode: PlayerMode,
  fpsBlend: number,
  cfg: CameraPresentationConfig,
): PresentationScale {
  if (mode !== 'horse') {
    return { effect: 1, pullback: 1 };
  }
  const t = clamp01(fpsBlend);
  return {
    effect: lerp(cfg.horsePresentationScale, cfg.horseFpsPresentationScale, t),
    pullback: lerp(cfg.horsePresentationScale, cfg.horseFpsPullbackScale, t),
  };
}

export function turnJellyScale(
  momentum: number,
  effectScale: number,
  cfg: CameraPresentationConfig,
): number {
  return lerp(1, cfg.turnJellyScaleMax, clamp01(momentum) * effectScale);
}

export function turnBankScale(
  momentum: number,
  effectScale: number,
  cfg: CameraPresentationConfig,
): number {
  return lerp(1, cfg.turnBankScaleMax, clamp01(momentum) * effectScale);
}

export function turnPullbackZ(
  momentum: number,
  pullbackScale: number,
  cfg: CameraPresentationConfig,
): number {
  return clamp01(momentum) * cfg.turnPullbackZMax * pullbackScale;
}

export function clampPresentationOffset(
  offset: PresentationOffset,
  cfg: CameraPresentationConfig,
): PresentationOffset {
  return {
    x: clampAbs(offset.x, cfg.presentationClampX),
    y: clampAbs(offset.y, cfg.presentationClampY),
    z: clampAbs(offset.z, cfg.presentationClampZ),
  };
}

function dodgeEnvelope(
  age: number,
  inSeconds: number,
  holdSeconds: number,
  outSeconds: number,
): number {
  if (age <= 0) return 0;
  if (age < inSeconds) {
    return inSeconds <= 0 ? 1 : easeOutCubic(age / inSeconds);
  }
  if (age < inSeconds + holdSeconds) return 1;
  if (outSeconds <= 0) return 0;
  return 1 - easeOutCubic((age - inSeconds - holdSeconds) / outSeconds);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampAbs(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(max, Math.max(-max, value));
}

function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}
