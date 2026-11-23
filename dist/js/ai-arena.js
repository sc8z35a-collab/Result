// Multi-Generation AI Arena Orchestrator (実験場 / Lab Head-to-Head Engine)
// Supports ALL 11 authentic AI generations in Result battling side-by-side in the same match:
//   RNV1 | NV1 | NV1.1 | NV1.2 | NV1.3 Pro | NV2 | NV2.1 SPY | NV2.3 | NV2.4 | NV2.5 | NV2.6 Force

import {NV1} from './nv1.js';
import {NV11} from './nv11.js';
import {NV12} from './nv12.js';
import {NV13Pro} from './nv13pro.js';
import {NV2} from './nv2.js';
import {RNV1} from './rnv1.js';

export const AI_VERSION_LIST = [
  {id: 'rnv1',    label: 'RNV1',        family: 'rnv1'},
  {id: 'human',   label: 'NV2.6 Force', family: 'nv2'},
  {id: 'humain',  label: 'NV2.5',       family: 'nv2'},
  {id: 'manusia', label: 'NV2.4',       family: 'nv2'},
  {id: 'nv23',    label: 'NV2.3',       family: 'nv2'},
  {id: 'nv21',    label: 'NV2.1 SPY',   family: 'nv2'},
  {id: 'classic', label: 'NV2',         family: 'nv2'},
  {id: 'nv13pro', label: 'NV1.3 Pro',   family: 'legacy'},
  {id: 'nv12',    label: 'NV1.2',       family: 'legacy'},
  {id: 'nv11',    label: 'NV1.1',       family: 'legacy'},
  {id: 'nv1',     label: 'NV1',         family: 'legacy'}
];

export const AI_VERSION_MAP = Object.fromEntries(AI_VERSION_LIST.map(v => [v.id, v]));

export function normalizeAiModelId(raw, fallback = 'human') {
  if (raw === 'RNV1' || raw === 'rnv1') return 'rnv1';
  if (raw === 'force' || raw === 'nv26') return 'human';
  if (raw === 'nv25') return 'humain';
  if (raw === 'nv24') return 'manusia';
  if (raw === 'nv2') return 'classic';
  if (typeof raw === 'string' && Object.hasOwn(AI_VERSION_MAP, raw)) return raw;
  return fallback;
}

export function aiVersionDisplay(id) {
  switch (normalizeAiModelId(id)) {
    case 'rnv1': return 'RNV1';
    case 'nv1': return 'NV1';
    case 'nv11': return 'NV1.1';
    case 'nv12': return 'NV1.2';
    case 'nv13pro': return 'NV1.3 Pro';
    case 'classic': return 'NV2';
    case 'nv21': return 'NV2.1';
    case 'nv23': return 'NV2.3 HUMAN';
    case 'manusia': return 'NV 2.4 Manusia';
    case 'humain': return 'NV2.5 humain';
    default: return 'NV2.6 Force';
  }
}

export function isLegacyAiId(id) {
  return AI_VERSION_MAP[normalizeAiModelId(id)]?.family === 'legacy';
}

export function isStandaloneAiId(id) {
  const fam = AI_VERSION_MAP[normalizeAiModelId(id)]?.family;
  return fam === 'legacy' || fam === 'rnv1';
}

function buildEngineForTeam(match, modelId, teamIdx) {
  const id = normalizeAiModelId(modelId);
  let eng;
  if (id === 'rnv1') eng = new RNV1(match);
  else if (id === 'nv1') eng = new NV1(match);
  else if (id === 'nv11') eng = new NV11(match);
  else if (id === 'nv12') eng = new NV12(match);
  else if (id === 'nv13pro') eng = new NV13Pro(match);
  else eng = new NV2(match);
  eng.teamFilter = teamIdx;
  return eng;
}

/**
 * Team-Partitioned Multi-Generation AI Composite:
 * Runs two independent authentic AI engines (one per team) on the same 360Hz Match
 * while exposing the unified NV2-compatible interface to Match, Renderer & Tests.
 */
export class ArenaCompositeAI {
  constructor(match, teamModels) {
    this.match = match;
    this.teamModels = [normalizeAiModelId(teamModels[0]), normalizeAiModelId(teamModels[1])];
    this.engines = [
      buildEngineForTeam(match, this.teamModels[0], 0),
      buildEngineForTeam(match, this.teamModels[1], 1)
    ];
    this.brains = new Map();
    this.version = `${aiVersionDisplay(this.teamModels[0])} vs ${aiVersionDisplay(this.teamModels[1])}`;
    this.metrics = this._mergedMetrics();
  }

