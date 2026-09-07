import {
  findComfortableCarRoute,
  findComfortableHorseRoute,
  horseRouteLaneAtZ,
  isPassableAsCarTemporal,
  isReadableMicroPlacement,
  type CarRoutePoint,
  type ComfortableCarRouteResult,
  type HorseRoutePoint,
} from './passability';
import type { LevelgenConfig } from '@core/config/schemas';
import { mulberry32 } from './prng';
import { carTrafficScrollSpeed } from './trafficMotion';
import { startLane } from './startLane';
import type {
  CoinEntity,
  ObstacleEntity,
  RampEntity,
  SceneryZoneEntity,
  SceneryTheme,
} from './types';
import type { PlayerMode } from '@core/modes/types';
import { CarPhasePlanner } from './carPhases';
import { HorsePhasePlanner, type HorsePhaseModifiers } from './horsePhases';
import { compactGroundObstacles, type ObstacleCompactionConfig } from './obstacleCompaction';
import { carHazardSpacingAllows } from './carHazardSpacing';
import { lateRunProgress, lateSongEaseFactor, scaleTowardEnd } from './difficulty';

export interface DestroySpawnConfig {
  microClusterProbability: number;
  microClusterSizeMin: number;
  microClusterSizeMax: number;
  microRowChance: number;
  mediumDensityScale: number;
  microChunkWeight: number;
  obstacleChunkWeightBoost: number;
  nitroTrafficMinLeadSeconds: number;
  nitroTallProbabilityScale: number;
  nitroMicroSpawnScale: number;
  nitroMediumSpawnScale: number;
  nitroSmashRowChance: number;
  nitroMaxMediumPerLaneRows: number;
  nitroLateStartProgress: number;
  nitroLateChargeGainScale: number;
  nitroLateChallengeScale: number;
  nitroLateMicroSpawnScale: number;
  nitroLateMediumSpawnScale: number;
  laneCommitmentMaxSeconds: number;
  laneCommitmentNitroMaxSeconds: number;
}

export interface LaneCommitmentState {
  lane: number;
  seconds: number;
  nitroActive: boolean;
}

export interface CarHorizonRepairScope {
  obstacleIds: ReadonlySet<number>;
  rampIds: ReadonlySet<number>;
}

export type ChunkCategory = 'obstacle' | 'coins' | 'bonus' | 'empty';

export interface Chunk {
  index: number;
  obstacles: ObstacleEntity[];
  coins: CoinEntity[];
  ramps: RampEntity[];
  sceneryZones?: SceneryZoneEntity[];
}

export class LevelGenerator {
  private nextId = 1;
  private nextGateId = 1;
  private nextChallengeId = 1;
  private nextActionGroupId = 1;
  private nextFlowGroupId = 1;
  private nextSceneryZoneId = 1;
  private lastGenerated = -1;
  private constraintLane: number | null = null;
  private lastWallRow: number | null = null;
  private densityMultiplier = 0.4;
  private coinFrequencyMultiplier = 1;
  private nitroActive = false;
  private nitroReady = false;
  private lastNitroChallengeRow: number | null = null;
  private lastFreeRampRow: number | null = null;
  private lastRampZ: number | null = null;
  private longRunProgress = 0;
  private songProgress = 0;
  private trackTime = 0;
  private trackDuration = 0;
  private trackSpeed = 16;
  private coinPullLane: number | null = null;

  setCoinPullLane(lane: number | null): void {
    this.coinPullLane = lane;
  }
  private mode: PlayerMode = 'car';
  private horseChunksGenerated = 0;
  private pendingHorseFollowup: 'jump' | 'slide' | 'dodge' | null = null;
  private lastHorseSlideEndZ: number | null = null;
  private horseMomentum = 0;
  private horseEmptyChunkStreak = 0;
  private horseChunksSinceDodge = 0;
  private horseConvertible = false;
  private horseCoinLane: number | null = null;
  private horseCoinLaneStreak = 0;
  private recentHorseActions: Array<'jump' | 'slide' | 'dodge'> = [];
  private pendingDodgeForceLane: number | null = null;
  private destroyCarMode = false;
  private destroySpawn: DestroySpawnConfig | null = null;
  private carTraffic: DestroySpawnConfig | null = null;
  private destroyNitroHorizonMeters = 0;
  private destroyNitroMinLeadMeters = 0;
  private laneCommitment: LaneCommitmentState | null = null;
  private obstacleCompaction: ObstacleCompactionConfig | null = null;
  private nitroLaneMediumRows = new Map<number, number>();
  private laneTallRowStreak = new Map<number, number>();
  private trafficPlayerDistance = 0;
  private trafficGameTime = 0;
  private trafficSpeed = 16;
  private carFairnessMinSpeed: number | null = null;
  private trafficNitroReady = false;
  private lastWallSpawnTime = -1000;
  private readonly carPhasePlanner = new CarPhasePlanner();
  private readonly horsePhasePlanner = new HorsePhasePlanner();
  private horseTownChunksRemaining = 0;
  private horseTownCooldownChunks = 0;

  constructor(
    private readonly config: LevelgenConfig,
    private seedValue: number,
  ) {
    this.constraintLane = startLane(this.config);
    this.densityMultiplier = this.config.baseDensity;
  }

  setDestroyCarMode(enabled: boolean, spawn: DestroySpawnConfig | null = null): void {
    this.destroyCarMode = enabled;
    this.destroySpawn = enabled ? spawn : null;
    if (!enabled) {
      this.destroyNitroHorizonMeters = 0;
      this.destroyNitroMinLeadMeters = 0;
    }
  }

  setCarTraffic(config: DestroySpawnConfig | null): void {
    this.carTraffic = config;
  }

  private trafficConfig(): DestroySpawnConfig | null {
    return this.destroySpawn ?? this.carTraffic;
  }

  setDestroyNitroTraffic(horizonMeters: number, minLeadMeters: number): void {
    this.destroyNitroHorizonMeters = Math.max(0, horizonMeters);
    this.destroyNitroMinLeadMeters = Math.max(0, minLeadMeters);
  }

  setLaneCommitment(state: LaneCommitmentState | null): void {
    this.laneCommitment = state;
  }

  setObstacleCompaction(config: ObstacleCompactionConfig): void {
    this.obstacleCompaction = config;
  }

  private obstacleCompactionConfig(): ObstacleCompactionConfig {
    return (
      this.obstacleCompaction ?? {
        lowDepth: 2.32,
        tallDepth: 5.1,
        maxChainTall: 2,
        maxChainLow: 2,
      }
    );
  }

  setTrafficSpawnContext(
    playerDistance: number,
    gameTime: number,
    speed: number,
    nitroReady: boolean,
  ): void {
    this.trafficPlayerDistance = Math.max(0, playerDistance);
    this.trafficGameTime = Math.max(0, gameTime);
    this.trafficSpeed = Math.max(speed, 8);
    this.carFairnessMinSpeed = Math.min(Math.max(speed, 0.5), this.config.fairness.referenceSpeed);
    this.trafficNitroReady = nitroReady;
  }

  private effectiveWallProbability(): number {
    return this.trafficNitroReady
      ? this.config.wallProbability
      : this.config.wallProbabilityNoNitro;
  }

  private canSpawnWallAt(z: number): boolean {
    const relativeZ = z - this.trafficPlayerDistance;
    if (relativeZ <= 0) return true;
    const reachTime =
      this.trafficGameTime + relativeZ / Math.max(this.trafficSpeed, 8);
    return (
      reachTime >=
      this.lastWallSpawnTime + this.config.wallCooldownSeconds
    );
  }

  private noteWallSpawnAt(z: number): void {
    const relativeZ = z - this.trafficPlayerDistance;
    this.lastWallSpawnTime =
      this.trafficGameTime +
      Math.max(0, relativeZ) / Math.max(this.trafficSpeed, 8);
  }

  private maybeSpawnShoulderPasser(
    obstacles: ObstacleEntity[],
    rng: () => number,
    z: number,
    globalRow: number,
  ): void {
    if (this.mode !== 'car') return;
    const earlyBoost =
      globalRow < this.config.earlyTraffic.rows ? 1.85 : 1;
    if (rng() >= this.config.shoulderPasserProbability * earlyBoost) return;
    const lanes = this.config.lanes;
    if (lanes < 2) return;
    const edgeLanes = [0, lanes - 1];
    const lane = edgeLanes[Math.floor(rng() * edgeLanes.length)];
    if (this.groundLaneBlocked(obstacles, lane, z)) return;
    const obstacle = this.makeObstacle('low', lane, z);
    obstacle.shoulderPasser = true;
    obstacles.push(obstacle);
  }

  private spawnForcedEarlyObstacle(
    obstacles: ObstacleEntity[],
    rng: () => number,
    z: number,
  ): void {
    const freeLane = this.pickFreeLane(rng);
    this.constraintLane = freeLane;
    const lane = this.destroyCarMode
      ? freeLane
      : (freeLane + 1) % this.config.lanes;
    obstacles.push(this.makeObstacle(this.destroyCarMode ? 'micro' : 'low', lane, z));
    this.finishCarObstacleRow([]);
  }

  private destroyNitroTrafficActive(z: number): boolean {
    if (!this.nitroActive) return false;
    if (this.destroyNitroHorizonMeters <= this.destroyNitroMinLeadMeters) return false;
    return z >= this.destroyNitroMinLeadMeters && z <= this.destroyNitroHorizonMeters;
  }

  private destroyNitroLateProgress(): number {
    const cfg = this.trafficConfig();
    if (!cfg) return 0;
    return lateRunProgress(
      this.songProgress,
      this.longRunProgress,
      cfg.nitroLateStartProgress,
    );
  }

  private destroyNitroLateScale(endScale: number): number {
    return scaleTowardEnd(endScale, this.destroyNitroLateProgress());
  }

  private destroyNitroMicroScale(z: number, cfg: DestroySpawnConfig): number {
    if (!this.destroyNitroTrafficActive(z)) return 1;
    return cfg.nitroMicroSpawnScale *
      this.destroyNitroLateScale(cfg.nitroLateMicroSpawnScale);
  }

  private laneCommitmentStagnant(rng: () => number): number | null {
    if (!this.laneCommitment || !this.trafficConfig()) return null;
    const cfg = this.trafficConfig()!;
    const limit = this.laneCommitment.nitroActive
      ? cfg.laneCommitmentNitroMaxSeconds
      : cfg.laneCommitmentMaxSeconds;
    if (this.laneCommitment.seconds < limit) return null;
    if (this.constraintLane !== null && rng() < 0.28) return this.constraintLane;
    return this.laneCommitment.lane;
  }

  private nitroLaneAllowsMedium(lane: number, z: number): boolean {
    if (!this.trafficConfig() || !this.destroyNitroTrafficActive(z)) return true;
    const count = this.nitroLaneMediumRows.get(lane) ?? 0;
    return count < this.trafficConfig()!.nitroMaxMediumPerLaneRows;
  }

  private noteNitroMediumLane(lane: number, z: number): void {
    if (!this.destroyNitroTrafficActive(z)) return;
    this.nitroLaneMediumRows.set(lane, (this.nitroLaneMediumRows.get(lane) ?? 0) + 1);
  }

  private commitmentTallPassable(
    obstacles: ObstacleEntity[],
    lane: number,
    z: number,
    ramps: RampEntity[],
  ): boolean {
    const trial = [...obstacles, this.makeObstacle('tall', lane, z)];
    return isPassableAsCarTemporal(trial, this.config, ramps).passable;
  }

  setDensityMultiplier(multiplier: number): void {
    this.densityMultiplier = multiplier;
  }

