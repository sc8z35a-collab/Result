import {Mesh, scale, add, sub, unit, cross, dot, clamp} from './geometry.js';
import {obstruction} from './yard.js';
import {machConeHalfAngle} from './magnus.js';
const rubber = '#485050', cloth = '#64716b', metal = '#9babad', ink = '#536067', ivory = '#c8c7ad';

// Helper: build an orthonormal basis (u, v, n) around an arbitrary axis.
function basisOf(axis) {
  const n = unit(axis);
  const u = unit(cross(n, Math.abs(n[1]) > .92 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(n, u);
  return [u, v, n];
}

// Helper: draw a crisp polygonal glowing shockwave / energy ring around center oriented along axis.
function ring(m, center, axis, radius, thick, segs, tint, kind = 3) {
  const [u, v] = basisOf(axis);
  let prev = add(center, scale(u, radius));
  for (let i = 1; i <= segs; i++) {
    const a = i / segs * Math.PI * 2;
    const cur = add(center, add(scale(u, Math.cos(a) * radius), scale(v, Math.sin(a) * radius)));
    m.beam(prev, cur, thick, thick, 'white', tint, kind);
    prev = cur;
  }
}

// Helper: crisp HDR radial lens-flare / impact glare star oriented around axis.
function starFlare(m, center, axis, radius, thick, rays, tint, rot = 0, kind = 3) {
  const [u, v, n] = basisOf(axis);
  for (let i = 0; i < rays; i++) {
    const a = rot + i / rays * Math.PI;
    const dir = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    const p0 = add(center, scale(dir, -radius));
    const p1 = add(center, scale(dir, radius));
    m.beam(p0, p1, thick, thick, 'white', tint, kind);
  }
  // Short axial glare spike for 3D volumetric flash from oblique angles
  m.beam(add(center, scale(n, -radius * .45)), add(center, scale(n, radius * .65)), thick * .9, thick * .9, 'white', tint, kind);
}

// Helper: curved 7-cell geodesic hexagonal energy shield lattice centered on impact normal.
function hexPatch(m, center, normal, cellR, thick, tint, outerTint, kind = 3) {
  const [u, v, n] = basisOf(normal);
  ring(m, center, n, cellR, thick, 6, tint, kind);
  const step = cellR * 1.72;
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + Math.PI / 6;
    const dir = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    // Curve slightly inward along -n to wrap around a tactical body shield
    const c = add(add(center, scale(dir, step)), scale(n, -cellR * .42));
    const cellN = unit(add(n, scale(dir, .36)));
    ring(m, c, cellN, cellR * .86, thick * .78, 6, outerTint || tint, kind);
  }
}

// Helper: flat normal-aligned crater / molten scorch disc.
function scorchDisc(m, center, normal, radius, tint, segs = 8, kind = 3) {
  const [u, v, n] = basisOf(normal);
  let prev = add(center, scale(u, radius));
  for (let i = 1; i <= segs; i++) {
    const a = i / segs * Math.PI * 2;
    const cur = add(center, add(scale(u, Math.cos(a) * radius), scale(v, Math.sin(a) * radius)));
    m.tri(center, prev, cur, 'white', tint, kind, n);
    prev = cur;
  }
}

// MS10: Hyper-velocity electromagnetic rail carbine (fastest projectile velocity: 180, auto fire rate: 130).
function ms10Device(m) {
  const frame = '#39464d', alloy = '#b5c4c8', accent = '#58c9e8', gold = '#edc060', dark = '#242f34';
  // Angular main receiver & upper rail spine
  m.box(0, .016, -.085, .092, .112, .38, 'blackMetal', frame, .34, 1);
  m.box(0, .082, -.115, .104, .038, .44, 'steel', alloy, .25, 1);
  // Twin upper & lower magnetic accelerator rails extending forward
  m.box(0, .054, -.50, .052, .026, .46, 'steel', alloy, .22, 1);
  m.box(0, -.008, -.48, .056, .028, .42, 'blackMetal', frame, .24, 1);
  // Central recessed precision rail barrel & glowing accelerator channel
  m.tube([0, .023, -.26], [0, .023, -.79], .024, .021, 'blackMetal', dark, 10, 1);
  m.box(0, .023, -.49, .018, .022, .42, 'white', '#7deaff', 0, 3);
  // Finned hyper-velocity muzzle brake
  m.box(0, .023, -.76, .068, .056, .11, 'steel', '#96a8ad', .2, 1);
  m.tube([0, .023, -.815], [0, .023, -.845], .028, .024, 'blackMetal', dark, 10, 1);
  // Glowing capacitor coils & gold voltage accents along both flanks
  for (const sx of [-1, 1]) {
    m.box(sx * .050, .024, -.46, .012, .058, .36, 'steel', '#697c84', 0, 1);
    for (let i = 0; i < 6; i++) {
      m.box(sx * .058, .024, -.31 - i * .062, .009, .020, .028, 'white', i % 2 ? accent : '#a8f6ff', 0, 3);
    }
    m.box(sx * .052, .064, -.10, .009, .014, .22, 'white', gold, 0, 3);
  }
  // Angled 24-round high-pressure magazine & ergonomic grip
  m.beam([0, -.035, -.14], [0, -.155, -.20], .064, .088, 'blackMetal', '#3a464a', 1);
  m.box(0, -.115, -.18, .068, .022, .092, 'white', gold, 0, 1);
  m.beam([0, -.038, .022], [0, -.152, .072], .062, .082, 'rubber', rubber, 0);
  // Lightweight skeleton stock
  m.beam([0, .048, .095], [0, .022, .255], .038, .028, 'steel', alloy, 1);
  m.beam([0, -.016, .095], [0, -.072, .245], .032, .026, 'blackMetal', frame, 1);
  m.box(0, -.026, .258, .064, .135, .046, 'rubber', dark, 0, 0);
  // Open-frame reflex holo-sight with glowing cyan aiming reticle pip
  m.box(0, .112, -.09, .066, .024, .115, 'blackMetal', dark, 0, 1);
  for (const sx of [-1, 1]) m.box(sx * .030, .148, -.09, .010, .054, .072, 'steel', alloy, 0, 1);
  m.box(0, .174, -.09, .068, .010, .072, 'steel', alloy, 0, 1);
  m.box(0, .146, -.09, .008, .008, .008, 'white', '#9cfaff', 0, 3);
  m.box(0, .118, -.68, .016, .034, .032, 'white', gold, 0, 3);
}

// RD40: Player-only twin-linked supersonic carbine with 130-round quad-drum mag & D01 SENSOR array pod.
function rd40Device(m) {
  const obsidian = '#242c30', titanium = '#6c7c82', crimson = '#ff5464', ember = '#ffb85c', sensorGlow = '#4fffe0';
  // Broad sculpted twin-linked receiver chassis
  m.box(0, .020, -.12, .128, .102, .42, 'blackMetal', obsidian, .28, 1);
  m.box(0, .076, -.10, .114, .036, .38, 'steel', titanium, .20, 1);
  // Twin parallel long supersonic barrels + crimson acceleration rails + twin compensators
  for (const sx of [-1, 1]) {
    const bx = sx * .036;
    m.box(bx, .026, -.48, .038, .062, .38, 'blackMetal', '#333e44', .18, 1);
    m.tube([bx, .026, -.28], [bx, .026, -.80], .020, .018, 'steel', '#4e5c62', 10, 1);
    m.box(bx, .026, -.78, .034, .036, .095, 'steel', '#96a6ac', .16, 1);
    m.tube([bx, .026, -.828], [bx, .026, -.848], .022, .020, 'blackMetal', obsidian, 8, 1);
    // Glowing crimson/amber twin acceleration side strips
    for (let i = 0; i < 5; i++) {
      m.box(sx * .060, .026, -.33 - i * .072, .009, .018, .034, 'white', i % 2 ? ember : crimson, 0, 3);
    }
    m.box(sx * .066, .054, -.12, .008, .014, .24, 'white', crimson, 0, 3);
  }
  // Center thermal bridge between twin barrels
  m.box(0, .026, -.50, .026, .032, .40, 'steel', '#526066', 0, 1);
  m.box(0, .048, -.52, .014, .012, .34, 'white', ember, 0, 3);
  // 130-round twin-drum high-capacity magazine + ergonomic angled grip
  for (const sx of [-1, 1]) {
    m.tube([sx * .058, -.105, -.13], [sx * .058, -.105, -.25], .052, .052, 'blackMetal', '#303a3f', 10, 1);
    m.box(sx * .096, -.105, -.19, .012, .028, .072, 'white', ember, 0, 3);
  }
  m.box(0, -.072, -.19, .084, .082, .112, 'blackMetal', obsidian, 0, 1);
  m.beam([0, -.038, .022], [0, -.152, .076], .064, .084, 'rubber', rubber, 0);
  // Reinforced dual-strut skeleton stock
  m.beam([0, .046, .095], [0, .020, .255], .040, .028, 'steel', titanium, 1);
  m.beam([0, -.018, .095], [0, -.072, .245], .034, .026, 'blackMetal', obsidian, 1);
  m.box(0, -.026, .258, .068, .135, .046, 'rubber', '#222a2d', 0, 0);
  // Top D01 SENSOR through-wall optical-radar array pod (glowing emerald-cyan scanner + crimson targeting frame)
  m.box(0, .114, -.10, .094, .036, .165, 'blackMetal', obsidian, 0, 1);
  m.box(0, .148, -.10, .078, .036, .125, 'steel', '#46545a', .15, 1);
  m.tube([0, .148, -.148], [0, .148, -.175], .024, .020, 'white', sensorGlow, 10, 3);
  for (const sx of [-1, 1]) {
    m.box(sx * .044, .148, -.095, .010, .024, .085, 'white', crimson, 0, 3);
  }
  m.box(0, .120, -.68, .022, .030, .036, 'white', sensorGlow, 0, 3);
}

// RD30: Open-access twin-linked 80-round squad carbine with ARV1.1 mini rail module.
function rd30Device(m) {
  const slate = '#2d373d', alloy = '#78888d', amber = '#ffaa4a', teal = '#5ee8d4';
  m.box(0, .020, -.10, .118, .096, .39, 'blackMetal', slate, .24, 1);
  m.box(0, .072, -.09, .104, .032, .35, 'steel', alloy, .18, 1);
  // Twin parallel medium barrels + compact twin brakes
  for (const sx of [-1, 1]) {
    const bx = sx * .032;
    m.box(bx, .025, -.43, .034, .054, .32, 'blackMetal', '#3a464c', .16, 1);
    m.tube([bx, .025, -.26], [bx, .025, -.72], .019, .017, 'steel', '#59686e', 9, 1);
    m.box(bx, .025, -.70, .030, .032, .080, 'steel', '#99a8ad', .14, 1);
    for (let i = 0; i < 4; i++) {
      m.box(sx * .054, .025, -.31 - i * .070, .008, .016, .030, 'white', i % 2 ? teal : amber, 0, 3);
    }
  }
  m.box(0, .025, -.44, .022, .028, .34, 'steel', '#56646a', 0, 1);
  // 80-round compact twin drum mag + grip + stock
  for (const sx of [-1, 1]) {
    m.tube([sx * .048, -.098, -.13], [sx * .048, -.098, -.23], .042, .042, 'blackMetal', '#354046', 9, 1);
  }
  m.box(0, -.068, -.18, .074, .072, .096, 'blackMetal', slate, 0, 1);
  m.beam([0, -.036, .022], [0, -.148, .072], .060, .078, 'rubber', rubber, 0);
  m.beam([0, .040, .090], [0, .014, .235], .036, .026, 'steel', alloy, 1);
  m.box(0, -.024, .238, .062, .125, .042, 'rubber', '#242c30', 0, 0);
  // Compact ARV1.1 mini micro-optic rail
  m.box(0, .106, -.09, .072, .028, .125, 'blackMetal', slate, 0, 1);
  m.box(0, .126, -.09, .048, .024, .085, 'steel', '#4e5d63', 0, 1);
  m.box(0, .126, -.135, .026, .014, .014, 'white', amber, 0, 3);
}

// RD20: Agile 20-round full-auto tactical carbine with ARV1.1 precision guidance module.
function rd20Device(m) {
  const dark = '#263036', steel = '#7d8e92', cyan = '#54f0d8', gold = '#f5ca64';
  m.box(0, .020, -.09, .092, .092, .35, 'blackMetal', dark, .22, 1);
  m.box(0, .068, -.09, .082, .030, .33, 'steel', steel, .18, 1);
  m.box(0, .024, -.37, .066, .058, .28, 'steel', '#4a5a60', .16, 1);
  m.tube([0, .024, -.26], [0, .024, -.64], .024, .021, 'blackMetal', '#333f45', 10, 1);
  m.box(0, .024, -.62, .044, .040, .082, 'steel', '#96a8ad', .14, 1);
  for (const sx of [-1, 1]) {
    m.box(sx * .038, .028, -.35, .008, .016, .22, 'white', cyan, 0, 3);
    m.box(sx * .048, .052, -.10, .008, .012, .18, 'white', gold, 0, 3);
  }
  // Angled 20-round stick mag + grip + compact stock
  m.beam([0, -.034, -.14], [0, -.145, -.19], .052, .072, 'blackMetal', '#344046', 1);
  m.box(0, -.108, -.175, .056, .018, .076, 'white', gold, 0, 1);
  m.beam([0, -.036, .022], [0, -.146, .070], .056, .074, 'rubber', rubber, 0);
  m.beam([0, .036, .086], [0, .008, .220], .034, .024, 'steel', steel, 1);
  m.box(0, -.022, .224, .056, .118, .040, 'rubber', '#222b2f', 0, 0);
  // ARV1.1 sleek top holo sight
  m.box(0, .102, -.08, .060, .022, .110, 'blackMetal', dark, 0, 1);
  for (const sx of [-1, 1]) m.box(sx * .026, .134, -.08, .009, .046, .066, 'steel', steel, 0, 1);
  m.box(0, .156, -.08, .060, .009, .066, 'steel', steel, 0, 1);
  m.box(0, .132, -.08, .008, .008, .008, 'white', cyan, 0, 3);
}

// DF40 II: Player-only flagship quad-barrel smart carbine with 350-round quad-helix drum,
// ARV1.3 convergent 4-barrel accelerator array & Auto-Aim 1.4 overdrive thermal radiator pod.
function df40iiDevice(m) {
  const obsidian = '#1f2830', ceramic = '#c8d0cc', titanium = '#768894', violet = '#8672ff', cyan = '#52f6ff', gold = '#ffd066';
  // Sculpted carbon-ceramic hybrid flagship receiver chassis
  m.box(0, .022, -.11, .142, .112, .44, 'blackMetal', obsidian, .28, 1);
  m.box(0, .082, -.10, .126, .036, .40, 'steel', ceramic, .22, 1);
  // Quad-barrel 2x2 accelerator cluster (upper-L, upper-R, lower-L, lower-R)
  const quadBarrels = [
    [-.036, .044, -.85, -.82],
    [.036, .044, -.85, -.82],
    [-.032, .004, -.82, -.79],
    [.032, .004, -.82, -.79]
  ];
  for (let b = 0; b < quadBarrels.length; b++) {
    const [bx, by, len, comp] = quadBarrels[b];
    const isTop = b < 2;
    m.box(bx, by, -.48, .034, .034, .40, 'blackMetal', '#2e3a44', .18, 1);
    m.tube([bx, by, -.28], [bx, by, len], .017, .015, 'steel', '#5b6c76', 9, 1);
    m.box(bx, by, comp, .030, .030, .092, 'steel', '#a2b4bc', .16, 1);
    m.tube([bx, by, len - .022], [bx, by, len - .038], .019, .017, 'blackMetal', obsidian, 8, 1);
    // Glowing ARV1.3 plasma conduits running along each of the 4 barrels
    for (let i = 0; i < 4; i++) {
      const stripCol = isTop ? (i % 2 ? gold : cyan) : (i % 2 ? cyan : violet);
      m.box(bx + Math.sign(bx) * .019, by + (isTop ? .012 : -.010), -.33 - i * .092, .008, .012, .034, 'white', stripCol, 0, 3);
    }
  }
  // Central quad-convergence magnetic yoke & dorsal thermal cooling fins (expand on lock/AA1.4!)
  m.box(0, .024, -.52, .054, .044, .42, 'steel', titanium, .16, 1);
  m.box(0, .024, -.54, .020, .016, .36, 'white', cyan, 0, 3);
  for (const sx of [-1, 1]) {
    // Flank overdrive thermal radiator fins (x > 0.05 -> animated by shaders.js uAnim rail pulse!)
    m.box(sx * .072, .048, -.16, .014, .034, .28, 'steel', '#485862', .15, 1);
    m.box(sx * .078, .054, -.16, .009, .014, .24, 'white', violet, 0, 3);
    m.box(sx * .076, .028, -.16, .008, .010, .20, 'white', gold, 0, 3);
  }
  // 350-round quad-helix high-capacity drum magazine + ergonomic grip
  for (const sx of [-1, 1]) {
    m.tube([sx * .066, -.106, -.11], [sx * .066, -.106, -.28], .058, .058, 'blackMetal', '#2a353d', 10, 1);
    m.box(sx * .108, -.106, -.195, .012, .032, .096, 'white', cyan, 0, 3);
  }
  // Central twin under-slung helical drum cores
  m.tube([0, -.126, -.12], [0, -.126, -.29], .050, .050, 'steel', '#3d4c55', 10, 1);
  m.box(0, -.164, -.205, .036, .012, .100, 'white', gold, 0, 3);
  m.box(0, -.070, -.195, .096, .084, .128, 'blackMetal', obsidian, 0, 1);
  m.beam([0, -.038, .024], [0, -.154, .078], .064, .086, 'rubber', rubber, 0);
  // Dual-strut ceramic-titanium counterbalance stock
  m.beam([0, .048, .098], [0, .022, .265], .042, .030, 'steel', ceramic, 1);
  m.beam([0, -.018, .098], [0, -.074, .252], .034, .026, 'blackMetal', obsidian, 1);
  m.box(0, -.026, .268, .070, .138, .048, 'rubber', '#1e262b', 0, 0);
  // Top ARV1.3 Optical Prism + Auto-Aim 1.4 Overdrive Core Pod (y > 0.095 -> animated by shader pod deploy!)
  m.box(0, .118, -.10, .106, .038, .178, 'blackMetal', obsidian, 0, 1);
  m.box(0, .154, -.10, .088, .038, .136, 'steel', '#465864', .16, 1);
  m.tube([0, .156, -.152], [0, .156, -.186], .026, .022, 'white', cyan, 12, 3);
  for (const sx of [-1, 1]) {
    m.box(sx * .050, .154, -.095, .011, .026, .096, 'white', violet, 0, 3);
    m.box(sx * .034, .176, -.10, .010, .010, .082, 'white', gold, 0, 3);
  }
  m.box(0, .124, -.72, .024, .032, .038, 'white', cyan, 0, 3);
}

// RD 50: Heavy-duty 50-round full-auto carbine with rapid-regen drum cell & cooling-fin heavy barrel (NO auto-aim module).
function rd50Device(m) {
  const gunmetal = '#2b3235', olive = '#525d52', brass = '#d9b252', steel = '#8c999c';
  // Heavy milled upper/lower receiver
  m.box(0, .022, -.10, .110, .102, .40, 'blackMetal', gunmetal, .22, 1);
  m.box(0, .076, -.09, .096, .032, .36, 'steel', olive, .18, 1);
  // Ribbed heat-dissipating heavy barrel shroud + single heavy barrel + muzzle brake
  m.box(0, .025, -.42, .078, .068, .32, 'blackMetal', '#384144', .16, 1);
  for (let i = 0; i < 4; i++) {
    m.box(0, .025, -.31 - i * .068, .086, .074, .016, 'steel', steel, .12, 1);
  }
  m.tube([0, .025, -.28], [0, .025, -.74], .026, .023, 'steel', '#5e6b70', 10, 1);
  m.box(0, .025, -.72, .048, .044, .088, 'steel', '#a2afb3', .14, 1);
  // Rapid-regen brass-amber charge strips along flank (signals 3.2/s rapid ammo regeneration)
  for (const sx of [-1, 1]) {
    m.box(sx * .058, .046, -.10, .009, .014, .22, 'white', brass, 0, 3);
    m.box(sx * .044, .025, -.42, .008, .012, .20, 'white', '#f2cf72', 0, 3);
  }
  // Oversized 50-round staggered extended box-drum magazine
  m.box(0, -.094, -.165, .076, .155, .112, 'blackMetal', '#333b3e', .16, 1);
  m.box(0, -.142, -.165, .082, .026, .118, 'steel', brass, .12, 1);
  for (const sx of [-1, 1]) {
    m.box(sx * .041, -.092, -.165, .008, .078, .018, 'white', brass, 0, 3);
  }
  // Ergonomic grip + solid recoil-dampening stock
  m.beam([0, -.036, .024], [0, -.150, .074], .060, .078, 'rubber', rubber, 0);
  m.beam([0, .042, .092], [0, .014, .248], .040, .028, 'steel', olive, 1);
  m.beam([0, -.016, .092], [0, -.068, .238], .030, .024, 'blackMetal', gunmetal, 1);
  m.box(0, -.026, .252, .064, .130, .044, 'rubber', '#22292c', 0, 0);
  // Clean mechanical open iron/reflex bridge (no auto-aim sensor pod)
  m.box(0, .106, -.08, .060, .020, .115, 'blackMetal', gunmetal, 0, 1);
  for (const sx of [-1, 1]) m.box(sx * .026, .134, -.08, .008, .040, .052, 'steel', steel, 0, 1);
  m.box(0, .122, -.66, .016, .034, .024, 'steel', brass, 0, 1);
}

function device(m, gun) {
  if (gun === 'DF1 OUT') {
    dfDevice(m);
    return;
  }
  if (gun === 'DF40 II') {
    df40iiDevice(m);
    return;
  }
  if (gun === 'MS10') {
    ms10Device(m);
    return;
  }
  if (gun === 'RD40') {
    rd40Device(m);
    return;
  }
  if (gun === 'RD 50') {
    rd50Device(m);
    return;
  }
  if (gun === 'RD30') {
    rd30Device(m);
    return;
  }
  if (gun === 'RD20') {
    rd20Device(m);
    return;
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
    for (let i = 0; i < 4; i++) m.box(s * (w / 2 + .005), .034, -.28 - i * .038, .009, .024, .017, 'blackMetal', ink);
    m.box(s * (w / 2 + .009), .047, -.073, .008, .018, .062, 'white', '#74c8b2', 0, 3);
  }
  if (gun !== 'SW T') {
    m.beam([0, .012, .082], [0, -.035, .225], w * .65, .066, 'white', ink);
    m.box(0, -.033, .2, w * .84, .145, .065, 'rubber', rubber);
  }
  if (gun === 'D1') m.tube([.040, .02, -long + .18], [.040, .02, -long - .003], .025, .025, 'steel', metal, 8);
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
    for (let i = 0; i < 5; i++) m.box(sx * .087, -.021, -.025 - i * .036, .012, .014, .020, 'white', '#89d9ca', 0, 3);
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

export function muzzleOffset(gun) {
  if (gun === 'MS10') return [0, .024, -.86];
  if (gun === 'DF40 II') return [0, .024, -.88];
  if (gun === 'RD40') return [0, .026, -.85];
  if (gun === 'RD 50') return [0, .025, -.76];
  if (gun === 'RD30') return [0, .025, -.75];
  if (gun === 'RD20') return [0, .024, -.67];
  if (gun === 'DF1 OUT') return [0, .032, -.70];
  if (gun === 'SW T') return [0, .024, -.58];
  if (gun === 'SRA') return [0, .024, -.75];
  return [0, .024, -.78];
}

// Local-space crisp, non-obstructive 3D muzzle flash attached to first-person weapon barrel tip(s).
export function muzzleFlashMesh(gun, intensity, seed, extra = false, lite = false) {
  const m = new Mesh();
  if (intensity <= .01) return m;
  const [mx0, my0, mz0] = muzzleOffset(gun);
  const tips = gun === 'DF40 II'
    ? [[mx0 - .036, .044, -.87], [mx0 + .036, .044, -.87], [mx0 - .032, .004, -.84], [mx0 + .032, .004, -.84]]
    : gun === 'RD40' ? [[mx0 - .036, my0, mz0], [mx0 + .036, my0, mz0]]
    : gun === 'RD30' ? [[mx0 - .032, my0, mz0], [mx0 + .032, my0, mz0]]
    : [[mx0, my0, mz0]];
  const s = intensity * (gun === 'MS10' ? .92 : gun === 'DF40 II' ? .56 : gun === 'RD40' ? .66 : gun === 'RD 50' ? .72 : gun === 'RD30' ? .60 : gun === 'D1' ? .78 : .70);
  const coreCol = gun === 'MS10' ? '#e8ffff' : gun === 'DF40 II' ? '#f4f0ff' : gun === 'RD40' ? '#fff4ea' : gun === 'RD 50' ? '#fff8df' : gun === 'RD30' ? '#fff6e4' : (gun === 'DF1 OUT' || gun === 'RD20') ? '#dcfff7' : '#fff8dc';
  const outerCol = gun === 'MS10' ? '#4de2ff' : gun === 'DF40 II' ? '#8c74ff' : gun === 'RD40' ? '#ff5c5c' : gun === 'RD 50' ? '#f0c454' : gun === 'RD30' ? '#ffad4e' : gun === 'RD20' ? '#58f0d8' : gun === 'DF1 OUT' ? '#6de8d5' : gun === 'SRA' ? '#ffcf76' : '#ffaa4e';
  const rot = (seed * 1.618) % 6.28;
  for (let b = 0; b < tips.length; b++) {
    const [mx, my, mz] = tips[b];
    const bRot = rot + b * .75;
    if (lite) {
      m.beam([mx, my, mz], [mx, my, mz - .20 * s], .028 * s, .028 * s, 'white', coreCol, 3);
      for (let i = 0; i < 2; i++) {
        const a = bRot + i * Math.PI * .5;
        const cx = Math.cos(a) * .095 * s, cy = Math.sin(a) * .095 * s;
        m.beam([mx - cx, my - cy, mz - .02 * s], [mx + cx, my + cy, mz - .02 * s], .015 * s, .012 * s, 'white', outerCol, 3);
      }
      continue;
    }
    const blades = 3;
    m.ellipsoid(mx, my, mz - .04 * s, .036 * s, .036 * s, .068 * s, 'white', coreCol, 3, 6, 3);
    m.tube([mx, my, mz], [mx, my, mz - .24 * s], .032 * s, .005, 'white', outerCol, 6, 3);
    for (let i = 0; i < blades; i++) {
      const a = bRot + i * Math.PI / blades;
      const len = (.10 + ((i * 37 + seed + b * 5) % 5) * .014) * s;
      const cx = Math.cos(a) * len, cy = Math.sin(a) * len;
      m.beam([mx - cx, my - cy, mz - .02 * s], [mx + cx, my + cy, mz - .02 * s], .015 * s, .011 * s, 'white', outerCol, 3);
    }
  }
  return m;
}

export function viewModel(gun) {
  const m = new Mesh();
  device(m, gun);
  m.ellipsoid(.012, -.104, .045, .060, .066, .097, 'rubber', '#727c73', 0, 10, 5);
  m.tube([.018, -.133, .077], [.085, -.237, .299], .065, .088, 'canvas', '#7c8273', 9);
  m.tube([.020, -.138, .093], [.026, -.156, .126], .072, .072, 'blackMetal', rubber, 9);
  m.ellipsoid(-.04, -.089, -.205, .066, .048, .088, 'rubber', '#727d76', 0, 10, 5);
  m.tube([-.055, -.11, -.189], [-.166, -.249, .008], .056, .072, 'canvas', '#899585', 8);
  return m;
}

export function character(team, gun, variant = 'standard', detail = 'high') {
  const m = new Mesh();
  const isSpy = variant === 'spy';
  const hi = detail !== 'low';
  const seg = hi ? 12 : 7;
  const eSeg = hi ? 14 : 8;
  const eBand = hi ? 7 : 4;
  const cSeg = hi ? 8 : 5;
  const ribs = hi ? 4 : 2;

  // Color palette: Standard Team (Cyan / Orange) vs Elite NV2.1 Spy (Midnight Stealth Carbon + Emerald-Cyan Tri-Optic)
  const accent = isSpy ? '#28e6c6' : (team ? '#df8054' : '#55b9b4');
  const light = isSpy ? '#72fff0' : (team ? '#f2a16e' : '#88ded2');
  const darkArmor = isSpy ? '#222d33' : '#384347';
  const midArmor = isSpy ? '#324148' : '#526065';
  const plate = isSpy ? '#495a61' : '#8c9b95';
  const vest = isSpy ? '#364449' : '#96a395';
  const suitDark = isSpy ? '#2a353a' : '#5b6863';
  const suitMid = isSpy ? '#39474d' : '#7b877e';
  const suitLight = isSpy ? '#445359' : '#8f9b8d';
  const gasketCol = '#272f32';
  const jointMetal = isSpy ? '#5e7077' : '#657379';
  const steelPin = '#c2d1d5';
  const strapCol = '#2d3638';
  const pouchCol = isSpy ? '#2d3b40' : '#52605b';
  const helmetShell = isSpy ? '#2d3b42' : '#aeb6a8';
  const visorTint = isSpy ? '#1a383c' : '#4a5c60';

  if (detail === 'lite') {
    // Ultra-low-poly 16-bone silhouette LOD for Lightweight Mode (>95% vertex reduction, full 16-bone rig preserved)
    for (const side of [-1, 1]) {
      const legX = side * .130;
      const baseBone = side < 0 ? 9 : 12;
      m.boneOffset = baseBone * 10;
      m.box(legX, .710, .008, .165, .380, .170, 'canvas', suitMid, 0, 0);
      m.boneOffset = (baseBone + 1) * 10;
      m.box(legX, .315, .006, .135, .410, .145, 'canvas', suitDark, 0, 0);
      m.box(legX, .500, -.072, .090, .105, .040, 'blackMetal', darkArmor, 0, 1);
      m.boneOffset = (baseBone + 2) * 10;
      m.box(legX, .055, -.036, .125, .110, .255, 'rubber', darkArmor, 0, 0);
    }
    // Pelvis (0), Abdomen (1), Chest (2), Neck (3), Head/Helmet (4)
    m.boneOffset = 0;
    m.box(0, .925, .008, .340, .175, .210, 'canvas', suitDark, 0, 0);
    m.boneOffset = 10;
    m.box(0, 1.080, .008, .300, .170, .195, 'canvas', suitMid, 0, 0);
    m.boneOffset = 20;
    m.box(0, 1.300, .006, .390, .290, .240, 'steel', vest, 0, 1);
    m.box(0, 1.330, -.124, .210, .140, .030, 'steel', isSpy ? darkArmor : plate, 0, 1);
    m.box(0, 1.385, -.140, isSpy ? .150 : .110, .024, .016, 'white', accent, 0, 3);
    m.box(0, 1.310, .148, .220, .230, .095, 'canvas', isSpy ? darkArmor : pouchCol, 0, 0);
    m.boneOffset = 30;
    m.box(0, 1.495, .002, .125, .115, .125, 'rubber', gasketCol, 0, 0);
    m.boneOffset = 40;
    m.box(0, 1.665, .000, .245, .255, .265, 'steel', helmetShell, 0, 1);
    m.box(0, 1.655, -.136, .190, .078, .032, 'blackMetal', visorTint, 0, 1);
    m.box(0, 1.662, -.154, isSpy ? .150 : .130, .024, .014, 'white', isSpy ? light : accent, 0, 3);
    if (isSpy) {
      // Distinctive stealth NVG brow silhouette even in Lightweight Mode
      m.box(0, 1.780, -.130, .140, .052, .075, 'blackMetal', darkArmor, 0, 1);
    }
    // Arms: Left Upper (5) / Forearm (6), Right Upper (7) / Forearm (8)
    const liteArms = [
      {s: -1, bUp: 5, bLo: 6, sh: [-.225, 1.400, .000], el: [-.210, 1.160, -.165], hn: [.035, 1.205, -.395]},
      {s: 1, bUp: 7, bLo: 8, sh: [.225, 1.400, .000], el: [.265, 1.145, -.065], hn: [.072, 1.170, -.240]}
    ];
    for (const arm of liteArms) {
      m.boneOffset = arm.bUp * 10;
      m.box(arm.sh[0] + arm.s * .02, arm.sh[1] + .01, arm.sh[2], .130, .120, .145, 'steel', isSpy ? darkArmor : accent, 0, 1);
      m.beam(arm.sh, arm.el, .062, .062, 'canvas', suitDark, 0);
      m.boneOffset = arm.bLo * 10;
      m.beam(arm.el, arm.hn, .052, .052, 'canvas', suitLight, 0);
      m.box(arm.hn[0], arm.hn[1], arm.hn[2], .068, .060, .078, 'rubber', '#323a3d', 0, 0);
    }
    // Simplified Weapon Silhouette (Bone 15)
    m.boneOffset = 150;
    const wLen = gun === 'MS10' ? .82 : gun === 'DF40 II' ? .76 : gun === 'RD40' ? .74 : gun === 'RD 50' ? .70 : gun === 'D1' ? .64 : gun === 'SRA' ? .68 : gun === 'RD30' ? .62 : gun === 'RD20' ? .52 : .58;
    const wCol = gun === 'MS10' ? '#465861' : gun === 'DF40 II' ? '#2c3644' : gun === 'RD40' ? '#523c42' : gun === 'RD 50' ? '#475046' : gun === 'DF1 OUT' ? '#3d5452' : gun === 'RD30' ? '#4b4846' : gun === 'RD20' ? '#384e54' : '#404a4d';
    const wGlow = gun === 'MS10' ? '#58e8ff' : gun === 'DF40 II' ? '#7c82ff' : gun === 'RD40' ? '#ff6478' : gun === 'RD 50' ? '#e8c25c' : gun === 'DF1 OUT' ? '#5ae8d0' : gun === 'RD30' ? '#ffbe62' : gun === 'RD20' ? '#64f0ff' : accent;
    m.box(.072, 1.270, -.360, gun === 'DF40 II' ? .096 : (gun === 'RD30' || gun === 'RD40') ? .086 : .068, .110, wLen * .62, 'blackMetal', wCol, 0, 1);
    if (gun === 'DF40 II') {
      m.box(.040, 1.280, -.360 - wLen * .44, .024, .026, wLen * .48, 'steel', '#2c3437', 0, 1);
      m.box(.072, 1.312, -.360 - wLen * .46, .026, .026, wLen * .50, 'steel', '#2c3437', 0, 1);
      m.box(.104, 1.280, -.360 - wLen * .44, .024, .026, wLen * .48, 'steel', '#2c3437', 0, 1);
    } else if (gun === 'RD30' || gun === 'RD40') {
      m.box(.044, 1.292, -.360 - wLen * .44, .026, .030, wLen * .48, 'steel', '#2c3437', 0, 1);
      m.box(.100, 1.292, -.360 - wLen * .44, .026, .030, wLen * .48, 'steel', '#2c3437', 0, 1);
    } else {
      m.box(.072, 1.292, -.360 - wLen * .44, .036, .038, wLen * .48, 'steel', '#2c3437', 0, 1);
    }
    m.box(.072, 1.170, -.340, .042, .145, .075, 'blackMetal', darkArmor, 0, 1);
    m.box(.072, 1.320, -.420, .024, .016, .180, 'white', wGlow, 0, 3);
    m.boneOffset = 0;
    return m;
  }

  const plateBox = (x, y, z, w, h, d, bv, mat, tint, kind = 1) => {
    if (hi) m.bevelBox(x, y, z, w, h, d, bv, mat, tint, kind);
    else m.box(x, y, z, w, h, d, mat, tint, 0, kind);
  };

  // ---- Bones 9..14: Articulated Left & Right Legs (Hip -> Thigh -> Hinged Knee -> Sculpted Shin/Calf -> Ankle -> Lugged Boot) ----
  for (const side of [-1, 1]) {
    const hipX = side * .122, legX = side * .130;
    const baseBone = side < 0 ? 9 : 12;

    // 1. Thigh (Bone 9 / 12): hip ball-and-ring socket + ribbed groin flex-gasket + anatomically lofted quad/hamstring + beveled thigh armor + drop-leg rig
    m.boneOffset = baseBone * 10;
    m.ellipsoid(hipX, .895, .012, .092, .088, .092, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
    m.hingeRotor([hipX + side * .068, .895, .012], [1, 0, 0], .042, .036, 'blackMetal', jointMetal, steelPin, seg, 1);
    m.ribbedJoint([hipX, .875, .012], [legX, .815, .010], .084, .098, ribs - 1, 'rubber', gasketCol, seg, 0);
    // Anatomically sculpted thigh (broad quad/hamstring taper down toward suprapatellar knee)
    m.sculptLimb([legX, .530, .006], [hipX, .855, .012], [
      [0.00, .076, .076, 0, 0],
      [0.18, .088, .094, 0, -.004],
      [0.48, .102, .112, 0, -.008],
      [0.78, .108, .116, 0, -.004],
      [1.00, .098, .102, 0, 0]
    ], 'canvas', suitMid, seg, 0);
    // Curved front femoral armor plate + beveled crest + twin retention straps
    m.curvedPlate([legX, .705, .004], [0, 1, 0], [0, 0, -1], .106, .165, 1.35, .016, 'steel', plate, cSeg, 1);
    plateBox(legX, .705, -.108, .074, .112, .022, .008, 'blackMetal', darkArmor, 1);
    for (const sy of [.645, .755]) {
      m.tube([legX, sy, .006], [legX, sy + .018, .006], .106, .106, 'rubber', strapCol, seg, 0);
    }
    // Outer drop-leg tactical holster (right) / modular spy utility rig (left) with steel buckle clasps
    plateBox(legX + side * .095, .705, .008, .048, .155, .118, .010, 'blackMetal', darkArmor, 1);
    plateBox(legX + side * .118, .735, -.016, .018, .032, .032, .005, 'steel', steelPin, 1);
    if (isSpy) plateBox(legX + side * .116, .668, -.010, .014, .062, .016, .004, 'white', accent, 3);
    // Distal suprapatellar ribbed cuff right above knee hinge
    m.ribbedJoint([legX, .555, .006], [legX, .505, .006], .068, .080, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);

    // 2. Knee + Shin (Bone 10 / 13): dual-axis mechanical knee rotor + inner ribbed bellows + floating beveled patella cap + lofted calf + armored shin greave
    m.boneOffset = (baseBone + 1) * 10;
    // Inner spherical joint core & corrugated posterior flex-bellows
    m.ellipsoid(legX, .500, .008, .074, .072, .076, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
    m.ribbedJoint([legX, .455, .012], [legX, .540, .010], .064, .076, ribs, 'rubber', gasketCol, seg, 0);
    // Concentric machined lateral knee hinge rotor & brushed steel pivot bolts on both sides of knee!
    m.hingeRotor([legX, .500, .006], [1, 0, 0], .046, .162, 'blackMetal', jointMetal, steelPin, seg, 1);
    // Multi-piece floating patella knee-pad (tracks bisector half-angle in rig.js!)
    m.curvedPlate([legX, .500, -.018], [0, 1, 0], [0, 0, -1], .084, .112, 1.55, .018, 'steel', midArmor, cSeg, 1);
    plateBox(legX, .500, -.104, .078, .086, .032, .011, 'blackMetal', darkArmor, 1);
    plateBox(legX, .500, -.120, .054, .042, .014, .005, 'white', accent, isSpy ? 3 : 1);
    // Side patella hinge brackets connecting rotor to knee shield
    for (const sx of [-1, 1]) {
      m.beam([legX + sx * .076, .500, .002], [legX + sx * .048, .500, -.092], .018, .024, 'steel', jointMetal, 1);
    }
    // Anatomically lofted shin & sculpted gastrocnemius calf muscle tapering to Achilles tendon
    m.sculptLimb([legX, .135, .014], [legX, .465, .006], [
      [0.00, .054, .056, 0, 0],
      [0.20, .060, .064, 0, .004],
      [0.52, .078, .090, 0, .020],
      [0.78, .082, .092, 0, .016],
      [1.00, .074, .078, 0, .002]
    ], 'canvas', suitDark, seg, 0);
    // Curved wrap-around front shin greave + beveled ridge + lateral exo-brace struts
    m.curvedPlate([legX, .305, .002], [0, 1, 0], [0, 0, -1], .078, .225, 1.48, .016, 'blackMetal', darkArmor, cSeg, 1);
    plateBox(legX, .312, -.084, .056, .185, .022, .007, 'steel', plate, 1);
    plateBox(legX, .380, -.096, .062, .028, .014, .004, 'white', accent, 0);
    if (hi) {
      for (const sx of [-1, 1]) {
        m.beam([legX + sx * .074, .475, .006], [legX + sx * .066, .140, .014], .015, .020, 'steel', jointMetal, 1);
      }
      // Calf strap
      m.tube([legX, .240, .012], [legX, .260, .012], .076, .078, 'rubber', strapCol, seg, 0);
    }

    // 3. Ankle + Multi-Part Articulated Combat Boot (Bone 11 / 14): ankle hinge rotor + ribbed gaiter + heel counter + arch + hinged forefoot toe box + lugged outsole (sole y=0.000)
    m.boneOffset = (baseBone + 2) * 10;
    m.ribbedJoint([legX, .085, .014], [legX, .155, .014], .052, .064, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    m.hingeRotor([legX, .115, .014], [1, 0, 0], .038, .128, 'blackMetal', jointMetal, steelPin, seg, 1);
    // Reinforced beveled heel cup & Achilles armor bumper
    plateBox(legX, .062, .034, .112, .096, .098, .012, 'blackMetal', darkArmor, 1);
    plateBox(legX, .072, .080, .068, .064, .020, .007, 'steel', midArmor, 1);
    // Contoured midfoot vamp & armored instep strap
    plateBox(legX, .056, -.026, .114, .078, .076, .012, 'rubber', rubber, 0);
    plateBox(legX, .082, -.028, .118, .022, .036, .006, 'steel', midArmor, 1);
    // Articulated forefoot toe box (bends naturally at z < -0.041 in rig.js!)
    m.ellipsoid(legX, .044, -.092, .058, .038, .064, 'rubber', '#394143', 0, seg, hi ? 5 : 4);
    plateBox(legX, .042, -.118, .096, .044, .058, .012, 'blackMetal', darkArmor, 1); // reinforced steel toe bumper
    // Multi-piece rugged lugged combat outsole cleanly touching y = 0.000
    m.box(legX, .014, .036, .118, .028, .096, 'rubber', '#22282a', 0, 0); // heel lug block (y=0.000..0.028)
    m.box(legX, .016, -.024, .106, .024, .046, 'rubber', '#1d2224', 0, 0); // recessed midfoot arch
    m.box(legX, .014, -.092, .122, .028, .108, 'rubber', '#22282a', 0, 0); // forefoot grip sole (y=0.000..0.028)
    if (hi) {
      for (const lz of [-.060, -.095, -.128]) {
        m.box(legX, .012, lz, .126, .018, .018, 'rubber', '#171c1e', 0, 0); // grip tread cleats
      }
    }
  }

  // ---- Bone 0: Pelvis, Hip Joint Sockets & Tactical Battle Belt ----
  m.boneOffset = 0;
  m.ellipsoid(0, .900, .012, .212, .108, .144, 'blackMetal', suitDark, 0, eSeg, eBand);
  plateBox(0, .865, -.116, .155, .122, .062, .014, 'blackMetal', darkArmor, 1); // armored front groin/codpiece guard
  plateBox(0, .890, .124, .215, .108, .052, .012, 'blackMetal', darkArmor, 1); // rear sacral armor guard
  // Heavy modular battle belt + beveled Cobra steel buckle
  plateBox(0, .948, .010, .426, .072, .296, .010, 'blackMetal', darkArmor, 1);
  plateBox(0, .948, -.152, .102, .058, .030, .008, 'steel', steelPin, 1);
  plateBox(0, .948, -.164, .056, .026, .014, .004, 'blackMetal', darkArmor, 1);
  // Hip socket collars & side modular pouches
  for (const sx of [-1, 1]) {
    m.curvedPlate([sx * .182, .895, .010], [0, 1, 0], [sx, 0, 0], .042, .088, 2.2, .014, 'steel', midArmor, cSeg, 1);
    plateBox(sx * .222, .932, -.026, .056, .096, .118, .009, 'canvas', pouchCol, 0);
    plateBox(sx * .224, .962, -.026, .060, .022, .120, .005, 'blackMetal', strapCol, 1);
  }
  plateBox(0, .922, .162, .178, .095, .062, .009, 'canvas', pouchCol, 0); // rear utility dump pouch

  // ---- Bone 1: Articulated Lumbar Spine, Ribbed Waist Flex-Gasket & Exo-Braces ----
  m.boneOffset = 10;
  // Corrugated ballistic flex-sleeve waist joint bridging pelvis to ribcage
  m.ribbedJoint([0, .965, .010], [0, 1.140, .010], .165, .184, ribs, 'rubber', gasketCol, eSeg, 0);
  m.ellipsoid(0, 1.055, .010, .196, .135, .138, 'canvas', suitLight, 0, seg, hi ? 5 : 4);
  // 3-tier overlapping beveled abdominal flex plates (front)
  for (let i = 0; i < 3; i++) {
    const ay = 1.000 + i * .054, aw = .245 + i * .018, az = -.122 - i * .005;
    plateBox(0, ay, az, aw, .042, .048, .008, 'blackMetal', midArmor, 1);
  }
  // 3-vertebrae dorsal spine armor plates + twin lateral hydraulic stabilizer struts (back)
  for (let i = 0; i < 3; i++) {
    plateBox(0, .995 + i * .056, .132, .138 - i * .008, .044, .046, .008, 'steel', jointMetal, 1);
  }
  if (hi) {
    for (const sx of [-1, 1]) {
      m.tube([sx * .142, .972, .082], [sx * .158, 1.148, .086], .016, .014, 'steel', steelPin, 8, 1);
      m.tube([sx * .146, 1.010, .083], [sx * .152, 1.095, .084], .022, .022, 'blackMetal', darkArmor, 8, 1);
    }
  }

  // ---- Bone 2: Thoracic Chest Armor, Collarbone Yoke, Shoulder Sockets & Tactical Backpack ----
  m.boneOffset = 20;
  // Contoured anatomical chest torso shell
  m.sculptLimb([0, 1.135, .008], [0, 1.430, .004], [
    [0.00, .195, .138, 0, 0],
    [0.25, .232, .156, 0, -.005],
    [0.62, .258, .168, 0, -.006],
    [0.88, .240, .152, 0, -.002],
    [1.00, .165, .128, 0, 0]
  ], 'canvas', vest, eSeg, 0);
  // Beveled front SAPI ballistic plate carrier + angled pectoral armor
  plateBox(0, 1.255, -.138, .356, .244, .086, .016, 'blackMetal', plate, 1);
  plateBox(0, 1.335, -.162, .312, .082, .052, .012, 'steel', midArmor, 1);
  plateBox(0, 1.356, -.190, .318, .034, .020, .005, 'white', accent, isSpy ? 3 : 0);
  // Glowing team/spy sternum IFF beacon
  plateBox(.098, 1.258, -.190, .084, .042, .022, .005, 'white', light, 3);
  // Triple front MOLLE magazine pouches (left chest reload target!) with steel retention clips
  for (let p = 0; p < 3; p++) {
    const px = -.118 + p * .058;
    plateBox(px, 1.202, -.192, .048, .096, .042, .006, 'canvas', pouchCol, 0);
    m.box(px, 1.256, -.190, .034, .018, .028, 'blackMetal', darkArmor, 0, 1); // exposed mag baseplate
  }
  // Shoulder harness straps + machined steel D-ring buckles + armored clavicle gorget yoke
  for (const sx of [-1, 1]) {
    m.beam([sx * .132, 1.355, -.135], [sx * .142, 1.425, .020], .062, .026, 'blackMetal', darkArmor, 1);
    m.beam([sx * .142, 1.425, .020], [sx * .135, 1.360, .152], .062, .026, 'blackMetal', darkArmor, 1);
    plateBox(sx * .132, 1.372, -.142, .042, .026, .022, .005, 'steel', steelPin, 1);
    // Recessed shoulder ball-joint collar ring seated on thorax flanks
    m.hingeRotor([sx * .218, 1.398, .000], [1, 0, 0], .068, .032, 'blackMetal', darkArmor, jointMetal, seg, 1);
  }
  m.curvedPlate([0, 1.418, .002], [0, 1, 0], [0, 0, -1], .136, .064, 3.6, .022, 'blackMetal', darkArmor, cSeg + 2, 1);

  // Tactical backpack: chamfered armored chassis + left shield condenser cylinder + right ammo-refiner + comms whip antenna
  plateBox(0, 1.248, .182, .378, .362, .084, .014, 'blackMetal', darkArmor, 1);
  m.tube([-.098, 1.07, .240], [-.098, 1.425, .240], .076, .076, 'steel', metal, seg, 1);
  for (const y of [1.115, 1.225, 1.335]) {
    m.tube([-.098, y, .240], [-.098, y + .034, .240], .082, .082, 'white', isSpy ? '#58ffe8' : '#77d4c6', seg, 3);
  }
  plateBox(.096, 1.242, .242, .152, .358, .128, .012, 'blackMetal', isSpy ? '#36464d' : '#969d8d', 1);
  for (let j = 0; j < 4; j++) {
    plateBox(.096, 1.132 + j * .062, .310, .118, .018, .014, .003, 'white', isSpy ? accent : '#e1b163', isSpy ? 3 : 1);
  }
  // Tactical whip comms antenna + Spy stealth dorsal fins
  m.tube([-.152, 1.415, .195], [-.178, 1.725, .215], .010, .004, 'blackMetal', darkArmor, 6, 1);
  m.ellipsoid(-.178, 1.732, .216, .010, .010, .010, 'white', light, 3, 6, 4);
  if (isSpy) {
    for (const sx of [-1, 1]) {
      m.beam([sx * .165, 1.36, .205], [sx * .205, 1.50, .285], .020, .062, 'steel', darkArmor, 1);
      m.beam([sx * .185, 1.42, .245], [sx * .208, 1.495, .290], .008, .022, 'white', light, 3);
    }
  }

  // ---- Bone 3: Cervical Neck, Ribbed Ballistic Gasket & Armored Throat Guard ----
  m.boneOffset = 30;
  m.ribbedJoint([0, 1.425, .002], [0, 1.545, -.006], .068, .082, ribs, 'rubber', gasketCol, seg, 0);
  m.curvedPlate([0, 1.472, -.004], [0, 1, 0], [0, 0, -1], .088, .064, 2.2, .016, 'blackMetal', darkArmor, cSeg, 1);
  if (hi) {
    for (const sx of [-1, 1]) {
      m.tube([sx * .058, 1.430, .048], [sx * .048, 1.535, .042], .012, .010, 'steel', jointMetal, 6, 1);
    }
  }

  // ---- Bone 4: Sculpted Multi-Plane Tactical Helmet, Visor, Mandible Respirator & Comms Headset ----
  m.boneOffset = 40;
  // Sculpted high-cut ballistic helmet dome
  m.ellipsoid(0, 1.648, -.006, .148, .174, .154, 'steel', helmetShell, 1, eSeg, eBand);
  // Armored brow hood & top crown crest shell
  m.ellipsoid(0, 1.748, .004, .158, .074, .156, 'steel', isSpy ? darkArmor : accent, 1, eSeg, hi ? 5 : 4);
  plateBox(0, 1.716, -.136, .185, .036, .062, .009, 'blackMetal', darkArmor, 1); // brow sun/sensor hood
  // NVG forehead shroud mount + rear counterweight battery box
  plateBox(0, 1.738, -.156, .062, .054, .036, .007, 'steel', jointMetal, 1);
  plateBox(0, 1.640, .148, .106, .074, .042, .009, 'blackMetal', darkArmor, 1);
  // Curved recessed optical visor shield
  m.ellipsoid(0, 1.655, -.076, .148, .092, .108, 'blackMetal', visorTint, 1, eSeg, hi ? 6 : 4);
  if (isSpy) {
    // NV2.1 Signature Tri-Optic Stealth Recon NVG Goggles (3 glowing emerald-cyan lenses + carbon housings!)
    for (const [gx, gy, gz, gr] of [[-.062, 1.666, -.174, .026], [0, 1.682, -.180, .028], [.062, 1.666, -.174, .026]]) {
      m.tube([gx, gy, gz + .032], [gx, gy, gz - .014], gr * 1.18, gr * 1.05, 'blackMetal', darkArmor, 10, 1);
      m.tube([gx, gy, gz - .014], [gx, gy, gz - .022], gr * .82, gr * .82, 'white', light, 10, 3);
    }
    plateBox(0, 1.676, -.152, .155, .022, .032, .005, 'steel', jointMetal, 1); // NVG bridge bar
  } else {
    // Standard glowing panoramic optical visor strip + brow rim
    plateBox(0, 1.668, -.178, .198, .026, .020, .005, 'white', light, 3);
  }
  // Sculpted angled jaw mandible respirator mask + twin cheek filter canisters + chin grille
  plateBox(0, 1.568, -.116, .148, .078, .092, .014, 'blackMetal', darkArmor, 1);
  plateBox(0, 1.558, -.162, .068, .042, .018, .005, 'steel', jointMetal, 1); // front respirator vent
  for (const sx of [-1, 1]) {
    // Cheek filter pods
    m.tube([sx * .068, 1.568, -.122], [sx * .096, 1.562, -.148], .024, .022, 'steel', midArmor, 8, 1);
    // Side ARC accessory rails + active ear-pro tactical comms headset cups
    plateBox(sx * .148, 1.678, -.018, .022, .032, .148, .005, 'blackMetal', darkArmor, 1);
    m.hingeRotor([sx * .156, 1.635, .004], [1, 0, 0], .048, .034, 'blackMetal', darkArmor, accent, seg, 1);
  }
  // Tactical boom microphone curving from left ear-pro cup to mandible
  if (hi) m.beam([-.156, 1.615, -.010], [-.068, 1.565, -.150], .012, .012, 'blackMetal', strapCol, 1);

  // ---- Bones 5..8: 2-Bone Analytical IK Sculpted Arms (Shoulder Pauldron -> Upper Arm -> Hinged Elbow -> Forearm Bracer -> Wrist -> Articulated Hand) ----
  const arms = [
    {s: -1, bUp: 5, bLo: 6, sh: [-.225, 1.400, .000], el: [-.210, 1.160, -.165], hn: [.035, 1.205, -.395]},
    {s: 1, bUp: 7, bLo: 8, sh: [.225, 1.400, .000], el: [.265, 1.145, -.065], hn: [.072, 1.170, -.240]}
  ];
  for (const arm of arms) {
    const uDir = unit(sub(arm.el, arm.sh));
    const fDir = unit(sub(arm.hn, arm.el));
    const shOut = [arm.s, .28, 0];
    const elMid = add(arm.sh, scale(sub(arm.el, arm.sh), .52));
    const elHint = unit(cross(uDir, fDir)); // exact anatomical elbow flexion hinge axis!

    // Upper Arm (Bone 5 / 7): shoulder ball joint + ribbed flex-bellows + dual-tier curved pauldron + anatomically lofted bicep/tricep + bicep cuff
    m.boneOffset = arm.bUp * 10;
    m.ellipsoid(...arm.sh, .084, .082, .084, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
    m.ribbedJoint(arm.sh, add(arm.sh, scale(uDir, .078)), .064, .078, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    // Dual-tier sculpted curved shoulder pauldron (upper cap + lower floating deltoid shield + rivets!)
    m.curvedPlate(add(arm.sh, [arm.s * .018, .018, 0]), uDir, shOut, .086, .118, 2.15, .018, 'steel', isSpy ? darkArmor : accent, cSeg, 1);
    m.curvedPlate(add(arm.sh, add(scale(uDir, .088), [arm.s * .014, 0, 0])), uDir, [arm.s, 0, -.15], .078, .086, 1.85, .015, 'blackMetal', darkArmor, cSeg, 1);
    if (isSpy) {
      m.curvedPlate(add(arm.sh, [arm.s * .022, .020, 0]), uDir, shOut, .096, .024, 1.65, .008, 'white', accent, cSeg, 3);
    }
    // Anatomically lofted upper arm (deltoid -> muscular bicep/tricep -> tapered distal humerus)
    m.sculptLimb(arm.sh, arm.el, [
      [0.05, .072, .074, 0, 0],
      [0.32, .076, .080, 0, -.004],
      [0.62, .074, .078, 0, -.004],
      [0.88, .064, .066, 0, 0],
      [1.00, .058, .060, 0, 0]
    ], 'canvas', suitDark, seg, 0);
    // Bicep compression strap & distal elbow-side ribbed sleeve
    m.tube(add(elMid, scale(uDir, -.016)), add(elMid, scale(uDir, .018)), .077, .077, 'rubber', strapCol, seg, 0);
    m.ribbedJoint(add(arm.el, scale(uDir, -.055)), arm.el, .054, .065, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);

    // Forearm + Hinged Elbow + Wrist + Articulated Glove (Bone 6 / 8)
    m.boneOffset = arm.bLo * 10;
    // Inner spherical joint + corrugated flex-bellows + precision machined elbow hinge rotor along true flexion axis!
    m.ellipsoid(...arm.el, .062, .062, .062, 'rubber', gasketCol, 0, seg, hi ? 5 : 4);
    m.ribbedJoint(arm.el, add(arm.el, scale(fDir, .058)), .052, .062, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    m.hingeRotor(arm.el, elHint, .036, .118, 'blackMetal', jointMetal, steelPin, seg, 1);
    // Outer hard-shell beveled tactical elbow guard (cop) positioned on posterior/outer elbow
    const elOut = unit(add(scale(uDir, .55), scale(fDir, -.55)));
    const padC = add(arm.el, scale(elOut, .056));
    m.curvedPlate(arm.el, elHint, elOut, .066, .082, 1.75, .016, 'blackMetal', darkArmor, cSeg, 1);
    plateBox(padC[0], padC[1], padC[2], .054, .056, .048, .009, 'steel', midArmor, 1);

    // Anatomically tapered forearm (muscular brachioradialis near elbow -> slim wrist)
    m.sculptLimb(arm.el, arm.hn, [
      [0.02, .060, .060, 0, 0],
      [0.26, .068, .066, 0, 0],
      [0.58, .058, .056, 0, 0],
      [0.82, .048, .046, 0, 0],
      [0.95, .046, .044, 0, 0]
    ], 'canvas', suitLight, seg, 0);

    // Curved armored forearm gauntlet bracer + glowing left-wrist tactical holo-display!
    const bracerC = add(arm.el, scale(sub(arm.hn, arm.el), .54));
    const bracerOut = unit([arm.s * .7, .4, .2]);
    m.curvedPlate(bracerC, fDir, bracerOut, .058, .125, 2.2, .014, 'blackMetal', darkArmor, cSeg, 1);
    if (arm.s < 0) {
      // Left wrist tactical mini-computer screen (extra bright cyan/emerald on NV2.1 Spy!)
      const tacC = add(bracerC, scale(bracerOut, .062));
      plateBox(tacC[0], tacC[1], tacC[2], .032, .022, .056, .004, 'blackMetal', darkArmor, 1);
      m.box(tacC[0] + bracerOut[0] * .011, tacC[1] + bracerOut[1] * .011, tacC[2] + bracerOut[2] * .011, .020, .010, .040, 'white', light, 0, 3);
    }

    // Articulated ribbed wrist joint + metallic cuff collar
    const wrStart = add(arm.el, scale(sub(arm.hn, arm.el), .76));
    const wrEnd = add(arm.el, scale(sub(arm.hn, arm.el), .90));
    m.ribbedJoint(wrStart, wrEnd, .044, .052, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    m.hingeRotor(wrEnd, elHint, .024, .092, 'steel', jointMetal, steelPin, 8, 1);

    // Sculpted Articulated Tactical Glove: palm + armored knuckle guard + opposing thumb + curled finger grip
    const palm = arm.hn;
    const fRight = unit(cross(fDir, [0, 1, 0]));
    const fUp = unit(cross(fRight, fDir));
    plateBox(palm[0], palm[1], palm[2], .064, .056, .078, .012, 'rubber', '#323a3d', 0);
    // Carbon armored knuckle guard on back of hand
    const knuck = add(palm, add(scale(fDir, .022), scale(fRight, arm.s * .026)));
    plateBox(knuck[0], knuck[1], knuck[2], .038, .044, .044, .007, 'blackMetal', darkArmor, 1);
    // Opposing thumb wrapping upper grip
    const thBase = add(palm, add(scale(fUp, .022), scale(fRight, -arm.s * .016)));
    const thTip = add(thBase, add(scale(fDir, .046), scale(fUp, .014)));
    m.tube(thBase, thTip, .016, .013, 'rubber', '#3a4346', 7, 0);
    // Curled tactical grip fingers wrapping rifle forend / trigger guard
    if (hi) {
      for (let fi = 0; fi < 3; fi++) {
        const fOff = -.016 + fi * .016;
        const fBase = add(palm, add(scale(fDir, .036), scale(fUp, fOff)));
        const fMid = add(fBase, add(scale(fDir, .024), scale(fRight, -arm.s * .018)));
        const fTip = add(fMid, scale(fRight, -arm.s * .026));
        m.tube(fBase, fMid, .013, .011, 'rubber', '#2f373a', 6, 0);
        m.tube(fMid, fTip, .011, .009, 'rubber', '#272f32', 6, 0);
      }
    }
  }

  // ---- Bone 15: Weapon Assembly (tracks AimPitch, ADS, Sprint Low-Ready, Recoil & Reload Tilt) ----
  m.boneOffset = 150;
  m.transform = {origin: [.072, 1.245, -.255], right: [.85, 0, 0], up: [0, .85, 0], back: [0, 0, .85]};
  device(m, gun);
  m.transform = null;
  m.tube([.070, 1.398, -.280], [.070, 1.398, -.332], .028, .026, 'blackMetal', metal, 8, 1);
  m.boneOffset = 0;
  return m;
}

function shotPalette(s) {
  if (s.aaTier === '1.5') return {core: '#f4fffc', jacket: '#54e8be', outer: s.ricocheted ? '#86ffd0' : '#28f5b8', ring: '#9effe8', spark: '#d6fff4', vapor: '#b0f0df'};
  if (s.ricocheted) return {core: '#ffffff', jacket: '#f4c86a', outer: '#ff9634', ring: '#ffe98a', spark: '#fff0a4', vapor: '#e8d8be'};
  if (s.gun === 'MS10') return {core: '#f7ffff', jacket: '#8ec7d8', outer: s.team ? '#ff8b4f' : '#3ee4ff', ring: s.team ? '#ffd57a' : '#8ef7ff', spark: '#ffe37a', vapor: '#b8e8f2'};
  if (s.gun === 'DF40 II') {
    if (s.aaTier === '1.4') return {core: '#fffdf2', jacket: '#f0b868', outer: s.guided ? '#ff68d6' : '#ffaa48', ring: '#ffe478', spark: '#fff0a8', vapor: '#f0cfe8'};
    return {core: '#f6f8ff', jacket: '#9a96df', outer: s.guided ? '#7c6eff' : '#58d8ff', ring: s.guided ? '#64f8ff' : '#a8a2ff', spark: '#9cfaff', vapor: '#ccd2f2'};
  }
  if (s.gun === 'RD40') return {core: '#fff7f0', jacket: '#d48272', outer: s.guided ? '#ff4a62' : '#ff7b4e', ring: s.guided ? '#ffcf76' : '#ff9c6e', spark: '#ffd27a', vapor: '#e8c4be'};
  if (s.gun === 'RD 50') return {core: '#fffdf0', jacket: '#c9ab5c', outer: s.team ? '#ff9a46' : '#f2c858', ring: '#ffe48a', spark: '#fff0a4', vapor: '#e2d7be'};
  if (s.gun === 'RD30') return {core: '#fffcf2', jacket: '#c9a06a', outer: s.guided ? '#ffae48' : (s.team ? '#ff7d44' : '#f4a250'), ring: s.guided ? '#ffe282' : '#ffcf76', spark: '#ffe388', vapor: '#e6d2b8'};
  if (s.gun === 'RD20') return {core: '#f4ffff', jacket: '#7eb8c8', outer: s.guided ? '#4ce4ff' : (s.team ? '#ff8c52' : '#58c8e8'), ring: s.guided ? '#a8f8ff' : '#ffe088', spark: '#b8fbff', vapor: '#c2e4ee'};
  if (s.source === 'p1') return {core: '#fdf4ff', jacket: '#a688d8', outer: '#cc7dff', ring: '#76f8ff', spark: '#ffd2ff', vapor: '#d8c4f4'};
  if (s.gun === 'DF1 OUT') return {core: '#f2fffd', jacket: '#7ac7bc', outer: s.guided ? '#3bf2d6' : '#58e2cc', ring: s.guided ? '#8effef' : '#f2bd74', spark: s.guided ? '#a4fff4' : '#99f6e4', vapor: '#b8e8e0'};
  if (s.gun === 'D1') return {core: '#fff8ea', jacket: '#c49664', outer: s.team ? '#ff7644' : '#ffa952', ring: '#ffe27e', spark: '#ffd278', vapor: '#d8cfc0'};
  if (s.gun === 'SRA') return {core: '#f4fffa', jacket: '#86b5aa', outer: s.team ? '#ff9459' : '#4be5bd', ring: '#a8ffea', spark: '#d6fff4', vapor: '#c8ded8'};
  return {core: '#fffef2', jacket: '#d4b468', outer: s.team ? '#ff9d52' : '#ffdf6e', ring: '#fff3ad', spark: '#ffd264', vapor: '#dcd5c4'};
}

// Smoothly maps projectile visual position from exact 1P/3P barrel muzzle onto the true ballistic ray over 13.5m
// so shots emerge directly from the physical gun muzzle while keeping zero-parallax crosshair hit registration.
function visualShotPoint(s, physPos, visMuzzle) {
  if (!visMuzzle || !s.origin || s.ricochets > 0 || s.penetrations > 0) return physPos;
  const dist = Math.hypot(physPos[0] - s.origin[0], physPos[1] - s.origin[1], physPos[2] - s.origin[2]);
  if (dist >= 13.5) return physPos;
  const u = clamp(dist / 13.5, 0, 1);
  const b = (1 - u) * (1 - u);
  return [
    physPos[0] + (visMuzzle[0] - s.origin[0]) * b,
    physPos[1] + (visMuzzle[1] - s.origin[1]) * b,
    physPos[2] + (visMuzzle[2] - s.origin[2]) * b
  ];
}

export function movingDetails(match, time, extra = false, lite = false, opts = null) {
  const m = new Mesh();
  if (!lite) {
    const gullCount = extra ? 11 : 7;
    for (let i = 0; i < gullCount; i++) {
      const a = time * (.041 + i * .0007) + i * .61,
        x = -54 + Math.sin(a) * (24 + i * 2.4),
        z = -39 + Math.cos(a) * 62 + i * 8,
        y = 22 + i * .67 + Math.sin(a * 3.2),
        b = Math.sin(time * 3 + i) * .22;
      m.tri([x - .62, y + b, z + .16], [x, y, z], [x - .30, y + .1, z - .07], 'white', '#d4d4c8', 5, [0, 1, 0]);
      m.tri([x + .62, y + b, z + .14], [x + .31, y + .08, z - .08], [x, y, z], 'white', '#d4d4c8', 5, [0, 1, 0]);
    }
  }
  if (!match) return m;

  // Supply tanker live status rings, beacon holograms, and recharge progress bars.
  const spectating = !!(opts?.spectating || match.spectating);
  const viewerActor = opts?.viewerActor || match.player;
  const viewerTeam = viewerActor?.team ?? 0;
  const fpActorId = opts?.fpActorId !== undefined ? opts.fpActorId : (spectating ? -1 : (match.player?.id ?? -1));
  if (match.tankers) {
    for (const tk of match.tankers) {
      const ready = tk.cooldown <= 0;
      const fill = ready ? 1 : clamp(1 - tk.cooldown / tk.maxCooldown, 0, 1);
      const ringCol = ready ? (Math.sin(time * 4 + tk.id) > 0 ? '#79f7e4' : '#ffe082') : '#d99a56';
      // Ground supply zone ring around the tanker
      ring(m, [tk.x, .09, tk.z], [0, 1, 0], tk.radius * .94, ready ? .065 : .035, lite ? 12 : (extra ? 24 : 16), ringCol, 3);
      if (!lite) {
        const bob = Math.sin(time * 2.7 + tk.id * 2.1) * .12;
        if (ready && extra) {
          const waveR = tk.radius * (.55 + ((time * .55 + tk.id * .33) % 1) * .45);
          ring(m, [tk.x, .14, tk.z], [0, 1, 0], waveR, .032, 20, '#b5fff4', 3);
        }
        // Elevated rotating holographic ammo-crystal beacon above the tanker
        const bx = tk.x, by = 3.55 + bob, bz = tk.z;
        const rot = time * (ready ? 1.8 : .55) + tk.id;
        const cr = Math.cos(rot) * .36, sr = Math.sin(rot) * .36;
        const top = [bx, by + .42, bz], bot = [bx, by - .42, bz];
        const p0 = [bx + cr, by, bz + sr], p1 = [bx - sr, by, bz + cr], p2 = [bx - cr, by, bz - sr], p3 = [bx + sr, by, bz - cr];
        const bCol = ready ? '#84ffec' : '#c78a4e';
        for (const [a, b] of [[p0, p1], [p1, p2], [p2, p3], [p3, p0]]) {
          m.tri(a, b, top, 'white', bCol, 3);
          m.tri(b, a, bot, 'white', ready ? '#ffd978' : '#7a593b', 3);
        }
        ring(m, [bx, by, bz], [Math.sin(rot) * .35, 1, Math.cos(rot) * .35], .56, .024, 12, ready ? '#ffe38c' : '#8d6c49', 3);
      }
      // Horizontal charge bar along top of tanker
      const barLen = 2.6 * fill;
      if (barLen > .08) {
        m.box(tk.x, 2.94, tk.z - tk.facing * .68, .18, .09, barLen, 'white', ready ? '#88ffee' : '#f0b865', 0, 3);
      }
    }
  }

  // Purple road pickups: BAIZER 200 (+20 purple shield) & BAIZER 400 (+40 purple shield)
  if (match.baizers) {
    for (const bz of match.baizers) {
      if (bz.cooldown > 0) continue;
      const is400 = bz.amount >= 40;
      const bob = Math.sin(time * 3.4 + bz.id * 1.9) * .09;
      const rot = time * (is400 ? 2.1 : 1.55) + bz.id * 1.1;
      const haloCol = is400 ? '#e37cff' : '#b25cff';
      const coreCol = is400 ? '#f0b4ff' : '#d28aff';
      const darkCol = is400 ? '#5c1f8c' : '#431a6b';
      const baseR = is400 ? 1.05 : .82;
      ring(m, [bz.x, .08, bz.z], [0, 1, 0], baseR, is400 ? .060 : .046, lite ? 10 : 16, haloCol, 3);
      if (is400 && !lite) {
        const pulseR = .62 + ((time * .72 + bz.id * .4) % 1) * .72;
        ring(m, [bz.x, .12, bz.z], [0, 1, 0], pulseR, .028, 16, '#f6c8ff', 3);
      }
      // Armored purple BAIZER shield capsule resting / hovering over the road
      const cy = (is400 ? .76 : .62) + bob;
      const rad = is400 ? .36 : .29;
      const halfH = is400 ? .44 : .34;
      const cr = Math.cos(rot) * rad, sr = Math.sin(rot) * rad;
      const top = [bz.x, cy + halfH, bz.z], bot = [bz.x, cy - halfH, bz.z];
      const q0 = [bz.x + cr, cy, bz.z + sr], q1 = [bz.x - sr, cy, bz.z + cr], q2 = [bz.x - cr, cy, bz.z - sr], q3 = [bz.x + sr, cy, bz.z - cr];
      for (const [pa, pb] of [[q0, q1], [q1, q2], [q2, q3], [q3, q0]]) {
        m.tri(pa, pb, top, 'white', coreCol, 3);
        m.tri(pb, pa, bot, 'white', darkCol, 3);
      }
      // Ground armored base pad + luminous orbiting purple energy ring(s)
      m.box(bz.x, .10, bz.z, is400 ? .64 : .52, .12, is400 ? .64 : .52, 'blackMetal', '#2e1846', 0, 1);
      m.box(bz.x, .18, bz.z, is400 ? .46 : .36, .04, is400 ? .46 : .36, 'white', haloCol, 0, 3);
      if (!lite) {
        ring(m, [bz.x, cy, bz.z], [Math.sin(rot) * .45, 1, Math.cos(rot) * .45], rad * 1.48, .026, 12, haloCol, 3);
        if (is400) {
          ring(m, [bz.x, cy + .06, bz.z], [-Math.cos(rot) * .55, .85, Math.sin(rot) * .55], rad * 1.72, .022, 12, '#ffd6ff', 3);
          m.beam([bz.x, .20, bz.z], [bz.x, cy + halfH + .42, bz.z], .042, .042, 'white', '#d578ff', 3);
        }
      }
    }
  }

  // Persistent cooling 3D bullet scorch craters & molten embers on struck containers/wharf.
  if (!lite && match.scorches) {
    for (const sc of match.scorches) {
      const prog = clamp(1 - sc.life / (sc.max || 1.8), 0, 1);
      const hot = clamp(1 - prog / .42, 0, 1);
      const n = sc.normal || [0, 1, 0];
      const isPlasma = sc.gun === 'MS10' || sc.source === 'p1';
      const baseR = (isPlasma ? .135 : sc.mat === 'steel' ? .095 : .11) * (1 - prog * .28);
      if (baseR > .025) {
        scorchDisc(m, sc.p, n, baseR, sc.mat === 'wood' ? '#2c1f16' : '#1b2022', 8, 0);
      }
      if (hot > .05) {
        const glowP = add(sc.p, scale(n, .008));
        const glowR = baseR * (.42 + .34 * hot);
        const emberCol = sc.source === 'p1'
          ? (hot > .5 ? '#f0d8ff' : '#a864ff')
          : sc.gun === 'MS10'
            ? (hot > .5 ? '#c4fcff' : '#3ec8e8')
            : (hot > .55 ? '#fff2b0' : '#ff7b2e');
        scorchDisc(m, glowP, n, glowR, emberCol, 8, 3);
      }
    }
  }

  // Sleek, true-muzzle-aligned 3D projectiles (converges seamlessly from 1P/3P gun muzzle onto true ballistic line!).
  for (const s of match.shots) {
    if (s.materialPass) continue;
    if (!spectating && s.shafferCloaked && s.team !== viewerTeam) continue;
    const pal = shotPalette(s);
    const isMS10 = s.gun === 'MS10';
    const isGuided = !!s.guided;
    const isScherp = s.aaTier === '1.5';
    const isP1 = s.source === 'p1';
    const isFpShot = s.owner?.id === fpActorId;
    const visMuzzle = isFpShot ? (s.muzzle1p || s.muzzle || null) : (s.muzzle3p || s.muzzle || null);
    const orig = s.origin || s.p;
    const traveled = Math.hypot(s.p[0] - orig[0], s.p[1] - orig[1], s.p[2] - orig[2]);
    // Emerge cleanly right from barrel tip without clipping camera eye on frame 1!
    const head = (visMuzzle && !s.ricochets && !s.penetrations && traveled < .55)
      ? add(visMuzzle, scale(s.dir, Math.max(.18, traveled)))
      : visualShotPoint(s, s.p, visMuzzle);
    const wantTail = lite
      ? (isMS10 ? 4.8 : isScherp ? 3.8 : 2.6)
      : isMS10 ? (extra ? 8.2 : 6.4) : isScherp ? (extra ? 5.8 : 4.5) : isP1 ? 4.4 : isGuided ? 3.8 : 3.0;
    const tailLen = Math.max(.24, Math.min(wantTail, Math.max(traveled, .34), s.speed * (isMS10 ? .015 : .010)));

    if (lite) {
      const tip = add(head, scale(s.dir, isMS10 ? .26 : .18));
      const tailPhys = add(s.p, scale(s.dir, -tailLen));
      const tail = (visMuzzle && !s.ricochets && !s.penetrations && traveled <= tailLen + .25)
        ? visMuzzle
        : visualShotPoint(s, tailPhys, visMuzzle);
      const midTail = add(head, scale(sub(tail, head), .48));
      const w = isMS10 ? .042 : isScherp ? .038 : isGuided || isP1 ? .034 : .028;
      m.beam(tail, head, w, w, 'white', pal.outer, 3);
      m.beam(midTail, tip, w * .52, w * .52, 'white', pal.core, 3);
      if (isGuided || isScherp) {
        const gCol = isScherp ? '#38ffbe' : s.gun === 'DF40 II' ? (s.aaTier === '1.4' ? '#ffe078' : '#78f6ff') : s.gun === 'RD40' ? '#ff7082' : s.gun === 'RD30' ? '#ffd478' : s.gun === 'RD20' ? '#7cf0ff' : '#92fff2';
        ring(m, add(head, scale(s.dir, -.32)), s.dir, .085, .010, 6, gCol, 3);
      }
      continue;
    }

    const [right, up] = basisOf(s.dir);

    // 1. Compact ogive tracer warhead
    const tip = add(head, scale(s.dir, isMS10 ? .32 : isScherp ? .28 : .22));
    const noseBack = add(head, scale(s.dir, -.06));
    const wRad = isMS10 ? .026 : isScherp ? .024 : .020;
    m.tube(noseBack, tip, wRad, .003, 'white', pal.core, 6, 3);

    // 2. Sleek curved multi-segment tracer (converged cleanly from barrel muzzle!)
    const pts = [];
    if (s.trail && s.trail.length >= 2) {
      let acc = 0;
      pts.push(head);
      for (let i = s.trail.length - 1; i >= 0 && acc < tailLen; i--) {
        const curPhys = s.trail[i];
        const cur = visualShotPoint(s, curPhys, visMuzzle);
        const prev = pts[pts.length - 1];
        const segD = Math.hypot(prev[0] - cur[0], prev[1] - cur[1], prev[2] - cur[2]);
        if (segD < .03) continue;
        if (acc + segD > tailLen) {
          const frac = (tailLen - acc) / segD;
          pts.push([prev[0] + (cur[0] - prev[0]) * frac, prev[1] + (cur[1] - prev[1]) * frac, prev[2] + (cur[2] - prev[2]) * frac]);
          acc = tailLen;
          break;
        }
        pts.push(cur);
        acc += segD;
      }
    }
    if (pts.length < 2) {
      pts.length = 0;
      const tailEnd = (visMuzzle && !s.ricochets && !s.penetrations && traveled <= tailLen + .25)
        ? visMuzzle
        : add(head, scale(s.dir, -tailLen));
      pts.push(head, add(head, scale(sub(tailEnd, head), .45)), tailEnd);
    }

    const nSegs = pts.length - 1;
    const coreW = isMS10 ? .024 : isScherp ? .022 : isP1 ? .020 : .017;
    const finW = isMS10 ? .048 : isScherp ? .044 : isP1 ? .040 : isGuided ? .036 : .030;
    for (let i = 0; i < nSegs; i++) {
      const f0 = 1 - i / nSegs;
      const f1 = 1 - (i + 1) / nSegs;
      const fMid = (f0 + f1) * .5;
      const pA = pts[i], pB = pts[i + 1];
      if (f0 > .24) {
        m.beam(pB, pA, coreW * fMid, coreW * fMid, 'white', pal.core, 3);
      }
      const outerT = finW * (.32 + .68 * fMid);
      m.beam(pB, pA, outerT, coreW * .6, 'white', pal.outer, 3);
    }

    // 3. Minimalist signature slipstream accents
    if (isMS10 || isScherp) {
      const hSegs = 4;
      const hLen = Math.min(tailLen * .75, isMS10 ? 4.2 : 3.2);
      const hStep = hLen / hSegs;
      let prevH = null;
      for (let k = 0; k <= hSegs; k++) {
        const back = .20 + k * hStep;
        const tFrac = k / hSegs;
        const ang = time * (isScherp ? 48 : 38) + s.id * 1.9 + k * 1.3;
        const rH = (isScherp ? (.032 + tFrac * .042) : (.040 + tFrac * .055)) * (1 - tFrac * .35);
        const curH = add(add(head, scale(s.dir, -back)), add(scale(right, Math.cos(ang) * rH), scale(up, Math.sin(ang) * rH)));
        if (prevH) m.beam(prevH, curH, .010 * (1 - tFrac * .45), .010 * (1 - tFrac * .45), 'white', pal.ring, 3);
        prevH = curH;
      }
    }

    if (isGuided) {
      const gRings = isScherp ? 2 : 1;
      const primaryRing = isScherp ? '#38ffbe' : s.aaTier === '1.4' ? '#ff6ee0' : s.gun === 'DF40 II' ? '#8c76ff' : s.gun === 'RD40' ? '#ff5a72' : s.gun === 'RD30' ? '#ffd678' : s.gun === 'RD20' ? '#7cf0ff' : '#a8fff5';
      for (let r = 0; r < gRings; r++) {
        const back = .24 + r * .72 + ((time * 26 + s.id * .7) % .42);
        if (back > tailLen) continue;
        ring(m, add(head, scale(s.dir, -back)), s.dir, .078 + r * .026, .010, 6, primaryRing, 3);
      }
    }

    const machMu = machConeHalfAngle(s.speed);
    if (machMu !== null && (isMS10 || s.gun === 'RD40')) {
      const distBack = .42 + ((time * 26 + s.id) % .55);
      if (distBack < tailLen) {
        const coneScale = clamp(Math.tan(machMu) * 0.11, 0.035, 0.14);
        ring(m, add(head, scale(s.dir, -distBack)), s.dir, .075 + distBack * coneScale, .009, 8, pal.ring, 3);
      }
    }
  }

  // Ejected spinning shell casings.
  if (!lite && match.casings) {
    for (const c of match.casings) {
      if (!spectating && c.shafferCloaked && c.team !== viewerTeam) continue;
      const ca = Math.cos(c.rot) * .032, sa = Math.sin(c.rot) * .032;
      const a = [c.p[0] - ca, c.p[1] - sa * .4, c.p[2] - sa];
      const b = [c.p[0] + ca, c.p[1] + sa * .4, c.p[2] + sa];
      const col = c.gun === 'MS10' ? '#7cefff' : c.gun === 'DF40 II' ? '#b8a8ff' : c.gun === 'DF1 OUT' ? '#b8f2e6' : '#e6c16c';
      m.beam(a, b, .011, .011, 'white', col, (c.gun === 'MS10' || c.gun === 'DF40 II') ? 3 : 1);
    }
  }

  // Clean, sleek, high-clarity tactical impact/damage/kill/skill effects (zero sightline clutter!).
  for (const e of match.effects) {
    if (!spectating && e.kind === 'muzzle' && e.shafferCloaked && e.team !== viewerTeam) continue;
    if (!spectating && e.kind === 'shaffer' && e.team !== viewerTeam) continue;
    const progress = clamp(1 - e.life / (e.max || .2), 0, 1);
    const inv = 1 - progress;
    const seed = e.seed || 1;
    const axis = e.dir || [0, 1, 0];
    const norm = e.normal || scale(axis, -1);
    const isScherpFx = e.aaTier === '1.5';

    if (e.kind === 'muzzle') {
      if (e.actor !== fpActorId && progress < .38) {
        const s = (1 - progress / .38) * (e.gun === 'MS10' ? .88 : .72);
        const fCol = isScherpFx ? '#38ffbe' : e.gun === 'MS10' ? '#58ecff' : e.gun === 'RD 50' ? '#f0c454' : e.source === 'p1' ? '#d48eff' : '#ffc464';
        m.beam(e.p, add(e.p, scale(axis, .30 * s)), .034 * s, .010 * s, 'white', fCol, 3);
        m.ellipsoid(e.p[0], e.p[1], e.p[2], .042 * s, .042 * s, .042 * s, 'white', '#fffef0', 3, 5, 3);
      }
      continue;
    }

    if (e.kind === 'tanker') {
      ring(m, [e.p[0], .25 + progress * 2.2, e.p[2]], [0, 1, 0], 1.2 + progress * 3.4, .048 * inv, lite ? 10 : 16, '#78ffec', 3);
      continue;
    }

    if (e.kind === 'baizerPickup') {
      const is400 = (e.amount || 20) >= 40;
      ring(m, [e.p[0], .20 + progress * 1.8, e.p[2]], [0, 1, 0], .65 + progress * (is400 ? 2.4 : 1.8), .044 * inv, lite ? 10 : 14, '#d876ff', 3);
      continue;
    }

    if (e.kind === 'shaffer') {
      ring(m, [e.p[0], .25 + progress * 1.6, e.p[2]], [0, 1, 0], .55 + progress * 1.7, .038 * inv, lite ? 10 : 14, '#90b8ff', 3);
      continue;
    }

    if (e.kind === 'heal') {
      ring(m, [e.p[0], .20 + progress * 1.8, e.p[2]], [0, 1, 0], .55 + progress * 1.7, .040 * inv, lite ? 10 : 14, '#4cffb4', 3);
      continue;
    }

    if (e.kind === 'kill') {
      // Crisp, restrained takedown burst: brief glint + single clean expanding ring + 6 fine sparks
      if (progress < .28) {
        const f = 1 - progress / .28;
        const cs = .14 * f;
        m.ellipsoid(e.p[0], e.p[1], e.p[2], cs, cs, cs, 'white', '#fffef2', 3, 6, 3);
      }
      const kCol = isScherpFx ? '#42ffc4' : (e.team ? '#ff945c' : '#6cf5e6');
      ring(m, e.p, [0, 1, 0], .18 + progress * .85, .024 * inv, lite ? 10 : 14, kCol, 3);
      const count = lite ? 4 : 6;
      for (let k = 0; k < count; k++) {
        const a1 = (seed * .7 + k * 2.39996) % 6.28;
        const elev = .10 + ((k * 17 + seed) % 6) * .14;
        const spd = .95 + ((k * 13 + seed) % 5) * .20;
        const d = unit([Math.cos(a1), elev, Math.sin(a1)]);
        const start = add(e.p, [d[0] * progress * spd, d[1] * progress * spd - progress * progress * .45 + progress * .25, d[2] * progress * spd]);
        const end = add(start, scale(d, .16 * inv + .02));
        m.beam(start, end, .010 * inv + .003, .010 * inv + .003, 'white', k % 2 ? '#ffe48a' : kCol, 3);
      }
      continue;
    }

    if (e.kind === 'break' || e.kind === 'shield' || e.kind === 'baizerBreak' || e.kind === 'baizer') {
      // Clean tactical shield / BAIZER impact & break: crisp surface ring + fine short energy flecks (zero sightline blocking!)
      const isBaizer = e.kind === 'baizer' || e.kind === 'baizerBreak';
      const isBreak = e.kind === 'break' || e.kind === 'baizerBreak';
      const colCore = isBaizer ? '#f6dcff' : '#e4ffff';
      const colRing = isBaizer ? '#cf6cff' : '#58eeff';
      if (progress < .24) {
        const cr = (isBreak ? .10 : .065) * (1 - progress / .24);
        m.ellipsoid(e.p[0], e.p[1], e.p[2], cr, cr, cr, 'white', colCore, 3, 5, 3);
      }
      ring(m, add(e.p, scale(norm, .03)), norm, .09 + progress * (isBreak ? .62 : .32), (isBreak ? .018 : .012) * inv, lite ? 8 : 12, colRing, 3);
      const count = isBreak ? (lite ? 4 : 6) : (lite ? 2 : 3);
      for (let k = 0; k < count; k++) {
        const a1 = seed + k * 2.39996;
        const d = unit([norm[0] * .75 + Math.cos(a1) * .75, .05 + ((k * 7) % 6) * .12, norm[2] * .75 + Math.sin(a1) * .75]);
        const dist = (.08 + progress * (isBreak ? .92 : .42)) * (.80 + (k % 2) * .25);
        const p0 = add(e.p, [d[0] * dist, d[1] * dist - progress * progress * .28, d[2] * dist]);
        const p1 = add(p0, scale(d, (isBreak ? .16 : .10) * inv + .02));
        m.beam(p0, p1, (isBreak ? .010 : .007) * inv + .002, .006 * inv + .002, 'white', k % 2 ? colRing : colCore, 3);
      }
      continue;
    }

    if (e.kind === 'hit') {
      // Minimal, crisp body-hit feedback: micro-flash + tight thin ring + 3 fine sparks (zero screen obstruction!)
      const isPlasma = e.gun === 'MS10' || e.source === 'p1';
      const hitPrimary = isScherpFx ? '#38ffbe' : e.source === 'p1' ? '#d896ff' : e.gun === 'MS10' ? '#68f2ff' : '#ffd86b';
      const hitHot = isScherpFx ? '#e6fff7' : e.source === 'p1' ? '#faeaff' : e.gun === 'MS10' ? '#e8ffff' : '#fff9dc';
      if (progress < .24) {
        const cr = .065 * (1 - progress / .24);
        m.ellipsoid(e.p[0], e.p[1], e.p[2], cr, cr, cr, 'white', hitHot, 3, 5, 3);
      }
      ring(m, add(e.p, scale(norm, .03)), norm, .07 + progress * .26, .011 * inv, lite ? 6 : 10, hitPrimary, 3);
      const count = lite ? 2 : 3;
      for (let k = 0; k < count; k++) {
        const a1 = seed * 1.3 + k * 2.39996;
        const d = unit([norm[0] * .85 + Math.cos(a1) * .75, .15 + (k % 3) * .16, norm[2] * .85 + Math.sin(a1) * .75]);
        const r0 = .06 + progress * (.46 + (k % 2) * .16);
        const p0 = add(e.p, [d[0] * r0, d[1] * r0 - progress * progress * .26, d[2] * r0]);
        const p1 = add(p0, scale(d, .12 * inv + .02));
        m.beam(p0, p1, .007 * inv + .002, .005 * inv + .002, 'white', k === 0 ? hitHot : (isPlasma ? '#7cf7ff' : hitPrimary), 3);
      }
      continue;
    }

    if (e.kind === 'ricochet' || e.kind === 'penetrate') {
      const isRic = e.kind === 'ricochet';
      const [u, v] = basisOf(isRic ? axis : norm);
      if (progress < .24) {
        const r = (isRic ? .075 : .060) * (1 - progress / .24);
        m.ellipsoid(e.p[0], e.p[1], e.p[2], r, r, r, 'white', isScherpFx ? '#dcfff4' : '#fff6d8', 3, 5, 3);
      }
      ring(m, add(e.p, scale(norm, .03)), norm, .07 + progress * (isRic ? .38 : .28), .012 * inv, 8, isScherpFx ? '#42ffc4' : isRic ? '#ffd872' : '#d4a66a', 3);
      const count = lite ? 2 : 4;
      for (let k = 0; k < count; k++) {
        const ang = seed + k * 2.39996;
        const spread = (isRic ? .34 : .52) * (.5 + (k % 3) * .22);
        const jet = unit(add(add(scale(axis, isRic ? 1.0 : .85), scale(u, Math.cos(ang) * spread)), scale(v, Math.sin(ang) * spread)));
        const spd = (isRic ? 1.4 : 1.0) + (k % 3) * .25;
        const p0 = add(e.p, [jet[0] * progress * spd, jet[1] * progress * spd - progress * progress * .48, jet[2] * progress * spd]);
        const p1 = add(p0, scale(jet, .14 * inv + .02));
        const spC = (!isRic && e.mat === 'wood' && k % 2 === 0) ? '#a87d4e' : isScherpFx ? '#38ffbe' : '#ffd872';
        m.beam(p0, p1, .008 * inv + .002, .005 * inv + .002, (!isRic && e.mat === 'wood' && k % 2 === 0) ? 'wood' : 'white', spC, (!isRic && e.mat === 'wood' && k % 2 === 0) ? 0 : 3);
      }
      continue;
    }

    // Minimalist wall/container/concrete/wood impact sparks (zero opaque dust clouds!)
    const dn = dot(axis, norm);
    const refl = unit(sub(axis, scale(norm, 2 * dn)));
    const mat = e.mat || (e.metal ? 'steel' : 'concrete');
    const isMS10 = e.gun === 'MS10';
    const isP1 = e.source === 'p1';
    const isPlasma = isMS10 || isP1;
    const flashCol = isP1 ? '#e2a8ff' : isMS10 ? '#9ef6ff' : mat === 'steel' ? '#fff4be' : '#ffdf9e';
    const ringCol = isP1 ? '#c87eff' : isMS10 ? '#5ceeff' : mat === 'steel' ? '#ffd56e' : '#d8c29e';
    if (progress < .24) {
      const cr = (isPlasma ? .075 : .052) * (1 - progress / .24);
      m.ellipsoid(e.p[0], e.p[1], e.p[2], cr, cr, cr, 'white', flashCol, 3, 5, 3);
    }
    if (isPlasma || mat === 'steel') {
      ring(m, add(e.p, scale(norm, .03)), norm, .06 + progress * (isPlasma ? .36 : .24), .010 * inv, 8, ringCol, 3);
    }
    const count = lite ? 2 : (mat === 'steel' ? 4 : 3);
    for (let k = 0; k < count; k++) {
      const a1 = seed * 1.7 + k * 2.39996;
      const sprayAxis = mat === 'steel' ? add(scale(refl, .75), scale(norm, .55)) : add(scale(norm, 1.05), scale(refl, .35));
      const d = unit([sprayAxis[0] + Math.cos(a1) * .68, sprayAxis[1] + .22 + (k % 3) * .12, sprayAxis[2] + Math.sin(a1) * .68]);
      const dist = .05 + progress * ((mat === 'steel' ? .68 : .48) + (k % 2) * .18);
      const p0 = add(e.p, [d[0] * dist, Math.max(.02 - e.p[1], d[1] * dist - progress * progress * .48), d[2] * dist]);
      const p1 = add(p0, scale(d, .11 * inv + .02));
      const spCol = isP1 ? '#d898ff' : isMS10 ? '#74f4ff' : mat === 'steel' ? '#ffd562' : mat === 'wood' ? '#b68c5a' : '#d6ccb8';
      m.beam(p0, p1, .007 * inv + .002, .005 * inv + .002, mat === 'wood' ? 'wood' : 'white', spCol, (mat === 'steel' || isPlasma) ? 3 : 0);
    }
  }

  // ChronoTrace 1.0: 3D world-space holographic ballistic crime-scene & death reconstruction ribbons (0 extra draw calls!)
  if (opts && match.chronoTrace && (opts.showChrono || opts.deathTrace)) {
    match.chronoTrace.appendForensicGeometry(m, match.time ?? time, {
      showAll: !!opts.showChrono,
      highlightTrace: opts.deathTrace || null,
      lite
    });
  }

  return m;
}
