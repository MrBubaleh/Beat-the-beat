import { runEnvelope, MusicTimingMetrics, type MusicalPatternRequest, type MusicForecast } from './musicPlanning';
import type { MusicPlacementContext } from '../levelgen/musicPlacement';
import { SfxEventQueue } from '@core/sfx/SfxEventQueue';
import type { SfxState } from '@core/sfx/types';
import type { GameConfig, LevelgenConfig } from '@core/config/schemas';
import type { Director } from '@core/director/types';
import type {
  BonusEntity,
  BonusKind,
  CoinEntity,
  ObstacleEntity,
  RampEntity,
  SceneryZoneEntity,
  TrainEntity,
} from '@core/levelgen/types';
import { carTrafficScrollSpeed } from '@core/levelgen/trafficMotion';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';
import { isPassableAsCarTemporal } from '@core/levelgen/passability';
import {
  horseLeftoverGuideHorizonZ,
  planHorseToCarGuides,
} from '@core/levelgen/modeTransition';
import { startLane } from '@core/levelgen/startLane';
import {
  lateRunProgress,
  longRunDifficultyProgress,
  scaleTowardEnd,
} from '@core/levelgen/difficulty';
import { mulberry32 } from '@core/levelgen/prng';
import type { PRNG } from '@core/levelgen/prng';
import type { PlayerState } from '@core/state/PlayerState';
import type { MusicState } from '@core/state/MusicState';
import type { ConsumedInput, PlayerAction } from './actions';
import { CollisionSystem } from './Collision';
import { collectDodgeEvents, updateDodgeLaneEscape, type DodgeFxEvent } from '@core/camera/cameraPresentation';
import { resolveObstacleCrushes } from './entityCrush';
import {
  startMediumKnockback,
  updateMediumKnockbacks,
  type MediumKnockbackConfig,
} from './obstacleKnockback';
import {
  startObstaclePanicFlee,
  updateObstaclePanicFlees,
} from './obstaclePanicFlee';
import { PlayerSim } from './PlayerSim';
import { Score } from './Score';
import { ComboSystem, comboMultiplier } from './Combo';
import {
  isTrainRoofBlockingHorsePath,
  playerTrainOffset,
} from './trainHorseOffer';
import { addNitroCharge, NITRO_DRY_COOLDOWN_SECONDS, NITRO_DRY_PULSE_SECONDS } from './nitro';
import {
  applySalvationTopUp,
  qualifiesForSalvation,
} from './nitroSalvation';
import {
  musicalLeadDistance,
  musicSceneRouteHint,
  planMusicPattern,
} from './musicPatterns';
import type { MusicPatternKind, MusicSceneTelemetry } from './musicPatterns';
import { airHeight, trickScoreMultiplier } from './air';
import type { LandingResult } from './air';
import { ModeController } from '@core/modes/ModeController';
import { interpretInput } from '@core/modes/InputContext';
import type { PlayerMode } from '@core/modes/types';
import type { RocketPhase } from './rocket';
import {
  buildRocketTrajectories,
  rocketCoinEndTime,
  rocketCoinStartTime,
  rocketCoinX,
  rocketCoinY,
  rocketDistanceAtTime,
  rocketFallStartTime,
} from './rocket';
import { planRocketLanding } from './rocketLanding';
import { buildHitEvent, buildModeEvent } from '@core/playtest/buildEvents';
import type { PlaytestEvent, ObstacleRef } from '@core/playtest/types';
import type { DamageState } from './health';
import type { GameplayRulesId } from './gameplayRules';
import { adrenalineCoinGainMultiplier } from './adrenalineHealth';
import { obstacleFootprint } from './obstacleFootprint';
import {
  levelIntroEncounterSeconds,
  levelIntroObstacleZ,
  levelIntroSpeedAt,
  levelIntroTargetSpeed,
} from './levelIntro';

export interface GameSimOptions {
  musicPlanningEnabled?: boolean;
  game: GameConfig;
  levelgen: LevelgenConfig;
  director: Director;
  consumeInput: (nowMs: number) => PlayerAction[];
  nowMs: () => number;
  getMusic: () => MusicState;
  getSongProgress?: () => number;
  getTrackTime?: () => number;
  getTrackDuration?: () => number;
  seed?: number;
  onPlaytestEvent?: (event: PlaytestEvent) => void;
  gameplayRules?: GameplayRulesId;
}

export interface GameSnapshot {
  musicTiming?: ReturnType<MusicTimingMetrics['snapshot']>;
  runStage?: string;
  musicAnalysis?: string;
  player: PlayerState;
  obstacles: ObstacleEntity[];
  horseBlasterActive: boolean;
  activeHorseSlideGroupId: number | null;
  coins: CoinEntity[];
  bonuses: BonusEntity[];
  ramps: RampEntity[];
  trains: TrainEntity[];
  sceneryZones: SceneryZoneEntity[];
  coinPickups: readonly { x: number; y: number; z: number }[];
  nearMissFx: readonly { x: number; y: number; z: number }[];
  dodgeFx: readonly DodgeFxEvent[];
  salvationFlash: number;
  nitroDryPulse: number;
  bonusPicked: BonusKind | null;
  scoreMeters: number;
  scoreCoins: number;
  scoreTotal: number;
  combo: number;
  comboMultiplier: number;
  phase: string;
  speedMultiplier: number;
  vfxIntensity: number;
  pulse: number;
  strongPulse: number;
  turbo: number;
  greenSmashFx: number;
  greenSmashStacks: number;
  nitroMaxFill: number;
  nitroReady: boolean;
  nitroSmashVisual: number;
  comboSmash: boolean;
  musicPattern: MusicPatternKind | null;
  musicScene: MusicSceneTelemetry | null;
  requestedDensity: number;
  effectiveDensity: number;
  effectiveCoinFrequency: number;
  musicEnergy: number;
  musicBrightness: number;
  musicSilence: boolean;
  gameplayRules: GameplayRulesId;
  adrenalineMax: number;
  runStats: RunStats;
  levelIntroActive: boolean;
  levelIntroElapsed: number;
}

export interface RunStats {
  maxCombo: number;
  smashes: number;
  tricks: number;
  trainRideSeconds: number;
  carSeconds: number;
  horseSeconds: number;
  modeSwitches: number;
  horseOffers: number;
  carOffers: number;
  horsePickups: number;
  carPickups: number;
  horseJumpClears: number;
  horseSlideClears: number;
  rocketOffers: number;
  rocketPickups: number;
  rocketSeconds: number;
  hits: number;
  nitroActivations: number;
  blasterSaves: number;
  maxHorseMomentum: number;
  recoverySteps: number;
  hitsWhileDamaged: number;
  woundedSeconds: number;
}

interface MusicSceneRequest {
  phase: 'buildUp' | 'intense' | 'peak' | 'cooldown';
  reason: 'phaseChange' | 'risingBeat';
}

export class GameSim {
  readonly playerSim: PlayerSim;
  private readonly collision: CollisionSystem;
  private readonly score = new Score();
  private readonly comboSystem = new ComboSystem();
  private levelgen: LevelgenConfig;
  private generator: LevelGenerator;
  private readonly modeController = new ModeController();
  private readonly obstacles: ObstacleEntity[] = [];
  private readonly coins: CoinEntity[] = [];
  private readonly bonuses: BonusEntity[] = [];
  private readonly ramps: RampEntity[] = [];
  private readonly trains: TrainEntity[] = [];
  private readonly sceneryZones: SceneryZoneEntity[] = [];
  private readonly fixedSeed: number | null;
  private nextBonusId = 1;
  private bonusRng: PRNG;
  private trainRng: PRNG;
  private sceneRng: PRNG;
  private salvationRng: PRNG;
  private lastGenerated = -1;
  private levelIntroActive = false;
  private levelIntroElapsed = 0;
  private levelIntroObstacleId: number | null = null;
  private levelIntroObstacleZ = 0;
  private behindBuffer: number;
  private lastSpeedMultiplier = 1;
  private lastVfxIntensity = 0;
  private prevPhase = '';
  private modeSwitchElapsed = 0;
  private bonusPicked: BonusKind | null = null;
  private pulse = 0;
  private strongPulse = 0;
  private turbo = 0;
  private turboTimer = 0;
  private turboCooldown = 0;
  private turboSustain = 0;
  private turboEnergyBaseline = 0.5;
  private turboEnergyHistory: number[] = [];
  private turboArmedTimer = 0;
  private turboSceneSpawned = false;
  private greenSmashFx = 0;
  private greenSmashStacks = 0;
  private greenSmashStackTimer = 0;
  private readonly nearMissTracked = new Set<number>();
  private readonly dodgeTracked = new Set<number>();
  private readonly dodgeHitIds = new Set<number>();
  private readonly dodgeSharedLaneIds = new Set<number>();
  private readonly dodgeEscapedIds = new Set<number>();
  private readonly horseCoinRewardedGroups = new Set<number>();
  private nitroActive = false;
  private nitroReady = false;
  private lastComboWasSmash = false;
  private ghost = false;
  private nextAirCoinId = -1;
  private nextAirPathId = 1;
  private airPathPattern = 0;
  private rampCooldownRemaining = 0;
  private trainCooldownRemaining = 0;
  private activeTrainId: number | null = null;
  private pendingTrainId: number | null = null;
  private nextTrainId = -200000;
  private nextTrainObstacleId = -300000;
  private protectedRampGateId: number | null = null;
  private timingMetrics = new MusicTimingMetrics();
  private nextRhythmTime = 0;
  private lastRhythmBeat = -1;
  private rhythmSequence = 0;
  private rhythmTracked = new Map<number, { entity: CoinEntity | ObstacleEntity; contact: number; previousZ: number }>();
  private rhythmForecast: MusicForecast | null = null;
  private rhythmSpeedPlan: readonly { time: number; value: number }[] = [];
  private get rhythmEnabled(): boolean { return Boolean(this.opts.musicPlanningEnabled && this.opts.game.musicPlanning.enabled); }
  private pendingMusicScene: MusicSceneRequest | null = null;
  private musicSceneCooldown = 0;
  private previousMusicEnergy = 0.5;
  private musicPatternSequence = 0;
  private nextMusicEntityId = -100000;
  private nextMusicGateId = -1000;
  private rampGuideTargetId: number | null = null;
  private completedRampGuides = 0;
  private maxCombo = 0;
  private totalSmashes = 0;
  private totalTricks = 0;
  private trainRideSeconds = 0;
  private carSeconds = 0;
  private horseSeconds = 0;
  private modeSwitches = 0;
  private horseOffers = 0;
  private carOffers = 0;
  private horsePickups = 0;
  private carPickups = 0;
  private horseJumpClears = 0;
  private horseSlideClears = 0;
  private rocketOffers = 0;
  private rocketPickups = 0;
  private rocketSeconds = 0;
  private rocketSpawnCooldown = 0;
  private rocketOfferElapsed = 0;
  private rocketLastPickupProgress = -1;
  private rocketLandingAdjustSeconds = 0;
  private firstHorseTransformGameTime: number | null = null;
  private totalHits = 0;
  private nitroActivations = 0;
  private blasterSaves = 0;
  private maxHorseMomentum = 0;
  private recoverySteps = 0;
  private hitsWhileDamaged = 0;
  private woundedSeconds = 0;
  private lastMusicPattern: MusicPatternKind | null = null;
  private musicScene: MusicSceneTelemetry | null = null;
  private musicSceneExpiresAt = 0;
  private musicSceneScheduledAt = 0;
  private activeMusicSceneId: number | null = null;
  private nextMusicSceneId = 1;
  private musicEchoCooldown = 0;
  private requestedDensity = 0.5;
  private musicEnergy = 0.5;
  private musicBrightness = 0.5;
  private musicSilence = false;
  private songProgress = 0;
  private readonly horseClearedObstacleIds = new Set<number>();
  private readonly horseSlideRewardedGroups = new Set<number>();
  private readonly horseHitGroups = new Set<number>();
  private readonly carPortalConsideredGroups = new Set<number>();
  private pendingCarPortalGroupId: number | null = null;
  private horseJumpFailed = false;
  private readonly modeBonusConsideredTrainIds = new Set<number>();
  private carPortalSafeRemaining = 0;
  private readonly coinPickupFx: { x: number; y: number; z: number }[] = [];
  private readonly nearMissFx: { x: number; y: number; z: number }[] = [];
  private readonly dodgeFx: DodgeFxEvent[] = [];
  private salvationFlashTimer = 0;
  private nitroDryPulseTimer = 0;
  private nitroDryCooldownTimer = 0;
  private prevRocketPhase: RocketPhase = 'none';
  private laneStickSeconds = 0;
  private laneStickLane = 0;
  private laneCommitmentLane = 0;
  private laneCommitmentSeconds = 0;
  private gameplayRules: GameplayRulesId = 'classic';

  constructor(private readonly opts: GameSimOptions) {
    this.gameplayRules = opts.gameplayRules ?? 'classic';
    this.levelgen = opts.levelgen;
    this.playerSim = new PlayerSim(opts.game, startLane(this.levelgen));
    this.playerSim.setGameplayRules(this.gameplayRules);
    this.collision = new CollisionSystem(opts.game);
    this.fixedSeed = opts.seed ?? null;
    this.generator = new LevelGenerator(this.levelgen, opts.seed ?? defaultSeed());
    this.syncDestroyGeneratorMode();
    this.syncObstacleCompaction();
    this.bonusRng = mulberry32((opts.seed ?? defaultSeed()) ^ 0xb0a5);
    this.trainRng = mulberry32((opts.seed ?? defaultSeed()) ^ 0x7a41);
    this.sceneRng = mulberry32((opts.seed ?? defaultSeed()) ^ 0x5ce10);
    this.salvationRng = mulberry32((opts.seed ?? defaultSeed()) ^ 0x5a170);
    this.behindBuffer = this.levelgen.segmentsBehind * this.levelgen.chunkLength;
  }

  get levelgenPresetConfig(): LevelgenConfig {
    return this.levelgen;
  }

  applyLevelgen(levelgen: LevelgenConfig): void {
    this.levelgen = levelgen;
    this.behindBuffer = levelgen.segmentsBehind * levelgen.chunkLength;
    const seed = this.fixedSeed ?? this.generator.seed;
    this.generator = new LevelGenerator(levelgen, seed);
    this.syncDestroyGeneratorMode();
    this.syncObstacleCompaction();
  }

  applyAdrenalineConfig(adrenaline: GameConfig['adrenaline']): void {
    Object.assign(this.opts.game.adrenaline, adrenaline);
  }

  get gameplayRulesId(): GameplayRulesId {
    return this.gameplayRules;
  }

  setGameplayRules(rules: GameplayRulesId): void {
    this.gameplayRules = rules;
    this.playerSim.setGameplayRules(rules);
    this.syncDestroyGeneratorMode();
  }

  setSkillMomentumEligible(eligible: boolean): void {
    this.playerSim.setSkillMomentumEligible(eligible);
  }

  setGhost(enabled: boolean): void {
    this.ghost = enabled;
  }

  private syncDestroyGeneratorMode(): void {
    this.generator.setDestroyCarMode(
      this.gameplayRules === 'destroy',
      this.gameplayRules === 'destroy' ? this.opts.game.destroy : null,
    );
    this.generator.setCarTraffic(this.opts.game.destroy);
  }

  private syncObstacleCompaction(): void {
    this.generator.setObstacleCompaction({
      lowDepth: this.opts.game.obstacle.lowDepth,
      tallDepth: this.opts.game.obstacle.tallDepth,
      maxChainTall: 2,
      maxChainLow: 2,
    });
  }

  private syncLaneCommitment(player: PlayerState, dt: number): void {
    if (player.mode !== 'car') {
      this.generator.setLaneCommitment(null);
      return;
    }
    if (player.lane === this.laneCommitmentLane) {
      this.laneCommitmentSeconds += dt;
    } else {
      this.laneCommitmentLane = player.lane;
      this.laneCommitmentSeconds = 0;
    }
    this.generator.setLaneCommitment({
      lane: this.laneCommitmentLane,
      seconds: this.laneCommitmentSeconds,
      nitroActive: player.isAbilityActive,
    });
  }

  get gameOver(): boolean {
    return this.playerSim.state.gameOver;
  }

  get seed(): number {
    return this.generator.seed;
  }

  /** Поправка длительности последнего полёта ракеты (секунды круиза). */
  get lastRocketLandingAdjustSeconds(): number {
    return this.rocketLandingAdjustSeconds;
  }

  get mode(): PlayerMode {
    return this.modeController.mode;
  }

  get combo(): number {
    return this.comboSystem.combo;
  }

  get comboMultiplier(): number {
    return comboMultiplier(this.comboSystem.combo, this.opts.game.combo);
  }

  setMode(mode: PlayerMode): void {
    this.switchPlayerMode(mode);
  }

  private destroyCarGroundCoinsSuppressed(): boolean {
    return this.gameplayRules === 'destroy' && this.playerSim.state.mode === 'car';
  }

  private isDestroyCarGroundCoin(coin: CoinEntity): boolean {
    if (coin.airPathId !== undefined || coin.airTargetTime !== undefined) return false;
    if (coin.trainId !== undefined) return false;
    return true;
  }

  private shouldSuppressDestroyCarCoin(coin: CoinEntity): boolean {
    return this.destroyCarGroundCoinsSuppressed() && this.isDestroyCarGroundCoin(coin);
  }

