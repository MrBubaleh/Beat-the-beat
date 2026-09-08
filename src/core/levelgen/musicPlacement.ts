import type { LevelgenConfig } from '../config/schemas';
import type { RunEnvelope } from '../gameplay/musicPlanning';
import type { ObstacleEntity, CoinEntity, RampEntity } from './types';
import { findComfortableCarRoute } from './passability';
import { carTrafficScrollSpeed } from './trafficMotion';

export interface MusicPlacementContext {
  time?: number;
  speed: number;
  minSpeed: number;
  maxSpeed: number;
  entryLane: number;
  envelope: RunEnvelope;
}

export function certifyMusicPlacement(
  obstacles: ObstacleEntity[], coins: CoinEntity[], ramps: RampEntity[],
  config: LevelgenConfig, context: MusicPlacementContext,
): boolean {
  const hazards = obstacles.filter(o => !o.broken && !o.cleared && !o.collisionIgnored);
  const pickups = [...hazards.filter(o => o.kind === 'micro' && o.musicTarget),
    ...coins.filter(c => c.musicTarget && !c.collected && !c.destroyed)].filter(p => p.z > 0);
  const speeds = new Set([context.speed, context.minSpeed, context.maxSpeed]);
  for (let speed = context.minSpeed; speed < context.maxSpeed; speed += config.fairness.speedSampleStep) speeds.add(speed);
  for (const playerSpeed of speeds) {
    const requiredWaypoints = pickups.map(p => ({ lane: p.lane,
      time: p.z / carTrafficScrollSpeed(playerSpeed, p.lane, config, p), z: p.z }));
    if (!findComfortableCarRoute(hazards, config, ramps, {
      playerSpeed, startLanes: [context.entryLane], requiredWaypoints,
      minDecisionSeconds: Math.max(config.fairness.minDecisionSeconds, context.envelope.minReactionSeconds),
    }).passable) return false;
    for (const pickup of pickups) {
      const pickupSpeed = carTrafficScrollSpeed(playerSpeed, pickup.lane, config, pickup);
      const arrival = pickup.z / pickupSpeed;
      for (const ramp of ramps) {
        if (ramp.lane !== pickup.lane || ramp.used) continue;
        const gap = ramp.z - pickup.z;
        const rampSpeed = ramp.gateId === undefined ? carTrafficScrollSpeed(playerSpeed, ramp.lane, config) : playerSpeed;
        const endGap = gap - (rampSpeed - pickupSpeed) * arrival;
        if (Math.abs(gap) < 2 || Math.abs(endGap) < 2 || gap * endGap < 0) return false;
      }
      for (const hazard of hazards) {
        if (hazard === pickup || hazard.lane !== pickup.lane) continue;
        const gap = hazard.z - pickup.z;
        const closing = carTrafficScrollSpeed(playerSpeed, hazard.lane, config, hazard) - pickupSpeed;
        const endGap = gap - closing * arrival;
        const clearance = hazard.kind === 'micro' ? 1.6 : Math.max(config.minGapZ * config.fairness.microLeadMinGapZScale, (hazard.zExtent ?? 0) / 2 + 2);
        if (Math.abs(gap) < clearance || Math.abs(endGap) < clearance || gap * endGap < 0) return false;
      }
    }
  }
  return true;
}

export function withinRunEnvelope(obstacles: ObstacleEntity[], config: LevelgenConfig, context: MusicPlacementContext): boolean {
  const events = obstacles.filter(o => !o.broken && !o.cleared && o.kind !== 'micro' && o.z >= 0)
    .map(o => ({ lane: o.lane, time: o.z / carTrafficScrollSpeed(context.speed, o.lane, config, o) }))
    .sort((a, b) => a.time - b.time);
  const env = context.envelope;
  let chain = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const simultaneous = events.filter(other => Math.abs(other.time - event.time) < env.minReactionSeconds);
    if (new Set(simultaneous.map(other => other.lane)).size > env.maxBlockedLanes) return false;
    if (i === 0 || event.time - events[i - 1].time > env.minReactionSeconds + config.fairness.laneSwitchSeconds + 0.5) chain = 1;
    else if (event.time - events[i - 1].time > 0.1) chain++;
    if (chain > env.maxActions) return false;
    if (events.filter(other => other.time >= event.time && other.time < event.time + 4).length > Math.ceil(env.densityCap * 12)) return false;
  }
  return true;
}
