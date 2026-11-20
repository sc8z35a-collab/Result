// NV-Synapse 1.0 — Real-Time 12-Dim Player Behavioral Twin, Online Sector Markov Predictor & Counter-Playbook Compiler.
//
// 100% Fair-Play Cognitive Adversary Modeling:
//   - NEVER queries hidden human player positions! Updates strictly from observed enemy visual sightings,
//     arrived EchoPulse acoustic detections, observed reloads, and observed Supply Tanker captures.
//   - Constructs a live 12-Dimensional Behavioral Fingerprint of the human player's personal habits:
//       (lane affinity West/Center/East, range preference CQB/Mid/Long, peek-side chirality Left vs Right,
//        strafe-reversal chaos, crouch-duel frequency, reload timing greed, tanker affinity, push aggression).
//   - Maintains an online Dirichlet-smoothed 12x12 Continuous-Time Sector Markov Transition Matrix
//     P(Z_next | Z_cur) across Harbor Range's 12 tactical zones (3 lanes x 4 depth bands) to predict
//     WHERE the human player will rotate next!
//   - Dynamically compiles a Counter-Playbook Directive feeding directly into NV2StrategyTree & NV2.1 Spy
//     synchronized flanking, and persists learned rivalry memory across matches in localStorage.

import {clamp} from './geometry.js';

export const SYNAPSE_VERSION = 'NV-Synapse 1.0';
export const SYNAPSE_STORAGE_KEY = 'result.synapse.v1';

const NUM_ZONES = 12; // 3 lanes (West=0, Center=1, East=2) x 4 depth bands (South=0 .. North=3)

export const ARCHETYPE_LABELS = {
  ADAPTIVE_HYBRID: {ja: '適応バランス型', counterJa: 'NV2 統合戦術シフト'},
  WEST_FLANKER: {ja: '西岸フランカー型', counterJa: '西埠頭クロスファイア封鎖'},
  EAST_FLANKER: {ja: '東コンテナ裏どり型', counterJa: '東レーン挟撃＆逆サイド裏どり'},
  CQB_RUSHER: {ja: '近距離アグレッシブ突撃型', counterJa: '距離確保＋後退キルゾーン罠'},
  LONG_SNIPER: {ja: '遠距離精密ライン支配型', counterJa: '遮蔽連携＋同期ピンサー詰め'},
  TANKER_HUNTER: {ja: '補給タンカー制圧型', counterJa: 'タンカー周囲アンブッシュ展開'},
  RELOAD_PUNISH_TARGET: {ja: '高頻度リロード型', counterJa: '装填音検知・即時ラッシュ奇襲'}
};

/** Maps world (x, z) into one of Harbor Range's 12 tactical sectors (3 lanes x 4 depth bands). */
export function sectorOf(x, z) {
  const lane = x < -7.5 ? 0 : x > 7.5 ? 2 : 1;
  // z runs from +100 (south ally spawn) to -100 (north enemy spawn)
  const band = clamp(Math.floor((100 - z) / 50), 0, 3);
  return band * 3 + lane;
}

export function sectorCenter(zone) {
  const zId = clamp(zone | 0, 0, NUM_ZONES - 1);
  const band = Math.floor(zId / 3);
  const lane = zId % 3;
  const x = lane === 0 ? -15 : lane === 2 ? 15 : 0;
  const z = 75 - band * 50;
  return [x, z];
}

export class SynapseProfiler {
  constructor() {
    this.version = SYNAPSE_VERSION;
    // 12-Dimensional Behavioral Fingerprint
    this.fp = {
      laneWest: 0.33,
      laneCenter: 0.34,
      laneEast: 0.33,
      rangeCQB: 0.33,
      rangeMid: 0.34,
      rangeLong: 0.33,
      peekRightBias: 0.5, // 0 = strong left peek, 1 = strong right peek
      strafeChaos: 0.35,
      crouchFreq: 0.15,
      reloadGreed: 0.25,
      tankerAffinity: 0.20,
      aggression: 0.50
    };
    // 12x12 Dirichlet-smoothed Markov transition counts
    this.markov = new Float32Array(NUM_ZONES * NUM_ZONES);
    this.markov.fill(0.18);

    this.observations = 0;
    this.matchesLearned = 0;
    this.lastZone = -1;
    this.lastObservedAt = -10;
    this.lastSideSign = 0;
    this.lastPredictedZone = -1;
    this.lastPredictionConf = 0;
    this.activeArchetype = 'ADAPTIVE_HYBRID';

    this._load();
    this._recomputeArchetype();
  }

  _load() {
    try {
      const raw = globalThis.localStorage?.getItem(SYNAPSE_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.fp) {
        for (const k of Object.keys(this.fp)) {
          if (Number.isFinite(saved.fp[k])) this.fp[k] = clamp(saved.fp[k], 0, 1);
        }
      }
      if (Array.isArray(saved?.markov) && saved.markov.length === NUM_ZONES * NUM_ZONES) {
        for (let i = 0; i < this.markov.length; i++) {
          this.markov[i] = clamp(Number(saved.markov[i]) || 0.18, 0.05, 40);
        }
      }
      this.matchesLearned = Math.max(0, Number(saved?.matchesLearned) || 0);
    } catch {}
  }

