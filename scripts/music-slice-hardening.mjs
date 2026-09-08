import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
edit('src/audio/AudioSession.ts','    this.clock?.restart();\n    this.analyzer?.restart();\n    this.setTutorialPlaybackScale(1);\n    await this.source.restart();', '    this.source.rewind();\n    this.clock?.restart();\n    this.analyzer?.restart();\n    this.setTutorialPlaybackScale(1);\n    await this.source.play();');
edit('src/core/gameplay/GameSim.ts','maxSpeed: Math.max(player.speed, this.levelgen.fairness.referenceSpeed),','maxSpeed: Math.max(player.speed, this.levelgen.fairness.referenceSpeed, this.opts.game.speeds.max * (1 + this.opts.game.skillMomentum.maxBonus)),');
edit('src/audio/rhythmAnalysis.ts',"const anchor = peaks.reduce((best, peak) => peak.strength > best.strength ? peak : best, peaks[0] ?? { time: offset, strength: 0 });",`  const phaseScore = (anchor: number): number => peaks.reduce((sum, peak) => {
    const nearest = Math.round((peak.time - anchor) / bestPeriod);
    const error = Math.abs(peak.time - anchor - nearest * bestPeriod);
    return sum + Math.sqrt(peak.strength) * Math.max(0, 1 - error / 0.085);
  }, 0);
  const anchor = peaks.reduce((best, peak) => phaseScore(peak.time) > phaseScore(best.time) ? peak : best, peaks[0] ?? { time: offset, strength: 0 });`);
edit('src/audio/rhythmAnalysis.ts','confidence: onGrid ? confidence : confidence * 0.4,','confidence: onGrid ? Math.max(confidence, Math.min(0.75, peak.strength)) : Math.min(0.7, peak.strength),');
