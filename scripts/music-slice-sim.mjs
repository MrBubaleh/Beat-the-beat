import fs from 'node:fs';
const p='src/core/gameplay/GameSim.ts';
let s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
function edit(a,b){if(!s.includes(a))throw Error(a.slice(0,80));s=s.replace(a,b);}
edit("import { SfxEventQueue }", "import { encounterDistance, runEnvelope, MusicTimingMetrics, type MusicalPatternRequest, type MusicForecast } from './musicPlanning';\nimport type { MusicPlacementContext } from '../levelgen/musicPlacement';\nimport { SfxEventQueue }");
edit('export interface GameSimOptions {','export interface GameSimOptions {\n  musicPlanningEnabled?: boolean;');
edit('export interface GameSnapshot {',"export interface GameSnapshot {\n  musicTiming?: ReturnType<MusicTimingMetrics['snapshot']>;\n  runStage?: string;");
edit('  private pendingMusicScene: MusicSceneRequest | null = null;',`  private timingMetrics = new MusicTimingMetrics();
  private nextRhythmTime = 0;
  private lastRhythmBeat = -1;
  private rhythmSequence = 0;
  private rhythmTracked = new Map<number, { entity: CoinEntity | ObstacleEntity; contact: number; previousZ: number }>();
  private rhythmForecast: MusicForecast | null = null;
  private get rhythmEnabled(): boolean { return Boolean(this.opts.musicPlanningEnabled && this.opts.game.musicPlanning.enabled); }
  private pendingMusicScene: MusicSceneRequest | null = null;`);
edit('    const introCfg = this.opts.game.levelIntro;\n    const speeds = this.opts.game.speeds;',`    if (this.rhythmEnabled) {
      this.levelIntroActive = true;
      this.levelIntroElapsed = 0;
      return;
    }
    const introCfg = this.opts.game.levelIntro;
    const speeds = this.opts.game.speeds;`);
edit('    const music = this.opts.getMusic();',`    const music = this.opts.getMusic();
    this.rhythmForecast = this.rhythmEnabled ? music.forecast ?? null : null;
    const envelope = runEnvelope(this.opts.getTrackTime?.() ?? player.gameTime,
      this.opts.getTrackDuration?.() ?? 0, this.opts.game.musicPlanning.introSeconds);
    this.generator.setRunEnvelope(this.rhythmEnabled ? envelope : null);`);
edit('    if (music.beat.value) {',`    if (music.beat.value && (!this.rhythmEnabled || music.beat.audioTime !== this.lastRhythmBeat)) {
      this.lastRhythmBeat = music.beat.audioTime;`);
edit('    const speedMultiplier = numberOr(speedIntent?.value, 1);',`    const speedMultiplier = this.rhythmEnabled
      ? Math.min(envelope.speedIntentCap, numberOr(speedIntent?.value, 1))
      : numberOr(speedIntent?.value, 1);`);
edit('    this.ensureChunks();\n    this.syncTrackEndObstacles();',`    if (this.rhythmEnabled && this.rhythmForecast) this.scheduleRhythmPatterns(directorOutput.patterns ?? [], this.rhythmForecast);
    this.ensureChunks();
    this.syncTrackEndObstacles();`);
edit('    this.spawnPendingMusicPattern();\n    this.maybeSpawnMusicEcho(music);',`    if (!this.rhythmEnabled) {
      this.spawnPendingMusicPattern();
      this.maybeSpawnMusicEcho(music);
    }`);
edit('    if (player.damageState !== \'normal\') {',`    if (this.rhythmEnabled) this.measureRhythmEvents();
    if (player.damageState !== 'normal') {`);
edit('  restart(): void {\n    this.sfxEvents.reset();',`  restart(): void {
    this.timingMetrics = new MusicTimingMetrics();
    this.nextRhythmTime = 0;
    this.lastRhythmBeat = -1;
    this.rhythmSequence = 0;
    this.rhythmTracked.clear();
    this.rhythmForecast = null;
    this.sfxEvents.reset();`);
edit('    return {\n      player,\n      coinPickups,',`    return {
      musicTiming: this.rhythmEnabled ? this.timingMetrics.snapshot(this.opts.game.musicPlanning.hitWindowMs) : undefined,
      runStage: this.rhythmEnabled ? runEnvelope(this.opts.getTrackTime?.() ?? player.gameTime,
        this.opts.getTrackDuration?.() ?? 0).stage : undefined,
      player,
      coinPickups,`);
