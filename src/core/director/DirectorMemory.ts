import type { DirectorIntent } from '@core/state/DirectorIntent';

const INTENT_HISTORY_LIMIT = 64;

export class DirectorMemory {
  private _intents: DirectorIntent[] = [];
  lastMajorEventAt = -Infinity;
  lastSpeedChangeAt = -Infinity;
  lastCameraChangeAt = -Infinity;
  recentDifficultyDelta: number[] = [];

  get intents(): readonly DirectorIntent[] {
    return this._intents;
  }

  record(intents: readonly DirectorIntent[]): void {
    this._intents.push(...intents);
    if (this._intents.length > INTENT_HISTORY_LIMIT) {
      this._intents.splice(0, this._intents.length - INTENT_HISTORY_LIMIT);
    }
  }

  clear(): void {
    this._intents = [];
    this.lastMajorEventAt = -Infinity;
    this.lastSpeedChangeAt = -Infinity;
    this.lastCameraChangeAt = -Infinity;
    this.recentDifficultyDelta = [];
  }
}
