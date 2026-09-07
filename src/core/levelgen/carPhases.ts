import type { LevelgenConfig } from '@core/config/schemas';

export type CarPhase = 'stream' | 'weave' | 'breather' | 'nitroTease';

export interface CarPhaseModifiers {
  densityScale: number;
  multiObstacleBiasBonus: number;
  nitroReadyChallengeMultiplier: number;
  coinFrequencyMultiplier: number;
  streamLaneStickiness: number;
  obstacleWeightScale: number;
  activePhase: CarPhase | null;
}

const NEUTRAL_MODIFIERS: CarPhaseModifiers = {
  densityScale: 1,
  multiObstacleBiasBonus: 0,
  nitroReadyChallengeMultiplier: 1,
  coinFrequencyMultiplier: 1,
  streamLaneStickiness: 0,
  obstacleWeightScale: 1,
  activePhase: null,
};

export class CarPhasePlanner {
  private phase: CarPhase = 'stream';
  private phaseChunksLeft = 0;
  private waveChunksLeft = 0;
  private waveHighIntensity = false;
  private streamLane: number | null = null;

  reset(): void {
    this.phase = 'stream';
    this.phaseChunksLeft = 0;
    this.waveChunksLeft = 0;
    this.waveHighIntensity = false;
    this.streamLane = null;
  }

  advanceChunk(
    rng: () => number,
    car: LevelgenConfig['car'],
    longRunProgress: number,
  ): CarPhaseModifiers {
    if (!car.phasesEnabled) return { ...NEUTRAL_MODIFIERS };

    this.advanceWave(rng, car);
    if (this.phaseChunksLeft <= 0) {
      this.phase = this.pickPhase(rng, car, longRunProgress);
      this.phaseChunksLeft =
        car.phaseMinChunks +
        Math.floor(rng() * (car.phaseMaxChunks - car.phaseMinChunks + 1));
    }
    this.phaseChunksLeft -= 1;
    return this.modifiersForPhase(car);
  }

  pickStreamBlockedLane(
    rng: () => number,
    freeLane: number,
    blocked: number[],
    stickiness: number,
    lanes: number,
  ): number[] {
    if (blocked.length === 0) return blocked;
    if (this.streamLane === null || rng() >= stickiness) {
      this.streamLane = blocked[0];
      return blocked;
    }
    const streamLane = clamp(this.streamLane, 0, lanes - 1);
    if (streamLane === freeLane) return blocked;
    return [streamLane];
  }

  private advanceWave(rng: () => number, car: LevelgenConfig['car']): void {
    if (this.waveChunksLeft <= 0) {
      this.waveHighIntensity = !this.waveHighIntensity;
      this.waveChunksLeft =
        car.waveMinChunks +
        Math.floor(rng() * (car.waveMaxChunks - car.waveMinChunks + 1));
    }
    this.waveChunksLeft -= 1;
  }

  private pickPhase(
    rng: () => number,
    car: LevelgenConfig['car'],
    longRunProgress: number,
  ): CarPhase {
    const waveBoost = this.waveHighIntensity ? car.waveIntensityPeak : 0;
    const weights: Record<CarPhase, number> = {
      stream: car.phaseWeights.stream,
      weave:
        car.phaseWeights.weave +
        longRunProgress * car.longRunWeaveWeightBonus +
        waveBoost * car.phaseWeights.weave,
      breather: Math.max(
        0,
        car.phaseWeights.breather -
          longRunProgress * car.longRunBreatherWeightPenalty -
          waveBoost * car.phaseWeights.breather * 0.65,
      ),
      nitroTease:
        car.phaseWeights.nitroTease +
        longRunProgress * car.longRunNitroTeaseWeightBonus +
        waveBoost * car.phaseWeights.nitroTease,
    };
    let roll = rng() * Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    for (const phase of ['stream', 'weave', 'breather', 'nitroTease'] as const) {
      roll -= weights[phase];
      if (roll < 0) return phase;
    }
    return 'weave';
  }

  private modifiersForPhase(car: LevelgenConfig['car']): CarPhaseModifiers {
    switch (this.phase) {
      case 'stream':
        return {
          densityScale: car.streamDensityScale,
          multiObstacleBiasBonus: 0,
          nitroReadyChallengeMultiplier: 1,
          coinFrequencyMultiplier: 1,
          streamLaneStickiness: car.streamLaneStickiness,
          obstacleWeightScale: 1,
          activePhase: this.phase,
        };
      case 'weave':
        return {
          densityScale: car.weaveDensityScale,
          multiObstacleBiasBonus: car.weaveMultiObstacleBiasBonus,
          nitroReadyChallengeMultiplier: 1,
          coinFrequencyMultiplier: 1,
          streamLaneStickiness: 0,
          obstacleWeightScale: 1,
          activePhase: this.phase,
        };
      case 'breather':
        return {
          densityScale: car.breatherDensityScale,
          multiObstacleBiasBonus: 0,
          nitroReadyChallengeMultiplier: 1,
          coinFrequencyMultiplier: 1.08,
          streamLaneStickiness: 0,
          obstacleWeightScale: car.breatherObstacleWeightScale,
          activePhase: this.phase,
        };
      case 'nitroTease':
        return {
          densityScale: car.nitroTeaseDensityScale,
          multiObstacleBiasBonus: car.weaveMultiObstacleBiasBonus * 0.45,
          nitroReadyChallengeMultiplier: car.nitroTeaseReadyChallengeMultiplier,
          coinFrequencyMultiplier: car.nitroTeaseCoinFrequencyMultiplier,
          streamLaneStickiness: 0,
          obstacleWeightScale: 1,
          activePhase: this.phase,
        };
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
