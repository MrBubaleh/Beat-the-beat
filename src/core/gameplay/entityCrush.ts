import type { ObstacleEntity, RampEntity } from '@core/levelgen/types';

function obstaclePriority(obstacle: ObstacleEntity): number {
  if (obstacle.kind === 'micro') return 0;
  if (obstacle.kind === 'tall') return 3;
  if (obstacle.kind === 'overhead') return 2;
  return 2;
}

function crushObstacle(obstacle: ObstacleEntity): void {
  if (obstacle.broken || obstacle.unbreakable || obstacle.transitionGhost) return;
  obstacle.broken = true;
  obstacle.crushBroken = true;
}

export function resolveObstacleCrushes(
  obstacles: ObstacleEntity[],
  ramps: RampEntity[],
  overlapDepth: number,
): void {
  const zTolerance = overlapDepth * 0.92;

  for (const ramp of ramps) {
    if (ramp.used) continue;
    for (const obstacle of obstacles) {
      if (obstacle.broken || obstacle.cleared || obstacle.trainId !== undefined) continue;
      if (obstacle.lane !== ramp.lane) continue;
      if (Math.abs(obstacle.z - ramp.z) > zTolerance) continue;
      crushObstacle(obstacle);
    }
  }

  for (let i = 0; i < obstacles.length; i++) {
    const a = obstacles[i];
    if (a.broken || a.cleared || a.trainId !== undefined || a.unbreakable) continue;
    for (let j = i + 1; j < obstacles.length; j++) {
      const b = obstacles[j];
      if (b.broken || b.cleared || b.trainId !== undefined || b.unbreakable) continue;
      if (a.lane !== b.lane) continue;
      if (Math.abs(a.z - b.z) > zTolerance) continue;
      const priorityA = obstaclePriority(a);
      const priorityB = obstaclePriority(b);
      if (priorityA > priorityB) {
        crushObstacle(b);
      } else if (priorityB > priorityA) {
        crushObstacle(a);
      } else if (a.z >= b.z) {
        crushObstacle(a);
      } else {
        crushObstacle(b);
      }
    }
  }
}
