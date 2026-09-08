import type { GameConfig } from '@core/config/schemas';
import type { PlayerState } from '@core/state/PlayerState';
import type { PlayerMode } from '@core/modes/types';
import { beginHit, registerHit, resetHealth, updateHealth } from './health';
import {
  applyAdrenalineCollision,
  gainAdrenaline,
  resetAdrenaline,
  updateAdrenaline,
} from './adrenalineHealth';
import type { GameplayRulesId } from './gameplayRules';
import { applyNitroBoost, drainNitroCharge } from './nitro';
import { rocketPlayerYAtTime } from './rocket';
import {
  addTrick,
  airHeight,
  landingHeight,
  startAir,
  updateAir,
} from './air';
import type { LandingResult } from './air';
import type { ConsumedInput } from './actions';
import { easeOutCubic } from './rocket';
import {
  createSkillMomentumState,
  onSkillMomentumHit,
  skillMomentumHardCap,
  updateSkillMomentum,
  type SkillMomentumState,
} from './skillMomentum';

export function createInitialPlayer(lanePositions: number[], startLane = Math.floor(lanePositions.length / 2)): PlayerState {
  return {
    gameTime: 0,
    speed: 0,
    mode: 'car',
    lane: startLane,
    laneX: lanePositions[startLane],
    y: 0,
    airState: 'grounded',
    airSource: 'none',
    airTime: 0,
    spinAngle: 0,
    trickCount: 0,
    isHit: false,
    damageState: 'normal',
    recoveryTimer: 0,
    gameOver: false,
    distance: 0,
    coins: 0,
    combo: 0,
    nearestObstacleDistance: Infinity,
    activeObstacleCount: 0,
    nitroCharge: 0,
    isAbilityActive: false,
    horseMomentum: 0,
    horseOverdriveRemaining: 0,
    isSliding: false,
    horseBoostPulse: 0,
    rocketH: 0,
    rocketV: 0,
    rocketFuel: 0,
    rocketPhase: 'none',
    rocketFx: 0,
    rocketBoostPulse: 0,
    timeSinceLastHit: 0,
    stressEstimate: 0,
    adrenaline: 100,
    laneIdleSeconds: 0,
    skillMomentum: 0,
  };
}

export class PlayerSim {
  readonly state: PlayerState;
  private readonly iframe = { timer: 0 };
  private multiplier = 1;
  private nitroGraceTimer = 0;
  private rampBoostTimer = 0;
  private trickCooldown = 0;
  private trainExitTimer = 0;
  private trainExitStartHeight = 0;
  private airLandingTargetHeight = 0;
  private trainLandingLane: number | null = null;
  private trainLandingEngage = 0;
  private retainedRampSpeedBonus = 0;
  private retainedTrainSpeedBonus = 0;
  private retainedSmashSpeedBonus = 0;
  private nitroSmashGraceTimer = 0;
  private horseFastFall = false;
  private horseJumpBuffered = false;
  private horseSlideBuffered = false;
  private horseLandingCompleted = false;
  private horseSlideElapsed = 0;
  private horseSlideExitTimer = 0;
  private horseSlideHazard = false;
  private transitionSpeedStart = 0;
  private transitionSpeedRemaining = 0;
  private rocketReturnMode: PlayerMode = 'car';
  private rocketResumeSpeed = 0;
  private rocketResumeMultiplier = 1;
  private rocketResumeRemaining = 0;
  private rocketExpired = false;
  private rocketLaunchElapsed = 0;
  private rocketAnticipationElapsed = 0;
  private rocketPlateauElapsed = 0;
  private rocketLaunchStartY = 0;
  private rocketFallVelocity = 0;
  private gameplayRules: GameplayRulesId = 'destroy';
  private prevLane = 0;
  private speedPenaltyRemaining = 0;
  private speedPenaltyAmount = 0;
  private readonly laneSpan: number;
  private readonly laneCount: number;
  private skillMomentumEligible = false;
  private readonly skillMomentumState: SkillMomentumState = createSkillMomentumState();

  constructor(
    private readonly cfg: GameConfig,
    private readonly startLane = Math.floor(cfg.lane.positions.length / 2),
  ) {
    this.state = createInitialPlayer(cfg.lane.positions, this.startLane);
    this.prevLane = this.startLane;
    this.state.adrenaline = cfg.adrenaline.start;
    this.laneSpan = Math.abs(cfg.lane.positions[1] - cfg.lane.positions[0]);
    this.laneCount = cfg.lane.positions.length;
  }

  setGameplayRules(rules: GameplayRulesId): void {
    this.gameplayRules = rules;
  }

  setSkillMomentumEligible(eligible: boolean): void {
    this.skillMomentumEligible = eligible;
  }

  getGameplayRules(): GameplayRulesId {
    return this.gameplayRules;
  }

  private beatLaunchBonus = 0;

  applyBeatLaunchBoost(amount: number, maxBonus: number): void {
    if (amount <= 0) return;
    this.beatLaunchBonus = Math.min(maxBonus, this.beatLaunchBonus + amount);
  }

  grantAdrenaline(amount: number): void {
    if (this.gameplayRules !== 'adrenaline') return;
    gainAdrenaline(this.state, amount, this.cfg.adrenaline);
  }

