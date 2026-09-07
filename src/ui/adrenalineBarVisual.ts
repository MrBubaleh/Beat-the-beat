export const ADRENALINE_BAR_VISUAL_EXPONENT = 1.62;
export const ADRENALINE_VISUAL_WARN_PERCENT = 50;
export const ADRENALINE_VISUAL_CRITICAL_PERCENT = 25;
const LOW_LINEAR_BLEND = 0.32;

export function adrenalineBarVisualPercent(actualPercent: number): number {
  const t = Math.max(0, Math.min(1, actualPercent / 100));
  const curved = Math.pow(t, ADRENALINE_BAR_VISUAL_EXPONENT);
  const blend = (1 - t) * LOW_LINEAR_BLEND;
  return (curved * (1 - blend) + t * blend) * 100;
}
