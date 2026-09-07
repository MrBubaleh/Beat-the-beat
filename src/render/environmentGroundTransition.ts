export interface EnvironmentGroundTransition {
  carPresence: number;
  cityPresence: number;
  horsePresence: number;
}

const CITY_PHASE_END = 0.9;
const CITY_SINK_POWER = 1.42;
const HORSE_PHASE_START = 0.54;

/**
 * Splits one mode blend into staged ground transitions.
 * Massive city scenery sinks over a longer, heavier curve; horse decor can
 * begin rising while buildings are still burying to avoid an empty gap.
 */
export function resolveEnvironmentGroundTransition(
  horseBlend: number,
): EnvironmentGroundTransition {
  const blend = clamp01(horseBlend);
  const cityT = clamp01(blend / CITY_PHASE_END);
  return {
    carPresence: 1 - smoothstep01(clamp01(blend * 2)),
    cityPresence: 1 - smootherstep01(Math.pow(cityT, CITY_SINK_POWER)),
    horsePresence: smoothstep01(
      clamp01((blend - HORSE_PHASE_START) / (1 - HORSE_PHASE_START)),
    ),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  return value * value * (3 - 2 * value);
}

function smootherstep01(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}
