export interface LongRunDifficultyConfig {
  delaySeconds: number;
  rampSeconds: number;
}

export function longRunDifficultyProgress(
  gameTime: number,
  config: LongRunDifficultyConfig,
): number {
  const linear = clamp01((gameTime - config.delaySeconds) / config.rampSeconds);
  return linear * linear * (3 - 2 * linear);
}

export function lateRunProgress(
  songProgress: number,
  longRunProgress: number,
  startProgress: number,
): number {
  const combined = Math.max(clamp01(songProgress), clamp01(longRunProgress));
  const start = clamp01(startProgress);
  const linear = clamp01((combined - start) / Math.max(1e-6, 1 - start));
  return linear * linear * (3 - 2 * linear);
}

export function scaleTowardEnd(endScale: number, progress: number): number {
  return 1 + (endScale - 1) * clamp01(progress);
}

export function lateSongEaseFactor(
  songProgress: number,
  startProgress: number,
  maxReduction: number,
): number {
  const start = clamp01(startProgress);
  if (songProgress <= start) return 1;
  const linear = clamp01((songProgress - start) / Math.max(1e-6, 1 - start));
  const smooth = linear * linear * (3 - 2 * linear);
  return 1 - clamp01(maxReduction) * smooth;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