  setMusicDensityIntent(intent: number): void {
    const centered = (clamp(intent, 0, 1) - 0.5) * 2;
    this.densityMultiplier =
      this.config.baseDensity + centered * this.config.musicDensityDeltaMax;
  }

  setCoinFrequencyIntent(intent: number): void {
    this.coinFrequencyMultiplier = clamp(intent / 0.5, 0.4, 1.6);
  }

  get effectiveDensity(): number {
    return this.clampDensity(
      (this.densityMultiplier +
        this.longRunProgress * this.config.longRunDifficulty.maxDensityBonus) *
        this.lateSongDensityEase(),
    );
  }

  private lateSongDensityEase(): number {
    const cfg = this.config.longRunDifficulty;
    return lateSongEaseFactor(
      this.songProgress,
      cfg.lateSongEaseStartProgress,
      cfg.lateSongEaseMaxReduction,
    );
  }

  private chunkStartZ(index: number): number {
    return this.config.contentStartZ + index * this.config.chunkLength;
  }

  get effectiveCoinFrequency(): number {
    return this.coinFrequencyMultiplier *
      (this.nitroActive ? this.config.nitroCoinFrequencyMultiplier : 1);
  }

  setNitroActive(active: boolean): void {
    this.nitroActive = active;
  }

  setNitroReady(ready: boolean): void {
    this.nitroReady = ready;
  }

  setLongRunProgress(progress: number): void {
    this.longRunProgress = clamp(progress, 0, 1);
  }

  setSongProgress(progress: number): void {
    this.songProgress = clamp(progress, 0, 1);
  }

  setTrackTiming(time: number, duration: number, speed: number): void {
    this.trackTime = Math.max(0, time);
    this.trackDuration = Math.max(0, duration);
    this.trackSpeed = Math.max(speed, 8);
  }

  private obstaclesSpawnAllowed(): boolean {
    const stopSeconds = this.config.trackEndObstacleStopSeconds;
    if (stopSeconds <= 0 || this.trackDuration <= 0) return true;
    const remaining = this.trackDuration - this.trackTime;
    const leadSeconds =
      ((this.config.segmentsAhead + 2) * this.config.chunkLength) / this.trackSpeed;
    return remaining > stopSeconds + leadSeconds;
  }

  setMode(mode: PlayerMode): void {
    if (mode === 'horse' && this.mode !== 'horse') {
      this.horseChunksGenerated = 0;
      this.pendingHorseFollowup = null;
      this.lastHorseSlideEndZ = null;
      this.horseEmptyChunkStreak = 0;
      this.horseChunksSinceDodge = 0;
      this.horseConvertible = false;
      this.horseCoinLane = null;
      this.horseCoinLaneStreak = 0;
      this.recentHorseActions = [];
      this.pendingDodgeForceLane = null;
      this.horseTownChunksRemaining = 0;
      this.horseTownCooldownChunks = 0;
      this.horsePhasePlanner.reset();
    }
    this.mode = mode;
    if (mode !== 'car') {
      this.nitroActive = false;
      this.nitroReady = false;
    }
    if (mode !== 'horse') this.horseMomentum = 0;
  }

  setHorseMomentum(momentum: number): void {
    this.horseMomentum = clamp(momentum, 0, 1);
  }

  setHorseConvertible(active: boolean): void {
    this.horseConvertible = active;
  }

  get seed(): number {
    return this.seedValue;
  }

  reset(seed: number): void {
    this.seedValue = seed;
    this.nextId = 1;
    this.nextGateId = 1;
    this.nextChallengeId = 1;
    this.nextActionGroupId = 1;
    this.nextFlowGroupId = 1;
    this.nextSceneryZoneId = 1;
    this.lastGenerated = -1;
    this.constraintLane = startLane(this.config);
    this.lastWallRow = null;
    this.densityMultiplier = this.config.baseDensity;
    this.coinFrequencyMultiplier = 1;
    this.coinPullLane = null;
    this.nitroActive = false;
    this.nitroReady = false;
    this.lastNitroChallengeRow = null;
    this.lastFreeRampRow = null;
    this.lastRampZ = null;
    this.longRunProgress = 0;
    this.songProgress = 0;
    this.mode = 'car';
    this.horseChunksGenerated = 0;
    this.pendingHorseFollowup = null;
    this.lastHorseSlideEndZ = null;
    this.horseMomentum = 0;
    this.horseEmptyChunkStreak = 0;
    this.horseChunksSinceDodge = 0;
    this.horseConvertible = false;
    this.horseCoinLane = null;
    this.horseCoinLaneStreak = 0;
    this.recentHorseActions = [];
    this.pendingDodgeForceLane = null;
    this.horseTownChunksRemaining = 0;
    this.horseTownCooldownChunks = 0;
    this.carPhasePlanner.reset();
    this.horsePhasePlanner.reset();
    this.trackTime = 0;
    this.trackDuration = 0;
    this.trackSpeed = 16;
    this.trafficPlayerDistance = 0;
    this.trafficGameTime = 0;
    this.trafficSpeed = 16;
    this.carFairnessMinSpeed = null;
    this.trafficNitroReady = false;
    this.lastWallSpawnTime = -1000;
    this.destroyNitroHorizonMeters = 0;
    this.destroyNitroMinLeadMeters = 0;
    this.laneCommitment = null;
    this.nitroLaneMediumRows.clear();
    this.laneTallRowStreak.clear();
  }

  private isRiskLane(lane: number): boolean {
    return this.config.riskZone.riskLanes.includes(lane);
  }

  generateUpTo(maxChunk: number): Chunk[] {
    const chunks: Chunk[] = [];
    for (let index = this.lastGenerated + 1; index <= maxChunk; index++) {
      chunks.push(this.generateChunk(index));
    }
    this.lastGenerated = Math.max(this.lastGenerated, maxChunk);
    return chunks;
  }

