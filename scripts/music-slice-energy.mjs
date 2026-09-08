import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
edit('src/core/gameplay/GameSim.ts',"[...this.rhythmTracked.values()\n            .filter", "[...[...this.rhythmTracked.values()]\n            .filter");
edit('src/audio/rhythmAnalysis.ts','  cues: MusicCue[];','  cues: MusicCue[];\n  energy: { time: number; value: number }[];');
edit('src/audio/rhythmAnalysis.ts','  return { cues, period: bestPeriod, confidence };',`  const sorted = [...envelope].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
  const ceiling = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const energy: { time: number; value: number }[] = [];
  for (let i = 0; i < envelope.length; i += 25) {
    const rms = envelope.slice(i, i + 25).reduce((sum, value) => sum + value, 0) / Math.min(25, envelope.length - i);
    const value = ceiling < 0.0001 ? 0 : ceiling - floor < 0.0001 ? 0.5 : Math.min(1, Math.max(0, (rms - floor) / (ceiling - floor)));
    energy.push({ time: offset + i * hop / sampleRate, value });
  }
  return { cues, energy, period: bestPeriod, confidence };`);
edit('src/audio/MusicLookahead.ts','  private cues: MusicCue[] = [];','  private cues: MusicCue[] = [];\n  private energy: { time: number; value: number }[] = [];\n  private initialEnergy: { time: number; value: number }[] = [];');
edit('src/audio/MusicLookahead.ts','until: number; serial: number }>','until: number; serial: number; energy: { time: number; value: number }[] }>');
edit('src/audio/MusicLookahead.ts','            this.until = event.data.until;','            this.energy.push(...event.data.energy.filter(frame => frame.time >= this.until));\n            this.until = event.data.until;');
edit('src/audio/MusicLookahead.ts','this.initialCues = [...this.cues];','this.initialCues = [...this.cues]; this.initialEnergy = [...this.energy];');
edit('src/audio/MusicLookahead.ts','    this.cues = this.cues.filter(cue => cue.time >= now - 2);','    this.cues = this.cues.filter(cue => cue.time >= now - 2);\n    this.energy = this.energy.filter(frame => frame.time >= now - 2);');
edit('src/audio/MusicLookahead.ts',"return { now, availableUntil: this.until, source: 'decoded', rate,", "return { now, availableUntil: this.until, source: 'decoded', rate,\n      energy: this.energy.filter(frame => frame.time >= now - 0.5 && frame.time <= now + this.config.lookaheadSeconds),");
edit('src/audio/MusicLookahead.ts','    this.cues = [...this.initialCues];','    this.cues = [...this.initialCues];\n    this.energy = [...this.initialEnergy];');
edit('src/audio/MusicLookahead.ts','    this.initialCues = [];','    this.initialCues = [];\n    this.energy = [];\n    this.initialEnergy = [];');
edit('src/audio/AudioSession.ts','    return { ...live, audioTime: now, forecast,','    return { ...live, audioTime: now, forecast,\n      energy: { value: forecast.energy?.filter(frame => frame.time <= now).at(-1)?.value ?? live.energy.value, audioTime: now },');
edit('src/core/gameplay/GameSim.ts','  runStage?: string;','  runStage?: string;\n  musicAnalysis?: string;');
edit('src/core/gameplay/GameSim.ts','      musicTiming: this.rhythmEnabled ?', '      musicAnalysis: this.rhythmForecast?.source,\n      musicTiming: this.rhythmEnabled ?');
edit('src/app/bootstrap.ts','        musicScene: snapshot.musicScene','        musicScene: snapshot.musicTiming ? `${snapshot.runStage} ${snapshot.musicAnalysis} planned ${snapshot.musicTiming.planned} rejected ${snapshot.musicTiming.rejected} hit ${Math.round((snapshot.musicTiming.hitShare ?? 0) * 100)}% median ${snapshot.musicTiming.medianMs?.toFixed(0) ?? \'—\'}ms p95 ${snapshot.musicTiming.p95Ms?.toFixed(0) ?? \'—\'}ms` : snapshot.musicScene');
