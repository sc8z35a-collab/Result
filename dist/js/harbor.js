import {Mesh, random, blend, add, sub, scale, unit} from './geometry.js';
import {dockFace, drawDockFixtures, quayEdge, breakwater} from './dockworks.js';
import {cargo, props, craneSites, tankers} from './yard.js';
const paint = {red: '#ba6049', blue: '#547486', teal: '#478381', green: '#657d6e', ivory: '#c4bd9f', ochre: '#c29a58'};
const trim = {red: '#9c493a', blue: '#415e6a', teal: '#436b66', green: '#4a635b', ivory: '#a5a18d', ochre: '#987240'};
const rubber = '#455052', iron = '#697779', white = '#d4d2bb';
function front(m, x, y, z, w, h, label, flip = false) {
  const s = flip ? -1 : 1;
  m.quad([x - s * w / 2, y - h / 2, z], [x + s * w / 2, y - h / 2, z], [x + s * w / 2, y + h / 2, z], [x - s * w / 2, y + h / 2, z], 'label' + label, '#ffffff', 1, 1, 4, [0, 0, s])
}
function side(m, x, y, z, w, h, label, dir) {
  m.quad([x, y - h / 2, z + dir * w / 2], [x, y - h / 2, z - dir * w / 2], [x, y + h / 2, z - dir * w / 2], [x, y + h / 2, z + dir * w / 2], 'label' + label, '#ffffff', 1, 1, 4, [dir, 0, 0])
}
function container(m, x, z, w, d, y, key, brand, detail = 1) {
  const h = 2.59, col = paint[key], edge = trim[key], longX = w > d;
  const coldUnit = key === 'ivory' && Math.abs(x) < 25;
  m.box(x, y + h / 2, z, w, h, d, coldUnit ? 'saltCladding' : 'panel', col, 2.55, 1, y > 0);
  if (coldUnit) {
    if (longX) dockFace(m, x-w/2-.018, y+h/2, z, d-.14, h-.15, 'west', 'chiller');
    else dockFace(m, x, y+h/2, z-d/2-.018, w-.14, h-.15, 'north', 'chiller');
  }
  if (!detail)return;
  // Rolled corner posts, frame rails, paired locking rods and the small end doors.
  for (const sx of [-1, 1])for (const sz of [-1, 1]) {
    m.box(x + sx * (w / 2 - .052), y + h / 2, z + sz * (d / 2 - .052), .115, h, .115, 'white', edge);
    for (const dy of [.09, h - .09])m.box(x + sx * (w / 2 - .055), y + dy, z + sz * (d / 2 - .055), .154, .16, .154, 'blackMetal', '#d1cec0', 0, 1)
  }
  for (const dy of [.085, h - .082]) {
    for (const sz of [-1, 1])m.box(x, y + dy, z + sz * d / 2, w, .12, .075, 'white', edge);
    for (const sx of [-1, 1])m.box(x + sx * w / 2, y + dy, z, .075, .12, d, 'white', edge)
  }
  if (longX) {
    for (const sz of [-1, 1])front(m, x - w * .12, y + 1.44, z + sz * (d / 2 + .013), Math.min(4, w * .47), 1.65, brand, sz < 0);
    for (const q of [-.36, -.13, .13, .36]) {
      m.box(x + w / 2 + .05, y + 1.34, z + d * q, .065, 2.29, .059, 'white', '#8c9186', 0, 1);
      m.box(x + w / 2 + .091, y + .82, z + d * q, .045, .06, .24, 'white', iron)
    }
    side(m, x + w / 2 + .09, y + 1.8, z - .15, .81, .8, 'serial', 1)
  } else {
    for (const sx of [-1, 1])side(m, x + sx * (w / 2 + .013), y + 1.44, z + d * .09, Math.min(4, d * .50), 1.65, brand, sx);
    for (const q of [-.36, -.13, .13, .36]) {
      m.box(x + w * q, y + 1.34, z + d / 2 + .052, .059, 2.29, .065, 'white', '#94998a', 0, 1);
      m.box(x + w * q, y + .82, z + d / 2 + .088, .24, .06, .043, 'white', iron)
    }
    front(m, x + w * .26, y + 1.85, z + d / 2 + .09, .76, .72, 'serial')
  }
}
function crane(m, x, z, s = 1, num = '04', detailed = true, lite = false) {
  const col = num === '05' ? '#759d9c' : '#cc9b56',
    shade = num === '05' ? '#587d7c' : '#a67743',
    light = '#d9c9a3',
    walk = '#858d86',
    steel = '#596a6b';
  const P = (a, b, c) => [x + a * s, b * s, z + c * s],
    box = (a, b, c, w, h, d, mat, c0) => m.box(...P(a, b, c), w * s, h * s, d * s, mat, c0, mat === 'panel' ? 3 : 0, 1),
    beam = (a, b, w, d = w, c = col) => {
      // Narrow webs in the boom are seen edge-on from the deck. Two facing
      // ribbons retain the open lattice in the software and lightweight views.
      if (lite && w <= .65 && a[2] === b[2]) {
        const dx = b[0]-a[0], dy = b[1]-a[1], len = Math.hypot(dx,dy);
        if (!len) return;
        const ex = -dy*w/(2*len), ey = dx*w/(2*len);
        const p = [P(a[0]-ex,a[1]-ey,a[2]), P(b[0]-ex,b[1]-ey,b[2]),
          P(b[0]+ex,b[1]+ey,b[2]), P(a[0]+ex,a[1]+ey,a[2])];
        m.quad(...p,'white',c,1,1,1,[0,0,1]);
        m.quad(p[3],p[2],p[1],p[0],'white',c,1,1,1,[0,0,-1]);
      } else m.beam(P(...a), P(...b), w*s, d*s, 'white', c, 1);
    };
  for (const dz of [-8, 8]) {
    for (const dx of [-4.4, 4.4]) {
      box(dx, .65, dz, 1.4, 1.2, 2.8, 'blackMetal', '#d0c7ad');
      if (!lite) {
        box(dx, 1.45, dz, 1.65, .6, 3.25, 'white', shade);
        box(dx, 2.0, dz, 1.1, .45, 2.65, 'labelhazard', white);
      }
      beam([dx, 1.9, dz], [dx * .70, 14, dz * .85], .96, 1.12);
      beam([dx * .70, 14, dz * .85], [dx * .39, 24.3, dz * .74], 1.02, .85)
    }
    beam([-4.4, 10, dz * .9], [4.4, 10, dz * .9], .84, .82);
    if (!lite) {
      beam([-3.8, 10, dz * .9], [2.6, 17, dz * .81], .26, .36);
      beam([3.8, 10, dz * .9], [-2.6, 17, dz * .81], .26, .36)
    }
  }
  for (const dx of [-3.4, 3.4]) {
    beam([dx, 13, -7.5], [dx, 13, 7.5], .84, 1.1);
    if (!lite) {
      beam([dx, 13, -7.3], [dx * .6, 23.5, 6.2], .36, .36, shade);
      beam([dx, 13, 7.3], [dx * .6, 23.5, -6.2], .36, .36, shade)
    }
  }
  // Box-truss boom with a tapered waterside end, counter-jib and A-frame stays.
  const boomStep = lite ? 9 : 3;
  for (const zz of [-2.1, 2.1]) {
    beam([-42, 24.4, zz], [15, 24.4, zz], .47, .46);
    beam([-42, 24.9, zz], [0, 27.7, zz], .46, .46);
    beam([0, 27.7, zz], [15, 26.4, zz], .41, .40);
    for (let a = -42, k = 0; a < 15; a += boomStep, k++) {
      const hi = b => b < 0 ? 24.9 + (b + 42) / 42 * 2.8 : 27.7 - b / 15 * 1.3;
      beam([a, 24.45, zz], [a, hi(a), zz], .19, .2);
      if (!lite) beam([a, k % 2 ? hi(a) : 24.45, zz], [a + 3, k % 2 ? 24.45 : hi(a + 3), zz], .21, .23)
    }
    beam([-2, 26.8, zz], [-4, 38.7, zz], .55, .64);
    beam([8, 26.6, zz], [-4, 38.7, zz], .47, .52);
    beam([-4, 38.7, zz], [-37, 25.2, zz], .12, .13, steel);
    if (!lite) {
      beam([-4, 38.7, zz], [-23, 26.25, zz], .105, .12, steel);
      beam([-4, 38.7, zz], [14, 26.6, zz], .14, .16, steel);
      beam([0, 26.8, zz], [-3.9, 38.2, zz], .17, .19, light)
    }
  }
  for (let a = -42; a <= 15; a += (lite ? 13.5 : 4.5))beam([a, 24.46, -2.1], [a, 24.46, 2.1], .19, .18);
  beam([-4, 38.5, -2.15], [-4, 38.5, 2.15], .47, .42);
  box(5, 26.1, 0, 10, 3.1, 4.4, 'panel', col);
  if (!lite) box(5, 27.72, 0, 10.4, .23, 4.8, 'white', light);
  box(13, 23.5, 0, 4.1, 2.6, 4.7, 'concrete', '#c8c3b1');
  if (!lite) box(-3.8, 24.9, 0, 3, .66, 4.75, 'white', shade);
  box(-6, 22.8, 2.85, 2.5, 2.6, 1.8, 'white', light);
  if (!lite) box(-6, 23.05, 3.77, 2.15, 1.05, .06, 'white', '#47646b');
  for (const dx of [-1.75, 1.75]) {
    beam([dx, 24.15, -6.15], [dx, 24.15, 6.15], .89, .86, shade);
    if (!lite) box(dx, 24.68, 0, 1.04, .21, 12.9, 'tread', light)
  }
  for (const zz of [-6.15, 6.15])beam([-1.9, 24.2, zz], [1.9, 24.2, zz], .76, .80, col);
  const trolley = -13;
  box(trolley, 24.12, 0, 3.2, 1, 4.4, 'white', shade);
  if (!lite) {
    for (const a of [-1.2, 1.2])for (const b of [-1.2, 1.2])beam([trolley + a, 23.7, b], [trolley + a, 10.6, b], .045, .045, steel);
    box(trolley, 10.35, 0, 3.6, .55, 3.85, 'labelhazard', white);
    front(m, x + 4.4 * s, 26.1 * s, z + 2.23 * s, 6.9 * s, 1.6 * s, 'portal');
    front(m, x + 1.42 * s, 20.15 * s, z + 6.65 * s, 2.2 * s, 2.45 * s, num);
    box(-2.8, 13.58, 0, 1.45, .18, 14.4, 'grate', walk);
  }
  if (detailed && !lite) {
    for (let y = 2.4; y < 24; y += .47)beam([2.55, y, 6.55], [3.13, y, 6.55], .046, .05, light);
    for (const ax of [2.52, 3.16])beam([ax, 2.0, 6.55], [ax, 24, 6.55], .064, .064, light);
    for (let a = -39; a <= 12; a += 2.9)beam([a, 24.68, 2.42], [a, 25.55, 2.42], .045, .045, walk);
    beam([-40, 25.55, 2.42], [14, 25.55, 2.42], .068, .068, walk);
    for (let j = 0; j < 5; j++)box(2 + j * 1.4, 26.88, 2.245, 1.02, .64, .05, 'white', '#42616a')
  }
}
const warehouses = {
  cold: {wall: 'saltCladding', base: 'cement', roof: 'panel', sign: 'coldSign', trim: '#688b89'},
  works: {wall: 'workTin', base: 'bricks', roof: 'workTin', sign: 'worksSign', trim: '#915b43'},
  bonded: {wall: 'bondTimber', base: 'stoneWall', roof: 'slateRoof', sign: 'labelgate', trim: '#828074'}
};
function warehouse(m, x, z, w, d, h, base, metal, type, lite) {
  const style = warehouses[type];
  m.box(x, h/2, z, w, h, d, style.wall, metal, 3.10, 1, false);
  m.box(x, 1.45, z, w+.16, 2.9, d+.16, style.base, base, 2.4, 0, false);
  const y = h+.02, peak = h+3.2, a = x-w/2-.48, b = x+w/2+.48, f = z-d/2-.40, g = z+d/2+.40;
  if (type === 'works') {
    for (let i=0; i<3; i++) {
      const start = f+(g-f)*i/3, end = f+(g-f)*(i+1)/3;
      m.quad([a,y,start], [a,peak,end], [b,peak,end], [b,y,start], style.roof, '#a7ada2', 5, 6, 1);
      // Vertical north light at each ridge, with a closed cheek on either side.
      for (let j=0; j<4; j++) dockFace(m, a+(b-a)*(j+.5)/4, (y+peak)/2, end, (b-a)/4, peak-y, 'south', 'wiredGlass');
      m.tri([a,y,start], [a,y,end], [a,peak,end], 'workTin', metal, 1, [-1,0,0]);
      m.tri([b,y,end], [b,y,start], [b,peak,end], 'workTin', metal, 1, [1,0,0]);
    }
  } else {
    m.quad([a,y,g], [x,peak,g], [x,peak,f], [a,y,f], style.roof, '#a9b2aa', w/4, d/4, 1);
    m.quad([x,peak,g], [b,y,g], [b,y,f], [x,peak,f], style.roof, '#b7bfb5', w/4, d/4, 1);
    m.tri([a,y,g], [b,y,g], [x,peak,g], style.wall, metal);
    m.tri([b,y,f], [a,y,f], [x,peak,f], style.wall, metal);
  }
  const west = x-w/2;
  for (let dz = -d/2+5; dz < d/2-2; dz += 10.5) {
    const bay = z+dz;
    dockFace(m, west-.10, 2.58, bay, 5.35, 4.96, 'west', 'slatDoor', '#b4b9ae', 1, 2);
    dockFace(m, west-.10, h-1.35, bay, 6.05, 1.34, 'west', 'wiredGlass');
    if (!lite) {
      m.box(west-.52, 5.22, bay, 1.26, .14, 6.12, 'workTin', '#b3b8a8', 2, 1);
      m.box(west-.23, .21, bay, .47, .42, 6.04, 'saltConcrete', '#ccc5a9', 2.6);
      for (const dz of [-2.5,2.5]) m.box(west-.49,.56,bay+dz,.21,.79,.22,'yardStripes','#dbd0ad',1);
    }
  }
  // Large enamel fascia faces the playing area and one end approach.
  const signHeight = type === 'bonded' ? 2.2 : 1.60, signWidth = type === 'bonded' ? 3.6 : 6.65;
  dockFace(m, west-.13, h-1.47, z+3.6, signWidth, signHeight, 'west', style.sign);
  dockFace(m, x, h-.42, g+.016, signWidth, signHeight, 'south', style.sign);
  if (lite) return;
  if (type === 'cold') {
    // Refrigerated transshipment shed: a loading marquee and an insulated dock wall.
    m.box(west-2.3, 4.63, z-7, 4.45,.22,17.6,'saltCladding','#bbc9b9',2.8,1);
    m.box(west-4.54,4.54,z-7,.13,.39,17.74,'portBlue',style.trim,1.5,1);
    for (const dz of [-14,-7,0]) {
      m.box(west-4.22,2.25,z+dz,.17,4.5,.17,'saltCladding','#92b0a8',1.3,1);
      m.beam([west-4.20,3.62,z+dz], [west-3.1,4.55,z+dz], .10,.11,'workTin');
    }
    for (const dz of [-10,9]) {
      m.box(x+3,h+3.32,z+dz,3.4,1.45,4.5,'slatDoor','#acb9ae',1.7,1);
      dockFace(m,x+1.28,h+3.38,z+dz,3.6,.95,'west','chiller');
    }
  } else if (type === 'works') {
    // Exterior crane runway: the cast feet, overhead rail and weather hood read
    // as one loading bay from the far side of the field.
    for (const dz of [-8,8]) {
      for (const dx of [1.3,5.0]) m.box(west-dx,3.72,z+dz,.27,7.44,.34,'workTin','#a7866e',1.6,1);
      m.box(west-3.15,7.40,z+dz,4.45,.35,.43,'workTin','#ad856a',1.7,1);
    }
    m.box(west-4.8,7.64,z,.43,.38,18.6,'workTin','#c19779',2,1);
    m.box(west-4.8,7.18,z+3,.82,.64,1.24,'yardStripes','#dcca96',1,1);
    m.beam([west-4.8,6.88,z+3], [west-4.8,5.15,z+3], .052,.052,'blackMetal');
  } else {
    for (const dz of [-8,0,8]) {
      m.box(west-.26, h*.49, z+dz, .42,h,.45,'stoneWall','#b3ad99',1.7);
      dockFace(m,west-.23,h-2.24,z+dz+2.3,2.28,1.48,'west','officeGlass');
    }
  }
}
function ship(m, lite = false) {
  const x = -50, z = -5;
  const slices = lite
    ? [[-63, 1.4, 4], [-49, 8.2, 4.9], [30, 8.9, 4.85], [52, 7.2, 5.7], [67, .07, 7.35]]
    : [[-63, 1.4, 4], [-58, 5.4, 4.75], [-49, 8.2, 4.9], [-35, 8.9, 4.85], [30, 8.9, 4.85], [43, 8.6, 5.0], [52, 7.2, 5.7], [60, 4.7, 6.6], [67, .07, 7.35]];
  for (let i = 0; i < slices.length - 1; i++) {
    const [a, wa, ha] = slices[i], [b, wb, hb] = slices[i + 1];
    for (const s of [-1, 1]) {
      const A = [x + wa * s, ha, z + a], B = [x + wb * s, hb, z + b], C = [x + wb * .94 * s, -.65, z + b], D = [x + wa * .94 * s, -.65, z + a];
      m.quad(D, C, B, A, 'blackMetal', '#838f94', (b - a) / 9, 1, 1, [s, 0, 0]);
      m.quad([x + wa * .72 * s, -3.2, z + a], [x + wb * .72 * s, -3.2, z + b], C, D, 'redPaint', '#925747', 2, 1, 1, [s, 0, 0]);
      if (!lite) m.beam(A, B, .16, .16, 'white', '#a8a897');
    }
    m.quad([x - wa, ha, z + a], [x - wa * 0 + wa, ha, z + a], [x + wb, hb, z + b], [x - wb, hb, z + b], 'tread', '#938f7a', 2, 3, 0, [0, 1, 0])
  }
  const r = random(81), keys = Object.keys(paint);
  if (lite) {
    for (let row = -27; row <= 34; row += 13) {
      container(m, x, z + row, 11.4, 12.2, 4.93, keys[Math.floor(r() * keys.length)], 'TIDE', 0);
      if (row % 2 === 0) container(m, x, z + row, 11.4, 12.2, 7.55, keys[Math.floor(r() * keys.length)], 'HBR', 0);
    }
    m.box(x, 9.6, z - 45, 14.4, 9.4, 13.4, 'paint', '#c7ccbe', 4);
    m.box(x, 14.4, z - 45, 15.6, 2.2, 9.4, 'white', '#d1d5c5');
    m.box(x + 3.6, 12, z - 53, 3.2, 6.2, 4.7, 'redPaint', '#c27e65', 2);
    return;
  }
  for (let row = -27; row <= 34; row += 13)for (let col = -1; col <= 1; col++) {
    const high = row === 12 ? 2 : 2 + (r() > .54 ? 1 : 0);
    for (let layer = 0; layer < high; layer++)container(m, x + col * 4.0, z + row, 3.5, 12.25, 4.93 + layer * 2.62, keys[Math.floor(r() * keys.length)], ['TIDE', 'HBR', 'NORTH'][Math.floor(r() * 3)], row > 4 && layer > 0 ? 1 : 0)
  }
  for (let j = 0; j < 3; j++) {
    m.box(x, 6.2 + j * 2.35, z - 45, 14.6 - j * .7, 2.45, 14 - j * .54, 'paint', '#c7ccbe', 4);
    m.box(x, 7.4 + j * 2.35, z - 45, 15.1 - j * .7, .19, 14.5 - j * .54, 'white', '#82948b');
    for (let k = -3; k <= 3; k++)m.box(x + k * 1.67, 6.45 + j * 2.35, z - 38.17 - j * .28, 1.12, .86, .10, 'white', '#455c66', 0, 1)
  }
  m.box(x, 13.2, z - 45, 15.6, 2.25, 9.4, 'white', '#d1d5c5');
  for (let k = -5; k <= 5; k++)m.box(x + k * 1.31, 13.5, z - 40.26, 1.08, .93, .075, 'white', '#38535e', 0, 1);
  m.box(x, 14.42, z - 45, 16.3, .22, 10.1, 'white', '#87958d');
  m.tube([x, 14.4, z - 46], [x, 22.3, z - 46], .23, .11, 'white', white, 10);
  m.beam([x - 3.2, 18, z - 46], [x + 3.2, 18, z - 46], .13, .13, 'white', white);
  m.box(x + 3.6, 12, z - 53, 3.2, 6.2, 4.7, 'redPaint', '#c27e65', 2);
  m.box(x + 3.6, 15.13, z - 53, 3.25, .73, 4.76, 'white', '#424e51');
  for (let dz = 40; dz < 58; dz += 2.5) {
    const w = 8.4 - (dz - 40) * .18;
    m.beam([x + w, 5.4 + (dz - 40) * .07, z + dz], [x + w, 6.5 + (dz - 40) * .07, z + dz], .052, .052, 'white', white)
  }
  side(m, x + 8.87, 2.95, z + 29, 9, 2.45, 'ship', 1);
}
function spool(m, x, z, w, h, lite = false) {
  const rr = w * .5, seg = lite ? 7 : 14;
  for (const k of [-1, 1])m.tube([x + k * (w * .35), h * .51, z], [x + k * (w * .35 + .11), h * .51, z], rr, rr, 'wood', '#b89b75', seg);
  m.tube([x - w * .35, h * .51, z], [x + w * .35, h * .51, z], rr * .74, rr * .74, 'blackMetal', '#8e8574', seg, 1, 'none');
  if (!lite) side(m, x + w * .35 + .12, h * .51, z, w * .93, h * .96, 'serial', 1)
}
function prop(m, p, lite = false) {
  const [type, x, z, w, h, d] = p;
  if (type === 'crates') {
    const k = h > 2 ? 2 : 1;
    for (let j = 0; j < k; j++) {
      const ww = w * (1 - j * .23), xx = x + j * .21;
      m.box(xx, (j + .5) * h / k, z, ww, h / k, d * (1 - j * .2), 'crate', '#d3c8aa');
      if (j > 0 || x > 0) {
        const face = j > 0 && x < 0 ? 'tarp' : 'timberBands';
        for (const sign of [-1,1]) dockFace(m,xx,(j+.5)*h/k,z+sign*(d*(1-j*.2)/2+.008),ww,h/k,
          sign>0?'south':'north',face,'#d5c9b4');
      }
      if (!lite) for (const s of [-1, 1])m.box(xx + s * ww * .28, (j + .5) * h / k, z, .085, h / k + .025, d * (1 - j * .2) + .027, 'white', '#5f6862')
    }
  } else if (type === 'spool')spool(m, x, z, w, h, lite); else if (type === 'barrier') {
    m.box(x, .18, z, w, .35, d, 'concrete', '#b1ada2', 1.4);
    m.box(x, (.35 + h)/2, z, w*.94, h-.35, d*.71, 'saltConcrete', '#cfccbc', 1.8);
    if (w > d) {
      for (const s of [-1,1]) dockFace(m,x,h-.12,z+s*(d*.355+.009),w*.89,.19,s>0?'south':'north','yardStripes','#dac59a',w/1.8,.54);
    } else {
      for (const s of [-1,1]) dockFace(m,x+s*(w*.47+.009),h-.12,z,d*.68,.19,s>0?'east':'west','yardStripes','#dac59a',d/1.8,.54);
    }
  } else {
    m.box(x, .78, z, 1.75, 1.05, 2.55, 'barrel', '#ceab67');
    m.box(x, 1.53, z + .3, 1.52, 1.12, 1.18, 'white', '#bfa466');
    if (!lite) {
      m.box(x, 1.82, z + .3, 1.54, .55, 1.2, 'white', '#4d6770');
      m.box(x, 2.21, z + .3, 1.78, .14, 1.45, 'white', '#8c886c');
    }
    for (const k of [-1, 1]) {
      m.box(x + k * .48, 1.32, z - 1.42, .16, 2.6, .18, 'white', iron);
      m.box(x + k * .48, .13, z - 1.85, .17, .14, 1.0, 'white', iron);
      if (!lite) for (const dz of [-.78, .83])m.tube([x + k * .7, .44, z + dz], [x + k * .99, .44, z + dz], .43, .43, 'rubber', '#5a6260', 10)
    }
  }
}
function lamp(m, x, z, direction, height = 12, lite = false) {
  m.tube([x, 0, z], [x, height, z], .18, .085, 'white', '#81918a', lite ? 5 : 8);
  m.beam([x, height - .25, z], [x + direction * 2.4, height + .63, z], .11, .11, 'white', '#8a9890');
  m.box(x + direction * 2.25, height + .53, z, .92, .21, .58, 'white', '#727f79');
  if (!lite) m.box(x + direction * 2.25, height + .404, z, .78, .045, .44, 'white', '#fce4a2', 0, 3)
}
function tanks(m, x, z, rad, hh, lite = false) {
  const seg = lite ? 10 : 32;
  m.tube([x, .15, z], [x, hh, z], rad, rad, 'saltCladding', '#cccdbb', seg, 1, 'none');
  m.tube([x, hh, z], [x, hh + 1.45, z], rad, .55, 'white', '#b2b9aa', seg, 1, 'end');
  if (lite) return;
  for (const f of [.24, .49, .75, .98])m.tube([x, hh * f, z], [x, hh * f + .075, z], rad + .045, rad + .045, 'white', '#8e9d92', 32, 1, 'none');
  for (let i = 0; i < 20; i++) {
    const t = i / 20 * Math.PI * 2, tt = (i + 1) / 20 * Math.PI * 2;
    let a = [x + Math.cos(t) * (rad + .28), hh + .82, z + Math.sin(t) * (rad + .28)],
      b = [x + Math.cos(tt) * (rad + .28), hh + .82, z + Math.sin(tt) * (rad + .28)];
    m.beam(a, b, .055, .055, 'white', iron);
    if (i % 2 === 0)m.beam([a[0], hh, a[2]], a, .05, .05, 'white', iron)
  }
  m.tube([x + rad * .77, 0, z + rad * .73], [x + rad * .77, hh, z + rad * .73], .20, .20, 'white', '#929d95', 8)
}
function supplyTanker(m, t, lite = false) {
  const {x, z, facing = 1} = t, f = facing;
  // Painted harbor supply bay markings on the dock apron around the tanker.
  m.plane(x, .043, z, 3.8, 7.2, 'tread', '#304347', 2, 4);
  if (lite) {
    // Simplified lightweight supply tanker keeping identical silhouette & cyan supply beacon cues
    m.box(x, .64, z, 2.08, .30, 5.25, 'blackMetal', '#566163', 1, 1);
    const cz = z + f * 1.88;
    m.box(x, 1.48, cz, 2.14, 1.38, 1.56, 'panel', '#d5a84e', 2, 1);
    dockFace(m,x,1.72,cz+f*.79,1.88,.58,f>0?'south':'north','officeGlass');
    const ta = z - f * 2.26, tb = z + f * .86;
    m.tube([x, 1.66, ta], [x, 1.66, tb], .96, .96, 'steel', '#d7d9cb', 8, 1);
    for (const dz of [-1.72, 1.65]) {
      for (const sx of [-1, 1]) m.tube([x + sx * .88, .46, z + f * dz], [x + sx * 1.18, .46, z + f * dz], .45, .45, 'rubber', '#373e40', 6, 1, 'end');
    }
    for (const sx of [-1, 1]) dockFace(m,x+sx*1.04,1.08,z-f*.68,2.7,.12,sx>0?'east':'west','white','#7de8d8',1,1,3);
    const rz = z - f * 2.48;
    dockFace(m,x,1.46,rz-f*.22,1.18,.54,f>0?'north':'south','white','#75e4d4',1,1,3);
    return;
  }
  for (const sx of [-1, 1])m.plane(x + sx * 1.98, .046, z, .22, 7.4, 'labelhazard', '#e5c16c', 1, 14);
  for (const sz of [-1, 1])m.plane(x, .046, z + sz * 3.68, 4.18, .22, 'labelhazard', '#e5c16c', 8, 1);
  // Heavy chassis frame and axles.
  m.box(x, .64, z, 2.08, .30, 5.25, 'blackMetal', '#566163', 1, 1);
  m.box(x, .52, z + f * 2.66, 2.26, .28, .22, 'labelhazard', '#dfbc65', 4, 1);
  m.box(x, .52, z - f * 2.66, 2.22, .26, .20, 'blackMetal', '#495456', 1, 1);
  for (const dz of [-1.72, -.52, 1.65]) {
    const wz = z + f * dz;
    m.tube([x - 1.10, .46, wz], [x + 1.10, .46, wz], .11, .11, 'steel', iron, 8);
    for (const sx of [-1, 1]) {
      m.tube([x + sx * .88, .46, wz], [x + sx * 1.18, .46, wz], .45, .45, 'rubber', '#373e40', 12);
      m.tube([x + sx * 1.16, .46, wz], [x + sx * 1.21, .46, wz], .23, .23, 'steel', '#a3b0ad', 10)
    }
  }
  // Forward armored harbor cab.
  const cz = z + f * 1.88;
  m.box(x, 1.48, cz, 2.14, 1.38, 1.56, 'panel', '#d5a84e', 2, 1);
  m.box(x, 2.21, cz - f * .04, 2.08, .12, 1.48, 'steel', '#b7c0b3', 1, 1);
  m.box(x, 1.72, cz + f * .79, 1.88, .58, .06, 'white', '#2c4850', 0, 1);
  for (const sx of [-1, 1]) {
    m.box(x + sx * 1.08, 1.72, cz + f * .08, .05, .52, .94, 'white', '#32515a', 0, 1);
    m.box(x + sx * .76, 1.02, cz + f * .79, .34, .18, .06, 'white', '#fff2c2', 0, 3);
    m.box(x + sx * .96, .82, z - f * .35, .14, .22, 2.35, 'blackMetal', '#3e4a4c', 1, 1)
  }
  m.box(x, 1.02, cz + f * .79, .95, .36, .06, 'grate', '#394648', 2, 1);
  // Pressurized ammo-refinery cylindrical tank + hemispherical end caps.
  const ta = z - f * 2.26, tb = z + f * .86;
  m.tube([x, 1.66, ta], [x, 1.66, tb], .96, .96, 'steel', '#d7d9cb', 18, 1);
  m.ellipsoid(x, 1.66, ta, .94, .94, .34, 'steel', '#c3c8bc', 1, 14, 6);
  m.ellipsoid(x, 1.66, tb, .94, .94, .30, 'steel', '#c3c8bc', 1, 14, 6);
  // Reinforcement ribs, glowing refinery core strips, and side signage.
  for (const u of [-2.0, -1.1, -.2, .65]) {
    const rz = z + f * u;
    m.tube([x, 1.66, rz - .07], [x, 1.66, rz + .07], 1.01, 1.01, 'blackMetal', '#31494d', 18, 1);
    m.box(x, .82, rz, 1.65, .28, .22, 'steel', '#697879', 0, 1)
  }
  // Upper catwalk, refinery intake dome, and side fuel/ammo conduits.
  m.box(x, 2.66, z - f * .70, .92, .08, 2.86, 'grate', '#768684', 1, 1);
  for (const dz of [-1.55, -.70, .15])m.tube([x, 2.55, z + f * dz], [x, 2.83, z + f * dz], .26, .22, 'blackMetal', '#44585c', 12, 1);
  for (const sx of [-1, 1]) {
    m.tube([x + sx * .98, 1.24, z - f * 2.20], [x + sx * .98, 1.24, z + f * .76], .08, .08, 'steel', '#66c7b8', 8, 1);
    side(m, x + sx * 1.02, 1.72, z - f * .68, 2.25, 1.08, 'supply', sx);
    m.box(x + sx * 1.01, 1.08, z - f * .68, .06, .10, 2.7, 'white', '#7de8d8', 0, 3)
  }
  // Rear automated ammo dispenser bay and hose manifold.
  const rz = z - f * 2.48;
  m.box(x, 1.38, rz, 1.68, 1.02, .38, 'blackMetal', '#324246', 1, 1);
  m.box(x, 1.46, rz - f * .20, 1.18, .54, .06, 'white', '#75e4d4', 0, 3);
  for (const sx of [-.66, .66])m.tube([x + sx, 1.02, rz - f * .16], [x + sx, 1.82, rz - f * .16], .07, .07, 'steel', '#e0b85a', 8, 1)
}
function shore(m, lite = false) {
  const r = random(93);
  for (const radius of (lite ? [420] : [470, 355])) {
    const n = lite ? 44 : 140;
    let points = [];
    for (let i = 0; i <= n; i++) {
      const a = 2 * Math.PI * i / n;
      const shape = 18 + 14 * Math.sin(a * 3 + .5) + 8 * Math.sin(a * 9 + 1.7) + 4 * Math.sin(a * 19) + 3 * Math.sin(a * 32);
      const hh = radius >= 420 ? shape * .92 + 8 : shape * .57 - 1;
      points.push([Math.sin(a) * radius, hh, Math.cos(a) * radius])
    }
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[i + 1];
      m.quad([a[0], -4, a[2]], [b[0], -4, b[2]], b, a, 'white', radius >= 420 ? '#758d98' : '#667e82', 1, 1, 5, [0, 1, 0])
    }
  }
  const bCount = lite ? 20 : 85;
  for (let i = 0; i < bCount; i++) {
    const x = -200 + r() * 380, z = -211 - r() * 47, h = 2 + r() * 8;
    const w = 2+r()*9, d = 3+r()*9, tint = r()>.6 ? '#a1aaa3' : '#748c91';
    if (lite) {
      dockFace(m,x,h/2-.3,z+d/2,w,h,'south','white',tint);
      const side = x>0 ? -1 : 1;
      dockFace(m,x+side*w/2,h/2-.3,z,d,h,side<0?'west':'east','white',tint);
    } else m.box(x, h/2-.3, z, w, h, d, 'white', tint);
    if (!lite && i % 11 === 0)m.tube([x, 0, z], [x, h + 8 + r() * 12, z], .63, .49, 'white', '#9e9890', 8)
  }
}
export function buildHarbor(detail = 'full') {
  const lite = detail === 'lite';
  const m = new Mesh();
  shore(m, lite);
  // The playable flat apron is exactly 50 by 200 metres; quays beyond its painted limits are scenery.
  m.box(0, -1.55, 0, 50, 3.10, 200, 'seaWall', '#b4b9a9', 4.25);
  m.plane(0, .009, 0, 50, 200, 'dockslab', '#c6c4b5', 13, 52, 2);
  m.plane(2.0, .016, -1, 8.8, 198, 'asphalt', '#bec1b5', 10, 218, 2);
  m.plane(-19.82, .019, 0, 8.8, 198, 'roadpatch', '#c1c6b6', 5.2, 118, 2);
  if (!lite) {
    for (const x of [-23.8, -15.1]) {
      m.box(x, .033, 0, .13, .063, 199, 'blackMetal', '#c1c2ad', 1, 1);
      m.box(x + .17, .024, 0, .08, .035, 199, 'white', '#555c59')
    }
  }
  for (const x of [-24.44, 24.52])m.plane(x, .041, 0, .18, 198, 'white', '#c5ab66', 1, 1);
  if (!lite) {
    for (let z = -94; z <= 95; z += 9.4)m.plane(2.15, .038, z, .15, 3.2, 'paint', '#c1bfa2');
    for (const x of [-2.1, 6.05])m.plane(x, .037, 0, .13, 197, 'paint', '#c6bd99', 1, 130);
    for (const z of [-80, -54, -26, 3, 32, 59, 85]) {
      m.plane(21.9, .023, z, 1.1, 2.6, 'drain', '#a9b2a7', 1, 2);
      for (const sx of [7, 21])m.plane(sx, .037, z - 5, .115, 14.6, 'paint', '#d6b560', 1, 8);
      m.plane(14, .038, z + 2.2, 14.1, .135, 'paint', '#ccae65', 8, 1)
    }
    for (const z of [66, 1, -74]) {
      m.plane(3.8, .045, z, 2, 4.0, 'labelarrow', '#b3b8ac', 1, 1, 4);
      m.plane(-.45, .045, z + 4, 3.2, 3.1, 'labelyard', '#a0a89e', 1, 1, 4)
    }
    for (let j = 0; j < 7; j++)m.plane(2, .042, 37 + j * .65, 8.35, .30, 'paint', '#c8c5a8', 4, 1);
  }
  for (const z of [-99.58, 99.58]) {
    m.plane(0, .042, z, 49.5, .24, 'labelhazard', '#b7a56f', 24, 1);
    if (lite) {
      m.box(0, .72, z, 48, .12, .12, 'white', '#869589');
    } else {
      for (let k = -23; k <= 24; k += 3) {
        m.box(k, .50, z, .10, 1, .10, 'white', '#c2b383');
        m.box(k, .72, z, 3.00, .08, .08, 'white', '#869589')
      }
    }
  }
  if (!lite) {
    m.plane(-9, .044, 90, 5.2, 5.2, 'labelmark04', '#b9b7a8', 1, 1, 4);
    for (let z = -94; z <= 96; z += 19) {
      m.box(-23.7, .12, z, 1.0, .24, 1.24, 'tread', '#94948b');
      m.tube([-23.7, .24, z], [-23.7, .71, z], .36, .31, 'blackMetal', '#838e86', 12);
      m.box(-23.7, .71, z, .54, .25, 1.07, 'blackMetal', '#828c82');
      m.box(-25.16, -.63, z, .32, 1.58, 1.1, 'rubber', '#99a297')
    }
  }
  if (lite) {
    for (let z = -94; z <= 96; z += 19)
      m.box(-23.7,.43,z,.81,.86,1.1,'blackMetal','#939a88',1,1,false);
  }
  quayEdge(m, lite);
  drawDockFixtures(m, lite);
  for (const c of cargo)container(m, c[0], c[1], c[2], c[3], c[4], c[5], c[6], lite ? 0 : 1);
  for (const p of props)prop(m, p, lite);
  for (const t of tankers)supplyTanker(m, t, lite);
  for (const c of craneSites)crane(m, c.x, c.z, c.scale, c.number, !lite, lite);
  ship(m, lite);
  // A separate landside service strip, drainage verge and industrial buildings.
  m.box(68, -1.05, -2, 86, 2.0, 235, 'stoneWall', '#c0bfa9', 3);
  m.plane(67, -.025, -2, 84, 232, 'pebble', '#bab5a1', 32, 80);
  if (!lite) {
    m.plane(28, .005, 0, 4.9, 200, 'weeds', '#9d9a74', 3, 120);
    m.plane(32, .011, 0, 2.4, 198, 'chip', '#acaa9f', 1.2, 90);
    m.plane(30, .013, 26, 1.25, 20, 'moss', '#a5a783', 1, 16);
    m.plane(30, .015, -33, 2.7, 29, 'bank', '#a99d80', 2, 22);
  }
  // The rails are continuous extrusions; only fence posts need separate geometry.
  for (const y of (lite ? [1.1, 2.49] : [.53, 1.07, 1.61, 2.15, 2.49])) {
    const gauge = y > 2.4 ? .063 : .026;
    m.box(25.12,y,0,gauge,gauge,198,'white','#89998e');
  }
  const postCount = lite ? 19 : 36;
  for (let i=0; i<=postCount; i++) {
    const z = -99+i*(lite ? 198/postCount : 5.4);
    if (lite) {
      // The landward face is outside every playable camera angle.
      dockFace(m,25.06,1.27,z,.126,2.53,'west','white','#89978a');
      for (const s of [-1,1]) dockFace(m,25.12,1.27,z+s*.063,.126,2.53,s>0?'south':'north','white','#89978a');
    } else m.box(25.12,1.27,z,.126,2.53,.126,'white','#89978a',0,1,false);
  }
  warehouse(m, 45, 63, 21, 50, 8.3, '#b1ad9e', '#cdd4c8', 'cold', lite);
  warehouse(m, 48, 3, 26, 45, 10.5, '#b0aa9a', '#b9c2b9', 'works', lite);
  warehouse(m, 49, -90, 27, 35, 9.5, '#b4b09f', '#c6bba4', 'bonded', lite);
  for (const [x, z, rad, h] of [[43, -43, 6.2, 11], [58, -55, 7.5, 14], [73, -40, 7, 12], [63, -118, 5, 16]])tanks(m, x, z, rad, h, lite);
  if (!lite) {
    for (let z = -87; z < 98; z += 30)lamp(m, 24.15, z, -1, 12.4);
    for (const z of [-82, -10, 68])lamp(m, -24.2, z, 1, 10);
    for (let j = 0; j < 4; j++)for (let k = 0; k < 4; k++) {
      const x = 29 + j * 3.15, z = -113 - k * 13;
      container(m, x, z, 3, 12.1, 0, ['teal', 'red', 'blue', 'ivory'][(j + k) % 4], 'HBR', 0);
      if ((j + k) % 3)container(m, x, z, 3, 12.1, 2.62, ['blue', 'ochre', 'teal', 'red'][(j + k) % 4], 'TIDE', 0)
    }
    m.box(23, -1.55, -136, 90, 3.1, 56, 'seaWall', '#adb0a1', 4);
    m.plane(23, .009, -136, 90, 56, 'dockslab', '#aaa99b', 20, 15);
    crane(m, -11, -136, .82, '07', false);
    crane(m, -83, -186, .56, '05', false);
    m.box(-93, -1.6, -187, 94, 3.0, 19, 'seaWall', '#aeb3ac', 5);
    for (const x of [-3, 20]) {
      m.box(x, .96, 99.8, .17, 1.92, .15, 'white', iron);
      front(m, x, 1.66, 99.9, 1.18, .66, 'berth')
    }
  } else {
    for (let z = -75; z < 90; z += 60)lamp(m, 24.15, z, -1, 12.4, true);
    m.box(23, -1.55, -136, 90, 3.1, 56, 'seaWall', '#adb0a1', 4);
  }
  breakwater(m, lite);
  return m
}
export function titleCamera(time) {
  const scenes = [[[9, 8.3, 95], [5.3, 7.1, 86], [-13.6, 7.9, 8], [-15.4, 7.7, -2], 58], [[-42, 6.1, 81], [-38, 8.7, 68], [-12, 8.1, 10], [-10, 8.6, 2], 59], [[16.8, 5.4, 4], [18.3, 6.6, -5], [-17, 7.5, -47], [-18, 8.3, -50], 62]];
  const span = 20, shot = Math.floor(time / span) % 3, t = time % span / span, s = scenes[shot];
  return {
    pos: blend(s[0], s[1], t),
    target: blend(s[2], s[3], t),
    fov: s[4],
    shot,
    fade: Math.min(1, Math.max(0, (t - .972) / .028), 1) * .85 + (time > span ? Math.max(0, 1 - t / .028) * .85 : 0)
  }
}
