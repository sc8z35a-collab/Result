import {clamp, angleDiff, forward} from './geometry.js';
import {obstruction} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
export const DF = 'DF1 OUT';
export function initialDF() {
  return {
    pattern: 'central',
    boost: false,
    p1: 20,
    p1Clock: 0,
    heat: 0,
    cooling: 0,
    lastBoost: -10,
    extraPhase: 0,
    ads: false,
    scope: 'plastic',
    focusId: -1,
    focus: 0,
    scanAt: 0,
    locked: false,
    shotIndex: 0,
    burstPattern: 'central'
  }
}
function aimAt(a, e) {
  const origin = eyeOf(a),
    p = targetPoint(e),
    dx = p[0] - origin[0],
    dy = p[1] - origin[1],
    dz = p[2] - origin[2],
    range = Math.hypot(dx, dz);
  return {origin, p, range, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, range)}
}
export function senseFocus(match, a, dt) {
  const d = a.df, t = match.time;
  if (t >= d.scanAt) {
    d.scanAt = t + .055;
    let best = -1, cost = Infinity;
    for (const e of match.actors) {
      if (!e.alive || e.team === a.team)continue;
      const s = aimAt(a, e);
      if (s.range > 98)continue;
      const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch),
        cone = e.id === d.focusId ? .109 : .078;
      if (sep >= cone || sep >= cost || obstruction(s.origin, s.p) <= 1)continue;
      best = e.id;
      cost = sep
    }
    if (best !== d.focusId) {
      d.focus = 0;
      d.locked = false;
      d.focusId = best
    }
  }
  if (d.focusId >= 0) {
    d.focus = Math.min(1, d.focus + dt / .42);
    d.locked = d.focus >= 1
  } else {
    d.focus = 0;
    d.locked = false
  }
}
export function assist(match, a) {
  const d = a.df, e = match.actors[d.focusId];
  if (!d.locked || !e?.alive || e.team === a.team)return;
  const s = aimAt(a, e), yaw = angleDiff(s.yaw, a.yaw), pitch = s.pitch - a.pitch, ang = Math.hypot(yaw, pitch);
  if (ang > .11 || obstruction(s.origin, s.p) <= 1) {
    d.locked = false;
    d.focus = 0;
    d.focusId = -1;
    return
  }
  const gain = Math.min(.28, .013 / Math.max(.00001, ang));
  a.yaw += yaw * gain;
  a.pitch = clamp(a.pitch + pitch * gain, -1.31, 1.31)
}
export function scheduleDF(a) {
  const d = a.df, main = Math.min(3, a.mag), queue = Array(main).fill('main');
  d.shotIndex = 0;
  d.burstPattern = d.pattern;
  if (main === 3 && d.boost && d.cooling <= 0 && d.p1) {
    const extra = Math.min(1 + d.extraPhase, d.p1);
    d.extraPhase = 1 - d.extraPhase;
    for (let i = 0; i < extra; i++)queue.push('p1')
  }
  return queue
}
export function directionDF(a) {
  const d = a.df, i = d.shotIndex++;
  if (d.burstPattern !== 'spread')return forward(a.yaw, a.pitch);
  const fan = [[0, .003], [-.034, -.011], [.034, -.011], [-.020, .026], [.020, .026]][i % 5];
  return forward(a.yaw + fan[0], a.pitch + fan[1])
}
export function spendP1(a, t) {
  const d = a.df;
  if (d.p1 <= 0 || d.cooling > 0 || !d.boost)return false;
  d.p1--;
  d.lastBoost = t;
  d.heat = Math.min(100, d.heat + 21);
  if (d.heat >= 100) {
    d.cooling = 5;
    d.boost = false
  }
  return true
}
export function updateDF(match, a, dt) {
  const d = a.df;
  if (d.p1 < 20) {
    d.p1Clock += dt;
    if (d.p1Clock + 1e-8 >= 8) {
      d.p1++;
      d.p1Clock = Math.max(0, d.p1Clock - 8)
    }
  } else d.p1Clock = 0;
  if (d.cooling > 0) {
    d.cooling = Math.max(0, d.cooling - dt);
    d.heat = d.cooling * 20
  } else if (match.time - d.lastBoost > 1.15)d.heat = Math.max(0, d.heat - 11 * dt);
  senseFocus(match, a, dt)
}
