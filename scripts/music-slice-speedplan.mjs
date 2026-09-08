import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,80));fs.writeFileSync(p,s.replace(a,b));}
edit('src/core/director/DirectorStateMachine.ts','  reset(): void {',`  copyFrom(other: DirectorStateMachine): void {
    this._phase = other._phase;
    this._phaseElapsed = other._phaseElapsed;
    this.lastMajorEventAt = other.lastMajorEventAt;
    Object.assign(this.cooldownUntil, other.cooldownUntil);
  }

  reset(): void {`);
edit('src/core/director/types.ts','  patterns?: MusicalPatternRequest[];','  patterns?: MusicalPatternRequest[];\n  speedPlan?: readonly { time: number; value: number }[];');
edit('src/core/director/ActiveDirector.ts','  private sectionEnergy = 0.5;', '  private sectionEnergy = 0.5;\n  private speedPlan: { time: number; value: number }[] = [];\n  private speedPlanAt = -Infinity;');
edit('src/core/director/ActiveDirector.ts','    return { intents, phase:',`    if (music.forecast && music.forecast.now >= this.speedPlanAt + 0.5) {
      const preview = new ActiveDirector(this.config);
      preview.fsm.copyFrom(this.fsm);
      preview.sectionEnergy = this.sectionEnergy;
      this.speedPlan = [];
      const forecast = music.forecast;
      for (let after = 0.1; after <= 7; after += 0.1) {
        const time = forecast.now + after * forecast.rate;
        const energy = forecast.energy?.filter(frame => frame.time <= time).at(-1)?.value ?? Number(music.energy.value);
        const future = preview.update(0.1, now + after, { ...music, forecast: undefined, energy: { value: energy, audioTime: time } }, stress);
        this.speedPlan.push({ time, value: Number(future.intents.find(intent => intent.target === 'speed')?.value ?? 1) });
      }
      this.speedPlanAt = forecast.now;
    }
    return { intents, speedPlan: music.forecast ? this.speedPlan : undefined, phase:`);
edit('src/core/director/ActiveDirector.ts','    this.sectionEnergy = 0.5;','    this.sectionEnergy = 0.5;\n    this.speedPlan = [];\n    this.speedPlanAt = -Infinity;');
edit('src/core/gameplay/musicPlanning.ts', 'export interface MusicForecast {', 'export interface MusicForecast {\n  energy?: readonly { time: number; value: number }[];');
edit('src/core/gameplay/PlayerSim.ts', 'flow: number, speedMultiplier: number, smashTimes:', 'flow: number, speedMultiplier: number | ((seconds: number) => number), smashTimes:');
edit('src/core/gameplay/PlayerSim.ts', 'clone.update(dt, { laneDelta: 0, jump: false, nitro: false }, speedMultiplier);','clone.update(dt, { laneDelta: 0, jump: false, nitro: false }, typeof speedMultiplier === \'number\' ? speedMultiplier : speedMultiplier(elapsed + dt));');
edit('src/core/gameplay/GameSim.ts','  private rhythmForecast: MusicForecast | null = null;','  private rhythmForecast: MusicForecast | null = null;\n  private rhythmSpeedPlan: readonly { time: number; value: number }[] = [];');
edit('src/core/gameplay/GameSim.ts','    const phase = directorOutput.phase;','    this.rhythmSpeedPlan = directorOutput.speedPlan ?? [];\n    const phase = directorOutput.phase;');
edit('src/core/gameplay/GameSim.ts','this.lastSpeedMultiplier, smashTimes));',`seconds => {
              const time = forecast.now + seconds * rate;
              const desired = this.rhythmSpeedPlan.find(frame => frame.time >= time)?.value ?? this.lastSpeedMultiplier;
              return Math.min(desired, runEnvelope(time, duration, cfg.introSeconds).speedIntentCap);
            }, smashTimes));`);
