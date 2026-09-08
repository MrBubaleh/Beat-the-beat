import type { LevelgenConfig } from '@core/config/schemas';
import { carTrafficScrollSpeed } from '@core/levelgen/trafficMotion';
import type { MusicCue } from './musicPlanning';
import type { ObstacleEntity } from '@core/levelgen/types';

/**
 * Квантование препятствий машины на бит-сетку (пункт 1).
 *
 * Чистый fairness-хелпер: сдвигает staged-препятствия (ещё не опубликованы,
 * двигать можно) так, чтобы момент встречи совпал с битом. Опубликованные
 * препятствия не трогаются. Вызыватель обязан прогнать результат через
 * certifyMusicCandidate; при провале — оставить исходный staged.
 */

export interface BeatSnapContext {
  cues: readonly MusicCue[];
  /** Трек-время «сейчас» (forecast.now). */
  now: number;
  rate: number;
  playerSpeed: number;
  config: LevelgenConfig;
  /** Максимальный сдвиг встречи в секундах. */
  windowSeconds: number;
}

/** Дальность, на которой встреча совпадёт с битом, или null. */
export function snapObstacleToBeat(
  obstacle: ObstacleEntity,
  context: BeatSnapContext,
): number | null {
  if (obstacle.z <= 0) return null;
  if (obstacle.broken || obstacle.cleared || obstacle.collisionIgnored) return null;
  if (obstacle.trainId !== undefined) return null;
  if (obstacle.kind !== 'tall' && obstacle.kind !== 'low') return null;
  if (obstacle.redWall || obstacle.nitroChallenge || obstacle.nitroMandatory) return null;
  const relative = carTrafficScrollSpeed(
    context.playerSpeed,
    obstacle.lane,
    context.config,
    obstacle,
  );
  const arrivalGameSeconds = obstacle.z / Math.max(relative, 1);
  let best: MusicCue | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const cue of context.cues) {
    const cueGameSeconds = (cue.time - context.now) / Math.max(context.rate, 0.25);
    if (cueGameSeconds < 0) continue;
    const error = Math.abs(cueGameSeconds - arrivalGameSeconds);
    if (error < bestError) {
      bestError = error;
      best = cue;
    }
  }
  if (!best || bestError > context.windowSeconds) return null;
  return ((best.time - context.now) / Math.max(context.rate, 0.25)) * Math.max(relative, 1);
}

/**
 * Снэп якоря конной группы: ты жмёшь прыжок/подкат ЗАРАНЕЕ, поэтому препятствие
 * должно прийти на `leadSeconds` ПОЗЖЕ бита — тогда нажатие ложится точно в такт.
 * Обязательные прыжковые ряды тянутся к фразам, крупные увороты предпочитают
 * сильные биты, остальные группы — к ближайшему биту.
 */
export type HorseSnapMode = 'phrase' | 'strong' | 'any';

export interface HorseGroupSnapContext {
  cues: readonly MusicCue[];
  now: number;
  rate: number;
  playerSpeed: number;
  config: LevelgenConfig;
  windowSeconds: number;
  mode: HorseSnapMode;
  /** Упреждение: нажатие раньше встречи. */
  leadSeconds: number;
  /** Порог «сильного» бита для режима strong. */
  strongStrength: number;
}

export function snapHorseGroupAnchor(
  anchor: ObstacleEntity,
  context: HorseGroupSnapContext,
): { z: number; cue: MusicCue } | null {
  if (anchor.z <= 0) return null;
  const relative = carTrafficScrollSpeed(
    context.playerSpeed,
    anchor.lane,
    context.config,
    anchor,
  );
  const arrivalGameSeconds = anchor.z / Math.max(relative, 1);
  const snapTo = (cues: readonly MusicCue[]): { z: number; cue: MusicCue } | null => {
    let best: MusicCue | null = null;
    let bestError = Number.POSITIVE_INFINITY;
    for (const cue of cues) {
      const cueGameSeconds = (cue.time - context.now) / Math.max(context.rate, 0.25);
      if (cueGameSeconds < 0) continue;
      const error = Math.abs(cueGameSeconds + context.leadSeconds - arrivalGameSeconds);
      if (error < bestError) {
        bestError = error;
        best = cue;
      }
    }
    if (!best || bestError > context.windowSeconds) return null;
    return {
      z: ((best.time + context.leadSeconds - context.now) / Math.max(context.rate, 0.25)) *
        Math.max(relative, 1),
      cue: best,
    };
  };
  if (context.mode === 'phrase') {
    return snapTo(context.cues.filter((cue) => cue.phrase));
  }
  if (context.mode === 'strong') {
    return (
      snapTo(context.cues.filter((cue) => cue.phrase || cue.strength >= context.strongStrength)) ??
      snapTo(context.cues)
    );
  }
  return snapTo(context.cues);
}