  private purgeDestroyGroundCoins(): void {
    if (!this.destroyCarGroundCoinsSuppressed()) return;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      if (this.isDestroyCarGroundCoin(this.coins[i])) {
        this.coins.splice(i, 1);
      }
    }
  }

  private collisionCoins(): CoinEntity[] {
    if (!this.destroyCarGroundCoinsSuppressed()) return this.coins;
    return this.coins.filter((coin) => !this.isDestroyCarGroundCoin(coin));
  }

  readonly sfxEvents = new SfxEventQueue();

  getSfxState(): SfxState {
    const p = this.playerSim.state;
    return { gameTime: p.gameTime, mode: p.mode, speed: p.speed, lane: p.lane,
      laneX: p.laneX, y: p.y, airState: p.airState,
      nitroActive: p.mode === 'car' && p.isAbilityActive,
      nitroReady: this.playerSim.nitroReady, sliding: p.isSliding,
      rocketPhase: p.rocketPhase, combo: this.comboSystem.combo, gameOver: p.gameOver,
      damageState: p.damageState };
  }

  beginLevelIntro(): void {
    if (this.rhythmEnabled) {
      this.levelIntroActive = true;
      this.levelIntroElapsed = 0;
      return;
    }
    const introCfg = this.opts.game.levelIntro;
    const speeds = this.opts.game.speeds;
    const targetSpeed = levelIntroTargetSpeed(speeds.base, speeds.rampPerSecond, introCfg);
    const encounter = levelIntroEncounterSeconds(this.generator.seed, introCfg);
    const z = levelIntroObstacleZ(targetSpeed, encounter, introCfg);
    const lane = this.playerSim.state.lane;
    const obstacle = this.generator.spawnIntroBlockingObstacle(lane, z);
    this.levelIntroObstacleId = obstacle.id;
    this.levelIntroObstacleZ = z;
    this.obstacles.push(obstacle);
    this.levelIntroActive = true;
    this.levelIntroElapsed = 0;
  }

  isLevelIntroActive(): boolean {
    return this.levelIntroActive;
  }

  getLevelIntroElapsed(): number {
    return this.levelIntroElapsed;
  }

  fixedUpdate(dt: number): void {
    this.sfxEvents.observe(this.getSfxState());
    const player = this.playerSim.state;
    if (player.gameOver) return;
    if (this.levelIntroActive) {
      this.fixedUpdateLevelIntro(dt);
      return;
    }
    this.purgeDestroyGroundCoins();
    const damageAtFrameStart = player.damageState;
    this.updateMusicSceneTelemetry();
    this.musicSceneCooldown = Math.max(0, this.musicSceneCooldown - dt);
    this.musicEchoCooldown = Math.max(0, this.musicEchoCooldown - dt);
    if (player.mode === 'car') this.carSeconds += dt;
    if (player.mode === 'horse') this.horseSeconds += dt;
    if (player.mode === 'rocket') this.rocketSeconds += dt;
    this.rocketSpawnCooldown = Math.max(0, this.rocketSpawnCooldown - dt);
    if (this.salvationFlashTimer > 0) {
      this.salvationFlashTimer = Math.max(0, this.salvationFlashTimer - dt);
    }
    if (this.nitroDryPulseTimer > 0) {
      this.nitroDryPulseTimer = Math.max(0, this.nitroDryPulseTimer - dt);
    }
    this.nitroDryCooldownTimer = Math.max(0, this.nitroDryCooldownTimer - dt);
    if (this.greenSmashStackTimer > 0) {
      this.greenSmashStackTimer = Math.max(0, this.greenSmashStackTimer - dt);
      if (this.greenSmashStackTimer <= 0) this.greenSmashStacks = 0;
    }
    this.greenSmashFx = Math.max(0, this.greenSmashFx - dt * 2.8);

    const actions = this.opts.consumeInput(this.opts.nowMs());
    const input = this.guardApproachingTrainTransfer(
      interpretInput(this.playerSim.state.mode, actions),
    );
    this.playerSim.setHorseSlideHazard(
      this.hasHorseSlideHazard(player, input.laneDelta),
    );

    if (input.nitro && player.mode === 'car') {
      this.playerSim.activateNitro();
      if (
        !player.isAbilityActive &&
        !this.playerSim.nitroReady &&
        !this.ghost &&
        this.nitroDryCooldownTimer <= 0
      ) {
        this.nitroDryCooldownTimer = NITRO_DRY_COOLDOWN_SECONDS;
        this.nitroDryPulseTimer = NITRO_DRY_PULSE_SECONDS;
        this.sfxEvents.emit('nitroDry', this.getSfxState(), 0.6);
      }
      this.sfxEvents.observe(this.getSfxState());
    }

    const music = this.opts.getMusic();
    this.rhythmForecast = this.rhythmEnabled ? music.forecast ?? null : null;
    const envelope = runEnvelope(this.opts.getTrackTime?.() ?? player.gameTime,
      this.opts.getTrackDuration?.() ?? 0, this.opts.game.musicPlanning);
    this.generator.setRunEnvelope(this.rhythmEnabled ? envelope : null);
    this.songProgress = clamp(this.opts.getSongProgress?.() ?? 0, 0, 1);
    this.musicEnergy = Number(music.energy.value);
    this.musicBrightness = Number(music.brightness.value);
    this.musicSilence = Boolean(music.silence.value);
    const pulseCfg = this.opts.game.pulse;
    if (music.beat.value && (!this.rhythmEnabled || music.beat.audioTime !== this.lastRhythmBeat)) {
      this.lastRhythmBeat = music.beat.audioTime;
      this.pulse = 1;
      this.strongPulse =
        Number(music.energy.value) >= pulseCfg.strongBeatEnergyThreshold ? 1 : 0;
      this.tryApplyBeatLaunchBoost(music, player);
    } else {
      this.pulse = Math.max(0, this.pulse - dt * pulseCfg.decayPerSecond);
      this.strongPulse = Math.max(0, this.strongPulse - dt * pulseCfg.decayPerSecond);
    }
    const directorOutput = this.opts.director.update(
      dt,
      player.gameTime,
      music,
      player.stressEstimate,
    );
    this.rhythmSpeedPlan = directorOutput.speedPlan ?? [];
    const phase = directorOutput.phase;
    const phaseChanged = phase !== this.prevPhase;
    this.modeSwitchElapsed += dt;
    this.rocketOfferElapsed += dt;
    if (
      player.mode === 'car' &&
      phaseChanged &&
      this.prevPhase !== '' &&
      isMusicScenePhase(phase)
    ) {
      this.requestMusicScene(phase, 'phaseChange');
    }
    const energyRise = this.musicEnergy - this.previousMusicEnergy;
    if (
      player.mode === 'car' &&
      isMusicScenePhase(phase) &&
      music.beat.value &&
      this.musicEnergy >= this.opts.game.pulse.strongBeatEnergyThreshold &&
      energyRise >= this.opts.game.musicScenes.cueEnergyRiseThreshold
    ) {
      this.requestMusicScene(phase, 'risingBeat');
    }
    this.previousMusicEnergy = this.musicEnergy;
    this.prevPhase = phase;
    const speedIntent = directorOutput.intents.find((intent) => intent.target === 'speed');
    const densityIntent = directorOutput.intents.find((intent) => intent.target === 'obstacleDensity');
    const coinIntent = directorOutput.intents.find((intent) => intent.target === 'coinFrequency');
    const vfxIntent = directorOutput.intents.find((intent) => intent.target === 'vfxIntensity');
    const speedMultiplier = this.rhythmEnabled
      ? Math.min(envelope.speedIntentCap, numberOr(speedIntent?.value, 1))
      : numberOr(speedIntent?.value, 1);
    const densityMultiplier = numberOr(densityIntent?.value, 0.4);
    this.requestedDensity = densityMultiplier;
    this.lastVfxIntensity =
      numberOr(vfxIntent?.value, 0) * (this.musicSilence ? 0.3 : 1);
    this.generator.setMusicDensityIntent(densityMultiplier);
    this.generator.setCoinFrequencyIntent(numberOr(coinIntent?.value, 0.5));
    const longRunProgress = longRunDifficultyProgress(
      player.gameTime,
      this.levelgen.longRunDifficulty,
    );
    this.generator.setLongRunProgress(longRunProgress);
    this.generator.setSongProgress(this.songProgress);
    this.generator.setTrackTiming(
      this.opts.getTrackTime?.() ?? 0,
      this.opts.getTrackDuration?.() ?? 0,
      player.speed,
    );

    const turboMultiplier = this.updateTurbo(dt, music);
    const effectiveMultiplier = speedMultiplier * (this.rhythmEnabled ? 1 : turboMultiplier);

    this.updateTrainLandingTarget(dt);
    const wasTrainRoof = player.airState === 'trainRoof';
    const wasHorseJump = player.airSource === 'horseJump';
    const laneBeforeUpdate = player.lane;
    const landing = this.playerSim.update(dt, input, effectiveMultiplier);
    this.sfxEvents.observe(this.getSfxState());
    if (
      player.mode === 'rocket' &&
      player.rocketPhase === 'fall' &&
      this.prevRocketPhase !== 'fall'
    ) {
      this.removeRocketCoins();
    }
    this.prevRocketPhase =
      player.mode === 'rocket' ? player.rocketPhase : 'none';
    this.trackPlaytestRecovery(damageAtFrameStart);
    if (
      wasTrainRoof &&
      player.airState === 'airborne' &&
      player.airSource === 'horseJump'
    ) {
      this.activeTrainId = null;
    }
    if (this.carPortalSafeRemaining > 0) {
      this.carPortalSafeRemaining = Math.max(0, this.carPortalSafeRemaining - dt);
    }
    if (
      player.mode === 'horse' &&
      !wasHorseJump &&
      player.airSource === 'horseJump'
    ) {
      if (!this.maybeSpawnCarBonusInHorseJump()) {
        this.maybeSpawnRocketBonusInHorseJump();
      }
    }
    if (landing) {
      if (player.mode === 'horse' && player.airSource === 'horseJump') {
      } else {
        this.onLanding(landing);
        this.tryLandOnTrain();
      }
    }
    this.lastSpeedMultiplier = effectiveMultiplier;
    if (player.isAbilityActive !== this.nitroActive) {
      this.nitroActive = player.isAbilityActive;
      this.generator.setNitroActive(this.nitroActive);
      if (this.nitroActive) this.thinGroundCoinsForNitro();
      if (this.nitroActive) this.nitroActivations += 1;
      if (!this.nitroActive && player.nitroCharge < this.opts.game.nitro.maxFill) {
        this.downgradeMandatoryNitroChallenges(player.lane);
      }
    }
    const nitroReady = this.playerSim.nitroReady;
    if (nitroReady !== this.nitroReady) {
      this.nitroReady = nitroReady;
      this.generator.setNitroReady(nitroReady);
      if (!nitroReady && !player.isAbilityActive) {
        this.downgradeMandatoryNitroChallenges(player.lane);
      }
    }
    if (player.mode === 'car') {
      const trafficCfg = this.opts.game.destroy;
      const nitroSeconds = player.isAbilityActive
        ? player.nitroCharge / Math.max(this.opts.game.nitro.drainPerSecond, 1e-6)
        : 0;
      this.generator.setDestroyNitroTraffic(
        nitroSeconds * player.speed,
        player.speed * trafficCfg.nitroTrafficMinLeadSeconds,
      );
    } else {
      this.generator.setDestroyNitroTraffic(0, 0);
    }
    this.syncLaneCommitment(player, dt);

    this.scrollWorld(player.speed, dt);
    this.updateShoulderPasserCrushes();
    resolveObstacleCrushes(
      this.obstacles,
      this.ramps,
      this.opts.game.obstacle.depth,
    );
    updateMediumKnockbacks(
      this.obstacles,
      dt,
      this.mediumKnockbackCfg(),
      this.opts.game.lane.positions,
    );
    updateObstaclePanicFlees(
      this.obstacles,
      dt,
      this.levelgen.laneFlow,
      this.opts.game.obstaclePanicFlee,
    );
    this.purgePanicFleeRemovals();
    this.updateLaneStickiness(player, dt);
    this.updateHorseSmashDelays(dt);
    this.trackHorseActionClears(player, dt);
    if (!this.ghost) this.tryCompleteCarPortal(player);
    this.updateTrainRide(dt, wasTrainRoof, laneBeforeUpdate);
    this.generator.setHorseMomentum(player.mode === 'horse' ? player.horseMomentum : 0);
    this.syncHorseConvertible();
    if (this.rhythmEnabled && this.rhythmForecast) this.scheduleRhythmPatterns(directorOutput.patterns ?? [], this.rhythmForecast);
    this.ensureChunks();
    this.syncTrackEndObstacles();
    this.maybeSpawnCarPortal(phase);
    if (!this.rhythmEnabled) {
      this.spawnPendingMusicPattern();
      this.maybeSpawnMusicEcho(music);
    }
    this.updateRampAvailability(dt);
    this.ensureEarlyRampGuide();

    if (this.ghost) {
      this.bonusPicked = null;
    } else {
    const result = this.collision.update(
      player,
      this.obstacles,
      this.collisionCoins(),
      this.bonuses,
      this.ramps,
      this.trains,
    );
    if (result.rampHit) {
      this.completeRampGuide(result.rampHit.id);
      result.rampHit.used = true;
      this.rampCooldownRemaining = this.opts.game.ramp.cooldownSeconds;
      this.protectedRampGateId = result.rampHit.gateId ?? null;
      this.playerSim.launchFromRamp();
      const trainLane = player.mode === 'car'
        ? this.maybeSpawnTrain(
            phase,
            this.lateHorseRampTrainMultiplier() * 0.82,
            result.rampHit.lane,
          )
        : null;
      const airPathId = this.spawnAirCoinPath(trainLane);
      if (trainLane === null) {
        const horseOffered = this.maybeSpawnHorseBonusInRampFlight(airPathId);
        if (!horseOffered) this.maybeSpawnRocketBonusInRampFlight(airPathId);
      }
    }
    if (result.hit && this.carPortalSafeRemaining > 0) {
      result.hit = false;
      result.hitObstacleId = null;
    }
    if (
      this.gameplayRules === 'destroy' &&
      (player.mode === 'car' || player.mode === 'horse')
    ) {
      for (const microId of result.microBreakIds) {
        this.breakMicroObstacle(microId);
      }
    }
    if (result.hit) {
      if (result.hitObstacleId !== null) {
        const obstacle = this.obstacles.find((o) => o.id === result.hitObstacleId);
        const absorbedByBlaster =
          player.mode === 'horse' && this.consumeHorseBlaster();
        const absorbedByReadyNitro =
          !absorbedByBlaster &&
          obstacle !== undefined &&
          this.activateReadyNitroCollisionBlast(obstacle);
        if (
          this.gameplayRules === 'destroy' &&
          player.mode === 'car' &&
          obstacle !== undefined
        ) {
          this.handleDestroyCarHit(obstacle, absorbedByBlaster, absorbedByReadyNitro);
        } else if (!absorbedByBlaster && !absorbedByReadyNitro) {
          const smashed =
            this.playerSim.canSmashWithNitro &&
            obstacle?.kind === 'low' &&
            !obstacle?.unbreakable;
          if (obstacle) {
            obstacle.broken = true;
            if (smashed) {
              obstacle.smashed = true;
              obstacle.penaltyBreak = false;
            } else if (obstacle.kind === 'low' && !obstacle.unbreakable) {
              if (player.mode === 'car') {
                this.startCarMediumKnockback(obstacle, 'yellow');
              } else {
                obstacle.penaltyBreak = true;
              }
            }
          }
          if (smashed && obstacle) {
            this.totalSmashes += 1;
            this.grantAdrenaline(this.opts.game.adrenaline.gainSmash);
            this.gainNitro(this.opts.game.nitro.gainPerSmash, obstacle);
            this.applyGreenSmashSpeedBoost();
            this.registerGreenSmashPulse();
            this.registerSmashHit();
          }
          if (!smashed && !player.isHit) {
            const horseJumpCleared =
              player.mode === 'horse' &&
              obstacle !== undefined &&
              (obstacle.cleared || this.horseClearedObstacleIds.has(obstacle.id));
            if (horseJumpCleared) {
              // already cleared in flight; ignore touchdown overlap
            } else if (
              player.mode === 'horse' &&
              obstacle?.actionGroupId !== undefined
            ) {
              this.horseHitGroups.add(obstacle.actionGroupId);
              for (const groupedObstacle of this.obstacles) {
                if (
                  groupedObstacle.actionGroupId === obstacle.actionGroupId &&
                  groupedObstacle.id !== obstacle.id
                ) {
                  groupedObstacle.collisionIgnored = true;
                }
              }
            }
            if (player.mode === 'horse' && player.airSource === 'horseJump') {
              this.horseJumpFailed = true;
            }
            const damageBefore = player.damageState;
            if (this.playerSim.canSmashWithNitro) {
              this.playerSim.interruptNitro();
              this.sfxEvents.observe(this.getSfxState());
              this.nitroActive = false;
              this.nitroReady = false;
              this.generator.setNitroActive(false);
              this.generator.setNitroReady(false);
              this.downgradeMandatoryNitroChallenges(player.lane);
            }
            this.playerSim.registerHit();
            this.totalHits += 1;
            this.noteDodgeHit(obstacle?.id);
            this.emitPlaytestHit(obstacle, 'obstacle', damageBefore);
            this.emitPlaytestGameOverIfNeeded();
            this.comboSystem.onHit();
            this.lastComboWasSmash = false;
          }
        }
      }
    }
    this.updateTrainCollision();
    this.updateTrainRoofCollision();
    this.bonusPicked = result.bonusCollected;
    if (result.bonusCollected === 'horse' && player.mode === 'car') {
      this.horsePickups += 1;
      if (this.firstHorseTransformGameTime === null) {
        this.firstHorseTransformGameTime = player.gameTime;
      }
      this.switchPlayerMode('horse');
      this.emitPlaytestBonus('horse');
    } else if (result.bonusCollected === 'car' && player.mode === 'horse') {
      this.carPickups += 1;
      this.switchPlayerMode('car');
      this.emitPlaytestBonus('car');
    } else if (result.bonusCollected === 'rocket' && player.mode !== 'rocket') {
      this.rocketPickups += 1;
      this.rocketLastPickupProgress = this.songProgress;
      this.rocketSpawnCooldown = this.opts.game.rocket.spawnCooldownSeconds;
      this.pulse = 1;
      this.strongPulse = 1;
      this.switchPlayerMode('rocket');
      this.emitPlaytestBonus('rocket');
      this.spawnRocketTrajectories();
      this.planRocketLandingWindow();
    }
    if (player.mode === 'rocket' && this.playerSim.consumeRocketExpired()) {
      this.finishRocketFlight();
    }
    if (this.playerSim.consumeHorseLandingCompleted()) {
      if (!this.horseJumpFailed && this.horseClearedObstacleIds.size > 0) {
        this.playerSim.registerHorseClear();
        this.horseJumpClears += 1;
        this.grantAdrenaline(this.opts.game.adrenaline.gainHorseJumpClear);
      }
      this.horseClearedObstacleIds.clear();
      this.horseJumpFailed = false;
    }
    if (result.coinCollected) {
      this.sfxEvents.emit('coin', this.getSfxState(), 0.45, result.coinsCollected);
      for (const spark of result.collectedCoinSparks) {
        this.coinPickupFx.push(spark);
      }
      this.registerGreenSmashPulse(0.72);
      player.coins += result.coinsCollected;
      const airborneRampCarCoin =
        player.mode === 'car' &&
        player.airSource === 'ramp' &&
        (player.airState === 'airborne' || player.airState === 'landing');
      const airborneCoinHpBonus =
        result.collectedAirborneCoins > 0
          ? 1.14 + 0.04 * Math.min(result.collectedAirborneCoins, 4)
          : 1;
      this.grantAdrenaline(
        this.opts.game.adrenaline.gainCoin *
          result.coinsCollected *
          airborneCoinHpBonus *
          adrenalineCoinGainMultiplier(player.mode, this.opts.game.adrenaline, {
            airborneCar: airborneRampCarCoin,
            adrenalinePercent:
              this.gameplayRules === 'adrenaline'
                ? (player.adrenaline / this.opts.game.adrenaline.max) * 100
                : undefined,
          }),
      );
      if (player.mode === 'car') {
        const coinGain = player.isAbilityActive
          ? this.opts.game.nitro.gainPerCoin * this.opts.game.nitro.coinNitroMultiplier
          : this.opts.game.nitro.gainPerCoin;
        this.gainNitro(coinGain * result.coinsCollected);
      }
      if (player.mode === 'car' && player.isAbilityActive) {
        this.score.addBonus(
          (this.opts.game.nitro.scoreMultiplier - 1) *
            this.opts.game.coin.value *
            result.coinsCollected,
        );
      }
      if (player.mode === 'horse') {
        for (const groupId of result.collectedCoinGroupIds) {
          if (this.horseCoinRewardedGroups.has(groupId)) continue;
          const groupCoins = this.coins.filter((coin) => coin.actionGroupId === groupId);
          if (groupCoins.length < 2 || !groupCoins.every((coin) => coin.collected)) continue;
          this.horseCoinRewardedGroups.add(groupId);
          this.playerSim.registerHorseClear();
        }
      }
    }
    if (player.mode === 'car') this.updateNearMiss(player);
    this.updateDodgeFx(player);
    if (player.mode === 'car' && this.isNitroChargeLane(player.lane)) {
      this.gainNitro(this.opts.game.nitro.gainPerChargeLaneSecond * dt);
    }
    }

    const comboBefore = this.comboSystem.combo;
    if (!this.ghost && player.mode === 'car') {
      this.comboSystem.update(
        player,
        this.obstacles,
        this.opts.game.combo,
        this.gameplayRules !== 'destroy' && !this.nitroActive,
      );
    }
    const comboAfter = this.comboSystem.combo;
    this.maxCombo = Math.max(this.maxCombo, comboAfter);
    if (player.mode === 'car' && comboAfter > comboBefore && !this.nitroActive) {
      const gained =
        (comboAfter - comboBefore) *
        (this.gameplayRules === 'destroy'
          ? 0
          : this.opts.game.nitro.gainPerDodge) *
        this.comboMultiplier;
      if (gained > 0) this.gainNitro(gained);
      this.lastComboWasSmash = false;
    }
    this.purgeDestroyGroundCoins();
    this.updatePerception(player);
    this.maxHorseMomentum = Math.max(this.maxHorseMomentum, player.horseMomentum);
    this.score.update(
      player.distance,
      player.coins,
      this.opts.game.coin.value,
      comboMultiplier(this.comboSystem.combo, this.opts.game.combo),
    );
    if (this.rhythmEnabled) this.measureRhythmEvents();
    if (player.damageState !== 'normal') {
      this.woundedSeconds += dt;
    }
    this.sfxEvents.observe(this.getSfxState());
  }

  restart(): void {
    this.timingMetrics = new MusicTimingMetrics();
    this.nextRhythmTime = 0;
    this.lastRhythmBeat = -1;
    this.rhythmSequence = 0;
    this.rhythmTracked.clear();
    this.rhythmForecast = null;
    this.sfxEvents.reset();
    this.generator.reset(this.fixedSeed ?? newSeed());
    this.obstacles.length = 0;
    this.coins.length = 0;
    this.bonuses.length = 0;
    this.ramps.length = 0;
    this.trains.length = 0;
    this.sceneryZones.length = 0;
    this.nextBonusId = 1;
    this.bonusRng = mulberry32((this.fixedSeed ?? this.generator.seed) ^ 0xb0a5);
    this.trainRng = mulberry32((this.fixedSeed ?? this.generator.seed) ^ 0x7a41);
    this.sceneRng = mulberry32((this.fixedSeed ?? this.generator.seed) ^ 0x5ce10);
    this.salvationRng = mulberry32((this.fixedSeed ?? this.generator.seed) ^ 0x5a170);
    this.lastGenerated = -1;
    this.playerSim.reset();
    this.modeController.reset();
    this.score.reset();
    this.comboSystem.reset();
    this.opts.director.reset();
    this.prevPhase = '';
    this.modeSwitchElapsed = 0;
    this.bonusPicked = null;
    this.lastSpeedMultiplier = 1;
    this.lastVfxIntensity = 0;
    this.pulse = 0;
    this.strongPulse = 0;
    this.turbo = 0;
    this.turboTimer = 0;
    this.turboCooldown = 0;
    this.turboSustain = 0;
    this.turboEnergyBaseline = 0.5;
    this.turboEnergyHistory = [];
    this.turboArmedTimer = 0;
    this.turboSceneSpawned = false;
    this.greenSmashFx = 0;
    this.greenSmashStacks = 0;
    this.greenSmashStackTimer = 0;
    this.nearMissTracked.clear();
    this.dodgeTracked.clear();
    this.dodgeHitIds.clear();
    this.dodgeSharedLaneIds.clear();
    this.dodgeEscapedIds.clear();
    this.horseCoinRewardedGroups.clear();
    this.nitroActive = false;
    this.nitroReady = false;
    this.nitroDryPulseTimer = 0;
    this.nitroDryCooldownTimer = 0;
    this.lastComboWasSmash = false;
    this.nextAirCoinId = -1;
    this.nextAirPathId = 1;
    this.airPathPattern = 0;
    this.rampCooldownRemaining = 0;
    this.trainCooldownRemaining = 0;
    this.activeTrainId = null;
    this.pendingTrainId = null;
    this.nextTrainId = -200000;
    this.nextTrainObstacleId = -300000;
    this.protectedRampGateId = null;
    this.pendingMusicScene = null;
    this.musicSceneCooldown = 0;
    this.previousMusicEnergy = 0.5;
    this.musicPatternSequence = 0;
    this.nextMusicEntityId = -100000;
    this.nextMusicGateId = -1000;
    this.rampGuideTargetId = null;
    this.completedRampGuides = 0;
    this.maxCombo = 0;
    this.totalSmashes = 0;
    this.totalTricks = 0;
    this.trainRideSeconds = 0;
    this.carSeconds = 0;
    this.horseSeconds = 0;
    this.modeSwitches = 0;
    this.horseOffers = 0;
    this.carOffers = 0;
    this.horsePickups = 0;
    this.carPickups = 0;
    this.horseJumpClears = 0;
    this.horseSlideClears = 0;
    this.rocketOffers = 0;
    this.rocketPickups = 0;
    this.rocketSeconds = 0;
    this.rocketSpawnCooldown = 0;
    this.rocketOfferElapsed = 0;
    this.rocketLastPickupProgress = -1;
    this.rocketLandingAdjustSeconds = 0;
    this.firstHorseTransformGameTime = null;
    this.prevRocketPhase = 'none';
    this.totalHits = 0;
    this.nitroActivations = 0;
    this.blasterSaves = 0;
    this.maxHorseMomentum = 0;
    this.recoverySteps = 0;
    this.hitsWhileDamaged = 0;
    this.woundedSeconds = 0;
    this.laneStickSeconds = 0;
    this.laneStickLane = startLane(this.levelgen);
    this.laneCommitmentLane = startLane(this.levelgen);
    this.laneCommitmentSeconds = 0;
    this.generator.setLaneCommitment(null);
    this.generator.setCoinPullLane(null);
    this.lastMusicPattern = null;
    this.musicScene = null;
    this.musicSceneExpiresAt = 0;
    this.musicSceneScheduledAt = 0;
    this.activeMusicSceneId = null;
    this.nextMusicSceneId = 1;
    this.musicEchoCooldown = 0;
    this.requestedDensity = 0.5;
    this.musicEnergy = 0.5;
    this.musicBrightness = 0.5;
    this.musicSilence = false;
    this.songProgress = 0;
    this.horseClearedObstacleIds.clear();
    this.horseSlideRewardedGroups.clear();
    this.horseHitGroups.clear();
    this.carPortalConsideredGroups.clear();
    this.pendingCarPortalGroupId = null;
    this.carPortalSafeRemaining = 0;
    this.horseJumpFailed = false;
    this.modeBonusConsideredTrainIds.clear();
    this.levelIntroActive = false;
    this.levelIntroElapsed = 0;
    this.levelIntroObstacleId = null;
    this.levelIntroObstacleZ = 0;
  }

  getSnapshot(): GameSnapshot {
    const player = this.playerSim.state;
    const coinPickups = this.coinPickupFx.splice(0, this.coinPickupFx.length);
    const nearMissFx = this.nearMissFx.splice(0, this.nearMissFx.length);
    const dodgeFx = this.dodgeFx.splice(0, this.dodgeFx.length);
    const salvationFlash = this.salvationFlashTimer;
    return {
      musicAnalysis: this.rhythmForecast?.source,
      musicTiming: this.rhythmEnabled ? this.timingMetrics.snapshot(this.opts.game.musicPlanning.hitWindowMs) : undefined,
      runStage: this.rhythmEnabled ? runEnvelope(this.opts.getTrackTime?.() ?? player.gameTime,
        this.opts.getTrackDuration?.() ?? 0).stage : undefined,
      player,
      coinPickups,
      nearMissFx,
      dodgeFx,
      salvationFlash,
      nitroDryPulse: this.nitroDryPulseTimer,
      obstacles: this.obstacles,
      horseBlasterActive: this.isHorseBlasterActive(),
      activeHorseSlideGroupId: this.findActiveHorseSlideGroupId(),
      coins: this.coins,
      bonuses: this.bonuses,
      ramps: this.ramps,
      trains: this.trains,
      sceneryZones: this.sceneryZones,
      bonusPicked: this.bonusPicked,
      scoreMeters: this.score.meters,
      scoreCoins: this.score.coins,
      scoreTotal: this.score.total,
      combo: this.comboSystem.combo,
      comboMultiplier: this.comboMultiplier,
      phase: this.opts.director.phase,
      speedMultiplier: this.lastSpeedMultiplier,
      vfxIntensity: this.lastVfxIntensity,
      pulse: this.pulse,
      strongPulse: this.strongPulse,
      turbo: this.turbo,
      greenSmashFx: this.greenSmashFx,
      greenSmashStacks: this.greenSmashStacks,
      nitroMaxFill: this.opts.game.nitro.maxFill,
      nitroReady: this.playerSim.nitroReady,
      nitroSmashVisual: this.playerSim.nitroSmashVisualStrength,
      comboSmash: this.lastComboWasSmash,
      musicPattern: this.lastMusicPattern,
      musicScene: this.currentMusicSceneTelemetry(),
      requestedDensity: this.requestedDensity,
      effectiveDensity: this.generator.effectiveDensity,
      effectiveCoinFrequency: this.generator.effectiveCoinFrequency,
      musicEnergy: this.musicEnergy,
      musicBrightness: this.musicBrightness,
      musicSilence: this.musicSilence,
      gameplayRules: this.gameplayRules,
      adrenalineMax: this.opts.game.adrenaline.max,
      runStats: {
        maxCombo: this.maxCombo,
        smashes: this.totalSmashes,
        tricks: this.totalTricks,
        trainRideSeconds: this.trainRideSeconds,
        carSeconds: this.carSeconds,
        horseSeconds: this.horseSeconds,
        modeSwitches: this.modeSwitches,
        horseOffers: this.horseOffers,
        carOffers: this.carOffers,
        horsePickups: this.horsePickups,
        carPickups: this.carPickups,
        horseJumpClears: this.horseJumpClears,
        horseSlideClears: this.horseSlideClears,
        rocketOffers: this.rocketOffers,
        rocketPickups: this.rocketPickups,
        rocketSeconds: this.rocketSeconds,
        hits: this.totalHits,
        nitroActivations: this.nitroActivations,
        blasterSaves: this.blasterSaves,
        maxHorseMomentum: this.maxHorseMomentum,
        recoverySteps: this.recoverySteps,
        hitsWhileDamaged: this.hitsWhileDamaged,
        woundedSeconds: this.woundedSeconds,
      },
      levelIntroActive: this.levelIntroActive,
      levelIntroElapsed: this.levelIntroElapsed,
    };
  }

  private fixedUpdateLevelIntro(dt: number): void {
    const introCfg = this.opts.game.levelIntro;
    const speeds = this.opts.game.speeds;
    this.levelIntroElapsed += dt;
    const targetSpeed = levelIntroTargetSpeed(speeds.base, speeds.rampPerSecond, introCfg);
    const speed = levelIntroSpeedAt(this.levelIntroElapsed, targetSpeed, introCfg);
    this.playerSim.applyLevelIntroMotion(dt, speed);
    this.scrollWorld(speed, dt);
    if (!this.rhythmEnabled) {
      this.ensureChunks();
      this.reconcileLevelIntroObstacle();
    }
    if (this.levelIntroElapsed >= introCfg.countdownSeconds) {
      this.completeLevelIntro(targetSpeed, introCfg.countdownSeconds);
    }
    this.sfxEvents.observe(this.getSfxState());
  }

  private completeLevelIntro(targetSpeed: number, countdownSeconds: number): void {
    this.playerSim.completeLevelIntro(targetSpeed, countdownSeconds);
    this.levelIntroActive = false;
    this.levelIntroObstacleId = null;
  }

  private reconcileLevelIntroObstacle(): void {
    if (this.levelIntroObstacleId === null) return;
    const lane = this.playerSim.state.lane;
    const minZ = this.levelIntroObstacleZ * 0.9;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      if (obstacle.id === this.levelIntroObstacleId) continue;
      if (obstacle.lane !== lane) continue;
      if (!this.isIntroBlockingObstacle(obstacle)) continue;
      if (obstacle.z > 0 && obstacle.z < minZ) {
        this.obstacles.splice(i, 1);
      }
    }
  }

  private isIntroBlockingObstacle(obstacle: ObstacleEntity): boolean {
    return (obstacle.kind === 'low' || obstacle.kind === 'tall') &&
      !obstacle.broken &&
      !obstacle.cleared;
  }

  private updateLaneStickiness(player: PlayerState, dt: number): void {
    if (player.mode !== 'car' || player.gameOver) {
      this.laneStickSeconds = 0;
      this.generator.setCoinPullLane(null);
      return;
    }
    if (player.lane === this.laneStickLane) {
      this.laneStickSeconds += dt;
    } else {
      this.laneStickLane = player.lane;
      this.laneStickSeconds = 0;
    }
    if (this.laneStickSeconds >= 5.5) {
      this.generator.setCoinPullLane(this.preferredAdjacentLane(player.lane));
    } else {
      this.generator.setCoinPullLane(null);
    }
  }

  private preferredAdjacentLane(lane: number): number {
    const lanes = this.opts.game.lane.positions.length;
    if (lane <= 0) return 1;
    if (lane >= lanes - 1) return lanes - 2;
    return lane < lanes / 2 ? lane + 1 : lane - 1;
  }

  private scrollWorld(speed: number, dt: number): void {
    for (const zone of this.sceneryZones) zone.z -= speed * dt;
    for (const obstacle of this.obstacles) {
      if (obstacle.trainId !== undefined) continue;
      if (obstacle.rampGuideId !== undefined) continue;
      const relative = obstacle.redWall || obstacle.nitroChallenge
        ? Math.max(speed, MIN_RELATIVE_SPEED)
        : this.obstacleScrollSpeed(speed, obstacle.lane, obstacle.flowGroupId, obstacle);
      obstacle.z -= relative * dt;
    }
    for (const train of this.trains) {
      const relative = this.trainScrollSpeed(speed, train.lane);
      if (train.rideStarted) {
        const rideProgress = train.rideRemaining / train.rideDuration;
        train.z =
          (train.length - train.landingInset) * rideProgress -
          train.length / 2;
      } else if (train.landingDelay > 0) {
        train.landingDelay = Math.max(0, train.landingDelay - dt);
        train.z =
          relative * train.landingDelay +
          train.length / 2 -
          train.landingInset;
        if (train.landingDelay === 0 && train.companionOf !== undefined) {
          train.rideStarted = true;
          const source = this.trains.find((candidate) => candidate.id === train.companionOf);
          if (source?.rideStarted) {
            train.rideRemaining = source.rideRemaining;
            train.z =
              (train.length - train.landingInset) *
                (train.rideRemaining / train.rideDuration) -
              train.length / 2;
          }
        }
      } else {
        train.z -= relative * dt;
      }
    }
    for (const obstacle of this.obstacles) {
      if (obstacle.trainId === undefined) continue;
      const train = this.trains.find((candidate) => candidate.id === obstacle.trainId);
      if (!train) continue;
      obstacle.z = train.z + (obstacle.trainOffsetZ ?? 0);
      obstacle.y = train.height;
    }
    this.clearTrainBodies();
    for (const coin of this.coins) {
      if (coin.trainId !== undefined) {
        const train = this.trains.find((candidate) => candidate.id === coin.trainId);
        if (train) {
          coin.z = train.z + (coin.trainOffsetZ ?? 0);
          coin.y = train.height + this.opts.game.train.coinHeight;
        }
      } else if (coin.actionGroupId !== undefined) {
        const host = this.obstacles.find(
          (obstacle) =>
            obstacle.actionGroupId === coin.actionGroupId &&
            obstacle.lane === coin.lane &&
            !obstacle.broken,
        );
        if (host) {
          coin.z = host.z;
        } else {
          coin.z -= this.obstacleScrollSpeed(speed, coin.lane, coin.flowGroupId) * dt;
        }
      } else if (coin.airTargetTime === undefined && coin.rampGuideId === undefined) {
        coin.z -= this.obstacleScrollSpeed(speed, coin.lane, coin.flowGroupId) * dt;
      } else if (coin.airTargetTime === undefined) {
        coin.z -= speed * dt;
      } else if (
        this.playerSim.state.airState === 'airborne' ||
        this.playerSim.state.airState === 'trainExit'
      ) {
        coin.z =
          (coin.airTargetTime - this.playerSim.state.airTime) *
          Math.max(this.playerSim.state.speed, 1);
      } else {
        coin.z -= speed * dt;
      }
    }
    for (const bonus of this.bonuses) {
      if (bonus.trainId !== undefined) {
        const train = this.trains.find((candidate) => candidate.id === bonus.trainId);
        if (train) {
          bonus.z = train.z + (bonus.trainOffsetZ ?? 0);
          bonus.y = train.height + this.opts.game.player.height * 0.5;
        }
      } else if (
        bonus.airTargetTime !== undefined &&
        this.playerSim.state.airState !== 'grounded'
      ) {
        bonus.z =
          (bonus.airTargetTime - this.playerSim.state.airTime) *
          Math.max(this.playerSim.state.speed, 1);
      } else {
        bonus.z -= speed * dt;
      }
    }
    for (const ramp of this.ramps) {
      const relative = ramp.gateId === undefined
        ? Math.max(speed + this.laneFlowFor(ramp.lane), MIN_RELATIVE_SPEED)
        : Math.max(speed, MIN_RELATIVE_SPEED);
      ramp.z -= relative * dt;
    }
    for (const obstacle of this.obstacles) {
      if (obstacle.rampGuideId === undefined) continue;
      const ramp = this.ramps.find(
        (candidate) => candidate.id === obstacle.rampGuideId,
      );
      if (ramp) obstacle.z = ramp.z + (obstacle.rampOffsetZ ?? 0);
    }
    for (const coin of this.coins) {
      if (coin.rampGuideId === undefined) continue;
      const ramp = this.ramps.find((candidate) => candidate.id === coin.rampGuideId);
      if (ramp) coin.z = ramp.z + (coin.rampOffsetZ ?? 0);
    }
    this.removeBehind(this.obstacles);
    this.removeBehind(this.coins);
    this.removeBehind(this.bonuses);
    this.removeBehind(this.ramps);
    this.removeBehind(this.trains);
    for (let index = this.sceneryZones.length - 1; index >= 0; index--) {
      const zone = this.sceneryZones[index];
      if (zone.z + zone.length < -this.behindBuffer) this.sceneryZones.splice(index, 1);
    }
    this.removeOrphanTrainCoins();
    this.removeOrphanTrainObstacles();
    this.removeOrphanTrainBonuses();
    this.removeAhead(this.obstacles);
    this.removeAhead(this.ramps);
  }

  private removeBehind<T extends { z: number }>(entities: T[]): void {
    for (let i = entities.length - 1; i >= 0; i--) {
      if (entities[i].z < -this.behindBuffer) entities.splice(i, 1);
    }
  }

  private clearTrainBodies(): void {
    for (const train of this.trains) {
      const rear = train.z - train.length / 2 - this.opts.game.obstacle.depth;
      const front = train.z + train.length / 2 + this.opts.game.obstacle.depth;
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const obstacle = this.obstacles[i];
        if (
          obstacle.trainId === undefined &&
          obstacle.lane === train.lane &&
          obstacle.z >= rear &&
          obstacle.z <= front
        ) {
          this.obstacles.splice(i, 1);
        }
      }
    }
  }

  private removeOrphanTrainCoins(): void {
    const trainIds = new Set(this.trains.map((train) => train.id));
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const trainId = this.coins[i].trainId;
      if (trainId !== undefined && !trainIds.has(trainId)) this.coins.splice(i, 1);
    }
  }

  private removeOrphanTrainObstacles(): void {
    const trainIds = new Set(this.trains.map((train) => train.id));
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const trainId = this.obstacles[i].trainId;
      if (trainId !== undefined && !trainIds.has(trainId)) this.obstacles.splice(i, 1);
    }
  }

  private removeOrphanTrainBonuses(): void {
    for (let i = this.bonuses.length - 1; i >= 0; i--) {
      const trainId = this.bonuses[i].trainId;
      if (
        trainId !== undefined &&
        !this.trains.some((train) => train.id === trainId)
      ) {
        this.bonuses.splice(i, 1);
      }
    }
  }

  private removeAhead<T extends { z: number }>(entities: T[]): void {
    const currentChunk = Math.floor(this.playerSim.state.distance / this.levelgen.chunkLength);
    const aheadBuffer =
      (currentChunk + this.levelgen.segmentsAhead + 2) * this.levelgen.chunkLength;
    for (let i = entities.length - 1; i >= 0; i--) {
      if (entities[i].z > aheadBuffer) entities.splice(i, 1);
    }
  }

  private onLanding(landing: LandingResult): void {
    const player = this.playerSim.state;
    this.totalTricks += landing.trickCount;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      if (this.coins[i].airPathId !== undefined) this.coins.splice(i, 1);
    }
    for (let i = this.bonuses.length - 1; i >= 0; i--) {
      const bonus = this.bonuses[i];
      if (bonus.collected) continue;
      if (bonus.airPathId !== undefined || bonus.airTargetTime !== undefined) {
        this.bonuses.splice(i, 1);
      }
    }
    const zTolerance =
      (this.opts.game.obstacle.depth + this.opts.game.player.depth) / 2 -
      this.opts.game.hit.zGrace;
    const landedOn = this.obstacles.find(
      (o) =>
        !o.broken &&
        o.trainId === undefined &&
        Math.abs(o.z) <= zTolerance &&
        o.lane === player.lane,
    );
    if (landedOn) {
      if (
        this.gameplayRules === 'destroy' &&
        player.mode === 'car' &&
        landedOn.kind === 'low' &&
        !landedOn.unbreakable
      ) {
        if (this.playerSim.canSmashWithNitro) {
          this.handleDestroyCarHit(landedOn, false, false);
        } else {
          this.startCarMediumKnockback(landedOn, 'green');
          this.gainDestroyCharge(this.opts.game.destroy.gainPerMediumSmash);
          this.totalSmashes += 1;
          this.registerSmashHit();
        }
        return;
      }
      landedOn.broken = true;
      return;
    }
    const tricks = landing.trickCount;
    if (tricks <= 0) return;
    this.gainNitro(tricks * this.opts.game.ramp.trickNitroGain);
    const trickCoins = tricks * this.opts.game.ramp.trickCoinGain;
    player.coins += trickCoins;
    const mult = trickScoreMultiplier(tricks, this.opts.game.ramp);
    if (mult > 1) {
      this.score.addBonus(trickCoins * this.opts.game.coin.value * (mult - 1));
    }
  }

  private spawnAirCoinPath(trainLane: number | null = null): number {
    const cfg = this.opts.game.ramp;
    const player = this.playerSim.state;
    const activePattern = this.airPathPattern % 2 === 1;
    this.airPathPattern += 1;
    const count = activePattern ? cfg.airCoinActiveCount : cfg.airCoinCalmCount;
    const pathId = this.nextAirPathId++;
    const direction = player.lane < this.levelgen.lanes / 2 ? 1 : -1;
    const calmOffsets = [0, 0, direction, direction, 0];
    const activeOffsets = [0, direction, 0, direction * 2, direction, 0, direction];
    const offsets = activePattern ? activeOffsets : calmOffsets;

    for (let i = 0; i < count; i++) {
      const progress = count === 1 ? 0.5 : i / (count - 1);
      const targetTime =
        cfg.airCoinStartSeconds +
        (cfg.airCoinEndSeconds - cfg.airCoinStartSeconds) * progress;
      const offset = offsets[i % offsets.length];
      const lane = trainLane === null
        ? clampLane(player.lane + offset, this.levelgen.lanes)
        : Math.round(player.lane + (trainLane - player.lane) * progress);
      this.coins.push({
        id: this.nextAirCoinId--,
        lane,
        z: targetTime * Math.max(player.speed, 1),
        y:
          airHeight(cfg, targetTime) +
          (trainLane === null
            ? 0
            : this.opts.game.train.height * (targetTime / cfg.flightTimeSeconds)),
        collected: false,
        airPathId: pathId,
        airTargetTime: targetTime,
      });
    }
    return pathId;
  }

  private maybeSpawnTrain(
    phase: string,
    chanceMultiplier = 1,
    excludeLane?: number,
  ): number | null {
    const cfg = this.opts.game.train;
    if (
      this.trainCooldownRemaining > 0 ||
      this.trainRng() >= cfg.chance * chanceMultiplier
    ) {
      return null;
    }

    const player = this.playerSim.state;
    const candidates = Array.from(
      { length: this.levelgen.lanes },
      (_, lane) => lane,
    ).filter(
      (lane) =>
        cfg.allowedLanes.includes(lane) &&
        Math.abs(lane - player.lane) <= 2 &&
        lane !== excludeLane,
    );
    if (candidates.length === 0) return null;
    const lane = candidates[Math.floor(this.trainRng() * candidates.length)];
    const rideDuration = trainDurationForPhase(phase, cfg.durations);
    const expectedSpeed = clamp(
      player.speed * this.opts.game.ramp.boostMultiplier,
      this.opts.game.speeds.min,
      this.opts.game.speeds.max,
    );
    const relative = Math.max(expectedSpeed + this.laneFlowFor(lane), MIN_RELATIVE_SPEED);
    const expectsCompanion = this.trainRng() < cfg.companionChance;
    const lengthScale = expectsCompanion ? 1 : cfg.soloLengthScale;
    const length = Math.max(
      cfg.landingInset + this.opts.game.player.depth * 4,
      relative * rideDuration * cfg.lengthMultiplier * lengthScale,
    );
    const train: TrainEntity = {
      id: this.nextTrainId--,
      lane,
      z:
        relative * this.opts.game.ramp.flightTimeSeconds +
        length / 2 -
        cfg.landingInset,
      length,
      height: cfg.height,
      rideDuration,
      rideRemaining: rideDuration,
      landingDelay: this.opts.game.ramp.flightTimeSeconds,
      landingInset: cfg.landingInset,
      rideStarted: false,
      variant: 0,
      expectsCompanion,
      avoidLane: excludeLane,
    };
    this.trains.push(train);
    this.pendingTrainId = train.id;
    this.spawnTrainCoins(train);
    if (!expectsCompanion) {
      this.maybeSpawnTrainRoofObstacle(train);
    }
    this.trainCooldownRemaining = cfg.cooldownSeconds;
    return lane;
  }

  private spawnTrainCoins(train: TrainEntity): void {
    const spacingSeconds = this.opts.game.train.coinSpacingSeconds;
    const startSeconds = 0.35;
    const endSeconds = Math.max(startSeconds, train.rideDuration - 0.25);
    const count = Math.floor((endSeconds - startSeconds) / spacingSeconds) + 1;
    const firstOffset = -train.length / 2 + train.landingInset + 2;
    const lastOffset = train.length / 2 - 2;
    for (let i = 0; i < count; i++) {
      const progress = count === 1 ? 0.5 : i / (count - 1);
      const offset = firstOffset + (lastOffset - firstOffset) * progress;
      this.coins.push({
        id: this.nextAirCoinId--,
        lane: train.lane,
        z: train.z + offset,
        y: train.height + this.opts.game.train.coinHeight,
        collected: false,
        trainId: train.id,
        trainOffsetZ: offset,
      });
    }
  }

  private maybeSpawnCompanionTrain(
    source: TrainEntity,
    force = false,
    minLeadSeconds = 0,
    musicSceneId?: number,
  ): boolean {
    const cfg = this.opts.game.train;
    if (
      source.companionOf !== undefined ||
      source.expectsCompanion === false ||
      this.trains.some((train) => train.companionOf === source.id) ||
      (!force &&
        source.expectsCompanion !== true &&
        this.trainRng() >= cfg.companionChance)
    ) {
      return false;
    }
    const lane = cfg.allowedLanes.find((candidate) => candidate !== source.lane);
    if (lane === undefined) return false;
    const delay = force
      ? Math.max(cfg.companionDelayMinSeconds, minLeadSeconds)
      : cfg.companionDelayMinSeconds +
        this.trainRng() *
          Math.max(0, cfg.companionDelayMaxSeconds - cfg.companionDelayMinSeconds);
    if (force && source.rideRemaining <= delay + 0.5) return false;
    const rideDuration = source.rideDuration;
    const relative = Math.max(
      this.playerSim.state.speed + this.laneFlowFor(lane),
      MIN_RELATIVE_SPEED,
    );
    const length = Math.max(
      cfg.landingInset + this.opts.game.player.depth * 4,
      relative * rideDuration * cfg.lengthMultiplier,
    );
    const train: TrainEntity = {
      id: this.nextTrainId--,
      lane,
      z: relative * delay + length / 2 - cfg.landingInset,
      length,
      height: cfg.height,
      rideDuration,
      rideRemaining: source.rideRemaining,
      landingDelay: delay,
      landingInset: cfg.landingInset,
      rideStarted: false,
      variant: 1,
      companionOf: source.id,
      musicSceneId,
      echoSpawnTime: musicSceneId === undefined ? undefined : this.playerSim.state.gameTime,
      echoSourceLane: musicSceneId === undefined ? undefined : source.lane,
    };
    this.trains.push(train);
    this.spawnTrainCoins(train);
    this.removeTrainRoofObstaclesExceptTransfer(source.id);
    this.prepareCompanionTransfer(source, train, delay);
    return true;
  }

  private prepareCompanionTransfer(
    source: TrainEntity,
    companion: TrainEntity,
    delay: number,
  ): void {
    const cfg = this.opts.game.train;
    const encounterTime = clamp(
      delay + cfg.companionObstacleDelaySeconds,
      delay + cfg.transferLeadSeconds + 0.35,
      Math.max(1.35, source.rideDuration - 0.35),
    );
    const sourceTravel = source.length - source.landingInset;
    const obstacleOffset =
      -source.length / 2 +
      source.landingInset +
      sourceTravel * (encounterTime / source.rideDuration);
    this.obstacles.push({
      id: this.nextTrainObstacleId--,
      kind: 'tall',
      lane: source.lane,
      z: source.z + obstacleOffset,
      y: source.height,
      trainId: source.id,
      trainOffsetZ: obstacleOffset,
      unbreakable: true,
      companionTransfer: true,
    });

    const coinCutOffset =
      obstacleOffset -
      this.playerSim.state.speed * cfg.companionCoinCutLeadSeconds;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (
        coin.trainId === source.id &&
        (coin.trainOffsetZ ?? Number.NEGATIVE_INFINITY) >= coinCutOffset
      ) {
        this.coins.splice(i, 1);
      }
    }

    const companionCoins = this.coins.filter((coin) => coin.trainId === companion.id);
    if (companionCoins.length > 0) {
      companionCoins[0].trainOffsetZ =
        -companion.length / 2 + companion.landingInset + 1;
    }
  }

  private maybeSpawnTrainRoofObstacle(train: TrainEntity): void {
    const cfg = this.opts.game.train;
    if (train.expectsCompanion || train.companionOf !== undefined) return;
    if (this.trainRng() >= cfg.roofObstacleChance) return;
    const landingClear = cfg.roofObstacleLandingClearProgress;
    const progressMin = Math.max(cfg.roofObstacleProgressMin, landingClear);
    const progressMax = Math.max(progressMin + 0.04, cfg.roofObstacleProgressMax);
    const progress =
      progressMin +
      this.trainRng() * Math.max(0, progressMax - progressMin);
    const startOffset = -train.length / 2 + train.landingInset;
    const travel = train.length - train.landingInset;
    const offset = startOffset + travel * progress;
    this.obstacles.push({
      id: this.nextTrainObstacleId--,
      kind: 'tall',
      lane: train.lane,
      z: train.z + offset,
      y: train.height,
      trainId: train.id,
      trainOffsetZ: offset,
      unbreakable: true,
    });
  }

  private tryLandOnTrain(): void {
    const player = this.playerSim.state;
    const laneCenter = this.opts.game.lane.positions[player.lane];
    const train = this.trains.find((candidate) => {
      const rear = candidate.z - candidate.length / 2;
      const front = candidate.z + candidate.length / 2;
      return (
        candidate.lane === player.lane &&
        Math.abs(player.laneX - laneCenter) <= this.opts.game.player.width / 2 &&
        rear <= this.opts.game.player.depth &&
        front >= -this.opts.game.player.depth
      );
    });
    this.pendingTrainId = null;
    this.playerSim.setAirLandingHeight(0);
    if (!train) return;
    train.landingDelay = 0;
    train.rideRemaining = train.rideDuration;
    train.rideStarted = true;
    this.activeTrainId = train.id;
    this.playerSim.landOnTrain();
    this.maybeSpawnCompanionTrain(train);
  }

  private updateTrainRide(dt: number, wasTrainRoof: boolean, laneBeforeUpdate: number): void {
    const player = this.playerSim.state;
    if (wasTrainRoof && this.activeTrainId !== null) {
      this.trainRideSeconds += dt;
    }
    if (wasTrainRoof && this.activeTrainId !== null) {
      const train = this.trains.find((candidate) => candidate.id === this.activeTrainId);
      if (!train) {
        this.removeAllTrainCoins();
        this.activeTrainId = null;
        this.playerSim.exitTrain();
      } else if (player.lane !== laneBeforeUpdate) {
        const target = this.findRideableTrain(player.lane);
        if (target) {
          this.activeTrainId = target.id;
        } else {
          this.removeAllTrainCoins();
          this.activeTrainId = null;
          this.playerSim.exitTrain();
        }
      }
    }

    const activeTrain = this.activeTrainId === null
      ? null
      : this.trains.find((candidate) => candidate.id === this.activeTrainId) ?? null;
    if (player.airState === 'trainRoof' && activeTrain) {
      this.explodeTrainSideObstacles(activeTrain.lane);
      if (
        activeTrain.rideRemaining <=
        this.opts.game.horse.horseTrainPickupSpawnLeadSeconds
      ) {
        this.maybeSpawnHorseBonusAtTrainEnd(activeTrain);
      }
    }

    for (const train of this.trains) {
      if (!train.rideStarted || train.companionOf !== undefined) continue;
      const rideDrain = this.trainRideDrainScale(train);
      train.rideRemaining = Math.max(0, train.rideRemaining - dt * rideDrain);
    }
    for (const train of this.trains) {
      if (!train.companionOf || !train.rideStarted) continue;
      const source = this.trains.find((candidate) => candidate.id === train.companionOf);
      if (!source?.rideStarted) continue;
      train.rideRemaining = source.rideRemaining;
      train.z =
        (train.length - train.landingInset) *
          (train.rideRemaining / train.rideDuration) -
        train.length / 2;
    }
    for (const train of this.trains) {
      if (!train.rideStarted) continue;
      if (train.rideRemaining > 0) continue;
      train.rideStarted = false;
      this.removeTrainCoins(train.id);
      this.removeTrainObstacles(train.id);
      this.removeTrainBonuses(train.id);
      if (train.id !== this.activeTrainId) continue;
      this.clearTrainLandingCorridor(train.lane);
      this.removeAllTrainCoins();
      this.spawnTrainExitCoins(train.lane);
      this.activeTrainId = null;
      this.playerSim.exitTrain();
    }
  }

  private findRideableTrain(lane: number): TrainEntity | null {
    const train = this.trains.find((candidate) => {
      if (candidate.rideRemaining <= 0 || candidate.lane !== lane) return false;
      return (
        candidate.rideStarted ||
        (candidate.landingDelay > 0 &&
          candidate.landingDelay <= this.opts.game.train.transferLeadSeconds)
      );
    }) ?? null;
    if (!train) return null;
    if (!train.rideStarted) {
      train.landingDelay = 0;
      train.rideStarted = true;
      train.z = train.length / 2 - train.landingInset;
    }
    return train;
  }

  private guardApproachingTrainTransfer(input: ConsumedInput): ConsumedInput {
    const player = this.playerSim.state;
    if (player.airState !== 'trainRoof' || input.laneDelta === 0) return input;
    const targetLane = clamp(
      player.lane + input.laneDelta,
      0,
      this.levelgen.lanes - 1,
    );
    const approaching = this.trains.find(
      (train) =>
        train.lane === targetLane &&
        !train.rideStarted &&
        train.rideRemaining > 0 &&
        train.landingDelay > this.opts.game.train.transferLeadSeconds,
    );
    return approaching ? { ...input, laneDelta: 0 } : input;
  }

  private updateTrainLandingTarget(_dt: number): void {
    const player = this.playerSim.state;
    if (
      player.airState !== 'airborne' ||
      player.airSource !== 'ramp' ||
      this.pendingTrainId === null
    ) {
      this.playerSim.clearTrainLandingGuide();
      return;
    }
    const train = this.trains.find((candidate) => candidate.id === this.pendingTrainId);
    if (!train) {
      this.pendingTrainId = null;
      this.playerSim.clearTrainLandingGuide();
      this.playerSim.setAirLandingHeight(0);
      return;
    }
    const rampCfg = this.opts.game.ramp;
    const airProgress = clamp(
      player.airTime / rampCfg.flightTimeSeconds,
      0,
      1,
    );
    const engage = smoothstep(
      rampCfg.trainLandingEngageStart,
      0.95,
      airProgress,
    );
    const targetX = this.opts.game.lane.positions[train.lane];
    const laneSpan = Math.abs(
      this.opts.game.lane.positions[1] - this.opts.game.lane.positions[0],
    );
    const alignment = clamp(1 - Math.abs(player.laneX - targetX) / laneSpan, 0, 1);
    const heightEngage = engage * (0.25 + 0.75 * alignment);
    this.playerSim.setAirLandingHeight(train.height * heightEngage);
    this.playerSim.guideTrainLandingLane(train.lane, engage);
  }

  private removeTrainCoins(trainId: number): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      if (this.coins[i].trainId === trainId) this.coins.splice(i, 1);
    }
  }

  private removeAllTrainCoins(): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      if (this.coins[i].trainId !== undefined) this.coins.splice(i, 1);
    }
  }

  private removeTrainObstacles(trainId: number): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      if (this.obstacles[i].trainId === trainId) this.obstacles.splice(i, 1);
    }
  }

  private removeTrainRoofObstaclesExceptTransfer(trainId: number): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      if (
        obstacle.trainId === trainId &&
        !obstacle.companionTransfer
      ) {
        this.obstacles.splice(i, 1);
      }
    }
  }

  private removeTrainBonuses(trainId: number): void {
    for (let i = this.bonuses.length - 1; i >= 0; i--) {
      if (this.bonuses[i].trainId === trainId) this.bonuses.splice(i, 1);
    }
  }

  private explodeTrainSideObstacles(trainLane: number): void {
    const cfg = this.opts.game.train;
    for (const obstacle of this.obstacles) {
      if (obstacle.broken || obstacle.unbreakable || obstacle.lane === trainLane) continue;
      if (obstacle.z < -cfg.sideBlastBehind || obstacle.z > cfg.sideBlastAhead) continue;
      obstacle.broken = true;
      obstacle.smashed = true;
    }
  }

  private clearTrainLandingCorridor(lane: number): void {
    const player = this.playerSim.state;
    const maxZ =
      player.speed *
      (this.opts.game.train.exitDurationSeconds + this.opts.game.train.landingClearSeconds);
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      if (obstacle.lane === lane && obstacle.z >= -3 && obstacle.z <= maxZ) {
        this.obstacles.splice(i, 1);
      }
    }
  }

  private spawnTrainExitCoins(lane: number): void {
    const cfg = this.opts.game.train;
    const count = 4;
    const pathId = this.nextAirPathId++;
    for (let i = 0; i < count; i++) {
      const progress = (i + 1) / (count + 1);
      const targetTime = cfg.exitDurationSeconds * progress;
      this.coins.push({
        id: this.nextAirCoinId--,
        lane,
        z: targetTime * Math.max(this.playerSim.state.speed, 1),
        y:
          cfg.height * (1 - progress) +
          4 * cfg.exitArcHeight * progress * (1 - progress) +
          cfg.coinHeight,
        collected: false,
        airPathId: pathId,
        airTargetTime: targetTime,
      });
    }
  }

  private updateTrainCollision(): void {
    const player = this.playerSim.state;
    if (player.mode === 'rocket' || player.airState !== 'grounded' || player.isHit) return;
    const train = this.trains.find((candidate) => {
      const halfDepth = candidate.length / 2 + this.opts.game.player.depth / 2;
      const laneCenter = this.opts.game.lane.positions[candidate.lane];
      return (
        Math.abs(candidate.z) <= halfDepth &&
        Math.abs(player.laneX - laneCenter) <=
          (this.opts.game.train.width + this.opts.game.player.width) / 2
      );
    });
    if (!train) return;
    if (player.mode === 'horse' && this.consumeHorseBlaster()) {
      this.removeTrainCoins(train.id);
      this.removeTrainObstacles(train.id);
      this.removeTrainBonuses(train.id);
      const trainIndex = this.trains.findIndex((candidate) => candidate.id === train.id);
      if (trainIndex >= 0) this.trains.splice(trainIndex, 1);
      return;
    }
    if (player.isAbilityActive) {
      this.playerSim.interruptNitro();
      this.sfxEvents.observe(this.getSfxState());
      this.nitroActive = false;
      this.nitroReady = false;
      this.generator.setNitroActive(false);
      this.generator.setNitroReady(false);
      this.downgradeMandatoryNitroChallenges(player.lane);
    }
    const damageBefore = player.damageState;
    this.playerSim.registerHit();
    this.totalHits += 1;
    this.emitPlaytestHit(undefined, 'train', damageBefore);
    this.emitPlaytestGameOverIfNeeded();
    this.comboSystem.onHit();
    this.lastComboWasSmash = false;
  }

  private updateTrainRoofCollision(): void {
    const player = this.playerSim.state;
    if (player.airState !== 'trainRoof' || this.activeTrainId === null || player.isHit) return;
    const zTolerance =
      (this.opts.game.obstacle.depth + this.opts.game.player.depth) / 2 -
      this.opts.game.hit.zGrace;
    const obstacle = this.obstacles.find(
      (candidate) =>
        candidate.unbreakable &&
        candidate.trainId === this.activeTrainId &&
        candidate.lane === player.lane &&
        Math.abs(candidate.z) <= zTolerance,
    );
    if (!obstacle) return;
    if (player.mode === 'horse' && this.consumeHorseBlaster()) return;
    this.playerSim.interruptNitro();
    this.sfxEvents.observe(this.getSfxState());
    this.nitroActive = false;
    this.nitroReady = false;
    this.generator.setNitroActive(false);
    this.generator.setNitroReady(false);
    const damageBefore = player.damageState;
    this.playerSim.registerHit();
    this.totalHits += 1;
    this.noteDodgeHit(obstacle.id);
    this.emitPlaytestHit(obstacle, 'train_roof', damageBefore);
    this.emitPlaytestGameOverIfNeeded();
    this.comboSystem.onHit();
    this.lastComboWasSmash = false;
    this.removeAllTrainCoins();
    this.activeTrainId = null;
    this.playerSim.exitTrain();
  }

  private laneFlowFor(lane: number): number {
    const flow = this.levelgen.laneFlow;
    return flow && lane >= 0 && lane < flow.length ? flow[lane] : 0;
  }

  private trainRideDrainScale(train: TrainEntity): number {
    const hasCompanion = this.trains.some((candidate) => candidate.companionOf === train.id);
    if (
      train.companionOf !== undefined ||
      train.expectsCompanion ||
      hasCompanion
    ) {
      return 1;
    }
    return this.laneFlowFor(train.lane) > 0
      ? this.opts.game.train.parallelRideDrainScale
      : 1;
  }

  private trainScrollSpeed(speed: number, lane: number): number {
    const flow = this.laneFlowFor(lane);
    const trainCfg = this.opts.game.train;
    const flowScale =
      flow > 0
        ? trainCfg.parallelScrollScale
        : flow < 0
          ? trainCfg.counterflowScrollScale
          : 1;
    return Math.max(speed + flow * flowScale, MIN_RELATIVE_SPEED);
  }

  private obstacleScrollSpeed(speed: number, lane: number, flowGroupId?: number, obstacle?: ObstacleEntity): number {
    return carTrafficScrollSpeed(speed, lane, this.levelgen, obstacle ?? { flowGroupId });
  }

  private updateTurbo(dt: number, music: MusicState): number {
    const cfg = this.opts.game.turbo;
    const energy = Number(music.energy.value);
    const trackTime = this.opts.getTrackTime?.();
    const earlyTrack =
      trackTime !== undefined && trackTime <= cfg.earlyTrackSeconds;
    const beatSyncTimeout = earlyTrack
      ? Math.min(cfg.earlyTrackBeatSyncSeconds, cfg.beatSyncTimeoutSeconds)
      : cfg.beatSyncTimeoutSeconds;
    const baselineAlpha = 1 - Math.exp(-dt / cfg.historySeconds);
    this.turboEnergyBaseline += (energy - this.turboEnergyBaseline) * baselineAlpha;
    this.turboEnergyHistory.push(energy);
    const maxHistory = Math.max(1, Math.ceil(cfg.historySeconds * 60));
    if (this.turboEnergyHistory.length > maxHistory) this.turboEnergyHistory.shift();
    const percentileEnergy = percentile(this.turboEnergyHistory, cfg.percentile);
    const relativeRise = energy - this.turboEnergyBaseline;
    const relativePeak = energy >= percentileEnergy;
    const sharpPeak =
      energy >= this.opts.game.pulse.strongBeatEnergyThreshold &&
      relativeRise >= cfg.relativeRiseThreshold * 1.8 &&
      relativePeak;
    const accentBeat =
      earlyTrack &&
      Boolean(music.beat.value) &&
      energy >= cfg.energyThreshold &&
      relativeRise >= cfg.relativeRiseThreshold &&
      relativePeak;
    const entrySeconds = earlyTrack ? cfg.earlyTrackEntrySeconds : cfg.entrySeconds;

    if (this.turboTimer > 0) {
      this.turboTimer -= dt;
      const elapsed = cfg.durationSeconds - Math.max(0, this.turboTimer);
      this.turbo = turboEnvelope(
        elapsed,
        cfg.durationSeconds,
        entrySeconds,
        cfg.exitSeconds,
      );
      if (this.turboTimer <= 0) {
        this.turboTimer = 0;
        this.turbo = 0;
        this.turboCooldown = cfg.cooldownSeconds;
      }
      return 1 + (cfg.speedBoost - 1) * this.turbo;
    }

    if (this.turboCooldown > 0) this.turboCooldown -= dt;
    if (this.turboCooldown < 0) this.turboCooldown = 0;

    if (this.turboArmedTimer > 0) {
      this.turboArmedTimer += dt;
      if (
        Boolean(music.beat.value) ||
        this.turboArmedTimer >= beatSyncTimeout
      ) {
        this.turboTimer = cfg.durationSeconds;
        this.turbo = entrySeconds > 0 ? Math.min(1, dt / entrySeconds) : 1;
        this.turboArmedTimer = 0;
        this.turboSustain = 0;
        this.spawnTurboScene();
        return 1 + (cfg.speedBoost - 1) * this.turbo;
      }
      return 1;
    }

    if (
      (sharpPeak || accentBeat) &&
      earlyTrack &&
      this.turboCooldown === 0 &&
      energy >= cfg.energyThreshold
    ) {
      this.turboTimer = cfg.durationSeconds;
      this.turbo = entrySeconds > 0 ? Math.min(1, dt / entrySeconds) : 1;
      this.turboSustain = 0;
      this.spawnTurboScene();
      return 1 + (cfg.speedBoost - 1) * this.turbo;
    }

    if (
      energy >= cfg.energyThreshold &&
      relativeRise >= cfg.relativeRiseThreshold &&
      relativePeak
    ) {
      this.turboSustain += dt;
      const sustainRequired =
        earlyTrack && (sharpPeak || accentBeat) ? 0.08 : cfg.sustainSeconds;
      if (this.turboSustain >= sustainRequired && this.turboCooldown === 0) {
        this.turboArmedTimer = dt;
        this.turboSustain = 0;
      }
    } else {
      this.turboSustain = 0;
    }
    return 1;
  }

  private spawnTurboScene(): void {
    if (this.turboSceneSpawned) return;
    this.turboSceneSpawned = true;
    const player = this.playerSim.state;
    if (player.airState !== 'grounded') return;

    const cfg = this.opts.game.turbo;
    const leadZ = Math.max(
      this.levelgen.minGapZ * 2,
      player.speed * cfg.sceneLeadSeconds,
    );
    const gap = this.levelgen.minGapZ * 1.35;
    const endZ = leadZ + (cfg.sceneRows - 1) * gap;
    this.clearTurboSceneArea(leadZ - 2, endZ + 2);

    if (player.mode === 'horse') {
      for (let row = 0; row < cfg.sceneRows; row++) {
        const groupId = this.nextMusicGateId--;
        const z = leadZ + row * gap;
        for (let lane = 0; lane < this.levelgen.lanes; lane++) {
          this.obstacles.push({
            id: this.nextMusicEntityId--,
            kind: 'low',
            lane,
            z,
            horseAction: 'jump',
            actionGroupId: groupId,
            actionIndex: 0,
            actionCount: 1,
          });
          this.coins.push({
            id: this.nextMusicEntityId--,
            lane,
            z,
            y: this.levelgen.horse.jumpCoinHeight,
            collected: false,
            actionGroupId: groupId,
            routeKind: 'sceneGuide',
          });
        }
      }
      return;
    }

    for (let row = 0; row < cfg.sceneRows; row++) {
      const z = leadZ + row * gap;
      const safeLane = (player.lane + (row % 2 === 0 ? 0 : 1)) % this.levelgen.lanes;
      for (let offset = 1; offset <= 2; offset++) {
        this.obstacles.push({
          id: this.nextMusicEntityId--,
          kind: 'low',
          lane: (safeLane + offset) % this.levelgen.lanes,
          z,
        });
      }
      if (row !== 1) {
        this.coins.push({
          id: this.nextMusicEntityId--,
          lane: safeLane,
          z,
          y: this.levelgen.coinHeight,
          collected: false,
          routeKind: 'sceneGuide',
        });
      }
    }
    const tailZ = leadZ + cfg.sceneRows * gap;
    const tailBlocked = this.obstacles.some(
      (obstacle) =>
        !obstacle.broken &&
        obstacle.lane === player.lane &&
        Math.abs(obstacle.z - tailZ) < this.levelgen.minGapZ * 0.45,
    );
    if (!tailBlocked) {
      this.coins.push({
        id: this.nextMusicEntityId--,
        lane: player.lane,
        z: tailZ,
        y: this.levelgen.coinHeight,
        collected: false,
        routeKind: 'safeGuide',
      });
    }
  }

  private clearTurboSceneArea(startZ: number, endZ: number): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      if (
        obstacle.trainId === undefined &&
        obstacle.z >= startZ &&
        obstacle.z <= endZ
      ) {
        this.obstacles.splice(i, 1);
      }
    }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (coin.trainId === undefined && coin.z >= startZ && coin.z <= endZ) {
        this.coins.splice(i, 1);
      }
    }
  }

  private syncTrackEndObstacles(): void {
    if (this.rhythmEnabled) return;
    const duration = this.opts.getTrackDuration?.() ?? 0;
    const time = this.opts.getTrackTime?.() ?? 0;
    if (duration <= 0) return;
    const remaining = duration - time;
    const stopSeconds = this.levelgen.trackEndObstacleStopSeconds;
    if (stopSeconds <= 0 || remaining > stopSeconds) return;
    const cutoffZ = -this.levelgen.minGapZ * 0.35;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      if (obstacle.trainId !== undefined) continue;
      if (obstacle.z > cutoffZ) this.obstacles.splice(i, 1);
    }
    for (let i = this.ramps.length - 1; i >= 0; i--) {
      if (this.ramps[i].z > cutoffZ) this.ramps.splice(i, 1);
    }
  }

  private ensureChunks(): void {
    if (this.rhythmEnabled && !this.ghost && !this.rhythmForecast) return;
    const distance = this.playerSim.state.distance;
    const chunkLength = this.levelgen.chunkLength;
    const currentChunk = Math.floor(distance / chunkLength);
    const target = currentChunk + this.levelgen.segmentsAhead;
    if (target <= this.lastGenerated) return;
    const player = this.playerSim.state;
    this.generator.setTrafficSpawnContext(
      player.distance,
      player.gameTime,
      player.speed,
      this.nitroReady,
    );
    const stagedObstacles: ObstacleEntity[] = [];
    const stagedCoins: CoinEntity[] = [];
    const stagedRamps: RampEntity[] = [];
    const stagedSceneryZones: SceneryZoneEntity[] = [];
    for (const chunk of this.generator.generateUpTo(target)) {
      for (const obstacle of chunk.obstacles) obstacle.z -= distance;
      for (const coin of chunk.coins) coin.z -= distance;
      for (const ramp of chunk.ramps) ramp.z -= distance;
      for (const zone of chunk.sceneryZones ?? []) zone.z -= distance;
      stagedObstacles.push(...chunk.obstacles);
      stagedCoins.push(...chunk.coins);
      stagedRamps.push(...chunk.ramps);
      stagedSceneryZones.push(...(chunk.sceneryZones ?? []));
    }
    this.updateRampAvailability(0, stagedObstacles, stagedRamps);
    if (this.rhythmEnabled && player.mode === 'car') {
      for (let i = stagedRamps.length - 1; i >= 0; i--) {
        if (stagedRamps[i].gateId !== undefined || (this.opts.getTrackTime?.() ?? player.gameTime) < 20) stagedRamps.splice(i, 1);
      }
      this.generator.stageMusicBackground(this.obstacles, stagedObstacles, this.coins,
        [...this.ramps, ...stagedRamps], this.rhythmPlacementContext());
    }
    if (player.mode === 'car') {
      const horizonObstacles = [...this.obstacles, ...stagedObstacles];
      const horizonRamps = [...this.ramps, ...stagedRamps];
      this.generator.repairCarHorizon(
        horizonObstacles,
        horizonRamps,
        player.lane,
        {
          obstacleIds: new Set(stagedObstacles.map((obstacle) => obstacle.id)),
          rampIds: new Set(stagedRamps.map((ramp) => ramp.id)),
        },
      );
      const keptObstacleIds = new Set(
        horizonObstacles.map((obstacle) => obstacle.id),
      );
      const keptRampIds = new Set(horizonRamps.map((ramp) => ramp.id));
      for (let index = stagedObstacles.length - 1; index >= 0; index--) {
        const obstacle = stagedObstacles[index];
        if (!keptObstacleIds.has(obstacle.id)) {
          stagedObstacles.splice(index, 1);
          continue;
        }
        if (
          obstacle.rampGuideId !== undefined &&
          !keptRampIds.has(obstacle.rampGuideId)
        ) {
          obstacle.routeGuide = false;
          obstacle.rampGuideId = undefined;
          obstacle.rampOffsetZ = undefined;
        }
      }
      for (let index = stagedRamps.length - 1; index >= 0; index--) {
        if (!keptRampIds.has(stagedRamps[index].id)) stagedRamps.splice(index, 1);
      }
    }
    const opening = this.generator.fillOpeningContent(
      [...this.obstacles, ...stagedObstacles],
      [...this.coins, ...stagedCoins].filter(coin =>
        !this.shouldSuppressDestroyCarCoin(coin) &&
        (coin.rampGuideId === undefined || [...this.ramps, ...stagedRamps].some(ramp => ramp.id === coin.rampGuideId)) &&
        !this.groundCoinBlocked(coin, [...this.obstacles, ...stagedObstacles], this.trains),
      ),
      [...this.ramps, ...stagedRamps],
      this.levelgen.contentStartZ + (this.lastGenerated + 1) * chunkLength - distance,
    );
    if (!this.rhythmEnabled) stagedObstacles.push(...opening.obstacles);
    stagedCoins.push(...opening.coins);
    this.obstacles.push(...stagedObstacles);
    this.ramps.push(...stagedRamps);
    this.sceneryZones.push(...stagedSceneryZones);
    const publishedRampIds = new Set(this.ramps.map((ramp) => ramp.id));
    for (const coin of stagedCoins) {
      if (this.rhythmEnabled && coin.musicTarget === undefined && Math.abs(coin.id) % 4 !== 0) continue;
      if (this.shouldSuppressDestroyCarCoin(coin)) continue;
      if (
        coin.rampGuideId !== undefined &&
        !publishedRampIds.has(coin.rampGuideId)
      ) {
        continue;
      }
      if (this.groundCoinBlocked(coin, this.obstacles, this.trains)) continue;
      this.coins.push(coin);
    }
    this.lastGenerated = target;
  }

  private groundCoinBlocked(
    coin: CoinEntity,
    obstacles: ObstacleEntity[] = this.obstacles,
    trains: TrainEntity[] = this.trains,
  ): boolean {
    if (coin.airPathId !== undefined || coin.trainId !== undefined) return false;
    const jumpY = this.levelgen.horse.jumpCoinHeight;
    if ((coin.y ?? this.levelgen.coinHeight) >= jumpY - 0.2) return false;
    return (
      this.collision.overlappingObstacle(coin, obstacles) !== null ||
      this.collision.overlappingTrain(coin, trains) !== null
    );
  }

  private updateRampAvailability(
    dt: number,
    obstacles = this.obstacles,
    ramps = this.ramps,
  ): void {
    this.rampCooldownRemaining = Math.max(0, this.rampCooldownRemaining - dt);
    this.trainCooldownRemaining = Math.max(0, this.trainCooldownRemaining - dt);
    if (this.rampCooldownRemaining === 0) this.protectedRampGateId = null;

    const beforeStart =
      this.playerSim.state.gameTime < this.opts.game.ramp.startDelaySeconds;
    if (!beforeStart && this.rampCooldownRemaining === 0) return;

    const player = this.playerSim.state;
    const remainingStartDelay = Math.max(
      0,
      this.opts.game.ramp.startDelaySeconds - player.gameTime,
    );
    const protectedGateId = beforeStart ? null : this.protectedRampGateId;
    const removedGateIds = new Set<number>();
    for (let i = ramps.length - 1; i >= 0; i--) {
      const ramp = ramps[i];
      if (beforeStart) {
        const relativeSpeed =
          ramp.gateId === undefined
            ? Math.max(player.speed + this.laneFlowFor(ramp.lane), MIN_RELATIVE_SPEED)
            : Math.max(player.speed, MIN_RELATIVE_SPEED);
        const arrivalSeconds = Math.max(0, ramp.z) / relativeSpeed;
        if (arrivalSeconds > remainingStartDelay) continue;
      }
      if (protectedGateId !== null && ramp.gateId === protectedGateId) continue;
      if (ramp.gateId !== undefined) removedGateIds.add(ramp.gateId);
      ramps.splice(i, 1);
    }
    if (removedGateIds.size === 0) return;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obstacle = obstacles[i];
      if (obstacle.gateId !== undefined && removedGateIds.has(obstacle.gateId)) {
        obstacles.splice(i, 1);
      }
    }
  }

  private ensureEarlyRampGuide(): void {
    if (this.playerSim.state.gameTime < this.opts.game.ramp.startDelaySeconds) return;
    if (this.completedRampGuides >= 3) return;
    if (this.rampGuideTargetId !== null) {
      const target = this.ramps.find((ramp) => ramp.id === this.rampGuideTargetId);
      if (target && !target.used && target.z >= -2) return;
      this.removeRampGuideCoin(this.rampGuideTargetId);
      this.rampGuideTargetId = null;
      this.completedRampGuides += 1;
      if (this.completedRampGuides >= 3) return;
    }
    const target = this.ramps
      .filter((ramp) => !ramp.used && ramp.z > this.levelgen.minGapZ)
      .sort((a, b) => a.z - b.z)[0];
    if (!target) return;
    this.rampGuideTargetId = target.id;
    this.coins.push({
      id: this.nextAirCoinId--,
      lane: target.lane,
      z: target.z - this.levelgen.minGapZ,
      y: this.levelgen.coinHeight,
      collected: false,
      rampGuideId: target.id,
      rampOffsetZ: -this.levelgen.minGapZ,
    });
  }

  private completeRampGuide(rampId: number): void {
    if (this.rampGuideTargetId !== rampId) return;
    this.removeRampGuideCoin(rampId);
    this.rampGuideTargetId = null;
    this.completedRampGuides += 1;
  }

  private removeRampGuideCoin(rampId: number): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      if (this.coins[i].rampGuideId === rampId) this.coins.splice(i, 1);
    }
  }

  private rhythmPlacementContext(): MusicPlacementContext {
    const player = this.playerSim.state;
    return { time: this.opts.getTrackTime?.() ?? player.gameTime, speed: Math.max(player.speed, this.opts.game.speeds.base),
      minSpeed: this.opts.game.speeds.min,
      maxSpeed: Math.max(player.speed, this.levelgen.fairness.referenceSpeed, this.opts.game.speeds.max * (1 + this.opts.game.skillMomentum.maxBonus)),
      entryLane: player.lane,
      envelope: runEnvelope(this.opts.getTrackTime?.() ?? player.gameTime,
        this.opts.getTrackDuration?.() ?? 0, this.opts.game.musicPlanning) };
  }

  private scheduleRhythmPatterns(requests: MusicalPatternRequest[], forecast: MusicForecast): void {
    const player = this.playerSim.state;
    if (this.ghost || player.mode !== 'car' || player.airState !== 'grounded' || this.trains.some(train => train.z + train.length / 2 > 0)) return;
    const cfg = this.opts.game.musicPlanning;
    const rate = Math.max(0.25, forecast.rate);
    const earliest = Math.max(this.nextRhythmTime, forecast.now + cfg.minLeadSeconds * rate);
    const duration = this.opts.getTrackDuration?.() ?? 0;
    const candidates = requests.filter(request => request.cue.time >= earliest &&
      request.cue.time <= forecast.now + cfg.maxLeadSeconds * rate && request.cue.time <= forecast.availableUntil &&
      (duration <= 0 || request.cue.time < duration - this.levelgen.trackEndObstacleStopSeconds));
    if (!candidates.length) return;
    const context = this.rhythmPlacementContext();
    const actionAllowed = earliest >= 5 && (this.rhythmSequence % 2 === 1 || candidates[0].kind === 'dodge');
    for (let attempt = 0; attempt < Math.min(3, candidates.length); attempt++) {
      const request = candidates[attempt];
      const accents = request.accents.filter((cue, i, all) => cue.time <= forecast.availableUntil &&
        (duration <= 0 || cue.time < duration - this.levelgen.trackEndObstacleStopSeconds) &&
        (i === 0 || cue.time - all[i - 1].time >= 0.28 * rate)).slice(0, 4);
      if (accents.length < 2) continue;
      for (const useAction of actionAllowed ? [true, false] : [false]) {
        const lanes = [player.lane, ...Array.from({ length: this.levelgen.lanes }, (_, lane) => lane)
          .filter(lane => lane !== player.lane).sort((a, b) => Math.abs(a - player.lane) - Math.abs(b - player.lane))];
        for (const lane of lanes) {
          const direction = ((this.generator.seed ^ this.rhythmSequence) & 1) === 0 ? 1 : -1;
          const neighbor = lane + direction < 0 || lane + direction >= this.levelgen.lanes ? lane - direction : lane + direction;
          const targetLane = useAction ? neighbor : lane;
          const coins: CoinEntity[] = [];
          const obstacles: ObstacleEntity[] = [];
          const tracked: Array<{ entity: CoinEntity | ObstacleEntity; contact: number; previousZ: number }> = [];

          const times = accents.map(cue => (cue.time - forecast.now) / rate);
          const smashTimes = this.gameplayRules === 'destroy' ? [...[...this.rhythmTracked.values()]
            .filter(entry => 'kind' in entry.entity && entry.entity.kind === 'micro')
            .map(entry => (entry.entity.musicTarget!.time - forecast.now) / rate), ...times]
            .filter(time => time > 0).sort((a, b) => a - b) : [];
          const travel = Array.from({ length: this.levelgen.lanes }, (_, lane) =>
            this.playerSim.predictTravel(times, this.laneFlowFor(lane) * this.levelgen.multiLaneFlowFactor, seconds => {
              const time = forecast.now + seconds * rate;
              const desired = this.rhythmSpeedPlan.find(frame => frame.time >= time)?.value ?? this.lastSpeedMultiplier;
              return Math.min(desired, runEnvelope(time, duration, cfg).speedIntentCap);
            }, smashTimes));
          for (let i = 0; i < accents.length; i++) {
            const cue = accents[i];
            const pickupLane = useAction ? targetLane : lane;

            const micro = this.gameplayRules === 'destroy';
            const contact = micro
              ? (this.opts.game.obstacle.lowDepth * this.opts.game.obstacle.microDepthScale + this.opts.game.player.depth) / 2 - this.opts.game.hit.zGrace
              : this.opts.game.player.depth / 2 + this.opts.game.coin.collectGrace + this.opts.game.coin.radius;
            const z = travel[pickupLane][i] + contact;
            const musicTarget = { time: cue.time, cueId: cue.id, confidence: cue.confidence, role: 'collect' as const };
            const flowGroupId = this.nextMusicGateId;
            const entity: CoinEntity | ObstacleEntity = micro
              ? { id: this.nextMusicEntityId--, kind: 'micro', lane: pickupLane, z, flowGroupId, routeGuide: true, musicTarget }
              : { id: this.nextMusicEntityId--, lane: pickupLane, z, flowGroupId, y: this.levelgen.coinHeight, collected: false, routeKind: 'sceneGuide', musicTarget };
            if ('kind' in entity) obstacles.push(entity); else coins.push(entity);
            tracked.push({ entity, contact, previousZ: z });
          }
          if (useAction && accents.length >= 3) {
            const cue = accents[1];
            const z = travel[lane][1];
            const hazard: ObstacleEntity = { id: this.nextMusicEntityId--, kind: 'tall', lane, z, flowGroupId: this.nextMusicGateId,
              zExtent: this.opts.game.obstacle.tallDepth,
              musicTarget: { time: cue.time, cueId: cue.id, confidence: cue.confidence, role: 'dodge' } };
            obstacles.push(hazard);
            tracked.push({ entity: hazard, contact: 0, previousZ: z });
          }
          if (!this.generator.certifyMusicCandidate([...this.obstacles, ...obstacles], [...this.coins, ...coins], this.ramps, context)) continue;
          this.obstacles.push(...obstacles);
          this.coins.push(...coins);
          for (const entry of tracked) this.rhythmTracked.set(entry.entity.id, entry);
          this.timingMetrics.planned += tracked.length;
          if (attempt > 0) this.timingMetrics.shifted++;
          if (actionAllowed && !useAction) this.timingMetrics.simplified++;
          this.nextMusicGateId--;
          this.rhythmSequence++;
          this.nextRhythmTime = accents.at(-1)!.time + 1.0 * rate;
          return;
        }
      }
      this.timingMetrics.rejected++;
    }
    this.nextRhythmTime = candidates[0].cue.time + 0.3;
  }

  private measureRhythmEvents(): void {
    const now = this.rhythmForecast?.now ?? this.opts.getTrackTime?.() ?? 0;
    for (const [id, entry] of this.rhythmTracked) {
      const entity = entry.entity;
      const target = entity.musicTarget!;
      const collected = 'collected' in entity ? entity.collected : Boolean(entity.smashed && !entity.crushBroken);
      const passed = entity.z <= 0;
      const expired = now > target.time + 12;
      if (!collected && !passed && !expired) { entry.previousZ = entity.z; continue; }
      const performed = target.role === 'dodge'
        ? passed && this.playerSim.state.lane !== entity.lane && !('broken' in entity && entity.broken)
        : collected;
      const relativeSpeed = carTrafficScrollSpeed(this.playerSim.state.speed, entity.lane, this.levelgen, entity);
      const crossing = now + Math.min(0, (entity.z - entry.contact) / relativeSpeed) * (this.rhythmForecast?.rate ?? 1);
      this.timingMetrics.record(crossing, target.time, performed, target.confidence >= this.opts.game.musicPlanning.confidenceThreshold);
      this.rhythmTracked.delete(id);
    }
  }

  private spawnPendingMusicPattern(): void {
    const request = this.pendingMusicScene;
    if (request === null) return;
    this.pendingMusicScene = null;
    const { phase, reason } = request;

    const player = this.playerSim.state;
    const canScheduleRamp =
      player.gameTime >= this.opts.game.ramp.startDelaySeconds &&
      this.rampCooldownRemaining === 0;
    const plan = planMusicPattern(
      phase,
      canScheduleRamp,
      this.musicPatternSequence++,
    );
    if (plan === null) return;

    const sceneCfg = this.opts.game.musicScenes;
    const sceneSpeed = Math.max(player.speed, this.opts.game.speeds.base);
    const desiredArrival = clamp(
      plan.arrivalSeconds,
      sceneCfg.minArrivalSeconds,
      sceneCfg.maxArrivalSeconds,
    );
    const leadZ = musicalLeadDistance(
      sceneSpeed,
      desiredArrival,
      sceneSpeed * sceneCfg.minArrivalSeconds,
      sceneSpeed * sceneCfg.maxArrivalSeconds,
    );
    const arrivalSeconds = leadZ / sceneSpeed;
    this.musicSceneCooldown = sceneCfg.cooldownSeconds;
    if (this.maybeSpawnRoadHorseTransition(phase, leadZ)) {
      this.lastMusicPattern = 'horseRoadTransition';
      this.setMusicSceneTelemetry('horseRoadTransition', phase, reason, arrivalSeconds, leadZ);
      return;
    }
    this.lastMusicPattern = plan.kind;
    const sceneId = this.setMusicSceneTelemetry(
      plan.kind,
      phase,
      reason,
      arrivalSeconds,
      leadZ,
    );
    if (plan.kind === 'calmCoins') {
      this.spawnMusicCoinPath(leadZ, [0, 0, 0, 0, 0, 0, 0], sceneId);
    } else if (plan.kind === 'buildUpGuide') {
      const direction = player.lane < this.levelgen.lanes / 2 ? 1 : -1;
      this.spawnMusicCoinPath(
        leadZ,
        [0, 0, direction, direction, direction * 2, direction, 0, 0],
        sceneId,
      );
    } else if (plan.kind === 'peakCoins') {
      const direction = player.lane < this.levelgen.lanes / 2 ? 1 : -1;
      this.spawnMusicCoinPath(
        leadZ,
        [0, direction, 0, -direction, 0, direction, 0, -direction, 0],
        sceneId,
      );
    } else if (plan.kind === 'intenseSlalom') {
      this.spawnMusicSlalom(leadZ, sceneId);
    } else {
      this.spawnMusicPeakGate(leadZ, sceneId);
    }
  }

  private setMusicSceneTelemetry(
    kind: MusicPatternKind,
    phase: 'buildUp' | 'intense' | 'peak' | 'cooldown',
    reason: MusicSceneRequest['reason'],
    arrivalSeconds: number,
    leadDistance: number,
  ): number {
    const player = this.playerSim.state;
    const sceneId = this.nextMusicSceneId++;
    const guideLanes = musicSceneGuideLanes(
      kind,
      player.lane,
      this.levelgen.lanes,
    );
    this.musicScene = {
      kind,
      phase,
      reason: reason === 'phaseChange' ? `phase:${phase}` : 'cue:risingBeat',
      arrivalSeconds,
      remainingSeconds: arrivalSeconds,
      leadDistance,
      guideLanes,
      routeHint: musicSceneRouteHint(kind),
      echo: 'none',
    };
    this.musicSceneExpiresAt = player.gameTime + arrivalSeconds + 3;
    this.musicSceneScheduledAt = player.gameTime;
    this.activeMusicSceneId = sceneId;
    if (kind !== 'horseRoadTransition') {
      this.spawnMusicSceneSafetyCorridor(leadDistance, sceneId);
    }
    return sceneId;
  }

  private spawnMusicSceneSafetyCorridor(leadZ: number, musicSceneId: number): void {
    const lane = this.playerSim.state.lane;
    const gap = this.levelgen.minGapZ * 0.88;
    for (let i = 0; i < 6; i++) {
      const z = leadZ + i * gap;
      const duplicate = this.coins.some(
        (coin) => coin.lane === lane && Math.abs(coin.z - z) < gap * 0.42,
      );
      if (duplicate) continue;
      this.coins.push({
        id: this.nextMusicEntityId--,
        lane,
        z,
        y: this.levelgen.coinHeight,
        collected: false,
        musicSceneId,
        routeKind: 'safeGuide',
      });
    }
  }

  private requestMusicScene(
    phase: MusicSceneRequest['phase'],
    reason: MusicSceneRequest['reason'],
  ): void {
    if (this.rhythmEnabled || this.musicSceneCooldown > 0 || this.pendingMusicScene !== null) return;
    this.pendingMusicScene = { phase, reason };
  }

  private maybeSpawnMusicEcho(music: MusicState): void {
    const cfg = this.opts.game.musicScenes;
    if (
      !music.beat.value ||
      this.musicEnergy < cfg.echoEnergyThreshold ||
      this.musicEchoCooldown > 0
    ) {
      return;
    }

    const player = this.playerSim.state;
    const scene = this.musicScene;
    const sceneId = this.activeMusicSceneId;
    const sceneIsEligible =
      scene !== null &&
      sceneId !== null &&
      player.gameTime >= this.musicSceneScheduledAt + 0.35 &&
      scene.remainingSeconds >= cfg.echoMinRemainingSeconds &&
      scene.echo === 'none';
    const nearbyRamp = this.findNearbyEchoRamp();
    if (nearbyRamp === null || this.sceneRng() >= cfg.echoChance) return;

    if (nearbyRamp && this.spawnRampEcho(nearbyRamp, sceneId ?? undefined)) {
      if (sceneIsEligible && scene) scene.echo = 'ramp';
      this.musicEchoCooldown = cfg.echoCooldownSeconds;
    }
  }

  private findNearbyEchoRamp(): RampEntity | null {
    const cfg = this.opts.game.musicScenes;
    const player = this.playerSim.state;
    return this.ramps
      .filter((ramp) => {
        if (ramp.used || ramp.echoed || ramp.z <= 0) return false;
        const relative = ramp.gateId === undefined
          ? Math.max(player.speed + this.laneFlowFor(ramp.lane), MIN_RELATIVE_SPEED)
          : Math.max(player.speed, MIN_RELATIVE_SPEED);
        const arrival = ramp.z / relative;
        return arrival >= cfg.echoMinArrivalSeconds && arrival <= cfg.echoMaxArrivalSeconds;
      })
      .sort((a, b) => a.z - b.z)[0] ?? null;
  }

  private spawnRampEcho(source: RampEntity, musicSceneId?: number): boolean {
    const laneCandidates = source.lane < this.levelgen.lanes / 2
      ? [source.lane + 1, source.lane - 1]
      : [source.lane - 1, source.lane + 1];
    const obstacleClearance = (this.opts.game.obstacle.depth + this.opts.game.player.depth) / 2;
    const lane = laneCandidates.find((candidate) =>
      candidate >= 0 &&
      candidate < this.levelgen.lanes &&
      !this.ramps.some((ramp) => ramp.lane === candidate && Math.abs(ramp.z - source.z) < 0.5) &&
      !this.obstacles.some((obstacle) =>
        !obstacle.broken &&
        obstacle.lane === candidate &&
        Math.abs(obstacle.z - source.z) < obstacleClearance,
      ),
    );
    if (lane === undefined) return false;
    source.echoed = true;
    this.ramps.push({
      id: this.nextMusicEntityId--,
      lane,
      z: source.z,
      gateId: source.gateId,
      musicSceneId: source.musicSceneId ?? musicSceneId,
      echoSpawnTime: this.playerSim.state.gameTime,
      echoSourceLane: source.lane,
      echoed: true,
    });
    return true;
  }

  private updateMusicSceneTelemetry(): void {
    if (this.musicScene === null) return;
    const player = this.playerSim.state;
    if (player.gameTime >= this.musicSceneExpiresAt) {
      this.musicScene = null;
      this.activeMusicSceneId = null;
      return;
    }
    this.musicScene.remainingSeconds = Math.max(
      0,
      this.musicSceneExpiresAt - player.gameTime - 3,
    );
  }

  private currentMusicSceneTelemetry(): MusicSceneTelemetry | null {
    return this.musicScene === null
      ? null
      : { ...this.musicScene, guideLanes: [...this.musicScene.guideLanes] };
  }

  private spawnMusicCoinPath(
    leadZ: number,
    offsets: number[],
    musicSceneId: number,
  ): void {
    const effectiveOffsets = this.playerSim.state.isAbilityActive
      ? offsets.filter((_, index) => index % 3 === 0)
      : offsets;
    const playerLane = this.playerSim.state.lane;
    const endZ =
      leadZ + Math.max(0, effectiveOffsets.length - 1) * this.levelgen.minGapZ;
    this.clearMusicPatternArea(leadZ - 2, endZ + 2);
    for (let i = 0; i < effectiveOffsets.length; i++) {
      this.coins.push({
        id: this.nextMusicEntityId--,
        lane: clamp(playerLane + effectiveOffsets[i], 0, this.levelgen.lanes - 1),
        z: leadZ + i * this.levelgen.minGapZ,
        y: this.levelgen.coinHeight,
        collected: false,
        musicSceneId,
        routeKind: 'sceneGuide',
      });
    }
  }

  private spawnMusicSlalom(leadZ: number, musicSceneId: number): void {
    const gap = this.levelgen.minGapZ * 1.5;
    const rows = 5;
    const endZ = leadZ + (rows - 1) * gap;
    this.clearMusicPatternArea(leadZ - 2, endZ + 2);
    const center = this.playerSim.state.lane;
    const patternId = this.nextMusicGateId--;
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : row % 4 === 1 ? 1 : -1;
      this.obstacles.push({
        id: this.nextMusicEntityId--,
        kind: row % 2 === 0 ? 'tall' : 'low',
        lane: clamp(center + offset, 0, this.levelgen.lanes - 1),
        z: leadZ + row * gap,
        gateId: patternId,
      });
      if (row % 2 === 0) {
        const guideOffset = offset >= 0 ? -1 : 1;
        this.coins.push({
          id: this.nextMusicEntityId--,
          lane: clamp(center + guideOffset, 0, this.levelgen.lanes - 1),
          z: leadZ + row * gap,
          y: this.levelgen.coinHeight,
          collected: false,
          musicSceneId,
          routeKind: 'sceneGuide',
        });
      }
    }
  }

  private carToHorseOfferOverdue(
    player: PlayerState,
    cfg: GameConfig['horse'],
    timing: ModeBonusTiming,
  ): boolean {
    if (
      this.horsePickups === 0 &&
      player.gameTime >= cfg.firstHorseGuaranteedSeconds
    ) {
      return true;
    }
    return this.modeSwitchElapsed >= timing.carToHorseGuaranteedSeconds;
  }

  private maybeSpawnRoadHorseTransition(
    phase: 'buildUp' | 'intense' | 'peak' | 'cooldown',
    leadZ: number,
  ): boolean {
    const player = this.playerSim.state;
    const cfg = this.opts.game.horse;
    const timing = modeBonusTiming(cfg, this.songProgress);
    if (
      (phase !== 'peak' && phase !== 'cooldown') ||
      player.mode !== 'car' ||
      player.gameTime < cfg.firstHorseMinSeconds ||
      this.modeSwitchElapsed < timing.carToHorseMinSeconds ||
      this.hasPendingReciprocalModeBonus()
    ) {
      return false;
    }
    const overdue = this.carToHorseOfferOverdue(player, cfg, timing);
    if (!overdue && this.bonusRng() >= roadHorseTransitionChance(cfg, this.songProgress)) {
      return false;
    }

    const direction = player.lane < this.levelgen.lanes / 2 ? 1 : -1;
    const rows = cfg.roadHorsePickupRows;
    const gap = cfg.roadHorsePickupGapZ;
    const bonusZ = leadZ + rows * gap;
    const patternId = this.nextMusicGateId--;
    this.clearMusicPatternArea(leadZ - 2, bonusZ + gap);
    let targetLane = player.lane;
    for (let row = 0; row < rows; row++) {
      const laneStep = Math.min(2, Math.floor((row + 1) / 2));
      targetLane = clamp(
        player.lane + direction * laneStep,
        0,
        this.levelgen.lanes - 1,
      );
      const z = leadZ + row * gap;
      this.coins.push({
        id: this.nextMusicEntityId--,
        lane: targetLane,
        z,
        y: this.levelgen.coinHeight,
        collected: false,
      });
      for (let lane = 0; lane < this.levelgen.lanes; lane++) {
        if (lane === targetLane) continue;
        this.obstacles.push({
          id: this.nextMusicEntityId--,
          kind: 'low',
          lane,
          z,
          gateId: patternId,
          flowGroupId: patternId,
        });
      }
    }
    this.horseOffers += 1;
    this.bonuses.push({
      id: this.nextBonusId++,
      kind: 'horse',
      lane: targetLane,
      z: bonusZ,
      y: this.levelgen.coinHeight,
      collected: false,
    });
    return true;
  }

  private canOfferRocketBonus(): boolean {
    const player = this.playerSim.state;
    const cfg = this.opts.game.rocket;
    const horseUnlock = this.opts.game.horse.firstHorseMinSeconds;
    if (
      this.firstHorseTransformGameTime !== null &&
      player.gameTime - this.firstHorseTransformGameTime < cfg.postFirstHorseDelaySeconds
    ) {
      return false;
    }
    if (
      player.mode === 'rocket' ||
      player.gameTime < Math.max(cfg.firstRocketMinSeconds, horseUnlock) ||
      this.rocketSpawnCooldown > 0 ||
      this.hasPendingRocketBonus() ||
      this.rocketPickups >= cfg.maxPickupsPerSong
    ) {
      return false;
    }
    if (
      this.rocketPickups > 0 &&
      this.rocketLastPickupProgress >= 0 &&
      this.songProgress - this.rocketLastPickupProgress < cfg.minPickupSpacingProgress
    ) {
      return false;
    }
    return true;
  }

  private maybeSpawnRocketBonusInRampFlight(airPathId: number): boolean {
    const player = this.playerSim.state;
    const cfg = this.opts.game.rocket;
    const horseCfg = this.opts.game.horse;
    const timing = modeBonusTiming(horseCfg, this.songProgress);
    if (
      !this.canOfferRocketBonus() ||
      player.mode !== 'car' ||
      this.rocketOfferElapsed < cfg.minModeSwitchSeconds ||
      this.bonuses.some(
        (bonus) =>
          !bonus.collected &&
          bonus.airPathId === airPathId &&
          (bonus.kind === 'horse' || bonus.kind === 'car' || bonus.kind === 'rocket'),
      )
    ) {
      return false;
    }
    const overdue = this.rocketOfferElapsed >= cfg.guaranteedModeSwitchSeconds;
    const chance = lateSongChance(cfg.rampPickupChance, timing.lateProgress);
    if (!overdue && this.bonusRng() >= chance) return false;
    const desiredTime = this.opts.game.ramp.flightTimeSeconds * 0.72;
    let guideIndex = -1;
    let guideDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.coins.length; i++) {
      const coin = this.coins[i];
      if (coin.airPathId !== airPathId || coin.airTargetTime === undefined) continue;
      const distance = Math.abs(coin.airTargetTime - desiredTime);
      if (distance < guideDistance) {
        guideIndex = i;
        guideDistance = distance;
      }
    }
    const guideCoin = guideIndex >= 0 ? this.coins.splice(guideIndex, 1)[0] : null;
    const targetTime = guideCoin?.airTargetTime ?? desiredTime;
    this.spawnAirModeBonus(
      'rocket',
      guideCoin?.lane ?? player.lane,
      targetTime,
      guideCoin?.y ?? airHeight(this.opts.game.ramp, targetTime),
      airPathId,
    );
    this.rocketSpawnCooldown = cfg.spawnCooldownSeconds;
    this.rocketOfferElapsed = 0;
    return true;
  }

  private maybeSpawnRocketBonusInHorseJump(): boolean {
    const player = this.playerSim.state;
    const cfg = this.opts.game.rocket;
    const horseCfg = this.opts.game.horse;
    const timing = modeBonusTiming(horseCfg, this.songProgress);
    if (
      !this.canOfferRocketBonus() ||
      player.mode !== 'horse' ||
      this.rocketOfferElapsed < cfg.minModeSwitchSeconds
    ) {
      return false;
    }
    const largeGroup = this.obstacles
      .filter(
        (obstacle) =>
          !obstacle.broken &&
          obstacle.horseAction === 'jump' &&
          (obstacle.actionCount ?? 0) >= cfg.jumpPickupMinGroupSize &&
          obstacle.z > 0 &&
          obstacle.z <= player.speed * horseCfg.flightTimeSeconds,
      )
      .sort((a, b) => a.z - b.z)[0];
    if (!largeGroup) return false;
    const overdue = this.rocketOfferElapsed >= cfg.guaranteedModeSwitchSeconds;
    const chance = modeBonusChance(
      this.rocketOfferElapsed,
      cfg.minModeSwitchSeconds,
      cfg.guaranteedModeSwitchSeconds,
      lateSongChance(cfg.jumpPickupChance, timing.lateProgress),
    );
    if (!overdue && this.bonusRng() >= chance) return false;
    const targetTime = horseCfg.flightTimeSeconds * cfg.jumpPickupTargetProgress;
    this.spawnAirModeBonus(
      'rocket',
      player.lane,
      targetTime,
      airHeight(horseCfg, targetTime) + this.opts.game.player.height * 0.5,
    );
    this.rocketSpawnCooldown = cfg.spawnCooldownSeconds;
    this.rocketOfferElapsed = 0;
    return true;
  }

  private spawnRocketTrajectories(): void {
    const player = this.playerSim.state;
    const cfg = this.opts.game.rocket;
    const positions = this.opts.game.lane.positions;
    const coinStart = rocketCoinStartTime(cfg);
    const fallStart = rocketFallStartTime(cfg);
    const maxCoinTime = rocketCoinEndTime({
      launchSeconds: cfg.launchSeconds,
      plateauSeconds: cfg.plateauSeconds,
      fuelSeconds: cfg.fuelSeconds,
      speedBoost: cfg.speedBoost,
      coinEndBufferSeconds: cfg.coinEndBufferSeconds,
      anticipationSeconds: cfg.anticipationSeconds,
    });
    const maxZ = rocketDistanceAtTime(maxCoinTime, player.speed, cfg);
    const samples = buildRocketTrajectories({
      launchSeconds: cfg.launchSeconds,
      plateauSeconds: cfg.plateauSeconds,
      fuelSeconds: cfg.fuelSeconds,
      anticipationSeconds: cfg.anticipationSeconds,
      coinEndBufferSeconds: cfg.coinEndBufferSeconds,
      coinSpacingSeconds: cfg.coinSpacingSeconds,
      coinsPerLaneSegment: cfg.coinsPerLaneSegment,
      startLane: player.lane,
      laneCount: this.levelgen.lanes,
    });
    for (const sample of samples) {
      if (sample.time < coinStart || sample.time >= fallStart) continue;
      const z = rocketDistanceAtTime(sample.time, player.speed, cfg);
      if (z < 0.35 || z > maxZ) continue;
      this.coins.push({
        id: this.nextAirCoinId--,
        lane: sample.lane,
        x: rocketCoinX(sample.lane, positions),
        z,
        y: rocketCoinY(sample.time, cfg),
        collected: false,
        rocketPattern: sample.pattern,
      });
    }
  }

  /**
   * Безопасная посадка ракеты: заранее выбрать окно посадки, умеренно
   * скорректировать длительность полёта (в пределах конфига) и зарезервировать
   * посадочный коридор в генераторе. Видимые препятствия не трогаются,
   * управление у игрока остаётся.
   */
  private planRocketLandingWindow(): void {
    const player = this.playerSim.state;
    const cfg = this.opts.game.rocket;
    const speed = Math.max(player.speed, 1);
    const baseDistance = rocketDistanceAtTime(rocketFallStartTime(cfg), player.speed, cfg);
    const plan = planRocketLanding({
      baseDistance,
      returnSpeed: speed,
      cruiseBoost: cfg.speedBoost,
      lane: player.lane,
      obstacles: this.obstacles,
      ramps: this.ramps,
      config: this.levelgen,
      game: this.opts.game,
    });
    this.rocketLandingAdjustSeconds = this.playerSim.adjustRocketFlight(
      plan.adjustSeconds,
      cfg.landingAdjustMaxSeconds,
    );
    const landingDist =
      baseDistance +
      this.rocketLandingAdjustSeconds * speed * cfg.speedBoost;
    const margin = Math.max(this.opts.game.player.depth * 2, speed * 0.3);
    this.generator.reserveRocketLanding(
      plan.landingLane,
      player.distance + landingDist - margin,
      player.distance + landingDist + speed * cfg.corridorSeconds,
    );
  }

  private finishRocketFlight(): void {
    const returnMode = this.playerSim.rocketPreviousMode;
    this.switchPlayerMode(returnMode);
    this.sfxEvents.emit('land', this.getSfxState(), returnMode === 'horse' ? 0.4 : 0.65);
    // Видимые препятствия не удаляем: безопасность обеспечена заранее
    // выбранным окном посадки, резервом коридора и коротким grace.
    // Резерв коридора живёт до проезда (автоочистка по дистанции).
    this.carPortalSafeRemaining = Math.max(
      this.carPortalSafeRemaining,
      this.opts.game.rocket.landingSafeSeconds,
    );
    this.removeRocketCoins();
    this.rampCooldownRemaining = Math.max(
      this.rampCooldownRemaining,
      this.opts.game.rocket.postLandingRampCooldownSeconds,
    );
  }

  private removeRocketCoins(): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      if (this.coins[i].rocketPattern !== undefined && !this.coins[i].collected) {
        this.coins.splice(i, 1);
      }
    }
  }

  private spawnMusicPeakGate(leadZ: number, musicSceneId: number): void {
    const player = this.playerSim.state;
    const lane = player.lane;
    const gateId = this.nextMusicGateId--;
    const wallLead =
      this.levelgen.rampLeadRows * this.levelgen.minGapZ;
    const wallZ = leadZ + wallLead;
    this.clearMusicPatternArea(leadZ - this.levelgen.minGapZ * 2, wallZ + 2);
    for (let step = 3; step >= 1; step--) {
      this.coins.push({
        id: this.nextMusicEntityId--,
        lane,
        z: leadZ - step * this.levelgen.minGapZ,
        y: this.levelgen.coinHeight,
        collected: false,
        musicSceneId,
        routeKind: 'sceneGuide',
      });
    }
    this.ramps.push({
      id: this.nextMusicEntityId--,
      lane,
      z: leadZ,
      gateId,
      musicSceneId,
    });
    for (let obstacleLane = 0; obstacleLane < this.levelgen.lanes; obstacleLane++) {
      this.obstacles.push({
        id: this.nextMusicEntityId--,
        kind: 'tall',
        lane: obstacleLane,
        z: wallZ,
        redWall: true,
        gateId,
      });
    }
  }

  private clearMusicPatternArea(minZ: number, maxZ: number): void {
    if (this.rhythmEnabled) return;
    const removedGateIds = new Set<number>();
    for (let i = this.ramps.length - 1; i >= 0; i--) {
      const ramp = this.ramps[i];
      if (ramp.z < minZ || ramp.z > maxZ) continue;
      if (ramp.gateId !== undefined) removedGateIds.add(ramp.gateId);
      this.ramps.splice(i, 1);
    }
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      const inArea = obstacle.z >= minZ && obstacle.z <= maxZ;
      const linkedToRemovedRamp =
        obstacle.gateId !== undefined && removedGateIds.has(obstacle.gateId);
      if (inArea || linkedToRemovedRamp) this.obstacles.splice(i, 1);
    }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (
        coin.airPathId === undefined &&
        coin.z >= minZ &&
        coin.z <= maxZ
      ) {
        this.coins.splice(i, 1);
      }
    }
  }

  private thinGroundCoinsForNitro(): void {
    if (this.rhythmEnabled) return;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (coin.airPathId !== undefined || coin.trainId !== undefined || coin.z <= 25) continue;
      if (Math.abs(coin.id) % 3 !== 0) this.coins.splice(i, 1);
    }
  }

  private hasPendingRocketBonus(): boolean {
    return this.bonuses.some(
      (bonus) => !bonus.collected && bonus.z > -2 && bonus.kind === 'rocket',
    );
  }

  private hasPendingReciprocalModeBonus(): boolean {
    const staleZ = -2;
    return this.bonuses.some(
      (bonus) =>
        !bonus.collected &&
        bonus.z > staleZ &&
        (bonus.kind === 'horse' || bonus.kind === 'car'),
    ) || this.obstacles.some(
      (obstacle) =>
        !obstacle.broken &&
        obstacle.modePortal !== undefined &&
        obstacle.z > staleZ,
    );
  }

  private maybeSpawnCarPortal(phase: string): void {
    const player = this.playerSim.state;
    const cfg = this.opts.game.horse;
    const timing = modeBonusTiming(cfg, this.songProgress);
    if (
      player.mode !== 'horse' ||
      this.modeSwitchElapsed < timing.horseToCarMinSeconds ||
      this.hasCarUnsafeAhead() ||
      this.hasPendingReciprocalModeBonus() ||
      (phase !== 'buildUp' && phase !== 'intense' && phase !== 'peak')
    ) {
      return;
    }
    const candidate = this.obstacles
      .filter((obstacle) => {
        const groupId = obstacle.actionGroupId;
        if (
          obstacle.broken ||
          obstacle.kind !== 'overhead' ||
          obstacle.horseAction !== 'slide' ||
          groupId === undefined ||
          this.carPortalConsideredGroups.has(groupId)
        ) {
          return false;
        }
        const arrival = obstacle.z / Math.max(player.speed, 1);
        if (arrival < cfg.carPortalMinLeadSeconds || arrival > cfg.carPortalMaxLeadSeconds) {
          return false;
        }
        const lanes = new Set(
          this.obstacles
            .filter((candidateObstacle) => candidateObstacle.actionGroupId === groupId)
            .map((candidateObstacle) => candidateObstacle.lane),
        );
        return lanes.size < this.levelgen.lanes;
      })
      .sort((a, b) => a.z - b.z)[0];
    if (!candidate || candidate.actionGroupId === undefined) return;
    this.carPortalConsideredGroups.add(candidate.actionGroupId);
    const chance = modeBonusChance(
      this.modeSwitchElapsed,
      timing.horseToCarMinSeconds,
      timing.horseToCarGuaranteedSeconds,
      lateSongChance(cfg.carPortalChance, timing.lateProgress),
    );
    if (this.bonusRng() >= chance) return;
    const groupId = candidate.actionGroupId;
    for (const obstacle of this.obstacles) {
      if (obstacle.actionGroupId === groupId) {
        obstacle.modePortal = 'car';
      }
    }
  }

  private spawnAirModeBonus(
    kind: BonusKind,
    lane: number,
    targetTime: number,
    y: number,
    airPathId?: number,
  ): void {
    if (kind === 'horse') this.horseOffers += 1;
    if (kind === 'car') this.carOffers += 1;
    if (kind === 'rocket') this.rocketOffers += 1;
    this.bonuses.push({
      id: this.nextBonusId++,
      kind,
      lane,
      z: targetTime * Math.max(this.playerSim.state.speed, 1),
      y,
      airTargetTime: targetTime,
      airPathId,
      collected: false,
    });
  }

  private maybeSpawnHorseBonusInRampFlight(airPathId: number): boolean {
    const player = this.playerSim.state;
    const cfg = this.opts.game.horse;
    const timing = modeBonusTiming(cfg, this.songProgress);
    if (
      player.mode !== 'car' ||
      player.gameTime < cfg.firstHorseMinSeconds ||
      this.modeSwitchElapsed < timing.carToHorseMinSeconds ||
      this.hasPendingReciprocalModeBonus()
    ) {
      return false;
    }
    const overdue = this.carToHorseOfferOverdue(player, cfg, timing);
    const chance = lateSongChance(cfg.horseRampPickupChance, timing.lateProgress);
    if (!overdue && this.bonusRng() >= chance) return false;
    const desiredTime = this.opts.game.ramp.flightTimeSeconds * 0.62;
    let guideIndex = -1;
    let guideDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.coins.length; i++) {
      const coin = this.coins[i];
      if (coin.airPathId !== airPathId || coin.airTargetTime === undefined) continue;
      const distance = Math.abs(coin.airTargetTime - desiredTime);
      if (distance < guideDistance) {
        guideIndex = i;
        guideDistance = distance;
      }
    }
    const guideCoin = guideIndex >= 0 ? this.coins.splice(guideIndex, 1)[0] : null;
    const targetTime = guideCoin?.airTargetTime ?? desiredTime;
    this.spawnAirModeBonus(
      'horse',
      guideCoin?.lane ?? player.lane,
      targetTime,
      guideCoin?.y ?? airHeight(this.opts.game.ramp, targetTime),
      airPathId,
    );
    return true;
  }

  private lateHorseRampTrainMultiplier(): number {
    const player = this.playerSim.state;
    const cfg = this.opts.game.horse;
    const timing = modeBonusTiming(cfg, this.songProgress);
    if (
      player.mode !== 'car' ||
      player.gameTime < cfg.firstHorseMinSeconds ||
      this.modeSwitchElapsed < timing.carToHorseMinSeconds ||
      this.hasPendingReciprocalModeBonus()
    ) {
      return 1;
    }
    return lateHorseRampTrainChanceMultiplier(cfg, this.songProgress);
  }

  private maybeSpawnHorseBonusAtTrainEnd(train: TrainEntity): void {
    const player = this.playerSim.state;
    const cfg = this.opts.game.horse;
    const timing = modeBonusTiming(cfg, this.songProgress);
    if (this.modeBonusConsideredTrainIds.has(train.id)) return;
    if (
      player.mode !== 'car' ||
      player.gameTime < cfg.firstHorseMinSeconds ||
      this.modeSwitchElapsed < timing.carToHorseMinSeconds ||
      this.hasPendingReciprocalModeBonus()
    ) {
      return;
    }
    const encounterRemaining = Math.min(
      train.rideDuration,
      cfg.horseTrainPickupEncounterRemainingSeconds,
    );
    const encounterElapsed = train.rideDuration - encounterRemaining;
    const travel = train.length - train.landingInset;
    const targetOffset =
      -train.length / 2 +
      train.landingInset +
      travel * (encounterElapsed / train.rideDuration);
    this.modeBonusConsideredTrainIds.add(train.id);
    const playerOffset = playerTrainOffset(train.z);
    if (
      isTrainRoofBlockingHorsePath(
        this.obstacles,
        train.id,
        playerOffset,
        targetOffset,
      )
    ) {
      return;
    }
    const overdue = this.carToHorseOfferOverdue(player, cfg, timing);
    const chance = lateSongChance(cfg.horseTrainPickupChance, timing.lateProgress);
    if (!overdue && this.bonusRng() >= chance) return;
    const targetZ = train.z + targetOffset;
    this.horseOffers += 1;
    this.bonuses.push({
      id: this.nextBonusId++,
      kind: 'horse',
      lane: train.lane,
      z: targetZ,
      y: train.height + this.opts.game.player.height * 0.5,
      trainId: train.id,
      trainOffsetZ: targetOffset,
      collected: false,
    });
  }

  private maybeSpawnCarBonusInHorseJump(): boolean {
    const player = this.playerSim.state;
    const cfg = this.opts.game.horse;
    const timing = modeBonusTiming(cfg, this.songProgress);
    if (
      player.mode !== 'horse' ||
      this.modeSwitchElapsed < timing.horseToCarMinSeconds ||
      this.hasCarUnsafeAhead() ||
      this.hasPendingReciprocalModeBonus()
    ) {
      return false;
    }
    const largeGroup = this.obstacles
      .filter(
        (obstacle) =>
          !obstacle.broken &&
          obstacle.horseAction === 'jump' &&
          (obstacle.actionCount ?? 0) >= cfg.carJumpPickupMinGroupSize &&
          obstacle.z > 0 &&
          obstacle.z <= player.speed * cfg.flightTimeSeconds,
      )
      .sort((a, b) => a.z - b.z)[0];
    if (!largeGroup) return false;
    const chance = modeBonusChance(
      this.modeSwitchElapsed,
      timing.horseToCarMinSeconds,
      timing.horseToCarGuaranteedSeconds,
      lateSongChance(cfg.carJumpPickupChance, timing.lateProgress),
    );
    if (this.bonusRng() >= chance) return false;
    const targetTime = cfg.flightTimeSeconds * cfg.carJumpPickupTargetProgress;
    this.spawnAirModeBonus(
      'car',
      player.lane,
      targetTime,
      airHeight(cfg, targetTime) + this.opts.game.player.height * 0.5,
    );
    return true;
  }

  private syncHorseConvertible(): void {
    const player = this.playerSim.state;
    if (player.mode !== 'horse') {
      this.generator.setHorseConvertible(false);
      return;
    }
    const timing = modeBonusTiming(this.opts.game.horse, this.songProgress);
    const leadDistance =
      this.levelgen.segmentsAhead * this.levelgen.chunkLength;
    const leadSeconds = leadDistance / Math.max(player.speed, 1);
    this.generator.setHorseConvertible(
      this.modeSwitchElapsed >= Math.max(0, timing.horseToCarMinSeconds - leadSeconds),
    );
  }

  private hasCarUnsafeAhead(): boolean {
    const ahead = this.obstacles.filter(
      (obstacle) => !obstacle.broken && !obstacle.cleared && obstacle.z > 1,
    );
    return !isPassableAsCarTemporal(ahead, this.levelgen).passable;
  }

  private emitPlaytest(event: PlaytestEvent): void {
    this.opts.onPlaytestEvent?.(event);
  }

  private emitPlaytestHit(
    obstacle: ObstacleEntity | undefined,
    source: ObstacleRef['source'],
    damageBefore: DamageState,
  ): void {
    const player = this.playerSim.state;
    if (!(player.mode === 'rocket' && (player.rocketPhase === 'launch' || player.rocketPhase === 'anticipation'))) {
      const mass = source === 'train' || obstacle?.kind === 'tall' || obstacle?.unbreakable ? 0.72 : 0.38;
      this.sfxEvents.emit('hit', this.getSfxState(), Math.min(1, mass + player.speed / 140));
    }
    if (damageBefore !== 'normal') {
      this.hitsWhileDamaged += 1;
      this.emitPlaytest({
        e: 'hit_while_damaged',
        t: roundPlaytest(player.gameTime),
        p: roundPlaytestProgress(this.songProgress),
        mode: player.mode,
        lane: player.lane,
        from: damageBefore,
        to: player.damageState,
      });
    }
    this.emitPlaytest(
      buildHitEvent({
        t: player.gameTime,
        p: this.songProgress,
        mode: player.mode,
        lane: player.lane,
        dmg: player.damageState,
        obstacles: this.obstacles,
        ramps: this.ramps,
        levelgen: this.levelgen,
        obstacle,
        source,
      }),
    );
  }

  private trackPlaytestRecovery(damageAtFrameStart: DamageState): void {
    const player = this.playerSim.state;
    const after = player.damageState;
    if (damageRank(after) >= damageRank(damageAtFrameStart)) return;
    this.recoverySteps += 1;
    this.emitPlaytest({
      e: 'recovery_step',
      t: roundPlaytest(player.gameTime),
      p: roundPlaytestProgress(this.songProgress),
      from: damageAtFrameStart,
      to: after,
      mode: player.mode,
      combo: this.comboSystem.combo,
      cleanSeconds: roundPlaytest(player.timeSinceLastHit),
    });
  }

  private emitPlaytestBonus(kind: string): void {
    const player = this.playerSim.state;
    this.emitPlaytest({
      e: 'bonus',
      t: Math.round(player.gameTime * 100) / 100,
      p: Math.round(this.songProgress * 1000) / 1000,
      kind,
      mode: player.mode,
    });
  }

  private emitPlaytestGameOverIfNeeded(): void {
    const player = this.playerSim.state;
    if (!player.gameOver) return;
    this.emitPlaytest({
      e: 'game_over',
      t: Math.round(player.gameTime * 100) / 100,
      p: Math.round(this.songProgress * 1000) / 1000,
      mode: player.mode,
      hits: this.totalHits,
    });
  }

  private switchPlayerMode(mode: PlayerMode): void {
    const current = this.playerSim.state.mode;
    if (current === mode) return;
    this.modeController.switchMode(mode);
    this.playerSim.switchMode(mode);
    if (mode !== 'rocket') {
      this.generator.setMode(mode);
    }
    if (current === 'horse' && mode === 'car') {
      // Безопасный переход конь → машина: новые чанки идут разреженными,
      // уже видимые препятствия не трогаем, проезд через бывшие slide-группы
      // подсвечиваем presentation-only монетами, короткий grace — как у портала.
      this.generator.beginHorseToCarTransition();
      this.carPortalSafeRemaining = Math.max(
        this.carPortalSafeRemaining,
        this.opts.game.horse.carPortalSafeSeconds,
      );
      this.markHorseLeftoversForCar();
    }
    this.modeSwitchElapsed = 0;
    this.modeSwitches += 1;
    this.emitPlaytest(
      buildModeEvent({
        t: this.playerSim.state.gameTime,
        p: this.songProgress,
        from: current,
        to: mode,
      }),
    );
    this.horseClearedObstacleIds.clear();
    this.horseSlideRewardedGroups.clear();
    this.horseHitGroups.clear();
    this.carPortalConsideredGroups.clear();
    this.horseJumpFailed = false;
    this.pendingCarPortalGroupId = null;
    this.pendingMusicScene = null;
    const nitroActive = mode === 'car' && this.playerSim.state.isAbilityActive;
    if (nitroActive && !this.nitroActive) this.nitroActivations += 1;
    this.nitroActive = nitroActive;
    this.nitroReady = this.playerSim.nitroReady;
    this.generator.setNitroActive(this.nitroActive);
    this.generator.setNitroReady(this.nitroReady);
  }

  private trackHorseActionClears(player: PlayerState, dt: number): void {
    if (player.mode !== 'horse') return;
    const zTolerance =
      (this.opts.game.obstacle.depth + this.opts.game.player.depth) / 2 -
      this.opts.game.hit.zGrace;
    const crossedBehind = Math.max(zTolerance, player.speed * dt + zTolerance);
    for (const obstacle of this.obstacles) {
      if (obstacle.broken || obstacle.cleared) continue;
      if (obstacle.trainId !== undefined) continue;
      const laneCenter = this.opts.game.lane.positions[obstacle.lane];
      const laneSpan = Math.abs(
        this.opts.game.lane.positions[1] - this.opts.game.lane.positions[0],
      );
      if (
        obstacle.lane !== player.lane &&
        Math.abs(player.laneX - laneCenter) > laneSpan / 2
      ) {
        continue;
      }
      if (obstacle.modePortal === 'car') {
        if (this.playerOverlapsHorseSlideObstacle(player, obstacle)) {
          this.pendingCarPortalGroupId = obstacle.actionGroupId ?? obstacle.id;
        }
        continue;
      }
      if (
        obstacle.kind === 'low' &&
        player.airSource === 'horseJump' &&
        player.airState === 'airborne'
      ) {
        const requiredHeight =
          this.opts.game.obstacle.lowHeight - this.opts.game.hit.heightGrace;
        const jumpZTolerance = Math.max(zTolerance, player.speed * 0.14);
        if (
          player.y < requiredHeight ||
          obstacle.z > jumpZTolerance ||
          obstacle.z < -crossedBehind
        ) {
          continue;
        }
        this.horseClearedObstacleIds.add(obstacle.id);
        this.smashHorseActionObstacle(obstacle);
        continue;
      }
      if (
        obstacle.kind === 'overhead' &&
        player.isSliding &&
        obstacle.z <= 0 &&
        obstacle.z >= -crossedBehind
      ) {
        this.smashHorseActionObstacle(obstacle);
        const groupId = obstacle.actionGroupId ?? obstacle.id;
        if (!this.horseSlideRewardedGroups.has(groupId)) {
          this.horseSlideRewardedGroups.add(groupId);
          this.playerSim.registerHorseClear();
          this.horseSlideClears += 1;
          this.grantAdrenaline(this.opts.game.adrenaline.gainHorseSlideClear);
        }
      }
    }
  }

  private tryCompleteCarPortal(player: PlayerState): void {
    if (this.pendingCarPortalGroupId === null || player.mode !== 'horse') return;
    if (this.playerOverlapsPortalGroup(player, this.pendingCarPortalGroupId)) return;
    this.completeCarPortalTransition(this.pendingCarPortalGroupId);
  }

  private completeCarPortalTransition(groupId: number): void {
    for (const obstacle of this.obstacles) {
      if (obstacle.actionGroupId !== groupId) continue;
      obstacle.cleared = true;
      obstacle.collisionIgnored = true;
    }
    this.pendingCarPortalGroupId = null;
    this.carPortalSafeRemaining = this.opts.game.horse.carPortalSafeSeconds;
    this.carPickups += 1;
    this.switchPlayerMode('car');
  }

  /**
   * Presentation-only подсветка проездов через бывшие slide-комбинации:
   * добавляет safeGuide-монеты в свободной полосе каждой опубликованной
   * slide-группы в пределах горизонта реакции. Препятствия, хитбоксы и режим
   * окружения не меняются.
   */
  private markHorseLeftoversForCar(): void {
    const player = this.playerSim.state;
    const horizonZ = horseLeftoverGuideHorizonZ(player.speed, this.levelgen.fairness);
    const guides = planHorseToCarGuides(this.obstacles, this.levelgen.lanes, horizonZ);
    let added = 0;
    for (const guide of guides) {
      if (added >= 12) break;
      const duplicate = this.coins.some(
        (coin) =>
          coin.lane === guide.lane &&
          Math.abs(coin.z - guide.z) < this.levelgen.minGapZ * 0.45,
      );
      if (duplicate) continue;
      this.coins.push({
        id: this.nextAirCoinId--,
        lane: guide.lane,
        z: guide.z,
        y: this.levelgen.coinHeight,
        collected: false,
        routeKind: 'safeGuide',
      });
      added += 1;
    }
  }

  private playerOverlapsPortalGroup(player: PlayerState, groupId: number): boolean {
    for (const obstacle of this.obstacles) {
      if (obstacle.broken || obstacle.cleared) continue;
      if (obstacle.actionGroupId !== groupId || obstacle.kind !== 'overhead') continue;
      if (this.playerOverlapsHorseSlideObstacle(player, obstacle)) return true;
    }
    return false;
  }

  private playerOverlapsHorseSlideObstacle(
    player: PlayerState,
    obstacle: ObstacleEntity,
  ): boolean {
    const zTolerance =
      (this.opts.game.obstacle.depth + this.opts.game.player.depth) / 2 -
      this.opts.game.hit.zGrace;
    if (Math.abs(obstacle.z) > zTolerance) return false;
    const laneCenter = this.opts.game.lane.positions[obstacle.lane];
    const laneSpan = Math.abs(
      this.opts.game.lane.positions[1] - this.opts.game.lane.positions[0],
    );
    return Math.abs(player.laneX - laneCenter) <= laneSpan / 2;
  }

  private isHorseBlasterActive(): boolean {
    const player = this.playerSim.state;
    return (
      player.mode === 'horse' &&
      player.horseMomentum >= this.opts.game.horse.blasterMomentumThreshold
    );
  }

  private consumeHorseBlaster(): boolean {
    if (!this.isHorseBlasterActive()) return false;
    const cfg = this.opts.game.horse;
    if (!this.playerSim.consumeHorseShield()) return false;
    this.sfxEvents.emit('smash', this.getSfxState(), 0.8);
    const playerX = this.playerSim.state.laneX;
    for (const obstacle of this.obstacles) {
      if (obstacle.broken) continue;
      const obstacleX = this.opts.game.lane.positions[obstacle.lane];
      const distance = Math.hypot(obstacleX - playerX, obstacle.z);
      if (distance > cfg.blasterBlastRadius) continue;
      obstacle.cleared = true;
      obstacle.broken = true;
      obstacle.smashed = true;
      obstacle.smashStrength = cfg.blasterBlastStrength;
      this.totalSmashes += 1;
      this.grantAdrenaline(this.opts.game.adrenaline.gainSmash);
    }
    this.blasterSaves += 1;
    return true;
  }

  private activateReadyNitroCollisionBlast(hit: ObstacleEntity): boolean {
    const player = this.playerSim.state;
    const cfg = this.opts.game.nitro;
    if (
      player.mode !== 'car' ||
      player.isAbilityActive ||
      player.nitroCharge < cfg.maxFill ||
      hit.kind !== 'low' ||
      hit.unbreakable
    ) {
      return false;
    }

    this.playerSim.activateNitro();

    this.sfxEvents.observe(this.getSfxState());
    if (!player.isAbilityActive) return false;
    this.nitroActive = true;
    this.nitroActivations += 1;
    this.nitroReady = false;
    this.generator.setNitroActive(true);
    this.generator.setNitroReady(false);
    this.thinGroundCoinsForNitro();

    const playerX = player.laneX;
    for (const obstacle of this.obstacles) {
      if (
        this.gameplayRules === 'destroy' &&
        obstacle.id === hit.id
      ) {
        continue;
      }
      if (obstacle.broken || obstacle.kind !== 'low' || obstacle.unbreakable) continue;
      const obstacleX = this.opts.game.lane.positions[obstacle.lane];
      if (Math.hypot(obstacleX - playerX, obstacle.z) > cfg.readyCollisionBlastRadius) {
        continue;
      }
      obstacle.cleared = true;
      obstacle.broken = true;
      obstacle.smashed = true;
      obstacle.smashStrength = cfg.readyCollisionBlastStrength;
      this.totalSmashes += 1;
      this.grantAdrenaline(this.opts.game.adrenaline.gainSmash);
      this.registerSmashHit();
    }
    return true;
  }

  private breakMicroObstacle(id: number): void {
    const obstacle = this.obstacles.find((entry) => entry.id === id);
    if (!obstacle || obstacle.broken || obstacle.kind !== 'micro') return;
    obstacle.broken = true;
    obstacle.smashed = true;
    this.totalSmashes += 1;
    this.gainDestroyCharge(this.opts.game.destroy.gainPerMicroBreak);
    this.applyGreenSmashSpeedBoost(true);
    this.registerGreenSmashPulse();
    this.registerSmashHit(true);
  }

  private handleDestroyCarHit(
    obstacle: ObstacleEntity,
    absorbedByBlaster: boolean,
    absorbedByReadyNitro: boolean,
  ): void {
    const player = this.playerSim.state;
    if (absorbedByBlaster) return;
    if (absorbedByReadyNitro && obstacle.kind !== 'low') return;
    const destroyCfg = this.opts.game.destroy;

    if (obstacle.kind === 'low' && !obstacle.unbreakable) {
      const smashed = this.playerSim.canSmashWithNitro;
      if (smashed) {
        this.totalSmashes += 1;
        this.gainNitro(destroyCfg.gainPerMediumSmash, obstacle);
        this.applyGreenSmashSpeedBoost();
        this.registerGreenSmashPulse();
        this.registerSmashHit();
        this.startCarMediumKnockback(obstacle, 'green');
        return;
      }
      if (player.isHit) return;
      const damageBefore = player.damageState;
      this.playerSim.registerHit();
      this.noteDodgeHit(obstacle.id);
      this.playerSim.applySpeedPenalty(
        destroyCfg.mediumHitSpeedPenalty,
        destroyCfg.mediumHitPenaltySeconds,
      );
      this.totalHits += 1;
      this.emitPlaytestHit(obstacle, 'obstacle', damageBefore);
      this.emitPlaytestGameOverIfNeeded();
      this.comboSystem.onHit();
      this.lastComboWasSmash = false;
      this.startCarMediumKnockback(obstacle, 'yellow');
      return;
    }

    if (obstacle.kind !== 'tall' && obstacle.kind !== 'overhead') return;
    obstacle.broken = true;
    if (player.isHit) return;
    const damageBefore = player.damageState;
    if (this.playerSim.canSmashWithNitro) {
      this.playerSim.interruptNitro();
      this.sfxEvents.observe(this.getSfxState());
      this.nitroActive = false;
      this.nitroReady = false;
      this.generator.setNitroActive(false);
      this.generator.setNitroReady(false);
      this.downgradeMandatoryNitroChallenges(player.lane);
    }
    this.playerSim.registerHit();
    this.noteDodgeHit(obstacle.id);
    this.playerSim.applySpeedPenalty(destroyCfg.tallHitSpeedPenalty, 0.55);
    this.totalHits += 1;
    this.emitPlaytestHit(obstacle, 'obstacle', damageBefore);
    this.emitPlaytestGameOverIfNeeded();
    this.comboSystem.onHit();
    this.lastComboWasSmash = false;
  }

  private mediumKnockbackCfg(): MediumKnockbackConfig {
    const cfg = this.opts.game.destroy;
    return {
      lateralSpeed: cfg.mediumKnockbackLateralSpeed,
      arcUpSpeed: cfg.mediumKnockbackArcUpSpeed,
      gravity: cfg.mediumKnockbackGravity,
      backwardSpeed: cfg.mediumKnockbackBackwardSpeed,
      greenLateralSpeed: cfg.mediumKnockbackGreenLateralSpeed,
      greenArcUpSpeed: cfg.mediumKnockbackGreenArcUpSpeed,
      greenGravity: cfg.mediumKnockbackGreenGravity,
      greenForwardSpeed: cfg.mediumKnockbackGreenForwardSpeed,
      yellowSpin: cfg.mediumKnockbackYellowSpin,
      greenSpin: cfg.mediumKnockbackGreenSpin,
      greenExplodeStrength: cfg.mediumKnockbackGreenExplodeStrength,
      maxDurationSeconds: cfg.mediumKnockbackDurationSeconds,
      hitRadius: cfg.mediumKnockbackHitRadius,
    };
  }

  private startCarMediumKnockback(
    obstacle: ObstacleEntity,
    style: 'yellow' | 'green',
  ): void {
    if (this.playerSim.state.mode !== 'car') return;
    startMediumKnockback(
      obstacle,
      obstacle.lane,
      this.levelgen.lanes,
      this.mediumKnockbackCfg(),
      style,
    );
  }

  private registerSmashHit(canister = false): void {
    this.sfxEvents.emit(canister ? 'canister' : 'smash', this.getSfxState(), canister ? 0.5 : 0.75);
    this.comboSystem.onSmash();
    this.lastComboWasSmash = true;
  }

  private applyGreenSmashSpeedBoost(collectedMicro = false): void {
    const cfg = this.opts.game.destroy;
    const earlyBlend = collectedMicro ? 1 - clamp(
      (this.playerSim.state.gameTime - cfg.earlyGreenSmashFullSeconds) /
        cfg.earlyGreenSmashFadeSeconds,
      0,
      1,
    ) : 0;
    this.playerSim.applyGreenSmashSpeedBonus(
      cfg.greenSmashSpeedBonus * (1 + (cfg.earlyGreenSmashSpeedScale - 1) * earlyBlend),
    );
  }

  private registerGreenSmashPulse(intensity = 1): void {
    if (intensity >= 1) {
      if (this.greenSmashStackTimer > 0) {
        this.greenSmashStacks = Math.min(6, this.greenSmashStacks + 1);
      } else {
        this.greenSmashStacks = 1;
      }
      this.greenSmashStackTimer = 0.42;
    }
    const pulse = (0.32 + this.greenSmashStacks * 0.11) * intensity;
    this.greenSmashFx = Math.min(1, Math.max(this.greenSmashFx, pulse));
  }

  private findActiveHorseSlideGroupId(): number | null {
    const player = this.playerSim.state;
    if (player.mode !== 'horse' || !player.isSliding) return null;
    const ahead = Math.max(
      this.opts.game.obstacle.depth,
      player.speed * this.opts.game.horse.slideAutoLeadSeconds,
    );
    const nearest = this.obstacles
      .filter(
        (obstacle) =>
          !obstacle.broken &&
          obstacle.kind === 'overhead' &&
          obstacle.lane === player.lane &&
          obstacle.z >= -this.opts.game.obstacle.depth &&
          obstacle.z <= ahead,
      )
      .sort((a, b) => Math.abs(a.z) - Math.abs(b.z))[0];
    return nearest?.actionGroupId ?? null;
  }

  private smashHorseActionObstacle(obstacle: ObstacleEntity): void {
    const count = Math.max(1, obstacle.actionCount ?? 1);
    const progress = count <= 1
      ? 0
      : clamp((obstacle.actionIndex ?? 0) / (count - 1), 0, 1);
    obstacle.cleared = true;
    if (
      this.playerSim.state.horseMomentum <
      this.opts.game.horse.actionSmashMinMomentum
    ) {
      return;
    }
    obstacle.smashDelayRemaining = this.opts.game.horse.actionSmashDelaySeconds;
    const baseStrength =
      1 +
      (this.opts.game.horse.actionSmashMaxStrength - 1) *
        progress * progress;
    obstacle.smashStrength = baseStrength * (
      this.playerSim.state.horseOverdriveRemaining > 0 ? 1.5 : 1
    );
    this.totalSmashes += 1;
    this.grantAdrenaline(this.opts.game.adrenaline.gainSmash);
  }

  private updateHorseSmashDelays(dt: number): void {
    for (const obstacle of this.obstacles) {
      if (
        !obstacle.cleared ||
        obstacle.broken ||
        obstacle.smashDelayRemaining === undefined
      ) {
        continue;
      }
      obstacle.smashDelayRemaining = Math.max(0, obstacle.smashDelayRemaining - dt);
      if (obstacle.smashDelayRemaining > 0) continue;
      this.sfxEvents.emit('smash', this.getSfxState(), 0.45);
      obstacle.broken = true;
      obstacle.smashed = true;
    }
  }

  private hasHorseSlideHazard(player: PlayerState, laneDelta: number): boolean {
    if (player.mode !== 'horse') return false;
    const targetLane = clamp(
      player.lane + laneDelta,
      0,
      this.opts.game.lane.positions.length - 1,
    );
    const lanes = new Set([player.lane, targetLane]);
    const ahead = Math.max(
      this.opts.game.obstacle.depth,
      player.speed * this.opts.game.horse.slideAutoLeadSeconds,
    );
    return this.obstacles.some(
      (obstacle) =>
        !obstacle.broken &&
        obstacle.kind === 'overhead' &&
        lanes.has(obstacle.lane) &&
        obstacle.z >= -this.opts.game.obstacle.depth &&
        obstacle.z <= ahead,
    );
  }

  private isNitroChargeLane(lane: number): boolean {
    return this.levelgen.nitroChargeLanes.includes(lane);
  }

  private updateNearMiss(player: PlayerState): void {
    const destroyMode = this.gameplayRules === 'destroy';
    const adrenalineMode = this.gameplayRules === 'adrenaline';
    const adrenalineCfg = this.opts.game.adrenaline;
    if (!destroyMode) {
      if (adrenalineMode && adrenalineCfg.gainNearMiss <= 0) return;
      if (!adrenalineMode && !player.isAbilityActive) return;
    }
    const cfg = this.opts.game.nitro;
    for (const obstacle of this.obstacles) {
      if (obstacle.broken) continue;
      if (obstacle.kind === 'micro') continue;
      if (obstacle.trainId !== undefined) continue;
      if (Math.abs(obstacle.lane - player.lane) !== 1) continue;
      const nearMissZ = adrenalineMode ? adrenalineCfg.nearMissMaxZ : NEAR_MISS_Z;
      if (obstacle.z > nearMissZ) continue;
      if (this.nearMissTracked.has(obstacle.id)) continue;
      this.nearMissTracked.add(obstacle.id);
      this.sfxEvents.emit('nearMiss', this.getSfxState(), 0.35, 1, Math.sign(obstacle.lane - player.lane) * 0.45);
      this.nearMissFx.push({
        x: player.laneX,
        y: 0.75,
        z: obstacle.z,
      });
      if (destroyMode) {
        this.gainDestroyCharge(this.opts.game.destroy.gainPerDodge);
      } else if (adrenalineMode) {
        this.grantAdrenaline(adrenalineCfg.gainNearMiss);
      } else {
        this.gainNitro(cfg.gainPerNearMiss, obstacle);
      }
    }
  }

  private noteDodgeHit(obstacleId: number | undefined): void {
    if (obstacleId === undefined) return;
    this.dodgeHitIds.add(obstacleId);
  }

  private updateDodgeFx(player: PlayerState): void {
    if (player.mode === 'rocket') return;
    const adrenalineMode = this.gameplayRules === 'adrenaline';
    const nearMissZ = adrenalineMode
      ? this.opts.game.adrenaline.nearMissMaxZ
      : NEAR_MISS_Z;
    updateDodgeLaneEscape(player, this.obstacles, {
      sharedLaneIds: this.dodgeSharedLaneIds,
      escapedIds: this.dodgeEscapedIds,
      hitIds: this.dodgeHitIds,
      nearMissZ,
    });
    const events = collectDodgeEvents(player, this.obstacles, {
      tracked: this.dodgeTracked,
      hitIds: this.dodgeHitIds,
      escapedIds: this.dodgeEscapedIds,
      nearMissZ,
      minSpeed: this.opts.game.camera.dodgeMinSpeed,
    });
    this.dodgeFx.push(...events);
  }

  private grantAdrenaline(amount: number): void {
    if (this.gameplayRules !== 'adrenaline' || amount <= 0) return;
    this.playerSim.grantAdrenaline(amount);
  }

  private tryApplyBeatLaunchBoost(music: MusicState, player: PlayerState): void {
    const cfg = this.opts.game.beatLaunch;
    if (cfg.windowSeconds <= 0 || cfg.speedPerBeat <= 0) return;
    if (player.mode !== 'car') return;
    if (player.gameTime >= cfg.windowSeconds) return;
    if (Number(music.energy.value) < cfg.strongEnergyThreshold) return;
    this.playerSim.applyBeatLaunchBoost(cfg.speedPerBeat, cfg.maxBonus);
  }

  private gainNitro(amount: number, sourceObstacle?: ObstacleEntity): void {
    if (amount <= 0) return;
    const player = this.playerSim.state;
    let effective = amount;
    if (this.gameplayRules === 'adrenaline') {
      const adrenalineCfg = this.opts.game.adrenaline;
      const percent = (player.adrenaline / adrenalineCfg.max) * 100;
      if (percent < adrenalineCfg.criticalThresholdPercent) {
        effective *= adrenalineCfg.criticalNitroGainMultiplier;
      }
    }
    const maxFill = this.opts.game.nitro.maxFill;
    const afterGain = addNitroCharge(
      player.nitroCharge,
      effective,
      maxFill,
    );
    const salvationCfg = this.opts.game.nitro.salvation;
    const qualified = qualifiesForSalvation(
      {
        playerMode: player.mode,
        damageState: player.damageState,
        nitroCharge: player.nitroCharge,
        nitroMaxFill: maxFill,
        songProgress: this.songProgress,
        obstacles: this.obstacles,
        ramps: this.ramps,
        levelgen: this.levelgen,
      },
      salvationCfg,
    );
    const salvation = applySalvationTopUp(
      afterGain,
      maxFill,
      this.salvationRng(),
      this.songProgress,
      salvationCfg,
      qualified,
    );
    player.nitroCharge = salvation.charge;
    if (salvation.applied) {
      this.salvationFlashTimer = salvationCfg.flashSeconds;
      if (sourceObstacle) {
        this.applySalvationMegaSmash(sourceObstacle);
      }
    }
  }

  private applySalvationMegaSmash(obstacle: ObstacleEntity): void {
    if (obstacle.broken || obstacle.unbreakable) return;
    const mult = this.opts.game.nitro.salvation.smashStrengthMultiplier;
    if (obstacle.kind === 'low' && this.playerSim.state.mode === 'car') {
      this.startCarMediumKnockback(obstacle, 'green');
      const cfg = this.mediumKnockbackCfg();
      obstacle.smashStrength = cfg.greenExplodeStrength * mult;
      obstacle.knockbackVelY = (obstacle.knockbackVelY ?? cfg.greenArcUpSpeed) * 1.35;
      obstacle.knockbackVelZ = (obstacle.knockbackVelZ ?? cfg.greenForwardSpeed) * 1.45;
      obstacle.knockbackBurstFx = true;
      return;
    }
    obstacle.broken = true;
    obstacle.smashed = true;
    obstacle.smashStrength = mult * 3;
    obstacle.knockbackBurstFx = true;
  }

  private obstaclesOverlapZ(a: ObstacleEntity, b: ObstacleEntity): boolean {
    const obstacleCfg = this.opts.game.obstacle;
    const aDepth = obstacleFootprint(a, obstacleCfg).depth;
    const bDepth = obstacleFootprint(b, obstacleCfg).depth;
    const aHalf = ((a.zExtent ?? aDepth) / 2) - 0.05;
    const bHalf = ((b.zExtent ?? bDepth) / 2) - 0.05;
    return Math.abs(a.z - b.z) < aHalf + bHalf;
  }

  private updateShoulderPasserCrushes(): void {
    const passers = this.obstacles.filter(
      (obstacle) => obstacle.shoulderPasser && !obstacle.broken,
    );
    if (passers.length === 0) return;
    for (const passer of passers) {
      for (const target of this.obstacles) {
        if (target === passer || target.broken || target.shoulderPasser) continue;
        if (target.lane !== passer.lane) continue;
        if (target.trainId !== undefined || target.redWall || target.nitroChallenge) continue;
        if (!this.obstaclesOverlapZ(passer, target)) continue;
        target.broken = true;
        target.knockbackBurstFx = true;
        target.smashStrength = 3.8;
        const lateralSign = target.lane <= 1 ? -1 : 1;
        const cfg = this.mediumKnockbackCfg();
        target.knockbackActive = true;
        target.knockbackStyle = 'yellow';
        target.knockbackLateralSign = lateralSign;
        target.knockbackElapsed = 0;
        target.knockbackVelX = lateralSign * cfg.lateralSpeed * 1.35;
        target.knockbackVelY = cfg.arcUpSpeed * 1.2;
        target.knockbackVelZ = cfg.backwardSpeed * 0.85;
        target.knockbackSpin = lateralSign * cfg.yellowSpin * 1.4;
        target.xOffset = 0;
        target.yOffset = 0;
      }
    }
  }

  private gainDestroyCharge(amount: number): void {
    const player = this.playerSim.state;
    if (player.isAbilityActive) {
      this.gainNitro(amount);
      return;
    }
    const cfg = this.opts.game.destroy;
    const progress = lateRunProgress(
      this.songProgress,
      longRunDifficultyProgress(player.gameTime, this.levelgen.longRunDifficulty),
      cfg.nitroLateStartProgress,
    );
    this.gainNitro(
      amount * scaleTowardEnd(cfg.nitroLateChargeGainScale, progress),
    );
  }

  private downgradeMandatoryNitroChallenges(safeLane: number): void {
    const mandatoryChallenges = new Set(
      this.obstacles
        .filter((obstacle) => obstacle.nitroMandatory && obstacle.z > 0)
        .map((obstacle) => obstacle.challengeId),
    );
    for (const challengeId of mandatoryChallenges) {
      const index = this.obstacles.findIndex(
        (obstacle) =>
          obstacle.nitroMandatory &&
          obstacle.challengeId === challengeId &&
          obstacle.lane === safeLane,
      );
      if (index >= 0) {
        const obstacle = this.obstacles[index];
        if (!this.tryStartMandatoryNitroPanicFlee(obstacle)) {
          this.obstacles.splice(index, 1);
        }
      }
    }
  }

  private tryStartMandatoryNitroPanicFlee(obstacle: ObstacleEntity): boolean {
    if (!obstacle.nitroMandatory) return false;
    return startObstaclePanicFlee(
      obstacle,
      this.levelgen.laneFlow,
      this.opts.game.lane.positions,
      this.opts.game.obstaclePanicFlee,
      true,
    );
  }

  private purgePanicFleeRemovals(): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      if (this.obstacles[i].panicFleeRemove) this.obstacles.splice(i, 1);
    }
  }

  private updatePerception(player: PlayerState): void {
    let nearest = Infinity;
    let count = 0;
    for (const obstacle of this.obstacles) {
      if (obstacle.broken) continue;
      if (obstacle.trainId !== undefined) continue;
      if (obstacle.z < 0) continue;
      if (obstacle.z < 60) count++;
      if (obstacle.z < nearest) nearest = obstacle.z;
    }
    player.activeObstacleCount = count;
    player.nearestObstacleDistance = Number.isFinite(nearest) ? nearest : Infinity;
    const cfg = this.opts.game.speeds;
    const speedNorm = (player.speed - cfg.min) / Math.max(1e-6, cfg.max - cfg.min);
    player.stressEstimate = clamp(count * 0.15 + speedNorm * 0.5, 0, 1);
  }
}

