import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,80));fs.writeFileSync(p,s.replace(a,b));}
edit('src/core/gameplay/PlayerSim.ts','  update(dt: number, input: ConsumedInput, speedMultiplier: number): LandingResult | null {',`  predictTravel(times: readonly number[], flow: number, speedMultiplier: number, smashTimes: readonly number[] = []): number[] {
    const clone = new PlayerSim(this.cfg, this.startLane);
    Object.assign(clone, this, { state: { ...this.state }, skillMomentumState: { ...this.skillMomentumState } });
    const distances: number[] = [];
    let elapsed = 0;
    let distance = 0;
    let smash = 0;
    for (const target of times) {
      while (elapsed < target - 1e-8) {
        const dt = Math.min(1 / 60, target - elapsed);
        clone.state.gameOver = false;
        clone.update(dt, { laneDelta: 0, jump: false, nitro: false }, speedMultiplier);
        distance += Math.max(0.5, clone.state.speed + flow) * dt;
        elapsed += dt;
        while (smash < smashTimes.length && smashTimes[smash] <= elapsed) {
          const cfg = this.cfg.destroy;
          const early = 1 - clamp((clone.state.gameTime - cfg.earlyGreenSmashFullSeconds) / cfg.earlyGreenSmashFadeSeconds, 0, 1);
          clone.applyGreenSmashSpeedBonus(cfg.greenSmashSpeedBonus * (1 + (cfg.earlyGreenSmashSpeedScale - 1) * early));
          smash++;
        }
      }
      distances.push(distance);
    }
    return distances;
  }

  update(dt: number, input: ConsumedInput, speedMultiplier: number): LandingResult | null {`);
edit('src/core/gameplay/GameSim.ts','    const effectiveMultiplier = speedMultiplier * this.updateTurbo(dt, music);',`    const turboMultiplier = this.updateTurbo(dt, music);
    const effectiveMultiplier = speedMultiplier * (this.rhythmEnabled ? 1 : turboMultiplier);`);
edit('src/core/gameplay/GameSim.ts','          const acceleration = this.opts.game.speeds.rampPerSecond * this.lastSpeedMultiplier;',`          const times = accents.map(cue => (cue.time - forecast.now) / rate);
          const smashTimes = this.gameplayRules === 'destroy' ? [...this.rhythmTracked.values()
            .filter(entry => 'kind' in entry.entity && entry.entity.kind === 'micro')
            .map(entry => (entry.entity.musicTarget!.time - forecast.now) / rate), ...times]
            .filter(time => time > 0).sort((a, b) => a - b) : [];
          const travel = Array.from({ length: this.levelgen.lanes }, (_, lane) =>
            this.playerSim.predictTravel(times, this.laneFlowFor(lane), this.lastSpeedMultiplier, smashTimes));`);
edit('src/core/gameplay/GameSim.ts','            const seconds = (cue.time - forecast.now) / rate;','');
edit('src/core/gameplay/GameSim.ts','const z = encounterDistance(speed, acceleration, seconds, this.laneFlowFor(pickupLane), contact);','const z = travel[pickupLane][i] + contact;');
edit('src/core/gameplay/GameSim.ts','const z = encounterDistance(speed, acceleration, (cue.time - forecast.now) / rate, this.laneFlowFor(lane));','const z = travel[lane][2];');
edit('src/core/gameplay/GameSim.ts','          const speed = context.speed;','');
edit('src/core/gameplay/GameSim.ts','import { encounterDistance, runEnvelope,','import { runEnvelope,');
