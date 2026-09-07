import type { TutorialStatus } from '@core/tutorial/TutorialController';

export class TutorialStorage {
  private cached: TutorialStatus = 'novice';

  load(): TutorialStatus {
    return this.cached;
  }

  save(status: TutorialStatus): void {
    this.cached = status;
  }
}
