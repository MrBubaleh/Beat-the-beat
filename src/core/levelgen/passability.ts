import type { LevelgenConfig } from '@core/config/schemas';
import { carTrafficScrollSpeed } from './trafficMotion';
import { startLane } from './startLane';
import type { ObstacleEntity, RampEntity } from './types';

export interface PassabilityResult {
  passable: boolean;
  reason: 'ok' | 'dead-end' | 'tall-block' | 'wall-gap';
}

export interface PassabilityOptions {
  asCar?: boolean;
  laneFlow?: readonly number[];
  flowFactor?: number;
  counterflowLingerSeconds?: number;
}

export interface ComfortableCarRouteOptions {
  playerDistance?: number;
  playerSpeed?: number;
  startLanes?: readonly number[];
  laneSwitchSeconds?: number;
  minDecisionSeconds?: number;
  obstaclePaddingSeconds?: number;
}

export interface CarRoutePoint {
  time: number;
  z: number;
  lane: number;
}

export interface HorseRoutePoint {
  z: number;
  lane: number;
}

export interface ComfortableHorseRouteResult extends PassabilityResult {
  route: HorseRoutePoint[];
}

export interface ComfortableCarRouteResult extends PassabilityResult {
  route: CarRoutePoint[];
  failureTime?: number;
  minDecisionSlackSeconds: number;
}

export function occupiedRowsForObstacle(
  obstacle: ObstacleEntity,
  minGapZ: number,
): number[] {
  const home = Math.round(obstacle.z / minGapZ);
  const rows = new Set<number>([home]);
  if (obstacle.zExtent === undefined || obstacle.zExtent <= 0) {
    return [...rows];
  }
  const half = obstacle.zExtent / 2;
  const minRow = Math.floor((obstacle.z - half) / minGapZ);
  const maxRow = Math.ceil((obstacle.z + half) / minGapZ);
  for (let row = minRow; row <= maxRow; row++) {
    if (Math.abs(obstacle.z - row * minGapZ) <= half) {
      rows.add(row);
    }
  }
  return [...rows];
}

export function occupiedRowsWithCounterflowLinger(
  obstacle: ObstacleEntity,
  minGapZ: number,
  laneFlow: readonly number[],
  flowFactor: number,
  lingerSeconds: number,
): number[] {
  const base = occupiedRowsForObstacle(obstacle, minGapZ);
  if (lingerSeconds <= 0) return base;
  const flow = laneFlow[obstacle.lane] ?? 0;
  if (flow >= 0) return base;
  const lingerRows = Math.ceil(
    Math.abs(flow) * flowFactor * lingerSeconds / minGapZ,
  );
  if (lingerRows <= 0) return base;
  const expanded = new Set<number>();
  for (const row of base) {
    for (let delta = 0; delta <= lingerRows; delta++) {
      expanded.add(row - delta);
    }
  }
  return [...expanded];
}

export function obstacleFrontZ(obstacle: ObstacleEntity): number {
  return obstacle.z - Math.max(0, obstacle.zExtent ?? 0) / 2;
}

export function obstacleRearZ(obstacle: ObstacleEntity): number {
  return obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2;
}

function isLaneBlockingHazard(obstacle: ObstacleEntity): boolean {
  return (
    obstacle.kind !== 'micro' &&
    obstacle.kind !== 'overhead'
  );
}

export function laneBlockingLeadClear(
  obstacles: readonly ObstacleEntity[],
  lane: number,
  fromZ: number,
  minLeadZ: number,
  ignored: ReadonlySet<ObstacleEntity> = new Set(),
): boolean {
  for (const obstacle of obstacles) {
    if (ignored.has(obstacle) || obstacle.lane !== lane) continue;
    if (!isLaneBlockingHazard(obstacle) || obstacle.redWall) continue;
    if (obstacleRearZ(obstacle) < fromZ) continue;
    if (obstacleFrontZ(obstacle) - fromZ < minLeadZ) return false;
  }
  return true;
}