/**
 * Крутые моменты: даунбит > фраза/сильный бит. Дальше — только сильные места,
 * слабые биты не трогаем (нечего дёргать ради них).
 */
export interface StrongCueContext {
  cues: readonly MusicCue[];
  rate: number;
  /** Окно поиска в игровых секундах. */
  windowSeconds: number;
  strongStrength: number;
}

/** Ближайший крутой момент к трек-времени, или null. */
export function pickStrongCue(
  atTrackTime: number,
  context: StrongCueContext,
): MusicCue | null {
  const windowTrack = context.windowSeconds * Math.max(context.rate, 0.25);
  let best: MusicCue | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const cue of context.cues) {
    if (!cue.downbeat) continue;
    const error = Math.abs(cue.time - atTrackTime);
    if (error < bestError) {
      bestError = error;
      best = cue;
    }
  }
  if (best && bestError <= windowTrack) return best;
  best = null;
  bestError = Number.POSITIVE_INFINITY;
  for (const cue of context.cues) {
    if (!cue.phrase && cue.strength < context.strongStrength) continue;
    const error = Math.abs(cue.time - atTrackTime);
    if (error < bestError) {
      bestError = error;
      best = cue;
    }
  }
  if (best && bestError <= windowTrack) return best;
  return null;
}

/** Ближайший любой бит к трек-времени в окне, или null (для подборов). */
export function pickNearCue(
  atTrackTime: number,
  cues: readonly MusicCue[],
  rate: number,
  windowSeconds: number,
): MusicCue | null {
  const windowTrack = windowSeconds * Math.max(rate, 0.25);
  let best: MusicCue | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    const error = Math.abs(cue.time - atTrackTime);
    if (error < bestError) {
      bestError = error;
      best = cue;
    }
  }
  if (!best || bestError > windowTrack) return null;
  return best;
}

/** Снэп наземного бонуса/монеты так, чтобы подбор лёг на крутой момент. */
export function snapBonusToStrongCue(
  z: number,
  speed: number,
  now: number,
  context: StrongCueContext,
): { z: number; cue: MusicCue } | null {
  if (z <= 0) return null;
  const arrivalTrack =
    now + (z / Math.max(speed, 1)) * Math.max(context.rate, 0.25);
  const cue = pickStrongCue(arrivalTrack, context);
  if (!cue) return null;
  return {
    z: ((cue.time - now) / Math.max(context.rate, 0.25)) * Math.max(speed, 1),
    cue,
  };
}
/**
 * Применяет снэп ко всем подходящим staged-препятствиям. Возвращает новый
 * массив; separation-контроль против опубликованных и соседей — внутри.
 */
export function quantizeStagedToBeat(
  staged: readonly ObstacleEntity[],
  published: readonly ObstacleEntity[],
  context: BeatSnapContext,
): ObstacleEntity[] {
  const minSeparation = context.config.minGapZ * 0.6;
  const taken = new Map<number, number[]>();
  for (const obstacle of published) {
    if (obstacle.trainId !== undefined) continue;
    const list = taken.get(obstacle.lane) ?? [];
    list.push(obstacle.z);
    taken.set(obstacle.lane, list);
  }
  const result: ObstacleEntity[] = [];
  for (const obstacle of staged) {
    const snapped = snapObstacleToBeat(obstacle, context);
    if (snapped === null || snapped <= 0) {
      result.push(obstacle);
      const list = taken.get(obstacle.lane) ?? [];
      list.push(obstacle.z);
      taken.set(obstacle.lane, list);
      continue;
    }
    const lanes = taken.get(obstacle.lane) ?? [];
    const clashes = lanes.some((z) => Math.abs(z - snapped) < minSeparation);
    if (clashes) {
      result.push(obstacle);
      lanes.push(obstacle.z);
      taken.set(obstacle.lane, lanes);
      continue;
    }
    lanes.push(snapped);
    taken.set(obstacle.lane, lanes);
    result.push({ ...obstacle, z: snapped });
  }
  return result;
}
