// Multi-Generation AI Arena Orchestrator (実験場 / Lab Head-to-Head Engine)
// Supports ALL 10 authentic AI generations in Result battling side-by-side in the same match:
//   NV1 | NV1.1 | NV1.2 | NV1.3 Pro | NV2 | NV2.1 SPY | NV2.3 | NV2.4 | NV2.5 | NV2.6 Force

import {NV1} from './nv1.js';
import {NV11} from './nv11.js';
import {NV12} from './nv12.js';
import {NV13Pro} from './nv13pro.js';
import {NV2} from './nv2.js';
import {NVSuperSoldier, NVSS_VERSION} from './nvss.js';
import {NVGamerEngine, NVGAMER_VERSION} from './nvgamer-result.js';

export const AI_VERSION_LIST = [
  {id: 'nvgamer', label: 'NV Gamer (汎用30×)', family: 'nvgamer'},
  {id: 'nvss',    label: 'NV Super Soldier (NVSS)', family: 'nvss'},
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
  if (raw === 'nvgamer' || raw === 'gamer' || raw === 'nv_gamer') return 'nvgamer';
  if (raw === 'nvss' || raw === 'supersoldier' || raw === 'nv_ss') return 'nvss';
  if (raw === 'force' || raw === 'nv26') return 'human';
  if (raw === 'nv25') return 'humain';
  if (raw === 'nv24') return 'manusia';
  if (raw === 'nv2') return 'classic';
  if (typeof raw === 'string' && Object.hasOwn(AI_VERSION_MAP, raw)) return raw;
  return fallback;
}

export function aiVersionDisplay(id) {
  switch (normalizeAiModelId(id)) {
    case 'nvgamer': return NVGAMER_VERSION;
    case 'nvss': return NVSS_VERSION;
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

export function isNvssAiId(id) {
  return normalizeAiModelId(id) === 'nvss';
}

export function isNvGamerAiId(id) {
  return normalizeAiModelId(id) === 'nvgamer';
}

function buildEngineForTeam(match, modelId, teamIdx) {
  const id = normalizeAiModelId(modelId);
  let eng;
  if (id === 'nvgamer') eng = new NVGamerEngine(match);
  else if (id === 'nvss') eng = new NVSuperSoldier(match);
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

  _getReinforceEngine() {
    if (!this.reinforceEngine) {
      this.reinforceEngine = new NV2(this.match);
      this.reinforceEngine.teamAiTier = ['force', 'force'];
    }
    return this.reinforceEngine;
  }

  _allEngines() {
    return this.reinforceEngine ? [...this.engines, this.reinforceEngine] : this.engines;
  }

  attach(actor) {
    const eng = actor?.forceNv26 ? this._getReinforceEngine() : this.engines[actor.team];
    if (!eng) return;
    eng.attach(actor);
    const b = eng.brains.get(actor.id);
    if (b) this.brains.set(actor.id, b);
  }

  addActorBrain(actor, opts = null) {
    if (opts?.forceNV26) actor.forceNv26 = true;
    this.attach(actor);
  }

  tick(dt) {
    this.engines[0].tick(dt);
    this.engines[1].tick(dt);
    if (this.reinforceEngine) this.reinforceEngine.tick(dt);
    this.metrics = this._mergedMetrics();
  }

  learn(actor, positive) {
    const eng = actor?.forceNv26 ? this.reinforceEngine : this.engines[actor?.team];
    eng?.learn?.(actor, positive);
  }

  onHit(v, owner, dir, power, shieldBreak) {
    if (v && !v.human) (v.forceNv26 ? this.reinforceEngine : this.engines[v.team])?.onHit?.(v, owner, dir, power, shieldBreak);
    if (owner && !owner.human && owner.team !== v?.team) {
      (owner.forceNv26 ? this.reinforceEngine : this.engines[owner.team])?.onHit?.(v, owner, dir, power, shieldBreak);
    }
  }

  onKill(killer, victim) {
    for (const eng of this._allEngines()) eng.onKill?.(killer, victim);
  }

  onReload(actor) {
    for (const eng of this._allEngines()) eng.onReload?.(actor);
  }

  onTanker(actor, tk) {
    for (const eng of this._allEngines()) eng.onTanker?.(actor, tk);
  }

  onShotFired(actor, source) {
    for (const eng of this._allEngines()) {
      if (eng.onShotFired) eng.onShotFired(actor, source);
      else eng.sound?.(actor);
    }
  }

  onBulletWhiz(v, s, d) {
    if (v) (v.forceNv26 ? this.reinforceEngine : this.engines[v.team])?.onBulletWhiz?.(v, s, d);
  }

  onEchoArrival(rep) {
    const listener = this.match.actors[rep?.listenerId];
    if (listener) (listener.forceNv26 ? this.reinforceEngine : this.engines[listener.team])?.onEchoArrival?.(rep);
  }

  onShafferCloak(actor) {
    for (const eng of this._allEngines()) {
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
    for (const eng of this._allEngines()) eng.onMatchEnd?.();
  }

  issuePlayerSquadOrder(kind, a) {
    const r = this.engines[a?.team ?? 0]?.issuePlayerSquadOrder?.(kind, a) || null;
    const r2 = this.reinforceEngine?.issuePlayerSquadOrder?.(kind, a) || null;
    return r || r2;
  }
}

export function createMatchAI(match) {
  const tm = match.teamAiModels;
  if (tm) {
    if (isNvGamerAiId(tm[0]) && isNvGamerAiId(tm[1])) return new NVGamerEngine(match);
    if (isNvssAiId(tm[0]) && isNvssAiId(tm[1])) return new NVSuperSoldier(match);
    if (isLegacyAiId(tm[0]) || isLegacyAiId(tm[1]) || isNvssAiId(tm[0]) || isNvssAiId(tm[1]) || isNvGamerAiId(tm[0]) || isNvGamerAiId(tm[1])) {
      return new ArenaCompositeAI(match, tm);
    }
  }
  if (!tm && isNvGamerAiId(match.aiModel)) {
    return new NVGamerEngine(match);
  }
  if (!tm && isNvssAiId(match.aiModel)) {
    return new NVSuperSoldier(match);
  }
  if (!tm && isLegacyAiId(match.aiModel)) {
    return new ArenaCompositeAI(match, [match.aiModel, match.aiModel]);
  }
  return new NV2(match);
}