export function linkedRampForRedWall(
  wall: readonly ObstacleEntity[],
  ramps: readonly RampEntity[],
  config: LevelgenConfig,
): RampEntity | null {
  if (wall.length === 0) return null;
  const wallZ = Math.min(...wall.map((obstacle) => obstacle.z));
  const gateId = wall.find((obstacle) => obstacle.gateId !== undefined)?.gateId;
  const linked = ramps
    .filter((ramp) =>
      gateId === undefined
        ? ramp.z < wallZ && wallZ - ramp.z <= config.rampLeadRows * config.minGapZ
        : ramp.gateId === gateId,
    )
    .sort((a, b) => b.z - a.z)[0];
  return linked ?? null;
}

export function isReadableMicroPlacement(
  obstacles: readonly ObstacleEntity[],
  ramps: readonly RampEntity[],
  config: LevelgenConfig,
  lane: number,
  fromZ: number,
  ignored: ReadonlySet<ObstacleEntity> = new Set(),
): boolean {
  const minLeadZ = config.minGapZ * config.fairness.microLeadMinGapZScale;
  if (!laneBlockingLeadClear(obstacles, lane, fromZ, minLeadZ, ignored)) {
    return false;
  }
  const wallLookahead = (config.rampLeadRows * 2 + 1) * config.minGapZ;
  const wallsByKey = new Map<string, ObstacleEntity[]>();
  for (const obstacle of obstacles) {
    if (!obstacle.redWall || ignored.has(obstacle)) continue;
    if (obstacle.z <= fromZ || obstacle.z - fromZ > wallLookahead) continue;
    const key = obstacle.gateId === undefined
      ? `row:${Math.round(obstacle.z / config.minGapZ)}`
      : `gate:${obstacle.gateId}`;
    const group = wallsByKey.get(key) ?? [];
    group.push(obstacle);
    wallsByKey.set(key, group);
  }
  for (const wall of wallsByKey.values()) {
    const wallZ = Math.min(...wall.map((obstacle) => obstacle.z));
    const ramp = linkedRampForRedWall(wall, ramps, config);
    if (!ramp) return false;
    if (fromZ > ramp.z && fromZ < wallZ) return false;
    const wallLanes = new Set(wall.map((obstacle) => obstacle.lane));
    if (!wallLanes.has(lane)) continue;
    const wallFront = Math.min(...wall.map((obstacle) => obstacleFrontZ(obstacle)));
    if (wallFront - fromZ < minLeadZ) return false;
    if (Math.abs(lane - ramp.lane) > 1) return false;
  }
  return true;
}

