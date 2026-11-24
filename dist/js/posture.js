import {clamp} from './geometry.js';
export function torso(a) {
  return 1 - (a.crouch || 0) * .34
}
export function bodyCenter(a) {
  const lean = a.lean || 0;
  return [a.x + Math.cos(a.yaw) * lean, a.z + Math.sin(a.yaw) * lean]
}
export function eyeOf(a) {
  if (a.isDrone) return [a.x, a.y + .35, a.z];
  const [x, z] = bodyCenter(a);
  return [x, a.y + (a.human ? 1.61 : 1.5) * torso(a), z]
}
export function targetPoint(a) {
  if (a.isDrone) return [a.x, a.y + .35, a.z];
  const [x, z] = bodyCenter(a);
  return [x, a.y + 1.23 * torso(a), z]
}
export function vertical(a, dt, floorAt, gravityScale = 1) {
  const before = a.y;
  a.vy -= 14 * gravityScale * dt;
  const next = before + a.vy * dt;
  const floor = a.vy <= 0 ? floorAt(a.x, a.z, before) : -Infinity;
  if (next <= floor) {
    if (!a.onGround && a.vy < -1.2) a.landCompress = clamp(-a.vy / 7.5, .25, 1);
    a.y = floor;
    a.vy = 0;
    a.onGround = true;
  } else {
    a.y = next;
    a.onGround = false;
  }
}
let _pLastDt = -1, _pLastK = 0;
export function postureStep(a, dt, crouch, lean, ads) {
  if (dt !== _pLastDt) { _pLastDt = dt; _pLastK = 1 - Math.exp(-7 * dt); }
  const k = _pLastK;
  a.crouch += ((crouch ? 1 : 0) - a.crouch) * k;
  a.lean += (clamp(lean, -.32, .32) - a.lean) * k;
  a.aimPose += ((ads ? 1 : 0) - a.aimPose) * k;
}