  save() {
    if (this.saved || this.observations === 0) return;
    this.saved = true;
    this.matchesLearned++;
    try {
      globalThis.localStorage?.setItem(SYNAPSE_STORAGE_KEY, JSON.stringify({
        fp: this.fp,
        markov: Array.from(this.markov, v => Number(v.toFixed(3))),
        matchesLearned: this.matchesLearned
      }));
    } catch {}
  }

  /**
   * Records a strictly fair-play observation of the human player (from direct enemy LOS or EchoPulse sound!).
   */
  observe(pos, {time = 0, observerPos = null, vx = 0, vz = 0, crouch = 0, isVisual = true} = {}) {
    if (!pos) return;
    const dt = time - this.lastObservedAt;
    if (dt < 0.14 && this.observations > 0) return; // Rate-limit samples cleanly to ~7Hz
    this.observations++;
    const lr = isVisual ? 0.14 : 0.07;

    // 1. Update lane affinity vector (West / Center / East)
    const zone = sectorOf(pos[0], pos[2]);
    const lane = zone % 3;
    const tW = lane === 0 ? 1 : 0, tC = lane === 1 ? 1 : 0, tE = lane === 2 ? 1 : 0;
    this.fp.laneWest += (tW - this.fp.laneWest) * lr;
    this.fp.laneCenter += (tC - this.fp.laneCenter) * lr;
    this.fp.laneEast += (tE - this.fp.laneEast) * lr;
    const lSum = this.fp.laneWest + this.fp.laneCenter + this.fp.laneEast || 1;
    this.fp.laneWest /= lSum;
    this.fp.laneCenter /= lSum;
    this.fp.laneEast /= lSum;

    // 2. Update Online 12x12 Markov Sector Transition Matrix when player rotates sectors
    if (this.lastZone >= 0 && zone !== this.lastZone && dt < 18) {
      const row = this.lastZone * NUM_ZONES;
      // Exponential recency decay keeps AI hyper-responsive to mid-match adaptation!
      for (let j = 0; j < NUM_ZONES; j++) this.markov[row + j] = Math.max(0.10, this.markov[row + j] * 0.92);
      this.markov[row + zone] += isVisual ? 1.4 : 0.8;
    }
    this.lastZone = zone;
    this.lastObservedAt = time;

    // 3. Visual-only micro-kinematics (engagement range, peek chirality, strafe reversals, crouch & push)
    if (isVisual && observerPos) {
      const dx = pos[0] - observerPos[0], dz = pos[2] - observerPos[2];
      const dist = Math.hypot(dx, dz);
      const isCQB = dist < 17 ? 1 : 0;
      const isMid = dist >= 17 && dist <= 40 ? 1 : 0;
      const isLong = dist > 40 ? 1 : 0;
      this.fp.rangeCQB += (isCQB - this.fp.rangeCQB) * lr;
      this.fp.rangeMid += (isMid - this.fp.rangeMid) * lr;
      this.fp.rangeLong += (isLong - this.fp.rangeLong) * lr;
      const rSum = this.fp.rangeCQB + this.fp.rangeMid + this.fp.rangeLong || 1;
      this.fp.rangeCQB /= rSum;
      this.fp.rangeMid /= rSum;
      this.fp.rangeLong /= rSum;

      // Observer-relative lateral motion -> learns player's preferred Left vs Right peek chirality!
      if (dist > 1.5) {
        const rx = -dz / dist, rz = dx / dist;
        const lat = vx * rx + vz * rz;
        if (Math.abs(lat) > 0.65) {
          const sign = lat > 0 ? 1 : -1;
          this.fp.peekRightBias += ((sign > 0 ? 1 : 0) - this.fp.peekRightBias) * 0.12;
          if (this.lastSideSign && sign !== this.lastSideSign) {
            this.fp.strafeChaos = clamp(this.fp.strafeChaos + 0.08, 0, 1);
          } else {
            this.fp.strafeChaos = clamp(this.fp.strafeChaos * 0.97, 0, 1);
          }
          this.lastSideSign = sign;
        }
        // Forward aggression toward enemy (-dz = moving toward north enemy half)
        const closing = -((vx * dx + vz * dz) / dist);
        const aggroSample = clamp(0.5 + closing / 8.0, 0, 1);
        this.fp.aggression += (aggroSample - this.fp.aggression) * 0.12;
      }
      this.fp.crouchFreq += ((crouch > 0.45 ? 1 : 0) - this.fp.crouchFreq) * 0.12;
    }

    const pred = this.predictNextZone(zone);
    this.lastPredictedZone = pred.zone;
    this.lastPredictionConf = pred.confidence;
    this._recomputeArchetype();
  }

