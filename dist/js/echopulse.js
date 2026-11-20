// EchoPulse 1.0 — 343 m/s 3D Acoustic Wave-Field, Peripheral Sound-to-Sight Compass & Echo-Decoy AI Perception.
//
// Bridges Sound Engin 1.0's physical raytraced acoustics directly into tactical gameplay & AI cognition:
//   1. True Speed-of-Sound Propagation Queue (t_arrive = t_emit + d / 343 m/s):
//      - Gunfire, steel ricochets, wallbang penetrations, Supply Tanker activations, and nearby steel-roof
//        footsteps propagate outward as physical 3D acoustic waves instead of magic 0ms teleport-hearing.
//   2. World-First Acoustic Decoy Physics for NV2 vs. NV2.1 Haas Precedence Filtering:
//      - When an occluded shooter fires inside a narrow corrugated steel container canyon and a clear
//        early reflection off an opposing steel wall carries strong reflected energy, standard NV2 NPCs
//        can be briefly decoyed toward the reflection bearing (~1.2s), whereas elite NV2.1 Spy Engine
//        applies Haas precedence multi-path filtering to reject the echo and pinpoint the true source!
//   3. Peripheral Sound-to-Sight Tactical Acoustic Compass (HUD):
//      - Feeds up to 6 crisp, unobtrusive peripheral directional wave arcs around screen center showing
//        the exact physical arrival bearing, loudness, occlusion, and signature (fire/ricochet/tanker/step)
//        — works seamlessly even when audio is muted!

import {clamp} from './geometry.js';
import {computeAcousticPath, traceEarlyReflections, SPEED_OF_SOUND} from './audio.js';
import {eyeOf} from './posture.js';

export const ECHOPULSE_VERSION = 'EchoPulse 1.0';
const MAX_PULSES = 24;

export class EchoPulseField {
  constructor() {
    this.version = ECHOPULSE_VERSION;
    this.queue = [];        // Pending speed-of-sound acoustic deliveries for NPCs
    this.playerWaves = [];  // Arrived/active directional acoustic signatures for player compass
    this.stats = {
      emitted: 0,
      delivered: 0,
      echoDecoys: 0,
      nv21RejectedDecoys: 0
    };
  }

  reset() {
    this.queue.length = 0;
    this.playerWaves.length = 0;
    for (const key of Object.keys(this.stats)) this.stats[key] = 0;
  }

