import { mergeActions } from '@core/gameplay/actions';
import type { ConsumedInput, PlayerAction } from '@core/gameplay/actions';
import type { PlayerMode } from './types';

export function interpretInput(mode: PlayerMode, actions: PlayerAction[]): ConsumedInput {
  switch (mode) {
    case 'horse': {
      const input = mergeActions(actions);
      let jump = false;
      let fastFall = Boolean(input.fastFall);
      for (const action of actions) {
        if (action === 'jump' || action === 'nitro') {
          jump = true;
          fastFall = false;
        } else if (action === 'fastFall') {
          fastFall = true;
          jump = false;
        }
      }
      return {
        laneDelta: input.laneDelta,
        jump,
        nitro: false,
        fastFall: fastFall || undefined,
      };
    }
    case 'rocket': {
      const input = mergeActions(actions);
      let verticalDelta: -1 | 0 | 1 = 0;
      if (input.fastFall) verticalDelta = -1;
      else if (input.jump || input.nitro) verticalDelta = 1;
      return verticalDelta === 0
        ? { laneDelta: input.laneDelta, jump: false, nitro: false }
        : { laneDelta: input.laneDelta, jump: false, nitro: false, verticalDelta };
    }
    case 'car': {
      const input = mergeActions(actions.filter((a) => a !== 'fastFall'));
      return { ...input, jump: false };
    }
    default:
      return mergeActions(actions);
  }
}
