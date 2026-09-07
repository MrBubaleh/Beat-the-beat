import type { ObstacleEntity } from '@core/levelgen/types';
import type { PlayerState } from '@core/state/PlayerState';

export interface ComboConfig {
  threatDistance: number;
  multiplierStep: number;
  multiplierPerStep: number;
  chainWindowSeconds: number;
}

export function comboMultiplier(combo: number, cfg: ComboConfig): number {
  return 1 + Math.floor(combo / cfg.multiplierStep) * cfg.multiplierPerStep;
}

const PASSED_Z = -0.5;

export class ComboSystem {
  private readonly tracked = new Set<number>();
  private readonly lastPassedAtByLane = new Map<number, number>();
  private _combo = 0;

  get combo(): number {
    return this._combo;
  }

  update(
    player: PlayerState,
    obstacles: ObstacleEntity[],
    cfg: ComboConfig,
    countDodges = true,
  ): void {
    if (!countDodges) {
      this.tracked.clear();
      this.lastPassedAtByLane.clear();
      return;
    }
    for (const obstacle of obstacles) {
      if (obstacle.trainId !== undefined) continue;
      if (obstacle.kind === 'micro') continue;
      if (obstacle.broken) {
        this.tracked.delete(obstacle.id);
        continue;
      }
      if (this.tracked.has(obstacle.id)) {
        if (obstacle.z <= PASSED_Z) {
          const lastPassedAt = this.lastPassedAtByLane.get(obstacle.lane);
          if (
            lastPassedAt === undefined ||
            player.gameTime - lastPassedAt > cfg.chainWindowSeconds
          ) {
            this._combo += 1;
          }
          this.lastPassedAtByLane.set(obstacle.lane, player.gameTime);
          this.tracked.delete(obstacle.id);
        }
        continue;
      }
      if (
        obstacle.z >= 0 &&
        obstacle.z <= cfg.threatDistance &&
        obstacle.lane === player.lane
      ) {
        this.tracked.add(obstacle.id);
      }
    }
  }

  onSmash(): void {
    this._combo += 1;
  }

  onHit(): void {
    this._combo = 0;
    this.tracked.clear();
    this.lastPassedAtByLane.clear();
  }

  reset(): void {
    this._combo = 0;
    this.tracked.clear();
    this.lastPassedAtByLane.clear();
  }
}