  /**
   * Emits a physical 3D acoustic wavefront from `srcPos` at match time `time`.
   * Computes real propagation delay (d / 343 m/s), container occlusion, and steel-wall early reflections!
   */
  emit(match, {kind = 'fire', pos, actor = null, team = -1, loudness = 1.0, gun = ''}) {
    if (!match || !pos) return;
    this.stats.emitted++;
    const tNow = match.time || 0;
    const maxRange = kind === 'reload' ? 26 : kind === 'step' ? 24 : kind === 'ricochet' ? 68 : kind === 'tanker' ? 95 : 135;

    for (const listener of match.actors) {
      if (!listener.alive || (listener.human && kind === 'reload')) continue;
      if (actor && listener.id === actor.id) continue;
      if (team === listener.team && !(listener.human && kind === 'tanker')) continue;
      const dst = eyeOf(listener);
      const dist = Math.hypot(pos[0] - dst[0], pos[1] - dst[1], pos[2] - dst[2]);
      if (dist > maxRange) continue;

      const path = computeAcousticPath(pos, dst);
      const gain = kind === 'reload' ? Math.min(path.directGain, path.bandGains.mid) : path.directGain;
      const effectiveGain = gain * loudness;
      if (effectiveGain < (kind === 'reload' ? .06 : .025)) continue;

      let perceivedPos = [pos[0], pos[1], pos[2]];
      let isDecoy = false;
      let arrivalDelay = path.delay;

      // Check corrugated steel container-alley early reflection echo decoy when direct path is strongly occluded!
      // High-frequency metallic wall reflections (4.6 kHz) dominate directional cues over low-passed steel-occluded waves (~800 Hz).
      if (path.occluded && path.occlusion >= 0.42 && (kind === 'fire' || kind === 'ricochet') && dist < 52) {
        const taps = traceEarlyReflections(pos, dst, 6);
        const bestTap = taps.find(tp => tp.clear && tp.mat === 'steel');
        if (bestTap && bestTap.gain > path.directGain * 0.30) {
          if (listener.isSpy) {
            // NV2.1 Spy Engine applies multi-path Haas precedence filtering -> rejects wall echo!
            this.stats.nv21RejectedDecoys++;
          } else if (!listener.human) {
            // Standard NV2 hears the crisp bright metallic wall reflection first -> brief realistic echo decoy!
            perceivedPos = [bestTap.pos[0], bestTap.pos[1], bestTap.pos[2]];
            arrivalDelay = bestTap.absDelay || (path.delay + bestTap.delay);
            isDecoy = true;
            this.stats.echoDecoys++;
          }
        }
      }

      if (listener.human) {
        // Queue for player's peripheral Sound-to-Sight Acoustic Compass (enemy & neutral/tanker cues)
        this.playerWaves.push({
          kind,
          actorId: actor?.id ?? -1,
          actorSpawnId: actor?.spawnId,
          listenerSpawnId: listener.spawnId,
          team,
          pos: perceivedPos,
          arriveAt: tNow + arrivalDelay,
          expireAt: tNow + arrivalDelay + (kind === 'tanker' ? 1.55 : kind === 'fire' ? 0.92 : 0.72),
          strength: clamp(effectiveGain * (kind === 'tanker' ? 1.5 : 1.35), 0.14, 1.0),
          occluded: path.occluded,
          dist,
          gun
        });
        if (this.playerWaves.length > MAX_PULSES) this.playerWaves.shift();
      } else {
        // Queue physically delayed speed-of-sound acoustic arrival for NPC AI perception!
        this.queue.push({
          listenerId: listener.id,
          listenerSpawnId: listener.spawnId,
          sourceSpawnId: actor?.spawnId,
          sourceActor: actor,
          perceivedPos,
          truePos: [pos[0], pos[1], pos[2]],
          arriveAt: tNow + arrivalDelay,
          emittedAt: tNow,
          reloadUntil: kind === 'reload' ? tNow + actor.reload : 0,
          occluded: path.occluded,
          isDecoy,
          kind,
          dist,
          strength: clamp(effectiveGain, 0.05, 1.0)
        });
        if (this.queue.length > 96) this.queue.shift();
      }
    }
  }

  /**
   * Advances 343 m/s acoustic propagation queue and returns all reports that physically arrived this tick.
   */
  step(match) {
    const tNow = match.time || 0;
    const arrived = [];
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].arriveAt <= tNow) {
        const report = this.queue[i];
        this.queue.splice(i, 1);
        const listener = match.actors[report.listenerId];
        if (listener?.alive && listener.spawnId === report.listenerSpawnId) {
          arrived.push(report);
          this.stats.delivered++;
        }
      }
    }
    for (let i = this.playerWaves.length - 1; i >= 0; i--) {
      if (this.playerWaves[i].expireAt <= tNow || this.playerWaves[i].listenerSpawnId !== match.player?.spawnId) this.playerWaves.splice(i, 1);
    }
    return arrived.sort((a, b) => a.arriveAt - b.arriveAt);
  }

  /**
   * Returns active peripheral compass bearings relative to player facing (`deg`: 0=ahead, +90=right, -90=left, ±180=behind).
   */
  getCompassArcs(player, time, maxArcs = 6) {
    if (!player?.alive || !this.playerWaves.length) return [];
    const fx = Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = Math.sin(player.yaw);
    const arcs = [];
    for (const w of this.playerWaves) {
      if (time < w.arriveAt || time >= w.expireAt) continue;
      const lifeFrac = clamp((w.expireAt - time) / Math.max(0.15, w.expireAt - w.arriveAt), 0, 1);
      const dx = w.pos[0] - player.x, dz = w.pos[2] - player.z;
      const len = Math.hypot(dx, dz) || 1;
      const fwdDot = (dx * fx + dz * fz) / len;
      const rightDot = (dx * rx + dz * rz) / len;
      const deg = (Math.atan2(rightDot, fwdDot) * 180) / Math.PI;
      arcs.push({
        deg,
        alpha: clamp(w.strength * Math.pow(lifeFrac, 0.72), 0, 1),
        kind: w.kind,
        occluded: w.occluded,
        dist: w.dist
      });
    }
    arcs.sort((a, b) => b.alpha - a.alpha);
    return arcs.slice(0, maxArcs);
  }
}

export {SPEED_OF_SOUND};
