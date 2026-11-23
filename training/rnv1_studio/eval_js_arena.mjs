#!/usr/bin/env node
// ============================================================================
// RNV1 Real-Engine 360Hz JS Arena Benchmark (Runs in Google Colab & Locally)
// ============================================================================
// Loads an exported `rnv1-weights.json` and pits RNV1 directly against Result's
// authentic AI generations inside the real 360Hz `dist/js/match.js` simulator!
//
// Usage:
//   node training/rnv1_studio/eval_js_arena.mjs --weights rnv1_outputs/rnv1-weights.json
// ============================================================================

import {readFile, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {Match} from '../../dist/js/match.js';
import {aiVersionDisplay} from '../../dist/js/ai-arena.js';
import {importRNV1WeightsJSON, getRNV1Status} from '../../dist/js/rnv1.js';

function parseArgs(argv) {
  const out = {
    weights: '',
    opponents: ['nv1', 'nv13pro', 'classic', 'nv21', 'humain', 'human'],
    teamSize: 3,
    matchesPerOpp: 2, // even number: equal South + North side swaps!
    secondsPerMatch: 45,
    gun: 'MS10',
    outJson: ''
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--weights') out.weights = argv[++i];
    else if (a === '--opponents') out.opponents = argv[++i].split(',').filter(Boolean);
    else if (a === '--team-size') out.teamSize = Number(argv[++i]) || 3;
    else if (a === '--matches') out.matchesPerOpp = Math.max(2, Number(argv[++i]) || 2);
    else if (a === '--seconds') out.secondsPerMatch = Number(argv[++i]) || 45;
    else if (a === '--gun') out.gun = argv[++i];
    else if (a === '--out') out.outJson = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);

if (args.weights) {
  const raw = await readFile(args.weights, 'utf8');
  const res = importRNV1WeightsJSON(raw, {persist: false, source: 'eval'});
  if (!res.ok) {
    console.error('Failed to load RNV1 weights:', res.error);
    process.exit(1);
  }
}

const status = getRNV1Status();
console.log('========================================================================');
console.log('  RNV1 Real-Engine 360Hz Harbor Range Arena Benchmark (dist/js/match.js)');
console.log('========================================================================');
console.log(`  Weights : ${status.trained ? 'TRAINED' : 'BOOTSTRAP'} | origin=${status.origin} | steps=${status.steps.toLocaleString()} | params=${status.paramCount.toLocaleString()} (H=${status.hiddenDim})`);
console.log(`  Format  : ${args.teamSize}v${args.teamSize} symmetric all-NPC | ${args.matchesPerOpp} side-swapped matches x ${args.secondsPerMatch}s | gun=${args.gun}`);
console.log('------------------------------------------------------------------------');

const DT = 1 / 60; // 60Hz integration of Match (6x faster benchmark than 360Hz while preserving 20Hz RNV1 cadence!)
const maxTicks = Math.round(args.secondsPerMatch / DT);
const results = [];

for (const oppId of args.opponents) {
  let rnvWins = 0, oppWins = 0, draws = 0;
  let rnvKills = 0, oppKills = 0, rnvShots = 0, rnvHits = 0;
  let tickMsTotal = 0, tickCount = 0;

  for (let g = 0; g < args.matchesPerOpp; g++) {
    const rnvTeam = g % 2; // 0 = South, 1 = North (100% fair side-swap!)
    const teamAAi = rnvTeam === 0 ? 'rnv1' : oppId;
    const teamBAi = rnvTeam === 1 ? 'rnv1' : oppId;

    const m = new Match({
      mode: 'lab',
      limit: 'points',
      multiplier: 5,
      lab: {
        playerRole: 'spectate',
        teamACount: args.teamSize,
        teamBCount: args.teamSize,
        teamAAi,
        teamBAi,
        teamAAA: 'off',
        teamBAA: 'off',
        teamAGun: args.gun,
        teamBGun: args.gun,
        npcSkills: true,
        aiLearning: false
      }
    });

    const t0 = performance.now();
    let ticks = 0;
    for (let s = 0; s < maxTicks && !m.ended; s++) {
      m.step(DT, {});
      ticks++;
    }
    tickMsTotal += performance.now() - t0;
    tickCount += ticks;

    const rScore = m.scores[rnvTeam];
    const oScore = m.scores[1 - rnvTeam];
    rnvKills += rScore;
    oppKills += oScore;
    if (rScore > oScore) rnvWins++;
    else if (oScore > rScore) oppWins++;
    else draws++;

    const tel = m.telemetry.getSummary();
    const rTel = rnvTeam === 0 ? tel.teamA : tel.teamB;
    rnvShots += rTel.shots;
    rnvHits += rTel.hits;
  }

  const row = {
    opponent: oppId,
    opponentLabel: aiVersionDisplay(oppId),
    rnvWins,
    oppWins,
    draws,
    winRatePct: Math.round((rnvWins / args.matchesPerOpp) * 1000) / 10,
    rnvKills,
    oppKills,
    kd: Math.round((rnvKills / Math.max(1, oppKills)) * 100) / 100,
    accPct: Math.round((rnvHits / Math.max(1, rnvShots)) * 1000) / 10,
    msPerTick: Math.round((tickMsTotal / Math.max(1, tickCount)) * 1000) / 1000
  };
  results.push(row);
  console.log(
    `  vs ${row.opponentLabel.padEnd(15)} | W-L-D: ${row.rnvWins}-${row.oppWins}-${row.draws} (${String(row.winRatePct).padStart(5)}%) | ` +
    `Kills ${String(row.rnvKills).padStart(3)}:${String(row.oppKills).padEnd(3)} (K/D ${row.kd.toFixed(2)}) | ` +
    `Acc ${String(row.accPct).padStart(5)}% | ${row.msPerTick.toFixed(3)} ms/tick`
  );
}

console.log('========================================================================');

if (args.outJson) {
  await writeFile(args.outJson, JSON.stringify({status, args, results}, null, 2), 'utf8');
  console.log('Saved JS arena benchmark JSON ->', args.outJson);
}
