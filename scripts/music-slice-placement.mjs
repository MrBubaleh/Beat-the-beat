import fs from 'node:fs';
function edit(path, from, to) { const s=fs.readFileSync(path,'utf8').replaceAll('\r\n','\n'); if(!s.includes(from)) throw Error(path+': '+from.slice(0,60)); fs.writeFileSync(path,s.replace(from,to)); }
edit('src/core/levelgen/types.ts','export interface ObstacleEntity {','export interface ObstacleEntity {\n  musicTarget?: MusicTarget;');
edit('src/core/levelgen/types.ts','export interface CoinEntity {','export interface CoinEntity {\n  musicTarget?: MusicTarget;');
fs.appendFileSync('src/core/levelgen/types.ts', `\nexport interface MusicTarget {\n  time: number;\n  cueId: number;\n  confidence: number;\n  role: 'collect' | 'dodge';\n}\n`);
edit('src/core/levelgen/passability.ts','export interface ComfortableCarRouteOptions {','export interface ComfortableCarRouteOptions {\n  requiredWaypoints?: readonly { time: number; lane: number; z: number }[];');
edit('src/core/levelgen/passability.ts','  const orderedEvents = [...events.values()].sort((a, b) => a.row - b.row);',`  for (const waypoint of options.requiredWaypoints ?? []) {
    ensureEvent(Math.round(waypoint.time / timeStep), waypoint.z).requiredLanes.add(waypoint.lane);
  }
  const orderedEvents = [...events.values()].sort((a, b) => a.row - b.row);`);
edit('src/core/levelgen/LevelGenerator.ts',"import { lateRunProgress, lateSongEaseFactor, scaleTowardEnd } from './difficulty';",`import { lateRunProgress, lateSongEaseFactor, scaleTowardEnd } from './difficulty';
import { certifyMusicPlacement, withinRunEnvelope, type MusicPlacementContext } from './musicPlacement';
import type { RunEnvelope } from '../gameplay/musicPlanning';`);
edit('src/core/levelgen/LevelGenerator.ts','export class LevelGenerator {',`export class LevelGenerator {
  private runEnvelope: RunEnvelope | null = null;

  setRunEnvelope(envelope: RunEnvelope | null): void { this.runEnvelope = envelope; }

  certifyMusicCandidate(obstacles: ObstacleEntity[], coins: CoinEntity[], ramps: RampEntity[], context: MusicPlacementContext): boolean {
    return withinRunEnvelope(obstacles, this.config, context) &&
      certifyMusicPlacement(obstacles, coins, ramps, this.config, context);
  }

  stageMusicBackground(published: ObstacleEntity[], staged: ObstacleEntity[], coins: CoinEntity[], ramps: RampEntity[], context: MusicPlacementContext): void {
    const accepted = [...published];
    const kept: ObstacleEntity[] = [];
    for (const obstacle of staged) {
      if (obstacle.redWall || obstacle.nitroMandatory) continue;
      const candidate = [...accepted, obstacle];
      if (!this.certifyMusicCandidate(candidate, coins, ramps, context)) continue;
      kept.push(obstacle);
      accepted.push(obstacle);
    }
    staged.splice(0, staged.length, ...kept);
  }
`);
edit('src/core/levelgen/LevelGenerator.ts','    return clamp(density, this.config.densityRange[0], this.config.densityRange[1]);',`    const capped = clamp(density, this.config.densityRange[0], this.config.densityRange[1]);
    return this.runEnvelope ? Math.min(capped, this.runEnvelope.densityCap) : capped;`);