  predictTravel(times: readonly number[], flow: number, speedMultiplier: number | ((seconds: number) => number), smashTimes: readonly number[] = []): number[] {
    const clone = new PlayerSim(this.cfg, this.startLane);
    Object.assign(clone, this, { state: { ...this.state }, skillMomentumState: { ...this.skillMomentumState } });
    const distances: number[] = [];
    let elapsed = 0;
    let distance = 0;
    let smash = 0;
    for (const target of times) {
      while (elapsed < target - 1e-8) {
        const dt = Math.min(1 / 60, target - elapsed);
        clone.state.gameOver = false;
        clone.update(dt, { laneDelta: 0, jump: false, nitro: false }, typeof speedMultiplier === 'number' ? speedMultiplier : speedMultiplier(elapsed + dt));
        distance += Math.max(0.5, clone.state.speed + flow) * dt;
        elapsed += dt;
        while (smash < smashTimes.length && smashTimes[smash] <= elapsed) {
          const cfg = this.cfg.destroy;
          const early = 1 - clamp((clone.state.gameTime - cfg.earlyGreenSmashFullSeconds) / cfg.earlyGreenSmashFadeSeconds, 0, 1);
          clone.applyGreenSmashSpeedBonus(cfg.greenSmashSpeedBonus * (1 + (cfg.earlyGreenSmashSpeedScale - 1) * early));
          smash++;
        }
      }
      distances.push(distance);
    }
    return distances;
  }

