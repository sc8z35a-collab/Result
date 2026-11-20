import {sub, unit, dot, cross} from './geometry.js';
import {bodyHit} from './match.js';
import {obstacles, rayBox} from './yard.js';
import {torso, bodyCenter} from './posture.js';
const W = 256, H = 192, halfX = Math.tan(6 * Math.PI / 180), halfY = halfX * H / W;
// The EVR1 sensor samples a 4:3 image. Cover is depth-tested for each warm
// silhouette in this virtual scene. The coarse grain belongs to the sensor.
export class ThermalOptic {
  constructor(surface) {
    this.canvas = surface;
    surface.width = W;
    surface.height = H;
    this.ctx = surface.getContext('2d', {willReadFrequently: true, alpha: false});
    this.next = 0;
    this.seed = 83
  }
  draw(renderer, match, cam, t) {
    if (t + .001 < this.next)return;
    this.next = t + 1 / 18;
    const ctx = this.ctx, src = renderer.canvas, aspect = renderer.aspect, fy = Math.tan(cam.fov * Math.PI / 360);
    const sw = src.width * halfX / (fy * aspect), sh = src.height * halfY / fy;
    ctx.drawImage(src, (src.width - sw) * .5, (src.height - sh) * .5, sw, sh, 0, 0, W, H);
    const im = ctx.getImageData(0, 0, W, H), rgb = im.data;
    let seed = this.seed;
    for (let i = 0; i < rgb.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = (seed >>> 28) - 7;
      const y = 21 + .53 * (.24 * rgb[i] + .54 * rgb[i + 1] + .22 * rgb[i + 2]) + grain * .55;
      rgb[i] = y * .94;
      rgb[i + 1] = y;
      rgb[i + 2] = y * .97
    }
    this.seed = seed;
    const origin = cam.pos, dir = unit(sub(cam.target, origin)), right = unit(cross(dir, [0, 1, 0])), up = cross(right, dir);
    // ThermoFlux 1.0 physical ground thermal trails (footprints, hot impact craters, hot brass) & solar contrast
    const tf = match.thermoFlux;
    if (tf && origin[1] > 0.1) {
      for (let py = Math.floor(H * 0.35); py < H; py += 2) {
        const vertical = (1 - 2 * (py + .5) / H) * halfY;
        const ry = dir[1] + vertical * up[1];
        if (ry >= -0.025) continue;
        const tGround = -origin[1] / ry;
        if (tGround < 0.8 || tGround > 68) continue;
        for (let px = 0; px < W; px += 2) {
          const horizontal = (2 * (px + .5) / W - 1) * halfX;
          const rx = dir[0] + horizontal * right[0] + vertical * up[0];
          const rz = dir[2] + horizontal * right[2] + vertical * up[2];
          const gx = origin[0] + rx * tGround;
          const gz = origin[2] + rz * tGround;
          const samp = tf.sampleTemp(gx, gz);
          if (samp.dyn < 0.06) continue;
          const boost = Math.min(185, samp.dyn * 165);
          for (let oy = 0; oy < 2 && py + oy < H; oy++) {
            for (let ox = 0; ox < 2 && px + ox < W; ox++) {
              const pIdx = ((py + oy) * W + (px + ox)) * 4;
              rgb[pIdx] = Math.min(255, rgb[pIdx] + boost * 1.02);
              rgb[pIdx + 1] = Math.min(255, rgb[pIdx + 1] + boost * 0.96);
              rgb[pIdx + 2] = Math.min(255, rgb[pIdx + 2] + boost * 0.88);
            }
          }
        }
      }
    }
    const zbuf = new Float32Array(W * H);
    zbuf.fill(130);
    for (const a of match.actors) {
      if (!a.alive || a === match.player)continue;
      const [x, z] = bodyCenter(a), middle = [x, a.y + .88 * torso(a), z], v = sub(middle, origin), dep = dot(v, dir);
      if (dep < .2 || dep > 125)continue;
      const cx = W * .5 + dot(v, right) / dep / halfX * W * .5,
        cy = H * .5 - dot(v, up) / dep / halfY * H * .5,
        pad = 1 / Math.max(.15, dep - .6),
        hw = (.43 + (Math.abs(dot(v, right)) / dep) * .5) * pad / halfX * W * .5 + 2,
        hh = (.99 * torso(a) + .10 + Math.abs(dot(v, up)) / dep * .5) * pad / halfY * H * .5 + 2;
      const xa = Math.max(0, Math.floor(cx - hw)),
        xb = Math.min(W - 1, Math.ceil(cx + hw)),
        ya = Math.max(0, Math.floor(cy - hh)),
        yb = Math.min(H - 1, Math.ceil(cy + hh));
      if (xa > xb || ya > yb)continue;
      const solids = obstacles.filter(o => o.x1 >= Math.min(origin[0], x) - .65 && o.x0 <= Math.max(origin[0], x) + .65 && o.z1 >= Math.min(origin[2], z) - .65 && o.z0 <= Math.max(origin[2], z) + .65);
      const length = dep + 2;
      for (let py = ya; py <= yb; py++) {
        const vertical = (1 - 2 * (py + .5) / H) * halfY;
        for (let px = xa; px <= xb; px++) {
          const horizontal = (2 * (px + .5) / W - 1) * halfX;
          const end = origin.map((v, i) => v + length * (dir[i] + horizontal * right[i] + vertical * up[i]));
          const hit = bodyHit(origin, end, a), idx = py * W + px;
          if (hit > 1 || length * hit >= zbuf[idx] || solids.some(o => rayBox(origin, end, o) < hit))continue;
          zbuf[idx] = length * hit;
          const edge = Math.min(1, Math.abs((px - cx) / (hw || 1)));
          const luminance = 237 - 40 * edge + ((idx + seed) & 7);
          rgb[idx * 4] = luminance;
          rgb[idx * 4 + 1] = luminance + 3;
          rgb[idx * 4 + 2] = luminance - 4
        }
      }
    }
    ctx.putImageData(im, 0, 0)
  }
}
