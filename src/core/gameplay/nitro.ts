export function addNitroCharge(charge: number, amount: number, maxFill: number): number {
  return Math.min(maxFill, charge + amount);
}

/** Отклик пустого нитро: длительность визуального импульса и кулдаун повторных чихов. */
export const NITRO_DRY_PULSE_SECONDS = 0.35;
export const NITRO_DRY_COOLDOWN_SECONDS = 0.6;

export function drainNitroCharge(charge: number, drainPerSecond: number, dt: number): number {
  return Math.max(0, charge - drainPerSecond * dt);
}

export function applyNitroBoost(charge: number, maxFill: number, boostMax: number): number {
  return 1 + boostMax * (charge / maxFill);
}
