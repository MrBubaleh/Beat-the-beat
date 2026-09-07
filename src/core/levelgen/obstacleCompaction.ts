import type { ObstacleEntity } from '@core/levelgen/types';

export interface ObstacleCompactionConfig {
  lowDepth: number;
  tallDepth: number;
  maxChainTall: number;
  maxChainLow: number;
  mergeTallChains?: boolean;
}

const DEFAULT_COMPACTION: ObstacleCompactionConfig = {
  lowDepth: 2.32,
  tallDepth: 5.1,
  maxChainTall: 2,
  maxChainLow: 2,
};

function compactionEligible(obstacle: ObstacleEntity): boolean {
  return (
    (obstacle.kind === 'low' || obstacle.kind === 'tall') &&
    obstacle.trainId === undefined &&
    obstacle.challengeId === undefined &&
    !obstacle.nitroChallenge &&
    !obstacle.redWall
  );
}

function compactionEligibleKind(
  kind: 'low' | 'tall',
  mergeTallChains: boolean,
): boolean {
  if (kind === 'low') return true;
  return mergeTallChains;
}

function baseDepth(
  kind: 'low' | 'tall',
  cfg: ObstacleCompactionConfig,
): number {
  return kind === 'tall' ? cfg.tallDepth : cfg.lowDepth;
}

function maxChainLength(
  kind: 'low' | 'tall',
  cfg: ObstacleCompactionConfig,
): number {
  return kind === 'tall' ? cfg.maxChainTall : cfg.maxChainLow;
}

function mergedExtent(
  kind: 'low' | 'tall',
  chainLength: number,
  span: number,
  cfg: ObstacleCompactionConfig,
): number {
  const depth = baseDepth(kind, cfg);
  const lengthBonus = 0.12 * (chainLength - 1);
  const spanBlend = kind === 'tall' ? 0.28 : 0.32;
  return Math.min(depth * (1 + lengthBonus), depth + span * spanBlend);
}

function clampExtentToOriginalRows(
  z: number,
  extent: number,
  chain: ObstacleEntity[],
  minGapZ: number,
): number {
  const rows = chain.map((obstacle) => Math.round(obstacle.z / minGapZ));
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const maxHalf =
    Math.min(
      Math.abs(z - (minRow - 1) * minGapZ),
      Math.abs(z - (maxRow + 1) * minGapZ),
    ) - 1e-4;
  return Math.min(extent, Math.max(0, maxHalf * 2));
}

export function compactGroundObstacles(
  obstacles: ObstacleEntity[],
  minGapZ: number,
  compaction: ObstacleCompactionConfig = DEFAULT_COMPACTION,
): void {
  const mergeGapZ = minGapZ * 1.05;
  const byLane = new Map<number, ObstacleEntity[]>();
  for (const obstacle of obstacles) {
    if (!compactionEligible(obstacle)) continue;
    const list = byLane.get(obstacle.lane) ?? [];
    list.push(obstacle);
    byLane.set(obstacle.lane, list);
  }
  const remove = new Set<number>();
  for (const list of byLane.values()) {
    list.sort((a, b) => a.z - b.z);
    let index = 0;
    while (index < list.length) {
      const current = list[index];
      const kind = current.kind as 'low' | 'tall';
      if (!compactionEligibleKind(kind, compaction.mergeTallChains ?? true)) {
        index += 1;
        continue;
      }
      const chain = [current];
      let next = index + 1;
      while (
        next < list.length &&
        chain.length < maxChainLength(kind, compaction)
      ) {
        const candidate = list[next];
        if (candidate.kind !== current.kind) break;
        const gap = candidate.z - chain[chain.length - 1].z;
        if (gap > mergeGapZ) break;
        chain.push(candidate);
        next += 1;
      }
      if (chain.length > 1) {
        const span = chain[chain.length - 1].z - chain[0].z;
        const mergedZ = chain[0].z + span / 2;
        const geometric = mergedExtent(kind, chain.length, span, compaction);
        current.zExtent = clampExtentToOriginalRows(
          mergedZ,
          geometric,
          chain,
          minGapZ,
        );
        current.z = mergedZ;
        for (let i = 1; i < chain.length; i++) remove.add(chain[i].id);
      }
      index = next;
    }
  }
  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (remove.has(obstacles[i].id)) obstacles.splice(i, 1);
  }
}
