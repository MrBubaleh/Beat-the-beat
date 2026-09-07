export type IntentTarget =
  | 'speed'
  | 'obstacleDensity'
  | 'coinFrequency'
  | 'bonusSpawnBias'
  | 'vfxIntensity'
  | 'camera.fov'
  | 'camera.pitch'
  | 'camera.shake'
  | 'camera.distance'
  | 'world.fog'
  | 'world.ambient'
  | 'world.palette'
  | 'vfx.speedLines'
  | 'vfx.bloom'
  | 'vfx.particles'
  | 'timingRewardWindow';

export interface DirectorIntent {
  target: IntentTarget;
  value: number | boolean;
  priority: number;
  tag: string;
  issuedAt: number;
}
