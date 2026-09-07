#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/analyze-playtest.mjs <file.playtest.json|folder>');
  process.exit(1);
}

const sessions = loadSessions(input);
if (sessions.length === 0) {
  console.error('No .playtest.json files found');
  process.exit(1);
}

const report = buildReport(sessions);
const target = statSync(input).isDirectory()
  ? join(input, 'playtest-report.md')
  : `${input.replace(/\.playtest\.json$/i, '')}-report.md`;

writeFileSync(target, report, 'utf8');
console.log(`Wrote ${target}`);

function loadSessions(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(raw.sessions)) {
      return raw.sessions.map((data, index) => ({
        path: `${basename(path)}#${index + 1}`,
        data,
      }));
    }
    return [{ path, data: raw }];
  }
  return readdirSync(path)
    .filter((name) => name.endsWith('.playtest.json') || name.endsWith('.json'))
    .flatMap((name) => {
      const fullPath = join(path, name);
      const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
      if (Array.isArray(raw.sessions)) {
        return raw.sessions.map((data, index) => ({
          path: `${name}#${index + 1}`,
          data,
        }));
      }
      if (name.endsWith('.playtest.json')) {
        return [{ path: fullPath, data: raw }];
      }
      return [];
    });
}

function buildReport(sessions) {
  const lines = [];
  lines.push('# Playtest report');
  lines.push('');
  lines.push(`Sessions: **${sessions.length}**`);
  lines.push('');

  const totals = {
    hits: 0,
    unpassableHits: 0,
    deaths: 0,
    runs: sessions.length,
  };

  for (const { path, data } of sessions) {
    const track = data.track ?? {};
    const summary = data.summary ?? {};
    const session = data.session ?? {};
    const context = data.context ?? {};
    const survey = data.survey ?? {};
    totals.hits += summary.hits ?? 0;
    totals.unpassableHits += summary.unpassableHits ?? 0;
    if (session.endReason === 'death') totals.deaths += 1;

    lines.push(`## ${track.artist ? `${track.artist} — ${track.title}` : track.title || basename(path)}`);
    lines.push('');
    lines.push(`- File: \`${basename(path)}\``);
    lines.push(`- Search: \`${track.searchQuery ?? track.title ?? ''}\``);
    lines.push(`- Duration: ${formatSeconds(track.durationSeconds)} · run ${formatSeconds(session.durationSeconds)} · progress ${pct(session.songProgressEnd)}`);
    lines.push(`- End: **${session.endReason ?? '?'}** · seed ${session.seed ?? '?'}`);
    lines.push(`- Hits: ${summary.hits ?? 0} · unpassable hits: **${summary.unpassableHits ?? 0}** · max combo ${summary.maxCombo ?? 0}`);
    lines.push(
      `- Recovery: steps ${summary.recoverySteps ?? 0} · hits while wounded ${summary.hitsWhileDamaged ?? 0} · wounded ${formatSeconds(summary.woundedSeconds)}`,
    );
    lines.push(
      `- Modes: car ${formatSeconds(summary.carSeconds)} · horse ${formatSeconds(summary.horseSeconds)} · rocket ${formatSeconds(summary.rocketSeconds)} · train ${formatSeconds(summary.trainRideSeconds)}`,
    );
    lines.push(`- Music energy avg/max: ${num(summary.avgMusicEnergy)} / ${num(summary.maxMusicEnergy)}`);
    if (context.levelgenPreset) {
      lines.push(
        `- Context: build #${context.buildSeq ?? '?'} (${context.buildVersion ?? '?'}) · ${context.gameplayRules ?? '?'} · ${context.levelgenPreset} · fps avg/min/p10 ${num(context.fps?.avg)}/${num(context.fps?.min)}/${num(context.fps?.p10)}`,
      );
    }
    if (Object.keys(survey).length > 0) {
      lines.push(`- Survey: ${Object.entries(survey).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    lines.push('');

    const hits = (data.events ?? []).filter((event) => event.e === 'hit');
    if (hits.length > 0) {
      lines.push('### Hits');
      for (const hit of hits) {
        const obs = hit.obs
          ? `${hit.obs.source}:${hit.obs.kind}@L${hit.obs.lane}`
          : 'unknown';
        const pass = hit.passable?.passable ? 'ok' : `**${hit.passable?.reason ?? 'blocked'}**`;
        lines.push(
          `- t=${num(hit.t)}s p=${pct(hit.p)} mode=${hit.mode} dmg=${hit.dmg} obs=${obs} passable=${pass}`,
        );
      }
      lines.push('');
    }

    const recovery = (data.events ?? []).filter((event) => event.e === 'recovery_step');
    const chainHits = (data.events ?? []).filter((event) => event.e === 'hit_while_damaged');
    if (recovery.length > 0 || chainHits.length > 0) {
      lines.push('### Recovery');
      for (const step of recovery) {
        lines.push(
          `- recovery t=${num(step.t)}s p=${pct(step.p)} ${step.from}→${step.to} combo=${step.combo} clean=${num(step.cleanSeconds)}s`,
        );
      }
      for (const hit of chainHits) {
        lines.push(
          `- chain-hit t=${num(hit.t)}s p=${pct(hit.p)} ${hit.from}→${hit.to} mode=${hit.mode}`,
        );
      }
      lines.push('');
    }
  }

  lines.unshift(
    `- Totals: hits ${totals.hits}, unpassable hits **${totals.unpassableHits}**, deaths ${totals.deaths}/${totals.runs}`,
    '',
  );
  lines.splice(3, 0, '## Aggregate', '');

  return `${lines.join('\n')}\n`;
}

function formatSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?';
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function pct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?';
  return `${Math.round(value * 100)}%`;
}

function num(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?';
  return String(Math.round(value * 1000) / 1000);
}