function defaultSeed(): number {
  return 1;
}

const NEAR_MISS_Z = -0.5;

const MIN_RELATIVE_SPEED = 0.5;

function numberOr(value: number | boolean | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

export function modeBonusChance(
  elapsedSeconds: number,
  minSeconds: number,
  guaranteedSeconds: number,
  initialChance: number,
): number {
  if (elapsedSeconds < minSeconds) return 0;
  const progress = clamp(
    (elapsedSeconds - minSeconds) / Math.max(0.001, guaranteedSeconds - minSeconds),
    0,
    1,
  );
  return initialChance + (1 - initialChance) * progress;
}

export interface ModeBonusTiming {
  lateProgress: number;
  carToHorseMinSeconds: number;
  carToHorseGuaranteedSeconds: number;
  horseToCarMinSeconds: number;
  horseToCarGuaranteedSeconds: number;
}

export function modeBonusTiming(
  cfg: GameConfig['horse'],
  songProgress: number,
): ModeBonusTiming {
  const linearProgress = clamp(
    (songProgress - cfg.lateSongSwitchStartProgress) /
      Math.max(0.001, 1 - cfg.lateSongSwitchStartProgress),
    0,
    1,
  );
  const lateProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
  const carToHorseMinSeconds = lerp(
    cfg.modeBonusMinSeconds,
    cfg.lateSongSwitchMinSeconds,
    lateProgress,
  );
  const horseToCarMinSeconds = lerp(
    cfg.carBonusMinSeconds,
    cfg.lateSongSwitchMinSeconds,
    lateProgress,
  );
  return {
    lateProgress,
    carToHorseMinSeconds,
    carToHorseGuaranteedSeconds: Math.max(
      carToHorseMinSeconds,
      lerp(cfg.modeBonusMaxSeconds, cfg.lateSongSwitchMaxSeconds, lateProgress),
    ),
    horseToCarMinSeconds,
    horseToCarGuaranteedSeconds: Math.max(
      horseToCarMinSeconds,
      lerp(
        cfg.carBonusGuaranteedSeconds,
        cfg.lateSongSwitchMaxSeconds,
        lateProgress,
      ),
    ),
  };
}

export function lateHorseRampTrainChanceMultiplier(
  cfg: GameConfig['horse'],
  songProgress: number,
): number {
  const { lateProgress } = modeBonusTiming(cfg, songProgress);
  return lerp(1, cfg.lateSongHorseRampTrainChanceMultiplier, lateProgress);
}

export function roadHorseTransitionChance(
  cfg: GameConfig['horse'],
  songProgress: number,
): number {
  const { lateProgress } = modeBonusTiming(cfg, songProgress);
  return lerp(
    cfg.roadHorsePickupChance,
    cfg.lateSongRoadHorsePickupChance,
    lateProgress,
  );
}

function lateSongChance(baseChance: number, lateProgress: number): number {
  return baseChance + (1 - baseChance) * lateProgress;
}

function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)));
  return sorted[index];
}

