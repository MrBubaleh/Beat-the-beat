import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
edit('src/core/gameplay/GameSim.ts','request.cue.time <= forecast.now + cfg.maxLeadSeconds * rate &&','request.cue.time <= forecast.now + cfg.maxLeadSeconds * rate && request.cue.time <= forecast.availableUntil &&');
edit('src/core/gameplay/GameSim.ts','const accents = request.accents.filter((cue, i, all) => i === 0 || cue.time - all[i - 1].time >= 0.28 * rate).slice(0, 4);','const accents = request.accents.filter((cue, i, all) => cue.time <= forecast.availableUntil &&\n        (duration <= 0 || cue.time < duration - this.levelgen.trackEndObstacleStopSeconds) &&\n        (i === 0 || cue.time - all[i - 1].time >= 0.28 * rate)).slice(0, 4);');
edit('src/core/gameplay/GameSim.ts','const targetLane = useAction ? (lane < this.levelgen.lanes - 1 ? lane + 1 : lane - 1) : lane;',`const direction = ((this.generator.seed ^ this.rhythmSequence) & 1) === 0 ? 1 : -1;
          const neighbor = lane + direction < 0 || lane + direction >= this.levelgen.lanes ? lane - direction : lane + direction;
          const targetLane = useAction ? neighbor : lane;`);
edit('src/core/levelgen/musicPlacement.ts','    for (const pickup of pickups) {','    for (const pickup of pickups) {');
edit('src/core/levelgen/musicPlacement.ts','      for (const hazard of hazards) {',`      for (const ramp of ramps) {
        if (ramp.lane !== pickup.lane || ramp.used) continue;
        const gap = ramp.z - pickup.z;
        const rampSpeed = ramp.gateId === undefined ? carTrafficScrollSpeed(playerSpeed, ramp.lane, config) : playerSpeed;
        const endGap = gap - (rampSpeed - pickupSpeed) * arrival;
        if (Math.abs(gap) < 2 || Math.abs(endGap) < 2 || gap * endGap < 0) return false;
      }
      for (const hazard of hazards) {`);
edit('src/core/gameplay/musicPatterns.ts',"import type { DirectorPhase }", "export { requestMusicalPatterns } from './musicPlanning';\n\nimport type { DirectorPhase }");
edit('src/core/director/ActiveDirector.ts',"import { requestMusicalPatterns } from '../gameplay/musicPlanning';", "import { requestMusicalPatterns } from '../gameplay/musicPatterns';");
edit('src/app/bootstrap.ts','planned ${snapshot.musicTiming.planned} rejected', 'planned ${snapshot.musicTiming.planned} measured ${snapshot.musicTiming.samples} rejected');
