import fs from 'node:fs';
let s=fs.readFileSync('tests/unit/musicLookahead.test.ts','utf8');
s=s.replace('  const scheduled: number[] = [];','  const scheduled: number[] = [];\n  let previousHits = 0;');
s=s.replace('    for (const e of [...snap.obstacles, ...snap.coins]) {',`    if (snap.runStats.hits > previousHits) console.log('HIT', seed, time, snap.player.lane, snap.obstacles.filter(o => Math.abs(o.z) < 9).map(o => ({id:o.id, lane:o.lane, z:o.z, kind:o.kind, target:o.musicTarget})));
    previousHits = snap.runStats.hits;
    for (const e of [...snap.obstacles, ...snap.coins]) {`);
s=s.replace('  return { snapshot: sim.getSnapshot(), scheduled };',`  console.log('METRICS', seed, rules, sim.getSnapshot().musicTiming);
  return { snapshot: sim.getSnapshot(), scheduled };`);
fs.writeFileSync('tests/unit/musicLookahead.test.ts',s);
