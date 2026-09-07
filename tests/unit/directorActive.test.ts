import { describe, expect, it } from 'vitest';
import directorRaw from '../../configs/director.default.json';
import type { DirectorConfig } from '@core/config/schemas';
import { ActiveDirector } from '@core/director/ActiveDirector';
import { ConstraintValidator } from '@core/director/ConstraintValidator';
import type { TransitionContext } from '@core/director/ConstraintValidator';
import { TransitionScorer } from '@core/director/TransitionScorer';
import type { ScorerContext } from '@core/director/TransitionScorer';
import type { DirectorPhase } from '@core/state/DirectorState';
import { makeMusic } from './musicHelpers';

const cfg = directorRaw as DirectorConfig;
const PHASES: DirectorPhase[] = ['calm', 'buildUp', 'intense', 'peak', 'cooldown'];

describe('TransitionScorer', () => {
  function ctx(over: Partial<ScorerContext> = {}): ScorerContext {
    return {
      music: makeMusic({ energy: 0.7 }),
      stress: 0,
      currentPhase: 'calm',
      phaseElapsed: 0,
      ...over,
    };
  }

  it('scores phases by distance to their center', () => {
    const scorer = new TransitionScorer(cfg);
    const scores = PHASES.map((phase) => scorer.score(phase, ctx(), false));
    expect(scores[1]).toBeGreaterThan(scores[0]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
    expect(scores[1]).toBeGreaterThan(scores[3]);
  });

  it('applies a cooldown penalty', () => {
    const scorer = new TransitionScorer(cfg);
    const c = ctx();
    expect(scorer.score('buildUp', c, true)).toBeLessThan(scorer.score('buildUp', c, false));
  });

  it('penalizes lingering in the current phase', () => {
    const scorer = new TransitionScorer(cfg);
    expect(scorer.score('buildUp', ctx(), false)).toBeGreaterThan(
      scorer.score('buildUp', ctx({ currentPhase: 'buildUp', phaseElapsed: 5 }), false),
    );
  });
});

describe('ConstraintValidator', () => {
  function ctx(
    scores: Partial<Record<DirectorPhase, number>>,
    over: Partial<TransitionContext> = {},
  ): TransitionContext {
    return {
      now: 100,
      phaseElapsed: 0,
      cooldownDeadlines: {
        calm: -Infinity,
        buildUp: -Infinity,
        intense: -Infinity,
        peak: -Infinity,
        cooldown: -Infinity,
      },
      lastMajorEventAt: 0,
      scores: scores as Record<DirectorPhase, number>,
      ...over,
    };
  }

  it('allows adjacent upward transitions past the hysteresis threshold', () => {
    const v = new ConstraintValidator(cfg);
    expect(v.canTransit('calm', 'buildUp', ctx({ calm: 0, buildUp: 0.2 }))).toBe(true);
    expect(v.canTransit('calm', 'buildUp', ctx({ calm: 0, buildUp: 0.09 }))).toBe(false);
  });

  it('blocks skipping phases and entering/leaving cooldown', () => {
    const v = new ConstraintValidator(cfg);
    expect(v.canTransit('calm', 'intense', ctx({ calm: 0, intense: 1 }))).toBe(false);
    expect(v.canTransit('calm', 'cooldown', ctx({ calm: 0, cooldown: 0 }))).toBe(false);
    expect(v.canTransit('cooldown', 'calm', ctx({ cooldown: 0, calm: 0 }))).toBe(false);
    expect(v.canTransit('calm', 'calm', ctx({ calm: 0 }))).toBe(false);
  });

  it('gates peak behind minSecondsBetweenMajorEvents', () => {
    const v = new ConstraintValidator(cfg);
    const recent = ctx({ intense: 0, peak: 0.2 }, { now: 10, lastMajorEventAt: 9 });
    expect(v.canTransit('intense', 'peak', recent)).toBe(false);
    const old = ctx({ intense: 0, peak: 0.2 }, { now: 30, lastMajorEventAt: 9 });
    expect(v.canTransit('intense', 'peak', old)).toBe(true);
  });

  it('allows downward transitions only when the target fits clearly better', () => {
    const v = new ConstraintValidator(cfg);
    expect(v.canTransit('intense', 'buildUp', ctx({ intense: 0.1, buildUp: 0.5 }))).toBe(true);
    expect(v.canTransit('intense', 'buildUp', ctx({ intense: 0.5, buildUp: 0.4 }))).toBe(false);
    expect(v.canTransit('peak', 'calm', ctx({ peak: -0.1, calm: 0.2 }))).toBe(true);
  });

  it('respects target cooldown deadlines', () => {
    const v = new ConstraintValidator(cfg);
    const c = ctx(
      { calm: 0, buildUp: 0.5 },
      {
        cooldownDeadlines: {
          calm: -Infinity,
          buildUp: 200,
          intense: -Infinity,
          peak: -Infinity,
          cooldown: -Infinity,
        },
      },
    );
    expect(v.canTransit('calm', 'buildUp', c)).toBe(false);
  });
});

describe('ActiveDirector', () => {
  it('climbs calm→buildUp→intense→peak→cooldown→calm on sustained high energy', () => {
    const director = new ActiveDirector(cfg);
    const music = makeMusic({ energy: 0.9, brightness: 0.9 });
    const seen: string[] = [director.phase];
    let now = 0;
    for (let i = 0; i < 400; i++) {
      director.update(0.1, now, music, 0.6);
      if (seen[seen.length - 1] !== director.phase) seen.push(director.phase);
      now += 0.1;
    }
    expect(seen.slice(0, 5)).toEqual(['calm', 'buildUp', 'intense', 'peak', 'cooldown']);
    expect(seen.slice(5)).toContain('buildUp');
    expect(seen.slice(5)).toContain('intense');
  });

  it('stays calm on low-energy music', () => {
    const director = new ActiveDirector(cfg);
    const music = makeMusic({ energy: 0.1, brightness: 0.1 });
    let now = 0;
    for (let i = 0; i < 300; i++) {
      director.update(0.1, now, music, 0.05);
      now += 0.1;
    }
    expect(director.phase).toBe('calm');
  });

  it('scales speed and vfx intents with music energy', () => {
    const calmDirector = new ActiveDirector(cfg);
    for (let i = 0; i < 30; i++) calmDirector.update(0.1, i * 0.1, makeMusic({ energy: 0.1 }), 0);
    const calmSpeed = calmDirector
      .update(0.1, 3, makeMusic({ energy: 0.1 }), 0)
      .intents.find((i) => i.target === 'speed');
    expect(calmSpeed?.value as number).toBe(1);

    const hotDirector = new ActiveDirector(cfg);
    for (let i = 0; i < 30; i++) hotDirector.update(0.1, i * 0.1, makeMusic({ energy: 0.9 }), 0);
    const hot = hotDirector.update(0.1, 3, makeMusic({ energy: 0.9 }), 0).intents;
    const hotSpeed = hot.find((i) => i.target === 'speed');
    const hotVfx = hot.find((i) => i.target === 'vfxIntensity');
    expect(hotSpeed?.value as number).toBeGreaterThan(1);
    expect(hotSpeed?.value as number).toBeLessThan(1.8);
    expect(hotVfx?.value as number).toBeGreaterThan(0);
    expect(hotVfx?.value as number).toBeLessThanOrEqual(1);
  });

  it('holds the phase through momentary energy dips inside a loud section', () => {
    const heldCfg: DirectorConfig = {
      ...cfg,
      constraints: { ...cfg.constraints, minSecondsBetweenMajorEvents: 1e9 },
    };
    const director = new ActiveDirector(heldCfg);
    let now = 0;
    let reachedIntense = false;
    let droppedBelowIntense = false;
    for (let i = 0; i < 600; i++) {
      const t = i * 0.1;
      const inDip = t >= 5 && t < 5.5;
      director.update(0.1, now, makeMusic({ energy: inDip ? 0.35 : 0.85, brightness: 0.9 }), 0.5);
      if (director.phase === 'intense') reachedIntense = true;
      else if (reachedIntense && (director.phase === 'buildUp' || director.phase === 'calm')) {
        droppedBelowIntense = true;
      }
      now += 0.1;
    }
    expect(reachedIntense).toBe(true);
    expect(droppedBelowIntense).toBe(false);
  });

  it('reset clears phase and memory', () => {
    const director = new ActiveDirector(cfg);
    director.update(0.1, 0, makeMusic({ energy: 0.9 }), 0);
    expect(director.memory.intents.length).toBeGreaterThan(0);
    director.reset();
    expect(director.phase).toBe('calm');
    expect(director.memory.intents).toHaveLength(0);
  });
});
