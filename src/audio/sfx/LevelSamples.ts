import { Mp3OneShot } from './Mp3OneShot';

const engineStartUrl = new URL('../../../sound/engine start.mp3', import.meta.url).href;
const fullRepairUrl = new URL('../../../sound/full repare.mp3', import.meta.url).href;

export interface LevelSampleConfig {
  engineStartGain: number;
  fullRepairGain: number;
}

export class LevelSamples {
  readonly ready: Promise<void>;
  private readonly engineStart: Mp3OneShot;
  private readonly fullRepair: Mp3OneShot;

  constructor(
    ctx: BaseAudioContext,
    destination: AudioNode,
    config: LevelSampleConfig,
  ) {
    this.engineStart = new Mp3OneShot(ctx, destination, engineStartUrl, config.engineStartGain);
    this.fullRepair = new Mp3OneShot(ctx, destination, fullRepairUrl, config.fullRepairGain);
    this.ready = Promise.all([this.engineStart.ready, this.fullRepair.ready]).then(() => undefined);
  }

  configure(config: LevelSampleConfig): void {
    this.engineStart.setGain(config.engineStartGain);
    this.fullRepair.setGain(config.fullRepairGain);
  }

  playEngineStart(at: number): void {
    this.engineStart.play(at);
  }

  playFullRepair(at: number): void {
    this.fullRepair.play(at);
  }

  dispose(): void {
    this.engineStart.dispose();
    this.fullRepair.dispose();
  }
}
