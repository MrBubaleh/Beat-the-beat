import { analyzeRhythm } from './rhythmAnalysis';

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number; offset: number; until: number; serial: number }>) => {
  const { samples, sampleRate, offset, until, serial } = event.data;
  self.postMessage({ ...analyzeRhythm(samples, sampleRate, offset), until, serial });
};
