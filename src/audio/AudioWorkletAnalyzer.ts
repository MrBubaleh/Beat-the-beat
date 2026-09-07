import type { AudioConfig } from '@core/config/schemas';
import type { MusicState, RawFeatures } from '@core/state/MusicState';
import { MusicStateBuilder } from '@core/state/MusicStateBuilder';
import type { AudioClock } from './AudioClock';
import type { IAudioAnalyzer } from './types';
import processorUrl from './analyzer-processor.worklet.ts?url';

export class AudioWorkletAnalyzer implements IAudioAnalyzer {
  private node: AudioWorkletNode | null = null;
  private clock: AudioClock | null = null;
  private readonly builder: MusicStateBuilder;

  constructor(
    private readonly ctx: AudioContext,
    private readonly config: AudioConfig,
  ) {
    this.builder = new MusicStateBuilder(config);
  }

  async start(sourceNode: AudioNode, clock: AudioClock): Promise<void> {
    this.stop();
    this.clock = clock;
    await this.ctx.audioWorklet.addModule(processorUrl);
    this.node = new AudioWorkletNode(this.ctx, 'analyzer-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: {
        fftSize: this.config.fftSize,
        blockSamples: this.config.blockSamples,
      },
    });
    this.node.port.onmessage = (event: MessageEvent<RawFeatures>): void => {
      this.builder.push({ ...event.data, t: this.clock!.getTrackTime() });
    };
    sourceNode.connect(this.node);
  }

  getLatestState(): MusicState {
    return this.builder.state;
  }

  restart(): void {
    this.builder.reset();
  }

  stop(): void {
    if (this.node) {
      this.node.disconnect();
      this.node.port.onmessage = null;
      this.node = null;
    }
  }
}