  update(dt: number, input: ConsumedInput, speedMultiplier: number): LandingResult | null {
    const s = this.state;
    if (s.gameOver) return null;

    s.gameTime += dt;
    const rawSpeed =
      s.gameTime * this.cfg.speeds.rampPerSecond +
      this.cfg.speeds.base +
      this.beatLaunchBonus;
    const rate = speedMultiplier > this.multiplier
      ? this.cfg.speeds.accelPerSecond
      : this.cfg.speeds.decelPerSecond;
    this.multiplier = moveToward(
      this.multiplier,
      Math.max(speedMultiplier, this.cfg.speeds.speedFloor),
      rate * dt,
    );
    let effectiveMultiplier = this.multiplier;
    if (s.isAbilityActive) effectiveMultiplier *= this.nitroBoostFactor();
    if (s.mode === 'horse') {
      effectiveMultiplier *= 1 + s.horseMomentum * this.cfg.horse.maxSpeedBoost;
      if (s.horseOverdriveRemaining > 0) {
        effectiveMultiplier *= 1 + this.cfg.horse.overdriveSpeedBoost;
      }
    }
    if (s.mode === 'rocket') {
      effectiveMultiplier *= this.rocketSpeedBoost();
    }
    if (this.rampBoostTimer > 0) {
      effectiveMultiplier *= this.cfg.ramp.boostMultiplier;
    } else if (this.retainedRampSpeedBonus > 0) {
      effectiveMultiplier *= 1 + this.retainedRampSpeedBonus;
    }
    if (s.airState === 'trainRoof') {
      effectiveMultiplier *= this.cfg.train.speedBoostMultiplier;
    } else if (this.retainedTrainSpeedBonus > 0) {
      effectiveMultiplier *= 1 + this.retainedTrainSpeedBonus;
    } else if (this.retainedSmashSpeedBonus > 0) {
      effectiveMultiplier *= 1 + this.retainedSmashSpeedBonus;
    }
    s.skillMomentum = updateSkillMomentum(
      this.skillMomentumState,
      s,
      this.cfg,
      dt,
      {
        veteranUnlocked: this.skillMomentumEligible,
        rawSpeedBeforeCap: rawSpeed,
        speedMultiplier,
        nitroBoostActive: s.mode === 'car' && s.isAbilityActive,
      },
    );
    const speedCap = skillMomentumHardCap(s.mode, this.cfg, s.skillMomentum);
    const targetSpeed = clamp(
      rawSpeed * effectiveMultiplier * this.damageFactor(),
      this.cfg.speeds.min,
      speedCap,
    );
    if (this.rocketResumeRemaining > 0 && s.mode !== 'rocket') {
      const duration = this.cfg.rocket.returnCarrySeconds;
      const t = this.rocketResumeRemaining / duration;
      s.speed = this.rocketResumeSpeed + (this.transitionSpeedStart - this.rocketResumeSpeed) * t;
      this.multiplier = this.rocketResumeMultiplier;
      this.rocketResumeRemaining = Math.max(0, this.rocketResumeRemaining - dt);
    } else if (s.mode === 'rocket' && s.rocketPhase === 'anticipation') {
      const cfg = this.cfg.rocket;
      const t = clamp(
        (this.rocketAnticipationElapsed + dt) / Math.max(cfg.anticipationSeconds, 0.01),
        0,
        1,
      );
      s.speed =
        this.rocketResumeSpeed *
        (1 + (cfg.anticipationSpeedScale - 1) * smoothstep01(t));
    } else if (this.transitionSpeedRemaining > 0) {
      const t = this.transitionSpeedRemaining / this.cfg.horse.transitionSpeedCarrySeconds;
      s.speed = Math.max(targetSpeed, targetSpeed + (this.transitionSpeedStart - targetSpeed) * t);
      this.transitionSpeedRemaining = Math.max(0, this.transitionSpeedRemaining - dt);
    } else {
      s.speed = targetSpeed;
    }
    s.distance += s.speed * dt;

    if (this.rampBoostTimer > 0) this.rampBoostTimer -= dt;
    if (this.rampBoostTimer <= 0 && this.retainedRampSpeedBonus > 0) {
      const decayRate =
        (this.cfg.ramp.boostMultiplier - 1) /
        this.cfg.ramp.retainedSpeedDecaySeconds;
      this.retainedRampSpeedBonus = Math.max(
        0,
        this.retainedRampSpeedBonus - decayRate * dt,
      );
    }
    if (this.trickCooldown > 0) this.trickCooldown -= dt;
    if (s.airState !== 'trainRoof' && this.retainedTrainSpeedBonus > 0) {
      const decayRate =
        (this.cfg.train.retainedSpeedMultiplier - 1) /
        this.cfg.train.retainedSpeedDecaySeconds;
      this.retainedTrainSpeedBonus = Math.max(
        0,
        this.retainedTrainSpeedBonus - decayRate * dt,
      );
    }
    if (this.retainedSmashSpeedBonus > 0) {
      const decayRate =
        this.retainedSmashSpeedBonus /
        Math.max(this.cfg.destroy.greenSmashSpeedDecaySeconds, 0.01);
      this.retainedSmashSpeedBonus = Math.max(
        0,
        this.retainedSmashSpeedBonus - decayRate * dt,
      );
    }
    this.updateHorseMomentum(dt);
    s.horseBoostPulse = Math.max(
      0,
      s.horseBoostPulse - this.cfg.horse.boostPulseDecayPerSecond * dt,
    );

    if (s.mode === 'horse' && input.fastFall) {
      if (s.airState === 'grounded' || s.airState === 'trainRoof') {
        this.startHorseSlide();
      } else if (
        s.airSource === 'horseJump' &&
        (s.airState === 'airborne' || s.airState === 'landing')
      ) {
        this.horseFastFall = true;
        this.horseSlideBuffered = true;
        this.horseJumpBuffered = false;
      }
    }

    if (s.mode === 'horse' && input.jump) {
      if (s.airState === 'grounded' || s.airState === 'trainRoof') {
        this.stopHorseSlide();
        this.startHorseJump();
      } else if (this.isHorseAirJumpSource() && this.horseJumpCanRestartEarly()) {
        this.horseLandingCompleted = true;
        this.horseSlideBuffered = false;
        this.startHorseJump();
      } else if (this.isHorseAirJumpSource() && this.horseJumpCanBuffer()) {
        this.horseJumpBuffered = true;
        this.horseSlideBuffered = false;
      }
    }

    const wasAirborne = s.airState === 'airborne';
    if (s.mode === 'rocket') {
      this.updateRocket(dt, input);
    } else {
      const targetLane = clamp(s.lane + input.laneDelta, 0, this.laneCount - 1);
      if (
        wasAirborne &&
        s.airSource === 'ramp' &&
        input.laneDelta !== 0 &&
        this.trickCooldown <= 0
      ) {
        addTrick(s);
        this.trickCooldown = this.cfg.ramp.trickCooldownSeconds;
      }
      s.lane = targetLane;
      const targetX = this.cfg.lane.positions[targetLane];
      const maxStep = (this.laneSpan / this.cfg.lane.switchTimeSeconds) * dt;
      s.laneX = moveToward(s.laneX, targetX, maxStep);
    }

    const airCfg = s.airSource === 'horseJump' ? this.cfg.horse : this.cfg.ramp;
    const horseDescending =
      s.airSource === 'horseJump' &&
      s.airState === 'airborne' &&
      s.airTime >= this.cfg.horse.flightTimeSeconds / 2;
    const airDt = horseDescending && this.horseFastFall
      ? dt * this.cfg.horse.fastFallMultiplier
      : dt;
    const completesHorseLanding =
      s.airSource === 'horseJump' &&
      s.airState === 'landing' &&
      s.airTime + airDt >= this.cfg.horse.landingTimeSeconds;
    const wasRampAirborne = s.airState === 'airborne' && s.airSource === 'ramp';
    const landing = updateAir(s, airDt, airCfg);
    if (wasRampAirborne && landing) {
      this.retainedRampSpeedBonus = this.cfg.ramp.boostMultiplier - 1;
    }
    if (completesHorseLanding) this.horseLandingCompleted = true;
    if (s.airState === 'airborne') {
      const progress = Math.min(1, s.airTime / airCfg.flightTimeSeconds);
      const heightBlend = progress * progress * (3 - 2 * progress);
      s.y =
        airHeight(airCfg, s.airTime) +
        this.airLandingTargetHeight * heightBlend;
      this.applyTrainLandingLaneGuide(dt);
    } else if (s.airState === 'landing') {
      s.y = landingHeight(airCfg, s.airTime);
    } else if (s.airState === 'trainExit') {
      this.trainExitTimer += dt;
      s.airTime = this.trainExitTimer;
      const progress = Math.min(1, this.trainExitTimer / this.cfg.train.exitDurationSeconds);
      s.y =
        this.trainExitStartHeight * (1 - progress) +
        4 * this.cfg.train.exitArcHeight * progress * (1 - progress);
      if (progress >= 1) {
        s.airState = 'grounded';
        s.airSource = 'none';
        s.airTime = 0;
        s.y = 0;
      } else if (
        s.mode === 'horse' &&
        this.horseJumpBuffered &&
        this.horseJumpCanRestartEarly()
      ) {
        s.airState = 'grounded';
        s.airSource = 'none';
        s.airTime = 0;
        s.y = 0;
        this.horseJumpBuffered = false;
        this.startHorseJump();
      }
    } else if (s.airState === 'trainRoof') {
      s.y = this.cfg.train.height;
    } else if (s.mode !== 'rocket') {
      s.y = 0;
    }

    if (s.airState === 'grounded' && (s.airSource === 'horseJump' || (s.airSource === 'ramp' && s.mode === 'horse'))) {
      s.airSource = 'none';
      this.horseFastFall = false;
      if (this.horseJumpBuffered && s.mode === 'horse') {
        this.startHorseJump();
        s.y = airHeight(this.cfg.horse, 0);
      } else if (this.horseSlideBuffered && s.mode === 'horse') {
        this.horseSlideBuffered = false;
        this.startHorseSlide();
      }
    }

    this.updateHorseSlide(dt);

    this.updateNitro(dt);
    const laneChanged = s.lane !== this.prevLane;
    this.prevLane = s.lane;
    if (this.gameplayRules === 'adrenaline') {
      updateAdrenaline(s, dt, this.iframe, this.cfg.adrenaline, {
        rocketMode: s.mode === 'rocket',
        laneChanged,
        runSeconds: s.gameTime,
        nitroActive: s.mode === 'car' && s.isAbilityActive,
        nitroClearSeconds: this.cfg.nitro.audioClearSeconds,
        damagedStress: this.cfg.destroy.damageAudioDamagedStress,
      });
      if (s.adrenaline <= 0) s.gameOver = true;
    } else {
      if (this.speedPenaltyRemaining > 0) {
        this.speedPenaltyRemaining = Math.max(0, this.speedPenaltyRemaining - dt);
        if (this.speedPenaltyRemaining <= 0) this.speedPenaltyAmount = 0;
      }
      updateHealth(s, dt, this.iframe, this.cfg.hit, {
        nitroActive: s.mode === 'car' && s.isAbilityActive,
        nitroClearSeconds: this.cfg.nitro.audioClearSeconds,
        damagedStress: this.cfg.destroy.damageAudioDamagedStress,
      });
    }
    return landing;
  }

