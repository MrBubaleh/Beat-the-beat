import type { BonusKind } from '@core/levelgen/types';

export type BonusStatus = 'none' | 'acquired' | 'active';

export interface BonusPipeline {
  readonly status: BonusStatus;
  readonly pending: BonusKind | null;
  acquire(kind: BonusKind): BonusKind | null;
  activate(): BonusKind | null;
  clear(): void;
}

export function createBonusPipeline(autoActivate = true): BonusPipeline {
  let status: BonusStatus = 'none';
  let pending: BonusKind | null = null;

  return {
    get status() {
      return status;
    },
    get pending() {
      return pending;
    },
    acquire(kind) {
      pending = kind;
      status = 'acquired';
      if (autoActivate) {
        const activated = pending;
        pending = null;
        status = 'active';
        return activated;
      }
      return null;
    },
    activate() {
      if (pending === null) return null;
      const activated = pending;
      pending = null;
      status = 'active';
      return activated;
    },
    clear() {
      status = 'none';
      pending = null;
    },
  };
}
