import type { DirectorConfig } from '@core/config/schemas';
import type { DirectorPhase } from '@core/state/DirectorState';

export class DirectorStateMachine {
  private _phase: DirectorPhase = 'calm';
  private _phaseElapsed = 0;
  private readonly cooldownUntil: Record<DirectorPhase, number> = {
    calm: -Infinity,
    buildUp: -Infinity,
    intense: -Infinity,
    peak: -Infinity,
    cooldown: -Infinity,
  };
  lastMajorEventAt = -Infinity;

  constructor(private readonly config: DirectorConfig) {}

  get phase(): DirectorPhase {
    return this._phase;
  }

  get phaseElapsed(): number {
    return this._phaseElapsed;
  }

  get cooldownDeadlines(): Readonly<Record<DirectorPhase, number>> {
    return this.cooldownUntil;
  }

  isInCooldown(phase: DirectorPhase, now: number): boolean {
    return this.cooldownUntil[phase] > now;
  }

  tick(dt: number): void {
    this._phaseElapsed += dt;
  }

  transitionTo(phase: DirectorPhase, now: number): void {
    if (phase === this._phase) return;
    const exitCfg = this.config.phases[this._phase].cooldownAfterExitSeconds;
    this.cooldownUntil[this._phase] = now + exitCfg;
    if (phase === 'intense' || phase === 'peak') this.lastMajorEventAt = now;
    this._phase = phase;
    this._phaseElapsed = 0;
  }

  reset(): void {
    this._phase = 'calm';
    this._phaseElapsed = 0;
    this.lastMajorEventAt = -Infinity;
    for (const key of Object.keys(this.cooldownUntil) as DirectorPhase[]) {
      this.cooldownUntil[key] = -Infinity;
    }
  }
}