  launchFromRamp(): void {
    startAir(this.state);
    this.state.airSource = 'ramp';
    this.airLandingTargetHeight = 0;
    this.rampBoostTimer = this.cfg.ramp.flightTimeSeconds;
    this.retainedRampSpeedBonus = 0;
    this.trickCooldown = 0;
  }

  setAirLandingHeight(height: number): void {
    if (this.state.airState !== 'airborne') return;
    this.airLandingTargetHeight = Math.max(0, height);
  }

  guideTrainLandingLane(lane: number, engage: number): void {
    this.trainLandingLane = lane;
    this.trainLandingEngage = clamp(engage, 0, 1);
  }

  clearTrainLandingGuide(): void {
    this.trainLandingLane = null;
    this.trainLandingEngage = 0;
  }

  private applyTrainLandingLaneGuide(dt: number): void {
    const s = this.state;
    if (
      this.trainLandingLane === null ||
      this.trainLandingEngage <= 0 ||
      s.airSource !== 'ramp'
    ) {
      return;
    }
    const targetX = this.cfg.lane.positions[this.trainLandingLane];
    const maxStep =
      (this.laneSpan / this.cfg.ramp.trainLandingLaneSeconds) *
      dt *
      this.trainLandingEngage;
    s.laneX = moveToward(s.laneX, targetX, maxStep);
    if (Math.abs(s.laneX - targetX) <= maxStep * 1.25) {
      s.lane = this.trainLandingLane;
    }
  }

  landOnTrain(): void {
    const s = this.state;
    s.airState = 'trainRoof';
    s.airSource = 'trainRoof';
    s.airTime = 0;
    s.y = this.cfg.train.height;
    s.spinAngle = 0;
    s.trickCount = 0;
    this.airLandingTargetHeight = 0;
    this.retainedRampSpeedBonus = 0;
    this.horseJumpBuffered = false;
    this.horseSlideBuffered = false;
  }

  exitTrain(): void {
    const s = this.state;
    if (s.airState !== 'trainRoof') return;
    s.airState = 'trainExit';
    s.airSource = 'trainExit';
    s.airTime = 0;
    this.trainExitTimer = 0;
    this.trainExitStartHeight = this.cfg.train.height;
    this.retainedTrainSpeedBonus = this.cfg.train.retainedSpeedMultiplier - 1;
    s.spinAngle = 0;
    s.trickCount = 0;
  }

  get nitroReady(): boolean {
    const s = this.state;
    return s.mode === 'car' && !s.isAbilityActive && s.nitroCharge >= this.cfg.nitro.maxFill;
  }

  activateNitro(): void {
    const s = this.state;
    if (!this.nitroReady) return;
    s.isAbilityActive = true;
    this.nitroSmashGraceTimer = 0;
    this.nitroGraceTimer = this.cfg.nitro.graceSeconds;
  }

  interruptNitro(): void {
    if (this.state.nitroCharge >= this.cfg.nitro.maxFill) {
      this.state.nitroCharge = Math.max(
        0,
        this.cfg.nitro.maxFill - this.cfg.nitro.gainPerCoin,
      );
    }
    this.state.isAbilityActive = false;
    this.nitroGraceTimer = 0;
    this.nitroSmashGraceTimer = 0;
  }

  get canSmashWithNitro(): boolean {
    if (
      this.gameplayRules === 'destroy' &&
      this.state.mode === 'car' &&
      this.state.nitroCharge >= this.cfg.nitro.maxFill
    ) {
      return true;
    }
    return this.state.isAbilityActive || this.nitroSmashGraceTimer > 0;
  }

  get nitroSmashVisualStrength(): number {
    const cfg = this.cfg.nitro;
    if (this.state.isAbilityActive) {
      const remainingSeconds = this.state.nitroCharge / cfg.drainPerSecond;
      if (remainingSeconds >= cfg.warningSeconds) return 1;
      const progress = Math.max(0, remainingSeconds / cfg.warningSeconds);
      return 0.35 + progress * 0.65;
    }
    if (this.nitroSmashGraceTimer <= 0 || cfg.smashGraceSeconds <= 0) return 0;
    return 0.35 * (this.nitroSmashGraceTimer / cfg.smashGraceSeconds);
  }

