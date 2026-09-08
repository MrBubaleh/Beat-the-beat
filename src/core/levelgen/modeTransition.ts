import type { LevelgenConfig } from '@core/config/schemas';
import type { ObstacleEntity } from './types';

/**
 * Переход конь → машина: fairness-слой.
 *
 * Уже опубликованные препятствия immutable: их нельзя удалять или
 * переставлять. Этот модуль только:
 *  - считает, сколько новых чанков держать разреженными после перехода;
 *  - считает горизонт, в котором leftover-разметка ещё актуальна;
 *  - планирует presentation-only монеты-направляющие в свободной полосе
 *    бывших slide-групп (монеты добавляются, препятствия не трогаются).
 */

export interface HorseLeftoverGuide {
  lane: number;
  z: number;
}

/** Сколько новых car-чанков после перехода генерировать разреженными. */
export function horseToCarTransitionChunks(): number {
  return 2;
}

/** Во сколько раз резать плотность в переходных чанках. */
export function horseToCarTransitionDensityScale(): number {
  return 0.32;
}

/**
 * Дальность leftover-разметки: фактическая полоса не важна (разметка идёт по
 * свободной полосе группы), важны скорость, длительность перестроения и запас
 * времени реакции.
 */
export function horseLeftoverGuideHorizonZ(
  speed: number,
  fairness: LevelgenConfig['fairness'],
): number {
  const seconds =
    fairness.minDecisionSeconds + fairness.laneSwitchSeconds + 0.35;
  return Math.max(1, speed) * seconds;
}

function isLeftoverSlide(
  obstacle: ObstacleEntity,
  groupId: number,
): boolean {
  return (
    !obstacle.broken &&
    !obstacle.cleared &&
    obstacle.kind === 'overhead' &&
    obstacle.horseAction === 'slide' &&
    obstacle.actionGroupId === groupId
  );
}

/**
 * Для каждой опубликованной slide-группы в пределах горизонта возвращает точки
 * (свободная полоса, z) — туда GameSim положит safeGuide-монеты. Группы,
 * перекрывающие все полосы (свободного проезда нет), пропускаются: рисовать
 * направляющую некуда, честность там держится на grace-периоде перехода.
 */
export function planHorseToCarGuides(
  obstacles: readonly ObstacleEntity[],
  lanes: number,
  horizonZ: number,
): HorseLeftoverGuide[] {
  const groupIds = new Set<number>();
  for (const obstacle of obstacles) {
    if (
      obstacle.actionGroupId === undefined ||
      obstacle.z <= 0 ||
      obstacle.z > horizonZ
    ) {
      continue;
    }
    if (isLeftoverSlide(obstacle, obstacle.actionGroupId)) {
      groupIds.add(obstacle.actionGroupId);
    }
  }
  const guides: HorseLeftoverGuide[] = [];
  for (const groupId of groupIds) {
    const group = obstacles.filter((obstacle) =>
      isLeftoverSlide(obstacle, groupId),
    );
    if (group.length === 0) continue;
    const blocked = new Set(group.map((obstacle) => obstacle.lane));
    let freeLane = -1;
    for (let lane = 0; lane < lanes; lane++) {
      if (!blocked.has(lane)) {
        freeLane = lane;
        break;
      }
    }
    if (freeLane < 0) continue;
    for (const obstacle of group) {
      guides.push({ lane: freeLane, z: obstacle.z });
    }
  }
  guides.sort((a, b) => a.z - b.z);
  return guides;
}
