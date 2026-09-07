import type { DirectorConfig } from '@core/config/schemas';
import type { DirectorPhase } from '@core/state/DirectorState';
import type { MusicState } from '@core/state/MusicState';

export interface ScorerContext {
  music: MusicState;
  stress: number;
  currentPhase: DirectorPhase;
  phaseElapsed: number;
}

export class TransitionScorer {
  constructor(private readonly config: DirectorConfig) {}

  score(phase: DirectorPhase, ctx: ScorerContext, inCooldown: boolean): number {
    const intensity = this.intensity(ctx);
    const center = this.config.phases[phase].center;
    let score = -Math.abs(intensity - center);
    if (inCooldown) score -= this.config.scoring.cooldownPenalty;
    if (phase === ctx.currentPhase) {
      const duration = this.config.phases[phase].minDurationSeconds;
      const linger = duration > 0 ? Math.min(1, ctx.phaseElapsed / duration) : 1;
      score -= this.config.scoring.wPhaseElapsed * linger;
    }
    return score;
  }

  intensity(ctx: ScorerContext): number {
    const s = this.config.scoring;
    const energy = num(ctx.music.energy.value);
    const brightness = num(ctx.music.brightness.value);
    const wSum = s.wEnergy + s.wStress + s.wBrightness;
    if (wSum <= 0) return 0;
    return (s.wEnergy * energy + s.wStress * ctx.stress + s.wBrightness * brightness) / wSum;
  }
}

function num(value: number | boolean): number {
  return typeof value === 'number' ? value : value ? 1 : 0;
}
