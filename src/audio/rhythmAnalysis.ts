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
  const lowEnvelope: number[] = [];
  // Низкая полоса (~150 Гц) для кика: однополюсный lowpass поверх семплов.
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let low = 0;
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    let lowSum = 0;
    for (let j = i; j < i + hop; j++) {
      sum += samples[j] * samples[j];
      low += alpha * (samples[j] - low);
      lowSum += low * low;
    }
    envelope.push(Math.sqrt(sum / hop));
    lowEnvelope.push(Math.sqrt(lowSum / hop));
  }
  const flux = envelope.map((v, i) => Math.max(0, v - (envelope[i - 1] ?? v)));
  const lowFlux = lowEnvelope.map((v, i) => Math.max(0, v - (lowEnvelope[i - 1] ?? v)));
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
  // Даунбит: фаза 4/4 с максимальным киком на «раз». Кик-сила пика — низкий
  // флюкс в его окне относительно максимума.
  const maxLow = Math.max(0.00001, ...lowFlux);
  const kickOf = (time: number): number => {
    const index = Math.round((time - offset) / (hop / sampleRate));
    return (lowFlux[Math.min(lowFlux.length - 1, Math.max(0, index))] ?? 0) / maxLow;
  };
  const beatRotationOf = (time: number): number =>
    Math.round((time - anchor.time) / bestPeriod);
  const onGridAt = (time: number): boolean =>
    Math.abs(time - anchor.time - beatRotationOf(time) * bestPeriod) <= 0.085;
  let downbeatShift = 0;
  let downbeatScore = -1;
  for (let shift = 0; shift < 4; shift++) {
    let score = 0;
    for (const peak of peaks) {
      if (!onGridAt(peak.time)) continue;
      if (((beatRotationOf(peak.time) % 4) + 4) % 4 !== shift) continue;
      score += kickOf(peak.time) * peak.strength;
    }
    if (score > downbeatScore) {
      downbeatScore = score;
      downbeatShift = shift;
    }
  }
  // Секции: граница там, где средняя энергия следующих 8 с сильно отличается
  // от предыдущих 8 с. Своя пиковая нормализация (перцентильная схлопывается
  // на редких ударах); выход energy не меняется.
  const sectionMarks: number[] = [];
  const energyFrames: { time: number; value: number }[] = [];
  const sortedPre = [...envelope].sort((a, b) => a - b);
  const floorPre = sortedPre[Math.floor(sortedPre.length * 0.05)] ?? 0;
  const ceilingPre = sortedPre[Math.floor(sortedPre.length * 0.95)] ?? 0;
  const normPre = (rms: number): number =>
    ceilingPre < 0.0001 ? 0 : ceilingPre - floorPre < 0.0001 ? 0.5 :
      Math.min(1, Math.max(0, (rms - floorPre) / (ceilingPre - floorPre)));
  const rawFrames: number[] = [];
  for (let i = 0; i < envelope.length; i += 25) {
    const rms = envelope.slice(i, i + 25).reduce((sum, value) => sum + value, 0) / Math.min(25, envelope.length - i);
    energyFrames.push({ time: offset + (i * hop) / sampleRate, value: normPre(rms) });
    rawFrames.push(rms);
  }
  const maxRaw = Math.max(0.00001, ...rawFrames);
  const local = rawFrames.map((rms) => rms / maxRaw);
  const windowFrames = Math.max(4, Math.round(8 / 0.25));
  const refineFrames = Math.max(4, Math.round(2 / 0.25));
  const frameTime = (index: number): number => offset + (index * 25 * hop) / sampleRate;
  const windowMean = (from: number, count: number): number => {
    let sum = 0;
    for (let k = from; k < from + count; k++) sum += local[k];
    return sum / count;
  };
  let lastMark = -Infinity;
  for (let i = windowFrames; i + windowFrames <= local.length; i++) {
    const before = windowMean(i - windowFrames, windowFrames);
    const after = windowMean(i, windowFrames);
    if (Math.abs(after - before) < 0.22 || frameTime(i) - lastMark < 8) continue;
    // Уточнение границы узким окном 2 с внутри ±4 с от кандидата.
    let bestJ = i;
    let bestDiff = Math.abs(after - before);
    for (
      let j = Math.max(refineFrames, i - 16);
      j <= Math.min(local.length - refineFrames, i + 16);
      j++
    ) {
      const diff = Math.abs(windowMean(j, refineFrames) - windowMean(j - refineFrames, refineFrames));
      if (diff > bestDiff) {
        bestDiff = diff;
        bestJ = j;
      }
    }
    lastMark = frameTime(bestJ);
    sectionMarks.push(frameTime(bestJ));
  }
  const sectionPeakTimes = new Set<number>();
  for (const mark of sectionMarks) {
    let best: number | null = null;
    let bestError = 1.0;
    for (const peak of peaks) {
      const error = Math.abs(mark - peak.time);
      if (error <= bestError) {
        bestError = error;
        best = peak.time;
      }
    }
    if (best !== null) sectionPeakTimes.add(best);
  }
  const cues = peaks.map(peak => {
    const beatIndex = Math.round((peak.time - anchor.time) / bestPeriod);
    const onGrid = Math.abs(peak.time - anchor.time - beatIndex * bestPeriod) <= 0.085;
    return { id: Math.round(peak.time * 1000), time: peak.time, strength: peak.strength,
      confidence: onGrid ? Math.max(confidence, Math.min(0.75, peak.strength)) : Math.min(0.7, peak.strength),
      phrase: onGrid && ((beatIndex % 8) + 8) % 8 === 0,
      downbeat: onGrid && confidence >= 0.35 && ((beatIndex % 4) + 4) % 4 === downbeatShift,
      sectionStart: sectionPeakTimes.has(peak.time) };
  });
  return { cues, energy: energyFrames, period: bestPeriod, confidence };
}
