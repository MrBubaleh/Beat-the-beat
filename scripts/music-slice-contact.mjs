import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(a);fs.writeFileSync(p,s.replace(a,b));}
edit('src/audio/rhythmAnalysis.ts','if (next) score += Math.min(peak.strength, next.strength);','if (next) score += Math.min(peak.strength, next.strength) * (1 - Math.abs(next.time - peak.time - period) / 0.065);');
edit('src/core/gameplay/GameSim.ts','(this.opts.game.obstacle.depth + this.opts.game.player.depth) / 2 - this.opts.game.hit.zGrace','(this.opts.game.obstacle.lowDepth * this.opts.game.obstacle.microDepthScale + this.opts.game.player.depth) / 2 - this.opts.game.hit.zGrace');
edit('src/core/gameplay/GameSim.ts','      const passed = entity.z <= entry.contact;','      const passed = entity.z <= 0;');
