import type { DirectorConfig } from '@core/config/schemas';
import type { DirectorPhase } from '@core/state/DirectorState';

export const PHASE_ORDER: readonly DirectorPhase[] = [
  'calm',
  'buildUp',
  'intense',
  'peak',
  'cooldown',
];

export interface TransitionContext {
  now: number;
  phaseElapsed: number;
  cooldownDeadlines: Record<DirectorPhase, number>;
  lastMajorEventAt: number;
  scores: Record<DirectorPhase, number>;
}

export class ConstraintValidator {
  constructor(private readonly config: DirectorConfig) {}

  canTransit(current: DirectorPhase, target: DirectorPhase, ctx: TransitionContext): boolean {
    if (target === current) return false;
    if (target === 'cooldown' || current === 'cooldown') return false;
    if (ctx.cooldownDeadlines[target] > ctx.now) return false;

    const idxCur = PHASE_ORDER.indexOf(current);
    const idxTar = PHASE_ORDER.indexOf(target);
    const scoreCur = ctx.scores[current];
    const scoreTar = ctx.scores[target];
    const c = this.config.constraints;

    if (idxTar > idxCur) {
      if (idxTar !== idxCur + 1) return false;
      if (
        target === 'peak' &&
        ctx.now - ctx.lastMajorEventAt < c.minSecondsBetweenMajorEvents
      ) {
        return false;
      }
      return scoreTar >= scoreCur + c.hysteresisUp;
    }

    return scoreTar >= scoreCur + c.hysteresisDown;
  }
}