  registerSoftHit(penalty: number, duration: number): void {
    beginHit(this.state, this.cfg.hit, this.iframe);
    this.applySpeedPenalty(penalty, duration);
  }

  applySpeedPenalty(penalty: number, duration: number): void {
    if (penalty <= 0 || duration <= 0) return;
    this.speedPenaltyAmount = Math.max(this.speedPenaltyAmount, penalty);
    this.speedPenaltyRemaining = Math.max(this.speedPenaltyRemaining, duration);
  }

  registerHit(): void {
    if (this.state.mode === 'rocket' &&
      (this.state.rocketPhase === 'launch' || this.state.rocketPhase === 'anticipation')) {
      return;
    }
    if (this.state.mode === 'horse') {
      this.beginTransitionSpeedCarry();
      this.state.horseMomentum = 0;
      this.state.horseOverdriveRemaining = 0;
      this.horseJumpBuffered = false;
      this.horseSlideBuffered = false;
      this.stopHorseSlide();
    }
    if (this.gameplayRules === 'adrenaline') {
      if (
        applyAdrenalineCollision(this.state, this.cfg.adrenaline, this.iframe, this.cfg.hit) ===
        'gameOver'
      ) {
        this.state.gameOver = true;
      }
      return;
    }
    if (registerHit(this.state, this.cfg.hit, this.iframe) === 'gameOver') {
      this.state.gameOver = true;
      return;
    }
    onSkillMomentumHit(this.skillMomentumState);
  }

  beginHit(): void {
    beginHit(this.state, this.cfg.hit, this.iframe);
  }

  reset(): void {
    this.state.gameTime = 0;
    this.state.speed = 0;
    this.state.mode = 'car';
    this.state.lane = this.startLane;
    this.state.laneX = this.cfg.lane.positions[this.startLane];
    this.state.y = 0;
    this.state.airState = 'grounded';
    this.state.airSource = 'none';
    this.state.airTime = 0;
    this.state.spinAngle = 0;
    this.state.trickCount = 0;
    this.state.gameOver = false;
    this.state.distance = 0;
    this.state.coins = 0;
    this.state.combo = 0;
    this.state.nitroCharge = 0;
    this.state.isAbilityActive = false;
    this.state.horseMomentum = 0;
    this.state.horseOverdriveRemaining = 0;
    this.state.isSliding = false;
    this.state.horseBoostPulse = 0;
    this.state.rocketH = 0;
    this.state.rocketV = 0;
    this.state.rocketFuel = 0;
    this.state.rocketPhase = 'none';
    this.state.rocketFx = 0;
    this.state.rocketBoostPulse = 0;
    this.state.nearestObstacleDistance = Infinity;
    this.state.activeObstacleCount = 0;
    this.state.stressEstimate = 0;
    Object.assign(this.skillMomentumState, createSkillMomentumState());
    this.state.skillMomentum = 0;
    this.multiplier = 1;
    this.beatLaunchBonus = 0;
    this.nitroGraceTimer = 0;
    this.rampBoostTimer = 0;
    this.trickCooldown = 0;
    this.trainExitTimer = 0;
    this.trainExitStartHeight = 0;
    this.airLandingTargetHeight = 0;
    this.retainedRampSpeedBonus = 0;
    this.retainedTrainSpeedBonus = 0;
    this.retainedSmashSpeedBonus = 0;
    this.nitroSmashGraceTimer = 0;
    this.horseFastFall = false;
    this.horseJumpBuffered = false;
    this.horseSlideBuffered = false;
    this.horseLandingCompleted = false;
    this.horseSlideElapsed = 0;
    this.horseSlideExitTimer = 0;
    this.horseSlideHazard = false;
    this.transitionSpeedStart = 0;
    this.transitionSpeedRemaining = 0;
    this.rocketReturnMode = 'car';
    this.rocketResumeSpeed = 0;
    this.rocketResumeMultiplier = 1;
    this.rocketResumeRemaining = 0;
    this.rocketExpired = false;
    this.rocketLaunchElapsed = 0;
    this.rocketAnticipationElapsed = 0;
    this.rocketPlateauElapsed = 0;
    this.rocketLaunchStartY = 0;
    this.rocketFallVelocity = 0;
    this.prevLane = this.startLane;
    this.speedPenaltyRemaining = 0;
    this.speedPenaltyAmount = 0;
    if (this.gameplayRules === 'adrenaline') {
      resetAdrenaline(this.state, this.iframe, this.cfg.adrenaline);
    } else {
      resetHealth(this.state, this.iframe);
    }
  }

  switchMode(mode: PlayerState['mode']): void {
    const s = this.state;
    if (s.mode === mode) return;
    if (mode === 'rocket') {
      this.enterRocket();
      return;
    }
    if (s.mode === 'rocket') {
      this.exitRocket(mode);
      return;
    }
    this.beginTransitionSpeedCarry();
    if (mode === 'horse' && s.mode === 'car') {
      const nitroMomentum = s.isAbilityActive
        ? clamp(s.nitroCharge / this.cfg.nitro.maxFill, 0, 1)
        : 0;
      s.horseMomentum = Math.max(s.horseMomentum, nitroMomentum);
      if (s.horseMomentum >= 1) {
        s.horseOverdriveRemaining = this.cfg.horse.overdriveDurationSeconds;
      }
      s.isAbilityActive = false;
      this.nitroGraceTimer = 0;
      this.nitroSmashGraceTimer = 0;
    } else if (s.mode === 'horse' && mode === 'car') {
      if (s.horseMomentum >= this.cfg.horse.maxMomentumNitroThreshold) {
        s.nitroCharge = this.cfg.nitro.maxFill;
        s.isAbilityActive = true;
        this.nitroGraceTimer = this.cfg.nitro.graceSeconds;
      } else {
        s.isAbilityActive = false;
      }
      s.horseOverdriveRemaining = 0;
    }
    s.mode = mode;
    this.horseFastFall = false;
    this.horseJumpBuffered = false;
    this.horseSlideBuffered = false;
    this.horseLandingCompleted = false;
    this.stopHorseSlide();
    if (s.airState === 'grounded') {
      s.airSource = 'none';
      s.airTime = 0;
      s.y = 0;
      s.spinAngle = 0;
      s.trickCount = 0;
      this.airLandingTargetHeight = 0;
    }
  }