  generateChunk(index: number): Chunk {
    if (this.mode === 'rocket') {
      return { index, obstacles: [], coins: [], ramps: [] };
    }
    if (this.mode === 'horse') return this.generateHorseChunk(index);
    const config = this.config;
    const chunkEntryLane = this.constraintLane ?? startLane(config);
    const rng = mulberry32((this.seedValue ^ index) >>> 0);
    const carModifiers = this.carPhasePlanner.advanceChunk(
      rng,
      config.car,
      this.longRunProgress,
    );
    const chunkCoinFrequency =
      this.effectiveCoinFrequency * carModifiers.coinFrequencyMultiplier;
    const z0 = this.chunkStartZ(index);
    const numRows = Math.max(1, Math.floor(config.chunkLength / config.minGapZ));
    const obstacles: ObstacleEntity[] = [];
    const coins: CoinEntity[] = [];
    const ramps: RampEntity[] = [];
    this.nitroLaneMediumRows.clear();
    this.laneTallRowStreak.clear();
    const pendingRamps: { row: number; lane: number; gateId?: number }[] = [];
    const gatePlans: { rampRow: number; wallRow: number; lane: number; gateId: number }[] = [];

    const destroySpawn = this.destroyCarMode ? this.destroySpawn : null;
    const spawnObstacles = this.obstaclesSpawnAllowed();
    const trafficCfg = this.trafficConfig();
    let category = this.pickCategory(rng, carModifiers.obstacleWeightScale, destroySpawn);
    const openingTraffic = !this.nitroActive &&
      config.segmentWeights.obstacle + config.segmentWeights.bonus > 0;
    if (openingTraffic && category === 'empty' && index * numRows < config.earlyTraffic.rows) category = 'obstacle';
    const useObstacles = category === 'obstacle' || category === 'bonus';
    const densityScale = category === 'bonus' ? 0.5 : 1;
    const density = this.clampDensity(
      (this.densityMultiplier * densityScale +
        this.longRunProgress * config.longRunDifficulty.maxDensityBonus) *
        this.lateSongDensityEase(),
    );

    for (let row = 0; row < numRows; row++) {
      const z = z0 + row * config.minGapZ;
      const globalRow = index * numRows + row;
      const earlyTraffic = globalRow < config.earlyTraffic.rows;
      const rowDensity = this.clampDensity(
        (density + (earlyTraffic ? config.earlyTraffic.densityBonus : 0)) *
          carModifiers.densityScale,
      );
      const wallAllowed =
        this.lastWallRow === null || globalRow - this.lastWallRow >= config.minWallGapRows;
      const redWallRampAllowed = row >= config.rampLeadRows * 2;
      const nitroChallengeAllowed =
        this.lastNitroChallengeRow === null ||
        globalRow - this.lastNitroChallengeRow >= config.nitroChallengeCooldownRows;

      if (
        spawnObstacles &&
        this.mode === 'car' &&
        useObstacles &&
        wallAllowed &&
        redWallRampAllowed &&
        rng() < config.redWallProbability
      ) {
        const gateId = this.nextGateId++;
        for (let lane = 0; lane < config.lanes; lane++) {
          obstacles.push(this.makeObstacle('tall', lane, z, true, gateId));
        }
        this.finishCarObstacleRow(this.allLanes());
        this.lastWallRow = globalRow;
        const rampLane = this.pickRampLane(rng);
        this.constraintLane = rampLane;
        const rampRow = row - config.rampLeadRows;
        const rampZ = z0 + rampRow * config.minGapZ;
        if (this.canPlaceRampAt(rampZ)) {
          this.reserveRamp(pendingRamps, rampRow, rampLane, gateId);
        }
        gatePlans.push({ rampRow, wallRow: row, lane: rampLane, gateId });
        continue;
      }

      const activeNitroChallenge =
        spawnObstacles &&
        this.mode === 'car' &&
        this.nitroActive &&
        nitroChallengeAllowed &&
        wallAllowed &&
        rng() <
          config.nitroWallProbability *
            (trafficCfg
              ? this.destroyNitroLateScale(trafficCfg.nitroLateChallengeScale)
              : 1);
      const readyNitroChallenge =
        spawnObstacles &&
        this.mode === 'car' &&
        !this.nitroActive &&
        this.nitroReady &&
        nitroChallengeAllowed &&
        wallAllowed &&
        rng() < config.nitroReadyChallengeProbability * carModifiers.nitroReadyChallengeMultiplier;
      if (activeNitroChallenge || readyNitroChallenge) {
        const mandatory = activeNitroChallenge
          ? rng() < config.nitroActiveFullRowProbability
          : rng() < config.nitroReadyMandatoryProbability;
        this.addNitroChallenge(obstacles, rng, z, mandatory);
        this.lastWallRow = globalRow;
        this.lastNitroChallengeRow = globalRow;
        this.finishCarObstacleRow([]);
        continue;
      }

      if (spawnObstacles && useObstacles && rng() < rowDensity) {
        const wallProb = this.effectiveWallProbability();
        if (
          wallAllowed &&
          this.canSpawnWallAt(z) &&
          rng() < wallProb
        ) {
          const freeLane = this.pickFreeLane(rng);
          this.constraintLane = freeLane;
          const flowGroupId = this.nextFlowGroupId++;
          for (const lane of this.allLanes()) {
            if (lane === freeLane) continue;
            const obstacle = this.makeObstacle('low', lane, z);
            obstacle.flowGroupId = flowGroupId;
            obstacles.push(obstacle);
          }
          this.noteWallSpawnAt(z);
          this.finishCarObstacleRow([]);
        } else {
          const freeLane = this.pickFreeLane(rng);
          this.constraintLane = freeLane;
          const commitmentLane = this.laneCommitmentStagnant(rng);
          if (
            commitmentLane !== null &&
            commitmentLane !== freeLane &&
            !this.groundLaneBlocked(obstacles, commitmentLane, z) &&
            this.laneTallRowStreakAt(commitmentLane) < 2 &&
            this.commitmentTallPassable(obstacles, commitmentLane, z, ramps) &&
            carHazardSpacingAllows(
              obstacles,
              commitmentLane,
              z,
              'tall',
              config.minGapZ,
              config.carHazardSpacing,
            )
          ) {
            obstacles.push(this.makeObstacle('tall', commitmentLane, z));
            this.finishCarObstacleRow([commitmentLane]);
            continue;
          }
          if (
            trafficCfg &&
            this.destroyNitroTrafficActive(z) &&
            rng() < trafficCfg.nitroSmashRowChance
          ) {
            const flowGroupId = this.nextFlowGroupId++;
            for (const lane of this.allLanes()) {
              if (lane === freeLane) continue;
              const obstacle = this.makeObstacle('low', lane, z);
              obstacle.flowGroupId = flowGroupId;
              obstacles.push(obstacle);
              this.noteNitroMediumLane(lane, z);
            }
            this.finishCarObstacleRow([]);
            continue;
          }
          const multiObstacleBias = clamp(
            (config.twoObstacleBias +
              carModifiers.multiObstacleBiasBonus +
              this.longRunProgress *
                config.longRunDifficulty.maxMultiObstacleBiasBonus) *
              this.lateSongDensityEase(),
            0,
            1,
          );
          const blockCount =
            carModifiers.activePhase === 'stream'
              ? 1
              : rng() < multiObstacleBias
                ? 2
                : 1;
          let blocked = this.pickBlockedLanes(rng, freeLane, blockCount, globalRow);
          if (carModifiers.streamLaneStickiness > 0) {
            blocked = this.carPhasePlanner.pickStreamBlockedLane(
              rng,
              freeLane,
              blocked,
              carModifiers.streamLaneStickiness,
              config.lanes,
            );
          }
          const flowGroupId = blockCount > 1 ? this.nextFlowGroupId++ : undefined;
          const tallLanes: number[] = [];
          for (const lane of blocked) {
            const kind = this.resolveCarGroundObstacleKind(
              rng,
              destroySpawn,
              z,
              earlyTraffic,
              lane,
            );
            if (kind === null || (kind !== 'low' && kind !== 'tall')) continue;
            if (
              !carHazardSpacingAllows(
                obstacles,
                lane,
                z,
                kind,
                config.minGapZ,
                config.carHazardSpacing,
              )
            ) {
              continue;
            }
            const obstacle = this.makeObstacle(kind, lane, z);
            if (
              kind === 'tall' &&
              (this.config.laneFlow[lane] ?? 0) < 0 &&
              !isPassableAsCarTemporal([...obstacles, obstacle], this.config, ramps).passable
            ) {
              obstacle.kind = 'low';
            }
            obstacle.flowGroupId = flowGroupId;
            obstacles.push(obstacle);
            if (kind === 'low') this.noteNitroMediumLane(lane, z);
            if (kind === 'tall') tallLanes.push(lane);
          }
          this.finishCarObstacleRow(tallLanes);
          if (
            !destroySpawn &&
            rng() <
            config.coinRoutes.obstacleGuideProbability * chunkCoinFrequency
          ) {
            if (!this.groundLaneBlocked(obstacles, freeLane, z)) {
              coins.push(this.makeCoin(freeLane, z, 'safeGuide'));
            }
          } else if (
            destroySpawn &&
            rng() <
              destroySpawn.microRowChance *
                this.destroyNitroMicroScale(z, destroySpawn) &&
            !this.groundLaneBlocked(obstacles, freeLane, z)
          ) {
            this.addMicroCluster(obstacles, rng, z, freeLane, destroySpawn);
          }
        }
      } else if (category === 'coins' || category === 'bonus') {
        this.finishCarObstacleRow([]);
        if (destroySpawn && spawnObstacles) {
          const microChance =
            destroySpawn.microClusterProbability *
            this.destroyNitroMicroScale(z, destroySpawn);
          if (rng() < microChance) {
            const lane = this.pickClearCoinLane(rng, obstacles, z);
            if (lane !== null) {
              this.addMicroCluster(obstacles, rng, z, lane, destroySpawn);
            }
          }
        } else {
        const coinProbability =
          (category === 'coins' ? 0.7 : 0.4) * chunkCoinFrequency;
        if (rng() < coinProbability) {
          if (rng() < config.coinRoutes.riskChoiceProbability) {
            const safeLane = this.pickClearCoinLane(
              rng,
              obstacles,
              z,
              this.constraintLane,
            );
            if (safeLane !== null) {
              coins.push(this.makeCoin(safeLane, z, 'safeGuide'));
            }
            const riskLane = this.pickClearCoinLane(
              rng,
              obstacles,
              z,
              this.pickRiskBiasedLane(rng, config.riskZone.coinWeight),
            );
            if (riskLane !== null && riskLane !== safeLane) {
              coins.push(this.makeCoin(riskLane, z, 'riskChoice'));
            }
          } else {
            const lane = this.pickClearCoinLane(rng, obstacles, z);
            if (lane !== null) coins.push(this.makeCoin(lane, z));
          }
        }
        }
      } else if (spawnObstacles && useObstacles) {
        this.finishCarObstacleRow([]);
      }

      if (spawnObstacles && useObstacles && this.mode === 'car') {
        this.maybeSpawnShoulderPasser(obstacles, rng, z, globalRow);
      }

      if (
        spawnObstacles && openingTraffic && (useObstacles || this.destroyCarMode) &&
        globalRow < config.earlyTraffic.forcedObstacleRows &&
        !obstacles.some((obstacle) => obstacle.z === z)
      ) {
        this.spawnForcedEarlyObstacle(obstacles, rng, z);
      }

      const earlyRampWindow = globalRow < config.earlyRampRows;
      const freeRampAllowed =
        this.lastFreeRampRow === null ||
        globalRow - this.lastFreeRampRow >= config.rampMinGapRows;
      const freeRampProbability = earlyRampWindow
        ? config.earlyRampProbability
        : config.rampProbability;
      if (
        this.mode === 'car' &&
        (useObstacles || earlyRampWindow) &&
        wallAllowed &&
        freeRampAllowed &&
        rng() < freeRampProbability
      ) {
        const freeLane = this.pickFreeLane(rng);
        const rampZ = z0 + row * config.minGapZ;
        if (this.canPlaceRampAt(rampZ)) {
          this.constraintLane = freeLane;
          this.reserveRamp(pendingRamps, row, freeLane);
          this.lastFreeRampRow = globalRow;
        }
      }
    }

    for (const gate of gatePlans) {
      for (let i = pendingRamps.length - 1; i >= 0; i--) {
        const pending = pendingRamps[i];
        if (pending.gateId === undefined) pendingRamps.splice(i, 1);
      }
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const obstacle = obstacles[i];
        const localRow = Math.round((obstacle.z - z0) / config.minGapZ);
        const approachStart = Math.max(0, gate.rampRow - config.rampLeadRows);
        const clearApproach = localRow >= approachStart && localRow <= gate.rampRow;
        const clearFlightCorridor =
          obstacle.lane === gate.lane &&
          localRow > gate.rampRow &&
          localRow < gate.wallRow;
        if (clearApproach || clearFlightCorridor) {
          obstacles.splice(i, 1);
        }
      }
      const approachStart = Math.max(0, gate.rampRow - config.rampLeadRows);
      for (let localRow = approachStart; localRow <= gate.rampRow; localRow++) {
        const guideZ = z0 + localRow * config.minGapZ;
        if (this.groundLaneBlocked(obstacles, gate.lane, guideZ)) continue;
        if (destroySpawn) {
          const microRowChance =
            destroySpawn.microRowChance *
            this.destroyNitroMicroScale(guideZ, destroySpawn);
          if (rng() < microRowChance * 0.65) {
            this.addMicroCluster(obstacles, rng, guideZ, gate.lane, destroySpawn);
          }
          continue;
        }
        const duplicate = coins.some(
          (coin) => coin.lane === gate.lane && Math.abs(coin.z - guideZ) < config.minGapZ * 0.45,
        );
        if (duplicate) continue;
        coins.push(this.makeCoin(gate.lane, guideZ, 'safeGuide'));
      }
    }

