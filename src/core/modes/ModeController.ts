import { MODE_PROFILES } from './types';
import type { ModeProfile, PlayerMode } from './types';

export interface ModeTransition {
  from: PlayerMode;
  to: PlayerMode;
}

export const PRESERVED_ACROSS_MODES = [
  'speedMultiplier',
  'nitro',
  'health',
  'distance',
  'coins',
  'combo',
] as const;

export const RESET_ON_MODE_CHANGE = ['air', 'jump', 'tricks'] as const;

export class ModeController {
  private current: PlayerMode = 'car';

  get mode(): PlayerMode {
    return this.current;
  }

  get profile(): ModeProfile {
    return MODE_PROFILES[this.current];
  }

  switchMode(next: PlayerMode): ModeTransition {
    const from = this.current;
    this.current = next;
    return { from, to: next };
  }

  reset(): void {
    this.current = 'car';
  }
}