  _mergedMetrics() {
    const out = {
      crouch: 0, jump: 0, scope: 0, peek: 0, intuition: 0, learning: 0,
      cover: 0, flank: 0, disengage: 0, ambush: 0, resupply: 0, evade: 0, focusFire: 0,
      beliefTrack: 0, commanderOrders: 0, suppress: 0, crossfire: 0,
      neuralInferences: 0, neuralUpdates: 0, lookaheadPlans: 0, npcShots: 0, npcHits: 0
    };
    for (const eng of this.engines) {
      if (!eng?.metrics) continue;
      for (const [k, v] of Object.entries(eng.metrics)) {
        if (typeof v === 'number') out[k] = (out[k] || 0) + v;
      }
    }
    return out;
  }

  attach(actor) {
    const eng = this.engines[actor.team];
    if (!eng) return;
    eng.attach(actor);
    const b = eng.brains.get(actor.id);
    if (b) this.brains.set(actor.id, b);
  }

  tick(dt) {
    this.engines[0].tick(dt);
    this.engines[1].tick(dt);
    this.metrics = this._mergedMetrics();
  }

  learn(actor, positive) {
    const eng = this.engines[actor?.team];
    eng?.learn?.(actor, positive);
  }

  onHit(v, owner, dir, power, shieldBreak) {
    if (v && !v.human) this.engines[v.team]?.onHit?.(v, owner, dir, power, shieldBreak);
    if (owner && !owner.human && owner.team !== v?.team) {
      this.engines[owner.team]?.onHit?.(v, owner, dir, power, shieldBreak);
    }
  }

  onKill(killer, victim) {
    for (const eng of this.engines) eng.onKill?.(killer, victim);
  }

  onReload(actor) {
    for (const eng of this.engines) eng.onReload?.(actor);
  }

  onTanker(actor, tk) {
    for (const eng of this.engines) eng.onTanker?.(actor, tk);
  }

  onShotFired(actor, source) {
    for (const eng of this.engines) {
      if (eng.onShotFired) eng.onShotFired(actor, source);
      else eng.sound?.(actor);
    }
  }

  onBulletWhiz(v, s, d) {
    if (v) this.engines[v.team]?.onBulletWhiz?.(v, s, d);
  }

  onEchoArrival(rep) {
    const listener = this.match.actors[rep?.listenerId];
    if (listener) this.engines[listener.team]?.onEchoArrival?.(rep);
  }

  onShafferCloak(actor) {
    for (const eng of this.engines) {
      if (eng.onShafferCloak) eng.onShafferCloak(actor);
      else if (actor) {
        // Legacy NV1/NV1.1/NV1.2/NV1.3 purge visual contact immediately on Shaffer cloak!
        for (const [id, b] of eng.brains) {
          const owner = this.match.actors[id];
          if (!owner || owner.team === actor.team) continue;
          if (b.targetId === actor.id) {
            b.targetId = -1;
            b.seen = null;
          }
          b.contacts?.delete?.(actor.id);
        }
      }
    }
  }

  onMatchEnd() {
    for (const eng of this.engines) eng.onMatchEnd?.();
  }

  issuePlayerSquadOrder(kind, a) {
    return this.engines[a?.team ?? 0]?.issuePlayerSquadOrder?.(kind, a) || null;
  }
}

export function createMatchAI(match) {
  const tm = match.teamAiModels;
  if (tm) {
    const m0 = normalizeAiModelId(tm[0]);
    const m1 = normalizeAiModelId(tm[1]);
    if (m0 === 'rnv1' && m1 === 'rnv1') return new RNV1(match);
    if (isStandaloneAiId(m0) || isStandaloneAiId(m1)) {
      return new ArenaCompositeAI(match, [m0, m1]);
    }
    return new NV2(match);
  }
  const single = normalizeAiModelId(match.aiModel);
  if (single === 'rnv1') return new RNV1(match);
  if (isLegacyAiId(single)) {
    return new ArenaCompositeAI(match, [single, single]);
  }
  return new NV2(match);
}
