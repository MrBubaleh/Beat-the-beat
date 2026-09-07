import { describe, expect, it } from 'vitest';
import {
  musicalLeadDistance,
  musicSceneRouteHint,
  planMusicPattern,
} from '@core/gameplay/musicPatterns';

describe('music pattern planning', () => {
  it('plans a build-up gate when ramps are available and a guide otherwise', () => {
    expect(planMusicPattern('buildUp', true, 0)?.kind).toBe('peakGate');
    expect(planMusicPattern('buildUp', false, 0)?.kind).toBe('buildUpGuide');
    expect(planMusicPattern('buildUp', true, 1)?.kind).toBe('buildUpGuide');
  });

  it('maps phrase and section phases to distinct safe pattern families', () => {
    expect(planMusicPattern('intense', true, 0)?.kind).toBe('intenseSlalom');
    expect(planMusicPattern('peak', true, 0)?.kind).toBe('peakCoins');
    expect(planMusicPattern('cooldown', true, 0)?.kind).toBe('calmCoins');
    expect(planMusicPattern('calm', true, 0)).toBeNull();
  });

  it('converts arrival time to a bounded lead distance', () => {
    expect(musicalLeadDistance(20, 3)).toBe(60);
    expect(musicalLeadDistance(2, 3)).toBe(36);
    expect(musicalLeadDistance(50, 3)).toBe(110);
  });

  it('provides a readable route label for every music-scene family', () => {
    expect(musicSceneRouteHint('calmCoins')).toBe('straight');
    expect(musicSceneRouteHint('buildUpGuide')).toBe('diagonal');
    expect(musicSceneRouteHint('intenseSlalom')).toBe('slalom');
    expect(musicSceneRouteHint('peakGate')).toBe('ramp');
    expect(musicSceneRouteHint('horseRoadTransition')).toBe('transition');
  });
});
