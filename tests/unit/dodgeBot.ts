import type { GameSim } from '@core/gameplay/GameSim';
import type { PlayerAction } from '@core/gameplay/actions';

export function makeDodgeBot(laneCount: number): (snapshot: ReturnType<GameSim['getSnapshot']>) => PlayerAction[] {
  return (snapshot) => {
    const player = snapshot.player;
    const horizon = 20;
    const stayClearance = 8;
    const ahead = snapshot.obstacles.filter((o) => !o.broken && o.z > 0 && o.z < horizon);
    const nearestByLane = Array.from({ length: laneCount }, () => Infinity);
    for (const o of ahead) {
      if (o.lane >= 0 && o.lane < laneCount) {
        nearestByLane[o.lane] = Math.min(nearestByLane[o.lane], o.z);
      }
    }
    if (nearestByLane[player.lane] >= stayClearance) return [];
    let bestLane = player.lane;
    for (let lane = 0; lane < laneCount; lane++) {
      if (nearestByLane[lane] > nearestByLane[bestLane]) bestLane = lane;
    }
    if (bestLane === player.lane) return [];
    return [bestLane > player.lane ? 'laneRight' : 'laneLeft'];
  };
}