  observeReload() {
    this.observations++;
    this.fp.reloadGreed = clamp(this.fp.reloadGreed + 0.14, 0, 1);
    this._recomputeArchetype();
  }

  observeTankerCapture() {
    this.observations++;
    this.fp.tankerAffinity = clamp(this.fp.tankerAffinity + 0.24, 0, 1);
    this._recomputeArchetype();
  }

  /** Predicts the player's most likely next tactical sector from the learned 12x12 Markov chain. */
  predictNextZone(fromZone = this.lastZone) {
    if (fromZone < 0 || fromZone >= NUM_ZONES) return {zone: 4, pos: sectorCenter(4), confidence: 0};
    const row = fromZone * NUM_ZONES;
    let best = fromZone, bestVal = -1, sum = 0;
    for (let j = 0; j < NUM_ZONES; j++) {
      const v = this.markov[row + j];
      sum += v;
      if (j !== fromZone && v > bestVal) {
        bestVal = v;
        best = j;
      }
    }
    const conf = sum > 0 ? clamp((bestVal / sum - 1 / NUM_ZONES) * 2.2, 0, 0.96) : 0;
    return {zone: best, pos: sectorCenter(best), confidence: conf};
  }

  _recomputeArchetype() {
    const f = this.fp;
    if (this.observations < 4 && this.matchesLearned === 0) {
      this.activeArchetype = 'ADAPTIVE_HYBRID';
      return;
    }
    if (f.tankerAffinity > 0.54) this.activeArchetype = 'TANKER_HUNTER';
    else if (f.reloadGreed > 0.62) this.activeArchetype = 'RELOAD_PUNISH_TARGET';
    else if (f.laneWest > 0.48) this.activeArchetype = 'WEST_FLANKER';
    else if (f.laneEast > 0.48) this.activeArchetype = 'EAST_FLANKER';
    else if (f.rangeCQB > 0.46 && f.aggression > 0.54) this.activeArchetype = 'CQB_RUSHER';
    else if (f.rangeLong > 0.46) this.activeArchetype = 'LONG_SNIPER';
    else this.activeArchetype = 'ADAPTIVE_HYBRID';
  }

  /**
   * Compiles live Counter-Playbook biases consumed by NV2StrategyTree & NV2.1 Spy Engine.
   */
  getCounterDirective() {
    const f = this.fp;
    const pred = this.predictNextZone();
    return {
      archetype: this.activeArchetype,
      predictedZone: pred.zone,
      predictedPos: pred.pos,
      confidence: pred.confidence,
      // Playbook bonus weights for NV2StrategyTree (0..6)
      playbookBias: {
        EXECUTE_COLLAPSE: f.rangeLong > 0.45 ? 0.35 : f.reloadGreed > 0.55 ? 0.40 : 0,
        PINCER_DOUBLE_FLANK: (f.laneWest > 0.45 || f.laneEast > 0.45) ? 0.38 : 0.08,
        ANCHOR_AND_CUT: f.aggression > 0.58 ? 0.32 : 0,
        BAIT_TRAP_CROSSFIRE: f.rangeCQB > 0.44 ? 0.42 : 0.06,
        TANKER_DENIAL_BOX: f.tankerAffinity > 0.46 ? 0.52 : 0,
        FALLBACK_KILLZONE: (f.rangeCQB > 0.48 && f.aggression > 0.62) ? 0.36 : 0
      },
      // Dominant lane X to pre-watch (-15 West, 0 Center, +15 East)
      favoredLaneX: f.laneWest > f.laneEast + 0.12 ? -15 : f.laneEast > f.laneWest + 0.12 ? 15 : 0,
      peekBias: (f.peekRightBias - 0.5) * 2, // -1..+1
      reloadPunishBoost: clamp((f.reloadGreed - 0.25) * 1.4, 0, 0.85)
    };
  }

  /** Formats a crisp Japanese analytical readout for the Match Results screen. */
  getSummary() {
    const meta = ARCHETYPE_LABELS[this.activeArchetype] || ARCHETYPE_LABELS.ADAPTIVE_HYBRID;
    const f = this.fp;
    const peekTag = f.peekRightBias > 0.58 ? '右ピーク傾向' : f.peekRightBias < 0.42 ? '左ピーク傾向' : '左右均衡ピーク';
    const rangeTag = f.rangeCQB > 0.42 ? '近距離主戦' : f.rangeLong > 0.42 ? '遠距離主戦' : '中距離主戦';
    return {
      archetype: this.activeArchetype,
      archetypeJa: meta.ja,
      counterJa: meta.counterJa,
      observations: this.observations,
      matchesLearned: this.matchesLearned,
      confidencePct: Math.round(this.lastPredictionConf * 100),
      lanesPct: [Math.round(f.laneWest * 100), Math.round(f.laneCenter * 100), Math.round(f.laneEast * 100)],
      traits: `${peekTag} · ${rangeTag} · 予測信頼度 ${Math.round(this.lastPredictionConf * 100)}%`
    };
  }
}
