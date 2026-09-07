export type PlayerAction = 'laneLeft' | 'laneRight' | 'jump' | 'nitro' | 'fastFall';

export interface ConsumedInput {
  laneDelta: -1 | 0 | 1;
  jump: boolean;
  nitro: boolean;
  fastFall?: boolean;
  verticalDelta?: -1 | 0 | 1;
}

export function mergeActions(actions: PlayerAction[]): ConsumedInput {
  let laneDelta: -1 | 0 | 1 = 0;
  let jump = false;
  let nitro = false;
  let fastFall = false;
  for (const action of actions) {
    if (action === 'laneLeft') laneDelta = 1;
    else if (action === 'laneRight') laneDelta = -1;
    else if (action === 'jump') jump = true;
    else if (action === 'nitro') nitro = true;
    else if (action === 'fastFall') fastFall = true;
  }
  return fastFall
    ? { laneDelta, jump, nitro, fastFall: true }
    : { laneDelta, jump, nitro };
}