edit('    this.ensureChunks();\n    this.reconcileLevelIntroObstacle();',`    if (!this.rhythmEnabled) {
      this.ensureChunks();
      this.reconcileLevelIntroObstacle();
    }`);
edit('  private ensureChunks(): void {','  private ensureChunks(): void {\n    if (this.rhythmEnabled && !this.ghost && !this.rhythmForecast) return;');
edit('    this.updateRampAvailability(0, stagedObstacles, stagedRamps);',`    this.updateRampAvailability(0, stagedObstacles, stagedRamps);
    if (this.rhythmEnabled && player.mode === 'car') {
      stagedRamps.length = 0;
      this.generator.stageMusicBackground(this.obstacles, stagedObstacles, this.coins,
        this.ramps, this.rhythmPlacementContext());
    }`);
edit('    stagedObstacles.push(...opening.obstacles);',`    if (!this.rhythmEnabled) stagedObstacles.push(...opening.obstacles);`);
edit('  private requestMusicScene(\n', '  private requestMusicScene(\n');
edit('    if (this.musicSceneCooldown > 0 || this.pendingMusicScene !== null) return;', '    if (this.rhythmEnabled || this.musicSceneCooldown > 0 || this.pendingMusicScene !== null) return;');
edit('  private clearMusicPatternArea(minZ: number, maxZ: number): void {','  private clearMusicPatternArea(minZ: number, maxZ: number): void {\n    if (this.rhythmEnabled) return;');
edit('  private syncTrackEndObstacles(): void {','  private syncTrackEndObstacles(): void {\n    if (this.rhythmEnabled) return;');
edit('  private thinGroundCoinsForNitro(): void {','  private thinGroundCoinsForNitro(): void {\n    if (this.rhythmEnabled) return;');
edit('  private spawnPendingMusicPattern(): void {',`  private rhythmPlacementContext(): MusicPlacementContext {
    const player = this.playerSim.state;
    return { speed: Math.max(player.speed, this.opts.game.speeds.base),
      minSpeed: this.opts.game.speeds.min,
      maxSpeed: Math.max(player.speed, this.levelgen.fairness.referenceSpeed),
      entryLane: player.lane,
      envelope: runEnvelope(this.opts.getTrackTime?.() ?? player.gameTime,
        this.opts.getTrackDuration?.() ?? 0, this.opts.game.musicPlanning.introSeconds) };
  }

  private scheduleRhythmPatterns(requests: MusicalPatternRequest[], forecast: MusicForecast): void {
    const player = this.playerSim.state;
    if (this.ghost || player.mode !== 'car' || player.airState !== 'grounded') return;
    const cfg = this.opts.game.musicPlanning;
    const rate = Math.max(0.25, forecast.rate);
    const earliest = Math.max(this.nextRhythmTime, forecast.now + cfg.minLeadSeconds * rate);
    const duration = this.opts.getTrackDuration?.() ?? 0;
    const candidates = requests.filter(request => request.cue.time >= earliest &&
      request.cue.time <= forecast.now + cfg.maxLeadSeconds * rate &&
      (duration <= 0 || request.cue.time < duration - this.levelgen.trackEndObstacleStopSeconds));
    if (!candidates.length) return;
    const context = this.rhythmPlacementContext();
    const actionAllowed = earliest >= 5 && (this.rhythmSequence % 2 === 1 || candidates[0].kind === 'dodge');
    for (let attempt = 0; attempt < Math.min(3, candidates.length); attempt++) {
      const request = candidates[attempt];
      const accents = request.accents.filter((cue, i, all) => i === 0 || cue.time - all[i - 1].time >= 0.28 * rate).slice(0, 4);
      if (accents.length < 2) continue;
      for (const useAction of actionAllowed ? [true, false] : [false]) {
        const lanes = [player.lane, ...Array.from({ length: this.levelgen.lanes }, (_, lane) => lane)
          .filter(lane => lane !== player.lane).sort((a, b) => Math.abs(a - player.lane) - Math.abs(b - player.lane))];
        for (const lane of lanes) {
          const targetLane = useAction ? (lane < this.levelgen.lanes - 1 ? lane + 1 : lane - 1) : lane;
          const coins: CoinEntity[] = [];
          const obstacles: ObstacleEntity[] = [];
          const tracked: Array<{ entity: CoinEntity | ObstacleEntity; contact: number; previousZ: number }> = [];
          const speed = context.speed;
          const acceleration = this.opts.game.speeds.rampPerSecond * this.lastSpeedMultiplier;
          for (let i = 0; i < accents.length; i++) {
            const cue = accents[i];
            const pickupLane = useAction && i >= 2 ? targetLane : lane;
            const seconds = (cue.time - forecast.now) / rate;
            const micro = this.gameplayRules === 'destroy';
            const contact = micro
              ? (this.opts.game.obstacle.depth + this.opts.game.player.depth) / 2 - this.opts.game.hit.zGrace
              : this.opts.game.player.depth / 2 + this.opts.game.coin.collectGrace + this.opts.game.coin.radius;
            const z = encounterDistance(speed, acceleration, seconds, this.laneFlowFor(pickupLane), contact);
            const musicTarget = { time: cue.time, cueId: cue.id, confidence: cue.confidence, role: 'collect' as const };
            const entity: CoinEntity | ObstacleEntity = micro
              ? { id: this.nextMusicEntityId--, kind: 'micro', lane: pickupLane, z, routeGuide: true, musicTarget }
              : { id: this.nextMusicEntityId--, lane: pickupLane, z, y: this.levelgen.coinHeight, collected: false, routeKind: 'sceneGuide', musicTarget };
            if ('kind' in entity) obstacles.push(entity); else coins.push(entity);
            tracked.push({ entity, contact, previousZ: z });
          }
          if (useAction && accents.length >= 3) {
            const cue = accents[2];
            const z = encounterDistance(speed, acceleration, (cue.time - forecast.now) / rate, this.laneFlowFor(lane));
            const hazard: ObstacleEntity = { id: this.nextMusicEntityId--, kind: 'tall', lane, z,
              zExtent: this.opts.game.obstacle.tallDepth,
              musicTarget: { time: cue.time, cueId: cue.id, confidence: cue.confidence, role: 'dodge' } };
            obstacles.push(hazard);
            tracked.push({ entity: hazard, contact: 0, previousZ: z });
          }
          if (!this.generator.certifyMusicCandidate([...this.obstacles, ...obstacles], [...this.coins, ...coins], this.ramps, context)) continue;
          this.obstacles.push(...obstacles);
          this.coins.push(...coins);
          for (const entry of tracked) this.rhythmTracked.set(entry.entity.id, entry);
          this.timingMetrics.planned += tracked.length;
          if (attempt > 0) this.timingMetrics.shifted++;
          if (actionAllowed && !useAction) this.timingMetrics.simplified++;
          this.rhythmSequence++;
          this.nextRhythmTime = accents.at(-1)!.time + 0.35 * rate;
          return;
        }
      }
      this.timingMetrics.rejected++;
    }
    this.nextRhythmTime = candidates[0].cue.time + 0.3;
  }

  private measureRhythmEvents(): void {
    const now = this.rhythmForecast?.now ?? this.opts.getTrackTime?.() ?? 0;
    for (const [id, entry] of this.rhythmTracked) {
      const entity = entry.entity;
      const target = entity.musicTarget!;
      const collected = 'collected' in entity ? entity.collected : Boolean(entity.smashed && !entity.crushBroken);
      const passed = entity.z <= entry.contact;
      const expired = now > target.time + 12;
      if (!collected && !passed && !expired) { entry.previousZ = entity.z; continue; }
      const performed = target.role === 'dodge'
        ? passed && this.playerSim.state.lane !== entity.lane && !('broken' in entity && entity.broken)
        : collected;
      const relativeSpeed = carTrafficScrollSpeed(this.playerSim.state.speed, entity.lane, this.levelgen, entity);
      const crossing = now + Math.min(0, (entity.z - entry.contact) / relativeSpeed) * (this.rhythmForecast?.rate ?? 1);
      this.timingMetrics.record(crossing, target.time, performed, target.confidence >= this.opts.game.musicPlanning.confidenceThreshold);
      this.rhythmTracked.delete(id);
    }
  }

  private spawnPendingMusicPattern(): void {`);
fs.writeFileSync(p,s);
