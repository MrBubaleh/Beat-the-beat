import type { GameConfig } from '@core/config/schemas';
import type { RunStats } from '@core/gameplay/GameSim';
import { obstacleFootprint } from '@core/gameplay/obstacleFootprint';
import type { ObstacleEntity } from '@core/levelgen/types';
import type { PlayerState } from '@core/state/PlayerState';

export type TutorialStatus = 'novice' | 'veteran';
export type TutorialStage = 'nitro' | 'jump' | 'slide';
export type TutorialConfig = GameConfig['tutorial'];
type TutorialGameConfig = Pick<GameConfig, 'tutorial' | 'lane' | 'obstacle' | 'player' | 'hit'>;
type TutorialStats = Pick<RunStats, 'nitroActivations' | 'horseJumpClears' | 'horseSlideClears' | 'hits'>;

export interface TutorialSnapshot {
  player: Pick<PlayerState, 'mode' | 'lane' | 'speed' | 'gameOver' | 'isHit' | 'isAbilityActive' | 'airState' | 'airSource'>;
  obstacles: readonly ObstacleEntity[];
  nitroReady: boolean;
  runStats: TutorialStats;
}

export interface TutorialIntent {
  active: boolean;
  stage: TutorialStage | null;
  targetObstacleId: number | null;
  arrowPose: { x: number; y: number; z: number; yaw: number; pitch: number } | null;
  arrowColor: 'green' | 'turquoise';
  slowMoBlend: number;
  timeScale: number;
}

export function isTutorialRampFlight(player: Pick<PlayerState, 'airState' | 'airSource'>): boolean {
  return player.airSource === 'ramp' && (player.airState === 'airborne' || player.airState === 'landing');
}

const emptyStats = (): TutorialStats => ({
  nitroActivations: 0, horseJumpClears: 0, horseSlideClears: 0, hits: 0,
});

export class TutorialController {
  private playerStatus: TutorialStatus;
  private done = { nitro: false, jump: false, slide: false };
  private baseline = emptyStats();
  private previousHits = 0;
  private wasHit = false;
  private previousMode: PlayerState['mode'] | null = null;
  private target: { id: number; stage: TutorialStage } | null = null;
  private slowing = false;
  private passedSeconds: number | null = null;
  private blend = 0;
  private ignoredIds = new Set<number>();

  constructor(private config: TutorialGameConfig, status: TutorialStatus = 'novice') {
    this.playerStatus = status;
  }

  get status(): TutorialStatus { return this.playerStatus; }

  get stages(): Readonly<{ nitroStageDone: boolean; jumpStageDone: boolean; slideStageDone: boolean }> {
    return {
      nitroStageDone: this.done.nitro,
      jumpStageDone: this.done.jump,
      slideStageDone: this.done.slide,
    };
  }

  setConfig(config: TutorialGameConfig): void { this.config = config; }

  resetRun(status = this.playerStatus, snapshot?: TutorialSnapshot): void {
    this.playerStatus = status;
    this.done = { nitro: false, jump: false, slide: false };
    this.baseline = snapshot ? { ...snapshot.runStats } : emptyStats();
    this.previousHits = this.baseline.hits;
    this.wasHit = snapshot?.player.isHit ?? false;
    this.previousMode = snapshot?.player.mode ?? null;
    this.ignoredIds.clear();
    this.suspend();
  }

  suspend(): TutorialIntent {
    this.clearTarget();
    this.blend = 0;
    return this.intent(null);
  }

  update(snapshot: TutorialSnapshot, realDt: number): TutorialIntent {
    const dt = Number.isFinite(realDt) ? Math.max(0, realDt) : 0;
    const { player, runStats } = snapshot;
    const hit = runStats.hits > this.previousHits || (player.isHit && !this.wasHit);
    this.previousHits = runStats.hits;
    this.wasHit = player.isHit;
    const modeChanged = this.previousMode !== null && player.mode !== this.previousMode;
    this.previousMode = player.mode;

    if (this.playerStatus === 'novice') {
      this.done.nitro ||= runStats.nitroActivations > this.baseline.nitroActivations;
      this.done.jump ||= runStats.horseJumpClears > this.baseline.horseJumpClears;
      this.done.slide ||= runStats.horseSlideClears > this.baseline.horseSlideClears;
      if (this.done.nitro && this.done.jump && this.done.slide) {
        this.resetRun('veteran', snapshot);
      }
    }

    if (this.playerStatus === 'veteran' || player.gameOver || player.mode === 'rocket' || isTutorialRampFlight(player)) {
      return this.suspend();
    }
    if (modeChanged) return this.suspend();

    const liveIds = new Set(snapshot.obstacles.map((obstacle) => obstacle.id));
    for (const id of this.ignoredIds) if (!liveIds.has(id)) this.ignoredIds.delete(id);
    let obstacle = this.target
      ? snapshot.obstacles.find((candidate) => candidate.id === this.target!.id) ?? null
      : null;

    if (hit || (this.target && this.done[this.target.stage])) {
      if (this.target) this.ignoredIds.add(this.target.id);
      this.clearTarget();
      this.advanceBlend(false, dt);
      return this.intent(null);
    }

    if (this.target && this.passedSeconds === null) {
      if (!obstacle || this.hasPassed(obstacle)) {
        this.ignoredIds.add(this.target.id);
        if (this.slowing) this.passedSeconds = 0;
        else this.clearTarget();
        obstacle = null;
      } else if (this.stageFor(obstacle, snapshot) !== this.target.stage) {
        this.clearTarget();
        obstacle = null;
      }
    }

    if (this.passedSeconds !== null) {
      this.passedSeconds += dt;
      const releaseDt = this.passedSeconds - this.config.tutorial.slowMoPassTimeoutSeconds;
      if (releaseDt >= 0) {
        this.clearTarget();
        this.advanceBlend(false, releaseDt);
      } else {
        this.advanceBlend(true, dt);
      }
      return this.intent(null);
    }

    if (!this.target) {
      obstacle = this.selectTarget(snapshot);
      if (obstacle) this.target = { id: obstacle.id, stage: this.stageFor(obstacle, snapshot)! };
    }
    if (obstacle && this.target) {
      this.slowing ||= this.timeToContact(obstacle, player.speed) <=
        this.config.tutorial.slowMoStartTimeToContact;
    }
    this.advanceBlend(this.slowing, dt);
    return this.intent(obstacle);
  }

