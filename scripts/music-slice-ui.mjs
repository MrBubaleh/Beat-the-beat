import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,80));fs.writeFileSync(p,s.replace(a,b));}
edit('src/audio/AudioSession.ts',"forecast.cues.findLast(c => c.time <= now && now - c.time < 0.09)","forecast.cues.filter(c => c.time <= now && now - c.time < 0.09).at(-1)");
edit('src/audio/AudioSession.ts','const beat = this.isPlaying && cue !== undefined && cue.id !== this.lastCueId;','const beat = this.isPlaying && cue !== undefined;');
edit('src/audio/AudioSession.ts','  private lastCueId = -1;','');
edit('src/audio/AudioSession.ts','    this.lastCueId = -1;','    this.lookahead.restart();');
edit('src/audio/AudioSession.ts','    if (beat) this.lastCueId = cue.id;','');
edit('src/audio/AudioSession.ts',"this.clock = new AudioClock({ get currentTime() { return 0; } }, this.config.latencyOffsetMs / 1000);","this.clock = new AudioClock(this.ctx, this.config.latencyOffsetMs / 1000);");
edit('src/app/bootstrap.ts','  const sim = new GameSim({',`  const musicPlanningEnabled = resolvedGameCfg.musicPlanning.enabled && new URLSearchParams(location.search).get('music') !== 'legacy';
  audio.configureMusicPlanning({ ...resolvedGameCfg.musicPlanning, enabled: musicPlanningEnabled });
  const requestedSeed = new URLSearchParams(location.search).get('seed');
  const sim = new GameSim({
    musicPlanningEnabled,
    seed: requestedSeed !== null && /^\\d+$/.test(requestedSeed) ? Number(requestedSeed) >>> 0 : undefined,`);
edit('src/app/bootstrap.ts',"    onLoadStart: () => {\n      if (mainMenu.isOpen) mainMenu.setBusy(true, 'загрузка…');", "    onLoadStart: () => {\n      enterMenu();\n      mainMenu.setBusy(true, 'Загружаем трек…');");
edit('src/app/bootstrap.ts','  const loop = new GameLoop({',`  audio.onPreparationProgress = message => { if (mainMenu.isOpen) mainMenu.setBusy(true, message); };
  const loop = new GameLoop({`);
edit('src/app/bootstrap.ts',"    fixedUpdate: (dt) => {\n      if (!playback",`    fixedUpdate: (dt) => {
      if (musicPlanningEnabled && runPhase === 'countdown' && !sim.isLevelIntroActive()) return;
      if (!playback`);
edit('src/app/bootstrap.ts','        if (elapsed >= introCfg.musicDelaySeconds && !introMusicStarted) {', '        if (!musicPlanningEnabled && elapsed >= introCfg.musicDelaySeconds && !introMusicStarted) {');
edit('src/app/bootstrap.ts',"        if (elapsed >= introCfg.countdownSeconds) {\n          runPhase = 'running';",`        if (musicPlanningEnabled && elapsed >= introCfg.countdownSeconds && !introMusicStarted) {
          introMusicStarted = true;
          const sequence = countdownSequence;
          void audio.play().then(() => {
            if (sequence !== countdownSequence || runPhase !== 'countdown') return;
            runPhase = 'running';
            beginPlaytestRecording();
            fpsTracker.reset();
            audioControls.setStatus('playing');
            hud.showCountdown(null);
          }).catch(() => {
            if (sequence !== countdownSequence) return;
            enterMenu();
            mainMenu.setError('Нажмите на трек ещё раз, чтобы разрешить воспроизведение');
          });
        }
        if (!musicPlanningEnabled && elapsed >= introCfg.countdownSeconds) {
          runPhase = 'running';`);
edit('src/ui/MainMenu.ts',"    this.statusEl.className = 'menu-status';", "    this.statusEl.className = 'menu-status';\n    this.statusEl.setAttribute('role', 'status');\n    this.statusEl.setAttribute('aria-live', 'polite');");
edit('src/ui/MainMenu.ts','    this.busy = busy;','    this.busy = busy;\n    this.root.classList.toggle(\'is-preparing\', busy);');
edit('src/ui/MainMenu.ts',"    this.statusEl.classList.toggle('is-error', true);", "    this.statusEl.classList.toggle('is-error', true);\n    this.root.classList.remove('is-preparing');");
edit('src/ui/MainMenu.ts',"    this.root.style.display = 'none';", "    this.root.classList.remove('is-preparing');\n    this.root.style.display = 'none';");
fs.appendFileSync('src/ui/shell.css', `\n.menu-root.is-preparing .menu-status::before {
  content: ''; display: inline-block; width: 14px; height: 14px; margin-right: 10px;
  border: 2px solid #ffffff30; border-top-color: #55e9e2; border-radius: 50%;
  vertical-align: middle; animation: rhythm-loading 0.85s linear infinite;
}
@keyframes rhythm-loading { to { transform: rotate(360deg); } }
`);
