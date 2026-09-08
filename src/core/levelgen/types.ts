export type ObstacleKind = 'tall' | 'low' | 'micro' | 'overhead';

export type HorseActionKind = 'jump' | 'slide';
export type SceneryTheme = 'frontierTown';

export interface ObstacleEntity {
  musicTarget?: MusicTarget;
  id: number;
  kind: ObstacleKind;
  lane: number;
  z: number;
  broken?: boolean;
  smashed?: boolean;
  redWall?: boolean;
  gateId?: number;
  nitroChallenge?: boolean;
  nitroMandatory?: boolean;
  challengeId?: number;
  y?: number;
  trainId?: number;
  trainOffsetZ?: number;
  unbreakable?: boolean;
  horseAction?: HorseActionKind;
  actionGroupId?: number;
  actionIndex?: number;
  actionCount?: number;
  smashStrength?: number;
  cleared?: boolean;
  smashDelayRemaining?: number;
  collisionIgnored?: boolean;
  transitionGhost?: boolean;
  crushBroken?: boolean;
  penaltyBreak?: boolean;
  flowGroupId?: number;
  companionTransfer?: boolean;
  horseDodgeOnly?: boolean;
  modePortal?: 'car';
  knockbackActive?: boolean;
  knockbackElapsed?: number;
  knockbackVelX?: number;
  knockbackVelY?: number;
  knockbackVelZ?: number;
  knockbackSpin?: number;
  knockbackStyle?: 'yellow' | 'green';
  knockbackLateralSign?: number;
  knockbackBurstFx?: boolean;
  shoulderPasser?: boolean;
  routeGuide?: boolean;
  rampGuideId?: number;
  rampOffsetZ?: number;
  zExtent?: number;
  xOffset?: number;
  yOffset?: number;
  panicFleeActive?: boolean;
  panicFleeElapsed?: number;
  panicFleeLateralSign?: number;
  panicFleeAlongSign?: number;
  panicFleeYaw?: number;
  panicFleeRemove?: boolean;
  visualTheme?: SceneryTheme;
}

export interface SceneryZoneEntity {
  id: number;
  theme: SceneryTheme;
  z: number;
  length: number;
}

export interface CoinEntity {
  musicTarget?: MusicTarget;
  id: number;
  lane: number;
  x?: number;
  z: number;
  collected: boolean;
  destroyed?: boolean;
  crushArmed?: boolean;
  y?: number;
  airPathId?: number;
  airTargetTime?: number;
  trainId?: number;
  trainOffsetZ?: number;
  rampGuideId?: number;
  rampOffsetZ?: number;
  actionGroupId?: number;
  flowGroupId?: number;
  musicSceneId?: number;
  routeKind?: 'safeGuide' | 'riskChoice' | 'sceneGuide' | 'echo';
  rocketPattern?: 'line' | 'arc' | 'snake' | 'diagonal';
  echoSpawnTime?: number;
  echoSourceLane?: number;
}

export interface RampEntity {
  id: number;
  lane: number;
  z: number;
  used?: boolean;
  gateId?: number;
  musicSceneId?: number;
  echoSpawnTime?: number;
  echoSourceLane?: number;
  echoed?: boolean;
}

export interface TrainEntity {
  id: number;
  lane: number;
  z: number;
  length: number;
  height: number;
  rideDuration: number;
  rideRemaining: number;
  landingDelay: number;
  landingInset: number;
  rideStarted: boolean;
  variant: 0 | 1;
  companionOf?: number;
  expectsCompanion?: boolean;
  musicSceneId?: number;
  echoSpawnTime?: number;
  echoSourceLane?: number;
  avoidLane?: number;
}

export type BonusKind = 'car' | 'horse' | 'rocket';

export interface BonusEntity {
  id: number;
  kind: BonusKind;
  lane: number;
  z: number;
  collected: boolean;
  y?: number;
  airTargetTime?: number;
  airPathId?: number;
  trainId?: number;
  trainOffsetZ?: number;
}

export interface MusicTarget {
  time: number;
  cueId: number;
  confidence: number;
  role: 'collect' | 'dodge';
}
