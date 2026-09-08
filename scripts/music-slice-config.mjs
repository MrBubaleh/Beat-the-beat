import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
const extra = {
  stageEnds: [0.48,0.72,0.8], densityCaps: [0.38,0.48,0.62,0.36,0.7], actionCaps: [2,3,4,2,5],
  blockedLaneCaps:[1,2,2,1,3], reactionSeconds:[0.65,0.45,0.35,0.5,0.28], speedCaps:[1.2,1.35,1.55,1.3,1.65]
};
edit('src/core/gameplay/musicPlanning.ts','  introSeconds: 20,','  introSeconds: 20,\n'+Object.entries(extra).map(([k,v])=>'  '+k+': '+JSON.stringify(v)+',').join('\n'));
const p='configs/game.default.json';let raw=fs.readFileSync(p,'utf8');raw=raw.replace('"introSeconds": 20','"introSeconds": 20,\n'+Object.entries(extra).map(([k,v])=>'    "'+k+'": '+JSON.stringify(v)).join(',\n'));fs.writeFileSync(p,raw);
edit('src/core/config/schemas.ts','    introSeconds: z.number().min(15).max(25),',`    introSeconds: z.number().min(15).max(25),
    stageEnds: z.array(z.number().min(0).max(1)).length(3),
    densityCaps: z.array(z.number().min(0).max(1)).length(5),
    actionCaps: z.array(z.number().int().min(1).max(8)).length(5),
    blockedLaneCaps: z.array(z.number().int().min(1).max(3)).length(5),
    reactionSeconds: z.array(z.number().min(0.28).max(2)).length(5),
    speedCaps: z.array(z.number().min(1).max(1.8)).length(5),`);
edit('src/core/config/schemas.ts',"{ message: 'music planning horizon must exceed the scheduling lead' }).default(MUSIC_PLANNING_DEFAULTS)","{ message: 'music planning horizon must exceed the scheduling lead' }).refine(value => value.stageEnds.every((end, i) => i === 0 || end > value.stageEnds[i - 1]), { message: 'music stages must be ordered' }).default(MUSIC_PLANNING_DEFAULTS)");
const plan='src/core/gameplay/musicPlanning.ts';let source=fs.readFileSync(plan,'utf8');const a=source.indexOf('export function runEnvelope('),b=source.indexOf('\nexport interface MusicalPatternRequest',a);
source=source.slice(0,a)+`export function runEnvelope(time: number, duration: number, config: MusicPlanningConfig = MUSIC_PLANNING_DEFAULTS): RunEnvelope {
  const progress = duration > config.introSeconds * 2 ? time / duration : Math.max(0, time - config.introSeconds) / 160;
  const index = time < config.introSeconds ? 0 : progress < config.stageEnds[0] ? 1 : progress < config.stageEnds[1] ? 2 : progress < config.stageEnds[2] ? 3 : 4;
  const stage: RunStage = (['warmup', 'build', 'peak', 'breather', 'final'] as const)[index];
  const warmup = index === 0 ? Math.max(0, Math.min(1, time / config.introSeconds)) : 1;
  return { stage, densityCap: config.densityCaps[index] * (0.65 + warmup * 0.35),
    maxActions: index === 0 && time < 10 ? 1 : config.actionCaps[index],
    maxBlockedLanes: config.blockedLaneCaps[index], minReactionSeconds: config.reactionSeconds[index],
    speedIntentCap: index === 0 ? 1.08 + (config.speedCaps[0] - 1.08) * warmup : config.speedCaps[index] };
}
`+source.slice(b);fs.writeFileSync(plan,source);
let sim=fs.readFileSync('src/core/gameplay/GameSim.ts','utf8').replaceAll('this.opts.game.musicPlanning.introSeconds)', 'this.opts.game.musicPlanning)').replaceAll('runEnvelope(time, duration, cfg.introSeconds)','runEnvelope(time, duration, cfg)');fs.writeFileSync('src/core/gameplay/GameSim.ts',sim);
edit('src/core/levelgen/musicPlacement.ts',"if (hazard === pickup || hazard.kind === 'micro' || hazard.lane !== pickup.lane) continue;","if (hazard === pickup || hazard.lane !== pickup.lane) continue;");
edit('src/core/levelgen/musicPlacement.ts','const clearance = Math.max(config.minGapZ',"const clearance = hazard.kind === 'micro' ? 1.6 : Math.max(config.minGapZ");
edit('src/core/gameplay/GameSim.ts',"if (this.ghost || player.mode !== 'car' || player.airState !== 'grounded') return;","if (this.ghost || player.mode !== 'car' || player.airState !== 'grounded' || this.trains.some(train => train.z + train.length / 2 > 0)) return;");