export function isPassable(
  obstacles: ObstacleEntity[],
  config: LevelgenConfig,
  ramps: RampEntity[] = [],
  options: PassabilityOptions = {},
): PassabilityResult {
  const laneFlow = options.laneFlow ?? config.laneFlow;
  const flowFactor = options.flowFactor ?? config.multiLaneFlowFactor;
  const lingerSeconds = options.counterflowLingerSeconds;
  const useCounterflowLinger =
    lingerSeconds !== undefined &&
    lingerSeconds > 0 &&
    laneFlow.length > 0;
  const byRow = new Map<number, ObstacleEntity[]>();
  for (const obstacle of obstacles) {
    if (obstacle.kind === 'micro' || obstacle.shoulderPasser) continue;
    const rows = useCounterflowLinger
        ? occupiedRowsWithCounterflowLinger(
            obstacle,
            config.minGapZ,
            laneFlow,
            flowFactor,
            lingerSeconds,
          )
        : occupiedRowsForObstacle(obstacle, config.minGapZ);
    for (const row of rows) {
      const list = byRow.get(row) ?? [];
      list.push(obstacle);
      byRow.set(row, list);
    }
  }
  const rampsByRow = new Map<number, RampEntity[]>();
  for (const ramp of ramps) {
    const row = Math.round(ramp.z / config.minGapZ);
    const list = rampsByRow.get(row) ?? [];
    list.push(ramp);
    rampsByRow.set(row, list);
  }

  const occupiedRows = [...byRow.keys(), ...rampsByRow.keys()];
  if (occupiedRows.length === 0) return { passable: true, reason: 'ok' };
  const minRow = Math.min(0, ...occupiedRows);
  const maxRow = Math.max(...occupiedRows);
  const sortedRows = Array.from({ length: maxRow - minRow + 1 }, (_, i) => minRow + i);
  let reachable = options.asCar
    ? new Set(Array.from({ length: config.lanes }, (_, i) => i))
    : new Set<number>([startLane(config)]);
  let lastWallRow: number | null = null;
  let airborne = 0;

  for (const row of sortedRows) {
    const list = byRow.get(row) ?? [];
    const blocking = list.filter((obstacle) => obstacle.kind !== 'micro');
    const occupiedLanes = new Set(blocking.map((obstacle) => obstacle.lane));
    const isFullRow = occupiedLanes.size >= config.lanes;
    const isRedWall = isFullRow && blocking.every((o) => o.kind === 'tall' && o.redWall);
    const isHorseAction =
      !options.asCar &&
      isFullRow &&
      blocking.every((obstacle) => obstacle.horseAction !== undefined);

    if (isHorseAction) {
      reachable = new Set(Array.from({ length: config.lanes }, (_, i) => i));
      continue;
    }

    if (isRedWall) {
      if (lastWallRow !== null && row - lastWallRow < config.minWallGapRows) {
        return { passable: false, reason: 'wall-gap' };
      }
      lastWallRow = row;
      const gateIds = new Set(
        blocking
          .map((o) => o.gateId)
          .filter((id): id is number => id !== undefined),
      );
      const rampRows = Array.from({ length: config.rampLeadRows }, (_, i) => row - 1 - i);
      const hasRamp = rampRows.some((r) =>
        (rampsByRow.get(r) ?? []).some(
          (ramp) =>
            gateIds.size === 0 ||
            (ramp.gateId !== undefined && gateIds.has(ramp.gateId)),
        ),
      );
      if (!hasRamp) {
        return { passable: false, reason: 'tall-block' };
      }
      if (airborne <= 0) {
        return { passable: false, reason: 'tall-block' };
      }
      airborne -= 1;
      reachable = new Set(Array.from({ length: config.lanes }, (_, i) => i));
      continue;
    }

    if (airborne > 0) {
      airborne -= 1;
      reachable = new Set(Array.from({ length: config.lanes }, (_, i) => i));
      continue;
    }

    if (isFullRow && !blocking.every((o) => o.kind === 'low')) {
      return { passable: false, reason: 'tall-block' };
    }
    if (isFullRow && !blocking.every((o) => o.nitroChallenge)) {
      return { passable: false, reason: 'dead-end' };
    }
    if (isFullRow) {
      if (lastWallRow !== null && row - lastWallRow < config.minWallGapRows) {
        return { passable: false, reason: 'wall-gap' };
      }
      lastWallRow = row;
    }

    const blocked = isFullRow
      ? new Set<number>()
      : new Set(blocking.map((o) => o.lane));
    const next = new Set<number>();
    for (let lane = 0; lane < config.lanes; lane++) {
      if (blocked.has(lane)) continue;
      for (const entry of reachable) {
        if (Math.abs(lane - entry) <= 1) {
          next.add(lane);
          break;
        }
      }
    }
    if (next.size === 0) {
      return { passable: false, reason: 'dead-end' };
    }
    reachable = next;

    if ((rampsByRow.get(row) ?? []).some((r) => reachable.has(r.lane))) {
      airborne = config.rampLeadRows;
    }
  }

  return { passable: true, reason: 'ok' };
}

export function isPassableAsCar(
  obstacles: ObstacleEntity[],
  config: LevelgenConfig,
  ramps: RampEntity[] = [],
): PassabilityResult {
  return isPassable(obstacles, config, ramps, { asCar: true });
}

