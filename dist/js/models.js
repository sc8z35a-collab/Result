import {Mesh, scale, add, sub, unit} from './geometry.js';
const rubber = '#485050', cloth = '#64716b', metal = '#9babad', ink = '#536067', ivory = '#c8c7ad';
function device(m, gun) {
  if (gun === 'DF1 OUT') {
    dfDevice(m);
    return
  }
  const long = gun === 'SW T' ? .52 : gun === 'SRA' ? .69 : .72;
  const w = gun === 'D1' ? .123 : .096, tag = gun === 'SW T' ? '#deaa58' : gun === 'SRA' ? '#67a69e' : '#c87b60';
  m.box(0, .015, -.075, w, .123, .35, 'blackMetal', '#a5aeb0', .36, 1);
  m.box(0, .084, -.076, w + .012, .048, .35, 'steel', metal, .28, 1);
  m.box(0, .015, -long * .59, w * .86, .092, long * .48, 'steel', '#8b9895', .25, 1);
  m.tube([0, .024, -long + .07], [0, .024, -long - .035], .042, .039, 'blackMetal', ink, 10);
  m.tube([0, .024, -long - .036], [0, .024, -long - .045], .026, .026, 'white', '#2d383c', 10);
  m.box(0, .027, -.222, w + .016, .064, .122, 'white', tag, 0, 1);
  m.box(0, -.089, .022, w * .76, .146, .088, 'rubber', rubber);
  m.box(0, -.075, -.14, w * .82, .118, gun === 'D1' ? .143 : .092, 'blackMetal', '#a5a89c');
  m.box(0, .127, -.05, w * .61, .055, .065, 'blackMetal', ink);
  m.box(0, .127, -long + .14, .023, .055, .036, 'white', tag);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++)m.box(s * (w / 2 + .005), .034, -.28 - i * .038, .009, .024, .017, 'blackMetal', ink);
    m.box(s * (w / 2 + .009), .047, -.073, .008, .018, .062, 'white', '#74c8b2', 0, 3)
  }
  if (gun !== 'SW T') {
    m.beam([0, .012, .082], [0, -.035, .225], w * .65, .066, 'white', ink);
    m.box(0, -.033, .2, w * .84, .145, .065, 'rubber', rubber)
  }
  if (gun === 'D1')m.tube([.040, .02, -long + .18], [.040, .02, -long - .003], .025, .025, 'steel', metal, 8)
}
// A fictional ceramic-bodied launcher. Its two illuminated channels distinguish
// the standard magazine and the independently replenished P1 cell.
function dfDevice(m) {
  const ceramic = '#bebda6', trim = '#5f7776', dark = '#454f52', copper = '#c49169';
  m.tube([0, .028, .09], [0, .03, -.46], .083, .065, 'steel', ceramic, 8);
  for (const sx of [-1, 1]) {
    m.beam([sx * .06, .01, .14], [sx * .054, .046, -.32], .039, .058, 'greenHull', trim);
    m.box(sx * .069, -.036, -.118, .031, .060, .30, 'blackMetal', '#9da79c');
    m.tube([sx * .052, -.026, -.31], [sx * .048, -.018, -.62], .033, .030, 'steel', trim, 10);
    for (let i = 0; i < 5; i++)m.box(sx * .087, -.021, -.025 - i * .036, .012, .014, .020, 'white', '#89d9ca', 0, 3)
  }
  m.tube([0, .022, -.42], [0, .032, -.66], .057, .042, 'blackMetal', '#9aa6a0', 10);
  m.tube([0, .032, -.615], [0, .032, -.674], .056, .047, 'steel', copper, 10);
  m.tube([0, .032, -.675], [0, .032, -.681], .028, .028, 'white', dark, 10);
  m.beam([0, -.038, .023], [0, -.154, .084], .073, .089, 'rubber', dark);
  m.tube([0, -.034, -.15], [0, -.13, -.17], .063, .069, 'greenHull', trim, 8);
  m.tube([.087, -.04, -.04], [.087, -.04, -.263], .028, .028, 'white', '#d79560', 8);
  m.beam([0, .032, .097], [0, -.045, .22], .045, .07, 'steel', trim);
  m.ellipsoid(0, -.044, .205, .048, .09, .045, 'rubber', dark, 0, 8, 4);
  m.box(0, .093, -.12, .056, .052, .11, 'blackMetal', dark);
  m.tube([0, .142, -.045], [0, .142, -.20], .053, .047, 'blackMetal', '#9aa8a2', 12);
  m.tube([0, .142, -.037], [0, .142, -.044], .044, .044, 'white', '#4a8180', 12);
  m.box(-.046, .14, -.116, .034, .041, .055, 'white', copper);
}
export function viewModel(gun) {
  const m = new Mesh();
  device(m, gun);
  m.ellipsoid(.012, -.104, .045, .060, .066, .097, 'rubber', '#727c73', 0, 10, 5);
  m.tube([.018, -.133, .077], [.085, -.237, .299], .065, .088, 'canvas', '#7c8273', 9);
  m.tube([.020, -.138, .093], [.026, -.156, .126], .072, .072, 'blackMetal', rubber, 9);
  m.ellipsoid(-.04, -.089, -.205, .066, .048, .088, 'rubber', '#727d76', 0, 10, 5);
  m.tube([-.055, -.11, -.189], [-.166, -.249, .008], .056, .072, 'canvas', '#899585', 8);
  return m
}
export function character(team, gun) {
  const m = new Mesh(), accent = team ? '#df8054' : '#55b9b4', light = team ? '#f2a16e' : '#88ded2';
  for (const side of [-1, 1]) {
    const x = side * .149;
    m.ellipsoid(x, .13, -.038, .119, .11, .19, 'rubber', rubber, 0, 10, 5);
    m.tube([x, .19, .018], [x, .56, .014], .086, .102, 'canvas', cloth, 9);
    m.ellipsoid(x, .52, -.04, .105, .09, .085, 'steel', '#848e83', 0, 8, 4);
    m.tube([x, .57, .017], [side * .13, .90, .014], .102, .13, 'canvas', '#869085', 9);
    m.box(x, .41, -.067, .115, .051, .04, 'white', accent)
  }
  m.ellipsoid(0, .91, .015, .251, .15, .172, 'blackMetal', '#89968a', 0, 12, 5);
  m.ellipsoid(0, 1.19, .008, .287, .342, .173, 'canvas', '#a2ac9c', 0, 14, 7);
  m.box(0, 1.20, -.14, .388, .287, .09, 'blackMetal', '#9aa8a1', 0, 1);
  m.box(0, 1.305, -.195, .34, .054, .022, 'white', accent);
  m.box(.097, 1.19, -.20, .091, .045, .024, 'white', light, 0, 3);
  m.tube([0, 1.43, 0], [0, 1.55, 0], .096, .10, 'rubber', rubber, 9);
  m.ellipsoid(0, 1.635, -.008, .161, .193, .151, 'steel', '#b0b8aa', 0, 14, 8);
  m.ellipsoid(0, 1.655, -.075, .163, .113, .119, 'blackMetal', '#667779', 1, 14, 6);
  m.box(0, 1.668, -.183, .215, .028, .022, 'white', light, 0, 3);
  m.ellipsoid(0, 1.754, .012, .174, .080, .157, 'steel', accent, 1, 12, 5);
  for (const s of [-1, 1]) {
    const a = [s * .253, 1.40, 0], e = [s * .323, 1.145, -.068], hand = [s === 1 ? .12 : -.04, 1.20, s === 1 ? -.26 : -.40];
    m.ellipsoid(...a, .118, .104, .114, 'steel', accent, 0, 10, 5);
    m.tube(a, e, .079, .085, 'canvas', cloth, 9);
    m.tube(e, hand, .077, .068, 'canvas', '#9ca598', 8);
    m.ellipsoid(...hand, .076, .065, .079, 'rubber', rubber, 0, 8, 4)
  }
  // The rounded left module is the shield charger; the vented right cassette is the ammo generator.
  m.box(0, 1.23, .177, .407, .404, .086, 'blackMetal', ink);
  m.tube([-.102, 1.032, .241], [-.102, 1.438, .241], .085, .085, 'steel', metal, 10);
  for (const y of [1.09, 1.21, 1.34])m.tube([-.102, y, .241], [-.102, y + .04, .241], .089, .089, 'white', '#77d4c6', 10, 3);
  m.box(.098, 1.224, .242, .163, .404, .14, 'blackMetal', '#969d8d');
  for (let j = 0; j < 4; j++)m.box(.098, 1.11 + j * .068, .317, .131, .022, .016, 'white', '#e1b163', 0, 1);
  m.transform = {origin: [.071, 1.255, -.26], right: [.85, 0, 0], up: [0, .85, 0], back: [0, 0, .85]};
  device(m, gun);
  m.transform = null;
  m.tube([.069, 1.408, -.285], [.069, 1.408, -.337], .029, .027, 'blackMetal', metal, 8);
  return m
}
export function movingDetails(match, time) {
  const m = new Mesh();
  for (let i = 0; i < 7; i++) {
    const a = time * (.041 + i * .0007) + i * .61,
      x = -54 + Math.sin(a) * (24 + i * 2.4),
      z = -39 + Math.cos(a) * 62 + i * 8,
      y = 22 + i * .67 + Math.sin(a * 3.2),
      b = Math.sin(time * 3 + i) * .22;
    m.tri([x - .62, y + b, z + .16], [x, y, z], [x - .30, y + .1, z - .07], 'white', '#d4d4c8', 5, [0, 1, 0]);
    m.tri([x + .62, y + b, z + .14], [x + .31, y + .08, z - .08], [x, y, z], 'white', '#d4d4c8', 5, [0, 1, 0])
  }
  if (match) {
    for (const s of match.shots) {
      const tail = add(s.p, scale(s.dir, -Math.min(2.65, s.speed * .007)));
      m.beam(tail, s.p, .026, .026, 'white', s.team ? '#ffb678' : '#acf7df', 3)
    }
    for (const e of match.effects) {
      const r = .034 + (.14 - e.life) * .55;
      for (let k = 0; k < 3; k++) {
        const dir = [Math.sin(k * 5.41 + e.p[0]) * .85, .65 + k * .27, Math.cos(k * 4.82 + e.p[2]) * .7];
        m.beam(add(e.p, scale(dir, r * .9)), add(e.p, scale(dir, r * 2.4)), .018, .018, 'white', e.target ? '#b2ffe7' : '#ffd99a', 3)
      }
    }
  }
  return m
}
