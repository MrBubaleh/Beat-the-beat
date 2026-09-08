import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
edit('src/audio/AudioSession.ts','    await this.analyzer!.start(this.graph!.musicBus, this.clock!);\n','');
edit('src/audio/AudioSession.ts','    this.clock = new AudioClock(this.source, this.config.latencyOffsetMs / 1000);\n    this.ensurePipeline();','    this.clock = new AudioClock(this.source, this.config.latencyOffsetMs / 1000);\n    this.ensurePipeline();\n    await this.analyzer!.start(this.graph!.musicBus, this.clock!);');
edit('src/audio/AudioWorkletAnalyzer.ts',"./analyzer-processor.worklet.ts?url", "./analyzer-processor.worklet.ts?worker&url");
edit('src/audio/AudioSession.ts','    this.source.rewind();\n    this.clock?.restart();','    this.source.rewind();\n    this.lookahead.restart();\n    this.clock?.restart();');