export function findComfortableHorseRoute(
  obstacles: ObstacleEntity[],
  config: LevelgenConfig,
  chunkStartZ: number,
  entryLane: number,
): ComfortableHorseRouteResult {
  const byZ = new Map<number, ObstacleEntity[]>();
  for (const obstacle of obstacles) {
    if (obstacle.kind === 'micro' || obstacle.shoulderPasser) continue;
    const zKey = Math.round(obstacle.z * 1000);
    const list = byZ.get(zKey) ?? [];
    list.push(obstacle);
    byZ.set(zKey, list);
  }

  interface HorseRouteNode {
    lane: number;
    changes: number;
    parent: HorseRouteNode | null;
    z: number;
  }

  let states = new Map<number, HorseRouteNode>();
  const safeEntryLane = Math.min(config.lanes - 1, Math.max(0, entryLane));
  states.set(safeEntryLane, {
    lane: safeEntryLane,
    changes: 0,
    parent: null,
    z: chunkStartZ,
  });
  for (const [zKey, rowObstacles] of [...byZ.entries()].sort((a, b) => a[0] - b[0])) {
    const occupiedLanes = new Set(rowObstacles.map((obstacle) => obstacle.lane));
    const mandatoryHorseAction =
      occupiedLanes.size >= config.lanes &&
      rowObstacles.every((obstacle) => obstacle.horseAction !== undefined);
    const blocked = mandatoryHorseAction ? new Set<number>() : occupiedLanes;
    const next = new Map<number, HorseRouteNode>();
    for (const previous of states.values()) {
      for (let lane = 0; lane < config.lanes; lane++) {
        if (blocked.has(lane)) continue;
        const candidate: HorseRouteNode = {
          lane,
          changes: previous.changes + Math.abs(lane - previous.lane),
          parent: previous,
          z: zKey / 1000,
        };
        const current = next.get(lane);
        if (!current || candidate.changes < current.changes) next.set(lane, candidate);
      }
    }
    if (next.size === 0) {
      return { passable: false, reason: 'dead-end', route: [] };
    }
    states = next;
  }

  const best = [...states.values()].sort((a, b) => {
    if (a.changes !== b.changes) return a.changes - b.changes;
    return Math.abs(a.lane - safeEntryLane) - Math.abs(b.lane - safeEntryLane);
  })[0];
  if (!best) return { passable: false, reason: 'dead-end', route: [] };

  const route: HorseRoutePoint[] = [];
  let cursor: HorseRouteNode | null = best;
  while (cursor) {
    route.push({ z: cursor.z, lane: cursor.lane });
    cursor = cursor.parent;
  }
  route.reverse();
  return { passable: true, reason: 'ok', route };
}

export function horseRouteLaneAtZ(
  route: readonly HorseRoutePoint[],
  z: number,
): number | null {
  if (route.length === 0) return null;
  return route.find((point) => point.z + 1e-6 >= z)?.lane ?? route.at(-1)!.lane;
}

interface TemporalRouteEvent {
  row: number;
  time: number;
  z: number;
  blocked: Set<number>;
  requiredLanes: Set<number>;
}

interface TemporalRouteNode {
  lane: number;
  eventTime: number;
  lastChangeTime: number;
  changes: number;
  minSlack: number;
  event: TemporalRouteEvent | null;
  parent: TemporalRouteNode | null;
}

/**
 * Finds a damage-free car route on the same time axis used by GameSim.
 * Unlike the legacy row check, lane flow changes encounter time, full nitro
 * rows preserve the incoming lane, and consecutive forced turns need a human
 * reaction margin in addition to the raw lane-switch duration.
 */