function clampLane(lane: number, laneCount: number): number {
  return Math.min(laneCount - 1, Math.max(0, lane));
}

function turboEnvelope(
  elapsed: number,
  duration: number,
  entrySeconds: number,
  exitSeconds: number,
): number {
  if (entrySeconds > 0 && elapsed < entrySeconds) return elapsed / entrySeconds;
  const exitStart = duration - exitSeconds;
  if (exitSeconds > 0 && elapsed > exitStart) {
    return Math.max(0, (duration - elapsed) / exitSeconds);
  }
  return 1;
}

function isMusicScenePhase(
  phase: string,
): phase is MusicSceneRequest['phase'] {
  return phase === 'buildUp' || phase === 'intense' || phase === 'peak' || phase === 'cooldown';
}

function musicSceneGuideLanes(
  kind: MusicPatternKind,
  lane: number,
  laneCount: number,
): number[] {
  const clampSceneLane = (value: number) => clampLane(value, laneCount);
  if (kind === 'buildUpGuide') {
    return [lane, lane, lane + 1, lane + 1, lane + 2].map(clampSceneLane);
  }
  if (kind === 'peakCoins') {
    return [lane, lane + 1, lane, lane - 1, lane].map(clampSceneLane);
  }
  if (kind === 'intenseSlalom') {
    return [lane, lane + 1, lane - 1, lane + 1].map(clampSceneLane);
  }
  if (kind === 'horseRoadTransition') {
    const direction = lane < laneCount / 2 ? 1 : -1;
    return [lane, lane + direction, lane + direction, lane + direction * 2].map(
      clampSceneLane,
    );
  }
  return [clampSceneLane(lane)];
}

function trainDurationForPhase(
  phase: string,
  durations: GameConfig['train']['durations'],
): number {
  if (phase === 'buildUp') return durations.buildUp;
  if (phase === 'intense') return durations.intense;
  if (phase === 'peak') return durations.peak;
  if (phase === 'cooldown') return durations.cooldown;
  return durations.calm;
}

function damageRank(state: DamageState): number {
  if (state === 'normal') return 0;
  if (state === 'damaged') return 1;
  return 2;
}

function roundPlaytest(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPlaytestProgress(value: number): number {
  return Math.round(value * 1000) / 1000;
}
