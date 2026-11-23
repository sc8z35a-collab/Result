#!/usr/bin/env node
// Real-Engine 360Hz Arena Gauntlet for NV 3 Sentient Human NPC!
// Loads an exported `nv3-weights.json` into `dist/js/nv3.js` and battles inside
// the REAL Result `dist/js/match.js` 360Hz engine against NV2.6 Force, RNV1 FAST, NV2.5, NV2.1 SPY, NV2, NV1.

import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Match} from '../../dist/js/match.js';
import {importNV3WeightsJSON, getNV3Status} from '../../dist/js/nv3.js';
import {aiVersionDisplay} from '../../dist/js/ai-arena.js';

function parseArgs(argv) {
  const out = {
    weights: null,
    opponents: ['human', 'rnv1', 'humain', 'nv21', 'classic', 'nv1'],
    matches: 4,
    seconds: 40,
    teamSize: 3,
    weapon: 'ms10'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--weights' && argv[i + 1]) out.weights = argv[++i];
    else if (a === '--opponents' && argv[i + 1]) out.opponents = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--matches' && argv[i + 1]) out.matches = Math.max(1, Number(argv[++i]) || 4);
    else if (a === '--seconds' && argv[i + 1]) out.seconds = Math.max(5, Number(argv[++i]) || 40);
    else if (a === '--team-size' && argv[i + 1]) out.teamSize = Math.max(1, Math.min(5, Number(argv[++i]) || 3));
    else if (a === '--weapon' && argv[i + 1]) out.weapon = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.weights) {
  const raw = fs.readFileSync(path.resolve(args.weights), 'utf8');
  const res = importNV3WeightsJSON(raw, false);
  if (!res.ok) {
    console.error(`[NV 3 Arena] Failed to load weights ${args.weights}: ${res.error}`);
    process.exit(1);
  }
}

const st = getNV3Status();
console.log('='.repeat(88));
console.log(` NV 3 REAL-ENGINE 360Hz ARENA GAUNTLET`);
console.log(` Weights : ${args.weights || 'bundled'} | trained=${st.trained} | params=${st.paramCount.toLocaleString()} | steps=${st.steps.toLocaleString()}`);
console.log(` Format  : ${args.teamSize}v${args.teamSize} | ${args.matches} matches/opponent | ${args.seconds}s/match | weapon=${args.weapon}`);
console.log('='.repeat(88));

const dt = 1 / 60;
const results = [];

for (const opp of args.opponents) {
  let wins = 0, losses = 0, draws = 0;
  let kills = 0, deaths = 0, shots = 0, hits = 0;
  let gestures = 0, breaths = 0, voices = 0;
  let tickMsTotal = 0, tickCount = 0;

  for (let mIdx = 0; mIdx < args.matches; mIdx++) {
    const swap = (mIdx % 2) === 1;
    const teamAAi = swap ? opp : 'nv3';
    const teamBAi = swap ? 'nv3' : opp;
    const nv3Team = swap ? 1 : 0;
    const gun = args.weapon.toUpperCase();
    const match = new Match({
      mode: 'lab',
      limit: 'points',
      multiplier: 5,
      lab: {
        playerRole: 'spectate',
        teamACount: args.teamSize,
        teamBCount: args.teamSize,
        teamAAi,
        teamBAi,
        teamAGun: gun,
        teamBGun: gun,
        npcSkills: true
      }
    });

    const maxTicks = Math.round(args.seconds / dt);
    const t0 = performance.now();
    let ticks = 0;
    for (; ticks < maxTicks && !match.over; ticks++) {
      match.step(dt, {});
    }
    tickMsTotal += (performance.now() - t0);
    tickCount += ticks;

    const sNv3 = match.scores?.[nv3Team] || 0;
    const sOpp = match.scores?.[1 - nv3Team] || 0;
    if (sNv3 > sOpp) wins++;
    else if (sNv3 < sOpp) losses++;
    else draws++;

    for (const a of match.actors) {
      if (a.team === nv3Team) {
        kills += a.kills || 0;
        deaths += a.deaths || 0;
      }
    }
    const nv3Eng = match.nv?.engines ? match.nv.engines[nv3Team] : match.nv;
    if (nv3Eng?.metrics) {
      shots += nv3Eng.metrics.npcShots || 0;
      hits += nv3Eng.metrics.npcHits || 0;
      gestures += nv3Eng.metrics.nv3Gestures || 0;
      breaths += nv3Eng.metrics.nv3Breaths || 0;
      voices += nv3Eng.metrics.nv3VoiceSignals || 0;
    }
  }

  const kd = kills / Math.max(1, deaths);
  const acc = hits / Math.max(1, shots) * 100;
  const msPerTick = tickMsTotal / Math.max(1, tickCount);
  const wr = (wins + 0.5 * draws) / args.matches * 100;
  const label = aiVersionDisplay(opp);
  results.push({opp, label, wins, losses, draws, wr, kills, deaths, kd, acc, gestures, breaths, voices, msPerTick});
  console.log(
    ` vs ${label.padEnd(13)} | W-L-D ${wins}-${losses}-${draws} (${wr.toFixed(1).padStart(5)}%) ` +
    `| K/D ${kills}:${deaths} (${kd.toFixed(2)}) | Acc ${acc.toFixed(1).padStart(5)}% ` +
    `| Gest=${String(gestures).padStart(3)} Voice=${String(voices).padStart(3)} Breath=${String(breaths).padStart(2)} | ${msPerTick.toFixed(2)}ms/tick`
  );
}
console.log('='.repeat(88));