    for (const pending of pendingRamps) {
      const rampZ = z0 + pending.row * config.minGapZ;
      if (!this.canPlaceRampAt(rampZ)) continue;
      const approachLead = Math.max(
        config.minGapZ,
        config.minGapZ * config.fairness.microLeadMinGapZScale,
      );
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        if (o.lane !== pending.lane) continue;
        if (o.z === rampZ) {
          obstacles.splice(i, 1);
          continue;
        }
        if (
          o.kind === 'micro' ||
          o.kind === 'overhead' ||
          o.shoulderPasser ||
          o.redWall
        ) {
          continue;
        }
        if (o.z < rampZ && rampZ - o.z <= approachLead) {
          obstacles.splice(i, 1);
        }
      }
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        if (c.lane === pending.lane && c.z === rampZ) coins.splice(i, 1);
      }
      ramps.push(this.makeRamp(pending.lane, rampZ, pending.gateId));
      this.noteRampPlaced(rampZ);
    }

    this.pruneOverlappingGroundCoins(coins, obstacles);
    compactGroundObstacles(
      obstacles,
      config.minGapZ,
      {
        ...this.obstacleCompactionConfig(),
        mergeTallChains: config.carHazardSpacing.compactTallChains,
      },
    );
    const comfortRoute = this.enforceComfortableCarChunk(
      obstacles,
      ramps,
      z0,
      chunkEntryLane,
    );
    this.alignCarRouteGuides(
      obstacles,
      coins,
      ramps,
      comfortRoute.route,
      z0,
      rng,
      destroySpawn,
    );
    const exitLane = comfortRoute.route.at(-1)?.lane;
    if (exitLane !== undefined) this.constraintLane = exitLane;
    return { index, obstacles, coins, ramps };
  }

  private generateHorseChunk(index: number): Chunk {
    const config = this.config;
    const horse = config.horse;
    const chunkEntryLane = this.constraintLane ?? startLane(config);
    const rng = mulberry32((this.seedValue ^ index ^ 0x48f25) >>> 0);
    const horseModifiers = this.horsePhasePlanner.advanceChunk(
      rng,
      horse,
      this.longRunProgress,
    );
    const z0 = this.chunkStartZ(index);
    const scenery = this.advanceHorseScenery(index, z0);
    const numRows = Math.max(1, Math.floor(config.chunkLength / config.minGapZ));
    const obstacles: ObstacleEntity[] = [];
    const coins: CoinEntity[] = [];
    const spawnObstacles = this.obstaclesSpawnAllowed();
    const highSpeedEase = clamp(
      (this.horseMomentum - horse.highSpeedEaseStartMomentum) /
        Math.max(0.0001, 1 - horse.highSpeedEaseStartMomentum),
      0,
      1,
    );
    const actionMultiplier =
      1 - highSpeedEase * (1 - horse.highSpeedActionMultiplier);
    const mandatoryMultiplier =
      1 - highSpeedEase * (1 - horse.highSpeedMandatoryMultiplier);
    const followupMultiplier =
      1 - highSpeedEase * (1 - horse.highSpeedFollowupMultiplier);
    const followup = this.pendingHorseFollowup;
    this.pendingHorseFollowup = null;
    const introductoryChunk = this.horseChunksGenerated <= horse.slideStartChunks;
    const forcedDodgeChunk =
      !introductoryChunk &&
      this.horseChunksSinceDodge >= horse.dodgeOnlyMaxGapChunks;
    const restChunk =
      !introductoryChunk &&
      !forcedDodgeChunk &&
      followup === null &&
      (horseModifiers.activePhase === 'breather' && rng() < 0.55 * horseModifiers.restChunkScale ||
        this.horseEmptyChunkStreak >= 3 ||
        rng() <
          horse.restChunkProbability *
            horseModifiers.restChunkScale *
            (1 + highSpeedEase * 0.35));
    const restLane = restChunk ? (rng() < 0.5 ? 0 : config.lanes - 1) : null;
    const actionChunk =
      spawnObstacles &&
      !restChunk &&
      (introductoryChunk ||
        forcedDodgeChunk ||
        followup !== null ||
        rng() <
          horse.actionChunkProbability *
            horseModifiers.actionChunkScale *
            (0.75 + this.effectiveDensity * 0.25) *
            actionMultiplier);

    if (actionChunk) {
      const actionStartOffset = followup === null
        ? config.minGapZ * 0.5
        : config.minGapZ * 2;
      const slideAllowed = this.horseChunksGenerated >= horse.slideStartChunks;
      const action = this.pickHorseChunkAction(
        rng,
        followup,
        introductoryChunk,
        forcedDodgeChunk,
        slideAllowed,
        horseModifiers,
      );
      if (action === 'dodge') {
        const forceLane = this.pendingDodgeForceLane;
        this.pendingDodgeForceLane = null;
        const freeLane = forceLane === null
          ? this.pickFreeLane(rng)
          : this.allLanes().filter((lane) => lane !== forceLane)[
            Math.floor(rng() * (this.config.lanes - 1))
          ] ?? (forceLane + 1) % this.config.lanes;
        const blockCount = randomInt(
          rng,
          horse.dodgeBlockedMin,
          horse.dodgeBlockedMax,
        );
        let blocked = this.pickBlockedLanes(
          rng,
          freeLane,
          blockCount,
          index * numRows + 1,
        );
        if (horseModifiers.dodgeLaneStickiness > 0) {
          blocked = this.horsePhasePlanner.pickCorridorBlockedLanes(
            rng,
            freeLane,
            blocked,
            horseModifiers.dodgeLaneStickiness,
            config.lanes,
          );
        }
        if (forceLane !== null && !blocked.includes(forceLane)) {
          blocked = [forceLane, ...blocked.filter((lane) => lane !== freeLane)].slice(
            0,
            horse.dodgeBlockedMax,
          );
        }
        const groupId = this.nextActionGroupId++;
        const flowGroupId = this.nextFlowGroupId++;
        for (const lane of blocked) {
          if (lane === freeLane) continue;
          const obstacle = this.makeObstacle('tall', lane, z0 + actionStartOffset);
          obstacle.horseDodgeOnly = true;
          obstacle.actionGroupId = groupId;
          obstacle.flowGroupId = flowGroupId;
          obstacles.push(obstacle);
        }
        const dodgeZ = z0 + actionStartOffset;
        for (let offset = -1; offset <= 2; offset++) {
          const pathZ = dodgeZ + offset * config.minGapZ;
          if (
            pathZ >= z0 &&
            pathZ < z0 + config.chunkLength &&
            !this.groundLaneBlocked(obstacles, freeLane, pathZ)
          ) {
            const pathCoin = this.makeCoin(freeLane, pathZ);
            pathCoin.routeKind = 'safeGuide';
            pathCoin.actionGroupId = groupId;
            pathCoin.flowGroupId = flowGroupId;
            coins.push(pathCoin);
          }
        }
        this.constraintLane = freeLane;
      } else {
        const convertibleSlide = action === 'slide' && this.horseConvertible;
        const longSlide =
          action === 'slide' &&
          !convertibleSlide &&
          rng() < horse.longSlideGroupProbability;
        const minCount = Math.max(
          1,
          (action === 'slide'
            ? longSlide
              ? horse.longSlideGroupMin
              : horse.slideGroupMin
            : horse.jumpGroupMin) + Math.floor(horseModifiers.groupSizeBonus),
        );
        const maxCount = Math.max(
          minCount,
          (action === 'slide'
            ? longSlide
              ? horse.longSlideGroupMax
              : horse.slideGroupMax
            : horse.jumpGroupMax) + Math.ceil(horseModifiers.groupSizeBonus),
        );
        const spacing = action === 'slide' ? horse.slideSpacingZ : config.minGapZ;
        const maxFitting = Math.max(
          1,
          Math.floor((config.chunkLength - actionStartOffset - 1) / spacing) + 1,
        );
        const count = Math.min(maxFitting, randomInt(rng, minCount, maxCount));
        const mandatory = convertibleSlide
          ? false
          : rng() <
            horse.mandatoryActionProbability *
              mandatoryMultiplier *
              horseModifiers.mandatoryActionScale;
        const freeLane = mandatory
          ? null
          : convertibleSlide
            ? this.constraintLane === 0 || this.constraintLane === config.lanes - 1
              ? this.constraintLane
              : rng() < 0.5 ? 0 : config.lanes - 1
            : Math.floor(rng() * config.lanes);
        const groupId = this.nextActionGroupId++;
        const flowGroupId = this.nextFlowGroupId++;
        const placeJumpCoins =
          action === 'jump' &&
          rng() <
            Math.min(
              1,
              horse.jumpCoinGroupProbability + horseModifiers.jumpCoinProbabilityBonus,
            );
        const placeSlideCoins =
          action === 'slide' &&
          (convertibleSlide || rng() < horse.slideCoinProbability);
        for (let actionIndex = 0; actionIndex < count; actionIndex++) {
          const z = z0 + actionStartOffset + actionIndex * spacing;
          for (const lane of this.allLanes()) {
            if (lane === freeLane) continue;
            const obstacle = this.makeObstacle(
              action === 'slide' ? 'overhead' : 'low',
              lane,
              z,
            );
            obstacle.horseAction = action;
            obstacle.actionGroupId = groupId;
            obstacle.actionIndex = actionIndex;
            obstacle.actionCount = count;
            obstacle.flowGroupId = flowGroupId;
            obstacles.push(obstacle);
            if (placeJumpCoins) {
              const coin = this.makeCoin(lane, z);
              coin.y = horse.jumpCoinHeight;
              coin.actionGroupId = groupId;
              coin.flowGroupId = flowGroupId;
              coins.push(coin);
            } else if (placeSlideCoins) {
              const coin = this.makeCoin(lane, z);
              coin.y = config.coinHeight * 0.5;
              coin.actionGroupId = groupId;
              coin.flowGroupId = flowGroupId;
              coins.push(coin);
            }
          }
          if (freeLane !== null && !this.groundLaneBlocked(obstacles, freeLane, z)) {
            const pathCoin = this.makeCoin(freeLane, z);
            pathCoin.routeKind = 'safeGuide';
            pathCoin.actionGroupId = groupId;
            pathCoin.flowGroupId = flowGroupId;
            coins.push(pathCoin);
          }
        }
        if (freeLane !== null) this.constraintLane = freeLane;
        if (convertibleSlide && freeLane !== null) {
          const slideEndZ = z0 + actionStartOffset + (count - 1) * spacing;
          const punishZ = slideEndZ + horse.convertibleShoulderPunishGapZ;
          const chunkEnd = z0 + config.chunkLength;
          if (punishZ < chunkEnd - 1) {
            const punish = this.makeObstacle('tall', freeLane, punishZ);
            punish.horseDodgeOnly = true;
            punish.actionGroupId = this.nextActionGroupId++;
            punish.flowGroupId = this.nextFlowGroupId++;
            obstacles.push(punish);
          } else {
            this.pendingHorseFollowup = 'dodge';
            this.pendingDodgeForceLane = freeLane;
          }
        } else if (
          action === 'jump' &&
          !introductoryChunk &&
          rng() < horse.jumpFollowupProbability * followupMultiplier * horseModifiers.followupScale
        ) {
          this.pendingHorseFollowup = rng() < horse.jumpFollowupSlideProbability
            ? 'slide'
            : 'dodge';
        } else if (
          action === 'slide' &&
          !introductoryChunk &&
          this.pendingHorseFollowup === null &&
          rng() < horse.slideFollowupDodgeProbability * followupMultiplier * horseModifiers.followupScale
        ) {
          this.pendingHorseFollowup = 'dodge';
        }
      }
      this.recentHorseActions.push(action);
      if (this.recentHorseActions.length > 6) this.recentHorseActions.shift();
    } else {
      this.recentHorseActions = [];
    }

    if (restLane !== null) {
      const groupId = this.nextActionGroupId++;
      const flowGroupId = this.nextFlowGroupId++;
      const z = z0 + config.minGapZ * 2;
      for (const lane of this.allLanes()) {
        if (lane === restLane) continue;
        const obstacle = this.makeObstacle('low', lane, z);
        obstacle.horseAction = 'jump';
        obstacle.actionGroupId = groupId;
        obstacle.actionIndex = 0;
        obstacle.actionCount = 1;
        obstacle.flowGroupId = flowGroupId;
        obstacles.push(obstacle);
      }
      this.constraintLane = restLane;
    }

    const firstJump = obstacles
      .filter((obstacle) => obstacle.horseAction === 'jump')
      .sort((a, b) => a.z - b.z)[0];
    if (
      firstJump &&
      this.lastHorseSlideEndZ !== null &&
      firstJump.z - this.lastHorseSlideEndZ < horse.slideToJumpMinGapZ
    ) {
      const groupId = firstJump.actionGroupId;
      for (let i = obstacles.length - 1; i >= 0; i--) {
        if (obstacles[i].actionGroupId === groupId) obstacles.splice(i, 1);
      }
      for (let i = coins.length - 1; i >= 0; i--) {
        if (coins[i].actionGroupId === groupId) coins.splice(i, 1);
      }
      this.pendingHorseFollowup = 'jump';
    }
    const slideEnd = obstacles
      .filter((obstacle) => obstacle.horseAction === 'slide')
      .reduce<number | null>(
        (latest, obstacle) => latest === null ? obstacle.z : Math.max(latest, obstacle.z),
        null,
      );
    if (slideEnd !== null) this.lastHorseSlideEndZ = slideEnd;

    for (let row = 0; row < numRows; row++) {
      const z = z0 + row * config.minGapZ;
      const occupied = obstacles.some(
        (obstacle) => Math.abs(obstacle.z - z) < config.minGapZ * 0.6,
      );
      const restCoinRow =
        restLane !== null && row % horse.restCoinStride === 0;
      if (
        !occupied &&
        (restCoinRow ||
          (restLane === null &&
            rng() <
              horse.groundCoinProbability *
                this.effectiveCoinFrequency *
                horseModifiers.groundCoinScale))
      ) {
        const lane = this.pickHorseGroundCoinLane(
          rng,
          obstacles,
          z,
          horse,
          restLane,
          row,
        );
        if (
          lane === null ||
          this.groundLaneBlocked(obstacles, lane, z) ||
          (lane === this.horseCoinLane &&
            this.horseCoinLaneStreak >= horse.coinMaxSameLaneStreak)
        ) {
          continue;
        }
        this.trackHorseCoinLane(lane);
        coins.push(this.makeCoin(lane, z));
        coins.at(-1)!.routeKind = 'safeGuide';
      }
    }
    this.horseEmptyChunkStreak =
      obstacles.length === 0 && coins.length === 0
        ? this.horseEmptyChunkStreak + 1
        : 0;
    this.horseChunksSinceDodge = obstacles.some((obstacle) => obstacle.horseDodgeOnly)
      ? 0
      : this.horseChunksSinceDodge + 1;
    this.horseChunksGenerated += 1;
    this.pruneOverlappingGroundCoins(coins, obstacles);
    const comfortRoute = findComfortableHorseRoute(
      obstacles,
      config,
      z0,
      chunkEntryLane,
    );
    this.alignHorseRouteGuides(obstacles, coins, comfortRoute.route, z0);
    this.diversifyHorseCoinLanes(obstacles, coins, horse.coinMaxSameLaneStreak);
    if (scenery.theme !== null) {
      for (const obstacle of obstacles) obstacle.visualTheme = scenery.theme;
    }
    const exitLane = comfortRoute.route.at(-1)?.lane;
    if (exitLane !== undefined) this.constraintLane = exitLane;
    return {
      index,
      obstacles,
      coins,
      ramps: [],
      sceneryZones: scenery.zones,
    };
  }

  private advanceHorseScenery(
    index: number,
    z0: number,
  ): { theme: SceneryTheme | null; zones: SceneryZoneEntity[] } {
    const horse = this.config.horse;
    const zones: SceneryZoneEntity[] = [];
    if (this.horseTownChunksRemaining <= 0) {
      if (this.horseTownCooldownChunks > 0) {
        this.horseTownCooldownChunks -= 1;
      } else if (this.horseChunksGenerated >= horse.frontierTownIntroChunks) {
        const themeRng = mulberry32((this.seedValue ^ index ^ 0x71f0a17) >>> 0);
        if (themeRng() < horse.frontierTownProbability) {
          const duration =
            horse.frontierTownMinChunks +
            Math.floor(
              themeRng() *
                (horse.frontierTownMaxChunks - horse.frontierTownMinChunks + 1),
            );
          this.horseTownChunksRemaining = duration;
          this.horseTownCooldownChunks = horse.frontierTownCooldownChunks;
          zones.push({
            id: this.nextSceneryZoneId++,
            theme: 'frontierTown',
            z: z0,
            length: duration * this.config.chunkLength,
          });
        }
      }
    }
    if (this.horseTownChunksRemaining <= 0) return { theme: null, zones };
    this.horseTownChunksRemaining -= 1;
    return { theme: 'frontierTown', zones };
  }

  fillOpeningContent(
    obstacles: ObstacleEntity[],
    coins: CoinEntity[],
    ramps: RampEntity[],
    firstNewZ: number,
  ): { obstacles: ObstacleEntity[]; coins: CoinEntity[] } {
    const addedObstacles: ObstacleEntity[] = [];
    const addedCoins: CoinEntity[] = [];
    if (this.mode !== 'car' || !this.obstaclesSpawnAllowed() ||
      this.config.segmentWeights.obstacle + this.config.segmentWeights.coins + this.config.segmentWeights.bonus === 0) {
      return { obstacles: addedObstacles, coins: addedCoins };
    }
    const start = Math.max(firstNewZ, this.config.contentStartZ);
    const end = Math.min(
      this.chunkStartZ(this.lastGenerated + 1),
      this.config.contentStartZ + this.config.earlyTraffic.rows * this.config.minGapZ,
    ) - this.trafficPlayerDistance;
    const radius = this.config.earlyTraffic.maxOpeningEmptyGapZ / 2;
    const horizon = [...obstacles];
    for (let z = start; z < end; z += this.config.minGapZ) {
      const nearby = [...horizon, ...coins, ...addedCoins, ...ramps]
        .some(entity => Math.abs(entity.z - z) <= radius);
      if (nearby) continue;
      for (let lane = 0; lane < this.config.lanes; lane++) {
        if (!this.carMicroGeometryClear(horizon, ramps, lane, z) ||
          !this.openingPickupContinuationClear(horizon, ramps, lane, z)) continue;
        if (this.destroyCarMode) {
          const micro = this.makeObstacle('micro', lane, z);
          horizon.push(micro);
          addedObstacles.push(micro);
        } else {
          addedCoins.push(this.makeCoin(lane, z, 'safeGuide'));
        }
        break;
      }
    }
    return { obstacles: addedObstacles, coins: addedCoins };
  }

  private openingPickupContinuationClear(
    obstacles: ObstacleEntity[],
    ramps: RampEntity[],
    lane: number,
    z: number,
  ): boolean {
    return this.carRouteSpeeds().every(playerSpeed => {
      const arrival = z / carTrafficScrollSpeed(playerSpeed, lane, this.config);
      const future = obstacles.map(obstacle => ({
        ...obstacle,
        z: obstacle.z - carTrafficScrollSpeed(playerSpeed, obstacle.lane, this.config, obstacle) * arrival,
      })).filter(obstacle => obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2 >= 0);
      const futureRamps = ramps.map(ramp => ({
        ...ramp,
        z: ramp.z - (ramp.gateId === undefined
          ? carTrafficScrollSpeed(playerSpeed, ramp.lane, this.config)
          : playerSpeed) * arrival,
      })).filter(ramp => ramp.z >= 0);
      return findComfortableCarRoute(future, this.config, futureRamps, {
        playerSpeed, startLanes: [lane],
      }).passable;
    });
  }

  private carRouteSpeeds(): number[] {
    const { referenceSpeed, speedSampleStep } = this.config.fairness;
    const speeds = [referenceSpeed];
    for (let speed = this.carFairnessMinSpeed ?? referenceSpeed; speed < referenceSpeed; speed += speedSampleStep) {
      speeds.push(speed);
    }
    return speeds;
  }

  private enforceComfortableCarChunk(
    obstacles: ObstacleEntity[],
    ramps: RampEntity[],
    chunkStartZ: number,
    entryLane: number,
    repairScope?: CarHorizonRepairScope,
    routeStartZ = chunkStartZ,
  ): ComfortableCarRouteResult {
    const fairness = this.config.fairness;
    const canRepairObstacle = (obstacle: ObstacleEntity): boolean =>
      repairScope === undefined || repairScope.obstacleIds.has(obstacle.id);
    const canRepairRamp = (ramp: RampEntity): boolean =>
      repairScope === undefined || repairScope.rampIds.has(ramp.id);
    let failureSpeed = fairness.referenceSpeed;
    const certify = (): ComfortableCarRouteResult => {
      let primary: ComfortableCarRouteResult | undefined;
      for (const playerSpeed of this.carRouteSpeeds()) {
        const result = findComfortableCarRoute(
          obstacles.filter((obstacle) =>
            obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2 >= routeStartZ,
          ),
          this.config,
          ramps.filter((ramp) => ramp.z >= routeStartZ),
          { playerDistance: routeStartZ, playerSpeed, startLanes: [entryLane] },
        );
        primary ??= result;
        if (!result.passable) {
          failureSpeed = playerSpeed;
          return result;
        }
      }
      return primary!;
    };
    const encounterTime = (obstacle: ObstacleEntity): number => {
      const relative = carTrafficScrollSpeed(failureSpeed, obstacle.lane, this.config, obstacle);
      return Math.max(0, (obstacle.z - routeStartZ) / relative);
    };

    let result = certify();
    let repairs = 0;
    while (!result.passable && repairs < obstacles.length) {
      const failureTime = result.failureTime ?? 0;
      const candidate = obstacles
        .filter((obstacle) =>
          obstacle.z >= chunkStartZ &&
          obstacle.trainId === undefined &&
          obstacle.kind !== 'micro' &&
          !obstacle.redWall &&
          !obstacle.nitroMandatory &&
          canRepairObstacle(obstacle),
        )
        .sort((a, b) => {
          const aTimeDelta = Math.abs(encounterTime(a) - failureTime);
          const bTimeDelta = Math.abs(encounterTime(b) - failureTime);
          if (Math.abs(aTimeDelta - bTimeDelta) > 0.12) {
            return aTimeDelta - bTimeDelta;
          }
          const riskDelta = Number(this.isRiskLane(a.lane)) - Number(this.isRiskLane(b.lane));
          if (riskDelta !== 0) return riskDelta;
          if (a.kind === b.kind) return a.id - b.id;
          return a.kind === 'tall' ? -1 : 1;
        })[0];
      if (!candidate) break;
      if (candidate.nitroChallenge && candidate.challengeId !== undefined) {
        for (let index = obstacles.length - 1; index >= 0; index--) {
          if (
            obstacles[index].challengeId === candidate.challengeId &&
            canRepairObstacle(obstacles[index])
          ) {
            obstacles.splice(index, 1);
          }
        }
      } else {
        obstacles.splice(obstacles.indexOf(candidate), 1);
      }
      repairs += 1;
      result = certify();
    }

    if (!result.passable) {
      for (let index = obstacles.length - 1; index >= 0; index--) {
        const obstacle = obstacles[index];
        if (
          obstacle.z < chunkStartZ ||
          obstacle.trainId !== undefined ||
          obstacle.kind === 'micro' ||
          obstacle.redWall ||
          obstacle.nitroMandatory ||
          !canRepairObstacle(obstacle)
        ) {
          continue;
        }
        obstacles.splice(index, 1);
      }
      result = certify();
    }

    while (!result.passable) {
      const redWall = obstacles
        .filter((obstacle) =>
          obstacle.redWall &&
          obstacle.z >= chunkStartZ &&
          canRepairObstacle(obstacle),
        )
        .sort((a, b) => a.z - b.z)[0];
      if (!redWall) break;
      const gateId = redWall.gateId;
      for (let index = obstacles.length - 1; index >= 0; index--) {
        const obstacle = obstacles[index];
        if (
          obstacle.redWall &&
          canRepairObstacle(obstacle) &&
          (gateId === undefined
            ? Math.abs(obstacle.z - redWall.z) < this.config.minGapZ * 0.5
            : obstacle.gateId === gateId)
        ) {
          obstacles.splice(index, 1);
        }
      }
      for (let index = ramps.length - 1; index >= 0; index--) {
        if (!canRepairRamp(ramps[index])) continue;
        if (
          gateId === undefined
            ? ramps[index].z < redWall.z &&
              redWall.z - ramps[index].z <=
                this.config.rampLeadRows * this.config.minGapZ
            : ramps[index].gateId === gateId
        ) {
          ramps.splice(index, 1);
        }
      }
      result = certify();
    }

    return result;
  }

  repairCarHorizon(
    obstacles: ObstacleEntity[],
    ramps: RampEntity[],
    entryLane: number,
    repairScope?: CarHorizonRepairScope,
  ): ComfortableCarRouteResult {
    const minRepairLeadZ = this.config.contentStartZ;
    const protectedGateIds = new Set(
      ramps
        .filter((ramp) => ramp.z < minRepairLeadZ && ramp.gateId !== undefined)
        .map((ramp) => ramp.gateId!),
    );
    const roadObstacles = obstacles.filter(
      (obstacle) =>
        obstacle.trainId === undefined &&
        obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2 >= 0 &&
        (obstacle.gateId === undefined || !protectedGateIds.has(obstacle.gateId)),
    );
    const roadRamps = ramps.filter((ramp) => ramp.z >= 0);
    this.enforceComfortableCarChunk(
      roadObstacles,
      roadRamps,
      minRepairLeadZ,
      entryLane,
      repairScope,
      0,
    );
    const plannedRoute = findComfortableCarRoute(
      roadObstacles,
      this.config,
      roadRamps,
      {
        playerDistance: 0,
        playerSpeed: this.config.fairness.referenceSpeed,
        startLanes: [entryLane],
      },
    );
    this.sanitizeCarMicroPlacement(
      roadObstacles,
      roadRamps,
      plannedRoute.route,
      minRepairLeadZ,
      repairScope,
    );
    this.clearStagedBlockingAheadOfPublishedMicros(roadObstacles, repairScope);
    for (const cluster of this.collectMicroClusters(roadObstacles)) {
      const lane = cluster[0]?.lane;
      if (lane === undefined) continue;
      const published = repairScope !== undefined &&
        cluster.some((micro) => !repairScope.obstacleIds.has(micro.id));
      if (repairScope !== undefined && !published) continue;
      this.enforceComfortableCarChunk(
        roadObstacles,
        roadRamps,
        this.microClusterCenterZ(cluster),
        lane,
        repairScope,
      );
    }
    const result = findComfortableCarRoute(
      roadObstacles,
      this.config,
      roadRamps,
      {
        playerDistance: 0,
        playerSpeed: this.config.fairness.referenceSpeed,
        startLanes: [entryLane],
      },
    );
    const keptIds = new Set(roadObstacles.map((obstacle) => obstacle.id));
    for (let index = obstacles.length - 1; index >= 0; index--) {
      const obstacle = obstacles[index];
      if (
        obstacle.trainId === undefined &&
        obstacle.z >= minRepairLeadZ &&
        (obstacle.gateId === undefined || !protectedGateIds.has(obstacle.gateId)) &&
        (repairScope === undefined || repairScope.obstacleIds.has(obstacle.id)) &&
        !keptIds.has(obstacle.id)
      ) {
        obstacles.splice(index, 1);
      }
    }
    const keptRampIds = new Set(roadRamps.map((ramp) => ramp.id));
    for (let index = ramps.length - 1; index >= 0; index--) {
      if (
        ramps[index].z >= minRepairLeadZ &&
        (repairScope === undefined || repairScope.rampIds.has(ramps[index].id)) &&
        !keptRampIds.has(ramps[index].id)
      ) {
        ramps.splice(index, 1);
      }
    }
    return result;
  }

  private alignCarRouteGuides(
    obstacles: ObstacleEntity[],
    coins: CoinEntity[],
    ramps: RampEntity[],
    route: CarRoutePoint[],
    chunkStartZ: number,
    rng: () => number,
    destroySpawn: DestroySpawnConfig | null,
  ): void {
    if (route.length === 0) return;
    const hasMeaningfulRoute = route.length > 1;
    if (hasMeaningfulRoute) {
      for (const coin of coins) {
        if (coin.routeKind !== 'safeGuide') continue;
        const lane = this.routeLaneAtZ(route, coin.z, chunkStartZ);
        if (lane !== null && !this.groundLaneBlocked(obstacles, lane, coin.z, coin.y)) {
          coin.lane = lane;
        }
      }
    }

    if (!destroySpawn) {
      this.preserveRiskCoinIncentive(coins, obstacles);
      return;
    }
    const originalMicroCount = obstacles.filter(
      (obstacle) => obstacle.kind === 'micro',
    ).length;
    let clusters = this.collectMicroClusters(obstacles);
    const usedClusters = new Set<ObstacleEntity[]>();

    for (const ramp of ramps) {
      const desired = ramp.gateId === undefined
        ? this.config.fairness.freeRampGuideClusters
        : this.config.fairness.mandatoryRampGuideClusters;
      for (let index = desired; index >= 1; index--) {
        const targetZ = ramp.z - index * this.config.minGapZ;
        if (targetZ < chunkStartZ) continue;
        const available = clusters
          .filter((cluster) => !usedClusters.has(cluster))
          .sort((a, b) =>
            Math.abs(this.microClusterCenterZ(a) - targetZ) -
            Math.abs(this.microClusterCenterZ(b) - targetZ),
          )[0];
        if (available) {
          const centerZ = this.microClusterCenterZ(available);
          if (!available.every((micro) =>
            this.carMicroGeometryClear(
              obstacles,
              ramps,
              ramp.lane,
              targetZ + (micro.z - centerZ),
              available,
            )
          )) {
            continue;
          }
          for (const micro of available) {
            micro.lane = ramp.lane;
            micro.z = targetZ + (micro.z - centerZ);
            micro.routeGuide = true;
            micro.rampGuideId = ramp.id;
            micro.rampOffsetZ = micro.z - ramp.z;
          }
          for (let microIndex = available.length; microIndex < 2; microIndex++) {
            const sampleZ = targetZ + microIndex * this.config.minGapZ * 0.32;
            if (!this.carMicroGeometryClear(
              obstacles,
              ramps,
              ramp.lane,
              sampleZ,
              available,
            )) {
              continue;
            }
            const micro = this.makeObstacle('micro', ramp.lane, sampleZ);
            micro.routeGuide = true;
            micro.rampGuideId = ramp.id;
            micro.rampOffsetZ = micro.z - ramp.z;
            obstacles.push(micro);
            available.push(micro);
          }
          usedClusters.add(available);
        } else {
          const pairZ = [0, 1].map(
            (microIndex) => targetZ + microIndex * this.config.minGapZ * 0.32,
          );
          if (!pairZ.every((sampleZ) =>
            this.carMicroGeometryClear(obstacles, ramps, ramp.lane, sampleZ)
          )) {
            continue;
          }
          const cluster = pairZ.map((sampleZ) => {
            const micro = this.makeObstacle('micro', ramp.lane, sampleZ);
            micro.routeGuide = true;
            micro.rampGuideId = ramp.id;
            micro.rampOffsetZ = micro.z - ramp.z;
            obstacles.push(micro);
            return micro;
          });
          clusters.push(cluster);
          usedClusters.add(cluster);
        }
      }
    }

    clusters = this.collectMicroClusters(obstacles);
    const targetGuidedClusters = Math.ceil(
      clusters.length * this.config.fairness.routeGuideShare,
    );
    let guidedClusters = clusters.filter((cluster) =>
      cluster.some((micro) => micro.routeGuide),
    ).length;
    const guideCandidates = clusters
      .filter((cluster) => !cluster.some((micro) => micro.routeGuide))
      .map((cluster) => ({ cluster, roll: rng() }))
      .sort((a, b) => a.roll - b.roll);
    for (const { cluster } of guideCandidates) {
      if (guidedClusters >= targetGuidedClusters) break;
      const centerZ = this.microClusterCenterZ(cluster);
      const lane = this.routeLaneAtZ(route, centerZ, chunkStartZ);
      if (
        lane === null ||
        !cluster.every((micro) =>
          this.carMicroPlacementClear(obstacles, ramps, lane, micro.z, cluster),
        )
      ) {
        continue;
      }
      for (const micro of cluster) {
        micro.lane = lane;
        micro.routeGuide = true;
      }
      guidedClusters += 1;
    }

    const softCap = originalMicroCount + Math.max(
      2,
      Math.ceil(originalMicroCount * 0.05),
    );
    let currentMicroCount = obstacles.filter(
      (obstacle) => obstacle.kind === 'micro',
    ).length;
    for (let index = obstacles.length - 1; index >= 0 && currentMicroCount > softCap; index--) {
      const obstacle = obstacles[index];
      if (obstacle.kind !== 'micro' || obstacle.routeGuide) continue;
      obstacles.splice(index, 1);
      currentMicroCount -= 1;
    }
    this.sanitizeCarMicroPlacement(
      obstacles,
      ramps,
      route,
      chunkStartZ,
    );
  }

  private alignHorseRouteGuides(
    obstacles: ObstacleEntity[],
    coins: CoinEntity[],
    route: HorseRoutePoint[],
    chunkStartZ: number,
  ): void {
    if (route.length === 0) return;

    const groups = new Map<number, ObstacleEntity[]>();
    for (const obstacle of obstacles) {
      if (obstacle.actionGroupId === undefined || obstacle.horseAction === undefined) continue;
      const group = groups.get(obstacle.actionGroupId) ?? [];
      group.push(obstacle);
      groups.set(obstacle.actionGroupId, group);
    }
    for (const group of groups.values()) {
      if (new Set(group.map((obstacle) => obstacle.lane)).size < this.config.lanes) continue;
      const actionZ = Math.min(...group.map((obstacle) => obstacle.z));
      for (const leadScale of [1, 0.5]) {
        const guideZ = actionZ - this.config.minGapZ * leadScale;
        if (guideZ < chunkStartZ) continue;
        const lane = horseRouteLaneAtZ(route, guideZ);
        if (lane === null || this.groundLaneBlocked(obstacles, lane, guideZ)) continue;
        const existing = coins.find(
          (coin) =>
            Math.abs(coin.z - guideZ) < this.config.minGapZ * 0.2 &&
            (coin.y ?? this.config.coinHeight) <= this.config.coinHeight,
        );
        if (existing) {
          existing.lane = lane;
          existing.routeKind = 'safeGuide';
          continue;
        }
        coins.push(this.makeCoin(lane, guideZ, 'safeGuide'));
      }
    }
  }

  private routeLaneAtZ(
    route: CarRoutePoint[],
    z: number,
    chunkStartZ: number,
  ): number | null {
    if (route.length === 0) return null;
    const targetTime = Math.max(
      0,
      (z - chunkStartZ) / this.config.fairness.referenceSpeed,
    );
    return route.find((point) => point.time + 1e-6 >= targetTime)?.lane ??
      route.at(-1)!.lane;
  }

  private preserveRiskCoinIncentive(
    coins: CoinEntity[],
    obstacles: ObstacleEntity[],
  ): void {
    const riskLanes = this.config.riskZone.riskLanes;
    const safeLanes = this.allLanes().filter((lane) => !riskLanes.includes(lane));
    if (riskLanes.length === 0 || safeLanes.length === 0) return;
    const countIn = (lanes: number[]): number =>
      coins.filter((coin) => lanes.includes(coin.lane)).length;
    let riskCount = countIn(riskLanes);
    let safeCount = countIn(safeLanes);
    const riskFloorRatio = 1 + (this.config.riskZone.coinWeight - 1) * 0.4;
    const targetRiskCount = Math.ceil(
      (safeCount / safeLanes.length) * riskFloorRatio * riskLanes.length,
    );
    if (riskCount >= targetRiskCount) return;
    const candidates = coins
      .filter((coin) => coin.routeKind !== 'safeGuide' && safeLanes.includes(coin.lane))
      .sort((a, b) => a.id - b.id);
    for (const coin of candidates) {
      if (riskCount >= targetRiskCount) break;
      const lane = riskLanes.find(
        (riskLane) => !this.groundLaneBlocked(obstacles, riskLane, coin.z, coin.y),
      );
      if (lane === undefined) continue;
      coin.lane = lane;
      coin.routeKind = 'riskChoice';
      riskCount += 1;
      safeCount -= 1;
    }
  }

  private collectMicroClusters(obstacles: ObstacleEntity[]): ObstacleEntity[][] {
    const micros = obstacles
      .filter((obstacle) => obstacle.kind === 'micro')
      .sort((a, b) => a.lane - b.lane || a.z - b.z || a.id - b.id);
    const clusters: ObstacleEntity[][] = [];
    for (const micro of micros) {
      const last = clusters.at(-1);
      const lastMicro = last?.at(-1);
      if (
        last &&
        lastMicro &&
        lastMicro.lane === micro.lane &&
        micro.z - lastMicro.z <= this.config.minGapZ * 0.55
      ) {
        last.push(micro);
      } else {
        clusters.push([micro]);
      }
    }
    return clusters;
  }

  private microClusterCenterZ(cluster: ObstacleEntity[]): number {
    return cluster.reduce((sum, micro) => sum + micro.z, 0) / cluster.length;
  }

  private microContinuationPassable(
    obstacles: ObstacleEntity[],
    ramps: RampEntity[],
    lane: number,
    z: number,
  ): boolean {
    return this.carRouteSpeeds().every(playerSpeed => findComfortableCarRoute(
      obstacles.filter((obstacle) =>
        obstacle.z + Math.max(0, obstacle.zExtent ?? 0) / 2 >= z,
      ),
      this.config,
      ramps.filter((ramp) => ramp.z >= z),
      {
        playerDistance: z,
        playerSpeed,
        startLanes: [lane],
      },
    ).passable);
  }

  private carMicroGeometryClear(
    obstacles: ObstacleEntity[],
    ramps: RampEntity[],
    lane: number,
    z: number,
    ignoredCluster: ObstacleEntity[] = [],
  ): boolean {
    const ignored = new Set(ignoredCluster);
    if (!isReadableMicroPlacement(
      obstacles,
      ramps,
      this.config,
      lane,
      z,
      ignored,
    )) {
      return false;
    }
    const overlapTol = this.config.minGapZ * 0.5;
    return !obstacles.some((obstacle) =>
      !ignored.has(obstacle) &&
      obstacle.kind === 'micro' &&
      obstacle.lane === lane &&
      Math.abs(obstacle.z - z) < overlapTol,
    );
  }

  private carMicroPlacementClear(
    obstacles: ObstacleEntity[],
    ramps: RampEntity[],
    lane: number,
    z: number,
    ignoredCluster: ObstacleEntity[] = [],
  ): boolean {
    return this.carMicroGeometryClear(obstacles, ramps, lane, z, ignoredCluster) &&
      this.microContinuationPassable(obstacles, ramps, lane, z);
  }

  private sanitizeCarMicroPlacement(
    obstacles: ObstacleEntity[],
    ramps: RampEntity[],
    route: CarRoutePoint[],
    chunkStartZ: number,
    repairScope?: CarHorizonRepairScope,
  ): void {
    const canTouch = (obstacle: ObstacleEntity): boolean =>
      repairScope === undefined || repairScope.obstacleIds.has(obstacle.id);
    const refill = repairScope === undefined;
    const desiredCount = obstacles.filter((obstacle) =>
      obstacle.kind === 'micro',
    ).length;
    for (const cluster of this.collectMicroClusters(obstacles)) {
      if (!cluster.every(canTouch)) continue;
      const rampId = cluster.find((micro) => micro.rampGuideId !== undefined)
        ?.rampGuideId;
      const ramp = rampId === undefined
        ? undefined
        : ramps.find((item) => item.id === rampId);
      const rampLane = ramp?.lane;
      const geometryOnly = rampLane !== undefined;
      if (cluster.every((micro) =>
        geometryOnly
          ? this.carMicroGeometryClear(obstacles, ramps, micro.lane, micro.z, cluster)
          : this.carMicroPlacementClear(obstacles, ramps, micro.lane, micro.z, cluster)
      )) {
        continue;
      }
      const centerZ = this.microClusterCenterZ(cluster);
      const preferred = rampLane ??
        this.routeLaneAtZ(route, centerZ, chunkStartZ);
      const candidateLanes = this.microRelocationLanes(preferred);
      const offsets = cluster.map((micro) => micro.z - centerZ);
      const tryPlaceAt = (lane: number, nextCenterZ: number): boolean => {
        const clear = geometryOnly
          ? this.carMicroGeometryClear.bind(this)
          : this.carMicroPlacementClear.bind(this);
        if (!offsets.every((offset) =>
          clear(obstacles, ramps, lane, nextCenterZ + offset, cluster)
        )) {
          return false;
        }
        const shift = nextCenterZ - centerZ;
        for (const micro of cluster) {
          micro.lane = lane;
          micro.z += shift;
          if (micro.rampGuideId !== undefined && ramp) {
            micro.rampOffsetZ = micro.z - ramp.z;
          }
          if (lane === preferred && preferred !== null) {
            micro.routeGuide = true;
          }
        }
        return true;
      };
      let placed = false;
      for (const lane of candidateLanes) {
        if (rampLane !== undefined && lane !== rampLane) continue;
        if (tryPlaceAt(lane, centerZ)) {
          placed = true;
          break;
        }
      }
      if (!placed && rampLane !== undefined) {
        for (const scale of [0.5, 1, 1.5, 2, 2.5, 3]) {
          const shifted = centerZ - this.config.minGapZ * scale;
          if (shifted < chunkStartZ) continue;
          if (tryPlaceAt(rampLane, shifted)) {
            placed = true;
            break;
          }
        }
      }
      if (placed) continue;
      for (let index = obstacles.length - 1; index >= 0; index--) {
        if (cluster.includes(obstacles[index])) {
          obstacles.splice(index, 1);
        }
      }
    }
    if (!refill) return;
    let current = obstacles.filter((obstacle) => obstacle.kind === 'micro').length;
    if (current >= desiredCount || route.length === 0) return;
    const stride = this.config.minGapZ * 0.85;
    const fillEndZ = Math.max(
      chunkStartZ + this.config.chunkLength,
      ...obstacles.map((obstacle) => obstacle.z),
    );
    for (
      let z = chunkStartZ + this.config.minGapZ;
      z < fillEndZ && current < desiredCount;
      z += stride
    ) {
      const lane = this.routeLaneAtZ(route, z, chunkStartZ);
      if (lane === null) continue;
      const pairZ = [z, z + this.config.minGapZ * 0.32];
      if (!pairZ.every((sampleZ) =>
        this.carMicroPlacementClear(obstacles, ramps, lane, sampleZ)
      )) {
        continue;
      }
      for (const sampleZ of pairZ) {
        if (current >= desiredCount) break;
        const micro = this.makeObstacle('micro', lane, sampleZ);
        micro.routeGuide = true;
        obstacles.push(micro);
        current += 1;
      }
    }
  }

  private microRelocationLanes(preferred: number | null): number[] {
    const lanes = this.allLanes();
    if (preferred === null) return lanes;
    return [...lanes].sort((a, b) => {
      const byRoute = Math.abs(a - preferred) - Math.abs(b - preferred);
      if (byRoute !== 0) return byRoute;
      return a - b;
    });
  }

  private clearStagedBlockingAheadOfPublishedMicros(
    obstacles: ObstacleEntity[],
    repairScope?: CarHorizonRepairScope,
  ): void {
    if (repairScope === undefined) return;
    const minLeadZ = this.config.minGapZ * this.config.fairness.microLeadMinGapZScale;
    for (const cluster of this.collectMicroClusters(obstacles)) {
      const published = cluster.filter((micro) => !repairScope.obstacleIds.has(micro.id));
      if (published.length === 0) continue;
      for (const micro of published) {
        for (let index = obstacles.length - 1; index >= 0; index--) {
          const obstacle = obstacles[index];
          if (!repairScope.obstacleIds.has(obstacle.id)) continue;
          if (
            obstacle.kind === 'micro' ||
            obstacle.kind === 'overhead' ||
            obstacle.shoulderPasser ||
            obstacle.redWall ||
            obstacle.lane !== micro.lane
          ) {
            continue;
          }
          const half = Math.max(0, obstacle.zExtent ?? 0) / 2;
          if (obstacle.z + half <= micro.z) continue;
          if (obstacle.z - half - micro.z < minLeadZ) {
            obstacles.splice(index, 1);
          }
        }
      }
    }
  }

  private rampGapZ(): number {
    return this.config.rampMinGapRows * this.config.minGapZ;
  }

  private canPlaceRampAt(z: number): boolean {
    if (this.lastRampZ === null) return true;
    return z - this.lastRampZ >= this.rampGapZ() - 0.01;
  }

  private noteRampPlaced(z: number): void {
    this.lastRampZ = z;
  }

  private reserveRamp(
    pendingRamps: { row: number; lane: number; gateId?: number }[],
    row: number,
    lane: number,
    gateId?: number,
  ): void {
    if (row < 0) return;
    const existing = pendingRamps.find((r) => r.row === row && r.lane === lane);
    if (existing) {
      if (gateId !== undefined) existing.gateId = gateId;
      return;
    }
    pendingRamps.push({ row, lane, gateId });
  }

  private addNitroChallenge(
    obstacles: ObstacleEntity[],
    rng: () => number,
    z: number,
    mandatory: boolean,
  ): void {
    const challengeId = this.nextChallengeId++;
    if (mandatory) {
      for (const lane of this.allLanes()) {
        obstacles.push(
          this.makeObstacle(
            'low',
            lane,
            z,
            false,
            undefined,
            true,
            true,
            challengeId,
          ),
        );
      }
      return;
    }

    const freeLane = this.pickFreeLane(rng);
    const candidates = this.allLanes().filter((lane) => lane !== freeLane);
    const count = Math.min(candidates.length, rng() < 0.5 ? 2 : 3);
    for (let i = 0; i < count; i++) {
      const index = Math.floor(rng() * candidates.length);
      const lane = candidates.splice(index, 1)[0];
      obstacles.push(
        this.makeObstacle(
          'low',
          lane,
          z,
          false,
          undefined,
          true,
          false,
          challengeId,
        ),
      );
    }
    this.constraintLane = freeLane;
  }

  private pickCategory(
    rng: () => number,
    obstacleWeightScale = 1,
    destroySpawn: DestroySpawnConfig | null = null,
  ): ChunkCategory {
    const weights = { ...this.config.segmentWeights };
    weights.obstacle *= obstacleWeightScale;
    if (destroySpawn) {
      weights.obstacle *= 1 + destroySpawn.obstacleChunkWeightBoost;
      weights.coins = destroySpawn.microChunkWeight;
    }
    const total = weights.obstacle + weights.coins + weights.bonus + weights.empty;
    let roll = rng() * total;
    if ((roll -= weights.obstacle) < 0) return 'obstacle';
    if ((roll -= weights.coins) < 0) return 'coins';
    if ((roll -= weights.bonus) < 0) return 'bonus';
    return 'empty';
  }

  private pickFreeLane(rng: () => number): number {
    const offset = Math.floor(rng() * 3) - 1;
    return clamp(this.constraintLane! + offset, 0, this.config.lanes - 1);
  }

  private pickHorseChunkAction(
    rng: () => number,
    followup: 'jump' | 'slide' | 'dodge' | null,
    introductoryChunk: boolean,
    forcedDodgeChunk: boolean,
    slideAllowed: boolean,
    horseModifiers: HorsePhaseModifiers,
  ): 'jump' | 'slide' | 'dodge' {
    const horse = this.config.horse;
    if (followup === 'dodge' || forcedDodgeChunk) return 'dodge';
    if (followup === 'slide') return 'slide';
    if (followup === 'jump') return 'jump';
    if (!slideAllowed) return 'jump';
    const banned = this.bannedHorseAction();
    if (
      !introductoryChunk &&
      rng() < horse.dodgeOnlyProbability * horseModifiers.dodgeProbabilityScale &&
      banned !== 'dodge'
    ) {
      return 'dodge';
    }
    const slideChance = clamp(
      horse.slideGroupProbability + horseModifiers.slideProbabilityBonus,
      0,
      1,
    );
    let action: 'jump' | 'slide' =
      this.horseChunksGenerated === horse.slideStartChunks || rng() < slideChance
        ? 'slide'
        : 'jump';
    if (action === banned) {
      action = action === 'slide' ? 'jump' : 'slide';
    }
    return action;
  }

  private bannedHorseAction(): 'jump' | 'slide' | 'dodge' | null {
    const streak = this.config.horse.maxSameActionStreak;
    if (this.recentHorseActions.length < streak) return null;
    const last = this.recentHorseActions.slice(-streak);
    return last.every((item) => item === last[0]) ? last[0] : null;
  }

  private pickCoinLane(rng: () => number): number {
    return this.pickRiskBiasedLane(rng, this.config.riskZone.coinWeight);
  }

  private groundLaneBlocked(
    obstacles: ObstacleEntity[],
    lane: number,
    z: number,
    y?: number,
  ): boolean {
    const jumpY = this.config.horse.jumpCoinHeight;
    if ((y ?? this.config.coinHeight) >= jumpY - 0.2) return false;
    const zTol = this.config.minGapZ * 0.5;
    return obstacles.some(
      (obstacle) =>
        obstacle.kind !== 'overhead' &&
        obstacle.lane === lane &&
        Math.abs(obstacle.z - z) < zTol,
    );
  }

  private pickClearCoinLane(
    rng: () => number,
    obstacles: ObstacleEntity[],
    z: number,
    preferred?: number | null,
    usePullBias = true,
  ): number | null {
    if (
      preferred !== undefined &&
      preferred !== null &&
      !this.groundLaneBlocked(obstacles, preferred, z)
    ) {
      return usePullBias
        ? this.maybeBiasCoinPullLane(rng, obstacles, z, preferred)
        : preferred;
    }
    const candidate = this.pickCoinLane(rng);
    if (!this.groundLaneBlocked(obstacles, candidate, z)) {
      return usePullBias
        ? this.maybeBiasCoinPullLane(rng, obstacles, z, candidate)
        : candidate;
    }
    const free = this.allLanes().filter(
      (lane) => !this.groundLaneBlocked(obstacles, lane, z),
    );
    if (free.length === 0) return null;
    const lane = free[Math.floor(rng() * free.length)];
    return usePullBias
      ? this.maybeBiasCoinPullLane(rng, obstacles, z, lane)
      : lane;
  }

  private pickHorseGroundCoinLane(
    rng: () => number,
    obstacles: ObstacleEntity[],
    z: number,
    horse: LevelgenConfig['horse'],
    restLane: number | null,
    row: number,
  ): number | null {
    const freeLanes = this.allLanes().filter(
      (lane) => !this.groundLaneBlocked(obstacles, lane, z),
    );
    if (freeLanes.length === 0) return null;

    let preferred: number | null = null;
    if (restLane !== null) {
      const weavePhase = Math.floor(row / horse.coinWeaveStride) % 2;
      const weaveOffset =
        restLane === 0
          ? 1
          : restLane === this.config.lanes - 1
            ? -1
            : rng() < 0.5
              ? -1
              : 1;
      preferred =
        weavePhase === 0
          ? restLane
          : Math.min(
              this.config.lanes - 1,
              Math.max(0, restLane + weaveOffset),
            );
      if (!freeLanes.includes(preferred)) {
        preferred = freeLanes.find((lane) => lane !== restLane) ?? restLane;
      }
    }

    if (
      this.horseCoinLane !== null &&
      this.horseCoinLaneStreak >= horse.coinMaxSameLaneStreak - 1
    ) {
      const alternates = freeLanes.filter((lane) => lane !== this.horseCoinLane);
      if (alternates.length > 0) {
        preferred = alternates[Math.floor(rng() * alternates.length)];
      }
    }

    if (preferred !== null && freeLanes.includes(preferred)) {
      return preferred;
    }

    const riskLanes = this.config.riskZone.riskLanes.filter((lane) =>
      freeLanes.includes(lane),
    );
    const lanePool = riskLanes.length > 0 ? riskLanes : freeLanes;
    return lanePool[Math.floor(rng() * lanePool.length)];
  }

  private trackHorseCoinLane(lane: number): void {
    if (this.horseCoinLane === lane) {
      this.horseCoinLaneStreak += 1;
      return;
    }
    this.horseCoinLane = lane;
    this.horseCoinLaneStreak = 1;
  }

  private maybeBiasCoinPullLane(
    rng: () => number,
    obstacles: ObstacleEntity[],
    z: number,
    lane: number,
  ): number | null {
    if (
      this.coinPullLane !== null &&
      !this.groundLaneBlocked(obstacles, this.coinPullLane, z) &&
      rng() < 0.58
    ) {
      return this.coinPullLane;
    }
    return lane;
  }

  private diversifyHorseCoinLanes(
    obstacles: ObstacleEntity[],
    coins: CoinEntity[],
    maxStreak: number,
  ): void {
    const groundCoins = coins
      .filter(
        (coin) =>
          coin.rocketPattern === undefined &&
          (coin.y ?? this.config.coinHeight) <= this.config.coinHeight + 0.01,
      )
      .sort((a, b) => a.z - b.z);
    if (groundCoins.length === 0) return;

    for (let pass = 0; pass < 2; pass++) {
      let streak = 1;
      let previousLane = groundCoins[0].lane;
      for (let index = 1; index < groundCoins.length; index++) {
        const coin = groundCoins[index];
        if (coin.lane === previousLane) {
          streak += 1;
        } else {
          streak = 1;
          previousLane = coin.lane;
          continue;
        }
        if (streak < maxStreak) continue;

        const alternateLane = this.pickHorseCoinLaneBreak(obstacles, coin, previousLane);
        if (alternateLane === null) continue;
        coin.lane = alternateLane;
        coin.x = undefined;
        previousLane = alternateLane;
        streak = 1;
      }
    }
  }

  private pickHorseCoinLaneBreak(
    obstacles: ObstacleEntity[],
    coin: CoinEntity,
    avoidLane: number,
  ): number | null {
    const coinY = coin.y ?? this.config.coinHeight;
    const candidates: number[] = [];
    for (const lane of this.config.riskZone.riskLanes) {
      if (lane === avoidLane) continue;
      if (!this.groundLaneBlocked(obstacles, lane, coin.z, coinY)) {
        candidates.push(lane);
      }
    }
    for (const offset of [-1, 1]) {
      const lane = avoidLane + offset;
      if (lane < 0 || lane >= this.config.lanes) continue;
      if (
        !candidates.includes(lane) &&
        !this.groundLaneBlocked(obstacles, lane, coin.z, coinY)
      ) {
        candidates.push(lane);
      }
    }
    for (let lane = 0; lane < this.config.lanes; lane++) {
      if (
        lane !== avoidLane &&
        !candidates.includes(lane) &&
        !this.groundLaneBlocked(obstacles, lane, coin.z, coinY)
      ) {
        candidates.push(lane);
      }
    }
    return candidates[0] ?? null;
  }

  private pruneOverlappingGroundCoins(
    coins: CoinEntity[],
    obstacles: ObstacleEntity[],
  ): void {
    for (let i = coins.length - 1; i >= 0; i--) {
      const coin = coins[i];
      if (this.groundLaneBlocked(obstacles, coin.lane, coin.z, coin.y)) {
        coins.splice(i, 1);
      }
    }
  }

  private pickBlockedLanes(
    rng: () => number,
    freeLane: number,
    count: number,
    globalRow: number,
  ): number[] {
    const lanes = this.allLanes().filter((lane) => lane !== freeLane);
    const selected: number[] = [];
    for (let i = 0; i < count && lanes.length > 0; i++) {
      const weights = lanes.map((lane) => {
        const riskWeight = this.isRiskLane(lane)
          ? this.config.riskZone.obstacleWeight
          : 1;
        const earlyWeight =
          globalRow < this.config.earlyTraffic.rows &&
          this.config.earlyTraffic.lanes.includes(lane)
            ? this.config.earlyTraffic.laneWeight
            : 1;
        return riskWeight * earlyWeight;
      });
      let roll = rng() * weights.reduce((sum, weight) => sum + weight, 0);
      let selectedIndex = weights.length - 1;
      for (let laneIndex = 0; laneIndex < weights.length; laneIndex++) {
        roll -= weights[laneIndex];
        if (roll < 0) {
          selectedIndex = laneIndex;
          break;
        }
      }
      selected.push(lanes[selectedIndex]);
      lanes.splice(selectedIndex, 1);
    }
    return selected;
  }

  private pickRampLane(rng: () => number): number {
    const free = this.pickFreeLane(rng);
    return free;
  }

  private pickRiskBiasedLane(rng: () => number, riskWeight: number): number {
    const riskLanes = this.config.riskZone.riskLanes;
    const safeLanes = this.allLanes().filter((lane) => !this.isRiskLane(lane));
    const riskTotal = riskLanes.length * riskWeight;
    const safeTotal = safeLanes.length;
    const roll = rng() * (riskTotal + safeTotal);
    if (roll < riskTotal) {
      return riskLanes[Math.floor(rng() * riskLanes.length)];
    }
    return safeLanes[Math.floor(rng() * safeLanes.length)];
  }

  private allLanes(): number[] {
    return Array.from({ length: this.config.lanes }, (_, i) => i);
  }

  private clampDensity(density: number): number {
    return clamp(density, this.config.densityRange[0], this.config.densityRange[1]);
  }

  private laneTallRowStreakAt(lane: number): number {
    return this.laneTallRowStreak.get(lane) ?? 0;
  }

  private finishCarObstacleRow(tallLanes: number[]): void {
    for (const lane of this.allLanes()) {
      if (tallLanes.includes(lane)) {
        this.laneTallRowStreak.set(lane, this.laneTallRowStreakAt(lane) + 1);
      } else {
        this.laneTallRowStreak.set(lane, 0);
      }
    }
  }

  private resolveCarGroundObstacleKind(
    rng: () => number,
    destroySpawn: DestroySpawnConfig | null,
    z: number,
    earlyTraffic: boolean,
    lane: number,
  ): ObstacleEntity['kind'] | null {
    let kind = this.pickCarObstacleKind(rng, destroySpawn, z, earlyTraffic);
    if (kind === 'tall' && this.laneTallRowStreakAt(lane) >= 2) {
      kind = 'low';
    }
    if (kind === 'low' && !this.nitroLaneAllowsMedium(lane, z)) {
      kind = 'tall';
    }
    if (kind === 'tall' && this.laneTallRowStreakAt(lane) >= 2) {
      return null;
    }
    return kind;
  }

  private pickCarObstacleKind(
    rng: () => number,
    destroySpawn: DestroySpawnConfig | null,
    z = 0,
    earlyTraffic = false,
  ): ObstacleEntity['kind'] {
    if (!destroySpawn) {
      return rng() >= this.config.tallProbability ? 'low' : 'tall';
    }
    let tallProbability = clamp(
      this.config.tallProbability / destroySpawn.mediumDensityScale,
      0.12,
      0.55,
    );
    if (earlyTraffic) {
      tallProbability = clamp(
        tallProbability + this.config.earlyTallBias,
        0.12,
        0.62,
      );
    }
    if (this.destroyNitroTrafficActive(z)) {
      tallProbability = clamp(
        tallProbability * destroySpawn.nitroTallProbabilityScale,
        0.15,
        0.75,
      );
      const lowProbability = (1 - tallProbability) * destroySpawn.nitroMediumSpawnScale;
      const lateLowProbability =
        lowProbability *
        this.destroyNitroLateScale(destroySpawn.nitroLateMediumSpawnScale);
      tallProbability = 1 - lateLowProbability;
    }
    return rng() >= tallProbability ? 'low' : 'tall';
  }

  private addMicroCluster(
    obstacles: ObstacleEntity[],
    rng: () => number,
    z: number,
    lane: number,
    destroy: DestroySpawnConfig,
  ): void {
    const span = destroy.microClusterSizeMax - destroy.microClusterSizeMin + 1;
    const size = destroy.microClusterSizeMin + Math.floor(rng() * span);
    for (let i = 0; i < size; i++) {
      const offsetZ = i * this.config.minGapZ * 0.44;
      if (this.groundLaneBlocked(obstacles, lane, z + offsetZ)) continue;
      obstacles.push(this.makeObstacle('micro', lane, z + offsetZ));
    }
  }

  spawnIntroBlockingObstacle(lane: number, z: number): ObstacleEntity {
    return this.makeObstacle('low', lane, z);
  }

  private makeObstacle(
    kind: ObstacleEntity['kind'],
    lane: number,
    z: number,
    redWall = false,
    gateId?: number,
    nitroChallenge = false,
    nitroMandatory = false,
    challengeId?: number,
  ): ObstacleEntity {
    return {
      id: this.nextId++,
      kind,
      lane,
      z,
      redWall,
      gateId,
      nitroChallenge,
      nitroMandatory,
      challengeId,
    };
  }

  private makeRamp(lane: number, z: number, gateId?: number): RampEntity {
    return { id: this.nextId++, lane, z, gateId };
  }

  private makeCoin(
    lane: number,
    z: number,
    routeKind?: CoinEntity['routeKind'],
  ): CoinEntity {
    return {
      id: this.nextId++,
      lane,
      z,
      y: this.config.coinHeight,
      collected: false,
      routeKind,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
