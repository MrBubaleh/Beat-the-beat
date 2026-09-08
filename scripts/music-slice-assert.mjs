import fs from 'node:fs';
const p='tests/unit/musicLookahead.test.ts';let s=fs.readFileSync(p,'utf8');
s=s.replace('    expect(result.snapshot.musicTiming!.samples).toBeGreaterThan(3);','    expect(result.snapshot.musicTiming!.samples).toBeGreaterThan(3);\n    expect(result.snapshot.musicTiming!.medianMs).toBeLessThan(120);\n    expect(result.snapshot.musicTiming!.p95Ms).toBeLessThan(260);\n    expect(result.snapshot.musicTiming!.hitShare).toBeGreaterThan(0.5);');
s=s.replace('  let previousHits = 0;\n','');
s=s.split('\n').filter(line => !line.includes("console.log('HIT'") && !line.includes('previousHits =') && !line.includes("console.log('METRICS'")).join('\n');
fs.writeFileSync(p,s);