  get rocketPreviousMode(): PlayerMode {
    return this.rocketReturnMode;
  }

  /**
   * Безопасная посадка ракеты: умеренно продлить/сократить круиз в пределах
   * ±maxAbsSeconds. Возвращает применённую поправку.
   */
  adjustRocketFlight(deltaSeconds: number, maxAbsSeconds: number): number {
    if (this.state.mode !== 'rocket') return 0;
    const limit = Math.max(0, maxAbsSeconds);
    const clamped = clamp(deltaSeconds, -limit, limit);
    this.state.rocketFuel = Math.max(0.5, this.state.rocketFuel + clamped);
    return clamped;
  }

  consumeRocketExpired(): boolean {
    const expired = this.rocketExpired;
    this.rocketExpired = false;
    return expired;
  }

  consumeHorseLandingCompleted(): boolean {
    const completed = this.horseLandingCompleted;
    this.horseLandingCompleted = false;
    return completed;
  }

  setHorseSlideHazard(active: boolean): void {
    this.horseSlideHazard = active;
  }

  applyGreenSmashSpeedBonus(bonus: number): void {
    if (bonus <= 0) return;
    const cap = skillMomentumHardCap(
      this.state.mode,
      this.cfg,
      this.state.skillMomentum,
    );
    if (this.state.speed >= cap * 0.985) return;
    this.retainedSmashSpeedBonus = Math.max(this.retainedSmashSpeedBonus, bonus);
  }

  registerHorseClear(): void {
    const s = this.state;
    if (s.mode !== 'horse') return;
    if (s.horseOverdriveRemaining > 0) {
      s.horseMomentum = clamp(
        s.horseMomentum + this.cfg.horse.momentumPerClear,
        this.cfg.horse.overdriveRecoveryMomentum,
        1,
      );
      s.horseOverdriveRemaining =
        ((s.horseMomentum - this.cfg.horse.overdriveRecoveryMomentum) /
          Math.max(1e-6, 1 - this.cfg.horse.overdriveRecoveryMomentum)) *
        this.cfg.horse.overdriveDurationSeconds;
    } else {
      s.horseMomentum = clamp(
        s.horseMomentum + this.cfg.horse.momentumPerClear,
        0,
        1,
      );
      if (s.horseMomentum >= 1) {
        s.horseOverdriveRemaining = this.cfg.horse.overdriveDurationSeconds;
      }
    }
    s.horseBoostPulse = 1;
  }

  consumeHorseShield(): boolean {
    const s = this.state;
    const cfg = this.cfg.horse;
    if (s.mode !== 'horse' || s.horseMomentum < cfg.blasterMomentumThreshold) return false;
    const segment = 1 / cfg.meterSegments;
    s.horseMomentum = Math.max(
      0,
      Math.min(s.horseMomentum - segment, cfg.blasterMomentumThreshold - segment),
    );
    s.horseOverdriveRemaining = 0;
    return true;
  }

  private nitroBoostFactor(): number {
    const cfg = this.cfg.nitro;
    return applyNitroBoost(this.state.nitroCharge, cfg.maxFill, cfg.boostMax);
  }

  private updateNitro(dt: number): void {
    const s = this.state;
    const cfg = this.cfg.nitro;
    if (s.mode !== 'car') return;
    if (!s.isAbilityActive) {
      this.nitroSmashGraceTimer = Math.max(0, this.nitroSmashGraceTimer - dt);
      return;
    }
    if (this.nitroGraceTimer > 0) {
      this.nitroGraceTimer -= dt;
      return;
    }
    s.nitroCharge = drainNitroCharge(s.nitroCharge, cfg.drainPerSecond, dt);
    if (s.nitroCharge <= 0) {
      s.nitroCharge = 0;
      s.isAbilityActive = false;
      this.nitroGraceTimer = 0;
      this.nitroSmashGraceTimer = cfg.smashGraceSeconds;
    }
  }

  private damageFactor(): number {
    let factor = this.state.damageState === 'normal' ? 1 : 1 - this.cfg.hit.speedPenalty;
    if (this.speedPenaltyRemaining > 0) {
      factor *= 1 - this.speedPenaltyAmount;
    }
    return factor;
  }

  private startHorseJump(): void {
    const s = this.state;
    this.stopHorseSlide();
    const launchY = s.airState === 'trainRoof' ? this.cfg.train.height : 0;
    startAir(s);
    s.airSource = 'horseJump';
    s.y = launchY;
    this.horseFastFall = false;
    this.horseJumpBuffered = false;
    this.horseSlideBuffered = false;
    this.airLandingTargetHeight = 0;
  }

  private isHorseAirJumpSource(): boolean {
    const s = this.state;
    return s.mode === 'horse' && (s.airSource === 'horseJump' || s.airSource === 'ramp');
  }

