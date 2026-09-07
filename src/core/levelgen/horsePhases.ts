import type { LevelgenConfig } from '@core/config/schemas';

export type HorsePhase = 'corridor' | 'weave' | 'breather' | 'overdriveTease';

export interface HorsePhaseModifiers {
  actionChunkScale: number;
  restChunkScale: number;
  dodgeProbabilityScale: number;
  slideProbabilityBonus: number;
  mandatoryActionScale: number;
  followupScale: number;
  jumpCoinProbabilityBonus: number;
  groupSizeBonus: number;
  groundCoinScale: number;
  dodgeLaneStickiness: number;
  activePhase: HorsePhase | null;
}

const NEUTRAL_MODIFIERS: HorsePhaseModifiers = {
  actionChunkScale: 1,
  restChunkScale: 1,
  dodgeProbabilityScale: 1,
  slideProbabilityBonus: 0,
  mandatoryActionScale: 1,
  followupScale: 1,
  jumpCoinProbabilityBonus: 0,
  groupSizeBonus: 0,
  groundCoinScale: 1,
  dodgeLaneStickiness: 0,
  activePhase: null,
};

export class HorsePhasePlanner {
  private phase: HorsePhase = 'corridor';
  private phaseChunksLeft = 0;
  private waveChunksLeft = 0;
  private waveHighIntensity = false;
  private corridorLane: number | null = null;

  reset(): void {
    this.phase = 'corridor';
    this.phaseChunksLeft = 0;
    this.waveChunksLeft = 0;
    this.waveHighIntensity = false;
    this.corridorLane = null;
  }

  advanceChunk(
    rng: () => number,
    horse: LevelgenConfig['horse'],
    longRunProgress: number,
  ): HorsePhaseModifiers {
    if (!horse.phasesEnabled) return { ...NEUTRAL_MODIFIERS };

    this.advanceWave(rng, horse);
    if (this.phaseChunksLeft <= 0) {
      this.phase = this.pickPhase(rng, horse, longRunProgress);
      this.phaseChunksLeft =
        horse.phaseMinChunks +
        Math.floor(rng() * (horse.phaseMaxChunks - horse.phaseMinChunks + 1));
    }
    this.phaseChunksLeft -= 1;
    return this.modifiersForPhase(horse);
  }

  pickCorridorBlockedLanes(
    rng: () => number,
    freeLane: number,
    blocked: number[],
    stickiness: number,
    lanes: number,
  ): number[] {
    if (blocked.length === 0 || stickiness <= 0) return blocked;
    if (this.corridorLane === null || rng() >= stickiness) {
      this.corridorLane = blocked[0] ?? null;
      return blocked;
    }
    const corridorLane = clamp(this.corridorLane, 0, lanes - 1);
    if (corridorLane === freeLane) return blocked;
    return [corridorLane];
  }

  private advanceWave(rng: () => number, horse: LevelgenConfig['horse']): void {
    if (this.waveChunksLeft <= 0) {
      this.waveHighIntensity = !this.waveHighIntensity;
      this.waveChunksLeft =
        horse.waveMinChunks +
        Math.floor(rng() * (horse.waveMaxChunks - horse.waveMinChunks + 1));
    }
    this.waveChunksLeft -= 1;
  }

  private pickPhase(
    rng: () => number,
    horse: LevelgenConfig['horse'],
    longRunProgress: number,
  ): HorsePhase {
    const waveBoost = this.waveHighIntensity ? horse.waveIntensityPeak : 0;
    const weights: Record<HorsePhase, number> = {
      corridor: horse.phaseWeights.corridor,
      weave:
        horse.phaseWeights.weave +
        longRunProgress * horse.longRunWeaveWeightBonus +
        waveBoost * horse.phaseWeights.weave,
      breather: Math.max(
        0,
        horse.phaseWeights.breather -
          longRunProgress * horse.longRunBreatherWeightPenalty -
          waveBoost * horse.phaseWeights.breather * 0.65,
      ),
      overdriveTease:
        horse.phaseWeights.overdriveTease +
        longRunProgress * horse.longRunOverdriveTeaseWeightBonus +
        waveBoost * horse.phaseWeights.overdriveTease,
    };
    let roll = rng() * Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    for (const phase of ['corridor', 'weave', 'breather', 'overdriveTease'] as const) {
      roll -= weights[phase];
      if (roll < 0) return phase;
    }
    return 'weave';
  }

  private modifiersForPhase(horse: LevelgenConfig['horse']): HorsePhaseModifiers {
    switch (this.phase) {
      case 'corridor':
        return {
          actionChunkScale: horse.corridorActionScale,
          restChunkScale: 1,
          dodgeProbabilityScale: horse.corridorDodgeProbabilityScale,
          slideProbabilityBonus: 0,
          mandatoryActionScale: 1,
          followupScale: 1,
          jumpCoinProbabilityBonus: 0,
          groupSizeBonus: 0,
          groundCoinScale: 1,
          dodgeLaneStickiness: horse.corridorDodgeLaneStickiness,
          activePhase: this.phase,
        };
      case 'weave':
        return {
          actionChunkScale: horse.weaveActionScale,
          restChunkScale: 1,
          dodgeProbabilityScale: 1,
          slideProbabilityBonus: horse.weaveSlideProbabilityBonus,
          mandatoryActionScale: 1,
          followupScale: horse.weaveFollowupScale,
          jumpCoinProbabilityBonus: 0,
          groupSizeBonus: horse.weaveGroupSizeBonus,
          groundCoinScale: 1,
          dodgeLaneStickiness: 0,
          activePhase: this.phase,
        };
      case 'breather':
        return {
          actionChunkScale: horse.breatherActionScale,
          restChunkScale: horse.breatherRestChunkScale,
          dodgeProbabilityScale: 1,
          slideProbabilityBonus: 0,
          mandatoryActionScale: 1,
          followupScale: 1,
          jumpCoinProbabilityBonus: 0,
          groupSizeBonus: 0,
          groundCoinScale: horse.breatherGroundCoinScale,
          dodgeLaneStickiness: 0,
          activePhase: this.phase,
        };
      case 'overdriveTease':
        return {
          actionChunkScale: horse.overdriveTeaseActionScale,
          restChunkScale: 1,
          dodgeProbabilityScale: 1,
          slideProbabilityBonus: horse.weaveSlideProbabilityBonus * 0.35,
          mandatoryActionScale: horse.overdriveTeaseMandatoryScale,
          followupScale: horse.overdriveTeaseFollowupScale,
          jumpCoinProbabilityBonus: horse.overdriveTeaseJumpCoinBonus,
          groupSizeBonus: horse.overdriveTeaseGroupSizeBonus,
          groundCoinScale: 1.08,
          dodgeLaneStickiness: 0,
          activePhase: this.phase,
        };
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
