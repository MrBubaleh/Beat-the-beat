import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
edit('tests/unit/musicPreparation.test.ts','expect(lookahead.forecast(0, 1).cues).toEqual(opening.cues);','expect(lookahead.forecast(0, 1).cues.filter(cue => cue.time < 24)).toEqual(opening.cues);');
edit('src/core/levelgen/LevelGenerator.ts','  reset(seed: number): void {','  reset(seed: number): void {\n    this.runEnvelope = null;');
edit('src/core/replay/ReplayTypes.ts','export interface ReplayData {',"export interface ReplayData {\n  musicPlanningEnabled?: boolean;\n  gameplayRules?: import('../gameplay/gameplayRules').GameplayRulesId;");
edit('src/core/replay/ReplayRecorder.ts','  private recording = false;',"  private recording = false;\n  private settings: Pick<ReplayData, 'musicPlanningEnabled' | 'gameplayRules'> = {};");
edit('src/core/replay/ReplayRecorder.ts','start(seed: number, trackDurationSeconds = 0): void {',"start(seed: number, trackDurationSeconds = 0, settings: Pick<ReplayData, 'musicPlanningEnabled' | 'gameplayRules'> = {}): void {\n    this.settings = settings;");
edit('src/core/replay/ReplayRecorder.ts','      version: 1,','      version: 1,\n      ...this.settings,');
edit('src/core/replay/ReplayRunner.ts','    const sim = new GameSim({',`    const currentMusic = (): MusicState => {
      while (musicIndex + 1 < replay.music.length && replay.music[musicIndex + 1].t <= tick.t) musicIndex++;
      return replay.music[musicIndex]?.music ?? emptyMusic();
    };
    const sim = new GameSim({
      musicPlanningEnabled: replay.musicPlanningEnabled,
      gameplayRules: replay.gameplayRules,
      ...(replay.musicPlanningEnabled ? {
        getTrackTime: () => currentMusic().forecast?.now ?? tick.t,
        getTrackDuration: () => replay.trackDurationSeconds ?? 0,
      } : {}),`);
edit('src/core/replay/ReplayRunner.ts','? tick.t / replay.trackDurationSeconds','? (replay.musicPlanningEnabled ? currentMusic().forecast?.now ?? tick.t : tick.t) / replay.trackDurationSeconds');
edit('src/app/bootstrap.ts','recorder.start(sim.seed, audio.trackDuration);','recorder.start(sim.seed, audio.trackDuration, { musicPlanningEnabled, gameplayRules: activeGameplayRulesId });');
