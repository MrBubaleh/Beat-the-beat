import { computeAnalysis } from './analysis';

declare const sampleRate: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: { new (...args: never[]): AudioWorkletProcessor },
): void;

interface AnalyzerOptions {
  fftSize?: number;
  blockSamples?: number;
}

class AnalyzerProcessor extends AudioWorkletProcessor {
  private readonly fftSize: number;
  private readonly buffer: Float32Array;
  private filled = 0;
  private prevMagnitudes: Float32Array | null = null;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const opts = (options.processorOptions ?? {}) as AnalyzerOptions;
    this.fftSize = opts.fftSize ?? 512;
    this.buffer = new Float32Array(this.fftSize);
  }

  process(inputs: Float32Array[][], _outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.buffer[this.filled++] = sample;
      if (this.filled >= this.fftSize) {
        const result = computeAnalysis(this.buffer, this.fftSize, sampleRate, this.prevMagnitudes);
        this.prevMagnitudes = result.magnitudes;
        this.port.postMessage({
          t: currentTime,
          rms: result.rms,
          spectralCentroid: result.spectralCentroid,
          spectralFlux: result.spectralFlux,
        });
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('analyzer-processor', AnalyzerProcessor);
