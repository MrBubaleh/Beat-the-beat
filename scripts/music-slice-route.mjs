import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
edit('src/core/gameplay/GameSim.ts','this.playerSim.predictTravel(times, this.laneFlowFor(lane), this.lastSpeedMultiplier, smashTimes)','this.playerSim.predictTravel(times, this.laneFlowFor(lane) * this.levelgen.multiLaneFlowFactor, this.lastSpeedMultiplier, smashTimes)');
edit('src/core/gameplay/GameSim.ts','const pickupLane = useAction && i >= 2 ? targetLane : lane;','const pickupLane = useAction ? targetLane : lane;');
edit('src/core/gameplay/GameSim.ts','            const entity: CoinEntity | ObstacleEntity = micro','            const flowGroupId = this.nextMusicGateId;\n            const entity: CoinEntity | ObstacleEntity = micro');
edit('src/core/gameplay/GameSim.ts',"kind: 'micro', lane: pickupLane, z, routeGuide: true, musicTarget", "kind: 'micro', lane: pickupLane, z, flowGroupId, routeGuide: true, musicTarget");
edit('src/core/gameplay/GameSim.ts',"lane: pickupLane, z, y: this.levelgen.coinHeight, collected: false, routeKind: 'sceneGuide', musicTarget", "lane: pickupLane, z, flowGroupId, y: this.levelgen.coinHeight, collected: false, routeKind: 'sceneGuide', musicTarget");
edit('src/core/gameplay/GameSim.ts','            const cue = accents[2];','            const cue = accents[1];');
edit('src/core/gameplay/GameSim.ts','            const z = travel[lane][2];','            const z = travel[lane][1];');
edit('src/core/gameplay/GameSim.ts',"kind: 'tall', lane, z,\n              zExtent", "kind: 'tall', lane, z, flowGroupId: this.nextMusicGateId,\n              zExtent");
edit('src/core/gameplay/GameSim.ts','          this.rhythmSequence++;','          this.nextMusicGateId--;\n          this.rhythmSequence++;');
edit('src/core/gameplay/GameSim.ts','accents.at(-1)!.time + 0.35 * rate','accents.at(-1)!.time + 1.0 * rate');
edit('src/core/gameplay/GameSim.ts','    return { speed: Math.max(player.speed, this.opts.game.speeds.base),','    return { time: this.opts.getTrackTime?.() ?? player.gameTime, speed: Math.max(player.speed, this.opts.game.speeds.base),');
edit('src/core/levelgen/musicPlacement.ts','export interface MusicPlacementContext {','export interface MusicPlacementContext {\n  time?: number;');
edit('src/core/levelgen/LevelGenerator.ts','      if (obstacle.redWall || obstacle.nitroMandatory) continue;',`      if (obstacle.redWall || obstacle.nitroMandatory) continue;
      if (context.envelope.stage === 'warmup' && obstacle.kind !== 'micro' &&
        (context.time ?? 0) + obstacle.z / carTrafficScrollSpeed(context.maxSpeed, obstacle.lane, this.config, obstacle) < 5.5) continue;`);
edit('tests/unit/musicLookahead.test.ts',"import { analyzeRhythm }", "import { carTrafficScrollSpeed } from '@core/levelgen/trafficMotion';\nimport { analyzeRhythm }");
edit('tests/unit/musicLookahead.test.ts','      const lane = targets[0]?.lane ?? snap.player.lane;',`      let lane = targets[0]?.lane ?? snap.player.lane;
      const clearance = Array.from({ length: cfg.lanes }, () => Infinity);
      for (const obstacle of snap.obstacles) {
        if (obstacle.broken || obstacle.kind === 'micro' || obstacle.z < -3) continue;
        clearance[obstacle.lane] = Math.min(clearance[obstacle.lane], (obstacle.z - (obstacle.zExtent ?? 3) / 2) / carTrafficScrollSpeed(snap.player.speed, obstacle.lane, cfg, obstacle));
      }
      if (clearance[lane] < 0.8 || clearance[snap.player.lane] < 0.8) {
        lane = clearance.reduce((best, value, i) => Math.abs(i - snap.player.lane) <= 1 && value > clearance[best] ? i : best, snap.player.lane);
      }`);