export function findComfortableCarRoute(
  obstacles: ObstacleEntity[],
  config: LevelgenConfig,
  ramps: RampEntity[] = [],
  options: ComfortableCarRouteOptions = {},
): ComfortableCarRouteResult {
  const structural = isPassable(obstacles, config, ramps, { asCar: true });
  if (!structural.passable && structural.reason !== 'dead-end') {
    return {
      ...structural,
      route: [],
      minDecisionSlackSeconds: 0,
    };
  }

  const fairness = config.fairness;
  const playerDistance = options.playerDistance ?? 0;
  const playerSpeed = Math.max(
    options.playerSpeed ?? fairness.referenceSpeed,
    1,
  );
  const laneSwitchSeconds =
    options.laneSwitchSeconds ?? fairness.laneSwitchSeconds;
  const minDecisionSeconds =
    options.minDecisionSeconds ?? fairness.minDecisionSeconds;
  const obstaclePaddingSeconds =
    options.obstaclePaddingSeconds ?? fairness.obstaclePaddingSeconds;
  const timeStep = config.minGapZ / playerSpeed;
  const events = new Map<number, TemporalRouteEvent>();

  const ensureEvent = (row: number, z: number): TemporalRouteEvent => {
    const safeRow = Math.max(0, row);
    let event = events.get(safeRow);
    if (!event) {
      event = {
        row: safeRow,
        time: safeRow * timeStep,
        z,
        blocked: new Set<number>(),
        requiredLanes: new Set<number>(),
      };
      events.set(safeRow, event);
    } else {
      event.z = Math.min(event.z, z);
    }
    return event;
  };

  const fullNitroChallenges = new Set<number>();
  const nitroGroups = new Map<number, ObstacleEntity[]>();
  for (const obstacle of obstacles) {
    if (!obstacle.nitroChallenge || obstacle.challengeId === undefined) continue;
    const group = nitroGroups.get(obstacle.challengeId) ?? [];
    group.push(obstacle);
    nitroGroups.set(obstacle.challengeId, group);
  }
  for (const [challengeId, group] of nitroGroups) {
    const lanes = new Set(group.map((obstacle) => obstacle.lane));
    if (
      lanes.size >= config.lanes &&
      group.every((obstacle) => obstacle.kind === 'low')
    ) {
      // GameSim removes/panic-flees the obstacle in the current lane if nitro
      // ends before arrival. The safe contract is therefore "stay in lane",
      // not the legacy assumption that the row can teleport the route anywhere.
      fullNitroChallenges.add(challengeId);
    }
  }

  const redWallGroups = new Map<string, ObstacleEntity[]>();
  for (const obstacle of obstacles) {
    if (!obstacle.redWall) continue;
    const key = obstacle.gateId === undefined
      ? `row:${Math.round(obstacle.z / config.minGapZ)}`
      : `gate:${obstacle.gateId}`;
    const group = redWallGroups.get(key) ?? [];
    group.push(obstacle);
    redWallGroups.set(key, group);
  }
  for (const wall of redWallGroups.values()) {
    const wallZ = Math.min(...wall.map((obstacle) => obstacle.z));
    const gateId = wall.find((obstacle) => obstacle.gateId !== undefined)?.gateId;
    const linkedRamp = ramps
      .filter((ramp) =>
        gateId === undefined
          ? ramp.z < wallZ && wallZ - ramp.z <= config.rampLeadRows * config.minGapZ
          : ramp.gateId === gateId,
      )
      .sort((a, b) => b.z - a.z)[0];
    if (!linkedRamp) {
      return {
        passable: false,
        reason: 'tall-block',
        route: [],
        minDecisionSlackSeconds: 0,
      };
    }
    const rampFlow = linkedRamp.gateId === undefined
      ? config.laneFlow[linkedRamp.lane] ?? 0
      : 0;
    const rampRelativeSpeed = Math.max(playerSpeed + rampFlow, 1);
    const rampTime = Math.max(
      0,
      (linkedRamp.z - playerDistance) / rampRelativeSpeed,
    );
    const rampRow = Math.round(rampTime / timeStep);
    ensureEvent(rampRow, linkedRamp.z).requiredLanes.add(linkedRamp.lane);
  }

  for (const obstacle of obstacles) {
    if (
      obstacle.kind === 'micro' ||
      obstacle.redWall ||
      (obstacle.challengeId !== undefined &&
        fullNitroChallenges.has(obstacle.challengeId))
    ) {
      continue;
    }
    const relativeSpeed = carTrafficScrollSpeed(playerSpeed, obstacle.lane, config, obstacle);
    const arrivalTime =
      (obstacle.z - playerDistance) / relativeSpeed;
    if (arrivalTime < -obstaclePaddingSeconds) continue;
    const halfBodySeconds =
      Math.max(0, obstacle.zExtent ?? 0) / (2 * relativeSpeed);
    const halfWindow = halfBodySeconds + obstaclePaddingSeconds;
    let firstRow = Math.ceil((arrivalTime - halfWindow) / timeStep);
    let lastRow = Math.floor((arrivalTime + halfWindow) / timeStep);
    if (firstRow > lastRow) {
      firstRow = Math.round(arrivalTime / timeStep);
      lastRow = firstRow;
    }
    for (let row = firstRow; row <= lastRow; row++) {
      ensureEvent(row, obstacle.z).blocked.add(obstacle.lane);
    }
  }

  const orderedEvents = [...events.values()].sort((a, b) => a.row - b.row);
  const configuredStartLanes = options.startLanes ??
    Array.from({ length: config.lanes }, (_, lane) => lane);
  let states = new Map<number, TemporalRouteNode>();
  for (const lane of configuredStartLanes) {
    if (lane < 0 || lane >= config.lanes) continue;
    states.set(lane, {
      lane,
      eventTime: 0,
      lastChangeTime: Number.NEGATIVE_INFINITY,
      changes: 0,
      minSlack: Number.POSITIVE_INFINITY,
      event: null,
      parent: null,
    });
  }

  const betterNode = (
    candidate: TemporalRouteNode,
    current: TemporalRouteNode | undefined,
  ): boolean => {
    if (!current) return true;
    if (candidate.minSlack > current.minSlack + 1e-6) return true;
    if (current.minSlack > candidate.minSlack + 1e-6) return false;
    return candidate.changes < current.changes;
  };

  for (const event of orderedEvents) {
    if (event.requiredLanes.size > 1) {
      return {
        passable: false,
        reason: 'dead-end',
        route: [],
        failureTime: event.time,
        minDecisionSlackSeconds: 0,
      };
    }
    const requiredLane = [...event.requiredLanes][0];
    const allowedLanes = Array.from({ length: config.lanes }, (_, lane) => lane)
      .filter((lane) => !event.blocked.has(lane))
      .filter((lane) => requiredLane === undefined || lane === requiredLane);
    const next = new Map<number, TemporalRouteNode>();
    for (const previous of states.values()) {
      const availableSeconds = Math.max(0, event.time - previous.eventTime);
      for (const lane of allowedLanes) {
        const laneSteps = Math.abs(lane - previous.lane);
        const moveSeconds = laneSteps * laneSwitchSeconds;
        if (moveSeconds > availableSeconds + 1e-6) continue;
        const changed = lane !== previous.lane;
        const decisionGap = changed && Number.isFinite(previous.lastChangeTime)
          ? event.time - previous.lastChangeTime
          : Number.POSITIVE_INFINITY;
        if (changed && decisionGap + 1e-6 < minDecisionSeconds) continue;
        const movementSlack = availableSeconds - moveSeconds;
        const decisionSlack = changed && Number.isFinite(decisionGap)
          ? decisionGap - minDecisionSeconds
          : Number.POSITIVE_INFINITY;
        const node: TemporalRouteNode = {
          lane,
          eventTime: event.time,
          lastChangeTime: changed ? event.time : previous.lastChangeTime,
          changes: previous.changes + (changed ? laneSteps : 0),
          minSlack: Math.min(
            previous.minSlack,
            changed ? movementSlack : Number.POSITIVE_INFINITY,
            decisionSlack,
          ),
          event,
          parent: previous,
        };
        if (betterNode(node, next.get(lane))) next.set(lane, node);
      }
    }
    if (next.size === 0) {
      return {
        passable: false,
        reason: 'dead-end',
        route: [],
        failureTime: event.time,
        minDecisionSlackSeconds: 0,
      };
    }
    states = next;
  }

  const best = [...states.values()].sort((a, b) => {
    if (a.minSlack !== b.minSlack) return b.minSlack - a.minSlack;
    return a.changes - b.changes;
  })[0];
  if (!best) {
    return {
      passable: false,
      reason: 'dead-end',
      route: [],
      minDecisionSlackSeconds: 0,
    };
  }
  const route: CarRoutePoint[] = [];
  let cursor: TemporalRouteNode | null = best;
  while (cursor) {
    if (cursor.event) {
      route.push({
        time: cursor.event.time,
        z: cursor.event.z,
        lane: cursor.lane,
      });
    }
    cursor = cursor.parent;
  }
  route.reverse();
  if (route.length === 0) {
    route.push({
      time: 0,
      z: playerDistance,
      lane: best.lane,
    });
  }
  return {
    passable: true,
    reason: 'ok',
    route,
    minDecisionSlackSeconds: Number.isFinite(best.minSlack)
      ? best.minSlack
      : minDecisionSeconds,
  };
}

export function isPassableAsCarTemporal(
  obstacles: ObstacleEntity[],
  config: LevelgenConfig,
  ramps: RampEntity[] = [],
): PassabilityResult {
  const result = findComfortableCarRoute(obstacles, config, ramps);
  return { passable: result.passable, reason: result.reason };
}
