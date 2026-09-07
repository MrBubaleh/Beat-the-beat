import type { DirectorConfig } from '@core/config/schemas';
import type { IntentTarget } from '@core/state/DirectorIntent';
import type { MusicState } from '@core/state/MusicState';
import { DirectorMemory } from './DirectorMemory';
import { DirectorStateMachine } from './DirectorStateMachine';
import { isValidIntentTarget } from './intentTargets';
import type { Director, DirectorOutput } from './types';

export type { DirectorOutput } from './types';

export class PassthroughDirector implements Director {
  readonly memory = new DirectorMemory();
  private readonly fsm: DirectorStateMachine;
  private readonly config: DirectorConfig;

  constructor(config: DirectorConfig) {
    this.config = config;
    this.fsm = new DirectorStateMachine(config);
  }

  get phase(): string {
    return this.fsm.phase;
  }

  get phaseElapsed(): number {
    return this.fsm.phaseElapsed;
  }

  update(dt: number, now: number, _music?: MusicState, _stress?: number): DirectorOutput {
    this.fsm.tick(dt);
    const intents = this.config.defaultIntents
      .filter((entry) => isValidIntentTarget(entry.target))
      .map((entry) => ({
        target: entry.target as IntentTarget,
        value: entry.value,
        priority: entry.priority,
        tag: entry.tag,
        issuedAt: now,
      }));
    this.memory.record(intents);
    return { intents, phase: this.fsm.phase, phaseElapsed: this.fsm.phaseElapsed };
  }

  reset(): void {
    this.fsm.reset();
    this.memory.clear();
  }
}
