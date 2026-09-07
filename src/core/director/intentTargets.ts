import type { IntentTarget } from '@core/state/DirectorIntent';

export const VALID_TARGETS = new Set<IntentTarget>([
  'speed',
  'obstacleDensity',
  'coinFrequency',
  'bonusSpawnBias',
  'vfxIntensity',
  'camera.fov',
  'camera.pitch',
  'camera.shake',
  'camera.distance',
  'world.fog',
  'world.ambient',
  'world.palette',
  'vfx.speedLines',
  'vfx.bloom',
  'vfx.particles',
  'timingRewardWindow',
]);

export function isValidIntentTarget(target: string): target is IntentTarget {
  return (VALID_TARGETS as Set<string>).has(target);
}