  private clearTarget(): void {
    this.target = null;
    this.slowing = false;
    this.passedSeconds = null;
  }

  private stageFor(obstacle: ObstacleEntity, snapshot: TutorialSnapshot): TutorialStage | null {
    if (obstacle.broken || obstacle.cleared || obstacle.collisionIgnored || obstacle.transitionGhost ||
      obstacle.modePortal || obstacle.panicFleeActive || obstacle.knockbackActive) return null;
    const { player } = snapshot;
    if (player.mode === 'car') {
      return !this.done.nitro && snapshot.nitroReady && !player.isAbilityActive &&
        obstacle.kind === 'low' && !obstacle.redWall && !obstacle.unbreakable ? 'nitro' : null;
    }
    if (player.mode !== 'horse' || obstacle.lane !== player.lane || obstacle.horseDodgeOnly) return null;
    const action = obstacle.horseAction;
    return action && !this.done[action] ? action : null;
  }

  private selectTarget(snapshot: TutorialSnapshot): ObstacleEntity | null {
    let nearest: ObstacleEntity | null = null;
    const cfg = this.config.tutorial;
    for (const obstacle of snapshot.obstacles) {
      if (obstacle.z <= 0 || this.ignoredIds.has(obstacle.id)) continue;
      const stage = this.stageFor(obstacle, snapshot);
      if (!stage) continue;
      const lead = stage === 'nitro' ? obstacle.z : this.timeToContact(obstacle, snapshot.player.speed);
      const min = stage === 'nitro' ? cfg.nitroArrowMinDistance
        : stage === 'jump' ? cfg.horseJumpArrowMinTimeToObstacle : cfg.horseArrowMinTimeToObstacle;
      const max = stage === 'nitro' ? cfg.nitroArrowMaxDistance
        : stage === 'jump' ? cfg.horseJumpArrowMaxTimeToObstacle : cfg.horseArrowMaxTimeToObstacle;
      if (lead < min || lead > max) continue;
      if (!nearest || obstacle.z < nearest.z || (obstacle.z === nearest.z && obstacle.id < nearest.id)) {
        nearest = obstacle;
      }
    }
    return nearest;
  }

  private timeToContact(obstacle: ObstacleEntity, speed: number): number {
    if (speed <= 0) return Infinity;
    const depth = obstacleFootprint(obstacle, this.config.obstacle).depth;
    const contactDistance = (depth + this.config.player.depth) / 2 - this.config.hit.zGrace;
    return Math.max(0, obstacle.z - contactDistance) / speed;
  }

  private hasPassed(obstacle: ObstacleEntity): boolean {
    const depth = obstacleFootprint(obstacle, this.config.obstacle).depth;
    return obstacle.z + (depth + this.config.player.depth) / 2 < 0;
  }

  private advanceBlend(slowing: boolean, dt: number): void {
    const step = dt / this.config.tutorial.slowMoBlendSeconds;
    this.blend = slowing ? Math.min(1, this.blend + step) : Math.max(0, this.blend - step);
  }

  private intent(obstacle: ObstacleEntity | null): TutorialIntent {
    const stage = obstacle ? this.target?.stage ?? null : null;
    const smoothed = this.blend * this.blend * (3 - 2 * this.blend);
    let arrowPose: TutorialIntent['arrowPose'] = null;
    if (stage && obstacle) {
      const footprint = obstacleFootprint(obstacle, this.config.obstacle);
      arrowPose = {
        x: this.config.lane.positions[obstacle.lane] + (obstacle.xOffset ?? 0),
        y: (obstacle.y ?? 0) + (obstacle.yOffset ?? 0) + (stage === 'nitro' ? 0.35 : footprint.height + 1),
        z: obstacle.z - footprint.depth / 2 - (stage === 'nitro' ? 2.6 : 0.25),
        yaw: 0,
        pitch: stage === 'nitro' ? Math.PI / 2 : stage === 'slide' ? Math.PI : 0,
      };
    }
    return {
      active: stage !== null,
      stage,
      targetObstacleId: stage ? obstacle!.id : null,
      arrowPose,
      arrowColor: stage === 'nitro' ? 'green' : 'turquoise',
      slowMoBlend: smoothed,
      timeScale: 1 - smoothed * (1 - this.config.tutorial.slowMoScale),
    };
  }
}
