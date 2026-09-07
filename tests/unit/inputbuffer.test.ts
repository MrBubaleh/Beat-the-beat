import { describe, expect, it } from 'vitest';
import { InputBuffer } from '@input/InputBuffer';
import { mergeActions } from '@core/gameplay/actions';

describe('InputBuffer', () => {
  it('returns actions within the window and drops stale ones', () => {
    const buffer = new InputBuffer(120);
    buffer.push('laneLeft', 100);
    buffer.push('jump', 200);
    buffer.push('laneRight', 400);
    const consumed = buffer.consume(300, 120);
    expect(consumed).toEqual(['jump']);
    expect(buffer.consume(500, 120)).toEqual(['laneRight']);
  });

  it('keeps future actions for a later step', () => {
    const buffer = new InputBuffer(120);
    buffer.push('jump', 500);
    expect(buffer.consume(300)).toEqual([]);
    expect(buffer.consume(520)).toEqual(['jump']);
  });

  it('clears buffered actions when a run pauses or restarts', () => {
    const buffer = new InputBuffer(120);
    buffer.push('laneLeft', 100);
    buffer.push('nitro', 110);
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.consume(120)).toEqual([]);
  });

  it('mergeActions: last lane action wins, jump and nitro are sticky', () => {
    expect(mergeActions(['laneLeft', 'laneRight'])).toEqual({
      laneDelta: -1,
      jump: false,
      nitro: false,
    });
    expect(mergeActions(['laneRight', 'laneLeft', 'jump'])).toEqual({
      laneDelta: 1,
      jump: true,
      nitro: false,
    });
    expect(mergeActions(['jump', 'nitro'])).toEqual({
      laneDelta: 0,
      jump: true,
      nitro: true,
    });
    expect(mergeActions([])).toEqual({ laneDelta: 0, jump: false, nitro: false });
  });
});