  private horseJumpCanBuffer(): boolean {
    const s = this.state;
    const bufferSeconds =
      s.airSource === 'ramp' ? 0.18 : this.cfg.horse.jumpBufferSeconds;
    const airCfg = s.airSource === 'ramp' ? this.cfg.ramp : this.cfg.horse;
    if (s.airState === 'landing') {
      return airCfg.landingTimeSeconds - s.airTime <= bufferSeconds;
    }
    if (s.airState !== 'airborne') return false;
    return airCfg.flightTimeSeconds - s.airTime <= bufferSeconds;
  }

  private horseJumpCanRestartEarly(): boolean {
    const s = this.state;
    if (s.airState === 'trainExit') {
      return s.y <= this.cfg.horse.jumpEarlyRestartHeight + this.cfg.train.height * 0.12;
    }
    if (s.airSource === 'ramp' && s.mode === 'horse') {
      if (s.airState === 'landing') {
        return true;
      }
      if (s.airState === 'airborne') {
        const remaining = this.cfg.ramp.flightTimeSeconds - s.airTime;
        return (
          remaining <= 0.1 ||
          (s.airTime >= this.cfg.ramp.flightTimeSeconds / 2 &&
            s.y <= this.cfg.horse.jumpEarlyRestartHeight)
        );
      }
      return false;
    }
    const descending =
      s.airState === 'landing' ||
      (s.airState === 'airborne' &&
        s.airTime >= this.cfg.horse.flightTimeSeconds / 2);
    return descending && s.y <= this.cfg.horse.jumpEarlyRestartHeight;
  }

  private updateHorseMomentum(dt: number): void {
    const s = this.state;
    if (s.mode !== 'horse') return;
    if (s.horseOverdriveRemaining > 0) {
      const drainPerSecond =
        (1 - this.cfg.horse.overdriveRecoveryMomentum) /
        this.cfg.horse.overdriveDurationSeconds;
      s.horseMomentum = Math.max(
        this.cfg.horse.overdriveRecoveryMomentum,
        s.horseMomentum - drainPerSecond * dt,
      );
      s.horseOverdriveRemaining = Math.max(0, s.horseOverdriveRemaining - dt);
      if (s.horseOverdriveRemaining === 0) {
        s.horseMomentum = this.cfg.horse.overdriveRecoveryMomentum;
      }
      return;
    }
  }

  private startHorseSlide(): void {
    const s = this.state;
    if (s.mode !== 'horse') return;
    if (s.airState !== 'grounded' && s.airState !== 'trainRoof') return;
    if (!s.isSliding) {
      s.isSliding = true;
      this.horseSlideElapsed = 0;
      this.horseSlideExitTimer = this.cfg.horse.slideExitBufferSeconds;
    }
  }

  private stopHorseSlide(): void {
    this.state.isSliding = false;
    this.horseSlideElapsed = 0;
    this.horseSlideExitTimer = 0;
    this.horseSlideHazard = false;
  }

  private updateHorseSlide(dt: number): void {
    const s = this.state;
    if (!s.isSliding) {
      this.horseSlideHazard = false;
      return;
    }
    if (s.mode !== 'horse' || s.airState !== 'grounded') {
      this.stopHorseSlide();
      return;
    }
    this.horseSlideElapsed += dt;
    if (this.horseSlideHazard) {
      this.horseSlideExitTimer = this.cfg.horse.slideExitBufferSeconds;
    } else {
      this.horseSlideExitTimer = Math.max(0, this.horseSlideExitTimer - dt);
    }
    if (
      this.horseSlideElapsed >= this.cfg.horse.slideMinSeconds &&
      !this.horseSlideHazard &&
      this.horseSlideExitTimer <= 0
    ) {
      this.stopHorseSlide();
      return;
    }
    this.horseSlideHazard = false;
  }

  private beginTransitionSpeedCarry(): void {
    this.transitionSpeedStart = this.state.speed;
    this.transitionSpeedRemaining = this.cfg.horse.transitionSpeedCarrySeconds;
  }

  private enterRocket(): void {
    const s = this.state;
    this.rocketReturnMode = s.mode === 'horse' ? 'horse' : 'car';
    this.rocketResumeSpeed = s.speed;
    this.rocketResumeMultiplier = this.multiplier;
    this.rocketResumeRemaining = 0;
    this.rocketExpired = false;
    this.rocketLaunchElapsed = 0;
    this.rocketAnticipationElapsed = 0;
    this.rocketPlateauElapsed = 0;
    this.rocketFallVelocity = 0;
    this.horseFastFall = false;
    this.horseJumpBuffered = false;
    this.horseSlideBuffered = false;
    this.horseLandingCompleted = false;
    this.stopHorseSlide();
    this.rocketLaunchStartY = s.y;
    s.mode = 'rocket';
    s.rocketH = 0;
    s.rocketV = 0;
    s.rocketFuel = this.cfg.rocket.fuelSeconds;
    s.rocketPhase = 'anticipation';
    s.rocketFx = 0;
    s.rocketBoostPulse = 0;
    s.airState = 'grounded';
    s.airSource = 'none';
    s.airTime = 0;
    s.spinAngle = 0;
    s.trickCount = 0;
    this.airLandingTargetHeight = 0;
  }

