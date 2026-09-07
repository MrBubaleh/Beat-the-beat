import type { DirectorConfig } from '@core/config/schemas';
import type { DirectorIntent, IntentTarget } from '@core/state/DirectorIntent';
import type { DirectorPhase } from '@core/state/DirectorState';
import type { MusicState } from '@core/state/MusicState';
import { ConstraintValidator, PHASE_ORDER } from './ConstraintValidator';
import type { TransitionContext } from './ConstraintValidator';
import { DirectorMemory } from './DirectorMemory';
import { DirectorStateMachine } from './DirectorStateMachine';
import { isValidIntentTarget } from './intentTargets';
import { TransitionScorer } from './TransitionScorer';
import type { DirectorOutput } from './types';

export class ActiveDirector {
  readonly memory = new DirectorMemory();
  private readonly fsm: DirectorStateMachine;
  private readonly scorer: TransitionScorer;
  private readonly validator: ConstraintValidator;
  private readonly config: DirectorConfig;
  private sectionEnergy = 0.5;

  constructor(config: DirectorConfig) {
    this.config = config;
    this.fsm = new DirectorStateMachine(config);
    this.scorer = new TransitionScorer(config);
    this.validator = new ConstraintValidator(config);
  }

  get phase(): string {
    return this.fsm.phase;
  }

  get phaseElapsed(): number {
    return this.fsm.phaseElapsed;
  }

  update(dt: number, now: number, music: MusicState, stress: number): DirectorOutput {
    this.fsm.tick(dt);
    this.applyForcedTransitions(now);
    this.updateSectionEnergy(
      dt,
      Boolean(music.silence.value) ? 0 : num(music.energy.value),
    );

    const sectionMusic = { ...music, energy: { value: this.sectionEnergy, audioTime: music.audioTime } };
    const scores = this.computeScores(now, sectionMusic, stress);
    const ctx: TransitionContext = {
      now,
      phaseElapsed: this.fsm.phaseElapsed,
      cooldownDeadlines: { ...this.fsm.cooldownDeadlines },
      lastMajorEventAt: this.fsm.lastMajorEventAt,
      scores,
    };
    const candidates = PHASE_ORDER.filter((phase) =>
      this.validator.canTransit(this.fsm.phase, phase, ctx),
    );
    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
      this.fsm.transitionTo(best, now);
    }
    this.memory.lastMajorEventAt = this.fsm.lastMajorEventAt;

    const intents = this.emitIntents(now, music);
    this.memory.record(intents);
    return { intents, phase: this.fsm.phase, phaseElapsed: this.fsm.phaseElapsed };
  }

  reset(): void {
    this.fsm.reset();
    this.memory.clear();
    this.sectionEnergy = 0.5;
  }

  private applyForcedTransitions(now: number): void {
    const cfg = this.config.phases;
    if (this.fsm.phase === 'peak' && this.fsm.phaseElapsed >= cfg.peak.minDurationSeconds) {
      this.fsm.transitionTo('cooldown', now);
    } else if (
      this.fsm.phase === 'cooldown' &&
      this.fsm.phaseElapsed >= cfg.cooldown.minDurationSeconds
    ) {
      this.fsm.transitionTo('calm', now);
    }
  }

  private computeScores(now: number, music: MusicState, stress: number): Record<DirectorPhase, number> {
    const scores = {} as Record<DirectorPhase, number>;
    const ctx = {
      music,
      stress,
      currentPhase: this.fsm.phase,
      phaseElapsed: this.fsm.phaseElapsed,
    };
    for (const phase of PHASE_ORDER) {
      scores[phase] = this.scorer.score(phase, ctx, this.fsm.isInCooldown(phase, now));
    }
    return scores;
  }

  private emitIntents(now: number, music: MusicState): DirectorIntent[] {
    const sectionEnergy = this.sectionEnergy;
    const fastEnergy = Boolean(music.silence.value) ? 0 : num(music.energy.value);
    const m = this.config.music;
    const out: DirectorIntent[] = [];
    for (const entry of this.config.phases[this.fsm.phase].intents) {
      if (!isValidIntentTarget(entry.target)) continue;
      let value: number | boolean = entry.value;
      if (entry.target === 'vfxIntensity' && typeof value === 'number') {
        value = clamp(value * (1 + m.vfxEnergyInfluence * (fastEnergy - 0.5)), 0, 1);
      } else if (entry.target === 'speed' && typeof value === 'number') {
        value = clamp(
          value * (1 + m.speedEnergyInfluence * (sectionEnergy - 0.5)),
          m.speedFloor,
          1.8,
        );
      } else if (
        (entry.target === 'obstacleDensity' || entry.target === 'coinFrequency') &&
        typeof value === 'number'
      ) {
        value = clamp(value * (1 + m.speedEnergyInfluence * (sectionEnergy - 0.5)), 0, 1);
      }
      out.push({
        target: entry.target as IntentTarget,
        value,
        priority: entry.priority,
        tag: entry.tag,
        issuedAt: now,
      });
    }
    return out;
  }

  private updateSectionEnergy(dt: number, energy: number): void {
    const section = this.config.music.sectionEnergy;
    const isRising = energy >= this.sectionEnergy;
    const timeConstant = isRising ? section.attackSeconds : section.releaseSeconds;
    const k = timeConstant > 0 ? 1 - Math.exp(-dt / timeConstant) : 1;
    this.sectionEnergy += (energy - this.sectionEnergy) * k;
  }
}

function num(value: number | boolean): number {
  return typeof value === 'number' ? value : value ? 1 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
