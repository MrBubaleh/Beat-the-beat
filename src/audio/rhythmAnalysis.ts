import type { MusicCue } from '@core/gameplay/musicPlanning';

export interface RhythmAnalysis {
  cues: MusicCue[];
  energy: { time: number; value: number }[];
  period: number;
  confidence: number;
}

export function analyzeRhythm(samples: Float32Array, sampleRate: number, offset = 0): RhythmAnalysis {
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const envelope: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += samples[j] * samples[j];
    envelope.push(Math.sqrt(sum / hop));
  }
  const flux = envelope.map((v, i) => Math.max(0, v - (envelope[i - 1] ?? v)));
  const peaks: { time: number; strength: number }[] = [];
  const max = Math.max(0.00001, ...flux);
  for (let i = 2; i < flux.length - 1; i++) {
    const history = flux.slice(Math.max(0, i - 80), i);
    const mean = history.reduce((sum, v) => sum + v, 0) / history.length;
    if (flux[i] < max * 0.08 || flux[i] < mean * 2 || flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;
    const time = offset + i * hop / sampleRate;
    if (time - (peaks.at(-1)?.time ?? -1) < 0.18) continue;
    peaks.push({ time, strength: flux[i] / max });
  }
  let bestPeriod = 60 / 112;
  let bestScore = 0;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const period = 60 / bpm;
    let score = 0;
    for (const peak of peaks) {
      const next = peaks.find(other => Math.abs(other.time - peak.time - period) < 0.065);
      if (next) score += Math.min(peak.strength, next.strength) * (1 - Math.abs(next.time - peak.time - period) / 0.065);
    }
    if (score > bestScore) { bestScore = score; bestPeriod = period; }
  }
  const total = peaks.reduce((sum, p) => sum + p.strength, 0);
  const confidence = peaks.length >= 6 ? Math.min(1, bestScore / Math.max(0.001, total) * 1.4) : 0;
    const phaseScore = (anchor: number): number => peaks.reduce((sum, peak) => {
    const nearest = Math.round((peak.time - anchor) / bestPeriod);
    const error = Math.abs(peak.time - anchor - nearest * bestPeriod);
    return sum + Math.sqrt(peak.strength) * Math.max(0, 1 - error / 0.085);
  }, 0);
  const anchor = peaks.reduce((best, peak) => phaseScore(peak.time) > phaseScore(best.time) ? peak : best, peaks[0] ?? { time: offset, strength: 0 });
  const cues = peaks.map(peak => {
    const beatIndex = Math.round((peak.time - anchor.time) / bestPeriod);
    const onGrid = Math.abs(peak.time - anchor.time - beatIndex * bestPeriod) <= 0.085;
    return { id: Math.round(peak.time * 1000), time: peak.time, strength: peak.strength,
      confidence: onGrid ? Math.max(confidence, Math.min(0.75, peak.strength)) : Math.min(0.7, peak.strength),
      phrase: onGrid && ((beatIndex % 8) + 8) % 8 === 0 };
  });
  const sorted = [...envelope].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
  const ceiling = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const energy: { time: number; value: number }[] = [];
  for (let i = 0; i < envelope.length; i += 25) {
    const rms = envelope.slice(i, i + 25).reduce((sum, value) => sum + value, 0) / Math.min(25, envelope.length - i);
    const value = ceiling < 0.0001 ? 0 : ceiling - floor < 0.0001 ? 0.5 : Math.min(1, Math.max(0, (rms - floor) / (ceiling - floor)));
    energy.push({ time: offset + i * hop / sampleRate, value });
  }
  return { cues, energy, period: bestPeriod, confidence };
}