  private exitRocket(mode: PlayerMode): void {
    const s = this.state;
    this.transitionSpeedStart = s.speed;
    this.rocketResumeRemaining = this.cfg.rocket.returnCarrySeconds;
    this.transitionSpeedRemaining = 0;
    s.mode = mode;
    s.laneX = this.cfg.lane.positions[s.lane];
    s.rocketH = 0;
    s.rocketV = 0;
    s.rocketFuel = 0;
    s.rocketPhase = 'none';
    s.rocketFx = 0;
    s.rocketBoostPulse = 0;
    s.airState = 'grounded';
    s.airSource = 'none';
    s.airTime = 0;
    s.y = 0;
    s.spinAngle = 0;
    s.trickCount = 0;
    this.airLandingTargetHeight = 0;
    this.rocketExpired = false;
    this.rocketLaunchElapsed = 0;
    this.rocketAnticipationElapsed = 0;
    this.rocketPlateauElapsed = 0;
    this.rocketLaunchStartY = 0;
    this.rocketFallVelocity = 0;
    this.horseFastFall = false;
    this.horseJumpBuffered = false;
    this.horseSlideBuffered = false;
    this.horseLandingCompleted = false;
    this.stopHorseSlide();
  }

  private updateRocket(dt: number, input: ConsumedInput): void {
    const s = this.state;
    const cfg = this.cfg.rocket;
    const peak = cfg.peakHeight;
    s.rocketBoostPulse = Math.max(
      0,
      s.rocketBoostPulse - dt / Math.max(cfg.pickupPulseSeconds, 0.01),
    );
    if (s.rocketPhase === 'anticipation') {
      this.rocketAnticipationElapsed += dt;
      s.y = rocketPlayerYAtTime(
        this.rocketAnticipationElapsed,
        this.rocketLaunchStartY,
        cfg,
      );
      s.rocketFx = Math.min(1, this.rocketAnticipationElapsed / Math.max(cfg.anticipationSeconds, 0.01));
      s.rocketBoostPulse = 0;
      this.steerRocketLanes(dt, input);
      if (this.rocketAnticipationElapsed >= cfg.anticipationSeconds) {
        s.rocketPhase = 'launch';
        this.rocketLaunchElapsed = 0;
        s.rocketFx = 1;
        s.rocketBoostPulse = 1;
      }
      return;
    }
    if (s.rocketPhase === 'launch') {
      this.rocketLaunchElapsed += dt;
      s.y = peak;
      s.rocketFx = 1;
      this.steerRocketLanes(dt, input);
      if (this.rocketLaunchElapsed >= cfg.launchSeconds) {
        s.rocketPhase = 'plateau';
        s.y = peak;
        this.rocketPlateauElapsed = 0;
      }
      return;
    }
    if (s.rocketPhase === 'plateau') {
      s.y = peak;
      s.rocketFx = 1;
      this.rocketPlateauElapsed += dt;
      this.steerRocketLanes(dt, input);
      if (this.rocketPlateauElapsed >= cfg.plateauSeconds) {
        s.rocketPhase = 'cruise';
      }
      return;
    }
    if (s.rocketPhase === 'fall') {
      this.steerRocketLanes(dt, input);
      this.rocketFallVelocity -= cfg.fallGravity * dt;
      s.y = Math.max(0, s.y + this.rocketFallVelocity * dt);
      s.rocketFx = Math.max(0, s.rocketFx - dt / Math.max(cfg.fxFadeSeconds, 0.01));
      if (s.y <= 0) {
        s.y = 0;
        s.rocketFx = 0;
        this.rocketExpired = true;
      }
      return;
    }
    this.steerRocketLanes(dt, input);
    s.y = peak;
    s.rocketFx = 1;
    s.rocketFuel = Math.max(0, s.rocketFuel - dt);
    if (s.rocketFuel <= 0) {
      s.rocketPhase = 'fall';
      this.rocketFallVelocity = 0;
    }
  }

  private steerRocketLanes(dt: number, input: ConsumedInput): void {
    const s = this.state;
    const maxStep = (this.laneSpan / this.cfg.rocket.switchTimeSeconds) * dt;
    const currentTargetX = this.cfg.lane.positions[s.lane];
    if (input.laneDelta !== 0) {
      const desiredLane = clamp(s.lane + input.laneDelta, 0, this.laneCount - 1);
      if (
        desiredLane !== s.lane &&
        Math.abs(s.laneX - currentTargetX) <= maxStep * 1.5
      ) {
        s.lane = desiredLane;
      }
    }
    const targetX = this.cfg.lane.positions[s.lane];
    s.laneX = moveToward(s.laneX, targetX, maxStep);
  }

  private rocketSpeedBoost(): number {
    const s = this.state;
    const cfg = this.cfg.rocket;
    if (s.rocketPhase === 'none' || s.rocketPhase === 'anticipation') return 1;
    if (s.rocketPhase === 'fall') {
      return 1 + (cfg.speedBoost - 1) * s.rocketFx;
    }
    if (s.rocketPhase === 'launch' && this.rocketLaunchElapsed < cfg.turboSnapSeconds) {
      const t = easeOutCubic(
        this.rocketLaunchElapsed / Math.max(cfg.turboSnapSeconds, 0.01),
      );
      return cfg.anticipationSpeedScale + (cfg.speedBoost - cfg.anticipationSpeedScale) * t;
    }
    return cfg.speedBoost;
  }

  applyLevelIntroMotion(dt: number, speed: number): void {
    const s = this.state;
    s.speed = speed;
    if (speed <= 0) return;
    s.distance += speed * dt;
    s.gameTime += dt;
  }

  completeLevelIntro(targetSpeed: number, countdownSeconds: number): void {
    const s = this.state;
    s.gameTime = countdownSeconds;
    s.speed = targetSpeed;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function smoothstep01(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
